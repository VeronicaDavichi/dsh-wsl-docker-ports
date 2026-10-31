// @vitest-environment jsdom
/**
 * **容器页的页头与表格版式**（017 六订·三十一 ~ 三十四；2026-10-28 从 `containers-pane.test.tsx` 拆出）
 *
 * 拆出原因：`containers-pane.test.tsx` 自身已到 **412 行** ⇒ 撞 `check-size` 的
 * 「单文件 ≤ 400 行」SHALL 判据（NFR-5）。这里只放**版式类**判据（页头三件套 + 列宽），
 * 取数 / 动作 / D2 轮询仍留在原文件 —— 两边各自的夹具自足，不互相 import 测试代码。
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { ContainersPane, CID, splitImageAtSeparators } from '../../src/client/containers/pane.tsx';
import { CONFIG_CSS } from '../../src/client/containers/config-css.ts';
import type { ContainersRuntime } from '../../src/client/containers/runtime.ts';
import type { SettingsPipe } from '../../src/client/settings-pipe.ts';

const CONTAINERS = [
  { id: 'cid-0', name: 'svc-0', image: 'nginx:1.27', state: 'running', status: 'Up 2 hours', ports: ['8000->80/tcp'] },
  { id: 'cid-1', name: 'svc-1', image: 'redis:6-alpine', state: 'running', status: 'Up 46 hours', ports: ['6379->6379/tcp'] },
];

const SNAPSHOT = {
  ok: true,
  snapshot: {
    generatedAt: '2026-10-28T00:00:00.000Z',
    distro: { name: 'Ubuntu2204', state: 'Running', source: 'config', staleConfig: false, message: null },
    distroError: null,
    containers: CONTAINERS,
    error: null,
    notes: [],
  },
};

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

/** 容器侧配置：默认「关闭」（0）⇒ 不排定时器 */
function quietSettings(sec = 0): SettingsPipe {
  return {
    readConfig: async () => ({ refreshIntervalSec: sec }),
    read: async () => ({ refreshIntervalSec: sec }),
    update: async () => undefined,
  } as unknown as SettingsPipe;
}

/** **生产形状**的 runtime：主包 `apply(ctx)` 无 options ⇒ 故意不给 `fetchImpl`（回落全局 fetch） */
function productionRuntime(sec = 0): ContainersRuntime {
  return { baseUrl: '', token: () => undefined, saveToken: () => undefined, settings: () => quietSettings(sec) };
}

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

/* ─────────────── 六订·三十一 / 三十二：页头「上次刷新：YYYY-MM-DD HH:mm:ss」 ───────────────
 * 主人原话：「先在刷新的右边容器通道凭据的左边插入上次刷新时间」→「上次刷新：2026-10-28 14:12:56 这个格式表现」。
 * 判据三条：① 顺序 + 未成功占位；② 首屏成功后的逐字符格式；③ 手动刷新前进、轮询同数据不动（D2 零重绘不破）。
 */
describe('六订·三十一 / 三十二 页头「上次刷新：YYYY-MM-DD HH:mm:ss」', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 固定本地时间 09:07:05 ⇒ 断言可以写死字面量（不看运行机时区/系统时钟）
    vi.setSystemTime(new Date(2026, 9, 28, 9, 7, 5));
  });

  it('① 顺序 = 刷新 → 上次刷新 → 本机凭据 → 服务端布尔；还没成功刷新时写 `上次刷新：—`', async () => {
    // 取数永不 resolve ⇒ 停在「还没成功过」那一刻
    globalThis.fetch = (() => new Promise(() => undefined)) as unknown as typeof globalThis.fetch;
    const { container } = render(<ContainersPane runtime={productionRuntime()} /> as ReactElement);
    await flush();

    const toolbar = container.querySelector('.wdp-toolbar');
    expect(toolbar).not.toBeNull();
    const parts = [...(toolbar?.children ?? [])].map((node) => (node.textContent ?? '').trim());
    // 019 D4：多一格「服务端：…」布尔态（值本体不进 UI）
    expect(parts).toEqual(['刷新', '上次刷新：—', '容器通道凭据：未保存', '服务端：未配置（写入口一律 401）']);
    console.log(`  · ① 页头四件套顺序：${parts.join(' → ')}`);
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

    render(<ContainersPane runtime={productionRuntime(15)} /> as ReactElement);
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
    console.log(`  · ③ 轮询(未变)后仍是 09:07:05、手动刷新后 ${String(screen.getByTestId(CID.refreshedAt).textContent)}、请求 ${String(version)} 次`);
  });
});

