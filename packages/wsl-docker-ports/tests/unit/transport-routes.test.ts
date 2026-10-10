/**
 * 008 T1.1 写入通道路由骨架（`node --test`，零真机、零真实进程、零副作用）
 *
 * 判据：
 * ① **注册形状**：`kind:'prefix'` + 独占前缀（**不带尾斜杠**）+ 装载期零请求、零 deps 调用；
 *    ①b **反例**（对抗性）：把前缀写成带尾斜杠 ⇒ 宿主判据再也不分派 ⇒ 至少 2 条红（复刻真机缺陷）；
 * ② **disposer 归 `ctx.effect`**：卸载后注册数归零，且**同 `(kind,path)` 能重新注册**
 *    （假宿主对重复 `(kind,path)` 抛错 —— 这正是漏登记 disposer 的真实后果）；
 * ③ **HTTP 语义**：未知路径 404（含本前缀根）/ 已知路径错方法 405 / **404 优先于 405** /
 *    200 + JSON + `Content-Length` 按 **UTF-8 字节**（含中文与 emoji）+ `Cache-Control: no-store` /
 *    deps 缺失 503 / deps 抛异常 500；
 * ④ **参数透传**：`plan` 收到解析后的 body；畸形 JSON 与超限**不抛**，作为 `problem` 传给 `plan`；
 *    `apply` 只收到四个白名单字段（客户端塞别的一律忽略）；
 * ⑤ **缺 webServer** ⇒ 不注册 + 记原因（不是失败，也不谎报缺失）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { HttpRequestLike, HttpResponseLike, RoutePluginContextLike, WebServerRoute, WebServerSurfaceLike } from '../../src/route.ts';
import {
  WRITE_APPLY_PATH,
  WRITE_AUDIT_PATH,
  WRITE_BODY_MAX_BYTES,
  WRITE_HTTP_PREFIX,
  WRITE_PLAN_PATH,
} from '../../src/transport/constants.ts';
import { registerWriteRoute, statusForWrite } from '../../src/transport/routes.ts';
import type { WriteRequestLike, WriteRouteDeps, WriteRouteResult } from '../../src/transport/routes.ts';

const encoder = new TextEncoder();

/** 宿主判据的**逐字复刻**（真机缺陷：带尾斜杠 ⇒ 注册成功但永不被分派） */
function hostMatches(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function fakeSurface(): {
  readonly surface: WebServerSurfaceLike;
  readonly routes: WebServerRoute[];
  registerCalls(): number;
} {
  const routes: WebServerRoute[] = [];
  const seen = new Set<string>();
  let calls = 0;
  return {
    surface: {
      register(route: WebServerRoute): () => void {
        calls += 1;
        const key = `${route.kind}:${route.path}`;
        if (seen.has(key)) throw new Error(`host: duplicate (kind, path) ${key}`);
        seen.add(key);
        routes.push(route);
        return () => {
          seen.delete(key);
          const index = routes.indexOf(route);
          if (index >= 0) routes.splice(index, 1);
        };
      },
    },
    routes,
    registerCalls: () => calls,
  };
}

function fakeCtx(surface: WebServerSurfaceLike | undefined): {
  readonly ctx: { get: (n: string) => unknown; inject: (n: readonly string[], cb: (s: RoutePluginContextLike) => void) => void; effect: (cb: () => (() => void) | void, label?: string) => void };
  readonly effects: (() => void)[];
  readonly injectNames: string[][];
} {
  const effects: (() => void)[] = [];
  const injectNames: string[][] = [];
  const scope = { get: (name: string) => (name === 'webServer' ? surface : undefined) };
  return {
    ctx: {
      get: (name: string) => (name === 'webServer' ? surface : undefined),
      inject: (names: readonly string[], callback: (s: RoutePluginContextLike) => void) => {
        injectNames.push([...names]);
        callback(scope);
      },
      effect: (callback: () => (() => void) | void) => {
        // cordis 语义：**调用**工厂并收编它返回的 disposer（与既有 route-fakes.ts:111-113 逐字一致）
        const disposer = callback();
        if (typeof disposer === 'function') effects.push(disposer);
      },
    },
    effects,
    injectNames,
  };
}

function fakeResponse(): HttpResponseLike & { readonly headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = {};
  return {
    statusCode: 0,
    headers,
    body: '',
    setHeader(name: string, value: string): void {
      headers[name] = value;
    },
    end(body?: string): void {
      if (body !== undefined) (this as { body: string }).body = body;
    },
  };
}

function request(url: string, method: string, body?: string): WriteRequestLike {
  const chunks = body === undefined ? [] : [encoder.encode(body)];
  return {
    url,
    method,
    [Symbol.asyncIterator]: async function* (): AsyncIterator<Uint8Array> {
      for (const chunk of chunks) yield chunk;
    },
  };
}

const never = (): Promise<WriteRouteResult> => Promise.resolve({ ok: true, payload: { unused: true } });

function deps(overrides: Partial<WriteRouteDeps> = {}): WriteRouteDeps {
  return { plan: () => never(), ...overrides };
}

/** 走一遍宿主分派 + 处理器（含「无匹配 ⇒ 宿主兜底 404」的返回 `undefined`） */
async function roundTrip(
  routes: readonly WebServerRoute[],
  req: WriteRequestLike,
): Promise<{ readonly handled: true; readonly response: ReturnType<typeof fakeResponse> } | { readonly handled: false }> {
  const pathname = new URL(req.url ?? '/', 'http://dsh.invalid').pathname;
  const route = routes.find((item) =>
    item.kind === 'prefix' ? hostMatches(item.path, pathname) : item.path === pathname,
  );
  if (route === undefined) return { handled: false };
  const response = fakeResponse();
  await route.handler(req as HttpRequestLike, response);
  return { handled: true, response };
}

test('T1.1 ① 注册形状：prefix + 独占前缀（不带尾斜杠）+ 装载期零请求零 deps 调用', () => {
  const fake = fakeSurface();
  const host = fakeCtx(fake.surface);
  let planCalls = 0;
  const registration = registerWriteRoute(host.ctx, deps({ plan: (t) => { planCalls += 1; return Promise.resolve({ ok: true, payload: t }); } }));

  assert.equal(registration.registered, true);
  assert.equal(registration.registrationCount(), 1);
  assert.equal(fake.routes.length, 1);
  assert.equal(fake.routes[0]?.kind, 'prefix');
  assert.equal(fake.routes[0]?.path, WRITE_HTTP_PREFIX);
  // 🔴 对外字面量（不从实现里取期望值）：宿主判据 `pathname !== prefix && !startsWith(`${prefix}/`)`
  assert.equal(WRITE_HTTP_PREFIX, '/dsh-wsl-docker-ports/write', '前缀必须无尾斜杠');
  assert.equal(WRITE_PLAN_PATH, '/dsh-wsl-docker-ports/write/plan');
  assert.equal(WRITE_APPLY_PATH, '/dsh-wsl-docker-ports/write/apply');
  assert.equal(WRITE_AUDIT_PATH, '/dsh-wsl-docker-ports/write/audit');
  assert.deepEqual(host.injectNames, [['webServer']], '必须走宿主可用时机（惰性注入）');
  assert.equal(host.effects.length, 1, 'disposer 必须归 ctx.effect');
  assert.equal(registration.requestCount(), 0, '装载期不得处理任何请求');
  assert.equal(planCalls, 0, '装载期不得调用 deps');
  assert.equal(registration.paths.prefix, WRITE_HTTP_PREFIX);
  console.log(`  · 装载 register ${String(fake.registerCalls())} 次；prefix=${WRITE_HTTP_PREFIX}`);
});

test('T1.1 ①b 反例（对抗性）：前缀带尾斜杠 ⇒ 宿主判据再也不分派 ⇒ 缺陷复现', () => {
  const bad = `${WRITE_HTTP_PREFIX}/`;
  assert.equal(hostMatches(WRITE_HTTP_PREFIX, WRITE_PLAN_PATH), true, '正确前缀必须命中');
  assert.equal(hostMatches(bad, WRITE_PLAN_PATH), false, '带尾斜杠 ⇒ 永不命中（真机＝宿主兜底 404、零报错）');
  assert.equal(WRITE_HTTP_PREFIX.endsWith('/'), false, '本常量一旦带上尾斜杠，这条先红');
  for (const path of [WRITE_PLAN_PATH, WRITE_APPLY_PATH, WRITE_AUDIT_PATH]) {
    assert.equal(path.startsWith(`${WRITE_HTTP_PREFIX}/`), true, `${path} 必须在前缀之下`);
  }
});

test('T1.1 ② disposer：卸载后注册数归零，且同 (kind,path) 能重新注册', () => {
  const fake = fakeSurface();
  const host = fakeCtx(fake.surface);
  const first = registerWriteRoute(host.ctx, deps());
  assert.equal(fake.routes.length, 1);

  host.effects[0]?.();
  assert.equal(first.registrationCount(), 0, '卸载后必须归零');
  assert.equal(fake.routes.length, 0, '必须从宿主面移除');

  // 若上面漏了 disposer，这里会因重复 (kind,path) 抛错（假宿主复刻宿主行为）
  const second = registerWriteRoute(host.ctx, deps());
  assert.equal(second.registered, true);
  assert.equal(fake.routes.length, 1);
});

test('T1.1 ③ HTTP 语义：404 / 405 / 404 优先 / 503 / 500 / 字节精确的 Content-Length', async () => {
  const fake = fakeSurface();
  const host = fakeCtx(fake.surface);
  const audit = (): WriteRouteResult => ({ ok: true, payload: { ok: true, records: [], 中文: '端口转发', emoji: '🐋' } });
  registerWriteRoute(host.ctx, deps({ audit }));

  // 未知路径（含本前缀根）⇒ 404 + 我们的 JSON（不是宿主兜底）
  const unknown = await roundTrip(fake.routes, request(`${WRITE_HTTP_PREFIX}/nope`, 'POST', '{}'));
  assert.equal(unknown.handled, true, '前缀之内的未知路径必须由我们的处理器接住');
  if (unknown.handled) {
    assert.equal(unknown.response.statusCode, 404);
    const body = JSON.parse(unknown.response.body) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'not-found');
  }

  // 🔴 404 优先于 405：未知路径 + 错方法 ⇒ 404
  const both = await roundTrip(fake.routes, request(`${WRITE_HTTP_PREFIX}/nope`, 'DELETE'));
  if (both.handled) assert.equal(both.response.statusCode, 404, '先判路径，后判方法');

  // 已知路径 + 错方法 ⇒ 405
  const wrongMethod = await roundTrip(fake.routes, request(WRITE_PLAN_PATH, 'GET'));
  if (wrongMethod.handled) {
    assert.equal(wrongMethod.response.statusCode, 405);
    assert.equal((JSON.parse(wrongMethod.response.body) as { error: { code: string } }).error.code, 'method-not-allowed');
  }

  // 200 + JSON + Content-Length 按 UTF-8 字节 + no-store
  const ok = await roundTrip(fake.routes, request(WRITE_AUDIT_PATH, 'GET'));
  if (ok.handled) {
    assert.equal(ok.response.statusCode, 200);
    assert.equal(ok.response.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(ok.response.headers['Content-Length'], String(encoder.encode(ok.response.body).length), '中文/emoji 按字符算会短 ⇒ 长连接串包');
    assert.notEqual(ok.response.headers['Content-Length'], String(ok.response.body.length));
    assert.equal(ok.response.headers['Cache-Control'], 'no-store');
  }

  // deps 缺失 ⇒ 503（不是 500）：审计未接线
  const noAudit = fakeSurface();
  const noAuditHost = fakeCtx(noAudit.surface);
  registerWriteRoute(noAuditHost.ctx, deps());
  const unavailable = await roundTrip(noAudit.routes, request(WRITE_AUDIT_PATH, 'GET'));
  if (unavailable.handled) {
    assert.equal(unavailable.response.statusCode, 503);
    assert.equal((JSON.parse(unavailable.response.body) as { error: { code: string } }).error.code, 'rules-unavailable');
  }
  const noApply = await roundTrip(noAudit.routes, request(WRITE_APPLY_PATH, 'POST', '{}'));
  if (noApply.handled) assert.equal(noApply.response.statusCode, 503, 'apply 未接线 ⇒ 503 且零提权零写入');

  // deps 抛异常 ⇒ 500 internal
  const throwing = fakeSurface();
  const throwingHost = fakeCtx(throwing.surface);
  registerWriteRoute(throwingHost.ctx, deps({ plan: () => Promise.reject(new Error('boom')) }));
  const crashed = await roundTrip(throwing.routes, request(WRITE_PLAN_PATH, 'POST', '{}'));
  if (crashed.handled) {
    assert.equal(crashed.response.statusCode, 500);
    assert.match(crashed.response.body, /boom/);
  }

  // 写侧两码的状态码（design §4）
  assert.equal(statusForWrite('confirm-required'), 403);
  assert.equal(statusForWrite('plan-mismatch'), 409);
  assert.equal(statusForWrite('not-found'), 404);
  assert.equal(statusForWrite('method-not-allowed'), 405);
  assert.equal(statusForWrite('rules-unavailable'), 503);
  assert.equal(statusForWrite('internal'), 500);
});

test('T1.1 ④ 参数透传：plan 收到解析后的 body；畸形/超限作为 problem 传入；apply 只收白名单字段', async () => {
  const fake = fakeSurface();
  const host = fakeCtx(fake.surface);
  const seen: { target: unknown; problem?: string | undefined }[] = [];
  const applied: Record<string, unknown>[] = [];
  registerWriteRoute(
    host.ctx,
    deps({
      plan: (target, problem) => {
        seen.push({ target, problem });
        return Promise.resolve({ ok: true, payload: { ok: true, echo: target } });
      },
      apply: (input) => {
        applied.push({ ...input });
        return Promise.resolve({ ok: true, payload: { ok: true } });
      },
    }),
  );

  await roundTrip(fake.routes, request(WRITE_PLAN_PATH, 'POST', JSON.stringify({ ports: [5432], scope: 'lan', action: 'add' })));
  assert.deepEqual(seen[0]?.target, { ports: [5432], scope: 'lan', action: 'add' });
  assert.equal(seen[0]?.problem, undefined);

  await roundTrip(fake.routes, request(WRITE_PLAN_PATH, 'POST', '{ 不是 JSON'));
  assert.equal(seen[1]?.target, undefined);
  assert.match(String(seen[1]?.problem), /不是合法 JSON/);

  const huge = `{"pad":"${'x'.repeat(WRITE_BODY_MAX_BYTES + 1)}"}`;
  await roundTrip(fake.routes, request(WRITE_PLAN_PATH, 'POST', huge));
  assert.match(String(seen[2]?.problem), /超过上限/);

  await roundTrip(
    fake.routes,
    request(WRITE_APPLY_PATH, 'POST', JSON.stringify({ target: { ports: [5432] }, planId: 'abc', confirmed: true, origin: 'agent', ticket: 'tk-1', commands: ['rm -rf /'] })),
  );
  assert.deepEqual(
    Object.keys(applied[0] ?? {}).sort(),
    ['confirmed', 'origin', 'planId', 'problem', 'target', 'ticket'],
    '只透传白名单字段（T2.2 起多一个 `ticket`）⇒ 客户端塞的 commands 被忽略',
  );
  assert.equal(applied[0]?.['ticket'], 'tk-1', '票据必须原样到达 apply（T2.1 签发 / T2.2 消费）');
  assert.equal(applied[0]?.['commands'], undefined, '🔴 绝不接受客户端传来的命令');
});

test('T1.1 ⑤ 缺 webServer ⇒ 不注册 + 记原因；有 inject 但形状不对 ⇒ 不注册且不抛', () => {
  const missingHost = fakeCtx(undefined);
  const missing = registerWriteRoute(missingHost.ctx, deps());
  assert.equal(missing.registered, false);
  assert.equal(missing.state, 'missing');
  assert.match(String(missing.reason), /未提供 webServer/);

  const wrongShapeHost = fakeCtx({} as unknown as WebServerSurfaceLike);
  const wrong = registerWriteRoute(wrongShapeHost.ctx, deps());
  assert.equal(wrong.registered, false);
  assert.equal(wrong.state, 'missing');
  assert.match(String(wrong.reason), /形状不对/);
});
