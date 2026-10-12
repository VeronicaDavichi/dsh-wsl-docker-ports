/**
 * T6.7 / REQ-14.1：插件**宿主入口**（`node --test`，零真机）
 *
 * 三条判据，每条都能二值判定：
 * ① **入口形状**与 002 宿主半同口径（具名 `name`/`inject`/`apply` + 默认对象），且 `name` 与包名逐字一致；
 * ② **装载零副作用**：`apply` 期间**一次外部命令都不执行**（探针是懒的）、不抛异常、
 *    缺什么就记 `gaps` 里那一条（REQ-10.3）；
 * ③ **服务面是真委派**：6 个方法都通到已实现的部件（用 fake 执行器 + 真 fixture 端到端验证），
 *    `classify` 是纯函数 ⇒ 执行器调用数**不增**。
 *
 * 「零真实进程」不是靠自律：本文件**只**注入 fake 执行器，且断言 `calls` 的每一条都在 fake 的账上。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apply,
  applyWslDockerPorts,
  inject,
  name as entryName,
  PORTS_SERVICE,
} from '../../src/plugin.ts';
import type { PluginContextLike } from '../../src/plugin.ts';
import { diff } from '../../src/diff/engine.ts';
import type { DiffInput } from '../../src/diff/types.ts';
import type { HttpRequestLike, HttpResponseLike, WebServerRoute } from '../../src/route.ts';
import { WRITE_PLAN_PATH } from '../../src/transport/constants.ts';
import { createFakeExecutor, failure, fixtureBytes, ok } from '../helpers/fake-executor.ts';
import { ETH0 } from './client-fixtures.ts';

const WSL_LIST = '  NAME            STATE           VERSION\n* Ubuntu2204    Running         2\n  Debian        Stopped         2\n';
const ETH0_TEXT = '2: eth0    inet 172.20.201.152/20 brd 172.20.207.255 scope global eth0\\       valid_lft forever preferred_lft forever\n';
/** 008 T2.6 的防火墙规则名现读：本机已有 5900 那条（**只读探针的假应答**，不跑真 PowerShell） */
const FIREWALL_NAMES = 'dsh-wsl-docker-ports-5900\r\n';

function readFixture(name: string): string {
  return Buffer.from(fixtureBytes(name)).toString('utf8');
}

/** 一个「什么都答得上来」的 fake 执行器：按命令行分流（**不跑任何真进程**） */
function routingExecutor(): ReturnType<typeof createFakeExecutor> {
  return createFakeExecutor((call) => {
    const line = [call.file, ...call.argv].join(' ');
    if (line.startsWith('wsl.exe -l -v')) return ok(WSL_LIST);
    // ⚠️ 顺序要紧：防火墙探针的命令行里含 `dsh-wsl-docker-ports`（**含 `docker` 子串**）⇒ 必须先判 powershell
    if (line.startsWith('powershell.exe') && line.includes('Get-NetFirewallRule')) return ok(FIREWALL_NAMES);
    if (line.includes('show v4tov4')) return ok(readFixture('netsh-portproxy-v4tov4.raw'));
    if (line.includes('docker')) return ok(readFixture('docker-ps.redacted.jsonl'));
    if (line.includes('addr show dev eth0')) return ok(ETH0_TEXT);
    return failure('Unexpected', { stderr: `未预期的命令：${line}` });
  });
}

interface FakeCtx {
  readonly ctx: PluginContextLike;
  readonly provided: { name: string; value: unknown }[];
  readonly effects: (() => void)[];
}

function fakeCtx(withProvide = true, withEffect = true): FakeCtx {
  const provided: { name: string; value: unknown }[] = [];
  const effects: (() => void)[] = [];
  const ctx: PluginContextLike = {
    ...(withProvide ? { provide: (serviceName: string, value: unknown) => { provided.push({ name: serviceName, value }); return undefined; } } : {}),
    ...(withEffect
      ? {
          effect: (callback: () => (() => void) | void) => {
            const disposer = callback();
            if (typeof disposer === 'function') effects.push(disposer);
            return undefined;
          },
        }
      : {}),
  };
  return { ctx, provided, effects };
}

