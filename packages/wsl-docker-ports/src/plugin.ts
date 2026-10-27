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
 * - **导出 `Config`**（声明在 `./config.ts`；与 002 同形态）—— 2026-10-12 真机两次订正：缺它 ⇒
 *   宿主取不到 schema；**只有它不够** ⇒ `describe()` 还要 `volatileForm(schema) !== undefined`，
 *   零 volatile 的命名空间**一样消失**。两个条件都满足才注册 settings 命名空间（详见 `./config.ts`）。
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
 * ## `Config` 已在 `./config.ts` 声明（2026-10-12 真机订正，**留痕不删**）
 *
 * 🔴 旧口径（2026-10-09 版）：以为「宿主不持有活体副本 ⇒ 没有 volatile 需求 ⇒ 不需要 `Config`」——**真机两次推翻**。根因与宿主源码判据（`describe()` 的 `volatileForm` 门、`write()` 的 `is not volatile` 抛错、`role('secret')` × `redactSecrets`）全部记在 `./config.ts` 文件头与 009 `tasks.md`，此处不重复。
 * ⚠️ **代价在读侧**：volatile 字段解析出来是**带 `.get()` 的活体包装**（B-1 定案）⇒ 本入口不再直接属性读，一律经 `./config-read.ts` 的 `createHostConfigReaders(config)`（两类形态同一读法、**每次现读** ⇒ 提权档不会退化成 `none`、凭据不会永久 401）。零新增依赖；解析不到 ⇒ `Config === undefined` + 诊断，绝不造假 schema。
 *
 * ## 仍然缺的那一件（不静默，写进 `gaps`）
 *
 * **提权写路径的接线**：执行器属 **005**（`runElevate` + `defaultElevationDeps` **已实现**），缺的是「带 ownership 判定的写计划装配」+「浏览器点击 → 宿主执行」的传输（本波只开了只读 GET）⇒ 本入口**不做**假的 `ElevationInvoker`（那会让「写成功」变成谎报），如实记成 gap。
 */

import { createExecutor, listDistros, resolveDistro } from 'dsh-wsl-shared';
import type { WslSharedError } from 'dsh-wsl-shared';
import { diff } from './diff/engine.ts';
import type { DiffInput, DiffOutcome } from './diff/types.ts';
import { createHostConfigReaders } from './config-read.ts';
import { createElevationAvailabilityProbe } from './elevate/backend.ts';
import { probeDockerPs } from 'dsh-wsl-docker-core';
import type { DockerPsOutcome } from 'dsh-wsl-docker-core';
import { createEth0Source } from 'dsh-wsl-docker-core';
import type { Eth0SourceOptions } from 'dsh-wsl-docker-core';
import { readLocalhostForwarding } from 'dsh-wsl-docker-core';
import type { LocalhostForwardingOutcome } from 'dsh-wsl-docker-core';
import { probePortproxyRules } from 'dsh-wsl-docker-core';
import type { PortproxyOutcome } from 'dsh-wsl-docker-core';
// 012：写通道的监听地址候选清单（与快照的 `localAddresses` 同源：`read/local-addresses.ts`）
import { probeLocalAddresses } from 'dsh-wsl-docker-core';
import { registerPortsRoute } from './route.ts';
import { attachWriteChannel, createDefaultLocalhostForwarding, createPluginFacts } from './transport/wire-plugin.ts';
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

// ─────────────────────────────────────────────────────────────────────────────
// 宿主面**类型**（T5 拆分，2026-10-12 009 收口轮）：7 个声明搬去 `./host-face.ts`
//
// 拆的理由是硬门：拆前本文件 `split('\n')` 口径**正好 400/400**（零余量），而「单文件 ≤ 400 行」
// 是 SHALL。切的边界是「**类型面 vs 装配面**」：类型全是编译期擦除、零运行时代码，装配留在这里。
// 🔴 公开面**一行未变**：下面这行再导出把 `src/index.ts` 与全部测试的既有 import 原样接住。
// ─────────────────────────────────────────────────────────────────────────────
export type {
  PluginContextLike,
  PluginGap,
  PortsHostDeps,
  PortsHostService,
  PortsPluginConfigLike,
  TargetDistro,
  WslDockerPortsPluginHandle,
} from './host-face.ts';
import type {
  PluginContextLike,
  PluginGap,
  PortsHostDeps,
  PortsHostService,
  PortsPluginConfigLike,
  TargetDistro,
  WslDockerPortsPluginHandle,
} from './host-face.ts';

