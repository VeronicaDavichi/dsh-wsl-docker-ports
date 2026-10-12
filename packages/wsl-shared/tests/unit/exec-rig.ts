/**
 * 执行器测试台架（2026-10-12 从 `exec.test.ts` 拆出）
 *
 * 为什么拆：T7.1（非零退出必须带 `stdout` 原文）新增 4 条断言后，`exec.test.ts` 达 **433 行 > 400**，
 * 撞上**NFR-5 单文件 ≤ 400 行（SHALL）** —— `check-size.mjs` 的 2026-10-12 扩面把 `packages/<pkg>/tests/**`
 * 也纳入了该判据（就是那次补门要拦的东西）。⇒ 把**台架**抽成模块复用：**用例一条不删、一条不改名**。
 * 本文件不是 `*.test.ts`，不会被 vitest 当用例收集（默认 include 是 `**\/*.{test,spec}.*`）。
 *
 * ⚠️ 硬口径（沿用原文件）：全部走 **fake spawn**，**不产生任何真实进程**。
 */
import type { SpawnLike, TreeKillLike } from '../../src/exec.ts';

export type StreamListener = (chunk: Uint8Array | string) => void;

export interface FakeHandle {
  readonly spawn: SpawnLike;
  readonly calls: { file: string; argv: readonly string[]; options: Record<string, unknown> }[];
  readonly killed: () => boolean;
  readonly emitBytes: (bytes: Uint8Array, stream?: 'stdout' | 'stderr') => void;
  readonly emitText: (text: string, stream?: 'stdout' | 'stderr') => void;
  readonly emitError: (code: string) => void;
  readonly emitClose: (code: number | null) => void;
}

/** 造一个可控的 fake 子进程：事件由测试显式触发 */
export function fakeSpawn(pid: number | undefined = 4242): FakeHandle {
  const out: StreamListener[] = [];
  const err: StreamListener[] = [];
  const onError: ((error: Error) => void)[] = [];
  const onClose: ((code: number | null) => void)[] = [];
  const calls: FakeHandle['calls'] = [];
  let killed = false;

  const spawn = ((file: string, argv: readonly string[], options: Record<string, unknown>) => {
    calls.push({ file, argv, options });
    return {
      pid,
      stdout: { on: (_event: string, listener: StreamListener) => void out.push(listener) },
      stderr: { on: (_event: string, listener: StreamListener) => void err.push(listener) },
      on: (event: string, listener: (...args: never[]) => void) => {
        if (event === 'error') onError.push(listener as (error: Error) => void);
        if (event === 'close') onClose.push(listener as (code: number | null) => void);
      },
      kill: () => {
        killed = true;
        return true;
      },
    } as unknown as ReturnType<SpawnLike>;
  }) as SpawnLike;

  const emitBytes: FakeHandle['emitBytes'] = (bytes, stream = 'stdout') => {
    for (const listener of stream === 'stdout' ? out : err) listener(bytes);
  };

  return {
    spawn,
    calls,
    killed: () => killed,
    emitBytes,
    emitText: (text, stream = 'stdout') => emitBytes(Buffer.from(text, 'utf8'), stream),
    emitError: (code) => {
      const error = Object.assign(new Error(`${code}: fake`), { code });
      for (const listener of onError) listener(error);
    },
    emitClose: (code) => {
      for (const listener of onClose) listener(code);
    },
  };
}

/** 默认兜底杀进程树：测试里一律不真杀 */
export const neverKill: TreeKillLike = async () => undefined;
