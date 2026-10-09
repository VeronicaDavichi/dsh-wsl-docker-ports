/**
 * 失败结果的构造出口（002 任务 T2.2 / REQ-3.3 / REQ-3.5）
 *
 * 只做两件事：把任意 `catch` 到的东西变成**可读一句**（`describeError`），以及唯一地拼装
 * `SessionFailure`（`fail`）。**别处不许手搓 `ok: false` 对象** —— REQ-3.3 要的是「错误里指出该路径」，
 * 若每个失败点各自拼消息，就一定会漏掉某条路径上的 `cwd`。
 */

import type { SessionFailure, SessionFailureCode } from './types.ts';

/**
 * 把 `unknown` 变成可读一句。
 *
 * ⚠️ 为什么不能只写 `String(error)`：node-pty / ConPTY 的启动失败常常抛**非 Error**（原生层回传的
 * 字符串或数字码），而 `String(new Error('x'))` 会得到 `"Error: x"` 这种把类型名混进人话的结果。
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message === '' ? error.name : error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    // 循环引用 / BigInt 等：JSON.stringify 会抛，退到最朴素的一层
    return String(error);
  }
}

/** `fail` 的可选补充（都用 spread 传，避免 `exactOptionalPropertyTypes` 下的显式 `undefined`） */
export interface FailureExtras {
  readonly hint?: string;
  readonly cwd?: string;
  readonly upstreamCode?: string;
}

/** 唯一失败构造出口。**空消息是被禁止的**（REQ-3.5：UI 必须看到原因） */
export function fail(code: SessionFailureCode, message: string, extras: FailureExtras = {}): SessionFailure {
  return { ok: false, code, message, ...extras };
}

/**
 * `spawnTerminal` 调用端抛错后的统一包装（T2.2 的核心断言点）。
 *
 * 四件事必须同时出现在消息里，少一件测试就会放过一个静默退化：
 * ① 被启动的**程序**（`argv[0]`，REQ-3.5 的「含被拒绝的能力名」在这里落成可定位的程序名）；
 * ② **那个 cwd**（REQ-3.3 原文：错误里指出该路径）；
 * ③ 宿主原始原因（诊断靠它，不要吞掉）；
 * ④ 「未回落」这句话 —— 它是**给人看的契约声明**：用户看到的不该是「在别的目录里跑起来了」。
 */
export function spawnFailureMessage(spec: { argv: readonly string[]; cwd: string }, error: unknown): string {
  const program = spec.argv[0] ?? '(空 argv)';
  return (
    `启动终端失败：程序「${program}」或工作目录「${spec.cwd}」不可用 —— ${describeError(error)}。` +
    '未回落到 Session 工作区或 $HOME。'
  );
}
