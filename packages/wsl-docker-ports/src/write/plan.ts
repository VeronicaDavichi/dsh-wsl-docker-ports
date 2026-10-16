/**
 * 写操作序列（005 T1.3 / T1.5 / design §2 的算法表）
 *
 * ## 纯函数
 *
 * 和 003 的引擎同一取向：不接执行器、不碰文件、不写任何东西 —— 只**规划**出有序步骤。
 * 真跑起来的是 `src/elevate/` 的提权辅助进程；这一层连一个可调用钩子都不往外给。
 *
 * ## 每个动作的门（对应 design §2 的「前置检查」列）
 *
 * | 动作 | 前置 |
 * |---|---|
 * | `add` | 端口 ∈ `managedPorts` · eth0 可判定 · 该端口**没有**任何既有规则 · `lan` 时防火墙同名不冲突 · `loopback && localhostForwarding` 时**无需规则**⇒零步骤 |
 * | `remove` | 端口 ∈ 集合 · 存在**满足 REQ-1.2** 的规则（`connectAddress == 期望值`）· 无形态冲突规则 |
 * | `fix` | `state == drift` · 同上（REQ-1.2 前置）—— 见文件末的**已知张力** |
 * | `switch-scope` | 逐端口显式（`from !== to`）· `lan→loopback` 只删自己那条 |
 *
 * **前置不满足 ⇒ `WriteBlock`，`steps` 恒为空元组**：不是「少做一步」，而是「一个动作都不产生」。
 *
 * ## 已知张力的处置（2026-10-16 主人裁定 (a)：**只放宽 `fix`**）
 *
 * 原张力（原文留痕）：`fix` 的目标态是 `drift`，而 `drift` 的规则 `connectAddress == 旧 eth0
 * != 期望值`，按 REQ-1.2 的字面前置它**不满足删除条件** ⇒ 本实现会 `rule-not-owned` 拦下、零动作；
 * 这正是「REQ-1.2 的可删集合」与「REQ-1.3 的『本插件写入值』」之间的差集。2026-10-16 真机取证
 * 确认它把 `fix`/`remove` **双双拦死**（真实漂移一条都修不了 ⇒ 原来的成功分支是死代码）⇒ 裁定：
 * 声明集合内 + listen 形态为本插件 + `connectAddress` 是合法 IPv4 且 ≠ 当前 eth0 ⇒ 允许 `fix`
 * 改回当前 eth0（判据 = `ownership.ts:fixableDriftRule()`），**`remove` 不放宽**；作用域**沿用既有规则**。
 */

import { isManagedPort, type ManagedPorts } from '../diff/managed-ports.ts';
import type { PortState, Scope } from '../diff/types.ts';
import type { PortproxyRule } from '../read/netsh.ts';

import {
  buildFirewallAddStep,
  buildFirewallDeleteStep,
  firewallNameExists,
  firewallRuleName,
  isPortNumber,
} from './firewall.ts';
import { fixableDriftRule, isIpv4, listenAddressForScope, matchOwnership, type OwnershipMatch } from './ownership.ts';
import { explainScope, needsExplicitRule } from './scope-note.ts';
import type {
  WriteBlock,
  WriteBlockReason,
  WritePlan,
  WritePlanInput,
  WritePlanOutcome,
  WriteStep,
} from './types.ts';

/**
 * 从前就在本文件的 IPv4 判据，2026-10-16 挪进 `ownership.ts`（与另外两道**规则形态**判据同族：
 * 裁定 (a) 的 `fixableDriftRule` 要用它，而 `ownership.ts` 不能反过来 import 本文件 —— 会成环）。
 * 这里**原样转出**，`write/index.ts` 的 `isIpv4` 出口与既有调用方一字不改。
 */
export { isIpv4 };

/** 端口作用域：缺省 **loopback**（REQ-2.1） */
export function resolveScope(scopes: Readonly<Record<string, Scope>> | undefined, port: number): Scope {
  return scopes?.[String(port)] ?? 'loopback';
}

/** 从既有规则推断当前作用域（`0.0.0.0` ⇒ lan）；没有规则时是 loopback 缺省 */
export function scopeFromRules(rules: readonly PortproxyRule[]): Scope {
  return rules.some((rule) => rule.listenAddress === listenAddressForScope('lan')) ? 'lan' : 'loopback';
}

