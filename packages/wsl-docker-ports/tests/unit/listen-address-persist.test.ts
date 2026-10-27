/**
 * 012 A 计划闭环（`node --test`，零真机、零外部命令）：**选择 → 写配置 → 计划 → 提权脚本 → 放行**
 *
 * 判据（逐条对应交付报告的验收项）：
 * ① **持久化生效**：配置里 `listenAddresses['3306'] = '192.168.31.129'` ⇒ 计划里
 *    `portproxy add … listenaddress=192.168.31.129` + `firewall-add` 的 `remoteAddress=192.168.31.0/24`；
 * ② **没传 ⇒ 与今天逐字节一致**：配置空 + 请求不带 `listenAddress` ⇒ 命令原文里 `listenaddress=0.0.0.0`、
 *    无 `remoteAddress`/`-RemoteAddress`，且**候选清单探针一次都不跑**（懒加载）；
 * ③ **非法/非候选 ⇒ fail-closed**：`listen-address-invalid` + **零步骤**（绝不静默回退 `0.0.0.0`）；
 * ④ **请求覆盖优先于配置**（同一端口，两处不同值 ⇒ 以请求为准，且仍过候选门槛）；
 * ⑤ **提权脚本真的带上了它**：argv 出现 `-ListenAddress` / `-RemoteAddress` / `-DeleteAddress`，
 *    缺省时 argv 与 010 逐字相同；模板里既有 `listenaddress=$listen` 也有 `-RemoteAddress $RemoteAddress`。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ManagedPorts } from '../../src/diff/managed-ports.ts';
import type { PortproxyRule } from '../../src/read/netsh.ts';
import type { LocalAddressEntry } from '../../src/read/local-addresses.ts';
import { buildElevateScript, scriptArgs } from '../../src/elevate/script.ts';
import { scriptAddressesOf } from '../../src/elevate/invoke.ts';
import type { ScriptParams } from '../../src/elevate/types.ts';
import { createPlanChannel } from '../../src/transport/plan.ts';
import type { PlanFacts, PlanResponse } from '../../src/transport/plan.ts';
import { createSnapshotBuilder } from '../../src/snapshot.ts';
import type { WriteStep } from '../../src/write/types.ts';
import { FIXTURE_PORTS, WSL_CONFIG, WSL_CONFIG_TEXT, routingExecutor } from '../helpers/snapshot-fixtures.ts';

const ETH0 = '172.20.201.152';
const LAN_IP = '192.168.31.129';
const LAN_CIDR = '192.168.31.0/24';
const PORT = 3306;
const MANAGED: ManagedPorts = [{ start: PORT, end: PORT }];
const CANDIDATES: readonly LocalAddressEntry[] = [{ address: LAN_IP, ifAlias: '以太网 4', prefixLength: 24 }];

interface Probe {
  /** 候选清单被读了几次（② 靠它证「懒加载 / 零额外探测」） */
  readonly localAddressCount: () => number;
  readonly facts: PlanFacts;
}

/** 事实替身：`listenAddresses` / `localAddresses` 由用例给（缺省 = 与 010 同形的空事实） */
function factsOf(options: {
  readonly persisted?: Readonly<Record<string, string>>;
  readonly candidates?: readonly LocalAddressEntry[];
  readonly elevationThrows?: boolean;
} = {}): Probe {
  let localAddressCalls = 0;
  const facts: PlanFacts = {
    managedPorts: () => MANAGED,
    eth0Ip: () => Promise.resolve(ETH0),
    rules: () => Promise.resolve([] as readonly PortproxyRule[]),
    elevation: () => ({ policy: 'none', backend: 'gsudo', available: true }),
    ...(options.persisted === undefined ? {} : { listenAddresses: (port: number) => options.persisted?.[String(port)] }),
    ...(options.candidates === undefined
      ? {}
      : {
          localAddresses: () => {
            localAddressCalls += 1;
            return Promise.resolve(options.candidates ?? []);
          },
        }),
  };
  return { localAddressCount: () => localAddressCalls, facts };
}

async function planOf(facts: PlanFacts, target: Record<string, unknown>): Promise<PlanResponse> {
  const result = await createPlanChannel(facts)({ action: 'add', ports: [PORT], scope: 'lan', ...target });
  assert.equal(result.ok, true, '计划通道的成功形态是 ok:true（拦下不是错误）');
  return result.ok ? (result.payload as PlanResponse) : ({} as PlanResponse);
}

