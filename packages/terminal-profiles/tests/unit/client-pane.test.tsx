// @vitest-environment jsdom
/**
 * T4.1/T4.2 终端面板组件（REQ-4.3 / REQ-5.1）—— jsdom + React + **假 loader**（真 xterm 不参与）。
 *
 * 判据：
 *   ① **挂载前零取块**：模块顶层就调 `loadXterm` 会让「懒加载」失效，这里用计数 loader 钉住
 *      「只有 `useEffect` 里调，且恰好一次」；
 *   ② 取块未完成 ⇒ 显示加载占位；完成 ⇒ 渲染 chunk 的 `TerminalBody` 且把 seat props 转发下去；
 *   ③ 取块失败 ⇒ 显示原因（含错误信息）且**不抛**（`require.async` 失败不能让右栏崩）；
 *   ④ loader identity 不变时不重复取块（重渲染/换回调不重挂终端）；
 *   ⑤ 标题 seat 用与 `definition.title` 同一常量。
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { TerminalPane, TerminalTitle } from '../../src/client/TerminalPane.tsx';
import { TERMINAL_TAB_TITLE } from '../../src/client/tab.ts';
import type { XtermChunkLoader, XtermChunkModule } from '../../src/client/xterm-loader.ts';
import type { TerminalBodyProps } from '../../src/client/xterm-body.tsx';

afterEach(() => {
  cleanup();
});

/** 假 chunk 模块：把收到的 props 记下来（断言转发） */
function createFakeChunk(): { module: XtermChunkModule; props: TerminalBodyProps[]; styleCalls: number } {
  const record = { props: [] as TerminalBodyProps[], styleCalls: 0 };
  const module: XtermChunkModule = {
    TerminalBody: (props: TerminalBodyProps): ReactElement => {
      record.props.push(props);
      return <div data-testid="chunk-body">{props.instanceId ?? ''}</div>;
    },
    installXtermStyles: () => {
      record.styleCalls += 1;
      return { dispose: () => undefined };
    },
  };
  return { module, get props() {
    return record.props;
  }, get styleCalls() {
    return record.styleCalls;
  } };
}

function deferred(): { promise: Promise<XtermChunkModule>; resolve: (value: XtermChunkModule) => void } {
  let resolve!: (value: XtermChunkModule) => void;
  const promise = new Promise<XtermChunkModule>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('T4.1 TerminalPane：懒加载 chunk', () => {
  it('挂载才取块，且恰好一次；取块前显示占位', async () => {
    const pending = deferred();
    const loader = vi.fn(() => pending.promise) as unknown as XtermChunkLoader;
    const view = render(<TerminalPane loader={loader} />);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('term-loading')).toBeTruthy();
    expect(view.queryByTestId('term-pane')).toBeNull();

    const chunk = createFakeChunk();
    await act(async () => {
      pending.resolve(chunk.module);
    });
    expect(view.queryByTestId('term-loading')).toBeNull();
    expect(view.getByTestId('term-pane')).toBeTruthy();
    expect(view.getByTestId('chunk-body')).toBeTruthy();
  });

  it('把 seat props 转发给 chunk 的 TerminalBody（instanceId 优先，退到 address）', async () => {
    const chunk = createFakeChunk();
    const loader = (() => Promise.resolve(chunk.module)) as unknown as XtermChunkLoader;
    const onData = vi.fn();
    const view = render(<TerminalPane loader={loader} address="term-7" onData={onData} />);
    await act(async () => undefined);
    expect(chunk.props).toHaveLength(1);
    expect(chunk.props[0]?.instanceId).toBe('term-7');
    expect(chunk.props[0]?.onData).toBe(onData);
    expect(view.getByTestId('term-pane').dataset.instanceId).toBe('term-7');

    view.rerender(<TerminalPane loader={loader} instanceId="explicit" address="term-7" onData={onData} />);
    await act(async () => undefined);
    expect(chunk.props.at(-1)?.instanceId).toBe('explicit');
  });

  it('取块失败 ⇒ 显示原因且不抛（宿主没供给 chunk 时右栏不崩）', async () => {
    const loader = (() => Promise.reject(new Error('missing supplier: ./client.terminal.js'))) as unknown as XtermChunkLoader;
    const view = render(<TerminalPane loader={loader} />);
    await act(async () => undefined);
    const error = view.getByTestId('term-load-error');
    expect(error.textContent).toContain('missing supplier');
    expect(view.queryByTestId('term-pane')).toBeNull();
  });

  it('loader identity 不变 ⇒ 重渲染不重复取块', async () => {
    const chunk = createFakeChunk();
    const loader = vi.fn(() => Promise.resolve(chunk.module)) as unknown as XtermChunkLoader;
    const view = render(<TerminalPane loader={loader} />);
    await act(async () => undefined);
    view.rerender(<TerminalPane loader={loader} />);
    await act(async () => undefined);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('T4.1 标题 seat', () => {
  it('用与 definition.title 同一常量（两处文案不漂移）', () => {
    const view = render(<TerminalTitle />);
    expect(view.getByTestId('term-title').textContent).toBe(TERMINAL_TAB_TITLE);
  });
});
