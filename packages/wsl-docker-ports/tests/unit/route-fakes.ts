/**
 * `route.test.ts` / `route-timing.test.ts` 共用的假宿主面（**不是**测试文件：`node --test` 的
 * glob 只吃 `tests/**\/*.test.ts`，故本文件不会被当成用例跑，也不会被 vitest 收走
 * —— vitest 的 include 只有 `tests/client/**`）。
 *
 * 三样东西值得单独钉在这里：
 * ① `fakeWebServer()` **带重复 `(kind,path)` 检测**（照宿主的真实行为：漏登记 disposer 会立刻红）；
 * ② `fakeCtx()` 的缺省形态**带 `inject`**（真宿主有它）且服务已就绪 ⇒ 注入回调**同步**跑
 *    （cordis 语义：依赖齐了立即跑）；`withInject:false` 才是老宿主/测试替身的兼容路径；
 * ③ `dispatch()` 是宿主 `dsh-host-webserver` 分派判据的**逐字复刻**，缺陷 B 的对抗性回归靠它。
 */

import { pathOf } from '../../src/route.ts';
import type { HttpResponseLike, RoutePluginContextLike, WebServerRoute, WebServerSurfaceLike } from '../../src/route.ts';
import type { SnapshotBuilder, SnapshotDeps } from '../../src/snapshot.ts';
import type { SnapshotDeclaration } from '../../src/wire.ts';
import { FIXTURE_PORTS, WSL_CONFIG, WSL_CONFIG_TEXT, routingExecutor } from '../helpers/snapshot-fixtures.ts';

export interface Recorded {
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
}

/** 假响应：只实现 wire 用到的三个动作（与 002 的 `HttpResponseLike` 同口径） */
export function fakeResponse(): { response: HttpResponseLike; recorded: Recorded } {
  const recorded: Recorded = { status: undefined, headers: {}, body: '' };
  const response: HttpResponseLike = {
    set statusCode(value: number | undefined) {
      recorded.status = value;
    },
    get statusCode(): number | undefined {
      return recorded.status;
    },
    setHeader(name: string, value: string) {
      recorded.headers[name] = value;
      return undefined;
    },
    end(body?: string) {
      recorded.body = body ?? '';
      return undefined;
    },
  };
  return { response, recorded };
}

/** 假 webServer：**带重复 `(kind,path)` 检测**（照宿主的真实行为，漏 disposer 会立刻红） */
export function fakeWebServer(): { surface: WebServerSurfaceLike; routes: WebServerRoute[]; registerCalls: number } {
  const routes: WebServerRoute[] = [];
  const state = { registerCalls: 0 };
  return {
    routes,
    get registerCalls() {
      return state.registerCalls;
    },
    surface: {
      register(route: WebServerRoute): () => void {
        state.registerCalls += 1;
        if (routes.some((item) => item.kind === route.kind && item.path === route.path)) {
          throw new Error(`重复注册 (${route.kind}, ${route.path})：宿主会直接抛错（disposer 漏登记的后果）`);
        }
        routes.push(route);
        let removed = false;
        return () => {
          if (removed) return;
          removed = true;
          const index = routes.indexOf(route);
          if (index >= 0) routes.splice(index, 1);
        };
      },
    },
  };
}

export interface FakeCtx {
  readonly ctx: RoutePluginContextLike;
  readonly effects: (() => void)[];
  readonly web: ReturnType<typeof fakeWebServer>;
  readonly injectNames: string[][];
}

/**
 * 假 ctx。
 *
 * - 缺省**带 `inject`**（真宿主有它）且服务已就绪 ⇒ 注入回调**同步**跑（cordis 语义：依赖齐了就立即跑）；
 * - `withInject: false` = 老宿主/测试替身 ⇒ 退回同步 `ctx.get` 那条兼容路径；
 * - `withWebServer: false` = 「服务从未到位」⇒ 有 `inject` 时回调不跑（状态 `pending`），
 *   没有 `inject` 时同步取不到（状态 `missing`）。两种状态**分开**断言。
 */
