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
 */

import type { ElevationPolicy } from '../elevate/types.ts';
import { readConfigValue } from '../config-read.ts';
import type { ConfigValueSource } from '../config-read.ts';
import type { PortproxyRule } from '../read/netsh.ts';
import type { LocalAddressEntry } from '../read/local-addresses.ts';
import type { PlanFacts } from './plan.ts';

const POLICIES: readonly ElevationPolicy[] = ['none', 'ask', 'passby'];

/**
 * 配置档字符串是否是**可识别**的策略值（唯一一份运行期清单；`policyFor` 也用它）。
 *
 * 认不出（含 `'unknown'`、空串、别的东西）⇒ 事实面给 `'unknown'`（不假装知道用户选了什么），
 * 执行层再把它映射成**最保守**的 `'none'`。⇒ 非法配置的效果 = 不写，不是写。
 *
 * 🔴 **本函数只认字符串**（type guard 不能对包装撒谎：`value is ElevationPolicy` 会把包装缩窄成字符串）。
 * 「配置字段标了 volatile ⇒ 宿主给的是带 `.get()` 的包装」这件事由 `readElevationPolicy` 在**进本函数之前**
 * 解包（`./../config-read.ts` 的统一读法）—— 两处合起来才是「活体与平凡两种形态判决一致」。
 */
export function isElevationPolicyValue(value: unknown): value is ElevationPolicy {
  return typeof value === 'string' && (POLICIES as readonly string[]).includes(value);
}

/**
 * 从配置来源读策略：**先解包（活体包装 / 平凡值 / 零参取值函数三类都收）再判**，认不出 ⇒ `'unknown'`。
 * 每次调用现读 ⇒ volatile 写入（不重挂载）后下一次计划就能看到新档位。
 */
export function readElevationPolicy(source: ConfigValueSource): ElevationPolicy | 'unknown' {
  const value = readConfigValue(source);
  return isElevationPolicyValue(value) ? value : 'unknown';
}

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
  /**
   * 已存在的防火墙规则名（008 `read/firewall-probe.ts` 的现读）。
   *
   * 🔴 **读失败请抛**（同 `rules`）：把「读不到」当「没有规则」⇒ 005 REQ-2.6 的同名冲突门失效 ⇒
   * 重复 `apply` 会叠第二条同名规则（Windows 允许 `DisplayName` 重名），回滚又只删本轮那条。
   * 不给来源 ⇒ 该门不启用（`firewallNames === undefined`，**不是**假装空集）。
   */
  readonly firewallNames?: (() => Promise<readonly string[]>) | undefined;
  /** 当前配置的策略（`none` / `ask` / `passby`）；**留空或认不出 = `'unknown'`**（见 `isElevationPolicyValue`）。
   *  🔴 收**活体包装 / 平凡值 / 零参取值函数**（本包 `Config` 标了 volatile ⇒ 宿主给的是包装；
   *  `plugin.ts` 透传的是 `config-read.ts` 的读取函数）—— 三态判决一致，且**每次计划现读**。 */
  readonly elevationPolicy?: ConfigValueSource;
  /**
   * 012：该端口已持久化的监听地址（服务端配置现读；`plugin.ts` 透传 `config-read.ts` 的读取函数）。
   * 缺省 ⇒ 永远 `undefined` ⇒ 计划逐字同 010。
   */
  readonly listenAddresses?: ((port: number) => string | undefined) | undefined;
  /**
   * 012：候选监听地址（`read/local-addresses.ts` 的现读）。**读失败请抛** ⇒ 计划回 503
   * （把「不知道本机有哪些网卡」当成「没有网卡」会让所有具体地址都被静默拒绝，比报错更难查）。
   */
  readonly localAddresses?: (() => Promise<readonly LocalAddressEntry[]>) | undefined;
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
  const firewall = sources.firewallNames;
  // 012：先取成 `const` 再收进闭包（`sources.x` 在闭包里会丢收窄，`!` 是噪声）
  const listenSource = sources.listenAddresses;
  const candidates = sources.localAddresses;
  // 认不出的配置值 ⇒ `'unknown'`（**不**原样透传：否则非法值会一路显示到只读预览里，像真的选过一样）；
  // 🔴 在 `elevation()` **里面**现读（不在构造期拍一次）：volatile 写入是原地更新 ⇒ 现读才吃得到新档位。
  const policy = (): ElevationPolicy | 'unknown' => readElevationPolicy(sources.elevationPolicy);

  return {
    // 缺省 = 空集（design §12 方案 (a)）：没声明 ⇒ 一切都 port-not-managed，失败方向最保守
    managedPorts: (declaration) => declaration ?? [],
    eth0Ip: sources.eth0Ip,
    rules: (port) => sources.rules(port),
    ...(forward === undefined ? {} : { localhostForwarding: () => forward() ?? null }),
    // 不给来源 ⇒ 键不存在（「该门不启用」≠「空集」：假装空集等于宣称「机器上没有同名规则」）
    ...(firewall === undefined ? {} : { firewallNames: () => firewall() }),
    // 012：配置现读（不是构造期拍一次 —— 客户端选值后要立刻生效）+ 候选清单现读
    ...(listenSource === undefined ? {} : { listenAddresses: (port: number) => listenSource(port) }),
    ...(candidates === undefined ? {} : { localAddresses: () => candidates() }),
    // `elevation` 在 PlanFacts 里是**必填** ⇒ 没给来源时给「不可用」，绝不省略
    elevation: async () => {
      const current = await elevation?.();
      return { policy: policy(), backend: current?.backend ?? 'unknown', available: current?.available ?? false };
    },
  };
}