function block(
  reason: WriteBlockReason,
  port: number,
  message: string,
  hint: string,
  conflictRules: readonly PortproxyRule[] = [],
): WriteBlock {
  return { ok: false, reason, port, message, hint, steps: [], conflictRules };
}

/** `netsh interface portproxy add v4tov4 …`（**必带 listenport**，design §2 红线） */
export function portproxyAddStep(port: number, scope: Scope, eth0Ip: string): WriteStep {
  const listenAddress = listenAddressForScope(scope);
  return {
    kind: 'portproxy-add',
    port,
    params: {
      listenport: port,
      listenaddress: listenAddress,
      connectport: port,
      connectaddress: eth0Ip,
    },
    commandText:
      `netsh interface portproxy add v4tov4 listenport=${String(port)} listenaddress=${listenAddress}` +
      ` connectport=${String(port)} connectaddress=${eth0Ip}`,
  };
}

/**
 * `netsh interface portproxy delete v4tov4 listenport=<p> listenaddress=<addr>`。
 * **精确四元组**：`listenaddress` 取自被匹配到的**那条规则本身**（不是用户文本、不是通配），
 * 且永远带 `listenport` —— 没有 `reset` 这种「按端口/全表清空」的形态。
 */
export function portproxyDeleteStep(rule: PortproxyRule): WriteStep {
  return {
    kind: 'portproxy-delete',
    port: rule.listenPort,
    params: { listenport: rule.listenPort, listenaddress: rule.listenAddress },
    commandText:
      `netsh interface portproxy delete v4tov4 listenport=${String(rule.listenPort)}` +
      ` listenaddress=${rule.listenAddress}`,
  };
}

function planOf(
  input: WritePlanInput,
  steps: readonly WriteStep[],
  notes: readonly string[],
): WritePlan {
  return {
    ok: true,
    action: input.action,
    port: input.port,
    scope: input.scope,
    eth0Ip: input.eth0Ip ?? '',
    steps,
    notes,
    commandText: steps.map((step) => step.commandText).join('\n'),
  };
}

/** 端口 + 合法端口号 + 声明集合（所有动作共用的三道门） */
function commonGate(input: WritePlanInput): WriteBlock | null {
  if (!isPortNumber(input.port)) {
    return block('state-precondition', input.port, `端口不是 1..65535 的整数：${String(input.port)}`, '检查端口声明');
  }
  if (!isManagedPort(input.managedPorts, input.port)) {
    return block(
      'port-not-managed',
      input.port,
      `端口 ${String(input.port)} 不在 managedPorts 声明集合内：不进五态、不可操作、不可修复（REQ-1.1）`,
      '先在端口声明里显式声明该端口（集合外规则一律不碰）',
    );
  }
  return null;
}

/** 形态冲突 ⇒ 只报告、零动作（REQ-1.3 / design §2 的 conflict 行） */
function conflictGate(match: OwnershipMatch, input: WritePlanInput): WriteBlock | null {
  if (match.conflicts.length === 0) return null;
  const details = match.conflicts.map((detail) => detail.ownership.message).join('；');
  return block(
    'state-conflict',
    input.port,
    `端口 ${String(input.port)} 上有 ${String(match.conflicts.length)} 条形态不符的既有规则：${details}`,
    '这些规则既非本插件形态、也无法证明是本插件写入的 ⇒ 不修改、不删除，请用户手工处理（REQ-1.3）',
    match.conflicts.map((detail) => detail.rule),
  );
}

function matchOf(input: WritePlanInput): OwnershipMatch {
  return matchOwnership({
    port: input.port,
    rules: input.rules,
    managedPorts: input.managedPorts,
    expectedConnectAddress: input.eth0Ip,
  });
}

