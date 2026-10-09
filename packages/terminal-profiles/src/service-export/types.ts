/**
 * 002 T7.1 —— `managedTerminal` 服务面的**契约声明**（唯一真相 = design.md §5 的表格）
 *
 * ## 为什么失败是「可读结果」而不是抛异常
 *
 * design §5 的「失败」列写的是 **typed error**。本包已有两套既成口径：
 * ① 会话层（`../session/types.ts`）与 001 的 `ok` 判别联合 —— **返回**可读失败；
 * ② 工具层（004，`../tools/failure.ts`）—— **抛出**，因为宿主 `execute` 只把「抛」归一化成
 *    `isError: true`。
 * 服务面的消费方是 **003 的程序化调用**（不是模型、不经过宿主的工具体归一化）⇒ 走 ①：
 * **一律返回**，绝不抛。这样 003 的调用点写一次 `if (!result.ok)` 就能覆盖全部失败。
 *
 * ## 为什么这里另起一个 `ServiceFailure`（与 `SessionFailure` 结构相同）
 *
 * 需要多三个码：`profile-not-found`（§5 的「profile 不存在」，本层按名查找才有）、
 * `sandbox-denied`（§5 的「沙箱拒绝」）、`internal`（端口抛出未预期错误的兜底 —— 有它才能保证
 * 「服务面不抛裸 `Error`」这条对**任何**输入都成立）。而 `../session/**` 是本任务的**冻结边界**
 * （不许改）⇒ 用 `Omit<SessionFailure, 'code'>` 派生：字段**跟着会话层走**，将来那边加字段这里
 * 自动跟上，不会漂移成两套形状。
 *
 * ⚠️ `SessionFailureCode` 里已经有的码（`not-startable` / `cwd-missing` / `cwd-unmappable` /
 * `spawn-failed` / `instance-not-found` / `resize-failed` / `write-failed`）**原样透传**（NFR-3），
 * 服务面不翻译、不换词。
 */

import type { TerminalRead, KillOutcome } from '../session/manager.ts';
import type { SessionFailure, SessionFailureCode, TerminalInstanceSummary } from '../session/types.ts';
import type { TerminalSize } from '../limits.ts';

/**
 * 服务名（design §5 与 §15 的架构图**字面**）。
 *
 * 🔴 逐字不可改：003 是 `ctx.inject(['managedTerminal'], …)` 按**字符串键**注入的（L3 约束：
 * 不建包依赖边，只认这个名字）。`tests/unit/service-surface.test.ts` 有一条契约测试钉死字面量。
 */
export const MANAGED_TERMINAL_SERVICE = 'managedTerminal';

/** 服务面失败码 = 会话层全部码 + 服务面独有的三个（见文件头） */
export type ServiceFailureCode =
  /** profile 名不在当前配置里（§5 `open` 的第一条失败）*/
  | 'profile-not-found'
  /** 沙箱策略拒绝（§5 `open`/写路径的失败；门禁实现见 `../plugin.ts` 的 guard 端口）*/
  | 'sandbox-denied'
  /** 端口抛出本层未预料的错误（有它才能兑现「不抛裸 Error」）*/
  | 'internal'
  | SessionFailureCode;

/** 可读失败（字段集与会话层一致，只放宽 `code`） */
export type ServiceFailure = Omit<SessionFailure, 'code'> & { readonly code: ServiceFailureCode };

/** 结果载体（与 001 / 会话层同一形状，调用方不用学第二套） */
export type ServiceResult<T> = { readonly ok: true; readonly value: T } | ServiceFailure;

/**
 * `open` 的入参。
 *
 * `profile` 是 **profile 名**（不是配置对象）：§5 的失败列有「profile 不存在」⇒ 必然有一次
 * 按名查找；且 003 不该持有 002 的配置对象（L3）。与 004 的 `managed_terminal_new` 工具**同一口径**（`profile: string`）。
 */
export interface OpenTerminalRequest {
  readonly profile: string;
  /**
   * 只影响**本次新建实例**（REQ-2.4 的语义），落在 profile 本来就用的那个 cwd 槽位：
   * WSL profile（`command` 是 `wsl.exe`）⇒ 替换 `cwdLinux`；其余 ⇒ 替换 `cwd`。
   * 空串/全空白**不接受**（PTY 拿到空 cwd 是未定义行为）⇒ 立即 `cwd-missing`。
   */
  readonly cwdOverride?: string | undefined;
}

/** `read` 的入参（字段名与 004 的工具面、会话层的 `ReadOptions` 逐字一致） */
export interface ReadTerminalRequest {
  readonly id: string;
  readonly mode?: 'snapshot' | 'incremental' | undefined;
  readonly sinceSeq?: number | undefined;
  readonly scrollbackLines?: number | undefined;
}

export interface WriteTerminalRequest {
  readonly id: string;
  readonly data: string;
}

/**
 * `resize` 的入参：**行在前**（§5 字面）。
 *
 * 🔴 换序与夹紧**都不在本层**：唯一发生点是 `../session/manager.ts` 的 `resize(id, rows, cols)`
 * （那里才调宿主的 `resize(cols, rows)` 并夹紧）。本层只做「同名字段转发」，连一次 `clampSize`
 * 都不再写 —— 两处换序就是「静默转置」的唯一来源（design §11）。
 */
export interface ResizeTerminalRequest {
  readonly id: string;
  readonly rows: number;
  readonly cols: number;
}

export interface KillTerminalRequest {
  readonly id: string;
}

/**
 * 订阅回调收到的值：**与 `read` 同一个形状**（`ServiceResult<TerminalRead>`）。
 *
 * 为什么不是「第三种事件类型」：§5 给 `subscribe` 的失败列是「—」，但实例被 kill / 读失败这两条
 * 路径**真的会发生**。发明 `{kind:'closed'}` 之类就等于给 003 造第二套词汇；而 `ServiceResult`
 * 已经带了判别式 `ok` ⇒ 复用它可以做到「零新词汇、失败不静默」。实例消失时回调收到一次
 * `ok:false` 的失败，然后订阅**自动注销**（监听数归零）。
 */
export type TerminalSubscriptionUpdate = ServiceResult<TerminalRead>;

/** 订阅回调（同步调用；抛错由服务面吞掉，不影响其它订阅者与定时器） */
export type TerminalSubscriber = (update: TerminalSubscriptionUpdate) => void;

/**
 * `managedTerminal` 服务面 —— **恰好 7 个方法**（design §5 的表逐行对应）。
 *
 * ⚠️ 这个接口**就是** `ctx.provide('managedTerminal', …)` 里那个对象的类型：不许挂任何额外成员
 * （003 只应看到 §5 的 7 个；多出来的东西会变成事实上的第二份契约）。
 */
export interface ManagedTerminalService {
  open(request: OpenTerminalRequest): Promise<ServiceResult<{ readonly id: string }>>;
  list(): readonly TerminalInstanceSummary[];
  read(request: ReadTerminalRequest): Promise<ServiceResult<TerminalRead>>;
  write(request: WriteTerminalRequest): Promise<ServiceResult<{ readonly written: number }>>;
  resize(request: ResizeTerminalRequest): Promise<ServiceResult<TerminalSize>>;
  kill(request: KillTerminalRequest): Promise<ServiceResult<KillOutcome>>;
  /** 返回 **unsubscribe**（幂等；可重复调用）*/
  subscribe(id: string, listener: TerminalSubscriber): () => void;
}
