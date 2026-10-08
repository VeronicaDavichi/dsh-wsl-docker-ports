/**
 * T3.4 通用「带守卫的发行版内执行」单测（2026-10-08 主人拍板新增）
 *
 * 这一件的意义是**守卫只有一份实现**：REQ-2.4 的「非 Running 绝不唤醒」在这里被钉死，
 * 消费方（eth0 探测、003 读层的 `docker ps`）都走它，不各写一遍。
 * 全部用 fake 执行器，**不产生真实进程、不唤醒发行版**。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  DISTRO_EXEC_COLD_START_TIMEOUT_MS,
  DISTRO_EXEC_TIMEOUT_MS,
  execInDistro,
} from '../../src/distro-exec.ts';
import type { WslDistro, WslDistroState } from '../../src/distros.ts';
import type { Executor } from '../../src/exec.ts';

const running: WslDistro[] = [
  { name: 'Ubuntu2204', state: 'Running', version: 2, isDefault: true },
  { name: 'Debian', state: 'Stopped', version: 2, isDefault: false },
];
const stopped: WslDistro[] = [
  { name: 'Ubuntu2204', state: 'Stopped', version: 2, isDefault: true },
];

const okExecutor = (stdout = '', stderr = '') =>
  vi.fn<Executor>(async () => ({ ok: true as const, exitCode: 0 as const, stdout, stderr }));

describe('T3.4 守卫：存在性（REQ-2.5）与状态（REQ-2.4）', () => {
  it('空 argv → Unexpected 且**零调用**（`wsl -d X --` 空命令会变成交互式 shell：既挂住又唤醒发行版）', async () => {
    const executor = okExecutor();
    const outcome = await execInDistro(executor, 'Ubuntu2204', running, []);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('Unexpected');
    expect(outcome.message).toContain('至少一个命令');
    expect(executor).not.toHaveBeenCalled();
  });

  it('名字不存在 → DistroNotFound 且带可用列表，零调用', async () => {
    const executor = okExecutor();
    const outcome = await execInDistro(executor, 'Fedora', running, ['true']);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('DistroNotFound');
    expect(outcome.distros).toEqual(['Ubuntu2204', 'Debian']);
    expect(executor).not.toHaveBeenCalled();
  });

  it.each(['Stopped', 'Installing', 'Uninstalling', 'Converting', 'Unknown'] as const)(
    '%s → DistroNotRunning 且**零调用**（执行即冷启动 12.6s + 拉起用户的全部容器）',
    async (state: WslDistroState) => {
      const executor = okExecutor();
      const outcome = await execInDistro(executor, 'Ubuntu2204', [
        { name: 'Ubuntu2204', state, version: 2, isDefault: true },
      ], ['true']);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe('DistroNotRunning');
      expect(outcome.message).toContain(state);
      expect(executor).not.toHaveBeenCalled();
    },
  );
});

describe('T3.4 执行：argv / 编码 / 超时 / 权威名字', () => {
  it('Running → 成功返回：stdout/stderr 透传 + 列表里的权威名字 + 完整 argv', async () => {
    const executor = okExecutor('容器列表\n', '警告\n');
    const outcome = await execInDistro(executor, 'ubuntu2204', running, [
      'docker',
      'ps',
      '--format',
      '{{json .}}',
    ]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.stdout).toBe('容器列表\n');
    expect(outcome.stderr).toBe('警告\n');
    expect(outcome.distro).toBe('Ubuntu2204');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.argv).toEqual([
      'wsl.exe',
      '-d',
      'Ubuntu2204',
      '--',
      'docker',
      'ps',
      '--format',
      '{{json .}}',
    ]);
    expect(executor.mock.calls[0]?.[0]).toBe('wsl.exe');
    expect(executor.mock.calls[0]?.[1]).toEqual([
      '-d',
      'Ubuntu2204',
      '--',
      'docker',
      'ps',
      '--format',
      '{{json .}}',
    ]);
  });

  it('默认编码 utf8、默认超时 = 热路径常量', async () => {
    const executor = okExecutor();
    await execInDistro(executor, 'Ubuntu2204', running, ['true']);

    expect(executor.mock.calls[0]?.[2]).toEqual({
      encoding: 'utf8',
      timeoutMs: DISTRO_EXEC_TIMEOUT_MS,
    });
  });

  it('需要 utf16le 的命令（如 `wsl -l -v` 那类自带消息）必须显式声明 —— 不靠猜', async () => {
    const executor = okExecutor();
    await execInDistro(executor, 'Ubuntu2204', running, ['true'], { encoding: 'utf16le' });

    expect(executor.mock.calls[0]?.[2]?.encoding).toBe('utf16le');
  });

  it('allowColdStart → 跳过状态守卫，并改用**冷启动超时**（REQ-2.4 的唯一例外）', async () => {
    const executor = okExecutor();
    const outcome = await execInDistro(executor, 'Ubuntu2204', stopped, ['true'], {
      allowColdStart: true,
    });

    expect(outcome.ok).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]?.[2]?.timeoutMs).toBe(DISTRO_EXEC_COLD_START_TIMEOUT_MS);
  });

  it('timeoutMs / allowColdStart 都不传时走默认（不透传 undefined，`exactOptionalPropertyTypes` 友好）', async () => {
    const executor = okExecutor();
    await execInDistro(executor, 'Ubuntu2204', running, ['true'], {});

    expect(executor.mock.calls[0]?.[2]).toEqual({
      encoding: 'utf8',
      timeoutMs: DISTRO_EXEC_TIMEOUT_MS,
    });
  });
});

describe('T3.4 错误透传（不吞、不改写）', () => {
  it.each(['NonZeroExit', 'Timeout', 'CommandNotFound'] as const)(
    '执行器返回 %s → 原样透传',
    async (code) => {
      const executor = vi.fn<Executor>(async () => ({
        ok: false as const,
        code,
        message: `底层结论：${code}`,
        argv: ['wsl.exe', '-d', 'Ubuntu2204', '--', 'true'],
      }));
      const outcome = await execInDistro(executor, 'Ubuntu2204', running, ['true']);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe(code);
      expect(outcome.message).toContain(code);
    },
  );
});
