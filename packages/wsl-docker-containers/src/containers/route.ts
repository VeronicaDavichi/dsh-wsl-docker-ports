/**
 * 容器侧的**路由装配**（015 `P2`/`P3`）—— 一个独占前缀，四条路径。
 *
 * ```
 * GET  /dsh-wsl-docker-containers/health     免鉴权 · 只读 · 零 IO（客户端据此 gate）
 * GET  /dsh-wsl-docker-containers/snapshot   免鉴权 · 只读（docker ps + wsl -l -v，**不读 netsh**）
 * POST /dsh-wsl-docker-containers/action     需容器侧凭据（start/stop/restart，不重试）
 * GET  /dsh-wsl-docker-containers/logs       需容器侧凭据（`--tail 1..200`，只进内存）
 * ```
 *
 * ## 与转发侧 `../route.ts` 的关系
 *
 * 形状同构（都是「惰性 `ctx.inject(['webServer'])` → `register({kind:'prefix'})` → `ctx.effect` 收编」），
 * 但**不 import 它**：015 的零交叉要求两条行各自闭包，`../route.ts` 里有转发侧的错误码/快照类型/
 * 缺陷 B2 的判据顺序。复制这层「注册骨架」是**有意的**（design §4.2 把它列进 R1 的理由），
 * 换来的是「转发侧删掉/改坏也不会动到容器侧」。
 *
 * ## 判据顺序（与 010 / 003 同口径，逐条）
 *
 * 1. **健康端点最先**（免鉴权、零 IO）：它是客户端判定「这一行在不在」的唯一信号；
 * 2. **先认路径，再谈方法** ⇒ 未知路径（含本前缀的根）一律 404，405 才可达；
 * 3. **鉴权先于读体**（动作/日志）：未带凭据 ⇒ 401，**不读体、不碰 docker**；
 * 4. 校验先于执行：非法 id / action ⇒ 400，**docker 一次都没调用**；
 * 5. 未预期的抛出 ⇒ 500（不冒充 400，也不静默吞掉）。
 *
 * ## 🔴 每一条 disposer 都必须在 `ctx.effect` 里
 *
 * 宿主对重复 `(kind, path)` 直接抛错 ⇒ 漏登记 = 卸载后再挂载必炸。这里与转发侧同一写法：
 * `attach` 幂等、`detach` 置零、`dispose` 可重入。
 */

import type { Executor, WslDistro } from 'dsh-wsl-shared';

import {
  isWebServerSurface,
  pathOf,
  queryOf,
  readJsonBody,
  resolveWebServer,
  sendJson,
  WEB_SERVER_SERVICE,
  type BodyRequestLike,
  type HttpRequestLike,
  type HttpResponseLike,
  type RoutePluginContextLike,
  type WebServerSurfaceLike,
} from 'dsh-wsl-docker-core';
import type { ConfigValueSource } from 'dsh-wsl-docker-core';
import type { WriteHeaderBag } from 'dsh-wsl-docker-core';
import { createContainersAuthenticator } from './credential.ts';
import { answerContainersHealth, CONTAINERS_HEALTH_PATH } from './health.ts';
import { readContainersLogs, runContainersAction, type ContainersFailure } from './control.ts';
import {
  CONTAINERS_ACTION_METHOD,
  CONTAINERS_ACTION_PATH,
  CONTAINERS_BODY_MAX_BYTES,
  CONTAINERS_LOGS_METHOD,
  CONTAINERS_LOGS_PATH,
  CONTAINERS_PREFIX,
  CONTAINERS_SNAPSHOT_METHOD,
  CONTAINERS_SNAPSHOT_PATH,
  isContainerId,
  isContainersAction,
  statusForContainers,
  type ContainersErrorCode,
} from './wire.ts';
import type { ContainersSnapshotBuilder } from './snapshot.ts';

/** 目标发行版的解析结果（结构面；失败只带一句可读原因） */
export type ContainersTarget =
  | { readonly ok: true; readonly name: string; readonly distros: readonly WslDistro[] }
  | { readonly ok: false; readonly message: string };

