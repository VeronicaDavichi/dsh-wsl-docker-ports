/**
 * **缺陷 A 的对抗性回归**：注册必须发生在**宿主可用时机**，不能在 `apply` 里同步 `ctx.get` 定生死。
 *
 * ## 真机时间线（003 包实测，本包同型）
 *
 * `+68ms` 时 `ctx.get('webServer') === undefined`；本包的 `ctx.inject(['webServer'])` 到 `+755ms`
 * 才 FIRED。旧写法在那 68ms 里取一次就下结论 ⇒ **永不注册**，而插件面板照旧显示「运行中」、零报错。
 *
 * ⇒ 本文件用 `inject: 'deferred'`（服务**后到**）复刻这条时间线：
 *   - 旧写法（同步 `ctx.get` 一次）在 `fireInject()` 之后 `registered` 仍为 `false` ⇒ **本文件必红**；
 *   - 新写法在这一步必须 `registered === true` 且两条路由真的进了宿主表。
 *
 * 🔴 期望值是**契约字面量**（完整 URL），不从 `src` 取。
 */

import { describe, expect, it } from 'vitest';

import { applyTerminalProfiles } from '../../src/plugin.ts';
import { createTokenStore } from '../../src/ws/auth.ts';
import { registerTerminalChannel } from '../../src/ws/routes.ts';
import { createFakeSubprocess } from '../helpers/fake-pty.ts';
import { CONFIG, ORIGIN, createFakePluginCtx, createHostSpy } from '../helpers/plugin-fixtures.ts';
import { createFakeTools } from '../helpers/tools-define.ts';
import { createFakeCtx, createFakeManager, createFakeWebServer, handshakeHeaders } from '../helpers/ws-fakes.ts';

/** 契约字面量（**不是**从 src 取） */
const HTTP_PREFIX = '/dsh-managed-terminal';
const LIST_PATH = '/dsh-managed-terminal/instances';
const UPGRADE_PATH = '/dsh-managed-terminal/ws';
const PENDING_GAP_TEXT = '尚未注册';

function lateSetup() {
  const webServer = createFakeWebServer();
  const fakeCtx = createFakeCtx(undefined, { inject: 'deferred' }); // ← 服务此刻**不在**
  const manager = createFakeManager();
  manager.add('inst-1');
  const tokens = createTokenStore();
  const registration = registerTerminalChannel(fakeCtx.ctx, {
    manager: manager.session,
    tokens,
    allowedOrigins: [ORIGIN],
  });
  return { webServer, fakeCtx, tokens, registration };
}

