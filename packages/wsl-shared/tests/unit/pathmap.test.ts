/**
 * T4.1–T4.4 路径翻译单测（REQ-3.1–3.7）
 *
 * 三条纪律：
 * ① **表格驱动**（正例逐条对拍 design §3.3 的表）；
 * ② **反例优先**（非法字符先于形态判定、相对路径、未知 UNC、非字符串、纯函数性）；
 * ③ **静态断言纯函数性**：剥注释后源码不得出现 `node:fs` / `node:child_process`（REQ-3.7）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { winToWsl, wslToWin, type PathMappingOutcome } from '../../src/pathmap.ts';
import type { ErrorCode, WslSharedError } from '../../src/errors.ts';

const mapped = (outcome: PathMappingOutcome): string => {
  if (!outcome.ok) throw new Error(`期望成功，实得 ${outcome.code}: ${outcome.message}`);
  return outcome.path;
};
const failed = (outcome: PathMappingOutcome): WslSharedError => {
  if (outcome.ok) throw new Error(`期望失败，实得 ${outcome.path}`);
  return outcome;
};
const codeOf = (outcome: PathMappingOutcome): ErrorCode => failed(outcome).code;

describe('T4.1 盘符双向翻译（REQ-3.1/3.2）', () => {
  it.each([
    ['E:\\x\\y', '/mnt/e/x/y'],
    ['e:/x/y', '/mnt/e/x/y'],
    ['E:x', '/mnt/e/x'],
    ['E:\\', '/mnt/e'],
    ['E:', '/mnt/e'], // ⚠️ win32.normalize('E:') → 'E:.' —— 盘符必须先摘出来
    ['E:.', '/mnt/e'],
    ['E:\\x\\', '/mnt/e/x'],
    ['E:\\x\\\\y', '/mnt/e/x/y'],
    ['E:\\x\\..\\y', '/mnt/e/y'],
    ['E:\\..\\..\\x', '/mnt/e/x'], // 越界被 normalize 夹在盘根
    ['C:\\Program Files\\My App', '/mnt/c/Program Files/My App'],
    ['D:\\资料\\项目', '/mnt/d/资料/项目'],
  ])('winToWsl(%s) → %s', (input, expected) => {
    expect(mapped(winToWsl(input))).toBe(expected);
  });

  it.each([
    ['/mnt/e/x/y', 'E:\\x\\y'],
    ['/mnt/e', 'E:\\'],
    ['/mnt/e/', 'E:\\'],
    ['/mnt/e/x/', 'E:\\x'],
    ['/mnt/e/x/..', 'E:\\'],
    ['/mnt/e/../f', 'F:\\'], // 真实形态就是 /mnt/f ⇒ 照实翻译，不"修正"
    ['/mnt/d/资料/项目', 'D:\\资料\\项目'],
  ])('wslToWin(%s) → %s', (input, expected) => {
    expect(mapped(wslToWin(input))).toBe(expected);
  });

  it('往返一致：winToWsl → wslToWin 回到原形（大小写与分隔符按 Windows 习惯归一）', () => {
    for (const win of ['C:\\Program Files\\My App', 'D:\\资料\\项目', 'E:\\']) {
      expect(mapped(wslToWin(mapped(winToWsl(win))))).toBe(win);
    }
  });
});

describe('T4.2 UNC 双向（REQ-3.3）', () => {
  it.each([
    ['\\\\wsl.localhost\\Ubuntu2204\\home\\u', '/home/u'],
    ['\\\\wsl$\\Ubuntu2204\\home\\u', '/home/u'],
    ['\\\\WSL.LOCALHOST\\Ubuntu2204\\home\\u', '/home/u'],
    ['//wsl.localhost/Ubuntu2204/home/u', '/home/u'], // 正斜杠形态（Windows 也接受）
    ['\\\\wsl.localhost\\Ubuntu2204\\home\\u\\', '/home/u'],
    ['\\\\wsl.localhost\\Ubuntu 22.04\\home\\u', '/home/u'], // 名字含空格
    ['\\\\wsl.localhost\\Ubuntu2204', '/'], // 发行版根
    ['\\\\wsl$\\Ubuntu2204\\home\\..\\u', '/u'], // 根内 `..` 正常消解
    ['\\\\wsl$\\Ubuntu2204\\home\\u\\..\\..', '/'],
    // `..` 被夹在**共享根**（与 Win32 的 UNC 语义一致，见 pathmap.ts 的实测注释）：
    ['\\\\wsl.localhost\\D\\..\\..\\x', '/x'],
    ['\\\\wsl.localhost\\D\\..', '/'],
    ['\\\\wsl.localhost\\D\\home\\..\\..\\u', '/u'],
  ])('winToWsl(%s) → %s', (input, expected) => {
    expect(mapped(winToWsl(input))).toBe(expected);
  });

  it('往返一致：UNC → Linux → UNC（WSL 侧统一用 \\\\wsl.localhost 形态，REQ-3.4）', () => {
    expect(mapped(wslToWin(mapped(winToWsl('\\\\wsl$\\D\\home\\u')), 'D'))).toBe(
      '\\\\wsl.localhost\\D\\home\\u',
    );
    expect(mapped(winToWsl(mapped(wslToWin('/home/u', 'D'))))).toBe('/home/u');
  });

  it.each([
    ['/home/u', 'Ubuntu2204', '\\\\wsl.localhost\\Ubuntu2204\\home\\u'],
    ['/home/u', 'Ubuntu 22.04', '\\\\wsl.localhost\\Ubuntu 22.04\\home\\u'],
    ['/', 'Ubuntu2204', '\\\\wsl.localhost\\Ubuntu2204\\'],
    ['/mnt/e/x', 'Ubuntu2204', 'E:\\x'], // /mnt 优先走盘符，发行版名不参与
  ])('wslToWin(%s, %s) → %s', (input, distro, expected) => {
    expect(mapped(wslToWin(input, distro))).toBe(expected);
  });
});

describe('T4.3 无盘符 Linux 路径：绝不猜盘符（REQ-3.4）', () => {
  it.each(['/home/u', '/', '/mnt', '/opt/data'])('%s 无发行版名 → NoWindowsEquivalent', (input) => {
    const error = failed(wslToWin(input));
    expect(error.code).toBe('NoWindowsEquivalent');
    expect(error.message).toContain('不猜盘符');
    // 断言没有偷偷兜底成盘符路径：错误里既没有 path 字段，消息里也不出现 `X:\`
    expect(error.path).toBeUndefined();
    expect(error.message).not.toMatch(/[A-Za-z]:\\/);
  });

  it.each(['', '   '])('发行版名为空（%j）等同未提供 → NoWindowsEquivalent', (distro) => {
    expect(codeOf(wslToWin('/home/u', distro))).toBe('NoWindowsEquivalent');
  });

  it.each(['a|b', '../x', 'a\\b', 'a/b', '..', '.'])(
    '发行版名 %j 不能拼进 UNC → UnmappablePath',
    (distro) => {
      const error = failed(wslToWin('/home/u', distro));
      expect(error.code).toBe('UnmappablePath');
      expect(error.message).toContain('发行版名');
    },
  );

  it('/mnt/C（大写）不是挂载点 ⇒ 仍按无盘符路径处理（REQ-3.4）', () => {
    expect(codeOf(wslToWin('/mnt/C/x'))).toBe('NoWindowsEquivalent');
    expect(mapped(wslToWin('/mnt/C/x', 'Ubuntu2204'))).toBe('\\\\wsl.localhost\\Ubuntu2204\\mnt\\C\\x');
  });
});

describe('T4.4 非法输入、纯函数性（REQ-3.5/3.6/3.7）', () => {
  it.each([
    ['', '空路径'],
    ['   ', '空路径'],
    ['relative\\x', '相对路径'],
    ['\\\\server\\share', '未知 UNC'],
    ['\\\\wsl.localhost', '没有发行版段'],
    ['\\\\wsl.localhostx\\D\\x', '前缀不符'],
    ['\\Windows\\System32', '无盘符的根路径'],
    ['E:\\x?y', '保留字符'],
    ['E:\\x*y', '保留字符'],
    ['E:\\x<y', '保留字符'],
    ['E:\\x|y', '保留字符'],
    ['E:\\x"y', '保留字符'],
    ['E:\\x:y', '非盘符位置的冒号'],
    ['E:\\x\u0007y', '控制字符'],
  ])('winToWsl(%j) → UnmappablePath', (input) => {
    expect(codeOf(winToWsl(input))).toBe('UnmappablePath');
  });

  it.each([
    ['', '空路径'],
    ['foo/bar', '相对路径'],
    ['/home/a?b', '保留字符'],
    ['/home/a*b', '保留字符'],
    ['/home/a:b', '保留字符'],
    ['/home/a\\b', '反斜杠会变成分隔符 ⇒ 静默错译'],
    ['/home/a\u0000b', '控制字符'],
  ])('wslToWin(%j) → UnmappablePath', (input) => {
    expect(codeOf(wslToWin(input))).toBe('UnmappablePath');
  });

  it('非字符串入参不抛裸异常（REQ-3.5）', () => {
    expect(codeOf(winToWsl(123 as unknown as string))).toBe('UnmappablePath');
    expect(codeOf(wslToWin(null as unknown as string))).toBe('UnmappablePath');
  });

  it('任何脏输入都不抛异常，且返回值形态始终合法（REQ-3.5：失败必须是返回值）', () => {
    const nasty = ['\\', '\\\\', '/', '.', '..', '/..', 'E:\\', 'E:\\\\', '\\\\wsl.localhost\\\\', '\\\\wsl$\\\\',
      '🙂', 'a'.repeat(4096), '\tE:\\x', 'E:\\x ', 'E:\\x.', '\\\\?\\E:\\x'];
    for (const input of nasty) {
      expect(() => winToWsl(input)).not.toThrow();
      expect(() => wslToWin(input, 'Ubuntu2204')).not.toThrow();
      for (const outcome of [winToWsl(input), wslToWin(input, 'Ubuntu2204')]) {
        // 要么 ok:true 且 path 是字符串，要么 ok:false 且 code 是字符串 —— 不许出现半成品
        expect(outcome.ok ? typeof outcome.path === 'string' : typeof outcome.code === 'string').toBe(
          true,
        );
      }
    }
  });

  it('不做引号包装、不做转义：空格与中文原样保留（REQ-3.6）', () => {
    const out = mapped(winToWsl('C:\\Program Files\\我的 项目'));
    expect(out).toBe('/mnt/c/Program Files/我的 项目');
    expect(out).not.toContain('"');
    expect(out).not.toContain("'");
    expect(out).not.toContain('\\');
  });

  it('纯函数：同输入同输出，且不改动入参（REQ-3.7）', () => {
    const input = 'E:\\x\\y';
    const first = winToWsl(input);
    const second = winToWsl(input);
    expect(second).toEqual(first);
    expect(input).toBe('E:\\x\\y');
  });

  it('静态断言：剥注释后源码不碰文件系统、不起进程（REQ-3.7）', () => {
    const source = readFileSync(new URL('../../src/pathmap.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const forbidden of ['node:fs', 'node:child_process', 'readFile', 'writeFile', 'statSync', 'spawn']) {
      expect(code).not.toContain(forbidden);
    }
  });
});
