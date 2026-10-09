/**
 * T1.2 防火墙参数生成（REQ-2.3 / REQ-2.6）
 *
 * 验收条件：**无通配端口、无全量放行**；同名已存在 → 报错（不覆盖）。
 * 这两条都要能被机器判 —— 所以既有正向断言（参数就是那个端口），也有反向断言
 * （`looksLikeWildcardAllow` 判据本身 + 生成文本里不出现 `Any` 作为端口）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { singlePort } from '../../src/diff/managed-ports.ts';
import {
  buildFirewallAddStep,
  buildFirewallDeleteStep,
  FIREWALL_GROUP,
  firewallAllowArgs,
  firewallNameExists,
  firewallRuleName,
  looksLikeWildcardAllow,
} from '../../src/write/firewall.ts';
import { buildWritePlan } from '../../src/write/plan.ts';
import { actionCount, commandsOf, expectBlock, expectPlan, stepKinds } from '../helpers/expect-plan.ts';
import { ETH0 } from '../helpers/factories.ts';

const PORTS = [singlePort(5000)];

test('T1.2 放行参数：就是该端口一个数字，方向/动作/协议/配置/分组逐项写死', () => {
  const args = firewallAllowArgs(5000);

  assert.deepEqual(args, {
    displayName: 'dsh-wsl-docker-ports-5000',
    direction: 'Inbound',
    action: 'Allow',
    protocol: 'TCP',
    localPort: 5000,
    profile: 'Any',
    group: FIREWALL_GROUP,
  });
  assert.equal(firewallRuleName(5000), 'dsh-wsl-docker-ports-5000');
  assert.equal(firewallRuleName(5000), `${FIREWALL_GROUP}-5000`);
});

test('T1.2 命令原文：`-LocalPort 5000` 是具体数字，且不含任何通配/全量放行形态', () => {
  const step = buildFirewallAddStep(5000);

  assert.match(step.commandText, /New-NetFirewallRule/);
  assert.match(step.commandText, /-LocalPort 5000\b/);
  assert.match(step.commandText, /-Direction Inbound -Action Allow -Protocol TCP/);
  assert.equal(looksLikeWildcardAllow(step.commandText), false);
  // 反向自证判据本身有效：通配/区间必须被它认出来
  assert.equal(looksLikeWildcardAllow('New-NetFirewallRule -LocalPort Any'), true);
  assert.equal(looksLikeWildcardAllow('New-NetFirewallRule -LocalPort 5000-5003'), true);
  assert.equal(looksLikeWildcardAllow('New-NetFirewallRule -LocalPort *'), true);
});

test('T1.2 生成文本里只出现本端口一个端口号（其余端口一个都不放行）', () => {
  const step = buildFirewallAddStep(5000);
  const numbers = step.commandText.match(/\b\d{2,5}\b/g) ?? [];

  assert.deepEqual([...new Set(numbers)], ['5000']);
});

test('T1.2 同名已存在 ⇒ 报错不覆盖（lan 的 add 被拦下、零动作）', () => {
  const outcome = buildWritePlan({
    action: 'add',
    port: 5000,
    scope: 'lan',
    managedPorts: PORTS,
    eth0Ip: ETH0,
    rules: [],
    existingFirewallNames: ['DSH-WSL-DOCKER-PORTS-5000'],
  });

  const blocked = expectBlock(outcome, 'firewall-rule-exists');
  assert.equal(blocked.steps.length, 0);
  assert.match(blocked.message, /已存在：报错，不覆盖/);
});

test('T1.2 同名判定大小写不敏感 + 容忍两侧空白（Windows 规则名比较如此）', () => {
  assert.equal(firewallNameExists(5000, ['  dsh-wsl-docker-ports-5000 ']), true);
  assert.equal(firewallNameExists(5000, ['DSH-WSL-DOCKER-PORTS-5000']), true);
  assert.equal(firewallNameExists(5000, ['dsh-wsl-docker-ports-5001']), false);
});

test('T1.2 lan 的放行步骤在 portproxy 之后（先建规则再开门，顺序即安全）', () => {
  const planned = expectPlan(
    buildWritePlan({ action: 'add', port: 5000, scope: 'lan', managedPorts: PORTS, eth0Ip: ETH0, rules: [] }),
  );

  assert.deepEqual(stepKinds(planned), ['portproxy-add', 'firewall-add']);
  assert.equal(commandsOf(planned, 'firewall-add').length, 1);
});

test('T1.2 删除只按 DisplayName（不按端口扫、不按组全删）', () => {
  const step = buildFirewallDeleteStep(5000);

  assert.equal(step.kind, 'firewall-delete');
  assert.deepEqual(step.params, { displayName: 'dsh-wsl-docker-ports-5000' });
  assert.equal(step.commandText, 'Remove-NetFirewallRule -DisplayName "dsh-wsl-docker-ports-5000"');
});

test('T1.2 端口参数非法一律拒（0 / 越界 / 非整数 / NaN）', () => {
  for (const bad of [0, 65536, 5000.5, Number.NaN]) {
    assert.throws(() => buildFirewallAddStep(bad), RangeError, `端口 ${String(bad)} 必须被拒`);
    assert.throws(() => buildFirewallDeleteStep(bad), RangeError);
  }
});

test('T1.2 放行只有一个入口：不存在「放行一段/全部」的 API（源码级自证）', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../src/write/firewall.ts', import.meta.url), 'utf8');

  // 反向证据：模块里没有「按范围放行」的实现痕（只有单端口）
  assert.equal(/localPort:\s*['"]/.test(source), false, 'localPort 必须是 number，不能是字符串（防 Any/区间）');
  assert.equal(source.includes('-LocalPort Any'), false, '生成器里不允许出现通配端口形态');
  assert.equal(looksLikeWildcardAllow(source), false, '整个模块的文本都不允许命中通配判据');
});

test('T1.2 未给 existingFirewallNames 时该门不启用（不假装知道防火墙现状）', () => {
  const planned = expectPlan(
    buildWritePlan({ action: 'add', port: 5000, scope: 'lan', managedPorts: PORTS, eth0Ip: ETH0, rules: [] }),
  );
  assert.equal(actionCount(planned), 2);

  // 给了空列表 = 明确知道「没有同名规则」⇒ 照常放行
  const planned2 = expectPlan(
    buildWritePlan({
      action: 'add',
      port: 5000,
      scope: 'lan',
      managedPorts: PORTS,
      eth0Ip: ETH0,
      rules: [],
      existingFirewallNames: [],
    }),
  );
  assert.equal(actionCount(planned2), 2);
});