/* ─────────────── 六订·三十三 / 三十四：列宽（名称 -20% / 镜像 -30%，连做两轮 + 动作列连带修） ───────────────
 * 主人原话：「将名称栏宽度缩小20%，镜像栏宽度缩小30%」→「进一步将名称栏宽度缩小20%，镜像栏宽度缩小30%」。
 * 连做两轮，每轮都在**上一轮量到的整数**上再缩（可追溯）：
 *   名称 171 →(×0.8) 137 →(×0.8) **110**；镜像 189 →(×0.7) 132 →(×0.7) **92**。
 * 动作列 42 → **64**：收进一屏后暴露出「42 px 时两个汉字被挤成两行」（真机 texts rects = 2）⇒ 连带修。
 */
describe('六订·三十三 / 三十四 容器表列宽', () => {
  it('① colgroup 五列显式宽度 = [110,92,58,85,64]，可回溯到真机基线，且合计装得进侧栏 412 px', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => SNAPSHOT })) as unknown as typeof globalThis.fetch;
    render(<ContainersPane runtime={productionRuntime()} /> as ReactElement);

    // 本 describe 用真实定时器（flush 只在假定时器下可用）
    const table = await screen.findByTestId(CID.table);
    const cols = [...table.querySelectorAll('colgroup > col')] as HTMLElement[];
    expect(cols).toHaveLength(5);
    const widths = cols.map((col) => col.style.width);

    // 两轮取整链：不写死「一串魔数」
    expect(Math.round(171 * 0.8)).toBe(137);
    expect(Math.round(189 * 0.7)).toBe(132);
    expect(Math.round(137 * 0.8)).toBe(110);
    expect(Math.round(132 * 0.7)).toBe(92);
    expect(widths).toEqual(['110px', '92px', '58px', '85px', '64px']);
    expect(table.style.tableLayout).toBe('fixed');

    // 合计必须收进侧栏内容宽（真机 412 px），否则「动作」列又要横向滚
    expect(110 + 92 + 58 + 85 + 64).toBeLessThanOrEqual(412);
    console.log(`  · ① 列宽：${widths.join(' / ')}（table-layout=${table.style.tableLayout}，合计 ${String(110 + 92 + 58 + 85 + 64)} px）`);
  });
});

/* ─────────────── 六订·三十五：镜像列在 `/` 与 `:` 处换行（主人 2026-10-28） ───────────────
 * 主人原话：「镜像这里转行有点问题，如果太长了应当在/或者:处转行」（截图：`semitechnologies/weaviate:1.27.0`
 * 从中间断开、越界压到状态列）。
 * 判据：① 拆段函数在 `/` `:` 之后切且拼回**逐字符一致**；② 镜像格渲染出 `<wbr>` 且文字零丢失；
 *       ③ 单元格带 `wdp-cell-image` 类（`overflow-wrap: anywhere` 兜底，长段不溢出）。
 */
