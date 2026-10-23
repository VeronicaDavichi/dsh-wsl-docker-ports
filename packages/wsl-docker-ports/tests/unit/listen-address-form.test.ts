/**
 * 012 验收期缺陷 F1（2026-10-23 主子真机反馈）：**本插件自己写出来的规则，写侧判成 `state-conflict`**
 *
 * ## 复现（真机原样）
 *
 * ```
 * listenAddress=192.168.31.129  listenPort=3306  connectAddress=172.20.201.152  connectPort=3306
 * POST /dsh-wsl-docker-ports/write/plan { action: 'fix', ports: [3306], scope: 'lan' }
 *   ⇒ ports[0].blocked.reason = 'state-conflict'
 *     message: listenAddress=192.168.31.129 不在本插件会写的 {127.0.0.1, 0.0.0.0} 内：只报告不改动
 * ```
 * 同一条规则在页面快照里是 `ok`（读侧 012 已把「候选清单里的 IP」认作我方形态）⇒ 两套口径自相矛盾。
 *
 * ## 修复口径（判据唯一：`diff/listen-allowed.ts:isOurListenAddress`）
 *
 * 本插件形态 = `{127.0.0.1, 0.0.0.0}` ∪ 该端口配置登记的地址 ∪ 候选清单里的 IP；读写两侧共用
 * 同一份 allowed（组装点 `allowedListenAddressesFor`）。本文件逐条钉死：
 *
 * ① 配置登记过 `192.168.31.129` ⇒ `fix` / `remove` 都**不再** `state-conflict`；
 * ② 未登记、也不在候选清单的 `10.9.9.9` ⇒ **仍** `state-conflict` 且零步骤（不放宽成「任何 IPv4」）；
 * ③ 候选清单**读失败** ⇒ 只认配置值，`fix` / `remove` 仍可执行（不因读不到网卡而 503）；
 *    重写的就是规则自己那条地址 ⇒ 不新增暴露面（`add` 仍然 fail-closed ⇒ 503，一个字没放宽）；
 * ④ 默认形态 `0.0.0.0` / `127.0.0.1` 逐字节不变（含「候选清单零探测」）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diff, isOurListenAddress } from '../../src/diff/engine.ts';
import { allowedListenAddressesFor, describeAllowedListenAddresses } from '../../src/diff/listen-allowed.ts';
import { singlePort } from '../../src/diff/managed-ports.ts';
import type { PortproxyRule } from '../../src/read/netsh.ts';
import type { LocalAddressEntry } from '../../src/read/local-addresses.ts';
import { createPlanChannel } from '../../src/transport/plan.ts';
import type { PlanFacts, PlanResponse } from '../../src/transport/plan.ts';
import { buildWritePlan } from '../../src/write/plan.ts';
import type { WritePlanInput } from '../../src/write/types.ts';
import { expectBlock, expectPlan } from '../helpers/expect-plan.ts';
import { ETH0, container, rule } from '../helpers/factories.ts';

const LAN_IP = '192.168.31.129';
const PORT = 3306;
const PORTS = [singlePort(PORT)];
const CANDIDATES: readonly LocalAddressEntry[] = [{ address: LAN_IP, ifAlias: '以太网 4', prefixLength: 24 }];

/** 真机那条规则的原样（本插件 012 写出来的 `lan + 具体 IP` 形态） */
function realRule(): PortproxyRule {
  return rule(LAN_IP, PORT, ETH0, PORT);
}

