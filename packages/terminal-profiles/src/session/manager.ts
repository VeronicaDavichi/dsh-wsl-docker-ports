/**
 * PTY 实例表与会话状态（002 任务 T2.1–T2.5；design §2.1）
 *
 * ## 这个文件是「谁拥有 PTY」的唯一答案
 *
 * 实例表 = `id → { handle, screen, size, exited }`。所有对外动作（起/列/读/写/尺寸/终止）都从这里
 * 出发，**没有任何别的模块直接拿 handle** —— design §11 的三个静默陷阱（`resize` 列在前、
 * `cwd` 不可省、`shellActivity` 反效果）因此各自只有一处需要写对：
 * `./spawn-spec.ts` 管 cwd 与字段集，本文件管换序与夹紧。
 *
 * ## 「不留幽灵实例」是怎么保证的
 *
 * 🔴 宿主契约：`spawnTerminal` **失败一律在调用端抛错**（不返回 handle、也不 reject `done`）。
 * 因此顺序被钉死为：**先 try/catch 拿到 handle，成功之后才 `instances.set(id, …)`**。
 * 任何一行把 `set` 提前（例如先占位再补 handle）都会立刻违反 REQ-3.5 —— 那正是「无内容的幽灵标签」
 * 的成因。`kill` 同理：**先 `delete` 再 `terminate`**，这样即使 terminate 抛错/挂住，表里也不会
 * 留一个「UI 能看见但已经死了」的条目（失败以 `warning` 告知，见 `kill`）。
 *
 * ## 读的确定性（为什么 `read` 是 async）
 *
 * PTY 输出经 `output` 流的 `data` 事件进来，而 `headless.write()` 是**异步解析**的（回调后才算完）。
 * 于是每个实例维护一条串行链 `chain`，`read` **先 `await chain`** 再出快照：调用方拿到的快照一定是
 * 「到目前为止收到的全部输出」的结果，不需要 sleep 去抖，也不会读到半个转义序列。
 */

import { StringDecoder } from 'node:string_decoder';

import type { TerminalProfile } from '../config/profiles.ts';
import { clampSize } from '../limits.ts';
import type { TerminalSize } from '../limits.ts';
import { createScreenModel } from '../screen/screen-model.ts';
import type { ScreenIncremental, ScreenModel, ScreenSnapshot } from '../screen/screen-model.ts';
import { describeError, fail, spawnFailureMessage } from './errors.ts';
import { buildSpawnSpec } from './spawn-spec.ts';
import type { SpawnSpecOptions } from './spawn-spec.ts';
import type {
  SessionResult,
  SubprocessSurface,
  TerminalInstanceSummary,
  TerminalPtyHandle,
} from './types.ts';

/** `start` 的启动参数（与 spec 构造层同一套字段，见 `./spawn-spec.ts`） */
export type StartOptions = SpawnSpecOptions;

/** `read` 的参数（004 的工具面与 003 的服务面共用这套字段名） */
export interface ReadOptions {
  /** 缺省 `snapshot`（决策：一次读默认要「现在长什么样」，增量要显式点名） */
  readonly mode?: 'snapshot' | 'incremental' | undefined;
  /** 只在 `incremental` 下有意义；缺省 = 把缓冲里还在的块全给我 */
  readonly sinceSeq?: number | undefined;
  /** 只在 `snapshot` 下有意义；缺省 `TERM_SNAPSHOT_SCROLLBACK_LINES`（有界尾部，REQ-6.2） */
  readonly scrollbackLines?: number | undefined;
}

/** `read` 的结果：`mode` 是判别式，调用方不必猜自己拿到的是哪一种 */
export type TerminalRead =
  | { readonly mode: 'snapshot'; readonly snapshot: ScreenSnapshot }
  | ({ readonly mode: 'incremental' } & ScreenIncremental);

export interface KillOutcome {
  readonly killed: true;
  /** 终尽力而为的告警（§11：Windows ConPTY 不在 Job containment 内） */
  readonly warning?: string | undefined;
}

