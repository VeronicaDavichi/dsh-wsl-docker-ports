/**
 * 自绘配置页（002 T6.1 / T6.2 / T6.3 / T6.4；REQ-10.1–10.5 + REQ-2.2/2.4）
 *
 * ## 页面负责的四件事（每件都有一个可二值判定的结果）
 *
 * 1. **保存前判定 volatile-only**（T6.2）：`profiles` 是 volatile ⇒ 直接写；
 *    含 ordinary 字段 ⇒ 先弹确认「正在运行的终端将被终止」，**确认前一个字节都不写**。
 * 2. **写回只走 settings 管道**（T6.1）：`pipe.saveProfiles(...)` —— 页面里**没有** fetch、
 *    没有 YAML、没有 `configEditor.edit()`。
 * 3. **失败态**（T6.3）：只读 ⇒ 显示原因 + 文件路径；revision 冲突 ⇒ 提示且**保留用户输入**；
 *    宿主不满足唯一寻址 ⇒ 显示限制（不让人白填）。
 * 4. **容错**（T6.4）：有问题的行**只**标红并排除出 patch，其余行照常保存；
 *    文案明示「改 cwd 只影响新建实例」。
 *
 * ## 🔴 2026-10-12 缺陷 A：只读态的真机可达路径（本轮修复）
 *
 * 真机上 `describe()` **给不出**逐命名空间可写性（外层 `writable` 是恒真桩、namespace 不带任何
 * 可写性字段、全载荷无路径 —— 查证见 `config-pipe.ts` 文件头）⇒ 只读态**只能**由「写入被拒」触发。
 * 修复前那条拒绝落在 `failed` 分支：页面只说「写入配置失败：…」，**不**进只读态；而且**即使**
 * 已判定只读，编辑控件也没有 `disabled` ⇒ 真机上渲染成**完全可编辑**的表单（正是缺陷症状）。
 *
 * 现在两条都补上：① `saveProfiles` 把「被上层 patch 覆盖」的拒绝归成 `readonly`（见 `config-pipe.ts`）
 * ⇒ 本组件第 179 行那一支**粘性**设置 `readOnly`（只设不清）；② `readOnly !== undefined` ⇒ 编辑控件
 * 全锁（`ConfigRow` 的 `disabled`、「新增 profile」`disabled`），并在根节点留 `data-readonly` 给门断言。
 *
 * ⚠️ **保留「保存」按钮可点**（故意）：只读态下点它正是 REQ-10.3 的「**不写盘**」证据面（`commit()`
 * 早退 ⇒ `updateCount` 不增长），也是既有关（`client-config-page.test.tsx` T6.3）逐字断言的行为。
 * 锁住的是**编辑面**（输入框 / 删除 / 新增），不是「问一句为什么不能存」。
 *
 * ## 状态全在本组件（行编辑器是受控子件）
 *
 * `rows` / `notice` / `readOnly` / `limitation` / `confirming` 五个 state 就是全部；没有第二个真相源，
 * 所以「冲突后输入还在不在」这种断言可以直接对 DOM 做（输入框的值来自 `rows`）。
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { parseRowStructure } from '../config/row-rules.ts';
import { ConfigRow } from './config-row.tsx';
import { CONFIG_PATCH_FIELD, DEFAULT_LIVENESS, READONLY_PATH_UNKNOWN } from './config-pipe.ts';
import type { ConfigPipe, FieldLiveness, ReadOnlyNotice } from './config-pipe.ts';
import { draftRow, emptyRow, fromRawRow } from './config-row-model.ts';
import type { EditableRow } from './config-row-model.ts';

/** 语义明示（REQ-2.4）：**逐字**出现在配置文件页上，测试按子串断言 */
export const CWD_NOTICE = '改 cwd 只影响新建实例：已在运行的终端保持原工作目录（不会迁移、不会重启）';

