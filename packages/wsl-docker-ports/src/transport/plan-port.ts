/**
 * 012：**单端口计划的装配**（从 `transport/plan.ts` 拆出，只为 NFR-5 的 ≤400 行）
 *
 * 这里只做两件事，且都是纯装配（无 IO、无外部命令）：
 * 1. 把「请求覆盖 / 配置持久化」解析出的监听地址字段并入 `WritePlanInput`（`listen-address.ts` 解析）；
 * 2. 调 005 的 `buildWritePlan()`，把结果原样盘成 `PlanPortDto`（`steps` / `commandText` 不重造）。
 *
 * 🔴 拦下时 `steps` 恒为 `[]` —— 这是 `WriteBlock.steps` 的元组事实，本文件不额外"补"任何步骤。
 */

import type { ManagedPorts } from '../diff/managed-ports.ts';
import type { PortState, Scope } from '../diff/types.ts';
import type { PortproxyRule } from '../read/netsh.ts';
import { buildWritePlan } from '../write/plan.ts';
import type { WriteAction, WriteBlockReason, WritePlanInput, WriteStep } from '../write/types.ts';
import type { ListenResolver } from './listen-address.ts';

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

/** 装配一个端口 DTO 所需的全部事实（**都由服务端现读**，客户端只提供 `override`） */
export interface PlanPortSources {
  readonly action: WriteAction;
  readonly port: number;
  readonly scope: Scope;
  readonly managedPorts: ManagedPorts;
  /** `null` = 取不到当前 eth0（此时计划层会拦成 `eth0-unknown`，不猜期望值） */
  readonly eth0Ip: string | null;
  readonly rules: readonly PortproxyRule[];
  readonly fromScope?: Scope | undefined;
  readonly localhostForwarding?: boolean | undefined;
  readonly firewallNames?: readonly string[] | undefined;
  readonly portState?: PortState | undefined;
  /** 监听地址解析器（一次规划共用一个 ⇒ 候选清单至多枚举一次） */
  readonly listen: ListenResolver;
  /** 请求体里的显式覆盖（`undefined` = 用配置里持久化的那一项） */
  readonly override?: string | undefined;
}

export async function planPortDtoOf(sources: PlanPortSources): Promise<PlanPortDto> {
  const { port } = sources;
  const listenInput = await sources.listen.resolve(port, sources.override);
  // ⚠️ `exactOptionalPropertyTypes`：可选字段**只能缺席**，不能显式给 `undefined`
  const input: WritePlanInput = {
    action: sources.action,
    port,
    scope: sources.scope,
    managedPorts: sources.managedPorts,
    eth0Ip: sources.eth0Ip,
    rules: sources.rules,
    ...(sources.fromScope === undefined ? {} : { fromScope: sources.fromScope }),
    ...(sources.localhostForwarding === undefined ? {} : { localhostForwarding: sources.localhostForwarding }),
    ...(sources.firewallNames === undefined ? {} : { existingFirewallNames: sources.firewallNames }),
    ...(sources.portState === undefined ? {} : { portState: sources.portState }),
    ...listenInput,
  };
  const outcome = buildWritePlan(input);
  if (outcome.ok) {
    return { port, ready: true, steps: outcome.steps, commandText: outcome.commandText, notes: outcome.notes };
  }
  return {
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
  };
}
