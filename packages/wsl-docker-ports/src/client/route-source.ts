/**
 * 客户端侧的 `PortsSource` 实现：**从宿主快照路由取数**（003 T6.8）
 *
 * ## 分工：宿主给事实+判决，客户端给「声明」
 *
 * 宿主进程**没有** settings 存储（`ctx.settings.register` 在 0.2.0-rc.2 已移除；配置写回
 * 是客户端的 `remote.settings.update(ns, patch)`）。故 `managedPorts` / `scopes` /
 * `elevationPolicy` 由**客户端**在每次刷新时读一次配置、拼进查询串；宿主只把它当**声明**，
 * 事实（netsh / docker / eth0 / `.wslconfig`）一律现读。
 *
 * ⇒ 路由是**无状态**的：同一 URL 永远给同一份判决。这既便于对账，也让「声明从哪来」只有一处。
 *
 * ## 编码器只有一份
 *
 * URL 由 `wire.ts` 的 `buildSnapshotQuery()` 拼（**与宿主的解码器互为逆**）。
 * 本模块不自己拼查询串 —— 那正是两侧漂移的经典入口。
 *
 * ## 零写操作（NFR-2）
 *
 * 本模块只有 `fetch`，没有任何 `settings.update` / 提权调用；`readDeclaration` 是**读**
 * （`describe()`）。
 */

import { PORTS_SNAPSHOT_METHOD, PORTS_SNAPSHOT_PATH, buildSnapshotQuery } from '../wire.ts';
import type { FetchLike, PortsSnapshot, PortsSnapshotResponse, SnapshotDeclaration } from '../wire.ts';
import type { PortsSource } from './host.ts';

/** 取数面的 fetch 面（定义在传输契约里，与宿主侧共用一份） */
export type { FetchLike, FetchResponseLike } from '../wire.ts';

export interface RouteSourceOptions {
  /** 同源基址（默认 `''`；GUI 与路由同源 ⇒ 相对路径即可） */
  readonly baseUrl?: string | undefined;
  /** 注入 fetch（测试用）；默认全局 `fetch` */
  readonly fetchImpl?: FetchLike | undefined;
  /** 每次刷新前读一次声明（来自 `settings.readConfig()`）；缺省 = 空声明 + 默认策略 */
  readonly readDeclaration?: (() => Promise<SnapshotDeclaration>) | undefined;
}

/** 空声明（读不到配置时的最保守默认：无受管端口、全 loopback、策略 none） */
export const EMPTY_DECLARATION: SnapshotDeclaration = { managedPorts: [], scopes: {}, elevationPolicy: 'none' };

/** 拼完整 URL（基址 + 路径 + 查询串）；导出以便测试断言**字面量** */
export function buildSnapshotUrl(baseUrl: string, declaration: SnapshotDeclaration, allowColdStart: boolean): string {
  const query = buildSnapshotQuery(declaration, allowColdStart);
  return `${baseUrl}${PORTS_SNAPSHOT_PATH}${query.length > 0 ? `?${query}` : ''}`;
}

/**
 * 把响应体解成快照，或**抛出**带码的错误。
 *
 * 抛错而不是返回降级快照：路由级失败意味着「事实读不到」（例如 netsh 读失败），
 * 伪造一份空快照会让页面显示「没有任何规则」—— 那比一句「读取失败」危险得多。
 * `pane.tsx` 已有 `catch` 分支（`loadError`），会把它显示成一行可读文案。
 */
export function parseSnapshotResponse(status: number, payload: unknown): PortsSnapshot {
  const body = payload as Partial<PortsSnapshotResponse> | null;
  if (typeof body === 'object' && body !== null && body.ok === true && 'snapshot' in body) {
    return body.snapshot as PortsSnapshot;
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof error?.code === 'string' ? error.code : `http-${String(status)}`;
  const message = typeof error?.message === 'string' ? error.message : `快照路由返回了不可识别的响应（HTTP ${String(status)}）`;
  throw new Error(`${code}: ${message}`);
}

/**
 * 造路由来源。**构造期不发请求**（装载期零请求；请求只发生在 `load()` 里）。
 */
export function createRouteSource(options: RouteSourceOptions = {}): PortsSource {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined);
  const readDeclaration = options.readDeclaration ?? ((): Promise<SnapshotDeclaration> => Promise.resolve(EMPTY_DECLARATION));

  return {
    async load(loadOptions = {}): Promise<PortsSnapshot> {
      if (fetchImpl === undefined) {
        throw new Error('no-fetch: 运行环境没有 fetch，无法读取宿主快照路由');
      }
      const declaration = await readDeclaration();
      const url = buildSnapshotUrl(baseUrl, declaration, loadOptions.allowColdStart === true);
      const response = await fetchImpl(url, { method: PORTS_SNAPSHOT_METHOD, cache: 'no-store', headers: { Accept: 'application/json' } });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      return parseSnapshotResponse(response.status, payload);
    },
  };
}
