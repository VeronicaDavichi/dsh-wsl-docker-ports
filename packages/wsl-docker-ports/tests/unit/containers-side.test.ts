/**
 * 015 `P2`/`P3` 的判据：**两条行真的分开了**（`node --test`，零真机）。
 *
 * 这一组用例要能独立证明五件事，缺一条就说明「分」只是文件分开了：
 *
 * 1. **角色判据**：`config.role` → 行 id 后缀 `-containers` → 缺省 `ports`（老 profile 不受影响）；
 * 2. **分派**：同一个 `apply`，容器行导出 `wslDockerContainers` / 注册 `/dsh-wsl-docker-containers`，
 *    并且**不注册**转发侧那条前缀；转发行反之；
 * 3. **容器侧自足**：`/snapshot` 只跑 `wsl -l -v` + `docker ps`，**零 netsh**；docker 失败时
 *    返回 `error` 字段而**不是**空列表；
 * 4. **凭据独立**：容器侧自己的 `writeToken`；未配置 ⇒ 401 且**0 次 docker 调用**；
 * 5. **与 010 遗留实现的等价**：同一动作/日志的 argv 两份实现逐字相同（防漂移）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { WslDistro } from 'dsh-wsl-shared';

import { apply } from '../../src/plugin.ts';
import { CONTAINERS_ROW_ID, PORTS_ROW_ID, decideRole, entryIdOf } from '../../src/role.ts';
import { applyWslDockerContainers } from '../../src/containers/plugin.ts';
import { CONTAINERS_SERVICE, createContainersAuthenticator } from '../../src/containers/credential.ts';
import { registerContainersRoute } from '../../src/containers/route.ts';
import { CONTAINERS_HEALTH_PATH, CONTAINERS_HEALTH_PAYLOAD } from '../../src/containers/health.ts';
import { createContainersSnapshotBuilder, formatPortMapping, resolveContainersDistro } from '../../src/containers/snapshot.ts';
import { containersActionArgv, containersLogsArgv } from '../../src/containers/control.ts';
import { containerActionArgv, containerLogsArgv } from '../../src/docker/control.ts';
import { CONTAINERS_ACTION_PATH, CONTAINERS_LOGS_PATH, CONTAINERS_PREFIX, CONTAINERS_SNAPSHOT_PATH, clampLogTail } from '../../src/containers/wire.ts';
import type { ContainersSnapshotBuilder } from '../../src/containers/snapshot.ts';
import { fakeCtx, fakeResponse } from './route-fakes.ts';
import { routingExecutor } from '../helpers/snapshot-fixtures.ts';

const TOKEN = 'containers-token-123';
const DISTRO = 'Ubuntu2204';
const DISTROS = [{ name: DISTRO, state: 'Running', version: 2, default: true }] as unknown as readonly WslDistro[];

/* ───────────────────────── 1. 角色判据 ───────────────────────── */

test('P2 角色判据：config.role → 行 id 后缀 → 缺省 ports（老 profile 必须落到转发侧）', () => {
  // 显式覆盖最高优先：哪怕行 id 是容器行，`role: ports` 也装转发侧
  assert.deepEqual(decideRole({ configuredRole: 'ports', entryId: CONTAINERS_ROW_ID }), { role: 'ports', source: 'config', rowId: PORTS_ROW_ID });
  assert.deepEqual(decideRole({ configuredRole: ' Containers ', entryId: PORTS_ROW_ID }), {
    role: 'containers',
    source: 'config',
    rowId: CONTAINERS_ROW_ID,
  });
  // 生产路径：行 id 后缀
  assert.deepEqual(decideRole({ entryId: CONTAINERS_ROW_ID }), { role: 'containers', source: 'row-id', rowId: CONTAINERS_ROW_ID });
  // 🔴 老 profile（没写 id / 写了包名）⇒ 转发侧。**这条是本 Spec 的零差异底座**
  assert.equal(decideRole({ entryId: PORTS_ROW_ID }).role, 'ports');
  assert.deepEqual(decideRole({}), { role: 'ports', source: 'default', rowId: PORTS_ROW_ID });
  // 认不出的 role 值 ⇒ 落判据 2/3（不抛、不猜成容器侧）
  assert.equal(decideRole({ configuredRole: 'containerz', entryId: PORTS_ROW_ID }).role, 'ports');
});

