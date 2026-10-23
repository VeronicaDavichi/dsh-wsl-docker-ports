/**
 * **2026-10-23 真机缺陷的回归判据**：容器页「注册了但看不见 / 点开了但空表 / 一开就崩」。
 *
 * ## 三个 bug，三条判据
 *
 * 1. **页签不出现**：真机 `performance` 里有 `/dsh-wsl-docker-containers/health`（⇒ `registerTab`
 *    真跑过），控制台 0 日志，右栏却只有「WSL Docker 端口」一个页签。根因**不在注册**：宿主
 *    `SidebarRightTabRegistry.register` 只把**类型**放进注册表 + 刷 `guide()`，**不创建 tab**；
 *    tab 是布局记录（`dsh.sidebar-right.v1.session-*` 的 `layout.tabs`），只由 `openTab` /
 *    guide 胶囊 / `defaultSeed` 产生。旧代码从头到尾没调过 `openTab` ⇒ 页签只可能出现在用户
 *    自己点引导页之后（真机已验：点「容器」胶囊能开）。
 * 2. **点开也空表**：`runtime` 只转发 `options.fetchImpl`，生产路径（`apply(ctx)` 无 options）下
 *    它就是 `undefined` ⇒ 容器页第一屏写「没有可用的 fetch」并**零请求**。缺省回落属 chunk
 *    （`containers/pane.tsx` 的 `deps`），由 `tests/client/containers-pane.test.tsx` 用真 DOM 证。
 * 3. **一开就崩**（本条最贵）：最初的修法在 `openTab` 抛错时用 `sidebarRight.mounted.subscribe(...)`
 *    递归重试。宿主那个快照 store 的订阅回调并非「只响一次」⇒「抛错 → 再订阅 → 回调 → 再抛错」
 *    自激成风暴，**renderer 直接崩**（真机两次复现：CDP 既无法求值也无法暂停）。⇒ 判据：
 *    **一个 `mounted.subscribe` 都不许有**，改用有限次定时重试。
 *
 * ## 判据为什么是「注册调用的参数与顺序」
 *
 * jsdom 里没有宿主 `sidebarRightTabs` / `sidebarRight` 的**真实**实现（注册表 / 布局 / `require()`），
 * 复刻它们只会测复刻品。能在离线钉死、且**旧代码必红**的最小判据是调用轨迹：
 * `tabs.register(id)` → `slots.register(TAB, key)` → `slots.register(TAB_TITLE, key)` → `sidebar.openTab(kind)`
 * —— 不依赖宿主内部结构。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createContainersSurface } from '../../src/client/containers-surface.ts';
import type { ClientApplyOptions, ClientContextLike, SidebarRightServiceLike, SlotsServiceLike } from '../../src/client/host.ts';
import { CONTAINERS_PAGE_ID, CONTAINERS_PAGE_KIND, TAB_SLOT, TAB_TITLE_SLOT } from '../../src/client/tab-def.ts';
import type { FetchLike } from '../../src/wire.ts';

interface Call {
  readonly text: string;
}

interface Harness {
  readonly ctx: ClientContextLike;
  readonly calls: Call[];
  readonly openTabArgs: { readonly kind: string; readonly options: unknown }[];
  /** 宿主 store 的订阅次数 —— 🔴 必须恒为 0（真机崩溃根因） */
  readonly mountSubscribes: () => number;
  readonly setMounted: (sessionId: string | undefined) => void;
}

