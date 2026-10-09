/**
 * T3.7 后端链探测的离线面（`gsudo` → `native` 回落）—— 只做只读探测的判定
 *
 * ⚠️ 真机验证（`gsudo` 真弹 UAC / 真 999）不在本次交付内，但**判据**必须在此钉死，尤其是
 * 本机那个已实测的陷阱：`Get-Command sudo` 唯一命中的是 **gsudo 自带的 `sudo.exe`**
 * （ProductName=gsudo 2.6.1）⇒ 一旦按命令名 `sudo` 探测，就会误判进 `winsudo` 分支。
 * 所以这里有一条**反向断言**：执行器里不允许出现以 `sudo` 结尾的探测调用。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  detectBackend,
  isSystemSudoPath,
  parseGsudoStatus,
  parseWhereOutput,
  resolvePolicy,
  windowsSudoPath,
} from '../../src/elevate/backend.ts';
import { createFakeExecutor, failure, ok, type RecordedCall } from '../helpers/fake-executor.ts';

/** 按「可执行文件」分派应答；没登记的路径一律 CommandNotFound（更接近真机） */
function router(
  routes: Record<string, ReturnType<typeof ok> | ReturnType<typeof failure>>,
): (call: RecordedCall) => ReturnType<typeof ok> | ReturnType<typeof failure> {
  return (call) => routes[call.file] ?? failure('CommandNotFound');
}

const GSUDO_PATH = 'D:\\Program Files\\gsudo\\Current\\gsudo.exe';
/** gsudo 自带、与本机 `sudo` 命令名撞车的那份 shim（真机实测存在） */
const GSUDO_SHIM = 'D:\\Program Files\\gsudo\\Current\\sudo.exe';

const STATUS_NO_CACHE = [
  'gsudo v2.6.1 (MSVC 194234443)',
  'Copyright (c) 2024 Gerardo Grignoli',
  '',
  'Credentials cache:',
  '  Mode          : Explicit',
  '  Available     : False',
  '  Expires       : -',
].join('\r\n');

const STATUS_WITH_CACHE = STATUS_NO_CACHE.replace('Available     : False', 'Available     : True');

/**
 * 🔴 **真机原文**（gsudo v2.6.1，2026-10-09 两次实测一致）：可用性行是 `Available for this process:`。
 * 旧正则 `/Available\s*:\s*(True|False)/` 在这份输出上**永不匹配** ⇒ 生产链静默回落 native。
 */
const STATUS_V261_REAL = [
  'gsudo v2.6.1 (MSVC 194234443)',
  'Copyright (c) 2024 Gerardo Grignoli',
  '',
  'Credentials cache:',
  '  Mode                       : Explicit',
  '  Available for this process: False',
  '  Expires                    : -',
].join('\r\n');

/** 🔴 **真机原文**（结构化出口）：`gsudo status --json` 实测含 `"CacheAvailable":false` */
const STATUS_JSON_NO_CACHE = '{"CacheMode":"Explicit","CacheAvailable":false,"CacheDuration":"10m"}';

test('T3.7 装了 gsudo 且缓存未激活 ⇒ gsudo 后端 + 绝对路径（stdio 回传）', async () => {
  const fake = createFakeExecutor(router({
    'where.exe': ok(`${GSUDO_PATH}\r\n`),
    [GSUDO_PATH]: ok(STATUS_NO_CACHE),
  }));

  const choice = await detectBackend({ executor: fake.executor });

  assert.equal(choice.backend, 'gsudo');
  assert.equal(choice.gsudoPath, GSUDO_PATH);
  assert.equal(choice.cacheActive, false);
  assert.deepEqual(fake.calls.map((call) => call.file), ['where.exe', GSUDO_PATH]);
});

