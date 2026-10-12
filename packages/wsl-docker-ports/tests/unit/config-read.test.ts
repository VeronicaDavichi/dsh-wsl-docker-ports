/**
 * 009 缺陷 1 的**第二层**判据：volatile 活体包装 vs 平凡对象，**每种行为逐项相同**（Task B-2）
 *
 * ## 为什么必须逐项比（而不是「活体那条过了就算」）
 *
 * 修缺陷 1 之后，宿主交给 `apply` 的 config 是「深冻结的活体包装」，而单测/集成方/手工传参给的
 * 是平凡对象。两套读法一定会分叉，而分叉的后果正是缺陷 1 的第二层陷阱：
 * 包装被当值读 ⇒ 提权档判不出 `ask`（落 `none`，永远写不动）、凭据不是字符串（**永久 401**）。
 * ⇒ 本文件的判据形式统一是「**两种形态的输出必须 `deepEqual`**」，且每一对都配一个**真值**断言
 * （否则「两边都是 undefined」也会被 deepEqual 判过 —— 那是假绿）。
 *
 * ## 六个消费点（覆盖 008/009 的全部读侧）
 *
 * 1. `config-read.ts` 的四个读取面（`distro` / `elevationPolicy` / `writeToken` / `managedPorts`）；
 * 2. `transport/real-facts.ts` 的**提权档判决**（`createPlanFacts(...).elevation()` ⇒ `policy: 'ask'`）；
 * 3. `transport/write-auth.ts` 的**写通道判决**（凭据正确 ⇒ `ok:true`，**不出现 401**）；
 * 4. 客户端**所有权声明**（`createDeclarationReader` ⇒ `isManagedPort(ports, 43312)`）；
 * 5. 类型错/空白/抛异常的**降级**（非串 ⇒ `undefined`、空白 ⇒ 未配置、`get()` 抛 ⇒ 当取不到）；
 * 6. 🔴 **live 轮换**：改一次底层值，两种形态的**下一个**读者都必须看到新值（否则就是「拍在注册期」
 *    ⇒ 凭据轮换后永久 401、配置页改成 `none` 而执行层仍按 `ask`）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createHostConfigReaders, readConfigToken, unwrapConfigStringArray } from '../../src/config-read.ts';
import { Config } from '../../src/config.ts';
import { createWriteAuthenticator } from '../../src/transport/write-auth.ts';
import { createPlanFacts, readElevationPolicy } from '../../src/transport/real-facts.ts';
import { createDeclarationReader } from '../../src/client/write-channel.ts';
import { createSettingsPipe, SETTINGS_NAMESPACE } from '../../src/client/settings-pipe.ts';
import type { RemoteSettingsLike, SettingsResponse } from '../../src/client/host.ts';
import { isManagedPort } from '../../src/diff/managed-ports.ts';
import type { ManagedPorts } from '../../src/diff/managed-ports.ts';
import { loadHostGate } from '../helpers/host-gate.ts';

/** 活体包装替身：与宿主 `createVolatile` 同形（对象 + `.get()` 现读）——**每次 `.get()` 都重新读底层** */
function liveRef<T>(read: () => T): { readonly get: () => T } {
  return Object.freeze({ get: read });
}

/** 一份可变的「配置文档」，两种形态都指向它 ⇒ 轮换时两边同时变（这正是 volatile 原地更新的形状） */
function makeConfig(): {
  readonly state: { distro?: unknown; elevationPolicy?: unknown; writeToken?: unknown; managedPorts?: unknown; scopes?: unknown };
  readonly wrap: Record<string, unknown>;
  readonly plain: Record<string, unknown>;
  readonly getter: () => { readonly distro: unknown; readonly elevationPolicy: unknown; readonly writeToken: unknown; readonly managedPorts: unknown };
} {
  const state = {
    distro: 'Ubuntu2204' as unknown,
    elevationPolicy: 'ask' as unknown,
    writeToken: 'tw-43312-secret' as unknown,
    managedPorts: ['43312'] as unknown,
    scopes: { '43312': 'lan' } as unknown,
  };
  return {
    state,
    // 活体包装形态：宿主 `resolve` 的输出（字段是 ref，属性读拿到的是对象）
    wrap: {
      distro: liveRef(() => state.distro),
      elevationPolicy: liveRef(() => state.elevationPolicy),
      writeToken: liveRef(() => state.writeToken),
      managedPorts: liveRef(() => state.managedPorts),
      scopes: liveRef(() => state.scopes),
    },
    // 平凡形态：单测/集成方/手工传参
    plain: state,
    getter: () => state,
  };
}

