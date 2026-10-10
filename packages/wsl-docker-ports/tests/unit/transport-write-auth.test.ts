/**
 * 008 T2.9 写通道鉴权（`node --test`，**零真机、零真实进程、零写入**）
 *
 * ## 缺口来源（真机实测，见 `specs/008-write-transport/tasks.md` T2.8 的 A4 观察）
 *
 * 不带宿主 GUI 的 `?token=` 时，`/dsh-wsl-docker-ports/write/{plan,apply,audit}` 仍返回 **200**
 * ⇒ 插件的具名路由**不被**宿主的 token 门覆盖 ⇒ 本机任意进程都能调写端点。T2.9 补上鉴权。
 *
 * ## 所选方案 = (B) 插件自有凭据（侦察结论见 `src/transport/write-auth.ts` 文件头）
 *
 * 宿主**没有**可用的鉴权面可接（注册契约只有 `kind`/`path`/`handler`；本仓可读的
 * `@deepseek-ai/*` 产物里 `webServer` 零命中）⇒ 不臆造 API，改走「配置里的 `writeToken`」。
 *
 * ## 判据（每条都能二值判定）
 *
 * ① **未配置 ⇒ 一律 401**（fail-safe）：三个端点全拒，**零 deps 调用**（零计划、零执行、零读审计），
 *    文案含「未配置写通道凭据」并给出配置方法（`writeToken`）；
 * ② **带错凭据 ⇒ 401**、**带长/短凭据也不抛**（长度不等走同一条常量时间路径），且**不回显凭据**；
 * ③ **凭据正确 ⇒ 行为与今天一致**（plan 200 / apply 走到既有门 / audit 200）、且 **401 优先于 404/405**；
 * ④ **401 不写审计**（用**真**审计环：三个端点被拒后 `audit.size() === 0`）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { WebServerRoute } from '../../src/route.ts';
import { WRITE_APPLY_PATH, WRITE_AUDIT_PATH, WRITE_PLAN_PATH } from '../../src/transport/constants.ts';
import { registerWriteRoute, statusForWrite } from '../../src/transport/routes.ts';
import type { WriteRequestLike, WriteRouteDeps } from '../../src/transport/routes.ts';
import { createWriteAuthenticator, readWriteCredential, WRITE_TOKEN_QUERY_PARAM } from '../../src/transport/write-auth.ts';
import { attachWriteChannel } from '../../src/transport/wire-plugin.ts';
import { fakeCtx, fakeResponse } from './route-fakes.ts';

/** 假装「用户配在 patch 里的随机长串」（测试里唯一的凭据本体；断言它绝不出现在响应里） */
const TOKEN = 'tk-write-3f9a1c2b4d5e6f708192a3b4c5d6e7f8';

const encoder = new TextEncoder();

interface Reply {
  readonly status: number | undefined;
  readonly body: string;
  /** 解析后的响应体：`error` 是声明的形状，其余字段按索引取（payload 各不相同，不为每条用例造类型） */
  readonly json: {
    readonly ok?: boolean;
    readonly error?: { readonly code?: string; readonly message?: string };
    readonly [key: string]: unknown;
  };
}

/** 走一遍宿主口径的分派（最长前缀命中）+ 我们的处理器；请求可带 query、头与体 */
async function call(
  routes: readonly WebServerRoute[],
  url: string,
  method: string,
  init: { readonly body?: string; readonly headers?: Record<string, string> } = {},
): Promise<Reply> {
  const pathname = new URL(url, 'http://dsh.invalid').pathname;
  const route = [...routes]
    .sort((left, right) => right.path.length - left.path.length)
    .find((item) =>
      item.kind === 'exact' ? item.path === pathname : pathname === item.path || pathname.startsWith(`${item.path}/`),
    );
  assert.notEqual(route, undefined, `宿主应当分派 ${url}`);
  const chunks = init.body === undefined ? [] : [encoder.encode(init.body)];
  const request: WriteRequestLike = {
    url,
    method,
    ...(init.headers === undefined ? {} : { headers: init.headers }),
    [Symbol.asyncIterator]: async function* (): AsyncIterator<Uint8Array> {
      for (const chunk of chunks) yield chunk;
    },
  };
  const captured = fakeResponse();
  await route?.handler(request, captured.response);
  const body = captured.recorded.body;
  return {
    status: captured.recorded.status,
    body,
    json: body === '' ? {} : (JSON.parse(body) as Reply['json']),
  };
}

