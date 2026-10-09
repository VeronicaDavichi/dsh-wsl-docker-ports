/**
 * T2.3 / T2.4 的**屏幕模型层**：真实 `@xterm/headless` 6.0.0 + `addon-serialize` 0.14.0
 * （002 REQ-6.1 / REQ-6.2 / REQ-6.3 / REQ-6.4 / REQ-6.5）
 *
 * 这一层不碰宿主、不起 PTY —— 屏幕模型是**纯内存**的，所以「零真机」在这里是免费的。
 * 断言刻意压在两条设计事实上（design §2.2）：
 * ① 快照是 serializer 的**当前帧**，所以 TUI 清屏重画之后旧内容**消失**（不是历史拼接）；
 * ② 快照与增量**同源**，所以 `lost` 时附的那份快照与单独读快照拿到的是同一个画面。
 */

import { describe, expect, it } from 'vitest';

import {
  TERM_SNAPSHOT_SCROLLBACK_LINES,
  TERM_SNAPSHOT_SCROLLBACK_MAX,
  createScreenModel,
  createTermBuffer,
} from '../../src/index.ts';

/** 一个有界小屏幕（4 行 × 40 列、scrollback 可调）——尾部截断靠它才看得出来 */
function smallScreen(scrollbackLines = 100): ReturnType<typeof createScreenModel> {
  return createScreenModel({ rows: 4, cols: 40 }, { scrollbackLines });
}

/** 逐行写入（每行都单独 `await`：模拟真实 PTY 分片，同时让 seq 一块一块涨） */
async function writeLines(screen: ReturnType<typeof createScreenModel>, count: number, prefix = 'line-'): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await screen.write(`${prefix}${String(i).padStart(2, '0')}\r\n`);
  }
}

describe('T2.3 快照（REQ-6.1 / REQ-6.2）', () => {
  it('正常：写入后快照含期望文本与尺寸，seq 随块数单调递增', async () => {
    const screen = createScreenModel({ rows: 6, cols: 30 });

    const before = screen.snapshot();
    expect(before.seq).toBe(1); // 下一号口径：还没有块时也是 1
    expect(before.rows).toBe(6);
    expect(before.cols).toBe(30);

    await screen.write('hello\r\n');
    await screen.write('world');

    const after = screen.snapshot();
    expect(after.text).toContain('hello');
    expect(after.text).toContain('world');
    expect(after.seq).toBe(3); // 两块 ⇒ 下一号是 3
    expect(screen.seq).toBe(3);
    screen.dispose();
  });

  it('正常：TUI 清屏重画后快照是**重画后**的画面（旧内容消失，证明快照是当前帧不是拼接）', async () => {
    const screen = smallScreen();

    await screen.write('\u001b[2J\u001b[H第一屏内容');
    expect(screen.snapshot().text).toContain('第一屏内容');

    await screen.write('\u001b[2J\u001b[H第二屏内容');
    const after = screen.snapshot();

    expect(after.text).toContain('第二屏内容');
    expect(after.text).not.toContain('第一屏内容');
    screen.dispose();
  });

  it('REQ-6.2 边界：尾部**有界** —— scrollback 参数越小快照越短，且 0 只给视口', async () => {
    const screen = smallScreen(100);
    await writeLines(screen, 30);

    const viewportOnly = screen.snapshot(0);
    const tail = screen.snapshot(2);
    const everything = screen.snapshot(TERM_SNAPSHOT_SCROLLBACK_MAX);
    expect(TERM_SNAPSHOT_SCROLLBACK_LINES).toBeLessThanOrEqual(TERM_SNAPSHOT_SCROLLBACK_MAX);

    expect(viewportOnly.text).not.toContain('line-00'); // 视口只有最后 4 行
    expect(everything.text).toContain('line-00');
    expect(tail.text.length).toBeGreaterThan(viewportOnly.text.length);
    expect(tail.text.length).toBeLessThan(everything.text.length);
    // 三者都带最新一行 —— 截断的是「老内容」，不是「新内容」
    for (const snapshot of [viewportOnly, tail, everything]) expect(snapshot.text).toContain('line-29');
    screen.dispose();
  });

  it('REQ-6.2 异常：尾部参数越界/NaN 一律夹到界内（不抛错、不无界）', async () => {
    const screen = smallScreen();
    await writeLines(screen, 8);

    expect(screen.snapshot(Number.NaN).text).toBe(screen.snapshot(0).text); // NaN ⇒ 下界
    expect(screen.snapshot(1e9).text).toBe(screen.snapshot(TERM_SNAPSHOT_SCROLLBACK_MAX).text);
    expect(screen.snapshot(-5).text).toBe(screen.snapshot(0).text);
    screen.dispose();
  });

  it('正常：resize 之后快照的尺寸是新值（尺寸入口用对象 ⇒ 行列不可能转置）', async () => {
    const screen = createScreenModel({ rows: 24, cols: 80 });

    screen.resize({ rows: 30, cols: 100 });

    expect(screen.size()).toStrictEqual({ rows: 30, cols: 100 });
    const snapshot = screen.snapshot();
    expect(snapshot.rows).toBe(30);
    expect(snapshot.cols).toBe(100);
    screen.dispose();
  });
});

