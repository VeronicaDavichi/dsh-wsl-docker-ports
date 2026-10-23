/**
 * T5.3 / T5.7：配置写回的**唯一管道**（`node --test`，无 DOM）
 *
 * 要证的五件事，每条都能二值判定：
 * 1. 四个写方法各写**自己那一项**（patch 的键集合恰好一个 —— 「只改这一项」不是形容词）；
 * 2. 并发写保护：`describe()` 里能取到 revision 就带上，取不到就传**显式 `undefined`**
 *    （🔴 2026-10-12 缺陷 2 订正：宿主按**实参个数**校验，少传一个直接抛
 *    `client api: settings/update expected 3 argument(s), got 2` ⇒「不带」不是合法写法，
 *    显式 `undefined` 才等价于「无条件写」）；
 * 3. 服务缺失 ⇒ `ok:false` + 文案，**不抛异常**（REQ-10.3 的同一条口径）；
 * 4. 宿主**抛错**（缺陷 4）⇒ 也化成 `ok:false` + 可读原因，只尝试 1 次（不重试）；
 * 5. **反例对照**：修前的两参写法在同一份宿主校验下**必抛**（否则第 2 条可能恒真）。
 *
 * 「零提权调用」的**反向对照**放在这里：同一轮里另挂一个提权计数器，断言它是 0 且
 * 写配置的 update 真发生了 —— 否则「0 次提权」可能只是「什么都没发生」的假象。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSettingsPipe, namespaceValue, revisionOf, SETTINGS_NAMESPACE } from '../../src/client/settings-pipe.ts';
import type { SettingsPatch } from '../../src/client/settings-pipe.ts';
import type { RemoteSettingsLike, SettingsPathOp, SettingsResponse } from '../../src/client/host.ts';

interface RecordedUpdate {
  readonly ns: string;
  readonly patch: SettingsPatch;
  readonly revision: unknown;
  readonly argCount: number;
}

/**
 * 只实现 `describe` / `update` 的假件，`mutate` 一律**抛**（T3 起 `mutate` 是接口必填项）：
 * 这些用例都不该碰清除路径 ⇒ 真被调到就是用例自身写错了，抛出来比静默 ok 好。
 */
function mutateNotExpected(): (ns: string, ops: readonly SettingsPathOp[], expectedRevision?: unknown) => Promise<SettingsResponse> {
  return async () => {
    throw new Error('本用例不该走 mutate（清除凭据是唯一的 mutate 用户）');
  };
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
    mutate: mutateNotExpected(),
  };
  return { service, updates, describes: () => describes };
}

