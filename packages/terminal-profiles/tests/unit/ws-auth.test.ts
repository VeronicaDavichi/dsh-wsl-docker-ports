/**
 * T3.2 握手校验（REQ-7.2 / REQ-7.5）
 *
 * 验证（tasks.md 第 102 行）：`vitest` —— 无令牌/错令牌/过期令牌/跨源 → 立即关闭且响应体**不含**
 * 实例信息；令牌只能用一次。list 路由同样校验。
 *
 * 「不含实例信息」的判据写成**具体串**（实例 id 与 profile 名）而不是「看起来没问题」：
 * 这两串故意起得与众不同，任何一处拼接泄露都会被 `not.toContain` 抓住。
 */

import { describe, expect, it } from 'vitest';
import { createTokenStore } from '../../src/ws/auth.ts';
import { TERM_WS_LIST_PATH, TERM_WS_TOKEN_TTL_MS } from '../../src/ws/constants.ts';
import { registerTerminalChannel } from '../../src/ws/routes.ts';
import { acceptKeyOf, createFakeCtx, createFakeManager, createFakeWebServer, handshakeHeaders } from '../helpers/ws-fakes.ts';

const ORIGIN = 'http://127.0.0.1:19387';
const INSTANCE_ID = 'inst-leak-canary';
const PROFILE_NAME = 'secret-profile-canary';
const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';

