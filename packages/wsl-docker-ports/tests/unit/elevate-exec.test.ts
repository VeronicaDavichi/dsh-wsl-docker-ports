/**
 * 三条后端的**调用形态** + 退出码 / UAC 分支（T2.2 / T2.3 / T2.4）
 *
 * 拆成独立文件是为了守住「单文件 ≤ 400 行」这条 SHALL；职责也清楚：
 * 这里只问「命令怎么发出去的、回来怎么解释」，策略门与日志在 `elevate-runner.test.ts`。
 *
 * 关键的一条：**拒绝 UAC 时主机侧不做任何回滚**（design §4 末行 —— 什么都没执行 ⇒ 没有可回滚
 * 的东西；`lan` 的半成品防护在脚本内部）。所以被拒时 `executor` 调用数必须是 1，
 * 且那一次调用里不许出现 `portproxy delete`。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_ELEVATE_TIMEOUT_MS } from '../../src/elevate/invoke.ts';
import { runElevate } from '../../src/elevate/runner.ts';
import {
  createElevateHarness,
  elevationRequest,
  GSUDO_CHOICE,
  okPayload,
  partialPayload,
  STUB_OUT_PATH,
  STUB_SCRIPT_PATH,
} from '../helpers/fake-elevation.ts';

const GSUDO_PATH = 'D:\\Program Files\\gsudo\\Current\\gsudo.exe';

test('T2.4 native 后端：argv 是 powershell + Start-Process -Verb RunAs（临时文件回传）', async () => {
  const harness = createElevateHarness({ confirm: true });
  await runElevate(elevationRequest('ask', 'user'), harness.deps);

  const call = harness.fake.calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.file, 'powershell.exe');
  assert.deepEqual(call.argv.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  const payload = call.argv[3] ?? '';
  assert.match(payload, /Start-Process -FilePath 'powershell\.exe'/);
  assert.match(payload, /-Verb RunAs -Wait -PassThru; exit \$p\.ExitCode/);
  assert.ok(payload.includes(STUB_SCRIPT_PATH), `载荷要带脚本路径：${payload}`);
  assert.ok(payload.includes(`'-Out', '${STUB_OUT_PATH}'`));
  assert.ok(payload.includes(`'-Port', '5000'`));
  assert.equal(harness.fs.writes[0], STUB_SCRIPT_PATH, '先写脚本再执行');
  // 清理会把文件删掉，所以查留档：写进去的确实是那份 PowerShell 脚本
  assert.match(harness.fs.contents.get(STUB_SCRIPT_PATH) ?? '', /^param\(/m);
  assert.match(harness.fs.contents.get(STUB_SCRIPT_PATH) ?? '', /ValidateSet\('add', 'remove', 'fix'\)/);
});

test('T2.4 gsudo 后端：stdio 回传即可成功，脚本仍走绝对路径 + 清理', async () => {
  const harness = createElevateHarness({
    confirm: true,
    probe: GSUDO_CHOICE,
    respondWith: { payload: okPayload(5000) },
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'ok');
  assert.equal(result.backend, 'gsudo');
  assert.equal(harness.fake.calls[0]?.file, GSUDO_PATH, '按 where.exe 给出的绝对路径调用');
  assert.deepEqual(harness.fake.calls[0]?.argv.slice(0, 2), ['powershell.exe', '-NoProfile']);
  assert.equal(result.cleanup.scriptRemoved, true);
});

test('T2.4 gsudo 退出码 999 ⇒ 提权失败（不是脚本异常）', async () => {
  const harness = createElevateHarness({
    confirm: true,
    probe: GSUDO_CHOICE,
    respondWith: { exitCode: 999, stderr: 'UAC declined', writeOutFile: false },
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'elevation-failed');
  assert.equal(result.exitCode, 999);
  assert.match(result.message, /gsudo 退出码 999/);
  assert.deepEqual(result.cleanup, { scriptRemoved: true, outRemoved: true });
});

test('T2.3 超时：按失败处理，且两个临时文件照样清理（第一条清理路径）', async () => {
  const harness = createElevateHarness({
    confirm: true,
    timeoutMs: 1_000,
    respond: () => ({ ok: false, code: 'Timeout', message: 'stub:timeout' }),
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'timeout');
  assert.match(result.message, /1000 ms 内没有返回/);
  assert.deepEqual(result.cleanup, { scriptRemoved: true, outRemoved: true });
  assert.deepEqual(harness.fs.removes, [STUB_SCRIPT_PATH, STUB_OUT_PATH]);
});

test('T2.4 默认超时是 90s（design §4：UAC 等待由用户决定，超时按失败处理）', async () => {
  const harness = createElevateHarness({ confirm: true });
  await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(harness.fake.calls[0]?.options.timeoutMs, DEFAULT_ELEVATE_TIMEOUT_MS);
  assert.equal(DEFAULT_ELEVATE_TIMEOUT_MS, 90_000);
});

test('T2.4 提权可执行文件找不到 ⇒ 明确报出，不伪装成脚本失败', async () => {
  const harness = createElevateHarness({
    confirm: true,
    respond: () => ({ ok: false, code: 'CommandNotFound', message: 'stub:missing' }),
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'failure');
  assert.match(result.message, /找不到提权可执行文件 powershell\.exe/);
  assert.deepEqual(result.cleanup, { scriptRemoved: true, outRemoved: true });
});

test('T2.3 用户拒绝 UAC（native：Start-Process 抛错 + 无 out 文件）⇒ 报「已取消」且不做回滚', async () => {
  const harness = createElevateHarness({
    confirm: true,
    respondWith: {
      exitCode: 1,
      writeOutFile: false,
      stderr: 'The operation was canceled by the user.',
    },
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'cancelled');
  assert.match(result.message, /用户拒绝了 UAC/);
  assert.match(result.hint, /不做任何回滚/);
  // 回滚 = 追加的系统改动 ⇒ 一次提权调用都不该多出来
  assert.equal(harness.fake.calls.length, 1);
  assert.equal(
    harness.fake.calls.some((call) => call.argv.some((token) => token.includes('portproxy delete'))),
    false,
    '被拒时绝不能有回滚动作',
  );
  assert.deepEqual(result.cleanup, { scriptRemoved: true, outRemoved: true });
});

test('T2.3 拒绝 UAC 的另一种指纹：没有文案，仅非 0 退出 + 什么都没回传', async () => {
  const harness = createElevateHarness({
    confirm: true,
    respond: () => ({ ok: false, code: 'NonZeroExit', message: 'stub', exitCode: 1, stderr: '' }),
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.steps, [], '没有任何 steps 可展示（脚本没跑起来）');
});

test('T2.3 有回传时绝不误判为「取消」：退出码 1 + 完整回传 ⇒ 脚本异常', async () => {
  const harness = createElevateHarness({
    confirm: true,
    respondWith: { payload: okPayload(5000), exitCode: 1 },
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'failure');
  assert.match(result.message, /脚本异常（退出码 1）/);
  assert.notEqual(result.status, 'cancelled');
});

test('T2.2 退出码 2（部分失败）与 3（前置不满足）在编排层同样可区分', async () => {
  const partial = createElevateHarness({
    confirm: true,
    respondWith: {
      payload: partialPayload(5000, 'firewall-add', 'Access is denied'),
      exitCode: 2,
    },
  });
  const precondition = createElevateHarness({
    confirm: true,
    respondWith: {
      payload: {
        ok: false,
        action: 'add',
        port: 5000,
        steps: [{ name: 'precondition', ok: false, stderr: 'not elevated' }],
        beforeRules: [],
        afterRules: [],
      },
      exitCode: 3,
    },
  });

  const a = await runElevate(elevationRequest('ask', 'user'), partial.deps);
  const b = await runElevate(elevationRequest('ask', 'user'), precondition.deps);

  assert.equal(a.status, 'partial');
  assert.equal(a.steps.length, 2);
  assert.equal(b.status, 'precondition');
  assert.deepEqual(a.cleanup, { scriptRemoved: true, outRemoved: true });
  assert.deepEqual(b.cleanup, { scriptRemoved: true, outRemoved: true });
});
