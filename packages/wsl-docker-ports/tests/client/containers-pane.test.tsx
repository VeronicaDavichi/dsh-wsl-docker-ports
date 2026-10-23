// @vitest-environment jsdom
/**
 * **2026-10-23 真机缺陷的第二半回归判据**：容器页「页签开了但空表」。
 *
 * ## 真机症状
 *
 * 右栏点开「WSL Docker 容器」后，页面写「目标发行版：未解析」，报
 * **「没有可用的 fetch：本页无法取容器列表（测试环境未注入 fetchImpl）」**，
 * 网络面板里**一条** `/dsh-wsl-docker-containers/snapshot` 都没有。
 *
 * ## 根因
 *
 * 生产路径是 `apply(ctx)`（**没有 `options`**）⇒ 主包不改写 `runtime.fetchImpl`（`undefined`），
 * 而旧 `ContainersPane` 的 `deps` 直接 `runtime?.fetchImpl === undefined ⇒ return undefined` ⇒
 * 首屏只 setError、**一个请求都不发**。`containers/runtime.ts:17` 的契约写的就是
 * 「缺省用全局 `fetch`」，同一个口径在主包 `route-source.ts:72` / `health-probe.ts:51` 也成立
 * ⇒ 缺省回落必须落在 chunk 侧（主包有 56,182 B 棘轮地板，chunk 不限）。
 *
 * ## 为什么这条用例在旧代码上必红
 *
 * 它**不给 `runtime.fetchImpl`**，只把 `globalThis.fetch` 换成一个记录器：
 * 旧代码 ⇒ 记录器**零调用**且表里只有「读取中…」这一行；修后 ⇒ 恰好一次 GET + 30 行容器。
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { ContainersPane, CID } from '../../src/client/containers/pane.tsx';
import type { ContainersRuntime } from '../../src/client/containers/runtime.ts';
import type { SettingsPipe } from '../../src/client/settings-pipe.ts';
import type { FetchLike } from '../../src/wire.ts';

interface Call {
  readonly url: string;
  readonly init: { readonly method?: string } | undefined;
}

/** 30 个容器（真机 `docker ps` 的规模：`/snapshot` 实测 30 条） */
const CONTAINERS = Array.from({ length: 30 }, (_, index) => ({
  id: `cid-${String(index)}`,
  name: `svc-${String(index)}`,
  image: 'nginx:1.27',
  state: 'running',
  status: 'Up 2 hours',
  ports: [`${String(8000 + index)}->80/tcp`],
}));

const SNAPSHOT = {
  ok: true,
  snapshot: {
    generatedAt: '2026-10-23T00:00:00.000Z',
    distro: { name: 'Ubuntu2204', state: 'Running', source: 'config', staleConfig: false, message: null },
    distroError: null,
    containers: CONTAINERS,
    error: null,
    notes: [],
  },
};

let calls: Call[] = [];
const realFetch = globalThis.fetch;

/**
 * 全局 `fetch` 的替身，**按浏览器语义校验接收者**。
 *
 * 🔴 这条校验是 2026-10-23 第二个真机缺陷的回归判据：取数面写的是
 * `deps.fetchImpl(url, init)`（**方法调用**），而原生 `fetch` 在「接收者不是 window/undefined」时
 * 抛 `TypeError: Illegal invocation` —— 真机症状是页签开着、表永远停在「读取中…」。
 * 普通箭头函数替身**测不出来**（箭头函数不关心 `this`），所以这里必须是 `function` 并显式判 `this`。
 */
const receiverGuardedFetch = function (this: unknown, url: string, init?: unknown) {
  if (this !== undefined && this !== globalThis) {
    throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
  }
  calls.push({ url, init: init as Call['init'] });
  return Promise.resolve({ ok: true, status: 200, json: async () => SNAPSHOT });
};

beforeEach(() => {
  calls = [];
  globalThis.fetch = receiverGuardedFetch as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

/** 容器侧配置：刷新关闭（0）⇒ 不排定时器，用例不必和计时器赛跑 */
function quietSettings(): SettingsPipe {
  return {
    readConfig: async () => ({ refreshIntervalSec: 0 }),
    read: async () => ({ refreshIntervalSec: 0 }),
    update: async () => undefined,
  } as unknown as SettingsPipe;
}

/**
 * **生产形状**的 runtime：主包 `apply(ctx)` 无 options ⇒ 这里**故意不给 `fetchImpl`**
 * （`baseUrl` 也是空串，与真机同源）。
 */
function productionRuntime(): ContainersRuntime {
  return { baseUrl: '', token: () => undefined, saveToken: () => undefined, settings: quietSettings };
}

describe('容器页取数：缺省必须回落全局 fetch', () => {
  it('没注入 fetchImpl ⇒ 发**恰好一次** `/snapshot` 请求并渲染 30 行（旧代码：零请求 + 一行错误）', async () => {
    const { container } = render(<ContainersPane runtime={productionRuntime()} /> as ReactElement);

    await screen.findByTestId(CID.table);
    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr')).toHaveLength(30);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/dsh-wsl-docker-containers/snapshot');
    expect(calls[0]?.init?.method).toBe('GET');
    // 表头 5 列 + 首行内容（名/镜像/状态/端口）都来自真载荷
    expect(container.querySelectorAll('tbody tr')[0]?.textContent).toContain('svc-0');
    expect(container.querySelectorAll('tbody tr')[0]?.textContent).toContain('8000->80/tcp');
    // 「没有可用的 fetch」那条错误**不许出现**（旧代码就是它 + 0 请求）
    expect(container.textContent ?? '').not.toContain('没有可用的 fetch');
    expect(container.textContent ?? '').toContain('目标发行版：Ubuntu2204');
    console.log(`  · 无注入 fetchImpl：请求 ${String(calls.length)} 次，容器行 ${String(container.querySelectorAll('tbody tr').length)} 行`);
  });

  it('注入 fetchImpl 仍然优先（测试/集成方接管传输时行为不变），且**方法调用**不会踩 Illegal invocation', async () => {
    const injected: Call[] = [];
    // 注入件同样是「在意接收者」的普通函数：取数面必须以方法调用也能成功（bind/局部变量都行，
    // 但不许把原生 fetch 直接挂上去当方法用）
    const fetchImpl = function (this: unknown, url: string, init?: unknown) {
      injected.push({ url, init: init as Call['init'] });
      return Promise.resolve({ ok: true, status: 200, json: async () => SNAPSHOT });
    } as unknown as FetchLike;
    const { container } = render(<ContainersPane runtime={{ ...productionRuntime(), fetchImpl }} /> as ReactElement);
    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr')).toHaveLength(30);
    });
    expect(injected).toHaveLength(1);
    expect(calls).toHaveLength(0);
    console.log(`  · 注入 fetchImpl：注入件 ${String(injected.length)} 次 / 全局 ${String(calls.length)} 次`);
  });
});
