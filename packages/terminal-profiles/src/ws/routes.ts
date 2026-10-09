/**
 * 路由与 upgrade 注册（002 T3.1 / REQ-7.1 / REQ-7.5 / REQ-7.6）
 *
 * 注册**两条**（REQ-7.1 的两半）：
 * ① `register({ kind: 'prefix', path: '/dsh-managed-terminal/' })` —— 独占领前缀的具名 HTTP 路由，
 *    本层只答 `/dsh-managed-terminal/instances`（实例枚举），前缀内其它路径答 404，
 *    前缀外一律不碰（官方的匹配顺序是 exact → 最长 prefix → fallback，本前缀独占 ⇒ 不抢 SPA fallback）；
 * ② `registerUpgrade({ path: '/dsh-managed-terminal/ws' })` —— **exact**，多终端靠协议层 `instanceId`
 *    复用这一个端点（宿主 upgrade 不支持前缀）。
 *
 * 🔴 **disposer 必须登记到 `ctx.effect`**：宿主不会自动收集注册返回的 disposer，漏登记就是
 *    「插件卸载了、路由还在，且再次挂载会因重复 `(kind, path)` 直接抛错」。T3.1 的判据
 *    （注册/卸载计数归零）就是钉这一条。
 *
 * 🔴 服务获取用**非严格** `ctx.get('webServer')`：缺服务时「不注册任何路由并给出原因」，
 *    **不是**让整个插件启动失败（宿主里 webServer 是可选的）。
 */

import { TERM_WS_HTTP_PREFIX, TERM_WS_LIST_PATH, TERM_WS_UPGRADE_PATH } from './constants.ts';
import { createTerminalChannel } from './connection.ts';
import type { ChannelDeps, TerminalChannel } from './connection.ts';
import { createUpgradeHandler, writeRejection } from './upgrade-socket.ts';
import type { ChannelPluginContext, HttpRequestLike, HttpResponseLike, UpgradeSocketLike, WebServerSurface } from './types.ts';

const encoder = new TextEncoder();

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

export interface ChannelRegistration {
  /** 宿主提供了 webServer 并成功登记 ⇒ true；否则 false（`reason` 说明原因） */
  readonly registered: boolean;
  readonly reason?: string | undefined;
  readonly channel: TerminalChannel;
  readonly paths: { readonly http: string; readonly upgrade: string };
  /** 当前仍生效的注册数（卸载后必须归零；T3.1 的判据） */
  registrationCount(): number;
  /** 幂等卸载（宿主卸载时由 `ctx.effect` 自动调用；测试里手动调） */
  dispose(): void;
}

export function registerTerminalChannel(ctx: ChannelPluginContext, deps: ChannelDeps): ChannelRegistration {
  const channel = createTerminalChannel(deps);
  const paths = { http: TERM_WS_HTTP_PREFIX, upgrade: TERM_WS_UPGRADE_PATH } as const;
  const disposers: (() => void)[] = [];
  let count = 0;

  /**
   * 登记一个宿主注册动作。`ctx.effect` 会在插件卸载时调用我们返回的 disposer；
   * 老宿主/测试替身若没有 `effect`，退到「手动 dispose」并把 disposer 收进 `disposers`。
   */
  const track = (register: () => () => void): void => {
    const install = (): (() => void) => {
      const hostDispose = register();
      count += 1;
      let done = false;
      const disposeOnce = (): void => {
        if (done) return;
        done = true;
        count -= 1;
        hostDispose();
      };
      disposers.push(disposeOnce);
      return disposeOnce;
    };
    if (typeof ctx.effect === 'function') ctx.effect(install);
    else install();
  };

  const dispose = (): void => {
    for (const item of disposers.splice(0, disposers.length)) item();
  };

  const webServer = ctx.get('webServer');
  if (!isWebServerSurface(webServer)) {
    return {
      registered: false,
      reason: '宿主未提供 webServer 服务（非严格 ctx.get）：WS 通道不注册任何路由，HTTP/upgrade 均不可用。',
      channel,
      paths,
      registrationCount: () => 0,
      dispose: () => undefined,
    };
  }

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

  track(() => webServer.register({ kind: 'prefix', path: TERM_WS_HTTP_PREFIX, handler: listHandler }));
  track(() => webServer.registerUpgrade({ path: TERM_WS_UPGRADE_PATH, handler: upgradeRoute }));

  return {
    registered: true,
    channel,
    paths,
    registrationCount: () => count,
    dispose,
  };
}
