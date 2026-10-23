/**
 * 容器控制路由（010 `T7.1` / `T7.2`）—— 前缀注册 + 鉴权 + 路径/方法判据 + 统一 JSON 出口。
 *
 * ## 形状与 008 的写通道**同构**，但语义与路径**不复用**
 *
 * 判据顺序照抄 008 `transport/routes.ts`（T2.9 的真机教训，逐条都有回归用例）：
 * **鉴权 → 路径 → 方法 → 请求体 → deps**。未带凭据 ⇒ 401，且**不读体、不调 deps、
 * 不碰 docker** ⇒ `REQ-11.4`（Agent 来源被拒）的判据是「0 次 docker 调用」，不是文案。
 *
 * 凭据与写通道**同一把**（`hostConfig.writeToken` ⇒ `../transport/write-auth.ts` 的常量时间比较）：
 * 这不是「另造一套鉴权」，而是复用**已经真机验过**的那一套；未配置 ⇒ fail-safe 401
 * （与 008 同一取向：通道默认不可用，不裸奔）。
 *
 * ## 为什么各持一份 `readJsonBody` / `resolveWebServer`
 *
 * `transport/routes.ts` 自己就各持一份（它在 363 行有自己的 `resolveWebServer`）。
 * 两条通道的注册时机、失败文案、生存期都独立 ⇒ 不为省 20 行把两个通道耦成一条
 * （耦了以后改写通道会静默改到容器动作）。**请求体上限不同**（这里 8 KiB，写通道 64 KiB）
 * 也正因为两条通道的体量语义不同。
 *
 * ## disposer 与时机
 *
 * `webServer` 后到（真机 +755ms）⇒ 惰性 `ctx.inject`，状态是**活 getter**；`register()` 的
 * disposer 交给 `ctx.effect`（宿主不会自动收编；漏了会「插件卸载、路由还在」⇒ 重复注册抛错）。
 */

import { isWebServerSurface, pathOf, queryOf, readJsonBody, resolveWebServer, sendJson, WEB_SERVER_SERVICE } from '../shared/http.ts';
import type { HttpRequestLike, HttpResponseLike, RoutePluginContextLike, WebServerSurfaceLike } from '../shared/http.ts';
import type { ConfigValueSource } from '../shared/config-read.ts';
import type { Executor, WslDistro } from 'dsh-wsl-shared';

import { createWriteAuthenticator } from '../shared/credential.ts';
import type { WriteHeaderBag } from '../shared/credential.ts';
import { readContainerLogs, runContainerAction } from './control.ts';
import type { ContainerFailure } from './control.ts';
import {
  CONTAINER_ACTION_METHOD,
  CONTAINER_ACTION_PATH,
  CONTAINER_BODY_MAX_BYTES,
  CONTAINER_HTTP_PREFIX,
  CONTAINER_LOGS_METHOD,
  CONTAINER_LOGS_PATH,
  isContainerAction,
  isContainerId,
  statusForContainer,
} from './wire.ts';
import type { ContainerErrorCode } from './wire.ts';

