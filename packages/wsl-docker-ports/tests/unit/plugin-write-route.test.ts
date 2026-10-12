/**
 * 写通道路由与 `/write/plan` 的**端到端**断言（`node --test`，零真机、零真进程）
 * —— 2026-10-12 009 收口轮 T5 从 `plugin-entry.test.ts` 拆出（拆前 `split('\n')` = **461**，超 SHALL 400）
 *
 * 三条判据：
 * ① **T1.7/T1.4**：装载期零外部命令、两条**独占前缀**路由（只读 + 写通道）、卸载归零；
 * ② **T2.6 + 008 T3**：`elevationPolicy` 与防火墙规则名**真接到事实面**（假执行器答「本机已有 5900 那条」
 *    ⇒ 计划阶段就被 `firewall-rule-exists` 拦下；接线前 `firewallNames` 恒缺 ⇒ 这一门从不启用）；
 * ③ **T2.9 fail-safe**：未配置 `writeToken` ⇒ plan 也 **401**，且**一条只读命令都不跑**
 *    （判据在一切副作用之前）。
 *
 * 🔴 全部走**假宿主面 + 假执行器**：`dispatchPlan` 调的是真插件注册的处理器，但没有真进程、没有真机。
 * 台架（`routingExecutor` / `fakeCtx`）在 `../helpers/plugin-rig.ts`。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyWslDockerPorts } from '../../src/plugin.ts';
import type { PluginContextLike } from '../../src/plugin.ts';
import type { HttpRequestLike, HttpResponseLike, WebServerRoute } from '../../src/route.ts';
import { WRITE_PLAN_PATH } from '../../src/transport/constants.ts';
import { createFakeExecutor } from '../helpers/fake-executor.ts';
import { fakeCtx, routingExecutor } from '../helpers/plugin-rig.ts';
/* ── 008 T2.6 + T3：配置读取（`elevationPolicy`）与防火墙规则名现读**真接到事实面** ── */

const encoder = new TextEncoder();

/** T2.9 写通道凭据（走真插件的 config ⇒ 证明「配置真被读到并用于鉴权」；缺它一切写请求 401） */
const WRITE_TOKEN = 'tk-entry-8d2c40';

/** 走一次真的 `/write/plan` 处理器（假宿主面 + 假执行器 ⇒ 零真进程、零真机） */
async function dispatchPlan(
  routes: readonly WebServerRoute[],
  body: string,
): Promise<{ readonly status: number; readonly payload: Record<string, unknown> }> {
  // 写通道以**前缀**注册（`/dsh-wsl-docker-ports/write`，而只读路由的前缀 `/dsh-wsl-docker-ports` 也命中）
  // ⇒ 按宿主口径取「**最长**前缀命中」那条，别把请求喂给只读路由
  const route = routes
    .filter((item) => (item.kind === 'prefix' ? WRITE_PLAN_PATH.startsWith(item.path) : item.path === WRITE_PLAN_PATH))
    .sort((left, right) => right.path.length - left.path.length)[0];
  assert.notEqual(route, undefined, `宿主应当已注册 ${WRITE_PLAN_PATH} 处理器`);
  const box = { status: 0, body: '' };
  const request = {
    // T2.9：`plan` 也要凭据（与 apply / audit 同一份；缺配置或凭据不符 ⇒ 401）
    url: `${WRITE_PLAN_PATH}?token=${WRITE_TOKEN}`,
    method: 'POST',
    [Symbol.asyncIterator]: async function* (): AsyncIterator<Uint8Array> {
      yield encoder.encode(body);
    },
  } as HttpRequestLike;
  const response: HttpResponseLike = {
    get statusCode(): number {
      return box.status;
    },
    set statusCode(value: number) {
      box.status = value;
    },
    setHeader: () => undefined,
    end: (text?: string) => {
      box.body = text ?? '';
    },
  };
  await route?.handler(request, response);
  return { status: box.status, payload: JSON.parse(box.body) as Record<string, unknown> };
}

/** 装配一套「有 webServer」的宿主面，返回注册到的路由（每个用例各造一套，互不干扰） */
function attachedRoutes(config: { readonly elevationPolicy?: string; readonly writeToken?: string } | undefined): { readonly routes: WebServerRoute[]; readonly fake: ReturnType<typeof createFakeExecutor> } {
  const routes: WebServerRoute[] = [];
  const surface = {
    register: (route: WebServerRoute) => {
      routes.push(route);
      return () => {
        routes.splice(0);
      };
    },
  };
  const host = fakeCtx();
  const ctx: PluginContextLike = { ...host.ctx, get: (serviceName: string) => (serviceName === 'webServer' ? surface : undefined) };
  const fake = routingExecutor();
  applyWslDockerPorts(ctx, config, { executor: fake.executor });
  return { routes, fake };
}

