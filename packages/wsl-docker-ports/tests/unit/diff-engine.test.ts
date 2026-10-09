/**
 * T2.1 / T2.2 / T2.4 diff-engine（纯函数，五态）
 *
 * 断言口径：
 * - **表格驱动**：`ok` / `missing` / `drift` / `conflict` / `extra` 各 ≥2 例（正常 / 边界 / 异常齐备）
 * - **REQ-3.3**：每个端口**恰好一条**归类（`counts` 之和 = 归类条数、端口不重复）
 * - **REQ-3.2**：集合外端口既不进五态、也不计 `conflict`（T2.2）
 * - **REQ-9.2**：UDP（及其它非 TCP）标「不支持」且**不生成**期望转发项（T2.4）
 * - **纯函数**：输出里没有任何函数（`assertNoFunctions`）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diff } from '../../src/diff/engine.ts';
import { singlePort, type ManagedPorts } from '../../src/diff/managed-ports.ts';
import type { DiffResult, PortState, Scope } from '../../src/diff/types.ts';
import { parseDockerPsJsonl } from '../../src/read/docker.ts';
import { parsePortproxyTable, type PortproxyRule } from '../../src/read/netsh.ts';
import { assertNoFunctions } from '../helpers/assertions.ts';
import { fixtureText } from '../helpers/fake-executor.ts';
import { container, ETH0, rule, ruleToEth0 } from '../helpers/factories.ts';

interface Case {
  readonly name: string;
  /** 容器的 `Ports` 列原文（**真解析器**造数据，避免手搓对象掩盖解析层的问题） */
  readonly ports?: string;
  readonly managed?: ManagedPorts;
  readonly scopes?: Readonly<Record<string, Scope>>;
  readonly localhostForwarding?: boolean;
  readonly rules?: readonly PortproxyRule[];
}

function runCase(item: Case): DiffResult {
  const outcome = diff({
    containers: item.ports === undefined ? [] : [container('svc-a-1', item.ports)],
    managedPorts: item.managed ?? [],
    rules: item.rules ?? [],
    eth0Ip: ETH0,
    localhostForwarding: item.localhostForwarding ?? true,
    ...(item.scopes === undefined ? {} : { scopes: item.scopes }),
  });
  assert.ok(outcome.ok, `${item.name} 不该失败`);
  assertNoFunctions(outcome);
  // REQ-3.3：端口不重复，且 counts 之和等于归类条数
  const ports = outcome.result.ports.map((one) => one.port);
  assert.equal(new Set(ports).size, ports.length, `${item.name}：同一端口出现了多条归类`);
  const total = Object.values(outcome.result.counts).reduce((sum, count) => sum + count, 0);
  assert.equal(total, ports.length, `${item.name}：counts 与归类条数不一致`);
  return outcome.result;
}

const LAN_6379: Readonly<Record<string, Scope>> = { '6379': 'lan' };

interface Row {
  readonly name: string;
  readonly item: Case;
  readonly expected: PortState;
  readonly port: number;
  /** 额外的针对性断言 */
  readonly check?: (result: DiffResult) => void;
}