/** `add`：只用于 `missing`；`lan` 追加单端口放行（REQ-2.3） */
function planAdd(input: WritePlanInput, match: OwnershipMatch): WritePlanOutcome {
  if (input.portState === 'conflict') {
    return block('state-conflict', input.port, '五态为 conflict：本插件不改动也不删除该端口的规则（REQ-1.3）', '手工处理冲突规则后再操作');
  }
  const existing = match.owned.length + match.notOwned.length + match.conflicts.length;
  if (existing > 0) {
    return block(
      'state-precondition',
      input.port,
      `端口 ${String(input.port)} 已有 ${String(existing)} 条既有规则：add 只用于 missing 态`,
      '规则已存在时请用 fix（漂移）或 switch-scope（换作用域），不要叠加第二条规则',
    );
  }
  if (input.eth0Ip === null) {
    return block('eth0-unknown', input.port, '取不到当前 eth0 ⇒ 目标地址不可判定，不生成任何动作（003 REQ-6.4）', '点「启动并核验」重试');
  }
  if (!isIpv4(input.eth0Ip)) {
    return block('eth0-unknown', input.port, `eth0 不是合法 IPv4：${input.eth0Ip}`, '核对 003 的 eth0 来源，不猜地址');
  }

  const localhostForwarding = input.localhostForwarding ?? true;
  const explanation = explainScope(input.scope, input.localhostForwarding ?? null);
  const notes = [explanation.message, ...(explanation.warn ? [explanation.detail] : [])];

  // REQ-2.2：loopback 且 WSL 自带转发开着 ⇒ 显示「无需规则」并**不添加**任何规则
  if (!needsExplicitRule(input.scope, localhostForwarding)) {
    return planOf(input, [], notes);
  }

  if (input.scope === 'lan' && firewallNameExists(input.port, input.existingFirewallNames ?? [])) {
    return block(
      'firewall-rule-exists',
      input.port,
      `防火墙规则 ${firewallRuleName(input.port)} 已存在：报错，不覆盖（REQ-2.6）`,
      '先确认那条规则是不是本插件建的（本插件清理清单里能查到），手工删除后再试',
    );
  }

  const steps: WriteStep[] = [portproxyAddStep(input.port, input.scope, input.eth0Ip)];
  if (input.scope === 'lan') steps.push(buildFirewallAddStep(input.port));
  return planOf(input, steps, notes);
}

/** 删除序列：portproxy 精确删除（+ 本插件防火墙规则） */
function removalSteps(
  input: WritePlanInput,
  rule: PortproxyRule,
  fromScope: Scope,
): WriteStep[] {
  const steps: WriteStep[] = [portproxyDeleteStep(rule)];
  const names = input.existingFirewallNames;
  const shouldRemoveFirewall =
    names === undefined ? fromScope === 'lan' : firewallNameExists(input.port, names);
  if (shouldRemoveFirewall) steps.push(buildFirewallDeleteStep(input.port));
  return steps;
}

/** `remove`：REQ-1.2 的**字面**前置（`connectAddress == 期望值`） */
function planRemove(input: WritePlanInput, match: OwnershipMatch): WritePlanOutcome {
  const owned = match.owned[0];
  if (owned === undefined) {
    const reasons = match.notOwned.map((detail) => detail.ownership.message).join('；');
    return block(
      'rule-not-owned',
      input.port,
      `端口 ${String(input.port)} 上没有满足 REQ-1.2 前置的规则${reasons.length > 0 ? `：${reasons}` : '（没有任何规则）'}`,
      '删除前置 = listenPort ∈ managedPorts 且 connectAddress == 期望值（当前 eth0）；无法证明归属的规则一律不删（REQ-1.2）',
    );
  }
  // ⚠️ 作用域**沿用既有规则**（2026-10-16 收口遗留 ⑬，与 `fix` 的裁定 (a) 同一先例）：`plan.scope` 决定
  // 脚本删哪个 listen address（`elevate/script.ts`：lan ⇒ `0.0.0.0`，否则 `127.0.0.1`）。留 `input.scope`
  // 会让脚本去删**另一个**地址（真机上是「删不掉 + 防火墙放行留着」）。**所有权判据仍按 REQ-1.2 字面**
  // （`owned` 只来自 `isDeletableRule`）⇒ 作用域跟规则走**不构成**放宽删除；逐条读数见 005 遗留 ⑬。
  const scope = scopeFromRules([owned]);
  return planOf({ ...input, scope }, removalSteps(input, owned, scope), [
    '按 REQ-1.2 精确删除一条规则（listenport + listenaddress），并在同一步里只删本插件建的防火墙规则',
    `作用域沿用既有规则（${scope}）：删的是那条规则**自己的** listen address，不受上方「作用域」选择影响`,
  ]);
}

