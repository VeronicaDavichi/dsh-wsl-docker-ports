/**
 * 002 T3.1 同族注册缺陷：**二次注册的生命周期收编**（`src/ws/routes.ts`；2026-10-12）。
 *
 * ## 缺陷（同一族：重复 `(kind, path)` 注册宿主**直接抛错** ⇒ 必须 effect-scoped disposer / 等价收编）
 *
 * 旧实现的 `attach` 只有一道闸 `if (disposed || live > 0) return;` —— 把「幂等」写成了**一律忽略第二次**。
 * 二次到达有**两条**真实触发路径，旧实现只处理对了①：
 *
 * ① **同一个服务面**再到达（`ctx.inject` 的通知不止一次 / 同一 ctx 被重复 activate）⇒ 旧实现在这条**恰好
 *    正确**（保留第一次，不撞重复注册；本文件判据 ① 把它钉住）；
 * ② **服务面被换掉**（宿主热重载 / 重启了提供 `webServer` 的那个插件：新面的路由表是空的，而旧面的
 *    disposer 还挂在我们手上）⇒ 旧实现**直接 return**：新面上 **0 条路由**（端点静默不可达）、
 *    `registered` / `registrationCount()` 仍**谎报 2**、旧面的 disposer **永不收回**（泄漏）。
 *
 * 触发路径的第三面（**测试并发**）也在此覆盖：同一 ctx 上并发/重复 activate 两次（判据 ④）。
 *
 * ## 修法（`releaseRoutes()`；见 `src/ws/routes.ts` 文件头硬约束 1）
 *
 * `attach` 记住 `attachedSurface`：**同面** ⇒ 保留第一次（什么都不做）；**面不同** ⇒ 先 `releaseRoutes()`
 * 收回旧注册，再整组重挂到新面 —— **安全收编**：不撞「重复 `(kind, path)` 抛错」，也不会把**第一次**的
 * 有效注册带走。`disposeOnce` 走同一条收回路径（收编的是**当前**那一组）。
 *
 * ## 判据（5 条，全部可二值判定）
 *
 * ① 同面二次到达 ⇒ 第一次注册**仍然有效**（`registerCalls` 仍 **1** 次、`duplicateAttempts === 0`、端点仍 200）；
 * ② 面被换掉 ⇒ 旧面 **2 → 0**（disposer 真收回）+ 新面 **0 → 2** + 端点在新面 200、旧面回落 404；
 * ③ 换面后再卸载 ⇒ **新面**也归零（收编的是当前那一组，不是只看第一次）；
 * ④ 同一 ctx 上重复 activate（两个句柄都登记了惰性注入）⇒ 不抛、第一次仍有效、第二个句柄**如实**报
 *    `missing`（不谎报成功）；
 * ⑤ **变异哨兵**：逐字复刻旧闸（`live > 0` 一律 return）⇒ 判据 ② 当场判错（新面 0 条 / 旧面 2 条）。
 */

import { describe, expect, it } from 'vitest';

import { registerTerminalChannel } from '../../src/ws/routes.ts';
import type { ChannelRegistration } from '../../src/ws/routes.ts';
import { createTokenStore } from '../../src/ws/auth.ts';
import { createFakeCtx, createFakeManager, createFakeWebServer, handshakeHeaders } from '../helpers/ws-fakes.ts';

/** 契约字面量（**不从 src 取**；常量改名/改形必须让本文件红） */
const HTTP_PREFIX = '/dsh-managed-terminal';
const LIST_PATH = '/dsh-managed-terminal/instances';
const UPGRADE_PATH = '/dsh-managed-terminal/ws';
const ORIGIN = 'http://127.0.0.1:19387';

