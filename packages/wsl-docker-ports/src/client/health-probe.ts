/**
 * 容器行的**健康探测**（015 `P4`）—— 客户端判定「容器侧这一行开着吗」的唯一信号。
 *
 * ## 为什么需要它（而不是「反正注册了就好」）
 *
 * 客户端 bundle **按包**加载、只 `apply` 一次 ⇒ 浏览器里看不到 cordis 的行清单，
 * 也没有「这一行被 disabled」的事件。而容器侧路由只在它的 `apply` 跑过之后才存在 ⇒
 * 唯一可观测的差异就是 `GET /dsh-wsl-docker-containers/health` 的响应：
 *
 * | 响应 | 含义 | 客户端动作 |
 * | --- | --- | --- |
 * | `200` + `{ok:true, side:'containers', v:1}` | 行开着、路由在 | 保留容器页 |
 * | `404`（宿主 SPA 兜底，**空 body**） | 行没开 / 路由没注册 | **撤掉**容器页（不留一个点开就报错的页） |
 * | 网络错误 / 超时 / 5xx / 形态不对 | 判不出来（离线、宿主慢、代理层挡了） | **保留**（保守方向：宁可多一个页，不可因探测抖动把功能藏了） |
 *
 * ## 三条纪律
 *
 * 1. **绝不抛**（`apply` 的返回值是契约，异步探测炸出去 = 未处理拒绝）；
 * 2. **绝不阻塞**：探测在后台跑，`apply` 同步返回；失败保守保留；
 * 3. **只认「确证 404」**为缺失 —— 其余一律 `unknown`。这条正是「探测失败保守注册」的落点。
 */

import type { FetchLike } from '../wire.ts';

/** 探测结论（三态，缺一不可：`unknown` 单独一态才不会被误当成 `missing`） */
export type HealthVerdict = 'ok' | 'missing' | 'unknown';

/** 容器侧健康端点的路径（与宿主半 `src/containers/health.ts` 的 `CONTAINERS_HEALTH_PATH` 逐字一致） */
export const CONTAINERS_HEALTH_PROBE_PATH = '/dsh-wsl-docker-containers/health';

/** 期望载荷的判别（`side` 必须对得上：防别的插件蹭同名路径） */
export const CONTAINERS_EXPECTATION = { side: 'containers', path: CONTAINERS_HEALTH_PROBE_PATH };

/**
 * 探测一次。**任何异常都收敛成 `unknown`**；只有「HTTP 404」才是 `missing`。
 *
 * `baseUrl` 与主包其余请求同源（默认 `''`）；末尾斜杠会被去掉（避免 `//health`）。
 * 载荷判别（`ok===true && side==='containers' && v===1`）与「解析失败也算 unknown」是同一条
 * 保守口径：**认不出来就不撤页**。
 */
export async function probeHealth(input: {
  readonly fetchImpl?: FetchLike | undefined;
  readonly baseUrl?: string | undefined;
}): Promise<HealthVerdict> {
  const fetchImpl = input.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (typeof fetchImpl !== 'function') return 'unknown';
  try {
    const url = `${(input.baseUrl ?? '').replace(/\/+$/u, '')}${CONTAINERS_EXPECTATION.path}`;
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
    if (response.status === 404) return 'missing';
    if (response.status !== 200) return 'unknown';
    const parsed = (await response.json()) as Record<string, unknown> | null;
    const recognised =
      typeof parsed === 'object' && parsed !== null && parsed['ok'] === true && parsed['side'] === CONTAINERS_EXPECTATION.side && parsed['v'] === 1;
    return recognised ? 'ok' : 'unknown';
  } catch {
    return 'unknown';
  }
}