/** volatile 确认文案（REQ-2.2）：**逐字**「正在运行的终端将被终止」 */
export const CONFIRM_MESSAGE = '该变更含 ordinary 字段 ⇒ 保存会重挂载插件行，正在运行的终端将被终止。确认后才会写盘。';

/** 配置页槽位里的摘要视图（`ownerProps.view === 'summary'`） */
export function ConfigSummary(): ReactElement {
  return (
    <span className="dtp-config-summary" data-testid="cfg-summary">
      受管终端：终端 profile 配置（点开编辑；保存不重启正在运行的终端）
    </span>
  );
}

interface Notice {
  readonly kind: 'ok' | 'warn' | 'error' | 'conflict' | 'readonly' | 'unavailable';
  readonly message: string;
}

export interface ConfigPageProps {
  /** 写回管道（缺省 = 未接线：页面仍可打开，但保存会明说不可用） */
  readonly pipe?: ConfigPipe | undefined;
  /** 字段存活判定（缺省 = 本包 schema 的静态事实；宿主可注入覆盖） */
  readonly liveness?: FieldLiveness | undefined;
  /** 初始行（测试 / 宿主预填）；省略时由 `pipe.readConfig()` 载入 */
  readonly initialRows?: readonly EditableRow[] | undefined;
}

/**
 * 只读提示文案（REQ-10.3）：**原因一定要有**（宿主拒绝原文）；路径**宿主给得出才写**，
 * 给不出就如实写「宿主未提供」—— 为什么不伪造路径见 `config-pipe.ts` 的 `READONLY_PATH_UNKNOWN`
 * 源码查证（线上 `describe` 载荷无路径、唯一远端出口只回 `{opened:true}`）。
 *
 * 本函数**故意不导出**：它是页面内部的文案口径，不进包的运行时导出面（导出预算见 001 REQ-6.4）。
 */
function readOnlyNoticeText(notice: ReadOnlyNotice): string {
  return notice.path === READONLY_PATH_UNKNOWN
    ? `未写入：${notice.reason}（配置文件路径：宿主未提供）`
    : `未写入：${notice.reason}（配置文件：${notice.path}）`;
}

/** 逐行问题：转换层（`draftRow().problems`）与结构层（`parseRowStructure`）合成一份 */export function collectRowProblems(
  rows: readonly EditableRow[],
): { readonly problems: ReadonlyMap<number, readonly string[]>; readonly drafts: readonly ReturnType<typeof draftRow>[] } {
  const collected = new Map<number, string[]>();
  const drafts = rows.map((row, index) => draftRow(row, index));
  for (const draft of drafts) {
    const messages = [...draft.problems];
    const parsed = parseRowStructure(draft.raw, draft.index);
    if (!parsed.ok) messages.push(parsed.diagnostic.message);
    if (messages.length > 0) collected.set(draft.index, messages);
  }
  return { problems: collected, drafts };
}

