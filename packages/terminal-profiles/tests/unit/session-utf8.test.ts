/**
 * 输出解码的**跨块**行为（002 T2.1/T2.3 的边界；REQ-6.1「屏幕模型必须看到 PTY 真实输出的文本」）
 *
 * 一个 3 字节 UTF-8 码点（如「中」= E4 B8 AD）被拆成两块发出时必须还原成一个字符 ——
 * 逐块 `Buffer.toString('utf8')` 会得到两个 U+FFFD，屏幕模型里就**永久**多出乱码（快照与增量都带着它）。
 * 本包声明的宿主契约只承诺「`data` 给一块 `unknown` 数据」，没承诺边界对齐码点 ⇒ 必须自己用
 * 有状态的 `StringDecoder` 解码。
 */

import { describe, expect, it } from 'vitest';

import { createSessionManager } from '../../src/index.ts';
import type { TerminalProfile } from '../../src/index.ts';
import { createFakeSubprocess } from '../helpers/fake-pty.ts';

const PWSh: TerminalProfile = {
  name: 'p',
  command: 'pwsh.exe',
  args: [],
  env: {},
  cwd: 'E:\\proj',
};

/** 「中」的 UTF-8 字节（E4 B8 AD），切成两半分别发 */
const ZHONG = [0xe4, 0xb8, 0xad];

async function boot(): Promise<{
  manager: ReturnType<typeof createSessionManager>;
  fake: ReturnType<typeof createFakeSubprocess>;
  id: string;
}> {
  const fake = createFakeSubprocess();
  const manager = createSessionManager({ subprocess: fake.surface });
  const started = await manager.start(PWSh);
  if (!started.ok) throw new Error(`夹具启动失败：${started.message}`);
  return { manager, fake, id: started.value.id };
}

describe('跨块 UTF-8 解码', () => {
  it('正常：3 字节码点被拆成两块 ⇒ 快照里是「中」而不是 U+FFFD', async () => {
    const { manager, fake, id } = await boot();
    const handle = fake.handles[0];
    if (handle === undefined) throw new Error('夹具没有 handle');

    await handle.emitRaw(ZHONG.slice(0, 2)); // E4 B8 —— 半个码点，此时不该产出任何字符
    const mid = await manager.read(id);
    expect(mid.ok && mid.value.mode === 'snapshot' && mid.value.snapshot.text).not.toContain('\uFFFD');

    await handle.emitRaw(ZHONG.slice(2)); // AD —— 补完
    const after = await manager.read(id);

    expect(after.ok && after.value.mode === 'snapshot' && after.value.snapshot.text).toContain('中');
    expect(after.ok && after.value.mode === 'snapshot' && after.value.snapshot.text).not.toContain('\uFFFD');
  });

  it('边界：多字节字符混在 ASCII 里、且分块落在码点中间 ⇒ 增量块也拼得回原文', async () => {
    const { manager, fake, id } = await boot();
    const handle = fake.handles[0];
    if (handle === undefined) throw new Error('夹具没有 handle');

    // "ok" + 「中」（拆开）+ "!" ：第 1 块是 ASCII 与半个码点连在一起
    await handle.emitRaw([0x6f, 0x6b, ...ZHONG.slice(0, 2)]);
    await handle.emitRaw([...ZHONG.slice(2), 0x21]);

    const read = await manager.read(id, { mode: 'incremental', sinceSeq: 1 });
    expect(read.ok && read.value.mode === 'incremental').toBe(true);
    if (!read.ok || read.value.mode !== 'incremental' || read.value.lost) throw new Error('不该 lost');
    // 两块拼起来必须回到原文；这一层的契约是「逐块原样」，所以断言的是**连接后**的结果
    expect(read.value.chunks.map((c) => c.data).join('')).toBe('ok中!');
  });

  it('边界：字符串形态的块（有些实现直接给 string）也原样通过', async () => {
    const { manager, fake, id } = await boot();
    const handle = fake.handles[0];
    if (handle === undefined) throw new Error('夹具没有 handle');

    await handle.emit('直接给字符串');

    const read = await manager.read(id);
    expect(read.ok && read.value.mode === 'snapshot' && read.value.snapshot.text).toContain('直接给字符串');
  });
});
