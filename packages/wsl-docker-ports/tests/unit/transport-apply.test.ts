/**
 * 008 T2.2 / T2.3 / T2.4 / T2.5：写通道**执行层**（`node --test`，**零真机、零真实进程、零写盘**）
 *
 * 这一组用例是「确认票据 → 真执行 → 回滚 → 审计」的**离线证据**。证据强度的关键在于：
 * 每条「零执行 / 零写入」的用例都断言 **假执行器一次都没被调用**（`fake.calls.length === 0`）
 * + **规则集合逐字节等于执行前** + **审计环空**；每条「真执行」的用例都断言
 * **提权脚本的 argv 逐字**（`-Action add -Port … -Address <eth0> -Scope …`）而不是只看状态码。
 *
 * | 用例 | 判据 |
 * | --- | --- |
 * | ① 票据门 | 无票 / 错票 / 未知 / 过期 **四种可区分**拒绝 ⇒ 零执行 + 零写入 + 零审计 |
 * | ② 确认门 | `confirmed !== true` / 畸形 body / 篡改 target ⇒ 零执行 + 零审计（**不吃掉票据**）|
 * | ③ 真执行 | 票据有效 ⇒ `runElevate` 被调一次、argv 逐字对、审计一条 `applied` |
 * | ④ 策略 | `none` ⇒ `disabled` 零进程零审计；**`unknown` ⇒ 按 `none`（SSoT 默认，2026-10-09 裁定）**；`passby` + agent ⇒ 降级 `ask` |
 * | ⑤ 回滚 | 执行失败 ⇒ 第二次调用是 `remove`，**他人规则一条不动**、条数回到执行前 |
 * | ⑥ 不回滚 | 什么都没写（UAC 被拒）⇒ **不做任何回滚**（防误删） |
 * | ⑦ 幂等 | 同目标第二次 ⇒ 计划阶段被拦（无票据）⇒ 零执行、零重复规则、审计不增 |
 * | ⑧ 旧票作废 | 同一 `planId` 重复规划 ⇒ 旧票 `mismatch`、新票可用 |
 * | ⑨ 接线 | HTTP 往返：`/write/plan` 签发的票据能被 `/write/apply` 消费（wire-plugin 同实例）|
 * | ⑩ 降级 | 没给执行器 ⇒ `apply` 不接线（503「写执行尚未接线」），不假装能写 |
 * | ⑪ 存在性闸门 | 计划后机器上冒出同名防火墙规则 ⇒ **整单不下发**（零命令、零审计）；读失败 ⇒ 503 且零执行 |
 * | ⑫ 规则名不存在 | 闸门不误拦：照常 `-Action add -Scope lan` 下发，两步都执行 |
 *
 * 假执行器模拟的是**脚本对系统状态的影响**（同端口先清后加），回滚判据则完全依赖 005 的前后快照
 * ⇒ 「删得对」这件事是被**结构**证明的，不是被我用例凑出来的。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ManagedPorts } from '../../src/diff/managed-ports.ts';
import type { ElevationDeps } from '../../src/elevate/types.ts';
import type { PortproxyRule } from '../../src/read/netsh.ts';
import type { HttpResponseLike, HttpRequestLike, RoutePluginContextLike, WebServerRoute, WebServerSurfaceLike } from '../../src/route.ts';
import { createApplyChannel, policyFor } from '../../src/transport/apply.ts';
import type { ApplyInput, ApplyReport } from '../../src/transport/apply.ts';
import { createAuditLog } from '../../src/transport/audit.ts';
import type { AuditLog } from '../../src/transport/audit.ts';
import { createConfirmTickets } from '../../src/transport/confirm.ts';
import type { ConfirmTickets } from '../../src/transport/confirm.ts';
import { WRITE_APPLY_PATH, WRITE_PLAN_PATH } from '../../src/transport/constants.ts';
import { createPlanChannel } from '../../src/transport/plan.ts';
import type { PlanFacts, PlanResponse } from '../../src/transport/plan.ts';
import type { WriteRouteResult } from '../../src/transport/routes.ts';
import { attachWriteChannel } from '../../src/transport/wire-plugin.ts';
import { createFakeExecutor, failure } from '../helpers/fake-executor.ts';
import type { FakeExecutor, RecordedCall } from '../helpers/fake-executor.ts';
import { GSUDO_CHOICE, NATIVE_CHOICE, createFakeFs, okPayload, partialPayload, respondWith } from '../helpers/fake-elevation.ts';
import type { Responder } from '../helpers/fake-elevation.ts';
import { ETH0 } from './client-fixtures.ts';

/** 本项目声明管理的端口（集合外的一律不碰） */
const PORT = 5900;
/** 「别人」的端口：代表本机既有 19 条里的任意一条 */
const OTHER = 6379;
const TARGET = { action: 'add', ports: [PORT], scope: 'lan' } as const;
/** 同一端口的另一个作用域：用来制造「可执行、但注册表里没有它的票」这种形态 */
const TARGET_LOOPBACK = { action: 'add', ports: [PORT], scope: 'loopback' } as const;
const MANAGED: ManagedPorts = [{ start: PORT, end: PORT }];

function foreignRule(): PortproxyRule {
  return { listenAddress: '0.0.0.0', listenPort: OTHER, connectAddress: ETH0, connectPort: OTHER };
}

