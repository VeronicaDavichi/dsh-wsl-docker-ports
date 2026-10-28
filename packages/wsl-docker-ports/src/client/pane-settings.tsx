/**
 * 配置类与下一期区域（003 T5.3 / T5.5 / T5.7）：端口声明表单 / 提权策略 / exec 注入点 / 原始输出
 *
 * ## 为什么这几块单独一个文件
 *
 * 它们**都只写配置**（`managedPorts` / `elevationPolicy`），与 `pane-tables.tsx` 的只读展示
 * 是两类东西：一个错误的改动方向是「顺手在这里调提权」——拆开后，本文件的入参里
 * **只有** `settings` 侧回调，没有任何写规则/提权的入口。
 *
 * 提权策略下拉**刻意不被 NAT 门或策略自身置灰**：`none` 若把 `sel-elevation` 也锁死，
 * 用户就永远回不到 `ask`（死锁）；「全部写控件置灰」的对象是**转发写控件**（REQ-1.1）。
 */

import { useState, type ReactElement } from 'react';

import { TESTID } from './rows.ts';
import type { ElevationPolicyValue } from './settings-pipe.ts';
import type { ExecControlView, PortsPageView } from './types.ts';

/**
 * 提权告知块的 `data-testid`（005 T2b.3）。**刻意不进 `rows.ts` 的 `TESTID`** ——
 * 那张表的口径是「requirements §2 的 **11 个控件**」（`tests/unit/client-rows.test.ts` 的 T5.4
 * 逐字断言 `ids.length === 11`），而告知块是**静态段落、不是控件** ⇒ 按本文件既有的
 * `WRITE_TOKEN_TESTID` 先例自己持有一份（2026-10-15 首次误放进 `TESTID`，被 T5.4 判红后改正）。
 */
export const ELEVATION_NOTICE_TESTID = 'elevation-consent-notice';

/** 凭据块的 `data-testid`（008 T3.1 自己的一份；不进 `rows.ts` 的 `TESTID`，那里已 364/400 行） */
export const WRITE_TOKEN_TESTID = {
  block: 'write-token',
  state: 'write-token-state',
  generate: 'btn-write-token-generate',
  once: 'write-token-once',
  /**
   * 一次性凭据的**复制**按钮（🆕 2026-10-12 a11y 加固轮）：值是明文、可鼠标选中，
   * 但**不进无障碍树** ⇒ 屏幕阅读器/自动化快照走的是这枚按钮（其无障碍名**不含值**）。
   */
  copy: 'btn-write-token-copy',
  /** 复制结果提示（成功/失败文案都**不含**凭据本体） */
  copyNote: 'write-token-copy-note',
  note: 'write-token-note',
  consequence: 'write-token-consequence',
  check: 'btn-write-token-check',
  clear: 'btn-write-token-clear',
  clearConfirm: 'btn-write-token-clear-confirm',
  clearCancel: 'btn-write-token-clear-cancel',
  /**
   * 「服务端要读到新值」那段说明的锚点（009 收口轮 T2 加的）：文案原文里**不许**再出现
   * 「未验证」——真机已验通投递链；用例按这个 testid 取 `textContent` 逐字核。
   */
  delivery: 'write-token-delivery',
} as const;

/**
 * 017 二订（主人 2026-10-27 原话）：「端口声明（managedPorts） 放到插件页面的配置里，
 * 展示放在外面容器的侧边栏里」⇒ 本块**只展示、不编辑**：
 *
 * - 编辑入口只剩 bundle 卡片页的配置页（那里和提权档/刷新频次/发行版共用底部一个「保存设置」）；
 * - 这里保留「声明了什么」的读数，因为它紧挨端口表与「集合外规则」区：
 *   看到某条规则为什么不在五态里，比翻一次配置页快得多。
 *
 * 只读 ⇒ **不携带 `data-write-control`**，也**不因提权档 `none` 置灰**（它不触发任何写）。
 */