/** 单端口计划的步骤（断言失败时带可读原因） */
function stepsOf(response: PlanResponse): readonly WriteStep[] {
  const only = response.ports[0];
  assert.ok(only !== undefined, '必须恰好有一个端口的结果');
  return only.steps;
}

function commandsOf(steps: readonly WriteStep[]): readonly string[] {
  return steps.map((step) => step.commandText);
}

test('① 配置里持久化的监听地址 ⇒ 计划的 listenaddress 与放行网段都用它', async () => {
  const probe = factsOf({ persisted: { [String(PORT)]: LAN_IP }, candidates: CANDIDATES });
  const response = await planOf(probe.facts, {});
  const steps = stepsOf(response);

  assert.deepEqual(
    steps.map((step) => step.kind),
    ['portproxy-add', 'firewall-add'],
  );
  const text = commandsOf(steps).join('\n');
  assert.match(text, /listenaddress=192\.168\.31\.129/u);
  assert.equal(
    text.includes('listenaddress=0.0.0.0'),
    false,
    '选了具体 IP 就不许再出现「所有网卡」形态（否则等于没选）',
  );
  const firewall = steps.find((step) => step.kind === 'firewall-add');
  assert.equal(firewall?.params['remoteAddress'], LAN_CIDR, '④ 放行网段必须是候选条目自己的 /24');
  assert.match(String(firewall?.commandText), /-RemoteAddress "?192\.168\.31\.0\/24"?/u);
  assert.equal(probe.localAddressCount(), 1, '一次规划至多枚举一次候选清单');
  console.log(`  · 持久化 ${LAN_IP} ⇒ ${String(steps.length)} 步：${commandsOf(steps).join(' | ')}`);
});

test('② 没传也没配 ⇒ 与今天逐字节一致（0.0.0.0 + 无 RemoteAddress + 候选清单零探测）', async () => {
  const probe = factsOf({ candidates: CANDIDATES });
  const response = await planOf(probe.facts, {});
  const steps = stepsOf(response);
  const text = commandsOf(steps).join('\n');

  assert.match(text, /listenaddress=0\.0\.0\.0/u);
  assert.equal(text.includes('RemoteAddress'), false, '没选地址就一条 -RemoteAddress 都不许有');
  for (const step of steps) assert.equal('remoteAddress' in step.params, false);
  assert.equal(probe.localAddressCount(), 0, '不选具体 IP 就不枚举网卡（连探测次数都不变）');
  console.log(`  · 缺省路径 ${String(steps.length)} 步 / 候选枚举 ${String(probe.localAddressCount())} 次：${text.split('\n')[0] ?? ''}`);
});

test('② 续：显式选 0.0.0.0 与「没选」完全等价（同一个 planId、同一份命令原文）', async () => {
  const base = await planOf(factsOf({ candidates: CANDIDATES }).facts, {});
  const explicitAny = await planOf(
    factsOf({ persisted: { [String(PORT)]: '0.0.0.0' }, candidates: CANDIDATES }).facts,
    {},
  );

  assert.equal(explicitAny.planId, base.planId, '0.0.0.0 = 缺省形态 ⇒ 票据必须相同');
  assert.deepEqual(commandsOf(stepsOf(explicitAny)), commandsOf(stepsOf(base)));
  console.log(`  · 0.0.0.0 与缺省的 planId 相同：${String(base.planId).slice(0, 12)}…`);
});

test('③ 非法/非候选地址 ⇒ listen-address-invalid + 零步骤（三种都不许回退 0.0.0.0）', async () => {
  const cases: readonly { readonly label: string; readonly facts: PlanFacts; readonly target: Record<string, unknown> }[] = [
    { label: '不是 IPv4', facts: factsOf({ candidates: CANDIDATES }).facts, target: { listenAddress: 'not-an-ip' } },
    // 合法 IPv4 但不在候选清单里（典型：WSL/Hyper-V 虚拟网段，决策 1 已把它们排除）
    { label: '合法但非候选', facts: factsOf({ candidates: CANDIDATES }).facts, target: { listenAddress: '172.20.201.152' } },
    // 候选清单读不到（服务端枚举失败）⇒ 空集 ⇒ 全拦（fail-closed）
    { label: '候选清单为空', facts: factsOf({ candidates: [] }).facts, target: { listenAddress: LAN_IP } },
  ];

  for (const item of cases) {
    const response = await planOf(item.facts, item.target);
    assert.equal(response.ready, false, `${item.label}：必须判不 ready`);
    assert.equal(response.planId, null, `${item.label}：拦下就不该有可执行票据`);
    const only = response.ports[0];
    assert.equal(only?.blocked?.reason, 'listen-address-invalid', `${item.label}：原因必须是 listen-address-invalid`);
    assert.deepEqual(only?.steps, [], `${item.label}：拦下时 steps 必须为空（零写动作）`);
    assert.match(String(only?.blocked?.message), /算不出合法网段|候选清单/u, '原因要能区分「算不出网段」与「不在候选里」');
    console.log(`  · ${item.label} ⇒ ${String(only?.blocked?.reason)}：${String(only?.blocked?.message).slice(0, 70)}…`);
  }
});