test('009 缺陷 1 第二层：四个读取面在「活体包装 / 平凡对象 / 取值函数」三种形态下逐项相同', () => {
  const config = makeConfig();
  const forms: readonly (readonly [string, unknown])[] = [
    ['活体包装（宿主 resolve 的输出）', config.wrap],
    ['平凡对象（手工传参）', config.plain],
    ['零参取值函数（plugin.ts 透传的形态）', config.getter],
  ];
  const outputs = forms.map(([label, form]) => {
    const readers = createHostConfigReaders(form);
    const read = { distro: readers.distro(), elevationPolicy: readers.elevationPolicy(), writeToken: readers.writeToken(), managedPorts: [...readers.managedPorts()] };
    console.log(`  · ${label} ⇒ ${JSON.stringify(read)}`);
    return read;
  });
  for (const output of outputs) {
    assert.deepEqual(output, { distro: 'Ubuntu2204', elevationPolicy: 'ask', writeToken: 'tw-43312-secret', managedPorts: ['43312'] }, '三种形态的读值必须相同，且必须是**真值**（不是三份 undefined 互相相等）');
  }
  assert.deepEqual(outputs[0], outputs[1], '活体包装 == 平凡对象');
  assert.deepEqual(outputs[0], outputs[2], '活体包装 == 取值函数');
  // 直接属性读的反例：包装形态下 `config.writeToken` 不是字符串 ⇒ 这就是第二层陷阱的现场
  assert.equal(typeof config.wrap['writeToken'], 'object', '直接属性读拿到的是包装对象（不是凭据）⇒ 旧读法必然永久 401');
  assert.equal(config.wrap['writeToken'] === config.state.writeToken, false, '包装 ≠ 值（旧读法与正确读法在这里分叉）');
});

test('009 缺陷 1 第二层：提权档判决 —— 三种形态初始都判 `ask`；两个**活体**形态随轮换即时变化', async () => {
  const config = makeConfig();
  const factsOf = (form: unknown) => createPlanFacts({
    rules: () => Promise.resolve([]),
    eth0Ip: () => Promise.resolve('172.20.201.152'),
    elevationPolicy: form,
  });
  // 🔴 传进去的是**字段来源**（活体包装 / 零参取值函数 / 平凡值），不是整个 config 对象
  const liveRefForm = factsOf(config.wrap['elevationPolicy']);
  const fnForm = factsOf(() => config.state.elevationPolicy);
  const valueForm = factsOf(config.state.elevationPolicy);
  for (const [label, facts] of [['活体包装', liveRefForm], ['零参取值函数', fnForm], ['平凡值', valueForm]] as const) {
    assert.equal((await facts.elevation()).policy, 'ask', `${label}：配置里写着 ask ⇒ 事实面必须是 ask（包装当值读会落 unknown ⇒ 执行层再落 none ⇒ 永远写不动）`);
    console.log(`  · ${label}：policy = ${(await facts.elevation()).policy} ✅`);
  }

  config.state.elevationPolicy = 'none';
  assert.equal((await liveRefForm.elevation()).policy, 'none', '🔴 live 轮换（活体包装）：宿主原地更新后，下一次计划必须看到 none（拍在构造期就看不到）');
  assert.equal((await fnForm.elevation()).policy, 'none', '🔴 live 轮换（取值函数）：同上');
  assert.equal((await valueForm.elevation()).policy, 'ask', '平凡值形态是**快照**（值不可能自更新）—— 生产上 `plugin.ts` 传的是函数，这里如实钉住差异');

  config.state.elevationPolicy = 'bogus';
  assert.equal((await liveRefForm.elevation()).policy, 'unknown', '认不出的值 ⇒ unknown（不假装知道用户选了什么）');
  assert.equal((await fnForm.elevation()).policy, 'unknown', '两种活体形态一致');
  assert.equal(readElevationPolicy(config.wrap['elevationPolicy']), 'unknown', '单点读法同口径');
  config.state.elevationPolicy = 'ask';
});

