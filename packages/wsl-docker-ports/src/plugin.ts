/**
 * 003 插件**宿主入口**（T6.7）—— 与 002 宿主半（`packages/terminal-profiles/src/plugin.ts`）同口径。
 *
 * ## 形态（照 002 逐项对齐，依据 = 本机同族已装插件的生产代码）
 *
 * - `export const name = 'dsh-wsl-docker-ports'` —— **与包名、与 `cordis.patch.yml` 的 `id` 逐字一致**
 *   （宿主按包根导出找 `name`；patch 行的 `id` 要按它引用）。
 * - `export const inject: readonly string[] = []` —— **无强依赖**。本包缺任何服务都不该「加载期不激活」：
 *   读层是只读探测、配置面走 `remote.settings`，缺了就在 `gaps` 里说清（REQ-10.3 的同一口径）。
 * - `export function apply(ctx, config?)` —— 宿主调用；**返回值被宿主忽略**，给测试/集成方留一个句柄。
 * - `export default { name, inject, apply }` —— 宿主官方三种形态之一（函数 / 对象 / `class`），
 *   两种都给以免疫宿主侧解析差异（002 也是这样）。
 * - **刻意不导出 `Config`**（与 002 的差异，理由在下面「为什么没有 Config」）。
 *
 * 🔴 **少了 `apply`，profile 里插了 patch 也不会激活** —— 宿主只会 import 到一堆普通导出。
 * 这正是本包 `exports["."]` 从 `./src/index.ts` 切到 `./lib/index.js` 的原因。
 *
 * ## 本入口**只做装配与委派**，不新造能力
 *
 * 三块，全部由**已实现且已测**的部件拼成：
 *
 * 1. `PORTS_SERVICE`（6 个方法）：`wsl-shared` 的发行版解析 / `read/*-probe.ts` 的三个只读探针 /
 *    `read/localhost-forwarding.ts` / `diff/engine.ts` 的纯判决；
 * 2. **T6.8 快照装配**（`./snapshot.ts`）：把上面这些探针 + 001 的 `.wslconfig` 读法拼成
 *    传输契约 `PortsSnapshot`，**没有新的进程调用、没有新的解析、没有新的命令文本**；
 * 3. **T6.8 快照路由**（`./route.ts`）：自建 `ctx.webServer` 独占前缀 `/dsh-wsl-docker-ports`（**不带尾斜杠**），
 *    `GET /dsh-wsl-docker-ports/snapshot` 返回 `{ok:true,snapshot}`。🔴 注册走 `ctx.inject(['webServer'], …)`
 *    （真机实测：`apply` 时刻 `ctx.get('webServer')` 是 `undefined`，服务要到 `+755ms` 才到 —— 同步取一次
 *    就下结论会让路由**永不注册且零报错**，即缺陷 A）。
 *
 * ## 为什么没有 `Config`（与 002 的**刻意**差异）
 *
 * 002 必须声明 `Config`，因为它的 `profiles` 是 `volatile` 数组（要 Schemastery 才能让 volatile 生效）。
 * 本包 P0 的四个配置项（`managedPorts` / `distro` / `elevationPolicy` / `scopes`）走**客户端 settings
 * 写回**（`remote.settings.update(ns, patch)`），宿主进程**不持有**它们的活体副本 ⇒ 没有 volatile 需求。
 * 而拿 Schemastery 只能经 `@deepseek-ai/schemastery`（本包**未声明**该依赖）⇒ 声明一个假 schema 比
 * 不声明更坏（002 文件头已记：假 schema 会让 volatile 静默失效）。故 `Config` 交给「真机 T0.5 确认
 * settings 命名空间是否需要宿主侧 schema」这一步决定，**此处不猜**（2026-10-09 集成方裁定：
 * **不许用「先加个依赖试试」解决**）。
 *
 * ## 仍然缺的那一件（不静默，写进 `gaps`）
 *
 * **提权写路径的接线**：执行器属 **005**（`runElevate` + `defaultElevationDeps` **已实现**），
 * 缺的是「带 ownership 判定的写计划装配」+「浏览器点击 → 宿主执行」的传输（本波只开了只读 GET）。
 * ⇒ 本入口**不做**假的 `ElevationInvoker`：那会让「写成功」变成谎报。如实记成 gap。
 */

