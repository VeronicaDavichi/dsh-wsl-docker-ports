/**
 * 容器侧的健康端点（015 `P2`）—— `GET /dsh-wsl-docker-containers/health`
 *
 * ## 为什么客户端需要它
 *
 * 客户端 bundle **按包**加载、只 `apply` 一次 ⇒ 浏览器里没有「哪一条行被关掉」的信号。
 * 唯一的可行判据 = 每侧自己的健康端点：行被关 ⇒ 它的 `apply` 没跑 ⇒ 路由没注册 ⇒ 宿主 SPA 兜底 404。
 *
 * ## 为什么载荷里带 `side` 与 `rowId`
 *
 * - `side`：客户端区分两个 pane（`ports` / `containers`）；
 * - `rowId`：客户端把它当**配置命名空间**（两个命名空间同名不同物，拿错一个就会去读对侧的凭据）；
 * - `v: 1`：防「别的插件蹭同名路径」——版本不在预期内 ⇒ 客户端按「探测失败」保守处理（仍注册）。
 *
 * ## 免鉴权、只读、零 IO
 *
 * 答的只是「这一侧的路由注册了吗」。**不能**要求凭据：未配置凭据是常态（用户还没点生成），
 * 若健康端点也 401，客户端会把「已启用但没配凭据」误判成「未启用」，页面直接消失。
 */

import { answerHealth, healthPath, type HealthPayload } from '../shared/health.ts';
import type { HttpRequestLike, HttpResponseLike } from '../shared/http.ts';
import { CONTAINERS_PREFIX } from './wire.ts';
import { CONTAINERS_ROW_ID } from './credential.ts';

/** 容器侧健康端点的全路径 */
export const CONTAINERS_HEALTH_PATH = healthPath(CONTAINERS_PREFIX);

/** 容器侧健康载荷（**唯一**构造点：`side`/`rowId` 改了这里就全改） */
export const CONTAINERS_HEALTH_PAYLOAD: HealthPayload = {
  ok: true,
  side: 'containers',
  rowId: CONTAINERS_ROW_ID,
  v: 1,
};

/** 答一次健康请求（非 GET ⇒ 405；走共享的唯一 JSON 出口） */
export function answerContainersHealth(request: HttpRequestLike, response: HttpResponseLike): void {
  answerHealth(request, response, CONTAINERS_HEALTH_PAYLOAD);
}
