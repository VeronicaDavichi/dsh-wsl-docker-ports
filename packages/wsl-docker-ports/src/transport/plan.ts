/**
 * 008 T1.3 只读动作计划通道（REQ-2）
 *
 * ## 这一层**不重写算法**（唯一真相在 005）
 *
 * 计划算法早就在 `write/plan.ts:345 buildWritePlan()` 里，且已带 `steps[].commandText`（REQ-3.2 的
 * 「展示命令原文」）与 `port-not-managed` 等拦下原因（`write/types.ts:56`）。本文件只做四件事：
 *
 * 1. **白名单解析声明式目标**：只认 `action` / `ports` / `scope` / `fromScope`。
 *    🔴 **所有权集合、eth0、既有规则、防火墙规则名一律由服务端现读**，绝不接受客户端传入 ——
 *    否则客户端只要声称「这个端口归我管」就能越过所有权边界（REQ-2 的安全命门）。
 * 2. **现读事实经注入**：`PlanFacts` 里全是「读」函数 ⇒ 装载期与单测都零外部命令，
 *    真机现读由 `plugin.ts` 在 T1.4 接线。
 * 3. **规范化 + `planId`**：`SHA-256` 只吃「会改变系统状态的东西」（`action` / `scope` / 端口升序 /
 *    每步 `kind`+`port`+`params` 按键升序），**不含** `notes` / `commandText` ⇒ 文案微调不会让
 *    已发出的票据失效，而任何一步实质变化都必然换 id。
 * 4. **盘成 DTO**：能执行 ⇒ 全步骤 + 命令原文 + 说明 + `planId`；被拦下 ⇒ **空 `steps`** + 原因 + 提示
 *    + 冲突规则（`WriteBlock` 的原样透出，不是错误）。
 *
 * ## 零副作用
 *
 * 本文件**不导入任何执行器**、不碰文件、不改注册表：唯一动作是调用注入的读函数与纯函数
 * `buildWritePlan()`。判据见 `tests/unit/transport-plan.test.ts`（装载期零命令、计划期零写调用）。
 */

import { createHash } from 'node:crypto';

import type { ManagedPorts } from '../diff/managed-ports.ts';
import type { PortState, Scope } from '../diff/types.ts';
import type { PortproxyRule } from '../read/netsh.ts';
import { isPortNumber } from '../write/firewall.ts';
import { buildWritePlan } from '../write/plan.ts';
import type { WriteAction, WriteBlockReason, WritePlanInput, WriteStep } from '../write/types.ts';
import type { WriteRouteResult } from './routes.ts';

/** 一次请求里最多处理多少个端口（声明集合可以是几千个端口，但单次写计划不该无界） */
export const PLAN_MAX_PORTS = 256;

/** 单次请求里最多几个所有权区间（防无界入参） */
export const PLAN_MAX_RANGES = 64;

/** 解析后的目标（端口已去重并**升序** —— `planId` 与展示都依赖这个稳定次序） */
export interface PlanTarget {
  readonly action: WriteAction;
  readonly ports: readonly number[];
  readonly scope: Scope;
  readonly fromScope?: Scope | undefined;
  /** 请求方声明的所有权集合（方案 (a)，同 003 的 query）；缺省 = 空集 */
  readonly declaration?: ManagedPorts | undefined;
}

const ACTIONS: readonly WriteAction[] = ['add', 'remove', 'fix', 'switch-scope'];
const SCOPES: readonly Scope[] = ['loopback', 'lan'];

export function isPlanAction(value: unknown): value is WriteAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export function isPlanScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

/**
 * 解析声明式目标。**非法一律给可读原因**（REQ-2.3：不抛、不猜、不静默），
 * 由调用方盘成「空计划 + 原因」。
 */
