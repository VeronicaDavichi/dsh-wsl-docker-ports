/**
 * 008 T2.7 [REQ-6.2] 红线单测 —— 断言对象 = **008 自己的执行层**（`src/transport/**`）
 *
 * 判据（`specs/008-write-transport/tasks.md` 的 T2.7 与其 2026-10-12 子项）：
 * ① **无 `portproxy reset`**：008 生成的每条命令原文（add / remove / 两种作用域）逐条断言 ——
 *    连 `reset` 这个词都不出现，且 `portproxy <动词>` 只允许 `add` / `delete`；
 * ② **无通配符防火墙**：每条 `New-NetFirewallRule` 都带**具体** `-LocalPort <本步端口>`，
 *    且 005 的 SSoT 谓词 `looksLikeWildcardAllow()` 判 false；
 * ③ **集合外零动作**：集合外端口 ⇒ 空 `steps` + `planId:null`，apply 零提权、零审计、系统逐字节不变；
 * ④ 真下发的 argv（008 交给执行器的那一份）同样逐个端口核对。
 *
 * 🔴 **为什么另立一份、不蹭别人的守卫**：003 的 `redline-guards.test.ts` 扫的是 005 的
 * `src/write/**` + `src/elevate/**` 的**实现文本**，005 的 `elevate-script.test.ts` 断言的是
 * **脚本模板**；T2.7 子项要求的是「**008 的通道把什么交给了执行器**」——命令原文（给人看）
 * 与 argv（真下发）两侧都得由本 Spec 自己记账，别人的用例不能替 008 记账。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ManagedPorts } from '../../src/diff/managed-ports.ts';
import type { PortproxyRule } from '../../src/read/netsh.ts';
import { createPlanChannel } from '../../src/transport/plan.ts';
import type { PlanFacts, PlanResponse } from '../../src/transport/plan.ts';
import { looksLikeWildcardAllow } from '../../src/write/firewall.ts';
import type { WriteStep } from '../../src/write/types.ts';
import { GSUDO_CHOICE } from '../helpers/fake-elevation.ts';
import { srcSources } from '../helpers/src-scan.ts';
import { OTHER, createRig, planOk, refusalOf, reportOf, textOf, ticketOf } from './transport-apply-rig.ts';

const ETH0 = '172.20.201.152';
/** 声明集合（含一个区间端口段，用来覆盖多端口规划） */
const MANAGED: ManagedPorts = [
  { start: 5000, end: 5003 },
  { start: 5900, end: 5900 },
];

function factsOf(rules?: (port: number) => readonly PortproxyRule[]): PlanFacts {
  return {
    managedPorts: () => MANAGED,
    eth0Ip: () => Promise.resolve(ETH0),
    rules: (port) => Promise.resolve(rules?.(port) ?? []),
    elevation: () => ({ policy: 'ask', backend: 'gsudo', available: true }),
    // `false` = loopback 也要显式规则 ⇒ 每个端口都至少一步（让下面的断言不会空转成假绿）
    localhostForwarding: () => false,
  };
}

async function planOfTarget(facts: PlanFacts, target: unknown): Promise<PlanResponse> {
  const outcome = await createPlanChannel(facts)(target);
  assert.equal(outcome.ok, true, '只读计划通道不该给通道级错误');
  return outcome.payload as PlanResponse;
}

/** 一条属于本插件、满足 REQ-1.2 前置的既有规则（`remove` 腿的输入） */
function ownedRule(port: number): PortproxyRule {
  return { listenAddress: '0.0.0.0', listenPort: port, connectAddress: ETH0, connectPort: port };
}

/** REQ-6.2：命令文本里不得有清空/导出/改设置形态；`portproxy <动词>` 只允许 add / delete */
function assertNoClearVerb(what: string, text: string): void {
  assert.equal(/\breset\b/iu.test(text), false, `${what}：不得出现 reset —— ${text}`);
  for (const match of text.matchAll(/portproxy\s+(\w+)/giu)) {
    const verb = (match[1] ?? '').toLowerCase();
    assert.ok(['add', 'delete'].includes(verb), `${what}：portproxy 动词只允许 add / delete，实际 ${verb} —— ${text}`);
  }
}

