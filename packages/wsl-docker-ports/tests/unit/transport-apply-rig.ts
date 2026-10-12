/**
 * `transport-apply*.test.ts` 共用的**离线台架**（**不是**测试文件：`node --test` 的 glob 只吃
 * `tests/**\/*.test.ts`，故本文件不会被当成用例跑，也不会被 vitest 收走 —— vitest 的 `include`
 * 只有 `tests/client/**`；本文件只导出**函数与常量**，不含任何用例声明（零 `test` / `it` / `describe` 调用）。
 *
 * ## 为什么抽出来（2026-10-12 拆分，refactor 零行为改动）
 *
 * `tests/unit/transport-apply.test.ts` 拆前 `split('\n')` = **748**、check-size 口径 = **747**
 * ⇒ 超「单文件 ≤ 400 行」这条 **SHALL**（008 T4.1 / 001 NFR-5 同口径）。按**被测关注点**切成
 * `transport-apply-plan` / `-exec` / `-rollback` / `-wire` 四个用例文件 + 本台架：
 * 台架是**四份文件都用到**的那一半（事实面替身 + 假执行器 + argv 解析 + HTTP 最小宿主面），
 * 各文件的切面在它们自己的文件头里写明。🔴 **用例零删减、零改名**（拆前 16 条 = 拆后 16 条，
 * 名字集合 `Compare-Object` 空差）。
 *
 * ## 台架的形状
 *
 * 这一组用例是「确认票据 → 真执行 → 回滚 → 审计」的**离线证据**（**零真机、零真实进程、零写盘**）。
 * 证据强度的关键在于：每条「零执行 / 零写入」的用例都断言 **假执行器一次都没被调用**
 * （`fake.calls.length === 0`）+ **规则集合逐字节等于执行前** + **审计环空**；每条「真执行」的用例都断言
 * **提权脚本的 argv 逐字**（`-Action add -Port … -Address <eth0> -Scope …`）而不是只看状态码。
 *
 * 假执行器模拟的是**脚本对系统状态的影响**（同端口先清后加），回滚判据则完全依赖 005 的前后快照
 * ⇒ 「删得对」这件事是被**结构**证明的，不是被用例凑出来的。
 */

import assert from 'node:assert/strict';

import type { ManagedPorts } from '../../src/diff/managed-ports.ts';
import type { ElevationDeps } from '../../src/elevate/types.ts';
import type { PortproxyRule } from '../../src/read/netsh.ts';
import type { HttpResponseLike, HttpRequestLike, RoutePluginContextLike, WebServerRoute, WebServerSurfaceLike } from '../../src/route.ts';
import { createApplyChannel } from '../../src/transport/apply.ts';
import type { ApplyInput, ApplyReport } from '../../src/transport/apply.ts';
import { createAuditLog } from '../../src/transport/audit.ts';
import type { AuditLog } from '../../src/transport/audit.ts';
import { createConfirmTickets } from '../../src/transport/confirm.ts';
import type { ConfirmTickets } from '../../src/transport/confirm.ts';
import { createPlanChannel } from '../../src/transport/plan.ts';
import type { PlanFacts, PlanResponse } from '../../src/transport/plan.ts';
import type { WriteRouteResult } from '../../src/transport/routes.ts';
import { createFakeExecutor } from '../helpers/fake-executor.ts';
import type { FakeExecutor, RecordedCall } from '../helpers/fake-executor.ts';
import { NATIVE_CHOICE, createFakeFs, okPayload, partialPayload, respondWith } from '../helpers/fake-elevation.ts';
import type { Responder } from '../helpers/fake-elevation.ts';
import { ETH0 } from './client-fixtures.ts';

/** 本项目声明管理的端口（集合外的一律不碰） */
export const PORT = 5900;
/** 「别人」的端口：代表本机既有 19 条里的任意一条 */
export const OTHER = 6379;
export const TARGET = { action: 'add', ports: [PORT], scope: 'lan' } as const;
/** 同一端口的另一个作用域：用来制造「可执行、但注册表里没有它的票」这种形态 */
export const TARGET_LOOPBACK = { action: 'add', ports: [PORT], scope: 'loopback' } as const;
const MANAGED: ManagedPorts = [{ start: PORT, end: PORT }];

export function foreignRule(): PortproxyRule {
  return { listenAddress: '0.0.0.0', listenPort: OTHER, connectAddress: ETH0, connectPort: OTHER };
}

/* ── argv 解析：native 把参数包进 `-Command` 字符串，gsudo 是独立元素 ⇒ 两种形态都认 ── */
export function textOf(call: RecordedCall): string {
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

export interface RigOptions {
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

export interface Rig {
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

export function createRig(options: RigOptions = {}): Rig {
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

export async function planOk(rig: Rig, target: unknown = TARGET): Promise<PlanResponse> {
  const outcome = await rig.planChannel(target);
  assert.equal(outcome.ok, true, '计划通道不该是通道级错误');
  return outcome.payload as PlanResponse;
}

export function ticketOf(response: PlanResponse): string {
  assert.notEqual(response.confirm, null, '可执行计划必须带票据');
  return response.confirm?.ticket ?? '';
}

/** 断言「拒绝」并取回可读的 code/message（`ok:false` 时才有） */
export function refusalOf(outcome: WriteRouteResult): { readonly code: string; readonly message: string } {
  assert.equal(outcome.ok, false, '这一步必须是拒绝（不执行、不写审计）');
  return outcome.ok ? { code: '', message: '' } : { code: outcome.code, message: outcome.message };
}

export function reportOf(outcome: WriteRouteResult): ApplyReport {
  assert.equal(outcome.ok, true, 'apply 的执行结果走 200 + 状态判别式（不是 HTTP 错误）');
  return outcome.ok ? (outcome.payload as ApplyReport) : ({} as ApplyReport);
}

/** 按调用次序应答的规则名来源（`[]` = 还没有；`Error` = 读失败）——用来复刻 TOCTOU 窗口 */
export function readScript(script: readonly (readonly string[] | Error)[]): () => Promise<readonly string[]> {
  let index = 0;
  return () => {
    const item = script[Math.min(index, script.length - 1)] ?? [];
    index += 1;
    return item instanceof Error ? Promise.reject(item) : Promise.resolve(item);
  };
}

/* ── ⑨/⑩ 接线用的最小宿主面（HTTP 往返：证明 wire-plugin 里 plan 与 apply 用的是**同一个**票据注册表） ── */
const encoder = new TextEncoder();

/** T2.9 写通道凭据（缺省 ⇒ 401；这两个往返用例证明「带对凭据 ⇒ 执行链逐字不变」） */
export const WRITE_TOKEN = 'tk-apply-4b7e19';

export function fakeSurface(): { readonly surface: WebServerSurfaceLike; readonly routes: WebServerRoute[] } {
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

export function fakeCtx(surface: WebServerSurfaceLike): RoutePluginContextLike {
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
    // T2.9：写通道要凭据 ⇒ 这两个 HTTP 往返用例一律带对（`?token=`）；401 的判据在
    // `transport-write-auth.test.ts`，本台架只证明「带对凭据 ⇒ 票据门/执行链逐字不变」
    url: `${path}?token=${WRITE_TOKEN}`,
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

export async function roundTrip(
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
