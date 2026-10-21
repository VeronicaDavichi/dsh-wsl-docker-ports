/**
 * 本插件用到的**宿主面类型**（003 T6.7 的类型面；2026-10-12 009 收口轮 T5 从 `plugin.ts` 拆出）
 *
 * ## 为什么单独一个文件
 *
 * `plugin.ts` 撞上了 **单文件 ≤ 400 行 SHALL**（拆前 `split('\n')` 口径**正好 400/400**、零余量）。
 * 拆法按「**类型面 vs 装配面**」切，不是按行数硬剁：这里的 7 个声明全是**编译期擦除**的东西
 * （零运行时代码、零副作用），装配逻辑（`applyWslDockerPorts`）留在 `plugin.ts`。
 * 拆完两边都是**真模块边界**：`host-face.ts` 只 import 类型，谁 import 它都不会拉起执行器。
 *
 * ## 导出预算不受影响
 *
 * 按 AGENTS.md「导出预算只计运行时导出」：本文件**一个运行时导出都没有**（7 个全是
 * `interface` / `type`）⇒ 不占「≤ 12 导出」预算；`src/index.ts` 的公开面**一行未改**，
 * 它的 `export type { … } from './plugin.ts'` 由 `plugin.ts` 的再导出接住（下面的 `export type` 行）。
 *
 * ## 与 `route.ts` 的 `RoutePluginContextLike` 的关系
 *
 * 两者是**故意分开**的窄接口：这里描述「插件入口拿到的 ctx」，`route.ts` 描述「注册路由用得到的
 * ctx 子集」。`plugin.ts` 把本文件的对象**继续传给** `registerPortsRoute`（结构兼容）⇒ 谁都不需要
 * 假装知道对方那一半。
 */

import type { DistroResolution, Eth0Outcome, Executor, WslDistro, WslSharedError } from 'dsh-wsl-shared';
import type { DiffInput, DiffOutcome } from './diff/types.ts';
import type { ElevationAvailability } from './elevate/backend.ts';
import type { BackendChoice } from './elevate/types.ts';
import type { DockerPsOutcome } from './read/docker-probe.ts';
import type { Eth0SourceOptions } from './read/eth0-source.ts';
import type { LocalhostForwardingDeps, LocalhostForwardingOutcome } from './read/localhost-forwarding.ts';
import type { NetshProbeOptions, PortproxyOutcome } from './read/netsh-probe.ts';
import type { PortsRouteRegistration } from './route.ts';
import type { SnapshotBuilder, SnapshotDeps } from './snapshot.ts';
import type { PlanFacts } from './transport/plan.ts';
import type { WriteRouteRegistration } from './transport/routes.ts';
import type { ContainerRouteRegistration } from './docker/route.ts';

/** 一条「降级原因」（不静默：装载后可直接读出来定位，口径同 002 的 `PluginGap`） */
export interface PluginGap {
  readonly what: string;
  readonly reason: string;
}

/**
 * 本插件用到的宿主上下文面（窄接口，只列真用到的成员）。
 *
 * `get` / `provide` / `inject` / `effect` 都写成**可选**：测试与降级路径都要能在没有它们的 ctx 上跑完，
 * 而「宿主没有 `provide`」应当是一个**可见的 gap**，不是一个 `TypeError`。
 *
 * 🔴 `inject` 是**缺陷 A 的修法入口**：`ctx.inject(['webServer'], cb)` 的回调在服务可用时才跑
 * （已在 ⇒ 同步跑；后到 ⇒ 后到就跑），这就是「宿主可用时机」。有它就不该再用同步 `ctx.get` 定生死。
 */
export interface PluginContextLike {
  readonly get?: (serviceName: string) => unknown;
  readonly provide?: (serviceName: string, value: unknown) => unknown;
  readonly inject?: ((names: readonly string[], callback: (scope: PluginContextLike) => void) => unknown) | undefined;
  readonly effect?: (callback: () => (() => void) | void, label?: string) => unknown;
}

/** 注入点（**测试与集成方**用；生产用缺省值） */
export interface PortsHostDeps {
  /** 外部命令执行器（001）；缺省 `createExecutor()`（真进程，**只在快照被请求时才跑**） */
  readonly executor?: Executor | undefined;
  /** 透传 `readLocalhostForwarding` 的注入面（测试用；生产留空即走默认路径解析） */
  readonly localhostForwarding?: LocalhostForwardingDeps | undefined;
  /** 覆盖 nat 门的数据源（默认 001 的 `readNetworkingMode()` 真读 `.wslconfig`） */
  readonly readNetworkingMode?: SnapshotDeps['readNetworkingMode'];
  /** 透传探针选项（超时等） */
  readonly netsh?: NetshProbeOptions | undefined;
  readonly docker?: { readonly attempts?: number; readonly timeoutMs?: number } | undefined;
  readonly eth0?: Eth0SourceOptions | undefined;
  /** 固定时间戳（测试）；默认 `Date.now` */
  readonly now?: (() => number) | undefined;
  /** 提权可用性探测（005 的只读后端探测）；缺省 = **真探测**（缓存 + 单飞，见 `applyWslDockerPorts` 内的说明） */
  readonly probeElevationAvailable?: (() => Promise<boolean>) | undefined;
  /** 覆盖**后端探测本身**（测试用；缺省 = 005 的 `detectBackend` 真跑 `where.exe gsudo` + `gsudo status`） */
  readonly probeBackend?: (() => Promise<BackendChoice>) | undefined;
  /** 整体替换装配器（集成方/测试；缺省用 `createSnapshotBuilder(…)`） */
  readonly snapshotBuilder?: SnapshotBuilder | undefined;
  /** 写通道现读事实（008；缺省 = 保守降级面：零 IO、eth0 未知 ⇒ 计划恒被拦下） */
  readonly writeFacts?: PlanFacts | undefined;
}