/* ── argv 解析：native 把参数包进 `-Command` 字符串，gsudo 是独立元素 ⇒ 两种形态都认 ── */
function textOf(call: RecordedCall): string {
  return call.argv.join(' ');
}

function actionOf(call: RecordedCall): 'add' | 'remove' {
  return /-Action['",\s]+remove/u.test(textOf(call)) ? 'remove' : 'add';
}

function portOf(call: RecordedCall): number {
  const found = /-Port['",\s]+(\d+)/u.exec(textOf(call));
  return found === null ? 0 : Number(found[1]);
}

function scopeArgsOf(call: RecordedCall): 'loopback' | 'lan' {
  return /-Scope['",\s]+loopback/u.test(textOf(call)) ? 'loopback' : 'lan';
}

function addressOf(call: RecordedCall): string {
  const found = /-Address['",\s]+([\d.]+)/u.exec(textOf(call));
  return found?.[1] ?? ETH0;
}

/** 脚本在一次动作里会上报的步骤名（与本插件计划层的步骤名同源） */
function scriptSteps(scope: 'loopback' | 'lan', action: 'add' | 'remove'): { name: string; ok: boolean }[] {
  const steps = [{ name: action === 'remove' ? 'portproxy-delete' : 'portproxy-add', ok: true }];
  if (scope === 'lan') steps.push({ name: action === 'remove' ? 'firewall-delete' : 'firewall-add', ok: true });
  return steps;
}

interface RigOptions {
  /** 事实面给的**配置档字符串**（真实生产里 `unknown` = 配置读不到 ⇒ 按 `none` 处理） */
  readonly policy?: string | undefined;
  /** 后端探测结果（`gsudo` 走 stdio 回传 ⇒ argv 是独立元素，便于逐字断言） */
  readonly probe?: typeof NATIVE_CHOICE | undefined;
  /** `add` 场景下发「部分失败」（⚠️ 必须配 native：gsudo 的非 0 退出不带回传 ⇒ 会被判成 cancelled） */
  readonly failAdd?: boolean | undefined;
  /** 完全自定义的应答（用于「脚本根本没跑起来」这类场景） */
  readonly respond?: Responder | undefined;
  readonly ttlMs?: number | undefined;
  /** 已存在的防火墙规则名来源（008 T2.6）；不给 ⇒ 存在性闸门不启用（与接线前一致） */
  readonly firewallNames?: (() => Promise<readonly string[]>) | undefined;
}

interface Rig {
  readonly facts: PlanFacts;
  readonly tickets: ConfirmTickets;
  readonly audit: AuditLog;
  readonly lines: string[];
  readonly rules: PortproxyRule[];
  readonly fake: FakeExecutor;
  readonly clock: { value: number };
  /** 005 依赖面的离线替身（HTTP 接线用例要把它一路传进 `attachWriteChannel`） */
  readonly elevationDeps: Partial<ElevationDeps>;
  readonly planChannel: (target?: unknown, problem?: string) => Promise<WriteRouteResult>;
  readonly applyChannel: (input: ApplyInput) => Promise<WriteRouteResult>;
}

function createRig(options: RigOptions = {}): Rig {
  const rules: PortproxyRule[] = [foreignRule()];
  const clock = { value: 1_000 };
  const now = (): number => clock.value;
  let issued = 0;
  const tickets = createConfirmTickets({ ttlMs: options.ttlMs ?? 60_000, now, newTicket: () => `tk-${String((issued += 1))}` });
  const lines: string[] = [];
  const audit = createAuditLog({ sink: (line) => lines.push(line) });

  const facts: PlanFacts = {
    managedPorts: () => MANAGED,
    eth0Ip: () => Promise.resolve(ETH0),
    rules: (port: number) => Promise.resolve(rules.filter((rule) => rule.listenPort === port)),
    elevation: () => Promise.resolve({ policy: options.policy ?? 'ask', backend: 'gsudo', available: true }),
    // `false` = loopback 也要显式规则 ⇒ 每个端口都至少有一步，便于断言「跳过了哪一步」
    localhostForwarding: () => false,
    ...(options.firewallNames === undefined ? {} : { firewallNames: options.firewallNames }),
  };

  const fs = createFakeFs();
  let runs = 0;
  const fake = createFakeExecutor((call, index) => {
    if (options.respond !== undefined) return options.respond(call, index);
    const port = portOf(call);
    const action = actionOf(call);
    const scope = scopeArgsOf(call);
    // 模拟脚本对系统状态的影响：先清掉同端口的既有规则（脚本自己会清另一 listen address），再按作用域写一条
    for (let i = rules.length - 1; i >= 0; i -= 1) if (rules[i]?.listenPort === port) rules.splice(i, 1);
    if (action === 'add') {
      rules.push({
        listenAddress: scope === 'loopback' ? '127.0.0.1' : '0.0.0.0',
        listenPort: port,
        connectAddress: addressOf(call),
        connectPort: port,
      });
    }
    if (action === 'add' && options.failAdd === true) {
      const payload = partialPayload(port, 'firewall-add', 'stub:放行失败');
      return respondWith(fs, { payload, exitCode: 2, stderr: 'stub' })(call, index);
    }
    return respondWith(fs, { payload: okPayload(port, action, scriptSteps(scope, action)) })(call, index);
  });

  const elevationDeps: Partial<ElevationDeps> = {
    probeBackend: () => Promise.resolve(options.probe ?? NATIVE_CHOICE),
    // 快照必须反映**当下的**真实状态（回滚判据依赖它）⇒ 不能用固定值
    snapshot: () => {
      runs += 1;
      return Promise.resolve({ ok: true as const, rules: [...rules], argv: ['netsh.exe'] });
    },
    writeFile: fs.writeFile,
    readFile: fs.readFile,
    removeFile: fs.removeFile,
    tempDir: 'C:\\Temp',
    randomSuffix: () => `abc${String(runs).padStart(5, '0')}def`,
  };

  return {
    facts,
    tickets,
    audit,
    lines,
    rules,
    fake,
    clock,
    elevationDeps,
    planChannel: createPlanChannel(facts, tickets),
    applyChannel: createApplyChannel({
      facts,
      tickets,
      audit,
      executor: fake.executor,
      elevationDeps,
      now,
    }),
  };
}

async function planOk(rig: Rig, target: unknown = TARGET): Promise<PlanResponse> {
  const outcome = await rig.planChannel(target);
  assert.equal(outcome.ok, true, '计划通道不该是通道级错误');
  return outcome.payload as PlanResponse;
}

function ticketOf(response: PlanResponse): string {
  assert.notEqual(response.confirm, null, '可执行计划必须带票据');
  return response.confirm?.ticket ?? '';
}

/** 断言「拒绝」并取回可读的 code/message（`ok:false` 时才有） */
function refusalOf(outcome: WriteRouteResult): { readonly code: string; readonly message: string } {
  assert.equal(outcome.ok, false, '这一步必须是拒绝（不执行、不写审计）');
  return outcome.ok ? { code: '', message: '' } : { code: outcome.code, message: outcome.message };
}

function reportOf(outcome: WriteRouteResult): ApplyReport {
  assert.equal(outcome.ok, true, 'apply 的执行结果走 200 + 状态判别式（不是 HTTP 错误）');
  return outcome.ok ? (outcome.payload as ApplyReport) : ({} as ApplyReport);
}

test('T2.2 ① 票据门四态：无票 / 错票 / 从未签发 / 过期 ⇒ 四种可区分拒绝 + 零执行 + 零写入 + 零审计', async () => {
  const rig = createRig();
  const response = await planOk(rig);
  const { planId } = response;
  const valid = ticketOf(response);
  assert.match(valid, /^tk-\d+$/u);
  assert.equal(response.confirm?.expiresAt, rig.clock.value + 60_000, '票据必须带过期的绝对时刻（客户端可据此提示）');

  // (a) 缺票据
  const missing = refusalOf(await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: '' }));
  assert.equal(missing.code, 'confirm-required');
  assert.match(missing.message, /缺确认票据/u);

  // (b) 错票（票据与这份计划不匹配）—— confirm.ts 的语义是 mismatch **不消费**真票
  const wrong = refusalOf(await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: 'tk-不是这张' }));
  assert.equal(wrong.code, 'plan-mismatch');
  assert.match(wrong.message, /票据与本次计划不匹配/u);

  // (c) 从未为**这份计划**签发过（另一个 plan 通道没装票据注册表 ⇒ 它的 planId 在注册表里查不到）
  const orphan = createPlanChannel(rig.facts);
  const orphaned = await orphan(TARGET_LOOPBACK);
  assert.equal(orphaned.ok, true);
  const unknownPlan = orphaned.payload as PlanResponse;
  assert.equal(unknownPlan.confirm, null, '没装票据注册表 ⇒ 不签发');
  assert.notEqual(unknownPlan.planId, null, '它本身仍是一份可执行的计划（loopback 也要显式规则）');
  const unknown = refusalOf(
    await rig.applyChannel({ target: TARGET_LOOPBACK, planId: unknownPlan.planId, confirmed: true, origin: 'user', ticket: 'tk-1' }),
  );
  assert.equal(unknown.code, 'confirm-required');
  assert.match(unknown.message, /没有为这份计划签发过票据/u);

  // (d) 过期（TTL 内签发、推进时钟后使用）
  rig.clock.value = (response.confirm?.expiresAt ?? 0) + 1;
  const expired = refusalOf(await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: valid }));
  assert.equal(expired.code, 'confirm-required');
  assert.match(expired.message, /已过期/u);

  // 🔴 四种拒绝共用一条红线：零提权、零写入、零审计
  assert.equal(rig.fake.calls.length, 0, '假执行器一次都不许被调用（零提权 = 零进程）');
  assert.deepEqual(rig.rules, [foreignRule()], '系统规则逐字节等于执行前');
  assert.equal(rig.audit.size(), 0, '被拒绝的 apply 不写审计（什么都没发生）');
  assert.deepEqual(rig.lines, [], '审计环的 sink 也没有任何一行');
});

