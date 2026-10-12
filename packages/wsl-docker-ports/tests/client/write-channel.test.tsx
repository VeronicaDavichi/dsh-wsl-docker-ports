/**
 * 008 T3.1 判据：**写通道客户端**（白名单请求体 / 信任边界 / 失败分类不重试）
 *
 * 全是离线断言：`fetch` 是假件，记录 URL / 方法 / 头 / body 原文。
 */

import { describe, expect, it } from 'vitest';

import { createDeclarationReader, createWriteChannel, failureText, serializeApplyBody, serializeTarget, buildWriteUrl, classifyWriteFailure, type WriteTargetInput } from '../../src/client/write-channel.ts';
import { parseApplyPayload, parsePlanPayload } from '../../src/client/write-dto.ts';
import { applyPayload, CMD_PORT_PROXY, createFetchRig, errorBody, planPayload, TEST_TOKEN } from './write-fixtures.ts';

const TARGET: WriteTargetInput = { action: 'add', ports: [3306], scope: 'loopback', declaration: [{ start: 3306, end: 3306 }] };

describe('T3.1 信任边界：请求体只有白名单字段，凭据只进请求头', () => {
  it('plan 体 = 四个白名单键；apply 体 = 五个白名单键；命令原文一个字都没进去', async () => {
    const rig = createFetchRig([
      { status: 200, payload: planPayload() },
      { status: 200, payload: applyPayload() },
    ]);
    const channel = createWriteChannel({ token: () => TEST_TOKEN, fetchImpl: rig.fetchImpl });
    const planned = await channel.plan(TARGET);
    expect(planned.ok).toBe(true);
    const applied = await channel.apply({ target: TARGET, planId: 'plan-abcdef0123456789', ticket: 'tkt-1' });
    expect(applied.ok).toBe(true);

    expect(rig.calls).toHaveLength(2);
    expect(rig.calls[0]?.url).toBe('/dsh-wsl-docker-ports/write/plan');
    expect(rig.calls[1]?.url).toBe('/dsh-wsl-docker-ports/write/apply');
    expect(rig.calls.map((call) => call.method)).toEqual(['POST', 'POST']);
    // 🔴 凭据只走头：URL 里没有它（URL 会进访问日志与浏览器历史）
    expect(rig.calls[0]?.url).not.toContain(TEST_TOKEN);
    expect(rig.calls[0]?.headers['Authorization']).toBe(`Bearer ${TEST_TOKEN}`);
    expect(Object.keys(rig.calls[0]?.headers ?? {}).sort()).toEqual(['Accept', 'Authorization', 'Content-Type']);
    // 🔴 白名单：多一个键都不行
    expect(Object.keys(rig.calls[0]?.body ?? {})).toEqual(['action', 'ports', 'scope', 'declaration']);
    expect(Object.keys(rig.calls[1]?.body ?? {})).toEqual(['target', 'planId', 'confirmed', 'origin', 'ticket']);
    expect(Object.keys((rig.calls[1]?.body['target'] as Record<string, unknown>) ?? {})).toEqual(['action', 'ports', 'scope', 'declaration']);
    expect(rig.calls[1]?.body['confirmed']).toBe(true);
    expect(rig.calls[1]?.body['origin']).toBe('user');
    // 两次调用的 target **逐字相同**（否则服务端重算的 planId 必然不同 ⇒ 409）
    expect(rig.calls[1]?.body['target']).toEqual(rig.calls[0]?.body);
    // 命令原文（服务端计划里的）绝不出现在任何请求体里
    expect(rig.calls[1]?.rawBody).not.toContain('netsh');
    expect(rig.calls[1]?.rawBody).not.toContain(CMD_PORT_PROXY);
    console.log(`  · 扫了 2 个请求：plan 4 键 / apply 5 键 / target 逐字相同 / rawBody 里 netsh 命中 0 次`);
  });

  it('序列化函数本身只认识白名单字段（多塞的键进不去）', () => {
    const target = { ...TARGET, commandText: 'netsh whatever', commands: ['rm -rf /'] } as unknown as WriteTargetInput;
    const body = serializeTarget(target);
    expect(Object.keys(body)).toEqual(['action', 'ports', 'scope', 'declaration']);
    expect(JSON.stringify(body)).not.toContain('netsh');
    const apply = serializeApplyBody({ target, planId: 'p', ticket: 't' });
    expect(JSON.stringify(apply)).not.toContain('netsh');
    expect(buildWriteUrl('http://127.0.0.1:1', '/x')).toBe('http://127.0.0.1:1/x');
    console.log('  · 扫了 2 个序列化函数：塞进去的 commandText/commands 全部被丢弃');
  });
});