function setup(options: { ttlMs?: number } = {}) {
  let clock = 1_000_000;
  const webServer = createFakeWebServer();
  const fakeCtx = createFakeCtx(webServer.surface);
  const manager = createFakeManager();
  manager.add(INSTANCE_ID, { profileName: PROFILE_NAME });
  const tokens = createTokenStore({ ttlMs: options.ttlMs ?? TERM_WS_TOKEN_TTL_MS });
  const registration = registerTerminalChannel(fakeCtx.ctx, {
    manager: manager.session,
    tokens,
    allowedOrigins: [ORIGIN],
    now: () => clock,
  });
  return {
    webServer,
    tokens,
    registration,
    issue: () => tokens.issue(clock),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function upgradeHeaders(token: string | undefined, origin = ORIGIN): Record<string, string> {
  return handshakeHeaders(token, origin, { 'sec-websocket-key': WS_KEY, upgrade: 'websocket', connection: 'Upgrade' });
}

/** 拒绝响应体的统一判据：无实例信息、无 101、无令牌回显 */
function expectSanitizedRejection(body: string, token?: string): void {
  expect(body).not.toContain(INSTANCE_ID);
  expect(body).not.toContain(PROFILE_NAME);
  expect(body).not.toContain('101 Switching Protocols');
  expect(body).not.toContain('Sec-WebSocket-Accept');
  if (token !== undefined) expect(body).not.toContain(token);
}

describe('T3.2 握手校验（upgrade）', () => {
  it('合法令牌 + 同源 ⇒ 101，且 Accept 与独立实现一致（RFC 6455 §1.3 向量）', () => {
    const { webServer, issue } = setup();
    const token = issue();
    const socket = webServer.invokeUpgrade('/dsh-managed-terminal/ws', { headers: upgradeHeaders(token) });
    expect(socket.responseStatus()).toBe(101);
    expect(socket.destroyed).toBe(false);
    const head = new TextDecoder().decode(socket.bytes());
    expect(head).toContain(`Sec-WebSocket-Accept: ${acceptKeyOf(WS_KEY)}`);
    expect(head).not.toContain(token); // 令牌绝不回显
  });

  it('无令牌 ⇒ 401 + 立即关闭，响应体不含实例信息', () => {
    const { webServer } = setup();
    const socket = webServer.invokeUpgrade('/dsh-managed-terminal/ws', { headers: upgradeHeaders(undefined) });
    expect(socket.responseStatus()).toBe(401);
    expect(socket.destroyed).toBe(true);
    expect(socket.responseBody()).toContain('token-missing');
    expectSanitizedRejection(socket.responseBody());
  });

  it('错令牌 ⇒ 401（且不泄露「这个令牌像不像真的」）', () => {
    const { webServer } = setup();
    const socket = webServer.invokeUpgrade('/dsh-managed-terminal/ws', { headers: upgradeHeaders('forged-token-value') });
    expect(socket.responseStatus()).toBe(401);
    expect(socket.destroyed).toBe(true);
    expect(socket.responseBody()).toContain('token-invalid');
    expectSanitizedRejection(socket.responseBody(), 'forged-token-value');
  });

  it('过期令牌 ⇒ 401（短 TTL 真会过期，不是摆设）', () => {
    const { webServer, issue, advance } = setup();
    const token = issue();
    advance(TERM_WS_TOKEN_TTL_MS + 1);
    const socket = webServer.invokeUpgrade('/dsh-managed-terminal/ws', { headers: upgradeHeaders(token) });
    expect(socket.responseStatus()).toBe(401);
    expect(socket.responseBody()).toContain('token-expired');
    expect(socket.destroyed).toBe(true);
    expectSanitizedRejection(socket.responseBody(), token);
  });

  it('跨源 ⇒ 403 + 立即关闭；无 Origin 也拒（失败关闭）', () => {
    const { webServer, issue } = setup();
    const crossOrigin = webServer.invokeUpgrade('/dsh-managed-terminal/ws', {
      headers: upgradeHeaders(issue(), 'http://evil.example'),
    });
    expect(crossOrigin.responseStatus()).toBe(403);
    expect(crossOrigin.destroyed).toBe(true);
    expect(crossOrigin.responseBody()).toContain('origin-denied');
    expectSanitizedRejection(crossOrigin.responseBody());

    const missingOrigin = webServer.invokeUpgrade('/dsh-managed-terminal/ws', {
      headers: { 'sec-websocket-key': WS_KEY },
    });
    expect(missingOrigin.responseStatus()).toBe(403);
    expect(missingOrigin.responseBody()).toContain('origin-missing');
  });

  it('令牌只能用一次：第二次（换 Origin 也一样）必然 401', () => {
    const { webServer, issue, tokens } = setup();
    const token = issue();
    expect(tokens.pending).toBe(1);
    const first = webServer.invokeUpgrade('/dsh-managed-terminal/ws', { headers: upgradeHeaders(token) });
    expect(first.responseStatus()).toBe(101);
    expect(tokens.pending).toBe(0); // 兑换即删

    const second = webServer.invokeUpgrade('/dsh-managed-terminal/ws', { headers: upgradeHeaders(token) });
    expect(second.responseStatus()).toBe(401);
    expect(second.responseBody()).toContain('token-invalid');
    expectSanitizedRejection(second.responseBody(), token);
  });

  it('缺 Sec-WebSocket-Key ⇒ 400（令牌已过校验，但 101 算不出来就不许开通道）', () => {
    const { webServer, issue } = setup();
    const socket = webServer.invokeUpgrade('/dsh-managed-terminal/ws', { headers: handshakeHeaders(issue()) });
    expect(socket.responseStatus()).toBe(400);
    expect(socket.destroyed).toBe(true);
    expectSanitizedRejection(socket.responseBody());
  });
});

describe('T3.2 握手校验（list 路由，REQ-7.5）', () => {
  it('无令牌 ⇒ 401，且响应体不含实例信息', async () => {
    const { webServer } = setup();
    const response = await webServer.invokeHttp(TERM_WS_LIST_PATH, { headers: handshakeHeaders(undefined) });
    expect(response.status).toBe(401);
    expect(response.body).toContain('token-missing');
    expectSanitizedRejection(response.body);
  });

  it('跨源 ⇒ 403，即使令牌合法', async () => {
    const { webServer, issue } = setup();
    const response = await webServer.invokeHttp(TERM_WS_LIST_PATH, {
      headers: handshakeHeaders(issue(), 'http://evil.example'),
    });
    expect(response.status).toBe(403);
    expect(response.body).toContain('origin-denied');
    expectSanitizedRejection(response.body);
  });

  it('同一枚令牌不能既开 list 又开 upgrade（一次性是跨路由的）', async () => {
    const { webServer, issue } = setup();
    const token = issue();
    const list = await webServer.invokeHttp(TERM_WS_LIST_PATH, { headers: handshakeHeaders(token) });
    expect(list.status).toBe(200);
    expect(list.body).toContain(INSTANCE_ID); // 授权后才出现实例信息

    const upgrade = webServer.invokeUpgrade('/dsh-managed-terminal/ws', { headers: upgradeHeaders(token) });
    expect(upgrade.responseStatus()).toBe(401);
    expectSanitizedRejection(upgrade.responseBody(), token);
  });

  it('过期令牌 ⇒ 401（list 与 upgrade 共用同一条过期判据）', async () => {
    const { webServer, issue, advance } = setup();
    const token = issue();
    advance(TERM_WS_TOKEN_TTL_MS + 1);
    const response = await webServer.invokeHttp(TERM_WS_LIST_PATH, { headers: handshakeHeaders(token) });
    expect(response.status).toBe(401);
    expect(response.body).toContain('token-expired');
  });
});

describe('T3.2 令牌表的有界性', () => {
  it('过期即清、超量丢最旧（不允许无界增长）', () => {
    let clock = 0;
    const tokens = createTokenStore({ ttlMs: 100, capacity: 3, generate: (() => {
      let n = 0;
      return () => `tok-${(n += 1)}`;
    })() });
    tokens.issue(clock);
    tokens.issue(clock);
    tokens.issue(clock);
    expect(tokens.pending).toBe(3);
    tokens.issue(clock); // 第 4 枚：丢最旧
    expect(tokens.pending).toBe(3);
    expect(tokens.redeem('tok-1', clock)).toBe('unknown');
    expect(tokens.redeem('tok-4', clock)).toBe('ok');

    clock += 101;
    tokens.issue(clock); // 清过期
    expect(tokens.pending).toBe(1); // 只剩刚下发的那一枚（其余都过期被清）
  });
});