function input(
  action: 'add' | 'remove' | 'fix' | 'switch-scope',
  rules: readonly PortproxyRule[],
  extra: Partial<WritePlanInput> = {},
): WritePlanInput {
  return { action, port: PORT, scope: 'loopback', managedPorts: PORTS, eth0Ip: ETH0, rules, ...extra };
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 配置登记过 ⇒ 算「我方形态」，fix / remove 都不再被 conflict 挡住
// ─────────────────────────────────────────────────────────────────────────────

test('① 配置里登记过的监听地址 ⇒ fix 不再 state-conflict（删旧建新两步、地址原样）', () => {
  const drifted = rule(LAN_IP, PORT, '172.20.201.99', PORT);
  const plan = expectPlan(
    buildWritePlan(
      input('fix', [drifted], {
        scope: 'lan',
        portState: 'drift',
        listenAddress: LAN_IP,
        // 真实装配（`transport/plan-port.ts`）会同时给：选择门的候选清单 + 形态判据的事实
        allowedListenAddresses: [LAN_IP],
        listenForms: { configured: LAN_IP, candidates: [LAN_IP] },
      }),
    ),
  );

  assert.deepEqual(plan.steps.map((step) => step.kind), ['portproxy-delete', 'portproxy-add'], '先删旧地址再按新地址重建');
  assert.equal(plan.steps[0]?.params['listenaddress'], LAN_IP, '删的是规则**自己**那条地址');
  assert.equal(plan.steps[1]?.params['listenaddress'], LAN_IP, '重建的监听地址 = 配置登记的那个（不许悄悄退回 0.0.0.0）');
  assert.equal(plan.steps[1]?.params['connectaddress'], ETH0, '新地址 = 当前 eth0（这才是 drift 要修的东西）');
  assert.equal(plan.scope, 'lan', '作用域沿用既有规则（具体网卡 IP 属 lan，见 `scopeFromRules` 的 2026-10-23 修正）');
  console.log(`  · ① fix ${LAN_IP} ⇒ ${plan.steps.map((step) => step.kind).join('+')}，address=${LAN_IP}`);
});

test('① 续：同一条规则 remove 正常删除（连本插件防火墙放行一起），ready + 零 conflict', () => {
  const plan = expectPlan(buildWritePlan(input('remove', [realRule()], { listenForms: { configured: LAN_IP } })));

  assert.deepEqual(plan.steps.map((step) => step.kind), ['portproxy-delete', 'firewall-delete'], 'lan 形态 ⇒ 连带删本插件那条放行');
  assert.match(plan.steps[0]?.commandText ?? '', /listenaddress=192\.168\.31\.129/u, '脚本按 plan.scope=lan 删的就是这条地址');
  assert.equal(plan.scope, 'lan');
  console.log(`  · ① remove ⇒ ${plan.steps.map((step) => step.kind).join('+')}`);
});

test('① 续：真机那次请求原样重放 ⇒ 不再有任何 blocked（`{action:"fix",ports:[3306],scope:"lan"}`）', async () => {
  const probe = factsOf({ persisted: { [PORT]: LAN_IP }, rules: [realRule()], candidates: () => Promise.resolve(CANDIDATES) });
  const only = single(await planOf(probe.facts, 'fix'));

  assert.equal(only.ready, true, '缺陷原文的请求体：修复后必须是可执行计划');
  assert.equal(only.blocked, undefined, '修复前这里是 reason=state-conflict');
  assert.deepEqual(only.steps.map((step) => step.kind), ['portproxy-delete', 'portproxy-add']);
  console.log(`  · ① 重放 fix ⇒ ready=${String(only.ready)}，steps=${String(only.steps.length)}，blocked=none`);
});

test('① 续：读侧同一条规则仍是 ok（两侧口径现在一致，不再是「快照 ok / 计划 conflict」）', () => {
  const outcome = diff({
    containers: [container('mysql-db', '0.0.0.0:3306->3306/tcp')],
    managedPorts: PORTS,
    rules: [realRule()],
    eth0Ip: ETH0,
    localhostForwarding: true,
    scopes: { [String(PORT)]: 'lan' },
    // 真机场景：配置登记了该地址；候选清单可能读不到（这里同时验证「只认配置值」）
    listenAddresses: { [String(PORT)]: LAN_IP },
    allowedListenAddresses: [],
  });
  assert.ok(outcome.ok, '前置：eth0 已知');
  const row = outcome.result.ports[0];
  assert.equal(row?.state, 'ok', '配置登记过的地址 ⇒ 我方形态 ⇒ ok');
  assert.deepEqual(row?.conflicts, [], '不许再判 conflict');
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 真正的外来形态仍然拦住（红线不放宽：「任何合法 IPv4」不经允许）
// ─────────────────────────────────────────────────────────────────────────────

test('② 未登记且不在候选清单的 10.9.9.9 ⇒ 仍 state-conflict、零写入（fix / remove 都拦）', () => {
  const foreign = rule('10.9.9.9', PORT, '172.20.201.99', PORT);
  const forms = { configured: LAN_IP, candidates: [LAN_IP] } as const;

  const fixBlocked = expectBlock(buildWritePlan(input('fix', [foreign], { portState: 'drift', listenForms: forms })), 'state-conflict');
  assert.deepEqual(fixBlocked.steps, [], 'conflict = 零写动作');
  assert.match(fixBlocked.message, /不在本插件会写的监听地址集合内/u);
  assert.match(fixBlocked.message, /127\.0\.0\.1 \/ 0\.0\.0\.0 \/ 192\.168\.31\.129/u, '消息要把「集合里有什么」说清楚（能自证）');

  const removeBlocked = expectBlock(
    buildWritePlan(input('remove', [rule('10.9.9.9', PORT, ETH0, PORT)], { listenForms: forms })),
    'state-conflict',
  );
  assert.deepEqual(removeBlocked.steps, []);
  assert.equal(removeBlocked.conflictRules.length, 1);

  // 读侧同一口径：两个来源都没有 ⇒ still conflict（010 的既有红线一词未改）
  assert.equal(isOurListenAddress('10.9.9.9', allowedListenAddressesFor(forms)), false);
  console.log(`  · ② 10.9.9.9 ⇒ fix=${String(fixBlocked.reason)} / remove=${String(removeBlocked.reason)}，steps=0`);
});

test('② 续：候选清单里的地址（未登记）也算我方形态 —— 候选那条路没有被关掉', () => {
  const other = '10.0.0.7';
  const plan = expectPlan(
    buildWritePlan(input('remove', [rule(other, PORT, ETH0, PORT)], { listenForms: { candidates: [other, LAN_IP] } })),
  );
  assert.equal(plan.steps[0]?.params['listenaddress'], other);
  assert.equal(describeAllowedListenAddresses([other]), `127.0.0.1 / 0.0.0.0 / ${other}`, '文案顺序 = 默认值 + 额外');
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 候选清单读失败 ⇒ 只认配置值，不误拦、不 503
// ─────────────────────────────────────────────────────────────────────────────

interface FactsProbe {
  readonly facts: PlanFacts;
  readonly count: () => number;
}

function factsOf(options: {
  readonly persisted?: Readonly<Record<string, number | string>>;
  readonly rules: readonly PortproxyRule[];
  readonly candidates?: (() => Promise<readonly LocalAddressEntry[]>) | undefined;
}): FactsProbe {
  let calls = 0;
  const persisted = options.persisted ?? {};
  const facts: PlanFacts = {
    managedPorts: () => PORTS,
    eth0Ip: () => Promise.resolve(ETH0),
    rules: () => Promise.resolve(options.rules),
    elevation: () => ({ policy: 'none', backend: 'gsudo', available: true }),
    listenAddresses: (port: number) => {
      const value = persisted[String(port)];
      return typeof value === 'string' ? value : undefined;
    },
    ...(options.candidates === undefined
      ? {}
      : {
          localAddresses: () => {
            calls += 1;
            return options.candidates?.() ?? Promise.resolve([]);
          },
        }),
  };
  return { facts, count: () => calls };
}

async function planOf(facts: PlanFacts, action: 'add' | 'fix' | 'remove', portState?: 'drift'): Promise<PlanResponse> {
  const result = await createPlanChannel(facts)({
    action,
    ports: [PORT],
    scope: 'lan',
    ...(portState === undefined ? {} : { portState }),
  });
  assert.equal(result.ok, true, '计划通道的成功形态是 ok:true（拦下不是错误，读失败才是 503）');
  return result.ok ? (result.payload as PlanResponse) : ({} as PlanResponse);
}

function single(response: PlanResponse): NonNullable<PlanResponse['ports'][0]> {
  const only = response.ports[0];
  assert.ok(only !== undefined, '必须恰好有一个端口的结果');
  return only;
}

test('③ 候选清单**读失败** ⇒ 只认配置值：remove 仍 ready（不 503、不 conflict），且一次都不探测', async () => {
  const probe = factsOf({
    persisted: { [PORT]: LAN_IP },
    rules: [realRule()],
    candidates: () => Promise.reject(new Error('powershell-missing')),
  });
  const only = single(await planOf(probe.facts, 'remove'));

  assert.equal(only.ready, true, '删除一条监听 192.168.31.129 的规则，跟「网卡清单读不到」无关 ⇒ 不许拦');
  assert.equal(only.blocked, undefined, '不该出现任何 blocked');
  assert.deepEqual(only.steps.map((step) => step.kind), ['portproxy-delete', 'firewall-delete']);
  assert.equal(probe.count(), 0, 'remove 只需要「规则自己那条地址」⇒ 候选清单零探测');
  console.log(`  · ③ remove（候选读失败）⇒ ready=${String(only.ready)}，探测 ${String(probe.count())} 次`);
});

test('③ 续：候选清单读失败时 fix **重写规则自己那条地址**仍可执行（地址不退化，只是不碰防火墙）', async () => {
  const probe = factsOf({
    persisted: { [PORT]: LAN_IP },
    rules: [rule(LAN_IP, PORT, '172.20.201.99', PORT)],
    candidates: () => Promise.reject(new Error('powershell-missing')),
  });
  const only = single(await planOf(probe.facts, 'fix', 'drift'));

  assert.equal(only.ready, true, '重写已有地址不新增暴露面 ⇒ 不该因为读不到候选清单而 503');
  assert.deepEqual(only.steps.map((step) => step.kind), ['portproxy-delete', 'portproxy-add']);
  assert.match(only.steps[1]?.commandText ?? '', /listenaddress=192\.168\.31\.129/u, '地址必须原样重写，不许退回 0.0.0.0');
  assert.equal(only.steps.some((step) => step.kind === 'firewall-add'), false, 'fix 不动防火墙放行（脚本按动作派发，这里只重建规则）');
  console.log(`  · ③ fix（候选读失败）⇒ ${only.steps.map((step) => step.kind).join('+')} @ ${LAN_IP}`);
});

test('③ 续：**写一个具体的地址**（add）仍 fail-closed ⇒ 503，不把「读不到」当「没网卡」', async () => {
  const probe = factsOf({
    persisted: { [PORT]: LAN_IP },
    rules: [],
    candidates: () => Promise.reject(new Error('powershell-missing')),
  });
  const result = await createPlanChannel(probe.facts)({ action: 'add', ports: [PORT], scope: 'lan' });
  assert.equal(result.ok, false, '这一条是 012 的原判据，本次一个字都没放宽');
  console.log(`  · ③ 对照：add ⇒ ${result.ok ? 'ok（错）' : result.code}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 默认形态逐字节不变
// ─────────────────────────────────────────────────────────────────────────────

test('④ 默认 0.0.0.0 / 127.0.0.1：命令原文与 010 一致（配置里有值也不影响）', () => {
  const forms = { configured: LAN_IP } as const;

  const lan = expectPlan(buildWritePlan(input('remove', [rule('0.0.0.0', PORT, ETH0, PORT)], { listenForms: forms })));
  assert.equal(lan.steps[0]?.commandText, `netsh interface portproxy delete v4tov4 listenport=${String(PORT)} listenaddress=0.0.0.0`);
  assert.deepEqual(lan.steps.map((step) => step.kind), ['portproxy-delete', 'firewall-delete']);

  const loop = expectPlan(
    buildWritePlan(input('remove', [rule('127.0.0.1', PORT, ETH0, PORT)], { scope: 'lan', listenForms: forms })),
  );
  assert.equal(loop.steps[0]?.commandText, `netsh interface portproxy delete v4tov4 listenport=${String(PORT)} listenaddress=127.0.0.1`);
  assert.deepEqual(loop.steps.map((step) => step.kind), ['portproxy-delete'], 'loopback 形态不连带删防火墙（010 口径）');

  // fix 一条 0.0.0.0 漂移规则：重建仍是 0.0.0.0（配置里有 192.168.31.129 也不许悄悄改地址）
  const fixed = expectPlan(
    buildWritePlan(
      input('fix', [rule('0.0.0.0', PORT, '172.20.201.99', PORT)], { portState: 'drift', listenForms: forms }),
    ),
  );
  assert.deepEqual(fixed.steps[1]?.params, { listenport: PORT, listenaddress: '0.0.0.0', connectport: PORT, connectaddress: ETH0 });
  assert.equal('remoteAddress' in (fixed.steps[1]?.params ?? {}), false, '没选具体 IP ⇒ 一条 -RemoteAddress 都不许有');
});

test('④ 续：默认形态走计划通道时**候选清单零探测**（懒读判据照旧成立）', async () => {
  const probe = factsOf({ persisted: { [PORT]: LAN_IP }, rules: [rule('0.0.0.0', PORT, ETH0, PORT)], candidates: () => Promise.resolve(CANDIDATES) });
  const only = single(await planOf(probe.facts, 'remove'));
  assert.equal(only.ready, true);
  assert.equal(probe.count(), 0, '0.0.0.0 属默认形态 ⇒ 不需要候选清单');
});
