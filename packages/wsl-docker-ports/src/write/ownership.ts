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
 * 2. 形状不符（`connectPort != listenPort` / `listenAddress` 不在「本插件形态」集合内）→ `conflict`：
 *    这种规则**连形态都不是本插件会写的**，engine 也判 conflict；T1.1 明令 conflict 无任何写动作。
 *    🔴 2026-10-23（真机缺陷 F1）：形态判据**不再**是本文件自己比两个字面量，而是
 *    `diff/listen-allowed.ts:isOurListenAddress(value, allowed)` —— 与读侧 `diff/engine.ts`
 *    调的是**同一个函数**；`allowed` = 该端口配置登记值 ∪ 候选清单（组装点唯一，见 `guards.ts:matchOf`）。
 *    修复前的症状：本插件写出的 `listenAddress=192.168.31.129` 在快照里 `ok`、在计划里 `state-conflict`。
 * 3. `connectAddress === 期望值`（= 当前 eth0）→ `owned`：**REQ-1.2 的删除前置**。
 * 4. 其余（`connectAddress` 既非当前 eth0）→ `not-owned`：
 *    - REQ-1.3 说「既非当前 eth0、也非**本插件写入值**」→ conflict。而 REQ-1.2 说的可删集合是
 *      「`connectAddress` == 本插件该端口的**期望值**」。两者的差集正是「本插件**历史**写入值」
 *      （漂移前的旧 eth0）—— 而**不建台账就无法判定**某个地址是不是我们写过。
 *    - 故按 REQ-1.2 的**字面**实现：无法证明是我写的 ⇒ 不算 owned ⇒ **一个动作都不产生**。
 *      这是保守方向（少做而不是误删），也正是本次实现要上报的口径张力（见 tasks/报告）；
 *      本文件不自行放宽（把旧地址当自己的）也不收紧（把它标成 conflict 断言「不是我的」）——
 *      `not-owned` 就是「无法证明」，语义上比 conflict 更弱，不会被 UI 当成「别人的规则」展示。
 * 5. 🔴 **2026-10-16 主人裁定 (a)：只放宽 `fix`**（上面第 4 条的张力已裁定；`remove` **不受影响**）。
 *    真机取证（`20261016-005-fix`）证明：drift 的 `fix` 与 `remove` **双双**被第 4 条拦成
 *    `rule-not-owned` ⇒ 真实漂移一条都修不了，`planFix` 的成功分支是**死代码**。裁定 = 在
 *    **声明集合内**且 listen 形态为本插件的前提下，`connectAddress` 是**合法 IPv4 且 ≠ 当前 eth0**
 *    ⇒ 视为「本插件**历史**写入值」⇒ 允许 `fix` 把地址改回当前 eth0；`remove` 仍按 REQ-1.2 字面
 *    只受理 `connectAddress == 期望值`（删除是破坏性的：删掉就没了；要先清漂移规则就 `fix` 再 `remove`）。
 *    依据 = `stack-decision.md` 的端口所有权维度「**声明集合界定所有权**，不建台账」，
 *    集合外端口一律零参与 ⇒ 取舍与代价写在下面 `fixableDriftRule()` 的注释里（不藏）。
 */

import { expectedListenAddress } from '../diff/engine.ts';
import { describeAllowedListenAddresses, isOurListenAddress } from '../diff/listen-allowed.ts';
import { isManagedPort, type ManagedPorts } from '../diff/managed-ports.ts';
import type { Scope } from '../diff/types.ts';
import type { PortproxyRule } from '../read/netsh.ts';

/**
 * 形态判据：**共用** `diff/listen-allowed.ts` 的 `isOurListenAddress`，本文件不再自己比字面量。
 *
 * 演进留痕：
 * - 2026-10-09：本文件原先复制了一份 `OUR_LISTEN_ADDRESSES`；判据必须读写同源 ⇒ 改为 import。
 * - 2026-10-23（真机缺陷 F1）：连「import 常量、自己 `includes()`」这个半吊子写法也取消 ——
 *   因为判决还差一个入参（`allowed` = 配置登记值 ∪ 候选清单）。现在两侧都走同一个函数 +
 *   同一个组装点（`diff/listen-allowed.ts:allowedListenAddressesFor`）。
 * `expectedListenAddress` 同样从 `diff/engine.ts` 来（转出为 `listenAddressForScope`），不另立映射。
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
  /**
   * 本次判定用到的 allowed 集合（配置登记值 ∪ 候选清单）。
   * 由 `matchOwnership` 原样带出，供 `fixableDriftRule()` 复用**同一份**判据
   * （不在第二个函数里再写一遍「哪些地址算我们的」）。
   */
  readonly allowedListenAddresses: readonly string[];
}

