/**
 * T2.4 策略门 + 三条清理路径 + 任务日志；T2.5 来源约束
 *
 * 全部走注入的 fake（**零真机**：不点 UAC、不起进程、不冷启动 WSL）。`executor` 调用数在这里
 * 等价于「发起了几次提权」—— `none` 策略要求它是 **0**，`ask` 被拒要求它也是 **0**。
 *
 * 三条后端的**调用形态**与退出码/UAC 分支在 `elevate-exec.test.ts`。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { singlePort } from '../../src/diff/managed-ports.ts';
import { parsePortproxyTable, type PortproxyRule } from 'dsh-wsl-docker-core';
import { runElevate } from '../../src/elevate/runner.ts';
import { buildWritePlan } from '../../src/write/plan.ts';
import type { WritePlan } from '../../src/write/types.ts';
import { fixtureText } from '../helpers/fake-executor.ts';
import { expectPlan } from '../helpers/expect-plan.ts';
import { rule, ruleToEth0 } from '../helpers/factories.ts';
import {
  createElevateHarness,
  elevationRequest,
  NATIVE_CHOICE,
  okPayload,
  planForPort,
  STUB_OUT_PATH,
  STUB_SCRIPT_PATH,
} from '../helpers/fake-elevation.ts';

const ACTUAL_SET: readonly PortproxyRule[] = parsePortproxyTable(fixtureText('netsh-portproxy-v4tov4.raw'));

test('T2.4 策略 none：零提权、零快照、零临时文件（默认策略就是最保守）', async () => {
  const harness = createElevateHarness();

  const result = await runElevate(elevationRequest('none', 'user'), harness.deps);

  assert.equal(result.status, 'disabled');
  assert.equal(harness.fake.calls.length, 0, 'none 策略下 executor 调用数必须是 0');
  assert.equal(harness.fs.writes.length, 0);
  assert.deepEqual(harness.events, []);
  assert.match(result.message, /不执行任何需要提权的操作/);
});

test('T2.4 空步骤的规划：不发起提权（前置不满足时规划层已给出零动作）', async () => {
  const harness = createElevateHarness();
  const empty = expectPlan(
    buildWritePlan({
      action: 'add',
      port: 5000,
      scope: 'loopback',
      managedPorts: [singlePort(5000)],
      eth0Ip: '172.20.201.152',
      rules: [],
      localhostForwarding: true,
    }),
  );

  const result = await runElevate(elevationRequest('passby', 'user', empty), harness.deps);

  assert.equal(result.status, 'no-actions');
  assert.equal(harness.fake.calls.length, 0);
});

test('T2.4 ask + 用户取消：零进程、零文件、不做任何回滚', async () => {
  const harness = createElevateHarness({ confirm: false });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'declined');
  assert.equal(harness.fake.calls.length, 0);
  assert.equal(harness.fs.writes.length, 0);
  assert.equal(harness.confirmCalls.length, 1);
  assert.equal(harness.confirmCalls[0]?.reason, 'policy-ask');
  assert.match(result.hint, /未做任何改动/);
});

test('T2.4 ask 但没有任何确认通道 ⇒ 按拒绝处理（没有闸门就不提权）', async () => {
  const harness = createElevateHarness({ confirmAbsent: true });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'declined');
  assert.equal(harness.fake.calls.length, 0);
});

test('T2.4 ask 的确认请求必须展示命令原文与逐步动作（REQ-3.2）', async () => {
  const harness = createElevateHarness({ confirm: true });

  await runElevate(elevationRequest('ask', 'user'), harness.deps);

  const confirm = harness.confirmCalls[0];
  assert.ok(confirm !== undefined);
  assert.match(confirm.commandText, /netsh interface portproxy add v4tov4 listenport=5000/);
  assert.match(confirm.commandText, /listenaddress=0\.0\.0\.0/);
  assert.equal(confirm.steps.length, 2);
  assert.equal(confirm.port, 5000);
});

test('T2.4 成功路径：一次提权 + 前后两次快照 + 两个临时文件都清理 + 四项日志', async () => {
  const harness = createElevateHarness({ confirm: true });
  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'ok');
  assert.equal(result.exitCode, 0);
  assert.equal(harness.fake.calls.length, 1, '只发起一次提权（不重复弹 UAC）');
  assert.deepEqual(harness.events, ['confirm', 'snapshot', 'exec', 'snapshot'], '顺序：先确认，再快照，再执行，再快照');
  assert.deepEqual(result.cleanup, { scriptRemoved: true, outRemoved: true });
  assert.deepEqual(harness.fs.removes, [STUB_SCRIPT_PATH, STUB_OUT_PATH]);
  assert.equal(harness.snapshotCount(), 2);
  assert.ok(result.log !== null);
  assert.deepEqual(Object.keys(result.log).sort(), ['action', 'after', 'before', 'exitCode', 'port', 'stdout']);
});

test('T2.4 执行前快照失败 ⇒ 直接中止：不提权、不写临时文件（拿不到基准就不动手）', async () => {
  const harness = createElevateHarness({
    confirm: true,
    before: { ok: false, reason: 'exec-failed', message: 'netsh 挂了', hint: '重试' },
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'snapshot-failed');
  assert.equal(harness.fake.calls.length, 0);
  assert.equal(harness.fs.writes.length, 0);
  assert.match(result.message, /执行前的实际集快照失败/);
});

test('T2.4 执行后快照失败 ⇒ 已下发但无法自证：如实报出（退出码保留、日志不造假）', async () => {
  const harness = createElevateHarness({
    confirm: true,
    after: { ok: false, reason: 'parse-error', message: '输出读不懂', hint: '手工核对' },
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'snapshot-failed');
  assert.equal(result.exitCode, 0, '写操作确实下发了，退出码不能丢');
  assert.equal(result.log, null, '拿不到 after 就不许拼一份假日志');
  assert.deepEqual(result.cleanup, { scriptRemoved: true, outRemoved: true });
});

test('T2.4 [C-3 红线] 他人规则变了 ⇒ 就算退出码 0 也按失败上报（并给出差异）', async () => {
  const tampered: readonly PortproxyRule[] = [
    ...ACTUAL_SET.filter((item) => item.listenPort !== 8080),
    rule('0.0.0.0', 8080, '172.20.201.199', 8080),
  ];
  const harness = createElevateHarness({
    confirm: true,
    before: { ok: true, rules: ACTUAL_SET, argv: [] },
    after: { ok: true, rules: [...tampered, ruleToEth0(6000, '0.0.0.0')], argv: [] },
    respondWith: { payload: okPayload(6000) },
  });

  const result = await runElevate(elevationRequest('ask', 'user', planForPort(6000)), harness.deps);

  assert.equal(result.status, 'failure');
  assert.match(result.message, /他人规则发生了变化/);
  assert.match(result.hint, /差异：/);
  assert.ok(result.log !== null && result.log.before.length === 19 && result.log.after.length === 20);
});

test('T2.4 日志的 before/after 是完整实际集（不是 diff 摘要）', async () => {
  const after: readonly PortproxyRule[] = [...ACTUAL_SET, ruleToEth0(6000, '0.0.0.0')];
  const harness = createElevateHarness({
    confirm: true,
    before: { ok: true, rules: ACTUAL_SET, argv: [] },
    after: { ok: true, rules: after, argv: [] },
    respondWith: { payload: okPayload(6000) },
  });

  const result = await runElevate(elevationRequest('ask', 'user', planForPort(6000)), harness.deps);

  assert.equal(result.status, 'ok');
  assert.equal(result.log?.before.length, 19);
  assert.equal(result.log?.after.length, 20);
  assert.equal(result.log?.port, 6000);
});

test('T2.4 参数校验失败（地址含 `;`）⇒ 连脚本都不生成、零进程零文件', async () => {
  const harness = createElevateHarness({ confirm: true });
  const bad: WritePlan = { ...planForPort(), eth0Ip: '1.2.3.4; calc' };

  const result = await runElevate(elevationRequest('ask', 'user', bad), harness.deps);

  assert.equal(result.status, 'failure');
  assert.match(result.message, /提权参数校验未通过/);
  assert.equal(harness.fake.calls.length, 0);
  assert.equal(harness.fs.writes.length, 0);
});

test('T2.4 临时脚本写不进去 ⇒ 不执行、如实报错', async () => {
  const harness = createElevateHarness({ confirm: true });
  const deps = { ...harness.deps, writeFile: async () => Promise.reject(new Error('EACCES')) };

  const result = await runElevate(elevationRequest('ask', 'user'), deps);

  assert.equal(result.status, 'failure');
  assert.match(result.message, /临时脚本写入失败/);
  assert.equal(harness.fake.calls.length, 0, '脚本写不进去就绝不执行');
});

test('T2.2 回传端口与请求不一致 ⇒ 不采信（防陈旧 out 文件/串话）', async () => {
  const harness = createElevateHarness({
    confirm: true,
    respondWith: { payload: okPayload(5001) },
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'failure');
  assert.match(result.message, /端口是 5001，与请求的 5000 不一致/);
  assert.match(result.hint, /不采信/);
});

test('T2.5 user + passby：不弹应用内确认（只由 UAC 把关），自动执行一次', async () => {
  const harness = createElevateHarness();

  const result = await runElevate(elevationRequest('passby', 'user'), harness.deps);

  assert.equal(result.status, 'ok');
  assert.equal(harness.confirmCalls.length, 0);
  assert.equal(harness.fake.calls.length, 1);
  assert.deepEqual(harness.events, ['snapshot', 'exec', 'snapshot']);
});

test('T2.5 agent + passby：降级为 ask ⇒ 先确认、再执行；确认在提权之前', async () => {
  const harness = createElevateHarness({ confirm: true });

  const result = await runElevate(elevationRequest('passby', 'agent'), harness.deps);

  assert.equal(result.status, 'ok');
  assert.equal(harness.confirmCalls.length, 1);
  assert.equal(harness.confirmCalls[0]?.reason, 'agent-passby-downgraded');
  assert.match(harness.confirmCalls[0]?.message ?? '', /不会静默执行/);
  assert.ok(harness.events.indexOf('confirm') < harness.events.indexOf('exec'));
});

test('T2.5 agent + passby + 确认被拒：一次提权都没有（REQ-4.1 的硬边界）', async () => {
  const harness = createElevateHarness({ confirm: false });

  const result = await runElevate(elevationRequest('passby', 'agent'), harness.deps);

  assert.equal(result.status, 'declined');
  assert.equal(harness.fake.calls.length, 0);
  assert.equal(harness.fs.writes.length, 0);
  assert.match(result.message, /Agent 触发的提权确认被拒/);
});

test('T2.5 agent 在 none/ask 策略下与 user 完全同权（不额外放行、不额外拦截）', async () => {
  const none = createElevateHarness();
  const ask = createElevateHarness({ confirm: false });

  const a = await runElevate(elevationRequest('none', 'agent'), none.deps);
  const b = await runElevate(elevationRequest('ask', 'agent'), ask.deps);

  assert.equal(a.status, 'disabled');
  assert.equal(b.status, 'declined');
  assert.equal(none.fake.calls.length + ask.fake.calls.length, 0);
});

test('T2.4 临时目录与随机段都来自注入点（生产默认值不进单测）', async () => {
  const harness = createElevateHarness({ confirm: true, tempDir: 'D:\\Tmp', suffix: '0011223344ff' });

  await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(harness.fs.writes[0], 'D:\\Tmp\\dsh-ppp-0011223344ff.ps1');
  assert.deepEqual(harness.fs.removes, [
    'D:\\Tmp\\dsh-ppp-0011223344ff.ps1',
    'D:\\Tmp\\dsh-ppp-0011223344ff-out.json',
  ]);
  assert.equal(harness.deps.probeBackend !== undefined, true, '后端探测也是注入点（本用例不该碰 where.exe）');
  assert.equal(NATIVE_CHOICE.backend, 'native');
});
