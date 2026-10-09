/**
 * 沙箱映射与审批门（004 REQ-3.1–3.5；design §4 / §5）
 *
 * ## 判定是「解析 + 自判」，不是「依赖宿主替我们拒」
 *
 * 复核结论（design §4 的 2026-10-09 定案）：`ctx.sandboxPolicy` **只解析、不拦截** —— 真正的门禁在
 * `tools/pre-execute` + `ctx.tools.guard()`。所以本层必须自己读策略、自己拒（REQ-3.1 的
 * 「SHALL NOT 借终端绕过沙箱」）。
 *
 * ## 🔴 服务获取一律**非严格**（REQ-3.4 的 2026-10-09 补充）
 *
 * 官方的 fail-fast 范式是 `static inject`（`dsh-tool-bash` / `dsh-tool-pwsh` / `dsh-tool-fs` 三族
 * 同形）：缺服务时插件**根本不激活** ⇒ 工具数 0，与 REQ-1.1「恰好 6 个」直接冲突。本 Spec 要的是
 * 「**注册满 6 个、缺服务时一律拒绝写**」⇒ 用 `ctx.get('sandboxPolicy')`（拿不到返回 `undefined`）
 * + 工具体内自判。`ctx.get` 本身也可能不存在（极简 fake / 老宿主）⇒ 连它一起防御。
 *
 * ## REQ-3.5：为什么必须**自调** `ctx.approval.request`
 *
 * 宿主的 ask 门禁（`tools/pre-execute` → `serviceAsk`）把 `rejected` / `cancelled` / `unavailable`
 * **一律**折成 `isError: true` 的结果 ⇒ 只用官方门禁**无法**满足「拒绝 ⇒ `cancelled` 结果且
 * **不**记为系统错误」。所以本层自己问、自己映射（`allowed-once` 才放行），并且**取消时不抛**
 * （返回 `{ ok:false, code:'cancelled', … }` 的正常值），把「不是系统错误」这条语义握在自己手里。
 */

import type { ApprovalLike, HostContextLike, SandboxPolicyLike } from './host.ts';
import { APPROVAL_SERVICE, SANDBOX_POLICY_SERVICE } from './host.ts';
import { cancelledValue, fail } from './failure.ts';
import type { ToolFailureValue } from './failure.ts';

/** 需要写权限的四个工具（design §4 表：`managed_terminal_new` / `managed_terminal_write` / `managed_terminal_resize` / `managed_terminal_kill` 受策略约束） */
export type WriteTool = 'managed_terminal_new' | 'managed_terminal_write' | 'managed_terminal_resize' | 'managed_terminal_kill';

/** 逐工具的**保守**默认：缺服务/解析不出时**拒绝**（REQ-3.4「最保守，SHALL NOT 默认放行」） */
export const CONSERVATIVE_MODE = 'read-only';

/** 沙箱模式（宿主词汇；design §4 表只区分「只读」与「可写」两档，`danger-full-access` 归可写） */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access' | 'unknown';

/** 把宿主返回的 `mode` 收成我们的三档（**未知值一律归 `unknown`**，由调用方按保守处理） */
export function normalizeMode(raw: string | undefined): SandboxMode {
  return raw === 'read-only' || raw === 'workspace-write' || raw === 'danger-full-access' ? raw : 'unknown';
}

/** 非严格取服务：`ctx.get` 不存在 / 名字拿不到 / 形状不对 → `undefined`（不抛） */
function getService<T>(ctx: HostContextLike, name: string): T | undefined {
  if (typeof ctx.get !== 'function') return undefined;
  try {
    const service = ctx.get(name) as T | undefined;
    return service === undefined || service === null ? undefined : service;
  } catch {
    // 取服务本身抛错（代理/getter 异常）时也**不放行**：当作「服务缺失」走保守路径
    return undefined;
  }
}

/** `ctx.get('sandboxPolicy')`（拿不到返回 `undefined` —— REQ-3.4 的关键分支） */
export function getSandboxPolicy(ctx: HostContextLike): SandboxPolicyLike | undefined {
  const service = getService<SandboxPolicyLike>(ctx, SANDBOX_POLICY_SERVICE);
  return typeof service?.resolve === 'function' ? service : undefined;
}

/** `ctx.get('approval')`（拿不到返回 `undefined`；`request` 不是函数也当没有） */
export function getApproval(ctx: HostContextLike): ApprovalLike | undefined {
  const service = getService<ApprovalLike>(ctx, APPROVAL_SERVICE);
  return typeof service?.request === 'function' ? service : undefined;
}

/**
 * 解析当前生效的沙箱模式。
 *
 * ⚠️ `resolve()` 的返回里 `mode` 缺失/是未知词时**归 `read-only`**：这是 REQ-3.4 的落点 ——
 * 「拿不到策略」与「策略说不清」必须是同一个结论（拒绝写），否则一条服务被替换/降级就会静默放行。
 * `serviceMissing` 单独带出来，只**为了消息可读**（原因不同、自救提示也不同）：判定结果一样保守。
 */