export function fakeCtx(options: { readonly withEffect?: boolean; readonly withWebServer?: boolean; readonly withInject?: boolean } = {}): FakeCtx {
  const web = fakeWebServer();
  const effects: (() => void)[] = [];
  const injectNames: string[][] = [];
  const surface = options.withWebServer === false ? undefined : web.surface;
  const scope: RoutePluginContextLike = { get: (serviceName: string) => (serviceName === 'webServer' ? surface : undefined) };
  const ctx: RoutePluginContextLike = {
    get: (serviceName: string) => (serviceName === 'webServer' ? surface : undefined),
    ...(options.withInject === false
      ? {}
      : {
          inject: (names: readonly string[], callback: (injected: RoutePluginContextLike) => void) => {
            injectNames.push([...names]);
            // 依赖已就绪 ⇒ 真宿主（cordis）在这里**同步**回调；未就绪 ⇒ 不回调，等它到位
            if (surface !== undefined) callback(scope);
            return () => undefined;
          },
        }),
    ...(options.withEffect === false
      ? {}
      : {
          effect: (callback: () => (() => void) | void) => {
            const disposer = callback();
            if (typeof disposer === 'function') effects.push(disposer);
            return undefined;
          },
        }),
  };
  return { ctx, effects, web, injectNames };
}

export interface HostDispatch {
  readonly status: number | undefined;
  readonly headers: Record<string, string>;
  readonly body: string;
  /** `true` = 命中具名路由（轮到我们的 handler）；`false` = 落到宿主兜底 404（无 Content-Type、无 body） */
  readonly matched: boolean;
}

/**
 * 宿主 `dsh-host-webserver/lib/index.js:328` 的分派**逐字复刻**：
 *
 * `if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;`
 *
 * 匹配顺序按官方口径取「exact → 最长 prefix → fallback」；未命中 ⇒ 兜底 404（**空 body**，
 * 这正是真机上 `/dsh-wsl-docker-ports/snapshot` 当时拿到的那个响应）。
 */
export async function dispatch(routes: readonly WebServerRoute[], method: string, url: string): Promise<HostDispatch> {
  const pathname = pathOf(url);
  const ordered = [...routes].sort((left, right) => right.path.length - left.path.length);
  for (const route of ordered) {
    const hit =
      route.kind === 'exact'
        ? pathname === route.path
        : pathname === route.path || pathname.startsWith(`${route.path}/`);
    if (!hit) continue;
    const call = fakeResponse();
    await route.handler({ url, method }, call.response);
    return { ...call.recorded, matched: true };
  }
  return { status: 404, headers: {}, body: '', matched: false };
}

/** 只记账的装配器（断言「传了什么声明」用；不跑任何探针） */
export function spyBuilder(): { builder: SnapshotBuilder; calls: { declaration: SnapshotDeclaration; allowColdStart: boolean }[] } {
  const calls: { declaration: SnapshotDeclaration; allowColdStart: boolean }[] = [];
  return {
    calls,
    builder: {
      build: (declaration, options = {}) => {
        calls.push({ declaration, allowColdStart: options.allowColdStart === true });
        return Promise.resolve({ ok: false, code: 'internal', message: 'spy' });
      },
    },
  };
}

export const OK_DECLARATION: SnapshotDeclaration = { managedPorts: [...FIXTURE_PORTS], scopes: {}, elevationPolicy: 'none' };

/** 真 fixture 的装配依赖（零真机：执行器是假的、`.wslconfig` 走内存） */
export function snapshotDeps(fake: ReturnType<typeof routingExecutor>): SnapshotDeps {
  return {
    executor: fake.executor,
    readNetworkingMode: () => Promise.resolve({ ok: true, path: WSL_CONFIG, mode: 'default', resolved: 'nat' }),
    localhostForwarding: { filePath: WSL_CONFIG, readFile: () => Promise.resolve(WSL_CONFIG_TEXT) },
    now: () => Date.UTC(2026, 9, 9, 4, 0, 0),
  };
}
