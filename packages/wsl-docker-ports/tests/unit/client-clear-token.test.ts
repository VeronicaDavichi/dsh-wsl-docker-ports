/**
 * 009 收口轮 **T3**：清除凭据（`settings-pipe.clearWriteToken()`）的离线门禁
 * —— 2026-10-12 从 `client-settings.test.ts` 拆出（拆前该文件 `split('\n')` = **432**，超「单文件 ≤ 400 行 SHALL」）
 *
 * 拆的切面 = **「写值的管道」vs「按路径 unset 的管道」**：本文件只管清除（`mutate`）面，
 * 四个写方法（`writeManagedPorts` / `writeDistro` / `writeElevationPolicy` / `writeScope`）、
 * 读回形状、零提权与「只暴露 8 个方法」留在 `client-settings.test.ts`。
 * 🔴 用例**一条没删**（拆前该文件 **19** = 拆后 **15 + 4**）。
 *
 * 三条判据（都可二值判定）：
 * ① 发出去的是**恰好一条** `unset`（ops 逐字 = `UNSET_WRITE_TOKEN_OPS`）、**实参恰好 3 个**、一个字节的凭据值都不发；
 * ② 清除后的布尔取自服务端**写入后的视图**（`set:false` ⇒ `false`；`set:true` ⇒ `true` 反向对照）—— 不是硬编码、不是内存推断；
 * ③ 失败（抛错 / 回执 not ok / 缺服务）⇒ `ok:false` + 布尔 **`null`（不猜）** + 只尝试 1 次 + `updateCount()` 不计。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSettingsPipe, SETTINGS_NAMESPACE, UNSET_WRITE_TOKEN_OPS } from '../../src/client/settings-pipe.ts';
import type { RemoteSettingsLike, SettingsPathOp, SettingsResponse } from '../../src/client/host.ts';

/** 记一次 `mutate`（T3）：ops 逐字记下来 ⇒ 「只发一条 unset」是可断言的同一性 */
interface RecordedMutate {
  readonly ns: string;
  readonly ops: readonly SettingsPathOp[];
  readonly revision: unknown;
  readonly argCount: number;
}

/**
 * 只实现 `describe` / `mutate` 的假件，`update` 一律**抛**：
 * 清除路径**不该**碰「写值」那条路（T3 的判据之一就是 `update` 0 次），真被调到即用例自身写错了。
 */
function mutateNotExpected(): (ns: string, patch: unknown, expectedRevision?: unknown) => Promise<SettingsResponse> {
  return async () => {
    throw new Error('本用例不该走 update（清除只能走 mutate 的 unset）');
  };
}
/** 记一次 `mutate`（T3）：ops 逐字记下来 ⇒ 「只发一条 unset」是可断言的同一性 */
interface RecordedMutate {
  readonly ns: string;
  readonly ops: readonly SettingsPathOp[];
  readonly revision: unknown;
  readonly argCount: number;
}

test('T3 清除：走 `mutate` 的**恰好一条 unset**、实参恰好 3 个，且一个字节的凭据值都不发', async () => {
  const recorded: RecordedMutate[] = [];
  const service: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => ({ ok: true, value: { revision: 11, namespaces: [{ ns: SETTINGS_NAMESPACE, value: {} }] } }),
    update: mutateNotExpected(),
    mutate: async (...args: unknown[]): Promise<SettingsResponse> => {
      recorded.push({ ns: String(args[0]), ops: args[1] as readonly SettingsPathOp[], revision: args[2], argCount: args.length });
      // 宿主 `mutate` 落盘后**重新** describe 的脱敏视图（`dsh-api-settings-controller` 的 `namespaceView`）
      return { ok: true, value: { namespaces: [{ ns: SETTINGS_NAMESPACE, value: {}, secrets: [{ path: ['writeToken'], set: false }] }] } };
    },
  };
  const result = await createSettingsPipe(() => service).clearWriteToken();

  assert.equal(result.ok, true, result.message);
  assert.equal(recorded.length, 1, '清除必须恰好发 1 次 mutate');
  assert.equal(recorded[0]?.argCount, 3, '🔴 实参恰好 3 个（少一个宿主直接抛，修前写空串就是两参的同族缺陷）');
  assert.equal(recorded[0]?.revision, 11, '并发保护：describe 里读到的 revision 必须带上');
  assert.deepEqual(recorded[0]?.ops, UNSET_WRITE_TOKEN_OPS, '🔴 只发常量那一份 ops（引用相等 ⇒ 不可能临时改成 set/空串）');
  assert.equal(recorded[0]?.ops, UNSET_WRITE_TOKEN_OPS, 'ops 必须是同一份冻结常量，不是每次现造的新对象');
  assert.deepEqual(recorded[0]?.ops, [{ op: 'unset', path: ['writeToken'] }], '逐字：unset writeToken');
  assert.equal(result.ops, UNSET_WRITE_TOKEN_OPS, '返回值里的 ops 也是同一份常量（给测试/审计看的就是真发出去的那份）');
  assert.equal('patch' in result, false, '清除不产出 patch —— 「写值」那条路在类型上就不存在');
  // 返回值里出现了**字段名** `writeToken`（那是 ops 的路径，必须出现），但**不得**出现任何凭据值：
  const serialized = JSON.stringify(result);
  assert.equal(/[0-9a-f]{32,}/u.test(serialized), false, '返回值里不得出现任何凭据样值（32+ 连续 hex）');
  assert.equal(serialized.includes('"set":true'), false, '返回值里也不得出现「已配置」的位图（本用例视图是 set:false）');
  console.log(`  · 扫了 1 次清除：mutate 调用 ${String(recorded.length)} 次 / 实参 ${String(recorded[0]?.argCount)} 个 / ops=${JSON.stringify(recorded[0]?.ops)}`);
});

