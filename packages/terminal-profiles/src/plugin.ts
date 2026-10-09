/**
 * 002 插件入口（T7.1 服务导出 + T7.2 卸载清理打底）
 *
 * ## 形态：函数形式（与本机同族插件的生产代码一致）
 *
 * - `export const name = 'dsh-terminal-profiles'` —— **与包名逐字一致**（profile 清单
 *   `cordis.patch.yml` 的 `insert` 行 `id` 要按它引用）；
 * - `export const Config = createProfilesSchema(Schema)`（T6.1 的那一行；Schema 的取用见下）；
 * - `export function apply(ctx, config)`。
 *
 * ## 🔴 `ctx.provide('managedTerminal', …)` 的依据（不再是假设）
 *
 * 本机同族插件的**生产代码**都在用（Host 侧；浏览器侧才是 `ctx.reflect.provide(…)`）：
 * `E:\NodeProjects\dsh-desktop\dsh-desktop-next\src\extensions.ts`（`ctx.provide('desktopProfiles', …)`
 * 等四个）、`dsh-desktop\dsh-plugin-desktop\src\profile-context.ts:84`、`host-bootstrap.ts:130-134`。
 * ⇒ **API 存在性已解决**；本文件仍把调用收在**一个窄缝**（`provideService()` 一处）里，残余的
 * 只是「服务名 `managedTerminal` 被 003 按字符串键注入」这一条要真机装载验证（T0.5）。
 *
 * `Config` 的 Schema 来自**宿主那一份** schemastery（同族写法 `import z from '@deepseek-ai/schemastery'`）：
 * 本包**默认走运行时解析**（`./service-export/host-modules.ts`），因为包的依赖声明由集成方落地 ——
 * 静态 import 在依赖尚未解析到位时会让 `import './plugin.ts'` 当场失败（连配置面都起不来）。
 * 三个宿主包（`schemastery` / `dsh-tools` / `cordis`）已声明为 devDependencies + peerDependencies，
 * **替代点 = 换成静态 import 即可**（那一处有注释）。拿不到就是 `Config === undefined`：**不造假
 * schema**（假 schema 会让 volatile 静默失效 ⇒ 每次保存重挂载、杀光运行中的终端）。
 *
 * ## 为什么 `inject = []`（无强依赖）
 *
 * 本包没有「缺了就毫无意义」的服务：配置面与实例枚举在无 PTY 时仍可用；`subprocess` 走非严格
 * `ctx.get` ⇒ **缺服务时 `open` 返回可读的 `spawn-failed`**，而不是加载期静默不激活（REQ-3.4 的
 * 同一口径：不要 fail-fast 范式）。`webServer` / `tools` 同理（各自降级并在 `gaps` 里说明原因）。
 *
 * ## T7.2 打底：**一个** dispose 收全部
 *
 * 路由（`registerTerminalChannel` 内部的 `ctx.effect`）+ 已建立的 WS 连接（`closeAll`）+ 工具面
 * （004 的 `dispose`）+ 服务面（订阅/定时器/全部实例终止）都挂在下面这一个幂等 `dispose()` 上，
 * 并被 `ctx.effect` 收编。判据（`tests/unit/plugin-entry.test.ts`）：卸载后 WS 连接数 / 路由数 /
 * 页类型数 / 工具数 / 监听数 / 定时器数**全部归零**，且 `terminate` 调用数 = 实例数。
 *
 * ## 文件行数（SHALL ≤ 400 原始行）
 *
 * 2026-10-09 缺陷 A 修复后本文件到过 **426 行** ⇒ 把边界最干净的一块（`sandboxGuard`，无内部状态）
 * 拆到 `./sandbox-guard.ts`，这里只留一行再导出（调用方 import 路径不变）。
 */

