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

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { ContainersPane, CID } from '../../src/client/containers/pane.tsx';
import type { ContainersRuntime } from '../../src/client/containers/runtime.ts';
import type { SettingsPipe } from '../../src/client/settings-pipe.ts';
import type { FetchLike } from '../../src/client/host.ts';

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
    // 017：页头的「目标发行版：…」文字已删（发行版改在组合包级配置页里选）
    expect(container.textContent ?? '').not.toContain('目标发行版：');
    expect(screen.queryByTestId('txt-containers-distro')).toBeNull();
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

/* ───────────────────────── D2：容器页自己的刷新间隔（2026-10-23 真机） ───────────────────────── */

interface SettingsWrite {
  readonly sec: number;
}

function recordingSettings(initial: number | undefined, writes: SettingsWrite[]): SettingsPipe {
  return {
    readConfig: async () => ({ refreshIntervalSec: initial }),
    writeRefreshInterval: async (sec: number) => {
      writes.push({ sec });
      return { ok: true, message: 'ok', patch: { refreshIntervalSec: sec }, revisionPassed: false };
    },
  } as unknown as SettingsPipe;
}

/** 让挂载期的 `load()` / `readConfig()` / setState 全部落地（假定时器下不能等真实时钟） */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * 017：页头上的刷新下拉**已删除**（搬到组合包级配置页 `plugins.bundle.config`，键 = 组合包包名）。
 * 页面只剩「刷新」按钮；自动刷新仍按配置里的值工作。判据改为「页头零控件 + 零配置写」。
 */
describe('D2 容器页刷新间隔（017 后：页头无控件，只按配置值轮询）', () => {
  let probeCalls = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    probeCalls = 0;
    // 容器页缺省回落全局 fetch：这里用「按次数给载荷」的替身，既能数请求也能制造数据变化
    globalThis.fetch = (async () => {
      probeCalls += 1;
      return { ok: true, status: 200, json: async () => SNAPSHOT };
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('D2-1 默认「关闭」：页头零刷新控件（两个 testid 都不在）、120 秒零轮询、零配置写', async () => {
    const writes: SettingsWrite[] = [];
    const runtime: ContainersRuntime = { ...productionRuntime(), settings: () => recordingSettings(0, writes) };
    render(<ContainersPane runtime={runtime} /> as ReactElement);
    await flush();
    await flush();

    expect(screen.queryByTestId('sel-containers-refresh-interval')).toBeNull();
    expect(screen.queryByTestId('sel-refresh-interval')).toBeNull();
    expect(probeCalls).toBe(1);

    await advance(120_000);
    expect(probeCalls).toBe(1);
    expect(writes).toHaveLength(0);
    console.log(`  · D2-1 扫了 120s：轮询 ${String(probeCalls - 1)} 次、配置写 ${String(writes.length)} 次`);
  });

  it('D2-2 配置「15 秒」：到点轮询（页头不再回填控件）', async () => {
    const writes: SettingsWrite[] = [];
    const runtime: ContainersRuntime = { ...productionRuntime(), settings: () => recordingSettings(15, writes) };
    render(<ContainersPane runtime={runtime} /> as ReactElement);
    await flush();
    await flush();

    expect(screen.queryByTestId('sel-containers-refresh-interval')).toBeNull();
    expect(probeCalls).toBe(1);

    await advance(15_000);
    expect(probeCalls).toBe(2);
    await advance(15_000);
    expect(probeCalls).toBe(3);
    console.log(`  · D2-2 扫了 30s：15s 档轮询到 ${String(probeCalls - 1)} 次`);
  });

  it('D2-3 数据未变（只有 generatedAt 变）⇒ 零重绘；数据真变 ⇒ 重绘', async () => {
    let version = 0;
    globalThis.fetch = (async () => {
      version += 1;
      probeCalls += 1;
      const containers = version >= 3 ? CONTAINERS.map((row, index) => (index === 0 ? { ...row, state: 'exited' } : row)) : CONTAINERS;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, snapshot: { ...SNAPSHOT.snapshot, generatedAt: `2026-10-23T00:00:0${String(version)}.000Z`, containers } }),
      };
    }) as unknown as typeof globalThis.fetch;

    let renders = 0;
    const runtime: ContainersRuntime = { ...productionRuntime(), settings: () => recordingSettings(15, []) };
    render(
      <Profiler
        id="containers"
        onRender={() => {
          renders += 1;
        }}
      >
        <ContainersPane runtime={runtime} />
      </Profiler> as ReactElement,
    );
    await flush();
    await flush();

    const loads = probeCalls;
    renders = 0;
    await advance(15_000);
    expect(probeCalls).toBe(loads + 1);
    expect(renders).toBe(0);

    // 反向对照：数据真变了必须重绘（否则「0 次」可能只是定时器没跑）
    await advance(15_000);
    expect(probeCalls).toBe(loads + 2);
    expect(renders).toBeGreaterThan(0);
    console.log(`  · D2-3 扫了 2 个周期：仅时间戳变 ⇒ 重绘 0 次；容器状态真变 ⇒ 重绘 ${String(renders)} 次`);
  });

  it('D2-4 卸载后清定时器：不再轮询', async () => {
    const runtime: ContainersRuntime = { ...productionRuntime(), settings: () => recordingSettings(15, []) };
    const view = render(<ContainersPane runtime={runtime} /> as ReactElement);
    await flush();
    await flush();

    await advance(15_000);
    expect(probeCalls).toBe(2);

    view.unmount();
    const afterUnmount = probeCalls;
    await advance(60_000);
    expect(probeCalls).toBe(afterUnmount);
    console.log(`  · D2-4 卸载后 60s 新增轮询 ${String(probeCalls - afterUnmount)} 次`);
  });

  it('D2-5 页头没有可写入口：点不到任何刷新档 ⇒ 零配置写（真正的写入口在配置页）', async () => {
    const writes: SettingsWrite[] = [];
    const runtime: ContainersRuntime = { ...productionRuntime(), settings: () => recordingSettings(0, writes) };
    render(<ContainersPane runtime={runtime} /> as ReactElement);
    await flush();
    await flush();

    // 主人 2026-10-28：「回到侧边栏这边，这个css和插件配置内页保持一致」⇒ 按钮用配置页同一套类名
  expect((screen.getByTestId(CID.refresh) as HTMLButtonElement).className).toBe('wdp-cfg-btn');
  fireEvent.click(screen.getByTestId(CID.refresh));
    await flush();
    await flush();

    expect(writes).toHaveLength(0);
    expect(probeCalls).toBe(2);
    console.log(`  · D2-5 点「刷新」后：配置写 ${String(writes.length)} 次、请求 ${String(probeCalls)} 次`);
  });
});
/* ─────────────────── 六订·三十一：页头「上次刷新 HH:mm:ss」（2026-10-28 主人） ───────────────────
 * 主人原话：「先在刷新的右边容器通道凭据的左边插入上次刷新时间」。
 * 判据三条（都可二值判定）：
 *   ① 页头同一行里三件套的**顺序** = 刷新 → 上次刷新 → 容器通道凭据，且没成功前写 `上次刷新 —`；
 *   ② 首屏取数成功 ⇒ 变成 `上次刷新 HH:mm:ss`（本地时间，逐字符比对）；
 *   ③ 手动点「刷新」⇒ 时间跟着走；**轮询到同一份数据 ⇒ 时间不动**（保住 D2-3 的零重绘）。
 */
