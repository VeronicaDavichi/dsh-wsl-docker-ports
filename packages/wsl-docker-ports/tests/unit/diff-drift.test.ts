/**
 * T2.3 [REQ-6.1 / REQ-6.2 / REQ-6.4] 漂移判定 + eth0 地址源
 *
 * 三件事：
 * ① `connectAddress != eth0` ⇒ `drift` 且给出「旧 → 新」两个地址（REQ-6.2 要求 UI 显示对照）
 * ② `eth0Ip = null` ⇒ **一条判决都不给**，返回「无法确定地址」，且**没有任何一条**被标 drift（REQ-6.4）
 * ③ **写入前强制现读**：`probe()` 绝不因缓存命中而短路（fake 执行器断言调用次数 **+1**）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diff } from '../../src/diff/engine.ts';
import { singlePort } from '../../src/diff/managed-ports.ts';
import { createEth0Source } from '../../src/read/eth0-source.ts';
import { createFakeExecutor, failure, ok } from '../helpers/fake-executor.ts';
import { container, distro, ETH0, rule, ruleToEth0 } from '../helpers/factories.ts';

const containers = [container('svc-a-1', '0.0.0.0:6379->6379/tcp')];

test('T2.3 漂移：旧地址 → 当前 eth0（`drift` 带上「旧 → 新」两个值）', () => {
  const outcome = diff({
    containers,
    managedPorts: [singlePort(6379)],
    rules: [rule('0.0.0.0', 6379, '172.20.0.9', 6379)],
    eth0Ip: ETH0,
    localhostForwarding: true,
    scopes: { '6379': 'lan' },
  });
  assert.ok(outcome.ok);
  const one = outcome.result.ports[0];
  assert.equal(one?.state, 'drift');
  assert.deepEqual(one?.drift, { from: '172.20.0.9', to: ETH0 });
  assert.equal(outcome.result.counts.drift, 1);
});

test('T2.3 [REQ-6.4] 取不到 eth0 ⇒ 不给任何判决、也**不把规则标成 drift**；只读信息仍在', () => {
  const external = rule('0.0.0.0', 80, '172.20.201.152', 80);
  const outcome = diff({
    containers,
    managedPorts: [singlePort(6379)],
    rules: [rule('0.0.0.0', 6379, '172.20.0.9', 6379), external],
    eth0Ip: null,
    localhostForwarding: true,
    scopes: { '6379': 'lan' },
  });

  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'eth0-unknown');
  assert.match(outcome.message, /无法确定 WSL 地址/);
  assert.match(outcome.hint, /启动并核验/);
  assert.equal('result' in outcome, false, '没有 result ⇒ 不存在任何五态判决（更不会全标 drift）');
  assert.deepEqual(outcome.external.map((item) => item.rule.listenPort), [80], '外部清单与 eth0 无关，仍要给');
});

test('T2.3 [REQ-6.1] 写入前强制现读：`probe()` 两次 = 执行器被调用两次（不吃缓存）', async () => {
  const fake = createFakeExecutor(() => ok('2: eth0    inet 172.20.201.152/20 brd 172.20.207.255 scope global eth0\n'));
  const source = createEth0Source(fake.executor, 'Ubuntu2204', [distro('Ubuntu2204')]);

  assert.equal(source.cachedIp(), null, '没探过 ⇒ 缓存是 null（不是空串，也不是 127.0.0.1）');
  assert.equal(fake.calls.length, 0, '读缓存绝不该执行任何命令');

  const first = await source.probe();
  assert.equal(first.ok, true);
  assert.equal(source.cachedIp(), ETH0);
  assert.equal(fake.calls.length, 1);

  // 展示路径：读缓存，不许再执行
  assert.equal(source.cachedIp(), ETH0);
  assert.equal(fake.calls.length, 1);

  // 写入路径：强制现读 —— 即使缓存是热的，也必须再执行一次（**+1**）
  const second = await source.probe();
  assert.equal(second.ok, true);
  assert.equal(fake.calls.length, 2, '写入前强制现读：拿旧地址去写规则 = 亲手造一条坏规则');
  assert.deepEqual(fake.calls[0]?.argv, ['-d', 'Ubuntu2204', '--', 'ip', '-4', '-o', 'addr', 'show', 'dev', 'eth0']);
});

test('T2.3 [REQ-6.4] 探测失败 ⇒ 缓存**清空**（不留一个可能已失效的地址在界面上）', async () => {
  const fake = createFakeExecutor((_call, index) =>
    index === 0
      ? ok('2: eth0    inet 172.20.201.152/20 scope global eth0\n')
      : failure('NoInterface', { argv: ['wsl.exe', '-d', 'Ubuntu2204'] }),
  );
  const source = createEth0Source(fake.executor, 'Ubuntu2204', [distro('Ubuntu2204')]);

  assert.equal((await source.probe()).ok, true);
  assert.equal(source.cachedIp(), ETH0);

  const failed = await source.probe();
  assert.equal(failed.ok, false);
  assert.equal(source.cachedIp(), null, '失败后 UI 的判据只有一条：cachedIp() === null ⇒ 显示「无法确定地址」');
});

test('T2.3 [001-REQ-2.4] 冷启动只允许按次显式覆盖：发行版 Stopped 时默认探测**一次都不执行**', async () => {
  const fake = createFakeExecutor(() => ok('2: eth0    inet 172.20.201.152/20 scope global eth0\n'));
  const stopped = [distro('Ubuntu2204', 'Stopped')];
  const source = createEth0Source(fake.executor, 'Ubuntu2204', stopped);

  const guarded = await source.probe();
  assert.equal(guarded.ok, false);
  assert.equal(guarded.ok === false ? guarded.code : '', 'DistroNotRunning');
  assert.equal(fake.calls.length, 0, '自动路径绝不冷启动（实测 12.6s + 拉起用户全部容器）');

  const explicit = await source.probe({ allowColdStart: true });
  assert.equal(fake.calls.length, 1, '用户点了「启动并核验」才允许这一次');
  assert.equal(explicit.ok, true);
  assert.equal(source.cachedIp(), ETH0);
});

test('T2.3 边界：规则指向 eth0 但 `connectPort` 不同 ⇒ conflict，不是 drift（两态不许混）', () => {
  const outcome = diff({
    containers,
    managedPorts: [singlePort(6379)],
    rules: [rule('0.0.0.0', 6379, ETH0, 9999)],
    eth0Ip: ETH0,
    localhostForwarding: true,
    scopes: { '6379': 'lan' },
  });
  assert.ok(outcome.ok);
  assert.equal(outcome.result.ports[0]?.state, 'conflict');
  assert.equal(outcome.result.counts.drift, 0);
  assert.equal(outcome.result.ports[0]?.rules[0]?.listenPort, 6379);
  assert.equal(ruleToEth0(6379).connectPort, 6379);
});
