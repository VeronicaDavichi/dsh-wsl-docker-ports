/**
 * 008 Phase 2 判据：`createPlanFacts` 的**失败语义**（`node --test`，零真机、零进程）
 *
 * ① 🔴 **读失败必须抛**（不许静默返回空数组）—— 空数组的事实含义是「本机确实没有规则」，
 *    把「读不到」混同成「没有」会让计划漏判既有规则 ⇒ 重复/冲突动作；
 * ② **确实为空 ⇒ 空数组**（这是事实，照实往下走）；
 * ③ `eth0Ip` 取不到 ⇒ `null`（003 REQ-6.4：不可判定 ⇒ 零动作）；拿到了 ⇒ 原样透传；
 * ④ `localhostForwarding` 取不到 ⇒ `null`（**不猜 `false`**）；拿到了 ⇒ 原样；
 * ⑤ `elevation()` 恒可调（必填字段），来源缺省 ⇒ `{policy:'unknown', backend:'unknown', available:false}`；
 *    给了来源 ⇒ `backend` 原样、`available` 原样、`policy` 走配置档（**不做触发方降级**，那是执行层的活）；
 *    配置值**认不出**（`bogus` / 空串）⇒ `'unknown'`（不原样透传，否则非法值会像真的选过一样显示出来）；
 * ⑥ 声明缺省 ⇒ 空集（design §12 方案 (a)）；
 * ⑦ `firewallNames`（008 T2.6）：给了来源 ⇒ 原样转发（**读失败照样抛**，不许变成空集）；
 *    没给 ⇒ 键不存在（「该门不启用」≠「机器上没有同名规则」）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlanFacts } from '../../src/transport/real-facts.ts';
import type { PlanFactSources } from '../../src/transport/real-facts.ts';

function sources(overrides: Partial<PlanFactSources> = {}): PlanFactSources {
  return {
    rules: () => Promise.resolve([]),
    eth0Ip: () => Promise.resolve('172.20.201.152'),
    ...overrides,
  };
}

test('Phase2 ① 读失败必须抛（静默空数组 = 假装「本机没有规则」）', async () => {
  const boom = new Error('netsh 现在读不到');
  const facts = createPlanFacts(sources({ rules: () => Promise.reject(boom) }));
  await assert.rejects(() => facts.rules(5432), /netsh 现在读不到/u, '规则读失败必须冒泡给 plan.ts 的 rules-unavailable');

  const eth0Boom = createPlanFacts(sources({ eth0Ip: () => Promise.reject(boom) }));
  await assert.rejects(() => eth0Boom.eth0Ip(), /netsh 现在读不到/u, 'eth0 读失败也必须冒泡（不许悄悄变 null 以外的判断）');
});

test('Phase2 ②③④ 空规则是事实；eth0 / localhostForwarding 拿不到给 null、拿到原样透传', async () => {
  const facts = createPlanFacts(sources({ localhostForwarding: () => true as boolean | null }));
  assert.deepEqual(await facts.rules(6379), [], '确实没有规则 ⇒ 空数组（这是事实，不是降级）');
  assert.equal(await facts.eth0Ip(), '172.20.201.152');
  assert.equal(facts.localhostForwarding?.(), true, '拿到就是拿到');

  const unknownForward = createPlanFacts(sources({ localhostForwarding: () => null }));
  assert.equal(unknownForward.localhostForwarding?.(), null, '拿不到 ⇒ null（不猜 false）');

  const noForward = createPlanFacts(sources());
  assert.equal(noForward.localhostForwarding, undefined, '没给来源 ⇒ 不提供该事实（该门不启用，而不是编一个值）');
});

test('Phase2 ⑤⑥ elevation 恒可调且不做触发方降级；声明缺省 = 空集', async () => {
  const fallback = createPlanFacts(sources());
  assert.deepEqual(await fallback.elevation(), { policy: 'unknown', backend: 'unknown', available: false }, '缺省来源 ⇒ 一律不可用（不假装能提权）');

  // 🔴 接线方给的是**真探测的 Promise**（vailability.probe()）⇒ 必须被 await 到值（这正是本次修的 bug：只 peek 不触发）
  const probed = createPlanFacts(sources({ elevation: async () => ({ available: true, backend: 'gsudo' }) }));
  assert.deepEqual(await probed.elevation(), { policy: 'unknown', backend: 'gsudo', available: true }, 'Promise 来源必须被 await，而不是把 Promise 当对象读');

  const real = createPlanFacts(sources({ elevation: () => ({ available: true, backend: 'gsudo' }), elevationPolicy: 'ask' }));
  assert.deepEqual(await real.elevation(), { policy: 'ask', backend: 'gsudo', available: true });
  assert.equal((await real.elevation()).policy, 'ask', '只反映配置档 —— Agent 触发的降级归执行层（005 resolvePolicy）');

  // 🔴 认不出的配置值不许原样透传：`policy` 会显示在只读预览里，写错一个字不能看着像「用户选过了」
  for (const bogus of ['bogus', '', 'NONE', 'none ']) {
    const facts = createPlanFacts(sources({ elevationPolicy: bogus }));
    assert.equal((await facts.elevation()).policy, 'unknown', `${JSON.stringify(bogus)} 不是合法档 ⇒ unknown（执行层再落到 none）`);
  }
  const nullBackend = createPlanFacts(sources({ elevation: () => ({ available: false, backend: null }) }));
  assert.deepEqual(await nullBackend.elevation(), { policy: 'unknown', backend: 'unknown', available: false }, 'backend=null ⇒ unknown，不编造后端名');

  assert.deepEqual(fallback.managedPorts(undefined), [], '没声明 ⇒ 空集（失败方向最保守）');
  assert.deepEqual(fallback.managedPorts([{ start: 5432, end: 5432 }]), [{ start: 5432, end: 5432 }]);
});

test('Phase2 ⑦ firewallNames：原样转发；读失败照样抛；没给来源 ⇒ 键不存在（不假装空集）', async () => {
  const boom = new Error('powershell 读不到防火墙规则');
  const facts = createPlanFacts(sources({ firewallNames: () => Promise.resolve(['dsh-wsl-docker-ports-5900']) }));
  assert.deepEqual(await facts.firewallNames?.(), ['dsh-wsl-docker-ports-5900'], '给什么转发什么（本层不解读规则名）');

  const failing = createPlanFacts(sources({ firewallNames: () => Promise.reject(boom) }));
  await assert.rejects(() => failing.firewallNames?.() ?? Promise.resolve([]), /读不到防火墙规则/u, '🔴 读失败必须冒泡（不得降级成空集）');

  const missing = createPlanFacts(sources());
  assert.equal(missing.firewallNames, undefined, '没给来源 ⇒ 不提供该事实 ⇒ 存在性闸门不启用（与接线前一致）');
});
