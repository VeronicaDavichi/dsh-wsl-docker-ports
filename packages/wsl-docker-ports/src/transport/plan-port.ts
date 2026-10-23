/**
 * 012：**单端口计划的装配**（从 `transport/plan.ts` 拆出，只为 NFR-5 的 ≤400 行）
 *
 * 这里只做两件事，且都是纯装配（无 IO、无外部命令）：
 * 1. 把「请求覆盖 / 配置持久化」解析出的监听地址字段并入 `WritePlanInput`（`listen-address.ts` 解析）；
 * 2. 调 005 的 `buildWritePlan()`，把结果原样盘成 `PlanPortDto`（`steps` / `commandText` 不重造）。
 *
 * 🔴 拦下时 `steps` 恒为 `[]` —— 这是 `WriteBlock.steps` 的元组事实，本文件不额外"补"任何步骤。
 *
 * ## 2026-10-23（真机缺陷 F1）：`listenForms` 的懒装配
 *
 * 形态判据需要「该端口配置登记值 ∪ 候选清单」。前者同步现读、零成本；后者要一条只读
 * PowerShell ⇒ **只在真能改变判决时才读**：若该端口每条规则的 `listenAddress` 都已由
 * 「两个默认值 + 配置值」覆盖（`isOurListenAddress` 判 true），候选清单**一个字节都读不到**
 * （`tests/unit/listen-address-persist.test.ts` 的「候选清单零探测」判据照旧成立）。
 * 读取失败降级为缺席（`listen-address.ts:candidates()` 内部 catch）⇒ 不会因此 503。
 */

import type { ManagedPorts } from '../diff/managed-ports.ts';
import type { AllowedListenFacts } from '../diff/listen-allowed.ts';
import { isOurListenAddress } from '../diff/listen-allowed.ts';
import type { PortState, Scope } from '../diff/types.ts';
import type { PortproxyRule } from '../read/netsh.ts';
import { buildWritePlan } from '../write/plan.ts';
import type { WriteAction, WriteBlockReason, WritePlanInput, WriteStep } from '../write/types.ts';
import { listenFactsOf, type ListenResolver } from './listen-address.ts';

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
  // 2026-10-23：`remove` **不需要**任何监听地址字段（删的是规则自己那条地址，`planRemove` 只看 `owned`）
  // ⇒ 连候选清单都不探测。否则「候选清单读不到」会把一个与网卡无关的删除动作盘成 503（缺陷 F1 ③）。
  const inPlace = requestedListenAddressInPlace(sources);
  const listenInput =
    sources.action === 'remove' ? {} : await sources.listen.resolve(port, sources.override, inPlace === true);
  const listenForms = await listenFormsOf(sources);
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
    ...(listenForms === undefined ? {} : { listenForms }),
    ...(inPlace === true && sources.action === 'fix' ? { listenAddressInPlace: true } : {}),
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

/**
 * `listenAddress` 是否**已经**是该端口某条既有规则正在监听的地址（2026-10-23，缺陷 F1）。
 *
 * `fix` 重写「规则自己那条地址」不新增暴露面 ⇒ 允许跳过候选清单那道门（见 `guards.ts:listenAddressGate`）。
 * 请求覆盖优先于配置（与 `listen-address.ts:resolve` 的取值顺序一致）。
 */
function requestedListenAddressInPlace(sources: PlanPortSources): boolean | undefined {
  const requested = (sources.override ?? '').trim();
  const target = requested === '' ? sources.listen.configured(sources.port) : requested;
  if (target === undefined || target === '0.0.0.0') return undefined;
  return sources.rules.some((rule) => rule.listenPort === sources.port && rule.listenAddress === target);
}

/**
 * 形态判据的两项事实（**懒**：候选清单只在「默认值 + 配置值」覆盖不了该端口的规则时才读）。
 *
 * 返回 `undefined` = 两个来源都没有 ⇒ `WritePlanInput.listenForms` 缺席 ⇒ 写侧只认
 * `{127.0.0.1, 0.0.0.0}`（修复前行为，逐字不变）。
 */
async function listenFormsOf(sources: PlanPortSources): Promise<AllowedListenFacts | undefined> {
  const configured = sources.listen.configured(sources.port);
  const covered = configured === undefined ? [] : [configured];
  const needsCandidates = sources.rules.some((rule) => !isOurListenAddress(rule.listenAddress, covered));
  if (!needsCandidates) return configured === undefined ? undefined : { configured };
  return listenFactsOf(configured, await sources.listen.candidates());
}
