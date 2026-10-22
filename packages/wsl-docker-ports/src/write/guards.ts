/**
 * 写路径的**拦下判据与拦下对象**（005 REQ-1.2 / 1.3 + 012 决策 3）
 *
 * ## 为什么单独一个文件（2026-10-22，012）
 *
 * `write/plan.ts` 涨到 440 行（>400 SHALL）。而它**不能**把 `portproxy add/delete` 的拼装搬走 ——
 * `tests/unit/redline-guards.test.ts` 红线④把「出现写动作字面量的文件」钉成白名单
 * `{src/elevate/script.ts, src/write/plan.ts}`。故搬走的是**与 netsh 拼装无关**的那部分：
 * 拦下对象的构造（`block`）、三道共用门（端口/声明/形态冲突）、归属匹配、以及 012 的
 * 「网段推导 + 地址非法即拦下」。它们的共同点是**只判不做**：这里没有任何一条命令会被拼出来。
 *
 * ## 一条口径只写一次
 *
 * `block()` 是**唯一**的拦下构造点（`steps: []` 恒空 —— 拦下时「一个动作都不产生」是类型层的
 * 事实，见 `types.ts` 里 `WriteBlock.steps` 的元组声明）。
 */

import { isManagedPort } from '../diff/managed-ports.ts';
import type { Scope } from '../diff/types.ts';
import type { PortproxyRule } from '../read/netsh.ts';

import { cidrFor, isPortNumber } from './firewall.ts';
import { matchOwnership, type OwnershipMatch } from './ownership.ts';
import type { WriteBlock, WriteBlockReason, WritePlanInput } from './types.ts';

/** 拦下（恒零步骤）；**唯一**构造点 */
export function block(
  reason: WriteBlockReason,
  port: number,
  message: string,
  hint: string,
  conflictRules: readonly PortproxyRule[] = [],
): WriteBlock {
  return { ok: false, reason, port, message, hint, steps: [], conflictRules };
}

/**
 * 012 决策 3：`lan` + 选中具体 IP ⇒ 防火墙 `RemoteAddress` = 该 IP 所在网段。
 *
 * - `null` = 不该带 `RemoteAddress`（没选具体 IP ⇒ 010 行为逐字不变）；
 * - `'invalid'` = 选中的地址/掩码算不出网段 ⇒ 调用方**必须拦下整个动作**：
 *   拿不到网段还去建规则 = 放行所有来源，正是 012 要收窄的攻击面。
 */
export function remoteAddressOf(input: WritePlanInput, scope: Scope): string | null | 'invalid' {
  if (scope !== 'lan' || input.listenAddress === undefined) return null;
  return cidrFor(input.listenAddress, input.listenAddressPrefixLength ?? 32) ?? 'invalid';
}

/** 监听地址非法 ⇒ 零动作（fail-closed；不退化成本网段全开） */
export function blockListenAddress(input: WritePlanInput): WriteBlock {
  return block(
    'listen-address-invalid',
    input.port,
    `监听地址 ${input.listenAddress ?? ''} 与掩码长度 ${String(input.listenAddressPrefixLength ?? 32)} 算不出合法网段`,
    '重新选择监听地址（候选清单来自 Windows 物理网卡 IPv4）；掩码长度必须是 0..32 的整数。算不出网段时不会放行任何来源',
  );
}

/**
 * 012 决策 3 的**第二道门**（fail-closed）：选中的地址必须**在候选清单里**。
 *
 * 为什么必须有这一道：`cidrFor` 只能证明「字符串是合法 IPv4」，证明不了「它属于本机物理网卡」。
 * 一个合法但**不属于本机**的地址（或属于被过滤的虚拟网段，如 WSL 的 `172.20.201.152`）写进
 * `listenaddress` 会得到一条永远接不到流量的规则，而上游防火墙却按它的 /24 放行 —— 用户以为
 * 收窄了攻击面，实际只是把入口换了个不存在的门牌。故：**清单缺席 = 空集 = 全部拦下**（漏传
 * 参数的方向是「什么都不做」，不是「随便写」）。
 *
 * 只在 `lan` 上生效：`loopback` 恒 `127.0.0.1`（作用域说了算，010 的既有口径）。
 */
export function listenAddressGate(input: WritePlanInput, scope: Scope): WriteBlock | null {
  if (scope !== 'lan' || input.listenAddress === undefined) return null;
  const allowed = input.allowedListenAddresses ?? [];
  if (allowed.includes(input.listenAddress)) return null;
  // 先分清「地址/掩码本身就非法」与「合法但不属于本机」：两者都拦下，但文案必须能区分 ——
  // 前者用户改掩码/重选，后者用户只能在候选里挑（回退 `0.0.0.0` 这条路永不提供）。
  if (cidrFor(input.listenAddress, input.listenAddressPrefixLength ?? 32) === null) return blockListenAddress(input);
  const list =
    allowed.length === 0
      ? '候选清单为空（服务端没能枚举出本机物理网卡 IPv4）'
      : `候选清单只有 ${allowed.join(' / ')}`;
  return block(
    'listen-address-invalid',
    input.port,
    `监听地址 ${input.listenAddress} 不在本机候选清单里（${list}）：不写任何规则`,
    '它也许是合法 IPv4，但不是这台机器的物理网卡地址（WSL/Hyper-V/loopback 网段按决策 1 已排除）⇒ 请重新选择。算不出归属时不会放行任何来源',
  );
}

/** 端口 + 合法端口号 + 声明集合（所有动作共用的三道门） */
export function commonGate(input: WritePlanInput): WriteBlock | null {
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
export function conflictGate(match: OwnershipMatch, input: WritePlanInput): WriteBlock | null {
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

/** 归属匹配（`matchOwnership` 的唯一调用点；入参顺序在这里固定） */
export function matchOf(input: WritePlanInput): OwnershipMatch {
  return matchOwnership({
    port: input.port,
    rules: input.rules,
    managedPorts: input.managedPorts,
    expectedConnectAddress: input.eth0Ip,
  });
}
