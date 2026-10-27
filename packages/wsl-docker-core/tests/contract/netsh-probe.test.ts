/**
 * T1.2 契约（真机 fixture → 探针 → 解析器）：19 条规则一条不少、命令行与编码声明正确
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NETSH_ARGV, probePortproxyRules } from '../../src/read/netsh-probe.ts';
import { createFakeExecutor, fixtureText, ok } from '../helpers/fake-executor.ts';

const raw = fixtureText('netsh-portproxy-v4tov4.raw');

test('T1.2 真机 fixture：19 条规则全部经探针取回（不经过 WSL，也不提权）', async () => {
  const fake = createFakeExecutor(() => ok(raw));
  const outcome = await probePortproxyRules(fake.executor);

  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.file, 'netsh.exe', 'Windows 侧命令，不经 wsl.exe（故不可能冷启动发行版）');
  assert.deepEqual(call.argv, ['interface', 'portproxy', 'show', 'v4tov4']);
  assert.equal(call.options.encoding, 'utf8', 'A-2 定案：本机输出是纯 ASCII');

  assert.ok(outcome.ok);
  assert.deepEqual(outcome.argv, ['netsh.exe', ...NETSH_ARGV]);
  assert.equal(outcome.rules.length, 19, '本机既有 19 条（用户真实数据）');
  for (const item of outcome.rules) {
    assert.equal(item.listenAddress, '0.0.0.0');
    assert.equal(item.connectAddress, '172.20.201.152');
    assert.equal(item.listenPort, item.connectPort);
  }
});
