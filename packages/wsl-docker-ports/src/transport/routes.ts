/**
 * 008 写入通道的 HTTP 路由（T1.1 骨架；REQ-1）
 *
 * ## 这一层**只做管道**，不做算法
 *
 * 路由只负责：前缀注册、**先路径后方法**的判据、请求体读取、统一 JSON 出口、错误码映射、
 * 幂等的 disposer 归 `ctx.effect`。动作计划（T1.3）、执行（T2.x）、审计（T1.6）都经 `deps`
 * 注入 ⇒ 单测可注入假实现，装载期**零外部命令、零副作用**（T1.4 的判据）。
 *
 * ## 判据顺序：先认路径，再谈方法
 *
 * 与 003 的 `route.ts` 同一口径（真机缺陷 B2 的教训）：未知路径一律 404，**不管方法是什么**；
 * 只有已知路径上的方法不符才是 405。两条各有一组回归用例。
 *
 * ## 时机与 disposer（照抄已修好的 003 模式）
 *
 * `webServer` 是**后到的**服务（真机 `+68ms` 取不到、`+755ms` 才到）⇒ 必须走惰性 `ctx.inject`，
 * 状态是**活 getter**；宿主不会自动收编 `register()` 返回的 disposer ⇒ 必须交给 `ctx.effect`，
 * 否则「插件卸载了、路由还在」，再次挂载会因重复 `(kind,path)` 直接抛错。
 *
 * ## 判据顺序：鉴权 → 路径 → 方法 → 请求体
 *
 * T2.9 起 **401 最靠前**：未带凭据的请求连「本前缀下存在哪些路径/方法」都读不到，也**不会**被读
 * 请求体（⇒ 未鉴权方无法拿 1MB 体逼我们分配），且 `deps` **一次都不被调用**、审计**一条都不写**。
 * 凭据校验见 `./write-auth.ts`（插件自有凭据；宿主没有可用的鉴权面 —— 侦察证据在 tasks.md T2.9）。
 * 已鉴权的请求进入下面的既有顺序 ⇒ 404 / 405 / 503 / 403 / 409 的语义**逐字不变**。
 *
 * ## 错误码：四个只读码 + 三个写侧码
 *
 * 复用 003 的 `not-found` / `method-not-allowed` / `rules-unavailable` / `internal`，
 * 写侧另加 **`confirm-required`(403)** 与 **`plan-mismatch`(409)**（见 design §4：未确认零写入、
 * 客户端篡改目标 ⇒ 拒绝）以及 **`unauthorized`(401)**（T2.9；与前三者语义不重叠）。
 * 四个只读码的语义与状态码**一字不改**。
 */

import { isWebServerSurface, pathOf } from '../route.ts';
import type { HttpRequestLike, HttpResponseLike, RoutePluginContextLike, WebServerSurfaceLike } from '../route.ts';
import type { ConfigValueSource } from '../config-read.ts';
import type { PortsErrorCode } from '../wire.ts';
import { createWriteAuthenticator } from './write-auth.ts';
import type { WriteHeaderBag } from './write-auth.ts';
import {
  WRITE_APPLY_METHOD,
  WRITE_APPLY_PATH,
  WRITE_AUDIT_METHOD,
  WRITE_AUDIT_PATH,
  WRITE_BODY_MAX_BYTES,
  WRITE_HTTP_PREFIX,
  WRITE_PLAN_METHOD,
  WRITE_PLAN_PATH,
} from './constants.ts';

/** 写侧错误码 = 003 的四个只读码 + 三个写侧码（语义见文件头） */
export type WriteErrorCode = PortsErrorCode | 'confirm-required' | 'plan-mismatch' | 'unauthorized';

/** 请求面：`url` / `method` 与 003 一致，另加「可异步迭代的请求体」（Node `IncomingMessage` 的形状）
 *  与 `headers`（T2.9 鉴权要读 `Authorization`；可选 ⇒ 只带 `?token=` 的客户端与既有测试不受影响） */
