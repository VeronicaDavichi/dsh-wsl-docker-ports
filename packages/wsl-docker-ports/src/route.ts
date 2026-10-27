/**
 * 自建 `ctx.webServer` 具名路由（003 T6.8 / REQ-7 的 P0 用法；2026-10-09 真机缺陷 A/B 修复）
 *
 * ## 为什么自己注册而不蹭 002 的 `/dsh-managed-terminal/`
 *
 * 宿主按「exact → 最长 prefix → fallback」匹配，**重复 `(kind, path)` 会直接抛错**。
 * 两个包各占一个前缀才互不影响；蹭别人的前缀会在对方改路径时立刻坏掉，而且
 * 卸载顺序会决定谁把谁的路由删掉。故本包独占 `PORTS_HTTP_PREFIX`（`./wire.ts`，
 * 🔴 **不带尾斜杠** —— 宿主的分派判据是 `pathname !== prefix && !startsWith(`${prefix}/`)`，
 * 带尾斜杠时 `/…/snapshot` 永不匹配，见 `wire.ts` 的常量注释）。
 *
 * ## 时机（缺陷 A）：注册必须发生在**宿主可用时机**，不能在 `apply` 里同步 `ctx.get` 定生死
 *
 * 真机实测：`+68ms ctx.get('webServer') === undefined`，本包的 `inject(['webServer'])`
 * 到 `+755ms` 才 FIRED。也就是说 `webServer` 是**后到的**服务 —— 同步取一次就下结论，
 * 结果必然是「不注册 + 记 gap」，而且**零报错**（插件面板照样显示「运行中」）。
 *
 * 故此处：有 `ctx.inject` 就走**惰性注入**（服务到位后回调才跑；`@deepseek-ai/dsh-client-modules`
 * 的官方说明把 `dsh.client.inject` 与 cordis 的服务注入分成两件事，后者正是「等到才跑」的语义），
 * 并且状态是**活的**（`registered` / `state` 都是 getter，注入后回调一跑就翻成 `registered`）。
 * 没有 `ctx.inject` 的宿主（老版本 / 测试替身）才退回同步 `ctx.get` —— 那是**兼容路径**，
 * 不是判据；「服务确实缺失 ⇒ 记 gap 且不注册」的语义在两条路径上都保留。
 *
 * ## 判据顺序（缺陷 B2）：已知路径 + 非 GET ⇒ 405；未知路径 ⇒ 404
 *
 * 真机上 `POST /dsh-wsl-docker-ports/` 拿到的是 **JSON 404** ⇒ 405 分支永不可达。
 * 修 B 之后 `/…/snapshot` 才会被宿主分派进来，故这里把顺序显式写死并各有回归用例。
 *
 * ## disposer 必须能被 `ctx.effect` 收编
 *
 * 宿主**不会**自动收集 `register()` 返回的 disposer。漏登记 = 「插件卸载了、路由还在，
 * 再次挂载会因重复 `(kind,path)` 直接抛错」。判据（`tests/unit/route.test.ts`）：
 * 卸载后 `registrationCount() === 0`，且响应不再可达、同 `(kind,path)` 能重新注册。
 *
 * ## 装载期零外部命令
 *
 * `registerPortsRoute()` 只做注册：**一条命令都不跑**。探针全部发生在请求处理里
 * （`handler` → `PortsSource` → `snapshot.build()`）。判据同 T6.7。
 */

import { PORTS_DISTROS_METHOD, PORTS_DISTROS_PATH, PORTS_HTTP_PREFIX, PORTS_SNAPSHOT_METHOD, PORTS_SNAPSHOT_PATH, parseSnapshotQuery } from './wire.ts';
import type { PortsErrorCode } from './wire.ts';
import type { WslDistro } from 'dsh-wsl-shared';
import type { SnapshotBuilder } from './snapshot.ts';
// 015 P1：HTTP 底座搬到 `./shared/http.ts`（两侧共用一份实现）；这里**原样再导出**，既有 import 不变
import {
  isWebServerSurface,
  pathOf,
  resolveWebServer,
  sendJson,
  WEB_SERVER_SERVICE,
  type HttpRequestLike,
  type HttpResponseLike,
  type RoutePluginContextLike,
  type WebServerRoute,
  type WebServerSurfaceLike,
} from 'dsh-wsl-docker-core';
import { answerHealth, healthPath, type HealthPayload } from 'dsh-wsl-docker-core';

