/**
 * **共享健康探测面**（015 `P2`）—— 每侧自带 `GET <prefix>/health`，客户端据此判定「对侧那一行是否启用」。
 *
 * ## 为什么需要它（客户端没有逐行信号）
 *
 * 015 design §Q4：服务端能用 `ctx.get('loader').entries()` 看到**两条**行的 `disabled`，但客户端
 * bundle 按**包**加载、只 apply 一次 ⇒ 浏览器里**没有**「哪一条行被关掉」的信号。唯一的可行判据 =
 * 每侧自己的 `GET <prefix>/health`：行被关 ⇒ 它的 `apply` 没跑 ⇒ 路由没注册 ⇒ 宿主 SPA 兜底 **404**。
 *
 * ## 为什么放在 `shared/`（而不是 design 里写的 `containers/health.ts`）
 *
 * 两侧都要这一条，而 015 R2 **禁止转发侧 import `containers/**`**（零交叉白名单）。把「同一份
 * 载荷形状」放在业务无关的共享层是唯一既满足 R2、又不复制两份口径的落点（R3 只管字段无关底座，
 * 一条 `{ok,side,rowId}` 的探针载荷没有业务判断）。
 *
 * ## 免鉴权、只读、零 IO
 *
 * 它答的只有「这一侧的路由注册了吗」，不含任何配置/凭据/事实 ⇒ 不需要 `writeToken`
 * （未配置凭据时也必须能答，否则客户端会对「已启用但还没配凭据」的一侧误判成未启用）。
 */

import { sendJson, type HttpRequestLike, type HttpResponseLike } from './http.ts';

/** 健康端点在前缀内的那一段（**不带尾斜杠**，与快照/动作路径同一个拼法） */
export const HEALTH_SEGMENT = '/health';

/** 某一侧的健康端点全路径（`<prefix>/health`） */
export function healthPath(prefix: string): string {
  return `${prefix}${HEALTH_SEGMENT}`;
}

/** 健康载荷：**只**回答身份与「我注册了」，不含配置/凭据/事实 */
export interface HealthPayload {
  readonly ok: true;
  /** 侧别（`ports` / `containers`；由调用方传，本模块不认识业务） */
  readonly side: string;
  /** 这一侧的行 id（客户端用来区分两个命名空间；与 `cordis.patch.yml` 的 `- id` 一致） */
  readonly rowId: string;
  /** 载荷版本：客户端按它判断「这条端点是不是本包发的」（防别的插件蹭同名路径） */
  readonly v: 1;
}

/** 答一次健康请求（非 GET ⇒ 405，走**唯一**的 JSON 出口） */
export function answerHealth(request: HttpRequestLike, response: HttpResponseLike, payload: HealthPayload): void {
  if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
    sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: '健康端点只接受 GET' } });
    return;
  }
  sendJson(response, 200, payload);
}