test('T3.7 🔴 只按路径认 gsudo：where 只给出 gsudo 的 sudo.exe shim 时 ⇒ 回落 native', async () => {
  const fake = createFakeExecutor(router({ 'where.exe': ok(`${GSUDO_SHIM}\r\n`) }));

  const choice = await detectBackend({ executor: fake.executor });

  assert.equal(choice.backend, 'native', '按命令名 sudo 探测会误判（本机陷阱）');
  assert.match(choice.note, /刻意不认 sudo 这个命令名/);
  // 反向证据：没有任何一次探测是拿「sudo」这个命令名去问的
  for (const call of fake.calls) {
    assert.notEqual(call.file.replace(/\.exe$/i, '').toLowerCase(), 'sudo');
  }
});

test('T3.7 where.exe 失败（未安装）⇒ native，永久回落不依赖外部工具', async () => {
  const fake = createFakeExecutor(router({ 'where.exe': failure('CommandNotFound') }));

  const choice = await detectBackend({ executor: fake.executor });

  assert.equal(choice.backend, 'native');
  assert.equal(choice.gsudoPath, null);
  assert.match(choice.note, /Start-Process -Verb RunAs/);
});

test('T3.7 gsudo 凭据缓存活跃 ⇒ 回落 native（不调 gsudo -k、不改 gsudo 配置）', async () => {
  const fake = createFakeExecutor(router({
    'where.exe': ok(`${GSUDO_PATH}\r\n`),
    [GSUDO_PATH]: ok(STATUS_WITH_CACHE),
  }));

  const choice = await detectBackend({ executor: fake.executor });

  assert.equal(choice.backend, 'native');
  assert.equal(choice.cacheActive, true);
  assert.equal(choice.gsudoPath, GSUDO_PATH, '路径照实保留（便于 UI 展示与诊断）');
  assert.match(choice.note, /缓存/);
  assert.match(choice.note, /不调用 gsudo -k|不改 gsudo/);
  // 只读探测的形态：**结构化出口优先**（`--json`），且一律只跑 `status` —— 绝不 `-k` / `config`
  const probes = fake.calls.slice(1).map((call) => [...call.argv]);
  assert.deepEqual(probes[0], ['status', '--json'], '结构化优先（gsudo v2.6.1 的 `--json` 实测含 CacheAvailable）');
  for (const argv of probes) {
    assert.equal(argv[0], 'status', '只做只读探测，绝不改动用户 gsudo 配置');
    assert.equal(argv.includes('-k') || argv.includes('config'), false, '绝不杀用户的缓存会话、绝不改配置');
  }
});

test('T3.7 `gsudo status` 读不出来 / 探测失败 ⇒ 保守回落 native（守住每次 UAC 闸门）', async () => {
  const unreadable = createFakeExecutor(router({
    'where.exe': ok(`${GSUDO_PATH}\r\n`),
    [GSUDO_PATH]: ok('some unexpected output'),
  }));
  const failed = createFakeExecutor(router({
    'where.exe': ok(`${GSUDO_PATH}\r\n`),
    [GSUDO_PATH]: failure('NonZeroExit', { exitCode: 1, stderr: 'boom' }),
  }));

  const a = await detectBackend({ executor: unreadable.executor });
  const b = await detectBackend({ executor: failed.executor });

  assert.equal(a.backend, 'native');
  assert.equal(b.backend, 'native');
  assert.equal(parseGsudoStatus('some unexpected output').readable, false);
  assert.match(b.note, /保守回落 native/);
});

test('T3.7 显式配置 winsudo：固定路径存在才用；不存在 ⇒ 回落链继续', async () => {
  const systemRoot = 'C:\\Windows';
  const sudoPath = windowsSudoPath(systemRoot);
  assert.equal(sudoPath, 'C:\\Windows\\System32\\sudo.exe');

  const present = createFakeExecutor(router({ 'where.exe': ok('') }));
  const choice = await detectBackend({
    executor: present.executor,
    configured: 'winsudo',
    systemRoot,
    fileExists: async (path) => path === sudoPath,
  });
  assert.equal(choice.backend, 'winsudo');
  assert.match(choice.note, /显式配置 elevationBackend=winsudo/);

  const absent = createFakeExecutor(router({ 'where.exe': failure('CommandNotFound') }));
  const fallback = await detectBackend({
    executor: absent.executor,
    configured: 'winsudo',
    systemRoot,
    fileExists: async () => false,
  });
  assert.equal(fallback.backend, 'native');
  assert.match(fallback.note, /不存在/);
});

