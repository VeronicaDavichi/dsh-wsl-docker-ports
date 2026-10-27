/**
 * 容器包测试用的**假宿主面**（016：从转发包的 `tests/unit/route-fakes.ts` 收窄而来）
 *
 * 与转发包那份的分工：这里只要「造一个带 `webServer` 的 ctx + 一个假响应」，**不要**转发侧的
 * `SnapshotBuilder` / `SnapshotDeclaration` 那些类型 —— 容器侧快照是 `containers/snapshot.ts` 的事，
 * 拿转发侧的类型来假装配只会让两个包在测试里重新缠在一起（正是 016 要拆掉的东西）。
 *
 * 类型一律取自 `dsh-wsl-docker-core` 的公开面（`HttpResponseLike` / `WebServerRoute` / …）：
 * 那是三个包共用的**协议形状**，不是某一方的实现。
 *
 * 文件名不带 `.test.` ⇒ `node --test` 的 glob 不会把它当用例；vitest 的 include 只有 `tests/client/**`。
 */

import type { HttpResponseLike, RoutePluginContextLike, WebServerRoute, WebServerSurfaceLike } from 'dsh-wsl-docker-core';

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

/** 假 webServer：**带重复 `(kind,path)` 检测**（照宿主的真实行为：漏登记 disposer 会立刻红） */
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
 * - `withWebServer: false` = 「服务从未到位」⇒ 有 `inject` 时回调不跑（状态 `pending`）。
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

/**
 * 宿主 `dsh-host-webserver` 的分派**逐字复刻**：
 * `if (pathname !== prefix && !pathname.startsWith(prefix + '/')) continue;`
 * 匹配顺序：exact → 最长 prefix；未命中 ⇒ 兜底 404（空 body）。
 */
export async function dispatch(
  routes: readonly WebServerRoute[],
  method: string,
  url: string,
): Promise<{ status: number | undefined; headers: Record<string, string>; body: string; matched: boolean }> {
  const pathname = new URL(url, 'http://127.0.0.1').pathname;
  const ordered = [...routes].sort((left, right) => right.path.length - left.path.length);
  for (const route of ordered) {
    const hit = route.kind === 'exact' ? pathname === route.path : pathname === route.path || pathname.startsWith(`${route.path}/`);
    if (!hit) continue;
    const call = fakeResponse();
    await route.handler({ url, method }, call.response);
    return { ...call.recorded, matched: true };
  }
  return { status: 404, headers: {}, body: '', matched: false };
}