export { isWebServerSurface, pathOf };
export type { HttpRequestLike, HttpResponseLike, RoutePluginContextLike, WebServerRoute, WebServerSurfaceLike };

/** 注册状态（**活的**：惰性注入的回调可能在 `registerPortsRoute` 返回之后才跑） */
export type PortsRouteState =
  /** 已进宿主路由表 */
  | 'registered'
  /** 已登记 `ctx.inject(['webServer'])`，等宿主把服务放进来（**不是失败**） */
  | 'pending'
  /** 没有 `inject` 且同步取不到服务，或注入到的东西形状不对 ⇒ 不注册（配 `reason`） */
  | 'missing';

export interface PortsRouteRegistration {
  /** 宿主提供了 webServer 并成功登记 ⇒ true（**getter**：惰性注入后回调一跑就翻） */
  readonly registered: boolean;
  /** 见 `PortsRouteState`（**getter**） */
  readonly state: PortsRouteState;
  /** 未注册的原因（**getter**：注册成功后必须变回 `undefined`，不许留一句过期的谎） */
  readonly reason?: string | undefined;
  readonly paths: { readonly prefix: string; readonly snapshot: string; readonly health: string; readonly distros: string };
  /** 处理过的请求数（测试用：证明「装载期零请求」与「请求真被处理」） */
  requestCount(): number;
  /** 当前仍生效的注册数（卸载后必须归零） */
  registrationCount(): number;
  dispose(): void;
}

/** 「服务确实缺失 ⇒ 不注册」的既有语义文案（`plugin.ts` 把它记进 `gaps`） */
const MISSING_WEB_SERVER_REASON =
  '宿主未提供 webServer 服务：快照路由不注册，客户端半将按 ports-source-missing 降级。';

/** 「已登记惰性注入、服务还没到」的文案（与「缺失」**分开**：这不是失败，也不能谎报缺失） */
const PENDING_WEB_SERVER_REASON =
  "宿主此刻尚未提供 webServer：已登记 ctx.inject(['webServer'])，服务到位后自动注册（惰性注入的常态，不是失败）。";

function statusFor(code: PortsErrorCode): number {
  if (code === 'not-found') return 404;
  if (code === 'method-not-allowed') return 405;
  if (code === 'rules-unavailable') return 503;
  return 500;
}

/**
 * 017：路由的可选额外能力（不传 ⇒ `/distros` 回 503 并说明「本宿主没接线」，行为可预测）。
 */
export interface PortsRouteExtras {
  /** 只跑 `wsl.exe -l -v` 的发行版清单（**绝不许**在实现里跑 docker/netsh） */
  readonly listDistros?: () => Promise<
    { readonly ok: true; readonly distros: readonly WslDistro[] } | { readonly ok: false; readonly message: string }
  >;
}

/**
 * 注册快照路由。
 *
 * ⚠️ 缺 `webServer` 时**不注册任何路由并给出原因**（非严格取服务），**不是**让整个插件加载失败
 * —— 客户端半会按 `ports-source-missing` 降级。返回对象的 `registered` / `state` / `reason`
 * 都是 **getter**：惰性注入的回调后到也能被读到。
 *
 * 015 P2：本前缀内多一条 `GET <prefix>/health`（客户端据此判定「转发那一行是否启用」）。
 * 它**免鉴权、只读、零 IO**，不改变快照路径的任何判据。
 *
 * 017：再加一条 `GET <prefix>/distros`（bundle 级配置页的发行版下拉）——同样是**只读、零写**。
 */