import { createExecutor, listDistros, resolveDistro } from 'dsh-wsl-shared';
import type { DistroResolution, Executor, WslDistro, WslSharedError } from 'dsh-wsl-shared';
import { diff } from './diff/engine.ts';
import type { DiffInput, DiffOutcome } from './diff/types.ts';
import { createElevationAvailabilityProbe } from './elevate/backend.ts';
import type { ElevationAvailability } from './elevate/backend.ts';
import type { BackendChoice } from './elevate/types.ts';
import { probeDockerPs } from './read/docker-probe.ts';
import type { DockerPsOutcome } from './read/docker-probe.ts';
import { createEth0Source } from './read/eth0-source.ts';
import type { Eth0SourceOptions } from './read/eth0-source.ts';
import { readLocalhostForwarding } from './read/localhost-forwarding.ts';
import type { LocalhostForwardingDeps, LocalhostForwardingOutcome } from './read/localhost-forwarding.ts';
import { probePortproxyRules } from './read/netsh-probe.ts';
import type { NetshProbeOptions, PortproxyOutcome } from './read/netsh-probe.ts';
import { registerPortsRoute } from './route.ts';
import type { PlanFacts } from './transport/plan.ts';
import { attachWriteChannel, createDefaultLocalhostForwarding, createPluginFacts } from './transport/wire-plugin.ts';
import type { WriteRouteRegistration } from './transport/routes.ts';
import type { PortsRouteRegistration } from './route.ts';
import { createSnapshotBuilder } from './snapshot.ts';
import type { SnapshotBuilder, SnapshotDeps } from './snapshot.ts';
import { PORTS_SNAPSHOT_PATH } from './wire.ts';
import type { Eth0Outcome } from 'dsh-wsl-shared';

/** 插件名（供 profile 清单的 `id` 引用；**与包名逐字一致** —— 二者不一致会让 patch 行指不到东西） */
export const name = 'dsh-wsl-docker-ports';

/** 无强依赖：缺服务一律降级 + 记 gap，不拒绝加载（见文件头） */
export const inject: readonly string[] = [];

/** 宿主侧服务名（`ctx.provide` 的键；真机 T0.5 用它核对服务导出生效） */
export const PORTS_SERVICE = 'wslDockerPorts';

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
  /** 008 写通道路由注册结果（pending 不是失败，与 oute 同理） */
  readonly writeRoute: WriteRouteRegistration;
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

/** 插件配置（`distro` = 目标发行版，留空按 001 的四级优先级解析；`elevationPolicy` = `none`/`ask`/`passby`，🔴 缺省/认不出 ⇒ 事实面 `'unknown'` ⇒ 执行层按 SSoT 默认落到 `none`（不写），见 `transport/apply.ts` 文件头；清单当前**没有** `config:` 块 ⇒ 生产上是空对象） */
export interface PortsPluginConfigLike {
  readonly distro?: string | undefined;
  readonly elevationPolicy?: string | undefined;
  /** 写通道凭据（008 T2.9）；🔴 缺省/空白 ⇒ 写通道**一律 401**（fail-safe，plan 也一样），见 `transport/write-auth.ts` */
  readonly writeToken?: string | undefined;
}

/** 宿主入口（cordis 调用；返回值被忽略） */
export function apply(ctx: PluginContextLike, config?: PortsPluginConfigLike | undefined): void {
  applyWslDockerPorts(ctx, config);
}

/**
 * 真正的装配（`apply` 的实体 + 测试入口）。
 *
 * 装配顺序 = 依赖顺序：执行器 → 只读服务面 → 服务导出 → disposer 收编。
 * **全程不抛**：任何缺失都变成 `gaps` 里的一条。
 */