test('T6.7 入口形状：name 与包名逐字一致 + 具名 apply/inject + 默认对象（002 同口径）', async () => {
  const pkg = JSON.parse(await import('node:fs').then((fs) => fs.promises.readFile(new URL('../../package.json', import.meta.url), 'utf8'))) as { name: string };
  assert.equal(entryName, 'dsh-wsl-docker-ports');
  assert.equal(entryName, pkg.name, '入口 name、包名、patch 行的 id 必须逐字一致（否则 patch 行指不到东西）');
  assert.equal(typeof apply, 'function');
  assert.deepEqual(inject, [], '无强依赖：inject 必须是空数组，别把可选依赖写进去');
  const module_ = await import('../../src/index.ts');
  assert.equal('default' in module_, true, '宿主半要有默认对象形态');
  // 🔴 009 缺陷 1（2026-10-12 真机）：`Config` 必须**在两种形态里都在场** ——
  // 宿主只为「导出了 Config」的插件注册 settings 命名空间（真机 describe 里缺本包 ⇒ 声明恒空 ⇒ 零步骤）
  assert.deepEqual(Object.keys(module_.default).sort(), ['Config', 'apply', 'inject', 'name']);
  assert.equal(module_.default.name, pkg.name);
  assert.equal((module_.default as { apply: unknown }).apply, module_.apply);
  assert.equal(module_.default.Config, module_.Config, '默认对象里的 Config 必须与具名导出同一份');
  console.log(`  · 扫了 4 个具名入口 + 1 个默认对象（name=${entryName}）；inject 长度 ${String(inject.length)}`);
});

test('T6.7 装载零副作用：apply 期间一条外部命令都不跑，探针是懒的', () => {
  const fake = routingExecutor();
  const host = fakeCtx();
  const handle = applyWslDockerPorts(host.ctx, undefined, { executor: fake.executor });
  assert.equal(fake.calls.length, 0, `装载不得执行任何外部命令，实际跑了 ${String(fake.calls.length)} 条：${JSON.stringify(fake.calls.map((call) => call.file))}`);
  assert.equal(handle.effectCount(), 1, 'disposer 必须被 ctx.effect 收编');
  console.log(`  · 装载扫了 ${String(fake.calls.length)} 条外部命令（要求 0）；effect 登记 ${String(handle.effectCount())} 个`);
});

test('T6.7 服务导出：provide 一次、服务名对、卸载幂等', () => {
  const host = fakeCtx();
  const handle = applyWslDockerPorts(host.ctx, undefined, { executor: routingExecutor().executor });
  assert.equal(host.provided.length, 1, `provide 必须恰好 1 次，实际 ${String(host.provided.length)}`);
  assert.equal(host.provided[0]?.name, PORTS_SERVICE);
  assert.equal(host.provided[0]?.value, handle.service, '导出的必须就是那个服务对象（不是副本）');
  assert.equal(handle.provided, true);
  assert.deepEqual(handle.gaps.filter((gap) => gap.what === 'provide'), [], 'provide 成功时不该有 provide 缺口');
  // 两条卸载钩子：插件自己的 `dispose` + 路由的 disposer（`route.ts` **无条件**登记，
  // 于是「服务晚到 / 从没到」都不存在漏卸载 —— 这正是缺陷 A 修复的附带要求）
  // 008 起本插件拥有 2 条路由（只读 + 写通道）⇒ 卸载钩子 = 插件 dispose + 2 路由 disposer = 3 条
  assert.equal(host.effects.length, 3, '卸载钩子应恰好 3 条（插件 dispose + 只读路由 + 写通道路由），实际 ' + String(host.effects.length));
  for (const disposer of host.effects) disposer();
  for (const disposer of host.effects) disposer();
  assert.equal(handle.effectCount(), 1, '插件自己只登记 1 条 effect');
  assert.equal(handle.route.registrationCount(), 0, '卸载后路由必须归零');
  console.log(`  · provide 扫了 ${String(host.provided.length)} 次（${PORTS_SERVICE}）；2 条 disposer 各调 2 次仍幂等；gaps=${JSON.stringify(handle.gaps.map((gap) => gap.what))}`);
});

