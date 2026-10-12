/**
 * 008 T3.1 客户端**写前确认对话框**（REQ-3.1 / REQ-3.2 + 主人 2026-10-10 裁定的契约 4/5/6/8）
 *
 * ## 这个组件凭什么算「闸门」而不是「提示」
 *
 * 1. **命令原文只来自服务端**：逐条渲染 `plan.ports[].steps[].commandText`，**不拼接、不改写、
 *    不换行重组**（每个步骤一个元素，`textContent` 与服务端字符串逐字相等；测试按 `===` 断言）。
 *    `plan.commandText`（服务端拼好的多行版）**刻意不用** —— 那会变成「客户端参与生成命令文本」。
 * 2. **本组件零副作用**：没有 fetch、没有 `settings`、没有事件订阅 ⇒ 「未点确认 ⇒ 零网络请求」
 *    在**结构上**成立（测试用 `fetch` 计数器把它钉死）。
 * 3. **不可能成功的操作不提供**：`elevationGate()` 在 `policy` 为 `none` / `unknown`、
 *    计划不可执行、或服务端没签发票据时把确认按钮**置灰并写明原因**。
 *    ⚠️ `elevation.available` 只**展示**、不参与置灰：真机上它是一个可能过期的探测值
 *    （008 的 `PlanFacts.elevation()` 曾只读 `peek()` ⇒ 恒 `null`），拿它当门会误灰掉可用的路径。
 *
 * ## 与 T3.2 的边界
 *
 * 这里**只**做「写前确认」；结果四态分色是 T3.2。故本文件的输出区只有中性文案。
 */

import type { ReactElement } from 'react';

import type { ClientPlan } from './write-channel.ts';

/**
 * 本模块的 `data-testid` 字面量（与实现同源）。
 * ⚠️ 刻意**不**塞进 `rows.ts` 的 `TESTID`：那份已经 364/400 行（单文件 ≤400 是 SHALL），
 * 而写通道的控件是 008 自己的面，就近定义不会让它继续膨胀。
 */
export const WRITE_TESTID = {
  block: 'write-channel',
  action: 'sel-write-action',
  ports: 'inp-write-ports',
  scope: 'sel-write-scope',
  preview: 'btn-write-plan',
  notice: 'write-notice',
  dialog: 'write-confirm',
  port: 'write-port',
  command: 'write-step-command',
  impact: 'write-impact',
  notes: 'write-notes',
  gate: 'write-gate',
  confirm: 'btn-write-confirm',
  cancel: 'btn-write-cancel',
  result: 'write-result',
} as const;

/** 确认闸门的判定结果：`allow === false` ⇒ 按钮置灰 + `reason` 必须显示出来 */
export interface WriteGate {
  readonly allow: boolean;
  readonly reason: string;
}

/**
 * 提权档 / 计划可用性 → 能不能确认。
 *
 * 顺序：先看计划**根本不可执行**（`planId === null` / `ready === false`），再看提权档，
 * 最后看票据。三者都要给出**可操作的原因**（NFR-4：拒绝路径不许只有错误码）。
 */
export function elevationGate(plan: ClientPlan): WriteGate {
  if (!plan.ready || plan.planId === null) {
    return {
      allow: false,
      reason: `计划不可执行（${plan.blockedReason ?? '服务端没有给出可执行步骤'}）：没有可确认的动作 ⇒ 不允许执行，按钮置灰。`,
    };
  }
  const policy = plan.elevation.policy;
  if (policy === 'none') {
    return {
      allow: false,
      reason:
        '提权档为 none（本机配置就是「不写入」）：执行层会拒绝提权 ⇒ 这个操作不可能成功，故按钮置灰。' +
        '要写就先在配置页把「提权策略」改成 ask（服务端 config 的 elevationPolicy）。',
    };
  }
  if (policy === 'unknown') {
    return {
      allow: false,
      reason:
        '提权档读不到（unknown）：执行层按 fail-safe 落到 none ⇒ 不可能成功，故按钮置灰。' +
        '请先在配置页把「提权策略」设为 ask，再重新预演。',
    };
  }
  if (plan.ticket === null) {
    return {
      allow: false,
      reason: '服务端没有为这份计划签发确认票据（confirm.ticket 为空）⇒ apply 必然 403，按钮置灰（不发注定失败的请求）。',
    };
  }
  return {
    allow: true,
    reason: `提权档 ${policy}（后端 ${plan.elevation.backend}，可用性探测 ${plan.elevation.available ? 'true' : 'false'}）：确认后经提权链执行。`,
  };
}

/**
 * 影响面文案（契约 4）。
 *
 * - `loopback`：只写回环，不新增防火墙放行；
 * - `lan`：**逐字**给出「会新增 1 条 portproxy 规则 + 1 条防火墙规则」（`add` 时）——
 *   这句是主人点名的判据，测试按子串断言；`remove` 时同位置写「会删除 1 条…」（不能对删除说新增）。
 * - 步数**按服务端给的步骤算**，不靠客户端猜：这样「说 1 条却给了 3 条」不可能发生。
 *
 * 🔴 **缺陷 3（2026-10-12 真机）**：计划不可执行（`ready === false`）或零步骤时，上面那句
 * 「会新增 1 条…」是**高报** —— 真机弹窗里同时出现「会新增 1 条 portproxy 规则 + 1 条防火墙规则」
 * 与「服务端给出的步骤：共 0 条」，自相矛盾。⇒ 只有「计划可执行且真有步骤」才配谈新增/删除；
 * 否则一律改成与实际一致的「不含可执行动作、不会改动任何规则」（判据：这两句互斥出现）。
 */