test('P2 行 id：只认 `entry.options.id`（`entry.id` 带 include: 前缀，不能拿它判后缀）', () => {
  const entryKey = Symbol.for('cordis.entry');
  assert.equal(entryIdOf({ [entryKey]: { options: { id: CONTAINERS_ROW_ID } } }), CONTAINERS_ROW_ID);
  assert.equal(entryIdOf({ entry: { options: { id: 'custom-row' } } }), 'custom-row');
  assert.equal(entryIdOf({ id: 'flat-row' }), 'flat-row');
  // `options.id` 优先于扁平的 `id`
  assert.equal(entryIdOf({ id: 'flat-row', [entryKey]: { options: { id: 'options-row' } } }), 'options-row');
  assert.equal(entryIdOf({}), undefined);
  assert.equal(entryIdOf(null), undefined);
});

/* ───────────────────────── 2. 分派 ───────────────────────── */

test('P2 分派：容器行只装容器侧（导出 wslDockerContainers、独占前缀、不碰转发侧）', () => {
  const provided: { name: string; value: unknown }[] = [];
  const routes: { kind: string; path: string }[] = [];
  const surface = {
    register: (route: { kind: 'exact' | 'prefix'; path: string }) => {
      routes.push({ kind: route.kind, path: route.path });
      return () => undefined;
    },
  };
  const ctx = {
    get: (name: string) => (name === 'webServer' ? surface : undefined),
    provide: (name: string, value: unknown) => provided.push({ name, value }),
    inject: (_names: readonly string[], callback: (scope: unknown) => void) => {
      callback(ctx);
      return undefined;
    },
    effect: (callback: () => (() => void) | void) => {
      callback();
      return undefined;
    },
    [Symbol.for('cordis.entry')]: { options: { id: CONTAINERS_ROW_ID } },
  };

  apply(ctx as never, undefined);

  assert.deepEqual(
    provided.map((item) => item.name),
    [CONTAINERS_SERVICE],
    '容器行只能导出 wslDockerContainers（转发侧的 wslDockerPorts 不该出现）',
  );
  assert.deepEqual(routes.map((route) => route.path), [CONTAINERS_PREFIX], '容器行只注册自己的前缀');
  assert.equal(
    routes.some((route) => route.path.startsWith(PORTS_ROW_ID)),
    false,
    '容器行不得注册转发侧前缀（两条行必须各有各的闭包）',
  );
});

test('P2 分派：转发行（含判不出 id 的老 profile）仍只装转发侧', () => {
  const provided: string[] = [];
  const routes: string[] = [];
  const surface = {
    register: (route: { kind: 'exact' | 'prefix'; path: string }) => {
      routes.push(route.path);
      return () => undefined;
    },
  };
  const base = {
    get: (name: string) => (name === 'webServer' ? surface : undefined),
    provide: (name: string) => provided.push(name),
    inject: (_names: readonly string[], callback: (scope: unknown) => void) => {
      callback(base);
      return undefined;
    },
    effect: (callback: () => (() => void) | void) => {
      callback();
      return undefined;
    },
  };
  apply(base as never, undefined);
  assert.equal(provided.includes('wslDockerPorts'), true, '转发行必须导出 wslDockerPorts');
  assert.equal(provided.includes(CONTAINERS_SERVICE), false, '转发行不得导出容器服务');
  assert.deepEqual(routes.sort(), ['/dsh-wsl-docker-ports', '/dsh-wsl-docker-ports/write'], '转发行只注册自己那两条前缀');
  assert.equal(routes.some((route) => route.startsWith(CONTAINERS_PREFIX)), false);
});

/* ───────────────────────── 3. 路由：健康 / 快照 / 动作 / 日志 ───────────────────────── */

interface RouteHarness {
  readonly route: ReturnType<typeof registerContainersRoute>;
  readonly exec: ReturnType<typeof routingExecutor>;
  readonly log: { bodyReads: number; targets: number };
  readonly snapshotCalls: { count: number };
  call(method: string, url: string, init?: { token?: string; body?: unknown }): Promise<{ status: number | undefined; body: string }>;
}

