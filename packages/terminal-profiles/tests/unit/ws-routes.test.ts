/**
 * T3.1 路由与 upgrade 注册（REQ-7.1 / REQ-7.6）
 *
 * 验证（tasks.md 第 98 行）：`vitest` + fake webServer —— 注册/卸载计数归零；卸载后不劫持未知路径。
 */

import { describe, expect, it } from 'vitest';
import { createTokenStore } from '../../src/ws/auth.ts';
import { TERM_WS_HTTP_PREFIX, TERM_WS_LIST_PATH, TERM_WS_UPGRADE_PATH } from '../../src/ws/constants.ts';
import { isWebServerSurface, pathOf, registerTerminalChannel } from '../../src/ws/routes.ts';
import { createFakeCtx, createFakeManager, createFakeWebServer, handshakeHeaders } from '../helpers/ws-fakes.ts';

const ORIGIN = 'http://127.0.0.1:19387';

function setup() {
  const webServer = createFakeWebServer();
  const fakeCtx = createFakeCtx(webServer.surface);
  const manager = createFakeManager();
  manager.add('inst-1');
  const tokens = createTokenStore();
  const registration = registerTerminalChannel(fakeCtx.ctx, {
    manager: manager.session,
    tokens,
    allowedOrigins: [ORIGIN],
  });
  return { webServer, fakeCtx, manager, tokens, registration };
}

describe('T3.1 路由与 upgrade 注册', () => {
  it('注册两条：prefix 的 HTTP 路由 + 单一 exact 的 upgrade 路由（REQ-7.1）', () => {
    const { webServer, registration } = setup();
    expect(registration.registered).toBe(true);
    expect(webServer.registerCalls).toEqual([{ kind: 'prefix', path: TERM_WS_HTTP_PREFIX }]);
    expect(webServer.upgradeCalls).toEqual([{ path: TERM_WS_UPGRADE_PATH }]);
    expect(registration.paths).toEqual({ http: TERM_WS_HTTP_PREFIX, upgrade: TERM_WS_UPGRADE_PATH });
    expect(webServer.liveCount()).toBe(2);
    expect(registration.registrationCount()).toBe(2);
    // HTTP 必须用 prefix（独占前缀），upgrade 只能 exact —— 两半都不能换成另一种
    expect(TERM_WS_LIST_PATH.startsWith(TERM_WS_HTTP_PREFIX)).toBe(true);
  });

  it('两个 disposer 都登记到 ctx.effect（宿主不会自动收集，漏登记 = 路由残留）', () => {
    const { fakeCtx, webServer, registration } = setup();
    expect(fakeCtx.effectCount()).toBe(2);
    expect(webServer.duplicateAttempts).toBe(0); // 只注册一次 ⇒ 没撞宿主的「重复 (kind,path) 抛错」
    expect(registration.registrationCount()).toBe(2);
  });

  it('卸载后注册计数归零，且不劫持未知路径（REQ-7.6）', async () => {
    const { fakeCtx, webServer, registration } = setup();
    // 卸载前：本前缀内的枚举路径由我们作答，前缀外的路径一次都没碰过
    const beforeUnload = await webServer.invokeHttp('/api/unknown');
    expect(beforeUnload.status).toBe('fallback');
    expect(webServer.handlerCalls).toBe(0);

    fakeCtx.unload();
    expect(webServer.liveCount()).toBe(0);
    expect(registration.registrationCount()).toBe(0);

    // 卸载后连自己的枚举路径也回落到官方行为（没有任何具名路由匹配）
    const afterUnload = await webServer.invokeHttp(TERM_WS_LIST_PATH, { headers: handshakeHeaders('whatever') });
    expect(afterUnload.status).toBe('fallback');
    const upgrade = webServer.invokeUpgrade(TERM_WS_UPGRADE_PATH, { headers: handshakeHeaders('whatever') });
    expect(upgrade.responseStatus()).toBe(404); // 无具名 upgrade 路由 ⇒ 由宿主回 404
    expect(webServer.handlerCalls).toBe(0);
  });

  it('dispose 幂等：重复卸载不会把计数减成负数', () => {
    const { registration } = setup();
    registration.dispose();
    registration.dispose();
    expect(registration.registrationCount()).toBe(0);
  });

  it('前缀内未知名路径答 404（只答自己那一条，不做 SPA fallback）', async () => {
    const { webServer } = setup();
    const response = await webServer.invokeHttp('/dsh-managed-terminal/nope');
    expect(response.status).toBe(404);
    expect(response.body).toContain('not-found');
  });

  it('缺 webServer（非严格 ctx.get）⇒ 不注册任何路由并给出原因，不抛', () => {
    const fakeCtx = createFakeCtx(undefined);
    const manager = createFakeManager();
    const registration = registerTerminalChannel(fakeCtx.ctx, {
      manager: manager.session,
      tokens: createTokenStore(),
      allowedOrigins: [ORIGIN],
    });
    expect(registration.registered).toBe(false);
    expect(registration.reason).toContain('webServer');
    expect(registration.registrationCount()).toBe(0);
    expect(fakeCtx.effectCount()).toBe(0);
  });

  it('list 路由：授权后返回摘要（不含 handle / screen 内部状态）', async () => {
    const { webServer, tokens } = setup();
    const token = tokens.issue();
    const response = await webServer.invokeHttp(TERM_WS_LIST_PATH, { headers: handshakeHeaders(token) });
    expect(response.status).toBe(200);
    const payload = JSON.parse(response.body) as { instances: Record<string, unknown>[] };
    expect(payload.instances.map((item) => item['id'])).toEqual(['inst-1']);
    expect(Object.keys(payload.instances[0] ?? {}).sort()).toEqual(
      ['cols', 'dropped', 'exited', 'id', 'profileName', 'rows', 'seq'].sort(),
    );
  });

  it('list 路由：非 GET 答 405，且不消耗令牌（先判方法再判令牌）', async () => {
    const { webServer, tokens } = setup();
    const token = tokens.issue();
    const response = await webServer.invokeHttp(TERM_WS_LIST_PATH, { method: 'POST', headers: handshakeHeaders(token) });
    expect(response.status).toBe(405);
    expect(tokens.pending).toBe(1); // 令牌仍在（405 分支没有兑换它）
  });

  it('结构面判定与路径解析（边界输入不抛）', () => {
    expect(isWebServerSurface(undefined)).toBe(false);
    expect(isWebServerSurface({})).toBe(false);
    expect(isWebServerSurface({ register: () => undefined })).toBe(false);
    expect(pathOf(undefined)).toBe('/');
    expect(pathOf('/dsh-managed-terminal/instances?token=x#y')).toBe(TERM_WS_LIST_PATH);
    expect(pathOf('http://')).toBe('http://'); // 畸形 url：退到原串，绝不抛
  });
});
