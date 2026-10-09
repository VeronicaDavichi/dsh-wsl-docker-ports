/**
 * 工具面的失败词汇（004 REQ-4.1 / REQ-4.3；design §5）
 *
 * ## 🔴 为什么失败**以抛出**呈现，而不是 `return { ok: false, … }`
 *
 * design §5 的字面写法是「返回 `{ ok: false, code, message, hint? }` 的可读结果」。**本实现没有
 * 照字面做**，理由是宿主契约（A-1 复核 + `ToolRuntime.createSuccessResult` 源码）：
 *
 * - `execute` **正常返回**的任何值都会被当成**成功**值 → 结果是 `isError: false`；
 * - 只有**抛出**才会被宿主归一化成 `isError: true` 的可读结果（`Error: <msg>`）且不中断会话。
 *
 * 而 T3.1 的验收（2026-10-09 订正后的口径）明写「**失败必须呈现为 `isError: true` 的可读结果**」。
 * 两者只能选一个：选后者（本实现）⇒ `code` / `hint` 必须**在消息文本里**可读，所以
 * `ToolFailureError.message` 的形状被固定为 **`[<code>] <人话>` +（有 hint 时）` — 提示：<hint>`**。
 * 这条形状有两个消费方：模型（读懂并自救）与测试（按 `code` 断言），且**不**依赖任何宿主私有字段。
 *
 * ⚠️ **唯一的例外是审批取消**（REQ-3.5）：它**不是**系统错误 ⇒ 它**不抛**，而是作为正常值返回
 * （`{ ok:false, code:'cancelled', message, hint }`，形状见 `./schemas.ts` 的 `CANCELLED_OUTPUT`）。
 * 这是 design §5 表格里「审批取消 —— **不是** error 语义」那一行的直接落地。
 *
 * ## design §5 表格里唯一不流经本文件的码：`invalid-args`
 *
 * 设计表的「参数非法」一行由 `defineTool` 的 schema 在**进体之前**拦下（REQ-1.8），
 * 那时 `execute` 还没被调用 ⇒ 我们**不可能**给它套上 `[invalid-args]` 前缀，也拿不到改写
 * `ToolArgsError` 的钩子（它由 `dsh-tools` 抛）。⇒ 本文件**不**收编该码：
 * 参数违规的对外形状就是宿主的 `invalid arguments: …`（可读、且在业务逻辑前）。
 * 把它写成我们自己的码只会制造一个「文档说 A、运行时是 B」的假契约。
 */

/** 工具失败码（design §5 的六行 + 002 透传的码；**与 002 的 `SessionFailureCode` 同一套词汇**） */
export type ToolFailureCode =
  /** profile 名不在配置里（REQ-1.2） */
  | 'profile-not-found'
  /** 实例 id 不在实例表里（REQ-1.7） */
  | 'instance-not-found'
  /** 沙箱策略拒绝（REQ-3.1 / REQ-3.4） */
  | 'sandbox-denied'
  /** 审批被拒 / 撤回 / 无人可问（REQ-3.5；**非 error 语义**，见文件头） */
  | 'cancelled'
  /** 未识别的按键名（REQ-4.2） */
  | 'unknown-key'
  /** 002 侧的失败（`not-startable` / `cwd-missing` / `cwd-unmappable` / `spawn-failed` /
   *  `resize-failed` / `write-failed` / `instance-not-found`）**原样透传**（NFR-3） */
  | string;

/** `code` + 人话 + 可选 hint 的失败值（**只**用于取消这一条非 error 路径） */
export interface ToolFailureValue {
  readonly ok: false;
  readonly code: ToolFailureCode;
  readonly message: string;
  readonly hint?: string;
}

/**
 * 失败消息的形状（**唯一**构造点：`formatFailure`）。
 *
 * 为什么把 `code` 塞进**方括号前缀**而不是句尾：模型读到的文本常常被截断/折叠展示，
 * 前缀是唯一「一定看得见」的位置；同时它让测试可以 `expect(message).toContain('[sandbox-denied]')`
 * 而不必解析自然语言。
 */
export function formatFailure(code: ToolFailureCode, message: string, hint?: string): string {
  const head = `[${code}] ${message}`;
  return hint === undefined || hint === '' ? head : `${head} — 提示：${hint}`;
}

/**
 * 工具面的失败（**唯一**的失败载体）。
 *
 * `name` 固定为 `ToolFailureError`：宿主把它归一化成 `Error: <message>`，于是模型看到的是
 * `Error: [sandbox-denied] …` —— 前缀仍在，仍然是可读结果。
 */
export class ToolFailureError extends Error {
  readonly code: ToolFailureCode;
  readonly hint: string | undefined;

  constructor(code: ToolFailureCode, message: string, hint?: string) {
    super(formatFailure(code, message, hint));
    this.name = 'ToolFailureError';
    this.code = code;
    // `exactOptionalPropertyTypes` 下不能把 `undefined` 直接赋给 `hint?: string`
    this.hint = hint;
  }
}

/** 抛一个可读失败（工具层的唯一失败出口） */
export function fail(code: ToolFailureCode, message: string, hint?: string): never {
  throw new ToolFailureError(code, message, hint);
}

/** 失败值构造（**只**给取消路径用；其余一律 `fail()`） */
export function cancelledValue(
  code: ToolFailureCode,
  message: string,
  hint?: string,
): ToolFailureValue {
  return hint === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, hint };
}

/**
 * `data` 的键名路径：未知键名 → `unknown-key`（REQ-4.2 的「不猜、不丢弃」）。
 * 附**已支持键名清单**（REQ-4.3 的「可执行的下一步」）。
 */
export function unknownKeyFailure(name: string, supported: readonly string[]): never {
  return fail(
    'unknown-key',
    `未识别的按键名「${name}」`,
    `已支持：${supported.join('、')}。要发字面文本请直接给字符串（例如 "ls -la"）。`,
  );
}
