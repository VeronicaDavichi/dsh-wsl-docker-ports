/**
 * 008 T3.1 写通道的**页面侧接线**：预演 → 确认 → 执行（REQ-3.1/3.2 + 契约 5/6/7）
 *
 * ## 状态机的四条规矩（每条都有对应判据）
 *
 * 1. **未点确认 ⇒ 零 `apply`**：预演只发 `plan`；`apply` 只在确认按钮的回调里发一次
 *    （`busy` 期间两个按钮都不可点 ⇒ 双击也只会有一个在途请求）。
 * 2. **`declaration` 在预演时读一次并**原样复用**：apply 会重算 `planId`，两次 `target` 必须逐字相同
 *    （见 `write-channel.ts` 文件头）。所以待确认的目标放在 `pending` 里，确认时不再重新读配置。
 * 3. **票据过期 / `plan-mismatch` ⇒ 重新 plan + 重新要求确认**：拿到 `replan` 类失败时**先清掉
 *    旧计划与旧目标**，再走一次 `preview()` ⇒ 用户必须**再点一次确认**。绝不静默重发 apply
 *    （那等于把「用户确认过的那份命令」换成「另一份命令」）。
 * 4. **401 ⇒ 指路、不重试**：`credential` 类失败只显示「去哪里配置」，循环重试是被明令禁止的。
 * 5. **结果保留**（009 T1.1）：最近一次 `apply` 的回执**不被重新预演清掉**（只被下一次 `apply` 的新回执替换）
 *    —— 免得「预演一下就看不到刚才到底发生了什么」。四态分色与逐步原因在 `write-result.tsx`。
 *
 * ## 本地能拦的一律不发请求
 *
 * 端口文本非法、没有凭据、配置里所有权声明非法时，都在本地给出可读原因并**零请求**
 * （凭据那一条由 `write-channel.ts` 的本地拦截给出）。
 */

import { useState, type ReactElement } from 'react';

import {
  failureText,
  type ClientApplyReport,
  type ClientPlan,
  type WriteActionInput,
  type WriteScopeInput,
  type WriteTargetInput,
  type WriteWiring,
} from './write-channel.ts';
import { WriteConfirmDialog, WRITE_TESTID } from './write-confirm.tsx';
import { WriteResultPanel } from './write-result.tsx';

/** 单次最多几个端口（与服务端 `PLAN_MAX_PORTS` 同值；本地先拦，省一次注定被拒的往返） */
export const WRITE_PORTS_MAX = 256;

/** 未接线时的固定原因（不是错误：只读事实层照常可用） */
export const WRITE_NOT_WIRED =
  '写通道未接线：本包没有拿到 remote.settings 或 fetch，写入口不可用（只读展示不受影响）。';

/** 端口文本 → 升序去重的端口数组；非法 ⇒ 可读原因（**不发请求**） */
export function parsePortsText(text: string): { readonly ok: true; readonly ports: readonly number[] } | { readonly ok: false; readonly message: string } {
  const tokens = text
    .split(/[\s,，、;；]+/u)
    .map((token) => token.trim())
    .filter((token) => token !== '');
  if (tokens.length === 0) return { ok: false, message: '请先填要处理的端口（空格或逗号分隔，如 3306 5432）—— 零请求。' };
  const ports: number[] = [];
  for (const token of tokens) {
    const value = Number(token);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      return { ok: false, message: `端口必须是 1..65535 的整数，实际是 "${token}" —— 零请求。` };
    }
    if (!ports.includes(value)) ports.push(value);
  }
  if (ports.length > WRITE_PORTS_MAX) {
    return { ok: false, message: `单次最多 ${String(WRITE_PORTS_MAX)} 个端口，实际 ${String(ports.length)} 个 —— 零请求。` };
  }
  return { ok: true, ports: ports.sort((left, right) => left - right) };
}

/**
 * `<select>` 的字符串 → 合法动作字面量（2026-10-16 `fix` 扩面，见 `write-channel.ts` 的同名注记）。
 * 不认识的值一律回落 `add`：客户端**不造**服务端不认的动作（未知 `action` 会被服务端回 400）。
 */
export function toActionInput(value: string): WriteActionInput {
  return value === 'remove' || value === 'fix' ? value : 'add';
}