describe('T2.4 增量与 lost（REQ-6.3 / REQ-6.4 / REQ-6.5）', () => {
  it('正常：incremental(sinceSeq) 只回增量块，seq 单调、内容与写入顺序一致', async () => {
    const screen = createScreenModel({ rows: 6, cols: 30 });

    await screen.write('a');
    await screen.write('b');
    const firstRead = screen.incremental(1);
    await screen.write('c');
    const secondRead = screen.incremental(firstRead.seq);

    expect(firstRead.lost).toBe(false);
    expect(firstRead.lost === false && firstRead.chunks.map((c) => c.data)).toStrictEqual(['a', 'b']);
    expect(firstRead.lost === false && firstRead.chunks.map((c) => c.seq)).toStrictEqual([1, 2]);
    expect(secondRead.lost).toBe(false);
    expect(secondRead.lost === false && secondRead.chunks.map((c) => c.data)).toStrictEqual(['c']);
    screen.dispose();
  });

  it('异常：sinceSeq 早于下界 ⇒ lost:true **并附快照**（不是空数组、也不只是报错）', async () => {
    // 注入极小的缓冲（只留 1 块）⇒ 第 3 块进来时第 1、2 块已被丢
    const screen = createScreenModel({ rows: 6, cols: 30 }, { buffer: createTermBuffer(1, Number.MAX_SAFE_INTEGER) });

    await screen.write('one\r\n');
    await screen.write('two\r\n');
    await screen.write('three\r\n');

    const read = screen.incremental(1);

    expect(read.lost).toBe(true);
    if (!read.lost) return;
    expect(read.requestedSeq).toBe(1);
    expect(read.oldestSeq).toBe(3);
    expect(read.dropped).toBe(2);
    // 关键：带回来的快照是**当前画面**（包含最新内容），调用方能靠它重建
    expect(read.snapshot.text).toContain('three');
    expect(read.snapshot.seq).toBe(4);
    expect(read.snapshot.text).toBe(screen.snapshot().text);
    screen.dispose();
  });

  it('REQ-6.4 正常：dropped 同时出现在快照与增量里（UI/日志可见）', async () => {
    const screen = createScreenModel({ rows: 6, cols: 30 }, { buffer: createTermBuffer(1, Number.MAX_SAFE_INTEGER) });

    await screen.write('one');
    await screen.write('two');

    expect(screen.dropped).toBe(1);
    expect(screen.snapshot().dropped).toBe(1);
    const read = screen.incremental(1);
    expect(read.dropped).toBe(1);
    screen.dispose();
  });

  it('REQ-6.5 正常：连续读**不改变**屏幕内容与尺寸（两次快照逐字相同）', async () => {
    const screen = createScreenModel({ rows: 5, cols: 20 });
    await screen.write('stable\r\n');

    const first = screen.snapshot();
    for (let i = 0; i < 5; i += 1) {
      screen.snapshot();
      screen.incremental();
      screen.incremental(1);
    }
    const last = screen.snapshot();

    expect(last.text).toBe(first.text);
    expect(last.seq).toBe(first.seq);
    expect(screen.size()).toStrictEqual({ rows: 5, cols: 20 });
    screen.dispose();
  });

  it('异常：dispose 之后再 write ⇒ 抛错（不静默吞掉输出），且 dispose 幂等', async () => {
    const screen = createScreenModel({ rows: 5, cols: 20 });
    screen.dispose();
    screen.dispose(); // 幂等：不抛

    await expect(screen.write('late')).rejects.toThrow('已释放');
  });
});
