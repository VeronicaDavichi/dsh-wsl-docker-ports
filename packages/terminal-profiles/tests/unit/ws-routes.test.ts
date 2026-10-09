/**
 * T3.1 路由与 upgrade 注册（REQ-7.1 / REQ-7.6）+ **缺陷 B 的对抗性回归**（2026-10-09）
 *
 * 验证（tasks.md 第 98 行）：`vitest` + fake webServer —— 注册/卸载计数归零；卸载后不劫持未知路径。
 *
 * 🔴 **期望值一律是契约字面量**（`'/dsh-managed-terminal'` / `'/dsh-managed-terminal/instances'` /
 * `'/dsh-managed-terminal/ws'`），**不从被测代码取**：常量改名/改形必须让本文件红，而不是自动跟随。
 *
 * 🔴 缺陷 B（prefix 带尾斜杠 ⇒ 宿主永不分派）：fake webServer 的 `match` 已按宿主原文逐字复刻
 * `pathname !== prefix && !pathname.startsWith(`${prefix}\/`)` ⇒ 常量带尾斜杠时下面的命中用例会红
 * （文件末尾的「反控」用例把这件事直接钉住：带尾斜杠的前缀在**同一套判据**下命中不了）。
 */

import { describe, expect, it } from 'vitest';
import { TERM_WS_HTTP_PREFIX, TERM_WS_LIST_PATH, TERM_WS_UPGRADE_PATH } from '../../src/ws/constants.ts';
import { isWebServerSurface, pathOf, registerTerminalChannel } from '../../src/ws/routes.ts';
import { createFakeCtx, createFakeManager, createFakeWebServer, handshakeHeaders } from '../helpers/ws-fakes.ts';
import { createTokenStore } from '../../src/ws/auth.ts';

const ORIGIN = 'http://127.0.0.1:19387';
/** RFC 6455 官方向量（缺 `Sec-WebSocket-Key` 时握手按 400 拒绝，与会话层无关） */
const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
/** 契约字面量（**不是**从 src 取；见文件头） */
const HTTP_PREFIX = '/dsh-managed-terminal';
const LIST_PATH = '/dsh-managed-terminal/instances';
const UPGRADE_PATH = '/dsh-managed-terminal/ws';

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
  it('常量契约：前缀**不带尾斜杠**，两个端点都在前缀之下（缺陷 B 的字面判据）', () => {
    expect(TERM_WS_HTTP_PREFIX).toBe('/dsh-managed-terminal');
    expect(TERM_WS_HTTP_PREFIX.endsWith('/')).toBe(false);
    expect(TERM_WS_LIST_PATH).toBe('/dsh-managed-terminal/instances');
    expect(TERM_WS_UPGRADE_PATH).toBe('/dsh-managed-terminal/ws');
  });

  it('注册两条：prefix 的 HTTP 路由 + 单一 exact 的 upgrade 路由（REQ-7.1）', () => {
    const { webServer, registration } = setup();
    expect(registration.registered).toBe(true);
    expect(registration.state).toBe('registered');
    expect(registration.reason).toBeUndefined();
    expect(webServer.registerCalls).toEqual([{ kind: 'prefix', path: HTTP_PREFIX }]);
    expect(webServer.upgradeCalls).toEqual([{ path: UPGRADE_PATH }]);
    expect(registration.paths).toEqual({ http: HTTP_PREFIX, upgrade: UPGRADE_PATH });
    expect(webServer.liveCount()).toBe(2);
    expect(registration.registrationCount()).toBe(2);
  });

  it('恰好一条生命周期 effect 收编两条注册（宿主不会自动收集，漏登记 = 路由残留）', () => {
    const { fakeCtx, webServer, registration } = setup();
    expect(fakeCtx.effectCount()).toBe(1);
    expect(webServer.duplicateAttempts).toBe(0); // 只注册一次 ⇒ 没撞宿主的「重复 (kind,path) 抛错」
    expect(registration.registrationCount()).toBe(2);
    fakeCtx.unload(); // `ctx.effect` 的那一条必须真能把两条都摘掉
    expect(webServer.liveCount()).toBe(0);
    expect(registration.registrationCount()).toBe(0);
  });

  it('卸载后注册计数归零，且不劫持未知路径（REQ-7.6）', async () => {
    const { fakeCtx, webServer, registration } = setup();
    // 卸载前：本前缀外的路径一次都没碰过（宿主兜底 404）
    const beforeUnload = await webServer.invokeHttpHost('/api/unknown');
    expect(beforeUnload.status).toBe(404);
    expect(webServer.handlerCalls).toBe(0);

    fakeCtx.unload();
    expect(webServer.liveCount()).toBe(0);
    expect(registration.registrationCount()).toBe(0);

    // 卸载后连自己的枚举路径也回落到官方行为（没有任何具名路由匹配）
    const afterUnload = await webServer.invokeHttp(LIST_PATH, { headers: handshakeHeaders('whatever') });
    expect(afterUnload.status).toBe('fallback');
    const upgrade = webServer.invokeUpgrade(UPGRADE_PATH, { headers: handshakeHeaders('whatever') });
    expect(upgrade.responseStatus()).toBe(404); // 无具名 upgrade 路由 ⇒ 由宿主回 404
    expect(webServer.handlerCalls).toBe(0);
  });

  it('dispose 幂等：重复卸载不会把计数减成负数', () => {
    const { registration } = setup();
    registration.dispose();
    registration.dispose();
    expect(registration.registrationCount()).toBe(0);
  });

  it('缺 webServer 且没有 inject ⇒ 不注册 + state=missing + 给原因 + 不抛', () => {
    const fakeCtx = createFakeCtx(undefined);
    const manager = createFakeManager();
    const registration = registerTerminalChannel(fakeCtx.ctx, {
      manager: manager.session,
      tokens: createTokenStore(),
      allowedOrigins: [ORIGIN],
    });
    expect(registration.registered).toBe(false);
    expect(registration.state).toBe('missing');
    expect(registration.reason).toContain('webServer');
    expect(registration.registrationCount()).toBe(0);
    // 即便一条都没注册，这条 effect 也必须**无条件**存在（后到的注入回调要被它挡住）
    expect(fakeCtx.effectCount()).toBe(1);
  });
});

