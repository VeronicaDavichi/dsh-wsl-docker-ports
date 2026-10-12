/**
 * 009 T1.1–T1.3 写通道**结果区**：四态逐步反馈（成功 / 失败 / 跳过 / 回滚）
 *
 * ## 数据源 = 服务端 `apply` 的 `ApplyReport`（`../transport/apply.ts`，服务端一行不改）
 *
 * `write-dto.ts` 把响应收敛成 `ClientApplyReport`。四个状态在**服务端都有真实生产者**：
 *
 * | 状态 | 服务端字段（出处 `transport/apply.ts`） | 生产者 |
 * | --- | --- | --- |
 * | 成功 | `executed: string[]` | L383 `result.steps.filter(ok).map(name)`（005 报告的步骤名） |
 * | 跳过 | `skipped: WriteStepKind[]` | L384 `only.steps.map(kind).filter(kind => !reported.has(kind))` |
 * | 失败 | `failed: { name, ok:false, reason }[]` | L385-387（`reason` = 该步 `stderr`，**可能是空串**） |
 * | 回滚 | `rolledBack: { port, listenAddress, ok, message }[]` | L317-348（只回滚**本轮刚加成功**的转发规则） |
 *
 * ⚠️ `host.ts` 的 `ForwardWriteReport`（005 `ElevationInvoker` 的面，`steps[{name,ok,stderr}]`）**不是**本区的数据源 ——
 * 它只被 `page.ts:summarizeWriteReport` 用来算「未改动」清单（另一块 UI）。本文件**不**改它、也不假装它有 `skipped` / `rolledBack` 位。
 *
 * ## 四条不许违反的渲染规矩
 *
 * 1. **只渲染真实存在的字段**：没有的清单**不渲染空段**；某状态在响应里**没有**原因字段时，
 *    就明写「服务端未给原因」，**不编**原因。
 * 2. **不重排**：每个清单按服务端给的顺序渲染（`executed` / `failed` 是 005 的报告顺序，
 *    `skipped` 是计划顺序）。🔴 响应里**没有**一份「跨清单统一有序」的 `steps[]` ⇒ 各清单之间的
 *    **相对次序不可知**；本文件不合并、不排序（合并排序 = 编造顺序）。
 * 3. **失败必带可读原因**（T1.2）：`reason` 原样搬运；空串时给**明确标注为兜底**的文案。
 * 4. **判定色只走 `styles.ts` 既有类名**（`wdp-tag-ok` / `wdp-tag-danger` / `wdp-tag-muted` /
 *    `wdp-tag-warn` ⇒ 宿主 `var(--dsw-alias-state-*)`）：本文件零 hex（T1.3），也不新造类名。
 */

import type { ReactElement } from 'react';

import type { ClientApplyReport } from './write-dto.ts';

/** 结果区的 `data-testid`（就近定义；不进 `write-confirm.tsx` 的 `WRITE_TESTID`） */
export const WRITE_RESULT_TESTID = {
  summary: 'write-result-summary',
  empty: 'write-result-empty',
  step: 'write-result-step',
} as const;

/** 四个状态（= 服务端四张清单，逐字对应） */
export type WriteResultState = 'executed' | 'failed' | 'skipped' | 'rolledBack';

/** 四态 → **既有**类名（白名单在 `styles.ts`；这里只有类名，颜色仍是宿主 token） */
export const RESULT_TONE_CLASS: Readonly<Record<WriteResultState, string>> = {
  executed: 'wdp-tag-ok',
  failed: 'wdp-tag-danger',
  skipped: 'wdp-tag-muted',
  rolledBack: 'wdp-tag-warn',
};

/** 每个清单的 `data-testid`（渲染分支的判据锚点） */
export const RESULT_GROUP_TESTID: Readonly<Record<WriteResultState, string>> = {
  executed: 'write-result-executed',
  failed: 'write-result-failed',
  skipped: 'write-result-skipped',
  rolledBack: 'write-result-rolled-back',
};

/** 四态标题（中性描述，不含任何推测） */
export const RESULT_STATE_LABEL: Readonly<Record<WriteResultState, string>> = {
  executed: '已执行（成功）',
  failed: '失败',
  skipped: '未执行（跳过）',
  rolledBack: '回滚',
};

/** 渲染顺序（固定；**不**代表执行顺序 —— 见文件头规矩 2） */
export const RESULT_STATE_ORDER: readonly WriteResultState[] = ['executed', 'failed', 'skipped', 'rolledBack'];

/** 失败原因兜底（`ApplyStepOutcome.reason` 类型可为 `null`，实际生产者给的是 `StepReport.stderr` ⇒ 空串也可能） */
export const FAILURE_REASON_FALLBACK =
  '服务端未给出该步骤的原因（stderr 为空）—— 失败是事实，细节请查宿主日志';

/** 跳过项的说明（服务端只有 `WriteStepKind[]`，**没有**逐条原因字段） */
export const SKIP_DETAIL = '未执行：服务端未在 005 的逐步报告里列出这一步（服务端未给逐条跳过原因）';

