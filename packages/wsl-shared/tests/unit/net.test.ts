/**
 * T3.1–T3.3 eth0 探测单测：解析走合成输入、探测走 fake 执行器，**不产生任何真实进程**。
 * 真机字节的断言在 `tests/contract/net.test.ts`（只有那层允许出现 fixture）。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  ETH0_COLD_START_TIMEOUT_MS,
  ETH0_PROBE_TIMEOUT_MS,
  parseEth0Address,
  probeEth0,
} from '../../src/net.ts';
import type { WslDistro } from '../../src/distros.ts';
import type { Executor } from '../../src/exec.ts';

/** 真机形态（fixture 的原文，含 `-o` 的 `\` + 空格续行段） */
const REAL_SHAPE =
  '2: eth0    inet 172.20.201.152/20 brd 172.20.207.255 scope global eth0\\       valid_lft forever preferred_lft forever\n';

const running: WslDistro[] = [
  { name: 'Ubuntu2204', state: 'Running', version: 2, isDefault: true },
  { name: 'Debian', state: 'Stopped', version: 2, isDefault: false },
];
const stopped: WslDistro[] = [
  { name: 'Ubuntu2204', state: 'Stopped', version: 2, isDefault: true },
];

const okExecutor = (stdout: string) =>
  vi.fn<Executor>(async () => ({
    ok: true as const,
    exitCode: 0 as const,
    stdout,
    stderr: '',
  }));

describe('T3.1 解析 `ip -4 -o addr`（REQ-2.1 / REQ-2.2）', () => {
  it('真机形态单行 → 取 inet 地址（`\\` 续行段被原样忽略）', () => {
    expect(parseEth0Address(REAL_SHAPE)).toBe('172.20.201.152');
  });

  it('多个 IPv4 → 取**首个**（REQ-2.2：不是数组、不是拼接串）', () => {
    const text =
      '2: eth0    inet 10.0.0.5/24 scope global eth0\n' +
      '2: eth0    inet 10.0.0.6/24 scope global secondary eth0\n';
    expect(parseEth0Address(text)).toBe('10.0.0.5');
  });

  it('接受 UTF-8 字节（真机就是字节流，本模块固定 utf8）', () => {
    expect(parseEth0Address(new Uint8Array(Buffer.from(REAL_SHAPE, 'utf8')))).toBe(
      '172.20.201.152',
    );
  });

  it('负例：把真机字节按 UTF-16LE 解 → 解析失败（编码指纹必要性的对照例）', () => {
    const utf16Bytes = new Uint8Array(Buffer.from(REAL_SHAPE, 'utf16le'));
    expect(parseEth0Address(utf16Bytes)).toBeUndefined();
  });

  it('CRLF 行尾不影响解析', () => {
    expect(parseEth0Address(REAL_SHAPE.replace('\n', '\r\n'))).toBe('172.20.201.152');
  });
});

describe('T3.2 取不到就 NoInterface，绝不回落（REQ-2.3）', () => {
  it.each([
    ['空输出', ''],
    ['只有 inet6', '2: eth0    inet6 fe80::215:5dff:fe00:1234/64 scope link\n'],
    ['`lo` 的输出（含 127.0.0.1）', '1: lo    inet 127.0.0.1/8 scope host lo\n'],
    ['`0.0.0.0`（未设置）', '2: eth0    inet 0.0.0.0/24 scope global eth0\n'],
    ['只有 brd 段、无 inet', '2: eth0    brd 172.20.207.255 scope global eth0\n'],
  ])('解析层：%s → undefined', (_label, text) => {
    expect(parseEth0Address(text)).toBeUndefined();
  });

  it('前导零 / 越界地址不是合法点分十进制 → undefined（宁可说"没有"，不报错地址）', () => {
    expect(parseEth0Address('2: eth0    inet 172.020.1.1/20 scope global eth0\n')).toBeUndefined();
    expect(parseEth0Address('2: eth0    inet 999.20.1.1/20 scope global eth0\n')).toBeUndefined();
  });

  it('`0.0.0.0` 被跳过后仍能取到后面的真实地址', () => {
    const text =
      '2: eth0    inet 0.0.0.0/24 scope global eth0\n' +
      '2: eth0    inet 172.20.201.152/20 scope global eth0\n';
    expect(parseEth0Address(text)).toBe('172.20.201.152');
  });

  it('探测层：`lo` 的输出 → NoInterface，且结论里不出现 127.0.0.1（不回落）', async () => {
    const outcome = await probeEth0(okExecutor('1: lo    inet 127.0.0.1/8 scope host lo\n'), 'Ubuntu2204', running);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('NoInterface');
    expect(outcome.message).not.toContain('127.0.0.1');
    expect(outcome.message.length).toBeGreaterThan(0);
  });

  it('探测层：eth0 不存在（`ip` 退出码非 0）→ 原样透传 NonZeroExit（不吞成 NoInterface）', async () => {
    const executor = vi.fn<Executor>(async () => ({
      ok: false as const,
      code: 'NonZeroExit' as const,
      message: '命令以退出码 1 结束：wsl.exe',
      exitCode: 1,
      stderr: 'Device "eth0" does not exist.',
    }));
    const outcome = await probeEth0(executor, 'Ubuntu2204', running);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('NonZeroExit');
    expect(outcome.stderr).toContain('does not exist');
  });
});