export function normalizeTarget(
  raw: unknown,
): { readonly ok: true; readonly target: PlanTarget } | { readonly ok: false; readonly reason: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: '目标必须是对象，形如 { action, ports, scope }' };
  }
  const record = raw as Record<string, unknown>;

  const action = record['action'];
  if (!isPlanAction(action)) {
    return { ok: false, reason: `action 必须是 ${ACTIONS.join(' / ')} 之一，实际 ${JSON.stringify(action) ?? 'undefined'}` };
  }

  const rawPorts = record['ports'] ?? (record['port'] === undefined ? undefined : [record['port']]);
  if (!Array.isArray(rawPorts) || rawPorts.length === 0) {
    return { ok: false, reason: 'ports 必须是非空数组（或给单个 port）；不接受空计划请求' };
  }
  if (rawPorts.length > PLAN_MAX_PORTS) {
    return { ok: false, reason: `单次最多 ${String(PLAN_MAX_PORTS)} 个端口，实际 ${String(rawPorts.length)} 个` };
  }
  const ports: number[] = [];
  for (const item of rawPorts) {
    if (typeof item !== 'number' || !isPortNumber(item)) {
      return { ok: false, reason: `端口必须是 1..65535 的整数，实际 ${JSON.stringify(item) ?? 'undefined'}` };
    }
    ports.push(item);
  }
  const unique = [...new Set(ports)].sort((left, right) => left - right);

  const scope = record['scope'] ?? 'loopback';
  if (!isPlanScope(scope)) {
    return { ok: false, reason: `scope 必须是 ${SCOPES.join(' / ')} 之一，实际 ${JSON.stringify(scope) ?? 'undefined'}` };
  }

  const parsedDeclaration = parseDeclaration(record['declaration']);
  if (!parsedDeclaration.ok) return { ok: false, reason: parsedDeclaration.reason };
  const declaration = parsedDeclaration.ports;
  /** 请求没给声明 ⇒ 交 undefined（给将来的 host 侧默认值留接口）；显式空数组 = 合法空集 */
  const declared = record['declaration'] === undefined || record['declaration'] === null ? undefined : declaration;

  const rawFrom = record['fromScope'];
  if (action === 'switch-scope') {
    if (!isPlanScope(rawFrom)) {
      return { ok: false, reason: 'switch-scope 必须给 fromScope（loopback / lan 之一）' };
    }
    return { ok: true, target: { action, ports: unique, scope, fromScope: rawFrom, declaration: declared } };
  }
  if (rawFrom !== undefined && !isPlanScope(rawFrom)) {
    return { ok: false, reason: `fromScope 给了但不是合法作用域：${JSON.stringify(rawFrom) ?? 'undefined'}` };
  }
  return { ok: true, target: { action, ports: unique, scope, fromScope: isPlanScope(rawFrom) ? rawFrom : undefined, declaration: declared } };
}

/**
 * 解析请求方声明的所有权集合（方案 (a)：与 003 的 snapshot?managedPorts=… 同构）。
 *
 * 🔴 缺省 = **空集**（不是全集）⇒ 一切都 port-not-managed：失败方向永远是「什么都不做」，
 * 绝不因为「没声明」而放宽。
 */
export function parseDeclaration(
  raw: unknown,
): { readonly ok: true; readonly ports: ManagedPorts } | { readonly ok: false; readonly reason: string } {
  if (raw === undefined || raw === null) return { ok: true, ports: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: 'declaration 必须是区间数组，形如 [{ start, end }]' };
  if (raw.length > PLAN_MAX_RANGES) return { ok: false, reason: `declaration 最多 ${String(PLAN_MAX_RANGES)} 个区间` };
  const ranges: { start: number; end: number }[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return { ok: false, reason: 'declaration 的元素必须是 { start, end }' };
    const range = item as Record<string, unknown>;
    const start = range['start'];
    const end = range['end'];
    if (typeof start !== 'number' || typeof end !== 'number' || !isPortNumber(start) || !isPortNumber(end) || start > end) {
      return { ok: false, reason: `declaration 区间必须是 1..65535 且 start <= end，实际 ${JSON.stringify(item) ?? 'undefined'}` };
    }
    ranges.push({ start, end });
  }
  return { ok: true, ports: ranges };
}