describe('T3.1 凭据缺失 ⇒ 本地拦下（零请求）', () => {
  it('没凭据时 plan/apply 都不发请求，返回 credential 失败并指路', async () => {
    const rig = createFetchRig([{ status: 200, payload: planPayload() }]);
    const channel = createWriteChannel({ token: () => undefined, fetchImpl: rig.fetchImpl });
    const outcome = await channel.plan(TARGET);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.kind).toBe('credential');
      expect(outcome.failure.message).toContain('凭据');
      expect(outcome.failure.message).toContain('本地拦下');
    }
    const applied = await channel.apply({ target: TARGET, planId: 'p', ticket: 't' });
    expect(applied.ok).toBe(false);
    expect(rig.calls).toHaveLength(0);
    expect(channel.requestCount()).toBe(0);
    expect(rig.unexpected()).toBe(0);
    console.log('  · 扫了 2 条无凭据路径：fetch 调用 0 次、requestCount 0');
  });
});

describe('T3.1 失败分类：401 指路不重试 / 票据失效要求重新确认', () => {
  it('401 ⇒ credential（不重试：请求数停在 1）', async () => {
    const rig = createFetchRig([{ status: 401, payload: errorBody('unauthorized', '缺少写通道凭据：拒绝本次请求（零执行、零写入、零审计）。') }]);
    const channel = createWriteChannel({ token: () => 'wrong-token', fetchImpl: rig.fetchImpl });
    const outcome = await channel.plan(TARGET);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.kind).toBe('credential');
      expect(outcome.failure.hint).toContain('配置页');
      expect(failureText(outcome.failure)).toContain('凭据');
    }
    expect(channel.requestCount()).toBe(1);
    expect(rig.calls).toHaveLength(1);
    console.log('  · 扫了 1 条 401：kind=credential、请求数 1（无重试）');
  });

  it('409 plan-mismatch 与 403 confirm-required ⇒ replan（必须重新计划 + 重新确认）', () => {
    expect(classifyWriteFailure({ status: 409, code: 'plan-mismatch', message: '票据与本次计划不匹配' }).kind).toBe('replan');
    expect(classifyWriteFailure({ status: 403, code: 'confirm-required', message: '确认票据已过期' }).kind).toBe('replan');
    expect(classifyWriteFailure({ status: 404, code: 'not-found', message: 'x' }).kind).toBe('protocol');
    expect(classifyWriteFailure({ status: 405, code: 'method-not-allowed', message: 'x' }).kind).toBe('protocol');
    expect(classifyWriteFailure({ status: 503, code: 'rules-unavailable', message: 'x' }).kind).toBe('unavailable');
    expect(classifyWriteFailure({ status: 500, code: '', message: '' }).code).toBe('http-500');
    console.log('  · 扫了 6 组码：replan 2 / unavailable 1 / protocol 2 / 兜底码 1');
  });

  it('网络异常 ⇒ protocol（不猜、不重试）', async () => {
    const channel = createWriteChannel({
      token: () => TEST_TOKEN,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const outcome = await channel.plan(TARGET);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.kind).toBe('protocol');
      expect(outcome.failure.message).toContain('ECONNREFUSED');
    }
    expect(channel.requestCount()).toBe(1);
    console.log('  · 扫了 1 条网络异常：kind=protocol、请求数 1');
  });
});

