/**
 * T3.4 背压与丢弃（REQ-7.7 / REQ-6.4）
 *
 * 验证（tasks.md 第 109 行）：`vitest` —— 消费者暂停后缓冲触顶 → 触发丢弃策略；
 * 断言**未**出现无界队列（队列长度 ≤ 常量）。
 *
 * 判据用的是 `src/limits.ts` 的命名常量（经 `src/ws/constants.ts` 复用），测试里**不抄数字**：
 * 调参会立刻反映到断言上，而不是让测试悄悄失去意义。
 */

import { describe, expect, it } from 'vitest';
import { createTokenStore } from '../../src/ws/auth.ts';
import { createTerminalChannel } from '../../src/ws/connection.ts';
import type { TextConnection } from '../../src/ws/connection.ts';
import { TERM_WS_QUEUE_MAX_BYTES, TERM_WS_QUEUE_MAX_FRAMES } from '../../src/ws/constants.ts';
import { createOutboundQueue } from '../../src/ws/outbound.ts';
import { createFakeManager, createFakeSink } from '../helpers/ws-fakes.ts';
import type { FakeManager, FakeSink } from '../helpers/ws-fakes.ts';

const ORIGIN = 'http://127.0.0.1:19387';

async function flush(): Promise<void> {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

interface ServerFrame {
  readonly type: string;
  readonly seq?: number;
  readonly data?: string;
  readonly snapshot?: string | null;
}

function framesOf(sink: FakeSink): ServerFrame[] {
  return sink.messages() as ServerFrame[];
}

async function setup(): Promise<{ manager: FakeManager; channel: ReturnType<typeof createTerminalChannel>; sink: FakeSink; conn: TextConnection; token: string }> {
  const manager = createFakeManager();
  manager.add('inst-1');
  const tokens = createTokenStore();
  const channel = createTerminalChannel({ manager: manager.session, tokens, allowedOrigins: [ORIGIN] });
  const sink = createFakeSink();
  const token = tokens.issue();
  const conn = channel.accept(sink, token);
  conn.handleText(JSON.stringify({ type: 'attach', instanceId: 'inst-1', token }));
  await flush();
  sink.clear();
  return { manager, channel, sink, conn, token };
}

describe('T3.4 消费者暂停 ⇒ 有界队列 + 丢弃策略', () => {
  it('触顶后按有界队列丢弃：长度恒等于上限，dropped 增长，标记需要重同步', async () => {
    const { manager, channel, sink, conn } = await setup();
    const total = TERM_WS_QUEUE_MAX_FRAMES + 100;
    for (let index = 0; index < total; index += 1) manager.push('inst-1', `块${index}|`);

    sink.paused = true; // 消费者暂停：第一帧写出即收到背压信号，其后一律排队
    await channel.pump();

    expect(conn.stats.queuedFrames).toBe(TERM_WS_QUEUE_MAX_FRAMES); // == 常量，不是「小于」
    expect(conn.stats.queuedBytes).toBeLessThanOrEqual(TERM_WS_QUEUE_MAX_BYTES);
    expect(conn.stats.dropped).toBeGreaterThan(0);
    expect(conn.stats.needsResync).toBe(true); // 丢弃 ≠ 静默：必须走重同步
    expect(conn.stats.blocked).toBe(true);
    expect(sink.written).toHaveLength(1); // 只有背压前的那一帧真的落到内核
  });

  it('反复 pump 也不增长（无界队列不存在）', async () => {
    const { manager, channel, sink, conn } = await setup();
    for (let index = 0; index < TERM_WS_QUEUE_MAX_FRAMES * 4; index += 1) manager.push('inst-1', `x${index}|`);
    sink.paused = true;
    const samples: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      await channel.pump();
      samples.push(conn.stats.queuedFrames);
    }
    expect(samples.every((length) => length <= TERM_WS_QUEUE_MAX_FRAMES)).toBe(true);
    expect(conn.stats.queuedFrames).toBeLessThan(TERM_WS_QUEUE_MAX_FRAMES * 4); // 不是「攒着不丢」
    expect(conn.stats.dropped).toBeGreaterThan(0);
    // 没有 drain 信号之前，一帧都不许多灌进内核（否则「单轮有界、总量无界」）
    expect(sink.written).toHaveLength(1);
  });

  it('消费者恢复 ⇒ 先排空队列，再用快照重同步（丢失的区间不许静默）', async () => {
    const { manager, channel, sink, conn } = await setup();
    const total = TERM_WS_QUEUE_MAX_FRAMES + 60;
    for (let index = 0; index < total; index += 1) manager.push('inst-1', `块${index}|`);

    sink.paused = true;
    await channel.pump();
    expect(conn.stats.needsResync).toBe(true);
    const droppedBefore = conn.stats.dropped;

    sink.paused = false; // 消费者恢复读取
    conn.drain(); // 宿主在 socket 的 drain 事件上转发（不是 pump 自己 flush）
    sink.clear();
    await channel.pump();

    const frames = framesOf(sink);
    expect(frames.at(-1)?.type).toBe('lost');
    expect(frames.at(-1)?.snapshot).toBe(manager.snapshotTextOf('inst-1')); // 完整快照 ⇒ 客户端可自愈
    expect(conn.stats.queuedFrames).toBe(0);
    expect(conn.stats.needsResync).toBe(false);
    expect(conn.stats.dropped).toBe(droppedBefore); // 恢复过程中不再丢

    // 重同步之后游标已经推到快照的 seq，后续新块继续按 seq 推（不回退、不重复）
    const snapshotSeq = frames.at(-1)?.seq ?? 0;
    manager.push('inst-1', '尾部增量');
    sink.clear();
    await channel.pump();
    const chunk = framesOf(sink).find((frame) => frame.type === 'chunk');
    expect(chunk?.seq).toBe(snapshotSeq);
    expect(chunk?.data).toBe('尾部增量');
  });
});

