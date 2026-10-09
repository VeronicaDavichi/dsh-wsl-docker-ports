/**
 * fake `ctx.subprocess`（002 Phase 2 的「零真机」载体）
 *
 * 🔴 为什么必须自己写、且必须**记录 `resize` 的实参**：
 * 宿主 handle 是 `resize(cols, rows)`（**列在前**），而本包对外是 `resize(id, rows, cols)`。
 * 弄反不会报错、只会**静默转置** —— 所以断言必须用 `rows ≠ cols`，并把宿主收到的两个实参
 * **按位置**记下来复查。用真 PTY 测这件事既慢又看不出来（行列转置在 80×24 上不明显）。
 *
 * 其它刻意保留的宿主事实（design §11）：
 * - `spawnTerminal` 失败**在调用端抛错**（`failFor` 就是那条路径）；
 * - 输出的承载是 Node 可读流（宿主是 `PassThrough`）⇒ 这里也用 `PassThrough`，传输形状与真机一致；
 * - `terminate` **幂等**：重复调用只累加计数、不抛错；
 * - **没有** `shellActivity` 字段、`cwd` 必填 —— 与 `TerminalSpawnSpec` 的类型面一致。
 */

import { PassThrough } from 'node:stream';

import type { SubprocessSurface, TerminalPtyHandle, TerminalSpawnSpec } from '../../src/index.ts';

/** 宿主收到的 `resize` 实参（**按位置**：`[cols, rows]`） */
export type ResizeCall = readonly [cols: number, rows: number];

export interface FakePtyHandle extends TerminalPtyHandle {
  readonly spec: TerminalSpawnSpec;
  /** 宿主视角的 resize 实参序列（唯一能查出「行列转置」的证据） */
  readonly resizeCalls: readonly ResizeCall[];
  /** `write` 收到的内容（T2.5 的只读性靠它：连读之后这里必须为空） */
  readonly writeCalls: readonly string[];
  /** `terminate` 被调次数（幂等 ⇒ 允许 > 1） */
  readonly terminateCount: number;
  readonly terminated: boolean;
  /** 设上它就让 `terminate()` reject —— 验「terminate 失败也不留幽灵实例」 */
  terminateError: Error | undefined;
  /** 设上它就让 `resize()` reject —— 验宿主调用失败被收成 `resize-failed` */
  resizeError: Error | undefined;
  /** 模拟 PTY 吐出一段输出；**await 它**（等 'data' 事件真的派发完）再断言屏幕内容 */
  emit(data: string): Promise<void>;
  /** 按**原始字节**吐输出（用来把一个多字节 UTF-8 码点切成两半，验 `StringDecoder` 的跨块解码） */
  emitRaw(bytes: readonly number[]): Promise<void>;
  /** 模拟顶层进程退出（`done` settle） */
  exit(exitCode?: number): void;
}

export interface FakeSubprocess {
  readonly surface: SubprocessSurface;
  /** 每次 `spawnTerminal` 的入参（T2.1 的字段逐项断言点） */
  readonly spawnCalls: readonly TerminalSpawnSpec[];
  readonly handles: readonly FakePtyHandle[];
}

export interface FakeSubprocessOptions {
  /** 存在的目录白名单；给了它就模拟「cwd 不存在 ⇒ 调用端抛错」 */
  readonly existingCwds?: readonly string[];
  /** 存在的程序白名单；给了它就模拟「程序不可解析 ⇒ 调用端抛错」 */
  readonly existingPrograms?: readonly string[];
  /** 让失败以 **rejected Promise** 形态出现（默认是同步抛）—— 两种形态都要被 `start` 收成可读错误 */
  readonly failAsync?: boolean;
  /** 模拟宿主返回空 handle（§11 说不会，但本包要能挡住，别让它在真机上变成幽灵实例） */
  readonly returnNothing?: boolean;
}

function makeHandle(spec: TerminalSpawnSpec): FakePtyHandle {
  const output = new PassThrough();
  const resizeCalls: ResizeCall[] = [];
  const writeCalls: string[] = [];
  let terminateCount = 0;
  let terminated = false;
  let terminateError: Error | undefined;
  let resizeError: Error | undefined;
  let settle: (outcome: unknown) => void = () => {};
  const done = new Promise<unknown>((resolve) => {
    settle = resolve;
  });

  return {
    pid: 4242,
    output,
    done,
    spec,
    resizeCalls,
    writeCalls,
    write(data) {
      writeCalls.push(data);
      return Promise.resolve();
    },
    resize(cols, rows) {
      resizeCalls.push([cols, rows]);
      return resizeError === undefined ? Promise.resolve() : Promise.reject(resizeError);
    },
    terminate() {
      terminateCount += 1;
      terminated = true;
      return terminateError === undefined ? Promise.resolve() : Promise.reject(terminateError);
    },
    get running() {
      return !terminated;
    },
    get terminateCount() {
      return terminateCount;
    },
    get terminated() {
      return terminated;
    },
    get terminateError() {
      return terminateError;
    },
    set terminateError(next: Error | undefined) {
      terminateError = next;
    },
    get resizeError() {
      return resizeError;
    },
    set resizeError(next: Error | undefined) {
      resizeError = next;
    },
    async emit(data) {
      output.write(Buffer.from(data, 'utf8'));
      // PassThrough 的 'data' 可能落在 nextTick 上：不 await 这一拍就会读到「输出还没进屏幕模型」的
      // 快照 —— 那不是被测行为，只是测试的时序 bug。`setImmediate` 之前 nextTick 队列已排空。
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    async emitRaw(bytes) {
      output.write(Buffer.from(bytes));
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    exit(exitCode = 0) {
      settle({ exitCode, signal: undefined });
    },
  };
}

/** 建一个 fake `ctx.subprocess`（每个测试一个，互不串味） */
export function createFakeSubprocess(options: FakeSubprocessOptions = {}): FakeSubprocess {
  const spawnCalls: TerminalSpawnSpec[] = [];
  const handles: FakePtyHandle[] = [];

  const surface: SubprocessSurface = {
    spawnTerminal(spec) {
      spawnCalls.push(spec);
      const failure = (): Error | undefined => {
        if (options.existingPrograms !== undefined && !options.existingPrograms.includes(spec.argv[0])) {
          return new Error(`File not found: ${spec.argv[0]}`);
        }
        if (options.existingCwds !== undefined && !options.existingCwds.includes(spec.cwd)) {
          return new Error(`Unable to start terminal: chdir failed for '${spec.cwd}' (ENOENT)`);
        }
        return undefined;
      };
      const error = failure();
      if (error !== undefined) {
        // 宿主失败有两种到达形态（同步抛 / rejected promise），`start` 必须都收成同一个可读错误
        if (options.failAsync === true) return Promise.reject(error);
        throw error;
      }
      if (options.returnNothing === true) return undefined as unknown as TerminalPtyHandle;
      const handle = makeHandle(spec);
      handles.push(handle);
      return handle;
    },
  };

  return { surface, spawnCalls, handles };
}
