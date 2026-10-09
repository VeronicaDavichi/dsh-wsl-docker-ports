/**
 * 008 Phase 2：把 003/005 的现读件拼成 `PlanFacts`（**独立文件** ⇒ 不碰 `plugin.ts` 的 400 行额度）
 *
 * ## 本文件的真正职责：**失败语义**，不是搬运
 *
 * 「现读暂时拿不到」绝不能悄悄变成「**本机没有规则**」—— 那会让计划把「已存在的规则」当成不存在，
 * 进而提出重复/冲突的动作（REQ-2.6 的红线）。所以：
 *
 * - **读失败 ⇒ 抛**（`plan.ts` 捕获后回 `rules-unavailable` 503 ⇒ UI 显示「现在读不到，稍后重试」）
 * - **规则确实为空 ⇒ 空数组**（这是**事实**，照实往下走）
 * - **eth0 取不到 ⇒ `null`**（003 REQ-6.4：期望值不可判定 ⇒ `buildWritePlan` 拦成 `eth0-unknown`，零动作）
 * - **`localhostForwarding` 取不到 ⇒ `null`**（同上：不可判定就不猜）
 *
 * ## 逐端口过滤
 *
 * `netsh` 一次给全量规则，`buildWritePlan` 要的是**该端口**的全部规则 ⇒ 按实测字段
 * `PortproxyRule.listenPort` 过滤（`netsh.ts:17` 实测：`listenAddress` / `listenPort` / `connectAddress` /
 * `connectPort`）。**端口匹配用 `listenPort`**：所有权判据是「谁在监听这个端口」。
 *
 * ## 刻意**不**提供的东西（如实留缺口，不造假）
 *
 * - `portState`：003 的五态判决需要完整快照上下文，此处不给 ⇒ 计划只用规则事实判（`buildWritePlan` 的
 *   既有能力）。少过一道门 ⇒ **偏保守**（宁可说「需要修」也不说「已经好了」）。
 * - `firewallNames`：本包**没有**防火墙规则读取件（005 的 `existingFirewallNames` 是**入参**）⇒ 该门
 *   未启用 ⇒ 🔴 REQ-2.6 的「同名防火墙规则冲突」目前在**计划阶段**查不出来。这是**已知缺口**，已在
 *   `specs/008-write-transport/tasks.md` 留痕，不假装覆盖。
 */

import type { PortproxyRule } from '../read/netsh.ts';
import type { PlanFacts } from './plan.ts';

/** 现读来源（由 `plugin.ts` 用 003/005 既有部件绑定；本文件**不**自己造探针，也不猜签名） */
export interface PlanFactSources {
  /** 该端口的全部既有规则；**读失败请抛**（不要返回空数组假装「没有规则」） */
  readonly rules: (port: number) => Promise<readonly PortproxyRule[]>;
  /** 现读 eth0（003 REQ-6.4 的写路径唯一入口）；取不到 ⇒ `null` */
  readonly eth0Ip: () => Promise<string | null>;
  /** `.wslconfig` 的 `localhostForwarding`（**同步读缓存值**，由调用方负责读一次）；取不到 ⇒ `null`（**不要**猜 `false`） */
  readonly localhostForwarding?: (() => boolean | null | Promise<boolean | null>) | undefined;
  /** 提权可用性（005 的单飞 + 一次缓存探测）；未跑过时给 `{ available: false, backend: null }` */
  readonly elevation?: (() => { readonly available: boolean; readonly backend: string | null } | Promise<{ readonly available: boolean; readonly backend: string | null }>) | undefined;
  /** 当前配置的策略；**留空 = `'unknown'`**（不假装知道：`elevationPolicy` 是 P1 完整配置页的字段） */
  readonly elevationPolicy?: string | undefined;
}

/**
 * 造 `PlanFacts`。
 *
 * 🔴 `elevation().policy` 只反映**配置档**，**不含**按触发方的降级（Agent 触发一律 `ask`，REQ-4.5）——
 * 那一步属于**执行层**（005 的 `resolvePolicy(policy, source)`），此处不重复实现，也不越权改写。
 */
export function createPlanFacts(sources: PlanFactSources): PlanFacts {
  const forward = sources.localhostForwarding;
  const elevation = sources.elevation;
  const policy = sources.elevationPolicy ?? 'unknown';

  return {
    // 缺省 = 空集（design §12 方案 (a)）：没声明 ⇒ 一切都 port-not-managed，失败方向最保守
    managedPorts: (declaration) => declaration ?? [],
    eth0Ip: sources.eth0Ip,
    rules: (port) => sources.rules(port),
    ...(forward === undefined ? {} : { localhostForwarding: () => forward() ?? null }),
    // `elevation` 在 PlanFacts 里是**必填** ⇒ 没给来源时给「不可用」，绝不省略
    elevation: async () => {
      const current = await elevation?.();
      return { policy, backend: current?.backend ?? 'unknown', available: current?.available ?? false };
    },
  };
}