const ROWS: readonly Row[] = [
  // ── ok ────────────────────────────────────────────────────────────────
  {
    name: 'ok①：lan + 规则指向当前 eth0',
    item: { name: 'ok①', ports: '0.0.0.0:6379->6379/tcp', managed: [singlePort(6379)], scopes: LAN_6379, rules: [ruleToEth0(6379)] },
    expected: 'ok',
    port: 6379,
    check: (result) => {
      const one = result.ports[0];
      assert.equal(one?.reason, null);
      assert.equal(one?.scopeMismatch, false);
      assert.equal(one?.drift, null);
    },
  },
  {
    name: 'ok②（边界）：loopback + `localhostForwarding=true` + 没有任何规则 ⇒ **无需规则**也是 ok',
    item: { name: 'ok②', ports: '0.0.0.0:6379->6379/tcp', managed: [singlePort(6379)] },
    expected: 'ok',
    port: 6379,
    check: (result) => {
      assert.equal(result.ports[0]?.reason, 'wsl-localhost-forwarding');
      assert.equal(result.expected[0]?.needsRule, false);
    },
  },
  // ── missing ───────────────────────────────────────────────────────────
  {
    name: 'missing①：lan 声明了但没有任何规则',
    item: { name: 'missing①', ports: '0.0.0.0:6379->6379/tcp', managed: [singlePort(6379)], scopes: LAN_6379 },
    expected: 'missing',
    port: 6379,
  },
  {
    name: 'missing②（边界）：loopback 且 `localhostForwarding=false` ⇒ loopback 也需要显式规则（005 REQ-2.5）',
    item: { name: 'missing②', ports: '0.0.0.0:6379->6379/tcp', managed: [singlePort(6379)], localhostForwarding: false },
    expected: 'missing',
    port: 6379,
    check: (result) => assert.equal(result.expected[0]?.needsRule, true),
  },
  // ── drift ─────────────────────────────────────────────────────────────
  {
    name: 'drift①：规则指向旧地址（WSL 重建后漂移）',
    item: {
      name: 'drift①',
      ports: '0.0.0.0:6379->6379/tcp',
      managed: [singlePort(6379)],
      scopes: LAN_6379,
      rules: [rule('0.0.0.0', 6379, '172.20.0.9', 6379)],
    },
    expected: 'drift',
    port: 6379,
    check: (result) => {
      assert.deepEqual(result.ports[0]?.drift, { from: '172.20.0.9', to: ETH0 });
    },
  },
  {
    name: 'drift②（边界）：同一端口「一条好 + 一条陈旧」⇒ drift（优先于 ok，不许把陈旧规则藏起来）',
    item: {
      name: 'drift②',
      ports: '0.0.0.0:6379->6379/tcp',
      managed: [singlePort(6379)],
      scopes: LAN_6379,
      rules: [ruleToEth0(6379), rule('0.0.0.0', 6379, '172.20.0.9', 6379)],
    },
    expected: 'drift',
    port: 6379,
    check: (result) => assert.equal(result.ports[0]?.rules.length, 2),
  },
  // ── conflict ──────────────────────────────────────────────────────────
  {
    name: 'conflict①：`connectPort` 与本插件声明不符（别人的转发占了这个端口）',
    item: {
      name: 'conflict①',
      ports: '0.0.0.0:6379->6379/tcp',
      managed: [singlePort(6379)],
      scopes: LAN_6379,
      rules: [rule('0.0.0.0', 6379, ETH0, 9999)],
    },
    expected: 'conflict',
    port: 6379,
    check: (result) => assert.equal(result.ports[0]?.conflicts.length, 1),
  },
  {
    name: 'conflict②：`listenAddress` 不是本插件会写的两种（绑在某个具体网卡地址上）',
    item: {
      name: 'conflict②',
      ports: '0.0.0.0:6379->6379/tcp',
      managed: [singlePort(6379)],
      scopes: LAN_6379,
      rules: [rule('10.0.0.5', 6379, ETH0, 6379)],
    },
    expected: 'conflict',
    port: 6379,
    check: (result) => assert.equal(result.ports[0]?.conflicts[0]?.listenAddress, '10.0.0.5'),
  },
  // ── extra ─────────────────────────────────────────────────────────────
  {
    name: 'extra①：声明集合里有 7000、规则也在，但 docker 已不再映射它',
    item: {
      name: 'extra①',
      ports: '0.0.0.0:6379->6379/tcp',
      managed: [singlePort(6379), singlePort(7000)],
      scopes: LAN_6379,
      rules: [ruleToEth0(6379), ruleToEth0(7000)],
    },
    expected: 'extra',
    port: 7000,
    check: (result) => {
      const one = result.ports.find((item) => item.port === 7000);
      assert.equal(one?.expected, null, 'extra 没有期望项（docker 已不再映射）');
      assert.equal(one?.reason, 'no-docker-mapping');
    },
  },
  {
    name: 'extra②（边界）：一个容器都没有（docker 全停）时，声明过的端口带规则 ⇒ extra',
    item: { name: 'extra②', managed: [singlePort(9100)], rules: [ruleToEth0(9100)] },
    expected: 'extra',
    port: 9100,
  },
];

