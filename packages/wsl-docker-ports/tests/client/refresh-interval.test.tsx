// @vitest-environment jsdom
/**
 * 014 自动刷新：**DOM + 假定时器**验收（A1–A5）
 *
 * A1 缺省关闭（零轮询）/ A2 选 15 秒 ⇒ 立即写配置 + 到点轮询 + 重挂载回填 /
 * A3 数据未变（只有 `refreshedAt` 变）⇒ **零重绘** / A4 卸载清定时器 / A5 轮询失败不清内容且继续重试。
 *
 * 🔴 A3 的「零重绘」用 React `Profiler` 的 `onRender` 计数证 —— 不是「看起来没变」。
 * 🔴 全部在假定时器下跑：不接受真实 `setInterval`（否则用例要等 15 秒，且无法证明清理）。
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function select(): HTMLSelectElement {
  return screen.getByTestId('sel-refresh-interval') as HTMLSelectElement;
}

describe('014 自动刷新频次', () => {
  it('A1 缺省「关闭」：不选档时 120 秒内零轮询、零配置写', async () => {
    const test = harness(snapshot());
    render(<PortsPane runtime={test.runtime} />);
    await flush();
    await flush();

    expect(select().value).toBe('0');
    expect(Array.from(select().options).map((option) => option.textContent)).toEqual(['关闭', '15 秒', '30 秒', '60 秒', '5 分钟']);

    const loads = test.recorded.loads.length;
    await advance(120_000);
    expect(test.recorded.loads.length).toBe(loads);
    expect(test.recorded.updates).toHaveLength(0);
    console.log(`  · A1 扫了 120s：轮询 ${String(test.recorded.loads.length - loads)} 次、配置写 ${String(test.recorded.updates.length)} 次（缺省关闭）`);
  });

  it('A2 选「15 秒」：立即写配置、到点轮询一次、刷新页面后回填', async () => {
    const test = harness(snapshot());
    const first = render(<PortsPane runtime={test.runtime} />);
    await flush();
    await flush();

    const before = test.recorded.loads.length;
    fireEvent.change(select(), { target: { value: '15' } });
    await flush();
    await flush();

    expect(select().value).toBe('15');
    expect(test.recorded.updates).toHaveLength(1);
    expect(test.recorded.updates[0]?.patch).toEqual({ refreshIntervalSec: 15 });
    expect(test.recorded.elevation).toHaveLength(0);

    await advance(15_000);
    expect(test.recorded.loads.length).toBe(before + 1);

    // 重挂载 = 刷新页面：读回服务端已落盘的 15，选择器不得丢档
    first.unmount();
    render(<PortsPane runtime={test.runtime} />);
    await flush();
    await flush();
    expect(select().value).toBe('15');
    console.log(`  · A2 扫了 1 次写 ${JSON.stringify(test.recorded.updates[0]?.patch)}、15s 后轮询 1 次、重挂载回填 15`);
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
    expect(select().value).toBe('15');

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
    expect(select().value).toBe('15');

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
    expect(select().value).toBe('15');

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
