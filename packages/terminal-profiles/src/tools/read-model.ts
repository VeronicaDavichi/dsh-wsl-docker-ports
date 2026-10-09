/**
 * 读模型接线（004 REQ-2.1–2.4 / T1.4）：**直接映射** 002 的屏幕模型，不自建缓冲与序号
 *
 * ## 这个文件里**没有**任何缓冲、序号或屏幕状态
 *
 * 它只有「形状搬运」：`snapshot` → 原样透出；`incremental` → 原样透出（含 `lost` 与 `snapshot`）；
 * 002 的失败 → 原样转成工具失败（码与文案都由 002 给，**不重写**）。NFR-3「SHALL NOT 复制 002 的
 * 业务逻辑」在这里是**结构上**成立的 —— 没有第二份 `seq` 计数、没有第二个 `T | undefined` 判定，
 * 所以两处口径不可能漂移。
 *
 * ## 为什么 `lost` 的语义不用我们判
 *
 * REQ-2.2 明写「`sinceSeq` 早于缓冲下界 ⇒ `lost: true` + 快照（**不**返回空数组冒充无输出）」，
 * 而「早于下界」只能由 002 的有界缓冲判定（它才知道自己丢了什么）。工具面若自己判（例如
 * `sinceSeq < 1` 就当丢失）就会造出与 002 不一致的第二套口径 ⇒ 本层一律**照抄** `lost`。
 */

import type { SessionManager, TerminalRead } from '../session/manager.ts';
import { fail } from './failure.ts';

/** 002 `read` 的结果（`TerminalRead` 的别名：本文件只搬运，不改语义） */
export type SessionRead = TerminalRead;

/**
 * 002 失败 → 工具失败。`code` **原样透传**（002 的 `SessionFailureCode` 与 design §5 是同一套词汇，
 * 见 `../session/types.ts` 的文件头），只补一句「谁拒绝的」以免模型把 `spawn-failed` 当成工具坏了。
 *
 * 🔴 `instance-not-found` 时**必须**补上「用 list 看有哪些实例」：002 的 hint 是给 UI 看的
 * （「当前没有任何实例」），对 Agent 而言「读不到某个 id」最需要的动作是列举现存的 id
 * （T1.4 的「指向 list」）。这是本层唯一改写 hint 的地方，改的是**动作**、不是 002 的判断。
 */
function failFromSession(tool: string, failure: { code: string; message: string; hint?: string; cwd?: string }): never {
  const cwd = failure.cwd === undefined ? '' : `（PTY cwd：${failure.cwd}）`;
  const hint = failure.code === 'instance-not-found'
    ? `先用 list 看看当前有哪些实例 id（实例可能已被 kill 或从未创建）。${failure.hint ?? ''}`
    : failure.hint;
  return fail(failure.code, `${tool}：${failure.message}${cwd}`, hint);
}

/**
 * 调 002 的 `read` 并把结果搬成工具值。
 *
 * `options.mode` 缺省 = `snapshot`（design §2 的默认；决策：一次读默认要「现在长什么样」）。
 * `scrollbackLines` 不暴露给模型（002 的默认就是有界尾部，REQ-6.2）。
 */
export async function readViaSession(
  manager: SessionManager,
  id: string,
  options: { readonly mode: 'snapshot' | 'incremental'; readonly sinceSeq?: number | undefined },
): Promise<unknown> {
  const result = await manager.read(
    id,
    options.mode === 'incremental'
      ? { mode: 'incremental', ...(options.sinceSeq === undefined ? {} : { sinceSeq: options.sinceSeq }) }
      : { mode: 'snapshot' },
  );
  if (!result.ok) return failFromSession('read', result);
  const read = result.value;
  if (read.mode === 'snapshot') return { mode: 'snapshot', snapshot: read.snapshot };
  if (!read.lost) {
    return { mode: 'incremental', lost: false, chunks: read.chunks, seq: read.seq, dropped: read.dropped };
  }
  return {
    mode: 'incremental',
    lost: true,
    snapshot: read.snapshot,
    requestedSeq: read.requestedSeq,
    oldestSeq: read.oldestSeq,
    seq: read.seq,
    dropped: read.dropped,
  };
}

/** 002 的失败也用于 `write` / `resize` / `kill` / `new` —— 同一个透传点，形状统一 */
export function failFromSessionResult(
  tool: string,
  failure: { code: string; message: string; hint?: string; cwd?: string },
): never {
  return failFromSession(tool, failure);
}