test('T2.2 ② 确认门：未确认 / 畸形 body / 篡改目标 ⇒ 零执行零审计，且**不吃掉票据**', async () => {
  const rig = createRig();
  const response = await planOk(rig);
  const { planId } = response;
  const valid = ticketOf(response);

  const unconfirmed = refusalOf(await rig.applyChannel({ target: TARGET, planId, confirmed: false, origin: 'user', ticket: valid }));
  assert.equal(unconfirmed.code, 'confirm-required');
  assert.match(unconfirmed.message, /未确认/u);

  const malformed = refusalOf(
    await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: valid, problem: '请求体不是合法 JSON' }),
  );
  assert.equal(malformed.code, 'confirm-required');
  assert.match(malformed.message, /不是合法 JSON/u);

  // 篡改 scope ⇒ 重算的 planId 与带来的不一致（票据是给 lan 那份签的）
  const tampered = refusalOf(
    await rig.applyChannel({ target: { action: 'add', ports: [PORT], scope: 'loopback' }, planId, confirmed: true, origin: 'user', ticket: valid }),
  );
  assert.equal(tampered.code, 'plan-mismatch');
  assert.match(tampered.message, /planId 与本次重算不一致/u);

  // 篡改到集合外端口 ⇒ 计划阶段就被拦（无 planId）
  const outOfScope = refusalOf(
    await rig.applyChannel({ target: { action: 'add', ports: [OTHER], scope: 'lan' }, planId, confirmed: true, origin: 'user', ticket: valid }),
  );
  assert.equal(outOfScope.code, 'plan-mismatch');

  assert.equal(rig.fake.calls.length, 0, '四次拒绝：零提权');
  assert.equal(rig.audit.size(), 0, '四次拒绝：零审计');
  assert.deepEqual(rig.rules, [foreignRule()]);

  // 🔴 「拒绝不吃票据」：原票仍然可用 ⇒ 紧接着一次合法 apply 必须真执行
  const report = reportOf(await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: valid }));
  assert.equal(report.status, 'ok');
  assert.equal(rig.fake.calls.length, 1, '合法票据才真执行（一次）');
  assert.equal(rig.audit.size(), 1);
});

