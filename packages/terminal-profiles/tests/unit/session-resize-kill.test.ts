/**
 * T2.2（自实现夹紧）· T2.1（`resize` / `kill` / `list`）与 design §11 的**行列顺序**陷阱
 *
 * 🔴 本文件存在的主要理由：宿主 handle 是 `resize(cols, rows)`（**列在前**），而本包对外是
 * `resize(id, rows, cols)`。弄反**不会报错**，只会静默转置 —— 所以每个断言都用 `rows ≠ cols`
 * 的实参，并**按位置**复查宿主收到的 `[cols, rows]`。80×24 这种 4:3 附近的尺寸是查不出来的。
 */

import { describe, expect, it } from 'vitest';

import { TERM_MAX_COLS, TERM_MAX_ROWS, TERM_MIN_COLS, TERM_MIN_ROWS, createSessionManager } from '../../src/index.ts';
import type { TerminalProfile } from '../../src/index.ts';
import { createFakeSubprocess } from '../helpers/fake-pty.ts';

const PWSh: TerminalProfile = {
  name: 'p',
  command: 'pwsh.exe',
  args: [],
  env: {},
  cwd: 'E:\\proj',
};

/** 起一个实例，返回 (manager, id, handle) —— 三个断言对象都要用 */
async function boot(): Promise<{
  manager: ReturnType<typeof createSessionManager>;
  fake: ReturnType<typeof createFakeSubprocess>;
  id: string;
  handle: NonNullable<ReturnType<typeof createFakeSubprocess>['handles'][number]>;
}> {
  const fake = createFakeSubprocess();
  const manager = createSessionManager({ subprocess: fake.surface });
  const started = await manager.start(PWSh, { rows: 24, cols: 80 });
  if (!started.ok) throw new Error(`夹具启动失败：${started.message}`);
  const handle = fake.handles[0];
  if (handle === undefined) throw new Error('夹具没有 handle');
  return { manager, fake, id: started.value.id, handle };
}

describe('resize：自实现夹紧 + 宿主换序（§11）', () => {
  it('§11 正常：resize(id, rows=30, cols=100) ⇒ 宿主收到 resize(cols=100, rows=30)', async () => {
    const { manager, id, handle } = await boot();

    const resized = await manager.resize(id, 30, 100);

    expect(resized.ok && resized.value).toStrictEqual({ rows: 30, cols: 100 });
    // 按位置复查：宿主拿到的第 1 个实参必须是**列**（100），第 2 个必须是**行**（30）
    expect(handle.resizeCalls).toStrictEqual([[100, 30]]);
    expect(handle.resizeCalls[0]?.[0]).toBe(100); // cols
    expect(handle.resizeCalls[0]?.[1]).toBe(30); // rows
    // 实例表与屏幕模型都跟着更新
    expect(manager.list()[0]).toMatchObject({ rows: 30, cols: 100 });
    const read = await manager.read(id);
    expect(read.ok && read.value.mode === 'snapshot' && read.value.snapshot.rows).toBe(30);
    expect(read.ok && read.value.mode === 'snapshot' && read.value.snapshot.cols).toBe(100);
  });

  it('§11 边界：另一个 rows ≠ cols 的组合也会被正确换序（防止只对一组数字碰巧成立）', async () => {
    const { manager, id, handle } = await boot();

    await manager.resize(id, 7, 213);

    expect(handle.resizeCalls).toStrictEqual([[213, 7]]);
  });

  it('REQ-5.3 边界：0 / 负数 / NaN / 越界都夹到界内**再**交给宿主（宿主不夹紧）', async () => {
    const { manager, id, handle } = await boot();

    const low = await manager.resize(id, 0, 1);
    const high = await manager.resize(id, 1e9, 1e9);
    const nan = await manager.resize(id, Number.NaN, Number.NaN);
    const frac = await manager.resize(id, 30.9, 100.4);

    expect(low.ok && low.value).toStrictEqual({ rows: TERM_MIN_ROWS, cols: TERM_MIN_COLS });
    expect(high.ok && high.value).toStrictEqual({ rows: TERM_MAX_ROWS, cols: TERM_MAX_COLS });
    expect(nan.ok && nan.value).toStrictEqual({ rows: TERM_MIN_ROWS, cols: TERM_MIN_COLS });
    // 小数先截断（xterm 的 resize 只接受整数，传小数会直接抛）
    expect(frac.ok && frac.value).toStrictEqual({ rows: 30, cols: 100 });
    expect(handle.resizeCalls).toStrictEqual([
      [TERM_MIN_COLS, TERM_MIN_ROWS],
      [TERM_MAX_COLS, TERM_MAX_ROWS],
      [TERM_MIN_COLS, TERM_MIN_ROWS],
      [100, 30],
    ]);
  });

  it('异常：宿主 resize 抛错 ⇒ resize-failed，且**不**改实例表里的尺寸（不假装成功）', async () => {
    const { manager, id, handle } = await boot();
    handle.resizeError = new Error('terminal process has exited');

    const resized = await manager.resize(id, 30, 100);

    expect(resized.ok).toBe(false);
    if (resized.ok) return;
    expect(resized.code).toBe('resize-failed');
    expect(resized.message).toContain('terminal process has exited');
    expect(manager.list()[0]).toMatchObject({ rows: 24, cols: 80 });
  });
});