test('T3.7 auto 不会去碰 System32\\sudo.exe（23H2 上不存在，且不是我们的回落路径）', async () => {
  const fake = createFakeExecutor(router({
    'where.exe': ok(`${GSUDO_PATH}\r\n`),
    [GSUDO_PATH]: ok(STATUS_NO_CACHE),
  }));
  let asked: string[] = [];

  await detectBackend({
    executor: fake.executor,
    fileExists: async (path) => {
      asked = [...asked, path];
      return true;
    },
  });

  assert.deepEqual(asked, [], 'auto 链不该去问系统 sudo 是否存在');
});

test('T3.7 where 输出解析：多行取 gsudo.exe、大小写不敏感、拒绝 shim', () => {
  assert.equal(parseWhereOutput(`C:\\x\\gsudo.exe\r\nC:\\y\\other.exe\r\n`, 'gsudo.exe'), 'C:\\x\\gsudo.exe');
  assert.equal(parseWhereOutput(`C:\\x\\GSUDO.EXE`, 'gsudo.exe'), 'C:\\x\\GSUDO.EXE');
  assert.equal(parseWhereOutput(`C:\\y\\sudo.exe`, 'gsudo.exe'), null);
  assert.equal(parseWhereOutput('', 'gsudo.exe'), null);
});

test('T3.7 系统 sudo 路径判定：SystemRoot 下才算系统自带', () => {
  assert.equal(isSystemSudoPath('C:\\Windows\\System32\\sudo.exe', 'C:\\Windows'), true);
  assert.equal(isSystemSudoPath('c:\\windows\\system32\\SUDO.EXE', 'C:\\Windows'), true);
  assert.equal(isSystemSudoPath(GSUDO_SHIM, 'C:\\Windows'), false, 'gsudo 的 shim 不是系统 sudo');
});

test('T3.7 策略解析：Agent 触发的 passby 一律降级 ask；none 不被任何来源提升', () => {
  assert.equal(resolvePolicy('passby', 'agent'), 'ask');
  assert.equal(resolvePolicy('passby', 'user'), 'passby');
  assert.equal(resolvePolicy('ask', 'agent'), 'ask');
  assert.equal(resolvePolicy('ask', 'user'), 'ask');
  assert.equal(resolvePolicy('none', 'agent'), 'none');
  assert.equal(resolvePolicy('none', 'user'), 'none');
});

/* ───────── 缺陷 1 的对抗性回归（真机 2026-10-09：gsudo v2.6.1 实装但探测读不出来） ───────── */

test('T3.7-修① 🔴 对抗性回归：真机原文 `Available for this process: False` ⇒ 必须识别为 gsudo', async () => {
  const fake = createFakeExecutor(router({
    'where.exe': ok(`${GSUDO_PATH}\r\n`),
    [GSUDO_PATH]: ok(STATUS_V261_REAL),
  }));

  const choice = await detectBackend({ executor: fake.executor });

  assert.equal(choice.backend, 'gsudo', '旧代码在这条必红：旧正则不匹配 ⇒ readable:false ⇒ 保守回落 native');
  assert.equal(choice.cacheActive, false, '`for this process: False` = 缓存未激活 ⇒ 用 gsudo，不是回落');
  assert.equal(choice.gsudoPath, GSUDO_PATH);
  // 解析器本身也钉一遍（判据来自真机原文，不是从实现里取的）
  assert.equal(parseGsudoStatus(STATUS_V261_REAL).readable, true);
  assert.equal(parseGsudoStatus(STATUS_V261_REAL).cacheAvailable, false);
  assert.equal(parseGsudoStatus(STATUS_V261_REAL).source, 'text');
  console.log(`  · 真机原文判定：backend=${choice.backend} / cacheActive=${String(choice.cacheActive)} / 判据来自 text`);
});