test('③ 续：候选清单来源抛异常 ⇒ 503 rules-unavailable（不把「读不到」当成「没有网卡」）', async () => {
  const facts: PlanFacts = {
    ...factsOf({ persisted: { [String(PORT)]: LAN_IP } }).facts,
    localAddresses: () => Promise.reject(new Error('powershell-missing')),
  };
  const result = await createPlanChannel(facts)({ action: 'add', ports: [PORT], scope: 'lan' });
  assert.equal(result.ok, false, '现读失败必须是错误态（503），不是一份看起来正常的空计划');
  console.log(`  · 候选清单抛异常 ⇒ ${result.ok ? 'ok（错）' : result.code}`);
});

test('④ 请求覆盖优先于配置（同端口两处不同值 ⇒ 以请求为准，且仍过候选门槛）', async () => {
  const probe = factsOf({ persisted: { [String(PORT)]: LAN_IP }, candidates: CANDIDATES });
  const other = { address: '10.0.0.5', ifAlias: '以太网 2', prefixLength: 16 } as const;
  const facts: PlanFacts = {
    ...probe.facts,
    localAddresses: () => Promise.resolve([...CANDIDATES, other]),
  };
  const response = await planOf(facts, { listenAddress: other.address });
  const text = commandsOf(stepsOf(response)).join('\n');

  assert.match(text, /listenaddress=10\.0\.0\.5/u);
  assert.equal(text.includes(`listenaddress=${LAN_IP}`), false, '配置里的旧值不许在请求给了新值时同时出现');
  assert.match(text, /-RemoteAddress "?10\.0\.0\.0\/16"?/u, '网段跟着请求里的地址算');
  console.log(`  · 请求覆盖 ${LAN_IP} → ${other.address}：${text.split('\n')[0] ?? ''}`);
});

test('⑤ 提权脚本：模板带 listenaddress/RemoteAddress，argv 只在需要时追加三个参数', () => {
  const template = buildElevateScript();
  assert.match(template, /listenaddress=\$listen/u, 'portproxy add 必须真的用 $listen');
  assert.match(template, /-RemoteAddress \$RemoteAddress/u, '防火墙分支必须真的用 -RemoteAddress');
  assert.match(template, /\[string\]\$ListenAddress/u, '脚本必须声明 -ListenAddress 形参');
  assert.match(template, /\[string\]\$DeleteAddress/u, '脚本必须声明 -DeleteAddress 形参');
  assert.match(template, /listenaddress=\$delete/u, '删除必须认 -DeleteAddress（fix 删旧建新）');

  const base = params();
  assert.deepEqual(scriptArgs(base), [
    '-Out',
    'C:\\Temp\\dsh-ppp-abcdef012345-out.json',
    '-Action',
    'add',
    '-Port',
    '5000',
    '-Address',
    ETH0,
    '-Scope',
    'lan',
  ], '缺省 argv 必须与 010 逐字相同（既有用例的 deepEqual 原样成立）');

  const withAddresses = scriptArgs({ ...base, listenAddress: LAN_IP, deleteAddress: '0.0.0.0', remoteAddress: LAN_CIDR });
  assert.deepEqual(withAddresses.slice(10), ['-ListenAddress', LAN_IP, '-DeleteAddress', '0.0.0.0', '-RemoteAddress', LAN_CIDR]);
  console.log(`  · argv 追加段 = ${withAddresses.slice(10).join(' ')}`);
});

