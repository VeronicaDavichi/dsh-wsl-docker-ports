/**
 * 路由与 upgrade 注册（002 T3.1 / REQ-7.1 / REQ-7.5 / REQ-7.6）
 *
 * 注册**两条**（REQ-7.1 的两半）：
 * ① `register({ kind: 'prefix', path: TERM_WS_HTTP_PREFIX })` —— 独占领前缀的具名 HTTP 路由，
 *    本层只答 `/dsh-managed-terminal/instances`（实例枚举），前缀内其它路径答 404，
 *    前缀外一律不碰（官方的匹配顺序是 exact → 最长 prefix → fallback，本前缀独占 ⇒ 不抢 SPA fallback）；
 *    🔴 前缀**不带尾斜杠**（缺陷 B，逐字证据见 `./constants.ts`）。
 * ② `registerUpgrade({ path: TERM_WS_UPGRADE_PATH })` —— **exact**，多终端靠协议层 `instanceId`
 *    复用这一个端点（宿主 upgrade 不支持前缀；`registerUpgrade` 只有 exact 表）。
 *
 * ## 时机（2026-10-09 真机缺陷 A）：注册必须发生在**宿主可用时机**
 *
 * 真机时间线：`+68ms` 时 `ctx.get('webServer')` 是 `undefined`，本包的 `ctx.inject(['webServer'])`
 * 到 `+755ms` 才 FIRED ⇒ **同步取一次就定生死 = 永不注册**，而插件面板照旧显示「运行中」、零报错。
 * 故：有 `ctx.inject` 就走惰性注入（回调在服务可用时才跑），状态是**活的**（`registered` / `state` /
 * `reason` 全是 getter）；没有 `inject` 的老宿主/测试替身才退回同步 `ctx.get`，且两条路径都保留
 * 「服务确实缺失 ⇒ 不注册 + 给原因」的语义 —— `pending`（还在等）与 `missing`（确证缺）**必须分开说**。
 *
 * ## 三条硬约束（每条都有回归用例）
 *
 * 1. **`attach` 幂等（2026-10-12 扩面：二次到达要**分辨**两种情形）**：重复 `(kind, path)` 宿主**直接抛错**
 *    ⇒ 注入回调多跑一次不能二次注册。但「幂等」不等于「一律忽略第二次」—— 二次到达有**两条**真实触发路径：
 *    ① **同一个服务面**再到达（`ctx.inject` 的通知不止一次 / 同一 ctx 上被重复 activate）⇒ 保留**第一次**
 *       注册（已有的那两条仍然有效，什么都不做）；
 *    ② **服务面被换掉**（宿主热重载 / 重启了提供 `webServer` 的那个插件）⇒ 旧面上的两条注册已随服务失效，
 *       而挂在旧面上的 disposer 若不收回就是**泄漏**（`live` 还会谎报 2、端点静默不可达）⇒ 先
 *       `releaseRoutes()` 收回，再整组重挂到新面 —— **安全收编**：不撞「重复 `(kind, path)` 抛错」，
 *       也不会把**第一次**的有效注册一起带走。
 *    回归门 + 变异哨兵：`tests/unit/ws-routes-reregister.test.ts`。
 * 2. **已 dispose 后到达的回调要被挡住**：卸载先置 `disposed`，后到的注入回调只记账、不注册。
 * 3. **disposer 无条件进 `ctx.effect`**：宿主**不会**自动回收 `register()` 的返回值。这里**恰好一条**
 *    effect 收编整条生命周期（HTTP + upgrade + 挡住后到回调），无论当时是否已经注册成功。
 */

import { TERM_WS_HTTP_PREFIX, TERM_WS_LIST_PATH, TERM_WS_UPGRADE_PATH } from './constants.ts';
import { createTerminalChannel } from './connection.ts';
import type { ChannelDeps, TerminalChannel } from './connection.ts';
import { createUpgradeHandler, writeRejection } from './upgrade-socket.ts';
import type { ChannelPluginContext, HttpRequestLike, HttpResponseLike, UpgradeSocketLike, WebServerSurface } from './types.ts';

const encoder = new TextEncoder();

/** 注入/取用的宿主服务名（一处字面量，注册与判定不漂移） */
const WEB_SERVER_SERVICE = 'webServer';

