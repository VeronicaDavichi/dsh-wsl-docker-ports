/**
 * T1.1 所有权匹配（REQ-1.1 / REQ-1.2 / REQ-1.3）
 *
 * 验收条件逐条对上：
 * - 匹配「本插件规则」/ 拒绝「他人规则」
 * - `connectPort` 不符即 conflict，且 **conflict 无任何写动作产生**
 * - 集合外端口**零参与**（动作产生数 = 0）
 *
 * 另加**裁定留痕**用例（见文件末）：2026-10-16 主人裁定 (a) —— `fix` 受理「声明端口内 + 本插件
 * listen 形态 + `connectAddress` 是合法 IPv4 且 ≠ 当前 eth0」的漂移规则（`remove` **不**放宽），
 * 并用一组边界用例钉住「放宽没有把门开成『声明端口内随便修』」。
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

test('T1.1 无法证明归属的规则：add / remove 零动作；`fix` 自 2026-10-16 裁定 (a) 起受理（**已知取舍**）', () => {
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

  // add / remove 仍零动作：不建台账 ⇒ 无法证明归属 ⇒ 不删、也不叠第二条规则
  for (const action of ['remove', 'add'] as const) {
    const outcome = buildWritePlan(input(action, [foreign], { portState: 'missing' }));
    assert.equal(actionCount(outcome), 0, `${action} 对无法证明归属的规则必须零动作`);
  }

  // 🔴 裁定 (a) 的**已知取舍**（2026-10-16 主人拍板，写在这里而不是藏起来）：声明集合内 + 本插件
  // listen 形态 + connectAddress 是合法 IPv4 且 ≠ 当前 eth0 ⇒ 视为「本插件历史写入」⇒ `fix` 受理。
  // 代价 = 无法区分「我们的旧地址规则」与「他人写在**已声明**端口上的同类规则」（不建台账）；
  // 边界 = 集合外端口零参与、非 IPv4 不受理（见文件末的边界用例）；`remove` 不受影响。
  const fixed = expectPlan(buildWritePlan(input('fix', [foreign], { portState: 'drift' })));
  assert.deepEqual(fixed.steps.map((step) => step.kind), ['portproxy-delete', 'portproxy-add']);
  assert.deepEqual(fixed.steps[0]?.params, { listenport: PORT, listenaddress: '0.0.0.0' });
  assert.deepEqual(fixed.steps[1]?.params, { listenport: PORT, listenaddress: '0.0.0.0', connectport: PORT, connectaddress: ETH0 });
  assert.equal(fixed.scope, 'lan', '作用域沿用既有规则（0.0.0.0 ⇒ lan）');
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
  assert.equal(planned.steps.length, 2, '[⑬ 2026-10-16] 作用域沿用既有规则（0.0.0.0 ⇒ lan）⇒ 步骤表也如实给 2 条');
  assert.equal(planned.steps[0]?.kind, 'portproxy-delete');
  assert.deepEqual(planned.steps[0]?.params, { listenport: PORT, listenaddress: '0.0.0.0' });
  assert.equal(planned.scope, 'lan', '[⑬] 旧口径留 input.scope（loopback）⇒ 脚本会去删 127.0.0.1（删不掉）且不删防火墙');
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

test('T1.1 [裁定 (a) 2026-10-16] 漂移规则：`fix` 受理（先删旧地址、再按当前 eth0 重建），`remove` 仍按 REQ-1.2 拦下', () => {
  const drifted = rule('0.0.0.0', PORT, '172.20.201.99', PORT);

  // 旧口径（原文留痕）：「漂移不满足 REQ-1.2 字面前置 ⇒ fix/remove 零动作，等集成方裁定」。
  // 2026-10-16 真机取证后主人裁定 (a) ⇒ `fix` 不再是死分支：两步、顺序固定、删的是**既有规则自己的**
  // listenaddress（不是通配、不是用户文本）。
  const fixed = expectPlan(buildWritePlan(input('fix', [drifted], { portState: 'drift' })));
  assert.deepEqual(fixed.steps.map((step) => step.kind), ['portproxy-delete', 'portproxy-add']);
  assert.deepEqual(fixed.steps[0]?.params, { listenport: PORT, listenaddress: '0.0.0.0' });
  assert.deepEqual(fixed.steps[1]?.params, { listenport: PORT, listenaddress: '0.0.0.0', connectport: PORT, connectaddress: ETH0 });
  assert.equal(fixed.eth0Ip, ETH0);
  assert.equal(fixed.scope, 'lan', '作用域沿用既有规则（0.0.0.0 ⇒ lan）—— 不拿 input.scope（缺省 loopback）重建，否则会悄悄降级');
  assert.match(fixed.notes.join(' '), /裁定 \(a\)/);

  // loopback 漂移：作用域同样沿用既有规则（127.0.0.1），不反升成 lan
  const loopFix = expectPlan(
    buildWritePlan(input('fix', [rule('127.0.0.1', PORT, '172.20.201.99', PORT)], { portState: 'drift' })),
  );
  assert.equal(loopFix.scope, 'loopback');
  assert.match(loopFix.notes.join(' '), /裁定 \(a\)/);

  // `remove` **不放宽**：同一条规则仍是 rule-not-owned、零动作（删除是破坏性的；要清就先 fix 再 remove）
  const blocked = expectBlock(buildWritePlan(input('remove', [drifted])), 'rule-not-owned');
  assert.equal(blocked.steps.length, 0);
});

test('T1.1 [裁定 (a)] 放宽的**边界**：六种情形仍旧不受理（门没有被开成「声明端口内随便修」）', () => {
  // ① connectAddress 不是合法 IPv4 ⇒ 历史值不可判定
  const notIp = expectBlock(buildWritePlan(input('fix', [rule('0.0.0.0', PORT, 'old-wsl-host', PORT)], { portState: 'drift' })), 'rule-not-owned');
  assert.match(notIp.hint, /合法 IPv4/);
  // ② listenAddress 不是本插件会写的形态 ⇒ conflict（连形态都不是）⇒ 整端口零动作
  expectBlock(buildWritePlan(input('fix', [rule('192.168.1.5', PORT, '172.20.201.99', PORT)], { portState: 'drift' })), 'state-conflict');
  // ③ connectPort ≠ listenPort ⇒ conflict
  expectBlock(buildWritePlan(input('fix', [rule('0.0.0.0', PORT, '172.20.201.99', 6001)], { portState: 'drift' })), 'state-conflict');
  // ④ 声明集合外 ⇒ port-not-managed（集合外零参与，裁定 (a) 没动这条红线）
  expectBlock(buildWritePlan({ ...input('fix', [ruleToEth0(5999)], { portState: 'drift' }), port: 5999 }), 'port-not-managed');
  // ⑤ 五态不是 drift ⇒ state-precondition
  expectBlock(buildWritePlan(input('fix', [rule('0.0.0.0', PORT, '172.20.201.99', PORT)], { portState: 'ok' })), 'state-precondition');
  // ⑥ 取不到 eth0 ⇒ eth0-unknown（新地址不可判定）
  expectBlock(
    buildWritePlan(input('fix', [rule('0.0.0.0', PORT, '172.20.201.99', PORT)], { portState: 'drift', eth0Ip: null })),
    'eth0-unknown',
  );
});

test('T1.1 [⑬ 2026-10-16 收口] `remove` 的作用域沿用**既有规则**（删的是那条规则自己的 listen address）', () => {
  // ① 缺省配置（input.scope = loopback）+ lan 规则：作用域必须跟规则走，否则脚本会去删 127.0.0.1
  const lanPlanned = expectPlan(buildWritePlan(input('remove', [rule('0.0.0.0', PORT, ETH0, PORT)])));
  assert.equal(lanPlanned.scope, 'lan', '旧口径 = input.scope（loopback）⇒ 脚本删错地址、且不删防火墙放行');
  assert.deepEqual(lanPlanned.steps.map((step) => step.kind), ['portproxy-delete', 'firewall-delete']);
  assert.match(lanPlanned.steps[0]?.commandText ?? '', /listenaddress=0\.0\.0\.0/);
  assert.match(lanPlanned.notes.join(' '), /作用域沿用既有规则（lan）/);

  // ② 反向：选择器给了 lan，但规则本身是 loopback ⇒ 只删回环那条、**不**删防火墙
  const loopPlanned = expectPlan(
    buildWritePlan(input('remove', [rule('127.0.0.1', PORT, ETH0, PORT)], { scope: 'lan' })),
  );
  assert.equal(loopPlanned.scope, 'loopback');
  assert.deepEqual(loopPlanned.steps.map((step) => step.kind), ['portproxy-delete']);
  assert.match(loopPlanned.steps[0]?.commandText ?? '', /listenaddress=127\.0\.0\.1/);

  // ③ 作用域跟规则走**不构成**放宽删除：所有权判据仍是 REQ-1.2 字面（漂移规则照样拦下）
  const drifted = expectBlock(buildWritePlan(input('remove', [rule('0.0.0.0', PORT, '172.20.201.99', PORT)])), 'rule-not-owned');
  assert.equal(drifted.steps.length, 0);

  // ④ 明确知道「没有同名防火墙规则」时，lan 也只删转发（与 switch-scope 的既有口径一致）
  const noFirewall = expectPlan(
    buildWritePlan(input('remove', [rule('0.0.0.0', PORT, ETH0, PORT)], { existingFirewallNames: [] })),
  );
  assert.deepEqual(noFirewall.steps.map((step) => step.kind), ['portproxy-delete']);
});
