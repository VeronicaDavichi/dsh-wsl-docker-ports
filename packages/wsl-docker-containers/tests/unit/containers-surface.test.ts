/**
 * **容器包客户端装配面的判据**（016 从转发包的 `containers-surface.test.ts` 收窄而来）
 *
 * ## 判据为什么是「注册调用的参数与顺序」
 *
 * jsdom 里没有宿主 `sidebarRightTabs` / `sidebarRight` 的**真实**实现（注册表 / 布局 / `require()`），
 * 复刻它们只会测复刻品。能在离线钉死、且**旧代码必红**的最小判据是调用轨迹：
 * `tabs.register(id)` → `slots.register(TAB, key)` → `slots.register(TAB_TITLE, key)` → `sidebar.openTab(kind)`
 * —— 不依赖宿主内部结构。
 *
 * ## 三条从 015 继承、一条因拆包消失
 *
 * 1. **页签不出现**：宿主 `SidebarRightTabRegistry.register` 只把**类型**放进注册表 + 刷 `guide()`，
 *    **不创建 tab**；tab 是布局记录，只由 `openTab` / guide 胶囊 / `defaultSeed` 产生 ⇒ 必须主动
 *    `openTab`（真机 2026-10-23 两次复现）。
 * 2. **点开也空表**：`runtime` 只转发 `options.fetchImpl`；缺省回落属 chunk（`containers/pane.tsx`
 *    的 `deps`），由 `tests/client/containers-pane.test.tsx` 用真 DOM 证。
 * 3. **一开就崩**：`openTab` 抛错时**绝不许**订阅 `sidebarRight.mounted`（自激风暴把 renderer 搞崩，
 *    真机两次复现）⇒ 只允许**有限次定时重试**。
 * 4. ~~health 404 ⇒ 撤页~~ **本条随 016 删除**：容器行成为独立包后，行没启用 ⇒ 宿主根本不加载本包的
 *    `client.js`，页面自然不会出现 ⇒ 探活与撤页整段删除（少一次启动请求、少一条失败路径）。
 *    取而代之的判据是**「注册路径一个请求都不发」**（下方第 1 条用例反向钉死：给了会炸的
 *    `fetchImpl`，但注册全程不许调用它）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ClientApplyOptions, ClientContextLike, FetchLike, RemoteSettingsLike, SettingsResponse, SidebarRightServiceLike, SlotsServiceLike } from '../../src/client/host.ts';
import { createSurface } from '../../src/client/surface.ts';
import { PAGE_ID, PAGE_KIND, TAB_SLOT, TAB_TITLE_SLOT } from '../../src/client/tab-def.ts';

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

/** 一旦被调用就判红：注册路径**不许发任何请求**（016 删掉了 health 探活） */
const FETCH_MUST_NOT_RUN: FetchLike = async () => {
  throw new Error('注册路径发了请求：容器包不再探活，任何启动期请求都是回归');
};

function fakeFetch(status: number, body: unknown): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
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

const softGet = <T>(scope: ClientContextLike, serviceName: string): T | undefined => scope.get?.(serviceName) as T | undefined;