test('T6.8 降级：空 ctx（无 provide / webServer / effect）不抛异常，四条缺口如实列出', () => {
  const handle = applyWslDockerPorts({}, undefined, { executor: routingExecutor().executor });
  assert.equal(handle.provided, false);
  const whats = handle.gaps.map((gap) => gap.what);
  assert.deepEqual(whats, ['provide', 'webServer', 'ElevationInvoker', 'effect'], `实际 ${JSON.stringify(whats)}`);
  assert.ok(handle.gaps.every((gap) => gap.reason.length > 20), '每条缺口都要写清原因（不写「未知错误」）');
  assert.equal(handle.effectCount(), 0);
  assert.equal(handle.route.registered, false, '没有 webServer ⇒ 路由不注册');
  assert.equal(handle.route.registrationCount(), 0);
  handle.dispose();
  console.log(`  · 空 ctx 扫了 ${String(whats.length)} 条缺口：${JSON.stringify(whats)}`);
});

test('T6.8 有 webServer ⇒ 路由真注册（prefix + 独占前缀），卸载后注册数归零', () => {
  const routes: { kind: string; path: string }[] = [];
  const surface = {
    register: (route: { kind: 'exact' | 'prefix'; path: string }) => {
      if (routes.some((item) => item.kind === route.kind && item.path === route.path)) throw new Error('重复 (kind,path) 注册');
      routes.push({ kind: route.kind, path: route.path });
      return () => {
        const index = routes.findIndex((item) => item.kind === route.kind && item.path === route.path);
        if (index >= 0) routes.splice(index, 1);
      };
    },
  };
  const host = fakeCtx();
  const ctx: PluginContextLike = { ...host.ctx, get: (serviceName: string) => (serviceName === 'webServer' ? surface : undefined) };
  const fake = routingExecutor();
  const handle = applyWslDockerPorts(ctx, undefined, { executor: fake.executor });

  assert.equal(handle.route.registered, true);
  assert.equal(handle.route.registrationCount(), 1);
  assert.deepEqual(routes.map((item) => item.path).sort(), ['/dsh-wsl-docker-ports', '/dsh-wsl-docker-ports/write'], '两条路由都必须独占前缀且不带尾斜杠（宿主判据是 prefix + / 拼接；不蹭 002 的 /dsh-managed-terminal）');
  assert.equal(handle.gaps.some((gap) => gap.what === 'webServer'), false, '注册成功就不该有 webServer 缺口');
  assert.equal(fake.calls.length, 0, `装载期零外部命令，实际 ${String(fake.calls.length)} 条`);
  assert.equal(handle.route.requestCount(), 0, '装载期零请求');
  assert.equal(typeof handle.snapshotBuilder.build, 'function', '装配器必须能被集成方直接复用');

  // 卸载：`ctx.effect` 收编的 disposer 一调，注册数归零（漏登记会让再次挂载直接抛重复 (kind,path)）
  for (const disposer of host.effects) disposer();
  assert.equal(handle.writeRoute.registrationCount(), 0, '卸载后写通道注册数也必须归零');
  assert.equal(handle.route.registrationCount(), 0);
  assert.deepEqual(routes, []);
  console.log(`  · 注册扫了 ${String(routes.length)} 条路由（卸载后）；缺口 ${JSON.stringify(handle.gaps.map((gap) => gap.what))}`);
});

