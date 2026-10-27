/**
 * T3.5 [REQ-16.3] 接管转移：重叠端口从**外部只读清单**移入**五态**，且不两处同时出现
 *
 * ## 这条证明的关键
 *
 * 引擎**一行都没改**（本任务不改 `engine.ts`）：接管不是「点一下清单里的某条规则」触发的，
 * 而是由配置声明集合驱动 —— `listenPort ∈ managedPorts` 就进五态（`classifyPorts`），
 * `∉` 就留在只读清单（`collectExternalRules`）。两个函数读的是**同一个** `isManagedPort` 判据，
 * 所以「移入」与「从清单消失」是同一件事的两面，不可能只发生一半。
 *
 * 每个用例都对照两组输入（未声明 / 声明）—— 只有对照才能证明是「**移入**」，
 * 而不是「那个端口本来就不在清单里」。
 *
 * ## 真机 fixture
 *
 * 本机 19 条既有规则（用户真实数据）在 `tests/contract/fixtures/netsh-portproxy-v4tov4.raw`，
 * 走真解析器读入 —— 离线、零真机、零写操作。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectExternalRules, diff } from '../../src/diff/engine.ts';
import { isManagedPort, type ManagedPorts } from '../../src/diff/managed-ports.ts';
import { parseManagedPorts, type ManagedPortsDecl } from '../../src/diff/managed-ports-parse.ts';
import { PORT_PRESETS } from '../../src/diff/port-presets.ts';
import type { Scope } from '../../src/diff/types.ts';
import type { DockerContainer } from 'dsh-wsl-docker-core';
import { parsePortproxyTable, type PortproxyRule } from 'dsh-wsl-docker-core';
import { fixtureText } from '../helpers/fake-executor.ts';
import { container, ETH0, ruleToEth0 } from '../helpers/factories.ts';

/** 本机 19 条既有规则（用户数据，只读） */
const REAL_RULES = parsePortproxyTable(fixtureText('netsh-portproxy-v4tov4.raw'));

/** 声明 → `ManagedPorts`：一律过真解析器（证明「配置里写的那串字」也能接管，不只是手搓区间） */
function declare(decls: readonly ManagedPortsDecl[]): ManagedPorts {
  const parsed = parseManagedPorts(decls);
  assert.ok(parsed.ok, `声明应当合法：${JSON.stringify(decls)}`);
  return parsed.ports;
}

interface Scenario {
  readonly managedPorts: ManagedPorts;
  readonly rules: readonly PortproxyRule[];
  readonly containers?: readonly DockerContainer[];
  readonly scopes?: Readonly<Record<string, Scope>>;
}

/** 跑一次完整判定（eth0 已给 ⇒ 必是成功态，取 `result` 省掉每个用例的收窄样板） */
function run(scenario: Scenario) {
  const outcome = diff({
    containers: scenario.containers ?? [],
    managedPorts: scenario.managedPorts,
    rules: scenario.rules,
    eth0Ip: ETH0,
    localhostForwarding: true,
    scopes: scenario.scopes ?? {},
  });
  assert.ok(outcome.ok, 'eth0 已给 ⇒ 必是成功态');
  return outcome.result;
}

test('T3.5 [REQ-16.3] 对照：未声明时 2000 只在只读清单里（五态里没有它）', () => {
  const result = run({ managedPorts: [], rules: [ruleToEth0(2000)] });
  assert.deepEqual(result.ports, []);
  assert.deepEqual(
    result.external.map((item) => item.rule.listenPort),
    [2000],
  );
});

test('T3.5 [REQ-16.3] 声明区间 1000-3000 ⇒ 2000 从清单**移入**五态，且不双现', () => {
  const managed = declare(['1000-3000']);
  const result = run({ managedPorts: managed, rules: [ruleToEth0(2000), ruleToEth0(4000)] });

  // 移入：五态里恰好一条 2000（docker 未映射 + 规则还在 ⇒ extra，REQ-3.3「每端口恰好一条」）
  assert.deepEqual(
    result.ports.map((item) => [item.port, item.state]),
    [[2000, 'extra']],
  );
  assert.deepEqual(
    result.ports[0]?.rules.map((rule) => rule.listenPort),
    [2000],
    '原规则对象整条进了五态（证据没丢）',
  );

  // 从清单消失：外部清单里只剩区间外的 4000
  assert.deepEqual(
    result.external.map((item) => item.rule.listenPort),
    [4000],
  );

  // 不双现（一般不变式）：五态端口集合 ∩ 外部清单端口集合 = ∅，且每条规则恰好出现一次
  const inStates = new Set(result.ports.map((item) => item.port));
  assert.deepEqual(
    result.external.filter((item) => inStates.has(item.rule.listenPort)),
    [],
  );
  assert.equal(result.ports.length + result.external.length, 2, '非此即彼，绝不两处同时出现');
});

test('T3.5 [REQ-16.3] 接管边界 = 闭区间两端：1000 与 3000 都进五态，999/3001 仍是别人的', () => {
  const result = run({
    managedPorts: declare(['1000-3000']),
    rules: [ruleToEth0(999), ruleToEth0(1000), ruleToEth0(3000), ruleToEth0(3001)],
  });
  assert.deepEqual(
    result.ports.map((item) => item.port),
    [1000, 3000],
  );
  assert.deepEqual(
    result.external.map((item) => item.rule.listenPort),
    [999, 3001],
  );
});