function surfaceOf(rig: Harness, options: ClientApplyOptions = {}) {
  return createSurface(rig.ctx, options, softGet, '[test]');
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

test('拆包后**无探活**：注册即成功 + 主动 openTab + 零 store 订阅 + **零请求**', async () => {
  const rig = harness({ mountedSession: 'session-1' });
  // 注入「一碰就炸」的 fetchImpl：注册路径若还在探活，本用例必红
  const surface = surfaceOf(rig, { fetchImpl: FETCH_MUST_NOT_RUN });
  const { tabs, slots, sidebar } = servicesOf(rig);

  surface.registerTab(tabs, slots, sidebar);

  assert.deepEqual(
    rig.calls.map((call) => call.text),
    [`tab:${PAGE_ID}`, `seat:${TAB_SLOT}@${PAGE_ID}`, `seat:${TAB_TITLE_SLOT}@${PAGE_ID}`, `open:${PAGE_KIND}`],
  );
  assert.equal(rig.openTabArgs.length, 1, '恰好开一次（`multiple:false` ⇒ 重复 openTab 只 reveal）');
  assert.equal(rig.openTabArgs[0]?.kind, 'wslDockerContainers');
  assert.equal(PAGE_ID, 'wsl-containers');
  assert.equal(rig.mountSubscribes(), 0, '🔴 必须直连 `openTab`、不经宿主 store（崩溃根因）');
  assert.deepEqual(surface.registerTab(tabs, slots, sidebar).length, 3, '一次注册返回 3 个 disposer（类型 + 两个 seat）');
});

test('配置槽用**复合键**注册（`组合包包名#行 id`，宿主按这个键查「配置」按钮）', () => {
  const rig = harness({});
  const surface = surfaceOf(rig);
  surface.registerConfig(rig.ctx);
  assert.deepEqual(
    rig.calls.map((call) => call.text),
    [`seat:plugins.row.config@dsh-wsl-docker-ports#wsl-containers`],
    '配置槽恰好注册一次，且 key = `组合包包名#行 id`（2026-10-27 真机：写成只行 id ⇒ 宿主查不到 ⇒ 这一行没有「配置」按钮）',
  );

  // 宿主没有 slots ⇒ 只降级、不抛（配置页是可选的编辑入口，不该拖垮整包加载）
  const bare: ClientContextLike = { get: () => undefined };
  assert.doesNotThrow(() => {
    createSurface(bare, {}, softGet, '[test]').registerConfig(bare);
  }, '缺 slots 时 registerConfig 不许抛');
});

test('`fetchImpl` / `baseUrl` 只**转发**注入值（缺省回落由 chunk 侧做）', () => {
  const bare = surfaceOf(harness({}));
  assert.equal(bare.runtime.fetchImpl, undefined);
  assert.equal(bare.runtime.baseUrl, '', '缺省 baseUrl 是空串（同源）');
  const injected = fakeFetch(200, {});
  assert.equal(surfaceOf(harness({}), { fetchImpl: injected }).runtime.fetchImpl, injected);
  assert.equal(surfaceOf(harness({}), { routeBaseUrl: '/base/' }).runtime.baseUrl, '/base/');
});

test('会话晚到 ⇒ **有限次定时重试**，且一个 `mounted.subscribe` 都不许有', () => {
  const rig = harness({ mountedSession: undefined });
  const scheduled: { readonly callback: () => void; readonly ms: number }[] = [];
  const timers = {
    setTimeout: (callback: () => void, ms: number) => {
      scheduled.push({ callback, ms });
      return scheduled.length;
    },
    clearTimeout: () => undefined,
  };
  const surface = surfaceOf(rig, { timers });
  const { tabs, slots, sidebar } = servicesOf(rig);

  surface.registerTab(tabs, slots, sidebar);

  assert.equal(rig.openTabArgs.length, 0, '首屏没有在屏会话 ⇒ openTab 抛，被吞掉（不炸 apply 的返回值）');
  assert.equal(rig.mountSubscribes(), 0, '🔴 一个订阅都不许有：真机就是这一个把 renderer 搞崩的');
  assert.deepEqual(scheduled.map((slot) => slot.ms), [300], '抛错后必须排一次重试');

  rig.setMounted('session-1');
  scheduled[0]?.callback();
  assert.equal(rig.openTabArgs.length, 1, '会话挂上后重试成功');
  assert.equal(rig.openTabArgs[0]?.kind, PAGE_KIND);
  assert.equal(scheduled.length, 1, '成功即停：不许继续排');
  assert.equal(rig.mountSubscribes(), 0);
});

test('重试是**有界**的（一直抛错就放弃，不无限自旋）', () => {
  const rig = harness({ mountedSession: undefined });
  const scheduled: { callback: () => void }[] = [];
  const timers = {
    setTimeout: (callback: () => void) => {
      scheduled.push({ callback });
      return scheduled.length;
    },
    clearTimeout: () => undefined,
  };
  const surface = surfaceOf(rig, { timers });
  const { tabs, slots, sidebar } = servicesOf(rig);
  surface.registerTab(tabs, slots, sidebar);

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

test('D2 容器页刷新间隔写回**容器行自己的命名空间**（不是转发侧 `dsh-wsl-docker-ports`）', async () => {
  const updates: { readonly ns: string; readonly patch: unknown }[] = [];
  const service: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => ({ ok: true, value: { revision: 3, namespaces: [] } }),
    update: async (ns: string, patch: unknown): Promise<SettingsResponse> => {
      updates.push({ ns, patch });
      return { ok: true, value: {} };
    },
    mutate: async (): Promise<SettingsResponse> => {
      throw new Error('本用例不该走 mutate');
    },
  };
  const ctx: ClientContextLike = { get: (name: string) => (name === 'remote.settings' ? service : undefined) };
  const surface = createSurface(ctx, {}, softGet, '[test]');

  const pipe = surface.runtime.settings();
  assert.ok(pipe, '容器页必须拿到**自己**的 settings 管道');
  const result = await pipe.writeRefreshInterval(15);
  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, { refreshIntervalSec: 15 });
  assert.deepEqual(updates, [{ ns: 'wsl-containers', patch: { refreshIntervalSec: 15 } }]);
  assert.notEqual(PAGE_ID, 'wsl-ports');
  console.log(`  · D2 写回命名空间 ${updates[0]?.ns}，patch ${JSON.stringify(updates[0]?.patch)}`);
});