/** `fix`：先 delete 再 add（design §2 第三行）。目标 = `owned`，或裁定 (a) 放行的漂移规则（见文件头） */
function planFix(input: WritePlanInput, match: OwnershipMatch): WritePlanOutcome {
  if (input.portState !== undefined && input.portState !== 'drift') {
    return block(
      'state-precondition',
      input.port,
      `五态为 ${input.portState}，不是 drift：fix 只用于地址漂移`,
      'missing 用 add；已 ok 无需操作；conflict 请手工处理',
    );
  }
  if (input.eth0Ip === null) {
    return block('eth0-unknown', input.port, '取不到当前 eth0 ⇒ 无法判定新地址，不生成任何动作', '点「启动并核验」重试');
  }
  const owned = match.owned[0];
  const target = owned ?? fixableDriftRule(match, input.eth0Ip);
  if (target === undefined) {
    const reasons = match.notOwned.map((detail) => detail.ownership.message).join('；');
    return block(
      'rule-not-owned',
      input.port,
      `drift 规则不满足可修复前置${reasons.length > 0 ? `：${reasons}` : ''}`,
      '可修复前置（2026-10-16 裁定 (a)）= listenPort ∈ managedPorts + listenAddress ∈ {127.0.0.1, 0.0.0.0} + connectAddress 是合法 IPv4 且 ≠ 当前 eth0；其余形态（如 connectAddress 不是 IPv4）不修改，请手工处理',
    );
  }
  // ⚠️ 作用域**沿用既有规则**，不用 `input.scope`（= 用户配置的 scopes，缺省 loopback）：drift 的 lan
  // 规则若按 `input.scope` 重建会被**悄悄降级成 loopback**（2026-10-16 发现）—— `fix` 只改地址，换
  // 作用域是 `switch-scope` 的显式动作（REQ-2.4）。脚本按 `plan.scope` 决定 listen 地址
  // （`elevate/runner.ts:scriptCallFor`，不看步骤表）⇒ 这里必须给对，否则真机会去删另一个地址。
  const scope = scopeFromRules([target]);
  const notes = ['先精确删除旧地址的规则，再按新地址重建（两条都带 listenport）'];
  if (owned === undefined) {
    notes.push('口径（2026-10-16 裁定 (a)）：声明集合内、listenAddress 为本插件形态、connectAddress 是合法 IPv4 且 ≠ 当前 eth0 ⇒ 视为本插件历史写入 ⇒ 允许修复；作用域沿用既有规则（只改地址）');
  }
  // ⑫（2026-10-16 收口）：lan 下的放行**幂等**了（先清本组同名再建），但步骤清单仍不含该条（脚本按
  // 「动作 + 作用域」派发）⇒ 必须说清，否则「共 2 条」会被读成「防火墙完全不动」。
  if (scope === 'lan') {
    notes.push('脚本会在 lan 下放行该端口入站 TCP（2026-10-16 收口 ⑫ 后已幂等：先只清**本插件的**同名规则再建 ⇒ 同名终态恒为一条、净增 0；非本组的同名规则一条都不动）—— 脚本固有行为，步骤清单不含该条');
  }
  return planOf(
    { ...input, scope },
    [portproxyDeleteStep(target), portproxyAddStep(input.port, scope, input.eth0Ip)],
    notes,
  );
}