for (const row of ROWS) {
  test(`T2.1 ${row.name}`, () => {
    const result = runCase(row.item);
    const one = result.ports.find((item) => item.port === row.port);
    assert.ok(one !== undefined, `端口 ${String(row.port)} 应当有一条归类`);
    assert.equal(one.state, row.expected);
    assert.equal(result.counts[row.expected] >= 1, true);
    row.check?.(result);
  });
}

test('T2.1 边界：`scopeMismatch` 是**事实位**而不是 conflict —— 声明 loopback 而规则监听 0.0.0.0', () => {
  // 这一条钉住本次的口径判断：若判成 conflict，005 REQ-1.3 的「conflict 不得修改或删除」
  // 会让用户永远删不掉本机那 19 条 0.0.0.0 的既有规则（写路径被锁死）。
  const result = runCase({
    name: 'scopeMismatch',
    ports: '0.0.0.0:6379->6379/tcp',
    managed: [singlePort(6379)],
    rules: [ruleToEth0(6379, '0.0.0.0')],
  });
  const one = result.ports[0];
  assert.equal(one?.state, 'ok', 'connectAddress 正确 ⇒ 不是 conflict');
  assert.equal(one?.scopeMismatch, true, '但「比声明更宽」这件事必须被如实标出');
  assert.equal(result.counts.conflict, 0);
});

test('T2.1 边界：`ok` 也不许掩盖 —— 同一端口两条规则全都指向 eth0 时仍是 ok', () => {
  const result = runCase({
    name: 'ok③',
    ports: '0.0.0.0:6379->6379/tcp',
    managed: [singlePort(6379)],
    scopes: LAN_6379,
    rules: [ruleToEth0(6379), ruleToEth0(6379)],
  });
  assert.equal(result.ports[0]?.state, 'ok');
  assert.equal(result.ports[0]?.rules.length, 2);
});

test('T2.1 边界：docker 映射区间 ∩ 声明区间 —— `5002-5003` 两条期望项，绝不展开声明集合其它成员', () => {
  const result = runCase({
    name: '区间',
    ports: '0.0.0.0:5002-5003->5002-5003/tcp',
    managed: [{ start: 1000, end: 6000 }],
    scopes: { '5002': 'lan', '5003': 'lan' },
  });
  assert.deepEqual(
    result.expected.map((item) => [item.port, item.containerPort]),
    [
      [5002, 5002],
      [5003, 5003],
    ],
    '声明了 5001 个端口、docker 只映射了 2 个 ⇒ 期望集只能是那 2 个（REQ-16.2：先求交，不枚举声明集合）',
  );
  assert.deepEqual(
    result.ports.map((item) => item.state),
    ['missing', 'missing'],
  );
});

test('T2.1 边界：映射区间与声明区间**不相交** ⇒ 零期望项（求交不是「有交集就整段收下」）', () => {
  const result = runCase({
    name: '不相交',
    ports: '0.0.0.0:5002-5003->5002-5003/tcp',
    managed: [{ start: 1000, end: 3000 }],
  });
  assert.deepEqual(result.expected, []);
  assert.deepEqual(result.ports, []);
});

