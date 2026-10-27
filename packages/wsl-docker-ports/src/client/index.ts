/**
 * `dsh-wsl-docker-ports` **客户端半**入口（003 Phase 5）
 *
 * ## 与宿主半的三处刻意的不同（照抄会踩坑，contract §0-2/0-3/§B5）
 *
 * 1. **没有默认导出**：客户端入口导出形状 = `{ apply, inject, name? }`（宿主半才是
 *    `export default { name, inject, apply, Config }`）。
 * 2. **模块级 `inject` 是 Cordis 服务名**（本包 = `['slots']`），不是包名；
 *    清单里的 `dsh.client.inject` 才是**包名数组**（信息性依赖），两者同名不同物。
 * 3. `inject` **只声明稳定服务**：声明了却缺失会让**整个客户端插件 load 失败**，
 *    所以 `sidebarRightTabs` / `sidebarRight` / `remote.settings` 一律**软取**（`ctx.get` 或注入作用域上的
 *    同名属性，两种写法实物里都有），缺失就降级并**给出原因**（REQ-10.3 的口径），绝不抛异常。
 *
 * ## 🔴 2026-10-09 真机缺陷 C：右栏页服务是**后到**的，判据不能是「同步取一次」
 *
 * 真机实测：客户端 bundle 已加载（`__DSH_BOOT__.entries` 有本包、CSS 已注入），但**右栏没有我们的页**、
 * **零快照请求**、**控制台 0 error / 0 warning**。
 *
 * 离线可证的结构原因：本包模块级 `inject` 只有 `['slots']` ⇒ 本插件 fiber 早早启动；而两个右栏服务由官方
 * `@deepseek-ai/dsh-client-ui-sidebar-right` 提供（实物：`ctx.reflect.provide("sidebarRightTabs", tabs)` /
 * `provide("sidebarRight", controller)`，且那家自己 `inject` 了 7 个服务、在 `apply` 中段才 provide）
 * ⇒ 我们 `apply` 的时刻它们**大概率还没到**。旧写法在这一步同步 `softGet` 一次就 `return`
 * ⇒ 紧随其后的 `ctx.inject(...)`（唯一的等待机制）**永远执行不到**。这与宿主半的缺陷 A 是同一类：
 * **同步判定挡死了惰性注册**。
 *
 * 故现在的写法：**不再同步定生死** —— 一律 `ctx.inject([...])` 等，`registered` 只在回调真跑过并注册成功
 * 之后才为 `true`；此刻没注册就如实返回 `sidebar-right-pending`（`deferred: true`），**不谎报缺失**。
 *
 * ## 🔴 2026-10-09 第二次真机复验：warn 不能打在正常路径上
 *
 * 真机探针：插件 `apply` 在 `@1051ms` 时两个宿主服务还是 `undefined`，宿主服务在 **`@1317ms`** 到齐、
 * 内层 `ctx.inject` **确实 fire**（`tabs=object / sidebar=object`）⇒ **晚到 ~240ms 是常态**。
 * 而当时的写法在 apply 当下就 `console.warn`「尚未注册」⇒ **每次启动一条假告警**，
 * 结果是训练人忽略真告警（真缺陷 C 就差点因此查无可查）。
 * 现在：窗口内到位 = **零 warn**；超过 `pendingWarnMs`（缺省 2000ms，可注入假时钟）仍在等才 warn；
 * 且若曾 warn 过、之后又注册成功，补一条 `console.info` 说明**已解除**（对照）。
 * 「真缺服务」的即时可见性没丢：`sidebar-right-unavailable` 那条 warn 原样保留。
 *
 * ## 降级不是一个 catch 分支，而是返回值的一部分
 *
 * `apply()` 返回判别联合：`registered: true` 或 `registered: false` + `reason` + `missing` + `message`；
 * `reason` 四态：`slots-missing` / `ports-source-missing` / `sidebar-right-pending`（等服务）/ `sidebar-right-unavailable`（确证缺）。
 * 于是每条降级路径都可以被**逐条断言**，而不是靠「反正没崩」来证明。
 */

import { createElement, type ReactElement } from 'react';