/** 生命周期 effect 的 label（宿主诊断可读） */
const ROUTE_EFFECT_LABEL = 'dsh-terminal-profiles: ws routes';

/** 结构面判定：宿主注入的对象是否**够用**（duck typing，不 import 宿主类型） */
export function isWebServerSurface(value: unknown): value is WebServerSurface {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WebServerSurface>;
  return typeof candidate.register === 'function' && typeof candidate.registerUpgrade === 'function';
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

function sendJson(res: HttpResponseLike, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(encoder.encode(body).length));
  res.end(body);
}

/**
 * 注册状态（**活的**：惰性注入的回调可能在 `registerTerminalChannel` 返回之后才跑）
 */
export type ChannelRouteState =
  /** 两条路由都已进宿主路由表 */
  | 'registered'
  /** 已登记 `ctx.inject(['webServer'])`，等宿主把服务放进来（**不是失败**） */
  | 'pending'
  /** 同步路径下取不到服务，或注入到的东西形状不对 / 注册抛错 ⇒ 不注册 */
  | 'missing';

/** 惰性注入登记时、以及确证缺失时的人话（测试与 gap 都引用它，避免两处漂移） */
export const PENDING_WEB_SERVER_REASON =
  "宿主此刻尚未提供 webServer：已登记 ctx.inject(['webServer'])，服务到位后自动注册（惰性注入的常态，不是失败）。";
export const MISSING_WEB_SERVER_REASON =
  '宿主未提供 webServer 服务（非严格 ctx.get 且无可用注入时机）：WS 通道不注册任何路由，HTTP/upgrade 均不可用。';

export interface ChannelRegistration {
  /** 宿主提供了 webServer 并成功登记 ⇒ true（**getter**：惰性注入后回调一跑就翻） */
  readonly registered: boolean;
  /** 见 `ChannelRouteState`（**getter**） */
  readonly state: ChannelRouteState;
  /** 未注册的原因（**getter**：注册成功后必须变回 `undefined`，不许留一句过期的谎） */
  readonly reason?: string | undefined;
  readonly channel: TerminalChannel;
  readonly paths: { readonly http: string; readonly upgrade: string };
  /** 当前仍生效的注册数（0 或 2；卸载后必须归零；T3.1 的判据） */
  registrationCount(): number;
  /** 幂等卸载（宿主卸载时由 `ctx.effect` 自动调用；测试里手动调） */
  dispose(): void;
}

