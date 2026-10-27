/**
 * 009 收口轮 **T3** 的离线门禁：用**宿主的真函数**证明「清除凭据」必须走 `mutate` 的 `unset`
 *
 * ## 判据（全部二值，全部跑宿主原文函数）
 *
 * 1. 🔴 **修前做法当场判「已配置」**（= 真机症状）：把 `writeToken` 写成**空串**后，
 *    宿主 `walk()` 的 `set: value !== void 0`（`lib/index.js:24-29`）照样给 `true`
 *    ⇒ `redactSecrets()` 出 `set:true` ⇒ 喂进**客户端真 `readConfig()`** 得
 *    `writeTokenConfigured === true` ⇒ 重载页面显示「已配置」，而写通道实际 401。
 *    👉 **这就是「两态不一致」的机器证据**，不是我的推断。
 * 2. 🔴 **修后做法当场判「未配置」**：同一条链路上把 `UNSET_WRITE_TOKEN_OPS`（产品代码真发出去的那条常量）
 *    喂给宿主真 `applyPathOp` ⇒ 该键被 `Reflect.deleteProperty` **删掉** ⇒ `set:false`
 *    ⇒ 真 `readConfig()` 得 `writeTokenConfigured === false`。
 * 3. 🔴 **反向对照（防恒假/恒真）**：同一次 `applyPathOp` 的 `set` op 仍能把值写回去（`set:true`）；
 *    对**别家字段**的 `unset` 不得动到 `writeToken`。
 * 4. 🔴 **同源**：判据里用的那条 op **就是**产品常量 `UNSET_WRITE_TOKEN_OPS[0]`（引用相等 ⇒
 *    「验过的」与「发出去的」是同一份，不存在两套口径）。
 *
 * ## 拿不到宿主产物时
 *
 * 🔴 **skip 并打印每个锚点的原因**（`config-gate.test.ts` 同一口径）：不造假判定、不用自写语义顶替。
 * 「宿主不在盘上」与「判定不通过」是两件不同的事，不许混成一条。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Config } from '../../src/config.ts';
import type { SchemaFactory } from 'dsh-wsl-docker-core';
import { SETTINGS_NAMESPACE, UNSET_WRITE_TOKEN_OPS, createSettingsPipe } from '../../src/client/settings-pipe.ts';
import type { RemoteSettingsLike, SettingsPathOp, SettingsResponse } from '../../src/client/host.ts';
import { HOST_FUNCTIONS, loadHostGate } from '../helpers/host-gate.ts';

const loaded = loadHostGate();

/** 有值 / 空串 / 键不存在 —— 三种「配置里 writeToken 那一格」的形态 */
const TOKEN = 'tk-009-t3-2f9c41';
const CONFIGURED = { managedPorts: ['3306'], distro: 'Ubuntu2204', writeToken: TOKEN };
const BLANK = { ...CONFIGURED, writeToken: '' };

/** 把宿主 `redactSecrets` 的输出（`{value, secrets}`）包成 `describe()` 的出口形状 */
function describeLike(redacted: { readonly value: unknown; readonly secrets: readonly { readonly path: readonly string[]; readonly set: boolean }[] }): SettingsResponse {
  return { ok: true, value: { revision: 7, namespaces: [{ ns: SETTINGS_NAMESPACE, value: redacted.value, secrets: redacted.secrets }] } };
}

/** 只实现 `describe`：本用例只用**读**侧（写侧由宿主的 `applyPathOp` 原文负责） */
function readOnly(described: SettingsResponse): RemoteSettingsLike {
  return {
    describe: async (): Promise<SettingsResponse> => described,
    update: async (): Promise<SettingsResponse> => Promise.reject(new Error('本用例不该走 update')),
    mutate: async (): Promise<SettingsResponse> => Promise.reject(new Error('本用例不该走 mutate（宿主那一步由 applyPathOp 原文代替）')),
  };
}