test('T2.3 ③ 合法票据 ⇒ runElevate 真被调用且 argv 逐字正确；审计记一条 applied', async () => {
  const rig = createRig({ probe: GSUDO_CHOICE });
  const response = await planOk(rig);
  const planId = response.planId ?? '';
  const planned = response.ports[0];
  assert.equal(planned?.ready, true);

  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId, confirmed: true, origin: 'user', ticket: ticketOf(response) }),
  );

  assert.equal(rig.fake.calls.length, 1, '一次 apply = 一次提权调用');
  const call = rig.fake.calls[0];
  assert.equal(call?.file, GSUDO_CHOICE.gsudoPath, '按探测结果走 gsudo（不由调用方指定）');
  const argv = call?.argv.join(' ') ?? '';
  assert.match(argv, /-Action add/u);
  assert.match(argv, new RegExp(`-Port ${String(PORT)}`, 'u'));
  assert.match(argv, new RegExp(`-Address ${ETH0.replaceAll('.', '\\.')}`, 'u'));
  assert.match(argv, /-Scope lan/u, 'lan 作用域必须原样传到脚本（脚本据此决定要不要放行防火墙）');
  assert.match(argv, /-File .*\.ps1/u, '脚本路径是主机侧临时产物');

  assert.equal(report.status, 'ok');
  assert.equal(report.action, 'add');
  assert.equal(report.scope, 'lan');
  assert.equal(report.port, PORT);
  assert.equal(report.backend, 'gsudo');
  assert.equal(report.exitCode, 0);
  assert.equal(report.elevationPolicy, 'ask', '配置档 ask ⇒ 生效档 ask');
  assert.deepEqual(report.executed, ['portproxy-add', 'firewall-add'], '两步都真跑了');
  assert.deepEqual(report.skipped, [], '没有跳过的步骤');
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.rolledBack, [], '成功就不该有回滚');
  assert.equal(report.commandText, planned?.commandText);
  assert.equal('stdout' in report, false, '🔴 响应里不带原始回传（REQ-4.4：不泄漏任何凭据）');

  const record = rig.audit.tail(1)[0];
  assert.equal(rig.audit.size(), 1);
  assert.equal(record?.result, 'applied');
  assert.equal(record?.origin, 'user');
  assert.equal(record?.planId, planId);
  assert.equal(record?.backend, 'gsudo');
  assert.equal(record?.exitCode, 0);
  assert.equal(record?.rolledBack, false);
  assert.deepEqual(record?.ports, [PORT]);
  assert.equal(rig.lines.length, 1, '审计落一行（不是「记了但没输出」）');

  // 系统状态：本端口真被写了一条，别人那条逐字节没动
  assert.deepEqual(rig.rules, [foreignRule(), { listenAddress: '0.0.0.0', listenPort: PORT, connectAddress: ETH0, connectPort: PORT }]);
});

test('T2.3 ④ 策略映射：none ⇒ none；unknown/认不出 ⇒ none（SSoT 默认，fail-safe）；passby 原样', () => {
  assert.equal(policyFor('none'), 'none');
  assert.equal(policyFor('ask'), 'ask');
  assert.equal(policyFor('passby'), 'passby');
  // 🔴 2026-10-09 主人裁定：默认值 none 是 SSoT（stack-decision.md 提权维度）定的 ⇒「读不到配置」
  // 只能落到**不写**；把 unknown 当 ask 等于替用户**打开**他从未打开过的提权开关（真机会真写）。
  assert.equal(policyFor('unknown'), 'none', '配置读不到 ⇒ 按 SSoT 默认 none（不是 ask、更不是 passby）');
  assert.equal(policyFor(''), 'none');
  assert.equal(policyFor('auto'), 'none', '认不出的值一律落到最保守档（不写），绝不升格成 ask / passby');
});

