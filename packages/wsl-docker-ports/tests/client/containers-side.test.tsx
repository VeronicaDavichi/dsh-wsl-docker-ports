/**
 * 015 `P4` 客户端侧的**取数面**契约（chunk 侧纯函数，无需 DOM）
 *
 * 判据分三组：
 * 1. **形态解析**（`readSnapshotPayload`）：认得出来的就解析，认不出来就 `ok:false`（不猜、不造空列表）；
 * 2. **三条请求**（快照 / 动作 / 日志）：路径、方法、凭据头、错误文案；
 * 3. **探活三态**（`probeHealth`）：**只有 404 是 `missing`**，其余一律 `unknown`（保守注册的落点）。
 */

import { describe, expect, it } from 'vitest';

import {
  fetchContainersLogs,
  fetchContainersSnapshot,
  readSnapshotPayload,
  runContainersAction,
} from '../../src/client/containers/source.ts';
import { probeHealth, CONTAINERS_EXPECTATION } from '../../src/client/health-probe.ts';
import type { FetchLike } from '../../src/wire.ts';

interface Call {
  readonly url: string;
  readonly init: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string } | undefined;
}

function fakeFetch(
  reply: { readonly status: number; readonly body: unknown },
  calls: Call[] = [],
): { readonly fetchImpl: FetchLike; readonly calls: Call[] } {
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = { url, init: init as Call['init'] };
    calls.push(call);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  return { fetchImpl, calls };
}

const SNAPSHOT = {
  ok: true,
  snapshot: {
    generatedAt: '2026-10-23T00:00:00.000Z',
    distro: { name: 'Ubuntu2204', state: 'Running', source: 'config', staleConfig: false, message: null },
    distroError: null,
    containers: [{ id: 'abc', name: 'pg', image: 'postgres:16', state: 'running', status: 'Up 3 hours', ports: ['5432->5432/tcp'] }],
    error: null,
    notes: ['一条备注'],
  },
};

describe('015 P4 容器快照解析', () => {
  it('正常载荷 ⇒ 逐字段解析（容器行、发行版、备注）', () => {
    const result = readSnapshotPayload(SNAPSHOT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.distro?.name).toBe('Ubuntu2204');
    expect(result.value.containers).toHaveLength(1);
    expect(result.value.containers[0]?.ports).toEqual(['5432->5432/tcp']);
    expect(result.value.notes).toEqual(['一条备注']);
  });

  it('宿主侧失败（ok:false + error）⇒ ok:false 且**带上原文**，不是空列表', () => {
    const result = readSnapshotPayload({ ok: false, error: { reason: 'docker-failed', message: 'docker ps 失败', hint: '看 WSL 里 docker 是否在跑' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('docker ps 失败');
  });

  it('形态不认识（没有 snapshot）⇒ ok:false，不猜', () => {
    expect(readSnapshotPayload({ ok: true }).ok).toBe(false);
    expect(readSnapshotPayload(null).ok).toBe(false);
    expect(readSnapshotPayload('x').ok).toBe(false);
  });

  it('动作/日志的失败载荷也走同一套 error 解析', async () => {
    const { fetchImpl } = fakeFetch({ status: 502, body: { ok: false, error: { reason: 'docker-failed', message: 'restart 失败：no such container', hint: '' } } });
    const result = await runContainersAction({ fetchImpl, baseUrl: '', token: () => 'tok' }, 'abc', 'restart');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('no such container');
  });
});

describe('015 P4 容器侧三条请求', () => {
  it('快照：GET /dsh-wsl-docker-containers/snapshot（无凭据）', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: SNAPSHOT });
    const result = await fetchContainersSnapshot({ fetchImpl, baseUrl: '' });
    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toBe('/dsh-wsl-docker-containers/snapshot');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.headers?.['authorization']).toBeUndefined();
  });

  it('快照：404 也算失败（不把 404 当「没有容器」）', async () => {
    const { fetchImpl } = fakeFetch({ status: 404, body: undefined });
    const result = await fetchContainersSnapshot({ fetchImpl, baseUrl: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('404');
  });

  it('动作：**没有凭据就一个请求都不发**（本地拦下）', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: { ok: true } });
    const result = await runContainersAction({ fetchImpl, baseUrl: '', token: () => undefined }, 'abc', 'start');
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('动作：有凭据 ⇒ POST + Bearer + 恰好 `{id, action}`（不重试）', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: { ok: true } });
    const result = await runContainersAction({ fetchImpl, baseUrl: '', token: () => 'tok' }, 'abc', 'restart');
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/dsh-wsl-docker-containers/action');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers?.['authorization']).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ id: 'abc', action: 'restart' });
  });

  it('日志：GET + `id`/`tail` 进 query，凭据进头', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: { ok: true, text: 'line1', tail: 50 } });
    const result = await fetchContainersLogs({ fetchImpl, baseUrl: '', token: () => 'tok' }, 'abc', 50);
    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toBe('/dsh-wsl-docker-containers/logs?id=abc&tail=50');
    expect(calls[0]?.init?.headers?.['authorization']).toBe('Bearer tok');
  });

  it('日志：没有凭据 ⇒ 零请求（日志也走受保护通道）', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: { ok: true } });
    const result = await fetchContainersLogs({ fetchImpl, baseUrl: '', token: () => undefined }, 'abc', 50);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('015 P4 容器页探活三态', () => {
  it('200 + 正确 side/v ⇒ ok', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: { ok: true, side: 'containers', rowId: 'dsh-wsl-docker-containers', v: 1 } });
    expect(await probeHealth({ fetchImpl, baseUrl: '' })).toBe('ok');
    expect(calls[0]?.url).toBe(CONTAINERS_EXPECTATION.path);
  });

  it('404 ⇒ **missing**（宿主 SPA 兜底 ⇒ 这一行没开）', async () => {
    const { fetchImpl } = fakeFetch({ status: 404, body: undefined });
    expect(await probeHealth({ fetchImpl, baseUrl: '' })).toBe('missing');
  });

  it('200 但 side 不对 / 版本不是 1 ⇒ unknown（不把别人的端点当自己）', async () => {
    const wrongSide = fakeFetch({ status: 200, body: { ok: true, side: 'ports', v: 1 } });
    expect(await probeHealth({ fetchImpl: wrongSide.fetchImpl, baseUrl: '' })).toBe('unknown');
    const wrongVersion = fakeFetch({ status: 200, body: { ok: true, side: 'containers', v: 2 } });
    expect(await probeHealth({ fetchImpl: wrongVersion.fetchImpl, baseUrl: '' })).toBe('unknown');
  });

  it('网络抛错 / 500 / 没有 fetch ⇒ 一律 unknown（保守：保留容器页）', async () => {
    const boom: FetchLike = async () => {
      throw new Error('offline');
    };
    expect(await probeHealth({ fetchImpl: boom, baseUrl: '' })).toBe('unknown');
    const serverError = fakeFetch({ status: 500, body: undefined });
    expect(await probeHealth({ fetchImpl: serverError.fetchImpl, baseUrl: '' })).toBe('unknown');
    expect(await probeHealth({ baseUrl: '' })).toBe('unknown');
  });
});