export interface OwnershipInput {
  readonly port: number;
  readonly rules: readonly PortproxyRule[];
  readonly managedPorts: ManagedPorts;
  /** 本插件该端口的期望 `connectAddress`（= 当前 eth0）；取不到时传 `null` ⇒ 一律 `not-owned` */
  readonly expectedConnectAddress: string | null;
  /**
   * 2026-10-23（缺陷 F1）：本插件形态判据的 allowed 集合 = 配置登记值 ∪ 候选清单。
   * 由 `write/guards.ts:matchOf` 用 `allowedListenAddressesFor()` 组装（**唯一组装点**）；
   * 缺省 `[]` ⇒ 只认 `{127.0.0.1, 0.0.0.0}`（修复前行为）。
   */
  readonly allowedListenAddresses?: readonly string[];
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** 是否是形态合法的 IPv4（不做 DNS、不做网段判定：只保证它能安全地进 argv / 脚本参数） */
export function isIpv4(value: string): boolean {
  if (!IPV4.test(value)) return false;
  return value.split('.').every((part) => Number(part) <= 255);
}

/**
 * REQ-1.2 的**字面**谓词：`listenPort ∈ managedPorts` **且** `connectAddress == 期望值`。
 * 单独导出是因为它是红线条款，必须能被逐字引用与断言（同时也被 T1.1 的用例直接测）。
 *
 * ⚠️ **只用于 `remove`（与 `switch-scope` 的归属判定）**；`fix` 走
 * `fixableDriftRule()` 的放宽口径（2026-10-16 裁定 (a)，见文件头第 5 条）。
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
  input: {
    readonly port: number;
    readonly managedPorts: ManagedPorts;
    readonly expectedConnectAddress: string | null;
    readonly allowedListenAddresses?: readonly string[];
  },
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
  const allowed = input.allowedListenAddresses ?? [];
  if (!isOurListenAddress(rule.listenAddress, allowed)) {
    return {
      kind: 'conflict',
      reason: 'listen-address-unknown',
      message: `listenAddress=${rule.listenAddress} 不在本插件会写的监听地址集合内（${describeAllowedListenAddresses(allowed)}）：只报告不改动（REQ-1.3）`,
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
      ...(input.allowedListenAddresses === undefined ? {} : { allowedListenAddresses: input.allowedListenAddresses }),
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
    allowedListenAddresses: input.allowedListenAddresses ?? [],
  };
}

/**
 * `fix` **专用**的放宽谓词 —— 2026-10-16 主人裁定 **(a)**（背景见文件头第 5 条）
 *
 * ## 判据（字面，逐条可断言）
 *
 * 1. 端口 ∈ `managedPorts`（`match.managed`；REQ-1.1 的声明式所有权）
 * 2. 规则已在 `notOwned` 桶里 ⇒ 它必然已过 `listenPort === 端口` / `connectPort === listenPort` /
 *    形态族（`isOurListenAddress`）三道判据 —— 这里**再显式复用一次** listen 形态，
 *    因为桶的构造若变化不该**静默**放宽这道门（防御性复算，不是重复）。
 *    2026-10-23 起复算用的是 `match.allowedListenAddresses`（= 判定那一刻用的同一份集合），
 *    ⇒ 配置登记的具体网卡 IP 也能被 `fix` 修（缺陷 F1 的另一半）。
 * 3. `connectAddress` 是**合法 IPv4**（非 IPv4 的历史值不可判定）**且 ≠ 当前 eth0**（否则本该是 `owned`）
 *
 * ## 已知取舍（写在这里，不藏）
 *
 * 不建台账 ⇒ **无法**区分「本插件的旧地址规则」与「他人写在**已声明**端口上、恰好是本插件监听形态
 * 的规则」。裁定取**声明式所有权**（`stack-decision.md`）：代价是这类**已声明端口**上的外来规则会被
 * 当作历史漂移一并改地址；**声明集合外**的端口仍零参与（`commonGate` 的 `port-not-managed` 先拦）。
 * 不选「按历史 eth0 白名单」的原因：我们不记历史，猜一个「旧地址清单」等于把台账做在代码里。
 *
 * @returns 可被 `fix` 重建的那条规则；没有则 `undefined`（`planFix` 照旧 `rule-not-owned` 拦下）
 */
export function fixableDriftRule(
  match: OwnershipMatch,
  expectedConnectAddress: string | null,
): PortproxyRule | undefined {
  if (expectedConnectAddress === null || !match.managed) return undefined;
  return match.notOwned.find((detail) => {
    const rule = detail.rule;
    // 与 `classifyRuleOwnership` **同一份** allowed（`match.allowedListenAddresses` 就是它用的那份）：
    // 2026-10-23 起配置登记的具体网卡 IP 也算本插件形态（缺陷 F1）。
    if (!isOurListenAddress(rule.listenAddress, match.allowedListenAddresses)) return false;
    if (rule.listenPort !== match.port || rule.connectPort !== rule.listenPort) return false;
    if (!isIpv4(rule.connectAddress)) return false;
    return rule.connectAddress !== expectedConnectAddress;
  })?.rule;
}

/**
 * 某作用域下本插件会写的 listenAddress（转调 003 的 `expectedListenAddress`，不另立一份映射）。
 *
 * 012（2026-10-22）：多接一个可选的**用户选择** —— `lan` + 具体 IP 时应写那个 IP；
 * 不传 ⇒ 逐字同 010（`lan` = `0.0.0.0`）。
 * ⚠️ 本函数回答的是「**要写哪个地址**」，不是「哪些地址算我们的」—— 后者唯一来源是
 * `diff/listen-allowed.ts:isOurListenAddress`（2026-10-23 起读写两侧同源，见文件头第 2 条）。
 */
export function listenAddressForScope(scope: Scope, listenAddress?: string): string {
  return expectedListenAddress(scope, listenAddress);
}
