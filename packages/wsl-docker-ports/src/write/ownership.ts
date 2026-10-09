/**
 * 所有权匹配（005 T1.1 / REQ-1.1 / REQ-1.2 / REQ-1.3）
 *
 * ## 这是整个写路径的安全闸门
 *
 * 本插件**不建台账**（`diff/types.ts` 的说明与 stack-decision 都已定案：「声明式所有权」）。
 * 于是「这条规则是不是我写的」只能靠**规则自身的事实**判 —— 没有第二份状态可查。
 * 本文件把这个判定收成唯一一处纯函数，`plan.ts` 的每个变更动作都必须先过这里。
 *
 * ## 判定顺序（每一条都对应一条 REQ）
 *
 * 1. `listenPort ∉ managedPorts` → `unmanaged`：REQ-1.1「集合外端口零参与」。
 * 2. 形状不符（`connectPort != listenPort` / `listenAddress ∉ {127.0.0.1, 0.0.0.0}`）→ `conflict`：
 *    这种规则**连形态都不是本插件会写的**，engine 也判 conflict；T1.1 明令 conflict 无任何写动作。
 *    （判据与 `diff/engine.ts` 的 conflict 分支逐条对齐，避免两处口径分叉。）
 * 3. `connectAddress === 期望值`（= 当前 eth0）→ `owned`：**REQ-1.2 的删除前置**。
 * 4. 其余（`connectAddress` 既非当前 eth0）→ `not-owned`：
 *    - REQ-1.3 说「既非当前 eth0、也非**本插件写入值**」→ conflict。而 REQ-1.2 说的可删集合是
 *      「`connectAddress` == 本插件该端口的**期望值**」。两者的差集正是「本插件**历史**写入值」
 *      （漂移前的旧 eth0）—— 而**不建台账就无法判定**某个地址是不是我们写过。
 *    - 故按 REQ-1.2 的**字面**实现：无法证明是我写的 ⇒ 不算 owned ⇒ **一个动作都不产生**。
 *      这是保守方向（少做而不是误删），也正是本次实现要上报的口径张力（见 tasks/报告）；
 *      本文件不自行放宽（把旧地址当自己的）也不收紧（把它标成 conflict 断言「不是我的」）——
 *      `not-owned` 就是「无法证明」，语义上比 conflict 更弱，不会被 UI 当成「别人的规则」展示。
 */

import { expectedListenAddress, OUR_LISTEN_ADDRESSES } from '../diff/engine.ts';
import { isManagedPort, type ManagedPorts } from '../diff/managed-ports.ts';
import type { Scope } from '../diff/types.ts';
import type { PortproxyRule } from '../read/netsh.ts';

/**
 * 本插件会写的两种 `listenAddress`：**全仓唯一一份**，来自 003 的 `diff/engine.ts`。
 * ⚠️ 2026-10-09 集成期订正：本文件原先复制了一份同名常量；「形态不符」的判据在读侧（引擎）
 * 与写侧（本闸门）必须**逐字一致**，两份会各自漂移 ⇒ 改为 import（`engine.ts` 已开出口）。
 * `expectedListenAddress` 同样从那里来（转出为 `listenAddressForScope`），不另立映射。
 */

/** 单条规则的所有权归属 */
export type OwnershipKind = 'owned' | 'conflict' | 'not-owned' | 'unmanaged';

export type OwnershipReason =
  | 'expected-address-match'
  | 'connect-port-mismatch'
  | 'listen-address-unknown'
  | 'expected-address-mismatch'
  | 'port-not-managed'
  | 'listen-port-mismatch';

export interface RuleOwnership {
  readonly kind: OwnershipKind;
  readonly reason: OwnershipReason;
  /** 给人看的一句话（可直接进 UI / 报告） */
  readonly message: string;
}

export interface OwnershipDetail {
  readonly rule: PortproxyRule;
  readonly ownership: RuleOwnership;
}

/** 一个端口的匹配结果（按规则分桶；`owned` 就是 REQ-1.2 允许删/改的集合） */
export interface OwnershipMatch {
  readonly port: number;
  /** 端口是否 ∈ `managedPorts`（REQ-1.1） */
  readonly managed: boolean;
  readonly owned: readonly PortproxyRule[];
  /** 形态不符：只报告、绝不改动（REQ-1.3 / design §2 的 conflict 行） */
  readonly conflicts: readonly OwnershipDetail[];
  /** 无法证明归属：`connectAddress` 与期望值不一致（含漂移旧地址）⇒ 不受理 */
  readonly notOwned: readonly OwnershipDetail[];
  /** 集合外（本函数不该收到，收到也只是原样标出、零参与） */
  readonly unmanaged: readonly PortproxyRule[];
}