/**
 * 宿主入口（cordis 调用；返回值被忽略）。
 *
 * ## 016：**只有转发侧**（角色分派已删除）
 *
 * 015 时这里按行 id 分派到容器侧；016 把容器侧拆成独立包 `dsh-wsl-docker-containers`
 * （它有自己的 `apply`）⇒ 本包不再需要「这一行是谁」的判定，`src/role.ts` 随之删除。
 * 唯一的 `apply` 实体 = `applyWslDockerPorts`（行为与 015 的转发侧逐字节一致）。
 */
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
  // 🔴 配置一律经活体读取面（`distro`/`elevationPolicy`/`writeToken` 都标了 volatile ⇒ 宿主给的是
  // 带 `.get()` 的包装）。四个方法**每次现读**：volatile 写入原地更新，现读才不会吃到 apply 时刻的旧值。
  const hostConfig = createHostConfigReaders(config);

  const resolveTarget = async (): Promise<TargetDistro> => {
    const listed = await listDistros(executor);
    if (!listed.ok) return listed;
    const resolved = resolveDistro(listed.distros, hostConfig.distro());
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
  // 🔴 缓存口径（为什么不是每份快照都真探测）：`build()` 每次刷新都问一次可用性，而真探测要起 1–3 个进程（`where.exe gsudo` + `gsudo status --json`，读不出来再加 `gsudo status`）⇒ 每份快照都打进程 = 刷新一次卡一次。故取「**进程内单飞 + 一次缓存**」（`createElevationAvailabilityProbe`）。
  // **不设 TTL** 的依据：① 真正的后端判定在每次提权时由 `runElevate` 重做一遍 ⇒ 陈旧值不可能造成错误的写；② 会话内「有没有提权通道」几乎不翻转（native 永久可回落）。
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
    // 012：逐端口已持久化的监听地址 —— 宿主从 config **现读**（判决与计划同一份事实）
    listenAddresses: hostConfig.listenAddresses,
  };
  const builder: SnapshotBuilder = deps.snapshotBuilder ?? createSnapshotBuilder(snapshotDeps);

  // ② 路由：**注册发生在宿主可用时机**（`ctx.inject(['webServer'])`），此处不再同步 `ctx.get` 定生死
  const route: PortsRouteRegistration = registerPortsRoute(ctx, builder);
  // ③ 写通道（008 T1.7 + T2.9）：接线在 wire-plugin.ts，此处只留一行（⇒ 不挤爆 400 行 SHALL）。🔴 透传的是 `config-read.ts` 的**活体读取函数**（不是值本身）：两个消费点都在 apply 之后才用（策略判决每次计划、凭据每次请求）⇒ 现读才吃得到 live 写入（缺省 ⇒ fail-safe：事实面 'unknown' ⇒ 不写；凭据未配置 ⇒ 401）
  const writeChannel = attachWriteChannel(ctx, deps.writeFacts ?? createPluginFacts({
    executor,
    netsh: deps.netsh,
    probeEth0: () => service.probeEth0(false),
    probeElevation: () => availability.probe(),
    probeLocalhostForwarding: createDefaultLocalhostForwarding(),
    elevationPolicy: hostConfig.elevationPolicy,
    // 012：选中的监听地址要**贯通到执行层**（plan 用它算 listenaddress/RemoteAddress）：
    // 配置现读（逐端口）+ 候选清单现读（同一道 fail-closed 门的输入）。
    listenAddresses: (port: number) => hostConfig.listenAddresses()[String(port)],
    localAddresses: async () => {
      const outcome = await probeLocalAddresses(executor, {});
      if (!outcome.ok) throw new Error(`监听地址候选清单读失败：${outcome.message}`);
      return outcome.addresses;
    },
  }), executor, undefined, hostConfig.writeToken);

  // ④ 015 P2：容器能力**不再**挂在转发侧（两条行、两条独立通道）。
  //    010 的 `src/docker/**` 保留为「已实现但未装配」的遗留面（契约用例直接调它），
  //    运行时的容器入口在 `src/containers/plugin.ts`（由上面的 `apply` 按行 id 分派）。

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