import { parseProfiles } from './config/profiles.ts';
import type { TerminalProfile } from './config/profiles.ts';
import { createProfilesSchema } from './config/schema.ts';
import type { SchemaLike } from './config/schema.ts';
import { createSessionManager } from './session/manager.ts';
import type { SubprocessSurface } from './session/types.ts';
import { createTerminalTools } from './tools/index.ts';
import type { HostContextLike, ToolRegisterSurface } from './tools/index.ts';
import { createTokenStore } from './ws/auth.ts';
import type { TokenStore } from './ws/auth.ts';
import { registerTerminalChannel } from './ws/routes.ts';
import type { ChannelRegistration } from './ws/routes.ts';
import { TERM_WS_LIST_PATH, TERM_WS_UPGRADE_PATH } from './ws/constants.ts';
import type { ChannelPluginContext } from './ws/types.ts';
import { defaultHostModulePort, resolveDefineTool, resolveSchemaFactory } from './service-export/host-modules.ts';
import type { HostModulePort } from './service-export/host-modules.ts';
import { createManagedTerminalService, createUnavailableSubprocess } from './service-export/service.ts';
import type { GuardAction, ManagedTerminalHost, SchedulePort } from './service-export/service.ts';
import { MANAGED_TERMINAL_SERVICE } from './service-export/types.ts';
import type { ManagedTerminalService, ServiceFailure } from './service-export/types.ts';

/** 沙箱门禁适配器（003 消费；实现与口径见 `./sandbox-guard.ts` —— 拆出去是为了守住 ≤400 行） */
export { sandboxGuard } from './sandbox-guard.ts';

/** 插件名（供 profile 清单的 `id` 引用；**与包名逐字一致**） */
export const name = 'dsh-terminal-profiles';

/** 无强依赖（见文件头）：空数组 = 不因任何服务缺失而拒绝加载 */
export const inject: readonly string[] = [];

/** 宿主模块端口（`Config` 与 `apply` 都用这一份；单测可换成 fake，见 `PluginDeps.hostModules`） */
const HOST_MODULES: HostModulePort = defaultHostModulePort();

/** T6.1 的字面：`Config = createProfilesSchema(Schema)`；Schema 取不到时 `undefined`（不造假 schema） */
export const Config: SchemaLike | undefined = createConfigSchema(HOST_MODULES);

/** 构造 `Config`（导出成函数是为了让测试注入 fake 的 schemastery 工厂，验证 volatile 只标在数组节点） */
export function createConfigSchema(modules: HostModulePort): SchemaLike | undefined {
  const schema = resolveSchemaFactory(modules);
  return schema === undefined ? undefined : createProfilesSchema(schema);
}

/** 插件配置的形状（只有 `profiles`；`volatile` 值必须走 `.get()`，见 `../config/schema.ts`） */
export interface ProfilesConfigLike {
  readonly profiles?: { readonly get?: (() => unknown) | undefined } | readonly unknown[] | undefined;
}

/**
 * 本插件用到的宿主上下文面。
 *
 * `get` **非严格**（缺服务返回 `undefined`，我们自己降级）；`provide` 是**可选**的，只在类型上
 * 可选是为了让「宿主没有 provide」这件事变成**可见的 gap**，而不是一个 `TypeError`。
 */
export interface PluginContextLike extends ChannelPluginContext {
  /** 服务导出（窄缝的唯一调用点 = `provideService()`；依据见文件头） */
  provide?(name: string, value: unknown): unknown;
}

/** 一条「降级原因」（不静默：卸载/加载后可直接读出来定位） */
export interface PluginGap {
  readonly what: string;
  readonly reason: string;
}

/** 注入点（**测试与集成方**用；生产用缺省值） */
export interface PluginDeps {
  readonly hostModules?: HostModulePort | undefined;
  readonly schedule?: SchedulePort | undefined;
  /** 同源白名单（`ws/auth.ts` 的 `allowedOrigins`；空 = 全拒）。缺省 `[]` ⇒ fail-closed + gap */
  readonly allowedOrigins?: readonly string[] | undefined;
  /**
   * 服务面的写路径门禁（**缺省 undefined = 不过门**，见 `sandboxGuard` 的口径说明）。
   * 想复用 004 的沙箱策略时传 `(action) => sandboxGuard(policyCtx, action)`。
   */
  readonly guard?: ((action: GuardAction) => ServiceFailure | undefined) | undefined;
}

