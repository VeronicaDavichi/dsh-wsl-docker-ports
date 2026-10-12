/**
 * 008 T2.5：写通道执行层的**回滚面**（`node --test`，**零真机、零真实进程、零写盘**）
 *
 * —— 2026-10-12 从 `transport-apply.test.ts` 拆出（拆前该文件 `split('\n')` = **748**，超 SHALL 400）。
 * 切面 = **「失败了怎么办」**：只回滚本轮刚加的规则 vs **什么都不回滚**（防误删他人规则）。
 * 共用台架 = [`./transport-apply-rig.ts`](./transport-apply-rig.ts)；🔴 **用例零删减、零改名**（拆前 16 条 = 拆后 16 条）。
 *
 * | 用例 | 判据 |
 * | --- | --- |
 * | ⑤ 回滚 | 执行失败 ⇒ 第二次调用是 `remove`，**他人规则一条不动**、条数回到执行前 |
 * | ⑥ 不回滚 | 什么都没写（UAC 被拒）⇒ **不做任何回滚**（防误删） |
 *
 * 回滚判据完全依赖 005 的前后快照 ⇒ 「删得对」这件事是被**结构**证明的，不是被用例凑出来的。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { failure } from '../helpers/fake-executor.ts';
import { OTHER, PORT, TARGET, createRig, planOk, reportOf, ticketOf } from './transport-apply-rig.ts';

test('T2.5 ⑤ 执行失败 ⇒ 只回滚**本轮刚加的**规则：他人规则一条不动、条数回到执行前', async () => {
  const rig = createRig({ failAdd: true });
  const response = await planOk(rig);
  const before = [...rig.rules];

  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId: response.planId, confirmed: true, origin: 'user', ticket: ticketOf(response) }),
  );

  assert.equal(report.status, 'partial', 'portproxy 成功 + 防火墙失败 ⇒ partial');
  assert.equal(report.failed.length, 1);
  assert.match(String(report.failed[0]?.reason), /放行失败/u);
  assert.deepEqual(report.executed, ['portproxy-add']);
  assert.deepEqual(report.skipped, [], '防火墙那步报了失败 ⇒ 不算「跳过」');

  assert.equal(rig.fake.calls.length, 2, '一次执行 + 一次回滚');
  const rollback = rig.fake.calls[1];
  const rollbackArgv = rollback?.argv.join(' ') ?? '';
  assert.match(rollbackArgv, /-Action['",\s]+remove/u, '回滚必须走 remove（不是第二次 add）');
  assert.match(rollbackArgv, new RegExp(`-Port['",\\s]+${String(PORT)}`, 'u'));
  assert.equal(new RegExp(String(OTHER), 'u').test(rollbackArgv), false, '🔴 回滚命令里不许出现别人的端口');

  assert.deepEqual(rig.rules, before, '系统规则逐字节回到执行前（他人一条不动 + 本轮加的已删）');
  assert.equal(rig.rules.length, before.length);
  assert.deepEqual(report.rolledBack, [{ port: PORT, listenAddress: '0.0.0.0', ok: true, message: report.rolledBack[0]?.message ?? '' }]);

  const record = rig.audit.tail(1)[0];
  assert.equal(rig.audit.size(), 1, '失败也要留一条审计（这是真发生过的动作）');
  assert.equal(record?.result, 'failed');
  assert.equal(record?.rolledBack, true);
});

test('T2.5 ⑥ 什么都没写（UAC 被拒 / 脚本没跑起来）⇒ **不做任何回滚**（防误删他人规则）', async () => {
  const rig = createRig({
    respond: () => failure('NonZeroExit', { exitCode: 1, stderr: 'The operation was canceled by the user' }),
  });
  const response = await planOk(rig);
  const before = [...rig.rules];

  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId: response.planId, confirmed: true, origin: 'user', ticket: ticketOf(response) }),
  );

  assert.equal(report.status, 'cancelled');
  assert.equal(rig.fake.calls.length, 1, '🔴 只许有那一次尝试：没有回滚命令');
  assert.deepEqual(report.rolledBack, [], '没有半成品可回滚 ⇒ 清单为空');
  assert.deepEqual(rig.rules, before, '系统状态与执行前逐字节一致');
  assert.equal(rig.audit.tail(1)[0]?.result, 'failed', '尝试过但失败 ⇒ 审计记 failed');
});