test('T5.7 写回：每个写方法只产出恰好一个键的 patch（「只改这一项」）', async () => {
  const cases: readonly { readonly name: string; readonly run: (pipe: ReturnType<typeof createSettingsPipe>) => Promise<unknown>; readonly key: string }[] = [
    { name: 'managedPorts', run: (pipe) => pipe.writeManagedPorts(['3306', '1000-3000']), key: 'managedPorts' },
    { name: 'distro', run: (pipe) => pipe.writeDistro('Ubuntu2204'), key: 'distro' },
    { name: 'elevationPolicy', run: (pipe) => pipe.writeElevationPolicy('ask'), key: 'elevationPolicy' },
    { name: 'scopes', run: (pipe) => pipe.writeScope(3306, 'lan'), key: 'scopes' },
    // 008 T3.1 追加、009 T2.3 补进本表：写通道凭据走**同一个** `write()` 单键 patch 路径
    // （它不是执行/提权入口；`forbidden` 那条断言与「写配置零提权调用」都**未**被削弱）。
    { name: 'writeToken', run: (pipe) => pipe.writeWriteToken('t'), key: 'writeToken' },
    // 014：第七个写方法（自动刷新频次）—— 同样是单键 patch，不碰执行器。
    { name: 'refreshIntervalSec', run: (pipe) => pipe.writeRefreshInterval(15), key: 'refreshIntervalSec' },
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

test('009 缺陷 2：取不到 revision 时第三个实参**仍要占位**（宿主按实参个数校验）', async () => {
  const fake = fakeSettings({}, { omitRevision: true });
  await createSettingsPipe(() => fake.service).writeDistro('Debian');
  assert.equal(fake.updates.length, 1);
  assert.equal(fake.updates[0]?.argCount, 3, `update 的实参个数必须恰好 3，实际 ${String(fake.updates[0]?.argCount)}`);
  assert.equal(fake.updates[0]?.revision, undefined, '取不到 revision 就传 undefined（不伪造一个数字）');
  console.log(
    `  · 扫了 1 次 update：实参个数 ${String(fake.updates[0]?.argCount)}，revision=${JSON.stringify(fake.updates[0]?.revision)}（显式 undefined 合法且等价于无条件写）`,
  );
});

/**
 * 缺陷 2 的**反例台架**：宿主 `prepareInvocation` 数的是实参**个数**
 * （`values.length !== expected` ⇒ 抛 `client api: <endpoint> expected <n> argument(s), got <m>`）。
 * 下面这个 fake 就按那条规则写 —— 修前的两参写法在它面前**必失败**。
 * 009 收口轮 T3 起 `mutate` 也按同一条规则校验（两个 endpoint 的 codec 一致）。
 */
function hostStrictSettings(): { readonly service: RemoteSettingsLike; readonly attempts: () => number; readonly mutates: () => number } {
  let attempts = 0;
  let mutates = 0;
  const service: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => ({
      ok: true,
      value: { namespaces: [{ ns: SETTINGS_NAMESPACE, revision: 9, value: {} }] },
    }),
    update: async (...args: unknown[]): Promise<SettingsResponse> => {
      attempts += 1;
      if (args.length !== 3) throw new Error(`client api: settings/update expected 3 argument(s), got ${String(args.length)}`);
      return { ok: true, value: {} };
    },
    mutate: async (...args: unknown[]): Promise<SettingsResponse> => {
      mutates += 1;
      if (args.length !== 3) throw new Error(`client api: settings/mutate expected 3 argument(s), got ${String(args.length)}`);
      return { ok: true, value: { namespaces: [{ ns: SETTINGS_NAMESPACE, value: {}, secrets: [{ path: ['writeToken'], set: false }] }] } };
    },
  };
  return { service, attempts: () => attempts, mutates: () => mutates };
}

test('009 缺陷 2 反例：修前的两参写法在宿主实参校验下当场抛（= 真机那句错）', async () => {
  const strict = hostStrictSettings();
  let thrown = '';
  try {
    await strict.service.update(SETTINGS_NAMESPACE, { distro: 'Debian' });
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  assert.match(thrown, /expected 3 argument\(s\), got 2/u, `反例必须复现真机错误，实际「${thrown}」`);
  assert.equal(strict.attempts(), 1);
  console.log(`  · 反例扫了 1 次两参调用：${thrown}`);
});

test('009 缺陷 2：新管道在同一份宿主校验下成功（恰好 3 实参、带 revision）', async () => {
  const strict = hostStrictSettings();
  const result = await createSettingsPipe(() => strict.service).writeDistro('Debian');
  assert.equal(result.ok, true, result.message);
  assert.equal(result.revisionPassed, true);
  assert.equal(strict.attempts(), 1);
  console.log('  · 扫了 1 次三参调用：宿主严格校验下不抛，写入 ok:true');
});

test('009 缺陷 4：update 抛错 ⇒ 管道**不抛**，返回 ok:false + 可读原因（只尝试 1 次）', async () => {
  let attempts = 0;
  const service: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => ({ ok: true, value: { namespaces: [{ ns: SETTINGS_NAMESPACE, revision: 3, value: {} }] } }),
    update: async (): Promise<SettingsResponse> => {
      attempts += 1;
      throw new Error('client api: settings/update expected 3 argument(s), got 2');
    },
    mutate: mutateNotExpected(),
  };
  const result = await createSettingsPipe(() => service).writeManagedPorts(['3306']);
  assert.equal(result.ok, false);
  assert.match(result.message, /expected 3 argument\(s\), got 2/u, '原因必须原样透出，否则页面无从提示');
  assert.match(result.message, /不重试/u);
  assert.equal(attempts, 1, '不得重试');
  console.log(`  · 扫了 1 次抛错写入：ok=false / attempts=${String(attempts)} / 「${result.message}」`);
});

test('009 缺陷 4：describe 抛错同样化成可读结果（不抛、不计 update）', async () => {
  let updates = 0;
  const service: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => {
      throw new Error('remote 挂了');
    },
    update: async (): Promise<SettingsResponse> => {
      updates += 1;
      return { ok: true, value: {} };
    },
    mutate: mutateNotExpected(),
  };
  const pipe = createSettingsPipe(() => service);
  const result = await pipe.writeDistro('X');
  assert.equal(result.ok, false);
  assert.match(result.message, /remote 挂了/u);
  assert.equal(updates, 0, '读都失败，绝不许发出写请求');
  assert.equal(pipe.updateCount(), 0, '未发出 update ⇒ 计数必须为 0');
  console.log(`  · 扫了 1 次读失败写入：${result.message}；update 调用 ${String(updates)} 次`);
});

test('T5.7 写回：remote.settings 缺失 ⇒ ok:false + 文案，不抛异常', async () => {
  const pipe = createSettingsPipe(() => undefined);
  const result = await pipe.writeManagedPorts(['3306']);
  assert.equal(result.ok, false);
  assert.match(result.message, /remote\.settings/u);
  assert.equal(pipe.updateCount(), 0, '服务缺失时不得计入 update');
  const read = await pipe.readConfig();
  // 014：读回形状**新增一个数值字段** `refreshIntervalSec`（缺省 0 = 关闭）——
  // 监听地址仍**不**在这里回填（走快照，保持单一来源）；频次必须回填，否则刷新页面后选择器丢档。
  assert.deepEqual(read, { managedPorts: [], distro: undefined, elevationPolicy: undefined, scopes: {}, writeTokenConfigured: false, refreshIntervalSec: 0 });
  console.log(`  · 扫了 2 个调用（写/读），均降级返回，updateCount=${String(pipe.updateCount())}`);
});

test('T5.7 写回：update 失败 ⇒ ok:false 并原样带回错误文案', async () => {
  const service: RemoteSettingsLike = {
    describe: async () => ({ ok: true, value: { revision: 1, namespaces: [] } }),
    update: async () => ({ ok: false, error: 'revision 冲突' }),
    mutate: mutateNotExpected(),
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

test('T2.3 读回：writeToken **只**化成布尔（值本体不出管道，页面无从回显）', async () => {
  const TOKEN = 'f'.repeat(64);
  const configured = fakeSettings({ writeToken: TOKEN });
  const view = await createSettingsPipe(() => configured.service).readConfig();
  assert.equal(view.writeTokenConfigured, true, '非空 writeToken ⇒ 已配置');
  assert.equal(JSON.stringify(view).includes(TOKEN), false, '读回结果里不得出现凭据本体');
  assert.equal(Object.keys(view).includes('writeToken'), false, '键名只能是 writeTokenConfigured，不得是 writeToken');

  const blank = fakeSettings({ writeToken: '   ' });
  assert.equal((await createSettingsPipe(() => blank.service).readConfig()).writeTokenConfigured, false, '空白串算「未配置」（与 write-auth 的 trim 口径一致）');
  const absent = fakeSettings({});
  assert.equal((await createSettingsPipe(() => absent.service).readConfig()).writeTokenConfigured, false, '字段缺失 ⇒ 未配置');
  const wrongType = fakeSettings({ writeToken: 42 });
  assert.equal((await createSettingsPipe(() => wrongType.service).readConfig()).writeTokenConfigured, false, '非字符串 ⇒ 未配置（不猜）');
  console.log('  · 扫了 4 种配置形态：true / 空白 false / 缺失 false / 非字符串 false；凭据本体 0 次出现在读回结果里');
});

test('009 订正：`writeToken` 标了 `role(secret)` ⇒ 「已配置」改从 `secrets[]` 读（value 里已没有它）', async () => {
  const TOKEN = 'e'.repeat(64);
  /** 宿主 `describe()` 的真实出口形状：`{ ns, value, secrets }`（`redactSecrets: true` 的产物） */
  const service = (secrets: unknown): RemoteSettingsLike => ({
    describe: async (): Promise<SettingsResponse> => ({
      ok: true,
      value: { revision: 3, namespaces: [{ ns: SETTINGS_NAMESPACE, value: { distro: 'Ubuntu2204', elevationPolicy: 'ask' }, secrets }] },
    }),
    update: async (): Promise<SettingsResponse> => ({ ok: true, value: {} }),
    mutate: mutateNotExpected(),
  });
  const read = (secrets: unknown) => createSettingsPipe(() => service(secrets)).readConfig();

  const configured = await read([{ path: ['writeToken'], set: true }]);
  assert.equal(configured.writeTokenConfigured, true, 'secrets.set=true ⇒ 已配置（凭据本体在 value 里根本不存在）');
  assert.equal(configured.distro, 'Ubuntu2204', '同一份 describe 里别的字段照旧读得到');
  assert.equal((await read([{ path: ['writeToken'], set: false }])).writeTokenConfigured, false, 'secrets.set=false ⇒ 未配置');
  assert.equal(
    (await read([{ path: ['other'], set: true }, { path: ['writeToken', 'inner'], set: true }])).writeTokenConfigured,
    false,
    '只看**本字段**（path 末段 === writeToken）的 set：别的 secret 位置与子路径都不算',
  );
  assert.equal((await read(undefined)).writeTokenConfigured, false, '没有 secrets 数组 ⇒ 未配置（不猜）');
  assert.equal(JSON.stringify(configured).includes(TOKEN), false, '读回结果里不得出现凭据本体');
  // ✅ 009 收口轮 T3：修前这里记的是「已知不一致（清除写空串 ⇒ 宿主 `walk()` 对空串仍判 set:true）」，
  // 根因与修法见 `UNSET_WRITE_TOKEN_OPS`；**读侧的形状判据不受影响**（远端本来就看不到值）⇒ 保留这一条。
  assert.equal((await read([{ path: ['writeToken'], set: true }])).writeTokenConfigured, true, 'secrets.set=true 一律算已配置（位图只说「有没有值」）');
  console.log('  · 扫了 5 种 secrets 形态：true / false / 他字段+子路径 false / 无数组 false / set:true 仍 true');
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

test('T5.7 管道面收窄：settings 管道只暴露 10 个方法，没有任何「执行/提权」入口', () => {
  const pipe = createSettingsPipe(() => undefined);
  const keys = Object.keys(pipe).sort();
  // 008 T3.1 追加第 6 个：`writeWriteToken` —— 它是**配置写入**（与服务端 config 的 writeToken 同一个字段），
  // 不是执行/提权入口；下面的 forbidden 断言（写配置零提权调用）仍是这条判据的真正红线。
  // 009 收口轮 T3 追加第 8 个：`clearWriteToken` —— 同样是**配置写入**（宿主 `mutate` 的 unset），
  // 它连「值」这个参数都没有（零凭据字节出门），更不是执行入口。
  // 012 A 计划追加第 9 个：`writeListenAddress` —— 同样是**配置写入**（listenAddresses[端口]），
  // 只收地址字符串，不碰任何执行器；它换来的计划仍由服务端重新算并从候选清单复核。
  // 014 追加第 10 个：`writeRefreshInterval` —— 只写一个数字（0/15/30/60/300），不启动定时器。
  assert.deepEqual(keys, ['clearWriteToken', 'readConfig', 'updateCount', 'writeDistro', 'writeElevationPolicy', 'writeListenAddress', 'writeManagedPorts', 'writeRefreshInterval', 'writeScope', 'writeWriteToken']);
  const forbidden = ['run', 'invoke', 'exec', 'elevate', 'spawn'];
  assert.deepEqual(forbidden.filter((key) => key in pipe), [], '配置管道不得带执行入口');
  console.log(`  · 扫了 ${String(keys.length)} 个方法名：${JSON.stringify(keys)}；执行入口 0 个`);
});