export function buildImpactLines(plan: ClientPlan): readonly string[] {
  const kinds = plan.ports.flatMap((port) => port.steps.map((step) => step.kind));
  const portproxySteps = kinds.filter((kind) => kind.startsWith('portproxy-')).length;
  const firewallSteps = kinds.filter((kind) => kind.startsWith('firewall-')).length;
  const verb = plan.action === 'remove' ? '删除' : '新增';
  const executable = plan.ready && plan.planId !== null && kinds.length > 0;
  const actionLine = executable
    ? plan.action === 'remove'
      ? `动作：移除 ${String(plan.ports.length)} 个端口的转发（逐端口 1 条，无批量入口）`
      : `动作：建立 / 校正 ${String(plan.ports.length)} 个端口的转发（逐端口 1 条，无批量入口）`
    : '动作：无 —— 服务端没有给出可执行的转发动作（既不新增、也不删除）。';
  const scopeLine = !executable
    ? `影响面：当前计划不含可执行动作，不会改动任何规则（portproxy 与防火墙都不动；服务端共 ${String(kinds.length)} 条步骤，全部不执行）。`
    : plan.scope === 'lan'
      ? `影响面：局域网（lan）—— 局域网内其他主机可访问这些端口；会${verb} 1 条 portproxy 规则 + 1 条防火墙规则` +
        '（端口专属、非通配符，不碰所有权集合外的任何规则）。'
      : '影响面：仅本机（loopback）—— 只写回环地址的 portproxy 规则，不新增防火墙放行，局域网内其他主机访问不到。';
  const countLine = `服务端给出的步骤：共 ${String(kinds.length)} 条（portproxy ${String(portproxySteps)} 条 + 防火墙 ${String(firewallSteps)} 条）。`;
  return [actionLine, scopeLine, countLine];
}

/** 计划里所有的说明（总说明 + 逐端口说明）—— 原样透出，不改写 */
export function collectPlanNotes(plan: ClientPlan): readonly string[] {
  const notes: string[] = [...plan.notes];
  for (const port of plan.ports) {
    for (const note of port.notes) notes.push(`端口 ${String(port.port)}：${note}`);
  }
  return notes;
}

export interface WriteConfirmDialogProps {
  readonly plan: ClientPlan;
  /** 正在发请求 ⇒ 两个按钮都不可点（避免双击变成两次 apply） */
  readonly busy: boolean;
  /** 外部前置（NAT 门等）未满足时的原因；非空 ⇒ 一并置灰 */
  readonly blocked?: string | null | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function WriteConfirmDialog(props: WriteConfirmDialogProps): ReactElement {
  const { plan, busy, onConfirm, onCancel } = props;
  const gate = elevationGate(plan);
  const blocked = props.blocked ?? null;
  const allow = gate.allow && (blocked === null || blocked === '');
  const reason = gate.allow ? (blocked ?? '') : gate.reason;
  const notes = collectPlanNotes(plan);

  return (
    <div className="wdp-card" data-testid={WRITE_TESTID.dialog} data-confirm-allowed={allow ? '1' : '0'} role="group">
      <h3>确认执行（逐条命令原文来自服务端计划，本页不改写）</h3>
      <ul className="wdp-list" data-testid={WRITE_TESTID.impact}>
        {buildImpactLines(plan).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {plan.ports.map((port) => (
        <div key={port.port} data-testid={WRITE_TESTID.port} data-port={String(port.port)} data-ready={port.ready ? '1' : '0'}>
          <div className="wdp-secondary">{`端口 ${String(port.port)}${port.ready ? '' : '（被拦下，零动作）'}`}</div>
          {port.steps.map((step, index) => (
            // 🔴 每个步骤一个元素，`textContent` 与服务端 `commandText` **逐字相等**
            <pre key={`${step.kind}-${String(index)}`} className="wdp-pre" data-testid={WRITE_TESTID.command} data-step-kind={step.kind}>
              {step.commandText}
            </pre>
          ))}
          {port.blocked === null ? null : (
            <p className="wdp-error">
              {port.blocked.message} {port.blocked.hint}
            </p>
          )}
        </div>
      ))}
      {notes.length === 0 ? null : (
        <ul className="wdp-list" data-testid={WRITE_TESTID.notes}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <p className={allow ? 'wdp-muted' : 'wdp-error'} data-testid={WRITE_TESTID.gate}>
        {reason}
      </p>
      <div className="wdp-inline">
        <button
          type="button"
          className="wdp-btn wdp-btn-primary"
          data-testid={WRITE_TESTID.confirm}
          data-write-control="1"
          disabled={!allow || busy}
          title={allow ? '' : reason}
          onClick={onConfirm}
        >
          确认并执行
        </button>
        <button type="button" className="wdp-btn" data-testid={WRITE_TESTID.cancel} disabled={busy} onClick={onCancel}>
          取消（零请求）
        </button>
      </div>
    </div>
  );
}
