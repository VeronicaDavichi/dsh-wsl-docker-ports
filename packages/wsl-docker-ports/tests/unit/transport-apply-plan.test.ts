/**
 * 008 T2.2 / T2.4：写通道执行层的**计划面与票据门**（`node --test`，**零真机、零真实进程、零写盘**）
 *
 * —— 2026-10-12 从 `transport-apply.test.ts` 拆出（拆前该文件 `split('\n')` = **748**，超 SHALL 400）。
 * 切面 = **「还没真执行」的那一半**：票据门 / 确认门 / 幂等（计划阶段被拦）/ 旧票作废。
 * 共用台架 = [`./transport-apply-rig.ts`](./transport-apply-rig.ts)（`createRig` / `planOk` / `ticketOf` …）；
 * 🔴 **用例零删减、零改名**（拆前 16 条 = 拆后 16 条）。
 *
 * | 用例 | 判据 |
 * | --- | --- |
 * | ① 票据门 | 无票 / 错票 / 未知 / 过期 **四种可区分**拒绝 ⇒ 零执行 + 零写入 + 零审计 |
 * | ② 确认门 | `confirmed !== true` / 畸形 body / 篡改 target ⇒ 零执行 + 零审计（**不吃掉票据**）|
 * | ⑦ 幂等 | 同目标第二次 ⇒ 计划阶段被拦（无票据）⇒ 零执行、零重复规则、审计不增 |
 * | ⑧ 旧票作废 | 同一 `planId` 重复规划 ⇒ 旧票 `mismatch`、新票可用 |
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlanChannel } from '../../src/transport/plan.ts';
import type { PlanResponse } from '../../src/transport/plan.ts';
import { GSUDO_CHOICE } from '../helpers/fake-elevation.ts';
import { OTHER, PORT, TARGET, TARGET_LOOPBACK, createRig, foreignRule, planOk, refusalOf, reportOf, ticketOf } from './transport-apply-rig.ts';

test('T2.2 ① 票据门四态：无票 / 错票 / 从未签发 / 过期 ⇒ 四种可区分拒绝 + 零执行 + 零写入 + 零审计', async () => {
  const rig = createRig();
  const response = await planOk(rig);
  const { planId } = response;
  const valid = ticketOf(response);
  assert.match(valid, /^tk-\d+$/u);
  assert.equal(response.confirm?.expiresAt, rig.clock.value + 60_000, '票据必须带过期的绝对时刻（客户端可据此提示）');

  // (a) 缺票据
  const missing = refusalOf(await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: '' }));
  assert.equal(missing.code, 'confirm-required');
  assert.match(missing.message, /缺确认票据/u);

  // (b) 错票（票据与这份计划不匹配）—— confirm.ts 的语义是 mismatch **不消费**真票
  const wrong = refusalOf(await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: 'tk-不是这张' }));
  assert.equal(wrong.code, 'plan-mismatch');
  assert.match(wrong.message, /票据与本次计划不匹配/u);

  // (c) 从未为**这份计划**签发过（另一个 plan 通道没装票据注册表 ⇒ 它的 planId 在注册表里查不到）
  const orphan = createPlanChannel(rig.facts);
  const orphaned = await orphan(TARGET_LOOPBACK);
  assert.equal(orphaned.ok, true);
  const unknownPlan = orphaned.payload as PlanResponse;
  assert.equal(unknownPlan.confirm, null, '没装票据注册表 ⇒ 不签发');
  assert.notEqual(unknownPlan.planId, null, '它本身仍是一份可执行的计划（loopback 也要显式规则）');
  const unknown = refusalOf(
    await rig.applyChannel({ target: TARGET_LOOPBACK, planId: unknownPlan.planId, confirmed: true, origin: 'user', ticket: 'tk-1' }),
  );
  assert.equal(unknown.code, 'confirm-required');
  assert.match(unknown.message, /没有为这份计划签发过票据/u);

  // (d) 过期（TTL 内签发、推进时钟后使用）
  rig.clock.value = (response.confirm?.expiresAt ?? 0) + 1;
  const expired = refusalOf(await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: valid }));
  assert.equal(expired.code, 'confirm-required');
  assert.match(expired.message, /已过期/u);

  // 🔴 四种拒绝共用一条红线：零提权、零写入、零审计
  assert.equal(rig.fake.calls.length, 0, '假执行器一次都不许被调用（零提权 = 零进程）');
  assert.deepEqual(rig.rules, [foreignRule()], '系统规则逐字节等于执行前');
  assert.equal(rig.audit.size(), 0, '被拒绝的 apply 不写审计（什么都没发生）');
  assert.deepEqual(rig.lines, [], '审计环的 sink 也没有任何一行');
});

test('T2.2 ② 确认门：未确认 / 畸形 body / 篡改目标 ⇒ 零执行零审计，且**不吃掉票据**', async () => {
  const rig = createRig();
  const response = await planOk(rig);
  const { planId } = response;
  const valid = ticketOf(response);

  const unconfirmed = refusalOf(await rig.applyChannel({ target: TARGET, planId, confirmed: false, origin: 'user', ticket: valid }));
  assert.equal(unconfirmed.code, 'confirm-required');
  assert.match(unconfirmed.message, /未确认/u);

  const malformed = refusalOf(
    await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: valid, problem: '请求体不是合法 JSON' }),
  );
  assert.equal(malformed.code, 'confirm-required');
  assert.match(malformed.message, /不是合法 JSON/u);

  // 篡改 scope ⇒ 重算的 planId 与带来的不一致（票据是给 lan 那份签的）
  const tampered = refusalOf(
    await rig.applyChannel({ target: { action: 'add', ports: [PORT], scope: 'loopback' }, planId, confirmed: true, origin: 'user', ticket: valid }),
  );
  assert.equal(tampered.code, 'plan-mismatch');
  assert.match(tampered.message, /planId 与本次重算不一致/u);

  // 篡改到集合外端口 ⇒ 计划阶段就被拦（无 planId）
  const outOfScope = refusalOf(
    await rig.applyChannel({ target: { action: 'add', ports: [OTHER], scope: 'lan' }, planId, confirmed: true, origin: 'user', ticket: valid }),
  );
  assert.equal(outOfScope.code, 'plan-mismatch');

  assert.equal(rig.fake.calls.length, 0, '四次拒绝：零提权');
  assert.equal(rig.audit.size(), 0, '四次拒绝：零审计');
  assert.deepEqual(rig.rules, [foreignRule()]);

  // 🔴 「拒绝不吃票据」：原票仍然可用 ⇒ 紧接着一次合法 apply 必须真执行
  const report = reportOf(await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: valid }));
  assert.equal(report.status, 'ok');
  assert.equal(rig.fake.calls.length, 1, '合法票据才真执行（一次）');
  assert.equal(rig.audit.size(), 1);
});

test('T2.4 ⑦ 幂等：同目标第二次 ⇒ 计划阶段被拦（无票据）⇒ 零执行、零重复规则、审计不增', async () => {
  const rig = createRig({ probe: GSUDO_CHOICE });
  const first = await planOk(rig);
  reportOf(await rig.applyChannel({ target: TARGET, planId: first.planId, confirmed: true, origin: 'user', ticket: ticketOf(first) }));
  const afterFirst = [...rig.rules];
  assert.equal(afterFirst.length, 2, '他人一条 + 本项目一条');

  const second = await planOk(rig);
  assert.equal(second.ready, false, '同端口已有自己的规则 ⇒ add 被拦成 state-precondition');
  assert.equal(second.planId, null, '被拦下 ⇒ 没有 planId');
  assert.equal(second.confirm, null, '没有 planId ⇒ 不签发票据（等价于「没有可执行的动作」）');

  const again = refusalOf(
    await rig.applyChannel({ target: TARGET, planId: first.planId, confirmed: true, origin: 'user', ticket: 'tk-1' }),
  );
  assert.equal(again.code, 'plan-mismatch', '第二次 apply 连票据门都到不了（计划已不可执行）');
  assert.equal(rig.fake.calls.length, 1, '🔴 第二次零执行');
  assert.deepEqual(rig.rules, afterFirst, '🔴 没有重复规则、也没有动别人');
  assert.equal(rig.audit.size(), 1, '被拒绝的 apply 不写审计');
});

test('T2.2 ⑧ 同一 planId 重复规划 ⇒ 旧票即刻作废（新票可用；旧票 mismatch 且零执行）', async () => {
  const rig = createRig();
  const first = await planOk(rig);
  const oldTicket = ticketOf(first);
  const again = await planOk(rig);
  assert.equal(again.planId, first.planId, 'planId 只由「事实 + 目标」决定（同一事实 ⇒ 同一指纹）');
  const newTicket = ticketOf(again);
  assert.notEqual(newTicket, oldTicket, '重规划签发新票（design §14：同一 planId 重复规划 ⇒ 旧票作废）');

  const stale = refusalOf(
    await rig.applyChannel({ target: TARGET, planId: first.planId, confirmed: true, origin: 'user', ticket: oldTicket }),
  );
  assert.equal(stale.code, 'plan-mismatch');
  assert.equal(rig.fake.calls.length, 0, '旧票：零执行');
  assert.deepEqual(rig.rules, [foreignRule()]);
  assert.equal(rig.audit.size(), 0);

  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId: again.planId, confirmed: true, origin: 'user', ticket: newTicket }),
  );
  assert.equal(report.status, 'ok', '新票照常可用（旧票作废不牵连新票）');
  assert.equal(rig.fake.calls.length, 1);
});