describe('kill / list 与生命周期', () => {
  it('正常：kill ⇒ terminate 调用 1 次、实例出表、再 read 是 instance-not-found', async () => {
    const { manager, id, handle } = await boot();

    const killed = await manager.kill(id);

    expect(killed.ok && killed.value.killed).toBe(true);
    expect(killed.ok && killed.value.warning).toBeUndefined();
    expect(handle.terminateCount).toBe(1);
    expect(handle.terminated).toBe(true);
    expect(manager.list()).toStrictEqual([]);
    const after = await manager.read(id);
    expect(after.ok).toBe(false);
    expect(after.ok === false && after.code).toBe('instance-not-found');
  });

  it('边界：kill 两次 ⇒ 第二次是 instance-not-found（不会静默成功）', async () => {
    const { manager, id, handle } = await boot();

    await manager.kill(id);
    const again = await manager.kill(id);

    expect(again.ok).toBe(false);
    expect(again.ok === false && again.code).toBe('instance-not-found');
    expect(handle.terminateCount).toBe(1); // 没有第二次 terminate
  });

  it('异常：terminate 抛错 ⇒ 仍从表里摘掉（不留幽灵实例），并以 warning 说明「尽力而为」', async () => {
    const { manager, id, handle } = await boot();
    handle.terminateError = new Error('refusing to SIGKILL the terminal shell');

    const killed = await manager.kill(id);

    expect(killed.ok).toBe(true);
    expect(killed.ok && killed.value.killed).toBe(true);
    expect(killed.ok && killed.value.warning).toContain('refusing to SIGKILL');
    expect(killed.ok && killed.value.warning).toContain('进程组');
    expect(manager.list()).toStrictEqual([]); // 表里没有残留
  });

  it('REQ-12.3 语义边界：顶层进程退出后实例**仍在表里**（tab 可回看屏幕），只是 exited = true', async () => {
    const { manager, id, handle } = await boot();
    await handle.emit('bye\r\n');
    expect(manager.list()[0]?.exited).toBe(false);

    handle.exit(0);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(manager.list()[0]?.exited).toBe(true);
    expect(manager.list()).toHaveLength(1); // 表里还在 —— 清理归 kill，不归 done
    const read = await manager.read(id);
    expect(read.ok && read.value.mode === 'snapshot' && read.value.snapshot.text).toContain('bye');
  });

  it('正常：list 按创建序返回多条（REQ-4.3 的列表顺序）', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });

    await manager.start({ ...PWSh, name: 'a' });
    await manager.start({ ...PWSh, name: 'b' });
    await manager.start({ ...PWSh, name: 'c' });

    expect(manager.list().map((i) => i.profileName)).toStrictEqual(['a', 'b', 'c']);
    expect(manager.list().map((i) => i.id)).toStrictEqual(['term-1', 'term-2', 'term-3']);
  });
});