/** 现读事实（**全是读**；T1.4 接真机，单测给固定 fixture ⇒ 两边都零副作用） */
/** 提权可用性（REQ-3.1：预览必须显示它）。**允许 Promise** ⇒ 接线方可**真触发**探测；plan.ts 一律 wait（await 非 Promise 合法 ⇒ 既有同步替身不受影响）。 */
export interface PlanElevation {
  readonly policy: string;
  readonly backend: string;
  readonly available: boolean;
}

export interface PlanFacts {
  /** 声明集合（REQ-1.1 所有权判据）—— 只来自服务端配置 */
  managedPorts(declaration: ManagedPorts | undefined): ManagedPorts;
  /** 当前 eth0（003 REQ-6.4）；`null` = 取不到 ⇒ 由 `buildWritePlan` 拦成 `eth0-unknown` */
  eth0Ip(): Promise<string | null>;
  /** 该端口的全部既有规则（003 的五态输入） */
  rules(port: number): Promise<readonly PortproxyRule[]>;
  /** 003 的五态判决（可选：给了就多过一道门） */
  portState?: ((port: number) => PortState | undefined) | undefined;
  /** 已存在的防火墙规则名（REQ-2.6 同名冲突判定） */
  firewallNames?: (() => Promise<readonly string[]>) | undefined;
  /** `localhostForwarding`（REQ-2.2/2.5）；`null` = 取不到 */
  localhostForwarding?: (() => boolean | null) | undefined;
  /** 当前提权策略与后端（REQ-3.1：预览必须显示它） */
  elevation(): PlanElevation | Promise<PlanElevation>;
}

/** 单端口计划（原样透出 005 的 `WriteStep`，不另造步骤形状） */
export interface PlanPortDto {
  readonly port: number;
  readonly ready: boolean;
  readonly steps: readonly WriteStep[];
  readonly commandText: string;
  readonly notes: readonly string[];
  readonly blocked?:
    | {
        readonly reason: WriteBlockReason;
        readonly message: string;
        readonly hint: string;
        readonly conflictRules: readonly PortproxyRule[];
      }
    | undefined;
}

export interface PlanResponse {
  readonly ok: true;
  /** 只有**全部端口都能执行**且非空时才给（否则 `null` ⇒ 没有票据可用） */
  readonly planId: string | null;
  readonly ready: boolean;
  readonly action: WriteAction;
  readonly scope: Scope;
  readonly fromScope: string | null;
  readonly ports: readonly PlanPortDto[];
  /** 全部步骤的命令原文（`\n` 连接），供确认展示 */
  readonly commandText: string;
  readonly notes: readonly string[];
  readonly elevation: { readonly policy: string; readonly backend: string; readonly available: boolean };
  /** 整单层面的原因（畸形请求 / 非法目标）；单端口原因在各 `ports[].blocked` 里 */
  readonly blockedReason: string | null;
}

/**
 * 规范文本：**只含会改变系统状态的东西**。
 * 端口升序、每步 `params` 按键升序、`notes` / `commandText` 一律不进 ⇒ 文案改动不换 `planId`。
 */
export function canonicalPlanText(input: {
  readonly action: WriteAction;
  readonly scope: Scope;
  readonly fromScope?: string | undefined;
  readonly ports: readonly { readonly port: number; readonly ready: boolean; readonly steps: readonly WriteStep[] }[];
}): string {
  const ordered = [...input.ports].sort((left, right) => left.port - right.port);
  return JSON.stringify({
    v: 1,
    action: input.action,
    scope: input.scope,
    fromScope: input.fromScope ?? null,
    ports: ordered.map((item) => ({
      port: item.port,
      ready: item.ready,
      steps: item.steps.map((step) => ({
        kind: step.kind,
        port: step.port,
        params: Object.keys(step.params)
          .sort()
          .map((key) => [key, step.params[key]]),
      })),
    })),
  });
}

