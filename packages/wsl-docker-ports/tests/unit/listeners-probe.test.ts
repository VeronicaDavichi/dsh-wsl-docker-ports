/**
 * 013 监听表探针（`ss -ltn`）：解析 + 失败语义 + 反冷启动闸门
 *
 * 三条硬约束：
 * ① **解析只认 LISTEN 行的第 4 列**，`bind` 保留原文（`0.0.0.0` / `*` / `[::]` / `127.0.0.1`）；
 * ② **失败绝不退化成空表**（REQ-1.3：读不到 ≠ 没有监听），且原因可区分；
 * ③ **发行版没在跑时连一次命令都不执行**（001 REQ-2.4 / 003 REQ-2.4）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LISTENERS_TIMEOUT_MS, parseSsListeners, probeListeners } from '../../src/read/listeners-probe.ts';
import { createFakeExecutor, failure, fixtureText, ok } from '../helpers/fake-executor.ts';
import { distro } from '../helpers/factories.ts';

const running = [distro('Ubuntu2204')];
const stopped = [distro('Ubuntu2204', 'Stopped')];

/** 真机形态样例（任务书要求覆盖的四种绑定写法） */
const SAMPLE = [
  'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process',
  'LISTEN 0      4096         0.0.0.0:3306       0.0.0.0:*',
  'LISTEN 0      511         127.0.0.1:3306     127.0.0.1:*',
  'LISTEN 0      4096            [::]:22            [::]:*',
  'LISTEN 0      128                *:8080             *:*',
].join('\n');

test('013 解析：四种绑定写法逐字保留（0.0.0.0 / 127.0.0.1 / [::] / *）', () => {
  assert.deepEqual(parseSsListeners(SAMPLE), [
    { port: 3306, bind: '0.0.0.0' },
    { port: 3306, bind: '127.0.0.1' },
    { port: 22, bind: '[::]' },
    { port: 8080, bind: '*' },
  ]);
});

test('013 解析：真机 fixture 的 12 条 LISTEN 一条不少（含 IPv6 方括号形态）', () => {
  const entries = parseSsListeners(fixtureText('ss-ltn.raw'));
  assert.equal(entries.length, 12, `fixture 必须解析出 12 条，实际 ${String(entries.length)}`);
  assert.deepEqual(entries.filter((entry) => entry.port === 6379).map((entry) => entry.bind), ['0.0.0.0', '[::]']);
  assert.deepEqual(entries.filter((entry) => entry.port === 3306).map((entry) => entry.bind), ['127.0.0.1']);
  assert.deepEqual(entries.filter((entry) => entry.port === 22).map((entry) => entry.bind), ['[::]']);
});

test('013 解析：表头与其它状态被跳过；只有表头 = 空表（不是解析失败）', () => {
  assert.deepEqual(
    parseSsListeners('State Recv-Q Send-Q Local Address:Port Peer Address:Port\nESTAB 0 0 127.0.0.1:9999 127.0.0.1:443'),
    [],
  );
  assert.deepEqual(parseSsListeners('State  Recv-Q Send-Q Local Address:Port  Peer Address:Port'), []);
});

test('013 解析：认不出的 LISTEN 行必须抛错（静默丢行会把「有服务」说成「没有」）', () => {
  assert.throws(() => parseSsListeners('LISTEN 0 4096 not-an-address 0.0.0.0:*'), /无法解析本地地址/u);
  assert.throws(() => parseSsListeners('LISTEN 0 4096'), /缺本地地址列/u);
});

test('013 探针：成功路径 —— 单条 `wsl.exe -d Ubuntu2204 -- ss -ltn`，无 shell、热路径 10s 超时', async () => {
  const fake = createFakeExecutor(() => ok(SAMPLE));
  const outcome = await probeListeners(fake.executor, 'Ubuntu2204', running);

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(fake.calls.length, 1, '一次调用拿全表（REQ-1.5：绝不逐端口开进程）');
  assert.equal(fake.calls[0]?.file, 'wsl.exe');
  assert.deepEqual(fake.calls[0]?.argv, ['-d', 'Ubuntu2204', '--', 'ss', '-ltn'], 'argv 数组下发，无 bash -lc');
  assert.equal(fake.calls[0]?.options.timeoutMs, LISTENERS_TIMEOUT_MS);
  assert.deepEqual(outcome.argv, ['wsl.exe', '-d', 'Ubuntu2204', '--', 'ss', '-ltn'], '证据里的完整命令行');
  assert.equal(outcome.entries.length, 4);
});