import { ChunkBoot, type ChunkSeatModule } from './chunk-degrade.ts';
import {
  CLIENT_SERVICES,
  SIDEBAR_SERVICE,
  SIDEBAR_TAB_SERVICE,
  type ClientApplyOptions,
  type ClientContextLike,
  type ClientRuntime,
  type ClientTimers,
  type PortsSource,
  type RemoteSettingsLike,
  type SidebarRightServiceLike,
  type SidebarRightTabsServiceLike,
  type SlotsServiceLike,
} from './host.ts';
import type { PortsPaneProps } from './pane.tsx';
import {
  PAGE_ID,
  PAGE_KIND,
  PAGE_TITLE,
  TAB_SLOT,
  TAB_TITLE_SLOT,
  portsTabDefinition,
  registerTabSeats,
} from './tab-def.ts';
import { createRouteSource } from './route-source.ts';
import { createSettingsPipe } from './settings-pipe.ts';
import { registerConfigSlot } from './config-slot.ts';
import type { ConfigSlotContext } from './config-slot.ts';
import { installStylesWith } from './styles.ts';
import { createWriteWiring } from './write-channel.ts';
import type { WriteWiring } from './write-channel.ts';
import { createWriteTokenStore, defaultSessionStorage } from './write-token.ts';

/**
 * 宿主注入的 CJS 工厂形参（`scripts/build-client.mjs` 的 banner 里就是 `(require) => {`）。
 *
 * 这里**只声明**我们用到的那个方法 `require.async`：宿主的懒加载取块 API，011 `Phase 0` 在
 * **0.2.0-rc.2 真机**上跑通了整链路（官方终端页 `lib/client.js:167` 同形：
 * `(await require.async("./client.terminal.js")).TerminalBody`）。声明成模块局部环境变量即可 ——
 * 不引入任何新依赖（REQ-BS-7），也不往 `globalThis` 上挂东西。
 */
declare const require: {
  (id: string): unknown;
  async<T = unknown>(id: string): Promise<T>;
};

/**
 * 渲染面 chunk 的**说明符**（相对本模块解析 ⇒ 宿主路由下与主包同目录）。
 *
 * 🔴 三处同名、改名必须三处同改：[`chunk-ports.ts`](./chunk-ports.ts)（chunk 入口）·
 * `scripts/build-client.mjs`（chunk 产物名）· 本常量。对不上 = 运行期取块 404。
 */
const PANE_CHUNK = './client.ports.js';

/**
 * 取块调用（`T2.4` 起由 `ChunkBoot` 统一负责 loading / failed / 重试）。
 *
 * ⚠️ 取块失败（404 / 离线 / chunk 执行期抛错）时本 promise **reject**；`T2.4` 之前由宿主的 slot
 * 失败路径报出来（`Phase 0` `T0.2` 三态已实测该语义与控制台原文），现在由 `ChunkBoot` 接住 ⇒
 * **可解释降级 + 可重试**（`REQ-BS-5`）。
 */
const loadPortsChunk = (spec: string): Promise<ChunkSeatModule> => require.async(spec) as Promise<ChunkSeatModule>;

/**
 * 座位组件（`sidebar.right.pane.tab` 的内容）：**自带加载态与降级面板**（`ChunkBoot`）。
 *
 * 官方终端页把 `react.lazy` 的组件直接交给 slot（宿主侧有边界，`T0.1` 实测）；我们多包一层
 * 只为「宿主即便没有边界也不会整页空白」+「失败时说清原因、给重试」—— `T0.2` 的原基线是
 * **不白屏但也没有任何原因文案 / 重试**，那正是本层要补的缺口。
 */
function PortsPaneSeat(props: PortsPaneProps): ReactElement {
  return createElement(ChunkBoot, {
    spec: PANE_CHUNK,
    title: PAGE_TITLE,
    load: loadPortsChunk,
    paneProps: props as unknown as Record<string, unknown>,
  });
}

/** 模块级 Cordis 服务注入（**只放稳定服务**） */
export const inject: readonly string[] = CLIENT_SERVICES;

/** 行 id == 包名（与 `cordis.patch.yml` 的 `- id:` 一致；同时是配置命名空间） */
export const name = 'dsh-wsl-docker-ports';

export type ClientDegradeReason = 'slots-missing' | 'ports-source-missing' | 'sidebar-right-unavailable' | 'sidebar-right-pending';

export type ClientApplyResult =
  | { readonly registered: true; readonly pageId: string; readonly kind: string; readonly seats: readonly string[]; readonly styles: string }
  | { readonly registered: false; readonly reason: ClientDegradeReason; readonly message: string; readonly missing: readonly string[]; readonly deferred?: boolean };

