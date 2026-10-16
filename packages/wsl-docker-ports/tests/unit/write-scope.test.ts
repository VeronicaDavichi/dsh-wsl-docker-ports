/**
 * T1.3 scope 切换序列 + T1.5 `localhostForwarding=false` 的差异说明
 *
 * T1.3 验收条件（逐字）：
 * - `loopback → lan` 产生「portproxy add + 防火墙 add」**顺序**
 * - `lan → loopback` 产生「两条 delete」
 * - 默认值为 `loopback`
 * - 断言切 lan **不是隐式批量**
 *
 * T1.5 验收条件：`localhostForwarding=false` 时 `loopback` 也生成显式规则，
 * 且文案含差异说明（**不静默**）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { singlePort } from '../../src/diff/managed-ports.ts';
import { buildWritePlan, resolveScope, scopeFromRules } from '../../src/write/plan.ts';
import { explainScope, needsExplicitRule } from '../../src/write/scope-note.ts';
import { commandsOf, expectBlock, expectPlan, portsTouched, stepKinds } from '../helpers/expect-plan.ts';
import { ETH0, ruleToEth0 } from '../helpers/factories.ts';

const PORTS = [singlePort(5000), singlePort(5001), singlePort(5002)];

test('T1.3 默认作用域是 loopback（缺省即最保守）', () => {
  assert.equal(resolveScope(undefined, 5000), 'loopback');
  assert.equal(resolveScope({}, 5000), 'loopback');
  assert.equal(resolveScope({ '5000': 'lan' }, 5000), 'lan');
  assert.equal(resolveScope({ '5000': 'lan' }, 5001), 'loopback');
});

test('T1.3 loopback → lan：恰好「portproxy add + 防火墙 add」，顺序固定', () => {
  const planned = expectPlan(
    buildWritePlan({
      action: 'switch-scope',
      port: 5000,
      scope: 'lan',
      fromScope: 'loopback',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
      localhostForwarding: true,
    }),
  );

  assert.deepEqual(stepKinds(planned), ['portproxy-add', 'firewall-add']);
  assert.match(commandsOf(planned, 'portproxy-add')[0] ?? '', /listenaddress=0\.0\.0\.0/);
  assert.match(commandsOf(planned, 'firewall-add')[0] ?? '', /-LocalPort 5000\b/);
});

test('T1.3 切 lan 不是隐式批量：只碰被显式指定的那一个端口', () => {
  const planned = expectPlan(
    buildWritePlan({
      action: 'switch-scope',
      port: 5002,
      scope: 'lan',
      fromScope: 'loopback',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
    }),
  );

  assert.deepEqual(portsTouched(planned), [5002], '声明集合里还有 5000/5001，但它们一个动作都不能有');
  for (const step of planned.steps) assert.equal(step.port, 5002);
});

test('T1.3 lan → loopback：两条 delete（portproxy 先、防火墙后）', () => {
  const planned = expectPlan(
    buildWritePlan({
      action: 'switch-scope',
      port: 5000,
      scope: 'loopback',
      fromScope: 'lan',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [ruleToEth0(5000, '0.0.0.0')],
    }),
  );

  assert.deepEqual(stepKinds(planned), ['portproxy-delete', 'firewall-delete']);
  assert.match(commandsOf(planned, 'portproxy-delete')[0] ?? '', /listenport=5000/);
  assert.match(commandsOf(planned, 'portproxy-delete')[0] ?? '', /listenaddress=0\.0\.0\.0/);
  assert.equal(commandsOf(planned, 'firewall-delete')[0], 'Get-NetFirewallRule -Group "dsh-wsl-docker-ports" | Where-Object { $_.DisplayName -eq "dsh-wsl-docker-ports-5000" } | Remove-NetFirewallRule');
});

test('T1.3 lan → loopback 只删自己建的防火墙规则：明确知道没有同名规则时不产生删除动作', () => {
  const planned = expectPlan(
    buildWritePlan({
      action: 'switch-scope',
      port: 5000,
      scope: 'loopback',
      fromScope: 'lan',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [ruleToEth0(5000, '0.0.0.0')],
      existingFirewallNames: [],
    }),
  );

  assert.deepEqual(stepKinds(planned), ['portproxy-delete']);
});

test('T1.3 已是目标作用域 ⇒ 拦下且零动作（不做无意义的隐式切换）', () => {
  const blocked = expectBlock(
    buildWritePlan({
      action: 'switch-scope',
      port: 5000,
      scope: 'lan',
      fromScope: 'lan',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [ruleToEth0(5000, '0.0.0.0')],
    }),
    'state-precondition',
  );

  assert.equal(blocked.steps.length, 0);
  assert.match(blocked.message, /已经是 lan 作用域/);
  assert.match(blocked.hint, /逐端口显式操作/);
});

test('T1.3 fromScope 缺省时按既有规则推断（0.0.0.0 ⇒ lan）', () => {
  assert.equal(scopeFromRules([ruleToEth0(5000, '0.0.0.0')]), 'lan');
  assert.equal(scopeFromRules([ruleToEth0(5000, '127.0.0.1')]), 'loopback');
  assert.equal(scopeFromRules([]), 'loopback');
});

test('T1.3 切换时若同端口有无法证明归属的规则 ⇒ 拦下（切换会清另一作用域的残留，故必须先证明）', () => {
  const blocked = expectBlock(
    buildWritePlan({
      action: 'switch-scope',
      port: 5000,
      scope: 'lan',
      fromScope: 'loopback',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [{ listenAddress: '127.0.0.1', listenPort: 5000, connectAddress: '10.0.0.9', connectPort: 5000 }],
    }),
    'rule-not-owned',
  );
  assert.equal(blocked.steps.length, 0);
});

test('T1.5 localhostForwarding=true：loopback 无需规则 ⇒ 显示说明且**不添加**任何规则（REQ-2.2）', () => {
  const planned = expectPlan(
    buildWritePlan({
      action: 'add',
      port: 5000,
      scope: 'loopback',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
      localhostForwarding: true,
    }),
  );

  assert.equal(planned.steps.length, 0, 'REQ-2.2：SHALL NOT 为该端口添加规则');
  assert.match(planned.notes.join(' '), /无需 portproxy 规则/);
});

test('T1.5 localhostForwarding=false：loopback 也生成显式规则（127.0.0.1），且文案含差异说明', () => {
  const planned = expectPlan(
    buildWritePlan({
      action: 'add',
      port: 5000,
      scope: 'loopback',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
      localhostForwarding: false,
    }),
  );

  assert.deepEqual(stepKinds(planned), ['portproxy-add']);
  assert.match(commandsOf(planned, 'portproxy-add')[0] ?? '', /listenaddress=127\.0\.0\.1/);

  const notes = planned.notes.join('\n');
  assert.match(notes, /localhostForwarding=false/, '必须点明依据，不许静默');
  assert.match(notes, /loopback 也需要/);
  assert.match(notes, /与 NAT 缺省时相反/, '差异说明是 T1.5 的验收条件');
});

test('T1.5 同一判据在读侧与写侧同源：needsExplicitRule 与文案结论一致', () => {
  assert.equal(needsExplicitRule('lan', true), true);
  assert.equal(needsExplicitRule('loopback', true), false);
  assert.equal(needsExplicitRule('loopback', false), true);

  assert.equal(explainScope('loopback', true).required, false);
  assert.equal(explainScope('loopback', false).required, true);
  assert.equal(explainScope('lan', true).required, true);
  // 不确定时偏保守（需要规则）且必须警示
  assert.equal(explainScope('loopback', null).required, true);
  assert.equal(explainScope('loopback', null).warn, true);
  assert.equal(explainScope('loopback', false).warn, true);
});
