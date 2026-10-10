/**
 * 008 T2.3/T2.4/T2.5：写通道的**执行层**（票据门 → 005 提权链 → 回滚 → 审计）
 *
 * ## 一次 apply 的五个动作（顺序即安全顺序）
 *
 * 1. **确认门**：`confirmed !== true` ⇒ 403 `confirm-required`，**零提权、零写入、零审计**（REQ-3.2）；
 * 2. **重规划**：拿**同一份事实面**重算计划 ⇒ `planId` / `steps` / `eth0Ip` / 命令原文。
 *    🔴 客户端传来的命令/规则文本**一律不看**（路由只透传白名单字段），计划只能由服务端推导；
 *    重算走 `plan.ts:computePlan`（与 `/write/plan` **同一代码路径** ⇒ 指纹不可能分叉）；
 * 3. **票据门**（REQ-4）：`consume(planId, ticket)` 一次性 + 绑定 `planId` + TTL；
 *    `unknown` / `mismatch` / `expired` **分开报**（不合并成一句「无效」）⇒ 每种都零提权零写入；
 * 4. **执行**：`runElevate(..., { ...defaultElevationDeps(executor), confirm: async () => true })` ——
 *    票据就是「用户已确认命令原文」，故 005 的确认位恒真：**凡走到这一步，应用内闸门已经过完了**（REQ-3.3）；
 * 5. **回滚 + 审计**：失败 ⇒ 只回滚**本轮刚加成功**的转发规则；审计只记**真正发生过的动作**。
 *
 * ## 策略映射（🔴 显式假设，需主人拍板）
 *
 * `facts` 给的是**配置档字符串**（`real-facts.ts` 的 `elevationPolicy`，未接线时是 `'unknown'`）：
 * - `'none'` ⇒ 原样：显式关闭 ⇒ 005 直接 `disabled`，**零进程零写入**（最保守，永不翻转）；
 * - `'ask'` / `'passby'` ⇒ 原样（`passby` + Agent 触发仍由 005 降级为 `ask`，REQ-3.4）；
 * - **其它（含 `'unknown'`）⇒ 按 `'ask'`**：`'unknown'` 的语义是「配置页还没接线」，**不是**「用户关掉了提权」；
 *   而 REQ-3.1 要求的「执行前显式确认 + 完整命令原文」**已由票据门满足**（票据只对看过命令原文的那一份计划签发）。
 *   ⚠️ 绝不升格成 `passby`（那会变成「不用确认」）；若主人裁定未接线时必须按 `'none'` 处理，
 *   改 `policyFor` 一处即可（`tests/unit/transport-apply.test.ts` 有该映射的用例钉住）。
 *
 * 触发来源（`origin`）同理取保守方向：**只有明确写 `'user'` 才算用户**，缺省/认不出的值按 `'agent'`
 * ⇒ Agent 的 `passby` 会被 005 降级成 `ask`（REQ-3.4）。⚠️ 但这**不是**「人在回路」的证明：
 * 真正的闸门是**票据**（只有请求过计划、看到命令原文的那一方才拿得到票），票据与「谁按的按钮」
 * 之间的绑定落在 008 T3.1 的客户端确认对话框上（本期未接线 ⇒ 已在报告里如实标注）。
 *
 * ## 回滚的判据只用 005 的前后快照（不猜、不越界）
 *
 * 「刚加成功的规则」= 005 自己**执行前后各取一次**的快照（`ElevateResult.log`）里，
 * `listenPort === 目标端口` 且 **`before` 里没有**的那些 ⇒
 * ① 别人在这期间加的规则（已进 `before`）**不会被删**；② 快照拿不到（`log === null`）⇒ **不动手**
 * （宁可留着半成品并如实上报，也不靠猜去删）⇒ 红线「不得动他人规则、条数回到执行前」由结构保证。
 *
 * ## 响应里刻意不放的东西
 *
 * **不放 `stdout` / 原始回传**（REQ-4.4：响应不含任何凭据；诊断要看原文请查宿主日志），
 * 命令原文只出现在 `commandText`（本来就是给用户看的、只含端口/地址/组名）。
 */