test('⑤ 端到端：真计划的步骤 ⇒ 提权脚本的 argv 真的带上 -ListenAddress / -RemoteAddress', async () => {
  const probe = factsOf({ persisted: { [String(PORT)]: LAN_IP }, candidates: CANDIDATES });
  const steps = stepsOf(await planOf(probe.facts, {}));
  const addresses = scriptAddressesOf(steps);
  assert.deepEqual(addresses, { listenAddress: LAN_IP, remoteAddress: LAN_CIDR }, '从**真计划**（不是手搓步骤）反推');

  const argv = scriptArgs(params({ ...addresses }));
  assert.equal(argv.includes('-ListenAddress'), true);
  assert.equal(argv[argv.indexOf('-ListenAddress') + 1], LAN_IP);
  assert.equal(argv[argv.indexOf('-RemoteAddress') + 1], LAN_CIDR);
  const script = buildElevateScript();
  assert.match(script, /\$ListenAddress/u, 'PS1 里必须有该形参的消费点（`-ListenAddress` 是宿主侧 argv，不写进模板）');
  console.log(`  · 真计划 → argv 末尾 = ${argv.slice(10).join(' ')}`);
});

test('⑤ 续：脚本参数从**计划步骤**反推（add / fix / remove 三种形态）', () => {
  const step = (kind: WriteStep['kind'], params: Record<string, string>): WriteStep => ({
    kind,
    port: PORT,
    params,
    commandText: `${kind} …`,
  });

  assert.deepEqual(
    scriptAddressesOf([step('portproxy-add', { listenport: String(PORT), listenaddress: LAN_IP }), step('firewall-add', { listenport: String(PORT), remoteAddress: LAN_CIDR })]),
    { listenAddress: LAN_IP, remoteAddress: LAN_CIDR },
    'add：只要 listen + remote',
  );
  assert.deepEqual(
    scriptAddressesOf([
      step('portproxy-delete', { listenport: String(PORT), listenaddress: '0.0.0.0' }),
      step('portproxy-add', { listenport: String(PORT), listenaddress: LAN_IP }),
    ]),
    { listenAddress: LAN_IP, deleteAddress: '0.0.0.0' },
    'fix：删旧的（0.0.0.0）建新的（具体 IP）',
  );
  assert.deepEqual(
    scriptAddressesOf([step('portproxy-delete', { listenport: String(PORT), listenaddress: LAN_IP })]),
    { listenAddress: LAN_IP },
    'remove：删除地址就是 listen（不必重复传 -DeleteAddress）',
  );
  assert.deepEqual(scriptAddressesOf([]), {}, '没有步骤 ⇒ 三个参数全缺席（010 形态）');
  console.log('  · 三种计划形态反推的脚本参数都正确');
});

function params(overrides: Partial<ScriptParams> = {}): ScriptParams {
  return {
    action: 'add',
    port: 5000,
    address: ETH0,
    scope: 'lan',
    scriptPath: 'C:\\Temp\\dsh-ppp-abcdef012345.ps1',
    outPath: 'C:\\Temp\\dsh-ppp-abcdef012345-out.json',
    ...overrides,
  };
}

test('① 快照：配置里的 listenAddresses 原样进快照（刷新后回填下拉的唯一来源）', async () => {
  const build = async (listenAddresses?: () => Readonly<Record<string, string>>): Promise<Record<string, unknown>> => {
    const fake = routingExecutor();
    const outcome = await createSnapshotBuilder({
      executor: fake.executor,
      readNetworkingMode: () => Promise.resolve({ ok: true, path: WSL_CONFIG, mode: 'default', resolved: 'nat' }),
      localhostForwarding: { filePath: WSL_CONFIG, readFile: () => Promise.resolve(WSL_CONFIG_TEXT) },
      now: () => 0,
      ...(listenAddresses === undefined ? {} : { listenAddresses }),
    }).build({ managedPorts: [...FIXTURE_PORTS], scopes: { [String(PORT)]: 'lan' }, elevationPolicy: 'none' }, {});
    assert.equal(outcome.ok, true, '快照必须成功（前置：fixture 的 netsh/eth0 都能读）');
    assert.equal(fake.calls.length > 0, true);
    return outcome.ok ? (outcome.snapshot as unknown as Record<string, unknown>) : {};
  };

  const withMap = await build(() => ({ [String(PORT)]: LAN_IP }));
  assert.deepEqual(withMap['listenAddresses'], { [String(PORT)]: LAN_IP }, '配置值必须原样出现在快照里');

  const without = await build();
  assert.deepEqual(without['listenAddresses'], {}, '没接配置源 ⇒ 空映射（等价于「一个都没选」）');
  console.log(`  · 快照 listenAddresses = ${JSON.stringify(withMap['listenAddresses'])} / 缺省 ${JSON.stringify(without['listenAddresses'])}`);
});