test('T2.1 边界：映射区间**横跨**声明的两个区间 ⇒ 只收交集中的那些端口（不越界一格）', () => {
  const result = runCase({
    name: '横跨',
    ports: '0.0.0.0:5002-5006->5002-5006/tcp',
    managed: [
      { start: 5002, end: 5003 },
      { start: 5005, end: 9000 },
    ],
    scopes: { '5002': 'lan', '5003': 'lan', '5005': 'lan', '5006': 'lan' },
  });
  assert.deepEqual(
    result.expected.map((item) => [item.port, item.containerPort]),
    [
      [5002, 5002],
      [5003, 5003],
      [5005, 5005],
      [5006, 5006],
    ],
    '5004 不在声明集合里 ⇒ 不许出现；容器侧端口必须随宿主端口 1:1 平移',
  );
});

test('T2.1 边界：docker 发布了端口但不在声明集合内 ⇒ 零期望项、零归类（所有权边界）', () => {
  const result = runCase({ name: '集合外', ports: '0.0.0.0:6379->6379/tcp', managed: [singlePort(8080)] });
  assert.deepEqual(result.expected, []);
  assert.deepEqual(result.ports, []);
});

test('T2.2 [REQ-3.2] 真机 fixture：19 条里只声明 8080 ⇒ 集合外的 18 条既不进五态、也不计 conflict', () => {
  const rules = parsePortproxyTable(fixtureText('netsh-portproxy-v4tov4.raw'));
  const containers = parseDockerPsJsonl(fixtureText('docker-ps.redacted.jsonl'));
  // 注入一条「形态最可疑」的集合外规则：绑具体网卡地址 + 指向别的地址
  const injected = rule('10.0.0.5', 12345, '192.168.1.50', 12345);

  const outcome = diff({
    containers,
    managedPorts: [singlePort(8080)],
    rules: [...rules, injected],
    eth0Ip: ETH0,
    localhostForwarding: true,
    scopes: { '8080': 'lan' },
  });
  assert.ok(outcome.ok);

  assert.deepEqual(outcome.result.ports.map((item) => [item.port, item.state]), [[8080, 'ok']]);
  assert.equal(outcome.result.counts.conflict, 0, '集合外规则**不得**被算成 conflict（REQ-3.2/4.1）');
  assert.equal(outcome.result.external.length, 19, '18 条既有 + 1 条注入的，全在只读清单里');
  assert.deepEqual(
    outcome.result.external.map((item) => item.rule.listenPort).includes(12345),
    true,
  );
  assert.equal(outcome.result.external.every((item) => item.reason === 'port-not-managed'), true);
});

test('T2.4 [REQ-9.2] UDP / SCTP 标「不支持」，且**不生成**期望转发项', () => {
  const containers = [
    container('svc-udp-1', '0.0.0.0:5353->5353/udp, [::]:5353->5353/udp, 0.0.0.0:5353->5353/tcp'),
    container('svc-sctp-1', '0.0.0.0:9999->9999/sctp'),
    container('svc-export-only-1', '8081/udp'),
  ];
  const outcome = diff({
    containers,
    managedPorts: [singlePort(5353)],
    rules: [],
    eth0Ip: ETH0,
    localhostForwarding: true,
  });
  assert.ok(outcome.ok);
  const { unsupported, expected, ports } = outcome.result;

  assert.equal(unsupported.length, 4, 'udp 两条（v4/v6）+ sctp 一条 + 未发布的 udp 一条');
  assert.equal(unsupported.filter((item) => item.protocol === 'udp').length, 3);
  assert.equal(unsupported.filter((item) => item.protocol === 'sctp').length, 1);
  assert.equal(
    unsupported.find((item) => item.containerName === 'svc-export-only-1')?.hostPort,
    null,
    'REQ-9.2「不许直接忽略该映射」—— 连未发布的 udp 也要标出来',
  );
  assert.equal(unsupported.every((item) => item.reason === 'portproxy-tcp-only'), true);

  assert.deepEqual(
    expected.map((item) => [item.port, item.protocol]),
    [[5353, 'tcp']],
    '同一个端口上 tcp 可转、udp 不可转：只有 tcp 进期望集',
  );
  assert.deepEqual(ports.map((item) => item.port), [5353]);
});