export function registerTerminalChannel(ctx: ChannelPluginContext, deps: ChannelDeps): ChannelRegistration {
  const channel = createTerminalChannel(deps);
  const paths = { http: TERM_WS_HTTP_PREFIX, upgrade: TERM_WS_UPGRADE_PATH } as const;
  /** 宿主给的撤回器（`register()` 的返回值；宿主不会自动回收 ⇒ 由下面那条 effect 统一持有） */
  const hostDisposers: Array<() => void> = [];
  let live = 0;
  let state: ChannelRouteState = 'pending';
  let reason: string | undefined = PENDING_WEB_SERVER_REASON;
  let disposed = false;
  /** 当前那两条注册挂在**哪个**宿主服务面上（同一个面重复到达 ⇒ 保留第一次；面换了 ⇒ 先收回再重挂） */
  let attachedSurface: WebServerSurface | undefined;

  const fail = (why: string): void => {
    state = 'missing';
    reason = why;
  };

  const listHandler = async (request: HttpRequestLike, response: HttpResponseLike): Promise<void> => {
    try {
      const path = pathOf(request.url);
      if (path !== TERM_WS_LIST_PATH) {
        sendJson(response, 404, { error: { code: 'not-found', message: '未知路径：本前缀只提供实例枚举。' } });
        return;
      }
      if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
        sendJson(response, 405, { error: { code: 'method-not-allowed', message: '实例枚举只接受 GET。' } });
        return;
      }
      // REQ-7.5：list 与 upgrade **同一套**握手校验（同一函数，不可能漂移）
      const auth = channel.authenticate(request);
      if (!auth.ok) {
        // 失败体只有固定码与文案（REQ-7.2：不含实例信息）
        sendJson(response, auth.status, { error: { code: auth.code, message: auth.message } });
        return;
      }
      sendJson(response, 200, { instances: deps.manager.list() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: { code: 'internal', message: `实例枚举失败：${message}` } });
    }
  };

  const upgradeHandler = createUpgradeHandler(channel);
  const upgradeRoute = (request: HttpRequestLike, socket: UpgradeSocketLike, head?: unknown): void => {
    try {
      upgradeHandler(request, socket, head);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeRejection(socket, { status: 500, code: 'internal', message: `建立通道失败：${message}` });
    }
  };

  /**
   * 把**当前**这两条注册全部收回（幂等）。
   *
   * 二次 `attach` 的两条触发路径都要经过它（见文件头硬约束 1）：
   * ① **服务面被换掉**（宿主热重载 / 重启了提供 `webServer` 的插件）⇒ 旧面上的注册已随服务失效，
   *    挂在旧面上的 disposer 不收回就是**泄漏**（`live` 谎报 2、端点静默不可达）；
   * ② **同面重挂 / 半注册回滚**⇒ 必须先摘干净再注册，否则撞「重复 `(kind, path)` 抛错」。
   * 旧服务面可能已经失效（撤回本身会抛）⇒ 逐条 try/catch，撤回失败**不该**打断「换面重挂」。
   */
  const releaseRoutes = (): void => {
    for (const undo of hostDisposers.splice(0, hostDisposers.length)) {
      try {
        undo();
      } catch {
        // 旧服务面已失效：撤回失败只影响它自己；`live` / `attachedSurface` 由下面统一归零
      }
    }
    live = 0;
    attachedSurface = undefined;
  };

  /**
   * 真正登记两条路由。**幂等且能分辨二次到达**：
   * - 同一个面重复到达 ⇒ 保留**第一次**注册（现有两条仍然有效）；
   * - 面被换掉（或上一次只挂了一半 / 全部失败）⇒ 先收回再整组重挂（安全收编）；
   * - 已卸载 ⇒ 直接返回。
   * 若第二条（upgrade）抛错，把这一轮已登记的撤回后再记 `missing` —— 不留半注册。
   */
  const attach = (surface: WebServerSurface): void => {
    if (disposed) return;
    if (live > 0 && surface === attachedSurface) return;
    if (live > 0) releaseRoutes();
    try {
      hostDisposers.push(surface.register({ kind: 'prefix', path: TERM_WS_HTTP_PREFIX, handler: listHandler }));
      hostDisposers.push(surface.registerUpgrade({ path: TERM_WS_UPGRADE_PATH, handler: upgradeRoute }));
    } catch (error) {
      releaseRoutes();
      fail(`WS 路由注册失败（已回滚半注册）：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    attachedSurface = surface;
    live = hostDisposers.length;
    state = 'registered';
    reason = undefined;
  };

  /** 卸载（幂等）：置 `disposed` 挡住后到的注入回调，再摘掉路由。 */
  const disposeOnce = (): void => {
    disposed = true;
    releaseRoutes();
    if (state === 'registered') {
      state = 'missing';
      reason = '已卸载（dispose）⇒ 路由已摘除；后到的注入回调不会再注册。';
    }
  };

  // ① 宿主可用时机：有 inject 就等（服务已在 ⇒ 同步跑；后到 ⇒ 后到就跑）
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject([WEB_SERVER_SERVICE], (scope) => {
        if (disposed) return;
        const injected = scope.get(WEB_SERVER_SERVICE);
        if (isWebServerSurface(injected)) attach(injected);
        else fail(MISSING_WEB_SERVER_REASON);
      });
    } catch (error) {
      fail(`inject([${WEB_SERVER_SERVICE}]) 登记失败：${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    // ② 兼容路径（老宿主 / 测试替身）：同步取一次。**不是**判据，只是没有等待机制时的兜底
    const sync = ctx.get(WEB_SERVER_SERVICE);
    if (isWebServerSurface(sync)) attach(sync);
    else fail(MISSING_WEB_SERVER_REASON);
  }

  // 🔴 无条件收编：宿主不自动回收 `register()` 的返回值；且后到的注入回调也要能被这条闸挡住
  if (typeof ctx.effect === 'function') ctx.effect(() => disposeOnce, ROUTE_EFFECT_LABEL);

  return {
    get registered(): boolean {
      return live > 0;
    },
    get state(): ChannelRouteState {
      return state;
    },
    get reason(): string | undefined {
      return reason;
    },
    channel,
    paths,
    registrationCount: () => live,
    dispose: disposeOnce,
  };
}
