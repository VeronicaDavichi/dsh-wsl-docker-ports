/**
 * 014：自动刷新频次的**纯函数 + 读取面 + 写回**（`node --test`，无 DOM）
 *
 * 三条都刻意在无 React 的层面证：
 * 1. 五档归一化（非法值一律关闭）；
 * 2. 快照比较忽略 `refreshedAt`（并且与对象键序无关）；
 * 3. 宿主 `config-read` 与客户端 `settings-pipe` 的读写口径（默认 0、写单键 patch）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createHostConfigReaders } from '../../src/config-read.ts';
import type { PortsSnapshot } from '../../src/client/types.ts';
import { normalizeRefreshIntervalSec, REFRESH_INTERVAL_OPTIONS, sameSnapshotPayload } from '../../src/client/refresh.ts';
import { createSettingsPipe, SETTINGS_NAMESPACE } from '../../src/client/settings-pipe.ts';
import type { SettingsPatch } from '../../src/client/settings-pipe.ts';
import type { RemoteSettingsLike, SettingsResponse } from '../../src/client/host.ts';
import { FIXED_TIMESTAMP, snapshot } from './client-fixtures.ts';

test('014 五档：选项恰为 关闭/15 秒/30 秒/60 秒/5 分钟；非法值一律归 0', () => {
  assert.deepEqual(
    REFRESH_INTERVAL_OPTIONS.map((option) => [option.value, option.label]),
    [
      [0, '关闭'],
      [15, '15 秒'],
      [30, '30 秒'],
      [60, '60 秒'],
      [300, '5 分钟'],
    ],
  );
  for (const option of REFRESH_INTERVAL_OPTIONS) {
    assert.equal(normalizeRefreshIntervalSec(option.value), option.value);
    assert.equal(normalizeRefreshIntervalSec(String(option.value)), option.value, '数字字符串同口径');
  }
  for (const bad of [undefined, null, '', '  ', 'bogus', -15, 20, 45, 301, Number.NaN, Infinity, true]) {
    assert.equal(normalizeRefreshIntervalSec(bad), 0, `非法值必须关闭：${String(bad)}`);
  }
  console.log(`  · 扫了 ${String(REFRESH_INTERVAL_OPTIONS.length)} 档 + 12 个非法输入：全部按口径归一`);
});

test('014 快照比较：忽略 refreshedAt，数据变化/键序不误判', () => {
  const base = snapshot({ managedPortsDecl: ['3306'] });
  assert.equal(sameSnapshotPayload(base, snapshot({ managedPortsDecl: ['3306'] })), true, '同一份数据（时间戳相同）必须判无变化');

  const later = snapshot({ managedPortsDecl: ['3306'], refreshedAt: FIXED_TIMESTAMP + 60_000 });
  assert.equal(sameSnapshotPayload(base, later), true, '🔴 refreshedAt 不同但数据相同 ⇒ 仍判无变化（轮询不重绘的判据）');

  const changed = snapshot({ managedPortsDecl: ['3306', '8080'] });
  assert.equal(sameSnapshotPayload(base, changed), false, '数据真变化必须判变化');

  // 键序不同、值相同：稳定序列化必须判「无变化」
  const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as PortsSnapshot;
  assert.equal(sameSnapshotPayload(base, reordered), true, '对象键序不同不得被当成数据变化');

  console.log('  · 扫了 4 组快照：同数据/仅时间戳/真变化/键序倒置 —— 判据与预期逐项一致');
});

test('014 宿主读取面：refreshIntervalSec 默认 0、数值/数字字符串都收、非法归 0（含 volatile 活体）', () => {
  assert.equal(createHostConfigReaders(undefined).refreshIntervalSec(), 0, '缺省必须是 0（关闭）');
  assert.equal(createHostConfigReaders({}).refreshIntervalSec(), 0);
  assert.equal(createHostConfigReaders({ refreshIntervalSec: 15 }).refreshIntervalSec(), 15);
  assert.equal(createHostConfigReaders({ refreshIntervalSec: '30' }).refreshIntervalSec(), 30, '手写/旧文档里的字符串也要收');
  assert.equal(createHostConfigReaders({ refreshIntervalSec: ' 300 ' }).refreshIntervalSec(), 300, '两侧空白要 trim');
  assert.equal(createHostConfigReaders({ refreshIntervalSec: 20 }).refreshIntervalSec(), 0, '未登记秒数 ⇒ 关闭');
  assert.equal(createHostConfigReaders({ refreshIntervalSec: -15 }).refreshIntervalSec(), 0, '负数 ⇒ 关闭');
  assert.equal(createHostConfigReaders({ refreshIntervalSec: 'bogus' }).refreshIntervalSec(), 0);

  // volatile 活体：宿主交给我们的是带 `.get()` 的包装，读侧必须解包（否则拿到包装对象）
  const live = createHostConfigReaders({ refreshIntervalSec: { get: () => 60 } });
  assert.equal(live.refreshIntervalSec(), 60, 'volatile 活体包装必须解包后再归一');
  const liveInvalid = createHostConfigReaders({ refreshIntervalSec: { get: () => 45 } });
  assert.equal(liveInvalid.refreshIntervalSec(), 0, '活体里的未登记值同样归 0');

  console.log('  · 扫了 9 组来源（缺省/对象/字符串/非法/活体）：读数与归一全部一致');
});

function fakeSettings(interval: unknown): { readonly service: RemoteSettingsLike; readonly updates: SettingsPatch[] } {
  const updates: SettingsPatch[] = [];
  const service: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => ({
      ok: true,
      value: { revision: 4, namespaces: [{ ns: SETTINGS_NAMESPACE, revision: 4, value: { refreshIntervalSec: interval } }] },
    }),
    update: async (_ns: string, patch: unknown): Promise<SettingsResponse> => {
      updates.push(patch as SettingsPatch);
      return { ok: true, value: {} };
    },
    mutate: async (): Promise<SettingsResponse> => {
      throw new Error('本用例不该走 mutate');
    },
  };
  return { service, updates };
}

test('014 客户端读回：默认 0 / 15 / "30" / 非法 0（视图层不猜）', async () => {
  assert.equal((await createSettingsPipe(() => fakeSettings(undefined).service).readConfig()).refreshIntervalSec, 0);
  assert.equal((await createSettingsPipe(() => fakeSettings(15).service).readConfig()).refreshIntervalSec, 15);
  assert.equal((await createSettingsPipe(() => fakeSettings('30').service).readConfig()).refreshIntervalSec, 30, '数字字符串也收');
  const invalid = (await createSettingsPipe(() => fakeSettings('bogus').service).readConfig()).refreshIntervalSec;
  assert.equal(invalid, 0);
  // 视图可能原样带出未登记数值（20），但选择器归一化后仍是「关闭」—— 两层合起来不会出现第六档。
  const unlisted = (await createSettingsPipe(() => fakeSettings(20).service).readConfig()).refreshIntervalSec;
  assert.equal(normalizeRefreshIntervalSec(unlisted), 0);
  console.log('  · 扫了 5 组读回：0/15/30/乱码/未登记 —— 前四组直接落 0 或合法值，未登记值被选择器归一为 0');
});

test('014 客户端写回：writeRefreshInterval 只发一个键、带 revision、不多发', async () => {
  const fake = fakeSettings(0);
  const pipe = createSettingsPipe(() => fake.service);
  const result = await pipe.writeRefreshInterval(15);
  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, { refreshIntervalSec: 15 });
  assert.equal(result.revisionPassed, true, 'describe 给了 revision ⇒ 必须带上（并发写保护）');
  assert.equal(fake.updates.length, 1, '选一次只写一次');
  assert.deepEqual(fake.updates[0], { refreshIntervalSec: 15 });
  assert.equal(pipe.updateCount(), 1);

  const missing = await createSettingsPipe(() => undefined).writeRefreshInterval(30);
  assert.equal(missing.ok, false);
  assert.match(missing.message, /remote\.settings/u, '未接线必须给可读原因，不抛');
  console.log(`  · 扫了 2 次写入：一次单键 patch=${JSON.stringify(fake.updates[0])}，一次未接线降级`);
});
