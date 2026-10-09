/**
 * fake `ctx.webServer` 与 fake 插件上下文（002 Phase 3 测试基建）
 *
 * 🔴 分派判据**逐字复刻宿主**（`dsh-host-webserver/lib/index.js` 的 `match(pathname)`，本机 asar 内原文）：
 *
 *   const exact = this.exact.get(pathname);
 *   if (exact !== void 0) return exact;
 *   let best;
 *   for (const [prefix, route] of this.prefixes) {
 *     if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
 *     if (best === void 0 || prefix.length > best.path.length) best = route;
 *   }
 *   return best;
 *
 * ⇒ **exact 全表 → 最长 prefix → 兜底**（官方 README：无 fallback owner 时答 404）。
 * ⚠️ 旧版本这里写的是裸 `pathname.startsWith(prefix)`，那会把「prefix 带尾斜杠」这个真机缺陷 B
 * **遮住**（`/dsh-managed-terminal/` 会被裸 startsWith 命中）⇒ 已按上面逐字改严，并留了一条反控用例。
 *
 * 重复 `(kind, path)` 注册**真的抛错**，与已核实的宿主行为一致 —— T3.1 的「只注册一次、卸载归零」判据全靠它。
 */

import { createFakeSocket } from './ws-socket-fakes.ts';
import type { FakeSocket } from './ws-socket-fakes.ts';
import type {
  ChannelPluginContext,
  HttpRequestLike,
  HttpResponseLike,
  WebServerRoute,
  WebServerSurface,
  WebServerUpgrade,
} from '../../src/ws/types.ts';

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ fake webServer */

export interface FakeHttpCall {
  /** `fallback` = 没有具名路由匹配（官方 fallback 行为） */
  readonly status: number | 'fallback';
  readonly body: string;
  readonly headers: Record<string, string>;
}

export interface FakeWebServer {
  readonly surface: WebServerSurface;
  readonly registerCalls: { kind: string; path: string }[];
  readonly upgradeCalls: { path: string }[];
  readonly handlerCalls: number;
  readonly duplicateAttempts: number;
  liveCount(): number;
  /** 宿主分派结果（`exact` / `prefix` / `fallback`=没有具名路由匹配） */
  dispatchKind(path: string): 'exact' | 'prefix' | 'fallback';
  invokeHttp(path: string, options?: { method?: string; headers?: Record<string, string> }): Promise<FakeHttpCall>;
  /** 宿主层的**最终**响应：没有具名路由匹配 ⇒ 兜底 404（不是 `'fallback'` 标记） */
  invokeHttpHost(path: string, options?: { method?: string; headers?: Record<string, string> }): Promise<FakeHttpCall>;
  invokeUpgrade(path: string, options?: { headers?: Record<string, string> }): FakeSocket;
}