import type { Executor } from 'dsh-wsl-shared';

import { expectedListenAddress } from '../diff/engine.ts';
import type { Scope } from '../diff/types.ts';
import { resolvePolicy } from '../elevate/backend.ts';
import { defaultElevationDeps, runElevate } from '../elevate/runner.ts';
import type { ElevateRequest, ElevateResult, ElevationDeps, ElevationPolicy, RequestSource } from '../elevate/types.ts';
import type { PortproxyRule } from '../read/netsh.ts';
import { portproxyDeleteStep } from '../write/plan.ts';
import type { WriteAction, WriteStepKind } from '../write/types.ts';
import type { AuditLog, AuditOrigin } from './audit.ts';
import type { ConfirmTickets } from './confirm.ts';
import { WRITE_CONFIRM_TTL_MS } from './constants.ts';
import { computePlan } from './plan.ts';
import type { PlanFacts } from './plan.ts';
import type { WriteErrorCode, WriteRouteResult } from './routes.ts';

/** 路由透传过来的白名单字段（**多一个都不收**） */
export interface ApplyInput {
  readonly target: unknown;
  readonly planId: unknown;
  readonly confirmed: unknown;
  readonly origin: unknown;
  readonly ticket: unknown;
  readonly problem?: string | undefined;
}

export interface ApplyChannelDeps {
  /** 现读事实面：**必须与 `/write/plan` 是同一个实例**（否则重算的 `planId` 会与票据失配） */
  readonly facts: PlanFacts;
  /** 票据注册表（T2.1）：与 `/write/plan` 共用同一个实例 */
  readonly tickets: ConfirmTickets;
  /** 审计环（T1.6）：只记真正发生过的动作 */
  readonly audit: AuditLog;
  /** 提权执行器（005 经 001 的 `Executor`） */
  readonly executor: Executor;
  /** 005 依赖面的**可注入覆盖**（离线测试注入假快照/假文件表；生产留空） */
  readonly elevationDeps?: Partial<ElevationDeps> | undefined;
  /** 时钟（测试注入以断言耗时；缺省 `Date.now`） */
  readonly now?: (() => number) | undefined;
}

/** 一条步骤的结果（`name` 是 005 报告里的步骤名） */
export interface ApplyStepOutcome {
  readonly name: string;
  readonly ok: boolean;
  readonly reason: string | null;
}

/** 一次回滚的结果（**只针对本轮刚加的规则**；`ok:false` 表示回滚自己失败了，如实上报） */
export interface ApplyRollbackOutcome {
  readonly port: number;
  readonly listenAddress: string;
  readonly ok: boolean;
  readonly message: string;
}

/** `apply` 的响应体（REQ-4.3 的四张清单：executed / skipped / failed / rolledBack） */
export interface ApplyReport {
  readonly ok: true;
  readonly planId: string;
  /** 005 的状态判别式（`ok` / `partial` / `failure` / `disabled` / `no-actions` / …） */
  readonly status: ElevateResult['status'];
  readonly action: WriteAction;
  readonly scope: Scope;
  readonly port: number;
  /** **生效**策略（`resolvePolicy` 之后：Agent + `passby` 会显示成 `ask`，REQ-3.4） */
  readonly elevationPolicy: ElevationPolicy;
  readonly backend: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly executed: readonly string[];
  /** 计划里有、但 005 的报告里没出现的步骤（如 portproxy 失败后防火墙那步压根没跑） */
  readonly skipped: readonly WriteStepKind[];
  readonly failed: readonly ApplyStepOutcome[];
  readonly rolledBack: readonly ApplyRollbackOutcome[];
  /** 将执行的命令原文（REQ-3.2 的展示面；只含端口/地址/组名） */
  readonly commandText: string;
  readonly message: string;
  readonly hint: string;
}

const KNOWN_POLICIES: readonly ElevationPolicy[] = ['none', 'ask', 'passby'];

/**
 * 配置档字符串 → 提权策略（映射表与理由见文件头「策略映射」）。
 * 认不出的值（含 `'unknown'`）按 `'ask'`：确认闸门 = 票据门，绝不升格成 `passby`。
 */
