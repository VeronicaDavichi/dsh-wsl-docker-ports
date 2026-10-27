/**
 * **容器侧的注册面**（015 `P4`）—— 从 `index.ts` 拆出来的一段，只为让入口回到
 * 「一屏读得完」的规模（`T6.4`：单文件 ≤ 400 行是 SHALL）。
 *
 * ## 这里放什么、不放什么
 *
 * - **放**：第二套注册**壳**（两个 chunk 座位组件、容器侧命名空间的配置管道、独立会话凭据键、
 *   配置槽、探活与「确证 404 才撤页」）。
 * - **不放**：任何 UI / 取数 / 渲染 —— 那些全在 `client.containers.js` 这个 chunk 里。
 *
 * ## 一次性造出、三处使用
 *
 * `createContainersSurface()` 返回 `{ runtime, registerConfig, registerTab }`：
 * `runtime` 要早造（配置页与右栏页共用同一个对象），注册动作分两次调用
 * （配置槽在 `apply` 里，右栏页要等 `sidebarRightTabs` 到位）。
 */

import { createElement, type ReactElement } from 'react';

import { ChunkBoot, type ChunkSeatModule } from './chunk-degrade.ts';
import type { ContainersRuntime } from './containers/runtime.ts';
import { registerConfigSlot } from './config-slot.ts';
import type { ConfigSlotContext } from './config-slot.ts';
import { probeHealth } from './health-probe.ts';
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
import { CONTAINERS_PAGE_ID, CONTAINERS_PAGE_KIND, CONTAINERS_PAGE_TITLE, containersTabDefinition, registerTabSeats } from './tab-def.ts';
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
export const ContainersPaneSeat = seat('ContainersPane', CONTAINERS_PAGE_TITLE);

/** 容器行配置页座位（同一个 chunk，取另一个导出名） */
export const ContainersConfigSeat = seat('ContainersConfigPage', 'WSL Docker 容器 · 配置');

export interface ContainersSurface {
  readonly runtime: ContainersRuntime;
  /** 注册容器行**配置槽**（键 = 容器行 id；失败只降级、不抛） */
  readonly registerConfig: (ctx: ClientContextLike) => void;
  /**
   * 注册右栏页 + 两个 seat，排定后台探活，并在 `health` 不是 404 时**真的把页签开出来**；
   * 返回 disposer（调用方挂 `ctx.effect`）。
   */
  readonly registerTab: (
    tabs: SidebarRightTabsServiceLike,
    slots: SlotsServiceLike,
    sidebar?: SidebarRightServiceLike | undefined,
  ) => (() => void)[];
}

/**
 * 按 kind 打开容器页（**注册类型不会产生页签**，见 `SidebarRightServiceLike` 的注释）。
 *
 * 纪律：**只试有限次、绝不订阅宿主 store**。
 * 🔴 2026-10-23 真机事故（两次复现）：早先版本在 `openTab` 抛错时用
 * `sidebarRight.mounted.subscribe(...)` 递归重试（失败即再订阅一次）。宿主那个快照 store 的
 * 订阅回调并非「只响一次」，于是「抛错 → 再订阅 → 回调 → 再抛错」自激成风暴，**renderer 直接崩**
 * （CDP 既无法求值也无法暂停 ⇒ 不是 JS 死循环，是崩溃）。⇒ 改成**有限次定时重试**，与宿主
 * store 彻底解耦；彻底失败的兜底仍是引导页胶囊（用户点一下同样能开）。
 *
 * 为什么需要重试：`apply` 期间容器页类型刚注册，宿主 `require()` 可能还没有在屏会话
 * （抛 `sidebarRight: no session surface is mounted`）—— 实测首屏那一刻正是这种情况。
 */
const OPEN_RETRY_MS = 300;
const OPEN_RETRY_MAX = 6;

/**
 * 全局定时器（**必须包一层**）。
 * 🔴 真机实证：把 `setTimeout` 直接塞进对象再当方法调用（`timers.setTimeout(...)`）会让 `this`
 * 变成那个对象，浏览器抛 **`TypeError: Illegal invocation`** —— 页签没开成、异常还进了控制台。
 * 包成箭头函数，接收者仍是 `window`。
 */
const GLOBAL_TIMERS: ClientTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as number),
};

function openContainersPage(sidebar: SidebarRightServiceLike | undefined, timers: ClientTimers): void {
  const attempt = (left: number): void => {
    try {
      sidebar?.openTab?.(CONTAINERS_PAGE_KIND);
    } catch {
      // 还没有在屏会话 ⇒ 稍后再试（有限次；幂等：`multiple:false` ⇒ 每次成功都只 reveal 同一页）
      if (left > 0) timers.setTimeout(() => attempt(left - 1), OPEN_RETRY_MS);
    }
  };
  attempt(OPEN_RETRY_MAX);
}

/**
 * 造容器侧的注册面。
 *
 * ⚠️ 探活判据：单测里没有真实宿主路由 ⇒ 只有**显式注入 `fetchImpl`** 时（测试自带的假件，天然
 * 无网络）才在 Node 里探活；浏览器里一律用全局 `fetch` 真探。
 */
export function createContainersSurface(
  ctx: ClientContextLike,
  options: ClientApplyOptions,
  softGet: <T>(scope: ClientContextLike, name: string) => T | undefined,
  logTag: string,
): ContainersSurface {
  // 容器侧命名空间：两行共用同一份 `Config`，但读写各走各的 ns ⇒ 必须另造一条管道
  const settings = createSettingsPipe(() => softGet<RemoteSettingsLike>(ctx, 'remote.settings'), CONTAINERS_PAGE_ID);
  const tokenKey = `${CONTAINERS_PAGE_ID}.writeToken`;
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
   * 这条分工写在 `containers/runtime.ts:17` 的契约里（「缺省用全局 fetch」）⇒ 主包不为它花字节。
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
      const seat = (): ReactElement => createElement(ContainersConfigSeat, { runtime });
      const slot = registerConfigSlot(scope as unknown as ConfigSlotContext, seat as unknown as (props: never) => unknown, CONTAINERS_PAGE_ID);
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
        () => createElement('span', { className: 'wdp-tab-title' }, CONTAINERS_PAGE_TITLE),
        CONTAINERS_PAGE_ID,
      )) {
        keep(disposer);
      }
      const inNode = typeof process !== 'undefined' && (process as { versions?: { node?: string } }).versions?.node !== undefined;
      if (!inNode || options.fetchImpl !== undefined) {
        void probeHealth({ fetchImpl: options.fetchImpl, baseUrl: options.routeBaseUrl ?? '' }).then((verdict) => {
          if (verdict === 'missing') {
            console.info(`${logTag} 容器行未启用（${CONTAINERS_PAGE_ID}/health 404）⇒ 撤掉容器页`);
            for (const dispose of disposers.splice(0).reverse()) dispose();
            return;
          }
          // 页类型已在册 ⇒ 把页签开出来（否则用户只能自己去引导页里点，见真机缺陷 2026-10-23）
          openContainersPage(sidebar, options.timers ?? GLOBAL_TIMERS);
        });
      }
      return disposers;
    },
  };
}
