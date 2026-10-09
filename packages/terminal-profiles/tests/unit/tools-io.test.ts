/**
 * T1.2 / T1.4 / T2.1 / T3.1 —— read / write / resize 的逐条口径
 *
 * 零真机：`read` 走 002 的屏幕模型（真 xterm headless，纯内存），`write`/`resize` 走 fake PTY handle。
 * 🔴 `resize` 的断言只用 `rows ≠ cols`（`30 × 100`）：相等时行列转置看不出来，那是**假绿**。
 */

import { describe, expect, it } from 'vitest';

import { TERM_BUFFER_MAX_BLOCKS, TERM_MAX_COLS, TERM_MAX_ROWS, TERM_MIN_COLS, TERM_MIN_ROWS } from '../../src/limits.ts';
import { decodeKeyName, decodeWritePayload, looksLikeKeyName, supportedKeyNames } from '../../src/tools/keys.ts';
import { createToolsHarness, handleOf } from '../helpers/tools-harness.ts';

/**
 * 往实例里灌 `count` 个 1 字节块（用来把有界缓冲挤爆，触发 `lost`）。
 *
 * 🔴 每次之间让出**一个宏任务**：`PassThrough` 在写侧持续有数据时会把待发数据**合并**成一个大
 * `data` 块（实测 261 次 `write` 只派发 14 次 `data`）。那样「块数」就不是我们能数出来的量，
 * 测试会以为它灌了 261 块、实际只灌了 14 块 —— 断言就会以完全错误的原因失败。
 * 让一拍之后每次 `write` 都独立成块，块数才等于 `count`。
 *
 * 为什么是 `setTimeout(0)` 而不是 `setImmediate`：`emit` 自己已经用 `setImmediate` 保证
 * 「`data` 事件派发完」。真正需要的是让**流内部**把这一小块冲刷出去 —— 那是定时器相位的事，
 * 同相位内连续写仍会被合并（实测）。慢（约 15ms/次）但**块数确定**，比快而数不清值得。
 */
