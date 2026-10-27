/**
 * 017：**只读发行版清单**端点 `/dsh-wsl-docker-ports/distros` 的判据（`node --test`，零真机）。
 *
 * 它服务于 bundle 级配置页的「目标发行版」下拉。为什么单开一条而不复用 `/snapshot`：
 * 快照要跑 netsh / docker / eth0（唤醒后首次 `docker ps` 会被硬超时砍掉）⇒ 只为一串名字
 * 不值得付那次冷启动；这条端点**只**跑 `wsl.exe -l -v`。
 *
 * 判据（每条都能二值判定）：
 * 1. GET ⇒ 200 + `{ok:true, distros}`；**快照一次都不许装配**（`spyBuilder` 计数为 0）；
 * 2. 非 GET ⇒ 405（不调 `listDistros`）；
 * 3. 没接线（未传 extras）⇒ 503 + 可读原因（不静默给空清单）；
 * 4. 读清单失败 ⇒ 503 + 原样原因；
 * 5. 未知路径 404 的文案里列出 `/distros`（路由清单不许落后实现）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { WslDistro } from 'dsh-wsl-shared';

import { registerPortsRoute } from '../../src/route.ts';
import type { PortsRouteExtras } from '../../src/route.ts';
import { dispatch, fakeCtx } from './route-fakes.ts';
import { PORTS_DISTROS_PATH, PORTS_HTTP_PREFIX } from '../../src/wire.ts';
import { spyBuilder } from './route-fakes.ts';

const DISTROS = [
  { name: 'Ubuntu2204', state: 'Running', version: 2, default: true },
  { name: 'Debian', state: 'Stopped', version: 2, default: false },
] as unknown as readonly WslDistro[];

test('017-D1 GET /distros ⇒ 200 + 清单；快照零装配、零外部命令', async () => {
  const host = fakeCtx();
  const spy = spyBuilder();
  let calls = 0;
  const extras: PortsRouteExtras = {
    listDistros: async () => {
      calls += 1;
      return { ok: true, distros: DISTROS };
    },
  };
  const registration = registerPortsRoute(host.ctx, spy.builder, undefined, extras);
  assert.equal(registration.paths.distros, PORTS_DISTROS_PATH);
  assert.equal(PORTS_DISTROS_PATH, '/dsh-wsl-docker-ports/distros', '对外字面量（client-contract 记录用）');

  const response = await dispatch(host.web.routes, 'GET', `${PORTS_DISTROS_PATH}?cache=0`);
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body) as { ok: boolean; distros: readonly { name: string }[] };
  assert.equal(payload.ok, true);
  assert.deepEqual(
    payload.distros.map((item) => item.name),
    ['Ubuntu2204', 'Debian'],
  );
  assert.equal(calls, 1);
  assert.equal(spy.calls.length, 0, '这条端点不许装配快照（那会跑 docker/netsh）');
  console.log(`  · GET /distros：status=${String(response.status)}、listDistros ${String(calls)} 次、快照装配 0 次`);
});

test('017-D2 非 GET ⇒ 405，且一次清单读取都不发生', async () => {
  const host = fakeCtx();
  let calls = 0;
  registerPortsRoute(host.ctx, spyBuilder().builder, undefined, {
    listDistros: async () => {
      calls += 1;
      return { ok: true, distros: DISTROS };
    },
  });
  const response = await dispatch(host.web.routes, 'POST', PORTS_DISTROS_PATH);
  assert.equal(response.status, 405);
  assert.match(response.body, /只接受 GET/u);
  assert.equal(calls, 0);
  console.log(`  · POST /distros：status=${String(response.status)}、listDistros ${String(calls)} 次`);
});

test('017-D3 未接线 ⇒ 503 + 可读原因（不静默给空清单）', async () => {
  const host = fakeCtx();
  registerPortsRoute(host.ctx, spyBuilder().builder);
  const response = await dispatch(host.web.routes, 'GET', PORTS_DISTROS_PATH);
  assert.equal(response.status, 503);
  assert.match(response.body, /未接线/u);
  console.log(`  · 未接线：status=${String(response.status)}、原因含「未接线」`);
});

test('017-D4 读清单失败 ⇒ 503 + 原样原因', async () => {
  const host = fakeCtx();
  registerPortsRoute(host.ctx, spyBuilder().builder, undefined, {
    listDistros: async () => ({ ok: false, message: 'wsl.exe -l -v 失败：exit 1' }),
  });
  const response = await dispatch(host.web.routes, 'GET', PORTS_DISTROS_PATH);
  assert.equal(response.status, 503);
  assert.match(response.body, /wsl\.exe -l -v 失败/u);
  console.log(`  · 读失败：status=${String(response.status)}、原因原样透出`);
});

test('017-D5 未知路径 404 的文案里列出 /distros', async () => {
  const host = fakeCtx();
  registerPortsRoute(host.ctx, spyBuilder().builder);
  const response = await dispatch(host.web.routes, 'GET', `${PORTS_HTTP_PREFIX}/nope`);
  assert.equal(response.status, 404);
  assert.ok(response.body.includes(PORTS_DISTROS_PATH), `404 文案应列出 ${PORTS_DISTROS_PATH}：${response.body}`);
  console.log(`  · 未知路径：status=${String(response.status)}、文案含 ${PORTS_DISTROS_PATH}`);
});
