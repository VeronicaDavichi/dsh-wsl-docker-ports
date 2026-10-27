/**
 * 010 `T7.1` 的路由判据（`node --test`，零真机）—— 真机教训的直接回归：
 *
 * - **鉴权最靠前**（`REQ-11.4`）：无凭据 ⇒ 401，且**不读请求体、不调 resolveTarget、不碰 docker**
 *   （判据是 `0 次`，不是文案）—— `U1` 的「Agent 来源被拒」就落在这条上；
 * - 判据顺序照抄 008：已知路径才谈方法（405 可达）· 未知路径一律 404；
 * - `U2`：`?tail=` 越界夹到 200，argv 里出现的是**夹紧后**的值；
 * - 缺 `webServer` ⇒ `pending`/`missing` 两态分开（与服务晚到的真机行为一致）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Executor, WslDistro } from 'dsh-wsl-shared';

import type { HttpResponseLike } from '../../src/route.ts';
import { registerContainerRoute } from '../../src/docker/route.ts';
import type { ContainerTarget } from '../../src/docker/route.ts';
import { CONTAINER_HTTP_PREFIX } from '../../src/docker/wire.ts';
import { fakeCtx, fakeResponse } from './route-fakes.ts';

const TOKEN = 'tok-1234567890';
const DISTRO = 'Ubuntu2204';
const DISTROS = [{ name: DISTRO, state: 'Running', version: 2, default: true }] as unknown as readonly WslDistro[];

interface Recorded {
  readonly argv: readonly string[];
}

function fakeExec(): { executor: Executor; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const executor: Executor = (_file, argv) => {
    calls.push({ argv: [...argv] });
    return Promise.resolve({ ok: true, exitCode: 0, stdout: 'log line\n', stderr: '' });
  };
  return { executor, calls };
}

interface CallLog {
  bodyReads: number;
  targetCalls: number;
}

/** 假请求：`headers` 参与鉴权、`[Symbol.asyncIterator]` 记「是否被读体」 */
function fakeRequest(input: {
  readonly url: string;
  readonly method: string;
  readonly token?: string | undefined;
  readonly body?: unknown;
  readonly log: CallLog;
}): { url: string; method: string; headers: Record<string, string>; [Symbol.asyncIterator](): AsyncIterator<string> } {
  const payload = input.body === undefined ? '' : JSON.stringify(input.body);
  return {
    url: input.url,
    method: input.method,
    headers: input.token === undefined ? {} : { authorization: `Bearer ${input.token}` },
    [Symbol.asyncIterator]() {
      input.log.bodyReads += 1;
      let done = false;
      return {
        next: () => {
          if (done) return Promise.resolve({ done: true, value: undefined });
          done = true;
          return Promise.resolve({ done: false, value: payload });
        },
      };
    },
  };
}

function setup(options: { readonly token?: string | undefined; readonly noWebServer?: boolean } = {}): {
  readonly register: ReturnType<typeof registerContainerRoute>;
  readonly call: (request: ReturnType<typeof fakeRequest>) => Promise<{ status: number | undefined; body: string }>;
  readonly exec: ReturnType<typeof fakeExec>;
  readonly log: CallLog;
  readonly routes: number;
} {
  const host = fakeCtx(options.noWebServer === true ? { withWebServer: false } : {});
  const exec = fakeExec();
  const log: CallLog = { bodyReads: 0, targetCalls: 0 };
  const register = registerContainerRoute(host.ctx, {
    writeToken: () => (options.token === undefined ? undefined : options.token),
    executor: exec.executor,
    resolveTarget: (): Promise<ContainerTarget> => {
      log.targetCalls += 1;
      return Promise.resolve({ ok: true, name: DISTRO, distros: DISTROS });
    },
  });
  const route = host.web.routes[0];
  return {
    register,
    exec,
    log,
    routes: host.web.routes.length,
    call: async (request) => {
      assert.notEqual(route, undefined, '路由必须已注册');
      const call = fakeResponse();
      await (route as { handler: (request: unknown, response: HttpResponseLike) => Promise<void> }).handler(request, call.response);
      return { status: call.recorded.status, body: call.recorded.body };
    },
  };
}

test('注册：容器通道独占前缀 `/dsh-wsl-docker-ports/container`（与快照 / 写通道互不重叠）', () => {
  const { register, routes } = setup({ token: TOKEN });
  assert.equal(register.registered, true);
  assert.equal(register.state, 'registered');
  assert.equal(routes, 1);
  assert.equal(register.paths.action, `${CONTAINER_HTTP_PREFIX}/action`);
  assert.equal(register.paths.logs, `${CONTAINER_HTTP_PREFIX}/logs`);
});

test('缺 webServer：不注册、pending 与 missing 分开说（服务晚到是常态，不是失败）', () => {
  const host = fakeCtx({ withWebServer: false });
  const register = registerContainerRoute(host.ctx, {
    writeToken: () => TOKEN,
    executor: fakeExec().executor,
    resolveTarget: () => Promise.resolve({ ok: true, name: DISTRO, distros: DISTROS }),
  });
  assert.equal(register.registered, false);
  assert.equal(register.state, 'pending');
  assert.match(register.reason ?? '', /webServer/);
  assert.equal(host.web.routes.length, 0);
});