test('T6.8-修A 装载期服务晚到（真机时序）⇒ 缺口是 pending、且注册到位后**自己消失**', () => {
  // 真机时序：`apply` 时刻 `ctx.get('webServer') === undefined`，服务要到后续 tick 才进注入作用域
  const routes: { kind: string; path: string }[] = [];
  const surface = {
    register: (route: { kind: 'exact' | 'prefix'; path: string }) => {
      if (routes.some((item) => item.kind === route.kind && item.path === route.path)) throw new Error('重复 (kind,path) 注册');
      routes.push({ kind: route.kind, path: route.path });
      return () => {
        routes.splice(0);
      };
    },
  };
  const host = fakeCtx();
  const pending: ((scope: PluginContextLike) => void)[] = [];
  const ctx: PluginContextLike = {
    ...host.ctx,
    get: () => undefined,
    inject: (_names, callback) => {
      pending.push(callback);
      return undefined;
    },
  };
  const handle = applyWslDockerPorts(ctx, undefined, { executor: routingExecutor().executor });

  // ① 此刻：诚实的 pending（不是「缺失」，也不是已注册）
  assert.equal(handle.route.registered, false);
  assert.equal(handle.route.state, 'pending');
  assert.deepEqual(routes, [], '服务没到 ⇒ 一条路由都没注册');
  const before = handle.gaps.find((gap) => gap.what === 'webServer');
  assert.ok(before !== undefined, 'pending 也必须在 gaps 里可见（不静默）');
  assert.match(String(before?.reason), /inject/u, '文案要写清「已登记注入」');
  assert.equal(/未注册；.*ports-source-missing/u.test(String(before?.reason)), false, 'pending 不是缺失，不许套缺失的后果文案');
  // 008 起两条路由各登记一次注入
  assert.equal(pending.length, 2, '必须登记了 ctx.inject（旧代码：0 次 ⇒ 路由永不注册）');

  // ② `+755ms`：服务到位 ⇒ 注入回调跑 ⇒ 注册
  pending[0]?.({ get: (name: string) => (name === 'webServer' ? surface : undefined) });
  assert.equal(handle.route.registered, true);
  assert.equal(handle.route.state, 'registered');
  assert.deepEqual(routes, [{ kind: 'prefix', path: '/dsh-wsl-docker-ports' }]);
  assert.equal(
    handle.gaps.some((gap) => gap.what === 'webServer'),
    false,
    '🔴 缺口是**活视图**：注册成功后必须自己消失（旧代码在装载那一刻拍下照片 ⇒ 会留一句过期的话）',
  );

  // ③ 卸载后注册数归零（`ctx.effect` 收编的 disposer）
  for (const disposer of host.effects) disposer();
  assert.equal(handle.writeRoute.registrationCount(), 0, '卸载后写通道注册数也必须归零');
  assert.equal(handle.route.registrationCount(), 0);
  assert.deepEqual(routes, []);
  console.log(`  · 晚到时序扫了 ${String(pending.length)} 次 inject：pending → registered，缺口从有到无，卸载后 routes=${String(routes.length)}`);
});

test('T6.8 仍然不做的事被如实记成缺口（不造假 ElevationInvoker：执行器已实现，缺的是计划装配 + 写传输）', () => {
  const handle = applyWslDockerPorts(fakeCtx().ctx, undefined, { executor: routingExecutor().executor });
  const webServer = handle.gaps.find((gap) => gap.what === 'webServer');
  const elevation = handle.gaps.find((gap) => gap.what === 'ElevationInvoker');
  assert.match(String(webServer?.reason), /webServer/u, '缺 webServer 必须点名服务（而不是含糊的「数据通道」）');
  assert.match(String(elevation?.reason), /005/u, '必须点名归属（005）');
  assert.match(String(elevation?.reason), /已实现/u, '必须写清「执行器已实现」，否则读的人会去重复实现一份');
  assert.equal('PortsSource' in handle.service, false, '服务面不得提供一个假的 PortsSource');
  assert.equal('run' in handle.service, false, '服务面不得提供一个假的提权入口');
  console.log(`  · 扫了 ${String(handle.gaps.length)} 条缺口 + 服务面 ${String(Object.keys(handle.service).length)} 个成员（无假实现）`);
});