export interface OwnershipInput {
  readonly port: number;
  readonly rules: readonly PortproxyRule[];
  readonly managedPorts: ManagedPorts;
  /** 本插件该端口的期望 `connectAddress`（= 当前 eth0）；取不到时传 `null` ⇒ 一律 `not-owned` */
  readonly expectedConnectAddress: string | null;
}

/**
 * REQ-1.2 的**字面**谓词：`listenPort ∈ managedPorts` **且** `connectAddress == 期望值`。
 * 单独导出是因为它是红线条款，必须能被逐字引用与断言（同时也被 T1.1 的用例直接测）。
 */
export function isDeletableRule(
  managedPorts: ManagedPorts,
  rule: PortproxyRule,
  expectedConnectAddress: string | null,
): boolean {
  if (expectedConnectAddress === null) return false;
  return isManagedPort(managedPorts, rule.listenPort) && rule.connectAddress === expectedConnectAddress;
}

/** 单条规则的归属判定（顺序即优先级，见文件头） */
export function classifyRuleOwnership(
  rule: PortproxyRule,
  input: { readonly port: number; readonly managedPorts: ManagedPorts; readonly expectedConnectAddress: string | null },
): RuleOwnership {
  if (rule.listenPort !== input.port) {
    return {
      kind: 'unmanaged',
      reason: 'listen-port-mismatch',
      message: `规则的 listenPort=${String(rule.listenPort)} 不是本次判定的端口 ${String(input.port)}，零参与`,
    };
  }
  if (!isManagedPort(input.managedPorts, rule.listenPort)) {
    return {
      kind: 'unmanaged',
      reason: 'port-not-managed',
      message: `端口 ${String(rule.listenPort)} 不在 managedPorts 声明集合内：不进五态、不可操作、不可修复（REQ-1.1）`,
    };
  }
  if (rule.connectPort !== rule.listenPort) {
    return {
      kind: 'conflict',
      reason: 'connect-port-mismatch',
      message: `connectPort=${String(rule.connectPort)} 与 listenPort=${String(rule.listenPort)} 不符：形态不是本插件会写的，只报告不改动（REQ-1.3）`,
    };
  }
  if (!OUR_LISTEN_ADDRESSES.includes(rule.listenAddress)) {
    return {
      kind: 'conflict',
      reason: 'listen-address-unknown',
      message: `listenAddress=${rule.listenAddress} 不在本插件会写的 {127.0.0.1, 0.0.0.0} 内：只报告不改动（REQ-1.3）`,
    };
  }
  if (input.expectedConnectAddress === null) {
    return {
      kind: 'not-owned',
      reason: 'expected-address-mismatch',
      message: '取不到当前 eth0 ⇒ 期望 connectAddress 不可判定 ⇒ 该规则不受理（003 REQ-6.4）',
    };
  }
  if (rule.connectAddress === input.expectedConnectAddress) {
    return {
      kind: 'owned',
      reason: 'expected-address-match',
      message: `connectAddress 与期望值一致（${rule.connectAddress}）：满足 REQ-1.2 的删除前置`,
    };
  }
  return {
    kind: 'not-owned',
    reason: 'expected-address-mismatch',
    message: `connectAddress=${rule.connectAddress} 与期望值 ${input.expectedConnectAddress} 不一致，且不建台账无法证明它是本插件写入的历史值 ⇒ 按 REQ-1.2 字面不受理`,
  };
}

/** 按端口做完整匹配（`owned` / `conflicts` / `notOwned` / `unmanaged` 四桶） */
export function matchOwnership(input: OwnershipInput): OwnershipMatch {
  const owned: PortproxyRule[] = [];
  const conflicts: OwnershipDetail[] = [];
  const notOwned: OwnershipDetail[] = [];
  const unmanaged: PortproxyRule[] = [];

  for (const rule of input.rules) {
    const ownership = classifyRuleOwnership(rule, {
      port: input.port,
      managedPorts: input.managedPorts,
      expectedConnectAddress: input.expectedConnectAddress,
    });
    switch (ownership.kind) {
      case 'owned':
        owned.push(rule);
        break;
      case 'conflict':
        conflicts.push({ rule, ownership });
        break;
      case 'not-owned':
        notOwned.push({ rule, ownership });
        break;
      case 'unmanaged':
        unmanaged.push(rule);
        break;
    }
  }

  return {
    port: input.port,
    managed: isManagedPort(input.managedPorts, input.port),
    owned,
    conflicts,
    notOwned,
    unmanaged,
  };
}

/** 某作用域下本插件会写的 listenAddress（转调 003 的 `expectedListenAddress`，不另立一份映射） */
export function listenAddressForScope(scope: Scope): string {
  return expectedListenAddress(scope);
}