test('T2.7 ① 无 `portproxy reset`：008 生成的每条命令原文（add / remove / 两种作用域）逐条断言', async () => {
  const add = await planOfTarget(factsOf(), { action: 'add', ports: [5000, 5003, 5900], scope: 'lan' });
  const remove = await planOfTarget(factsOf((port) => [ownedRule(port)]), { action: 'remove', ports: [5000, 5900], scope: 'lan' });
  const loopback = await planOfTarget(factsOf(), { action: 'add', ports: [5900], scope: 'loopback' });
  const steps: readonly WriteStep[] = [add, remove, loopback]
    .flatMap((response) => response.ports)
    .flatMap((port) => port.steps);

  // 防呆：四类命令都真出现过，否则下面的循环会空转
  for (const kind of ['portproxy-add', 'portproxy-delete', 'firewall-add', 'firewall-delete'] as const) {
    assert.ok(steps.some((step) => step.kind === kind), `本用例必须覆盖 ${kind}`);
  }
  for (const step of steps) {
    assert.ok(step.commandText.length > 0, `${step.kind} 必须给出命令原文（REQ-3.2 展示用）`);
    assertNoClearVerb(`${step.kind}:${String(step.port)}`, step.commandText);
  }
  for (const [name, response] of [['add', add], ['remove', remove], ['loopback', loopback]] as const) {
    assertNoClearVerb(`${name} 整单 commandText`, response.commandText);
  }
  console.log(`  · 扫了 ${String(steps.length)} 条命令原文：零 reset、动词集合收在 {add, delete}`);

  // 元断言（负对照）：判据本身必须能判红，否则上面的循环可能是在空转
  assert.throws(() => assertNoClearVerb('负对照', 'netsh interface portproxy reset'), /reset/u);
  assert.throws(() => assertNoClearVerb('负对照', 'netsh interface portproxy dump'), /动词/u);
});

test('T2.7 ② 无通配符防火墙：每条 New-NetFirewallRule 都带具体 -LocalPort = 本步端口', async () => {
  const add = await planOfTarget(factsOf(), { action: 'add', ports: [5000, 5003, 5900], scope: 'lan' });
  const firewallSteps = add.ports.flatMap((port) => port.steps).filter((step) => step.kind === 'firewall-add');
  assert.equal(firewallSteps.length, 3, '三个 lan 端口各一条放行 ⇒ 断言不会空转');

  for (const step of firewallSteps) {
    assert.match(step.commandText, /^New-NetFirewallRule /u);
    const localPort = /-LocalPort\s+(\S+)/u.exec(step.commandText);
    assert.notEqual(localPort, null, `必须带 -LocalPort：${step.commandText}`);
    assert.equal(Number(localPort?.[1]), step.port, `-LocalPort 必须是本步端口的具体数字：${step.commandText}`);
    assert.equal(step.params['localPort'], step.port, '结构化参数同样必须是数字端口（不是区间 / Any）');
    assert.equal(looksLikeWildcardAllow(step.commandText), false, `SSoT 谓词判成了通配符放行：${step.commandText}`);
    assert.equal(step.commandText.includes('*'), false, `命令原文不得含 *：${step.commandText}`);
    assert.equal(/-DisplayName "dsh-wsl-docker-ports-\d+"/u.test(step.commandText), true, '规则名必须带端口（可识别、可单独清理）');
  }
  console.log(`  · 扫了 ${String(firewallSteps.length)} 条防火墙放行：-LocalPort 全是具体端口`);

  // 元断言（负对照）：SSoT 谓词对真通配形态必须判 true，且通配值不可能等于端口号
  assert.equal(looksLikeWildcardAllow('New-NetFirewallRule -LocalPort Any'), true);
  assert.equal(looksLikeWildcardAllow('New-NetFirewallRule -LocalPort 5000-5003'), true);
  assert.equal(looksLikeWildcardAllow('New-NetFirewallRule -LocalPort *'), true);
  const wildcardValue = /-LocalPort\s+(\S+)/u.exec('New-NetFirewallRule -LocalPort Any')?.[1];
  assert.ok(Number.isNaN(Number(wildcardValue)), '通配值转数字必须是 NaN ⇒ 上面对 step.port 的比较会当场判红');
});