const PLAN_BODY = JSON.stringify({ action: 'add', ports: [5900], scope: 'lan', declaration: [{ start: 5900, end: 5900 }] });

test('008 T3 配置读取：`elevationPolicy` 从插件 config 进事实面（缺省 ⇒ `unknown` ⇒ 执行层按 `none`）；T2.9 未配 `writeToken` ⇒ 401', async () => {
  const configured = attachedRoutes({ elevationPolicy: 'ask', writeToken: WRITE_TOKEN });
  const asked = await dispatchPlan(configured.routes, PLAN_BODY);
  assert.equal(asked.status, 200, `计划必须成功（否则下面的断言恒真）：${JSON.stringify(asked.payload)}`);
  const elevation = asked.payload['elevation'] as { policy?: string; available?: boolean } | undefined;
  assert.equal(elevation?.policy, 'ask', '清单/配置页给的值必须真的成为 `facts.elevation().policy`（不是常量 unknown）');

  // 🔴 顺手钉住 T2.6 的接线：假执行器答了「本机已有 5900 那条」⇒ 计划阶段就被 `firewall-rule-exists` 拦下
  //    （接线前 `firewallNames` 恒缺 ⇒ 这一门从不启用，计划反而会「可执行」）
  const ports = asked.payload['ports'] as { blocked?: { reason?: string } }[] | undefined;
  assert.equal(ports?.[0]?.blocked?.reason, 'firewall-rule-exists', '`createPluginFacts` 必须真接防火墙规则名现读');
  assert.equal(asked.payload['planId'], null, '被拦下的计划不给 planId（没有票据可用）');

  const unconfigured = attachedRoutes({ writeToken: WRITE_TOKEN });
  const plain = await dispatchPlan(unconfigured.routes, PLAN_BODY);
  const plainElevation = plain.payload['elevation'] as { policy?: string } | undefined;
  assert.equal(plainElevation?.policy, 'unknown', '没配置 elevationPolicy ⇒ unknown（**不假装**用户选过；执行层据此按 none 不写）');

  // 🔴 T2.9：**没配 writeToken** ⇒ 同一个真插件装配下，写通道自己的鉴权把请求挡在 401（fail-safe）
  const noCredential = attachedRoutes({ elevationPolicy: 'ask' });
  const refused = await dispatchPlan(noCredential.routes, PLAN_BODY);
  assert.equal(refused.status, 401, '未配置 writeToken ⇒ plan 也 401（fail-safe：默认「通道不可用」而非「裸奔」）');
  assert.equal(
    (refused.payload['error'] as { code?: string } | undefined)?.code,
    'unauthorized',
    '拒绝必须用 `unauthorized`（与 404/405/503 的语义不重叠）',
  );
  assert.equal(noCredential.fake.calls.length, 0, '🔴 被鉴权拒掉的计划**一条只读命令都不跑**（判据在一切副作用之前）');

  // 🔴 零写入：两次计划都只跑了只读探针（netsh show / Get-NetFirewallRule / eth0 / wsl -l -v）
  for (const rig of [configured, unconfigured]) {
    assert.equal(rig.fake.calls.length > 0, true, '计划要真读（否则上面的断言可能恒真）');
    for (const call of rig.fake.calls) {
      const line = [call.file, ...call.argv].join(' ');
      assert.equal(/New-NetFirewallRule|Set-NetFirewallRule|Remove-NetFirewallRule|netsh interface portproxy (add|delete|set|reset)/u.test(line), false, `计划阶段不许有写命令：${line}`);
    }
  }
  const sawFirewallRead = configured.fake.calls.some((call) => call.file === 'powershell.exe' && call.argv.join(' ').includes('Get-NetFirewallRule'));
  assert.equal(sawFirewallRead, true, '防火墙规则名现读必须真被触发（只读 Get-NetFirewallRule）');
  console.log(`  · plan 真读了 ${String(configured.fake.calls.length)} 条只读命令；policy=ask / 缺省 unknown；firewallNames 已接线；未配 writeToken ⇒ 401 且零命令（T2.9）`);
});