test('T3 清除后布尔取自服务端**写入后的视图**（不是硬编码 false，也不是内存推断）', async () => {
  const withView = (secrets: unknown) => {
    const service: RemoteSettingsLike = {
      describe: async (): Promise<SettingsResponse> => ({ ok: true, value: { revision: 2, namespaces: [{ ns: SETTINGS_NAMESPACE, value: {} }] } }),
      update: mutateNotExpected(),
      mutate: async (): Promise<SettingsResponse> => ({
        ok: true,
        value: { namespaces: [{ ns: SETTINGS_NAMESPACE, value: { distro: 'Ubuntu2204' }, secrets }] },
      }),
    };
    return createSettingsPipe(() => service).clearWriteToken();
  };
  const gone = await withView([{ path: ['writeToken'], set: false }]);
  assert.equal(gone.writeTokenConfigured, false, '写入后视图报 set:false ⇒ 未配置');
  assert.equal(gone.message.includes('unset'), true, '文案要说清是 unset（不是「写成空串」）');
  // 🔴 反例：同一段代码在「视图仍报已配置」时必须报告 true —— 否则上面那条只是恒真
  const inherited = await withView([{ path: ['writeToken'], set: true }]);
  assert.equal(inherited.writeTokenConfigured, true, '视图仍报 set:true（值来自更外层配置）⇒ 必须如实显示「仍已配置」，不许一律报 false');
  assert.match(inherited.message, /更外层配置/u, '这种情况要给得出原因，不然用户会以为清除坏了');
  console.log('  · 扫了 2 种写入后视图：set:false ⇒ 未配置 / set:true（继承值）⇒ 仍已配置（布尔随视图走，非硬编码）');
});

test('T3 清除失败（mutate 抛错 / 回执 not ok）⇒ ok:false、布尔 null（不猜）、只尝试 1 次', async () => {
  let attempts = 0;
  const throwing: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => ({ ok: true, value: { revision: 4, namespaces: [] } }),
    update: mutateNotExpected(),
    mutate: async (...args: unknown[]): Promise<SettingsResponse> => {
      attempts += 1;
      if (args.length !== 3) throw new Error(`client api: settings/mutate expected 3 argument(s), got ${String(args.length)}`);
      throw new Error('宿主拒绝：Config field "writeToken" is not volatile');
    },
  };
  const pipe = createSettingsPipe(() => throwing);
  const failed = await pipe.clearWriteToken();
  assert.equal(failed.ok, false);
  assert.equal(failed.writeTokenConfigured, null, '没拿到写入后视图 ⇒ 必须 null（不猜），否则页面会显示错的布尔');
  assert.equal(failed.revisionPassed, true);
  assert.match(failed.message, /is not volatile/u, '宿主原话必须透出（可读原因，不静默）');
  assert.equal(attempts, 1, '🔴 不重试');
  assert.equal(pipe.updateCount(), 0, '清除走 mutate ⇒ `update` 计数保持 0（两个口径不混）');

  const refused: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => ({ ok: true, value: { revision: 4, namespaces: [] } }),
    update: mutateNotExpected(),
    mutate: async (): Promise<SettingsResponse> => ({ ok: false, error: 'settings-conflict' }),
  };
  const second = await createSettingsPipe(() => refused).clearWriteToken();
  assert.equal(second.ok, false);
  assert.equal(second.writeTokenConfigured, null);
  assert.match(second.message, /settings-conflict/u);
  console.log(`  · 扫了 2 条清除失败路径：抛错（attempts=${String(attempts)}）/ 回执 settings-conflict；两者布尔均 null`);
});

test('T3 清除：`remote.settings` 缺失 ⇒ 明确失败且**不猜**布尔（不用写空串顶替）', async () => {
  const pipe = createSettingsPipe(() => undefined);
  const result = await pipe.clearWriteToken();
  assert.equal(result.ok, false);
  assert.match(result.message, /remote\.settings/u);
  assert.equal(result.writeTokenConfigured, null);
  assert.deepEqual(result.ops, [{ op: 'unset', path: ['writeToken'] }], '即使没服务，报出来的 ops 仍是那条 unset（不是空串 patch）');
  assert.equal(pipe.updateCount(), 0);
  console.log(`  · 扫了 1 条缺服务路径：${result.message}`);
});