async function flood(h: ReturnType<typeof createToolsHarness>, handleIndex: number, count: number): Promise<void> {
  const handle = handleOf(h.fake, handleIndex);
  for (let index = 0; index < count; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await handle.emit('x');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('T1.2 REQ-1.4 managed_terminal_read 的两种模式', () => {
  it('正常：缺省 mode = snapshot，直接给 002 的屏幕模型（text/rows/cols/seq/dropped）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);
    await handle.emit('hello\r\n');

    const result = await h.call('managed_terminal_read', { id: 'term-1' });

    expect(result.isError).toBe(false);
    const value = result.value as { mode: string; snapshot: Record<string, unknown> };
    expect(value.mode).toBe('snapshot');
    expect(value.snapshot).toMatchObject({ rows: 24, cols: 80, dropped: 0 });
    // seq 是「下一号」：一个块入缓冲 ⇒ 下一号是 2
    expect(value.snapshot.seq).toBe(2);
    expect(String(value.snapshot.text)).toContain('hello');
  });

  it('正常：incremental 返回 `sinceSeq` 之后的块（含 002 的 `data`/`bytes`，形状一字不改）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);
    await handle.emit('abc');
    await handle.emit('def');

    const result = await h.call('managed_terminal_read', { id: 'term-1', mode: 'incremental' });

    expect(result.isError).toBe(false);
    const value = result.value as { mode: string; lost: boolean; chunks: any[]; seq: number; dropped: number };
    expect(value).toMatchObject({ mode: 'incremental', lost: false, seq: 3, dropped: 0 });
    expect(value.chunks.map((chunk) => [chunk.seq, chunk.data])).toStrictEqual([[1, 'abc'], [2, 'def']]);
    expect(value.chunks[0]?.bytes).toBe(3);
  });

  it('边界：incremental + `sinceSeq` = 下一号 ⇒ `chunks` 空数组（**不是** `lost`，也**不是**错误）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    await handleOf(h.fake).emit('abc');

    const result = await h.call('managed_terminal_read', { id: 'term-1', mode: 'incremental', sinceSeq: 2 });

    expect(result.isError).toBe(false);
    const value = result.value as { lost: boolean; chunks: unknown[]; seq: number };
    expect(value.lost).toBe(false);
    expect(value.chunks).toStrictEqual([]);
    expect(value.seq).toBe(2);
  });

  it('REQ-2.2 边界：`sinceSeq` 早于缓冲下界 ⇒ `lost:true` + **快照**，不是空数组冒充无输出', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    await flood(h, 0, TERM_BUFFER_MAX_BLOCKS + 20);

    const result = await h.call('managed_terminal_read', { id: 'term-1', mode: 'incremental', sinceSeq: 1 });

    expect(result.isError).toBe(false);
    const value = result.value as {
      mode: string;
      lost: boolean;
      snapshot: { text: string };
      requestedSeq: number;
      oldestSeq: number;
      dropped: number;
    };
    expect(value.mode).toBe('incremental');
    expect(value.lost).toBe(true);
    expect(value.requestedSeq).toBe(1);
    expect(value.oldestSeq).toBe(21);
    expect(value.dropped).toBe(20);
    // 「不返回空数组冒充无输出」的可判定形式：**带了**快照
    expect(typeof value.snapshot.text).toBe('string');
  });

  it('REQ-2.4 / REQ-3.3：`dropped` 在 managed_terminal_list 与 managed_terminal_read 里**都**看得见（不隐藏丢失）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    await flood(h, 0, TERM_BUFFER_MAX_BLOCKS + 5);

    const listed = (await h.call('managed_terminal_list', {})).value as { instances: any[] };
    expect(listed.instances[0]?.dropped).toBe(5);

    const read = (await h.call('managed_terminal_read', { id: 'term-1' })).value as { snapshot: { dropped: number } };
    expect(read.snapshot.dropped).toBe(5);
    h.dispose();
  });
  it('T1.4 异常：managed_terminal_read 未知实例 ⇒ instance-not-found + 指向 managed_terminal_list 的提示，**不**静默返回空文本', async () => {
    const h = createToolsHarness();
    const result = await h.call('managed_terminal_read', { id: 'term-1' });

    expect(result.isError).toBe(true);
    const text = result.content.map((block) => block.text).join('');
    expect(text).toContain('[instance-not-found]');
    // 自救路径必须写在结果里（读不到时最该做的一件事就是看看现在有哪些实例）
    expect(text).toContain('list');
    h.dispose();
  });

  it('REQ-2.1 边界：顶层进程退出后仍能读到最后屏幕（不是「已退出所以读不到」）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);
    await handle.emit('bye\r\n');
    handle.exit(0);
    await new Promise((resolve) => setImmediate(resolve));

    const value = (await h.call('managed_terminal_read', { id: 'term-1' })).value as { snapshot: { text: string } };
    expect(value.snapshot.text).toContain('bye');
    h.dispose();
  });
});