describe('T3.1 宿主分派判据（缺陷 B：exact → 最长 prefix → 兜底 404）', () => {
  it('GET 实例枚举：宿主的 prefix 判据下**真的命中**（不是被兜底吃掉）', async () => {
    const { webServer, tokens } = setup();
    expect(webServer.dispatchKind(LIST_PATH)).toBe('prefix');
    const response = await webServer.invokeHttpHost(LIST_PATH, { headers: handshakeHeaders(tokens.issue()) });
    expect(response.status).toBe(200);
    expect(webServer.handlerCalls).toBe(1); // 命中 = 请求真进了我们的 handler
  });

  it('前缀自身（`/dsh-managed-terminal`）也分派给我们 ⇒ 我们答 404，而不是宿主兜底', async () => {
    const { webServer } = setup();
    expect(webServer.dispatchKind(HTTP_PREFIX)).toBe('prefix');
    const response = await webServer.invokeHttpHost(HTTP_PREFIX);
    expect(response.status).toBe(404);
    expect(response.body).toContain('not-found'); // 我们自己的 JSON 404（宿主兜底体是空的）
    expect(webServer.handlerCalls).toBe(1);
  });

  it('前缀内未知名路径答 404（只答自己那一段，不做 SPA fallback）', async () => {
    const { webServer } = setup();
    const response = await webServer.invokeHttp(LIST_PATH.replace('/instances', '/nope'));
    expect(response.status).toBe(404);
    expect(response.body).toContain('not-found');
  });

  it('前缀外一律 fallback ⇒ 宿主兜底 404（零劫持）', async () => {
    const { webServer } = setup();
    expect(webServer.dispatchKind('/api/settings')).toBe('fallback');
    expect(webServer.dispatchKind('/dsh-managed-terminalx')).toBe('fallback'); // 不许裸 startsWith 误命中
    expect(webServer.dispatchKind('/dsh-managed-terminalX/instances')).toBe('fallback');
    const response = await webServer.invokeHttpHost('/dsh-managed-terminalx');
    expect(response.status).toBe(404);
    expect(response.body).toBe('');
  });

  it('upgrade 只认 exact：`/ws` 命中，前缀内其它路径与 `//ws` 都不命中', () => {
    const { webServer, tokens } = setup();
    // `Sec-WebSocket-Key` 是 RFC 6455 握手的必需头（缺它通道按 400 拒绝，与本用例的「是否分派」无关）
    const hit = webServer.invokeUpgrade(UPGRADE_PATH, {
      headers: handshakeHeaders(tokens.issue(), ORIGIN, { 'sec-websocket-key': WS_KEY }),
    });
    expect(hit.responseStatus()).toBe(101); // 真握手（exact 命中）
    const nested = webServer.invokeUpgrade(`${HTTP_PREFIX}/ws/extra`, { headers: handshakeHeaders(tokens.issue()) });
    expect(nested.responseStatus()).toBe(404);
    const doubled = webServer.invokeUpgrade(`${HTTP_PREFIX}//ws`, { headers: handshakeHeaders(tokens.issue()) });
    expect(doubled.responseStatus()).toBe(404);
  });

  /**
   * 反控（防呆）：把旧常量（**带尾斜杠**）手工注册进**同一套**宿主判据 ⇒ 必须命中不了。
   * 没有这条，「fake 的分派判据其实比宿主松」就会让上面的命中用例变成空转。
   */
  it('反控：带尾斜杠的前缀 `…/` 在宿主判据下永不命中（缺陷 B 的可复现证据）', async () => {
    const webServer = createFakeWebServer();
    webServer.surface.register({ kind: 'prefix', path: `${HTTP_PREFIX}/`, handler: () => undefined });
    expect(webServer.dispatchKind(LIST_PATH)).toBe('fallback');
    expect(webServer.dispatchKind(`${HTTP_PREFIX}/`)).toBe('prefix'); // 只有「前缀本身」才命中
    expect(webServer.dispatchKind(`${HTTP_PREFIX}//instances`)).toBe('prefix'); // 宿主实际要求 `…//`
    expect((await webServer.invokeHttpHost(LIST_PATH)).status).toBe(404);
  });
});

describe('T3.1 处理面（list 路由）', () => {
  it('list 路由：授权后返回摘要（不含 handle / screen 内部状态）', async () => {
    const { webServer, tokens } = setup();
    const response = await webServer.invokeHttp(LIST_PATH, { headers: handshakeHeaders(tokens.issue()) });
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
    const response = await webServer.invokeHttp(LIST_PATH, { method: 'POST', headers: handshakeHeaders(token) });
    expect(response.status).toBe(405);
    expect(tokens.pending).toBe(1); // 令牌仍在（405 分支没有兑换它）
  });

  it('结构面判定与路径解析（边界输入不抛）', () => {
    expect(isWebServerSurface(undefined)).toBe(false);
    expect(isWebServerSurface({})).toBe(false);
    expect(isWebServerSurface({ register: () => undefined })).toBe(false);
    expect(pathOf(undefined)).toBe('/');
    expect(pathOf(`${LIST_PATH}?token=x#y`)).toBe(LIST_PATH);
    expect(pathOf('http://')).toBe('http://'); // 畸形 url：退到原串，绝不抛
  });
});
