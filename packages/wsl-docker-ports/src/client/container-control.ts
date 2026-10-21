/**
 * 容器动作 / 日志的**客户端半**（010 `T7.1` / `T7.2`）—— 只发两条请求，不做判决。
 *
 * ## 为什么在 chunk 里
 *
 * 011 的主包棘轮是**零余量**的地板：只有 `pane.tsx` 下的东西才进 `lib/client.ports.js`
 * （无上限）。本模块被 `pane-tables.tsx` 的容器表引用 ⇒ 与页面同住在 chunk 里，主包一个字节都不涨。
 *
 * ## 凭据：与 008 的写通道**同一把**
 *
 * `REQ-11.4` 要求「容器动作只有用户本人能触发」。宿主的 HTTP 请求**没有可信的用户标识**
 * （008 T2.9 的侦察结论：宿主没有可用的鉴权面）⇒ 判据只能落在**插件自有凭据**上：
 * 页面上点按钮 = 带着 `sessionStorage` 里的凭据发请求；Agent 没有那把凭据 ⇒ 宿主回 401，
 * **一次 docker 调用都不会发生**（服务端 `docker/route.ts` 的鉴权最靠前）。
 *
 * 这里**不发明** `source: 'user'` 这类字段：那种字段 Agent 也能照写，等于自欺。
 *
 * ## 不重试、不落盘
 *
 * 动作请求失败就是失败（`start|stop|restart` 不幂等）；日志只进 React 状态，随组件卸载消失。
 */

import type { FetchLike } from '../wire.ts';
import type { ClientRuntime } from './host.ts';
import type { WriteTokenStore } from './write-token.ts';
import type { ContainerAction } from '../docker/wire.ts';
import { CONTAINER_ACTION_METHOD, CONTAINER_ACTION_PATH, CONTAINER_LOGS_METHOD, CONTAINER_LOGS_PATH, DEFAULT_LOG_TAIL } from '../docker/wire.ts';

/** 凭据缺失时的统一文案（与 008 的写通道同一句，不另造一套解释） */
export const CONTAINER_CREDENTIAL_MISSING = '尚未配置写凭据：容器动作需要凭据（在右栏页「写凭据」区生成并保存）。未带凭据的请求宿主一律 401，一次 docker 调用都不会发生。';

export interface ContainerControlDeps {
  /** 同源基址（默认 `''`） */
  readonly baseUrl?: string | undefined;
  readonly tokenStore: Pick<WriteTokenStore, 'read'>;
  readonly fetchImpl?: FetchLike | undefined;
}

export type ContainerActionOutcome =
  | { readonly ok: true; readonly action: ContainerAction }
  | { readonly ok: false; readonly message: string };

export type ContainerLogsOutcome =
  | { readonly ok: true; readonly tail: number; readonly text: string }
  | { readonly ok: false; readonly message: string };

export interface ContainerControl {
  action(containerId: string, action: ContainerAction): Promise<ContainerActionOutcome>;
  logs(containerId: string, tail?: number): Promise<ContainerLogsOutcome>;
}

/** 宿主错误体（`{ok:false, error:{code,message}}`）→ 一句可读原因；解析不了就用状态码 */
function errorText(status: number, parsed: unknown, readable: boolean): string {
  if (readable) {
    const message = (parsed as { error?: { message?: unknown } } | null)?.error?.message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return readable ? `宿主返回 ${String(status)}（响应体里没有 error.message）` : `宿主返回 ${String(status)}（响应体不是 JSON）`;
}

export function createContainerControl(deps: ContainerControlDeps): ContainerControl {
  const baseUrl = deps.baseUrl ?? '';
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined);

  const send = async (url: string, init: Parameters<FetchLike>[1]): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly message: string }> => {
    const token = deps.tokenStore.read();
    if (token === undefined || token.trim() === '') return { ok: false, message: CONTAINER_CREDENTIAL_MISSING };
    if (fetchImpl === undefined) return { ok: false, message: '当前运行环境没有 fetch：容器动作不可用（只读面照常）' };
    try {
      const response = await fetchImpl(url, {
        ...init,
        // 🔴 凭据只走请求头：`?token=` 会进访问日志与浏览器历史（008 客户端半的同一取向）
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        cache: 'no-store',
      });
      // `FetchLike` 只声明了 `json()`（浏览器 `Response` 与 fake 都满足）⇒ 只解一次，靠 `status` 分叉
      let parsed: unknown;
      let readable = true;
      try {
        parsed = await response.json();
      } catch {
        readable = false;
      }
      if (!response.ok) return { ok: false, message: errorText(response.status, parsed, readable) };
      if (!readable) return { ok: false, message: '宿主响应不是合法 JSON（协议不符）' };
      return { ok: true, body: parsed };
    } catch (error) {
      return { ok: false, message: `请求容器动作时抛出异常：${error instanceof Error ? error.message : String(error)}（未重试）` };
    }
  };

  return {
    async action(containerId: string, action: ContainerAction): Promise<ContainerActionOutcome> {
      const outcome = await send(`${baseUrl}${CONTAINER_ACTION_PATH}`, {
        method: CONTAINER_ACTION_METHOD,
        body: JSON.stringify({ id: containerId, action }),
      });
      if (!outcome.ok) return outcome;
      const body = outcome.body as { ok?: unknown; action?: unknown };
      if (body?.ok !== true) return { ok: false, message: '宿主没有确认这次容器动作（响应 ok≠true）' };
      return { ok: true, action };
    },

    async logs(containerId: string, tail = DEFAULT_LOG_TAIL): Promise<ContainerLogsOutcome> {
      const query = new URLSearchParams({ id: containerId, tail: String(tail) });
      const outcome = await send(`${baseUrl}${CONTAINER_LOGS_PATH}?${query.toString()}`, { method: CONTAINER_LOGS_METHOD });
      if (!outcome.ok) return outcome;
      const body = outcome.body as { ok?: unknown; tail?: unknown; text?: unknown };
      if (body?.ok !== true || typeof body.text !== 'string') return { ok: false, message: '宿主没有返回日志正文（响应不合预期）' };
      return { ok: true, tail: typeof body.tail === 'number' ? body.tail : tail, text: body.text };
    },
  };
}

/**
 * 从 `ClientRuntime` 取容器动作客户端（`T7.1` 的装配点，放这里页面就只需一行）。
 *
 * `runtime.write === undefined`（写整包被显式关掉）⇒ 返回 `undefined`：控件**置灰 + 写明原因**，
 * 而不是「存在但点了没反应」（后者会被用户当成 bug）。
 */
export function containerControlOf(runtime: ClientRuntime): ContainerControl | undefined {
  if (runtime.write === undefined) return undefined;
  const { baseUrl, fetchImpl, tokenStore } = runtime.write;
  return createContainerControl({
    tokenStore,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
}