/** 回滚说明兜底 */
export const ROLLBACK_MESSAGE_FALLBACK = '服务端未给出这一条回滚的说明（message 为空）';

/** 步骤名兜底（正常路径不会用到；用到了说明服务端给了空名，如实标注，不编名字） */
export const STEP_NAME_FALLBACK = '（服务端未给步骤名）';

/** 一段可读原因：非空则原样搬运（不 trim 文案内容以外的东西、不改写），空则给兜底 */
export function readableReason(reason: string): string {
  return reason.trim() === '' ? FAILURE_REASON_FALLBACK : reason;
}

/** 一行结果（渲染与判据共用的形状） */
export interface WriteResultRow {
  /** React key（含序号 ⇒ 同名步骤不会撞 key） */
  readonly key: string;
  readonly state: WriteResultState;
  /** 名称：步骤名 / 步骤种类 / 回滚目标 */
  readonly name: string;
  /** 结果 + 原因（失败必带可读原因） */
  readonly detail: string;
}

/**
 * 四张清单 → 渲染行（**顺序 = 服务端给的顺序**；不做任何排序、合并没有的项）。
 *
 * 纯函数 ⇒ 可在无 DOM 下逐条断言「名称 / 结果 / 原因」与顺序。
 */
export function buildResultRows(report: ClientApplyReport): Readonly<Record<WriteResultState, readonly WriteResultRow[]>> {
  return {
    executed: report.executed.map((name, index) => ({
      key: `executed-${String(index)}-${name}`,
      state: 'executed' as const,
      name: name === '' ? STEP_NAME_FALLBACK : name,
      detail: '成功：已执行并成功（005 逐步报告里 ok=true）',
    })),
    failed: report.failed.map((item, index) => ({
      key: `failed-${String(index)}-${item.name}`,
      state: 'failed' as const,
      name: item.name === '' ? STEP_NAME_FALLBACK : item.name,
      detail: `失败：${readableReason(item.reason)}`,
    })),
    skipped: report.skipped.map((kind, index) => ({
      key: `skipped-${String(index)}-${kind}`,
      state: 'skipped' as const,
      name: kind,
      detail: SKIP_DETAIL,
    })),
    rolledBack: report.rolledBack.map((item, index) => ({
      key: `rolledBack-${String(index)}-${String(item.port)}`,
      state: 'rolledBack' as const,
      name: `端口 ${String(item.port)} 的转发规则`,
      detail: `${item.ok ? '回滚成功' : '回滚失败'}：${
        item.message.trim() === '' ? ROLLBACK_MESSAGE_FALLBACK : item.message
      }`,
    })),
  };
}

export interface WriteResultPanelProps {
  /** 服务端 `apply` 的回执（客户端视图）；由 `write-panel.tsx` 持有**最近一次**执行结果 */
  readonly report: ClientApplyReport;
}

/**
 * 结果正文（不含外层 `section`：外层与标题由 `write-panel.tsx` 渲染，`data-testid="write-result"` 保持原位）。
 *
 * 「空态不渲染空段」= 某清单为空时**连容器都不渲染**（不是渲染一个「（无）」）⇒ 判据可二值判定。
 */
export function WriteResultPanel({ report }: WriteResultPanelProps): ReactElement {
  const rows = buildResultRows(report);
  const total = RESULT_STATE_ORDER.reduce((sum, state) => sum + rows[state].length, 0);

  return (
    <>
      <p className="wdp-secondary" data-testid={WRITE_RESULT_TESTID.summary}>
        status={report.status} / 后端={report.backend} / 提权档={report.elevationPolicy} / 耗时=
        {String(report.durationMs)} ms
      </p>
      <p>{report.message === '' ? '（服务端未给 message）' : report.message}</p>
      {report.hint === '' ? null : <p className="wdp-muted">{report.hint}</p>}
      {total === 0 ? (
        <p className="wdp-muted" data-testid={WRITE_RESULT_TESTID.empty}>
          四张清单都是空的（服务端未报告任何步骤结果）—— 结论以上面的 status / message 为准。
        </p>
      ) : null}
      {RESULT_STATE_ORDER.map((state) => {
        const list = rows[state];
        // 🔴 空态不渲染空段
        if (list.length === 0) return null;
        return (
          <div
            key={state}
            data-testid={RESULT_GROUP_TESTID[state]}
            data-state={state}
            data-tone={RESULT_TONE_CLASS[state]}
            data-count={String(list.length)}
          >
            <p className="wdp-secondary">
              {RESULT_STATE_LABEL[state]}：{String(list.length)} 项
            </p>
            <ul className="wdp-list">
              {list.map((row) => (
                <li
                  key={row.key}
                  className={`wdp-row ${RESULT_TONE_CLASS[state]}`}
                  data-testid={WRITE_RESULT_TESTID.step}
                  data-state={state}
                >
                  <span>{row.name}</span>
                  <span className="wdp-secondary">{row.detail}</span>
                </li>
              ))}
            </ul>
            {state === 'skipped' ? (
              <p className="wdp-muted">
                服务端只给步骤种类、没有逐条原因 ⇒ 这里只报「未执行」这一事实（不替服务端编原因）。
              </p>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