describe('T3.1 响应解析：命令原文原样搬运', () => {
  it('逐字保留 commandText（含首尾空格与换行），票据/提权档/说明都读出来', () => {
    const payload = planPayload({
      scope: 'lan',
      ports: [
        { port: 3306, steps: [{ kind: 'portproxy-add', commandText: CMD_PORT_PROXY }, { kind: 'firewall-add', commandText: '  New-NetFirewallRule ...  \n' }], notes: ['逐端口说明'] },
        { port: 5432, steps: [{ kind: 'portproxy-add', commandText: '  netsh ... \n' }], notes: [] },
      ],
      notes: ['总说明'],
    });
    const plan = parsePlanPayload(payload);
    expect(plan.planId).toBe('plan-abcdef0123456789');
    expect(plan.scope).toBe('lan');
    expect(plan.ticket).toBe('tkt-1');
    expect(plan.elevation).toEqual({ policy: 'ask', backend: 'gsudo', available: true });
    expect(plan.ports.map((port) => port.port)).toEqual([3306, 5432]);
    expect(plan.ports[0]?.steps[0]?.commandText).toBe(CMD_PORT_PROXY);
    expect(plan.ports[0]?.steps[1]?.commandText).toBe('  New-NetFirewallRule ...  \n');
    expect(plan.ports[1]?.steps[0]?.commandText).toBe('  netsh ... \n');
    expect(plan.notes).toEqual(['总说明']);
    expect(plan.ports[0]?.notes).toEqual(['逐端口说明']);
    console.log(`  · 扫了 2 个端口 / 3 条步骤：commandText 逐字相等（含首尾空格与换行）`);
  });

  it('被拦下的计划：ready=false / planId=null / 无票据 / 带可读原因', () => {
    const plan = parsePlanPayload(
      planPayload({
        planId: null,
        ready: false,
        ticket: null,
        blockedReason: '端口不在所有权集合内',
        ports: [{ port: 5173, ready: false, steps: [], blocked: { reason: 'port-not-managed', message: '端口 5173 不在声明集合内', hint: '先把它加进 managedPorts' } }],
      }),
    );
    expect(plan.planId).toBeNull();
    expect(plan.ready).toBe(false);
    expect(plan.ticket).toBeNull();
    expect(plan.blockedReason).toContain('所有权');
    expect(plan.ports[0]?.blocked?.reason).toBe('port-not-managed');
    console.log('  · 扫了 1 份被拦下的计划：planId/ready/ticket/原因 四项都如实透出');
  });

  it('执行回执四项清单都读出来', () => {
    const report = parseApplyPayload(
      applyPayload({
        status: 'partial',
        executed: ['portproxy-add'],
        skipped: ['firewall-add'],
        failed: [{ name: 'portproxy-add', reason: 'exit 999' }],
        rolledBack: [{ port: 3306, ok: true, message: '已删除本轮新增规则' }],
      }),
    );
    expect(report.status).toBe('partial');
    expect(report.executed).toEqual(['portproxy-add']);
    expect(report.skipped).toEqual(['firewall-add']);
    expect(report.failed).toEqual([{ name: 'portproxy-add', reason: 'exit 999' }]);
    expect(report.rolledBack).toEqual([{ port: 3306, ok: true, message: '已删除本轮新增规则' }]);
    expect(report.durationMs).toBe(321);
    console.log('  · 扫了 4 张清单：executed/skipped/failed/rolledBack 各 1 条');
  });
});

describe('T3.1 所有权声明读取器：复用宿主的解析器', () => {
  const settingsWith = (managedPorts: readonly string[], ok = true) => ({
    readConfig: async () => ({ managedPorts, distro: undefined, elevationPolicy: undefined, scopes: {} }),
    updateCount: () => 0,
    writeManagedPorts: async () => ({ ok, message: '', patch: {}, revisionPassed: false }),
    writeDistro: async () => ({ ok, message: '', patch: {}, revisionPassed: false }),
    writeElevationPolicy: async () => ({ ok, message: '', patch: {}, revisionPassed: false }),
    writeScope: async () => ({ ok, message: '', patch: {}, revisionPassed: false }),
    writeWriteToken: async () => ({ ok, message: '', patch: {}, revisionPassed: false }),
  });

  it('管道缺失 ⇒ 可读原因（不发任何请求）', async () => {
    const outcome = await createDeclarationReader(undefined)();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('未接线');
    console.log('  · 扫了 1 条未接线路径：结果里带可读原因');
  });

  it('合法声明 ⇒ 区间原样（不展开）；非法声明 ⇒ 逐项原因 + 不发请求', async () => {
    const good = await createDeclarationReader(settingsWith(['3306', '1000-1005']))();
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.ports).toEqual([{ start: 3306, end: 3306 }, { start: 1000, end: 1005 }]);
    const bad = await createDeclarationReader(settingsWith(['3306', 'abc']))();
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toContain('第 2 项');
      expect(bad.message).toContain('零请求');
    }
    console.log('  · 扫了 2 组声明：合法 2 个区间 / 非法 1 处带「第 N 项」原因');
  });
});
