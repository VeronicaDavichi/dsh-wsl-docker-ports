/**
 * T1.2 边界与异常（离线，fake 执行器）
 *
 * 「空表」与「形状脏」必须走两条完全不同的路：前者是**事实**（本机确实没有规则，返回 `[]`），
 * 后者**必须报错并交出脱敏原文**（REQ-3.5）—— 静默丢行会让 005 的红线
 * 「他人规则条数不变」失去比对基准。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { probePortproxyRules } from '../../src/read/netsh-probe.ts';
import { createFakeExecutor, failure, ok } from '../helpers/fake-executor.ts';

const header =
  '\r\nListen on ipv4:             Connect to ipv4:\r\n\r\nAddress         Port        Address         Port\r\n';

test('T1.2 边界：无规则（只有表头、没有分隔线）→ 成功且 rules 为空数组', async () => {
  const fake = createFakeExecutor(() => ok(header));
  const outcome = await probePortproxyRules(fake.executor);

  assert.ok(outcome.ok);
  assert.deepEqual(outcome.rules, []);
});

test('T1.2 异常①：数据行列数不对 → `parse-error` + 脱敏原文（含用户名掩码）', async () => {
  const dirty = `${header}--------------- ----------  --------------- ----------\r\n0.0.0.0 8080 172.20.201.152\r\n`;
  const fake = createFakeExecutor(() => ok(dirty));
  const outcome = await probePortproxyRules(fake.executor);

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'parse-error');
  assert.ok(outcome.raw !== null);
  assert.match(outcome.raw, /0\.0\.0\.0 8080 172\.20\.201\.152/, '原文必须保留，否则无从判断哪里不对');
});

test('T1.2 异常②：端口越界 → `parse-error`（不静默丢行）', async () => {
  const dirty = `${header}--------------- ----------  --------------- ----------\r\n0.0.0.0 99999 172.20.201.152 8080\r\n`;
  const fake = createFakeExecutor(() => ok(dirty));
  const outcome = await probePortproxyRules(fake.executor);

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'parse-error');
});

test('T1.2 异常③：原文里的用户目录名与凭据一律进不了 UI（脱敏只此一处）', async () => {
  const leaky = `${header}--------------- ----------  --------------- ----------\r\nC:\\Users\\EDY\\x 8080 172.20.201.152 8080 token=abc123\r\n`;
  const fake = createFakeExecutor(() => ok(leaky));
  const outcome = await probePortproxyRules(fake.executor);

  assert.ok(!outcome.ok);
  const raw = outcome.raw ?? '';
  assert.equal(raw.includes('EDY'), false);
  assert.equal(raw.includes('abc123'), false);
  assert.match(raw, /C:\\Users\\<user>/);
  assert.match(raw, /token=<已脱敏>/);
});

test('T1.2 异常④：netsh 以非零码退出 → `non-zero-exit`（带 001 的原始错误）', async () => {
  const fake = createFakeExecutor(() =>
    failure('NonZeroExit', { exitCode: 1, stderr: 'The requested operation requires elevation.\r\n' }),
  );
  const outcome = await probePortproxyRules(fake.executor);

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'non-zero-exit');
  assert.equal(outcome.cause?.exitCode, 1);
});

test('T1.2 异常⑤：找不到 netsh.exe → `netsh-missing`', async () => {
  const fake = createFakeExecutor(() => failure('CommandNotFound', { argv: ['netsh.exe'] }));
  const outcome = await probePortproxyRules(fake.executor);

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'netsh-missing');
});

test('T1.2 异常⑥：netsh 挂住 → `timeout`（不重试：show 是毫秒级的本地调用）', async () => {
  const fake = createFakeExecutor(() => failure('Timeout', { argv: ['netsh.exe', 'interface'] }));
  const outcome = await probePortproxyRules(fake.executor);

  assert.equal(fake.calls.length, 1);
  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'timeout');
  assert.equal(fake.calls[0]?.options.timeoutMs, 5_000);
});
