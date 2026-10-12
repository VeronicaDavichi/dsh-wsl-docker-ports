/**
 * `Timeout` 路径的输出回传门（001 · 2026-10-12 文档同步轮）
 *
 * 判据：`Timeout` 的失败对象必须带上**超时那一刻已经收到**的 `stdout` / `stderr`。
 * 此前该分支只带 `argv`（`outChunks` / `errChunks` 里已有部分数据却未回传），
 * 与 `NonZeroExit` 的 `stdout` 欠账（`b61c060` 已修）是**同一族的另一条路径**。
 *
 * 🔴 本文件自带**变异哨兵**：`legacyTimeoutPayload()` 逐字复刻修复前的载荷形态
 * （`fail('Timeout', …, { argv })` ⇒ 只有 `ok/code/message/argv`），并用**同一个**判据函数去判它
 * ⇒ 旧实现**当场判错**（缺字段）、新实现判对。只有「哨兵当场红」才能证明这道门不是假绿 ——
 * 与 `client-config-readonly.test.tsx` / `client-tab-guide.test.ts` 同一套做法。
 *
 * ⚠️ 硬口径（沿用 `exec-rig.ts`）：全部走 **fake spawn**，**不产生任何真实进程**。
 */
import { describe, expect, it } from 'vitest';
import { createExecutor } from '../../src/exec.ts';
import { fakeSpawn, neverKill } from './exec-rig.ts';

/** 哨兵输入：逐字复刻修复前 `Timeout` 分支造出来的载荷（那时只有 `argv`） */
function legacyTimeoutPayload(): Record<string, unknown> {
  return {
    ok: false,
    code: 'Timeout',
    message: '命令在 20ms 内未结束，已终止：wsl.exe',
    argv: ['wsl.exe', '-l'],
  };
}

/**
 * 判据本体（一份实现，同时判哨兵载荷与真实现载荷 —— 不各写一份正则）。
 * `exitCode` **不在**判据里：`Timeout` 没有退出码，加了才是改语义。
 */
function timeoutEchoViolations(payload: Record<string, unknown>): string[] {
  const violations: string[] = [];
  for (const field of ['stdout', 'stderr'] as const) {
    if (!(field in payload)) violations.push(`缺 ${field} 字段`);
    else if (typeof payload[field] !== 'string') violations.push(`${field} 不是字符串`);
  }
  return violations;
}

const keys = (value: object): string[] => Object.keys(value).sort();

describe('T7.1 同族（Timeout）：超时必须回传已收集到的 stdout / stderr', () => {
  it('🔴 变异哨兵：旧载荷「缺 stdout/stderr」当场判错；真实现判对', async () => {
    const legacyViolations = timeoutEchoViolations(legacyTimeoutPayload());
    // 哨兵必须红：证明这道门能杀掉旧实现（否则就是假绿）
    expect(legacyViolations.length).toBeGreaterThan(0);
    console.log(
      `旧实现（Timeout 只带 argv）⇒ 违反 ${legacyViolations.length} 条：${legacyViolations.join('；')}`,
    );

    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 20 });
    // 超时前先喂入「部分输出」：这正是「命令跑了一半才被杀」的真机形态
    fake.emitText('PARTIAL-OUT', 'stdout');
    fake.emitText('PARTIAL-ERR', 'stderr');
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('Timeout');
    const liveViolations = timeoutEchoViolations(result as unknown as Record<string, unknown>);
    console.log(`新实现（Timeout 带 stdout/stderr）⇒ 违反 ${liveViolations.length} 条`);
    expect(liveViolations).toEqual([]);
    expect(result.stdout).toBe('PARTIAL-OUT');
    expect(result.stderr).toBe('PARTIAL-ERR');
  });

  it('字段集**不多不少**：Timeout ⇒ ok/code/message/argv/stderr/stdout（无 exitCode）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 20 });
    fake.emitText('X', 'stdout');
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(keys(result)).toEqual(['argv', 'code', 'message', 'ok', 'stderr', 'stdout']);
  });

  it('超时时零输出 ⇒ 字段仍在且为空串（「没这个字段」与「值为空」不得混为一谈）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const result = await exec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 20 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('Timeout');
    expect('stdout' in result).toBe(true);
    expect('stderr' in result).toBe(true);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('仍按调用方声明的编码解码（utf16le 的部分输出不得乱码）', async () => {
    const fake = fakeSpawn();
    const exec = createExecutor(fake.spawn, neverKill);
    const pending = exec('wsl.exe', ['-l', '-v'], { encoding: 'utf16le', timeoutMs: 20 });
    fake.emitBytes(Buffer.from('Ubuntu2204', 'utf16le'), 'stdout');
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stdout).toBe('Ubuntu2204');
  });

  it('其它分支字段集未被改变：成功路径 / NonZeroExit', async () => {
    const okFake = fakeSpawn();
    const okExec = createExecutor(okFake.spawn, neverKill);
    const okPending = okExec('wsl.exe', ['-l', '-v'], { encoding: 'utf8', timeoutMs: 1000 });
    okFake.emitText('NAME STATE', 'stdout');
    okFake.emitText('warn', 'stderr');
    okFake.emitClose(0);
    const okResult = await okPending;
    expect(okResult.ok).toBe(true);
    if (!okResult.ok) return;
    expect(keys(okResult)).toEqual(['exitCode', 'ok', 'stderr', 'stdout']);

    const failFake = fakeSpawn();
    const failExec = createExecutor(failFake.spawn, neverKill);
    const failPending = failExec('powershell.exe', ['-File', 'elevate.ps1'], {
      encoding: 'utf8',
      timeoutMs: 1000,
    });
    failFake.emitText('{"ok":true}', 'stdout');
    failFake.emitClose(1);
    const failResult = await failPending;
    expect(failResult.ok).toBe(false);
    if (failResult.ok) return;
    expect(failResult.code).toBe('NonZeroExit');
    expect(keys(failResult)).toEqual(['argv', 'code', 'exitCode', 'message', 'ok', 'stderr', 'stdout']);
  });

  it('其它分支字段集未被改变：启动前失败 / CommandNotFound / 非 ENOENT 的 error ⇒ **不带** stdout', async () => {
    const noProcess = createExecutor(fakeSpawn().spawn, neverKill);
    const preStart = await noProcess('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 0 });
    expect(preStart.ok).toBe(false);
    if (!preStart.ok) expect(keys(preStart)).toEqual(['argv', 'code', 'message', 'ok']);

    const missingFake = fakeSpawn();
    const missingExec = createExecutor(missingFake.spawn, neverKill);
    const missingPending = missingExec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 1000 });
    missingFake.emitError('ENOENT');
    const missing = await missingPending;
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe('CommandNotFound');
      expect(keys(missing)).toEqual(['argv', 'code', 'message', 'ok']);
    }

    const badFake = fakeSpawn();
    const badExec = createExecutor(badFake.spawn, neverKill);
    const badPending = badExec('wsl.exe', ['-l'], { encoding: 'utf8', timeoutMs: 1000 });
    badFake.emitError('EACCES');
    const bad = await badPending;
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.code).toBe('Unexpected');
      expect(keys(bad)).toEqual(['argv', 'code', 'message', 'ok']);
    }
  });
});