/**
 * 读一个服务（两个来源都认）。
 *
 * 🔴 官方调用点里两种写法**都**出现过，故都试：`ctx.get("sidebarRightTabs")`（本仓既有口径；
 * 实物出处 `app.asar` 内 `openExternalLink` 分支）与注入作用域上的直接属性
 * `scope.sidebarRightTabs`（实物出处：官方 `ui-chat` 的 `ctx.inject(["sidebarRightTabs"], scope => {
 * const tabs = scope.sidebarRightTabs; })`，与本仓 002 的 `client/tab.ts` 同形）。
 * 只认一种写法会让「服务其实在、只是没走 `get`」又一次变成「页面静默不出现」。
 */
function softGet<T>(ctx: ClientContextLike, serviceName: string): T | undefined {
  const viaGet = typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined;
  if (viaGet !== undefined && viaGet !== null) return viaGet as T;
  const viaProperty = (ctx as unknown as Record<string, unknown>)[serviceName];
  return viaProperty === undefined || viaProperty === null ? undefined : (viaProperty as T);
}

/** 客户端日志前缀：**降级必须可见**（静默不注册 = 「页面莫名其妙不出现」，真机就吃过这个亏） */
const CLIENT_LOG_TAG = '[dsh-wsl-docker-ports]';

/**
 * pending 告警的缺省宽限窗口（ms）。
 *
 * 🔴 **2026-10-09 第二次真机复验**：右栏两个服务**晚到 ~240 ms 是常态**（探针：插件 `apply` 在
 * `@1051ms` 时两个宿主服务还是 `undefined`，`@1317ms` 到齐、内层 `ctx.inject` **确实 fire**）。
 * 于是「apply 时还没到」**是正常路径**，旧写法在正常路径上每次启动都打一条 warn
 * ⇒ 训练人忽略真告警。现在：窗口内到位 = **零 warn**；超过窗口仍在等才 warn。
 */
const DEFAULT_PENDING_WARN_MS = 2000;

/**
 * 客户端半入口。**不抛异常**：任何缺失都从返回值里说清。
 *
 * ## 取数面（T6.8）：优先级 = 显式注入 > 自建路由 > 降级
 *
 * 1. `options.source` 给了 ⇒ 用它（测试与集成方注入；内部行为完全可控）；
 * 2. `options.routeBaseUrl !== null` ⇒ **自建路由来源**（`route-source.ts`）：同源 `fetch`
 *    宿主的 `/dsh-wsl-docker-ports/snapshot`，声明来自 `settings.readConfig()`；
 * 3. 两者都没有 ⇒ `ports-source-missing` 降级，**不注册页面、不抛**。
 *
 * ⚠️ **注释留痕**：T6.8 之前这里是「没有 `options.source` 就不注册」。现在默认走自建路由，
 * 于是「没接数据通道」变成了「数据通道就是自建的那条」；降级路径保留给
 * `routeBaseUrl: null`（显式关掉）与「运行环境没有 `fetch`」两种情形。
 *
 * ## 右栏页那一刻没就绪 ⇒ 不是失败（缺陷 C）
 *
 * 服务晚到时本函数返回 `registered: false` + `reason: 'sidebar-right-pending'` + `deferred: true`
 * —— **此刻真的没注册**（不谎报），但惰性注入已登记，服务一到就会注册页与两个 seat。
 */
