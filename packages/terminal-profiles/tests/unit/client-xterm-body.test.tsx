// @vitest-environment jsdom
/**
 * T4.3 xterm 视图生命周期（REQ-5.3 / REQ-12.2）—— jsdom + 假 xterm 三件套（真 xterm 只在 chunk 里）。
 *
 * 判据（每条都能被一处改动打红）：
 *   ① 挂载 = 恰好 1 次 `new Terminal` + `loadAddon` + `open(容器)`，容器就是渲染出来的那个 div；
 *   ② 挂载即 **fit 一次** 并把 `{rows, cols}` 报给 `onResize`（PTY 初始尺寸不能等 resize 才来）；
 *   ③ 容器 resize 走**尾沿节流**：窗口内多次触发只 fit 一次，且**不是**同步立即 fit；
 *   ④ 卸载：observer `disconnect`、退订 `onData`、`terminal.dispose()`，且**已排队的节流不再触发**；
 *   ⑤ 父组件换回调 identity **不**重建终端，新回调仍收到数据（ref 转发生效）；
 *   ⑥ 没有 `ResizeObserver` 时不抛，挂载仍 fit 一次；
 *   ⑦ 选项：`TERMINAL_DEFAULT_OPTIONS` 生效且被 `deps.options` 覆盖。
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TERMINAL_DEFAULT_OPTIONS,
  TERMINAL_THROTTLE_MS,
  createTerminalBody,
  createTrailingThrottle,
} from '../../src/client/xterm-body.tsx';
import type { TerminalSize } from '../../src/client/xterm-body.tsx';
import { createFakeXtermEnvironment } from '../helpers/client-fixtures.ts';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('T4.3 节流器（纯函数）', () => {
  it('窗口内多次 schedule 合并成一次 run；cancel 后不再 run', () => {
    const run = vi.fn();
    const throttle = createTrailingThrottle(TERMINAL_THROTTLE_MS, run);
    throttle.schedule();
    throttle.schedule();
    expect(run).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(TERMINAL_THROTTLE_MS);
    expect(run).toHaveBeenCalledTimes(1);

    throttle.schedule();
    throttle.cancel();
    vi.advanceTimersByTime(TERMINAL_THROTTLE_MS * 3);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('T4.3 视图生命周期（假 xterm）', () => {
  it('挂载：1 个终端 + fit addon 已加载 + open 到渲染出的容器 + 首次 onResize', () => {
    const environment = createFakeXtermEnvironment();
    const sizes: TerminalSize[] = [];
    const Body = createTerminalBody({ ...environment.deps, throttleMs: 50 });
    const view = render(<Body instanceId="inst-1" onResize={(size) => sizes.push(size)} />);

    expect(environment.terminals).toHaveLength(1);
    const terminal = environment.terminals[0];
    expect(terminal?.addons).toEqual(environment.fitAddons);
    expect(terminal?.openedContainers).toHaveLength(1);
    expect(terminal?.openedContainers[0]?.className).toBe('dtp-surface');
    expect(terminal?.openedContainers[0]).toBe(view.getByTestId('term-surface'));
    expect(environment.fitAddons[0]?.fitted).toBe(1);
    expect(sizes).toEqual([{ rows: 24, cols: 80 }]);
    expect(environment.observeCalls()).toBe(1);
    expect(environment.observers[0]?.targets[0]).toBe(view.getByTestId('term-surface'));
    expect(view.getByTestId('term-surface').dataset.instanceId).toBe('inst-1');
  });

  it('容器 resize：节流窗口内多次触发只 fit 一次，且窗口到点前不同步 fit', () => {
    const environment = createFakeXtermEnvironment();
    const sizes: TerminalSize[] = [];
    const Body = createTerminalBody({ ...environment.deps, throttleMs: 50 });
    render(<Body onResize={(size) => sizes.push(size)} />);
    environment.setNextSize(30, 100);

    act(() => {
      environment.triggerResize();
      environment.triggerResize();
      environment.triggerResize();
    });
    expect(environment.fitAddons[0]?.fitted).toBe(1);
    expect(sizes).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(environment.fitAddons[0]?.fitted).toBe(2);
    expect(sizes).toEqual([
      { rows: 24, cols: 80 },
      { rows: 30, cols: 100 },
    ]);
  });

  it('卸载：disconnect + 退订 onData + dispose，且排队的节流不再触发（REQ-12.2）', () => {
    const environment = createFakeXtermEnvironment();
    const sizes: TerminalSize[] = [];
    const Body = createTerminalBody({ ...environment.deps, throttleMs: 50 });
    const view = render(<Body onResize={(size) => sizes.push(size)} />);
    const terminal = environment.terminals[0];
    expect(terminal?.handlers).toHaveLength(1);

    act(() => {
      environment.triggerResize();
    });
    view.unmount();

    expect(environment.observers[0]?.disconnected).toBe(1);
    expect(terminal?.handlers).toHaveLength(0);
    expect(terminal?.disposed).toBe(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(sizes).toHaveLength(1);
    expect(environment.fitAddons[0]?.fitted).toBe(1);
  });

  it('onData 转发：终端数据交给当前回调', () => {
    const environment = createFakeXtermEnvironment();
    const received: string[] = [];
    const Body = createTerminalBody(environment.deps);
    render(<Body onData={(data) => received.push(data)} />);
    environment.terminals[0]?.emit('ls\r');
    expect(received).toEqual(['ls\r']);
  });

  it('换回调 identity 不重建终端，新回调仍收数据（ref 转发）', () => {
    const environment = createFakeXtermEnvironment();
    const first: string[] = [];
    const second: string[] = [];
    const Body = createTerminalBody(environment.deps);
    const view = render(<Body onData={(data) => first.push(data)} />);
    view.rerender(<Body onData={(data) => second.push(data)} />);

    expect(environment.terminals).toHaveLength(1);
    environment.terminals[0]?.emit('x');
    expect(first).toHaveLength(0);
    expect(second).toEqual(['x']);
  });

  it('没有 ResizeObserver：不抛、observer 为 0，挂载仍 fit 一次', () => {
    const environment = createFakeXtermEnvironment({ withResizeObserver: false });
    const sizes: TerminalSize[] = [];
    const Body = createTerminalBody({ ...environment.deps, throttleMs: 50 });
    expect(() => {
      render(<Body onResize={(size) => sizes.push(size)} />);
    }).not.toThrow();
    expect(environment.observers).toHaveLength(0);
    expect(environment.fitAddons[0]?.fitted).toBe(1);
    expect(sizes).toEqual([{ rows: 24, cols: 80 }]);
  });

  it('onReady 交出的句柄：fit() 返回实际生效尺寸，dispose() 关掉终端', () => {
    const environment = createFakeXtermEnvironment();
    const handles: Array<{ fit(): TerminalSize; dispose(): void }> = [];
    const Body = createTerminalBody({ ...environment.deps, throttleMs: 50 });
    render(<Body onReady={(handle) => handles.push(handle)} />);
    environment.setNextSize(40, 120);
    expect(handles[0]?.fit()).toEqual({ rows: 40, cols: 120 });
    handles[0]?.dispose();
    expect(environment.terminals[0]?.disposed).toBe(1);
  });

  it('选项：默认值生效且被 deps.options 覆盖', () => {
    const environment = createFakeXtermEnvironment();
    const Body = createTerminalBody({ ...environment.deps, options: { fontSize: 16, scrollback: 5000 } });
    render(<Body />);
    const options = environment.terminals[0]?.options;
    expect(options?.fontSize).toBe(16);
    expect(options?.scrollback).toBe(5000);
    expect(options?.cursorBlink).toBe(TERMINAL_DEFAULT_OPTIONS.cursorBlink);
    expect(options?.convertEol).toBe(TERMINAL_DEFAULT_OPTIONS.convertEol);
    expect(options?.fontFamily).toBe(TERMINAL_DEFAULT_OPTIONS.fontFamily);
  });

  it('deps.installStyles 在挂载时被调用一次（xterm.css 注入时机 = 视图挂载，不是模块顶层）', () => {
    const environment = createFakeXtermEnvironment();
    const installStyles = vi.fn();
    const Body = createTerminalBody({ ...environment.deps, installStyles });
    render(<Body />);
    expect(installStyles).toHaveBeenCalledTimes(1);
  });
});