test('T6.7 委派①：resolveTarget 走真 `wsl -l -v`（只读、不带 -d、不冷启动）', async () => {
  const fake = routingExecutor();
  const handle = applyWslDockerPorts(fakeCtx().ctx, undefined, { executor: fake.executor });
  const target = await handle.service.resolveTarget();
  assert.equal(target.ok, true);
  if (target.ok) {
    assert.equal(target.resolved.name, 'Ubuntu2204');
    assert.equal(target.resolved.source, 'wslDefault');
    assert.equal(target.distros.length, 2);
  }
  const argvText = fake.calls.map((call) => [call.file, ...call.argv].join(' '));
  assert.deepEqual(argvText, ['wsl.exe -l -v'], `只允许一条只读命令，实际 ${JSON.stringify(argvText)}`);
  assert.equal(argvText.some((line) => line.includes(' -d ')), false, '解析发行版不得用 -d（会冷启动）');
  console.log(`  · 扫了 ${String(argvText.length)} 条命令：${JSON.stringify(argvText)}`);
});

test('T6.7 委派②：readRules 端到端 = 执行器 → 探针 → 解析（真 fixture 的 19 条）', async () => {
  const fake = routingExecutor();
  const handle = applyWslDockerPorts(fakeCtx().ctx, undefined, { executor: fake.executor });
  const outcome = await handle.service.readRules();
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.rules.length, 19, `真 fixture 应解析出 19 条，实际 ${String(outcome.rules.length)}`);
    assert.equal(outcome.rules[0]?.connectAddress, ETH0, 'connectAddress 必须与 fixture 一致（漂移检测的基准）');
  }
  const command = fake.calls.map((call) => [call.file, ...call.argv].join(' '));
  assert.equal(command.length, 1);
  assert.match(String(command[0]), /^netsh\.exe .*show v4tov4/u);
  console.log(`  · 端到端扫了 ${String(outcome.ok ? outcome.rules.length : 0)} 条规则 / ${String(command.length)} 条命令`);
});

test('T6.7 委派③：readContainers 先解析发行版再探 docker（两条命令，顺序固定）', async () => {
  const fake = routingExecutor();
  const handle = applyWslDockerPorts(fakeCtx().ctx, undefined, { executor: fake.executor });
  const outcome = await handle.service.readContainers();
  assert.equal(outcome.ok, true);
  const command = fake.calls.map((call) => [call.file, ...call.argv].join(' '));
  assert.equal(command.length, 2, `应当恰好两条命令，实际 ${JSON.stringify(command)}`);
  assert.match(String(command[0]), /^wsl\.exe -l -v/u);
  assert.match(String(command[1]), /-d Ubuntu2204 .*docker ps/u, '第二条必须钉在解析出的发行版上');
  assert.match(String(command[1]), /\{\{json \.\}\}/u, 'docker ps 必须用 --format {{json .}}（裸 json 会挂住）');
  if (outcome.ok) assert.ok(outcome.containers.length > 0, '真 fixture 应至少有一个容器');
  console.log(`  · 扫了 ${String(command.length)} 条命令，容器 ${String(outcome.ok ? outcome.containers.length : 0)} 个`);
});

test('T6.7 委派④：readLocalhostForwarding 透传读文件依赖（不碰真 `.wslconfig`）', async () => {
  const handle = applyWslDockerPorts(fakeCtx().ctx, undefined, {
    executor: routingExecutor().executor,
    localhostForwarding: { filePath: 'X:\\fake\\.wslconfig', readFile: async () => '[wsl2]\nlocalhostForwarding=true\n' },
  });
  const outcome = await handle.service.readLocalhostForwarding();
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.enabled, true);
    assert.equal(outcome.path, 'X:\\fake\\.wslconfig');
  }
  console.log(`  · 扫了 1 次假文件读（path=${outcome.ok ? outcome.path : '—'}，enabled=${String(outcome.ok ? outcome.enabled : '—')}）`);
});

