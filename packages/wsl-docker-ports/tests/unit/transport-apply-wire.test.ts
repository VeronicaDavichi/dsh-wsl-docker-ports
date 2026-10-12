/**
 * 008 T2.2 / T2.9：写通道执行层的**接线面**（`node --test`，**零真机、零真实进程、零写盘**）
 *
 * —— 2026-10-12 从 `transport-apply.test.ts` 拆出（拆前该文件 `split('\n')` = **748**，超 SHALL 400）。
 * 切面 = **HTTP 往返**：证明 `wire-plugin` 里 plan 与 apply 用的是**同一个**票据注册表；
 * 以及「没给执行器 ⇒ 不接线」的降级形态。共用台架 = [`./transport-apply-rig.ts`](./transport-apply-rig.ts)
 * （HTTP 最小宿主面 `fakeSurface` / `fakeCtx` / `roundTrip` 也在那里）；🔴 **用例零删减、零改名**（拆前 16 条 = 拆后 16 条）。
 *
 * | 用例 | 判据 |
 * | --- | --- |
 * | ⑨ 接线 | HTTP 往返：`/write/plan` 签发的票据能被 `/write/apply` 消费（wire-plugin 同实例）|
 * | ⑩ 降级 | 没给执行器 ⇒ `apply` 不接线（503「写执行尚未接线」），不假装能写 |
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { WRITE_APPLY_PATH, WRITE_PLAN_PATH } from '../../src/transport/constants.ts';
import { attachWriteChannel } from '../../src/transport/wire-plugin.ts';
import { GSUDO_CHOICE } from '../helpers/fake-elevation.ts';
import { TARGET, WRITE_TOKEN, createRig, fakeCtx, fakeSurface, roundTrip } from './transport-apply-rig.ts';

test('T2.2 ⑨ HTTP 往返：/write/plan 签发的票据能被 /write/apply 消费并真执行（wire-plugin 同实例）', async () => {
  const rig = createRig({ probe: GSUDO_CHOICE });
  const fake = fakeSurface();
  const handle = attachWriteChannel(fakeCtx(fake.surface), rig.facts, rig.fake.executor, rig.elevationDeps, WRITE_TOKEN);
  // 🔴 attachWriteChannel 自己造审计环与票据注册表 ⇒ 本用例断言「plan 签的票 = apply 认的票」
  assert.equal(handle.writeRoute.registered, true);
  assert.equal(handle.writeRoute.authConfigured, true, 'T2.9：凭据已配 ⇒ 带对凭据的请求正常走票据门');
  assert.equal(handle.tickets.size(), 0, '装载期不签发任何票据');
  assert.equal(rig.fake.calls.length, 0, '装载期零外部命令');

  const planned = await roundTrip(fake.routes, WRITE_PLAN_PATH, JSON.stringify(TARGET));
  assert.equal(planned.status, 200);
  const confirm = planned.payload['confirm'] as { ticket?: string; expiresAt?: number } | null;
  assert.notEqual(confirm, null, 'HTTP 层也要签发票据');
  assert.equal(handle.tickets.size(), 1, '票据落在 wire-plugin 的注册表里（同一个实例）');
  assert.equal(rig.fake.calls.length, 0, '计划是只读的：一条命令都不跑');

  const applied = await roundTrip(
    fake.routes,
    WRITE_APPLY_PATH,
    JSON.stringify({ target: TARGET, planId: planned.payload['planId'], confirmed: true, origin: 'user', ticket: confirm?.ticket }),
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.payload['status'], 'ok');
  assert.equal(rig.fake.calls.length, 1, 'HTTP 往返真的把命令下发到了执行器');
  assert.equal(handle.tickets.size(), 0, '票据一次性：用过即消失');
  assert.equal(handle.audit.size(), 1, 'HTTP 往返产生了 1 条审计');

  // 重放同一张票：注册表里已没有它，且目标此刻已由「本插件规则存在」被拦 ⇒ 两条路都拒
  const replay = await roundTrip(
    fake.routes,
    WRITE_APPLY_PATH,
    JSON.stringify({ target: TARGET, planId: planned.payload['planId'], confirmed: true, origin: 'user', ticket: confirm?.ticket }),
  );
  assert.equal(replay.status, 409, '重放必须被拒（计划已不可执行；票也已消费）');
  assert.equal(rig.fake.calls.length, 1, '重放零执行');
});

test('T2.2 ⑩ 没给执行器 ⇒ apply 不接线：503 + 「写执行尚未接线」，零执行零审计', async () => {
  const fake = fakeSurface();
  const handle = attachWriteChannel(fakeCtx(fake.surface), createRig().facts, undefined, undefined, WRITE_TOKEN);
  const planned = await roundTrip(fake.routes, WRITE_PLAN_PATH, JSON.stringify(TARGET));
  const out = await roundTrip(fake.routes, WRITE_APPLY_PATH, JSON.stringify({ target: TARGET, planId: planned.payload['planId'], confirmed: true, ticket: 'tk-1' }));

  assert.equal(out.status, 503);
  assert.match(String((out.payload['error'] as { message?: string } | undefined)?.message), /写执行尚未接线/u);
  assert.equal(handle.audit.size(), 0);
});