function fakeFetch(status: number, body: unknown): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function harness(options: { readonly mountedSession?: string | undefined } = {}): Harness {
  const calls: Call[] = [];
  const openTabArgs: { readonly kind: string; readonly options: unknown }[] = [];
  let mountSubscribes = 0;
  let mounted = options.mountedSession;
  const push = (text: string): void => {
    calls.push({ text });
  };
  const tabs = {
    register: (definition: { readonly id: string }) => {
      push(`tab:${definition.id}`);
      return () => push(`unregister-tab:${definition.id}`);
    },
  };
  const slots: SlotsServiceLike = {
    register: (registerOptions) => {
      push(`seat:${String(registerOptions.name)}@${String(registerOptions.key ?? '')}`);
      return () => push(`unregister-seat:${String(registerOptions.key ?? '')}`);
    },
    inject: (_name, callback) => {
      const disposer = callback();
      return typeof disposer === 'function' ? disposer : () => undefined;
    },
  };
  const sidebar: SidebarRightServiceLike = {
    // 宿主 `require()`：没有在屏会话就**抛**（`sidebarRight: no session surface is mounted`）
    openTab: (kind, openOptions) => {
      if (mounted === undefined) throw new Error('sidebarRight: no session surface is mounted');
      openTabArgs.push({ kind, options: openOptions });
      push(`open:${kind}`);
    },
    mounted: {
      getSnapshot: () => mounted,
      subscribe: () => {
        // 🔴 真机事故：只要走到这里，就有可能被自激风暴拖垮 renderer ⇒ 用例直接判红
        mountSubscribes += 1;
        return () => undefined;
      },
    },
  };
  const merged: Record<string, unknown> = { slots, sidebarRightTabs: tabs, sidebarRight: sidebar };
  const ctx: ClientContextLike = { get: (serviceName: string) => merged[serviceName] };
  return {
    ctx,
    calls,
    openTabArgs,
    mountSubscribes: () => mountSubscribes,
    setMounted: (sessionId) => {
      mounted = sessionId;
    },
  };
}

/** 让探活的 promise 链跑完（`probeHealth` → `.then`），不 sleep */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const softGet = <T>(scope: ClientContextLike, serviceName: string): T | undefined => scope.get?.(serviceName) as T | undefined;

function surfaceOf(rig: Harness, options: ClientApplyOptions = {}) {
  return createContainersSurface(rig.ctx, options, softGet, '[test]');
}

function servicesOf(rig: Harness): {
  tabs: { register: (definition: { readonly id: string }) => () => void };
  slots: SlotsServiceLike;
  sidebar: SidebarRightServiceLike;
} {
  return {
    tabs: rig.ctx.get?.('sidebarRightTabs') as { register: (definition: { readonly id: string }) => () => void },
    slots: rig.ctx.get?.('slots') as SlotsServiceLike,
    sidebar: rig.ctx.get?.('sidebarRight') as SidebarRightServiceLike,
  };
}

const HEALTH_OK = { ok: true, side: 'containers', rowId: CONTAINERS_PAGE_ID, v: 1 };

test('缺陷 ①：health 200 ⇒ 注册类型 + 两个 seat，并**主动 openTab(kind)**（旧代码永不调 openTab）', async () => {
  const rig = harness({ mountedSession: 'session-1' });
  const surface = surfaceOf(rig, { fetchImpl: fakeFetch(200, HEALTH_OK) });
  const { tabs, slots, sidebar } = servicesOf(rig);

  surface.registerTab(tabs, slots, sidebar);
  await flush();

  assert.deepEqual(
    rig.calls.map((call) => call.text),
    [`tab:${CONTAINERS_PAGE_ID}`, `seat:${TAB_SLOT}@${CONTAINERS_PAGE_ID}`, `seat:${TAB_TITLE_SLOT}@${CONTAINERS_PAGE_ID}`, `open:${CONTAINERS_PAGE_KIND}`],
  );
  assert.equal(rig.openTabArgs.length, 1, '恰好开一次（`multiple:false` ⇒ 重复 openTab 只 reveal）');
  assert.equal(rig.openTabArgs[0]?.kind, 'wslDockerContainers');
  assert.equal(CONTAINERS_PAGE_ID, 'dsh-wsl-docker-containers');
  assert.equal(rig.mountSubscribes(), 0, '🔴 必须直连 `openTab`、不经宿主 store（崩溃根因）');
});

test('缺陷 ②：主包只**转发**注入的 fetchImpl（缺省回落由 chunk 侧做，见 containers-pane.test.tsx）', () => {
  const surface = surfaceOf(harness({}));
  assert.equal(surface.runtime.fetchImpl, undefined);
  const injected = fakeFetch(200, {});
  assert.equal(surfaceOf(harness({}), { fetchImpl: injected }).runtime.fetchImpl, injected);
  const scoped = surfaceOf(harness({}), { routeBaseUrl: '/base/' });
  assert.equal(scoped.runtime.baseUrl, '/base/');
});

