/**
 * 本包的**全部数值上限与命名常量**（002 REQ-6.4「命名常量上限」/ REQ-5.3 尺寸夹紧 / 任务 T2.1–T2.4）
 *
 * 为什么单独一个文件：REQ-6.4 明写增量缓冲的上限**必须是命名常量**（否则 UI 与日志里的 `dropped`
 * 就没有可追溯的口径），而尺寸夹紧（T2.2 的「自实现夹紧」）与快照尾部长度也需要各自的界。把界
 * 集中在一处，测试就能**引用常量而不是抄数字** —— 抄数字的测试会在调参时静默失去意义。
 *
 * ⚠️ 这里的所有界都是**本包自定的实现选择**，宿主不给任何默认：design §11 的 `resize` 事实写着
 * 「宿主 `resize(cols, rows)` **列在前且不夹紧**」⇒ 界必须由本包给，且错一处就是越界写进 ConPTY。
 */

/** 终端尺寸（**行/列各一个字段**：宿主与 xterm 的 resize 都是位置参数，用对象消灭转置的可能） */
export interface TerminalSize {
  readonly rows: number;
  readonly cols: number;
}

/** 缺省尺寸（profile 没给、也没有 UI fit 结果时用；与 xterm 的 80×24 惯例一致） */
export const DEFAULT_ROWS = 24;
export const DEFAULT_COLS = 80;

/** 缺省 TERM 值。与宿主一致：`spawnTerminal` 会用 `terminalType` 同时填 node-pty 的 `name` 与 `TERM` */
export const DEFAULT_TERMINAL_TYPE = 'xterm-256color';

/**
 * 尺寸夹紧下界。`rows >= 1`、`cols >= 2` 是终端语义的硬下界：0 行/1 列的终端无法容纳光标，
 * xterm 与 ConPTY 都会给出未定义行为（§11 明写宿主**不夹紧**，所以这个判断只能在我们这层做）。
 */
export const TERM_MIN_ROWS = 1;
export const TERM_MIN_COLS = 2;

/** 尺寸夹紧上界。**上限只为挡住脏输入**（UI 传来 0/NaN/1e9），不是产品约束：正常窗口远到不了 */
export const TERM_MAX_ROWS = 500;
export const TERM_MAX_COLS = 1000;

/**
 * 增量缓冲的**双上限**（REQ-6.4：块数 + 字节）。
 *
 * 两个都要：块数挡「极小分片刷屏」（大量 1 字节块），字节挡「单块很大」（黏贴/大段回显）。
 * 单靠块数会 OOM，单靠字节会让 `dropped` 的口径随分片大小漂移。
 * `256 × 1KB` 是刻意配平的：正常 PTY 分片（≤4KB）先撞字节上限，病态小分片先撞块数上限 ——
 * 两条丢弃路径**都能被真实触发**，也都能被单测钉住。
 */
export const TERM_BUFFER_MAX_BLOCKS = 256;
export const TERM_BUFFER_MAX_BYTES = 256 * 1024;

/** 屏幕模型的 scrollback 容量（xterm 的 `scrollback` 选项）。比快照尾部上限大，才能取到整段尾部 */
export const TERM_SCREEN_SCROLLBACK_LINES = 1000;

/**
 * 快照默认带回的 scrollback 尾部行数（REQ-6.2「有界尾部」）。
 *
 * 🔴 **必须显式传 `scrollback` 给 serializer**：实测（2026-10-09，`@xterm/addon-serialize` 0.14.0）
 * 不传该选项时 serializer 会把**全部** scrollback 吐出来 ⇒ 快照大小随会话时长线性增长，
 * 正好违反 REQ-6.2 的「有界」。
 */
export const TERM_SNAPSHOT_SCROLLBACK_LINES = 200;

/** 调用方可要求的尾部上限（再大就没有意义：屏幕模型本身只留 `TERM_SCREEN_SCROLLBACK_LINES` 行） */
export const TERM_SNAPSHOT_SCROLLBACK_MAX = TERM_SCREEN_SCROLLBACK_LINES;

/**
 * 整数夹紧：先 `trunc` 再夹到 `[min, max]`。
 *
 * 非有限值（`NaN` / `±Infinity`）**落到 `min`**，不是落到默认值也不是抛错 —— 调用点是「尺寸同步」
 * 与「快照尾部」两条热路径，抛错会把一次脏输入升级成整条通道断开；落到下界是**可观察且安全**的
 * 结果（UI 会看到 `rows/cols` 变小，能立刻对上账）。
 */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** 夹紧后的尺寸（缺省值补齐 + 上下界夹紧）；**唯一**产出 `TerminalSize` 的地方 */
export function clampSize(rows?: number, cols?: number): TerminalSize {
  return {
    rows: clampInt(rows ?? DEFAULT_ROWS, TERM_MIN_ROWS, TERM_MAX_ROWS),
    cols: clampInt(cols ?? DEFAULT_COLS, TERM_MIN_COLS, TERM_MAX_COLS),
  };
}
