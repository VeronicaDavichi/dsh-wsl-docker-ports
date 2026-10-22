/**
 * 012 REQ-1.2–1.5 / 决策 2/3/4：监听地址**选择**在判决层与规划层的落点
 *
 * 判据（逐条可二值判定）：
 * 1. `expectedListenAddress('lan')` 缺省仍是 `0.0.0.0`（决策 2：默认行为不变），传具体 IP 才改；
 *    `loopback` 无视入参恒 `127.0.0.1`；
 * 2. `isOurListenAddress`：`{127.0.0.1, 0.0.0.0}` 永远算，其余只算**候选清单里**的 IP；
 * 3. 判决：候选清单里的 IP 不报 `conflict`（决策 1 / REQ-1.5 最多只是 `scopeMismatch`）；
 *    清单外地址仍 `conflict`（既有红线不放宽）；
 * 4. 规划：选中具体 IP ⇒ `listenaddress=<IP>` + 防火墙 `-RemoteAddress <网段>`（决策 3）；
 *    不选 ⇒ 两条命令与 010 **逐字相同**；
 * 5. 地址/掩码算不出网段 ⇒ `listen-address-invalid` 拦下、**零步骤**（fail-closed，不许退化成全放开）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diff, expectedListenAddress, isOurListenAddress } from '../../src/diff/engine.ts';
import { singlePort } from '../../src/diff/managed-ports.ts';
import type { DiffResult } from '../../src/diff/types.ts';
import { buildFirewallAddStep, cidrFor, firewallAllowArgs, firewallAllowCommandText } from '../../src/write/firewall.ts';
import { buildWritePlan, portproxyAddStep } from '../../src/write/plan.ts';
import { listenAddressForScope } from '../../src/write/ownership.ts';
import { commandsOf, expectBlock, expectPlan, stepKinds } from '../helpers/expect-plan.ts';
import { ETH0, container, rule, ruleToEth0 } from '../helpers/factories.ts';

const LAN_IP = '192.168.31.129';
const LAN_CIDR = '192.168.31.0/24';
const PORT = 3306;
const PORTS = [singlePort(PORT)];

function diffOf(options: {
  readonly listenAddress?: string;
  readonly allowed?: readonly string[];
  readonly rules?: readonly ReturnType<typeof ruleToEth0>[];
  readonly scope?: 'loopback' | 'lan';
} = {}): DiffResult {
  const outcome = diff({
    containers: [container('mysql-db', '0.0.0.0:3306->3306/tcp')],
    managedPorts: PORTS,
    rules: options.rules ?? [],
    eth0Ip: ETH0,
    localhostForwarding: true,
    scopes: { [String(PORT)]: options.scope ?? 'lan' },
    ...(options.allowed === undefined ? {} : { allowedListenAddresses: options.allowed }),
    ...(options.listenAddress === undefined ? {} : { listenAddresses: { [String(PORT)]: options.listenAddress } }),
  });
  assert.ok(outcome.ok, '前置：eth0 已知 ⇒ 判决必须成功');
  return outcome.result;
}

test('决策 2：expectedListenAddress 缺省逐字同 010，只有 lan + 具体 IP 才换地址', () => {
  assert.equal(expectedListenAddress('lan'), '0.0.0.0', '缺省仍是 0.0.0.0（010 及之前所有断言照旧）');
  assert.equal(expectedListenAddress('loopback'), '127.0.0.1');
  assert.equal(expectedListenAddress('lan', LAN_IP), LAN_IP, '选中具体 IP ⇒ 用它');
  assert.equal(expectedListenAddress('lan', ''), '0.0.0.0', '空串视作没选（不写空 address）');
  assert.equal(expectedListenAddress('lan', '   '), '0.0.0.0', '空白同样视作没选');
  assert.equal(expectedListenAddress('loopback', LAN_IP), '127.0.0.1', 'loopback 没有「用哪块网卡」的自由度');
  assert.equal(listenAddressForScope('lan', LAN_IP), LAN_IP, '写侧转出同一份口径');
  assert.equal(listenAddressForScope('lan'), '0.0.0.0');
});

test('决策 1：isOurListenAddress = 两个默认值 ∪ 候选清单（清单外一律不算）', () => {
  assert.equal(isOurListenAddress('127.0.0.1'), true, '默认值永远算');
  assert.equal(isOurListenAddress('0.0.0.0'), true, '默认值永远算');
  assert.equal(isOurListenAddress(LAN_IP), false, '没有候选清单时，具体 IP 仍算「不是我们会写的形态」');
  assert.equal(isOurListenAddress(LAN_IP, [LAN_IP]), true, '候选清单里的 IP 算');
  assert.equal(isOurListenAddress('10.0.0.9', [LAN_IP]), false, '清单外的地址仍不算（不放宽到任何 IPv4）');
  assert.equal(isOurListenAddress(LAN_IP, []), false);
});

test('REQ-1.5：候选 IP 的规则不报 conflict；清单外地址仍 conflict（既有红线不变）', () => {
  const withCandidate = diffOf({ allowed: [LAN_IP], rules: [rule(LAN_IP, PORT, ETH0, PORT)] });
  const row = withCandidate.ports[0];
  assert.equal(row?.state, 'ok', '候选 IP 上的规则形状正确 ⇒ ok');
  assert.deepEqual(row?.conflicts, [], '不许再判成 conflict');
  assert.equal(row?.scopeMismatch, true, '未选具体 IP 时「监听地址 ≠ 0.0.0.0」只能作为事实位暴露（默认形态仍是 0.0.0.0）');

  const selected = diffOf({ allowed: [LAN_IP], listenAddress: LAN_IP, rules: [rule(LAN_IP, PORT, ETH0, PORT)] });
  assert.equal(selected.ports[0]?.scopeMismatch, false, '选了该 IP ⇒ 一致，不再是 scopeMismatch');

  const foreign = diffOf({ allowed: [LAN_IP], rules: [rule('10.0.0.9', PORT, ETH0, PORT)] });
  assert.equal(foreign.ports[0]?.state, 'conflict', '清单外地址照旧 conflict');
  assert.equal(foreign.ports[0]?.conflicts.length, 1);

  const legacy = diffOf({ rules: [rule(LAN_IP, PORT, ETH0, PORT)] });
  assert.equal(legacy.ports[0]?.state, 'conflict', '不传候选清单 ⇒ 与 010 逐字相同（具体 IP 仍 conflict）');
});

test('决策 3：portproxyAddStep 带/不带 listenAddress 的命令原文', () => {
  const withIp = portproxyAddStep(PORT, 'lan', ETH0, LAN_IP);
  assert.equal(withIp.params.listenaddress, LAN_IP);
  assert.match(withIp.commandText, /listenaddress=192\.168\.31\.129 connectport=3306 connectaddress=172\.20\.201\.152/u);
  assert.match(withIp.commandText, /^netsh interface portproxy add v4tov4 listenport=3306 /u, '仍必带 listenport（design §2 红线）');

  const dflt = portproxyAddStep(PORT, 'lan', ETH0);
  assert.equal(dflt.params.listenaddress, '0.0.0.0');
  assert.equal(
    dflt.commandText,
    `netsh interface portproxy add v4tov4 listenport=3306 listenaddress=0.0.0.0 connectport=3306 connectaddress=${ETH0}`,
    '缺省命令原文与 010 逐字相同',
  );
  assert.equal(portproxyAddStep(PORT, 'loopback', ETH0, LAN_IP).params.listenaddress, '127.0.0.1', 'loopback 忽略入参');
});

test('决策 3：cidrFor 按 PrefixLength 折网段（含 /0 与 /32 边界）', () => {
  assert.equal(cidrFor(LAN_IP, 24), LAN_CIDR);
  assert.equal(cidrFor(LAN_IP, 32), '192.168.31.129/32', '/32 = 只放行该地址本身');
  assert.equal(cidrFor('10.1.2.3', 16), '10.1.0.0/16');
  assert.equal(cidrFor('10.1.2.3', 0), '0.0.0.0/0', '边界：/0 明确算出 0.0.0.0/0（而不是 null 或崩）');
  assert.equal(cidrFor('255.255.255.255', 24), '255.255.255.0/24', '边界：最高位不为 0 时也不许出现负号');
  assert.equal(cidrFor('192.168.31', 24), null, '非 IPv4 ⇒ null（调用方据此拦下）');
  assert.equal(cidrFor(LAN_IP, 33), null, '掩码越界 ⇒ null');
  assert.equal(cidrFor(LAN_IP, 24.5), null, '非整数掩码 ⇒ null');
});

test('决策 3：防火墙步骤默认**不含** -RemoteAddress（010 命令原文逐字不变）', () => {
  const dflt = buildFirewallAddStep(PORT);
  assert.equal('remoteAddress' in dflt.params, false, '缺省 params 里不许出现这个键');
  assert.equal(dflt.commandText.includes('-RemoteAddress'), false);
  assert.equal(dflt.commandText, firewallAllowCommandText(firewallAllowArgs(PORT)));

  const narrowed = buildFirewallAddStep(PORT, LAN_CIDR);
  assert.equal(narrowed.params.remoteAddress, LAN_CIDR);
  assert.match(narrowed.commandText, /-RemoteAddress "192\.168\.31\.0\/24"/u);
  assert.match(narrowed.commandText, /-LocalPort 3306 /u, '端口仍是具体数字（无通配）');

  assert.throws(() => firewallAllowArgs(PORT, 'not-a-cidr'), /-RemoteAddress 必须是/u, '非法网段必须在参数层就抛');
});

test('决策 3：lan + 选中 IP ⇒ 两步都带上该 IP 与网段（add 与 switch-scope 同口径）', () => {
  const add = expectPlan(
    buildWritePlan({
      action: 'add',
      port: PORT,
      scope: 'lan',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
      localhostForwarding: true,
      listenAddress: LAN_IP,
      listenAddressPrefixLength: 24,
    }),
  );
  assert.deepEqual(stepKinds(add), ['portproxy-add', 'firewall-add']);
  assert.equal(add.listenAddress, LAN_IP, '规划自身带出本次使用的地址（便于确认与审计）');
  assert.match(commandsOf(add, 'portproxy-add')[0] ?? '', new RegExp(`listenaddress=${LAN_IP.replaceAll('.', '\\.')}`, 'u'));
  assert.match(commandsOf(add, 'firewall-add')[0] ?? '', /-RemoteAddress "192\.168\.31\.0\/24"/u);

  const switched = expectPlan(
    buildWritePlan({
      action: 'switch-scope',
      port: PORT,
      scope: 'lan',
      fromScope: 'loopback',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
      listenAddress: LAN_IP,
      listenAddressPrefixLength: 24,
    }),
  );
  assert.deepEqual(stepKinds(switched), ['portproxy-add', 'firewall-add']);
  assert.match(commandsOf(switched, 'portproxy-add')[0] ?? '', /listenaddress=192\.168\.31\.129/u);
  assert.match(commandsOf(switched, 'firewall-add')[0] ?? '', /-RemoteAddress "192\.168\.31\.0\/24"/u);
});

test('决策 2/回归：不传 listenAddress ⇒ 规划与 010 逐字相同（无 listenAddress 键、无 RemoteAddress）', () => {
  const dflt = expectPlan(
    buildWritePlan({ action: 'add', port: PORT, scope: 'lan', managedPorts: PORTS, eth0Ip: ETH0, rules: [], localhostForwarding: true }),
  );
  assert.equal('listenAddress' in dflt, false, '缺省不许出现这个键（形状与 010 一致）');
  assert.equal(dflt.steps[0]?.commandText.includes('listenaddress=0.0.0.0'), true);
  assert.equal('remoteAddress' in (dflt.steps[1]?.params ?? {}), false);
  assert.equal(dflt.commandText.includes('-RemoteAddress'), false);

  // 边界：loopback 传了 IP 也不该把地址带进去（作用域说了算）
  const loopback = expectPlan(
    buildWritePlan({ action: 'add', port: PORT, scope: 'loopback', managedPorts: PORTS, eth0Ip: ETH0, rules: [], localhostForwarding: false, listenAddress: LAN_IP }),
  );
  assert.equal(loopback.steps[0]?.params.listenaddress, '127.0.0.1');
});

test('决策 3 fail-closed：地址或掩码算不出网段 ⇒ listen-address-invalid、零步骤', () => {
  const blocked = expectBlock(
    buildWritePlan({
      action: 'add',
      port: PORT,
      scope: 'lan',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
      localhostForwarding: true,
      listenAddress: 'not-an-ip',
      listenAddressPrefixLength: 24,
    }),
    'listen-address-invalid',
  );
  assert.deepEqual(blocked.steps, [], '拦下时一个动作都不许产生');
  assert.match(blocked.message, /算不出合法网段/u);

  expectBlock(
    buildWritePlan({
      action: 'switch-scope',
      port: PORT,
      scope: 'lan',
      fromScope: 'loopback',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
      listenAddress: LAN_IP,
      listenAddressPrefixLength: 40,
    }),
    'listen-address-invalid',
  );

  // 边界：合法地址 + 缺省掩码 ⇒ /32（只放行该地址），绝不能悄悄变成 /0
  const noPrefix = expectPlan(
    buildWritePlan({
      action: 'add',
      port: PORT,
      scope: 'lan',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
      localhostForwarding: true,
      listenAddress: LAN_IP,
    }),
  );
  assert.equal(String(noPrefix.steps[1]?.params.remoteAddress), '192.168.31.129/32', '缺省掩码必须是 /32（最小放行面）');
});

test('决策 4：既有 0.0.0.0 规则 + 新选 IP ⇒ fix 按新址重建，但仍先精确删除旧规则', () => {
  const planned = expectPlan(
    buildWritePlan({
      action: 'fix',
      port: PORT,
      scope: 'lan',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [ruleToEth0(PORT)],
      portState: 'drift',
      listenAddress: LAN_IP,
      listenAddressPrefixLength: 24,
    }),
  );
  assert.deepEqual(stepKinds(planned), ['portproxy-delete', 'portproxy-add']);
  assert.match(commandsOf(planned, 'portproxy-delete')[0] ?? '', /listenaddress=0\.0\.0\.0/u, '删除对准**旧**规则，不许按通配删');
  assert.match(commandsOf(planned, 'portproxy-add')[0] ?? '', /listenaddress=192\.168\.31\.129/u);
});
