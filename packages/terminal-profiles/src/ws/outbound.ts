/**
 * 有界待发队列 + 丢弃策略（002 T3.4 / REQ-7.7）
 *
 * ## 为什么必须有这一层
 *
 * `socket.write()` 返回 `false` 时数据**已经进内核缓冲**，但继续写就会让内核缓冲无限增长 ——
 * 消费者（浏览器标签页被切走/被挂起）不再读，宿主事件循环的内存就跟着涨。这是 REQ-7.7
 * 明令禁止的「无界排队」。所以：看到 `false` 就**停止写**（`blocked`），把后续帧放进**有界**队列，
 * 等 `flush()`（= 宿主在 `drain` 时调用）再放行。
 *
 * ## 丢弃策略
 *
 * 队列触顶（块数**或**字节，双界）时**丢新帧**并置 `needsResync`：
 * 通道层随后会下发一条 `lost { snapshot }`（REQ-6.3 的「明确说已丢失 + 附快照」），
 * 所以丢哪一段都不会让客户端停留在**静默有洞**的屏幕上 —— 这是「丢弃」与「静默丢块」的区别，
 * 也是 T3.4 断言 `needsResync === true` 的意义。
 *
 * 丢**新**帧而不是丢最旧：队列里已有的帧更接近客户端当前状态，而重同步无论如何都会覆盖屏幕，
 * 两者都不影响正确性；丢新帧的实现不需要移动数组，且「触顶后队列长度恒等于上限」（可二值断言）。
 */

import { TERM_WS_QUEUE_MAX_BYTES, TERM_WS_QUEUE_MAX_FRAMES } from './constants.ts';
import type { FrameSink } from './types.ts';

const encoder = new TextEncoder();

export type EnqueueOutcome = 'sent' | 'queued' | 'dropped';

export interface OutboundStats {
  /** 当前排队帧数（**上界** = `maxFrames`，T3.4 的判据） */
  readonly queuedFrames: number;
  /** 当前排队字节数（**上界** = `maxBytes`） */
  readonly queuedBytes: number;
  /** 累计丢弃帧数（UI/日志可见，口径同会话层的 `dropped`） */
  readonly dropped: number;
  /** 是否需要用快照重同步（丢弃后为 true，直到 `clearResync`） */
  readonly needsResync: boolean;
  /** 消费者是否处于背压暂停态（`write` 返回过 false 且还没 drain） */
  readonly blocked: boolean;
}

export interface OutboundQueue {
  readonly maxFrames: number;
  readonly maxBytes: number;
  /** 送一帧；`dropped` 表示触顶丢弃（调用方**必须**接受，不许改写成阻塞等待） */
  enqueue(text: string): EnqueueOutcome;
  /** 消费者恢复（`drain`）时调用；返回本次实际写出的帧数 */
  flush(): number;
  /** 已用快照补齐丢失区间后调用 */
  clearResync(): void;
  /** 主动标记需要重同步（如会话层报了 `lost`） */
  markResync(): void;
  readonly stats: OutboundStats;
}

export interface OutboundQueueOptions {
  readonly maxFrames?: number | undefined;
  readonly maxBytes?: number | undefined;
}

export function createOutboundQueue(sink: FrameSink, options: OutboundQueueOptions = {}): OutboundQueue {
  const maxFrames = options.maxFrames ?? TERM_WS_QUEUE_MAX_FRAMES;
  const maxBytes = options.maxBytes ?? TERM_WS_QUEUE_MAX_BYTES;
  const pending: string[] = [];
  let pendingBytes = 0;
  let dropped = 0;
  let needsResync = false;
  let blocked = false;

  const withinLimits = (addingBytes: number): boolean =>
    pending.length + 1 <= maxFrames && pendingBytes + addingBytes <= maxBytes;

  const enqueue = (text: string): EnqueueOutcome => {
    const bytes = encoder.encode(text).length;
    if (!blocked) {
      const accepted = sink.write(text);
      // false 只表示「内核满了」，数据本身已被接受 ⇒ 不能重复入队
      if (!accepted) blocked = true;
      return 'sent';
    }
    if (withinLimits(bytes)) {
      pending.push(text);
      pendingBytes += bytes;
      return 'queued';
    }
    dropped += 1;
    needsResync = true;
    return 'dropped';
  };

  const flush = (): number => {
    blocked = false;
    let sent = 0;
    while (pending.length > 0) {
      const next = pending.shift();
      if (next === undefined) break;
      pendingBytes -= encoder.encode(next).length;
      sent += 1;
      if (!sink.write(next)) {
        blocked = true;
        break; // 内核又满了：停在 drain 处，不许继续灌
      }
    }
    if (pendingBytes < 0) pendingBytes = 0;
    return sent;
  };

  return {
    maxFrames,
    maxBytes,
    enqueue,
    flush,
    clearResync: () => {
      needsResync = false;
    },
    markResync: () => {
      needsResync = true;
    },
    get stats(): OutboundStats {
      return { queuedFrames: pending.length, queuedBytes: pendingBytes, dropped, needsResync, blocked };
    },
  };
}