export function registerPortsRoute(
  ctx: RoutePluginContextLike,
  builder: SnapshotBuilder,
  identity?: { readonly rowId?: string | undefined },
  extras?: PortsRouteExtras,
): PortsRouteRegistration {
  const rowId = identity?.rowId ?? PORTS_HTTP_PREFIX.slice(1);
  const health = healthPath(PORTS_HTTP_PREFIX);
  const healthPayload: HealthPayload = { ok: true, side: 'ports', rowId, v: 1 };
  const paths = { prefix: PORTS_HTTP_PREFIX, snapshot: PORTS_SNAPSHOT_PATH, health, distros: PORTS_DISTROS_PATH } as const;
  let requests = 0;
  let live = 0;
  let state: PortsRouteState = 'missing';
  let reason: string | undefined = MISSING_WEB_SERVER_REASON;
  let hostDispose: (() => void) | null = null;
  let disposed = false;

  const fail = (response: HttpResponseLike, code: PortsErrorCode, message: string): void => {
    sendJson(response, statusFor(code), { ok: false, error: { code, message } });
  };

  const handler = async (request: HttpRequestLike, response: HttpResponseLike): Promise<void> => {
    requests += 1;
    try {
      // 015 P2：健康端点**先**认（免鉴权、零 IO）—— 客户端靠它判定「转发这一行是否启用」。
      // 非 GET 由 `answerHealth` 回 405（与快照的 405 同语义，但文案各自说清）。
      if (pathOf(request.url) === health) {
        answerHealth(request, response, healthPayload);
        return;
      }
      // 017：发行版清单（只跑 `wsl -l -v`；配置页的下拉数据源）。
      if (pathOf(request.url) === PORTS_DISTROS_PATH) {
        if ((request.method ?? PORTS_DISTROS_METHOD).toUpperCase() !== PORTS_DISTROS_METHOD) {
          fail(response, 'method-not-allowed', `发行版清单只接受 ${PORTS_DISTROS_METHOD}`);
          return;
        }
        const listDistros = extras?.listDistros;
        if (listDistros === undefined) {
          fail(response, 'rules-unavailable', '本宿主未接线发行版清单（插件未传入 listDistros）：配置页将退回只显示当前值');
          return;
        }
        const listed = await listDistros();
        if (!listed.ok) {
          fail(response, 'rules-unavailable', `读不到发行版清单：${listed.message}`);
          return;
        }
        sendJson(response, 200, { ok: true, distros: listed.distros });
        return;
      }
      // 🔴 判据顺序（缺陷 B2）：**先**认路径，已知路径才谈方法 ⇒ 405 才可达；
      // 未知路径（含本前缀的根）一律 404，不管方法是什么。
      if (pathOf(request.url) !== PORTS_SNAPSHOT_PATH) {
        fail(response, 'not-found', `未知路径：本前缀（${PORTS_HTTP_PREFIX}）只提供 ${PORTS_SNAPSHOT_PATH} / ${PORTS_DISTROS_PATH} 与 ${health}`);
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

  const detach = (): void => {
    const host = hostDispose;
    hostDispose = null;
    live = 0;
    if (host !== null) host();
  };

  /** 注册一次；**幂等**（宿主对重复 `(kind,path)` 直接抛错 ⇒ 重复 attach 必须被吞掉） */
  const attach = (surface: WebServerSurfaceLike): void => {
    if (disposed || live > 0) return;
    hostDispose = surface.register({ kind: 'prefix', path: PORTS_HTTP_PREFIX, handler });
    live = 1;
    state = 'registered';
    reason = undefined;
  };

  /* ── 时机（缺陷 A）：优先惰性注入；只有没有 `inject` 的宿主才退回同步 `get` ── */
  if (typeof ctx.inject === 'function') {
    let fired = false;
    try {
      ctx.inject([WEB_SERVER_SERVICE], (scope) => {
        fired = true;
        const surface = resolveWebServer(scope);
        if (surface === undefined) {
          state = 'missing';
          reason = `webServer 已注入但形状不对（没有 register()）⇒ 快照路由不注册：${MISSING_WEB_SERVER_REASON}`;
          return;
        }
        attach(surface);
      });
      // 回调同步跑过 = 服务此刻已在；没跑 = 后到（真机是 +755ms 那种）⇒ 记 pending，等它
      if (!fired) {
        state = 'pending';
        reason = PENDING_WEB_SERVER_REASON;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state = 'missing';
      reason = `ctx.inject(['${WEB_SERVER_SERVICE}']) 登记失败（${message}）⇒ 快照路由不注册：${MISSING_WEB_SERVER_REASON}`;
    }
  } else {
    const surface = typeof ctx.get === 'function' ? ctx.get(WEB_SERVER_SERVICE) : undefined;
    if (isWebServerSurface(surface)) attach(surface);
    else {
      state = 'missing';
      reason = MISSING_WEB_SERVER_REASON;
    }
  }

  /** 卸载（幂等）：置 `disposed` 挡住后到的注入回调，再摘掉路由 */
  const disposeOnce = (): void => {
    disposed = true;
    detach();
  };

  // 宿主不会自动收编 `register()` 的 disposer ⇒ 必须交给 `ctx.effect`
  if (typeof ctx.effect === 'function') ctx.effect(() => disposeOnce, 'dsh-wsl-docker-ports: snapshot route');

  return {
    get registered(): boolean {
      return live > 0;
    },
    get state(): PortsRouteState {
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