function fakeBuilder(overrides: { readonly fail?: string } = {}): { builder: ContainersSnapshotBuilder; calls: { count: number } } {
  const calls = { count: 0 };
  return {
    calls,
    builder: {
      build: () => {
        calls.count += 1;
        if (overrides.fail !== undefined) return Promise.resolve({ ok: false, code: 'docker-failed', message: overrides.fail });
        return Promise.resolve({
          ok: true,
          snapshot: {
            generatedAt: '2026-10-23T00:00:00.000Z',
            distro: { name: DISTRO, state: 'Running', source: 'config', staleConfig: false, message: null },
            distroError: null,
            containers: [{ id: 'abc', name: 'redis', image: 'redis:7', state: 'running', status: 'Up 2 hours', ports: ['0.0.0.0:6379->6379/tcp'] }],
            error: null,
            notes: [],
          },
        });
      },
    },
  };
}

function setupRoute(options: { readonly token?: string | undefined; readonly snapshotFail?: string } = {}): RouteHarness {
  const host = fakeCtx();
  const exec = routingExecutor();
  const log = { bodyReads: 0, targets: 0 };
  const fake = fakeBuilder(options.snapshotFail === undefined ? {} : { fail: options.snapshotFail });
  const route = registerContainersRoute(host.ctx, {
    ...(options.token === undefined ? {} : { config: { writeToken: options.token } }),
    executor: exec.executor,
    snapshotBuilder: fake.builder,
    resolveTarget: () => {
      log.targets += 1;
      return Promise.resolve({ ok: true, name: DISTRO, distros: DISTROS });
    },
  });
  return {
    route,
    exec,
    log,
    snapshotCalls: fake.calls,
    call: async (method, url, init = {}) => {
      const request = {
        url,
        method,
        headers: init.token === undefined ? {} : { authorization: `Bearer ${init.token}` },
        async *[Symbol.asyncIterator]() {
          log.bodyReads += 1;
          if (init.body !== undefined) yield JSON.stringify(init.body);
        },
      };
      const call = fakeResponse();
      const registered = host.web.routes.find((item) => item.path === CONTAINERS_PREFIX);
      assert.notEqual(registered, undefined, '路由必须已注册');
      await (registered as { handler: (request: unknown, response: unknown) => Promise<void> }).handler(request, call.response);
      return { status: call.recorded.status, body: call.recorded.body };
    },
  };
}

test('P3 健康端点：免鉴权、零 IO、答 side+rowId（客户端据此 gate 两页）', async () => {
  const host = setupRoute(); // 注意：**没有** writeToken
  const response = await host.call('GET', CONTAINERS_HEALTH_PATH);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), CONTAINERS_HEALTH_PAYLOAD);
  assert.equal(CONTAINERS_HEALTH_PAYLOAD.rowId, CONTAINERS_ROW_ID, '健康载荷里的 rowId 就是配置命名空间');
  assert.equal(host.exec.calls.length, 0, '健康端点不许跑任何外部命令');
  // 非 GET ⇒ 405（不是 404、也不是 401）
  assert.equal((await host.call('POST', CONTAINERS_HEALTH_PATH)).status, 405);
});

test('P3 快照：容器行自己的路径、免鉴权、失败返回 error 而不是空列表', async () => {
  const ok = setupRoute();
  const response = await ok.call('GET', CONTAINERS_SNAPSHOT_PATH);
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body) as { ok: boolean; snapshot: { containers: { name: string; ports: string[] }[] } };
  assert.equal(payload.snapshot.containers[0]?.name, 'redis');
  assert.deepEqual(payload.snapshot.containers[0]?.ports, ['0.0.0.0:6379->6379/tcp']);

  const failed = setupRoute({ snapshotFail: 'docker 守护进程没在运行' });
  const errorResponse = await failed.call('GET', CONTAINERS_SNAPSHOT_PATH);
  assert.equal(errorResponse.status, 502, '上游 docker 失败 ⇒ 502（不是 500、也不是 200 空列表）');
  assert.match(errorResponse.body, /"code":"docker-failed"/);
});