export interface WriteRequestLike extends HttpRequestLike {
  readonly headers?: WriteHeaderBag | undefined;
  [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array | string>;
}

/** 结果面：成功给 `status` + `payload`；失败给错误码 + 人类可读原因（REQ-NFR-4） */
export type WriteRouteResult =
  | { readonly ok: true; readonly status?: number | undefined; readonly payload: unknown }
  | { readonly ok: false; readonly code: WriteErrorCode; readonly message: string };

/** 三个端点的实现（T1.1 只定形状，实现分别落在 T1.3 / T2.x / T1.6） */
export interface WriteRouteDeps {
  /** 只读动作计划；`problem` 非空表示请求体畸形/超限（T1.5 要把它变成「空计划 + 该原因」） */
  readonly plan: (target: unknown, problem?: string) => Promise<WriteRouteResult>;
  /** 执行（T2.2/T2.3）；未接线时缺省 ⇒ 503 `rules-unavailable`（不是 500） */
  readonly apply?:
    | ((input: {
        readonly target: unknown;
        readonly planId: unknown;
        readonly confirmed: unknown;
        readonly origin: unknown;
        /** 一次性确认票据（T2.1 签发 / T2.2 消费）：**只加这一个字段**，其余语义一律不动 */
        readonly ticket: unknown;
        readonly problem?: string | undefined;
      }) => Promise<WriteRouteResult>)
    | undefined;
  /** 审计尾部（T1.6）；缺省 ⇒ 503 */
  readonly audit?: ((limit: unknown) => WriteRouteResult) | undefined;
  /**
   * 写通道凭据（T2.9）：`plan` / `apply` / `audit` **共用同一份**。
   * 🔴 **缺省 = 未配置 = 一律 401**（fail-safe；不是「放行」）—— 见 `./write-auth.ts`。
   * 形态三类都收（字符串 / volatile 活体包装 / 零参取值函数）：本包 `Config` 标了 volatile ⇒
   * 生产上传进来的是 `config-read.ts` 的**读取函数**，鉴权每次请求现读它（轮换凭据即时生效）。
   */
  readonly writeToken?: ConfigValueSource;
}

/** 与 003 同名的活状态（惰性注入的回调可能晚于返回才跑） */
export type WriteRouteState = 'registered' | 'pending' | 'missing';

export interface WriteRouteRegistration {
  /** getter：注入回调一跑就翻 */
  readonly registered: boolean;
  readonly state: WriteRouteState;
  readonly reason?: string | undefined;
  /** 写通道凭据是否已配置（`false` ⇒ 三个端点恒 401，fail-safe；**不泄露**凭据本体） */
  readonly authConfigured: boolean;
  readonly paths: {
    readonly prefix: string;
    readonly plan: string;
    readonly apply: string;
    readonly audit: string;
  };
  requestCount(): number;
  registrationCount(): number;
  dispose(): void;
}

const WRITE_MISSING_REASON =
  '宿主未提供 webServer 服务：写入通道路由不注册，写入口保持不可达（读侧不受影响）。';

const WRITE_PENDING_REASON =
  "宿主此刻尚未提供 webServer：已登记 ctx.inject(['webServer'])，服务到位后自动注册（惰性注入的常态，不是失败）。";

const WEB_SERVER_SERVICE = 'webServer';

const encoder = new TextEncoder();

/** 写侧状态码映射（四个只读码与 003 逐字一致；写侧三码见 design §4 与 T2.9） */
export function statusForWrite(code: WriteErrorCode): number {
  if (code === 'not-found') return 404;
  if (code === 'method-not-allowed') return 405;
  if (code === 'rules-unavailable') return 503;
  if (code === 'confirm-required') return 403;
  if (code === 'plan-mismatch') return 409;
  if (code === 'unauthorized') return 401;
  return 500;
}

/** 唯一的响应出口：`Content-Length` 按 **UTF-8 字节**算（中文按字符算会短、长连接会串包） */
function sendJson(response: HttpResponseLike, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(encoder.encode(body).length));
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

/** 读请求体：限长、容忍空体、畸形/超限**不抛**（交给 `plan`/`apply` 变成可读原因） */
async function readJsonBody(
  request: WriteRequestLike,
  maxBytes: number,
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string }> {
  if (typeof request[Symbol.asyncIterator] !== 'function') return { ok: true, value: undefined };
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for await (const chunk of request as AsyncIterable<Uint8Array | string>) {
      bytes += typeof chunk === 'string' ? encoder.encode(chunk).length : chunk.byteLength;
      if (bytes > maxBytes) return { ok: false, reason: `请求体超过上限 ${String(maxBytes)} 字节` };
      text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    return { ok: false, reason: `读取请求体失败：${error instanceof Error ? error.message : String(error)}` };
  }
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, reason: `请求体不是合法 JSON：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 端点表（路径 → 方法 → 处理分支）：**唯一真相来源**，判据与文案都从这里取 */
const ENDPOINTS = [
  { kind: 'plan', path: WRITE_PLAN_PATH, method: WRITE_PLAN_METHOD },
  { kind: 'apply', path: WRITE_APPLY_PATH, method: WRITE_APPLY_METHOD },
  { kind: 'audit', path: WRITE_AUDIT_PATH, method: WRITE_AUDIT_METHOD },
] as const;

const KNOWN_PATHS = ENDPOINTS.map((endpoint) => endpoint.path).join(' / ');

/**
 * 注册写入通道路由。
 *
 * ⚠️ 缺 `webServer` 时**不注册并给出原因**（非严格取服务），不是让插件加载失败 ——
 * `registered` / `state` / `reason` 都是 **getter**，惰性注入后到也能读到。
 */
export function registerWriteRoute(ctx: RoutePluginContextLike, deps: WriteRouteDeps): WriteRouteRegistration {
  const paths = {
    prefix: WRITE_HTTP_PREFIX,
    plan: WRITE_PLAN_PATH,
    apply: WRITE_APPLY_PATH,
    audit: WRITE_AUDIT_PATH,
  } as const;
  // 凭据在**注册期**定下来（T2.9）：请求期不再读配置 ⇒ 不存在「半个请求换了一份配置」的窗口
  // 🔴 但「定下来的」是**来源**（可能是 `config-read.ts` 的现读函数，也可能就是字符串）：
  // 鉴权器每次 `authorize()` 现解包，故 volatile 轮换凭据即时生效，而单次请求内只解包一次。
  const auth = createWriteAuthenticator(deps.writeToken);
  let requests = 0;
  let live = 0;
  let state: WriteRouteState = 'missing';
  let reason: string | undefined = WRITE_MISSING_REASON;
  let hostDispose: (() => void) | null = null;
  let disposed = false;

  const fail = (response: HttpResponseLike, code: WriteErrorCode, message: string): void => {
    sendJson(response, statusForWrite(code), { ok: false, error: { code, message } });
  };

  const handler = async (request: WriteRequestLike, response: HttpResponseLike): Promise<void> => {
    requests += 1;
    try {
      // 🔴 T2.9 鉴权**最靠前**：未带凭据 ⇒ 401，且不认路径/方法、不读请求体、不调 deps、不写审计
      const decision = auth.authorize(request);
      if (!decision.ok) {
        fail(response, decision.code, decision.message);
        return;
      }

      // 🔴 先认路径（未知路径不管方法一律 404），已知路径才谈方法 ⇒ 405 才可达
      const path = pathOf(request.url);
      const endpoint = ENDPOINTS.find((item) => item.path === path);
      if (endpoint === undefined) {
        fail(response, 'not-found', `未知路径：本通道只提供 ${KNOWN_PATHS}`);
        return;
      }
      if ((request.method ?? endpoint.method).toUpperCase() !== endpoint.method) {
        fail(response, 'method-not-allowed', `${endpoint.path} 只接受 ${endpoint.method}`);
        return;
      }

      if (endpoint.kind === 'audit') {
        if (deps.audit === undefined) {
          fail(response, 'rules-unavailable', '审计尚未接线：本次不返回任何记录（零副作用）。');
          return;
        }
        const outcome = deps.audit(undefined);
        if (!outcome.ok) {
          fail(response, outcome.code, outcome.message);
          return;
        }
        sendJson(response, outcome.status ?? 200, outcome.payload);
        return;
      }

      const body = await readJsonBody(request, WRITE_BODY_MAX_BYTES);
      const problem = body.ok ? undefined : body.reason;
      const value = body.ok ? body.value : undefined;

      if (endpoint.kind === 'plan') {
        const outcome = await deps.plan(value, problem);
        if (!outcome.ok) {
          fail(response, outcome.code, outcome.message);
          return;
        }
        sendJson(response, outcome.status ?? 200, outcome.payload);
        return;
      }

      if (deps.apply === undefined) {
        fail(response, 'rules-unavailable', '写执行尚未接线：本请求零提权、零写入。');
        return;
      }
      const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
      const outcome = await deps.apply({
        target: record['target'],
        planId: record['planId'],
        confirmed: record['confirmed'],
        origin: record['origin'],
        ticket: record['ticket'],
        problem,
      });
      if (!outcome.ok) {
        fail(response, outcome.code, outcome.message);
        return;
      }
      sendJson(response, outcome.status ?? 200, outcome.payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(response, 'internal', `处理写通道请求时抛出未预期异常：${message}`);
    }
  };

  const detach = (): void => {
    const host = hostDispose;
    hostDispose = null;
    live = 0;
    if (host !== null) host();
  };

  /** 注册一次；**幂等**（宿主对重复 `(kind,path)` 直接抛错 ⇒ 重复 attach 必须被吞掉） */
  const attach = (surface: WebServerSurfaceLike): void => {
    if (disposed || live > 0) return;
    hostDispose = surface.register({ kind: 'prefix', path: WRITE_HTTP_PREFIX, handler });
    live = 1;
    state = 'registered';
    reason = undefined;
  };

  /* ── 时机：优先惰性注入；只有没有 `inject` 的宿主才退回同步 `get` ── */
  if (typeof ctx.inject === 'function') {
    let fired = false;
    try {
      ctx.inject([WEB_SERVER_SERVICE], (scope) => {
        fired = true;
        const surface = resolveWebServer(scope);
        if (surface === undefined) {
          state = 'missing';
          reason = `webServer 已注入但形状不对（没有 register()）⇒ 写入路由不注册：${WRITE_MISSING_REASON}`;
          return;
        }
        attach(surface);
      });
      if (!fired) {
        state = 'pending';
        reason = WRITE_PENDING_REASON;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state = 'missing';
      reason = `ctx.inject(['${WEB_SERVER_SERVICE}']) 登记失败（${message}）⇒ 写入路由不注册：${WRITE_MISSING_REASON}`;
    }
  } else {
    const surface = typeof ctx.get === 'function' ? ctx.get(WEB_SERVER_SERVICE) : undefined;
    if (isWebServerSurface(surface)) attach(surface);
    else {
      state = 'missing';
      reason = WRITE_MISSING_REASON;
    }
  }

  const disposeOnce = (): void => {
    disposed = true;
    detach();
  };

  // 宿主不会自动收编 register() 的 disposer ⇒ 必须交给 ctx.effect
  if (typeof ctx.effect === 'function') ctx.effect(() => disposeOnce, 'dsh-wsl-docker-ports: write route');

  return {
    get registered(): boolean {
      return live > 0;
    },
    get state(): WriteRouteState {
      return state;
    },
    get reason(): string | undefined {
      return reason;
    },
    /** getter：凭据来源现读 ⇒ live 轮换后这里立刻翻，不吃注册期快照（**不泄露**凭据本体） */
    get authConfigured(): boolean {
      return auth.configured;
    },
    paths,
    requestCount: () => requests,
    registrationCount: () => live,
    dispose: disposeOnce,
  };
}

/** 从注入回调拿到的 scope 里取 webServer（三种写法都收，拿不到返回 `undefined`，**不抛**） */
function resolveWebServer(scope: unknown): WebServerSurfaceLike | undefined {
  if (typeof scope !== 'object' || scope === null) return undefined;
  const candidate = scope as { get?: (name: string) => unknown; webServer?: unknown };
  const viaGet = typeof candidate.get === 'function' ? candidate.get(WEB_SERVER_SERVICE) : undefined;
  if (isWebServerSurface(viaGet)) return viaGet;
  if (isWebServerSurface(candidate.webServer)) return candidate.webServer;
  return isWebServerSurface(scope) ? scope : undefined;
}