/** 请求面：`url`/`method` 与 003 一致；另加 `headers`（鉴权）与可异步迭代的体（Node `IncomingMessage` 形状） */
export interface ContainerRequestLike extends HttpRequestLike {
  readonly headers?: WriteHeaderBag | undefined;
  [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array | string>;
}

/** 目标发行版的解析结果（结构面，不 import `../distro.ts` 的类型 ⇒ 两个方向都不耦） */
export type ContainerTarget =
  | { readonly ok: true; readonly name: string; readonly distros: readonly WslDistro[] }
  | { readonly ok: false; readonly reason: string; readonly message: string };

export interface ContainerRouteDeps {
  /** 凭据来源（`config-read.ts` 的**活体读取函数**：volatile 轮换即时生效） */
  readonly writeToken: ConfigValueSource;
  readonly executor: Executor;
  /** 每次请求现解析目标发行版（`distro` 是 volatile，现读才吃得到 live 写入） */
  readonly resolveTarget: () => Promise<ContainerTarget>;
}

export type ContainerRouteState = 'registered' | 'pending' | 'missing';

export interface ContainerRouteRegistration {
  readonly registered: boolean;
  readonly state: ContainerRouteState;
  readonly reason?: string | undefined;
  readonly paths: { readonly action: string; readonly logs: string };
  requestCount(): number;
  registrationCount(): number;
  dispose(): void;
}

const MISSING_WEB_SERVER_REASON = '宿主未提供 webServer 服务：容器动作路由不注册（容器表仍可只读浏览）。';
const PENDING_WEB_SERVER_REASON =
  "宿主此刻尚未提供 webServer：已登记 ctx.inject(['webServer'])，服务到位后自动注册（惰性注入的常态，不是失败）。";

function failureMessage(failure: ContainerFailure): string {
  return failure.message;
}

/**
 * 注册容器动作路由。
 *
 * ⚠️ 缺 `webServer` 时**不注册并给出原因**（非严格取服务），不是让插件加载失败。
 */
export function registerContainerRoute(ctx: RoutePluginContextLike, deps: ContainerRouteDeps): ContainerRouteRegistration {
  const paths = { action: CONTAINER_ACTION_PATH, logs: CONTAINER_LOGS_PATH } as const;
  const auth = createWriteAuthenticator(deps.writeToken);
  let requests = 0;
  let live = 0;
  let state: ContainerRouteState = 'missing';
  let reason: string | undefined = MISSING_WEB_SERVER_REASON;
  let hostDispose: (() => void) | null = null;
  let disposed = false;

  const fail = (response: HttpResponseLike, code: ContainerErrorCode, message: string): void => {
    sendJson(response, statusForContainer(code), { ok: false, error: { code, message } });
  };

  const handler = async (request: ContainerRequestLike, response: HttpResponseLike): Promise<void> => {
    requests += 1;
    try {
      // 🔴 鉴权最靠前（REQ-11.4）：未带凭据 ⇒ 401，不读体、不碰 docker
      const decision = auth.authorize(request);
      if (!decision.ok) {
        fail(response, 'unauthorized', decision.message);
        return;
      }

      // 先认路径（未知路径不管方法一律 404），已知路径才谈方法 ⇒ 405 才可达
      const path = pathOf(request.url);
      if (path !== CONTAINER_ACTION_PATH && path !== CONTAINER_LOGS_PATH) {
        fail(response, 'not-found', `未知路径：本通道只提供 ${CONTAINER_ACTION_PATH} 与 ${CONTAINER_LOGS_PATH}`);
        return;
      }
      const wanted = path === CONTAINER_ACTION_PATH ? CONTAINER_ACTION_METHOD : CONTAINER_LOGS_METHOD;
      if ((request.method ?? wanted).toUpperCase() !== wanted) {
        fail(response, 'method-not-allowed', `${path} 只接受 ${wanted}`);
        return;
      }

      if (path === CONTAINER_LOGS_PATH) {
        const query = queryOf(request.url);
        const id = query.get('id');
        if (!isContainerId(id)) {
          fail(response, 'bad-request', '缺少或非法的容器 id（只接受 [a-zA-Z0-9][a-zA-Z0-9_.-]*）：docker 一次都没调用');
          return;
        }
        const target = await deps.resolveTarget();
        if (!target.ok) {
          fail(response, 'docker-failed', target.message);
          return;
        }
        const outcome = await readContainerLogs({ executor: deps.executor, distros: target.distros, distro: target.name }, id, query.get('tail'));
        if (!outcome.ok) {
          fail(response, 'docker-failed', failureMessage(outcome));
          return;
        }
        sendJson(response, 200, { ok: true, containerId: id, tail: outcome.tail, text: outcome.text });
        return;
      }

      const body = await readJsonBody(request, CONTAINER_BODY_MAX_BYTES);
      if (!body.ok) {
        fail(response, 'bad-request', body.reason);
        return;
      }
      const record = (typeof body.value === 'object' && body.value !== null ? body.value : {}) as Record<string, unknown>;
      const id = record['id'];
      const action = record['action'];
      if (!isContainerId(id)) {
        fail(response, 'bad-request', '请求体缺少合法的容器 id（只接受 [a-zA-Z0-9][a-zA-Z0-9_.-]*）：docker 一次都没调用');
        return;
      }
      if (!isContainerAction(action)) {
        fail(response, 'bad-request', '请求体的 action 只接受 start / stop / restart：docker 一次都没调用');
        return;
      }
      const target = await deps.resolveTarget();
      if (!target.ok) {
        fail(response, 'docker-failed', target.message);
        return;
      }
      const outcome = await runContainerAction({ executor: deps.executor, distros: target.distros, distro: target.name }, id, action);
      if (!outcome.ok) {
        fail(response, 'docker-failed', failureMessage(outcome));
        return;
      }
      sendJson(response, 200, { ok: true, action, containerId: id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(response, 'internal', `处理容器动作请求时抛出未预期异常：${message}`);
    }
  };

  const detach = (): void => {
    const host = hostDispose;
    hostDispose = null;
    live = 0;
    if (host !== null) host();
  };

  const attach = (surface: WebServerSurfaceLike): void => {
    if (disposed || live > 0) return;
    hostDispose = surface.register({ kind: 'prefix', path: CONTAINER_HTTP_PREFIX, handler });
    live = 1;
    state = 'registered';
    reason = undefined;
  };

  if (typeof ctx.inject === 'function') {
    let fired = false;
    try {
      ctx.inject([WEB_SERVER_SERVICE], (scope) => {
        fired = true;
        const surface = resolveWebServer(scope);
        if (surface === undefined) {
          state = 'missing';
          reason = `webServer 已注入但形状不对（没有 register()）⇒ 容器动作路由不注册：${MISSING_WEB_SERVER_REASON}`;
          return;
        }
        attach(surface);
      });
      if (!fired) {
        state = 'pending';
        reason = PENDING_WEB_SERVER_REASON;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state = 'missing';
      reason = `ctx.inject(['${WEB_SERVER_SERVICE}']) 登记失败（${message}）⇒ 容器动作路由不注册：${MISSING_WEB_SERVER_REASON}`;
    }
  } else {
    const surface = typeof ctx.get === 'function' ? ctx.get(WEB_SERVER_SERVICE) : undefined;
    if (isWebServerSurface(surface)) attach(surface);
    else {
      state = 'missing';
      reason = MISSING_WEB_SERVER_REASON;
    }
  }

  const disposeOnce = (): void => {
    disposed = true;
    detach();
  };

  if (typeof ctx.effect === 'function') ctx.effect(() => disposeOnce, 'dsh-wsl-docker-ports: container route');

  return {
    get registered(): boolean {
      return live > 0;
    },
    get state(): ContainerRouteState {
      return state;
    },
    get reason(): string | undefined {
      return reason;
    },
    paths,
    requestCount: () => requests,
    registrationCount: () => live,
    dispose: disposeOnce,
  };
}