export function applyWslDockerPorts(
  ctx: PluginContextLike,
  config?: PortsPluginConfigLike | undefined,
  deps: PortsHostDeps = {},
): WslDockerPortsPluginHandle {
  const executor = deps.executor ?? createExecutor();
  const configured = config?.distro;

  const resolveTarget = async (): Promise<TargetDistro> => {
    const listed = await listDistros(executor);
    if (!listed.ok) return listed;
    const resolved = resolveDistro(listed.distros, configured);
    if (!resolved.ok) return resolved;
    return { ok: true, resolved, distros: listed.distros };
  };

  const service: PortsHostService = {
    serviceName: PORTS_SERVICE,

    resolveTarget,

    // ⚠️ 两个探针都要「目标发行版」⇒ 这里现解析一次，而不是各自再走一遍 `wsl -l -v`
    readContainers: async (): Promise<DockerPsOutcome | WslSharedError> => {
      const target = await resolveTarget();
      if (!target.ok) return target;
      const options = deps.docker === undefined ? {} : deps.docker;
      return probeDockerPs(executor, target.resolved.name, target.distros, options);
    },

    readRules: async (): Promise<PortproxyOutcome> =>
      probePortproxyRules(executor, deps.netsh === undefined ? {} : deps.netsh),

    readLocalhostForwarding: async (): Promise<LocalhostForwardingOutcome> =>
      readLocalhostForwarding(deps.localhostForwarding === undefined ? {} : deps.localhostForwarding),

    probeEth0: async (allowColdStart?: boolean): Promise<Eth0Outcome | WslSharedError> => {
      const target = await resolveTarget();
      if (!target.ok) return target;
      // 显式拼可选字段（不写 `{...base, ...override}`）：`exactOptionalPropertyTypes` 下
      // 「可选字段的值可能是 undefined」与「字段不存在」是两回事（口径同 `read/eth0-source.ts`）
      const options: { -readonly [K in keyof Eth0SourceOptions]: Eth0SourceOptions[K] } = { ...(deps.eth0 ?? {}) };
      if (allowColdStart !== undefined) options.allowColdStart = allowColdStart;
      return createEth0Source(executor, target.resolved.name, target.distros, options).probe();
    },

    // 唯一的非 IO 方法：纯判决直接委派给 Phase 2 的引擎（不复制一份口径）
    classify: (input: DiffInput): DiffOutcome => diff(input),
  };

  const provided = provideService(ctx, PORTS_SERVICE, service);
  const provideGap: PluginGap | null = provided
    ? null
    : {
        what: 'provide',
        reason:
          '宿主 ctx 上没有 provide() ⇒ 只读服务面未导出；服务导出缺口只影响宿主侧消费方，' +
          '右栏页的数据通道另见下面的 gaps 条目（REQ-10.3 的降级，不是错误）。',
      };

  // ── 提权可用性（缺陷 2 / 005 tasks 的「待办①」）：真探测 = 005 的只读后端探测 ──────────
  // 🔴 缓存口径（为什么不是每份快照都真探测）：`build()` 每次刷新都问一次可用性，而真探测要起
  // 1–3 个进程（`where.exe gsudo` + `gsudo status --json`，读不出来再加 `gsudo status`）⇒ 每份
  // 快照都打进程 = 刷新一次卡一次。故取「**进程内单飞 + 一次缓存**」（`createElevationAvailabilityProbe`）。
  // **不设 TTL** 的依据：① 真正的后端判定在每次提权时由 `runElevate` 重做一遍 ⇒ 陈旧值不可能
  // 造成错误的写；② 会话内「有没有提权通道」几乎不翻转（native 永久可回落）。
  const availability = createElevationAvailabilityProbe({
    executor,
    ...(deps.probeBackend === undefined ? {} : { probeBackend: deps.probeBackend }),
  });
  const elevationAvailable =
    deps.probeElevationAvailable ?? (async (): Promise<boolean> => (await availability.probe()).available);

  // ── T6.8：宿主侧快照装配 + 自建路由（右栏页的数据通道） ──────────────────────
  // ① 装配器：**只构造，不执行**（探针在请求处理里才跑 ⇒ 装载期零外部命令）
  const snapshotDeps: SnapshotDeps = {
    executor,
    ...(deps.localhostForwarding === undefined ? {} : { localhostForwarding: deps.localhostForwarding }),
    ...(deps.netsh === undefined ? {} : { netsh: deps.netsh }),
    ...(deps.docker === undefined ? {} : { docker: deps.docker }),
    ...(deps.eth0 === undefined ? {} : { eth0: deps.eth0 }),
    ...(deps.readNetworkingMode === undefined ? {} : { readNetworkingMode: deps.readNetworkingMode }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
    // 提权可用性 = 上面那个**缓存 + 单飞**的真探测（注入 `probeElevationAvailable` 时以注入为准）
    elevationAvailable,
    // 002 的 `managedTerminal` 只按字符串键软取（REQ-10.2：不建包依赖边）
    execAvailable: (): boolean => ctx.get?.('managedTerminal') !== undefined,
  };
  const builder: SnapshotBuilder = deps.snapshotBuilder ?? createSnapshotBuilder(snapshotDeps);

  // ② 路由：**注册发生在宿主可用时机**（`ctx.inject(['webServer'])`），此处不再同步 `ctx.get` 定生死
  const route: PortsRouteRegistration = registerPortsRoute(ctx, builder);
  // ③ 写通道（008 T1.7 + T2.9）：接线在 wire-plugin.ts，此处只留一行调用（⇒ 不挤爆 400 行 SHALL）；config 的 `elevationPolicy` / `writeToken` 都在这一行透传（缺省 ⇒ fail-safe：事实面 'unknown' ⇒ 不写；凭据未配置 ⇒ 401）
  const writeChannel = attachWriteChannel(ctx, deps.writeFacts ?? createPluginFacts({ executor, netsh: deps.netsh, probeEth0: () => service.probeEth0(false), probeElevation: () => availability.probe(), probeLocalhostForwarding: createDefaultLocalhostForwarding(), elevationPolicy: config?.elevationPolicy }), executor, undefined, config?.writeToken);

  /**
   * webServer 缺口：**每次读都按 `route` 的当前状态算**。
   *
   * 🔴 这是缺陷 A 的第二半：惰性注入的回调可能在本函数返回**之后**才跑（真机 +755ms），
   * 所以缺口不能是「装载那一刻拍下的一张照片」—— 否则路由都注册好了，`gaps` 里还挂着一句
   * 「未注册」的过期谎话。`pending`（等服务，不是失败）与 `missing`（确实缺）也必须分开说。
   */
  const webServerGap = (): PluginGap | null => {
    if (route.registered) return null;
    const why = route.reason ?? '宿主未提供 webServer';
    if (route.state === 'pending') {
      return { what: 'webServer', reason: `${why} ⇒ 快照端点 ${PORTS_SNAPSHOT_PATH} 尚未注册；注册到位后本条自动消失。` };
    }
    return {
      what: 'webServer',
      reason:
        `${why} ⇒ 快照端点 ${PORTS_SNAPSHOT_PATH} 未注册；` +
        '客户端半会按 ports-source-missing 降级（不注册页面、不抛异常），只读服务面仍可用。',
    };
  };

  /**
   * 提权可用性的缺口：**只在探测失败时**出现（探测是懒的 ⇒ 没请求过快照就还没跑过，此时无话可说）。
   * 与 `webServer` 那条同一取向：活的、不静默、原因必须可诊断。
   */
  const availabilityGap = (): PluginGap | null => {
    const result = availability.peek();
    if (result === null || result.available) return null;
    return { what: 'elevationAvailable', reason: `${result.reason}；快照的 elevationAvailable 因此为 false（写控件置灰）` };
  };

  // ③ 提权写路径：**执行器已实现 + 执行已接线**（008 T2.2–T2.4：票据门 → 提权链 → 回滚 → 审计）
  const tailGaps: PluginGap[] = [
    {
      what: 'ElevationInvoker',
      reason:
        '提权执行器**已实现**（005 的 `elevate/runner.ts` `runElevate` + `defaultElevationDeps`）且写通道的执行层已接线（008 `transport/apply.ts`：' +
        '票据门 ⇒ 存在性闸门 ⇒ 提权链 ⇒ 失败回滚 ⇒ 审计）；仍未接线的是**客户端确认对话框**（008 T3.1）⇒ 页面上点不到写入口；' +
        '`elevationPolicy` 已从插件 config 读，缺省/认不出 ⇒ 策略档为 `unknown` ⇒ 按 SSoT 默认落到 `none`（不写，fail-safe）。',
    },
  ];

  let effectCount = 0;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    route.dispose(); // 幂等；`ctx.effect` 也会在卸载时调它
  };

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      effectCount += 1;
      return dispose;
    });
  } else {
    tailGaps.push({
      what: 'effect',
      reason: '宿主 ctx 上没有 effect() ⇒ 卸载钩子未登记（路由的 disposer 只能在手动 dispose() 时生效）。',
    });
  }

  /**
   * 装载结果。
   *
   * ⚠️ `gaps` 是 **getter**（不是那一刻的快照）：`webServer` 那条按 `route` 的当前状态现算，
   * 于是「惰性注入后到 ⇒ 路由注册成功」时它会**自己消失**（见 `webServerGap`）；`elevationAvailable`
   * 那条同理，按**缓存里的探测结果**现算（没探测过就不出现）。
   * 顺序保持既有口径：`provide` → `webServer` → `elevationAvailable` → `ElevationInvoker` → `effect`。
   */
  const handle: WslDockerPortsPluginHandle = {
    service,
    snapshotBuilder: builder,
    writeRoute: writeChannel.writeRoute,
    route,
    get gaps(): readonly PluginGap[] {
      const out: PluginGap[] = [];
      if (provideGap !== null) out.push(provideGap);
      const web = webServerGap();
      if (web !== null) out.push(web);
      const availabilityGapNow = availabilityGap();
      if (availabilityGapNow !== null) out.push(availabilityGapNow);
      out.push(...tailGaps);
      return out;
    },
    elevationAvailability: () => availability.peek(),
    provided,
    effectCount: () => effectCount,
    dispose,
  };
  return handle;
}

/* ────────────────────────── 内部的窄适配 ────────────────────────── */

/**
 * 🔴 服务导出的**唯一**调用点（窄缝，照 002 的口径）。
 *
 * 单独一个函数是为了：真机 T0.5 若发现签名/时机不同，改这一处即可；且「宿主没有 provide」
 * 能被记成 gap 而不是崩掉整个插件加载。
 */
function provideService(ctx: PluginContextLike, serviceName: string, value: unknown): boolean {
  if (typeof ctx.provide !== 'function') return false;
  ctx.provide(serviceName, value);
  return true;
}