/** 记账的 deps：**任何一次调用都记下来** ⇒ 「401 路径零执行」可二值判定 */
function countingDeps(): { readonly deps: WriteRouteDeps; readonly calls: readonly string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      plan: (target, problem) => {
        calls.push('plan');
        return Promise.resolve({ ok: true, status: 200, payload: { ok: true, planId: 'p-1', echo: target, problem: problem ?? null } });
      },
      apply: (input) => {
        calls.push('apply');
        return Promise.resolve({ ok: true, status: 200, payload: { ok: true, status: 'ok', ticket: input.ticket } });
      },
      audit: () => {
        calls.push('audit');
        return { ok: true, status: 200, payload: { ok: true, records: [] } };
      },
    },
  };
}

const PLAN_BODY = JSON.stringify({ action: 'add', ports: [5900], scope: 'lan', declaration: [{ start: 5900, end: 5900 }] });
const APPLY_BODY = JSON.stringify({ target: { ports: [5900] }, planId: 'p-1', confirmed: true, origin: 'user', ticket: 'tk-1' });
const withToken = (path: string, token: string): string => `${path}?${WRITE_TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}`;

test('T2.9 ① 未配置 writeToken ⇒ 三个端点一律 401（fail-safe）+ 零 deps 调用', async () => {
  const rig = countingDeps();
  const host = fakeCtx();
  const registration = registerWriteRoute(host.ctx, rig.deps); // 🔴 故意不配 writeToken
  assert.equal(registration.authConfigured, false, '未配置必须如实反映在 authConfigured 上');
  assert.equal(statusForWrite('unauthorized'), 401);

  // 未配置 ≠ 放行：**连带上凭据也一样 401**（不做任何比较，直接拒）
  for (const [url, method, body] of [
    [withToken(WRITE_PLAN_PATH, TOKEN), 'POST', PLAN_BODY],
    [WRITE_APPLY_PATH, 'POST', APPLY_BODY],
    [WRITE_AUDIT_PATH, 'GET', undefined],
  ] as const) {
    const reply = await call(host.web.routes, url, method, body === undefined ? {} : { body });
    assert.equal(reply.status, 401, `${method} ${url} 未配置凭据时必须 401（实际 ${String(reply.status)}）`);
    assert.equal(reply.json.error?.code, 'unauthorized');
    assert.match(String(reply.json.error?.message), /未配置写通道凭据/u);
    assert.match(String(reply.json.error?.message), /writeToken/u, '必须给出配置方法，而不是只说「拒绝」');
    assert.equal(reply.body.includes(TOKEN), false, '响应里不得出现凭据本体');
  }
  assert.deepEqual(rig.calls, [], '401 路径必须零 deps 调用（零计划、零执行、零读审计）');
});

