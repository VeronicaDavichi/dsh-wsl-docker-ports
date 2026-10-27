/**
 * 012 REQ-1.1 / REQ-2.1：候选监听地址的**读侧**（纯函数 + 只读探针）
 *
 * 判据（逐条可二值判定）：
 * 1. `isCandidateAddress` 只留**物理网卡**的 IPv4：127/8、169.254/16、172.16/12 与
 *    虚拟网卡别名（`vEthernet` / `aTrust` / `Tailscale` / `VMware` / `VirtualBox` /
 *    `Loopback` / `WSL` / `Bluetooth` / `蓝牙`，大小写不敏感）一律排除；
 * 2. 真机 fixture（`get-netipaddress.raw`，8 行原始输出）过滤后**只剩** `192.168.31.129`；
 * 3. 探针**只读**：一条 `powershell.exe -NoProfile -NonInteractive -Command …Get-NetIPAddress…`；
 * 4. 读失败 ⇒ `ProbeFailure`（**绝不**返回空列表冒充「没有网卡」），原因按进程层错误分开。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LOCAL_ADDRESSES_PS_ARGV,
  LOCAL_ADDRESSES_TIMEOUT_MS,
  filterLocalAddresses,
  isCandidateAddress,
  parseLocalAddresses,
  probeLocalAddresses,
} from '../../src/read/local-addresses.ts';
import { createFakeExecutor, failure, ok } from '../helpers/fake-executor.ts';
import { readFixture } from '../helpers/snapshot-fixtures.ts';

const REAL = 'get-netipaddress.raw';

test('REQ-1.1 决策 1：候选判据逐个过（IPv4 段 + 网卡别名，两项都查）', () => {
  // ── 留下：真机的那块物理网卡
  assert.equal(isCandidateAddress({ address: '192.168.31.129', ifAlias: '以太网 4' }), true, '物理网卡 IPv4 必须留下');

  // ── IPv4 段排除
  assert.equal(isCandidateAddress({ address: '172.20.201.152', ifAlias: 'eth0' }), false, '172.16/12 = WSL 内网段');
  assert.equal(isCandidateAddress({ address: '172.20.192.1', ifAlias: '以太网 4' }), false, '172.16/12 只看地址：即使别名是物理网卡也排除');
  assert.equal(isCandidateAddress({ address: '127.0.0.1', ifAlias: '以太网 4' }), false, '127/8 = loopback');
  assert.equal(isCandidateAddress({ address: '169.254.1.1', ifAlias: '以太网 4' }), false, '169.254/16 = 链路本地');

  // ── 网卡别名排除（大小写不敏感 + 中文别名）
  for (const ifAlias of ['vEthernet (WSL (Hyper-V firewall))', 'aTrustVNIC', 'Tailscale', 'VMware Network Adapter VMnet8', 'VirtualBox Host-Only Network', 'Loopback Pseudo-Interface 1', 'Bluetooth Network Connection', '蓝牙网络连接']) {
    assert.equal(isCandidateAddress({ address: '192.168.31.129', ifAlias }), false, `虚拟网卡别名必须排除：${ifAlias}`);
  }

  // ── 形态异常
  assert.equal(isCandidateAddress({ address: '192.168.31', ifAlias: '以太网 4' }), false, '三段不是 IPv4');
  assert.equal(isCandidateAddress({ address: '192.168.31.999', ifAlias: '以太网 4' }), false, '越界八位组不是 IPv4');
  assert.equal(isCandidateAddress({ address: '::1', ifAlias: '以太网 4' }), false, 'IPv6 不在候选内（portproxy 用 v4tov4）');
});

test('REQ-1.1 真机 fixture：8 行原始输出过滤后只剩 192.168.31.129（且保持枚举顺序）', () => {
  const parsed = parseLocalAddresses(readFixture(REAL));
  assert.equal(parsed.length, 8, `前置：真机原始输出是 8 行，实际 ${String(parsed.length)}`);
  assert.deepEqual(parsed[0], { address: '172.20.192.1', ifAlias: 'vEthernet (WSL (Hyper-V firewall))', prefixLength: 20 });

  const kept = filterLocalAddresses(parsed);
  assert.deepEqual(kept, [{ address: '192.168.31.129', ifAlias: '以太网 4', prefixLength: 24 }], '只留物理网卡那一条');
  assert.deepEqual(
    kept.map((entry) => entry.address),
    ['192.168.31.129'],
    '验收 A1 要逐字排除 172.20.201.152 / 172.20.192.1 / 127.0.0.1 —— 这里一次性钉死',
  );
});

test('REQ-1.1 去重：同一地址出现在两块网卡时只留第一条；空输入是合法的空列表', () => {
  const deduped = filterLocalAddresses([
    { address: '192.168.31.129', ifAlias: '以太网 4', prefixLength: 24 },
    { address: '192.168.31.129', ifAlias: '以太网 5', prefixLength: 24 },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.ifAlias, '以太网 4', '保留枚举顺序里的第一条');

  assert.deepEqual(filterLocalAddresses([]), [], '空列表进、空列表出（不是失败）');
  assert.deepEqual(parseLocalAddresses(''), [], '枚举成功但没有 IPv4 ⇒ 空列表（合法，不是 parse-error）');
  assert.deepEqual(parseLocalAddresses('\r\n\r\n'), [], '纯空行同样合法');
});

test('REQ-1.1 解析器严格：脏行必须抛（不许把读不懂的输出当「没有网卡」）', () => {
  for (const dirty of ['以太网 4|192.168.31.129', '以太网 4|not-an-ip|24', '以太网 4|192.168.31.129|33', '以太网 4|192.168.31.129|xx']) {
    assert.throws(() => parseLocalAddresses(dirty), /无法解析的网卡行/u, `脏行必须抛：${dirty}`);
  }
  // 别名里带空格/括号没问题（真机第一条就是这种）
  assert.deepEqual(parseLocalAddresses('vEthernet (WSL (Hyper-V firewall))|172.20.192.1|20\r\n'), [
    { address: '172.20.192.1', ifAlias: 'vEthernet (WSL (Hyper-V firewall))', prefixLength: 20 },
  ]);
});

test('REQ-2.1 探针是**只读单条**命令：powershell 非交互 + 只有 Get-NetIPAddress', async () => {
  const fake = createFakeExecutor(() => ok(readFixture(REAL)));
  const outcome = await probeLocalAddresses(fake.executor);

  assert.equal(fake.calls.length, 1, '一次读 = 一条命令（不重试、不批量）');
  const call = fake.calls[0];
  assert.equal(call?.file, 'powershell.exe');
  assert.deepEqual(call?.argv, LOCAL_ADDRESSES_PS_ARGV, 'argv 逐字来自唯一构造点');
  assert.equal(call?.options.timeoutMs, LOCAL_ADDRESSES_TIMEOUT_MS, `缺省硬超时 ${String(LOCAL_ADDRESSES_TIMEOUT_MS)}ms`);
  assert.equal(call?.options.encoding, 'utf8');
  assert.equal(LOCAL_ADDRESSES_PS_ARGV.includes('powershell.exe'), false, '常量只放参数（exe 由探针补）');

  const line = [call?.file, ...(call?.argv ?? [])].join(' ');
  assert.match(line, /-NoProfile -NonInteractive -Command/u, '必须非交互无 profile');
  assert.match(line, /Get-NetIPAddress -AddressFamily IPv4/u);
  assert.equal(/Remove-|Set-NetIPAddress|New-NetIPAddress|netsh|Start-Process/u.test(line), false, '只读探针里不得出现任何写/提权动词');

  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.deepEqual(outcome.addresses.map((entry) => entry.address), ['192.168.31.129'], '读到的就是候选清单');
    assert.equal(outcome.argv[0], 'powershell.exe');
  }
});

test('REQ-2.1 超时可覆盖（测试用）；读失败返回 ProbeFailure 而不是空列表', async () => {
  const fake = createFakeExecutor(() => ok(''));
  await probeLocalAddresses(fake.executor, { timeoutMs: 1234 });
  assert.equal(fake.calls[0]?.options.timeoutMs, 1234);
});

test('REQ-2.1 四类读失败各归各的原因，且都**不是** ok（不许冒充「没有网卡」）', async () => {
  const cases = [
    { name: 'powershell 不在 PATH', respond: () => failure('CommandNotFound', { argv: ['powershell.exe'] }), expected: 'powershell-missing' },
    { name: '超时', respond: () => failure('Timeout'), expected: 'timeout' },
    { name: '非 0 退出', respond: () => failure('NonZeroExit', { exitCode: 1, stderr: '拒绝访问' }), expected: 'non-zero-exit' },
    { name: '输出读不懂', respond: () => ok('garbage-line\r\n'), expected: 'parse-error' },
  ] as const;

  for (const item of cases) {
    const fake = createFakeExecutor(item.respond);
    const outcome = await probeLocalAddresses(fake.executor);
    assert.equal(outcome.ok, false, `${item.name} ⇒ 必须是失败态`);
    if (!outcome.ok) {
      assert.equal(outcome.reason, item.expected, `${item.name} ⇒ reason=${item.expected}`);
      assert.notEqual(outcome.message.length, 0, '失败必须带给人看的原因（REQ-2.1 的降级要显示原因）');
      assert.notEqual(outcome.hint.length, 0, '失败必须带修法提示');
      assert.equal('addresses' in outcome, false, '失败态不许带空 addresses 字段');
    }
  }
});

test('REQ-2.1 成功态但退出码非 0（001 把 stdout 也给回来的情形）仍判失败', async () => {
  // ⚠️ 001 的类型把 `ExecResult.exitCode` 钉成字面量 `0`（成功态**只**可能是 0）⇒ 这个分支是
  // 防御性的：真出现只能来自「类型之外」的返回值，故这里显式跨过类型造一次，把防御分支钉住。
  const fake = createFakeExecutor(
    () => ({ ok: true, exitCode: 1, stdout: readFixture(REAL), stderr: '部分失败' }) as unknown as ReturnType<typeof ok>,
  );
  const outcome = await probeLocalAddresses(fake.executor);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reason, 'non-zero-exit');
});
