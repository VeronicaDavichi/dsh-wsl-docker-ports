/**
 * T2.3 / T2.4 的**纯缓冲层**：双上限 FIFO 丢弃、`dropped` 累计、`lost` 判定
 * （002 REQ-6.3 / REQ-6.4）
 *
 * 为什么把缓冲单独测：屏幕模型那层要真跑 xterm headless，很难把「块数上限」和「字节上限」分别
 * 压到边界上；而 REQ-6.4 要求**两个**上限都真的有界，所以两条丢弃路径各要有独立证据。
 * 上限是 `createTermBuffer(maxBlocks, maxBytes)` 的入参 —— 测试用小上限复现，生产用命名常量。
 */

import { describe, expect, it } from 'vitest';

import { TERM_BUFFER_MAX_BLOCKS, TERM_BUFFER_MAX_BYTES, createTermBuffer } from '../../src/index.ts';

/** 上限大得打不到（用来单独验另一条上限） */
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

describe('T2.3 有界缓冲（REQ-6.4）', () => {
  it('正常：未超限时 blocks / bytes / nextSeq 如实累计，seq 从 1 起单调递增', () => {
    const buffer = createTermBuffer(10, 1000);

    const first = buffer.push('abc');
    const second = buffer.push('де');

    expect(first?.seq).toBe(1);
    expect(second?.seq).toBe(2);
    expect(second?.bytes).toBe(Buffer.byteLength('де', 'utf8')); // 非 ASCII 走 UTF-8 字节数，不是字符数
    expect(buffer.blocks).toBe(2);
    expect(buffer.bytes).toBe(3 + 4);
    expect(buffer.nextSeq).toBe(3);
    expect(buffer.oldestSeq).toBe(1);
    expect(buffer.dropped).toBe(0);
  });

  it('正常：空串不入块、不推号（避免垃圾块挤掉真数据）', () => {
    const buffer = createTermBuffer(10, 1000);

    expect(buffer.push('')).toBeUndefined();
    expect(buffer.blocks).toBe(0);
    expect(buffer.nextSeq).toBe(1);
    expect(buffer.dropped).toBe(0);
  });

  it('边界：块数超上限 ⇒ FIFO 丢**最老的**，dropped = 丢掉的块数，块数 ≤ 上限', () => {
    const buffer = createTermBuffer(3, UNBOUNDED);

    for (let i = 1; i <= 10; i += 1) buffer.push(`chunk-${i}`);

    expect(buffer.blocks).toBe(3); // 内存不随写入线性增长
    expect(TERM_BUFFER_MAX_BLOCKS).toBeGreaterThan(0); // 生产常量仍是命名常量（REQ-6.4）
    expect(buffer.dropped).toBe(7);
    expect(buffer.nextSeq).toBe(11); // 丢弃**不**回退序号
    expect(buffer.oldestSeq).toBe(8); // 还在的是 chunk-8/9/10
    const read = buffer.read(1);
    expect(read.lost).toBe(true);
  });

  it('边界：**字节**超上限也走同一条 FIFO 丢弃路径（两条上限各自有界）', () => {
    const buffer = createTermBuffer(UNBOUNDED, 10);

    buffer.push('aaaa'); // 4
    buffer.push('bbbb'); // 8
    buffer.push('cccc'); // 12 > 10 ⇒ 丢最老的 ⇒ 8
    expect(buffer.bytes).toBe(8);
    expect(buffer.dropped).toBe(1);
    expect(buffer.oldestSeq).toBe(2);

    buffer.push('dddd'); // 12 ⇒ 再丢一个 ⇒ 8
    expect(buffer.bytes).toBe(8);
    expect(buffer.dropped).toBe(2);
    expect(buffer.blocks).toBe(2);
    expect(TERM_BUFFER_MAX_BYTES).toBeGreaterThan(0);
  });

  it('边界：单块本身就超过字节上限 ⇒ 它**自己**也被丢（「有界」优先于「尽量留一块」）', () => {
    const buffer = createTermBuffer(UNBOUNDED, 4);

    buffer.push('aaaaa'); // 5 字节 > 4

    expect(buffer.blocks).toBe(0);
    expect(buffer.bytes).toBe(0);
    expect(buffer.dropped).toBe(1);
    expect(buffer.oldestSeq).toBe(buffer.nextSeq); // 空缓冲的下界就是下一号
  });
});

describe('T2.4 lost 语义（REQ-6.3）', () => {
  it('正常：sinceSeq 合法 ⇒ 只回该序号起的块（不重复、不遗漏）', () => {
    const buffer = createTermBuffer(10, 1000);
    buffer.push('one');
    buffer.push('two');
    buffer.push('three');

    const read = buffer.read(2);

    expect(read.lost).toBe(false);
    expect(read.lost === false && read.chunks.map((c) => c.data)).toStrictEqual(['two', 'three']);
    expect(read.lost === false && read.chunks.map((c) => c.seq)).toStrictEqual([2, 3]);
    expect(read.nextSeq).toBe(4);
  });

  it('正常：sinceSeq = nextSeq ⇒ lost:false 且**零块**（「没有新输出」不是丢失）', () => {
    const buffer = createTermBuffer(10, 1000);
    buffer.push('one');

    const read = buffer.read(buffer.nextSeq);

    expect(read.lost).toBe(false);
    expect(read.lost === false && read.chunks).toStrictEqual([]);
  });

  it('正常：sinceSeq 缺省 ⇒ 给全部还在的块，且永不判丢失', () => {
    const buffer = createTermBuffer(2, UNBOUNDED);
    buffer.push('one');
    buffer.push('two');
    buffer.push('three');

    const read = buffer.read();

    expect(read.lost).toBe(false);
    expect(read.lost === false && read.chunks.map((c) => c.data)).toStrictEqual(['two', 'three']);
  });

  it('异常：sinceSeq 早于下界 ⇒ lost:true 且带 requestedSeq/oldestSeq，**绝不**退化成空数组', () => {
    const buffer = createTermBuffer(2, UNBOUNDED);
    buffer.push('one');
    buffer.push('two');
    buffer.push('three');

    const read = buffer.read(1);

    expect(read.lost).toBe(true);
    // 「绝不返回空数组」的字面判据：`lost` 分支**没有** chunks 这个字段，调用方拿不到「看起来像成功」的空数组
    expect(read !== undefined && 'chunks' in read).toBe(false);
    expect(read.lost === true && read.requestedSeq).toBe(1);
    expect(read.lost === true && read.oldestSeq).toBe(2);
    expect(read.dropped).toBe(1);
  });

  it('边界：缓冲被丢空之后，任何旧序号都是 lost（下界 = 下一号）—— 而不是「空 = 没丢」', () => {
    const buffer = createTermBuffer(UNBOUNDED, 4);
    buffer.push('aaaaa');

    const read = buffer.read(1);

    expect(read.lost).toBe(true);
    expect(read.lost === true && read.oldestSeq).toBe(2);
    expect(buffer.read(2).lost).toBe(false); // 只有「从下一号起」才是合法的空区间
  });

  it('边界：非有限 sinceSeq（NaN）按「下界」处理 ⇒ 不崩、也不误判丢失', () => {
    const buffer = createTermBuffer(10, 1000);
    buffer.push('one');

    const read = buffer.read(Number.NaN);

    expect(read.lost).toBe(false);
    expect(read.lost === false && read.chunks.map((c) => c.data)).toStrictEqual(['one']);
  });
});
