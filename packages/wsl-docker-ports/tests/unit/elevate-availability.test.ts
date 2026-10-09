/**
 * 缺陷 2 的离线回归（`node --test`，零真机、零真实进程）：`elevationAvailable` 从「硬编码 false」
 * 变成**真探测 + 缓存**
 *
 * 三组判据（期望值一律是**契约字面量 / 真机原文**，不从被测实现里取）：
 * ① 后端侧（`probeElevationAvailability`）：gsudo 按路径存在 ⇒ `true`；非 win32 / 探测抛异常 ⇒ 保守 `false` + 原因可读；
 * ② 缓存侧（`createElevationAvailabilityProbe`）：**进程内只真跑一次**、并发共享同一次 —— 「不许每份快照都打真进程」；
 * ③ 接线侧（`applyWslDockerPorts`）：真探测接到 `snapshot.elevationAvailable`（旧代码恒 `false` ⇒ 必红）、
 *    失败时 `gaps` 留下可诊断原因、**两份快照只起一次真探测**。
 *
 * 🔴 **不在本文件内**：真机复验（修后应变成 `backend:"gsudo"` / `elevationAvailable:true`）——
 * 那要真跑 `where.exe gsudo` 与 `gsudo status`，由集成方在真机上安排；本文件只钉离线判据。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Executor } from 'dsh-wsl-shared';

import { createElevationAvailabilityProbe, probeElevationAvailability } from '../../src/elevate/backend.ts';
import { applyWslDockerPorts } from '../../src/plugin.ts';
import type { PluginContextLike, WslDockerPortsPluginHandle } from '../../src/plugin.ts';
import type { SnapshotDeclaration } from '../../src/wire.ts';
import { createFakeExecutor, failure, ok, type RecordedCall } from '../helpers/fake-executor.ts';
import { WSL_CONFIG, WSL_CONFIG_TEXT, routingExecutor } from '../helpers/snapshot-fixtures.ts';

/** 真机路径（2026-10-09 实测 `where.exe gsudo` 的首条命中） */
const GSUDO_PATH = 'D:\\Program Files\\gsudo\\Current\\gsudo.exe';
/** 真机原文：`gsudo status --json` 实测含 `"CacheAvailable":false` */
const STATUS_JSON_NO_CACHE = '{"CacheMode":"Explicit","CacheAvailable":false}';

/** gsudo 按路径存在的那套应答（`where.exe` + `gsudo status --json`） */
function gsudoExecutor(): ReturnType<typeof createFakeExecutor> {
  return createFakeExecutor((call) =>
    call.file === 'where.exe'
      ? ok(`${GSUDO_PATH}\r\n`)
      : call.file === GSUDO_PATH
        ? ok(STATUS_JSON_NO_CACHE)
        : failure('Unexpected', { stderr: `未预期的命令：${call.file}` }));
}

const DECLARATION: SnapshotDeclaration = { managedPorts: ['3306'], scopes: {}, elevationPolicy: 'none' };

/* ───────────────────────── ① 后端侧的三种结论 ───────────────────────── */

test('缺陷2-①：gsudo 按路径存在 ⇒ 可用性 true 且 backend=gsudo（旧代码恒 false，必红）', async () => {
  const fake = gsudoExecutor();

  const availability = await probeElevationAvailability({ executor: fake.executor, platform: 'win32' });

  assert.equal(availability.available, true, '旧实现 `?? (async () => false)` 在这条必红：UI 被置灰而机器其实能提权');
  assert.equal(availability.backend, 'gsudo', '判定与后端探测同源');
  assert.ok(availability.reason.length > 0, '可用的情形也要说清依据（可诊断）');
  assert.deepEqual([...(fake.calls[1]?.argv ?? [])], ['status', '--json'], '只走只读探测：结构化出口优先');
  console.log(`  · 后端侧扫了 ${String(fake.calls.length)} 条只读探测 ⇒ available=${String(availability.available)} / backend=${String(availability.backend)}`);
});

test('缺陷2-②：非 win32（既没 gsudo 也没 Start-Process -Verb RunAs）⇒ 保守 false + 原因可读', async () => {
  const fake = gsudoExecutor();

  const availability = await probeElevationAvailability({ executor: fake.executor, platform: 'linux' });

  assert.equal(availability.available, false);
  assert.equal(availability.backend, null);
  assert.match(availability.reason, /linux/u, '原因必须点名平台（可诊断，不写「未知错误」）');
  assert.match(availability.reason, /无提权通道/u);
  assert.equal(fake.calls.length, 0, '平台不成立 ⇒ 一条探测命令都不该跑');
  console.log(`  · 非 win32 ⇒ available=${String(availability.available)}；reason=${availability.reason}`);
});

test('缺陷2-②：探测抛出异常 ⇒ 保守 false + 原因可读（不抛穿、不静默）', async () => {
  const availability = await probeElevationAvailability({
    executor: createFakeExecutor(() => failure('Unexpected')).executor,
    platform: 'win32',
    probeBackend: () => Promise.reject(new Error('探测通道坏了')),
  });

  assert.equal(availability.available, false);
  assert.equal(availability.backend, null);
  assert.match(availability.reason, /探测通道坏了/u);
  console.log(`  · 探测抛异常 ⇒ available=${String(availability.available)}；reason=${availability.reason}`);
});

/* ───────────────────────── ② 缓存与单飞 ───────────────────────── */