export function ManagedPortsSummary(props: { readonly form: PortsPageView['managedPorts'] }): ReactElement {
  const { form } = props;
  const declared = form.rangeText.trim();
  return (
    <section className="wdp-sec" data-testid="managed-ports-summary">
      <h3>端口声明（managedPorts）</h3>
      {declared === '' ? (
        <p className="wdp-muted" data-testid="managed-ports-empty">
          还没有声明任何端口（集合外的规则一律不进五态、不计入任何计数）。
        </p>
      ) : (
        <p className="wdp-pre" data-testid="managed-ports-declared">
          {declared}
        </p>
      )}
      {form.presets.some((preset) => preset.checked) ? (
        <p className="wdp-muted" data-testid="managed-ports-presets">
          已声明的常用端口：{form.presets.filter((preset) => preset.checked).map((preset) => preset.label).join('、')}
        </p>
      ) : null}
      {form.issues.length > 0 ? (
        <ul className="wdp-list wdp-error" data-testid="managed-ports-issues">
          {form.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <p className="wdp-muted" data-testid="managed-ports-readonly-note">
        本页只读：要改声明请到「插件 → WSL Port Forwarding」卡片页的配置区（配置页是唯一写入口）。
      </p>
    </section>
  );
}
export function ElevationBlock(props: {
  readonly elevation: PortsPageView['elevation'];
  /**
   * 010 `T7.3`：省略 = **只读**。
   * 提权档的写入口已收到宿主的插件配置页（`client/config-page.tsx`）——
   * 同一字段只留**一个**写入口（`REQ-12.2` / D-4），这里只展示 + 指路。
   */
  readonly onChange?: ((policy: ElevationPolicyValue) => void) | undefined;
}): ReactElement {
  const { elevation, onChange } = props;
  const readOnly = onChange === undefined;
  return (
    <section className="wdp-sec">
      <h3>提权策略</h3>
      <select
        className="wdp-btn"
        data-testid={TESTID.elevation}
        data-settings-control="1"
        disabled={!elevation.enabled || readOnly}
        value={elevation.value}
        onChange={(event) => {
          if (onChange !== undefined) onChange(event.target.value as ElevationPolicyValue);
        }}
      >
        {elevation.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="wdp-muted">{elevation.note}</p>
      {readOnly ? (
        <p className="wdp-secondary" data-testid="elevation-readonly-pointer">
          只读：提权档的写入口已收到宿主的插件配置页（设置 → 插件 → dsh-wsl-docker-ports）。同一字段只留一个写入口。
        </p>
      ) : null}
      <p className="wdp-secondary wdp-gate" data-testid={ELEVATION_NOTICE_TESTID}>
        {elevation.notice}
      </p>
    </section>
  );
}

/**
 * 写通道凭据（008 T3.1 契约 1 / 009 REQ-1.3）：**唯一的凭据生成入口**。
 *
 * - 契约要求「由**配置页**提供生成并保存动作」+「一次性显示」⇒ 这里只有一枚按钮与一段
 *   **生成后才有**的明文（`issued`）。刷新后 `issued` 为空 ⇒ 明文不再出现（凭据仍活在本会话的
 *   sessionStorage 里，客户端照常带得出去），这正是「一次性」的落地方式。
 * - 本块**不携带 `data-write-control`**：它不是提权写控件，非 NAT 时也必须可用
 *   （与 `sel-elevation` 同一口径 —— 否则「没凭据」与「非 NAT」两把锁会互相锁死）。
 * - 生成后要写服务端配置，故 `onGenerate` 是异步的；`busy` 期间按钮不可点（避免连点生成两串）。
 * - 🔴 **只显示布尔，不回显既有值**：本组件能拿到的凭据事实只有
 *   `sessionPresent: boolean`（本会话仓库）与 `configured: boolean | null`（服务端配置**是否**已配置，
 *   `null` = 还没检查）——`writeToken` 的值根本没有进 props 的**通路**（唯一例外是 `issued`，
 *   即刚生成的那一次）。
 * - **清除 / 轮换**：轮换 = 再点一次生成（覆盖）；清除 = 两段式按钮（先「清除凭据」、
 *   再「确认清除」/「取消」）⇒ 二次确认在 UI 层、可被断言。
 * - 🔴 **a11y 加固（2026-10-12 缺陷修复）**：一次性明文**不进无障碍树**。修前 `{issued}` 直接是
 *   `<code>` 的文本子节点 ⇒ 无障碍树里就是一个 `StaticText` 节点、`name` = 凭据本体 ⇒ 每次
 *   自动化验收快照（chrome-devtools `take_snapshot`）都把一次性凭据打进快照证据（违反了
 *   `write-token.ts` 的「不落盘」口径）。修法 = 明文留在 `aria-hidden="true"` 容器里
 *   （**屏上仍可见、可鼠标选中**）+ 一枚无障碍名**不含值**的「复制」按钮；值只经
 *   `navigator.clipboard.writeText` 出去，**不进**文本节点之外的任何可读面（属性/日志/快照）。
 */
export function WriteTokenBlock(props: {
  readonly sessionPresent: boolean;
  readonly configured: boolean | null;
  readonly issued: string | null;
  readonly busy: boolean;
  readonly note: string | null;
  readonly confirmingClear: boolean;
  readonly onGenerate: () => void;
  readonly onCheck: () => void;
  readonly onClearRequest: () => void;
  readonly onClearConfirm: () => void;
  readonly onClearCancel: () => void;
}): ReactElement {
  const { sessionPresent, configured, issued, busy, note, confirmingClear, onGenerate, onCheck, onClearRequest, onClearConfirm, onClearCancel } = props;
  const configuredText = configured === null ? '未检查' : configured ? '已配置' : '未配置（写通道一律 401，fail-safe）';
  const [copyNote, setCopyNote] = useState<string | null>(null);
  /**
   * 复制到剪贴板（**唯一**把凭据送出去的 UI 动作）。
   * 🔴 失败文案也要过 `withoutValue()`：剪贴板异常文本原则上不含值，但「异常对象里带上了等待的值」
   * 是这类 API 的常见坑 ⇒ 落进 DOM 之前**无条件**把值替换掉（与「凭据零日志」同一条红线）。
   */
  const withoutValue = (text: string): string => (issued === null ? text : text.split(issued).join('«凭据已隐藏»'));
  const copyIssued = async (): Promise<void> => {
    if (issued === null) return;
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (value: string) => Promise<void> } } }).navigator?.clipboard;
    if (clipboard?.writeText === undefined) {
      setCopyNote('本环境没有剪贴板 API：请直接选中上面那串手工复制（明文可选中）。');
      return;
    }
    try {
      await clipboard.writeText(issued);
      setCopyNote('已复制到剪贴板。该值不进无障碍树、不进日志、不落盘（只活在本会话的 sessionStorage 里）。');
    } catch (error) {
      setCopyNote(withoutValue(`复制失败：${error instanceof Error ? error.message : String(error)}（请直接选中上面那串手工复制）`));
    }
  };
  return (
    <section className="wdp-sec" data-testid={WRITE_TOKEN_TESTID.block}>
      <h3>写通道凭据</h3>
      <p
        className="wdp-muted"
        data-testid={WRITE_TOKEN_TESTID.state}
        data-session-credential={sessionPresent ? '1' : '0'}
        data-config-configured={configured === null ? 'unknown' : configured ? '1' : '0'}
      >
        本会话持有凭据：{sessionPresent ? '是' : '否'}；服务端配置 writeToken：{configuredText}（这里**只报布尔**，不回显凭据本体）
      </p>
      <p className="wdp-muted">
        写操作会改动本机 `netsh portproxy` 与 Windows 防火墙规则；本凭据用于阻止本机其它用户进程调用写通道（它不是加密、不是账号体系）。
      </p>
      {sessionPresent && configured !== false ? null : (
        <p className="wdp-error" data-testid={WRITE_TOKEN_TESTID.consequence}>
          后果：写入口会 401（凭据缺失 ⇒ `plan` / `apply` / `audit` 一律 unauthorized，零执行零写入）⇒ 请先在本页「生成并保存写通道凭据」（`writeToken` 是 volatile 字段、宿主每请求现读 ⇒ **即时生效**，不需要重载插件行）。
        </p>
      )}
      <button
        type="button"
        className="wdp-btn wdp-btn-primary"
        data-testid={WRITE_TOKEN_TESTID.generate}
        data-settings-control="1"
        disabled={busy}
        onClick={onGenerate}
      >
        生成并保存写通道凭据
      </button>
      {issued === null ? null : (
        <div>
          <p className="wdp-error">
            ⚠️ 这串**离开后将不再显示，请立即复制**（页面不提供「再显示一次」的入口）。它**不进无障碍树**（屏幕阅读器读不到该值）—— 请用下面的「复制写通道凭据」按钮，或鼠标选中手工复制。
          </p>
          <div className="wdp-once-row">
            <p className="wdp-once-code" aria-hidden="true">
              <code className="wdp-pre" data-testid={WRITE_TOKEN_TESTID.once}>
                {issued}
              </code>
            </p>
            <button type="button" className="wdp-btn wdp-once-copy" data-testid={WRITE_TOKEN_TESTID.copy} onClick={() => void copyIssued()}>
              复制写通道凭据
            </button>
          </div>
          {copyNote === null ? null : (
            <p className="wdp-secondary" data-testid={WRITE_TOKEN_TESTID.copyNote}>
              {copyNote}
            </p>
          )}
        </div>
      )}
      <p className="wdp-muted">再点一次 = **轮换**（新值覆盖旧值）；`writeToken` 是 volatile 字段、宿主每次请求现读 ⇒ **即时生效**（旧串立即 401、新串立即 200），不需要重载插件行。</p>
      <div className="wdp-grid">
        <button
          type="button"
          className="wdp-btn wdp-btn-stacked"
          data-testid={WRITE_TOKEN_TESTID.check}
          data-settings-control="1"
          disabled={busy}
          onClick={onCheck}
        >
          检查服务端配置状态
          <span className="wdp-btn-sub">（只报布尔）</span>
        </button>
        {confirmingClear ? (
          <>
            <span className="wdp-error">确认清除？清除后服务端 writeToken 会被 **unset**（把字段真的删掉，**不是写空串** —— 空串在宿主判据里仍算「已配置」）⇒ 写入口回到一律 401（fail-safe），本会话凭据同时清掉。</span>
            <button type="button" className="wdp-btn wdp-btn-primary" data-testid={WRITE_TOKEN_TESTID.clearConfirm} data-settings-control="1" disabled={busy} onClick={onClearConfirm}>
              确认清除
            </button>
            <button type="button" className="wdp-btn" data-testid={WRITE_TOKEN_TESTID.clearCancel} data-settings-control="1" disabled={busy} onClick={onClearCancel}>
              取消
            </button>
          </>
        ) : (
          <button type="button" className="wdp-btn wdp-btn-stacked" data-testid={WRITE_TOKEN_TESTID.clear} data-settings-control="1" disabled={busy} onClick={onClearRequest}>
            清除凭据
            <span className="wdp-btn-sub">（二次确认）</span>
          </button>
        )}
      </div>
      {note === null ? null : (
        <p className="wdp-secondary" data-testid={WRITE_TOKEN_TESTID.note}>
          {note}
        </p>
      )}
      <p className="wdp-muted" data-testid={WRITE_TOKEN_TESTID.delivery}>
        ⚠️ **2026-10-12 真机已订正**：`settings/describe` 里会出现本插件命名空间，凭据经 `secrets` 脱敏下发（服务端不回显值）；
        `writeToken` 是 volatile 字段、宿主每次请求现读 ⇒ **轮换即时生效**（旧串立即 401、新串立即 200）、**清除同样即时生效**，**不需要重载插件行**。
      </p>
    </section>
  );
}

/** exec 注入点（REQ-10.1/10.3/10.4）：**恒禁用**，只解释原因；002 缺失也不报错。 */
export function NextPhaseBlock({ exec }: { readonly exec: ExecControlView }): ReactElement {
  return (
    <section className="wdp-sec">
      <h3>下一期</h3>
      <button type="button" className="wdp-btn" data-testid={TESTID.exec} data-write-control="1" disabled title={exec.reason}>
        {exec.label}
      </button>
      <p className="wdp-muted">{exec.reason}</p>
    </section>
  );
}


