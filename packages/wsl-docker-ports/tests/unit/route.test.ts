/**
 * T6.8 自建 `ctx.webServer` 路由（`node --test`，零真机、零真实进程）
 *
 * 判据：
 * ① **注册形状**：`kind:'prefix'` + 独占前缀 `/dsh-wsl-docker-ports/`（**不蹭** 002 的
 *    `/dsh-managed-terminal/`）+ **装载期零命令、零请求**；
 * ② **disposer 归 `ctx.effect`**：卸载后 `registrationCount()===0`，且**同 `(kind,path)` 能重新注册**
 *    （宿主对重复 `(kind,path)` 会抛错 —— 这条正是漏登记 disposer 的真实后果）；
 * ③ **HTTP 语义**：200 + JSON + `Content-Length` 按 UTF-8 字节；前缀内未知路径 404；
 *    非 GET 405；规则读不到 503；装配抛异常 500；
 * ④ **判据① 的端到端形态**：路由返回的 `snapshot.diff` 与「同批事实直接喂 `diff()`」逐字相等。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { listDistros } from 'dsh-wsl-shared';

import { diff } from '../../src/diff/engine.ts';
import { parseManagedPorts } from '../../src/diff/managed-ports-parse.ts';
import { probeDockerPs } from '../../src/read/docker-probe.ts';
import { probePortproxyRules } from '../../src/read/netsh-probe.ts';
import { registerPortsRoute } from '../../src/route.ts';
import type { HttpResponseLike, RoutePluginContextLike, WebServerRoute, WebServerSurfaceLike } from '../../src/route.ts';
import { createSnapshotBuilder } from '../../src/snapshot.ts';
import type { SnapshotBuilder, SnapshotDeps } from '../../src/snapshot.ts';
import { PORTS_HTTP_PREFIX, PORTS_SNAPSHOT_PATH, buildSnapshotQuery, parseSnapshotQuery } from '../../src/wire.ts';
import type { PortsSnapshotResponse, SnapshotDeclaration } from '../../src/wire.ts';
import { ETH0 } from './client-fixtures.ts';
import { FIXTURE_PORTS, WSL_CONFIG, WSL_CONFIG_TEXT, routingExecutor } from '../helpers/snapshot-fixtures.ts';

/* ────────────────────────── fake 宿主面 ────────────────────────── */

interface Recorded {
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
}

/** 假响应：只实现 wire 用到的三个动作（与 002 的 `HttpResponseLike` 同口径） */
function fakeResponse(): { response: HttpResponseLike; recorded: Recorded } {
  const recorded: Recorded = { status: undefined, headers: {}, body: '' };
  const response: HttpResponseLike = {
    set statusCode(value: number | undefined) {
      recorded.status = value;
    },
    get statusCode(): number | undefined {
      return recorded.status;
    },
    setHeader(name: string, value: string) {
      recorded.headers[name] = value;
      return undefined;
    },
    end(body?: string) {
      recorded.body = body ?? '';
      return undefined;
    },
  };
  return { response, recorded };
}

/** 假 webServer：**带重复 `(kind,path)` 检测**（照宿主的真实行为，漏 disposer 会立刻红） */
function fakeWebServer(): { surface: WebServerSurfaceLike; routes: WebServerRoute[]; registerCalls: number } {
  const routes: WebServerRoute[] = [];
  const state = { registerCalls: 0 };
  return {
    routes,
    get registerCalls() {
      return state.registerCalls;
    },
    surface: {
      register(route: WebServerRoute): () => void {
        state.registerCalls += 1;
        if (routes.some((item) => item.kind === route.kind && item.path === route.path)) {
          throw new Error(`重复注册 (${route.kind}, ${route.path})：宿主会直接抛错（disposer 漏登记的后果）`);
        }
        routes.push(route);
        let removed = false;
        return () => {
          if (removed) return;
          removed = true;
          const index = routes.indexOf(route);
          if (index >= 0) routes.splice(index, 1);
        };
      },
    },
  };
}

