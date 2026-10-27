/**
 * 测试用 fake 执行器（003 Phase 1/2 离线单测的公共底座）
 *
 * 为什么需要一个：003 的读层全部经 001 的 `Executor` 执行外部命令 —— **真机调用会冷启动发行版**
 * （001 REQ-2.4 明令禁止自动路径这么做，实测代价 10–12 秒 + 拉起用户全部容器）。
 * 故所有测试一律注入 fake：**零真实进程**，且能精确断言「执行了什么、执行了几次」。
 *
 * 这是 001 `exec.ts` 的 `createExecutor(spawnImpl, treeKillImpl)` 注入点的下游用法 ——
 * 003 换掉的是更上一层（整条命令），比底层注入更贴近被测代码。
 */

import { readFileSync } from 'node:fs';

import type { ErrorCode, ExecOptions, ExecResult, Executor, WslSharedError } from 'dsh-wsl-shared';

/** 一次被记录的调用（断言「执行了什么」时的证据） */
export interface RecordedCall {
  readonly file: string;
  readonly argv: readonly string[];
  readonly options: ExecOptions;
}

export interface FakeExecutor {
  readonly executor: Executor;
  /** 按发生顺序记录的全部调用 */
  readonly calls: RecordedCall[];
}

/** 造一个按 `respond(call, index)` 回话的执行器；不清空、不限制次数 */
export function createFakeExecutor(
  respond: (call: RecordedCall, index: number) => ExecResult | WslSharedError,
): FakeExecutor {
  const calls: RecordedCall[] = [];
  const executor: Executor = async (file, argv, options) => {
    const call: RecordedCall = { file, argv: [...argv], options };
    calls.push(call);
    return respond(call, calls.length - 1);
  };
  return { executor, calls };
}

/** 固定的成功返回 */
export function ok(stdout: string, stderr = ''): ExecResult {
  return { ok: true, exitCode: 0, stdout, stderr };
}

export interface FailureExtra {
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly argv?: readonly string[];
  readonly distros?: readonly string[];
}

/**
 * 造一个 001 口径的失败。
 * 刻意**手搓**而不是用 001 的 `fail()`：`fail` 不在 001 的公开面（8 个运行时导出里没有它），
 * 而 003 只能消费公开面 —— 这也正是「测试里手搓 → 生产里靠 001」这条边界的体现。
 */
export function failure(code: ErrorCode, extra: FailureExtra = {}): WslSharedError {
  return {
    ok: false,
    code,
    message: `stub:${code}`,
    ...(extra.exitCode === undefined ? {} : { exitCode: extra.exitCode }),
    ...(extra.stderr === undefined ? {} : { stderr: extra.stderr }),
    ...(extra.argv === undefined ? {} : { argv: extra.argv }),
    ...(extra.distros === undefined ? {} : { distros: extra.distros }),
  };
}

/** 读真机 fixture（脱敏后入库的原文） */
export function fixtureText(name: string): string {
  return readFileSync(new URL(`../contract/fixtures/${name}`, import.meta.url), 'utf8');
}

/** 读 fixture 的原始字节（`netsh` 的编码事实要用字节断言） */
export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../contract/fixtures/${name}`, import.meta.url)));
}