test('缺陷 ③：在屏会话晚到 ⇒ **有限次定时重试**，且一个 `mounted.subscribe` 都不许有', async () => {
  const rig = harness({ mountedSession: undefined });
  const scheduled: { readonly callback: () => void; readonly ms: number }[] = [];
  const timers = {
    setTimeout: (callback: () => void, ms: number) => {
      scheduled.push({ callback, ms });
      return scheduled.length;
    },
    clearTimeout: () => undefined,
  };
  const surface = surfaceOf(rig, { fetchImpl: fakeFetch(200, HEALTH_OK), timers });
  const { tabs, slots, sidebar } = servicesOf(rig);

  surface.registerTab(tabs, slots, sidebar);
  await flush();

  assert.equal(rig.openTabArgs.length, 0, '首屏没有在屏会话 ⇒ openTab 抛，被吞掉（不炸 apply 的返回值）');
  assert.equal(rig.mountSubscribes(), 0, '🔴 一个订阅都不许有：真机就是这一个把 renderer 搞崩的');
  assert.deepEqual(scheduled.map((slot) => slot.ms), [300], '抛错后必须排一次重试');

  rig.setMounted('session-1');
  scheduled[0]?.callback();
  assert.equal(rig.openTabArgs.length, 1, '会话挂上后重试成功');
  assert.equal(rig.openTabArgs[0]?.kind, CONTAINERS_PAGE_KIND);
  assert.equal(scheduled.length, 1, '成功即停：不许继续排');
  assert.equal(rig.mountSubscribes(), 0);
});

test('缺陷 ③ 补：重试是**有界**的（一直抛错就放弃，不无限自旋）', async () => {
  const rig = harness({ mountedSession: undefined });
  const scheduled: { callback: () => void }[] = [];
  const timers = {
    setTimeout: (callback: () => void) => {
      scheduled.push({ callback });
      return scheduled.length;
    },
    clearTimeout: () => undefined,
  };
  const surface = surfaceOf(rig, { fetchImpl: fakeFetch(200, HEALTH_OK), timers });
  const { tabs, slots, sidebar } = servicesOf(rig);
  surface.registerTab(tabs, slots, sidebar);
  await flush();

  // 把排出来的回调逐个执行（每个回调失败后再排下一个），直到不再排新的
  let executed = 0;
  while (scheduled.length > executed && executed < 50) {
    const slot = scheduled[executed];
    executed += 1;
    slot?.callback();
  }
  assert.equal(scheduled.length, 6, '最多 6 次重试（300ms × 6 ≈ 1.8s）后放弃');
  assert.equal(rig.openTabArgs.length, 0);
  assert.equal(rig.mountSubscribes(), 0);
});

test('health 404 ⇒ **撤页**（类型与两个 seat 全撤、一次 openTab 都不许有）：转发页不受影响', async () => {
  const rig = harness({ mountedSession: 'session-1' });
  const surface = surfaceOf(rig, { fetchImpl: fakeFetch(404, undefined) });
  const { tabs, slots, sidebar } = servicesOf(rig);

  const disposers = surface.registerTab(tabs, slots, sidebar);
  await flush();

  assert.equal(rig.openTabArgs.length, 0, '确证 404 ⇒ 不许开出容器页（否则留一个点开就报错的死页签）');
  assert.deepEqual(
    rig.calls.map((call) => call.text).filter((text) => text.startsWith('unregister-')),
    [`unregister-seat:${CONTAINERS_PAGE_ID}`, `unregister-seat:${CONTAINERS_PAGE_ID}`, `unregister-tab:${CONTAINERS_PAGE_ID}`],
  );
  assert.deepEqual(disposers, [], '撤页后不该再留任何 disposer（重复撤会二次 unregister）');
  assert.equal(rig.mountSubscribes(), 0);
});