export function planIdOf(input: Parameters<typeof canonicalPlanText>[0]): string {
  return createHash('sha256').update(canonicalPlanText(input), 'utf8').digest('hex');
}

/** 空计划：**零步骤 + 可读原因**（REQ-2.3 的形态，不是错误码） */
function emptyPlan(reason: string, elevation: PlanResponse['elevation']): WriteRouteResult {
  const payload: PlanResponse = {
    ok: true,
    planId: null,
    ready: false,
    action: 'add',
    scope: 'loopback',
    fromScope: null,
    ports: [],
    commandText: '',
    notes: [reason],
    elevation,
    blockedReason: reason,
  };
  return { ok: true, status: 200, payload };
}

/** 造只读计划通道（注入的是路由的 `plan` 依赖） */
export function createPlanChannel(facts: PlanFacts): (target: unknown, problem?: string) => Promise<WriteRouteResult> {
  return async (target: unknown, problem?: string): Promise<WriteRouteResult> => {
    let elevation: PlanResponse['elevation'];
    try {
      elevation = await facts.elevation();
    } catch {
      elevation = { policy: 'unknown', backend: 'unknown', available: false };
    }

    if (problem !== undefined) return emptyPlan(problem, elevation);
    const normalized = normalizeTarget(target);
    if (!normalized.ok) return emptyPlan(normalized.reason, elevation);

    const { action, ports, scope } = normalized.target;
    const fromScope = normalized.target.fromScope;

    try {
      const managedPorts = facts.managedPorts(normalized.target.declaration);
      const eth0Ip = await facts.eth0Ip();
      const firewallNames = facts.firewallNames === undefined ? undefined : await facts.firewallNames();
      const localhostForwarding = facts.localhostForwarding === undefined ? undefined : facts.localhostForwarding();

      const dtos: PlanPortDto[] = [];
      for (const port of ports) {
        const rules = await facts.rules(port);
        const portState = facts.portState?.(port);
        // ⚠️ `exactOptionalPropertyTypes`：可选字段**只能缺席**，不能显式给 `undefined`
        const input: WritePlanInput = {
          action,
          port,
          scope,
          managedPorts,
          eth0Ip,
          rules,
          ...(fromScope === undefined ? {} : { fromScope }),
          ...(localhostForwarding === undefined || localhostForwarding === null ? {} : { localhostForwarding }),
          ...(firewallNames === undefined ? {} : { existingFirewallNames: firewallNames }),
          ...(portState === undefined ? {} : { portState }),
        };
        const outcome = buildWritePlan(input);
        dtos.push(
          outcome.ok
            ? { port, ready: true, steps: outcome.steps, commandText: outcome.commandText, notes: outcome.notes }
            : {
                port,
                ready: false,
                steps: [],
                commandText: '',
                notes: [],
                blocked: {
                  reason: outcome.reason,
                  message: outcome.message,
                  hint: outcome.hint,
                  conflictRules: outcome.conflictRules,
                },
              },
        );
      }

      const ready = dtos.length > 0 && dtos.every((item) => item.ready);
      const response: PlanResponse = {
        ok: true,
        planId: ready ? planIdOf({ action, scope, fromScope, ports: dtos }) : null,
        ready,
        action,
        scope,
        fromScope: fromScope ?? null,
        ports: dtos,
        commandText: dtos
          .map((item) => item.commandText)
          .filter((text) => text !== '')
          .join('\n'),
        notes: dtos.flatMap((item) => item.notes),
        elevation,
        blockedReason: ready ? null : '至少一个端口被拦下（见 ports[].blocked）',
      };
      return { ok: true, status: 200, payload: response };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, code: 'rules-unavailable', message: `现读事实失败，未产生任何动作：${message}` };
    }
  };
}