test('T6.7 委派⑤：probeEth0 现读（不吃缓存），默认**不**允许冷启动', async () => {
  const fake = routingExecutor();
  const handle = applyWslDockerPorts(fakeCtx().ctx, undefined, { executor: fake.executor });
  const outcome = await handle.service.probeEth0();
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.ip, ETH0);
  const command = fake.calls.map((call) => [call.file, ...call.argv].join(' '));
  assert.equal(command.length, 2, `解析发行版 + 探测各一条，实际 ${JSON.stringify(command)}`);
  assert.match(String(command[1]), /ip -4 -o addr show dev eth0/u);
  assert.equal(command.some((line) => line.includes('allowColdStart')), false, '默认不得允许冷启动（自动路径禁止冷启动）');
  assert.equal(handle.service.probeEth0 !== undefined, true);
  console.log(`  · 扫了 ${String(command.length)} 条命令，eth0=${outcome.ok ? outcome.ip : '—'}（默认不打冷启动开关）`);
});

test('T6.7 委派⑥：classify 是纯函数 ⇒ 执行器调用数**不增**，且与 Phase 2 引擎逐字一致', async () => {
  const fake = routingExecutor();
  const handle = applyWslDockerPorts(fakeCtx().ctx, undefined, { executor: fake.executor });
  const before = fake.calls.length;
  const input: DiffInput = { containers: [], managedPorts: [{ start: 3306, end: 3306 }], rules: [], eth0Ip: ETH0, localhostForwarding: true };
  const mine = handle.service.classify(input);
  const theirs = diff(input);
  assert.deepEqual(mine, theirs, 'classify 必须是引擎的直通（不复制第二套口径）');
  assert.equal(fake.calls.length, before, '纯判决不得触发任何外部命令');
  assert.equal(mine.ok, true);
  console.log(`  · 判决扫了 1 次（状态数 ${String(mine.ok ? mine.result.ports.length : 0)}）；执行器调用 ${String(before)} → ${String(fake.calls.length)}`);
});

test('T6.7 服务面自述：serviceName 可断言（消费方不用猜拿到的是哪个服务）', () => {
  const handle = applyWslDockerPorts(fakeCtx().ctx, undefined, { executor: routingExecutor().executor });
  assert.equal(handle.service.serviceName, PORTS_SERVICE);
  const methods = Object.keys(handle.service).sort();
  assert.deepEqual(methods, ['classify', 'probeEth0', 'readContainers', 'readLocalhostForwarding', 'readRules', 'resolveTarget', 'serviceName']);
  console.log(`  · 服务面扫了 ${String(methods.length)} 个成员：${JSON.stringify(methods)}`);
});
test('T1.7/T1.4 写通道路由：装载期零外部命令、两条独占前缀、卸载归零（008）', () => {
  const routes: { kind: string; path: string }[] = [];
  const surface = {
    register: (route: { kind: 'exact' | 'prefix'; path: string }) => {
      if (routes.some((item) => item.kind === route.kind && item.path === route.path)) throw new Error('重复 (kind,path) 注册');
      routes.push({ kind: route.kind, path: route.path });
      return () => {
        const index = routes.findIndex((item) => item.kind === route.kind && item.path === route.path);
        if (index >= 0) routes.splice(index, 1);
      };
    },
  };
  const host = fakeCtx();
  const ctx: PluginContextLike = { ...host.ctx, get: (serviceName: string) => (serviceName === 'webServer' ? surface : undefined) };
  const fake = routingExecutor();
  const handle = applyWslDockerPorts(ctx, undefined, { executor: fake.executor });

  assert.equal(handle.writeRoute.registered, true, '写通道路由必须真注册（不是留个缺口）');
  assert.equal(handle.writeRoute.registrationCount(), 1);
  assert.deepEqual(routes.map((item) => item.path).sort(), ['/dsh-wsl-docker-ports', '/dsh-wsl-docker-ports/write']);
  assert.equal(fake.calls.length, 0, '装载期零外部命令（T1.4 判据），实际 ' + String(fake.calls.length) + ' 条');
  assert.equal(handle.writeRoute.requestCount(), 0, '装载期零请求（现读只在请求处理里发生）');

  for (const disposer of host.effects) disposer();
  assert.equal(handle.writeRoute.registrationCount(), 0, '卸载后写通道注册数必须归零');
  assert.equal(handle.route.registrationCount(), 0);
  assert.deepEqual(routes, []);
});