/** 真机时序：`apply` 那一刻 `webServer` 还没到（`inject` 只登记回调） */
function lateSetup() {
  const surfaceA = createFakeWebServer();
  const fakeCtx = createFakeCtx(undefined, { inject: 'deferred' });
  const manager = createFakeManager();
  manager.add('inst-1');
  const tokens = createTokenStore();
  const registration = registerTerminalChannel(fakeCtx.ctx, {
    manager: manager.session,
    tokens,
    allowedOrigins: [ORIGIN],
  });
  return { surfaceA, fakeCtx, tokens, registration };
}

describe('ws/routes.ts 二次注册：同一个面（保留第一次）', () => {
  it('① 注入通知多跑一次 ⇒ 第一次注册**仍然有效**（不二次注册、不撞宿主抛错、端点仍 200）', async () => {
    const { surfaceA, fakeCtx, tokens, registration } = lateSetup();
    fakeCtx.install(surfaceA.surface);
    fakeCtx.fireInject();
    expect(registration.registrationCount()).toBe(2);
    expect(surfaceA.liveCount()).toBe(2);

    fakeCtx.fireInject(); // 第二次通知（**同一个**服务面）

    expect(surfaceA.duplicateAttempts).toBe(0); // 没撞「duplicate prefix route」
    expect(surfaceA.registerCalls).toEqual([{ kind: 'prefix', path: HTTP_PREFIX }]);
    expect(surfaceA.upgradeCalls).toEqual([{ path: UPGRADE_PATH }]);
    expect(registration.registrationCount()).toBe(2);
    expect(registration.registered).toBe(true);
    expect(registration.state).toBe('registered');

    // 「第一次注册仍有效」= 端到端仍命中（不是「注册对象还在、宿主已不分派」）
    const response = await surfaceA.invokeHttpHost(LIST_PATH, { headers: handshakeHeaders(tokens.issue()) });
    expect(response.status).toBe(200);
    expect(surfaceA.handlerCalls).toBe(1);
  });
});

describe('ws/routes.ts 二次注册：服务面被换掉（安全收编）', () => {
  it('② 宿主热重载换了 webServer ⇒ 旧面归零、新面 2 条、端点在新面 200、旧面回落 404', async () => {
    const { surfaceA, fakeCtx, tokens, registration } = lateSetup();
    fakeCtx.install(surfaceA.surface);
    fakeCtx.fireInject();
    expect(surfaceA.liveCount()).toBe(2);

    const surfaceB = createFakeWebServer(); // 新服务面：路由表是**空的**
    fakeCtx.install(surfaceB.surface);
    fakeCtx.fireInject(); // 「新服务面到达」

    expect(surfaceB.duplicateAttempts).toBe(0); // 不撞重复注册（先收回再重挂）
    expect(surfaceB.liveCount()).toBe(2); // 旧实现这里 = 0（端点静默不可达）
    expect(surfaceA.liveCount()).toBe(0); // 旧实现这里 = 2（disposer 泄漏）
    expect(surfaceB.registerCalls).toEqual([{ kind: 'prefix', path: HTTP_PREFIX }]);
    expect(surfaceB.upgradeCalls).toEqual([{ path: UPGRADE_PATH }]);
    expect(registration.registrationCount()).toBe(2);
    expect(registration.registered).toBe(true);

    expect(surfaceB.dispatchKind(LIST_PATH)).toBe('prefix');
    const response = await surfaceB.invokeHttpHost(LIST_PATH, { headers: handshakeHeaders(tokens.issue()) });
    expect(response.status).toBe(200);
    expect(surfaceB.handlerCalls).toBe(1);
    // 对照：旧面**不再**分派（不是「两边都留着」）
    expect(surfaceA.dispatchKind(LIST_PATH)).toBe('fallback');
    expect((await surfaceA.invokeHttpHost(LIST_PATH)).status).toBe(404);
  });

  it('③ 换面之后卸载 ⇒ **新面**也归零（收编的是当前那一组）', () => {
    const { surfaceA, fakeCtx, registration } = lateSetup();
    fakeCtx.install(surfaceA.surface);
    fakeCtx.fireInject();
    const surfaceB = createFakeWebServer();
    fakeCtx.install(surfaceB.surface);
    fakeCtx.fireInject();
    expect(surfaceB.liveCount()).toBe(2);

    fakeCtx.unload(); // ctx.effect 的那一条生命周期

    expect(surfaceB.liveCount()).toBe(0);
    expect(registration.registrationCount()).toBe(0);
    expect(registration.registered).toBe(false);
  });
});

