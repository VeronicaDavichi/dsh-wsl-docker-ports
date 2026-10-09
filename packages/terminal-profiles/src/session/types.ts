/**
 * PTY 宿主契约与失败词汇（002 任务 T2.1–T2.5；契约事实来源 = design.md §11）
 *
 * ## 为什么把宿主的 handle 抄成一个本地结构面
 *
 * 本包**不** import 宿主包（零运行时依赖 + 离线可验证），但需要它的 handle 形状。这里只写本包
 * **真正调用**的那几个成员，并把 §11 的三条陷阱直接钉在签名上：
 *
 * ① 🔴 `resize(cols, rows)` —— **列在前**、**不夹紧**。本包对外的入口一律是 `resize(id, rows, cols)`
 *    （行在前、自带夹紧），换序只允许发生在 `./manager.ts` 的那一处；把 `(cols, rows)` 写进宿主
 *    这一侧的签名，是为了让「按名字调」在类型层就不可能写反。
 * ② `terminate()` **幂等**（重复调用返回同一个 promise 语义），所以 `kill` 可以直接 await、不需要
 *    自己再加一次「已终止」判定。
 * ③ 失败**一律在 `spawnTerminal` 调用端抛错** —— 它不返回 handle、也不 reject `done` ⇒ `start` 必须
 *    try/catch 成可读错误，且**只有拿到 handle 才进实例表**（否则就是 REQ-3.5 的幽灵实例）。
 *
 * ⚠️ 还有两个「不写」：`shellActivity`（Windows 上是反效果：activity 无效却跳过 done 后的自动
 * terminate ⇒ 不传该字段）与「不传 `cwd`」（`cwd: undefined` 会落到**宿主进程 cwd** ⇒ 必须显式传）。
 * 这两条以「字段根本不存在于 `TerminalSpawnSpec`」的方式保证：类型层就传不进去。
 */

/** PTY 输出流的最小结构面（宿主的实现是 `node:stream` 的 `PassThrough`，`data` 事件给 Buffer） */
export interface PtyOutputSource {
  /** 只声明 `data`：本包不消费 `end`/`error`（收尾由 `done` 负责，见下面 `TerminalPtyHandle.done`） */
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/** `ctx.subprocess.spawnTerminal` 返回的受管终端句柄（§11：「立即返回 live handle」） */
export interface TerminalPtyHandle {
  readonly pid?: number;
  /** PTY 输出（宿主用 `PassThrough` 承载；**不**继承给宿主进程，是本包唯一的输出来源） */
  readonly output?: PtyOutputSource;
  /** 退出事实。⚠️ spawn 失败**不会** reject 它 —— 那是在 `spawnTerminal` 调用端抛的 */
  readonly done?: Promise<unknown>;
  /** 原样写入 PTY（**只允许** `write` 路径调用；`read` 路径 SHALL NOT 碰它，REQ-6.5/REQ-5.4） */
  write(data: string): unknown;
  /** 🔴 宿主语义：**列在前且不夹紧**。只有 `./manager.ts` 的 `resize` 允许调它 */
  resize(cols: number, rows: number): unknown;
  /** 幂等（§11）：重复调用不会重复杀，也不会抛「已经终止」 */
  terminate(): unknown;
  /** 尚未退出时为 true；宿主在退出后置 false */
  readonly running?: boolean;
}

/**
 * `spawnTerminal` 的入参形状（§11 的实测字段集）。
 *
 * 刻意**没有** `shellActivity`，也**没有**把 `cwd` 标成可选 —— 后者是 REQ-3.3 的关键：
 * `cwd: undefined` 会让 PTY 落到宿主进程的 cwd（node-pty 不校验），而 REQ-3.3 明写
 * 「SHALL NOT 静默回落到 Session 工作区或 `$HOME`」。类型上不给 `undefined` 的余地，比在文档里
 * 写一句「记得传」可靠。
 */
export interface TerminalSpawnSpec {
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly rows: number;
  readonly cols: number;
  readonly terminalType: string;
}

/** `ctx.subprocess` 里本包用到的那一点点（只列 `spawnTerminal`；别的一律不碰） */
export interface SubprocessSurface {
  spawnTerminal(spec: TerminalSpawnSpec): TerminalPtyHandle | Promise<TerminalPtyHandle>;
}

/**
 * 会话层失败码。**与 004 的工具体结果码同一套词汇**（design §5 的 `profile-not-found` /
 * `instance-not-found` / `sandbox-denied` … 由 004 拥有；本文件只出 002 自己产生的那些）。
 *
 * 命名口径：`not-startable` 是**配置期**结论（REQ-1.4 的 `needsFix` 在启动期兑现），
 * `cwd-*` 是 REQ-3.3 的两条拒绝路径，`spawn-failed` 是 REQ-3.5 的调用端抛错。
 */
export type SessionFailureCode =
  /** profile 被标了 `needsFix`（REQ-1.4：不可启动） */
  | 'not-startable'
  /** 没有任何可**显式**传给 PTY 的 cwd（REQ-3.3：拒绝，不回落到工作区/`$HOME`） */
  | 'cwd-missing'
  /** WSL profile 的 `cwd` 翻不成 Linux 路径（REQ-3.3，带 001 的错误码） */
  | 'cwd-unmappable'
  /** `spawnTerminal` 抛错（cwd 不存在 / 程序不可解析 / 沙箱拒绝…）（REQ-3.5） */
  | 'spawn-failed'
  /** 实例 id 不在表里（已 kill / 从未存在） */
  | 'instance-not-found'
  /** 宿主 `resize` 调用失败 */
  | 'resize-failed'
  /** 宿主 `write` 调用失败（终端已退出等） */
  | 'write-failed';

/** 可读失败（**不抛异常**：004 的工具体与 WS 层都要把它整形成结果，见 004 design §5） */
export interface SessionFailure {
  readonly ok: false;
  readonly code: SessionFailureCode;
  /** 人话在前：UI 直接展示，必含定位信息（REQ-3.3 要求错误里指出**那个路径**） */
  readonly message: string;
  readonly hint?: string;
  /** 失败时**本该使用**的 PTY cwd（REQ-3.3 的可追溯点；`cwd-missing` 时可能没有） */
  readonly cwd?: string;
  /** 001 的错误码透传（`cwd-unmappable` / `not-startable` 时带） */
  readonly upstreamCode?: string;
}

/** 结果载体（对照 001 的 `ok` 判别联合：形状一致，调用方不用学第二套） */
export type SessionResult<T> = { readonly ok: true; readonly value: T } | SessionFailure;

/** 实例摘要（`list` 与 `start` 共用；**不含** handle / screen，别把内部状态漏出去） */
export interface TerminalInstanceSummary {
  readonly id: string;
  /** 来源 profile 名（配置改后**不**迁移，REQ-2.4） */
  readonly profileName: string;
  /** 宿主 pid（拿不到时缺省 —— 例如 fake handle 不给） */
  readonly pid?: number;
  readonly rows: number;
  readonly cols: number;
  /**
   * **下一号**（`nextSeq`，REQ-6.3）：第一个块的 `seq` 是 1，所以「还没有任何输出」时它也是 1。
   * 消费方把它原样存下来当下次的 `sinceSeq` 用**永远安全**（既不会重复读，也不会跳过）。
   */
  readonly seq: number;
  /** 因缓冲上限被 FIFO 丢弃的块数（REQ-6.4，UI/日志可见） */
  readonly dropped: number;
  /** 顶层进程已退出（`done` 已 resolve）；此时实例**仍在表里**，直到 `kill` */
  readonly exited: boolean;
}