describe('六订·三十五 镜像列按 / 与 : 换行', () => {
  it('① splitImageAtSeparators：在 / 与 : 之后切，拼回与原串完全一致', () => {
    expect(splitImageAtSeparators('semitechnologies/weaviate:1.27.0')).toEqual([
      'semitechnologies/',
      'weaviate:',
      '1.27.0',
    ]);
    expect(splitImageAtSeparators('redis:6-alpine')).toEqual(['redis:', '6-alpine']);
    expect(splitImageAtSeparators('nginx')).toEqual(['nginx']);
    // 不留空段、尾部无分隔符时原样收尾
    expect(splitImageAtSeparators('a/b/c')).toEqual(['a/', 'b/', 'c']);
    const joined = splitImageAtSeparators('registry.local:5000/ns/app:1.0').join('');
    expect(joined).toBe('registry.local:5000/ns/app:1.0');
    console.log(`  · ① 拆段：${JSON.stringify(splitImageAtSeparators('semitechnologies/weaviate:1.27.0'))}`);
  });

  it('② 镜像格渲染 <wbr> 且文字零丢失；单元格带 wdp-cell-image', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => SNAPSHOT })) as unknown as typeof globalThis.fetch;
    render(<ContainersPane runtime={productionRuntime()} /> as ReactElement);
    const table = await screen.findByTestId(CID.table);

    const cell = table.querySelector('tbody tr td:nth-child(2)') as HTMLTableCellElement;
    expect(cell.className).toBe('wdp-cell-image');
    // 夹具首行镜像 = nginx:1.27 ⇒ 恰好在 ':' 后插一个 <wbr>
    expect(cell.querySelectorAll('wbr')).toHaveLength(1);
    expect(cell.textContent).toBe('nginx:1.27');
    console.log(`  · ② 镜像格：textContent=${String(cell.textContent)}、wbr=${String(cell.querySelectorAll('wbr').length)} 个`);
  });
});

/* ─────────────── 六订·三十六：动作格回归 table-cell（边框歪）+ 镜像断词降为最低优先级 ───────────────
 * 主人（截图）：「semitechnologies这种直接断掉词语本身，作为最低优先级使用。此外这边有几个超长单元格的
 * 动作一栏的边框歪了」。
 * 根因：`.wdp-actions { display: flex }` 原本**挂在 `<td>` 上** ⇒ 该 td 不再是 table-cell，
 * 高度只剩内容高（真机 65 px vs 行 81 px），行底边框在这一列错位。
 */
describe('六订·三十六 动作格是 table-cell；镜像断词为最低优先级', () => {
  it('① 动作格 = 普通 td（无 wdp-actions 类）> div.wdp-actions，且节点数不变', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => SNAPSHOT })) as unknown as typeof globalThis.fetch;
    render(<ContainersPane runtime={productionRuntime()} /> as ReactElement);
    const table = await screen.findByTestId(CID.table);

    const cell = table.querySelector('tbody tr td:nth-child(5)') as HTMLTableCellElement;
    // 🔴 这一条就是「边框歪」的回归判据：td 上不许挂 display:flex 的类
    expect(cell.className).toBe('');
    expect(getComputedStyle(cell).display).toBe('table-cell');
    const wrapper = cell.querySelector('div.wdp-actions');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelectorAll('button')).toHaveLength(4);
    console.log(`  · ① 动作格 display=${getComputedStyle(cell).display}、按钮 ${String(wrapper?.querySelectorAll('button').length)} 个`);
  });

  it('② 镜像格的断词是 break-word（只在无处可断时才断词 = 最低优先级）', () => {
    // 样式在 chunk 侧的 config-css 里；这里直接断言常量文本，避免 jsdom 未注入样式表时假绿
    expect(CONFIG_CSS).toContain('.wdp-table td.wdp-cell-image { overflow-wrap: break-word; }');
    // 只针对镜像格这一条规则断言「不是 anywhere」——.wdp-cfg-hint / .wdp-cfg-notice 本就用 anywhere，别误伤
    expect(CONFIG_CSS).not.toContain('.wdp-table td.wdp-cell-image { overflow-wrap: anywhere; }');
    console.log('  · ② 镜像格 overflow-wrap = break-word ✓');
  });
});
