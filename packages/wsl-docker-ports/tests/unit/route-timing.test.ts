/**
 * T6.8 快照路由的**时序与分派**对抗性回归（`node --test`，零真机、零真实进程）
 *
 * 这三条用例都是 2026-10-09 真机缺陷的钉子，**在旧代码上会红**（红/绿原始输出见交付报告）：
 *
 * - **缺陷 A**：`webServer` 是**后到**的服务（真机 `+68ms` 取不到、`+755ms` 才到）。
 *   旧代码在 `apply` 里同步 `ctx.get('webServer')` 定生死 ⇒ 「不注册 + 记 gap」且零报错
 *   ⇒ 路由**永远进不了宿主路由表**（P0 主路径整体失效）。
 *   修法：`ctx.inject(['webServer'], …)` 等宿主可用时机，状态是活的。
 * - **缺陷 B**：前缀常量带尾斜杠 ⇒ 宿主判据
 *   `pathname !== prefix && !pathname.startsWith(`${prefix}/`)` 实际要求
 *   `startsWith('/dsh-wsl-docker-ports//')` ⇒ 契约 URL `/dsh-wsl-docker-ports/snapshot`
 *   **永不匹配**，被宿主兜底 404 吃掉（真机实测：无 `Content-Type`、无 body）。
 * - **缺陷 B2**：修 B 之前 405 分支**不可达**（真机 `POST /dsh-wsl-docker-ports/` 拿到 JSON 404）
 *   ⇒ 判据顺序写死为「先认路径，已知路径才谈方法」，未知路径一律 404。
 *
 * 假宿主面（含 `dispatch()` 这个宿主分派判据的逐字复刻）在 `./route-fakes.ts`。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerPortsRoute } from '../../src/route.ts';
import type { RoutePluginContextLike } from '../../src/route.ts';
import { createSnapshotBuilder } from '../../src/snapshot.ts';
import { PORTS_HTTP_PREFIX, PORTS_SNAPSHOT_PATH } from '../../src/wire.ts';
import type { PortsSnapshotResponse } from '../../src/wire.ts';
import { OK_DECLARATION, dispatch, fakeCtx, fakeWebServer, snapshotDeps, spyBuilder } from './route-fakes.ts';
import { routingExecutor } from '../helpers/snapshot-fixtures.ts';

test('T6.8-修A ① 服务还没到时**不许**谎报「缺失」：状态是 pending，等注入（旧代码：同步 ctx.get 定生死）', () => {
  const host = fakeCtx({ withWebServer: false });
  const registration = registerPortsRoute(host.ctx, spyBuilder().builder);
  assert.equal(registration.registered, false);
  assert.equal(registration.state, 'pending', '有 ctx.inject ⇒ 登记等待，不是「缺失」');
  assert.match(String(registration.reason), /inject/u, '文案要写清「已登记注入、等服务」');
  assert.equal(/ports-source-missing/u.test(String(registration.reason)), false, 'pending 不是降级，不许照抄缺失的后果文案');
  assert.deepEqual(host.injectNames, [['webServer']], '必须真的登记了注入（旧代码在同步判空这一步就返回，0 次 inject）');
  registration.dispose();
  console.log(`  · pending 扫了 ${String(host.injectNames.length)} 次 inject 登记 / ${String(host.web.registerCalls)} 次 register；reason=${String(registration.reason)}`);
});

test('T6.8-修A ② 🔴 对抗性回归：webServer **晚到**（真机 +68ms 取不到 / +755ms 才到）也必须注册', () => {
  const web = fakeWebServer();
  const effects: (() => void)[] = [];
  const pending: { readonly names: readonly string[]; readonly callback: (scope: RoutePluginContextLike) => void }[] = [];
  const ctx: RoutePluginContextLike = {
    // 🔴 真机时刻：`+68ms ctx.get('webServer') === undefined`
    get: () => undefined,
    // `ctx.inject` 登记后**不**同步回调 —— 服务在后续 tick 才进注入作用域（真机 +755ms）
    inject: (names, callback) => {
      pending.push({ names, callback });
      return () => undefined;
    },
    effect: (callback) => {
      const disposer = callback();
      if (typeof disposer === 'function') effects.push(disposer);
      return undefined;
    },
  };
  const registration = registerPortsRoute(ctx, spyBuilder().builder);

  // 此刻：诚实地说「还没注册」，既不是已注册，也不是「缺失」
  assert.equal(web.registerCalls, 0, '服务还没到，不许注册');
  assert.equal(pending.length, 1, '🔴 旧代码在这一行就红了：它 0 次调用 ctx.inject（同步取到 undefined 就 return）');
  assert.deepEqual(pending[0]?.names, ['webServer']);
  assert.equal(registration.registered, false);
  assert.equal(registration.state, 'pending');

  // `+755ms`：宿主把服务放进注入作用域，cordis 触发注入回调
  pending[0]?.callback({ get: (name: string) => (name === 'webServer' ? web.surface : undefined) });

  assert.equal(registration.registered, true, '🔴 旧代码在这一行红：路由永远进不了宿主路由表');
  assert.equal(registration.state, 'registered');
  assert.equal(registration.reason, undefined, '注册成功后不许留着过期的原因');
  assert.equal(web.routes.length, 1);
  assert.equal(web.routes[0]?.path, PORTS_HTTP_PREFIX);
  assert.equal(web.registerCalls, 1);

  // 注入回调重复触发（服务被重新 provide）不许注册第二次 —— 宿主对重复 (kind,path) 会抛错
  pending[0]?.callback({ get: (name: string) => (name === 'webServer' ? web.surface : undefined) });
  assert.equal(web.registerCalls, 1, 'attach 必须幂等');

  // 卸载：disposer 仍归 ctx.effect
  assert.equal(effects.length, 1);
  effects[0]?.();
  assert.equal(registration.registrationCount(), 0);
  assert.equal(web.routes.length, 0);
  // 卸载后**后到**的注入回调不许把路由又挂回去
  pending[0]?.callback({ get: (name: string) => (name === 'webServer' ? web.surface : undefined) });
  assert.equal(web.routes.length, 0, 'disposed 之后后到的注入回调必须被挡住');
  console.log(`  · 晚到时序扫了 ${String(pending.length)} 次 inject 登记：registered ${String(registration.registered)} / 注册数 ${String(registration.registrationCount())}（卸载后）`);
});

test('T6.8-修B ③ 🔴 对抗性回归：按**宿主**分派规则，契约 URL /dsh-wsl-docker-ports/snapshot 必须命中我们的 handler', async () => {
  // 🔴 契约字面量（`client-contract.md` §P9 的对外 URL）：**不从实现里取**，
  // 于是「常量改了、契约没改」这种漂移会在这里立刻红。
  const EXTERNAL_SNAPSHOT_URL = '/dsh-wsl-docker-ports/snapshot';
  const EXTERNAL_PREFIX = '/dsh-wsl-docker-ports';

  const fake = routingExecutor();
  const host = fakeCtx();
  registerPortsRoute(host.ctx, createSnapshotBuilder(snapshotDeps(fake)));
  const registeredPrefix = host.web.routes[0]?.path ?? '';

  const query = OK_DECLARATION.managedPorts.map((port) => `managedPorts=${port}`).join('&');
  const hit = await dispatch(host.web.routes, 'GET', `${EXTERNAL_SNAPSHOT_URL}?${query}`);

  assert.equal(
    hit.matched,
    true,
    '🔴 旧代码在这一行红：前缀带尾斜杠 ⇒ 宿主实际要求 startsWith("/dsh-wsl-docker-ports//") ⇒ 契约 URL 永不匹配（matched=false、body 空，被兜底 404 吃掉）',
  );
  assert.equal(hit.status, 200);
  assert.equal(hit.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(hit.headers['Cache-Control'], 'no-store');
  const body = JSON.parse(hit.body) as PortsSnapshotResponse;
  assert.equal(body.ok, true, '必须是我们 handler 的真快照（不是宿主的兜底 404）');

  // 前缀根（正好等于 prefix）也归我们 ⇒ handler 自己判 404（JSON 体）
  const root = await dispatch(host.web.routes, 'GET', EXTERNAL_PREFIX);
  assert.equal(root.matched, true, 'pathname === prefix 属于本前缀（宿主判据的第一半）');
  assert.equal(root.status, 404);
  assert.equal((JSON.parse(root.body) as PortsSnapshotResponse).ok, false);

  // 宿主判据的自检（与 dispatch 里那句逐字同源）：契约 URL 必须落在注册前缀的口径内。
  // ⚠️ 先算成 boolean 再断言：`assert.equal` 会把 `registeredPrefix` 收窄成字面量类型，
  // 之后的字面量比较会被 TS 判成「无重叠」（运行期断言已经说明同一件事，不必骗过类型系统）。
  const contractUrlIsReachable =
    EXTERNAL_SNAPSHOT_URL === registeredPrefix || EXTERNAL_SNAPSHOT_URL.startsWith(`${registeredPrefix}/`);
  assert.ok(
    contractUrlIsReachable,
    `注册前缀 "${registeredPrefix}" 必须能吃下契约 URL：判据 \`pathname !== prefix && !pathname.startsWith(\`${registeredPrefix}/\`)\` 的**反面**`,
  );

  // 最后才钉常量本身：对外 URL 不变 + 注册进宿主的前缀不带尾斜杠
  assert.equal(PORTS_SNAPSHOT_PATH, EXTERNAL_SNAPSHOT_URL, '对外端点 URL 不变');
  assert.equal(PORTS_HTTP_PREFIX, EXTERNAL_PREFIX, '注册进宿主的前缀必须是不带尾斜杠的那一个');
  assert.equal(registeredPrefix, EXTERNAL_PREFIX);

  console.log(`  · 宿主分派扫了 2 条路径：/…/snapshot matched=${String(hit.matched)} status=${String(hit.status)}；根 → ${String(root.status)}`);
});

test('T6.8-修B2 ③ 🔴 对抗性回归：已知路径 + 非 GET ⇒ **405 可达**；未知路径 ⇒ 404', async () => {
  const EXTERNAL_SNAPSHOT_URL = '/dsh-wsl-docker-ports/snapshot';
  const EXTERNAL_PREFIX = '/dsh-wsl-docker-ports';
  const host = fakeCtx();
  registerPortsRoute(host.ctx, spyBuilder().builder);

  const post = await dispatch(host.web.routes, 'POST', EXTERNAL_SNAPSHOT_URL);
  assert.equal(post.matched, true, 'POST 到已知路径也必须先被分派给我们（否则 405 分支永远不可达）');
  assert.equal(post.status, 405, '🔴 旧代码（真机）在这一行红：POST 拿到的是 JSON 404，405 不可达');
  const postBody = JSON.parse(post.body) as PortsSnapshotResponse;
  assert.equal(postBody.ok === false ? postBody.error.code : '', 'method-not-allowed');

  // 未知路径：不论方法一律 404（先判路径，后判方法）
  for (const [method, url] of [
    ['GET', `${EXTERNAL_PREFIX}/nope`],
    ['POST', `${EXTERNAL_PREFIX}/nope`],
    ['POST', EXTERNAL_PREFIX],
  ] as const) {
    const call = await dispatch(host.web.routes, method, url);
    assert.equal(call.matched, true, `${method} ${url} 在本前缀内 ⇒ 必须轮到我们`);
    assert.equal(call.status, 404, `${method} ${url} 未知路径 ⇒ 404（不是 405）`);
    const parsed = JSON.parse(call.body) as PortsSnapshotResponse;
    assert.equal(parsed.ok === false ? parsed.error.code : '', 'not-found');
  }

  console.log('  · 扫了 1 条 POST(已知路径) → 405 + 3 条未知路径（GET/POST/根 POST）→ 404');
});
