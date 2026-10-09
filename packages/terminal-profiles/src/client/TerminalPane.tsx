/**
 * 终端面板组件（002 T4.1 / T4.2 / T4.3）
 *
 * 分工（**xterm 只在 chunk 里**，§P2）：本文件属于**主 bundle**，只做两件事：
 *   ① 视图**首次挂载时**经 `xterm-loader.ts`（唯一取用点）`await require.async("./client.terminal.js")` 取 chunk；
 *   ② 取到之后渲染 chunk 的 `TerminalBody`（fit / 节流 / dispose 都在那边 —— 因为真 xterm 只在那边的 bundle 里，
 *      主 bundle 连它的类都没有；这与官方把 `TerminalBody` 放在 chunk 里的做法一致）。
 *
 * 🔴 「挂载前零调用」是 T4.2 的可二值判据：`useEffect` 里才调 loader（模块顶层、渲染期都不碰）。
 * ⚠️ seat 传进来的 props 形状**未在 0.1.7 的 d.ts 里写死**（`sidebar.right.pane.tab` 的 keyed seat 只保证
 *    「有 key」）⇒ 实例 id 宽松读取：`instanceId` 优先，退到宿主常见的 `address`。真机项，见回报。
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { TERMINAL_TAB_TITLE } from './tab.ts';
import { loadXterm } from './xterm-loader.ts';
import type { XtermChunkLoader, XtermChunkModule } from './xterm-loader.ts';
import type { TerminalBodyProps } from './xterm-body.tsx';

export interface TerminalPaneProps extends TerminalBodyProps {
  /** 宿主 seat 的地址（tab 地址/实例 id；见文件头的宽松读取说明） */
  readonly address?: string | undefined;
  /** 注入点：单测传假 loader 以断言「挂载前零调用 / 失败文案」；生产用 `xterm-loader.ts` 的唯一取用点 */
  readonly loader?: XtermChunkLoader | undefined;
}

/** 把「给了的」回调逐个搬给 chunk（`exactOptionalPropertyTypes` 下不能直接摊开可选字段） */
function bodyProps(props: TerminalPaneProps, instanceId: string): TerminalBodyProps {
  return {
    instanceId,
    ...(props.onData === undefined ? {} : { onData: props.onData }),
    ...(props.onResize === undefined ? {} : { onResize: props.onResize }),
    ...(props.onReady === undefined ? {} : { onReady: props.onReady }),
  };
}

export function TerminalPane(props: TerminalPaneProps): ReactElement {
  const loader = props.loader ?? loadXterm;
  const instanceId = props.instanceId ?? props.address ?? '';
  const [chunk, setChunk] = useState<XtermChunkModule | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loader().then(
      (loaded) => {
        if (alive) setChunk(loaded);
      },
      (error: unknown) => {
        // 取块失败 = 宿主 ModuleLoader 没供给 chunk；显示原因，**不**抛（REQ-3.5 的同款口径）
        if (alive) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [loader]);

  if (failure !== null) {
    return (
      <div className="dtp-status dtp-status-error" data-testid="term-load-error">
        {`终端渲染器加载失败：${failure}`}
      </div>
    );
  }
  if (chunk === null) {
    return (
      <div className="dtp-status" data-testid="term-loading">
        正在加载终端渲染器…
      </div>
    );
  }
  const Body = chunk.TerminalBody;
  return (
    <div className="dtp-pane" data-instance-id={instanceId} data-testid="term-pane">
      <Body {...bodyProps(props, instanceId)} />
    </div>
  );
}

/** 标题 seat 的组件（`sidebar.right.pane.tab.title`；与 `definition.title` 共用同一常量） */
export function TerminalTitle(): ReactElement {
  return (
    <span className="dtp-title" data-testid="term-title">
      {TERMINAL_TAB_TITLE}
    </span>
  );
}
