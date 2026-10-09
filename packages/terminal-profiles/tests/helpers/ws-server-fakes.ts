/**
 * fake `ctx.webServer` 与 fake 插件上下文（002 Phase 3 测试基建）
 *
 * 记录 `register` / `registerUpgrade` 的调用与 handler，并按官方匹配顺序
 * （exact 全表 → 最长 prefix → fallback）派发；重复 `(kind, path)` 注册**真的抛错**，
 * 与已核实的宿主行为一致 —— T3.1 的「只注册一次、卸载归零」判据全靠它。
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
  invokeHttp(path: string, options?: { method?: string; headers?: Record<string, string> }): Promise<FakeHttpCall>;
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
    // 官方口径：exact 全表 → 最长 prefix → fallback
    const prefixes = routes.filter((item) => item.kind === 'prefix' && path.startsWith(item.path));
    return prefixes.sort((a, b) => b.path.length - a.path.length)[0];
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
    async invokeHttp(path, options = {}): Promise<FakeHttpCall> {
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
  unload(): void;
}

export function createFakeCtx(webServer: WebServerSurface | undefined): FakeCtx {
  const disposers: (() => void)[] = [];
  let effects = 0;
  return {
    ctx: {
      effect(callback: () => void | (() => void)): unknown {
        effects += 1;
        const dispose = callback();
        if (typeof dispose === 'function') disposers.push(dispose);
        return dispose;
      },
      get(name: string): unknown {
        return name === 'webServer' ? webServer : undefined;
      },
    },
    effectCount: () => effects,
    unload(): void {
      for (const dispose of disposers.splice(0, disposers.length)) dispose();
    },
  };
}