export function policyFor(raw: string): ElevationPolicy {
  return KNOWN_POLICIES.find((item) => item === raw) ?? 'ask';
}

function fingerprint(rule: PortproxyRule): string {
  return `${rule.listenAddress}:${String(rule.listenPort)}->${rule.connectAddress}:${String(rule.connectPort)}`;
}

/** 「本轮刚加成功的转发规则」= 005 前后快照里**新增的、本端口**的那些（判据见文件头） */
function justAdded(result: ElevateResult, port: number): readonly PortproxyRule[] {
  const log = result.log;
  if (log === null) return [];
  const before = new Set(log.before.filter((rule) => rule.listenPort === port).map(fingerprint));
  return log.after.filter((rule) => rule.listenPort === port && !before.has(fingerprint(rule)));
}

/** 监听地址 → 作用域（提权脚本按作用域推 `listenaddress` ⇒ 回滚必须回到同一个地址族） */
function scopeOf(address: string): Scope | null {
  if (address === expectedListenAddress('lan')) return 'lan';
  if (address === expectedListenAddress('loopback')) return 'loopback';
  return null;
}

/** 造执行通道（注入的是路由的 `apply` 依赖） */
export function createApplyChannel(deps: ApplyChannelDeps): (input: ApplyInput) => Promise<WriteRouteResult> {
  const now = deps.now ?? ((): number => Date.now());
  const refuse = (code: WriteErrorCode, message: string): WriteRouteResult => ({ ok: false, code, message });

  return async (input: ApplyInput): Promise<WriteRouteResult> => {
    // ── ① 确认门（REQ-3.2）：未确认 ⇒ 零提权、零写入，且**不写审计**（被拒绝 = 什么都没发生）
    if (input.problem !== undefined) {
      return refuse('confirm-required', `请求体畸形/超限（${input.problem}）：无法确认 ⇒ 零提权、零写入。`);
    }
    if (input.confirmed !== true) {
      return refuse(
        'confirm-required',
        '未确认（confirmed 必须是 true）：零提权、零写入。先请求计划看到命令原文，确认后带回 planId 与票据。',
      );
    }

    // ── ② 重规划（同一 facts，与 /write/plan 同一条代码路径）：planId 只能由服务端推导
    const computed = await computePlan(deps.facts, input.target);
    if (!computed.ok) return refuse(computed.code, computed.message);
    const { response, eth0Ip, policy: configuredPolicy } = computed.plan;
    const only = response.ports.length === 1 ? response.ports[0] : undefined;
    const planId = response.planId;
    if (!response.ready || planId === null || only === undefined) {
      return refuse(
        'plan-mismatch',
        `目标不可执行（apply 逐端口，REQ-2.4）：${response.blockedReason ?? '计划被拦下'}；零提权、零写入。`,
      );
    }
    if (typeof input.planId !== 'string' || input.planId !== planId) {
      return refuse(
        'plan-mismatch',
        `planId 与本次重算不一致（服务端重算 ${planId.slice(0, 12)}…）：目标可能已变或来自另一次计划；零提权、零写入。`,
      );
    }
    if (eth0Ip === null) {
      return refuse('rules-unavailable', '重算计划时 eth0 取不到（可执行计划不该出现这种形态）：不发起提权、零写入。');
    }

    // ── ③ 票据门（REQ-4）：三种失败**分开报**，每种都零提权零写入
    if (typeof input.ticket !== 'string' || input.ticket === '') {
      return refuse('confirm-required', '缺确认票据（confirm.ticket）：未确认 ⇒ 零提权、零写入。');
    }
    const verdict = deps.tickets.consume(planId, input.ticket);
    if (verdict === 'unknown') {
      return refuse(
        'confirm-required',
        '没有为这份计划签发过票据（或已用过、已过期被清理）：请重新请求计划后再确认；零提权、零写入。',
      );
    }
    if (verdict === 'mismatch') {
      return refuse('plan-mismatch', '票据与本次计划不匹配（票据只对签发它的那份计划有效）：零提权、零写入。');
    }
    if (verdict === 'expired') {
      const seconds = String(Math.trunc(WRITE_CONFIRM_TTL_MS / 1000));
      return refuse('confirm-required', `确认票据已过期（TTL ${seconds} 秒）：请重新请求计划后再确认；零提权、零写入。`);
    }

    // ── ④ 执行（005）：票据 = 用户对命令原文的确认 ⇒ 确认位恒真（闸门已在应用内过完，REQ-3.3）
    // 触发来源：**只有明确写 `user` 才算用户**；缺省/认不出的值一律按 `agent`（保守方向：Agent 的
    // `passby` 会被 005 降级成 `ask`，而反过来的默认会让 Agent 拿到 `passby` 语义）
    const source: RequestSource = input.origin === 'user' ? 'user' : 'agent';
    const auditOrigin: AuditOrigin = source;
    const configured = policyFor(configuredPolicy);
    const effective = resolvePolicy(configured, source);
    const elevationDeps: ElevationDeps = {
      ...defaultElevationDeps(deps.executor),
      ...(deps.elevationDeps ?? {}),
      confirm: async () => true,
    };
    const request: ElevateRequest = {
      plan: {
        ok: true,
        action: response.action,
        port: only.port,
        scope: response.scope,
        eth0Ip,
        steps: only.steps,
        commandText: only.commandText,
      },
      policy: configured,
      source,
    };
    const started = now();
    const result = await runElevate(request, elevationDeps);
    const durationMs = Math.max(0, now() - started);

    // ── ⑤ 失败 ⇒ 回滚**本轮刚加成功**的转发规则（红线：他人规则一条都不动，条数回到执行前）
    const rolledBack: ApplyRollbackOutcome[] = [];
    if (result.status !== 'ok') {
      const byScope = new Map<Scope, PortproxyRule>();
      for (const rule of justAdded(result, only.port)) {
        const rollbackScope = scopeOf(rule.listenAddress);
        if (rollbackScope !== null && !byScope.has(rollbackScope)) byScope.set(rollbackScope, rule);
      }
      for (const [rollbackScope, rule] of byScope) {
        const step = portproxyDeleteStep(rule);
        const undo = await runElevate(
          {
            plan: {
              ok: true,
              action: 'remove',
              port: only.port,
              scope: rollbackScope,
              eth0Ip,
              steps: [step],
              commandText: step.commandText,
            },
            policy: configured,
            source,
          },
          elevationDeps,
        );
        rolledBack.push({
          port: only.port,
          listenAddress: rule.listenAddress,
          ok: undo.status === 'ok',
          message: undo.message,
        });
      }
    }

    // ── ⑥ 审计：只记真正发生过的动作（`disabled` / `no-actions` 在执行前就返回 ⇒ 不写）
    const attempted = result.status !== 'disabled' && result.status !== 'no-actions';
    if (attempted) {
      deps.audit.record({
        origin: auditOrigin,
        planId,
        action: response.action,
        scope: response.scope,
        ports: [only.port],
        steps: only.steps.map((step) => ({ kind: step.kind, port: step.port })),
        elevationPolicy: effective,
        backend: result.backend ?? 'unknown',
        result: result.status === 'ok' ? 'applied' : 'failed',
        exitCode: result.exitCode,
        durationMs,
        rolledBack: rolledBack.length > 0,
        note: result.message,
      });
    }

    const reported = new Set(result.steps.map((step) => step.name));
    const payload: ApplyReport = {
      ok: true,
      planId,
      status: result.status,
      action: response.action,
      scope: response.scope,
      port: only.port,
      elevationPolicy: effective,
      backend: result.backend ?? 'unknown',
      exitCode: result.exitCode,
      durationMs,
      executed: result.steps.filter((step) => step.ok).map((step) => step.name),
      skipped: only.steps.map((step) => step.kind).filter((kind) => !reported.has(kind)),
      failed: result.steps
        .filter((step) => !step.ok)
        .map((step) => ({ name: step.name, ok: false, reason: step.stderr })),
      rolledBack,
      commandText: only.commandText,
      message: result.message,
      hint: result.hint,
    };
    return { ok: true, status: 200, payload };
  };
}
