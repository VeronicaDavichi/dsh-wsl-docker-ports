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
  assert.deepEqual(fake.calls[1]?.argv, ['status'], '只做只读探测，绝不改动用户 gsudo 配置');
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
