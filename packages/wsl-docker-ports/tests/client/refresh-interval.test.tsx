// @vitest-environment jsdom
/**
 * 014 自动刷新：**DOM + 假定时器**验收（A1–A5）
 *
 * 🔴 017（2026-10-27 主人拍板）：页头上的**频次下拉已删除** —— 它搬到组合包级配置页
 * （`plugins.bundle.config`，卡片页「描述与组件行之间」）。本文件因此改成「页头零控件 +
 * 自动刷新仍按配置值工作」的判据：A1/A2 断言控件不在、A2 用配置种子（`initialInterval`）
 * 代替「点选下拉」。轮询/重绘/清理三组判据（A3–A5）逻辑不变。
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PortsPane } from '../../src/client/pane.tsx';
import { FIXED_TIMESTAMP, snapshot } from '../unit/client-fixtures.ts';
import { harness } from './pane-harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** 排空微任务 + 0ms 定时器（挂载读、写配置、setState 都靠它落地） */
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

describe('014/017 自动刷新频次（页头无控件）', () => {
  it('A1 缺省「关闭」：页头没有频次下拉，120 秒内零轮询、零配置写', async () => {
    const test = harness(snapshot());
    render(<PortsPane runtime={test.runtime} />);
    await flush();
    await flush();

    // 017：频次下拉已从这里删除（搬到 bundle 级配置页）⇒ 页头不得再出现它
    expect(screen.queryByTestId('sel-refresh-interval')).toBeNull();

    const loads = test.recorded.loads.length;
    await advance(120_000);
    expect(test.recorded.loads.length).toBe(loads);
    expect(test.recorded.updates).toHaveLength(0);
    console.log(`  · A1 扫了 120s：轮询 ${String(test.recorded.loads.length - loads)} 次、配置写 ${String(test.recorded.updates.length)} 次（缺省关闭，页头零控件）`);
  });

  it('A2 配置「15 秒」：到点轮询一次；页头不改配置、重挂载仍按配置值跑', async () => {
    const test = harness(snapshot(), { initialInterval: 15 });
    const first = render(<PortsPane runtime={test.runtime} />);
    await flush();
    await flush();

    expect(screen.queryByTestId('sel-refresh-interval')).toBeNull();
    const before = test.recorded.loads.length;

    await advance(15_000);
    expect(test.recorded.loads.length).toBe(before + 1);
    // 017：页头不再写配置（写入口只剩配置页）
    expect(test.recorded.updates).toHaveLength(0);
    expect(test.recorded.elevation).toHaveLength(0);

    // 重挂载 = 刷新页面：仍从配置读 15，按同一频次继续跑
    first.unmount();
    const second = render(<PortsPane runtime={test.runtime} />);
    await flush();
    await flush();
    const afterRemount = test.recorded.loads.length;
    await advance(15_000);
    expect(test.recorded.loads.length).toBe(afterRemount + 1);
    second.unmount();
    console.log(`  · A2 15s 档轮询 1 次、配置写 ${String(test.recorded.updates.length)} 次、重挂载后继续按 15s 跑`);
  });

  it('A3 数据未变（只有 refreshedAt 变）⇒ 定时器到点但零重绘', async () => {
    const test = harness(snapshot(), { initialInterval: 15 });
    let renders = 0;
    render(
      <Profiler
        id="ports"
        onRender={() => {
          renders += 1;
        }}
      >
        <PortsPane runtime={test.runtime} />
      </Profiler>,
    );
    await flush();
    await flush();

    const loads = test.recorded.loads.length;
    renders = 0;
    test.push(snapshot({ refreshedAt: FIXED_TIMESTAMP + 60_000 }));
    await advance(15_000);

    expect(test.recorded.loads.length).toBe(loads + 1);
    expect(renders).toBe(0);
    const noChangeRenders = renders;

    // 反向对照：数据真变了必须重绘（否则「0 次」可能是定时器根本没跑）
    test.push(snapshot({ managedPortsDecl: ['3306'], refreshedAt: FIXED_TIMESTAMP + 120_000 }));
    await advance(15_000);
    expect(renders).toBeGreaterThan(0);
    expect(screen.getByTestId('tbl-ports')).toBeTruthy();
    console.log(`  · A3 扫了 2 个周期：仅时间戳变 ⇒ 重绘 ${String(noChangeRenders)} 次；数据真变 ⇒ 重绘 ${String(renders)} 次`);
  });

  it('A4 卸载后清定时器：不再轮询', async () => {
    const test = harness(snapshot(), { initialInterval: 15 });
    const view = render(<PortsPane runtime={test.runtime} />);
    await flush();
    await flush();

    const before = test.recorded.loads.length;
    await advance(15_000);
    expect(test.recorded.loads.length).toBe(before + 1);

    view.unmount();
    const afterUnmount = test.recorded.loads.length;
    await advance(60_000);
    expect(test.recorded.loads.length).toBe(afterUnmount);
    console.log(`  · A4 扫了卸载前后各 1 个窗口：卸载后 60s 新增轮询 ${String(test.recorded.loads.length - afterUnmount)} 次`);
  });

  it('A5 轮询失败：显示既有错误、不清空内容、继续按频次重试', async () => {
    const test = harness(snapshot(), { initialInterval: 15, failAfterLoads: 1 });
    render(<PortsPane runtime={test.runtime} />);
    await flush();
    await flush();

    expect(screen.queryByTestId('load-error')).toBeNull();
    await advance(15_000);
    expect(screen.getByTestId('load-error').textContent).toContain('读取失败');
    expect(screen.getByTestId('tbl-ports')).toBeTruthy();

    const loads = test.recorded.loads.length;
    await advance(15_000);
    expect(test.recorded.loads.length).toBe(loads + 1);
    expect(screen.getByTestId('load-error')).toBeTruthy();
    expect(screen.getByTestId('tbl-ports')).toBeTruthy();
    console.log(`  · A5 扫了 2 次失败轮询：错误可见、表格仍在、重试 ${String(test.recorded.loads.length - loads)} 次`);
  });
});