export function apply(ctx: ClientContextLike, options: ClientApplyOptions = {}): ClientApplyResult {
  // ① 样式：必须在 factory 闭包内（材质化时）执行 —— 这里正是那个位置（contract §P4-4）
  installStylesWith(ctx);

  // ② 稳定服务：`slots` 已在模块级 inject 里声明，理论上必在；仍然软取以便降级可断言
  const slots = softGet<SlotsServiceLike>(ctx, 'slots');
  if (slots === undefined) {
    return { registered: false, reason: 'slots-missing', message: '宿主未提供 slots 服务：客户端插件不注册任何页面（未抛异常）', missing: ['slots'] };
  }

  // ③ 配置管道先建：路由来源每次刷新要用它读声明（**读**，不是写）
  const settings = createSettingsPipe(() => softGet<RemoteSettingsLike>(ctx, 'remote.settings'));

  // ⑤ 写通道（T3.1）：凭据仓库先建（缺省真 sessionStorage；取不到 ⇒ 内存降级 —— 绝不落盘）。
  //    ⚠️ 017 三订起**提前到位**：配置页要拿到同一份 `write`（写通道预演搬去了配置页），
  //    而座位在 ③′ 就建好了 ⇒ 构造顺序必须排在座位之前。构造期仍然**零请求**。
  const tokenStore = options.tokenStore ?? createWriteTokenStore(options.sessionStorage ?? defaultSessionStorage());
  const write: WriteWiring =
    options.write ??
    createWriteWiring({
      settings,
      tokenStore,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });

  // ③′ 010 T7.3 → 017：**bundle 级**配置页（宿主 `plugins.bundle.config`，画在卡片页的
  //    「描述与组件行之间」）。组件本体在 chunk 里（主包棘轮零余量），这里只注册一个**取块座位**；
  //    `settings` 直接闭包进去 ⇒ 页面写走同一条 live 管道（不另造一条）。
  //    关自动表单 + 槽位注册失败都只降级、不抛（配置页是可选的编辑入口，不该拖垮整包加载）。
  const configSeat = (ownerProps: Record<string, unknown>): ReactElement =>
    createElement(ChunkBoot, {
      spec: PANE_CHUNK,
      title: 'WSL Docker 工具箱 · 配置',
      load: loadPortsChunk,
      exportName: 'ConfigPage',
      paneProps: { ...ownerProps, settings, write },
    });
  const configSlot = registerConfigSlot(ctx as unknown as ConfigSlotContext, configSeat as unknown as (props: never) => unknown);
  if (!configSlot.registered) {
    console.warn(`${CLIENT_LOG_TAG} 插件配置页未注册：${configSlot.reason ?? '原因未记录'}`);
  }

  // ④ 取数面：显式注入 > 自建路由 > 降级
  const source: PortsSource | undefined =
    options.source ??
    (options.routeBaseUrl === null
      ? undefined
      : createRouteSource({
          baseUrl: options.routeBaseUrl ?? '',
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
          readDeclaration: async () => {
            const config = await settings.readConfig();
            return {
              managedPorts: config.managedPorts,
              scopes: config.scopes,
              elevationPolicy: config.elevationPolicy ?? 'none',
              ...(config.distro === undefined ? {} : { distro: config.distro }),
            };
          },
        }));

  if (source === undefined) {
    return {
      registered: false,
      reason: 'ports-source-missing',
      message: '未接线 PortsSource（宿主侧数据通道被显式关闭：routeBaseUrl === null）：只读看板无可渲染数据，故不注册页面（未抛异常）',
      missing: ['PortsSource'],
    };
  }


  const runtime: ClientRuntime = {
    source,
    // 惰性软取：`remote.settings` 可能晚于本插件就绪（contract §D13），故传 getter 而不是取一次的值
    settings,
    elevation: options.elevation,
    exec: options.exec,
    // ⑧ 008 T3.1 写通道：路由客户端 + 凭据仓库（sessionStorage）+ 所有权声明读取器。
    //    **构造期零请求**：channel 只在用户点「预演」时才发第一个请求。
    write,
  };

  const disposers: (() => void)[] = [];
  const collect = (disposer: unknown): void => {
    if (typeof disposer === 'function') disposers.push(disposer as () => void);
  };

  let registeredPage = false;
  /** 注入回调**真的跑过**（= 两个服务到过位）—— 与「还没到」是两回事，别混 */
  let injectFired = false;
  let lastMissing: string[] = [];

  const timers: ClientTimers = options.timers ?? {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    },
  };
  const grace = options.pendingWarnMs ?? DEFAULT_PENDING_WARN_MS;
  /** 已排定的 pending 告警句柄（`null` = 没排/已撤） */
  let pendingWarnTimer: unknown = null;
  /** 那条 pending 告警**真的打出去过** ⇒ 之后注册成功要打一条 info 作对照（不然告警像没恢复） */
  let warnedPending = false;

  const cancelPendingWarn = (): void => {
    if (pendingWarnTimer === null) return;
    timers.clearTimeout(pendingWarnTimer);
    pendingWarnTimer = null;
  };

  /**
   * 排定「等太久了」那条告警。**不在 apply 当下打** —— 服务数百 ms 后到位是常态（见上方常量注释）。
   * 负值 / 非有限值 = 显式关掉（真缺服务仍有 `sidebar-right-unavailable` 那条即时 warn 兜底）。
   */
  const schedulePendingWarn = (): void => {
    if (!Number.isFinite(grace) || grace < 0) return;
    pendingWarnTimer = timers.setTimeout(() => {
      pendingWarnTimer = null;
      if (injectFired || registeredPage) return;
      warnedPending = true;
      console.warn(
        `${CLIENT_LOG_TAG} 右栏页等待超时（已等 ${String(grace)}ms）：已登记 ctx.inject(['${SIDEBAR_TAB_SERVICE}', '${SIDEBAR_SERVICE}']) 但宿主仍未提供这两个服务 ⇒ 页不会出现，看这一行（正常启动时服务在数百 ms 内到位，不会走到这里）`,
      );
    }, grace);
  };

  const register = (scope: ClientContextLike): void => {
    injectFired = true;
    cancelPendingWarn();
    const tabs = softGet<SidebarRightTabsServiceLike>(scope, SIDEBAR_TAB_SERVICE);
    const sidebar = softGet<SidebarRightServiceLike>(scope, SIDEBAR_SERVICE);
    const missing: string[] = [];
    if (tabs === undefined) missing.push(SIDEBAR_TAB_SERVICE);
    if (sidebar === undefined) missing.push(SIDEBAR_SERVICE);
    if (tabs === undefined || missing.length > 0) {
      lastMissing = missing;
      // 🔴 降级**必须可见**：静默不注册 = 「页面莫名其妙不出现」（真机实测过：0 error / 0 warning）
      console.warn(`${CLIENT_LOG_TAG} 右栏页未注册：宿主未提供 ${missing.join(' / ')}（本包不抛异常，只读事实层仍可用）`);
      return;
    }
    // `register` 返回**幂等 disposer**（contract §C9/§C11）：重复注册同一 `id` 不会产生第二个页
    collect(tabs.register(portsTabDefinition()));
    const scopedSlots = softGet<SlotsServiceLike>(scope, 'slots') ?? slots;
    for (const disposer of registerTabSeats(
      scopedSlots,
      () => createElement(PortsPaneSeat, { runtime }),
      () => createElement('span', { className: 'wdp-tab-title' }, PAGE_TITLE),
    )) {
      collect(disposer);
    }
    registeredPage = true;
    // 对照：先前那条「等待超时」告警到此**已解除**（否则看到告警的人无从判断它是否还成立）
    if (warnedPending) {
      console.info(`${CLIENT_LOG_TAG} 右栏页已注册：${SIDEBAR_TAB_SERVICE} / ${SIDEBAR_SERVICE} 已到位，此前那条「等待超时」告警已解除`);
    }
  };

  // ⑥ 注册（缺陷 C 的修法）：**一律登记惰性注入**，不再同步 `softGet` 一次就早退。
  //    真机时序：本包的模块级 `inject` 只有 `['slots']` ⇒ 本插件 fiber 早早启动；而
  //    `sidebarRightTabs` / `sidebarRight` 由官方 `dsh-client-ui-sidebar-right` 提供，那家自己
  //    `inject` 了 7 个服务（slots/layout/locale/resources/sessions/uiSession/shortcuts）且在
  //    `apply` **中段**才 `provide` ⇒ 我们 `apply` 的时刻它们大概率还没到。旧写法在这里同步
  //    检查后直接 `return`，下面的 `ctx.inject` **永远执行不到** ⇒ 页不出现、无请求、零告警。
  //    （`dsh.client.inject` 官方说明原文只是 *order activation* ⇒ 它**不保证服务就绪**。）
  if (typeof ctx.inject === 'function') collect(ctx.inject([SIDEBAR_TAB_SERVICE, SIDEBAR_SERVICE], register));
  else register(ctx);

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        // 拆插件时连「等太久」的告警一起撤掉（否则卸载后还会冒一条无主的 warn）
        cancelPendingWarn();
        for (const dispose of disposers.splice(0).reverse()) dispose();
      },
      'dsh-wsl-docker-ports: right-pane tab',
    );
  }

  if (registeredPage) return { registered: true, pageId: PAGE_ID, kind: PAGE_KIND, seats: [TAB_SLOT, TAB_TITLE_SLOT], styles: 'dsh-wsl-docker-ports/styles' };

  if (injectFired) {
    return {
      registered: false,
      reason: 'sidebar-right-unavailable',
      message: `宿主未声明右栏页服务：${lastMissing.join(' / ')} —— 本包不注册页面，也不报错（只读事实层仍可用）`,
      missing: lastMissing,
    };
  }

  // 登记了惰性注入但服务还没到：**此刻确实没注册**（不谎报），但这不是失败 —— 服务一到就会注册。
  // 🔴 这里**不打 warn**：真机上「晚到 ~240ms」是常态（见 DEFAULT_PENDING_WARN_MS），
  //    正常路径上打 warn 会把真告警训练成噪音。改为排定一条**超时才响**的告警。
  schedulePendingWarn();
  return {
    registered: false,
    reason: 'sidebar-right-pending',
    deferred: true,
    message: `已登记惰性注入等 ${SIDEBAR_TAB_SERVICE} / ${SIDEBAR_SERVICE} 到位：服务一到即注册页与两个 seat，此刻尚未注册（不是失败）`,
    missing: [],
  };
}