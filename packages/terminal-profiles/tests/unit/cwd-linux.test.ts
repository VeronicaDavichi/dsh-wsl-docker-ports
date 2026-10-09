/**
 * T1.2 `cwdLinux` 推导接线（REQ-1.4）—— **用真 001** 的那一半
 *
 * 本文件不 mock：它钉的是「**复用** 001 的路径翻译」。所以夹具特意挑 001 的**特有形态**
 * （UNC 共享、裸盘符 `E:`、盘符相对 `E:x`）—— 手搓一个「拼 /mnt/<字母>」的实现会在这几条上翻车。
 * 「什么时候**调**它 / 什么时候**不调**」是另一半，在 `cwd-linux-wiring.test.ts`（fake 001）里断言。
 */

import { describe, expect, it } from 'vitest';

import { deriveCwdLinux } from '../../src/config/cwd-linux.ts';
import { isStartable, parseProfiles } from '../../src/config/profiles.ts';

describe('T1.2 deriveCwdLinux —— 消费 001 的 winToWsl', () => {
  it('REQ-1.4 正常：E:\\proj → /mnt/e/proj', () => {
    expect(deriveCwdLinux('E:\\proj')).toStrictEqual({ ok: true, cwdLinux: '/mnt/e/proj' });
  });

  it('REQ-1.4 正常：001 的特有形态照旧生效（UNC 共享 → 发行版内路径；裸盘符 E: → /mnt/e；E:x → /mnt/e/x）', () => {
    expect(deriveCwdLinux('\\\\wsl.localhost\\Ubuntu2204\\home\\u')).toStrictEqual({
      ok: true,
      cwdLinux: '/home/u',
    });
    expect(deriveCwdLinux('E:')).toStrictEqual({ ok: true, cwdLinux: '/mnt/e' });
    expect(deriveCwdLinux('E:x')).toStrictEqual({ ok: true, cwdLinux: '/mnt/e/x' });
  });

  it('REQ-1.4 边界：入参首尾空白按 001 的口径 trim', () => {
    expect(deriveCwdLinux('  E:\\proj  ')).toStrictEqual({ ok: true, cwdLinux: '/mnt/e/proj' });
  });

  it('REQ-1.4 异常：相对路径 / 服务器共享 / 非法字符 ⇒ UnmappablePath，**不猜**路径', () => {
    for (const bad of ['relative\\path', '\\\\server\\share', 'E:\\x?y', '']) {
      const derived = deriveCwdLinux(bad);
      expect(derived.ok).toBe(false);
      if (!derived.ok) {
        expect(derived.error.code).toBe('UnmappablePath');
        expect(derived.error.message.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('T1.2 parseProfiles 的推导接线（REQ-1.4）', () => {
  it('REQ-1.4 正常：WSL profile 只填 cwd ⇒ 推导出 cwdLinux，零诊断且可启动', () => {
    const result = parseProfiles([{ name: 'w', command: 'wsl.exe', cwd: 'E:\\proj' }]);
    expect(result.diagnostics).toStrictEqual([]);
    expect(result.profiles[0]).toStrictEqual({
      name: 'w',
      command: 'wsl.exe',
      args: [],
      env: {},
      cwd: 'E:\\proj',
      cwdLinux: '/mnt/e/proj',
    });
    expect(result.profiles.map(isStartable)).toStrictEqual([true]);
  });

  it('REQ-1.4 正常：显式给了 cwdLinux ⇒ 不推导、**不覆盖用户输入**', () => {
    const result = parseProfiles([
      { name: 'w', command: 'wsl.exe', cwd: 'E:\\proj', cwdLinux: '/home/me/proj' },
    ]);
    expect(result.diagnostics).toStrictEqual([]);
    expect(result.profiles[0]?.cwdLinux).toBe('/home/me/proj');
  });

  it('REQ-1.4 边界：非 WSL profile 只填 cwd ⇒ 不推导，也不标需修复', () => {
    const result = parseProfiles([{ name: 'p', command: 'pwsh.exe', cwd: 'E:\\proj' }]);
    expect(result.profiles[0]?.cwdLinux).toBeUndefined();
    expect(result.profiles[0]?.needsFix).toBeUndefined();
    expect(result.diagnostics).toStrictEqual([]);
  });

  it('REQ-1.4 边界：WSL profile 两个 cwd 都没填 ⇒ 不推导、不标需修复（留给启动期 REQ-3.3）', () => {
    const result = parseProfiles([{ name: 'w', command: 'wsl.exe' }]);
    expect(result.profiles[0]?.needsFix).toBeUndefined();
    expect(result.diagnostics).toStrictEqual([]);
  });

  it('REQ-1.4 异常：推导失败 ⇒ 该条**保留**（配置页要能看见它）+ CwdUnmappable + 不可启动', () => {
    const result = parseProfiles([{ name: 'w', command: 'wsl.exe', cwd: 'relative\\path' }]);

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.name).toBe('w');
    expect(result.profiles.map(isStartable)).toStrictEqual([false]);
    expect(result.diagnostics).toStrictEqual([
      {
        index: 0,
        kind: 'CwdUnmappable',
        message: expect.stringContaining('不可启动'),
        field: 'cwd',
        skipped: false,
        code: 'UnmappablePath',
      },
    ]);
  });

  it('REQ-1.4 异常：推导失败**不影响**同配置里的其他条目', () => {
    const result = parseProfiles([
      { name: 'bad', command: 'wsl.exe', cwd: 'relative\\path' },
      { name: 'good', command: 'wsl.exe', cwd: 'E:\\proj' },
      { name: 'win', command: 'pwsh.exe' },
    ]);
    expect(result.profiles.map((p) => p.name)).toStrictEqual(['bad', 'good', 'win']);
    expect(result.profiles.map(isStartable)).toStrictEqual([false, true, true]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