test('缺陷2-③：探测结果**进程内只真跑一次**，并发调用共享同一次（单飞）', async () => {
  const fake = gsudoExecutor();
  const probe = createElevationAvailabilityProbe({ executor: fake.executor, platform: 'win32' });

  assert.equal(probe.peek(), null, '还没跑过 ⇒ peek 必须是 null（不许编一个默认值）');
  const [first, second] = await Promise.all([probe.probe(), probe.probe()]);
  const third = await probe.probe();

  assert.equal(second, first, '并发调用必须共享同一次探测（否则刷新一次起一批进程）');
  assert.equal(third, first, '之后读缓存');
  assert.deepEqual(probe.peek(), first);
  assert.equal(fake.calls.length, 2, `真进程只该起 2 条（where + status --json），实际 ${String(fake.calls.length)} 条`);
  console.log(`  · 3 次 probe（含 2 次并发）扫了 ${String(fake.calls.length)} 条真探测 ⇒ 缓存生效`);
});

/* ───────────────────────── ③ 接线到快照与 gaps ───────────────────────── */

/** 宿主执行器：`where.exe`/`gsudo` 走 gsudo 应答，其余命令交给 003 的只读真 fixture 分流 */
function hostExecutor(): { readonly executor: Executor; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const inner = routingExecutor();
  const executor: Executor = async (file, argv, options) => {
    calls.push({ file, argv: [...argv], options });
    if (file === 'where.exe') return ok(`${GSUDO_PATH}\r\n`);
    if (file === GSUDO_PATH) return ok(STATUS_JSON_NO_CACHE);
    return inner.executor(file, argv, options);
  };
  return { executor, calls };
}

function fakeCtx(): PluginContextLike {
  return {
    provide: () => undefined,
    effect: (callback: () => (() => void) | void) => {
      callback();
      return undefined;
    },
  };
}

/** 装配一套「不碰真 `.wslconfig`、不碰真进程」的宿主依赖 */
function hostDeps(executor: Executor, extra: object = {}): Parameters<typeof applyWslDockerPorts>[2] {
  return {
    executor,
    readNetworkingMode: () => Promise.resolve({ ok: true, path: WSL_CONFIG, mode: 'default', resolved: 'nat' }),
    localhostForwarding: { filePath: WSL_CONFIG, readFile: () => Promise.resolve(WSL_CONFIG_TEXT) },
    ...extra,
  };
}

async function buildOnce(handle: WslDockerPortsPluginHandle): Promise<boolean> {
  const outcome = await handle.snapshotBuilder.build(DECLARATION, {});
  assert.equal(outcome.ok, true, '快照必须装配成功（否则下面的断言会变成空转）');
  return outcome.ok ? outcome.snapshot.elevationAvailable : false;
}

test('缺陷2-④ 接线：真探测接到快照 ⇒ elevationAvailable === true（旧代码恒 false，必红）', async () => {
  const fake = hostExecutor();
  const handle = applyWslDockerPorts(fakeCtx(), undefined, hostDeps(fake.executor));

  assert.equal(await buildOnce(handle), true, '旧代码在这条必红：`?? (async () => false)` ⇒ 快照恒 false（gsudo 明明装着）');
  assert.equal(handle.elevationAvailability()?.backend, 'gsudo', '集成方可从 handle 直接读到判定与依据（真机复验用）');
  assert.match(String(handle.elevationAvailability()?.reason), /backend=gsudo/u);

  // 「不许每份快照都同步打真进程」的可二值判据：第二份快照不再起探测进程
  assert.equal(await buildOnce(handle), true);
  const probes = fake.calls.filter((call) => call.file === 'where.exe' || call.file === GSUDO_PATH);
  assert.equal(probes.length, 2, `两份快照只该起一次真探测（where + status 各一条），实际 ${String(probes.length)} 条`);
  assert.deepEqual(probes.map((call) => call.file), ['where.exe', GSUDO_PATH]);
  console.log(`  · 两份快照扫了 ${String(probes.length)} 条提权探测命令 ⇒ elevationAvailable=${String(await buildOnce(handle))}（缓存生效）`);
});

test('缺陷2-⑤ 接线：探测失败 ⇒ false **且 gaps 里有可诊断原因**（不抛异常、不静默）', async () => {
  const handle = applyWslDockerPorts(
    fakeCtx(),
    undefined,
    hostDeps(routingExecutor().executor, { probeBackend: () => Promise.reject(new Error('探测通道坏了')) }),
  );

  assert.equal(await buildOnce(handle), false, '探测失败 ⇒ 保守 false（未知状态不放开写控件）');
  const gap = handle.gaps.find((item) => item.what === 'elevationAvailable');
  assert.ok(gap !== undefined, '失败必须出现在 gaps 里（本包的既有口径：不静默）');
  assert.match(String(gap?.reason), /探测通道坏了/u);
  assert.match(String(gap?.reason), /写控件置灰/u);
  console.log(`  · 探测失败 ⇒ elevationAvailable=false；gaps=${JSON.stringify(handle.gaps.map((item) => item.what))}`);
});

test('缺陷2-⑥：注入 `probeElevationAvailable` 时**以注入为准**（不打任何真进程）', async () => {
  const fake = hostExecutor();
  const handle = applyWslDockerPorts(fakeCtx(), undefined, hostDeps(fake.executor, { probeElevationAvailable: () => Promise.resolve(true) }));

  assert.equal(await buildOnce(handle), true);
  assert.equal(handle.elevationAvailability(), null, '注入覆盖时内置探测不该被触发（peek 仍是 null）');
  assert.equal(fake.calls.some((call) => call.file === 'where.exe'), false, '零真探测命令');
  console.log('  · 注入优先：0 条 where.exe / gsudo 探测命令');
});