test('P2 动作：无凭据 ⇒ 401 且**不读体、不解析目标、0 次 docker**（Agent 路径）', async () => {
  const host = setupRoute({ token: TOKEN });
  const response = await host.call('POST', CONTAINERS_ACTION_PATH, { body: { id: 'abc', action: 'stop' } });
  assert.equal(response.status, 401);
  assert.match(response.body, /"code":"unauthorized"/);
  assert.equal(host.log.bodyReads, 0, '未鉴权不得读请求体');
  assert.equal(host.log.targets, 0, '未鉴权不得解析目标发行版');
  assert.equal(host.exec.calls.length, 0, '未鉴权不得碰 docker');
});

test('P2 动作：凭据正确 ⇒ argv 恰好 `docker <action> <id>`（不重试、无 shell）', async () => {
  const host = setupRoute({ token: TOKEN });
  const response = await host.call('POST', CONTAINERS_ACTION_PATH, { token: TOKEN, body: { id: 'abc123', action: 'restart' } });
  assert.equal(response.status, 200);
  assert.equal(host.exec.calls.length, 1, '恰好一次调用（写动作不重试）');
  assert.deepEqual(host.exec.calls[0]?.argv.slice(-2), ['restart', 'abc123']);
  assert.equal(host.exec.calls[0]?.file, 'wsl.exe', '必须经 wsl.exe -d <distro> -- 进发行版');
});

test('P2 动作：非法 id / 非法 action ⇒ 400，且 0 次 docker 调用', async () => {
  const host = setupRoute({ token: TOKEN });
  const badId = await host.call('POST', CONTAINERS_ACTION_PATH, { token: TOKEN, body: { id: 'ab; rm -rf /', action: 'stop' } });
  assert.equal(badId.status, 400);
  const badAction = await host.call('POST', CONTAINERS_ACTION_PATH, { token: TOKEN, body: { id: 'abc', action: 'exec' } });
  assert.equal(badAction.status, 400, '`exec` 属于下一期 ⇒ 现在必须 400，不是 200');
  assert.equal(host.exec.calls.length, 0);
});

test('P2 日志：`?tail` 夹紧到 1..200，argv 里是夹紧后的值；未知路径 404', async () => {
  const host = setupRoute({ token: TOKEN });
  const response = await host.call('GET', `${CONTAINERS_LOGS_PATH}?id=abc&tail=9999`, { token: TOKEN });
  assert.equal(response.status, 200);
  assert.deepEqual(host.exec.calls[0]?.argv.slice(-3), ['--tail', '200', 'abc'], 'argv 里必须是夹紧后的 tail（9999 → 200）');
  assert.equal(clampLogTail(9999), 200);
  assert.equal(clampLogTail(0), 1);
  assert.equal(clampLogTail('abc'), 200);

  const unknown = await host.call('GET', `${CONTAINERS_PREFIX}/nope`);
  assert.equal(unknown.status, 404);
  assert.match(unknown.body, /未知路径/);
});

/* ───────────────────────── 4. 快照装配器：只读、零 netsh ───────────────────────── */

test('P3 快照装配：只跑 wsl -l -v + docker ps（**0 次 netsh**），列表来自真 fixture', async () => {
  const fake = routingExecutor();
  const builder = createContainersSnapshotBuilder({ executor: fake.executor, configuredDistro: () => DISTRO, now: () => Date.UTC(2026, 9, 23) });
  const outcome = await builder.build();
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.snapshot.distro?.name, DISTRO);
  assert.equal(outcome.snapshot.error, null);
  assert.equal(outcome.snapshot.containers.length > 0, true, 'fixture 里必须有容器（否则这条判据是空转）');
  assert.equal(
    fake.calls.some((call) => call.argv.join(' ').includes('portproxy') || call.argv.join(' ').includes('netsh')),
    false,
    '🔴 容器侧快照不许碰 netsh（那是转发侧的事，正是 R2 要防的耦合）',
  );
});

