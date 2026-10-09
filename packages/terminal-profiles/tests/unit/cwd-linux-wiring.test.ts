/**
 * T1.2 接线行为的另一半：**fake 001**（`vi.mock('dsh-wsl-shared')`）
 *
 * 真 001 证明「翻译得对」（见 `cwd-linux.test.ts`），本文件证明「**什么时候调它**」：
 * 只在 WSL profile 且需要推导时调、显式 `cwdLinux` 时一次都不调、重名被丢弃的条目不调。
 * 这层必须用 fake —— 真实现无法观察「没被调用」。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseProfiles } from '../../src/config/profiles.ts';

const { winToWslMock } = vi.hoisted(() => ({ winToWslMock: vi.fn() }));

vi.mock('dsh-wsl-shared', () => ({ winToWsl: winToWslMock }));

/** fake 成功的翻译结果：值刻意与真 001 不同 ⇒ 结果里出现它才说明**真的走了接线** */
const FAKE_OK = { ok: true, path: '/mnt/z/fake' };
/** fake 失败：错误码与 message 都照 001 的形状给，验「原样带回」 */
const FAKE_FAIL = { ok: false, code: 'UnmappablePath', message: 'fake 说这条路径翻不了' };

describe('T1.2 cwdLinux 推导接线（fake 001）', () => {
  beforeEach(() => {
    winToWslMock.mockReset();
  });

  it('REQ-1.4 正常：需要推导时调用 001 一次，入参就是 cwd，结果直接落进 cwdLinux', () => {
    winToWslMock.mockReturnValue(FAKE_OK);
    const result = parseProfiles([{ name: 'w', command: 'wsl.exe', cwd: 'E:\\proj' }]);

    expect(winToWslMock).toHaveBeenCalledTimes(1);
    expect(winToWslMock).toHaveBeenCalledWith('E:\\proj');
    expect(result.profiles[0]?.cwdLinux).toBe('/mnt/z/fake');
  });

  it('REQ-1.4 正常：显式给了 cwdLinux ⇒ 一次都不调 001，用户输入原样保留', () => {
    const result = parseProfiles([
      { name: 'w', command: 'wsl.exe', cwd: 'E:\\proj', cwdLinux: '/home/me/proj' },
    ]);

    expect(winToWslMock).not.toHaveBeenCalled();
    expect(result.profiles[0]?.cwdLinux).toBe('/home/me/proj');
  });

  it('REQ-1.4 边界：非 WSL profile、以及两个 cwd 都没填的 WSL profile ⇒ 都不调 001', () => {
    parseProfiles([
      { name: 'p', command: 'pwsh.exe', cwd: 'E:\\proj' },
      { name: 'w', command: 'wsl.exe' },
    ]);
    expect(winToWslMock).not.toHaveBeenCalled();
  });

  it('REQ-1.4 异常：001 返回 UnmappablePath ⇒ needsFix **原样**带回该错误，message 逐字进诊断', () => {
    winToWslMock.mockReturnValue(FAKE_FAIL);
    const result = parseProfiles([{ name: 'w', command: 'wsl.exe', cwd: 'E:\\proj' }]);

    expect(result.profiles[0]?.needsFix).toStrictEqual(FAKE_FAIL);
    expect(result.diagnostics[0]).toMatchObject({
      kind: 'CwdUnmappable',
      code: 'UnmappablePath',
      skipped: false,
    });
    expect(result.diagnostics[0]?.message).toContain('fake 说这条路径翻不了');
  });

  it('REQ-1.4 边界：重名被丢弃的条目**不**参与推导（诊断一对一，不多报一条）', () => {
    winToWslMock.mockReturnValue(FAKE_OK);
    const result = parseProfiles([
      { name: 'w', command: 'wsl.exe', cwd: 'E:\\a' },
      { name: 'w', command: 'wsl.exe', cwd: 'E:\\b' },
    ]);

    expect(winToWslMock).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('DuplicateName');
  });
});