/** `apply` 的返回值（**宿主会忽略它**；给测试与集成方一个可 await 的卸载把手） */
export interface TerminalProfilesPluginHandle {
  /** 已导出的服务面（**恰好** §5 的 7 个方法） */
  readonly service: ManagedTerminalService;
  /** 一次性令牌表（页面挂载时 `issue()`；Phase 4/5 的 UI 接线点） */
  readonly tokens: TokenStore;
  readonly serviceHost: ManagedTerminalHost;
  /** WS 通道注册（`undefined` 只在注册逻辑本身抛错时出现） */
  readonly channel: ChannelRegistration | undefined;
  readonly toolNames: readonly string[];
  readonly gaps: readonly PluginGap[];
  effectCount(): number;
  routeCount(): number;
  dispose(): Promise<void>;
}

/** 缺 PTY 服务时 `open` 收到的人话（经会话层收成 `spawn-failed`，可读且可定位） */
const MISSING_SUBPROCESS_REASON =
  '宿主未提供 ctx.subprocess（非严格 ctx.get）⇒ 无法启动 PTY。请确认 profile 里挂载了提供 spawnTerminal 的组件。';

/** 宿主入口（cordis 调用；返回值被忽略） */
export function apply(ctx: PluginContextLike, config?: ProfilesConfigLike | undefined): void {
  applyTerminalProfiles(ctx, config);
}

/**
 * 真正的装配（`apply` 的实体 + 测试入口）。
 *
 * 装配顺序 = 依赖顺序：PTY 端口 → 服务面 → 工具面 → WS 通道 → 服务导出 → disposer 收编。
 */