/* ── 008 T2.6 + T3：配置读取（`elevationPolicy`）与防火墙规则名现读**真接到事实面** ── */

const encoder = new TextEncoder();

/** T2.9 写通道凭据（走真插件的 config ⇒ 证明「配置真被读到并用于鉴权」；缺它一切写请求 401） */
const WRITE_TOKEN = 'tk-entry-8d2c40';

/** 走一次真的 `/write/plan` 处理器（假宿主面 + 假执行器 ⇒ 零真进程、零真机） */
async function dispatchPlan(
  routes: readonly WebServerRoute[],
  body: string,
): Promise<{ readonly status: number; readonly payload: Record<string, unknown> }> {
  // 写通道以**前缀**注册（`/dsh-wsl-docker-ports/write`，而只读路由的前缀 `/dsh-wsl-docker-ports` 也命中）
  // ⇒ 按宿主口径取「**最长**前缀命中」那条，别把请求喂给只读路由
  const route = routes
    .filter((item) => (item.kind === 'prefix' ? WRITE_PLAN_PATH.startsWith(item.path) : item.path === WRITE_PLAN_PATH))
    .sort((left, right) => right.path.length - left.path.length)[0];
  assert.notEqual(route, undefined, `宿主应当已注册 ${WRITE_PLAN_PATH} 处理器`);
  const box = { status: 0, body: '' };
  const request = {
    // T2.9：`plan` 也要凭据（与 apply / audit 同一份；缺配置或凭据不符 ⇒ 401）
    url: `${WRITE_PLAN_PATH}?token=${WRITE_TOKEN}`,
    method: 'POST',
    [Symbol.asyncIterator]: async function* (): AsyncIterator<Uint8Array> {
      yield encoder.encode(body);
    },
  } as HttpRequestLike;
  const response: HttpResponseLike = {
    get statusCode(): number {
      return box.status;
    },
    set statusCode(value: number) {
      box.status = value;
    },
    setHeader: () => undefined,
    end: (text?: string) => {
      box.body = text ?? '';
    },
  };
  await route?.handler(request, response);
  return { status: box.status, payload: JSON.parse(box.body) as Record<string, unknown> };
}

/** 装配一套「有 webServer」的宿主面，返回注册到的路由（每个用例各造一套，互不干扰） */
function attachedRoutes(config: { readonly elevationPolicy?: string; readonly writeToken?: string } | undefined): { readonly routes: WebServerRoute[]; readonly fake: ReturnType<typeof createFakeExecutor> } {
  const routes: WebServerRoute[] = [];
  const surface = {
    register: (route: WebServerRoute) => {
      routes.push(route);
      return () => {
        routes.splice(0);
      };
    },
  };
  const host = fakeCtx();
  const ctx: PluginContextLike = { ...host.ctx, get: (serviceName: string) => (serviceName === 'webServer' ? surface : undefined) };
  const fake = routingExecutor();
  applyWslDockerPorts(ctx, config, { executor: fake.executor });
  return { routes, fake };
}

const PLAN_BODY = JSON.stringify({ action: 'add', ports: [5900], scope: 'lan', declaration: [{ start: 5900, end: 5900 }] });

