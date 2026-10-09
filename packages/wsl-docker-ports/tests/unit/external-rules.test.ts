/**
 * T2.5 [REQ-15.1 / D-2] 外部规则只读集合
 *
 * 「集合外一律不碰」的落地形式：`managedPorts` 为空时，本机那 19 条**用户真实数据**
 * 全部进只读清单，`ports` 一条都没有、`counts` 全是 0、**动作数为 0**（`assertNoFunctions`）。
 *
 * ⚠️ 判据只有「`listenPort ∉ managedPorts`」一条：本插件**不建台账**（stack-decision 定案），
 * 所以无法从规则形态上分辨「谁写的」—— 原脚本写的 19 条 connectAddress 就是 eth0，
 * 与插件写的规则长得一模一样。声明式所有权就是靠这条判据落地的。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectExternalRules, diff } from '../../src/diff/engine.ts';
import { singlePort } from '../../src/diff/managed-ports.ts';
import { parsePortproxyTable } from '../../src/read/netsh.ts';
import { assertNoFunctions } from '../helpers/assertions.ts';
import { fixtureText } from '../helpers/fake-executor.ts';
import { ETH0 } from '../helpers/factories.ts';

const rules = parsePortproxyTable(fixtureText('netsh-portproxy-v4tov4.raw'));

/** 本机 19 条既有规则（用户数据，只读展示） */
const ALL_PORTS = [
  80, 443, 3000, 3128, 5000, 5001, 5002, 5003, 5173, 5432, 6379, 8080, 8194, 9000, 9001, 18080, 30808, 38080,
  50051,
];

test('T2.5 真机 fixture：`managedPorts` 为空 ⇒ 19 条全是外部规则，零五态、零计数、零动作', () => {
  const outcome = diff({
    containers: [],
    managedPorts: [],
    rules,
    eth0Ip: ETH0,
    localhostForwarding: true,
  });
  assert.ok(outcome.ok);
  assertNoFunctions(outcome);

  assert.deepEqual(outcome.result.ports, [], '一端口都没声明 ⇒ 没有任何五态归类');
  assert.deepEqual(outcome.result.counts, { ok: 0, missing: 0, drift: 0, conflict: 0, extra: 0 });
  assert.deepEqual([...outcome.result.external.map((item) => item.rule.listenPort)].sort((a, b) => a - b), ALL_PORTS);
  assert.equal(outcome.result.external.every((item) => item.reason === 'port-not-managed'), true);
  assert.deepEqual(outcome.result.expected, []);
  assert.deepEqual(outcome.result.unsupported, []);
});

test('T2.5 [REQ-15.1] 每条外部规则都给出 `监听地址:端口 → 目标地址:端口` 的展示串', () => {
  const external = collectExternalRules(rules, []);
  const first = external[0];
  assert.ok(first !== undefined);
  assert.equal(first.display, '0.0.0.0:80 → 172.20.201.152:80');
  assert.equal(
    external.every((item) => item.display === `${item.rule.listenAddress}:${String(item.rule.listenPort)} → ${item.rule.connectAddress}:${String(item.rule.connectPort)}`),
    true,
  );
});

test('T2.5 边界：声明集合 ⊆ 现有端口 ⇒ 只有集合内的端口进五态，其余仍是只读清单', () => {
  const outcome = diff({
    containers: [],
    managedPorts: [singlePort(5000), singlePort(6379)],
    rules,
    eth0Ip: ETH0,
    localhostForwarding: true,
    scopes: { '5000': 'lan', '6379': 'lan' },
  });
  assert.ok(outcome.ok);

  assert.deepEqual(
    outcome.result.ports.map((item) => [item.port, item.state]),
    [
      [5000, 'extra'],
      [6379, 'extra'],
    ],
    '声明了、规则也在、但 docker 没映射 ⇒ extra（不是外部规则）',
  );
  assert.equal(outcome.result.external.length, ALL_PORTS.length - 2);
  assert.equal(outcome.result.counts.extra, 2);
  assert.equal(outcome.result.counts.conflict, 0);
});

test('T2.5 边界：没有任何既有规则 ⇒ 空清单（UI 据此不渲染该区域），不报错也不造数据', () => {
  const outcome = diff({
    containers: [],
    managedPorts: [singlePort(6379)],
    rules: [],
    eth0Ip: ETH0,
    localhostForwarding: true,
  });
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.result.external, []);
});