export function createFakeWebServer(): FakeWebServer {
  const routes: WebServerRoute[] = [];
  const upgrades: WebServerUpgrade[] = [];
  const registerCalls: { kind: string; path: string }[] = [];
  const upgradeCalls: { path: string }[] = [];
  let handlerCalls = 0;
  let duplicateAttempts = 0;

  const surface: WebServerSurface = {
    register(route: WebServerRoute): () => void {
      if (routes.some((item) => item.kind === route.kind && item.path === route.path)) {
        duplicateAttempts += 1;
        // 宿主真实行为：重复 (kind, path) 直接抛错（REQ-7.6 的实证）
        throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
      }
      routes.push(route);
      registerCalls.push({ kind: route.kind, path: route.path });
      return () => {
        const at = routes.indexOf(route);
        if (at >= 0) routes.splice(at, 1);
      };
    },
    registerUpgrade(upgrade: WebServerUpgrade): () => void {
      if (upgrades.some((item) => item.path === upgrade.path)) {
        duplicateAttempts += 1;
        throw new Error(`webserver: duplicate upgrade route "${upgrade.path}"`);
      }
      upgrades.push(upgrade);
      upgradeCalls.push({ path: upgrade.path });
      return () => {
        const at = upgrades.indexOf(upgrade);
        if (at >= 0) upgrades.splice(at, 1);
      };
    },
  };

  const match = (path: string): WebServerRoute | undefined => {
    const exact = routes.find((item) => item.kind === 'exact' && item.path === path);
    if (exact !== undefined) return exact;
    // 宿主原文逐字：`pathname !== prefix && !pathname.startsWith(`${prefix}/`)` 则跳过；否则最长 prefix 胜
    let best: WebServerRoute | undefined;
    for (const route of routes.filter((item) => item.kind === 'prefix')) {
      if (path !== route.path && !path.startsWith(`${route.path}/`)) continue;
      if (best === undefined || route.path.length > best.path.length) best = route;
    }
    return best;
  };

  const runHttp = async (
    path: string,
    options: { method?: string; headers?: Record<string, string> } = {},
  ): Promise<FakeHttpCall> => {
    const route = match(path);
    if (route === undefined) return { status: 'fallback', body: '', headers: {} };
    handlerCalls += 1;
    const headers: Record<string, string> = {};
    let body = '';
    let status = 200;
    const request: HttpRequestLike = {
      url: path,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
    };
    const response: HttpResponseLike = {
      statusCode: 200,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      end(chunk?: string) {
        status = response.statusCode ?? 200;
        body = chunk ?? '';
      },
    };
    await route.handler(request, response);
    return { status, body, headers };
  };

  return {
    surface,
    registerCalls,
    upgradeCalls,
    get handlerCalls(): number {
      return handlerCalls;
    },
    get duplicateAttempts(): number {
      return duplicateAttempts;
    },
    liveCount: () => routes.length + upgrades.length,
    dispatchKind(path: string): 'exact' | 'prefix' | 'fallback' {
      const route = match(path);
      return route === undefined ? 'fallback' : route.kind;
    },
    invokeHttp: runHttp,
    async invokeHttpHost(path, options = {}): Promise<FakeHttpCall> {
      const routed = await runHttp(path, options);
      // 官方 README：没有注册 fallback owner 时，服务器对「无具名路由匹配」的请求回 **404**
      return routed.status === 'fallback' ? { status: 404, body: '', headers: {} } : routed;
    },
    invokeUpgrade(path, options = {}): FakeSocket {
      const socket = createFakeSocket();
      const route = upgrades.find((item) => item.path === path);
      if (route === undefined) {
        socket.write(encoder.encode('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n'));
        socket.destroy();
        return socket;
      }
      route.handler({ url: path, method: 'GET', headers: options.headers ?? {} }, socket, undefined);
      return socket;
    },
  };
}
/* ------------------------------------------------------------------ fake ctx */

export interface FakeCtx {
  readonly ctx: ChannelPluginContext;
  readonly effectCount: () => number;
  /** 每次 `ctx.inject([...])` 请求的服务名（真机时序用） */
  readonly injectCalls: string[][];
  /** 「宿主服务到位」那一下：让 `get('webServer')` 开始返回它（真机 `+755ms` 的模型） */
  install(webServer: WebServerSurface): void;
  /** 触发已登记的注入回调（配合 `install` 用；`inject: 'none'` 时是空操作） */
  fireInject(): void;
  unload(): void;
}

export interface FakeCtxOptions {
  /**
   * `'none'`（缺省）= ctx 上**没有** `inject`（老宿主 / 测试替身）⇒ 走同步 `ctx.get` 兼容路径；
   * `'deferred'` = 有 `inject` 且**不**同步触发（真机缺陷 A 的时序：服务后到）。
   */
  readonly inject?: 'none' | 'deferred';
}

export function createFakeCtx(webServer: WebServerSurface | undefined, options: FakeCtxOptions = {}): FakeCtx {
  const disposers: (() => void)[] = [];
  const injectCalls: string[][] = [];
  const pending: Array<() => void> = [];
  let effects = 0;
  let current = webServer;
  let self: ChannelPluginContext;
  const ctx: ChannelPluginContext = {
    effect(callback: () => void | (() => void)): unknown {
      effects += 1;
      const dispose = callback();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
    get(name: string): unknown {
      return name === 'webServer' ? current : undefined;
    },
    ...(options.inject === 'deferred'
      ? {
          inject(services: readonly string[], callback: (scope: ChannelPluginContext) => void): unknown {
            injectCalls.push([...services]);
            pending.push(() => callback(self));
            return undefined;
          },
        }
      : {}),
  };
  self = ctx;
  return {
    ctx,
    injectCalls,
    effectCount: () => effects,
    install(next: WebServerSurface): void {
      current = next;
    },
    fireInject(): void {
      // **可重复触发**：真机的注入通知可能不止一次 ⇒ 「attach 必须幂等」这条判据要靠它才验得出来
      for (const fire of pending) fire();
    },
    unload(): void {
      for (const dispose of disposers.splice(0, disposers.length)) dispose();
    },
  };
}