export function applyTerminalProfiles(
  ctx: PluginContextLike,
  config?: ProfilesConfigLike | undefined,
  deps: PluginDeps = {},
): TerminalProfilesPluginHandle {
  const gaps: PluginGap[] = [];
  const modules = deps.hostModules ?? HOST_MODULES;
  // 每次现取：volatile 配置改完只影响「新建实例」（REQ-2.2 / REQ-2.4）
  const profilesOf = (): readonly TerminalProfile[] => readProfiles(config);

  // ① PTY 端口（非严格）：缺服务 ⇒ 兜底端口让 open 收成可读失败，而不是加载期不激活
  const subprocess = asSubprocessSurface(ctx.get('subprocess'));
  if (subprocess === undefined) {
    gaps.push({ what: 'subprocess', reason: MISSING_SUBPROCESS_REASON });
  }
  const manager = createSessionManager({
    subprocess: subprocess ?? createUnavailableSubprocess(MISSING_SUBPROCESS_REASON),
  });

  // ② 工具服务（`ctx.tools.register` 返回 disposer）—— 也供沙箱策略查询复用同一个 ctx
  const toolSurface = asToolRegisterSurface(ctx.get('tools'));
  if (toolSurface === undefined) {
    gaps.push({
      what: 'tools',
      reason: '宿主未提供 ctx.tools.register ⇒ 004 的 6 个工具不注册（配置面与服务面不受影响）。',
    });
  }
  const policyCtx: HostContextLike = {
    // `HostContextLike.tools` 是必填字段（`../tools/host.ts`），而本用途只读 `get`：
    // 这里给一个**不会被用到**的空注册面，而不是把「没有工具服务」谎报成有（注册面单独判空，见下）
    tools: toolSurface ?? { register: () => () => undefined },
    get: (service: string) => ctx.get(service),
  };
  /**
   * 自己记一份「已注册工具的撤回器」：宿主 `defineTool` 可能**在注册到一半时**抛错（真机实测过 ——
   * 见下面 ④ 的注释）⇒ 那时 `createTerminalTools` 还没返回 handle，只有这份流水账能把前半截收回去。
   */
  const registered: Array<() => void> = [];
  const guardTools = (surface: ToolRegisterSurface, log: Array<() => void>): ToolRegisterSurface => ({
    register(definition) {
      const dispose = surface.register(definition);
      log.push(dispose);
      return dispose;
    },
  });

  // ③ 服务面（§5 的 7 个方法）。门禁**默认不过门**（口径见 `sandboxGuard` 的注释）：
  //    端口保留，集成方/集成测试想切换时传 `deps.guard` 即可。
  const serviceHost = createManagedTerminalService({
    manager,
    profiles: profilesOf,
    schedule: deps.schedule,
    guard: deps.guard,
  });

  // ④ 工具面：`../tools/index.ts` 已暴露单一注册入口 ⇒ 就调它（不自造注册逻辑）
  let toolHandle: { readonly names: readonly string[]; readonly dispose: () => void } | undefined;
  if (toolSurface !== undefined) {
    const defineTool = resolveDefineTool(modules);
    if (defineTool === undefined) {
      gaps.push({
        what: 'defineTool',
        reason:
          '宿主模块 @deepseek-ai/dsh-tools 不可解析（本包 package.json 未声明该依赖）⇒ 工具面不注册；' +
          '补上依赖后自动上线（见 ./service-export/host-modules.ts 文件头）。',
      });
    } else {
      try {
        toolHandle = createTerminalTools({
          defineTool,
          tools: guardTools(toolSurface, registered),
          manager,
          profiles: profilesOf,
          ctx: policyCtx,
        });
        // 成功 ⇒ 交回给 handle 管（避免我这边再 dispose 一次）
        registered.length = 0;
      } catch (error) {
        // 🔴 真机实测（2026-10-09，装好真 dsh-tools 后）：宿主的 `defineTool` 会**当场校验参数表**
        // （值 schema DSL），而 004 的定义里有它不认的关键字（`oneOf` / `required` / `minimum` /
        // `minLength`）⇒ **6/6 全抛**。工具面失败**不许**把整包加载带崩（配置面 / 服务面 / 通道照常）
        // ⇒ 收成 gap 交给 004 修；同时把**半途已注册**的工具全部撤回（不留残渣，REQ-12.2）。
        for (const dispose of registered.splice(0, registered.length)) dispose();
        gaps.push({
          what: 'tools',
          reason: `工具面注册失败（宿主 defineTool 拒绝参数表，已回滚已注册项）：${describeError(error)}`,
        });
      }
    }
  }

  // ⑤ WS 通道：路由 + upgrade（`registerTerminalChannel` 内部已把两个 disposer 登记到 ctx.effect）
  const tokens = createTokenStore();
  const allowedOrigins = deps.allowedOrigins ?? [];
  if (allowedOrigins.length === 0) {
    // fail-closed（空列表 = 全拒，见 `../ws/auth.ts`）：**不**自造同源白名单（宁可拒，也别静默开口子）
    gaps.push({
      what: 'allowedOrigins',
      reason:
        '没有可用的同源白名单 ⇒ WS 通道 fail-closed（空列表 = 全拒）。集成方需把宿主 GUI 的实际 origin' +
        '经 PluginDeps.allowedOrigins 传进来（本任务不猜测端口）。',
    });
  }
  let channel: ChannelRegistration | undefined;
  let channelError: string | undefined;
  try {
    channel = registerTerminalChannel(ctx, { manager, tokens, allowedOrigins });
  } catch (error) {
    // 唯一可能的抛错点是「重复 (kind, path) 注册」（设计 §11 的实证）：降级但不静默
    channelError = describeError(error);
  }

  /**
   * webServer 缺口：**每次读都按 `channel` 的当前状态现算**（2026-10-09 真机缺陷 A 的第二半）。
   *
   * 惰性注入的回调可能在 `applyTerminalProfiles` 返回**之后**才跑（真机 `+755ms`）⇒ 缺口不能是
   * 「装载那一刻拍下的一张照片」，否则路由都注册好了、`gaps` 里还挂着一句「未注册」的过期谎话。
   * `pending`（还在等宿主服务，**不是失败**）与 `missing`（确证缺 / 注册抛错）必须分开说。
   */
  const webServerGap = (): PluginGap | null => {
    if (channelError !== undefined) {
      return { what: 'webServer', reason: `WS 路由注册失败：${channelError}` };
    }
    if (channel === undefined) {
      return { what: 'webServer', reason: 'WS 通道未装配（registerTerminalChannel 未返回句柄）。' };
    }
    if (channel.registered) return null;
    const why = channel.reason ?? '宿主未提供 webServer（原因未给出）';
    if (channel.state === 'pending') {
      return {
        what: 'webServer',
        reason: `${why} ⇒ 实例枚举端点 ${TERM_WS_LIST_PATH} 与 upgrade 端点 ${TERM_WS_UPGRADE_PATH} 尚未注册；注册到位后本条自动消失。`,
      };
    }
    return { what: 'webServer', reason: why };
  };

  // ⑥ 服务导出：**唯一窄缝**（依据见文件头；残余真机项 = 003 按字符串键能否注入到）
  const provided = provideService(ctx, MANAGED_TERMINAL_SERVICE, serviceHost.service);
  if (!provided) {
    gaps.push({
      what: 'provide',
      reason:
        '宿主 ctx 上没有 provide() ⇒ 服务未导出；003 的 inject 落空会走它自己的置灰路径' +
        '（这正是 REQ-11.3 的降级，不是错误）。',
    });
  }

  let effectCount = 0;
  let disposing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (disposing !== undefined) return disposing;
    disposing = (async () => {
      // 顺序：先断通道（不再有新输入/新连接）→ 注销路由 → 注销工具 → 终止全部实例
      channel?.channel.closeAll();
      channel?.dispose();
      toolHandle?.dispose();
      await serviceHost.dispose();
    })();
    return disposing;
  };

  // 🔴 收进 ctx.effect（宿主不会自动收编，design §11）。清理函数是**同步契约** ⇒ 只点火不等待：
  // 同一个幂等 `dispose()` 同时暴露在返回值上，测试/集成方可以 `await`（T7.2 的判据靠它）
  ctx.effect(() => {
    effectCount += 1;
    return () => {
      void dispose();
    };
  });

  return {
    service: serviceHost.service,
    tokens,
    serviceHost,
    channel,
    toolNames: toolHandle?.names ?? [],
    /**
     * 🔴 **getter，不是快照**：静态 gap（`gaps` 数组）+ 按当前状态现算的 `webServer` 缺口。
     * 惰性注入的服务后到时，这条会**自己消失**（真机缺陷 A 的可观测性要求）。
     */
    get gaps(): readonly PluginGap[] {
      const live = webServerGap();
      return live === null ? [...gaps] : [...gaps, live];
    },
    effectCount: () => effectCount,
    routeCount: () => channel?.registrationCount() ?? 0,
    dispose,
  };
}