test('009 T3：宿主真函数证明「写空串 ≠ 清除」（修前症状）+ `unset` 才是真删（修后）', async (t) => {
  if (loaded.gate === null) {
    const reasons = loaded.attempts.map((attempt) => `${attempt.anchor} ⇒ ${attempt.detail}`).join(' / ');
    console.log(`  · 本机找不到宿主 dsh-settings 产物 ⇒ **本判据无法离线判定**（不造假判定）。候选锚点：${reasons}`);
    t.skip('宿主 dsh-settings 产物不在本机可读路径上');
    return;
  }
  const { gate } = loaded;
  assert.notEqual(Config, undefined, '本包 Config 必须是真 schema');
  const form = gate.volatileForm(Config);
  assert.notEqual(form, undefined, 'Config 必须过 volatileForm 门（否则命名空间根本不出现，本用例的读侧就无从谈起）');
  console.log(`  · 宿主产物：${gate.file}`);
  for (const slice of gate.slices) {
    console.log(`  · 对照表 | ${slice.name.padEnd(14)} | 宿主 L${String(slice.from)}-L${String(slice.to)} | ${String(slice.bytes)} B（**原文切片，未转写**）`);
  }
  const factory = gate.z as unknown as SchemaFactory;

  // ── ① 修前做法：写空串 ⇒ 宿主仍判「已配置」 ⇒ 客户端真 readConfig() 报 true ──────────────
  const blankRedacted = gate.redactSecrets(form, BLANK);
  assert.deepEqual(
    blankRedacted.secrets.map((secret) => ({ path: [...secret.path], set: secret.set })),
    [{ path: ['writeToken'], set: true }],
    '🔴 空串在宿主判据 `set: value !== void 0` 下**仍算已配置**（这就是 T3 的根因）',
  );
  const blankView = await createSettingsPipe(() => readOnly(describeLike(blankRedacted))).readConfig();
  assert.equal(blankView.writeTokenConfigured, true, '🔴 修前症状（机器证据）：清除后重载页面会显示「已配置」，而写通道 401');
  assert.equal(JSON.stringify(blankRedacted.value).includes(TOKEN), false, '空串形态下整份 value 里也绝不能出现旧凭据本体');

  // ── ② 修后做法：`unset` ⇒ 键真的没了 ⇒ 客户端真 readConfig() 报 false ────────────────────
  const op = UNSET_WRITE_TOKEN_OPS[0];
  assert.equal(op, UNSET_WRITE_TOKEN_OPS[0], 'op 必须是产品常量的那一份（引用相等）');
  const afterUnset = gate.applyPathOp(BLANK, op as SettingsPathOp, form);
  assert.equal(Object.hasOwn(afterUnset, 'writeToken'), false, '🔴 宿主 `applyPathOp` 的 unset 是 `Reflect.deleteProperty` ⇒ 键**消失**（不是写成空串）');
  assert.equal(afterUnset['managedPorts'], BLANK.managedPorts, 'unset 只动这一格：别的字段逐字不变');
  const unsetRedacted = gate.redactSecrets(form, afterUnset);
  assert.deepEqual(unsetRedacted.secrets.map((secret) => secret.set), [false], '🔴 键删掉之后 `set` 才是 false');
  const unsetView = await createSettingsPipe(() => readOnly(describeLike(unsetRedacted))).readConfig();
  assert.equal(unsetView.writeTokenConfigured, false, '🔴 修后：重载页面读出来是「未配置」，与写通道实际状态一致');
  console.log('  · 同一条读链路（宿主 redactSecrets → 客户端真 readConfig）：空串 ⇒ true（错）；unset ⇒ false（对）');

  // ── ③ 反向对照：判据既不恒真也不恒假 ─────────────────────────────────────────────────
  const restored = gate.applyPathOp(afterUnset, { op: 'set', path: ['writeToken'], value: TOKEN }, form);
  assert.equal(restored['writeToken'], TOKEN, '同一条路径上的 `set` 仍能写值（⇒ 上面的 false 不是「这条路根本不工作」）');
  assert.deepEqual(gate.redactSecrets(form, restored).secrets.map((secret) => secret.set), [true], 'set 回去之后仍判已配置');
  const others = gate.applyPathOp(CONFIGURED, { op: 'unset', path: ['distro'] }, form);
  assert.equal(Object.hasOwn(others, 'distro'), false, 'unset 对别家字段生效（证明路径参数真被用上）');
  assert.equal(others['writeToken'], TOKEN, '🔴 清 distro **不得**连带清掉凭据（路径必须逐字命中 writeToken）');
  const empty = gate.applyPathOp({}, op as SettingsPathOp, form);
  assert.deepEqual(empty, {}, '对空配置 unset 是幂等空操作（不抛、不造出多余的键）');
  const withoutSecret = { managedPorts: ['3306'] };
  assert.deepEqual(gate.applyPathOp(withoutSecret, op as SettingsPathOp, form), withoutSecret, '本来就没这一格 ⇒ 逐字不变（幂等）');
  console.log('  · 反向对照：set 能写回（true）/ unset 他字段不碰凭据 / 空对象 unset 幂等 ✅');

  // ── ④ 凭据本体零外泄：三种形态的 value 序列化里都没有真值 ─────────────────────────────
  for (const [label, value] of [['有值', CONFIGURED], ['空串', BLANK], ['无键', withoutSecret]] as const) {
    const redacted = gate.redactSecrets(form, value);
    assert.equal(Object.hasOwn(redacted.value as Record<string, unknown>, 'writeToken'), false, `${label}：secret 字段必须从 value 里摘掉`);
  }
  const factoryProbe = factory.object({ writeToken: factory.string() });
  assert.equal(gate.isPlainObject(factoryProbe), false, '宿主 isPlainObject 对 schema 实例判 false（切片真的是宿主那个函数，不是「什么都 true」的替身）');
  assert.equal(gate.isPlainObject({}), true, '宿主 isPlainObject 对平凡对象判 true');
  assert.equal(gate.member({ a: 1 }, 'a'), 1, '宿主 member 能取到自有成员（切片可用）');
  console.log(`  · 切了 ${String(HOST_FUNCTIONS.length)} 个宿主函数：${gate.slices.map((slice) => slice.name).join('/')}`);
  console.log('  · 三种形态的 describe().value 里都 0 处凭据本体 ✅');
});
