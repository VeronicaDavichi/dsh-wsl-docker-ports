/**
 * 有界增量缓冲（002 REQ-6.3 / REQ-6.4 / 任务 T2.3–T2.4）
 *
 * ## 为什么要双上限（块数 + 字节），且两条都真的会被撞到
 *
 * 单看块数挡不住「一块很大」（大段回显/黏贴），单看字节挡不住「大量极小分片刷屏」。两者都留，
 * 并且让两条路径在真实分片规模下**都可能先触发**（见 `../limits.ts` 的配平说明），
 * 这样 `dropped` 的语义在任何流量形态下都是「被丢掉的**块**数」，不会随分片大小漂移。
 *
 * ## `lost` 判定（REQ-6.3）
 *
 * 下界 = 缓冲里最老一块的 `seq`；缓冲为空时下界 = **下一号**（`nextSeq`）
 * —— 后者是关键：空缓冲意味着「所有块都已被丢完」，此时任何 `sinceSeq < nextSeq` 的请求
 * **必须**是 `lost`。若把空缓冲的下界写成「无穷小/0」，慢消费者就会拿到一个空数组却以为没丢东西，
 * 正是 REQ-6.3 明令禁止的「静默丢块」。
 *
 * `read()` 的两种返回**不重叠**：`lost: false` 只表示「你点名的区间都还在」（可以是 0 块 ——
 * 「自上次以来没有新输出」），`lost: true` 表示「你点名的区间已经被丢过，别指望增量」。
 * 快照由上层（屏幕模型）附加，本文件不碰终端。
 */

import { TERM_BUFFER_MAX_BLOCKS, TERM_BUFFER_MAX_BYTES } from '../limits.ts';

/**
 * 一个增量块。`seq` 是**下一号**口径的序号：第一个块拿 1，且「还没有块」时 `nextSeq` 也是 1
 * ⇒ 消费方存下 `nextSeq` 再原样回传，永远不会重复也永远不会跳过。
 */
export interface TermChunk {
  readonly seq: number;
  readonly data: string;
  /** UTF-8 字节数（`TERM_BUFFER_MAX_BYTES` 的计量口径；与「去注释字节数」同一口径，可复算） */
  readonly bytes: number;
}

/** 区间仍在：`chunks` 可为空数组（= 自 `sinceSeq` 以来没有新输出），**不是**丢失 */
export interface TermBufferHit {
  readonly lost: false;
  readonly chunks: readonly TermChunk[];
  /** 下一号（消费方存它作为下次的 `sinceSeq`） */
  readonly nextSeq: number;
  readonly oldestSeq: number;
  readonly dropped: number;
}

/** 区间已被丢弃（REQ-6.3：明确说「已丢失」，**绝不**退化成空数组） */
export interface TermBufferLost {
  readonly lost: true;
  /** 调用方点名的那个 `seq`（回显以便 UI 说清是哪次读丢了） */
  readonly requestedSeq: number;
  /** 缓冲下界：从这里起的块还在 */
  readonly oldestSeq: number;
  readonly nextSeq: number;
  readonly dropped: number;
}

export type TermBufferRead = TermBufferHit | TermBufferLost;

export interface TermBuffer {
  /** 入块；空串**不**入块也不推号（返回 `undefined`），避免垃圾块挤掉真数据 */
  push(data: string): TermChunk | undefined;
  read(sinceSeq?: number): TermBufferRead;
  /** **下一号**（从 1 起；单调递增。丢弃**不**回退它） */
  readonly nextSeq: number;
  /** 缓冲里最老一块的 seq；空缓冲时等于 `nextSeq` */
  readonly oldestSeq: number;
  /** 因上限被 FIFO 丢弃的块数（REQ-6.4 的 `dropped`） */
  readonly dropped: number;
  readonly blocks: number;
  readonly bytes: number;
}

/**
 * 建一个有界缓冲。两个上限可注入 —— 单测靠它把小上限压到几条就能复现丢弃路径，
 * 生产代码用 `../limits.ts` 的命名常量。
 */
export function createTermBuffer(
  maxBlocks: number = TERM_BUFFER_MAX_BLOCKS,
  maxBytes: number = TERM_BUFFER_MAX_BYTES,
): TermBuffer {
  const chunks: TermChunk[] = [];
  let nextSeq = 1;
  let dropped = 0;
  let bytes = 0;

  const oldestSeq = (): number => (chunks.length === 0 ? nextSeq : (chunks[0] as TermChunk).seq);

  return {
    push(data) {
      if (data === '') return undefined;
      const chunk: TermChunk = { seq: nextSeq, data, bytes: Buffer.byteLength(data, 'utf8') };
      nextSeq += 1;
      chunks.push(chunk);
      bytes += chunk.bytes;
      // FIFO 丢弃：块数与字节**任一**超限就从头丢，丢到两个上限都满足为止。
      // 注意允许丢空 —— 单块本身就超过 `maxBytes` 时它自己也会被丢掉（内存「有界」优先于
      // 「尽量留一块」）：此时消费方会拿到 `lost: true` + 快照，比留一个超过上限的块更符合 REQ-6.4。
      while (chunks.length > 0 && (chunks.length > maxBlocks || bytes > maxBytes)) {
        const evicted = chunks.shift() as TermChunk;
        bytes -= evicted.bytes;
        dropped += 1;
      }
      return chunk;
    },

    read(sinceSeq) {
      const oldest = oldestSeq();
      const base = { nextSeq, oldestSeq: oldest, dropped };
      // 缺省 = 「把现在还在的都给我」：从下界起读 ⇒ 永不 lost（这是 `attach` 不带 sinceSeq 的语义）
      if (sinceSeq === undefined) return { lost: false, chunks: [...chunks], ...base };

      const requested = Number.isFinite(sinceSeq) ? Math.trunc(sinceSeq) : oldest;
      if (requested < oldest) return { lost: true, requestedSeq: requested, ...base };
      const start = chunks.findIndex((chunk) => chunk.seq >= requested);
      return { lost: false, chunks: start < 0 ? [] : chunks.slice(start), ...base };
    },

    get nextSeq() {
      return nextSeq;
    },
    get oldestSeq() {
      return oldestSeq();
    },
    get dropped() {
      return dropped;
    },
    get blocks() {
      return chunks.length;
    },
    get bytes() {
      return bytes;
    },
  };
}