/* ────────────────────────── 内部的窄适配 ────────────────────────── */

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 读 `profiles`。
 *
 * 🔴 volatile 值的正确读法是 `.get()`（下标取值是 `undefined`，见 `../index.ts` 的调用约定）；
 * 裸数组那一支只服务夹具/非 volatile 兜底，不是第二套口径。取不到就是**空名录** ⇒ `open` 会给出
 * 「profile 不在当前配置里」+「当前配置里没有任何 profile」的可读失败（不静默）。
 */
function readProfiles(config: ProfilesConfigLike | undefined): readonly TerminalProfile[] {
  const holder = config?.profiles;
  if (holder === undefined) return [];
  if (Array.isArray(holder)) return parseProfiles(holder).profiles;
  const get = (holder as { get?: (() => unknown) | undefined }).get;
  const raw = typeof get === 'function' ? get.call(holder) : undefined;
  if (!Array.isArray(raw)) return [];
  return parseProfiles(raw).profiles;
}

function asSubprocessSurface(value: unknown): SubprocessSurface | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SubprocessSurface>;
  return typeof candidate.spawnTerminal === 'function' ? (candidate as SubprocessSurface) : undefined;
}

function asToolRegisterSurface(value: unknown): ToolRegisterSurface | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<ToolRegisterSurface>;
  return typeof candidate.register === 'function' ? (candidate as ToolRegisterSurface) : undefined;
}

/**
 * 🔴 服务导出的**唯一**调用点（窄缝）。
 *
 * 形状照 design §5/§15 的字面 `ctx.provide('managedTerminal', …)`；证据（同族插件生产代码）见文件头。
 * 单独一个函数是为了：真机 T0.5 若发现签名/时机不同，改这一处即可；且「宿主没有 provide」能被
 * 记成 gap 而不是崩掉整个插件加载。
 */
function provideService(ctx: PluginContextLike, serviceName: string, value: unknown): boolean {
  if (typeof ctx.provide !== 'function') return false;
  ctx.provide(serviceName, value);
  return true;
}