interface FakeCtx {
  readonly ctx: RoutePluginContextLike;
  readonly effects: (() => void)[];
  readonly web: ReturnType<typeof fakeWebServer>;
}

function fakeCtx(options: { readonly withEffect?: boolean; readonly withWebServer?: boolean } = {}): FakeCtx {
  const web = fakeWebServer();
  const effects: (() => void)[] = [];
  const ctx: RoutePluginContextLike = {
    ...(options.withWebServer === false ? {} : { get: (serviceName: string) => (serviceName === 'webServer' ? web.surface : undefined) }),
    ...(options.withEffect === false
      ? {}
      : {
          effect: (callback: () => (() => void) | void) => {
            const disposer = callback();
            if (typeof disposer === 'function') effects.push(disposer);
            return undefined;
          },
        }),
  };
  return { ctx, effects, web };
}

/** 只记账的装配器（断言「传了什么声明」用；不跑任何探针） */
function spyBuilder(): { builder: SnapshotBuilder; calls: { declaration: SnapshotDeclaration; allowColdStart: boolean }[] } {
  const calls: { declaration: SnapshotDeclaration; allowColdStart: boolean }[] = [];
  return {
    calls,
    builder: {
      build: (declaration, options = {}) => {
        calls.push({ declaration, allowColdStart: options.allowColdStart === true });
        return Promise.resolve({ ok: false, code: 'internal', message: 'spy' });
      },
    },
  };
}

const OK_DECLARATION: SnapshotDeclaration = { managedPorts: [...FIXTURE_PORTS], scopes: {}, elevationPolicy: 'none' };

function snapshotDeps(fake: ReturnType<typeof routingExecutor>): SnapshotDeps {
  return {
    executor: fake.executor,
    readNetworkingMode: () => Promise.resolve({ ok: true, path: WSL_CONFIG, mode: 'default', resolved: 'nat' }),
    localhostForwarding: { filePath: WSL_CONFIG, readFile: () => Promise.resolve(WSL_CONFIG_TEXT) },
    now: () => Date.UTC(2026, 9, 9, 4, 0, 0),
  };
}

/* ────────────────────────── 判据 ────────────────────────── */

test('T6.8 ① 注册形状：prefix + 独占前缀 + 装载期零命令零请求', () => {
  const fake = routingExecutor();
  const spy = spyBuilder();
  const host = fakeCtx();
  const registration = registerPortsRoute(host.ctx, spy.builder);

  assert.equal(registration.registered, true);
  assert.equal(registration.registrationCount(), 1);
  assert.equal(host.web.routes.length, 1);
  assert.equal(host.web.routes[0]?.kind, 'prefix', 'HTTP 只读快照用 prefix 即可（不需要 upgrade）');
  assert.equal(host.web.routes[0]?.path, PORTS_HTTP_PREFIX);
  assert.equal(PORTS_HTTP_PREFIX, '/dsh-wsl-docker-ports/');
  assert.notEqual(PORTS_HTTP_PREFIX, '/dsh-managed-terminal/', '必须独占前缀（蹭 002 的前缀会在改路径/卸载顺序上互相破坏）');
  assert.equal(registration.paths.snapshot, PORTS_SNAPSHOT_PATH);
  assert.equal(registration.requestCount(), 0, '装载期不得处理任何请求');
  assert.equal(spy.calls.length, 0, '装载期不得装配快照');
  assert.equal(fake.calls.length, 0, `装载期不得执行任何外部命令，实际 ${String(fake.calls.length)} 条`);
  console.log(`  · 装载扫了 ${String(host.web.registerCalls)} 次 register / ${String(fake.calls.length)} 条外部命令 / ${String(spy.calls.length)} 次装配；prefix=${PORTS_HTTP_PREFIX}`);
});