describe('T1.2 REQ-1.5 managed_terminal_write：键名与字面文本', () => {
  it('正常：键名命中键名表 ⇒ 发的是**转义字节**（不是键名的字面量）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    const enter = await h.call('managed_terminal_write', { id: 'term-1', data: 'Enter' });
    const ctrlC = await h.call('managed_terminal_write', { id: 'term-1', data: 'C-c' });
    const up = await h.call('managed_terminal_write', { id: 'term-1', data: 'ArrowUp' });

    // 🔴 载荷是**转义字节**：`\r` / `\x03` / CSI `A`（不是键名字面量）
    expect(handle.writeCalls).toStrictEqual(['\r', '\u0003', '\u001b[A']);
    // 回执里的 `key` 就是那串转义载荷（键名 ↔ 载荷 1:1，且与 `writeCalls` 完全一致 ⇒ 可对账）
    expect(enter.value).toMatchObject({ written: 1, key: '\r' });
    expect(ctrlC.value).toMatchObject({ written: 1, key: '\u0003' });
    expect(up.value).toMatchObject({ written: 3, key: '\u001b[A' });
  });

  it('正常：文本**原样**进 PTY（design §6：不经 shell 切词、不 trim、不补回车）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    const result = await h.call('managed_terminal_write', { id: 'term-1', data: 'ls -la "a b"' });

    expect(result.value).toMatchObject({ written: 12, key: 'text' });
    expect(handle.writeCalls).toStrictEqual(['ls -la "a b"']);
    h.dispose();
  });

  it('边界：单字符按字面发（键名表无单字符条目 ⇒ 「想发字母 a」不会被当成未知键名）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    expect((await h.call('managed_terminal_write', { id: 'term-1', data: 'a' })).isError).toBe(false);
    expect((await h.call('managed_terminal_write', { id: 'term-1', data: ' ' })).isError).toBe(false);
    expect(handle.writeCalls).toStrictEqual(['a', ' ']);
    h.dispose();
  });

  it('边界：看起来像文本的多字节内容不被误判成键名（中文 / emoji）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    expect((await h.call('managed_terminal_write', { id: 'term-1', data: 'echo 你好' })).isError).toBe(false);
    expect((await h.call('managed_terminal_write', { id: 'term-1', data: '😀' })).isError).toBe(false);
    expect(handle.writeCalls).toStrictEqual(['echo 你好', '😀']);
    h.dispose();
  });

  it('REQ-4.2 异常：未识别键名 ⇒ unknown-key + 已支持清单，一个字节都不写', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    const result = await h.call('managed_terminal_write', { id: 'term-1', data: 'C-?' });

    expect(result.isError).toBe(true);
    const text = result.content.map((block) => block.text).join('');
    expect(text).toContain('[unknown-key]');
    expect(text).toContain('ArrowUp');
    expect(text).toContain('C-c');
    expect(handle.writeCalls).toStrictEqual([]);
    h.dispose();
  });

  it('REQ-4.2 异常：未知键名的判定**先于**实例查找（不把参数级错误说成实例不存在）', async () => {
    const h = createToolsHarness();
    const text = (await h.call('managed_terminal_write', { id: 'term-404', data: 'C-?' })).content
      .map((block) => block.text)
      .join('');
    expect(text).toContain('[unknown-key]');
    expect(text).not.toContain('[instance-not-found]');
    h.dispose();
  });

  it('T3.1 异常：managed_terminal_write 未知实例 ⇒ instance-not-found（参数合法时）', async () => {
    const h = createToolsHarness();
    const result = await h.call('managed_terminal_write', { id: 'term-404', data: 'ls' });
    expect(result.content.map((block) => block.text).join('')).toContain('[instance-not-found]');
    h.dispose();
  });
});

describe('T1.2 REQ-1.6 managed_terminal_resize：夹紧 + 顺序', () => {
  it('🔴 正常：`rows ≠ cols` 时宿主收到的是 `resize(cols, rows)`（我们的 `(rows, cols)` 已由 002 换序）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    const result = await h.call('managed_terminal_resize', { id: 'term-1', rows: 30, cols: 100 });

    expect(result.value).toMatchObject({ rows: 30, cols: 100 });
    // [cols, rows] 位置参数：100 在前、30 在后。反了就是静默转置。
    expect(handle.resizeCalls).toStrictEqual([[100, 30]]);
    h.dispose();
  });

  it('边界：越界入参被 002 夹紧，返回值是**实际生效**值 + 原样回显 requested', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    const tooBig = await h.call('managed_terminal_resize', { id: 'term-1', rows: 9999, cols: 9999 });
    expect(tooBig.value).toMatchObject({
      rows: TERM_MAX_ROWS,
      cols: TERM_MAX_COLS,
      requestedRows: 9999,
      requestedCols: 9999,
    });

    const tooSmall = await h.call('managed_terminal_resize', { id: 'term-1', rows: 0, cols: 0 });
    expect(tooSmall.value).toMatchObject({ rows: TERM_MIN_ROWS, cols: TERM_MIN_COLS });

    expect(handle.resizeCalls).toStrictEqual([
      [TERM_MAX_COLS, TERM_MAX_ROWS],
      [TERM_MIN_COLS, TERM_MIN_ROWS],
    ]);
    h.dispose();
  });

  it('边界：负数 / 非整数入参走 002 的 `clampInt`（先 trunc 再夹紧），不自造第二套口径', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    const negative = await h.call('managed_terminal_resize', { id: 'term-1', rows: -50, cols: -1 });
    expect(negative.value).toMatchObject({ rows: TERM_MIN_ROWS, cols: TERM_MIN_COLS });
    expect(handle.resizeCalls).toStrictEqual([[TERM_MIN_COLS, TERM_MIN_ROWS]]);
    h.dispose();
  });

  it('REQ-1.8 异常：`rows` 是字符串 ⇒ 参数被拒（进体前），宿主 handle 一次都没被调', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    await expect(
      h.tool('managed_terminal_resize').execute({ id: 'term-1', rows: '30', cols: 100 }, { callId: 'c1' }),
    ).rejects.toThrow(/invalid arguments/);
    expect(handle.resizeCalls).toStrictEqual([]);
    h.dispose();
  });

  it('T3.1 异常：宿主 `resize` reject ⇒ 收成可读错误（不透传原始 throw）', async () => {
    const h = createToolsHarness();
    await h.start('pwsh');
    handleOf(h.fake).resizeError = new Error('conpty gone');

    const result = await h.call('managed_terminal_resize', { id: 'term-1', rows: 30, cols: 100 });

    expect(result.isError).toBe(true);
    expect(result.content.map((block) => block.text).join('')).toMatch(/^Error: \[/);
    h.dispose();
  });
});