describe('T3.3 冷启动守卫（REQ-2.4）与存在性守卫（REQ-2.5）', () => {
  it('Stopped 发行版 → DistroNotRunning，且**一次都没调用**探测命令（不冷启动）', async () => {
    const executor = okExecutor(REAL_SHAPE);
    const outcome = await probeEth0(executor, 'Ubuntu2204', stopped);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('DistroNotRunning');
    expect(executor).not.toHaveBeenCalled();
  });

  it('非 Running 的其它状态（Installing）同样被拦下', async () => {
    const executor = okExecutor(REAL_SHAPE);
    const outcome = await probeEth0(executor, 'Ubuntu2204', [
      { name: 'Ubuntu2204', state: 'Installing', version: 2, isDefault: true },
    ]);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('DistroNotRunning');
    expect(executor).not.toHaveBeenCalled();
  });

  it('名字不存在 → DistroNotFound 且带可用发行版名列表，零调用（REQ-2.5）', async () => {
    const executor = okExecutor(REAL_SHAPE);
    const outcome = await probeEth0(executor, 'Fedora', running);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('DistroNotFound');
    expect(outcome.distros).toEqual(['Ubuntu2204', 'Debian']);
    expect(executor).not.toHaveBeenCalled();
  });

  it('REQ-2.4 的唯一例外：allowColdStart → 允许执行，并改用**冷启动超时**', async () => {
    const executor = okExecutor(REAL_SHAPE);
    const outcome = await probeEth0(executor, 'Ubuntu2204', stopped, { allowColdStart: true });

    expect(outcome.ok).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]?.[2]?.timeoutMs).toBe(ETH0_COLD_START_TIMEOUT_MS);
  });

  it('Running → 执行一次，argv / 编码 / 超时正确，且用列表里的**权威名字**（大小写以 WSL 为准）', async () => {
    const executor = okExecutor(REAL_SHAPE);
    const outcome = await probeEth0(executor, 'ubuntu2204', running);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.ip).toBe('172.20.201.152');
    expect(executor.mock.calls[0]?.[0]).toBe('wsl.exe');
    expect(executor.mock.calls[0]?.[1]).toEqual([
      '-d',
      'Ubuntu2204',
      '--',
      'ip',
      '-4',
      '-o',
      'addr',
      'show',
      'dev',
      'eth0',
    ]);
    expect(executor.mock.calls[0]?.[2]).toMatchObject({
      encoding: 'utf8',
      timeoutMs: ETH0_PROBE_TIMEOUT_MS,
    });
  });

  it('timeoutMs 可显式覆盖', async () => {
    const executor = okExecutor(REAL_SHAPE);
    await probeEth0(executor, 'Ubuntu2204', running, { timeoutMs: 4321 });
    expect(executor.mock.calls[0]?.[2]?.timeoutMs).toBe(4321);
  });
});

describe('探测层的错误透传（不吞、不改写）', () => {
  it('执行器 Timeout → 原样透传（冷启动/网络卡住是最可能的真实失败）', async () => {
    const executor = vi.fn<Executor>(async () => ({
      ok: false as const,
      code: 'Timeout' as const,
      message: '命令在 10000ms 内未结束，已终止：wsl.exe',
      argv: ['wsl.exe', '-d', 'Ubuntu2204', '--', 'ip'],
    }));
    const outcome = await probeEth0(executor, 'Ubuntu2204', running);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('Timeout');
    expect(outcome.message).toContain('未结束');
    expect(outcome.argv).toEqual(['wsl.exe', '-d', 'Ubuntu2204', '--', 'ip']);
  });
});
