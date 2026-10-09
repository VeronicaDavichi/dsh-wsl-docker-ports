/**
 * xterm 视图（fit / 节流 / 卸载）—— **可注入的纯逻辑层**（002 T4.3 / REQ-5.3）
 *
 * 为什么单独一层：`terminal-chunk.ts` 是唯一能拿到真 `@xterm/*` 的地方（它静态 import 真包 ⇒ 只进 chunk）。
 * 若把 fit/节流/卸载逻辑写在 chunk 里，单测就必须在 jsdom 里跑**真 xterm 的渲染时序**（尺寸、canvas、
 * ResizeObserver 全靠 jsdom 模拟）—— 那种断言脆得没有证据价值。故这里用**依赖注入**：真类由 chunk 注入，
 * 单测注入假类，于是「resize → fit 一次」「卸载 → dispose」是可二值判定的。
 *
 * 结构面口径：下面三个 `*Like` 接口只声明**本文件真正调用**的成员；它们与真 `@xterm/xterm`
 * / `@xterm/addon-fit` 的兼容性由 `tests/unit/client-xterm-body.test.ts` 的**编译期一致性用例**钉住
 * （不 import 运行时值 ⇒ 主 bundle 里零 xterm 痕迹）。
 */

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

/** 尺寸（与 `src/limits.ts` 的 `TerminalSize` 同形：`rows` 在前 —— 宿主 handle 是 `resize(cols, rows)`，别混） */
export interface TerminalSize {
  readonly rows: number;
  readonly cols: number;
}

/** 真 `@xterm/xterm` 的 `Terminal` 的结构子集 */
export interface XtermTerminalLike {
  readonly rows: number;
  readonly cols: number;
  open(container: HTMLElement): void;
  loadAddon(addon: unknown): void;
  onData(handler: (data: string) => void): { dispose(): void };
  dispose(): void;
}

/** 真 `@xterm/addon-fit` 的 `FitAddon` 的结构子集 */
export interface XtermFitAddonLike {
  fit(): void;
}

/** 真 `ResizeObserver` 的结构子集 */
export interface ResizeObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

/** 传给 `new Terminal(options)` 的选项子集（全部是真 `ITerminalOptions` 的字段） */
export interface XtermTerminalOptionsLike {
  readonly convertEol: boolean;
  readonly cursorBlink: boolean;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly scrollback: number;
}

export interface XtermBodyDeps {
  readonly createTerminal: (options: XtermTerminalOptionsLike) => XtermTerminalLike;
  readonly createFitAddon: () => XtermFitAddonLike;
  /** 缺省 = 真 `ResizeObserver`（不存在则**不观察**，只在挂载时 fit 一次；浏览器里必有） */
  readonly createResizeObserver?: ((callback: () => void) => ResizeObserverLike | undefined) | undefined;
  /** 挂载时注入样式（chunk 里 = 内联的 xterm.css）；缺省什么都不做 */
  readonly installStyles?: (() => void) | undefined;
  readonly throttleMs?: number | undefined;
  readonly options?: Partial<XtermTerminalOptionsLike> | undefined;
}

/** 节流窗口（T4.3：容器 resize 抖动不该把 PTY 打爆） */
export const TERMINAL_THROTTLE_MS = 100;

/** 面板级默认选项（只用宿主 token 之外的中性值；主题由 `--dsw-*` 走 CSS，不在这里写颜色） */
export const TERMINAL_DEFAULT_OPTIONS: XtermTerminalOptionsLike = {
  convertEol: false,
  cursorBlink: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12,
  scrollback: 1000,
};

export interface TerminalSurfaceHandle {
  /** 触发一次 fit 并返回**实际生效**的尺寸（`fit` 之后读 `terminal.rows/cols`） */
  fit(): TerminalSize;
  dispose(): void;
}

export interface TerminalBodyProps {
  readonly instanceId?: string | undefined;
  /** 键盘输入（→ PTY；走 WS 传输层，本 Phase 只暴露这个缝） */
  readonly onData?: ((data: string) => void) | undefined;
  /** 尺寸同步（→ PTY；首次挂载与容器 resize 后各触发一次） */
  readonly onResize?: ((size: TerminalSize) => void) | undefined;
  /** 拿到命令式句柄（传输层用 `fit()` 拿初始尺寸；本 Phase 只暴露这个缝） */
  readonly onReady?: ((handle: TerminalSurfaceHandle) => void) | undefined;
}

export interface TrailingThrottle {
  schedule(): void;
  cancel(): void;
}

/** 尾沿节流：窗口内的多次 `schedule()` 合并成**一次** `run()`（可取消 ⇒ 卸载时不留定时器） */
export function createTrailingThrottle(ms: number, run: () => void): TrailingThrottle {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule: () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, ms);
    },
    cancel: () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

function defaultResizeObserver(callback: () => void): ResizeObserverLike | undefined {
  if (typeof ResizeObserver === 'undefined') return undefined;
  return new ResizeObserver(() => {
    callback();
  });
}

/**
 * 造一个 xterm 视图组件（**只依赖注入进来的类**）。
 *
 * 生命周期（一次挂载 = 一次 `new Terminal`）：
 * 挂载 →（可选）注入样式 → `new Terminal` → `loadAddon(fit)` → `open(host)` → 订阅 `onData`
 *      → `ResizeObserver` 观察容器（**尾沿节流**）→ **首次 fit + onResize** → `onReady`
 * 卸载 → `disconnect` → 取消节流 → 退订 → `terminal.dispose()`（零残留监听/定时器，REQ-12.2）
 */
export function createTerminalBody(deps: XtermBodyDeps): (props: TerminalBodyProps) => ReactElement {
  const throttleMs = deps.throttleMs ?? TERMINAL_THROTTLE_MS;
  const createObserver = deps.createResizeObserver ?? defaultResizeObserver;

  return function TerminalBody(props: TerminalBodyProps): ReactElement {
    const hostRef = useRef<HTMLDivElement | null>(null);
    /** 回调走 ref 转发：父组件换新函数 identity **不**重挂终端（否则每次渲染都重建 PTY 视图） */
    const latest = useRef<TerminalBodyProps>(props);
    useEffect(() => {
      latest.current = props;
    }, [props]);

    useEffect(() => {
      const host = hostRef.current;
      if (host === null) return undefined;
      deps.installStyles?.();

      const terminal = deps.createTerminal({ ...TERMINAL_DEFAULT_OPTIONS, ...deps.options });
      const fitAddon = deps.createFitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(host);

      const fit = (): TerminalSize => {
        fitAddon.fit();
        return { rows: terminal.rows, cols: terminal.cols };
      };
      const subscription = terminal.onData((data: string) => {
        latest.current.onData?.(data);
      });
      const throttle = createTrailingThrottle(throttleMs, () => {
        latest.current.onResize?.(fit());
      });
      const observer = createObserver(() => {
        throttle.schedule();
      });
      observer?.observe(host);

      latest.current.onResize?.(fit());
      latest.current.onReady?.({
        fit,
        dispose: () => {
          terminal.dispose();
        },
      });

      return () => {
        observer?.disconnect();
        throttle.cancel();
        subscription.dispose();
        terminal.dispose();
      };
    }, [deps]);

    return <div className="dtp-surface" data-instance-id={props.instanceId ?? ''} data-testid="term-surface" ref={hostRef} />;
  };
}