export interface WriteChannelBlockProps {
  /** 写通道整包（`undefined` = 未接线 ⇒ 控件置灰 + 原因） */
  readonly write: WriteWiring | undefined;
  /** 外部前置（NAT 硬前提 / 读模型可用性）；`false` ⇒ 全部写控件置灰 */
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

export function WriteChannelBlock(props: WriteChannelBlockProps): ReactElement {
  const { write, enabled } = props;
  const [action, setAction] = useState<WriteActionInput>('add');
  const [portsText, setPortsText] = useState('');
  const [scope, setScope] = useState<WriteScopeInput>('loopback');
  /** 与 `plan` **成对**存：这份计划是哪个 target 换来的（确认时必须原样回传） */
  const [pending, setPending] = useState<WriteTargetInput | null>(null);
  const [plan, setPlan] = useState<ClientPlan | null>(null);
  const [report, setReport] = useState<ClientApplyReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wired = write !== undefined;
  const usable = enabled && wired;
  const reason = wired ? props.disabledReason : WRITE_NOT_WIRED;

  /** 预演：读声明 → 只读 plan。**只发 1 个请求**（本地校验不过就 0 个） */
  async function preview(carry?: string): Promise<void> {
    if (write === undefined) {
      setNotice(WRITE_NOT_WIRED);
      return;
    }
    const parsed = parsePortsText(portsText);
    if (!parsed.ok) {
      setNotice(parsed.message);
      return;
    }
    setBusy(true);
    setNotice(null);
    const declared = await write.declaration();
    if (!declared.ok) {
      setBusy(false);
      setPlan(null);
      setPending(null);
      setNotice(declared.message);
      return;
    }
    const target: WriteTargetInput = { action, ports: parsed.ports, scope, declaration: declared.ports };
    const outcome = await write.channel.plan(target);
    setBusy(false);
    if (!outcome.ok) {
      setPlan(null);
      setPending(null);
      setNotice(failureText(outcome.failure));
      return;
    }
    setPending(target);
    setPlan(outcome.value);
    setNotice(carry ?? null);
  }

  /** 确认：**恰好一次** apply（body 只有白名单字段，命令文本没有任何入口） */
  async function confirm(): Promise<void> {
    if (write === undefined || plan === null || pending === null) return;
    const { planId, ticket } = plan;
    if (planId === null || ticket === null) {
      setNotice('这份计划没有可用票据（planId / ticket 为空）：请重新预演 —— 不会自动执行。');
      return;
    }
    setBusy(true);
    const outcome = await write.channel.apply({ target: pending, planId, ticket });
    setBusy(false);
    if (outcome.ok) {
      setReport(outcome.value);
      setPlan(null);
      setPending(null);
      setNotice(null);
      return;
    }
    // 失败：先作废这次确认（不留任何可复用的票据），再按 kind 决定下一步
    setPlan(null);
    setPending(null);
    setNotice(failureText(outcome.failure));
    if (outcome.failure.kind === 'replan') {
      await preview(`上一次确认已失效（${outcome.failure.code}）：已重新预演，请**重新确认**（不会静默重试）。`);
    }
  }

  function cancel(): void {
    setPlan(null);
    setPending(null);
    setNotice('已取消：零请求。这份计划作废，要执行请重新预演。');
  }

  return (
    <section className="wdp-card" data-testid={WRITE_TESTID.block} data-wired={wired ? '1' : '0'}>
      <h3>写通道（确认后执行）</h3>
      <p className="wdp-muted">
        写动作需要服务端签发的计划与一次性票据：先「预演」看逐条命令原文，确认后才发 apply；改一个字都要重新预演。
      </p>
      <div className="wdp-inline">
        <label>
          动作
          <select
            className="wdp-btn"
            data-testid={WRITE_TESTID.action}
            data-write-control="1"
            disabled={!usable || busy}
            value={action}
            onChange={(event) => setAction(toActionInput(event.target.value))}
          >
            <option value="add">建立 / 校正转发</option>
            <option value="remove">移除转发</option>
            <option value="fix">修复地址漂移（先删后加）</option>
          </select>
        </label>
        <label>
          端口
          <input
            className="wdp-btn"
            data-testid={WRITE_TESTID.ports}
            data-write-control="1"
            disabled={!usable || busy}
            value={portsText}
            placeholder="3306 5432"
            onChange={(event) => setPortsText(event.target.value)}
          />
        </label>
        <label>
          作用域
          <select
            className="wdp-btn"
            data-testid={WRITE_TESTID.scope}
            data-write-control="1"
            disabled={!usable || busy}
            value={scope}
            onChange={(event) => setScope(event.target.value === 'lan' ? 'lan' : 'loopback')}
          >
            <option value="loopback">仅本机（loopback）</option>
            <option value="lan">局域网（lan）</option>
          </select>
        </label>
        <button
          type="button"
          className="wdp-btn"
          data-testid={WRITE_TESTID.preview}
          data-write-control="1"
          disabled={!usable || busy}
          title={usable ? '' : (reason ?? '')}
          onClick={() => void preview()}
        >
          预演（只读，零写入）
        </button>
      </div>
      {action === 'fix' ? (
        <p className="wdp-muted" data-testid={WRITE_TESTID.fixHint}>
          修复只改 connectAddress：作用域沿用既有规则（不受上面「作用域」选择影响 —— 改作用域是「切换作用域」，本页不做）；
          命令是「先精确删除那条旧规则，再按当前地址重建」，且只对声明集合内、地址确实漂移的规则放行（判定全在服务端，客户端不判）。
        </p>
      ) : null}
      {action === 'remove' ? (
        <p className="wdp-muted" data-testid={WRITE_TESTID.removeHint}>
          移除也沿用既有规则的作用域（删的是那条规则**自己的** listen address，不受上面「作用域」选择影响）：
          只有满足 REQ-1.2 字面前置（集合内 + 地址匹配当前 eth0）的规则才可删，服务端判，客户端不判。
        </p>
      ) : null}
      {!usable ? <p className="wdp-muted">{reason}</p> : null}
      {notice === null ? null : (
        <p className="wdp-error" data-testid={WRITE_TESTID.notice}>
          {notice}
        </p>
      )}
      {plan === null ? null : (
        <WriteConfirmDialog plan={plan} busy={busy} blocked={enabled ? null : reason} onConfirm={() => void confirm()} onCancel={cancel} />
      )}
      {report === null ? null : (
        <section className="wdp-card" data-testid={WRITE_TESTID.result} data-status={report.status}>
          <h3>最近一次执行结果（保留展示：重新预演不会清掉它，直到下一次确认返回）</h3>
          <WriteResultPanel report={report} />
        </section>
      )}
    </section>
  );
}