test('T3.7-修① 结构化出口优先：`gsudo status --json` 的 `CacheAvailable` 就是判据（读得出来就不再跑第二条命令）', async () => {
  const fake = createFakeExecutor(router({
    'where.exe': ok(`${GSUDO_PATH}\r\n`),
    [GSUDO_PATH]: ok(STATUS_JSON_NO_CACHE),
  }));

  const choice = await detectBackend({ executor: fake.executor });

  assert.equal(choice.backend, 'gsudo');
  assert.equal(choice.cacheActive, false);
  assert.deepEqual(fake.calls.map((call) => call.file), ['where.exe', GSUDO_PATH]);
  assert.deepEqual([...(fake.calls[1]?.argv ?? [])], ['status', '--json'], '结构化出口是第一条探测命令');
  assert.equal(parseGsudoStatus(STATUS_JSON_NO_CACHE).source, 'json');
  assert.match(choice.note, /gsudo status --json/u, 'note 要写清判据来自哪一路（可诊断）');
  console.log(`  · 结构化判定：argv=${JSON.stringify([...(fake.calls[1]?.argv ?? [])])} ⇒ backend=${choice.backend}`);
});

test('T3.7-修① 结构化 JSON 说缓存活跃 ⇒ 照旧回落 native（REQ-3.4 的保守方向没变）', async () => {
  const fake = createFakeExecutor(router({
    'where.exe': ok(`${GSUDO_PATH}\r\n`),
    [GSUDO_PATH]: ok('{"CacheAvailable":true,"CacheMode":"Auto"}'),
  }));

  const choice = await detectBackend({ executor: fake.executor });

  assert.equal(choice.backend, 'native');
  assert.equal(choice.cacheActive, true);
  assert.match(choice.note, /不调用 gsudo -k|不改 gsudo/);
});

test('T3.7-修① 🔴 两路都读不出来 ⇒ 保守 native 且 note **点名两路**（保守性没丢、也不许静默）', async () => {
  const fake = createFakeExecutor(router({
    'where.exe': ok(`${GSUDO_PATH}\r\n`),
    [GSUDO_PATH]: ok('totally unrecognizable output'),
  }));

  const choice = await detectBackend({ executor: fake.executor });

  assert.equal(choice.backend, 'native', '读不出来 ⇒ 按「缓存可能活跃」保守回落（REQ-3.4）');
  assert.equal(choice.gsudoPath, GSUDO_PATH, '路径照实保留（便于诊断）');
  assert.equal(parseGsudoStatus('totally unrecognizable output').readable, false);
  assert.ok(choice.note.length > 0, 'note 必须非空 —— 「静默退化」正是缺陷 1 的形态');
  assert.match(choice.note, /--json/u, 'note 要说清结构化那一路的结果');
  assert.match(choice.note, /Available/u, 'note 要说清人工可读那一路的结果');
  assert.match(choice.note, /保守回落 native/u);
  assert.equal(fake.calls.length, 3, '两路都要真的试过：where + status --json + status');
  console.log(`  · 两路都读不出来 ⇒ backend=${choice.backend}；note=${choice.note}`);
});

test('T3.7-修① 探测命令抛出异常 ⇒ **不抛穿**（e）且 note 里带原因', async () => {
  const fake = createFakeExecutor(() => {
    throw new Error('spawn EPERM');
  });

  const choice = await detectBackend({ executor: fake.executor });

  assert.equal(choice.backend, 'native', '异常也要给出一个可判定的后端，不是让调用方崩掉');
  assert.match(choice.note, /抛出异常/u);
  assert.match(choice.note, /spawn EPERM/u);
  console.log(`  · 抛异常探测 ⇒ backend=${choice.backend}；note 含原因`);
});