test('T3.5 [REQ-16.3] 接管后按五态判定：有映射 + 规则正确 ⇒ ok；有映射无规则(lan) ⇒ missing', () => {
  const managed = declare(['1000-3000']);
  const containers = [container('svc-a-1', '0.0.0.0:2000->2000/tcp')];

  const withRule = run({ managedPorts: managed, rules: [ruleToEth0(2000)], containers });
  assert.deepEqual(
    withRule.ports.map((item) => [item.port, item.state]),
    [[2000, 'ok']],
  );
  assert.deepEqual(withRule.external, [], '已被接管的端口不会同时留在清单里');

  // 换成「有映射、无规则、作用域 lan」⇒ missing：证明它确实**参与**五态判定，而不只是被藏起来
  const withoutRule = run({ managedPorts: managed, rules: [], containers, scopes: { '2000': 'lan' } });
  assert.deepEqual(
    withoutRule.ports.map((item) => [item.port, item.state]),
    [[2000, 'missing']],
  );
});

test('T3.5 [REQ-16.3] 重叠区间（1000-2000 ∪ 1500-3000）下仍每端口恰好一条归类', () => {
  const result = run({
    managedPorts: declare(['1000-2000', '1500-3000']),
    rules: [ruleToEth0(1500), ruleToEth0(2000), ruleToEth0(3000)],
  });
  assert.deepEqual(
    result.ports.map((item) => item.port),
    [1500, 2000, 3000],
  );
  assert.equal(new Set(result.ports.map((item) => item.port)).size, result.ports.length, '重叠声明导致重复归类就是 bug');
  assert.deepEqual(result.external, []);
});

test('T3.5 [REQ-16.3] 真机 19 条规则：声明 9000-9001 ⇒ 恰好这两条移入五态，其余 17 条仍在清单', () => {
  const result = run({ managedPorts: declare(['9000-9001']), rules: REAL_RULES });
  assert.deepEqual(
    result.ports.map((item) => [item.port, item.state]),
    [
      [9000, 'extra'],
      [9001, 'extra'],
    ],
  );
  assert.equal(result.external.length, REAL_RULES.length - 2);
  const inStates = new Set(result.ports.map((item) => item.port));
  for (const item of result.external) assert.equal(inStates.has(item.rule.listenPort), false);
  assert.equal(result.ports.length + result.external.length, REAL_RULES.length);
});

test('T3.5 [REQ-16.2] 真机：声明 1-65535 时五态仍只有 19 条（求交不枚举 ⇒ 不会造出 6.5 万条）', () => {
  const result = run({ managedPorts: declare(['1-65535']), rules: REAL_RULES });
  assert.equal(result.ports.length, REAL_RULES.length, '归类按**规则**迭代，不按声明成员迭代');
  assert.equal(result.ports.every((item) => item.state === 'extra'), true);
  assert.deepEqual(result.external, []);
  assert.deepEqual(result.expected, [], 'docker 未映射 ⇒ 期望集为空（而不是把声明展开成 6.5 万条）');
});

test('T3.5 [REQ-16.3] 直接对 `collectExternalRules` 断言：区间命中 ⇒ 该端口从清单里消失', () => {
  const rules = [ruleToEth0(2000), ruleToEth0(4000)];
  assert.deepEqual(
    collectExternalRules(rules, []).map((item) => item.rule.listenPort),
    [2000, 4000],
  );

  const managed = declare(['1000-3000']);
  assert.equal(isManagedPort(managed, 2000), true);
  assert.deepEqual(
    collectExternalRules(rules, managed).map((item) => item.rule.listenPort),
    [4000],
    '清单的判据就是 `listenPort ∉ managedPorts`（与五态同源，不可能只移一半）',
  );
});

test('T3.5 [REQ-16.1] 非法声明导致解析失败 ⇒ 拿不到任何区间，无法「半套接管」', () => {
  const parsed = parseManagedPorts(['1000-3000', 'abc']);
  assert.ok(!parsed.ok);
  assert.deepEqual(
    parsed.issues.map((item) => [item.index, item.item]),
    [[1, 'abc']],
    '失败态指出是哪一项挡住了整次应用',
  );
  assert.equal('ports' in parsed, false, '类型层面拿不到「解析到一半」的集合 ⇒ 只能整体不接管');
});

test('T3.5 [REQ-16.4] presets 勾选 = 写进声明集合：MinIO(9000) 同样从清单移入五态', () => {
  // 勾选结果直接进 `managedPorts`（不另建存储），故 presets 走的也是上面这条接管链
  const picked = PORT_PRESETS.filter((preset) => preset.name === 'minio').map((preset) => preset.port);
  assert.deepEqual(picked, [9000]);

  const result = run({ managedPorts: declare(picked), rules: REAL_RULES });
  assert.deepEqual(
    result.ports.map((item) => item.port),
    [9000],
  );
  assert.equal(result.external.some((item) => item.rule.listenPort === 9000), false);
});