test('T6.8 ② disposer 归 ctx.effect：卸载后注册数归零，且同 (kind,path) 能重新注册', () => {
  const host = fakeCtx();
  const builder = spyBuilder().builder;
  const first = registerPortsRoute(host.ctx, builder);
  assert.equal(host.effects.length, 1, 'register 必须被 ctx.effect 收编（宿主不会自动回收路由）');

  // 卸载：调 effect 收编的那个 disposer（= 宿主卸载插件时做的事）
  host.effects[0]?.();
  assert.equal(first.registrationCount(), 0, '卸载后必须归零');
  assert.equal(host.web.routes.length, 0, '路由必须从宿主面移除');

  // 重新挂载：若上面漏了 disposer，这里的 register 会因重复 (kind,path) 抛错
  const second = registerPortsRoute(host.ctx, builder);
  assert.equal(second.registered, true);
  assert.equal(host.web.routes.length, 1);
  // 幂等：dispose 两次只移除一次
  second.dispose();
  second.dispose();
  assert.equal(second.registrationCount(), 0);
  console.log(`  · 卸载/重挂各扫了 1 次：注册数 ${String(first.registrationCount())} → ${String(host.web.routes.length)}，disposer 幂等 ✅`);
});

test('T6.8 ② 没有 ctx.effect 时也不崩：注册照做，靠手动 dispose()（并如实记在 plugin 的 gaps 里）', () => {
  const host = fakeCtx({ withEffect: false });
  const registration = registerPortsRoute(host.ctx, spyBuilder().builder);
  assert.equal(registration.registered, true);
  assert.equal(registration.registrationCount(), 1);
  registration.dispose();
  assert.equal(registration.registrationCount(), 0);
  assert.equal(host.web.routes.length, 0);
  console.log('  · 无 effect 扫了 1 次：注册 ✅ / 手动 dispose 后归零 ✅');
});

test('T6.8 ① 缺 webServer 时不注册、不抛，且给得出原因（客户端半据此降级）', () => {
  const host = fakeCtx({ withWebServer: false });
  const registration = registerPortsRoute(host.ctx, spyBuilder().builder);
  assert.equal(registration.registered, false);
  assert.match(String(registration.reason), /webServer/u);
  assert.match(String(registration.reason), /ports-source-missing/u, '要写清客户端半的后果');
  assert.equal(host.web.routes.length, 0);
  assert.equal(registration.registrationCount(), 0);
  assert.equal(registration.requestCount(), 0);
  registration.dispose();
  console.log(`  · 空 ctx 扫了 ${String(host.web.registerCalls)} 次 register（要求 0）；reason 长度 ${String(String(registration.reason).length)}`);
});

test('T6.8 ③ HTTP 语义：前缀内未知路径 404 / 非 GET 405', async () => {
  const host = fakeCtx();
  registerPortsRoute(host.ctx, spyBuilder().builder);
  const handler = host.web.routes[0]?.handler;
  assert.equal(typeof handler, 'function');
  if (handler === undefined) return;

  const missing = fakeResponse();
  await handler({ url: `${PORTS_HTTP_PREFIX}whatever?x=1`, method: 'GET' }, missing.response);
  assert.equal(missing.recorded.status, 404);
  const missingBody = JSON.parse(missing.recorded.body) as PortsSnapshotResponse;
  assert.equal(missingBody.ok, false);
  assert.equal(missingBody.ok === false ? missingBody.error.code : '', 'not-found');

  const wrongMethod = fakeResponse();
  await handler({ url: PORTS_SNAPSHOT_PATH, method: 'POST' }, wrongMethod.response);
  assert.equal(wrongMethod.recorded.status, 405);
  const wrongBody = JSON.parse(wrongMethod.recorded.body) as PortsSnapshotResponse;
  assert.equal(wrongBody.ok === false ? wrongBody.error.code : '', 'method-not-allowed');

  const otherPackage = fakeResponse();
  await handler({ url: '/dsh-managed-terminal/instances', method: 'GET' }, otherPackage.response);
  assert.equal(otherPackage.recorded.status, 404, '002 的路径不在本前缀内 ⇒ 本处理器一律 404（不抢别人的路由）');
  console.log(`  · 扫了 3 个请求：未知路径 404 / POST 405 / 别人的前缀 404`);
});

