/**
 * T1.1 错误模型单测：每个 code 都有工厂、`extra` 按需出现、判别守卫有效。
 */
import { describe, expect, it } from 'vitest';

import { ERROR_CODES, ERROR_HINTS, fail, isWslFailure } from '../../src/errors.ts';

describe('T1.1 类型化错误模型', () => {
  it('每个 code 都能经 fail() 造出 ok:false 的对象，且 message 非空', () => {
    for (const code of ERROR_CODES) {
      const error = fail(code, `${code} 的说明`);
      expect(error.ok).toBe(false);
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('ERROR_HINTS 覆盖全部 code（不漏项、不多项）', () => {
    expect(Object.keys(ERROR_HINTS).sort()).toEqual([...ERROR_CODES].sort());
    for (const code of ERROR_CODES) {
      expect(ERROR_HINTS[code].length).toBeGreaterThan(0);
    }
  });

  it('未提供的 extra 字段不出现在结果里（不伪造 undefined）', () => {
    const error = fail('Timeout', '超时了');
    expect('argv' in error).toBe(false);
    expect('exitCode' in error).toBe(false);
    expect('stderr' in error).toBe(false);
    expect('path' in error).toBe(false);
    expect('distros' in error).toBe(false);
  });

  it('提供的 extra 字段按 code 出现（argv / exitCode / stderr / path / distros）', () => {
    const nonZero = fail('NonZeroExit', '退出码非 0', {
      argv: ['wsl.exe', '-l', '-v'],
      exitCode: 1,
      stderr: 'boom',
    });
    expect(nonZero.argv).toEqual(['wsl.exe', '-l', '-v']);
    expect(nonZero.exitCode).toBe(1);
    expect(nonZero.stderr).toBe('boom');

    const missing = fail('DistroNotFound', '不存在', { distros: ['Ubuntu2204'] });
    expect(missing.distros).toEqual(['Ubuntu2204']);

    const unreadable = fail('ConfigUnreadable', '读不到', { path: 'C:\\Users\\x\\.wslconfig' });
    expect(unreadable.path).toBe('C:\\Users\\x\\.wslconfig');
  });

  it('isWslFailure 区分失败态与成功态', () => {
    expect(isWslFailure(fail('NoDistro', '一个都没有'))).toBe(true);
    const success = { ok: true, exitCode: 0, stdout: '', stderr: '' };
    expect(isWslFailure(success)).toBe(false);
  });
});