test('U1 · 无凭据（Agent 路径）⇒ 401，且**不读体、不解析目标、0 次 docker 调用**', async () => {
  const ctx = setup({ token: TOKEN });
  const response = await ctx.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/action`, method: 'POST', body: { id: 'abc', action: 'stop' }, log: ctx.log }));
  assert.equal(response.status, 401);
  assert.match(response.body, /"code":"unauthorized"/);
  assert.equal(ctx.exec.calls.length, 0, '401 时一次 docker 调用都不能发生');
  assert.equal(ctx.log.bodyReads, 0, '401 时连请求体都不读（不分配内存给未鉴权方）');
  assert.equal(ctx.log.targetCalls, 0, '401 时不解析发行版');
});

test('U1 · 凭据错 ⇒ 401；凭据**未配置** ⇒ fail-safe 401（带上任意 token 也不放行）', async () => {
  const wrong = setup({ token: TOKEN });
  const r1 = await wrong.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/action`, method: 'POST', token: 'not-the-token', body: { id: 'abc', action: 'stop' }, log: wrong.log }));
  assert.equal(r1.status, 401);
  assert.equal(wrong.exec.calls.length, 0);

  const unconfigured = setup({ token: undefined });
  const r2 = await unconfigured.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/action`, method: 'POST', token: 'anything', body: { id: 'abc', action: 'stop' }, log: unconfigured.log }));
  assert.equal(r2.status, 401, '未配置凭据时通道默认不可用（与 008 同一取向）');
  assert.equal(unconfigured.exec.calls.length, 0);
});

test('U1 · 合法请求 ⇒ 200 且恰好 1 次 docker 调用（argv 逐字）', async () => {
  const ctx = setup({ token: TOKEN });
  const response = await ctx.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/action`, method: 'POST', token: TOKEN, body: { id: 'abc123', action: 'restart' }, log: ctx.log }));
  assert.equal(response.status, 200);
  assert.match(response.body, /"ok":true/);
  assert.match(response.body, /"action":"restart"/);
  assert.equal(ctx.exec.calls.length, 1);
  assert.deepEqual(ctx.exec.calls[0]?.argv, ['-d', DISTRO, '--', 'docker', 'restart', 'abc123']);
});

test('400 · 非法 id / 非法 action / 畸形 JSON ⇒ 都是 400，且 0 次 docker 调用', async () => {
  const ctx = setup({ token: TOKEN });
  for (const body of [
    { id: 'a;b', action: 'stop' },
    { id: 'abc', action: 'kill' },
    { action: 'stop' },
    { id: 'abc' },
  ]) {
    const response = await ctx.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/action`, method: 'POST', token: TOKEN, body, log: ctx.log }));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(response.body, /"code":"bad-request"/);
  }
  const broken = await ctx.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/action`, method: 'POST', token: TOKEN, body: 'not-json-object', log: ctx.log }));
  assert.equal([400, 200].includes(broken.status ?? 0), true, '字符串体不是对象 ⇒ 400（或按缺 id 处理）');
  assert.equal(ctx.exec.calls.length, 0, '被拒的请求一次 docker 都不能调');
});

test('判据顺序：已知路径错方法 ⇒ 405；未知路径 ⇒ 404（不管方法）', async () => {
  const ctx = setup({ token: TOKEN });
  const onAction = await ctx.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/action`, method: 'GET', token: TOKEN, log: ctx.log }));
  assert.equal(onAction.status, 405);
  const onLogs = await ctx.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/logs`, method: 'POST', token: TOKEN, log: ctx.log }));
  assert.equal(onLogs.status, 405);
  const unknown = await ctx.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/nope`, method: 'POST', token: TOKEN, log: ctx.log }));
  assert.equal(unknown.status, 404);
  assert.equal(ctx.exec.calls.length, 0);
});

test('U2 · 日志：`?tail=5000` 夹到 200，argv 里是夹紧后的值；正文原样回传', async () => {
  const ctx = setup({ token: TOKEN });
  const response = await ctx.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/logs?id=abc123&tail=5000`, method: 'GET', token: TOKEN, log: ctx.log }));
  assert.equal(response.status, 200);
  assert.match(response.body, /"tail":200/);
  assert.match(response.body, /log line/);
  assert.deepEqual(ctx.exec.calls[0]?.argv, ['-d', DISTRO, '--', 'docker', 'logs', '--tail', '200', 'abc123']);
});

test('日志缺 id ⇒ 400（一次 docker 都不调）；请求计数与注册计数据实', async () => {
  const ctx = setup({ token: TOKEN });
  const response = await ctx.call(fakeRequest({ url: `${CONTAINER_HTTP_PREFIX}/logs`, method: 'GET', token: TOKEN, log: ctx.log }));
  assert.equal(response.status, 400);
  assert.equal(ctx.exec.calls.length, 0);
  assert.equal(ctx.register.requestCount(), 1);
  assert.equal(ctx.register.registrationCount(), 1);
});

test('卸载：dispose 摘掉路由且幂等（宿主漏收编会在重挂载时因重复 (kind,path) 抛错）', () => {
  const host = fakeCtx();
  const register = registerContainerRoute(host.ctx, {
    writeToken: () => TOKEN,
    executor: fakeExec().executor,
    resolveTarget: () => Promise.resolve({ ok: true, name: DISTRO, distros: DISTROS }),
  });
  assert.equal(host.web.routes.length, 1);
  register.dispose();
  register.dispose();
  assert.equal(host.web.routes.length, 0);
  assert.equal(register.registered, false);
});