test('T2.9 ② 配了凭据但缺失/错误 ⇒ 401；长度不等不抛；响应不回显凭据', async () => {
  const rig = countingDeps();
  const host = fakeCtx();
  const registration = registerWriteRoute(host.ctx, { ...rig.deps, writeToken: TOKEN });
  assert.equal(registration.authConfigured, true);

  const missing = await call(host.web.routes, WRITE_PLAN_PATH, 'POST', { body: PLAN_BODY });
  assert.equal(missing.status, 401);
  assert.equal(missing.json.error?.code, 'unauthorized');
  assert.match(String(missing.json.error?.message), /缺少写通道凭据/u);

  const wrong = 'tk-write-wrong';
  const mismatch = await call(host.web.routes, withToken(WRITE_PLAN_PATH, wrong), 'POST', { body: PLAN_BODY });
  assert.equal(mismatch.status, 401);
  assert.match(String(mismatch.json.error?.message), /凭据不正确/u);
  assert.equal(mismatch.body.includes(wrong), false, '🔴 绝不回显客户端给的凭据');
  assert.equal(mismatch.body.includes(TOKEN), false, '🔴 也绝不回显期望值');

  // 长度不等 / 极长：同一路径、不抛（`timingSafeEqual` 对长度不等会抛 ⇒ 我们比的是 sha256 摘要）
  const long = 'x'.repeat(4096);
  for (const candidate of ['', 'a', long, `${TOKEN} `, TOKEN.toUpperCase()]) {
    const reply = await call(host.web.routes, withToken(WRITE_APPLY_PATH, candidate), 'POST', { body: APPLY_BODY });
    assert.equal(reply.status, 401, `候选凭据 ${candidate.slice(0, 8)}…（长度 ${String(candidate.length)}）必须 401`);
    assert.equal(reply.body.includes(TOKEN), false, '任何分支都不许回显期望值');
    // 单字符候选（`a`）会被 `unauthorized` 这种固定英文词偶然命中 ⇒ 只在「有辨识度」时断言不回显
    if (candidate.length >= 8) {
      assert.equal(reply.body.includes(candidate), false, `🔴 绝不回显客户端给的凭据：${candidate.slice(0, 8)}…`);
    }
  }
  // 空串 = 「没带」（不是「带了个空凭据」），走 `缺少` 那条文案
  const empty = await call(host.web.routes, withToken(WRITE_AUDIT_PATH, ''), 'GET');
  assert.equal(empty.status, 401);
  assert.match(String(empty.json.error?.message), /缺少写通道凭据/u);

  assert.deepEqual(rig.calls, [], '被拒的请求一次都不许碰到 deps');
});