export interface SessionManager {
  /** 起实例（**每次都是新 id**，REQ-3.4：不劫持、不复用） */
  start(profile: TerminalProfile, options?: StartOptions): Promise<SessionResult<TerminalInstanceSummary>>;
  /** 实例摘要，**按创建序**（REQ-4.3 的列表顺序靠它） */
  list(): readonly TerminalInstanceSummary[];
  /** 读屏幕（只读：不注入输入、不改尺寸，REQ-6.5 / REQ-5.4） */
  read(id: string, options?: ReadOptions): Promise<SessionResult<TerminalRead>>;
  /** 写输入（原样字节，不经 shell 切词） */
  write(id: string, data: string): Promise<SessionResult<{ readonly written: number }>>;
  /** 改尺寸；返回**实际生效**值（夹紧在本层，REQ-5.3） */
  resize(id: string, rows: number, cols: number): Promise<SessionResult<TerminalSize>>;
  /** 终止实例（含尽力而为的进程树终止） */
  kill(id: string): Promise<SessionResult<KillOutcome>>;
}

export interface SessionManagerOptions {
  readonly subprocess: SubprocessSurface;
}

/** 内部实例记录（**不**导出：handle 与 screen 都不该被外部拿到） */
interface Instance {
  readonly id: string;
  readonly profileName: string;
  readonly handle: TerminalPtyHandle;
  readonly screen: ScreenModel;
  readonly pid: number | undefined;
  rows: number;
  cols: number;
  exited: boolean;
  /** 已终止（从表里摘掉后置 true）：让迟到的输出不再喂屏幕模型 */
  closed: boolean;
  /** 输出吸收链（见文件头「读的确定性」） */
  chain: Promise<void>;
}

/**
 * 把 `output` 的一块数据变成文本。
 *
 * ⚠️ 为什么要 `StringDecoder` 而不是 `chunk.toString('utf8')`：本包声明的宿主契约里，`output` 只承诺
 * 「`data` 事件给一块 `unknown` 形状的数据」，**没有**承诺「块边界与 UTF-8 码点对齐」（真实实现是
 * `PassThrough`，`data` 事件给 Buffer；在合并/背压路径下「写入一块」不等于「读出一块」）。
 * 逐块 `toString` 会把落在码点中间的边界变成 U+FFFD，屏幕模型里就永久多出一个乱码字符。
 * 行为由 `tests/unit/session-utf8.test.ts` 钉住（把一个「中」字切成两半、分两次发）。
 */
function decodeChunk(decoder: StringDecoder, chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return decoder.write(Buffer.from(chunk));
  return String(chunk);
}

