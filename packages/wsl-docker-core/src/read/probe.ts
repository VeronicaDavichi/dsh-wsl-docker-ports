/**
 * 只读探针（docker / netsh / `.wslconfig`）的**统一失败态**（003 REQ-1.3 / REQ-2.3 / REQ-3.5 / design §10）
 *
 * ## 为什么不用 001 的 `WslSharedError`
 *
 * 001 的 `code` 是 11 个值的**枚举**，且 SSoT 在 `packages/wsl-shared/src/errors.ts`（003 不得改）。
 * 而 003 要区分的是**领域原因**（docker 未安装 / daemon 未运行 / 权限不足 / 输出形态不可识别 …），
 * 它们不是 001 的错误码；硬塞进去会让两侧的语义都不干净。故这里是**独立的判别联合**，
 * 但把 001 的原始错误原样带在 `cause` 里（argv / exitCode / stderr 一个不丢）。
 *
 * ## 三条硬口径（缺一不可）
 *
 * 1. **失败绝不返回空集合** —— REQ-1.3 明令「SHALL NOT 用空列表冒充『没有容器』」：
 *    失败就是 `ok: false`，UI 必须能分辨「读失败」与「真的一个都没有」。
 * 2. **可区分**：`reason` 是判别式，`hint` 是对应的引导文案（REQ-2.3 要求三种 docker 失败各给引导）。
 * 3. **保留证据**：`raw` 是**脱敏后**的原始输出（REQ-3.5「展示脱敏后的原始输出」），
 *    只在「形态不可识别」时有值 —— 那是唯一能让人自己看出哪里不对的东西。
 */

import type { WslSharedError } from 'dsh-wsl-shared';

/** 统一的失败态（`Reason` 由各探针收窄成自己的字面量联合） */
export interface ProbeFailure<Reason extends string = string> {
  readonly ok: false;
  readonly reason: Reason;
  /** 给人看的一句话（可直接进 UI 文案） */
  readonly message: string;
  /** 修复引导（REQ-2.3：三类失败必须给**不同**的引导）；无引导时是空串，不是 `undefined` */
  readonly hint: string;
  /** 001 的原始错误（带 argv / exitCode / stderr）；003 自己判出来的失败（如解析失败）为 `null` */
  readonly cause: WslSharedError | null;
  /** 脱敏后的原始输出（REQ-3.5）；不涉及原始输出时为 `null` */
  readonly raw: string | null;
  /** 实际执行的完整命令行（含 `wsl.exe` / `netsh.exe`），供 UI 展示「将执行什么」 */
  readonly argv: readonly string[] | null;
}

/**
 * `probeFailure()` 的入参：只写关心的字段，其余统一落成 `null` / 空串。
 * `raw` / `argv` 显式允许 `null`：调用方手里常常就是「有或没有」的值，
 * 逼它写成条件展开只会把同一段样板抄到每个探针里。
 */
export interface ProbeFailureParts<Reason extends string> {
  readonly reason: Reason;
  readonly message: string;
  readonly hint?: string;
  readonly cause?: WslSharedError;
  readonly raw?: string | null;
  readonly argv?: readonly string[] | null;
}

/**
 * 唯一的失败工厂。
 *
 * 存在的理由与 001 的 `fail()` 相同：**避免各处手搓对象导致字段漂移**，
 * 同时把 `exactOptionalPropertyTypes` 的坑挡在一处 —— 可选字段这里一律落成显式 `null`，
 * 下游就不必区分「没有这个信息」与「值就是空」（`undefined` 在 UI 上是空白，`null` 是「无」）。
 */
export function probeFailure<Reason extends string>(parts: ProbeFailureParts<Reason>): ProbeFailure<Reason> {
  return {
    ok: false,
    reason: parts.reason,
    message: parts.message,
    hint: parts.hint ?? '',
    cause: parts.cause ?? null,
    raw: parts.raw ?? null,
    argv: parts.argv ?? null,
  };
}