/** 容器侧请求面：`url`/`method` + 鉴权用的 `headers`（动作/日志两条要凭据） */
export interface ContainersRequestLike extends HttpRequestLike {
  readonly headers?: WriteHeaderBag | undefined;
}

export interface ContainersRouteDeps {
  /** 容器侧自己的 `writeToken`（活体读取：每次请求现读 ⇒ 轮换即时生效） */
  readonly config?: ConfigValueSource;
  readonly executor: Executor;
  /** 每次请求现解析目标发行版（`distro` 是 volatile） */
  readonly resolveTarget: () => Promise<ContainersTarget>;
  readonly snapshotBuilder: ContainersSnapshotBuilder;
}

export type ContainersRouteState = 'registered' | 'pending' | 'missing';

export interface ContainersRouteRegistration {
  readonly registered: boolean;
  readonly state: ContainersRouteState;
  readonly reason?: string | undefined;
  readonly paths: {
    readonly prefix: string;
    readonly snapshot: string;
    readonly health: string;
    readonly action: string;
    readonly logs: string;
  };
  requestCount(): number;
  registrationCount(): number;
  dispose(): void;
}

/** 「服务确实缺失 ⇒ 不注册」的文案（与转发侧**分开写**：两条行的降级后果不同） */
const MISSING_WEB_SERVER_REASON =
  '宿主未提供 webServer 服务：容器侧路由不注册（容器列表与动作都不可用，转发侧的端口表不受影响）。';

/** 「已登记惰性注入、服务还没到」的文案（pending 不是失败） */
const PENDING_WEB_SERVER_REASON =
  "宿主此刻尚未提供 webServer：已登记 ctx.inject(['webServer'])，服务到位后自动注册（惰性注入的常态，不是失败）。";

function failureMessage(failure: ContainersFailure): string {
  return failure.message;
}

