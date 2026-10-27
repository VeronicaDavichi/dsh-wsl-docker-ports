/**
 * **本包客户端半的装配面**（016：容器包自己的，一个页、一条管道、一个 chunk）
 *
 * ## 这里放什么、不放什么
 *
 * - **放**：注册**壳**（两个 chunk 座位组件、本命名空间的配置管道、本包会话凭据键、配置槽、
 *   页类型注册、`openTab`）。
 * - **不放**：任何 UI / 取数 / 渲染 —— 那些全在 `client.containers.js` 这个 chunk 里。
 *
 * ## 016 相对 015 的收敛（拆包直接带来的）
 *
 * 015 时容器侧和转发侧同处一个主包 ⇒ 必须**探活**（`GET …/health`）来判定「容器行没启用」，
 * 确证 404 才撤页。016 起容器行是**独立包**：行没启用 ⇒ 宿主根本不加载本包的 `client.js`，
 * 页面自然不会出现 ⇒ 探活与「撤页」逻辑整段删除（少一次启动请求、少一条失败路径）。
 *
 * ## 一次性造出、三处使用
 *
 * `createSurface()` 返回 `{ runtime, registerConfig, registerTab }`：`runtime` 要早造
 * （配置页与右栏页共用同一个对象），注册动作分两次调用（配置槽在 `apply` 里，右栏页等 `sidebarRightTabs` 到位）。
 */

import { createElement, type ReactElement } from 'react';

import { ChunkBoot, type ChunkSeatModule } from './chunk-degrade.ts';
import { registerConfigSlot } from './config-slot.ts';
import type { ConfigSlotContext } from './config-slot.ts';
import type { ContainersRuntime } from './containers/runtime.ts';
import type {
  ClientApplyOptions,
  ClientContextLike,
  ClientTimers,
  RemoteSettingsLike,
  SidebarRightServiceLike,
  SidebarRightTabsServiceLike,
  SlotsServiceLike,
} from './host.ts';
import { createSettingsPipe } from './settings-pipe.ts';
import { PAGE_ID, PAGE_KIND, PAGE_TITLE, containersTabDefinition, registerTabSeats } from './tab-def.ts';
import { defaultSessionStorage } from './write-token.ts';

declare const require: {
  (id: string): unknown;
  async<T = unknown>(id: string): Promise<T>;
};

/** 容器页 chunk 说明符（= `scripts/build-client.mjs` 的产物名 = `chunk-containers.ts` 的产物名） */
export const CONTAINERS_CHUNK = './client.containers.js';

/** 取块（失败由 `ChunkBoot` 接住并给原因 + 重试） */
const loadContainersChunk = (spec: string): Promise<ChunkSeatModule> => require.async(spec) as Promise<ChunkSeatModule>;

/**
 * 座位工厂（两个座位只差 `exportName` 与标题 ⇒ 合一个工厂，主包按字节算，重复的那份不写两遍）。
 * 座位本身**只负责取块**，组件本体在 chunk 里。
 */
const seat =
  (exportName: string, title: string) =>
  (props: { readonly runtime?: ContainersRuntime }): ReactElement =>
    createElement(ChunkBoot, {
      spec: CONTAINERS_CHUNK,
      exportName,
      title,
      load: loadContainersChunk,
      paneProps: props as unknown as Record<string, unknown>,
    });

/** 右栏容器页座位 */
export const ContainersPaneSeat = seat('ContainersPane', PAGE_TITLE);

/** 容器行配置页座位（同一个 chunk，取另一个导出名） */
export const ContainersConfigSeat = seat('ContainersConfigPage', `${PAGE_TITLE} · 配置`);

/**
 * 按 kind 打开容器页（**注册类型不会产生页签**：真机 2026-10-23 两次复现）。
 *
 * 纪律：**只试有限次、绝不订阅宿主 store**。
 * 🔴 事故原话：早先版本在 `openTab` 抛错时用 `sidebarRight.mounted.subscribe(...)` 递归重试，
 * 而宿主那个快照 store 的订阅回调并非「只响一次」⇒「抛错 → 再订阅 → 回调 → 再抛错」自激成风暴，
 * **renderer 直接崩**。⇒ 改成**有限次定时重试**，与宿主 store 彻底解耦；彻底失败的兜底仍是
 * 引导页胶囊（用户点一下同样能开）。
 */
const OPEN_RETRY_MS = 300;
const OPEN_RETRY_MAX = 6;