describe('T1.2 REQ-4.2 键名表本身', () => {
  it('正常：表内每个键名都能解码成非空字节，且同义写法指向**同一个**载荷', () => {
    const names = supportedKeyNames();
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      const bytes = decodeKeyName(name);
      expect(bytes, `${name} 应能解码`).toBeTypeOf('string');
      expect(bytes).not.toBe('');
    }
    // 三个**故意**的同义项（不是漏写：`Return`/`Esc` 是别名，`C-i`/`C-m` 是 readline 与 Tab/Enter 同码）
    expect(decodeKeyName('Return')).toBe(decodeKeyName('Enter'));
    expect(decodeKeyName('Esc')).toBe(decodeKeyName('Escape'));
    const synonyms = new Set(['Return', 'Esc', 'C-i', 'C-m']);
    const distinct = names.filter((name) => !synonyms.has(name)).map((name) => decodeKeyName(name));
    expect(new Set(distinct).size).toBe(distinct.length);
    expect(names).toStrictEqual([...names].sort());
  });

  it('正常：`C-x` / `Ctrl+x` / `^x` 三种写法归一到同一个键（别让模型猜我们的拼法）', () => {
    const target = '\u0003';
    expect(decodeKeyName('C-c')).toBe(target);
    expect(decodeKeyName('Ctrl+c')).toBe(target);
    expect(decodeKeyName('^c')).toBe(target);
    expect(decodeKeyName('C-C')).toBe(target); // 大小写宽松：控制组合本来就是同一个键
    expect(decodeKeyName('Ctrl+c')).toBe(decodeKeyName('C-c'));
  });

  it('边界：大小写不敏感地识别别名，但**不**把普通短词当键名（`looksLikeKeyName` 的口径）', () => {
    expect(decodeKeyName('enter')).toBe('\r');
    expect(decodeKeyName('ESC')).toBe('\u001b');
    expect(looksLikeKeyName('ls')).toBe(false);
    expect(looksLikeKeyName('ls -la')).toBe(false);
    expect(looksLikeKeyName('Frobnicate')).toBe(true);
    expect(looksLikeKeyName('C-?')).toBe(true);
    expect(looksLikeKeyName('a')).toBe(false);
  });

  it('边界：`decodeWritePayload` 对「未识别键名」给出空串哨兵（唯一失败信号）', () => {
    expect(decodeWritePayload('Enter')).toBe('\r');
    expect(decodeWritePayload('ls -la')).toBe('ls -la');
    expect(decodeWritePayload('a')).toBe('a');
    expect(decodeWritePayload('Frobnicate')).toBe('');
    expect(decodeWritePayload('C-?')).toBe('');
  });
});