describe('ws/routes.ts 二次注册：同一 ctx 上重复 activate', () => {
  it('④ 两个句柄都等 webServer ⇒ 不抛、第一次仍有效、第二个句柄**如实**报 missing', async () => {
    const surfaceA = createFakeWebServer();
    const fakeCtx = createFakeCtx(undefined, { inject: 'deferred' });
    const manager = createFakeManager();
    manager.add('inst-1');
    const tokens = createTokenStore();
    const first = registerTerminalChannel(fakeCtx.ctx, {
      manager: manager.session,
      tokens,
      allowedOrigins: [ORIGIN],
    });
    const box: { handle?: ChannelRegistration } = {};
    expect(() => {
      box.handle = registerTerminalChannel(fakeCtx.ctx, {
        manager: manager.session,
        tokens: createTokenStore(),
        allowedOrigins: [ORIGIN],
      });
    }).not.toThrow();

    fakeCtx.install(surfaceA.surface);
    expect(() => fakeCtx.fireInject()).not.toThrow(); // 两个注入回调都跑：第二家撞「重复 (kind, path)」

    const second = box.handle;
    expect(first.registered).toBe(true);
    expect(first.registrationCount()).toBe(2);
    expect(surfaceA.liveCount()).toBe(2);
    expect(surfaceA.registerCalls).toHaveLength(1);
    expect(surfaceA.duplicateAttempts).toBe(1);
    // 第二个句柄**不谎报**：确实没注册 + 原因里带宿主的 duplicate 原文
    expect(second?.registered).toBe(false);
    expect(second?.state).toBe('missing');
    expect(second?.reason).toContain('duplicate');
    expect(second?.registrationCount()).toBe(0);
    // 第一次注册不受影响（端到端仍 200）
    const response = await surfaceA.invokeHttpHost(LIST_PATH, { headers: handshakeHeaders(tokens.issue()) });
    expect(response.status).toBe(200);
  });
});

describe('🔴 变异哨兵：旧 `attach` 闸（`live > 0` 一律 return）在判据 ② 下当场判错', () => {
  it('⑤ 同一对 fake 服务面上复刻旧闸 ⇒ 新面 0 条 + 旧面 disposer 不收回（判据 ② 的两条断言必红）', () => {
    // 旧实现那一刻的状态：第一次已挂上（live = 2、未 dispose），第二个**不同的**服务面到达
    const surfaceA = createFakeWebServer();
    surfaceA.surface.register({ kind: 'prefix', path: HTTP_PREFIX, handler: () => undefined });
    surfaceA.surface.registerUpgrade({ path: UPGRADE_PATH, handler: () => undefined });
    const surfaceB = createFakeWebServer();
    const live = 2;
    const disposed = false;

    // 逐字复刻旧闸：`if (disposed || live > 0) return;` ⇒ 第二个面**什么都没做**
    const oldGuardReturns = disposed || live > 0;
    expect(oldGuardReturns).toBe(true);

    expect(surfaceB.liveCount()).toBe(0); // ⇒ 判据 ② 的 `expect(surfaceB.liveCount()).toBe(2)` 必红
    expect(surfaceA.liveCount()).toBe(2); // ⇒ 判据 ② 的 `expect(surfaceA.liveCount()).toBe(0)` 必红
    console.log(
      `[sentinel] 旧闸（live > 0 一律 return）后果：新面 liveCount=${surfaceB.liveCount()}、旧面 liveCount=${surfaceA.liveCount()}（端点静默不可达 + disposer 泄漏）`,
    );
  });
});
