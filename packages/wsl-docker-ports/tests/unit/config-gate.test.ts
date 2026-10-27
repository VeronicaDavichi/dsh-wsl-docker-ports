/**
 * 009 缺陷 1 的**离线门禁**（Task C）：用**宿主的真 `volatileForm`** 判我们自己的 `Config`
 *
 * 判据（全部二值）：
 * 1. 🔴 **真函数来源可追溯**：切出来的每个宿主函数都报出自己在宿主产物里的**行号区间**
 *    （「逐行对照表」= 宿主原文，不是我重写的语义）；
 * 2. 🔴 `volatileForm(Config) !== undefined` —— 这就是 `describe()` 会不会收下本命名空间的那道门；
 * 3. 🔴 **同一份判定必须能证伪**：零 volatile 的 schema（`z.object({ a: z.string() })`）判 `undefined`
 *    ⇒ 判据不是恒真；我们**改造前的**字段集（同样零 volatile）也当场判 `undefined`；
 * 4. 🔴 `describe()` 出口的形状：`redactSecrets(form, value)` 必须把 `writeToken` 从 `value` 里摘掉、
 *    只在 `secrets: [{ path: ['writeToken'], set }]` 里留布尔（009 REQ-1.3 的结构性保证）。
 *
 * 🔴 **拿不到宿主产物 ⇒ 本文件 skip 并打印每个锚点的原因**（不造假判定、不用自写语义顶替）。
 * 「宿主不在盘上」与「判定不通过」是两件不同的事，不许混成一条。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Config, PORTS_CONFIG_FIELDS, createPortsSchema } from '../../src/config.ts';
import type { SchemaFactory } from 'dsh-wsl-docker-core';
import { HOST_FUNCTIONS, loadHostGate, hostSettingsCandidates } from '../helpers/host-gate.ts';

const loaded = loadHostGate();

test('009 Task C：宿主真 `volatileForm` 判本包 `Config` —— 命名空间门（含反例）', (t) => {
  if (loaded.gate === null) {
    const reasons = loaded.attempts.map((attempt) => `${attempt.anchor} ⇒ ${attempt.detail}`).join(' / ');
    console.log(`  · 本机找不到宿主 dsh-settings 产物 ⇒ **本判据无法离线判定**（不造假判定）。候选锚点：${reasons}`);
    t.skip('宿主 dsh-settings 产物不在本机可读路径上');
    return;
  }
  const { gate } = loaded;
  assert.notEqual(Config, undefined, '本包 Config 必须是真 schema（拿不到宿主 schemastery 时另有诊断用例负责报原话）');

  console.log(`  · 宿主产物：${gate.file}`);
  for (const slice of gate.slices) {
    console.log(`  · 对照表 | ${slice.name.padEnd(14)} | 宿主 L${String(slice.from)}-L${String(slice.to)} | ${String(slice.bytes)} B（**原文切片，未转写**）`);
  }

  const form = gate.volatileForm(Config);
  assert.notEqual(form, undefined, '🔴 volatileForm(Config) 必须是 schema：零 volatile ⇒ 整个命名空间在 describe() 里消失（缺陷 1 的真正根因）');
  assert.deepEqual(Object.keys(form?.dict ?? {}), [...PORTS_CONFIG_FIELDS], '门收下的可编辑字段必须恰好是这五个（少一个 ⇒ 客户端读/写不到；多一个 ⇒ 声明了没人用的字段）');
  console.log(`  · volatileForm(Config) = object，字段 ${Object.keys(form?.dict ?? {}).join('/')} ⇒ 门 ✅`);

  // 🔴 反例 1：零 volatile 的 hand-made schema（证明判据不是恒真）；用**宿主产物自己的** schemastery（同版本）
  const factory = gate.z as unknown as SchemaFactory;
  const zero = factory.object({ distro: factory.string() });
  assert.equal(gate.volatileForm(zero), undefined, '零 volatile 的 schema 必须判 undefined（否则本判据恒真、什么也证不了）');
  // 🔴 反例 2：**改造前**的字段集（同样零 volatile）—— 这一份就是真机上「命名空间消失」的那份声明
  const before = factory.object({
    managedPorts: factory.array(factory.string()),
    scopes: typeof factory.dict === 'function' ? factory.dict(factory.string()) : factory.any(),
    distro: factory.string(),
    elevationPolicy: factory.string(),
    writeToken: factory.string(),
  });
  assert.equal(gate.volatileForm(before), undefined, '改造前那份声明（`896fa42` 的字段集）必须判 undefined —— 与真机 describe 里没有本命名空间一致');
  const after = createPortsSchema(factory);
  assert.notEqual(gate.volatileForm(after), undefined, '同一份字段集加上 volatile 之后必须过门（差异只有 volatile 一处 ⇒ 因果干净）');
  console.log('  · 反例：零 volatile（手工一份 + 改造前字段集）都判 undefined，改造后过门 ⇒ 判据可证伪 ✅');

  // 🔴 describe() 出口形状：凭据必须被摘掉、只在 secrets 里留布尔
  const value = { managedPorts: ['3306'], scopes: { '3306': 'lan' }, distro: 'Ubuntu2204', elevationPolicy: 'ask', writeToken: 'super-secret-value' };
  const redacted = gate.redactSecrets(form, value);
  const visible = redacted.value as Record<string, unknown>;
  assert.equal(Object.hasOwn(visible, 'writeToken'), false, '🔴 role(secret) 字段必须从 describe().value 里消失（否则凭据明文发给浏览器）');
  assert.equal(JSON.stringify(redacted.value).includes('super-secret-value'), false, '整份 value 序列化后不得出现凭据本体');
  assert.deepEqual(redacted.secrets.map((secret) => ({ path: [...secret.path], set: secret.set })), [{ path: ['writeToken'], set: true }], 'secrets 里必须恰有 writeToken 的位置 + set 布尔（客户端「已配置」的唯一权威来源）');
  const empty = gate.redactSecrets(form, { ...value, writeToken: undefined });
  assert.deepEqual(empty.secrets.map((secret) => secret.set), [false], '未配置 ⇒ set: false（客户端据此显示「未配置」）');
  console.log(`  · describe 出口：value 里可见字段 ${Object.keys(visible).join('/')}；secrets=${JSON.stringify(redacted.secrets)} ⇒ 凭据不回显 ✅`);
  console.log(`  · 切了 ${String(HOST_FUNCTIONS.length)} 个宿主函数：${gate.slices.map((slice) => slice.name).join('/')}`);
  console.log(`  · 宿主候选锚点共 ${String(hostSettingsCandidates().length)} 个（首个命中即用；全部失败时的原因会打印在上面）`);
});