test('T2.7 ③ 集合外零动作：空 steps + planId:null，apply 零提权、零审计、系统逐字节不变', async () => {
  const rig = createRig();
  const target = { action: 'add', ports: [OTHER], scope: 'lan' } as const;
  const outcome = await rig.planChannel(target);
  assert.equal(outcome.ok, true, '集合外不是通道级错误（是「拦下」）');
  const response = outcome.payload as PlanResponse;

  assert.equal(response.ready, false);
  assert.equal(response.planId, null, '集合外 ⇒ 没有可执行的票据');
  assert.equal(response.ports[0]?.blocked?.reason, 'port-not-managed');
  assert.deepEqual(response.ports[0]?.steps, [], '被拦下必须零步骤（REQ-1.2）');
  assert.equal(response.commandText, '', '整单也不得有任何命令原文');

  const before = rig.rules.map((rule) => ({ ...rule }));
  const refusal = refusalOf(
    await rig.applyChannel({ target, planId: response.planId, confirmed: true, origin: 'user', ticket: 'tk-redline' }),
  );
  assert.equal(refusal.code, 'plan-mismatch', '没有可执行计划 ⇒ 连票据都签发不出来');
  assert.equal(rig.fake.calls.length, 0, '🔴 集合外 ⇒ 一个提权进程都不许起');
  assert.equal(rig.audit.size(), 0, '什么都没发生 ⇒ 不写审计');
  assert.deepEqual(rig.rules, before, '系统状态逐字节不变（别人的规则一条不动）');
});

test('T2.7 ④ 真下发的 argv：无 reset、动词收在 {add, delete}、端口集合恰好是本端口', async () => {
  const rig = createRig({ probe: GSUDO_CHOICE });
  const response = await planOk(rig);
  reportOf(
    await rig.applyChannel({
      target: { action: 'add', ports: [5900], scope: 'lan' },
      planId: response.planId,
      confirmed: true,
      origin: 'user',
      ticket: ticketOf(response),
    }),
  );

  assert.equal(rig.fake.calls.length, 1, '一次 apply = 一次提权调用');
  const call = rig.fake.calls[0];
  assert.notEqual(call, undefined, '必须真下发过一次');
  const argv = call === undefined ? '' : textOf(call);

  assertNoClearVerb('提权 argv', argv);
  assert.match(argv, /-Action['",\s]+add/u, '动作原样传到脚本');
  const ports = [...argv.matchAll(/-Port['",\s]+(\d+)/gu)].map((match) => Number(match[1]));
  assert.deepEqual(ports, [5900], '下发的端口集合恰好是本端口（别人的端口不出现）');
  assert.match(argv, /-Address['",\s]+172\.20\.201\.152/u, '连接地址 = 服务端现读的 eth0，不是客户端给的');
});

test('T2.7 ⑤ 静态侧：008 自己的 `src/transport/**` 可执行文本零 reset、零清空/导出动词', () => {
  const sources = srcSources().filter((source) => source.path.startsWith('src/transport/'));
  assert.ok(sources.length >= 8, `必须真扫到 008 的 transport 源文件，实际 ${String(sources.length)} 个`);
  for (const source of sources) {
    assert.equal(/\breset\b/iu.test(source.code), false, `${source.path} 的可执行文本里不得出现 reset`);
    assertNoClearVerb(source.path, source.code);
  }
  console.log(`  · 静态扫了 ${String(sources.length)} 个 008 源文件（去注释后）`);
});