test('009 缺陷 1 第二层：写通道判决 —— 两种形态都通过（**无 401**），错误/缺失凭据仍 401，轮换即时生效', () => {
  const config = makeConfig();
  const cases: readonly (readonly [string, unknown])[] = [
    ['活体包装', config.wrap['writeToken']],
    ['平凡对象', config.getter().writeToken],
    ['零参取值函数', () => config.state.writeToken],
  ];
  for (const [label, form] of cases) {
    const auth = createWriteAuthenticator(form);
    assert.equal(auth.configured, true, `${label}：凭据已配置`);
    const ok = auth.authorize({ url: '/dsh-wsl-docker-ports/write/plan?token=tw-43312-secret' });
    assert.deepEqual(ok, { ok: true, presented: true }, `${label}：正确凭据必须放行（**不出现 401**）`);
    const bearer = auth.authorize({ url: '/x', headers: { authorization: 'Bearer tw-43312-secret' } });
    assert.equal(bearer.ok, true, `${label}：Authorization: Bearer 同样放行`);
    const wrong = auth.authorize({ url: '/x?token=nope' });
    assert.equal(wrong.ok, false, `${label}：错误凭据必须 401`);
    assert.equal(wrong.ok === false ? wrong.code : '', 'unauthorized', '401 的码不变');
    const missing = auth.authorize({ url: '/x' });
    assert.equal(missing.ok, false, `${label}：不带凭据必须 401（fail-safe 的既有语义不许放松）`);
    console.log(`  · ${label}：configured=${String(auth.configured)} 正确凭据 ⇒ ok；错/缺 ⇒ 401`);
  }

  // 🔴 live 轮换：这是「每次请求现读」的可证伪判据
  const auth = createWriteAuthenticator(config.wrap['writeToken']);
  config.state.writeToken = 'tw-rotated';
  assert.equal(auth.authorize({ url: '/x?token=tw-rotated' }).ok, true, '轮换后**新**凭据必须立刻可用（否则就是永久 401）');
  assert.equal(auth.authorize({ url: '/x?token=tw-43312-secret' }).ok, false, '轮换后**旧**凭据必须失效');
  // 清空 ⇒ 回到 fail-safe（`configured` 是 getter，不是注册期快照）
  config.state.writeToken = '   ';
  assert.equal(auth.configured, false, '凭据清空/纯空白 ⇒ configured 立刻翻 false');
  assert.equal(auth.authorize({ url: '/x?token=tw-rotated' }).ok, false, '未配置 ⇒ 一切写请求 401（fail-safe 不收松）');
  config.state.writeToken = 'tw-43312-secret';
});

test('009 缺陷 1 第二层：降级口径 —— 非串/空白/抛异常都不许把坏值当成有效配置', () => {
  assert.equal(readConfigToken(liveRef(() => 42)), undefined, '数字不是凭据');
  assert.equal(readConfigToken({ get: () => { throw new Error('ref 已经失效'); } }), undefined, '`.get()` 抛 ⇒ 当取不到（装载期不许炸）');
  assert.equal(readConfigToken(liveRef(() => '  ')), undefined, '纯空白 = 未配置（与 write-auth 的 trim 口径一致）');
  assert.equal(readConfigToken(liveRef(() => '  spaced-token  ')), 'spaced-token', '前后空白被 trim');
  assert.deepEqual(unwrapConfigStringArray(liveRef(() => ['43312', 42, null])), ['43312'], '非串成员被剔除（声明恒空是安全降级）');
  assert.deepEqual(unwrapConfigStringArray(liveRef(() => ({ 43312: true }))), [], '非数组 ⇒ 空集（不是「把对象的键当端口」）');
  const readers = createHostConfigReaders(undefined);
  assert.deepEqual(
    { distro: readers.distro(), policy: readers.elevationPolicy(), token: readers.writeToken(), ports: [...readers.managedPorts()] },
    { distro: undefined, policy: undefined, token: undefined, ports: [] },
    'config 整个缺失（降级路径）⇒ 四项都取不到（凭据 ⇒ 未配置 ⇒ 401）',
  );
  console.log('  · 降级：数字 / 抛异常 / 空白 ⇒ 未配置；非串成员与非法形状被剔除；undefined config ⇒ 四项皆空');
});

