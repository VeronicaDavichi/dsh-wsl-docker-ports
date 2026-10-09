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
 *    所以 `sidebarRightTabs` / `sidebarRight` / `remote.settings` 一律 `ctx.get(...)` **软取**，
 *    缺失就降级并**给出原因**（REQ-10.3 的口径），绝不抛异常。
 *
 * ## 降级不是一个 catch 分支，而是返回值的一部分
 *
 * `apply()` 返回判别联合：`registered: true` 或 `registered: false` + `reason` + `missing` + `message`。
 * 于是「宿主没声明这些服务 ⇒ 不注册、给原因、不抛异常」可以被**逐条断言**，
 * 而不是靠「反正没崩」来证明。
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

export type ClientDegradeReason = 'slots-missing' | 'ports-source-missing' | 'sidebar-right-unavailable';

export type ClientApplyResult =
  | { readonly registered: true; readonly pageId: string; readonly kind: string; readonly seats: readonly string[]; readonly styles: string }
  | { readonly registered: false; readonly reason: ClientDegradeReason; readonly message: string; readonly missing: readonly string[] };

function softGet<T>(ctx: ClientContextLike, serviceName: string): T | undefined {
  if (typeof ctx.get !== 'function') return undefined;
  const value = ctx.get(serviceName);
  return value === undefined || value === null ? undefined : (value as T);
}

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

  // ⑤ 右栏页服务：缺失 ⇒ 不注册 + 给原因（REQ-10.3）
  const missing: string[] = [];
  if (softGet<SidebarRightTabsServiceLike>(ctx, SIDEBAR_TAB_SERVICE) === undefined) missing.push(SIDEBAR_TAB_SERVICE);
  if (softGet<unknown>(ctx, SIDEBAR_SERVICE) === undefined) missing.push(SIDEBAR_SERVICE);
  if (missing.length > 0) {
    return {
      registered: false,
      reason: 'sidebar-right-unavailable',
      message: `宿主未声明右栏页服务：${missing.join(' / ')} —— 本包不注册页面，也不报错（只读事实层仍可用）`,
      missing,
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

  const register = (scope: ClientContextLike): void => {
    const tabs = softGet<SidebarRightTabsServiceLike>(scope, SIDEBAR_TAB_SERVICE);
    if (tabs !== undefined) collect(tabs.register(portsTabDefinition()));
    const scopedSlots = softGet<SlotsServiceLike>(scope, 'slots') ?? slots;
    // `register` 返回**幂等 disposer**（contract §C9/§C11）：重复注册同一 `id` 不会产生第二个页
    for (const disposer of registerTabSeats(
      scopedSlots,
      () => createElement(PortsPane, { runtime }),
      () => createElement('span', { className: 'wdp-tab-title' }, PAGE_TITLE),
    )) {
      collect(disposer);
    }
  };

  if (typeof ctx.inject === 'function') ctx.inject([SIDEBAR_TAB_SERVICE, SIDEBAR_SERVICE], register);
  else register(ctx);

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        for (const dispose of disposers.splice(0).reverse()) dispose();
      },
      'dsh-wsl-docker-ports: right-pane tab',
    );
  }

  return { registered: true, pageId: PAGE_ID, kind: PAGE_KIND, seats: [TAB_SLOT, TAB_TITLE_SLOT], styles: 'dsh-wsl-docker-ports/styles' };
}