describe('T3.4 出站队列单元判据', () => {
  it('触顶丢新帧 + flush 排空（块数上限）', () => {
    const sink = createFakeSink();
    const queue = createOutboundQueue(sink, { maxFrames: 2, maxBytes: 100 });
    sink.paused = true;
    expect(queue.enqueue('a')).toBe('sent'); // 数据已进内核，但内核已满 ⇒ 从此 blocked
    expect(queue.enqueue('b')).toBe('queued');
    expect(queue.enqueue('c')).toBe('queued');
    expect(queue.enqueue('d')).toBe('dropped');
    expect(queue.stats).toMatchObject({ queuedFrames: 2, dropped: 1, needsResync: true, blocked: true });

    sink.paused = false;
    expect(queue.flush()).toBe(2);
    expect(queue.stats.queuedFrames).toBe(0);
    expect(queue.stats.queuedBytes).toBe(0);
    expect(queue.stats.blocked).toBe(false);
    expect(queue.stats.dropped).toBe(1);
  });

  it('字节上限独立生效（单帧很大时块数还没满也要丢）', () => {
    const sink = createFakeSink();
    const queue = createOutboundQueue(sink, { maxFrames: 100, maxBytes: 10 });
    sink.paused = true;
    queue.enqueue('aaaa');
    expect(queue.enqueue('bbbb')).toBe('queued');
    expect(queue.stats.queuedBytes).toBe(4);
    expect(queue.enqueue('cccccccc')).toBe('dropped'); // 4 + 8 > 10
    expect(queue.stats.queuedBytes).toBe(4);
  });

  it('默认上限取自命名常量：一万次入队后长度仍等于常量（T3.4 的硬判据）', () => {
    const sink = createFakeSink();
    const queue = createOutboundQueue(sink);
    sink.paused = true;
    for (let index = 0; index < 10_000; index += 1) queue.enqueue(`帧${index}`);
    expect(queue.maxFrames).toBe(TERM_WS_QUEUE_MAX_FRAMES);
    expect(queue.maxBytes).toBe(TERM_WS_QUEUE_MAX_BYTES);
    expect(queue.stats.queuedFrames).toBe(TERM_WS_QUEUE_MAX_FRAMES);
    expect(queue.stats.queuedFrames).toBeLessThanOrEqual(TERM_WS_QUEUE_MAX_FRAMES);
    expect(queue.stats.queuedBytes).toBeLessThanOrEqual(TERM_WS_QUEUE_MAX_BYTES);
    expect(queue.stats.dropped).toBe(10_000 - 1 - TERM_WS_QUEUE_MAX_FRAMES);
  });

  it('markResync / clearResync 是显式开关（会话层 lost 也要能主动标记）', () => {
    const sink = createFakeSink();
    const queue = createOutboundQueue(sink, { maxFrames: 4, maxBytes: 1024 });
    expect(queue.stats.needsResync).toBe(false);
    queue.markResync();
    expect(queue.stats.needsResync).toBe(true);
    queue.clearResync();
    expect(queue.stats.needsResync).toBe(false);
  });
});
