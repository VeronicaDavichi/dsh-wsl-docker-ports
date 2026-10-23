/**
 * 容器页的**取数面**（015 `P4`，只活在 chunk 里 ⇒ 主包零增长）
 *
 * 三条请求，全部打到**容器侧自己的前缀**（`/dsh-wsl-docker-containers`）：
 *
 * | 方法 | 路径 | 凭据 | 用途 |
 * | --- | --- | --- | --- |
 * | GET | `/snapshot` | 无 | 容器列表 + 目标发行版 + 失败原因 |
 * | POST | `/action` | 容器侧令牌 | `start` / `stop` / `restart` |
 * | GET | `/logs?id=&tail=` | 容器侧令牌 | 日志文本（服务端夹紧 `1..200`） |
 *
 * ## 三条纪律（与主包 `route-source.ts` / `container-control.ts` 同口径）
 *
 * 1. **不抛**：网络错误/非 2xx/形态不对都收敛成 `{ ok:false, message }` —— 页面渲染一行原因，
 *    不炸整棵 React 树；
 * 2. **不发第二次**：动作不自动重试（写语义不幂等），失败就如实显示，由用户再点；
 * 3. **凭据只在内存/会话里**：`authorization` 头由调用方给，本文件不读不存凭据。
 */

import type { FetchLike } from '../../wire.ts';

/** 容器侧前缀（与宿主半 `src/containers/wire.ts` 逐字一致；改一边必须改另一边） */
export const CONTAINERS_BASE = '/dsh-wsl-docker-containers';
export const CONTAINERS_SNAPSHOT_URL = `${CONTAINERS_BASE}/snapshot`;
export const CONTAINERS_ACTION_URL = `${CONTAINERS_BASE}/action`;
export const CONTAINERS_LOGS_URL = `${CONTAINERS_BASE}/logs`;

/** 容器行（与宿主半 `ContainersRow` 同形） */
export interface ContainerRow {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly state: string;
  readonly status: string;
  readonly ports: readonly string[];
}

export interface ContainersDistroView {
  readonly name: string;
  readonly state: string | null;
  readonly source: string;
  readonly staleConfig: boolean;
  readonly message: string | null;
}

export interface ContainersFailureView {
  readonly reason: string;
  readonly message: string;
  readonly hint: string;
}

export interface ContainersSnapshotView {
  readonly generatedAt: string;
  readonly distro: ContainersDistroView | null;
  readonly distroError: string | null;
  readonly containers: readonly ContainerRow[];
  readonly error: ContainersFailureView | null;
  readonly notes: readonly string[];
}

export type ContainersAction = 'start' | 'stop' | 'restart';

export interface ContainersClientDeps {
  readonly fetchImpl: FetchLike;
  /** 同源基址（默认 `''`）；末尾斜杠由调用方去掉 */
  readonly baseUrl?: string | undefined;
  /** 当前令牌（每次现取：用户在页内换了令牌，下一次动作就用新的） */
  readonly token?: (() => string | undefined) | undefined;
}

/** 统一的结果形状（`message` 一律是**可以直接显示的中文**） */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readFailure(value: unknown): ContainersFailureView | null {
  if (!isRecord(value)) return null;
  const message = asString(value['message']);
  if (message === null) return null;
  return { reason: asString(value['reason']) ?? 'unknown', message, hint: asString(value['hint']) ?? '' };
}

function readRow(value: unknown): ContainerRow | null {
  if (!isRecord(value)) return null;
  const id = asString(value['id']);
  const name = asString(value['name']);
  if (id === null || name === null) return null;
  const ports = Array.isArray(value['ports']) ? value['ports'].filter((item): item is string => typeof item === 'string') : [];
  return {
    id,
    name,
    image: asString(value['image']) ?? '',
    state: asString(value['state']) ?? '',
    status: asString(value['status']) ?? '',
    ports,
  };
}