test('T2.3 ④b `none`：005 在执行前返回 disabled ⇒ 零提权调用、零审计（不是失败）', async () => {
  const rig = createRig({ policy: 'none' });
  const response = await planOk(rig);
  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId: response.planId, confirmed: true, origin: 'user', ticket: ticketOf(response) }),
  );

  assert.equal(report.status, 'disabled');
  assert.equal(rig.fake.calls.length, 0, '策略 none ⇒ 一个进程都不许起');
  assert.equal(rig.audit.size(), 0, '没发生的动作不写审计');
  assert.deepEqual(rig.rules, [foreignRule()]);
  assert.match(report.message, /none/u);
});

test('T2.3 ④c `unknown`（配置读不到）⇒ 生效档 none ⇒ 零提权零写入零审计；passby+agent ⇒ 降级 ask 照常执行', async () => {
  const unknown = createRig({ policy: 'unknown', probe: GSUDO_CHOICE });
  const plannedByUnknown = await planOk(unknown);
  const reportByUnknown = reportOf(
    await unknown.applyChannel({
      target: TARGET,
      planId: plannedByUnknown.planId,
      confirmed: true,
      origin: 'user',
      ticket: ticketOf(plannedByUnknown),
    }),
  );
  assert.equal(reportByUnknown.status, 'disabled', 'unknown ⇒ 按 none（SSoT 默认）⇒ 005 直接 disabled');
  assert.equal(reportByUnknown.elevationPolicy, 'none');
  assert.equal(unknown.fake.calls.length, 0, '🔴 读不到配置 ⇒ 零进程（真机上就是不写）');
  assert.equal(unknown.audit.size(), 0, '零动作 ⇒ 零审计');
  assert.deepEqual(unknown.rules, [foreignRule()], '系统状态逐字节不变');
  assert.match(reportByUnknown.message, /none/u);

  const agent = createRig({ policy: 'passby', probe: GSUDO_CHOICE });
  const plannedByAgent = await planOk(agent);
  const reportByAgent = reportOf(
    await agent.applyChannel({
      target: TARGET,
      planId: plannedByAgent.planId,
      confirmed: true,
      origin: 'agent',
      ticket: ticketOf(plannedByAgent),
    }),
  );
  assert.equal(reportByAgent.elevationPolicy, 'ask', 'REQ-3.4：Agent 触发的 passby 必须降级成 ask');
  assert.equal(reportByAgent.status, 'ok');
  assert.equal(agent.fake.calls.length, 1);
  assert.equal(agent.audit.tail(1)[0]?.origin, 'agent', '审计要能区分是谁触发的');
  assert.equal(agent.audit.tail(1)[0]?.elevationPolicy, 'ask', '审计记**生效**档（不是配置档）');

  // 缺省 origin（客户端漏传）按 **agent** 算 —— 保守方向：Agent 的 passby 会被降级
  const anon = createRig({ policy: 'passby', probe: GSUDO_CHOICE });
  const plannedAnon = await planOk(anon);
  const reportAnon = reportOf(
    // 路由在客户端漏传时给的就是 `undefined`（`record['origin']`）⇒ 这里复刻真实入参形态
    await anon.applyChannel({ target: TARGET, planId: plannedAnon.planId, confirmed: true, origin: undefined, ticket: ticketOf(plannedAnon) }),
  );
  assert.equal(reportAnon.elevationPolicy, 'ask', '缺省 origin ⇒ 按 agent（降级方向）');
  assert.equal(anon.audit.tail(1)[0]?.origin, 'agent', '审计按**生效**来源记，不按「猜是用户」记');
});

/* ── ⑪/⑫ 存在性闸门（REQ-2.6 第二层）：防火墙规则名的现读 + 执行前再读一次 ── */

/** 按调用次序应答的规则名来源（`[]` = 还没有；`Error` = 读失败）——用来复刻 TOCTOU 窗口 */
function readScript(script: readonly (readonly string[] | Error)[]): () => Promise<readonly string[]> {
  let index = 0;
  return () => {
    const item = script[Math.min(index, script.length - 1)] ?? [];
    index += 1;
    return item instanceof Error ? Promise.reject(item) : Promise.resolve(item);
  };
}