test('T2.9 ③ 凭据正确 ⇒ 行为与今天一致（两种携带方式都认）+ 401 优先于 404/405', async () => {
  const rig = countingDeps();
  const host = fakeCtx();
  registerWriteRoute(host.ctx, { ...rig.deps, writeToken: TOKEN });

  // `?token=`：plan 200，请求体照旧到达
  const planned = await call(host.web.routes, withToken(WRITE_PLAN_PATH, TOKEN), 'POST', { body: PLAN_BODY });
  assert.equal(planned.status, 200);
  assert.deepEqual(planned.json['echo'], JSON.parse(PLAN_BODY));

  // `Authorization: Bearer`：apply 200，白名单字段照旧到达
  const applied = await call(host.web.routes, WRITE_APPLY_PATH, 'POST', {
    body: APPLY_BODY,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.json['ticket'], 'tk-1', '票据必须原样到达 apply（T2.1/T2.2 的门没动）');

  const audited = await call(host.web.routes, withToken(WRITE_AUDIT_PATH, TOKEN), 'GET');
  assert.equal(audited.status, 200);
  assert.deepEqual(rig.calls, ['plan', 'apply', 'audit'], '带对凭据 ⇒ 三个端点都照常工作');

  // 已鉴权 ⇒ 既有 404/405 语义**逐字不变**
  const unknown = await call(host.web.routes, withToken(`${WRITE_PLAN_PATH}/nope`, TOKEN), 'POST', { body: '{}' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error?.code, 'not-found');
  const badMethod = await call(host.web.routes, withToken(WRITE_PLAN_PATH, TOKEN), 'GET');
  assert.equal(badMethod.status, 405);

  // 未鉴权 ⇒ 401 **优先**于 404/405（不泄露「哪些路径/方法存在」）
  const unknownNoAuth = await call(host.web.routes, `${WRITE_PLAN_PATH}/nope`, 'POST', { body: '{}' });
  assert.equal(unknownNoAuth.status, 401, '未带凭据时连 404 都不给（判定顺序 = 鉴权最先）');
  const badMethodNoAuth = await call(host.web.routes, WRITE_PLAN_PATH, 'GET');
  assert.equal(badMethodNoAuth.status, 401);

  // 两条通道同时给、其中一条错 ⇒ 仍拒（证明优先级固定，不存在「头对了就绕过」）
  const mixed = await call(host.web.routes, withToken(WRITE_PLAN_PATH, 'wrong'), 'POST', {
    body: PLAN_BODY,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(mixed.status, 401, '查询参数优先于头（与 002 readHandshakeToken 同序）');
  assert.deepEqual(rig.calls, ['plan', 'apply', 'audit'], '只有未被拒的请求才碰 deps');
});

test('T2.9 ④ 401 不写审计（真审计环）+ 装载期零命令、authConfigured 如实上报', async () => {
  const host = fakeCtx();
  // 全缺省装配：保守事实面 + 无执行器 + **无凭据** ⇒ 三个端点全 401
  const handle = attachWriteChannel(host.ctx);
  assert.equal(handle.writeRoute.registered, true);
  assert.equal(handle.writeRoute.authConfigured, false);
  assert.equal(handle.audit.size(), 0, '装载期零审计');

  for (const [url, method, body] of [
    [WRITE_PLAN_PATH, 'POST', PLAN_BODY],
    [WRITE_APPLY_PATH, 'POST', APPLY_BODY],
    [WRITE_AUDIT_PATH, 'GET', undefined],
  ] as const) {
    const reply = await call(host.web.routes, url, method, body === undefined ? {} : { body });
    assert.equal(reply.status, 401);
  }
  assert.equal(handle.audit.size(), 0, '🔴 被拒的请求零审计（审计只记真正发生过的动作）');
  assert.equal(handle.tickets.size(), 0, '被拒的请求也不许签发确认票据');
  assert.equal(handle.audit.tail().length, 0);

  // 配上凭据后：plan 照常可算（保守事实面 ⇒ 计划被 eth0-unknown 拦下，但仍 200 且零写入零审计）
  const authed = fakeCtx();
  const withAuth = attachWriteChannel(authed.ctx, undefined, undefined, undefined, TOKEN);
  assert.equal(withAuth.writeRoute.authConfigured, true);
  const planned = await call(authed.web.routes, withToken(WRITE_PLAN_PATH, TOKEN), 'POST', { body: PLAN_BODY });
  assert.equal(planned.status, 200, `带凭据的计划必须可算：${planned.body.slice(0, 200)}`);
  assert.equal(withAuth.audit.size(), 0, '计划是只读的：不写审计');
});

test('T2.9 ⑤ 鉴权单元面：取凭据的优先级/边界，与 configured 判定', () => {
  const auth = createWriteAuthenticator(TOKEN);
  assert.equal(auth.configured, true);
  assert.equal(createWriteAuthenticator(undefined).configured, false);
  assert.equal(createWriteAuthenticator('').configured, false);
  assert.equal(createWriteAuthenticator('   ').configured, false, '空白 = 未配置（不是「凭据是空格」）');

  assert.equal(readWriteCredential({ url: withToken('/x', TOKEN) }), TOKEN);
  assert.equal(readWriteCredential({ url: '/x', headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN);
  assert.equal(readWriteCredential({ url: '/x', headers: { Authorization: `bearer ${TOKEN}` } }), TOKEN, 'Bearer 大小写不敏感');
  assert.equal(readWriteCredential({ url: '/x', headers: { Authorization: 'Basic abc' } }), undefined, '只认 Bearer');
  assert.equal(readWriteCredential({ url: withToken('/x', 'wrong'), headers: { authorization: `Bearer ${TOKEN}` } }), 'wrong');
  assert.equal(readWriteCredential({ url: `${WRITE_PLAN_PATH}?token=` }), undefined, '空串当「没带」');
  assert.equal(readWriteCredential({ url: 'http://[::1' }), undefined, '畸形 url 不抛，退到「没带」');
  assert.equal(readWriteCredential({}), undefined);

  // `configured` 与「判定用不用比较」一致：未配置时**任何**输入都拒（连比较都不做）
  const off = createWriteAuthenticator(undefined);
  const refused = off.authorize({ url: withToken('/x', TOKEN) });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.presented, true, '「是否带凭据」是允许记录的布尔事实');
  const noAuth = auth.authorize({ url: '/x' });
  assert.equal(noAuth.ok, false);
  if (!noAuth.ok) assert.equal(noAuth.presented, false);
  assert.deepEqual(auth.authorize({ url: withToken('/x', TOKEN) }), { ok: true, presented: true });
});