test('009 缺陷 1 第二层：所有权声明 —— 两种形态都让 `declaration` 含 43312（客户端解析器同一条）', async () => {
  const config = makeConfig();
  // 客户端读的是 `RemoteSettings.describe()` 的 `value`（**平凡 JSON**）：这里用宿主真函数把两种
  // 形态各自投影成 describe 出口的形状（`projectForm(form, plainConfig(config))`），再走客户端真路径。
  const gate = loadHostGate().gate;
  const declarationOf = async (declare: readonly string[]) : Promise<ManagedPorts> => {
    const service: RemoteSettingsLike = {
      describe: (): Promise<SettingsResponse> => Promise.resolve({ ok: true, value: { namespaces: [{ ns: SETTINGS_NAMESPACE, value: { managedPorts: [...declare] } }] } }),
      update: (): Promise<SettingsResponse> => Promise.resolve({ ok: true, value: { namespaces: [] } }),
      mutate: (): Promise<SettingsResponse> => Promise.reject(new Error('本用例不该走 mutate')),
    };
    const outcome = await createDeclarationReader(createSettingsPipe(() => service))();
    assert.equal(outcome.ok, true, '声明读取必须成功（解析器与客户端同一条）');
    return outcome.ok ? outcome.ports : [];
  };

  for (const [label, form] of [['活体包装', config.wrap], ['平凡对象', config.plain]] as const) {
    const read = createHostConfigReaders(form).managedPorts();
    assert.deepEqual([...read], ['43312'], `${label}：读取面给出 ['43312']`);
    const ports = await declarationOf(read);
    assert.equal(isManagedPort(ports, 43312), true, `${label}：声明必须含 43312（含 ⇒ 该端口归本插件所有）`);
    assert.equal(isManagedPort(ports, 3306), false, `${label}：未声明的端口**不得**被判为归本插件所有`);
    console.log(`  · ${label}：declaration = ${JSON.stringify(ports)} ⇒ 43312 ✅ / 3306 ❌`);
  }

  if (gate === null) {
    console.log('  · 宿主 dsh-settings 不在盘上 ⇒ 「describe 出口投影」这一环**本轮无法离线验**（如实报出，不造假）');
    return;
  }
  // 🔴 把「宿主 resolve 的活体 config」与「客户端拿到的 JSON」连起来：用宿主自己的两个函数投影。
  // 这一环刻意用**宿主 cosmokit 的真引用**（`createVolatile` + `updateVolatile`，就是 `_commitVolatile()`
  // 用的那对）：自己仿的 `{ get }` 过不了 `isVolatile`，`plainConfig` 不认 ⇒ 投影链就假了。
  const formSchema = gate.volatileForm(Config);
  assert.notEqual(formSchema, undefined, '门必须先过（`config-gate.test.ts` 专证）');
  const { createVolatile, updateVolatile, isVolatile } = gate.refs;
  const realLive = {
    distro: createVolatile('Ubuntu2204'),
    elevationPolicy: createVolatile('ask'),
    writeToken: createVolatile('tw-43312-secret'),
    managedPorts: createVolatile(['43312']),
    scopes: createVolatile({}),
  };
  assert.equal(isVolatile(realLive.writeToken), true, '宿主 `isVolatile` 必须认这个引用（否则后面全是假证）');
  assert.deepEqual(createHostConfigReaders(realLive).managedPorts(), ['43312'], '真引用的读取面同样给出声明');
  assert.equal(createHostConfigReaders(realLive).writeToken(), 'tw-43312-secret', '真引用解包出凭据');
  for (const [label, form] of [['真活体引用（宿主 createVolatile）', realLive], ['平凡对象', config.plain]] as const) {
    const projected = gate.projectForm(formSchema, gate.plainConfig(form)) as Record<string, unknown>;
    assert.deepEqual(projected['managedPorts'], ['43312'], `${label}：宿主 describe 出口的投影里 managedPorts 必须是 ['43312']`);
    // `describe()` 出口 = `redactSecrets(form, projectForm(form, plainConfig(config)))`：脱敏在**投影之后**
    const redacted = gate.redactSecrets(formSchema, projected);
    assert.deepEqual(
      Object.keys(redacted.value as Record<string, unknown>).sort(),
      ['distro', 'elevationPolicy', 'managedPorts', 'scopes'],
      `${label}：脱敏后的出口里凭据已被摘掉（writeToken 不在可见字段里）`,
    );
    assert.deepEqual(redacted.secrets.map((secret) => ({ path: [...secret.path], set: secret.set })), [{ path: ['writeToken'], set: true }], `${label}：凭据位置以布尔形式出现在 secrets 里`);
    console.log(`  · ${label}：出口投影 = ${JSON.stringify(redacted.value)}；secrets=${JSON.stringify(redacted.secrets)} ✅`);
  }

  // 🔴 原地更新（`updateVolatile` = 宿主 `_commitVolatile()`）：同一个引用对象、下一个读者看到新值
  const reader = createHostConfigReaders(realLive);
  updateVolatile(realLive.elevationPolicy, createVolatile('none'));
  updateVolatile(realLive.writeToken, createVolatile('tw-rotated'));
  assert.equal(reader.elevationPolicy(), 'none', 'updateVolatile 之后同一个引用读到 none（**不需要重挂载**）');
  assert.equal(reader.writeToken(), 'tw-rotated', 'updateVolatile 之后读到新凭据（轮换即生效的机制证据）');
  assert.equal(createWriteAuthenticator(realLive.writeToken).authorize({ url: '/x?token=tw-rotated' }).ok, true, '真引用轮换后新凭据立即可用');
  assert.equal(createWriteAuthenticator(realLive.writeToken).authorize({ url: '/x?token=tw-43312-secret' }).ok, false, '真引用轮换后旧凭据失效');
  console.log('  · 原地更新（宿主 updateVolatile）：policy none / 新凭据可用 / 旧凭据失效 ⇒ 现读语义 ✅');
});