/** 建实例表（每个插件行一个；id 是 `term-N`，**单调递增**，所以同 profile 两次启动必得两个 id） */
export function createSessionManager(options: SessionManagerOptions): SessionManager {
  const { subprocess } = options;
  const instances = new Map<string, Instance>();
  let counter = 0;

  const notFound = (id: string): SessionResult<never> => {
    const ids = [...instances.keys()];
    return fail('instance-not-found', `实例「${id}」不在实例表里（可能已被 kill）`, {
      hint: ids.length === 0 ? '当前没有任何实例。' : `当前实例：${ids.join('、')}`,
    });
  };

  const summary = (inst: Instance): TerminalInstanceSummary => ({
    id: inst.id,
    profileName: inst.profileName,
    rows: inst.rows,
    cols: inst.cols,
    seq: inst.screen.seq,
    dropped: inst.screen.dropped,
    exited: inst.exited,
    ...(inst.pid === undefined ? {} : { pid: inst.pid }),
  });

  const attachOutput = (inst: Instance): void => {
    const output = inst.handle.output;
    if (output === undefined || typeof output.on !== 'function') return;
    const decoder = new StringDecoder('utf8');
    output.on('data', (chunk) => {
      if (inst.closed) return;
      const text = decodeChunk(decoder, chunk);
      if (text === '') return;
      // 串行化：`screen.write` 内部是异步解析，并行调用会让块序与屏幕内容不一致
      inst.chain = inst.chain.then(() => inst.screen.write(text)).catch(() => {});
    });
  };

  const attachExit = (inst: Instance): void => {
    const done = inst.handle.done;
    if (done === undefined || typeof done.then !== 'function') return;
    const settle = (): void => {
      inst.exited = true;
    };
    // ⚠️ `done` 只在**顶层进程退出**时 settle（spawn 失败不会 reject 它 —— 那是在调用端抛的），
    // 所以这里只标状态、**不**动实例表：REQ-12.3 要的是「进程没了但 tab 仍在、可回看屏幕」。
    void done.then(settle, settle).catch(() => {});
  };

  return {
    async start(profile, startOptions = {}) {
      const spec = buildSpawnSpec(profile, startOptions);
      if (!spec.ok) return spec;

      let handle: TerminalPtyHandle | undefined;
      try {
        handle = await subprocess.spawnTerminal(spec.value);
      } catch (error) {
        return fail('spawn-failed', spawnFailureMessage(spec.value, error), {
          cwd: spec.value.cwd,
          hint: '检查 profile 的 cwd / cwdLinux 是否存在、command 是否可执行（REQ-3.3 / REQ-3.5）。',
        });
      }
      if (handle === undefined || typeof handle.terminate !== 'function') {
        return fail('spawn-failed', spawnFailureMessage(spec.value, new Error('宿主未返回可用的终端 handle')), {
          cwd: spec.value.cwd,
          hint: '宿主契约要求成功时返回 live handle（§11）；拿到空值即视为启动失败，不建实例。',
        });
      }

      // 🔴 只有到这里才进实例表：失败路径一条都不留幽灵实例（REQ-3.5）
      counter += 1;
      const id = `term-${counter}`;
      const size = clampSize(spec.value.rows, spec.value.cols);
      const inst: Instance = {
        id,
        profileName: profile.name,
        handle,
        screen: createScreenModel(size),
        pid: handle.pid,
        rows: size.rows,
        cols: size.cols,
        exited: false,
        closed: false,
        chain: Promise.resolve(),
      };
      instances.set(id, inst);
      attachOutput(inst);
      attachExit(inst);
      return { ok: true, value: summary(inst) };
    },

    list() {
      return [...instances.values()].map(summary);
    },

    async read(id, readOptions = {}) {
      const inst = instances.get(id);
      if (inst === undefined) return notFound(id);
      await inst.chain; // 先把已收到的输出吸收完（见文件头「读的确定性」）
      if (readOptions.mode === 'incremental') {
        const incremental = inst.screen.incremental(readOptions.sinceSeq);
        return { ok: true, value: { mode: 'incremental', ...incremental } };
      }
      return { ok: true, value: { mode: 'snapshot', snapshot: inst.screen.snapshot(readOptions.scrollbackLines) } };
    },

    async write(id, data) {
      const inst = instances.get(id);
      if (inst === undefined) return notFound(id);
      try {
        await inst.handle.write(data);
      } catch (error) {
        return fail('write-failed', `向实例「${id}」写入失败：${describeError(error)}`, {
          hint: '终端可能已退出；先用 list 确认 exited 状态。',
        });
      }
      return { ok: true, value: { written: data.length } };
    },

    async resize(id, rows, cols) {
      const inst = instances.get(id);
      if (inst === undefined) return notFound(id);
      const size = clampSize(rows, cols);
      try {
        // 🔴🔴 宿主 handle 是 `resize(cols, rows)` —— **列在前**，且**不夹紧**（design §11）。
        // 本包对外的 `resize(id, rows, cols)` 是行在前，换序**只允许发生在这一行**：
        // 写反不会报错，只会静默把行列转置（唯一会静默坏掉的地方）。
        await inst.handle.resize(size.cols, size.rows);
      } catch (error) {
        return fail('resize-failed', `调整实例「${id}」尺寸失败：${describeError(error)}`);
      }
      inst.screen.resize(size);
      inst.rows = size.rows;
      inst.cols = size.cols;
      return { ok: true, value: size };
    },

    async kill(id) {
      const inst = instances.get(id);
      if (inst === undefined) return notFound(id);
      instances.delete(id); // 先移表：terminate 抛错/挂住也不会留下幽灵实例
      inst.closed = true;
      await inst.chain;
      let warning: string | undefined;
      try {
        await inst.handle.terminate(); // 幂等（§11），不需要自己再判「是否已终止」
      } catch (error) {
        warning =
          'terminate 失败（尽力而为：Windows 上 ConPTY 不在 Job containment 内，逃出进程组的子孙不保证被终止）' +
          ` —— ${describeError(error)}`;
      }
      inst.screen.dispose();
      return { ok: true, value: { killed: true, ...(warning === undefined ? {} : { warning }) } };
    },
  };
}