test('T6.8 ③ 查询参数解码：声明逐字段到位，`allowColdStart=1` 才放行冷启动', async () => {
  const spy = spyBuilder();
  const host = fakeCtx();
  registerPortsRoute(host.ctx, spy.builder);
  const handler = host.web.routes[0]?.handler;
  if (handler === undefined) return;

  const call = fakeResponse();
  await handler(
    { url: `${PORTS_SNAPSHOT_PATH}?managedPorts=3306&managedPorts=1000-3000&scope=3306%3Alan&scope=bogus&scope=5432%3Aweird&elevationPolicy=ask&distro=Ubuntu2204&allowColdStart=1`, method: 'GET' },
    call.response,
  );
  assert.equal(spy.calls.length, 1);
  assert.deepEqual(spy.calls[0]?.declaration, {
    managedPorts: ['3306', '1000-3000'],
    scopes: { 3306: 'lan' },
    elevationPolicy: 'ask',
    distro: 'Ubuntu2204',
  }, '非法 scope（`bogus` / `5432:weird`）一律丢弃 ⇒ 落回 loopback 默认');
  assert.equal(spy.calls[0]?.allowColdStart, true);

  const noCold = fakeResponse();
  await handler({ url: PORTS_SNAPSHOT_PATH, method: 'GET' }, noCold.response);
  assert.equal(spy.calls[1]?.allowColdStart, false, '缺省**不**允许冷启动（REQ-6.4：只允许用户显式动作）');
  assert.deepEqual(spy.calls[1]?.declaration, { managedPorts: [], scopes: {}, elevationPolicy: 'none' }, '缺省声明 = 空集合 + 最保守策略');
  console.log(`  · 扫了 2 个请求：声明 ${JSON.stringify(spy.calls[0]?.declaration)}；编码↔解码同源（wire.ts 一份）`);
});

test('T6.8 ③ 503：规则读不到 ⇒ rules-unavailable（带 hint，且不含明文秘密）', async () => {
  const host = fakeCtx();
  registerPortsRoute(host.ctx, createSnapshotBuilder(snapshotDeps(routingExecutor({ netsh: false }))));
  const handler = host.web.routes[0]?.handler;
  if (handler === undefined) return;

  const call = fakeResponse();
  await handler({ url: PORTS_SNAPSHOT_PATH, method: 'GET' }, call.response);
  assert.equal(call.recorded.status, 503);
  const body = JSON.parse(call.recorded.body) as PortsSnapshotResponse;
  assert.equal(body.ok, false);
  assert.equal(body.ok === false ? body.error.code : '', 'rules-unavailable');
  assert.equal(call.recorded.body.includes('hunter2'), false, 'REQ-3.5：错误文案也要脱敏');
  assert.equal(call.recorded.headers['Content-Type'], 'application/json; charset=utf-8');
  console.log(`  · 扫了 1 个请求 → 503 ${JSON.stringify(body.ok === false ? body.error.code : '')}`);
});

test('T6.8 ③ 500：装配抛异常 ⇒ internal（路由绝不把异常漏给宿主 http 层）', async () => {
  const host = fakeCtx();
  registerPortsRoute(host.ctx, { build: () => { throw new Error('装配炸了'); } });
  const handler = host.web.routes[0]?.handler;
  if (handler === undefined) return;

  const call = fakeResponse();
  await handler({ url: PORTS_SNAPSHOT_PATH, method: 'GET' }, call.response);
  assert.equal(call.recorded.status, 500);
  const body = JSON.parse(call.recorded.body) as PortsSnapshotResponse;
  assert.equal(body.ok === false ? body.error.code : '', 'internal');
  assert.match(body.ok === false ? body.error.message : '', /装配炸了/u);
  console.log('  · 扫了 1 个抛出 → 500 internal');
});