export function ConfigPage(props: ConfigPageProps): ReactElement {
  const { pipe, liveness = DEFAULT_LIVENESS } = props;
  const [rows, setRows] = useState<readonly EditableRow[]>(props.initialRows ?? [emptyRow()]);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [readOnly, setReadOnly] = useState<ReadOnlyNotice | undefined>(undefined);
  const [limitation, setLimitation] = useState<string | undefined>(undefined);
  const [revision, setRevision] = useState<unknown>(undefined);
  const [confirming, setConfirming] = useState<readonly string[] | undefined>(undefined);
  const [problems, setProblems] = useState<ReadonlyMap<number, readonly string[]>>(new Map());
  const [loading, setLoading] = useState(pipe !== undefined && props.initialRows === undefined);
  /**
   * 用户是否已经动过表单。🔴 存在的理由：`readConfig()` 是一次 IPC 往返，
   * 期间用户**可以**打字；加载回来无条件 `setRows` 会把刚敲的字**冲掉**（真实竞态，不是测试问题）。
   * 故加载只填「用户还没碰过」的表单；只读/限制/revision 无论如何都填。
   */
  const touched = useRef(false);

  useEffect(() => {
    if (pipe === undefined) {
      setNotice({ kind: 'unavailable', message: '配置写回管道未接线：只能查看与编辑本地表单，无法写盘' });
      setLoading(false);
      return;
    }
    let alive = true;
    void pipe.readConfig().then((outcome) => {
      if (!alive) return;
      setLoading(false);
      if (outcome.kind === 'unavailable') {
        setNotice({ kind: 'unavailable', message: outcome.message });
        return;
      }
      if (outcome.kind === 'failed') {
        setNotice({ kind: 'error', message: outcome.message });
        return;
      }
      setReadOnly(outcome.state.readOnly);
      setLimitation(outcome.state.addressability?.reason);
      setRevision(outcome.state.revision);
      if (!touched.current) setRows(outcome.state.rows.map(fromRawRow));
    });
    return () => {
      alive = false;
    };
  }, [pipe]);

  function updateRow(index: number, next: EditableRow): void {
    touched.current = true;
    setRows((current) => current.map((row, position) => (position === index ? next : row)));
  }

  function removeRow(index: number): void {
    touched.current = true;
    setRows((current) => current.filter((_row, position) => position !== index));
  }

  /** 管道回报的逐行问题并进同一张表（页面已先滤过一遍 ⇒ 正常为空，这里只是别把问题丢掉） */
  function mergeSkipped(skipped: readonly { readonly index: number; readonly message: string }[]): void {
    if (skipped.length === 0) return;
    setProblems((current) => {
      const next = new Map(current);
      for (const problem of skipped) next.set(problem.index, [...(next.get(problem.index) ?? []), problem.message]);
      return next;
    });
  }

  /** 真正写盘（确认之后 / volatile-only 直接走） */
  async function commit(): Promise<void> {
    setConfirming(undefined);
    if (readOnly !== undefined) {
      // 只读已判定 ⇒ **一个字节都不写**（`pipe.updateCount()` 保持不动）
      setNotice({ kind: 'readonly', message: readOnlyNoticeText(readOnly) });
      return;
    }
    const collected = collectRowProblems(rows);
    setProblems(collected.problems);
    const saveable = collected.drafts.filter((draft) => !collected.problems.has(draft.index)).map((draft) => draft.raw);
    if (collected.drafts.length > 0 && saveable.length === 0) {
      // 全部条目都有问题 ⇒ **不调管道**（否则会用一个空数组把既有配置清空）
      setNotice({
        kind: 'error',
        message: `全部 ${collected.drafts.length} 条 profile 都有问题 ⇒ 未写盘（已在下面对应行标出，输入已保留）`,
      });
      return;
    }
    if (pipe === undefined) {
      setNotice({ kind: 'unavailable', message: '配置写回管道未接线：未写盘，输入已保留' });
      return;
    }
    const outcome = await pipe.saveProfiles(saveable, revision);
    if (outcome.kind !== 'unavailable' && outcome.kind !== 'ok') mergeSkipped(outcome.skipped);
    if (outcome.kind === 'ok') {
      setNotice({
        kind: collected.problems.size === 0 ? 'ok' : 'warn',
        message:
          collected.problems.size === 0
            ? `已保存 ${outcome.saved} 条 profile（live 路径，正在运行的终端不受影响；不重挂载）`
            : `已保存 ${outcome.saved} 条；${collected.problems.size} 条有问题**未**写入（已在下面对应行标出）`,
      });
      // 写入成功后只刷新 revision（**不**动用户正在编辑的行）
      void pipe.readConfig().then((next) => {
        if (next.kind === 'ok') setRevision(next.state.revision);
      });
      return;
    }
    if (outcome.kind === 'readonly') {
      setReadOnly(outcome.notice);
      setNotice({ kind: 'readonly', message: readOnlyNoticeText(outcome.notice) });
      return;
    }
    if (outcome.kind === 'conflict') setNotice({ kind: 'conflict', message: outcome.message });
    else if (outcome.kind === 'unavailable') setNotice({ kind: 'unavailable', message: outcome.message });
    else if (outcome.kind === 'invalid') setNotice({ kind: 'error', message: outcome.message });
    else setNotice({ kind: 'error', message: outcome.message });
  }

  /** 保存入口：先做存活判定（T6.2），必要时先要确认 */
  function requestSave(): void {
    const verdict = liveness.classify([CONFIG_PATCH_FIELD]);
    if (!verdict.volatileOnly) {
      setConfirming(verdict.ordinaryFields);
      return;
    }
    void commit();
  }

  /**
   * 只读态 ⇒ **编辑面全锁**（缺陷 A 的「不可编辑」半边）。
   * 判据来源有两处且都汇到同一个状态：读配置时宿主说不可写（`:110`），或写入被拒（`:180`）。
   */
  const locked = readOnly !== undefined;

  return (
    <div
      className="dtp-config"
      data-testid="cfg-page"
      data-loading={loading ? 'true' : 'false'}
      data-readonly={locked ? 'true' : 'false'}
    >
      <div className="dtp-config-head">
        <span className="dtp-config-title">终端 profile 配置</span>
        <button
          type="button"
          className="dtp-config-add"
          data-testid="btn-profile-add"
          disabled={locked}
          onClick={() => {
            touched.current = true;
            setRows((current) => [...current, emptyRow()]);
          }}
        >
          新增 profile
        </button>
        <button type="button" className="dtp-config-save" data-testid="btn-profile-save" onClick={requestSave}>
          保存
        </button>
      </div>

      {loading ? (
        <div className="dtp-config-loading" data-testid="cfg-loading">
          正在读取配置…
        </div>
      ) : null}

      {readOnly === undefined ? null : (
        <div className="dtp-config-readonly" data-testid="cfg-readonly">
          <span>只读：{readOnly.reason}</span>
          <span className="dtp-config-path">
            {readOnly.path === READONLY_PATH_UNKNOWN ? '配置文件路径：宿主未提供' : `配置文件：${readOnly.path}`}
          </span>
        </div>
      )}

      {limitation === undefined ? null : (
        <div className="dtp-config-limitation" data-testid="cfg-limitation">
          {limitation}
        </div>
      )}

      {notice === undefined ? null : (
        <div className="dtp-config-notice" data-testid="cfg-error" data-notice-kind={notice.kind}>
          {notice.message}
        </div>
      )}

      {confirming === undefined ? null : (
        <div className="dtp-config-confirm" data-testid="cfg-confirm">
          <span>{CONFIRM_MESSAGE}</span>
          <span className="dtp-config-confirm-fields" data-testid="cfg-confirm-fields">
            ordinary 字段：{confirming.join('、')}
          </span>
          <button
            type="button"
            className="dtp-config-confirm-ok"
            data-testid="btn-confirm-save"
            onClick={() => {
              void commit();
            }}
          >
            确认并保存
          </button>
          <button
            type="button"
            className="dtp-config-confirm-cancel"
            data-testid="btn-cancel-save"
            onClick={() => {
              setConfirming(undefined);
            }}
          >
            取消
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="dtp-config-empty" data-testid="cfg-empty">
          还没有任何 profile：点「新增 profile」开始（REQ-1.5 的引导态）
        </div>
      ) : (
        rows.map((row, index) => (
          <ConfigRow
            key={`row-${index}`}
            row={row}
            index={index}
            problems={problems.get(index) ?? []}
            readOnly={locked}
            onChange={updateRow}
            onRemove={removeRow}
          />
        ))
      )}

      <div className="dtp-config-cwd-notice" data-testid="cfg-cwd-notice">
        {CWD_NOTICE}
      </div>
    </div>
  );
}
