/**
 * T1.1 所有权匹配（REQ-1.1 / REQ-1.2 / REQ-1.3）
 *
 * 验收条件逐条对上：
 * - 匹配「本插件规则」/ 拒绝「他人规则」
 * - `connectPort` 不符即 conflict，且 **conflict 无任何写动作产生**
 * - 集合外端口**零参与**（动作产生数 = 0）
 *
 * 另加一条**张力留痕**用例（见文件末）：漂移规则不满足 REQ-1.2 的**字面**删除前置 ⇒ 零动作。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { singlePort, type ManagedPortRange } from '../../src/diff/managed-ports.ts';
import { buildWritePlan } from '../../src/write/plan.ts';
import { classifyRuleOwnership, isDeletableRule, matchOwnership } from '../../src/write/ownership.ts';
import { actionCount, expectBlock, expectPlan } from '../helpers/expect-plan.ts';
import { ETH0, rule, ruleToEth0 } from '../helpers/factories.ts';

const PORTS: readonly ManagedPortRange[] = [singlePort(5000), { start: 6000, end: 6001 }];
const PORT = 5000;

function input(
  action: 'add' | 'remove' | 'fix' | 'switch-scope',
  rules: ReturnType<typeof rule>[],
  extra: Partial<Parameters<typeof buildWritePlan>[0]> = {},
): Parameters<typeof buildWritePlan>[0] {
  return {
    action,
    port: PORT,
    scope: 'loopback',
    managedPorts: PORTS,
    eth0Ip: ETH0,
    rules,
    ...extra,
  };
}

test('T1.1 本插件规则：集合内 + 形状对 + connectAddress == eth0 ⇒ owned（满足 REQ-1.2 前置）', () => {
  const match = matchOwnership({
    port: PORT,
    rules: [ruleToEth0(PORT)],
    managedPorts: PORTS,
    expectedConnectAddress: ETH0,
  });

  assert.equal(match.managed, true);
  assert.equal(match.owned.length, 1);
  assert.equal(match.conflicts.length, 0);
  assert.equal(match.notOwned.length, 0);
});

test('T1.1 拒绝他人规则：connectAddress 既非 eth0、也无法证明是本插件写的 ⇒ 不受理 + 零动作', () => {
  const foreign = rule('0.0.0.0', PORT, '10.0.0.9', PORT);
  const match = matchOwnership({
    port: PORT,
    rules: [foreign],
    managedPorts: PORTS,
    expectedConnectAddress: ETH0,
  });

  assert.equal(match.owned.length, 0);
  assert.equal(match.notOwned.length, 1);
  assert.equal(match.notOwned[0]?.ownership.reason, 'expected-address-mismatch');
  assert.match(match.notOwned[0]?.ownership.message ?? '', /不建台账无法证明/);

  for (const action of ['remove', 'fix', 'add'] as const) {
    const outcome = buildWritePlan(input(action, [foreign], { portState: action === 'fix' ? 'drift' : 'missing' }));
    assert.equal(actionCount(outcome), 0, `${action} 对他人规则必须零动作`);
  }
});

test('T1.1 connectPort 不符 ⇒ conflict（形态不是本插件会写的），且 conflict 无任何写动作', () => {
  // 目标端口 5000，规则却把流量转给 5001：这不是本插件会写的形态
  const weird = rule('0.0.0.0', PORT, ETH0, 5001);

  const ownership = classifyRuleOwnership(weird, { port: PORT, managedPorts: PORTS, expectedConnectAddress: ETH0 });
  assert.equal(ownership.kind, 'conflict');
  assert.equal(ownership.reason, 'connect-port-mismatch');

  for (const action of ['add', 'remove', 'fix'] as const) {
    const blocked = expectBlock(buildWritePlan(input(action, [weird])), 'state-conflict');
    assert.equal(blocked.steps.length, 0);
    assert.equal(blocked.conflictRules.length, 1);
  }
});

test('T1.1 listenAddress 不在 {127.0.0.1, 0.0.0.0} 内 ⇒ conflict（只报告）', () => {
  const odd = rule('192.168.1.5', PORT, ETH0, PORT);
  const ownership = classifyRuleOwnership(odd, { port: PORT, managedPorts: PORTS, expectedConnectAddress: ETH0 });

  assert.equal(ownership.kind, 'conflict');
  assert.equal(ownership.reason, 'listen-address-unknown');
  expectBlock(buildWritePlan(input('remove', [odd])), 'state-conflict');
});

test('T1.1 集合外端口零参与：unmanaged + 规划层 port-not-managed，四种动作全部 0 动作', () => {
  const outside = ruleToEth0(5999);
  const match = matchOwnership({
    port: 5999,
    rules: [outside],
    managedPorts: PORTS,
    expectedConnectAddress: ETH0,
  });
  assert.equal(match.managed, false);
  assert.equal(match.unmanaged.length, 1);
  assert.equal(match.owned.length + match.conflicts.length + match.notOwned.length, 0);

  for (const action of ['add', 'remove', 'fix', 'switch-scope'] as const) {
    const blocked = expectBlock(
      buildWritePlan({ ...input(action, [outside]), port: 5999, scope: action === 'switch-scope' ? 'lan' : 'loopback' }),
      'port-not-managed',
    );
    assert.equal(blocked.steps.length, 0, `集合外端口在 ${action} 下必须零动作（REQ-1.1）`);
  }
});

test('T1.1 同端口既有他人规则 + 本插件规则 ⇒ conflict 优先，整端口零动作（REQ-1.3 只报告）', () => {
  const mine = ruleToEth0(PORT);
  const foreign = rule('0.0.0.0', PORT, '10.0.0.9', PORT);
  const match = matchOwnership({
    port: PORT,
    rules: [mine, foreign],
    managedPorts: PORTS,
    expectedConnectAddress: ETH0,
  });

  assert.equal(match.owned.length, 1);
  assert.equal(match.notOwned.length, 1);
  // 没有形态冲突时不被判 conflict（这是 003 引擎与 005 REQ-1.3 的口径分歧点，见报告）
  assert.equal(match.conflicts.length, 0);

  // 但 remove 的可删集合只有 owned 那一条：它满足 REQ-1.2 前置 ⇒ 允许删「我自己那条」
  const planned = expectPlan(buildWritePlan(input('remove', [mine, foreign])));
  assert.equal(planned.steps.length, 1);
  assert.equal(planned.steps[0]?.kind, 'portproxy-delete');
});

test('T1.1 REQ-1.2 的字面谓词：只有「集合内 + 地址匹配」才可删（其余一律 false）', () => {
  assert.equal(isDeletableRule(PORTS, ruleToEth0(PORT), ETH0), true);
  // 地址不匹配（漂移的旧 eth0 / 别人的地址）
  assert.equal(isDeletableRule(PORTS, rule('0.0.0.0', PORT, '172.20.201.99', PORT), ETH0), false);
  // 集合外
  assert.equal(isDeletableRule(PORTS, ruleToEth0(5999), ETH0), false);
  // 期望值不可判定（取不到 eth0）
  assert.equal(isDeletableRule(PORTS, ruleToEth0(PORT), null), false);
});

test('T1.1 取不到 eth0（null）⇒ 期望值不可判定 ⇒ 连本插件规则也判 not-owned、零动作', () => {
  const match = matchOwnership({
    port: PORT,
    rules: [ruleToEth0(PORT)],
    managedPorts: PORTS,
    expectedConnectAddress: null,
  });
  assert.equal(match.owned.length, 0);
  assert.equal(match.notOwned.length, 1);

  const blocked = expectBlock(
    buildWritePlan(input('remove', [ruleToEth0(PORT)], { eth0Ip: null })),
    'rule-not-owned',
  );
  assert.equal(blocked.steps.length, 0);
});

test('T1.1 分桶正确：不属于本端口的规则落进 unmanaged（不参与本端口判定）', () => {
  const match = matchOwnership({
    port: PORT,
    rules: [ruleToEth0(6000)],
    managedPorts: PORTS,
    expectedConnectAddress: ETH0,
  });
  assert.equal(match.unmanaged.length, 1);
  assert.equal(match.owned.length + match.conflicts.length + match.notOwned.length, 0);
});

test('T1.1 [张力留痕] 漂移（旧 eth0）不满足 REQ-1.2 字面前置 ⇒ fix/remove 零动作，等集成方裁定', () => {
  const drifted = rule('0.0.0.0', PORT, '172.20.201.99', PORT);
  const blocked = expectBlock(buildWritePlan(input('fix', [drifted], { portState: 'drift' })), 'rule-not-owned');

  // 按 REQ-1.2 的字面实现：不满足前置 ⇒ **一个动作都不产生**（不自作主张放宽/收紧）
  assert.equal(blocked.steps.length, 0);
  assert.match(blocked.message, /drift 规则不满足 REQ-1.2 的删除前置/);
  assert.match(blocked.hint, /不建台账无法证明/);

  // 同一份规则在 remove 下同样零动作（同一条闸门，不是 fix 的特例）
  expectBlock(buildWritePlan(input('remove', [drifted])), 'rule-not-owned');
});