/** 目标发行版（解析结果 + 全量列表；每个探针都要它，故只解析一次） */
export type TargetDistro = { readonly ok: true; readonly resolved: DistroResolution; readonly distros: readonly WslDistro[] } | WslSharedError;

/**
 * 宿主侧只读服务面：**6 个方法，全部是已有部件的一对一委派**。
 *
 * 📌 为什么方法这么「碎」而不是一个 `load(): PortsSnapshot`：把探针结果拼成客户端快照是
 * **Phase 4** 的活儿（`PortsSnapshot` 是客户端类型）。这里只导出现成能力 ⇒ 不越界、也不造假。
 */
export interface PortsHostService {
  /** 服务名（= `PORTS_SERVICE`），便于消费方断言拿到的是哪个服务 */
  readonly serviceName: string;
  /** 解析目标发行版（001 的四级优先级）；**只读**，不冷启动 */
  resolveTarget(): Promise<TargetDistro>;
  /** `docker ps` 只读探测（超时 + 重试；被唤醒后第一次空输出不当「没有容器」） */
  readContainers(): Promise<DockerPsOutcome | WslSharedError>;
  /** `netsh ... show v4tov4` 只读探测 */
  readRules(): Promise<PortproxyOutcome>;
  /** 只读 `.wslconfig` 的 `localhostForwarding` */
  readLocalhostForwarding(): Promise<LocalhostForwardingOutcome>;
  /** 现读 WSL eth0（不吃缓存；`allowColdStart` 只允许「启动并核验」传 true） */
  probeEth0(allowColdStart?: boolean): Promise<Eth0Outcome | WslSharedError>;
  /** 五态判决：**纯函数**（零进程、零 IO），对拍 003 Phase 2 的引擎 */
  classify(input: DiffInput): DiffOutcome;
}

/** `apply` 的返回值（**宿主会忽略它**；给测试与集成方一个可读的装载结果） */
export interface WslDockerPortsPluginHandle {
  /** 已导出的只读服务面（宿主没有 `provide` 时仍会构造，只是没导出） */
  readonly service: PortsHostService;
  /** T6.8 的快照装配器（路由的处理器就是调它；也可被集成方直接复用） */
  readonly snapshotBuilder: SnapshotBuilder;
  /** T6.8 的快照路由注册结果（`registered:false` ⇒ 看 `state`：`pending` = 等服务，`missing` = 确实缺） */
  readonly route: PortsRouteRegistration;
  /** 008 写通道路由注册结果（pending 不是失败，与 route 同理） */
  readonly writeRoute: WriteRouteRegistration;
  /** 010 容器动作路由注册结果（`pending` 不是失败；与 `route` / `writeRoute` 各占一个前缀） */
  readonly containerRoute: ContainerRouteRegistration;
  /**
   * 本次装载的降级原因（空数组 = 一切齐备）。
   * ⚠️ **活视图**：`webServer` 那条按 `route` 的当前状态现算 —— 惰性注入的回调后到并注册成功后，
   * 再读 `gaps` 就不会有这一条（`pending` 与 `missing` 的文案不同，见 `webServerGap`）。
   */
  readonly gaps: readonly PluginGap[];
  /**
   * 提权可用性的**最近一次探测结果**（懒探测：还没请求过快照时为 `null`）。
   * 给集成方一条命令读出「判定成哪个后端 + 依据」——真机复验用（`elevationAvailable` 在快照里只是布尔）。
   */
  readonly elevationAvailability: () => ElevationAvailability | null;
  /** `ctx.provide` 是否真的调用成功 */
  readonly provided: boolean;
  effectCount(): number;
  dispose(): void;
}

/**
 * 插件配置（`distro` = 目标发行版，留空按 001 的四级优先级解析；`elevationPolicy` = `none`/`ask`/`passby`，
 * 🔴 缺省/认不出 ⇒ 事实面 `'unknown'` ⇒ 执行层按 SSoT 默认落到 `none`（不写），见 `transport/apply.ts` 文件头）。
 *
 * 🔴 字段类型是 `unknown` 而**不是** `string`：`Config` 标了 volatile ⇒ 宿主交给 `apply` 的是**活体包装**而不是字符串；单测/集成方手工传参会给平凡值。两类都收，读法统一在 `./config-read.ts`。
 */
export interface PortsPluginConfigLike {
  readonly distro?: unknown;
  readonly elevationPolicy?: unknown;
  /** 写通道凭据（008 T2.9）；🔴 缺省/空白 ⇒ 写通道**一律 401**（fail-safe，plan 也一样），见 `transport/write-auth.ts` */
  readonly writeToken?: unknown;
}
