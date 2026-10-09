/**
 * 008 T1.3 只读动作计划通道（`node --test`，零真机、零外部命令、零写调用）
 *
 * 判据：
 * ① **合法 add** ⇒ `ready:true` + `planId` 为 64 位 hex + 步骤含 `portproxy-add` + 每条 `commandText`
 *    非空且含具体端口、**无通配符**（复用 `looksLikeWildcardAllow` 交叉验证）；
 * ② **端口去重 + 升序**（`[6379,5432,6379]` ⇒ `[5432,6379]`）且单步 `port` 恒等于目标端口；
 * ③ **集合外 ⇒ `port-not-managed`**：该端 `ready:false` + **空 `steps`** + `planId:null`（没有可执行的票据）；
 * ④ **非法输入 ⇒ 空计划 + 可读原因**（200、不抛）：缺 `action` / 空 `ports` / 端口越界 / 非对象 / 畸形 problem；
 * ⑤ 🔴 **安全命门**：客户端塞的 `managedPorts` / `eth0Ip` / `rules` / `existingFirewallNames` **一律被忽略**
 *    —— 所有权与事实只认服务端现读；
 * ⑥ **`planId` 语义**：同输入稳定；`notes`/`commandText` 变化**不换 id**；步骤实质变化**必换 id**；
 * ⑦ `eth0Ip = null` ⇒ 拦成 `eth0-unknown`（不猜期望值）；现读抛异常 ⇒ `rules-unavailable`（不是 500）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ManagedPorts } from '../../src/diff/managed-ports.ts';
import type { PortproxyRule } from '../../src/read/netsh.ts';
import { looksLikeWildcardAllow } from '../../src/write/firewall.ts';
import type { WriteStep } from '../../src/write/types.ts';
import { canonicalPlanText, createPlanChannel, normalizeTarget, planIdOf, PLAN_MAX_PORTS } from '../../src/transport/plan.ts';
import type { PlanFacts, PlanResponse } from '../../src/transport/plan.ts';

const ETH0 = '172.20.201.152';
const MANAGED: ManagedPorts = [
  { start: 5432, end: 5432 },
  { start: 6379, end: 6379 },
];

interface Spy {
  readonly facts: PlanFacts;
  readonly calls: { rules: number[]; eth0: number; managed: number; firewall: number; localhost: number; elevation: number };
}

function spyFacts(overrides: Partial<PlanFacts> = {}, eth0Ip: string | null = ETH0): Spy {
  const calls = { rules: [] as number[], eth0: 0, managed: 0, firewall: 0, localhost: 0, elevation: 0 };
  const facts: PlanFacts = {
    managedPorts: () => {
      calls.managed += 1;
      return MANAGED;
    },
    eth0Ip: () => {
      calls.eth0 += 1;
      return Promise.resolve(eth0Ip);
    },
    rules: (port: number) => {
      calls.rules.push(port);
      return Promise.resolve([] as readonly PortproxyRule[]);
    },
    elevation: () => {
      calls.elevation += 1;
      return { policy: 'none', backend: 'gsudo', available: true };
    },
    ...overrides,
  };
  return { facts, calls };
}

function payloadOf(result: Awaited<ReturnType<ReturnType<typeof createPlanChannel>>>): PlanResponse {
  assert.equal(result.ok, true, '计划通道的成功形态是 ok:true（拦下不是错误）');
  return result.ok ? (result.payload as PlanResponse) : ({} as PlanResponse);
}

test('T1.3 ① 合法 add：ready + 64 位 planId + 步骤与命令原文（无通配符）', async () => {
  const spy = spyFacts();
  const plan = createPlanChannel(spy.facts);
  const response = payloadOf(await plan({ action: 'add', ports: [5432], scope: 'lan' }));

  assert.equal(response.ready, true);
  assert.match(String(response.planId), /^[0-9a-f]{64}$/, 'planId 必须是 SHA-256 的 hex');
  assert.equal(response.ports.length, 1);
  const only = response.ports[0];
  assert.equal(only?.port, 5432);
  assert.equal(only?.ready, true);
  assert.ok((only?.steps.length ?? 0) >= 1, 'lan 作用域至少要产生一条 portproxy 步骤');
  assert.ok(only?.steps.some((step) => step.kind === 'portproxy-add'), '必须含 portproxy-add');
  assert.ok(only?.steps.some((step) => step.kind === 'firewall-add'), 'lan 必须不含防火墙步骤才怪（REQ-2.3 次序）');
  for (const step of only?.steps ?? []) {
    assert.equal(step.port, 5432, '每步 port 必须等于目标端口（只动本端口）');
    assert.ok(step.commandText.length > 0, 'commandText 必须给出来（REQ-3.2 展示命令原文）');
    assert.ok(!step.commandText.includes('*'), `命令原文不得含通配符：${step.commandText}`);
    assert.equal(looksLikeWildcardAllow(step.commandText), false, '交叉验证：不是通配符放行');
  }
  assert.equal(response.commandText, only?.commandText, '整单命令原文 = 各端口拼接');
  assert.equal(response.elevation.backend, 'gsudo', 'REQ-3.1：预览必须显示提权后端');
  console.log(`  · 5432/lan ⇒ ${String(only?.steps.length ?? 0)} 步；planId=${String(response.planId).slice(0, 12)}…`);
});

test('T1.3 ② 端口去重 + 升序；apply 之外的动作也能规划', async () => {
  const spy = spyFacts();
  const plan = createPlanChannel(spy.facts);
  const response = payloadOf(await plan({ action: 'add', ports: [6379, 5432, 6379], scope: 'loopback' }));

  assert.deepEqual(
    response.ports.map((item) => item.port),
    [5432, 6379],
    '去重且升序 ⇒ planId 与展示都稳定',
  );
  assert.deepEqual(spy.calls.rules, [5432, 6379], '只对被请求的端口现读规则，且按升序');
  assert.equal(response.planId?.length, 64);

  // 规范化本身的语义（不经过算法）
  const normalized = normalizeTarget({ action: 'remove', port: 8080, scope: 'lan' });
  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.deepEqual(normalized.target.ports, [8080], '单个 port 字段也收');
    assert.equal(normalized.target.scope, 'lan');
    assert.equal(normalized.target.action, 'remove');
  }
});

test('T1.3 ③ 集合外端口 ⇒ port-not-managed：空 steps + planId:null（无票据可用）', async () => {
  const spy = spyFacts();
  const plan = createPlanChannel(spy.facts);
  const response = payloadOf(await plan({ action: 'add', ports: [9999], scope: 'lan' }));

  assert.equal(response.ready, false);
  assert.equal(response.planId, null, '只要有一端不可执行，整单不给 planId');
  const blocked = response.ports[0]?.blocked;
  assert.equal(response.ports[0]?.steps.length, 0, '被拦下必须零步骤（REQ-1.2/1.3）');
  assert.equal(blocked?.reason, 'port-not-managed');
  assert.ok((blocked?.message.length ?? 0) > 0, '必须给可读原因（不静默）');
  assert.ok((blocked?.hint.length ?? 0) > 0, '必须给修复提示');
  assert.deepEqual(blocked?.conflictRules, [], '只报告冲突规则，不动它们');
});

test('T1.3 ④ 非法输入 ⇒ 空计划 + 可读原因（200、不抛）', async () => {
  const spy = spyFacts();
  const plan = createPlanChannel(spy.facts);
  const cases: [unknown, RegExp][] = [
    [undefined, /目标必须是对象/],
    ['nope', /目标必须是对象/],
    [{ ports: [5432] }, /action 必须是/],
    [{ action: 'nuke', ports: [5432] }, /action 必须是/],
    [{ action: 'add', ports: [] }, /非空数组/],
    [{ action: 'add', ports: [0] }, /1\.\.65535/],
    [{ action: 'add', ports: [70000] }, /1\.\.65535/],
    [{ action: 'add', ports: ['5432'] }, /1\.\.65535/],
    [{ action: 'add', ports: [5432], scope: 'wan' }, /scope 必须是/],
    [{ action: 'switch-scope', ports: [5432], scope: 'lan' }, /必须给 fromScope/],
  ];
  for (const [raw, expected] of cases) {
    const response = payloadOf(await plan(raw));
    assert.equal(response.ready, false, `非法输入必须 ready:false：${JSON.stringify(raw) ?? 'undefined'}`);
    assert.equal(response.planId, null);
    assert.deepEqual(response.ports, [], '非法输入 ⇒ 一个端口都不规划');
    assert.match(response.notes.join(' '), expected, `原因必须可读：${JSON.stringify(raw) ?? 'undefined'}`);
    assert.equal(response.blockedReason, response.notes[0]);
  }

  // 端口数上限（有界工作量）
  const tooMany = { action: 'add', ports: Array.from({ length: PLAN_MAX_PORTS + 1 }, (_v, index) => 1000 + index), scope: 'lan' };
  assert.match(payloadOf(await plan(tooMany)).notes.join(' '), /最多 256 个端口/);

  // 路由传来的 problem（畸形/超限）⇒ 空计划 + 该原因，且**不做任何现读**
  const malformed = payloadOf(await plan(undefined, '请求体不是合法 JSON：…'));
  assert.equal(malformed.ready, false);
  assert.match(malformed.notes.join(' '), /不是合法 JSON/);
  assert.equal(spy.calls.eth0, 0, '畸形请求不得现读 eth0');
  assert.ok(spy.calls.elevation >= 1, '每次请求读一次提权状态（预览要显示它）');
  assert.deepEqual(spy.calls.rules, [], '畸形请求不得现读规则');
});

test('T1.3 ⑤ 🔴 安全命门：客户端塞的 managedPorts / eth0Ip / rules / 防火墙名一律被忽略', async () => {
  const spy = spyFacts();
  const plan = createPlanChannel(spy.facts);
  const forged = {
    action: 'add',
    ports: [9999],
    scope: 'lan',
    managedPorts: [{ start: 1, end: 65535 }],
    eth0Ip: '10.0.0.1',
    rules: [],
    existingFirewallNames: ['随便'],
    commands: ['netsh interface portproxy reset'],
  };
  const response = payloadOf(await plan(forged));

  assert.equal(response.ready, false, '伪造 managedPorts 不能把 9999 变成「我管的」');
  assert.equal(response.ports[0]?.blocked?.reason, 'port-not-managed', '所有权只认服务端现读的声明集合');
  assert.deepEqual(spy.calls.rules, [9999], '规则也只走服务端现读');

  const legit = payloadOf(await plan({ action: 'add', ports: [5432], scope: 'lan', eth0Ip: '10.0.0.1' }));
  const step = legit.ports[0]?.steps.find((item) => item.kind === 'portproxy-add');
  assert.equal(step?.params['connectaddress'], ETH0, 'connectaddress 必须用服务端现读的 eth0，而不是客户端给的');
});

test('T1.3 ⑥ planId 语义：稳定 / 忽略文案 / 实质变化必换 id', async () => {
  const spy = spyFacts();
  const plan = createPlanChannel(spy.facts);
  const first = payloadOf(await plan({ action: 'add', ports: [5432], scope: 'lan' }));
  const second = payloadOf(await plan({ action: 'add', ports: [5432], scope: 'lan' }));
  assert.equal(first.planId, second.planId, '同输入必须稳定');

  const steps: readonly WriteStep[] = [
    { kind: 'portproxy-add', port: 5432, params: { listenport: 5432, connectaddress: ETH0 }, commandText: 'A' },
  ];
  const base = { action: 'add' as const, scope: 'lan' as const, ports: [{ port: 5432, ready: true, steps }] };
  const textA = canonicalPlanText(base);
  const textB = canonicalPlanText(base);
  assert.equal(textA, textB);
  assert.equal(planIdOf(base), planIdOf(base));

  // 文案变化（notes 不进规范文本 ⇒ 同一份 base 就代表这一点；这里再钉一次实现细节）
  assert.equal(textA.includes('commandText'), false, '规范文本不得含 commandText');
  assert.equal(textA.includes('notes'), false, '规范文本不得含 notes');

  // 实质变化 ⇒ 必换 id
  const changedParams: readonly WriteStep[] = [
    { kind: 'portproxy-add', port: 5432, params: { listenport: 5432, connectaddress: '10.0.0.1' }, commandText: 'A' },
  ];
  const moved = { ...base, ports: [{ port: 5432, ready: true, steps: changedParams }] };
  assert.notEqual(planIdOf(base), planIdOf(moved), 'connectaddress 变了 ⇒ planId 必须变');

  const otherPort = { ...base, ports: [{ port: 6379, ready: true, steps }] };
  assert.notEqual(planIdOf(base), planIdOf(otherPort), '端口变了 ⇒ planId 必须变');

  const notReady = { ...base, ports: [{ port: 5432, ready: false, steps: [] as readonly WriteStep[] }] };
  assert.notEqual(planIdOf(base), planIdOf(notReady), '能不能执行变了 ⇒ planId 必须变');
});

test('T1.3 ⑦ eth0 取不到 ⇒ eth0-unknown（不猜）；现读抛异常 ⇒ rules-unavailable（不是 500）', async () => {
  const noEth0 = spyFacts({}, null);
  const planA = createPlanChannel(noEth0.facts);
  const response = payloadOf(await planA({ action: 'add', ports: [5432], scope: 'lan' }));
  assert.equal(response.ready, false, 'eth0 未知时不得产生任何动作（003 REQ-6.4）');
  assert.equal(response.planId, null);
  assert.equal(response.ports[0]?.blocked?.reason, 'eth0-unknown');
  assert.equal(response.ports[0]?.steps.length, 0);

  const boom = spyFacts({
    rules: () => Promise.reject(new Error('netsh 挂了')),
  });
  const planB = createPlanChannel(boom.facts);
  const failed = await planB({ action: 'add', ports: [5432], scope: 'lan' });
  assert.equal(failed.ok, false, '现读失败是通道级错误（503），不是计划里的拦下');
  if (!failed.ok) {
    assert.equal(failed.code, 'rules-unavailable');
    assert.match(failed.message, /netsh 挂了/);
    assert.match(failed.message, /未产生任何动作/);
  }
});