test('T2.6 ⑪ 执行前闸门：计划发出后机器上冒出同名防火墙规则 ⇒ **整单不下发**（零命令、零审计）', async () => {
  // 读次序：① `/write/plan` 那次（还没有）② apply 的重规划（还没有）③ 执行前的闸门（冒出来了）
  const rig = createRig({
    probe: GSUDO_CHOICE,
    firewallNames: readScript([[], [], ['dsh-wsl-docker-ports-5900']]),
  });
  const response = await planOk(rig);
  assert.equal(response.ports[0]?.ready, true, '计划阶段当时确实没有同名规则 ⇒ 可执行');

  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId: response.planId, confirmed: true, origin: 'user', ticket: ticketOf(response) }),
  );

  assert.equal(report.status, 'no-actions', '整单不做（005 的脚本按 action+scope 放行防火墙，滤不掉单步）');
  assert.deepEqual(report.executed, [], '一条都没执行');
  assert.deepEqual([...report.skipped].sort(), ['firewall-add', 'portproxy-add'], '两步都如实进 skipped');
  assert.equal(report.backend, 'not-attempted');
  assert.match(report.message, /已存在/u);
  assert.match(report.message, /不新增、不覆盖、也不删除/u);
  assert.match(report.hint, /DisplayName 重名/u, '要把「为什么整单不做」说清');

  // 🔴 红线：不是「少做一步」，而是**一条命令都没下发**（否则会叠第二条同名规则）
  assert.equal(rig.fake.calls.length, 0, `零提权：实际 ${String(rig.fake.calls.length)} 条`);
  assert.equal(rig.fake.calls.some((call) => textOf(call).includes('New-NetFirewallRule')), false);
  assert.deepEqual(rig.rules, [foreignRule()], '转发规则也没写（连 portproxy 都不动）');
  assert.equal(rig.audit.size(), 0, '什么都没发生 ⇒ 不写审计（与 disabled / no-actions 同口径）');
});

test('T2.6 ⑪b 执行前读到**失败**（不是空集）⇒ 503 rules-unavailable、零执行、零审计', async () => {
  const rig = createRig({
    probe: GSUDO_CHOICE,
    firewallNames: readScript([[], [], new Error('powershell 读失败：服务未启动')]),
  });
  const response = await planOk(rig);
  const refusal = refusalOf(
    await rig.applyChannel({ target: TARGET, planId: response.planId, confirmed: true, origin: 'user', ticket: ticketOf(response) }),
  );

  assert.equal(refusal.code, 'rules-unavailable');
  assert.match(refusal.message, /读不到防火墙规则名/u);
  assert.match(refusal.message, /服务未启动/u, '原因要原样带出来（可诊断）');
  assert.equal(rig.fake.calls.length, 0, '读不到 ⇒ 零提权（绝不把「读不到」当「没有」）');
  assert.equal(rig.audit.size(), 0);
  assert.deepEqual(rig.rules, [foreignRule()]);
});

test('T2.6 ⑪c 计划阶段就发现同名 ⇒ 计划被拦（`firewall-rule-exists`）⇒ apply 拒绝且零提权', async () => {
  const rig = createRig({ probe: GSUDO_CHOICE, firewallNames: readScript([['dsh-wsl-docker-ports-5900']]) });
  const response = await planOk(rig);

  assert.equal(response.planId, null, '计划阶段（第一层）就该拦下：不产生任何步骤');
  const planned = response.ports[0];
  assert.equal(planned?.ready, false);
  assert.match(planned?.blocked?.reason ?? '', /firewall-rule-exists/u);
  assert.equal(planned?.steps.length, 0, '被拦下的计划恒为空步骤（REQ-1.2）');

  const refusal = refusalOf(
    await rig.applyChannel({ target: TARGET, planId: response.planId, confirmed: true, origin: 'user', ticket: 'tk-1' }),
  );
  assert.equal(refusal.code, 'plan-mismatch', '没有可执行计划 ⇒ 连票据都签发不出来');
  assert.equal(rig.fake.calls.length, 0);
  assert.equal(rig.audit.size(), 0);
});

test('T2.6 ⑫ 规则名不存在（同名判定按前缀+端口，别的端口不算）⇒ 闸门不误拦，照常下发', async () => {
  const rig = createRig({
    probe: GSUDO_CHOICE,
    firewallNames: readScript([['dsh-wsl-docker-ports-6379', '别人的规则']]),
  });
  const response = await planOk(rig);
  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId: response.planId, confirmed: true, origin: 'user', ticket: ticketOf(response) }),
  );

  assert.equal(report.status, 'ok', '别的端口的规则名不该拦住本端口');
  assert.deepEqual(report.executed, ['portproxy-add', 'firewall-add']);
  assert.deepEqual(report.skipped, []);
  assert.equal(rig.fake.calls.length, 1, '一次提权调用（脚本自身完成两步）');
  const argv = textOf(rig.fake.calls[0] as RecordedCall);
  assert.match(argv, /-Action add/u);
  assert.match(argv, /-Scope lan/u, 'portproxy 腿的行为一字未变（作用域照旧原样传）');
  assert.equal(rig.rules.length, 2, '真写了本端口的转发规则（他人规则仍在）');
  assert.equal(rig.audit.size(), 1);
});

