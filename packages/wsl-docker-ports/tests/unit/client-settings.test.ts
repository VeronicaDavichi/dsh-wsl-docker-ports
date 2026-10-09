/**
 * T5.3 / T5.7：配置写回的**唯一管道**（`node --test`，无 DOM）
 *
 * 要证的三件事，每条都能二值判定：
 * 1. 四个写方法各写**自己那一项**（patch 的键集合恰好一个 —— 「只改这一项」不是形容词）；
 * 2. 并发写保护：`describe()` 里能取到 revision 就带上，取不到就**不带**（不伪造）；
 * 3. 服务缺失 ⇒ `ok:false` + 文案，**不抛异常**（REQ-10.3 的同一条口径）。
 *
 * 「零提权调用」的**反向对照**放在这里：同一轮里另挂一个提权计数器，断言它是 0 且
 * 写配置的 update 真发生了 —— 否则「0 次提权」可能只是「什么都没发生」的假象。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSettingsPipe, namespaceValue, revisionOf, SETTINGS_NAMESPACE } from '../../src/client/settings-pipe.ts';
import type { SettingsPatch } from '../../src/client/settings-pipe.ts';
import type { RemoteSettingsLike, SettingsResponse } from '../../src/client/host.ts';

interface RecordedUpdate {
  readonly ns: string;
  readonly patch: SettingsPatch;
  readonly revision: unknown;
  readonly argCount: number;
}

function fakeSettings(
  current: Record<string, unknown> = {},
  options: { readonly revision?: unknown; readonly omitRevision?: boolean } = {},
): {
  readonly service: RemoteSettingsLike;
  readonly updates: RecordedUpdate[];
  readonly describes: () => number;
} {
  const updates: RecordedUpdate[] = [];
  let describes = 0;
  const service: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => {
      describes += 1;
      // ⚠️ 用 options 而不是默认参数表达「没有 revision」：默认参数在显式传 `undefined` 时会**回落默认值**，
      // 那样就造不出「取不到 revision」这个场景了（这个坑正是本测试第一版踩到的）。
      const value: Record<string, unknown> = { namespaces: [{ ns: SETTINGS_NAMESPACE, value: current }] };
      if (options.omitRevision !== true) value['revision'] = options.revision ?? 7;
      return { ok: true, value };
    },
    // 用 rest 参数数**真实实参个数**：`expectedRevision` 是 undefined 时，
    // 「传了 undefined」与「只传两参」在语义上不同，必须能分辨
    update: async (...args: unknown[]): Promise<SettingsResponse> => {
      updates.push({ ns: String(args[0]), patch: args[1] as SettingsPatch, revision: args[2], argCount: args.length });
      return { ok: true, value: {} };
    },
  };
  return { service, updates, describes: () => describes };
}

test('T5.7 写回：每个写方法只产出恰好一个键的 patch（「只改这一项」）', async () => {
  const cases: readonly { readonly name: string; readonly run: (pipe: ReturnType<typeof createSettingsPipe>) => Promise<unknown>; readonly key: string }[] = [
    { name: 'managedPorts', run: (pipe) => pipe.writeManagedPorts(['3306', '1000-3000']), key: 'managedPorts' },
    { name: 'distro', run: (pipe) => pipe.writeDistro('Ubuntu2204'), key: 'distro' },
    { name: 'elevationPolicy', run: (pipe) => pipe.writeElevationPolicy('ask'), key: 'elevationPolicy' },
    { name: 'scopes', run: (pipe) => pipe.writeScope(3306, 'lan'), key: 'scopes' },
  ];
  for (const item of cases) {
    const fake = fakeSettings();
    const pipe = createSettingsPipe(() => fake.service);
    const result = await item.run(pipe);
    assert.equal(fake.updates.length, 1, `${item.name}: update 必须恰好 1 次，实际 ${String(fake.updates.length)}`);
    const update = fake.updates[0];
    assert.deepEqual(Object.keys(update?.patch ?? {}), [item.key], `${item.name}: patch 键集合应为 [${item.key}]，实际 ${JSON.stringify(Object.keys(update?.patch ?? {}))}`);
    assert.equal(update?.ns, SETTINGS_NAMESPACE, '命名空间必须是 patch 条目 id（= 包名）');
    assert.equal(update?.revision, 7, '有能力带 revision 时必须带上（并发写保护）');
    assert.deepEqual((result as { ok: boolean }).ok, true);
  }
  console.log(`  · 扫了 ${String(cases.length)} 个写方法，每个都产出单键 patch`);
});

test('T5.7 写回：scopes 只写被切的那一个端口（不覆盖整张表）', async () => {
  const fake = fakeSettings({ scopes: { '5432': 'lan' } });
  await createSettingsPipe(() => fake.service).writeScope(3306, 'loopback');
  assert.deepEqual(fake.updates[0]?.patch, { scopes: { '3306': 'loopback' } });
  console.log(`  · patch = ${JSON.stringify(fake.updates[0]?.patch)}；既有 5432 的声明不在 patch 里（由 settings 合并）`);
});

test('T5.7 写回：取不到 revision 时不带第三参（不伪造并发写保护）', async () => {
  const fake = fakeSettings({}, { omitRevision: true });
  await createSettingsPipe(() => fake.service).writeDistro('Debian');
  assert.equal(fake.updates.length, 1);
  assert.equal(fake.updates[0]?.argCount, 2, `取不到 revision 时必须只传两参，实际 ${String(fake.updates[0]?.argCount)}`);
  console.log(`  · 扫了 1 次 update：实参个数 ${String(fake.updates[0]?.argCount)}，revision=${JSON.stringify(fake.updates[0]?.revision)}`);
});

test('T5.7 写回：remote.settings 缺失 ⇒ ok:false + 文案，不抛异常', async () => {
  const pipe = createSettingsPipe(() => undefined);
  const result = await pipe.writeManagedPorts(['3306']);
  assert.equal(result.ok, false);
  assert.match(result.message, /remote\.settings/u);
  assert.equal(pipe.updateCount(), 0, '服务缺失时不得计入 update');
  const read = await pipe.readConfig();
  assert.deepEqual(read, { managedPorts: [], distro: undefined, elevationPolicy: undefined, scopes: {} });
  console.log(`  · 扫了 2 个调用（写/读），均降级返回，updateCount=${String(pipe.updateCount())}`);
});

test('T5.7 写回：update 失败 ⇒ ok:false 并原样带回错误文案', async () => {
  const service: RemoteSettingsLike = {
    describe: async () => ({ ok: true, value: { revision: 1, namespaces: [] } }),
    update: async () => ({ ok: false, error: 'revision 冲突' }),
  };
  const result = await createSettingsPipe(() => service).writeDistro('X');
  assert.equal(result.ok, false);
  assert.match(result.message, /revision 冲突/u);
  console.log(`  · 扫了 1 个失败回执：${result.message}`);
});

test('T5.7 读回：managedPorts / distro / elevationPolicy / scopes 都能解析出来', async () => {
  const fake = fakeSettings({ managedPorts: ['3306', '1000-3000', 42], distro: 'Ubuntu2204', elevationPolicy: 'passby', scopes: { '3306': 'lan', '5432': 'bogus' } });
  const config = await createSettingsPipe(() => fake.service).readConfig();
  assert.deepEqual(config.managedPorts, ['3306', '1000-3000'], '非字符串项必须被过滤，不得污染声明');
  assert.equal(config.distro, 'Ubuntu2204');
  assert.equal(config.elevationPolicy, 'passby');
  assert.deepEqual(config.scopes, { '3306': 'lan' }, '非法 scope 值必须被丢掉');
  console.log(`  · 扫了 ${String(Object.keys(config.scopes).length)} 个 scope / ${String(config.managedPorts.length)} 条声明（原始 3 条，非法 1 条被剔）`);
});

test('T5.7 读回：命名空间与 revision 的形状兼容三种写法', () => {
  const shapes: readonly { readonly name: string; readonly value: unknown; readonly expected: unknown }[] = [
    { name: '顶层 revision', value: { revision: 5, namespaces: [] }, expected: 5 },
    { name: 'namespaces[].revision', value: { namespaces: [{ ns: SETTINGS_NAMESPACE, revision: 6 }] }, expected: 6 },
    { name: 'namespaces[].value.revision', value: { namespaces: [{ ns: SETTINGS_NAMESPACE, value: { revision: 8 } }] }, expected: 8 },
    { name: '一处都没有', value: { namespaces: [] }, expected: undefined },
  ];
  for (const shape of shapes) assert.equal(revisionOf({ ok: true, value: shape.value }), shape.expected, shape.name);
  const value = namespaceValue({ ok: true, value: { namespaces: [{ ns: SETTINGS_NAMESPACE, value: { a: 1 } }, { ns: 'other', value: { b: 2 } }] } });
  assert.deepEqual(value, { a: 1 }, '只取本命名空间的值，别家的不得混入');
  console.log(`  · 扫了 ${String(shapes.length)} 种 revision 形状 + 2 个命名空间条目`);
});

test('T5.7 零提权调用：写配置的一轮里提权计数器保持 0（且确有配置写入，非「什么都没发生」）', async () => {
  const fake = fakeSettings();
  const elevationCalls: string[] = [];
  // 形如真实 runtime 的接线：settings 与 elevation 并排放着，代码路径**只碰 settings**
  const runtime = {
    settings: createSettingsPipe(() => fake.service),
    elevation: {
      run: async (request: { readonly action: string }) => {
        elevationCalls.push(request.action);
        return { status: 'ok', message: '', steps: [] };
      },
    },
  };
  await runtime.settings.writeManagedPorts(['3306']);
  await runtime.settings.writeScope(3306, 'lan');

  assert.equal(elevationCalls.length, 0, '写配置不得触发任何提权调用');
  assert.equal(fake.updates.length, 2, '反向对照：配置写入必须真的发生，否则上面的 0 是假象');
  assert.equal(runtime.settings.updateCount(), 2);
  console.log(`  · 扫了 2 次配置写入 / ${String(elevationCalls.length)} 次提权调用（updateCount=${String(runtime.settings.updateCount())}）`);
});

test('T5.7 管道面收窄：settings 管道只暴露 5 个方法，没有任何「执行/提权」入口', () => {
  const pipe = createSettingsPipe(() => undefined);
  const keys = Object.keys(pipe).sort();
  assert.deepEqual(keys, ['readConfig', 'updateCount', 'writeDistro', 'writeElevationPolicy', 'writeManagedPorts', 'writeScope']);
  const forbidden = ['run', 'invoke', 'exec', 'elevate', 'spawn'];
  assert.deepEqual(forbidden.filter((key) => key in pipe), [], '配置管道不得带执行入口');
  console.log(`  · 扫了 ${String(keys.length)} 个方法名：${JSON.stringify(keys)}；执行入口 0 个`);
});
