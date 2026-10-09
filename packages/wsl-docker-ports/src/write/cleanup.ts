/**
 * 卸载清理清单（005 T3.3 / REQ-5.1 / REQ-5.2）
 *
 * ## 为什么是「清单」而不是「自动删」
 *
 * REQ-5.1 明令卸载 SHALL NOT 自动删除任何 portproxy / 防火墙规则：规则是**用户可感知的系统状态**，
 * 本机既有 19 条是原脚本的产物（含 `5432` / `6379`），删错一条就静默断掉用户的服务（A-2 已定案）。
 * 于是卸载只给清单，把「删不删」的扳机留给用户（REQ-5.4 的显式入口）。
 *
 * ## REQ-5.2 的底线：SHALL NOT 只给一句「请手工清理」
 *
 * 每个条目必须自带**具体命令**（端口 / 规则名 / 地址三项齐全）。为此本文件做两件事：
 * 1. 「谁该被清」的判定**复用 REQ-1.2 的同一份谓词**（`isDeletableRule`）——不另立一份口径，
 *    清单与写路径永远说同一句话；
 * 2. 命令文本交给写路径**既有的渲染器**（`portproxyDeleteStep` / `buildFirewallDeleteStep`）拼，
 *    于是「照着清单敲」与「插件自己执行」逐字同源。本文件里因此**没有一处手写的写命令**，
 *    T3.1 红线④的落点白名单仍然只有 `elevate/script.ts` 与 `write/plan.ts` 两个文件。
 *
 * 纯函数：不碰进程 / 文件系统 / 网络。
 */

import type { ManagedPorts } from '../diff/managed-ports.ts';
import type { PortproxyRule } from '../read/netsh.ts';
import { buildFirewallDeleteStep, firewallRuleName } from './firewall.ts';
import { isDeletableRule } from './ownership.ts';
import { portproxyDeleteStep } from './plan.ts';
import type { WriteStep } from './types.ts';

export interface CleanupItem {
  readonly port: number;
  /** `firewallRuleName(port)` —— REQ-5.2 明文要求的「规则名」 */
  readonly ruleName: string;
  /** 该转发监听的地址：**删除命令里的 `listenaddress` 取值就是它**（精确四元组，REQ-1.4） */
  readonly listenAddress: string;
  /** 归属证据：`connectAddress` == 期望 eth0（REQ-1.2），用户据此判断「这真是插件建的」 */
  readonly connectAddress: string;
  readonly portproxyCommand: string;
  readonly firewallCommand: string;
  /** 可直接复制的两行（≥ 2 行）：先断转发、再撤放行（与 T1.3 的既有次序一致） */
  readonly lines: readonly string[];
}

export interface CleanupManifest {
  readonly items: readonly CleanupItem[];
  /** 清单涉及的端口（去重升序） */
  readonly ports: readonly number[];
  /** 可直接复制粘贴的多行文本：**只含命令，不含任何说明文字**（粘进 PowerShell 就能跑） */
  readonly text: string;
  /** 给人看的说明（**不在 `text` 里**，免得用户把说明也粘进去） */
  readonly note: string;
}

export interface CleanupManifestInput {
  readonly rules: readonly PortproxyRule[];
  readonly managedPorts: ManagedPorts;
  /** 本插件该端口的期望 `connectAddress`（= 当前 eth0）；`null` ⇒ 期望不可判定 ⇒ 清单为空 */
  readonly expectedConnectAddress: string | null;
  /** 清单为空时的解释（如「读规则事实失败」）；不给则用缺省文案 */
  readonly emptyReason?: string | undefined;
}

const NO_RULE_NOTE =
  '没有本插件维护的规则（REQ-1.2 谓词无命中）：无需清理；清单命令的作用域永远只有本插件命名的规则，' +
  '既有他人规则（含原脚本遗留的 19 条）一律不出现。';

/** REQ-1.2 的准入过滤：**唯一**一处判定，`items` 与 `steps` 都从它派生 */
function ownedRules(input: CleanupManifestInput): readonly PortproxyRule[] {
  return input.rules
    .filter((rule) => isDeletableRule(input.managedPorts, rule, input.expectedConnectAddress))
    // 端口 + 监听地址双键排序：清单顺序稳定，便于人工核对与 diff
    .sort((a, b) => a.listenPort - b.listenPort || (a.listenAddress < b.listenAddress ? -1 : 1));
}

function itemOf(rule: PortproxyRule): CleanupItem {
  const portproxyCommand = portproxyDeleteStep(rule).commandText;
  const firewallCommand = buildFirewallDeleteStep(rule.listenPort).commandText;
  return {
    port: rule.listenPort,
    ruleName: firewallRuleName(rule.listenPort),
    listenAddress: rule.listenAddress,
    connectAddress: rule.connectAddress,
    portproxyCommand,
    firewallCommand,
    lines: [portproxyCommand, firewallCommand],
  };
}

/** 结构化清单 + 可复制文本（REQ-5.2） */
export function buildCleanupManifest(input: CleanupManifestInput): CleanupManifest {
  const items = ownedRules(input).map(itemOf);
  return {
    items,
    ports: [...new Set(items.map((item) => item.port))],
    text: items.map((item) => item.lines.join('\n')).join('\n'),
    note: items.length === 0 ? (input.emptyReason ?? NO_RULE_NOTE) : noteFor(items.length),
  };
}

function noteFor(count: number): string {
  return (
    `以下是**本插件维护的 ${String(count)} 条规则**的清理命令（端口 / 规则名 / 地址齐全，可直接复制）：` +
    '卸载不会自动删除它们（REQ-5.1）；命令只作用于这些端口与规则名，不含按端口扫、不含按组全删。'
  );
}

/**
 * 显式清理要执行的步骤（REQ-5.4 用）。与清单**同源**——「清单里有的才会被删」因此是可执行的
 * 事实而非口号：`connectAddress != 期望 eth0` 或 `listenPort ∉ managedPorts` 的规则一步都不产生。
 */
export function buildCleanupSteps(input: CleanupManifestInput): readonly WriteStep[] {
  const owned = ownedRules(input);
  const steps: WriteStep[] = owned.map((rule) => portproxyDeleteStep(rule));
  // 防火墙规则**按端口**（同名规则只有一条）⇒ 同端口两份规则只产生一次删除；次序与 T1.3 一致
  for (const port of [...new Set(owned.map((rule) => rule.listenPort))].sort((a, b) => a - b)) {
    steps.push(buildFirewallDeleteStep(port));
  }
  return steps;
}