test('T2.5 ⑤ 执行失败 ⇒ 只回滚**本轮刚加的**规则：他人规则一条不动、条数回到执行前', async () => {
  const rig = createRig({ failAdd: true });
  const response = await planOk(rig);
  const before = [...rig.rules];

  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId: response.planId, confirmed: true, origin: 'user', ticket: ticketOf(response) }),
  );

  assert.equal(report.status, 'partial', 'portproxy 成功 + 防火墙失败 ⇒ partial');
  assert.equal(report.failed.length, 1);
  assert.match(String(report.failed[0]?.reason), /放行失败/u);
  assert.deepEqual(report.executed, ['portproxy-add']);
  assert.deepEqual(report.skipped, [], '防火墙那步报了失败 ⇒ 不算「跳过」');

  assert.equal(rig.fake.calls.length, 2, '一次执行 + 一次回滚');
  const rollback = rig.fake.calls[1];
  const rollbackArgv = rollback?.argv.join(' ') ?? '';
  assert.match(rollbackArgv, /-Action['",\s]+remove/u, '回滚必须走 remove（不是第二次 add）');
  assert.match(rollbackArgv, new RegExp(`-Port['",\\s]+${String(PORT)}`, 'u'));
  assert.equal(new RegExp(String(OTHER), 'u').test(rollbackArgv), false, '🔴 回滚命令里不许出现别人的端口');

  assert.deepEqual(rig.rules, before, '系统规则逐字节回到执行前（他人一条不动 + 本轮加的已删）');
  assert.equal(rig.rules.length, before.length);
  assert.deepEqual(report.rolledBack, [{ port: PORT, listenAddress: '0.0.0.0', ok: true, message: report.rolledBack[0]?.message ?? '' }]);

  const record = rig.audit.tail(1)[0];
  assert.equal(rig.audit.size(), 1, '失败也要留一条审计（这是真发生过的动作）');
  assert.equal(record?.result, 'failed');
  assert.equal(record?.rolledBack, true);
});

test('T2.5 ⑥ 什么都没写（UAC 被拒 / 脚本没跑起来）⇒ **不做任何回滚**（防误删他人规则）', async () => {
  const rig = createRig({
    respond: () => failure('NonZeroExit', { exitCode: 1, stderr: 'The operation was canceled by the user' }),
  });
  const response = await planOk(rig);
  const before = [...rig.rules];

  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId: response.planId, confirmed: true, origin: 'user', ticket: ticketOf(response) }),
  );

  assert.equal(report.status, 'cancelled');
  assert.equal(rig.fake.calls.length, 1, '🔴 只许有那一次尝试：没有回滚命令');
  assert.deepEqual(report.rolledBack, [], '没有半成品可回滚 ⇒ 清单为空');
  assert.deepEqual(rig.rules, before, '系统状态与执行前逐字节一致');
  assert.equal(rig.audit.tail(1)[0]?.result, 'failed', '尝试过但失败 ⇒ 审计记 failed');
});

test('T2.4 ⑦ 幂等：同目标第二次 ⇒ 计划阶段被拦（无票据）⇒ 零执行、零重复规则、审计不增', async () => {
  const rig = createRig({ probe: GSUDO_CHOICE });
  const first = await planOk(rig);
  reportOf(await rig.applyChannel({ target: TARGET, planId: first.planId, confirmed: true, origin: 'user', ticket: ticketOf(first) }));
  const afterFirst = [...rig.rules];
  assert.equal(afterFirst.length, 2, '他人一条 + 本项目一条');

  const second = await planOk(rig);
  assert.equal(second.ready, false, '同端口已有自己的规则 ⇒ add 被拦成 state-precondition');
  assert.equal(second.planId, null, '被拦下 ⇒ 没有 planId');
  assert.equal(second.confirm, null, '没有 planId ⇒ 不签发票据（等价于「没有可执行的动作」）');

  const again = refusalOf(
    await rig.applyChannel({ target: TARGET, planId: first.planId, confirmed: true, origin: 'user', ticket: 'tk-1' }),
  );
  assert.equal(again.code, 'plan-mismatch', '第二次 apply 连票据门都到不了（计划已不可执行）');
  assert.equal(rig.fake.calls.length, 1, '🔴 第二次零执行');
  assert.deepEqual(rig.rules, afterFirst, '🔴 没有重复规则、也没有动别人');
  assert.equal(rig.audit.size(), 1, '被拒绝的 apply 不写审计');
});

test('T2.2 ⑧ 同一 planId 重复规划 ⇒ 旧票即刻作废（新票可用；旧票 mismatch 且零执行）', async () => {
  const rig = createRig();
  const first = await planOk(rig);
  const oldTicket = ticketOf(first);
  const again = await planOk(rig);
  assert.equal(again.planId, first.planId, 'planId 只由「事实 + 目标」决定（同一事实 ⇒ 同一指纹）');
  const newTicket = ticketOf(again);
  assert.notEqual(newTicket, oldTicket, '重规划签发新票（design §14：同一 planId 重复规划 ⇒ 旧票作废）');

  const stale = refusalOf(
    await rig.applyChannel({ target: TARGET, planId: first.planId, confirmed: true, origin: 'user', ticket: oldTicket }),
  );
  assert.equal(stale.code, 'plan-mismatch');
  assert.equal(rig.fake.calls.length, 0, '旧票：零执行');
  assert.deepEqual(rig.rules, [foreignRule()]);
  assert.equal(rig.audit.size(), 0);

  const report = reportOf(
    await rig.applyChannel({ target: TARGET, planId: again.planId, confirmed: true, origin: 'user', ticket: newTicket }),
  );
  assert.equal(report.status, 'ok', '新票照常可用（旧票作废不牵连新票）');
  assert.equal(rig.fake.calls.length, 1);
});

/* ── ⑨ 接线：HTTP 往返（证明 wire-plugin 里 plan 与 apply 用的是**同一个**票据注册表） ── */
const encoder = new TextEncoder();