test('009 缺陷 1 第二层：源码面 —— 入口不再直接属性读配置（一律经读取面，且透传的是**函数**）', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../../src/plugin.ts', import.meta.url), 'utf8');
  const code = text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*'));
    })
    .join('\n');
  const direct = [...code.matchAll(/config\??\.\s*(distro|elevationPolicy|writeToken|managedPorts)\b/gu)].map((match) => match[0]);
  assert.deepEqual(direct, [], `入口里不得再出现直接属性读（包装形态下读到的不是值）：${direct.join(' / ')}`);
  assert.equal(code.includes('createHostConfigReaders(config)'), true, '入口必须经 `createHostConfigReaders(config)` 建读取面');
  assert.match(code, /hostConfig\.writeToken\b/u, '写通道必须拿到 `hostConfig.writeToken`（**现读函数**，不是值）');
  assert.match(code, /hostConfig\.elevationPolicy\b/u, '事实面必须拿到 `hostConfig.elevationPolicy`（现读函数）');
  assert.match(code, /hostConfig\.distro\(\)/u, '`distro` 在解析目标发行版时现读');
  console.log(`  · 扫了 src/plugin.ts（剥注释 ${String(code.split('\n').length)} 行）：直接属性读 ${String(direct.length)} 处（要求 0）、读取面接线 4 处 ✅`);
});