test('013 探针：`allowColdStart` 透传，且**不**把 30s 冷启动预算砍成 10s', async () => {
  const fake = createFakeExecutor(() => ok(SAMPLE));
  const outcome = await probeListeners(fake.executor, 'Ubuntu2204', stopped, { allowColdStart: true });

  assert.equal(outcome.ok, true);
  assert.equal(fake.calls.length, 1, '显式动作才允许冷启动');
  // 001 的 `execInDistro` 已把冷启动默认值（30s）填进 options ⇒ 探针不该用 10s 覆盖它
  assert.equal(fake.calls[0]?.options.timeoutMs, 30_000, '冷启动预算必须是 001 的 30s，不是热路径的 10s');
});

test('013 探针：发行版 Stopped ⇒ `wsl-stopped` + **零调用**（反冷启动闸门）', async () => {
  const fake = createFakeExecutor(() => ok(SAMPLE));
  const outcome = await probeListeners(fake.executor, 'Ubuntu2204', stopped);

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'wsl-stopped');
  assert.equal(fake.calls.length, 0, 'REQ-2.4：非 Running 时连一次命令都不许执行');
  assert.match(outcome.hint, /冷启动/u);
});

test('013 探针：发行版不存在 ⇒ `distro-missing`', async () => {
  const fake = createFakeExecutor(() => ok(SAMPLE));
  const outcome = await probeListeners(fake.executor, 'Ubuntu2404', running);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'distro-missing');
  assert.equal(fake.calls.length, 0);
});

test('013 探针：超时 ⇒ `timeout`（不重试、不当空表）', async () => {
  const fake = createFakeExecutor(() => failure('Timeout', { argv: ['wsl.exe', '-d', 'Ubuntu2204'] }));
  const outcome = await probeListeners(fake.executor, 'Ubuntu2204', running);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'timeout');
  assert.equal(fake.calls.length, 1, '监听表只读一次（无 docker 那种重试语义）');
});

test('013 探针：`ss` 不存在（exit 127 / command not found）⇒ `ss-missing` + iproute2 引导', async () => {
  const fake = createFakeExecutor(() =>
    failure('NonZeroExit', { exitCode: 127, stderr: 'execvpe(ss) failed: No such file or directory' }),
  );
  const outcome = await probeListeners(fake.executor, 'Ubuntu2204', running);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'ss-missing');
  assert.match(outcome.hint, /iproute2/u);
});

test('013 探针：其它非零退出 ⇒ `non-zero-exit`（与「ss 缺失」分开）', async () => {
  const fake = createFakeExecutor(() => failure('NonZeroExit', { exitCode: 2, stderr: 'ss: invalid option' }));
  const outcome = await probeListeners(fake.executor, 'Ubuntu2204', running);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'non-zero-exit');
});

test('013 探针：空输出 ⇒ `parse-error`（0 字节只能是读被截断，不许冒充「没有监听」）', async () => {
  const fake = createFakeExecutor(() => ok(''));
  const outcome = await probeListeners(fake.executor, 'Ubuntu2204', running);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'parse-error');
  assert.equal('entries' in outcome, false, '失败**不得**带 entries（否则「没有监听」与「读不到」混了）');
});

test('013 探针：形态脏 ⇒ `parse-error` + 脱敏后的原始输出（可定位）', async () => {
  const fake = createFakeExecutor(() => ok('LISTEN 0 4096 不是地址 0.0.0.0:*\n'));
  const outcome = await probeListeners(fake.executor, 'Ubuntu2204', running);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, 'parse-error');
  assert.match(outcome.raw ?? '', /不是地址/u);
  assert.equal(outcome.cause, null, '解析失败不是 001 的错误');
});