test('P3 快照装配：docker 读失败 ⇒ `error` 有值 + 空列表 + note（不冒充「没有容器」）', async () => {
  const fake = routingExecutor({ docker: false });
  const builder = createContainersSnapshotBuilder({ executor: fake.executor, now: () => Date.UTC(2026, 9, 23) });
  const outcome = await builder.build();
  assert.equal(outcome.ok, true, 'docker 失败仍返回快照（页面要能显示发行版状态与原因）');
  if (!outcome.ok) return;
  assert.equal(outcome.snapshot.containers.length, 0);
  assert.notEqual(outcome.snapshot.error, null, '空列表 + error 才叫「读不到」；只有空列表会说谎');
  assert.match(outcome.snapshot.error?.message ?? '', /守护进程|daemon/i);
  assert.equal(outcome.snapshot.notes.length > 0, true);
});

test('P3 发行版解析：配置失效 ⇒ 明说并回落（不静默换一个）', () => {
  const distros = DISTROS;
  const stale = resolveContainersDistro(distros, 'Ubuntu9999');
  assert.notEqual(stale.distro, null, '要回落到唯一可用的发行版');
  assert.equal(stale.distro?.staleConfig, true);
  assert.match(stale.distro?.message ?? '', /Ubuntu9999/);
  assert.equal(resolveContainersDistro(distros, DISTRO).distro?.staleConfig, false);
  assert.equal(resolveContainersDistro([], '').distro, null, '一个发行版都没有 ⇒ null + 原因');
});

test('P3 端口映射格式化：未发布端口 / 区间 / IPv6 原样', () => {
  assert.equal(formatPortMapping({ hostIp: '0.0.0.0', hostPort: 8080, hostPortEnd: null, containerPort: 80, containerPortEnd: null, protocol: 'tcp' }), '0.0.0.0:8080->80/tcp');
  assert.equal(formatPortMapping({ hostIp: null, hostPort: null, hostPortEnd: null, containerPort: 8080, containerPortEnd: null, protocol: 'tcp' }), '8080/tcp');
  assert.equal(
    formatPortMapping({ hostIp: '[::]', hostPort: 5002, hostPortEnd: 5003, containerPort: 5002, containerPortEnd: 5003, protocol: 'tcp' }),
    '[::]:5002-5003->5002-5003/tcp',
  );
});

/* ───────────────────────── 5. 凭据独立 + 与 010 等价 ───────────────────────── */

test('P2 凭据独立：容器侧读自己的命名空间，且提示文案指向容器行 id', () => {
  const auth = createContainersAuthenticator({ writeToken: TOKEN });
  assert.equal(auth.authorize({ headers: { authorization: `Bearer ${TOKEN}` } }).ok, true);
  assert.equal(auth.authorize({ headers: { authorization: 'Bearer other' } }).ok, false);
  const missing = createContainersAuthenticator({});
  const decision = missing.authorize({ headers: {} });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.match(decision.message, /未配置写通道凭据/);
    assert.match(decision.message, /dsh-wsl-docker-containers/, '必须告诉用户去改**哪一行**');
  }
});

test('P2 与 010 遗留实现等价：同一动作/日志的 argv 逐字相同（防两份拷贝漂移）', () => {
  for (const action of ['start', 'stop', 'restart'] as const) {
    assert.deepEqual(containersActionArgv('abc123', action), containerActionArgv('abc123', action), `argv 漂移：${action}`);
  }
  for (const tail of [1, 200]) {
    assert.deepEqual(containersLogsArgv('abc123', tail), containerLogsArgv('abc123', tail), `argv 漂移：tail=${String(tail)}`);
  }
});

test('P2 容器侧装配：装载期零外部命令、缺 webServer 走 pending、卸载后注册归零', () => {
  const host = fakeCtx({ withWebServer: false });
  const fake = routingExecutor();
  const handle = applyWslDockerContainers(host.ctx as never, undefined, { executor: fake.executor });
  assert.equal(handle.provided, false, '假 ctx 没有 provide ⇒ 记成缺口而不是崩');
  assert.equal(handle.gaps.some((gap) => gap.what === 'provide'), true);
  assert.equal(handle.route.state, 'pending', '服务未到位 = pending（不是失败）');
  assert.equal(fake.calls.length, 0, '装载期零外部命令');
  for (const disposer of host.effects) disposer();
  assert.equal(handle.route.registrationCount(), 0);
});