export function registerContainersRoute(ctx: RoutePluginContextLike, deps: ContainersRouteDeps): ContainersRouteRegistration {
  const paths = {
    prefix: CONTAINERS_PREFIX,
    snapshot: CONTAINERS_SNAPSHOT_PATH,
    health: CONTAINERS_HEALTH_PATH,
    action: CONTAINERS_ACTION_PATH,
    logs: CONTAINERS_LOGS_PATH,
  } as const;
  const auth = createContainersAuthenticator(deps.config);
  let requests = 0;
  let live = 0;
  let state: ContainersRouteState = 'missing';
  let reason: string | undefined = MISSING_WEB_SERVER_REASON;
  let hostDispose: (() => void) | null = null;
  let disposed = false;

  const fail = (response: HttpResponseLike, code: ContainersErrorCode, message: string): void => {
    sendJson(response, statusForContainers(code), { ok: false, error: { code, message } });
  };

  const handleSnapshot = async (request: HttpRequestLike, response: HttpResponseLike): Promise<void> => {
    if ((request.method ?? CONTAINERS_SNAPSHOT_METHOD).toUpperCase() !== CONTAINERS_SNAPSHOT_METHOD) {
      fail(response, 'method-not-allowed', `快照只接受 ${CONTAINERS_SNAPSHOT_METHOD}`);
      return;
    }
    const outcome = await deps.snapshotBuilder.build();
    if (!outcome.ok) {
      fail(response, 'docker-failed', outcome.message);
      return;
    }
    sendJson(response, 200, { ok: true, snapshot: outcome.snapshot });
  };

  const handleLogs = async (request: ContainersRequestLike, response: HttpResponseLike): Promise<void> => {
    const decision = auth.authorize(request);
    if (!decision.ok) {
      fail(response, 'unauthorized', decision.message);
      return;
    }
    if ((request.method ?? CONTAINERS_LOGS_METHOD).toUpperCase() !== CONTAINERS_LOGS_METHOD) {
      fail(response, 'method-not-allowed', `${CONTAINERS_LOGS_PATH} 只接受 ${CONTAINERS_LOGS_METHOD}`);
      return;
    }
    const id = queryOf(request.url).get('id');
    if (!isContainerId(id)) {
      fail(response, 'bad-request', '缺少或非法的容器 id（只接受 [a-zA-Z0-9][a-zA-Z0-9_.-]*）：docker 一次都没调用');
      return;
    }
    const target = await deps.resolveTarget();
    if (!target.ok) {
      fail(response, 'docker-failed', target.message);
      return;
    }
    const outcome = await readContainersLogs({ executor: deps.executor, distros: target.distros, distro: target.name }, id, queryOf(request.url).get('tail'));
    if (!outcome.ok) {
      fail(response, 'docker-failed', failureMessage(outcome));
      return;
    }
    sendJson(response, 200, { ok: true, containerId: id, tail: outcome.tail, text: outcome.text });
  };

  const handleAction = async (request: ContainersRequestLike, response: HttpResponseLike): Promise<void> => {
    const decision = auth.authorize(request);
    if (!decision.ok) {
      fail(response, 'unauthorized', decision.message);
      return;
    }
    if ((request.method ?? CONTAINERS_ACTION_METHOD).toUpperCase() !== CONTAINERS_ACTION_METHOD) {
      fail(response, 'method-not-allowed', `${CONTAINERS_ACTION_PATH} 只接受 ${CONTAINERS_ACTION_METHOD}`);
      return;
    }
    const body = await readJsonBody(request as BodyRequestLike, CONTAINERS_BODY_MAX_BYTES);
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
    if (!isContainersAction(action)) {
      fail(response, 'bad-request', '请求体的 action 只接受 start / stop / restart：docker 一次都没调用');
      return;
    }
    const target = await deps.resolveTarget();
    if (!target.ok) {
      fail(response, 'docker-failed', target.message);
      return;
    }
    const outcome = await runContainersAction({ executor: deps.executor, distros: target.distros, distro: target.name }, id, action);
    if (!outcome.ok) {
      fail(response, 'docker-failed', failureMessage(outcome));
      return;
    }
    sendJson(response, 200, { ok: true, action, containerId: id });
  };

  const handler = async (request: HttpRequestLike, response: HttpResponseLike): Promise<void> => {
    requests += 1;
    try {
      const path = pathOf(request.url);
      if (path === paths.health) {
        answerContainersHealth(request, response);
        return;
      }
      if (path === paths.snapshot) {
        await handleSnapshot(request, response);
        return;
      }
      if (path === paths.action) {
        await handleAction(request, response);
        return;
      }
      if (path === paths.logs) {
        await handleLogs(request, response);
        return;
      }
      fail(response, 'not-found', `未知路径：本前缀（${CONTAINERS_PREFIX}）只提供 ${paths.snapshot} / ${paths.action} / ${paths.logs} / ${paths.health}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(response, 'internal', `处理容器侧请求时抛出未预期异常：${message}`);
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
    hostDispose = surface.register({ kind: 'prefix', path: CONTAINERS_PREFIX, handler });
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
          reason = `webServer 已注入但形状不对（没有 register()）⇒ 容器侧路由不注册：${MISSING_WEB_SERVER_REASON}`;
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
      reason = `ctx.inject(['${WEB_SERVER_SERVICE}']) 登记失败（${message}）⇒ 容器侧路由不注册：${MISSING_WEB_SERVER_REASON}`;
    }
  } else {
    const surface = typeof ctx.get === 'function' ? ctx.get(WEB_SERVER_SERVICE) : undefined;
    if (isWebServerSurface(surface)) attach(surface);
    else {
      state = 'missing';
      reason = MISSING_WEB_SERVER_REASON;
    }
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => detach, 'dsh-wsl-docker-containers: route');
  }

  return {
    get registered(): boolean {
      return live > 0;
    },
    get state(): ContainersRouteState {
      return state;
    },
    get reason(): string | undefined {
      return reason;
    },
    paths,
    requestCount: () => requests,
    registrationCount: () => live,
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      detach();
    },
  };
}