function fakeSurface(): { readonly surface: WebServerSurfaceLike; readonly routes: WebServerRoute[] } {
  const routes: WebServerRoute[] = [];
  return {
    routes,
    surface: {
      register(route: WebServerRoute): () => void {
        routes.push(route);
        return () => {
          const at = routes.indexOf(route);
          if (at >= 0) routes.splice(at, 1);
        };
      },
    },
  };
}

function fakeCtx(surface: WebServerSurfaceLike): RoutePluginContextLike {
  return {
    get: (name: string) => (name === 'webServer' ? surface : undefined),
    inject: (names: readonly string[], callback: (scope: RoutePluginContextLike) => void) => {
      assert.deepEqual([...names], ['webServer']);
      callback(fakeCtx(surface));
      return undefined;
    },
    effect: (callback: () => (() => void) | void) => callback(),
  };
}

function request(path: string, body: string): HttpRequestLike {
  const chunks = [encoder.encode(body)];
  return {
    url: path,
    method: 'POST',
    [Symbol.asyncIterator]: async function* (): AsyncIterator<Uint8Array> {
      for (const chunk of chunks) yield chunk;
    },
  } as HttpRequestLike;
}

function responseOf(): { readonly response: HttpResponseLike; readonly status: () => number; readonly text: () => string } {
  const box = { status: 0, body: '' };
  return {
    text: () => box.body,
    status: () => box.status,
    response: {
      get statusCode(): number {
        return box.status;
      },
      set statusCode(value: number) {
        box.status = value;
      },
      setHeader: () => undefined,
      end: (body?: string) => {
        box.body = body ?? '';
      },
    },
  };
}

async function roundTrip(
  routes: readonly WebServerRoute[],
  path: string,
  body: string,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const route = routes.find((item) => (item.kind === 'prefix' ? path.startsWith(item.path) : item.path === path));
  assert.notEqual(route, undefined, `宿主应当分派 ${path}`);
  const fake = responseOf();
  await route?.handler(request(path, body), fake.response);
  return { status: fake.status(), payload: JSON.parse(fake.text()) as Record<string, unknown> };
}

test('T2.2 ⑨ HTTP 往返：/write/plan 签发的票据能被 /write/apply 消费并真执行（wire-plugin 同实例）', async () => {
  const rig = createRig({ probe: GSUDO_CHOICE });
  const fake = fakeSurface();
  const handle = attachWriteChannel(fakeCtx(fake.surface), rig.facts, rig.fake.executor, rig.elevationDeps);
  // 🔴 attachWriteChannel 自己造审计环与票据注册表 ⇒ 本用例断言「plan 签的票 = apply 认的票」
  assert.equal(handle.writeRoute.registered, true);
  assert.equal(handle.tickets.size(), 0, '装载期不签发任何票据');
  assert.equal(rig.fake.calls.length, 0, '装载期零外部命令');

  const planned = await roundTrip(fake.routes, WRITE_PLAN_PATH, JSON.stringify(TARGET));
  assert.equal(planned.status, 200);
  const confirm = planned.payload['confirm'] as { ticket?: string; expiresAt?: number } | null;
  assert.notEqual(confirm, null, 'HTTP 层也要签发票据');
  assert.equal(handle.tickets.size(), 1, '票据落在 wire-plugin 的注册表里（同一个实例）');
  assert.equal(rig.fake.calls.length, 0, '计划是只读的：一条命令都不跑');

  const applied = await roundTrip(
    fake.routes,
    WRITE_APPLY_PATH,
    JSON.stringify({ target: TARGET, planId: planned.payload['planId'], confirmed: true, origin: 'user', ticket: confirm?.ticket }),
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.payload['status'], 'ok');
  assert.equal(rig.fake.calls.length, 1, 'HTTP 往返真的把命令下发到了执行器');
  assert.equal(handle.tickets.size(), 0, '票据一次性：用过即消失');
  assert.equal(handle.audit.size(), 1, 'HTTP 往返产生了 1 条审计');

  // 重放同一张票：注册表里已没有它，且目标此刻已由「本插件规则存在」被拦 ⇒ 两条路都拒
  const replay = await roundTrip(
    fake.routes,
    WRITE_APPLY_PATH,
    JSON.stringify({ target: TARGET, planId: planned.payload['planId'], confirmed: true, origin: 'user', ticket: confirm?.ticket }),
  );
  assert.equal(replay.status, 409, '重放必须被拒（计划已不可执行；票也已消费）');
  assert.equal(rig.fake.calls.length, 1, '重放零执行');
});

test('T2.2 ⑩ 没给执行器 ⇒ apply 不接线：503 + 「写执行尚未接线」，零执行零审计', async () => {
  const fake = fakeSurface();
  const handle = attachWriteChannel(fakeCtx(fake.surface), createRig().facts);
  const planned = await roundTrip(fake.routes, WRITE_PLAN_PATH, JSON.stringify(TARGET));
  const out = await roundTrip(fake.routes, WRITE_APPLY_PATH, JSON.stringify({ target: TARGET, planId: planned.payload['planId'], confirmed: true, ticket: 'tk-1' }));

  assert.equal(out.status, 503);
  assert.match(String((out.payload['error'] as { message?: string } | undefined)?.message), /写执行尚未接线/u);
  assert.equal(handle.audit.size(), 0);
});
