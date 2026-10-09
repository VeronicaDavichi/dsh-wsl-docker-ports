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
 * 并把降级/等待写成 `console.warn`（可见性：真机那次的「0 warning」让缺陷查无可查）。
 *
 * ## 降级不是一个 catch 分支，而是返回值的一部分
 *
 * `apply()` 返回判别联合：`registered: true` 或 `registered: false` + `reason` + `missing` + `message`；
 * `reason` 四态：`slots-missing` / `ports-source-missing` / `sidebar-right-pending`（等服务）/ `sidebar-right-unavailable`（确证缺）。
 * 于是每条降级路径都可以被**逐条断言**，而不是靠「反正没崩」来证明。
 */

import { createElement } from 'react';

import {
  CLIENT_SERVICES,
  SIDEBAR_SERVICE,
  SIDEBAR_TAB_SERVICE,
  type ClientApplyOptions,
  type ClientContextLike,
  type ClientRuntime,
  type PortsSource,
  type RemoteSettingsLike,
  type SidebarRightTabsServiceLike,
  type SlotsServiceLike,
} from './host.ts';
import { PortsPane } from './pane.tsx';
import { PAGE_ID, PAGE_KIND, PAGE_TITLE, TAB_SLOT, TAB_TITLE_SLOT, portsTabDefinition, registerTabSeats } from './rows.ts';
import { createRouteSource } from './route-source.ts';
import { createSettingsPipe } from './settings-pipe.ts';
import { installStylesWith } from './styles.ts';

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
  };

  const disposers: (() => void)[] = [];
  const collect = (disposer: unknown): void => {
    if (typeof disposer === 'function') disposers.push(disposer as () => void);
  };

  let registeredPage = false;
  /** 注入回调**真的跑过**（= 两个服务到过位）—— 与「还没到」是两回事，别混 */
  let injectFired = false;
  let lastMissing: string[] = [];

  const register = (scope: ClientContextLike): void => {
    injectFired = true;
    const tabs = softGet<SidebarRightTabsServiceLike>(scope, SIDEBAR_TAB_SERVICE);
    const sidebar = softGet<unknown>(scope, SIDEBAR_SERVICE);
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
      () => createElement(PortsPane, { runtime }),
      () => createElement('span', { className: 'wdp-tab-title' }, PAGE_TITLE),
    )) {
      collect(disposer);
    }
    registeredPage = true;
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

  // 登记了惰性注入但服务还没到：**此刻确实没注册**（不谎报），但这不是失败 —— 服务一到就会注册
  console.warn(`${CLIENT_LOG_TAG} 右栏页尚未注册：已登记 ctx.inject(['${SIDEBAR_TAB_SERVICE}', '${SIDEBAR_SERVICE}']) 等宿主服务到位（惰性注入的常态；若页面始终不出现，看这一行）`);
  return {
    registered: false,
    reason: 'sidebar-right-pending',
    deferred: true,
    message: `已登记惰性注入等 ${SIDEBAR_TAB_SERVICE} / ${SIDEBAR_SERVICE} 到位：服务一到即注册页与两个 seat，此刻尚未注册（不是失败）`,
    missing: [],
  };
}