describe('六订·三十一 / 三十二 页头「上次刷新：YYYY-MM-DD HH:mm:ss」', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 固定本地时间 09:07:05 ⇒ 断言可以写死字面量（不看运行机时区/系统时钟）
    vi.setSystemTime(new Date(2026, 9, 28, 9, 7, 5));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('① 顺序 = 刷新 → 上次刷新 → 容器通道凭据；还没成功刷新时写 `上次刷新 —`', async () => {
    // 取数永不 resolve ⇒ 停在「还没成功过」那一刻
    globalThis.fetch = (() => new Promise(() => undefined)) as unknown as typeof globalThis.fetch;
    const { container } = render(<ContainersPane runtime={productionRuntime()} /> as ReactElement);
    await flush();

    const toolbar = container.querySelector('.wdp-toolbar');
    expect(toolbar).not.toBeNull();
    const parts = [...(toolbar?.children ?? [])].map((node) => (node.textContent ?? '').trim());
    expect(parts).toEqual(['刷新', '上次刷新：—', '容器通道凭据：未保存']);
    console.log(`  · ① 页头三件套顺序：${parts.join(' → ')}`);
  });

  it('② 首屏取数成功 ⇒ 显示 `上次刷新：2026-10-28 09:07:05`（本地日期 + 时间、全角冒号）', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => SNAPSHOT })) as unknown as typeof globalThis.fetch;
    render(<ContainersPane runtime={productionRuntime()} /> as ReactElement);
    await flush();
    await flush();

    const stamp = screen.getByTestId(CID.refreshedAt);
    expect(stamp.textContent).toBe('上次刷新：2026-10-28 09:07:05');
    console.log(`  · ② 首屏成功后：${String(stamp.textContent)}`);
  });

  it('③ 手动刷新 ⇒ 时间走到当前时刻；轮询同一份数据 ⇒ 时间**不动**（D2 零重绘不破）', async () => {
    let version = 0;
    globalThis.fetch = (async () => {
      version += 1;
      return { ok: true, status: 200, json: async () => SNAPSHOT };
    }) as unknown as typeof globalThis.fetch;

    const runtime: ContainersRuntime = { ...productionRuntime(), settings: () => recordingSettings(15, []) };
    render(<ContainersPane runtime={runtime} /> as ReactElement);
    await flush();
    await flush();
    expect(screen.getByTestId(CID.refreshedAt).textContent).toBe('上次刷新：2026-10-28 09:07:05');

    // 轮询到同一份数据（载荷逐字节相同）：时间原地不动
    vi.setSystemTime(new Date(2026, 9, 28, 9, 7, 20));
    await advance(15_000);
    expect(screen.getByTestId(CID.refreshedAt).textContent).toBe('上次刷新：2026-10-28 09:07:05');

    // 手动刷新：即便载荷没变，也盖上新时刻（这次刷新本来就重绘）
    vi.setSystemTime(new Date(2026, 9, 28, 9, 8, 42));
    fireEvent.click(screen.getByTestId(CID.refresh));
    await flush();
    await flush();
    expect(screen.getByTestId(CID.refreshedAt).textContent).toBe('上次刷新：2026-10-28 09:08:42');
    console.log(
      `  · ③ 轮询(未变)后仍是 09:07:05、手动刷新后 ${String(screen.getByTestId(CID.refreshedAt).textContent)}、请求 ${String(version)} 次`,
    );
  });
});
