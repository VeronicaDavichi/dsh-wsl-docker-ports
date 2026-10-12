/**
 * 008 T2.3 / T2.6：写通道执行层的**真执行面**（`node --test`，**零真机、零真实进程、零写盘**）
 *
 * —— 2026-10-12 从 `transport-apply.test.ts` 拆出（拆前该文件 `split('\n')` = **748**，超 SHALL 400）。
 * 切面 = **「命令真被下发」的那一半**：提权档映射（含 fail-safe 默认）+ 执行前的**存在性闸门**（TOCTOU）。
 * 共用台架 = [`./transport-apply-rig.ts`](./transport-apply-rig.ts)；🔴 **用例零删减、零改名**（拆前 16 条 = 拆后 16 条）。
 *
 * | 用例 | 判据 |
 * | --- | --- |
 * | ③ 真执行 | 票据有效 ⇒ `runElevate` 被调一次、argv 逐字对、审计一条 `applied` |
 * | ④ 策略 | `none` ⇒ `disabled` 零进程零审计；**`unknown` ⇒ 按 `none`（SSoT 默认，2026-10-09 裁定）**；`passby` + agent ⇒ 降级 `ask` |
 * | ⑪ 存在性闸门 | 计划后机器上冒出同名防火墙规则 ⇒ **整单不下发**（零命令、零审计）；读失败 ⇒ 503 且零执行 |
 * | ⑫ 规则名不存在 | 闸门不误拦：照常 `-Action add -Scope lan` 下发，两步都执行 |
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { policyFor } from '../../src/transport/apply.ts';
import type { RecordedCall } from '../helpers/fake-executor.ts';
import { GSUDO_CHOICE } from '../helpers/fake-elevation.ts';
import { ETH0 } from './client-fixtures.ts';
import { PORT, TARGET, createRig, foreignRule, planOk, readScript, refusalOf, reportOf, textOf, ticketOf } from './transport-apply-rig.ts';

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
