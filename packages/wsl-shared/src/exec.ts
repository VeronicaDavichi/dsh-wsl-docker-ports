/**
 * 结构化命令执行器（001 REQ-5 / 任务 T1.2–T1.5）
 *
 * 三条硬口径：
 * 1. **无 shell**（REQ-5.2）：只走 `argv` 数组，任何用户输入都不进命令字符串。
 * 2. **超时必填**（REQ-5.3）：`timeoutMs` 没有隐式默认；超时先 `kill()` 再 `taskkill /T /F` 兜底
 *    （Windows 无 POSIX 进程组信号，`wsl.exe` 会派生 `wslhost` 与发行版侧进程）。
 * 3. **可注入**（REQ-6.3）：`createExecutor(spawnImpl, treeKillImpl)` 供测试传 fake，
 *    注入后**不产生任何真实进程**。
 *
 * 编码（REQ-5.5）：调用方**显式声明**；解码器在启动命令**之前**解析好，
 * 非法编码标签直接失败，而不是让乱码流进解析器。
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { fail, type WslSharedError } from './errors.ts';

/** 执行参数（`timeoutMs` 必填，见 REQ-5.3） */
export interface ExecOptions {
  readonly timeoutMs: number;
  /** `'utf16le'` / `'utf8'` / 任何 `TextDecoder` 接受的标签 */
  readonly encoding: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** 成功态（`stderr` 非空也算成功，REQ-5.4） */
export interface ExecResult {
  readonly ok: true;
  readonly exitCode: 0;
  readonly stdout: string;
  readonly stderr: string;
}

export type ExecOutcome = ExecResult | WslSharedError;

/** 执行器签名（消费方可以自己实现一个，用于注入 fake 或换传输层） */
export type Executor = (
  file: string,
  argv: readonly string[],
  options: ExecOptions,
) => Promise<ExecOutcome>;

/** 已启动子进程的最小结构面（够 fake 用，又不逼测试去造完整的 `ChildProcess`） */
interface StreamLike {
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): unknown;
}

interface ChildLike {
  readonly pid: number | undefined;
  readonly stdout: StreamLike | null;
  readonly stderr: StreamLike | null;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** 注入点 1：启动进程 */
export type SpawnLike = (
  file: string,
  argv: readonly string[],
  options: Record<string, unknown>,
) => ChildLike;

/** 注入点 2：兜底杀进程树（默认 `taskkill`） */
export type TreeKillLike = (file: string, argv: readonly string[]) => Promise<void>;

const defaultSpawn: SpawnLike = (file, argv, options) =>
  // `@types/node` 的 `ChildProcess.on` 签名更宽（`(event: string, ...args: any[])`），
  // 结构化收窄在运行时是同一对象，故此处一次显式断言，换取 fake 侧不用造假类型。
  nodeSpawn(file, [...argv], options) as unknown as ChildLike;

async function defaultTreeKill(file: string, argv: readonly string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      const child = nodeSpawn(file, [...argv], { stdio: 'ignore', windowsHide: true, shell: false });
      child.on('close', () => resolve());
      child.on('error', () => resolve());
    } catch {
      resolve();
    }
  });
}

function toBytes(chunk: Uint8Array | string): Uint8Array {
  return typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 规范化编码标签：Node 的 `'utf16le'` 与 WHATWG 的 `'utf-16le'` 是同一个东西 */
function normalizeEncodingLabel(encoding: string): string {
  return encoding.trim().toLowerCase().replace(/^utf16le$/, 'utf-16le');
}

async function killTree(child: ChildLike, treeKill: TreeKillLike): Promise<void> {
  try {
    child.kill();
  } catch {
    // 进程可能已经退出；杀不到不是新错误
  }
  const pid = child.pid;
  if (typeof pid === 'number' && pid > 0) {
    // 兜底：taskkill 失败不改变错误码（超时的结论已经确定）
    await treeKill('taskkill', ['/PID', String(pid), '/T', '/F']);
  }
}

/**
 * 造一个执行器。默认参数就是真机实现；测试传 fake 后完全离线。
 */
export function createExecutor(
  spawnImpl: SpawnLike = defaultSpawn,
  treeKillImpl: TreeKillLike = defaultTreeKill,
): Executor {
  return async (file, argv, options) => {
    const args = [...argv];
    // 错误对象里带**完整命令**（含可执行文件），UI 可直接展示「将执行什么」（005 REQ-3.2 口径）
    const command = [file, ...args];

    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(normalizeEncodingLabel(options.encoding));
    } catch {
      return fail('Unexpected', `不支持的输出编码：${options.encoding}`, { argv: command });
    }

    return await new Promise<ExecOutcome>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (outcome: ExecOutcome): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(outcome);
      };

      let child: ChildLike;
      try {
        child = spawnImpl(file, args, {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.env === undefined ? {} : { env: options.env }),
          windowsHide: true,
          stdio: 'pipe',
          shell: false,
        });
      } catch (error) {
        finish(fail('Unexpected', `无法启动命令：${describe(error)}`, { argv: command }));
        return;
      }

      const outChunks: Uint8Array[] = [];
      const errChunks: Uint8Array[] = [];

      // ⚠️ 顺序要紧：定时器**先**建立再挂事件处理器。
      // 否则一旦子进程在注册阶段就同步 close/error（fake 或极端情况），
      // `finish()` 里 timer 还是 undefined → 定时器永远不会被 clear，会把事件循环拖到超时才退出。
      timer = setTimeout(() => {
        void killTree(child, treeKillImpl);
        finish(
          fail('Timeout', `命令在 ${String(options.timeoutMs)}ms 内未结束，已终止：${file}`, {
            argv: command,
          }),
        );
      }, options.timeoutMs);
      // 不因这个定时器本身而阻止进程退出（子进程句柄在运行时仍会让事件循环存活，超时照常触发）
      timer.unref();

      child.stdout?.on('data', (chunk) => outChunks.push(toBytes(chunk)));
      child.stderr?.on('data', (chunk) => errChunks.push(toBytes(chunk)));

      child.on('error', (error) => {
        const code = (error as NodeJS.ErrnoException).code;
        finish(
          code === 'ENOENT'
            ? fail('CommandNotFound', `找不到命令：${file}`, { argv: command })
            : fail('Unexpected', `命令执行失败：${describe(error)}`, { argv: command }),
        );
      });

      child.on('close', (code) => {
        const stdout = decoder.decode(Buffer.concat(outChunks));
        const stderr = decoder.decode(Buffer.concat(errChunks));
        if (code === 0) {
          finish({ ok: true, exitCode: 0, stdout, stderr });
          return;
        }
        finish(
          fail('NonZeroExit', `命令以退出码 ${String(code)} 结束：${file}`, {
            argv: command,
            exitCode: code ?? -1,
            stderr,
          }),
        );
      });
    });
  };
}
