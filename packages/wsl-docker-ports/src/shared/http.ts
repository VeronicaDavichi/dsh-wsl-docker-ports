/**
 * **共享 HTTP 面**（015 `P1`）—— 001 版 `route.ts` 里的宿主路由底座，搬到 `src/shared/` 供两侧共用。
 *
 * ## 为什么必须搬（而不是两侧各持一份）
 *
 * 015 把「转发」与「容器」拆成两条 cordis 行，两条行都在**同一个模块实例**里跑。若两边的路由底座
 * 各写一份，最先分叉的必然是「响应头 / 判据顺序 / 惰性注入时机」这类**看起来一样**的东西 ——
 * 它们恰恰是本仓历史上真出过缺陷的地方（003 缺陷 A / B2）。故：**一份实现，两处 import**。
 *
 * ## 白名单（015 §4.1）
 *
 * `src/shared/**` 只允许 **字段无关 / 业务无关** 的底座（本文件：HTTP 请求响应面 + 路由面判定 +
 * JSON 出口 + 限长读体）。**禁止**把 `snapshot` / `route` / `wire` / `config` / `plugin` 的任何业务
 * 判断搬进来 —— 判据由 `scripts/check-borders.mjs` 的 R3 逐条扫。
 *
 * ## 与旧落点的关系（零行为变化）
 *
 * `src/route.ts` / `src/docker/route.ts` 的原有导出**一个不少**：前者再导出本文件的名字，后者的
 * `registerContainerRoute`（010 的旧前缀）原样保留（015 起运行时不再接线，测试仍直接调用它）。
 * 判据：015 的 `P1` 门跑完既有 527 条 `node --test`，形状断言零改动。
 */

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

/**
 * 路由注册用到的 ctx 面（三个成员都可选：测试与降级路径都要能在没有它们的 ctx 上跑完）。
 *
 * `inject` 是**缺陷 A 的修法所在**：`ctx.inject(['webServer'], cb)` 的回调在服务可用时才跑
 * （服务已在 ⇒ 同步跑；后到 ⇒ 后到就跑），这就是「宿主可用时机」。
 */
export interface RoutePluginContextLike {
  readonly get?: (serviceName: string) => unknown;
  readonly inject?: ((names: readonly string[], callback: (scope: RoutePluginContextLike) => void) => unknown) | undefined;
  readonly effect?: (callback: () => (() => void) | void, label?: string) => unknown;
}

/** 宿主 webServer 的服务名（**唯一**字面量，别在别处再写一遍） */
export const WEB_SERVER_SERVICE = 'webServer';

/** 结构面判定（duck typing，不 import 宿主类型） */
export function isWebServerSurface(value: unknown): value is WebServerSurfaceLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WebServerSurfaceLike>;
  return typeof candidate.register === 'function';
}

/**
 * 从注入回调拿到的 scope 里取 webServer。
 *
 * 三种写法都收（官方调用点里两种都出现过）：`scope.get('webServer')`（本仓既有口径）、
 * cordis 注入作用域上的直接属性 `scope.webServer`、以及「回调直接收到服务本身」。
 * 拿不到就返回 `undefined`，由调用方记成 `missing`（**不抛**）。
 */
export function resolveWebServer(scope: unknown): WebServerSurfaceLike | undefined {
  if (typeof scope !== 'object' || scope === null) return undefined;
  const candidate = scope as { get?: (name: string) => unknown; webServer?: unknown };
  const viaGet = typeof candidate.get === 'function' ? candidate.get(WEB_SERVER_SERVICE) : undefined;
  if (isWebServerSurface(viaGet)) return viaGet;
  if (isWebServerSurface(candidate.webServer)) return candidate.webServer;
  return isWebServerSurface(scope) ? scope : undefined;
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

export const ENCODER = new TextEncoder();

/**
 * 唯一的 JSON 出口（`Content-Length` 按 UTF-8 字节算 —— 中文文案按字符算会短，长连接会串包）。
 *
 * `payload` 是 `unknown`：本函数**不解释**业务错误码，状态码由调用方给（两侧各有一套码表）。
 */
export function sendJson(response: HttpResponseLike, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(ENCODER.encode(body).length));
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

/** 可异步迭代的请求体（Node `IncomingMessage` 形状；测试替身按需实现） */
export interface BodyRequestLike extends HttpRequestLike {
  [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array | string>;
}

export type ReadBodyOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * 读请求体：限长、容忍空体、畸形/超限**不抛**（变成 400 的可读原因）。
 *
 * `maxBytes` 由调用方给 —— 两条通道的体量语义不同（写通道 64 KiB、容器动作 8 KiB），
 * 把上限写死在这里等于替调用方决定风险面。
 */
export async function readJsonBody(request: BodyRequestLike, maxBytes: number): Promise<ReadBodyOutcome> {
  if (typeof request[Symbol.asyncIterator] !== 'function') return { ok: true, value: undefined };
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for await (const chunk of request as AsyncIterable<Uint8Array | string>) {
      bytes += typeof chunk === 'string' ? ENCODER.encode(chunk).length : chunk.byteLength;
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

/** `?a=b`（不认识的参数一律忽略，与 003 的快照查询同口径；畸形 url ⇒ 空表，不抛） */
export function queryOf(url: string | undefined): URLSearchParams {
  try {
    return new URL(url ?? '/', 'http://dsh.invalid').searchParams;
  } catch {
    return new URLSearchParams();
  }
}