describe('缺陷 A：webServer 后到（+68ms undefined → +755ms 注入 FIRED）', () => {
  it('服务没到 ⇒ 只登记注入、state=pending，**不**当成缺失、不注册（旧写法在这里也一样，故还不够）', () => {
    const { webServer, fakeCtx, registration } = lateSetup();
    expect(fakeCtx.injectCalls).toEqual([['webServer']]);
    expect(registration.registered).toBe(false);
    expect(registration.state).toBe('pending');
    expect(registration.reason).toContain('inject');
    expect(registration.registrationCount()).toBe(0);
    expect(webServer.registerCalls).toEqual([]);
    expect(webServer.liveCount()).toBe(0);
  });

  it('服务到位 + 注入回调 FIRED ⇒ 两条路由真的进宿主表（**旧写法在本条必红**）', async () => {
    const { webServer, fakeCtx, tokens, registration } = lateSetup();
    fakeCtx.install(webServer.surface); // 「服务到位」
    fakeCtx.fireInject(); // 「注入回调 FIRED」

    expect(registration.registered).toBe(true);
    expect(registration.state).toBe('registered');
    expect(registration.reason).toBeUndefined();
    expect(registration.registrationCount()).toBe(2);
    expect(webServer.registerCalls).toEqual([{ kind: 'prefix', path: HTTP_PREFIX }]);
    expect(webServer.upgradeCalls).toEqual([{ path: UPGRADE_PATH }]);
    expect(webServer.duplicateAttempts).toBe(0);

    // 端到端：按宿主分派判据真的能命中（不是「注册了但宿主不分派」）
    expect(webServer.dispatchKind(LIST_PATH)).toBe('prefix');
    const response = await webServer.invokeHttpHost(LIST_PATH, { headers: handshakeHeaders(tokens.issue()) });
    expect(response.status).toBe(200);
    expect(webServer.handlerCalls).toBe(1);
  });

  it('注入回调多跑一次 ⇒ attach 幂等（重复 (kind,path) 宿主会直接抛错）', () => {
    const { webServer, fakeCtx, registration } = lateSetup();
    fakeCtx.install(webServer.surface);
    fakeCtx.fireInject();
    fakeCtx.fireInject(); // 第二遍：只记账，不二次注册
    expect(registration.registrationCount()).toBe(2);
    expect(webServer.registerCalls).toHaveLength(1);
    expect(webServer.duplicateAttempts).toBe(0);
  });

  it('已 dispose 后到达的回调被挡住：不注册、不留残渣、不撞重复注册', () => {
    const { webServer, fakeCtx, registration } = lateSetup();
    registration.dispose(); // 插件先卸载
    fakeCtx.install(webServer.surface);
    fakeCtx.fireInject(); // 后到的注入回调
    expect(registration.registrationCount()).toBe(0);
    expect(registration.registered).toBe(false);
    expect(webServer.registerCalls).toEqual([]);
    expect(webServer.liveCount()).toBe(0);
    expect(webServer.duplicateAttempts).toBe(0);
  });

  it('卸载走 ctx.effect（宿主不自动回收 disposer）：unload 摘掉两条路由', () => {
    const { webServer, fakeCtx, registration } = lateSetup();
    fakeCtx.install(webServer.surface);
    fakeCtx.fireInject();
    expect(fakeCtx.effectCount()).toBe(1);
    fakeCtx.unload();
    expect(webServer.liveCount()).toBe(0);
    expect(registration.registrationCount()).toBe(0);
  });
});

describe('缺陷 A 第二半：插件 handle 的 webServer 缺口是**活视图**（服务到位后自动消失）', () => {
  function pluginSetup() {
    const webServer = createFakeWebServer();
    const subprocess = createFakeSubprocess();
    const tools = createFakeTools();
    const fakeCtx = createFakePluginCtx(
      { subprocess: subprocess.surface, tools: tools.service },
      { inject: 'deferred' },
    );
    const handle = applyTerminalProfiles(fakeCtx.ctx, CONFIG, {
      hostModules: createHostSpy().port,
      allowedOrigins: [ORIGIN],
    });
    return { webServer, fakeCtx, handle };
  }

  it('装载后（服务未到）：gap 里有一条 webServer 且写明「尚未注册」，routeCount=0', () => {
    const { fakeCtx, handle } = pluginSetup();
    expect(fakeCtx.injectCalls).toEqual([['webServer']]);
    expect(handle.routeCount()).toBe(0);
    const gap = handle.gaps.find((item) => item.what === 'webServer');
    expect(gap?.reason).toContain(PENDING_GAP_TEXT);
    expect(handle.channel?.registered).toBe(false);
    expect(handle.channel?.state).toBe('pending');
  });

  it('服务到位后：routeCount=2、registered 翻真、那条 gap **自己消失**（不是装载时的快照）', async () => {
    const { webServer, fakeCtx, handle } = pluginSetup();
    expect(handle.gaps.map((item) => item.what)).toContain('webServer');

    fakeCtx.installService('webServer', webServer.surface);
    fakeCtx.fireInject();

    expect(handle.routeCount()).toBe(2);
    expect(handle.channel?.registered).toBe(true);
    expect(handle.gaps.map((item) => item.what)).not.toContain('webServer');

    await handle.dispose();
    expect(handle.routeCount()).toBe(0);
    expect(webServer.liveCount()).toBe(0);
  });
});