test('T6.8 ③+④ 端到端：200 + 真 fixture 装配，且返回的判决与「同批事实直接喂 diff()」逐字相等', async () => {
  const fake = routingExecutor();
  const host = fakeCtx();
  const registration = registerPortsRoute(host.ctx, createSnapshotBuilder(snapshotDeps(fake)));
  const handler = host.web.routes[0]?.handler;
  if (handler === undefined) return;

  const query = OK_DECLARATION.managedPorts.map((port) => `managedPorts=${port}`).join('&');
  const call = fakeResponse();
  await handler({ url: `${PORTS_SNAPSHOT_PATH}?${query}`, method: 'GET' }, call.response);

  assert.equal(call.recorded.status, 200);
  assert.equal(call.recorded.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(call.recorded.headers['Content-Length'], String(Buffer.byteLength(call.recorded.body)), 'Content-Length 必须按 UTF-8**字节**算（中文文案按字符算会短）');
  assert.equal(call.recorded.headers['Cache-Control'], 'no-store');
  assert.equal(registration.requestCount(), 1);

  const body = JSON.parse(call.recorded.body) as PortsSnapshotResponse;
  assert.equal(body.ok, true);
  if (!body.ok) return;
  const { snapshot } = body;
  assert.equal(snapshot.refreshedAt, Date.UTC(2026, 9, 9, 4, 0, 0));
  assert.equal(snapshot.diff.ok, true);
  assert.equal(snapshot.managedPortsDecl.length, 19);
  if (!snapshot.diff.ok) return;
  assert.equal(snapshot.diff.result.eth0Ip, ETH0);
  assert.equal(snapshot.diff.result.ports.length, 19);

  // 独立复算（不经 HTTP 层）：判决必须与「同一批事实直接喂引擎」逐字相等
  const distros = await listDistros(fake.executor);
  const rules = await probePortproxyRules(fake.executor, {});
  const containers = distros.ok ? await probeDockerPs(fake.executor, 'Ubuntu2204', distros.distros, {}) : null;
  const parsed = parseManagedPorts([...FIXTURE_PORTS]);
  assert.equal(rules.ok && parsed.ok && containers !== null && containers.ok, true);
  if (rules.ok && parsed.ok && containers !== null && containers.ok) {
    const recomputed = diff({ containers: containers.containers, managedPorts: parsed.ports, rules: rules.rules, eth0Ip: ETH0, localhostForwarding: true, scopes: {} });
    assert.deepEqual(snapshot.diff, recomputed, '判据①：路由返回的快照必须与 diff 的输入一致（装配层不得丢/改事实）');
  }
  // 传输层必须是纯数据：JSON 往返逐字相等
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  console.log(`  · 端到端扫了 ${String(call.recorded.body.length)} 字节响应 / 判决 counts=${JSON.stringify(snapshot.diff.result.counts)}；Content-Length=${String(call.recorded.headers['Content-Length'])}`);
});

test('T6.8 编解码互为逆：parseSnapshotQuery(buildSnapshotQuery(x)) 逐字段等于 x', () => {
  const samples: SnapshotDeclaration[] = [
    { managedPorts: ['3306', '1000-3000', '8080'], scopes: { 3306: 'lan', 8080: 'loopback' }, elevationPolicy: 'ask', distro: 'Ubuntu2204' },
    { managedPorts: [], scopes: {}, elevationPolicy: 'none' },
    { managedPorts: ['50051'], scopes: {}, elevationPolicy: 'passby' },
  ];
  let scanned = 0;
  for (const declaration of samples) {
    for (const allowColdStart of [false, true]) {
      const parsed = parseSnapshotQuery(`${PORTS_SNAPSHOT_PATH}?${buildSnapshotQuery(declaration, allowColdStart)}`);
      assert.deepEqual(parsed.declaration, declaration, `往返失败：${JSON.stringify(declaration)}`);
      assert.equal(parsed.allowColdStart, allowColdStart);
      scanned += 1;
    }
  }
  assert.equal(scanned, 6, '扫描数必须固定，否则判据可能被空循环绕过');
  console.log(`  · 扫了 ${String(scanned)} 次往返（3 份声明 × 冷启动开关），逐字段相等`);
});