/** 解析 `GET /snapshot` 的载荷（形态不对 ⇒ 失败，不猜） */
export function readSnapshotPayload(payload: unknown): Outcome<ContainersSnapshotView> {
  if (!isRecord(payload) || payload['ok'] !== true || !isRecord(payload['snapshot'])) {
    const failure = isRecord(payload) ? readFailure(isRecord(payload['error']) ? payload['error'] : payload) : null;
    return { ok: false, message: failure?.message ?? '容器侧快照响应形态无法识别' };
  }
  const snapshot = payload['snapshot'];
  const distroRaw = isRecord(snapshot['distro']) ? snapshot['distro'] : null;
  const containersRaw = Array.isArray(snapshot['containers']) ? snapshot['containers'] : [];
  return {
    ok: true,
    value: {
      generatedAt: asString(snapshot['generatedAt']) ?? '',
      distro:
        distroRaw === null
          ? null
          : {
              name: asString(distroRaw['name']) ?? '',
              state: asString(distroRaw['state']),
              source: asString(distroRaw['source']) ?? '',
              staleConfig: distroRaw['staleConfig'] === true,
              message: asString(distroRaw['message']),
            },
      distroError: asString(snapshot['distroError']),
      containers: containersRaw.map(readRow).filter((row): row is ContainerRow => row !== null),
      error: readFailure(snapshot['error']),
      notes: Array.isArray(snapshot['notes']) ? snapshot['notes'].filter((item): item is string => typeof item === 'string') : [],
    },
  };
}

const joiner = (deps: ContainersClientDeps): string => (deps.baseUrl ?? '').replace(/\/+$/u, '');

async function readJson(response: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** 取快照（无凭据） */
export async function fetchContainersSnapshot(deps: ContainersClientDeps): Promise<Outcome<ContainersSnapshotView>> {
  try {
    const response = await deps.fetchImpl(`${joiner(deps)}${CONTAINERS_SNAPSHOT_URL}`, { method: 'GET', headers: { accept: 'application/json' } });
    const payload = await readJson(response);
    if (response.status !== 200) {
      const failure = isRecord(payload) ? readFailure(isRecord(payload['error']) ? payload['error'] : payload) : null;
      return { ok: false, message: failure?.message ?? `容器快照请求失败（HTTP ${String(response.status)}）` };
    }
    return readSnapshotPayload(payload);
  } catch (error) {
    return { ok: false, message: `容器快照请求抛错：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 执行一次动作（需凭据；**不重试**） */
export async function runContainersAction(deps: ContainersClientDeps, id: string, action: ContainersAction): Promise<Outcome<null>> {
  const token = deps.token?.();
  if (token === undefined) return { ok: false, message: '本会话没有容器通道凭据（本地拦下，零请求）：请先在容器页点「保存凭据」' };
  try {
    const response = await deps.fetchImpl(`${joiner(deps)}${CONTAINERS_ACTION_URL}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, action }),
    });
    const payload = await readJson(response);
    if (response.status !== 200) {
      const failure = isRecord(payload) ? readFailure(isRecord(payload['error']) ? payload['error'] : payload) : null;
      return { ok: false, message: failure?.message ?? `${action} 失败（HTTP ${String(response.status)}）` };
    }
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, message: `${action} 请求抛错：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 取日志（需凭据；服务端把 `tail` 夹紧到 1..200） */
export async function fetchContainersLogs(deps: ContainersClientDeps, id: string, tail: number): Promise<Outcome<{ readonly text: string; readonly tail: number }>> {
  const token = deps.token?.();
  if (token === undefined) return { ok: false, message: '本会话没有容器通道凭据：日志也走受保护通道，请先保存凭据' };
  try {
    const url = `${joiner(deps)}${CONTAINERS_LOGS_URL}?id=${encodeURIComponent(id)}&tail=${String(tail)}`;
    const response = await deps.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    const payload = await readJson(response);
    if (response.status !== 200 || !isRecord(payload) || payload['ok'] !== true) {
      const failure = isRecord(payload) ? readFailure(isRecord(payload['error']) ? payload['error'] : payload) : null;
      return { ok: false, message: failure?.message ?? `日志请求失败（HTTP ${String(response.status)}）` };
    }
    return { ok: true, value: { text: asString(payload['text']) ?? '', tail: typeof payload['tail'] === 'number' ? payload['tail'] : tail } };
  } catch (error) {
    return { ok: false, message: `日志请求抛错：${error instanceof Error ? error.message : String(error)}` };
  }
}