/** `switch-scope`：逐端口显式切换（REQ-2.4） */
function planSwitchScope(input: WritePlanInput, match: OwnershipMatch): WritePlanOutcome {
  const from = input.fromScope ?? scopeFromRules(input.rules);
  if (from === input.scope) {
    return block(
      'state-precondition',
      input.port,
      `端口 ${String(input.port)} 已经是 ${from} 作用域：无需切换（本插件不做隐式批量切换）`,
      '切作用域是逐端口显式操作（REQ-2.4）；要改别的端口请单独发起',
    );
  }

  if (input.scope === 'lan') {
    if (input.eth0Ip === null || !isIpv4(input.eth0Ip)) {
      return block('eth0-unknown', input.port, '取不到合法的 eth0 ⇒ 目标地址不可判定，不生成任何动作', '点「启动并核验」重试');
    }
    if (firewallNameExists(input.port, input.existingFirewallNames ?? [])) {
      return block(
        'firewall-rule-exists',
        input.port,
        `防火墙规则 ${firewallRuleName(input.port)} 已存在：报错，不覆盖（REQ-2.6）`,
        '手工删除本插件建的那条规则后再切到 lan',
      );
    }
    // 无法证明归属的同端口规则 ⇒ 不受理：切换动作里包含「清掉同端口另一 listen address 的残留」
    // （见 `elevate/script.ts` 的 Add-Portproxy），那条残留必须是本插件写的
    if (match.notOwned.length > 0) {
      const reasons = match.notOwned.map((detail) => detail.ownership.message).join('；');
      return block(
        'rule-not-owned',
        input.port,
        `端口 ${String(input.port)} 上有无法证明归属的规则：${reasons}`,
        '切换动作会清理同端口另一作用域的残留规则，无法证明它是本插件写的就不动（REQ-1.2 口径）',
      );
    }
    // T1.3 的顺序要求：切到 lan = **portproxy add + 防火墙 add**（两步，不夹带别的动作）
    return planOf(
      input,
      [portproxyAddStep(input.port, 'lan', input.eth0Ip), buildFirewallAddStep(input.port)],
      [
        `逐端口显式切到 lan：只影响 ${String(input.port)}（REQ-2.4，无隐式批量）`,
        `提权脚本在 add 前会清掉同端口另一 listen address 的残留规则（只可能是本插件写的 127.0.0.1/0.0.0.0），保证该端口最终只有一条规则`,
        explainScope('lan', input.localhostForwarding ?? null).message,
      ],
    );
  }

  const lanRules = match.owned.filter((rule) => rule.listenAddress === listenAddressForScope('lan'));
  if (lanRules.length === 0) {
    if (match.notOwned.length > 0) {
      const reasons = match.notOwned.map((detail) => detail.ownership.message).join('；');
      return block('rule-not-owned', input.port, `没有满足 REQ-1.2 前置的 lan 规则可删：${reasons}`, '无法证明归属的规则一律不删');
    }
    return block(
      'state-precondition',
      input.port,
      `端口 ${String(input.port)} 当前没有本插件的 0.0.0.0 规则：无需切回 loopback`,
      '规则已不存在，直接刷新状态即可',
    );
  }
  const steps: WriteStep[] = lanRules.map((rule) => portproxyDeleteStep(rule));
  const names = input.existingFirewallNames;
  const shouldRemoveFirewall = names === undefined ? true : firewallNameExists(input.port, names);
  if (shouldRemoveFirewall) steps.push(buildFirewallDeleteStep(input.port));
  return planOf(input, steps, [
    `逐端口切回 loopback：删除该端口的 portproxy 与本插件建的防火墙规则（只删自己那条，REQ-2.4）`,
    explainScope('loopback', input.localhostForwarding ?? null).message,
  ]);
}

/** 唯一的规划入口（纯函数：同一个输入永远给出同一个步骤序列） */
export function buildWritePlan(input: WritePlanInput): WritePlanOutcome {
  const gate = commonGate(input);
  if (gate !== null) return gate;

  const match = matchOf(input);
  const conflict = conflictGate(match, input);
  if (conflict !== null) return conflict;

  switch (input.action) {
    case 'add':
      return planAdd(input, match);
    case 'remove':
      return planRemove(input, match);
    case 'fix':
      return planFix(input, match);
    case 'switch-scope':
      return planSwitchScope(input, match);
  }
}

/** 规划里出现的端口集合（断言「只动本端口」用；单端口动作必然只有一个元素） */
export function plannedPorts(outcome: WritePlanOutcome): number[] {
  return [...new Set(outcome.steps.map((step) => step.port))];
}

/** 声明集合的成员判定转发（测试/UI 复用，避免各处再 import 一次 diff 层） */
export function isDeclaredPort(managedPorts: ManagedPorts, port: number): boolean {
  return isManagedPort(managedPorts, port);
}

/** 五态里**本插件允许产生写动作**的那些（其余一律零动作） */
export function isWritableState(state: PortState): boolean {
  return state === 'missing' || state === 'drift' || state === 'extra';
}