/**
 * 全局定时器（**必须包一层**）。
 * 🔴 真机实证：把 `setTimeout` 直接塞进对象再当方法调用会让 `this` 变成那个对象，浏览器抛
 * **`TypeError: Illegal invocation`**。包成箭头函数，接收者仍是 `window`。
 */
const GLOBAL_TIMERS: ClientTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as number),
};

export function openContainersPage(sidebar: SidebarRightServiceLike | undefined, timers: ClientTimers): void {
  const attempt = (left: number): void => {
    try {
      sidebar?.openTab?.(PAGE_KIND);
    } catch {
      // 还没有在屏会话 ⇒ 稍后再试（有限次；幂等：`multiple:false` ⇒ 每次成功都只 reveal 同一页）
      if (left > 0) timers.setTimeout(() => attempt(left - 1), OPEN_RETRY_MS);
    }
  };
  attempt(OPEN_RETRY_MAX);
}

export interface ContainersSurface {
  readonly runtime: ContainersRuntime;
  /** 注册容器行**配置槽**（键 = 容器行 id；失败只降级、不抛） */
  readonly registerConfig: (ctx: ClientContextLike) => void;
  /** 注册右栏页 + 两个 seat，并把页签开出来；返回 disposer（调用方挂 `ctx.effect`） */
  readonly registerTab: (
    tabs: SidebarRightTabsServiceLike,
    slots: SlotsServiceLike,
    sidebar?: SidebarRightServiceLike | undefined,
  ) => (() => void)[];
}

export function createSurface(
  ctx: ClientContextLike,
  options: ClientApplyOptions,
  softGet: <T>(scope: ClientContextLike, name: string) => T | undefined,
  logTag: string,
): ContainersSurface {
  // 本包命名空间（`dsh-wsl-docker-containers`）：与转发侧**各走各的** ⇒ 凭据互不通用
  const settings = createSettingsPipe(() => softGet<RemoteSettingsLike>(ctx, 'remote.settings'), PAGE_ID);
  const tokenKey = `${PAGE_ID}.writeToken`;
  const readToken = (): string | undefined => {
    try {
      const raw = (options.sessionStorage ?? defaultSessionStorage())?.getItem(tokenKey) ?? null;
      const text = raw === null ? '' : raw.trim();
      return text === '' ? undefined : text;
    } catch {
      return undefined;
    }
  };
  const saveToken = (value: string): void => {
    try {
      (options.sessionStorage ?? defaultSessionStorage())?.setItem(tokenKey, value);
    } catch {
      // 存储被禁（隐私模式）⇒ 本次会话存不了凭据；页面会如实提示，不抛
    }
  };
  /**
   * `fetchImpl` **只转发**注入值：缺省由 chunk 侧回落全局 `fetch`（`containers/pane.tsx` 的 `deps`）。
   * 这条分工写在 `containers/runtime.ts` 的契约里 ⇒ 主包不为它花字节。
   */
  const runtime: ContainersRuntime = {
    baseUrl: options.routeBaseUrl ?? '',
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    token: readToken,
    saveToken,
    settings: () => settings,
  };

  return {
    runtime,
    registerConfig: (scope: ClientContextLike): void => {
      const configSeat = (): ReactElement => createElement(ContainersConfigSeat, { runtime });
      const slot = registerConfigSlot(scope as unknown as ConfigSlotContext, configSeat as unknown as (props: never) => unknown, PAGE_ID);
      if (!slot.registered) console.warn(`${logTag} 容器行配置页未注册：${slot.reason ?? '原因未记录'}`);
    },
    registerTab: (tabs: SidebarRightTabsServiceLike, slots: SlotsServiceLike, sidebar?: SidebarRightServiceLike | undefined): (() => void)[] => {
      const disposers: (() => void)[] = [];
      const keep = (disposer: unknown): void => {
        if (typeof disposer === 'function') disposers.push(disposer as () => void);
      };
      keep(tabs.register(containersTabDefinition()));
      for (const disposer of registerTabSeats(
        slots,
        () => createElement(ContainersPaneSeat, { runtime }),
        () => createElement('span', { className: 'wdp-tab-title' }, PAGE_TITLE),
        PAGE_ID,
      )) {
        keep(disposer);
      }
      // 页类型已在册 ⇒ 把页签开出来（否则用户只能自己去引导页里点）
      openContainersPage(sidebar, options.timers ?? GLOBAL_TIMERS);
      return disposers;
    },
  };
}