test('008 T3 配置读取：`elevationPolicy` 从插件 config 进事实面（缺省 ⇒ `unknown` ⇒ 执行层按 `none`）；T2.9 未配 `writeToken` ⇒ 401', async () => {
  const configured = attachedRoutes({ elevationPolicy: 'ask', writeToken: WRITE_TOKEN });
  const asked = await dispatchPlan(configured.routes, PLAN_BODY);
  assert.equal(asked.status, 200, `计划必须成功（否则下面的断言恒真）：${JSON.stringify(asked.payload)}`);
  const elevation = asked.payload['elevation'] as { policy?: string; available?: boolean } | undefined;
  assert.equal(elevation?.policy, 'ask', '清单/配置页给的值必须真的成为 `facts.elevation().policy`（不是常量 unknown）');

  // 🔴 顺手钉住 T2.6 的接线：假执行器答了「本机已有 5900 那条」⇒ 计划阶段就被 `firewall-rule-exists` 拦下
  //    （接线前 `firewallNames` 恒缺 ⇒ 这一门从不启用，计划反而会「可执行」）
  const ports = asked.payload['ports'] as { blocked?: { reason?: string } }[] | undefined;
  assert.equal(ports?.[0]?.blocked?.reason, 'firewall-rule-exists', '`createPluginFacts` 必须真接防火墙规则名现读');
  assert.equal(asked.payload['planId'], null, '被拦下的计划不给 planId（没有票据可用）');

  const unconfigured = attachedRoutes({ writeToken: WRITE_TOKEN });
  const plain = await dispatchPlan(unconfigured.routes, PLAN_BODY);
  const plainElevation = plain.payload['elevation'] as { policy?: string } | undefined;
  assert.equal(plainElevation?.policy, 'unknown', '没配置 elevationPolicy ⇒ unknown（**不假装**用户选过；执行层据此按 none 不写）');

  // 🔴 T2.9：**没配 writeToken** ⇒ 同一个真插件装配下，写通道自己的鉴权把请求挡在 401（fail-safe）
  const noCredential = attachedRoutes({ elevationPolicy: 'ask' });
  const refused = await dispatchPlan(noCredential.routes, PLAN_BODY);
  assert.equal(refused.status, 401, '未配置 writeToken ⇒ plan 也 401（fail-safe：默认「通道不可用」而非「裸奔」）');
  assert.equal(
    (refused.payload['error'] as { code?: string } | undefined)?.code,
    'unauthorized',
    '拒绝必须用 `unauthorized`（与 404/405/503 的语义不重叠）',
  );
  assert.equal(noCredential.fake.calls.length, 0, '🔴 被鉴权拒掉的计划**一条只读命令都不跑**（判据在一切副作用之前）');

  // 🔴 零写入：两次计划都只跑了只读探针（netsh show / Get-NetFirewallRule / eth0 / wsl -l -v）
  for (const rig of [configured, unconfigured]) {
    assert.equal(rig.fake.calls.length > 0, true, '计划要真读（否则上面的断言可能恒真）');
    for (const call of rig.fake.calls) {
      const line = [call.file, ...call.argv].join(' ');
      assert.equal(/New-NetFirewallRule|Set-NetFirewallRule|Remove-NetFirewallRule|netsh interface portproxy (add|delete|set|reset)/u.test(line), false, `计划阶段不许有写命令：${line}`);
    }
  }
  const sawFirewallRead = configured.fake.calls.some((call) => call.file === 'powershell.exe' && call.argv.join(' ').includes('Get-NetFirewallRule'));
  assert.equal(sawFirewallRead, true, '防火墙规则名现读必须真被触发（只读 Get-NetFirewallRule）');
  console.log(`  · plan 真读了 ${String(configured.fake.calls.length)} 条只读命令；policy=ask / 缺省 unknown；firewallNames 已接线；未配 writeToken ⇒ 401 且零命令（T2.9）`);
});