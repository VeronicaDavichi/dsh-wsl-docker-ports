/**
 * 自建 `ctx.webServer` 具名路由（003 T6.8 / REQ-7 的 P0 用法）
 *
 * ## 为什么自己注册而不蹭 002 的 `/dsh-managed-terminal/`
 *
 * 宿主按「exact → 最长 prefix → fallback」匹配，**重复 `(kind, path)` 会直接抛错**。
 * 两个包各占一个前缀才互不影响；蹭别人的前缀会在对方改路径时立刻坏掉，而且
 * 卸载顺序会决定谁把谁的路由删掉。故本包独占 `/dsh-wsl-docker-ports/`。
 *
 * ## HTTP 用 `prefix`，**不需要** upgrade
 *
 * 快照是「一问一答的只读数据」，没有服务端推送需求 ⇒ 只用 `register({kind:'prefix'})`。
 * `registerUpgrade` 只支持**exact** path，本波不需要，也就不引入那份复杂度。
 *
 * ## 🔴 disposer 必须登记到 `ctx.effect`
 *
 * 宿主**不会**自动收集 `register()` 返回的 disposer。漏登记 = 「插件卸载了、路由还在，
 * 再次挂载会因重复 `(kind,path)` 直接抛错」。判据（`tests/unit/route.test.ts`）：
 * 卸载后 `registrationCount() === 0`，且响应不再可达。
 *
 * ## 装载期零外部命令
 *
 * `registerPortsRoute()` 只做注册：**一条命令都不跑**。探针全部发生在请求处理里
 * （`handler` → `PortsSource` → `snapshot.build()`）。判据同 T6.7。
 */

import { PORTS_HTTP_PREFIX, PORTS_SNAPSHOT_METHOD, PORTS_SNAPSHOT_PATH, parseSnapshotQuery } from './wire.ts';
import type { PortsErrorCode, PortsSnapshotResponse } from './wire.ts';
import type { SnapshotBuilder } from './snapshot.ts';

/** 宿主 `webServer` 的路由处理器响应面（形状按 Node `http.ServerResponse` 取，与 002 同一假设） */
export interface HttpResponseLike {
  statusCode?: number | undefined;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface HttpRequestLike {
  readonly url?: string | undefined;
  readonly method?: string | undefined;
}

export interface WebServerRoute {
  readonly kind: 'exact' | 'prefix';
  readonly path: string;
  readonly handler: (request: HttpRequestLike, response: HttpResponseLike) => void | Promise<void>;
}

export interface WebServerSurfaceLike {
  register(route: WebServerRoute): () => void;
}

/** 路由注册用到的 ctx 面（`get` / `effect` 都可选：测试与降级路径都要能跑完） */
export interface RoutePluginContextLike {
  readonly get?: (serviceName: string) => unknown;
  readonly effect?: (callback: () => (() => void) | void, label?: string) => unknown;
}

export interface PortsRouteRegistration {
  /** 宿主提供了 webServer 并成功登记 ⇒ true */
  readonly registered: boolean;
  readonly reason?: string | undefined;
  readonly paths: { readonly prefix: string; readonly snapshot: string };
  /** 处理过的请求数（测试用：证明「装载期零请求」与「请求真被处理」） */
  requestCount(): number;
  /** 当前仍生效的注册数（卸载后必须归零） */
  registrationCount(): number;
  dispose(): void;
}

/** 结构面判定（duck typing，不 import 宿主类型） */
export function isWebServerSurface(value: unknown): value is WebServerSurfaceLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WebServerSurfaceLike>;
  return typeof candidate.register === 'function';
}

/** 取路径（去掉 query/hash；畸形 url 退到原串，绝不抛） */
export function pathOf(url: string | undefined): string {
  if (url === undefined || url === '') return '/';
  try {
    return new URL(url, 'http://dsh.invalid').pathname;
  } catch {
    return url;
  }
}

const encoder = new TextEncoder();

/** 唯一的响应出口（`Content-Length` 按 UTF-8 字节算 —— 中文文案按字符算会短，长连接会串包） */
function sendJson(response: HttpResponseLike, status: number, payload: PortsSnapshotResponse | { readonly ok: false; readonly error: { readonly code: PortsErrorCode; readonly message: string } }): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(encoder.encode(body).length));
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function statusFor(code: PortsErrorCode): number {
  if (code === 'not-found') return 404;
  if (code === 'method-not-allowed') return 405;
  if (code === 'rules-unavailable') return 503;
  return 500;
}

/**
 * 注册快照路由。
 *
 * ⚠️ 缺 `webServer` 时**不注册任何路由并给出原因**（非严格 `ctx.get`），
 * **不是**让整个插件加载失败 —— 客户端半会按 `ports-source-missing` 降级。
 */
export function registerPortsRoute(ctx: RoutePluginContextLike, builder: SnapshotBuilder): PortsRouteRegistration {
  const paths = { prefix: PORTS_HTTP_PREFIX, snapshot: PORTS_SNAPSHOT_PATH } as const;
  let count = 0;
  let requests = 0;

  const fail = (response: HttpResponseLike, code: PortsErrorCode, message: string): void => {
    sendJson(response, statusFor(code), { ok: false, error: { code, message } });
  };

  const handler = async (request: HttpRequestLike, response: HttpResponseLike): Promise<void> => {
    requests += 1;
    try {
      if (pathOf(request.url) !== PORTS_SNAPSHOT_PATH) {
        fail(response, 'not-found', `未知路径：本前缀只提供 ${PORTS_SNAPSHOT_PATH}`);
        return;
      }
      if ((request.method ?? PORTS_SNAPSHOT_METHOD).toUpperCase() !== PORTS_SNAPSHOT_METHOD) {
        fail(response, 'method-not-allowed', `快照只接受 ${PORTS_SNAPSHOT_METHOD}`);
        return;
      }
      const query = parseSnapshotQuery(request.url);
      const outcome = await builder.build(query.declaration, { allowColdStart: query.allowColdStart });
      if (!outcome.ok) {
        fail(response, outcome.code, outcome.message);
        return;
      }
      sendJson(response, 200, { ok: true, snapshot: outcome.snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(response, 'internal', `处理快照请求时抛出未预期异常：${message}`);
    }
  };

  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
  if (!isWebServerSurface(webServer)) {
    return {
      registered: false,
      reason: '宿主未提供 webServer 服务（非严格 ctx.get）：快照路由不注册，客户端半将按 ports-source-missing 降级。',
      paths,
      requestCount: () => 0,
      registrationCount: () => 0,
      dispose: (): void => undefined,
    };
  }

  /** 注册一次；`ctx.effect` 存在就交给它收编，否则退回「手动 dispose」 */
  let hostDispose: (() => void) | null = null;
  let done = false;
  const disposeOnce = (): void => {
    if (done) return;
    done = true;
    count -= 1;
    if (hostDispose !== null) hostDispose();
  };
  const install = (): () => void => {
    hostDispose = webServer.register({ kind: 'prefix', path: PORTS_HTTP_PREFIX, handler });
    count += 1;
    return disposeOnce;
  };

  if (typeof ctx.effect === 'function') ctx.effect(install, 'dsh-wsl-docker-ports: snapshot route');
  else install();

  return { registered: true, paths, requestCount: () => requests, registrationCount: () => count, dispose: disposeOnce };
}