export function resolvePolicy(
  ctx: HostContextLike,
  session: unknown,
): { readonly mode: SandboxMode; readonly serviceMissing: boolean } {
  const service = getSandboxPolicy(ctx);
  if (service === undefined) return { mode: CONSERVATIVE_MODE, serviceMissing: true };
  try {
    const policy = service.resolve(session === undefined ? {} : { session });
    const mode = normalizeMode(policy?.mode);
    return { mode: mode === 'unknown' ? CONSERVATIVE_MODE : mode, serviceMissing: false };
  } catch {
    return { mode: CONSERVATIVE_MODE, serviceMissing: false };
  }
}

/** `resolvePolicy` 只要模式时的薄包装（测试与工具层都常用） */
export function resolveMode(ctx: HostContextLike, session: unknown): SandboxMode {
  return resolvePolicy(ctx, session).mode;
}

/**
 * 写工具的准入：沙箱否决是**终态**（不进入业务逻辑、不产生副作用），返回可读原因 + 当前策略。
 *
 * 「为什么」写进 hint（REQ-3.1 的「返回原因」）：只读下要告诉模型**怎么自救** —— 要么改策略，
 * 要么改用 `managed_terminal_read` / `managed_terminal_list`（它们在只读下可用，REQ-3.2）。
 */
export function assertWriteAllowed(ctx: HostContextLike, session: unknown, tool: WriteTool): void {
  const policy = resolvePolicy(ctx, session);
  if (policy.mode !== 'read-only') return;
  if (policy.serviceMissing) {
    fail(
      'sandbox-denied',
      `宿主未提供沙箱策略服务，${tool} 按最保守口径被拒绝（REQ-3.4：缺服务时不得默认放行）`,
      '这是防御性分支：确认 profile 里挂载了 @deepseek-ai/dsh-permission-presets 的 sandbox 配置；只读的 managed_terminal_read / managed_terminal_list 不受影响。',
    );
  }
  fail(
    'sandbox-denied',
    `当前沙箱策略为 read-only，${tool} 被拒绝（终端不绕过沙箱）`,
    '把沙箱模式切到 workspace-write / danger-full-access 后重试；managed_terminal_read 与 managed_terminal_list 在 read-only 下仍可用。',
  );
}

/** 审批答案（宿主 `ApprovalOutcome` 的闭集） */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

/**
 * 问一次审批并映射结果。
 *
 * - 服务缺失 / 无 agent / 返回表外值 → `unavailable`（**fail closed**：没人能批准就不做）；
 * - `allowed-once` → 放行（唯一的授权）；
 * - `rejected` / `cancelled` → `cancelled` 结果（REQ-3.5：**不是**系统错误）。
 *
 * ⚠️ 返回 `ToolFailureValue` 而**不是抛**，是本文件与 `failure.ts` 里那条唯一例外的合流点。
 */
export async function requestApproval(
  ctx: HostContextLike,
  input: {
    readonly tool: string;
    readonly reason: string;
    readonly agent: unknown;
    readonly callId: unknown;
    readonly signal: AbortSignal | undefined;
  },
): Promise<{ readonly allowed: true } | { readonly allowed: false; readonly value: ToolFailureValue }> {
  const service = getApproval(ctx);
  const deny = (outcome: ApprovalOutcome): { readonly allowed: false; readonly value: ToolFailureValue } => ({
    allowed: false,
    value:
      outcome === 'unavailable'
        ? cancelledValue(
            'cancelled',
            `${input.tool} 未获得审批（无人可问：审批服务缺失或本次调用没有 agent 会话）`,
            '这不是失败而是「未授权」：请在交互式会话里重试，或先确认 approval 策略不是 never。',
          )
        : cancelledValue(
            'cancelled',
            `${input.tool} 的审批结果为 ${outcome}，未执行任何副作用`,
            '如确实需要该操作，请在审批提示里选择允许后重试。',
          ),
  });

  if (service === undefined || input.agent === undefined) return deny('unavailable');

  let outcome: string;
  try {
    outcome = await service.request({
      agent: input.agent,
      toolName: input.tool,
      reason: input.reason,
      ...(input.callId === undefined ? {} : { callId: input.callId }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  } catch {
    // 审批通道本身坏掉（无开启的 turn / 审计追加失败）⇒ 与「无人可问」同待遇：不放行
    return deny('unavailable');
  }
  if (outcome === 'allowed-once') return { allowed: true };
  return deny(
    outcome === 'rejected' || outcome === 'cancelled' || outcome === 'unavailable' ? outcome : 'unavailable',
  );
}
