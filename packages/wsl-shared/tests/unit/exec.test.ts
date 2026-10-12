/**
 * T1.2–T1.5 执行器单测：全部走 fake spawn，**不产生任何真实进程**。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createExecutor, type Executor, type SpawnLike, type TreeKillLike } from '../../src/exec.ts';
import { listDistros } from '../../src/distros.ts';
// 台架（`fakeSpawn` / `neverKill` / `FakeHandle`）2026-10-12 抽出到 `exec-rig.ts`：
// T7.1 加完 4 条断言后本文件会超 NFR-5 的 400 行 SHALL ⇒ 抽台架，**用例一条不删不改名**。
import { fakeSpawn, neverKill } from './exec-rig.ts';

describe('T1.2 基础执行路径', () => {
  it('退出码 0 → ok:true，stdout 按声明编码解码', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l', '-v'], { encoding: 'utf8', timeoutMs: 1000 });
    fake.emitText('hello');
    fake.emitClose(0);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(fake.calls[0]?.file).toBe('wsl.exe');
    expect(fake.calls[0]?.argv).toEqual(['-l', '-v']);
  });

  it('无 shell：options 里 shell:false / windowsHide:true，且 argv 原样传递', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-d', 'Ubuntu 22.04', '--', 'echo', 'a b'], {
      encoding: 'utf8',
      timeoutMs: 1000,
    });
    fake.emitClose(0);
    await pending;

    const options = fake.calls[0]?.options ?? {};
    expect(options.shell).toBe(false);
    expect(options.windowsHide).toBe(true);
    expect(options.stdio).toBe('pipe');
    expect(fake.calls[0]?.argv).toEqual(['-d', 'Ubuntu 22.04', '--', 'echo', 'a b']);
  });

  it('退出码非 0 → NonZeroExit（带 exitCode / stderr / **stdout 原文** / argv）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l', '-v'], { encoding: 'utf8', timeoutMs: 1000 });
    fake.emitText('PAYLOAD-151B', 'stdout');
    fake.emitText('bad things', 'stderr');
    fake.emitClose(1);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NonZeroExit');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('PAYLOAD-151B');
    expect(result.stderr).toBe('bad things');
    expect(result.argv).toEqual(['wsl.exe', '-l', '-v']);
  });

  it('ENOENT → CommandNotFound（不抛裸异常）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l', '-v'], { encoding: 'utf8', timeoutMs: 1000 });
    fake.emitError('ENOENT');
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CommandNotFound');
    expect(result.argv).toEqual(['wsl.exe', '-l', '-v']);
  });

  it('非 ENOENT 的启动失败 → Unexpected', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 1000 });
    fake.emitError('EACCES');
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('Unexpected');
  });

  it('编码标签非法 → 启动前就 Unexpected（不让乱码流进解析器）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const result = await exec('wsl.exe', ['-l'], { encoding: 'no-such-encoding', timeoutMs: 1000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('Unexpected');
    expect(fake.calls.length).toBe(0);
  });

  it('utf16le 字节按声明编码解码（真机 wsl.exe 的编码）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l', '-v'], { encoding: 'utf16le', timeoutMs: 1000 });
    fake.emitBytes(Buffer.from('Ubuntu2204', 'utf16le'));
    fake.emitClose(0);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stdout).toBe('Ubuntu2204');
  });

  it('T1.2 静态断言：源码里没有 shell 字符串拼接（shell:true / exec( 零命中）', () => {
    const source = readFileSync(new URL('../../src/exec.ts', import.meta.url), 'utf8');
    expect(/\bshell\s*:\s*true/.test(source)).toBe(false);
    expect(/\b(?:exec|execSync|execFileSync)\s*\(/.test(source)).toBe(false);
  });
});

describe('T7.1 跨 Spec 欠账：非零退出的结果必须携带 stdout 原文（005 真机缺陷 2）', () => {
  it('🔴 非零退出 ⇒ 带 stdout 原文；字段集 = 真机 keys（ok/code/message/argv/exitCode/stderr）+ stdout', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('powershell.exe', ['-NoProfile', '-File', 'elevate.ps1'], {
      encoding: 'utf8',
      timeoutMs: 1000,
    });
    // 真机形态（2026-10-12）：提权脚本把**同一份 JSON** 既写 out 文件、也写 stdout，退出码非 0
    fake.emitText('{"ok":true,"payload":"PAYLOAD"}', 'stdout');
    fake.emitClose(1);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NonZeroExit');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('{"ok":true,"payload":"PAYLOAD"}');
    // 字段集**不多不少**：真机实测 keys 是 [ok,code,message,argv,exitCode,stderr]，缺陷即「少了 stdout」
    expect(Object.keys(result).sort()).toEqual([
      'argv',
      'code',
      'exitCode',
      'message',
      'ok',
      'stderr',
      'stdout',
    ]);
  });

  it('非零退出但 stdout 确实零输出 ⇒ 字段仍在且为空串（「没这个字段」与「值为空」不得混为一谈）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 1000 });
    fake.emitClose(3);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect('stdout' in result).toBe(true);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('成功路径字段集逐字未变（防回归：新增失败字段不得碰成功态）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l', '-v'], { encoding: 'utf8', timeoutMs: 1000 });
    fake.emitText('NAME STATE', 'stdout');
    fake.emitText('warn', 'stderr');
    fake.emitClose(0);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(['exitCode', 'ok', 'stderr', 'stdout']);
    expect(result.stdout).toBe('NAME STATE');
    expect(result.stderr).toBe('warn');
  });

  it('启动前就失败的路径（非法 timeoutMs / 非法编码）不带 stdout：没进程就没回传，字段必须**缺席**而非空串', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const badTimeout = await exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 0 });
    const badEncoding = await exec('wsl.exe', ['-l'], { encoding: 'no-such-encoding', timeoutMs: 1000 });

    for (const result of [badTimeout, badEncoding]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect('stdout' in result).toBe(false);
      expect('stderr' in result).toBe(false);
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe('T1.3 stderr 非空但退出码 0', () => {
  it('判成功且 stderr 原样保留', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l', '-v'], { encoding: 'utf8', timeoutMs: 1000 });
    fake.emitText('warning: 无关紧要', 'stderr');
    fake.emitClose(0);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('warning: 无关紧要');
  });
});

describe('T1.4 超时与进程终止', () => {
  it('必然超时 → Timeout，且不挂起（settled）', async () => {
    const fake = fakeSpawn(1234);
    const treeKill = vi.fn<TreeKillLike>(async () => undefined);
    const exec = createExecutor(fake.spawn, treeKill);

    const result = await exec('wsl.exe', ['-d', 'Ubuntu2204', '--', 'sleep', '60'], {
      encoding: 'utf8',
      timeoutMs: 20,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('Timeout');
    expect(fake.killed()).toBe(true);
    expect(treeKill).toHaveBeenCalledTimes(1);
    expect(treeKill.mock.calls[0]?.[0]).toBe('taskkill');
    expect(treeKill.mock.calls[0]?.[1]).toEqual(['/PID', '1234', '/T', '/F']);
  });

  it('超时后的迟到 close 事件不覆盖结论（第一个结果胜出）', async () => {
    const fake = fakeSpawn(99);
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 10 });
    const result = await pending;
    fake.emitClose(0);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('Timeout');
  });

  it('pid 为 0（拿不到 pid）时跳过 taskkill（但 kill() 仍然调用）', async () => {
    const fake = fakeSpawn(0);
    const treeKill = vi.fn<TreeKillLike>(async () => undefined);
    const exec = createExecutor(fake.spawn, treeKill);
    const result = await exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 10 });

    expect(result.ok).toBe(false);
    expect(fake.killed()).toBe(true);
    expect(treeKill).not.toHaveBeenCalled();
  });

  it('子进程在**注册阶段同步** close 也判成功（回归：定时器顺序缺陷曾导致 20s 退出延迟）', async () => {
    const spawn = ((_file: string, _argv: readonly string[]) =>
      ({
        pid: 7,
        stdout: { on: (_event: string, listener: (chunk: Uint8Array) => void) => listener(Buffer.from('ok')) },
        stderr: { on: () => undefined },
        on: (event: string, listener: (code: number | null) => void) => {
          if (event === 'close') listener(0);
        },
        kill: () => true,
      }) as unknown as ReturnType<SpawnLike>) as SpawnLike;

    const exec = createExecutor(spawn, neverKill);
    const result = await exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 1000 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stdout).toBe('ok');
  });
});

describe('T1.5 可注入执行器', () => {
  it('注入 fake 执行器后 listDistros 只走注入件：真实 spawn 零产生', async () => {
    const executor = vi.fn<Executor>(async () => ({
      ok: true as const,
      exitCode: 0 as const,
      stdout: '  NAME    STATE    VERSION\n* Ubuntu2204  Running  2\n',
      stderr: '',
    }));

    const outcome = await listDistros(executor);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]?.[0]).toBe('wsl.exe');
    expect(executor.mock.calls[0]?.[1]).toEqual(['-l', '-v']);
    expect(executor.mock.calls[0]?.[2]).toMatchObject({ encoding: 'utf16le' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.distros[0]?.name).toBe('Ubuntu2204');
  });
});

describe('复审补强：非法 timeoutMs / 终止文案 / 注入实现炸掉（2026-10-08 自审）', () => {
  const badTimeouts: [string, number][] = [
    ['Infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
    ['0', 0],
    ['负数', -1],
    ['超出 setTimeout 上限', 2_147_483_648],
  ];

  it.each(badTimeouts)(
    'timeoutMs = %s → 启动前判 Unexpected，且**零 spawn**（回归：Node 对超上限延时按 1ms 处理 ⇒ 假超时）',
    async (_label, bad) => {
      const fake = fakeSpawn();
      const exec = createExecutor(fake.spawn, neverKill);
      const result = await exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: bad });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('Unexpected');
      expect(result.message).toContain('timeoutMs');
      expect(fake.calls).toHaveLength(0);
    },
  );

  it('注入的 treeKill reject 时不产生 unhandled rejection（会崩宿主进程）', async () => {
    const fake = fakeSpawn(4321);
    const boom: TreeKillLike = async () => {
      throw new Error('treeKill 炸了');
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const result = await createExecutor(fake.spawn, boom)('wsl.exe', ['-l'], {
        encoding: 'utf8',
        timeoutMs: 10,
      });
      // 让微任务清空：若实现退回 `void killTree(...)`（无 catch），这里就会捕获到
      await new Promise((resolve) => setImmediate(resolve));
      expect(result.ok).toBe(false);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('ENOENT 且设了 cwd → 文案同时点出命令与工作目录（Windows 上两者同名）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l'], {
      encoding: 'utf8',
      timeoutMs: 1000,
      cwd: 'E:\\不存在的目录',
    });
    fake.emitError('ENOENT');
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CommandNotFound');
    expect(result.message).toContain('wsl.exe');
    expect(result.message).toContain('E:\\不存在的目录');
  });

  it('close(null)（被外部终止）→ 文案不再出现「退出码 null」，exitCode 为 -1', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 1000 });
    fake.emitClose(null);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NonZeroExit');
    expect(result.exitCode).toBe(-1);
    expect(result.message).not.toContain('null');
    expect(result.message).toContain('外部终止');
  });
});
