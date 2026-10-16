/**
 * 防火墙参数生成（005 T1.2 / REQ-2.3 / REQ-2.6 / design §3）
 *
 * ## 原脚本坑 #2 的正面消解
 *
 * 原脚本用 `0.0.0.0` 监听 **+ 防火墙全量放行**，把 19 个端口（含 `5432` / `6379` / `5000-5003`）
 * 暴露给局域网。这里**只放行该端口**：`-LocalPort <port>` 永远是具体数字，
 * 不存在 `Any` / 区间 / 通配（T1.2 要求「断言无通配端口、无全量放行」）。
 *
 * ## 命名与分组
 *
 * `dsh-wsl-docker-ports-<port>`（REQ-2.6 可识别名称）+ `-Group dsh-wsl-docker-ports`（便于
 * REQ-5 的手工清理清单按组枚举）。**同名已存在 → 报错不覆盖**（REQ-2.6）——
 * 判定与拒绝在 `plan.ts` 里做成「拦下 + 零步骤」，本文件只提供名字与冲突查询。
 *
 * ## 只删自己建的
 *
 * 删除按 **本插件组 + 本插件命名的 DisplayName**：
 * `Get-NetFirewallRule -Group <group> | Where-Object { $_.DisplayName -eq <name> } | Remove-NetFirewallRule`
 * —— 绝不按端口扫、绝不按组全删。
 * **【2026-10-16 收口遗留 ⑯】** 原口径只带 `-DisplayName`（删**所有组**的同名规则）⇒ 与本轮 ⑫ 给
 * `elevate/script.ts` 新写的「只清**本组**」不对称。现两处同形，且**人类可复制的清理清单**
 * （`write/cleanup.ts:76` 直接取本步骤的 `commandText`）随之同步 —— 否则清单上的命令会比插件多删。
 */

import type { WriteStep } from './types.ts';

/** 规则名前缀 / 分组名（REQ-2.6；两处都靠它可识别） */
export const FIREWALL_NAME_PREFIX = 'dsh-wsl-docker-ports';
export const FIREWALL_GROUP = 'dsh-wsl-docker-ports';

/** 端口是否是可放行的合法端口（1..65535 的整数；非整数/越界一律拒） */
export function isPortNumber(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** `dsh-wsl-docker-ports-<port>`（REQ-2.6） */
export function firewallRuleName(port: number): string {
  return `${FIREWALL_NAME_PREFIX}-${String(port)}`;
}

/** 防火墙步骤的结构化参数（提权脚本模板只吃这些字段） */
export interface FirewallArgs {
  readonly displayName: string;
  readonly direction: 'Inbound';
  readonly action: 'Allow';
  readonly protocol: 'TCP';
  readonly localPort: number;
  readonly profile: 'Any';
  readonly group: string;
}

/**
 * 放行参数：**唯一**的构造入口。注意 `localPort` 是 `number`（不是字符串）——
 * 类型层就排除了 `Any` / `5000-5003` 这类东西被塞进来。
 */
export function firewallAllowArgs(port: number): FirewallArgs {
  if (!isPortNumber(port)) throw new RangeError(`端口必须是 1..65535 的整数（收到 ${String(port)}）`);
  return {
    displayName: firewallRuleName(port),
    direction: 'Inbound',
    action: 'Allow',
    protocol: 'TCP',
    localPort: port,
    profile: 'Any',
    group: FIREWALL_GROUP,
  };
}

/** 渲染成给人看的命令原文（`ask` 展示用；README/验收也照这份核对） */
export function firewallAllowCommandText(args: FirewallArgs): string {
  return [
    'New-NetFirewallRule',
    `-DisplayName "${args.displayName}"`,
    `-Direction ${args.direction}`,
    `-Action ${args.action}`,
    `-Protocol ${args.protocol}`,
    `-LocalPort ${String(args.localPort)}`,
    `-Profile ${args.profile}`,
    `-Group "${args.group}"`,
  ].join(' ');
}

/** `lan` 的单端口放行步骤（REQ-2.3） */
export function buildFirewallAddStep(port: number): WriteStep {
  const args = firewallAllowArgs(port);
  return {
    kind: 'firewall-add',
    port,
    params: {
      displayName: args.displayName,
      direction: args.direction,
      action: args.action,
      protocol: args.protocol,
      localPort: args.localPort,
      profile: args.profile,
      group: args.group,
    },
    commandText: firewallAllowCommandText(args),
  };
}

/**
 * 删除本插件建的防火墙规则（**本组 + 本名**，REQ-2.4 / design §3；⑯ 2026-10-16）
 *
 * ⚠️ 为什么是管道而不是 `-DisplayName … -Group …`：PowerShell 的 NetFirewallRule cmdlet 里
 * `-DisplayName`（ByDisplayName）与 `-Group`（ByQuery）**互斥**，同时给会抛
 * *Parameter set cannot be resolved using the specified named parameters*（2026-10-16 真机实测，
 * 提权脚本里那版写法当场把 `firewall-delete` 打成失败）；只给 `-Group` 则是「删整组」= 红线。
 * ⇒ 唯一正确的形态是「先按组取 → 按名筛 → 删」，**提权脚本 `Remove-Firewall` 与这份给人复制的
 * 命令原文逐字同形**（否则清理清单会比插件多删：删掉非本组的同名规则 = 碰了别人的对象）。
 */
export function buildFirewallDeleteStep(port: number): WriteStep {
  if (!isPortNumber(port)) throw new RangeError(`端口必须是 1..65535 的整数（收到 ${String(port)}）`);
  const displayName = firewallRuleName(port);
  return {
    kind: 'firewall-delete',
    port,
    params: { displayName },
    commandText: `Get-NetFirewallRule -Group "${FIREWALL_GROUP}" | Where-Object { $_.DisplayName -eq "${displayName}" } | Remove-NetFirewallRule`,
  };
}

/** 同名已存在？（REQ-2.6：报错，不覆盖）大小写不敏感 —— Windows 的规则名比较如此 */
export function firewallNameExists(port: number, existingNames: readonly string[]): boolean {
  const target = firewallRuleName(port).toLowerCase();
  return existingNames.some((name) => name.trim().toLowerCase() === target);
}

/**
 * 生成文本里是否出现了「通配端口 / 全量放行」的迹象。
 * 供测试断言用（T1.2 的「无通配端口、无全量放行」要能被机器判，而不是靠读代码相信）。
 */
export function looksLikeWildcardAllow(text: string): boolean {
  return /-LocalPort\s+(?:"?\*"?|Any|any|0-65535|\d+-\d+)/.test(text);
}
