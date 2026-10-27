/**
 * T1.1 边界与异常（离线，fake 执行器）
 *
 * 三条必须**可区分**的 docker 失败（REQ-2.3）：未安装 / daemon 未运行 / 权限不足；
 * 外加 T0.1 实测逼出来的两条：**超时要重试**、**空输出不许当结论**。
 * 以及一条硬约束：发行版没在跑时**连一次命令都不许执行**（001 REQ-2.4 / 003 REQ-2.4）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { probeDockerPs } from '../../src/read/docker-probe.ts';
import { createFakeExecutor, failure, ok } from '../helpers/fake-executor.ts';
import { distro } from '../helpers/factories.ts';

const running = [distro('Ubuntu2204')];
const stopped = [distro('Ubuntu2204', 'Stopped')];

test('T1.1 异常①：docker 未安装 → `docker-missing` + 安装引导（不是「没有容器」）', async () => {
  const fake = createFakeExecutor(() =>
    failure('NonZeroExit', { exitCode: 127, stderr: 'bash: line 1: docker: command not found\n' }),
  );
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', running);

  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'docker-missing');
  assert.match(outcome.hint, /apt-get install -y docker\.io/);
  assert.equal(outcome.cause?.exitCode, 127, '001 的原始错误必须原样带出来');
  assert.equal('containers' in outcome, false, 'REQ-1.3：失败**不得**退化成空容器列表');
});

test('T1.1 异常②：daemon 未运行 → `daemon-down` + 启动引导', async () => {
  const fake = createFakeExecutor(() =>
    failure('NonZeroExit', {
      exitCode: 1,
      stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n',
    }),
  );
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', running);

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'daemon-down');
  assert.match(outcome.hint, /sudo service docker start/);
});

test('T1.1 异常③：权限不足 → `permission-denied`（**优先于** daemon-down，两者文案都像）', async () => {
  const fake = createFakeExecutor(() =>
    failure('NonZeroExit', {
      exitCode: 1,
      stderr:
        'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock\n',
    }),
  );
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', running);

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'permission-denied');
  assert.match(outcome.hint, /usermod -aG docker/);
});

test('T1.1 边界：第一次超时、第二次成功（T0.1 实测的唤醒后形态）→ 自动重试且 attemptCount=2', async () => {
  const containers = ['{"ID":"dead00000001","Names":"svc-a-1","Image":"i","State":"running","Status":"Up","Ports":"0.0.0.0:6379->6379/tcp"}'].join('\n');
  const fake = createFakeExecutor((_call, index) =>
    index === 0 ? failure('Timeout', { argv: ['wsl.exe', '-d', 'Ubuntu2204'] }) : ok(containers),
  );
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', running);

  assert.equal(fake.calls.length, 2, '超时是瞬时失败 → 必须重试');
  assert.ok(outcome.ok);
  assert.equal(outcome.attemptCount, 2);
  assert.equal(outcome.containers.length, 1);
});

test('T1.1 异常④：两次都超时 → `timeout` 失败（**绝不**返回空列表）', async () => {
  const fake = createFakeExecutor(() => failure('Timeout', { argv: ['wsl.exe', '-d', 'Ubuntu2204'] }));
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', running);

  assert.equal(fake.calls.length, 2);
  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'timeout');
  assert.equal('containers' in outcome, false);
});

test('T1.1 异常⑤：一次都不许执行（发行版 Stopped）—— 001 的守卫在**执行前**拦下', async () => {
  const fake = createFakeExecutor(() => ok(''));
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', stopped);

  assert.equal(fake.calls.length, 0, 'REQ-2.4：自动路径绝不冷启动发行版（实测 12.6s + 拉起用户容器）');
  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'distro-not-running');
  assert.match(outcome.hint, /启动并核验/);
});

test('T1.1 边界：两次都是 0 字节输出 → ok 但 `emptyAfterRetry=true`（复核过才敢说「没有容器」）', async () => {
  const fake = createFakeExecutor(() => ok(''));
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', running);

  assert.equal(fake.calls.length, 2, '空输出必须复核一次');
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.containers, []);
  assert.equal(outcome.emptyAfterRetry, true);
});

test('T1.1 边界：`attempts: 1` 时空输出 → `emptyAfterRetry=false`（没有复核过，UI 不许声称「没有容器」）', async () => {
  const fake = createFakeExecutor(() => ok(''));
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', running, { attempts: 1 });

  assert.equal(fake.calls.length, 1);
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.containers, []);
  assert.equal(outcome.emptyAfterRetry, false);
});

test('T1.1 异常⑥：输出形态不可识别 → `parse-error` + **脱敏后**的原始输出（REQ-3.5）', async () => {
  const fake = createFakeExecutor(() =>
    ok('{"ID":"dead1","Names":"svc","Image":"i","State":"running","Status":"Up","Ports":"ok","PASSWORD=hunter2"}\n{不是 JSON}\n'),
  );
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', running);

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'parse-error');
  assert.ok(outcome.raw !== null, 'REQ-3.5：报错必须把原文交出来（脱敏后）');
  assert.equal(outcome.raw.includes('hunter2'), false, '凭据不得进 UI');
  assert.match(outcome.raw, /PASSWORD=<已脱敏>/);
  assert.match(outcome.raw, /\{不是 JSON\}/, '原始形态本身要保留，否则无从判断哪里不对');
});

test('T1.1 异常⑦：wsl.exe 都找不到 → `wsl-missing`（与「docker 没装」是两件事）', async () => {
  const fake = createFakeExecutor(() => failure('CommandNotFound', { argv: ['wsl.exe', '-l', '-v'] }));
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', running);

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'wsl-missing');
  assert.match(outcome.hint, /wsl --install/);
});

test('T1.1 异常⑧：发行版名写错 → `distro-missing`，引导里带上可用列表', async () => {
  const fake = createFakeExecutor(() => ok(''));
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu', running);

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'distro-missing');
  assert.match(outcome.hint, /Ubuntu2204/);
});
