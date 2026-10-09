/**
 * T4.1–T4.4 路径翻译单测（**006** REQ-3.1–3.7 —— 2026-10-09 自 001 迁出的独立 Spec，编号保持）
 *
 * 三条纪律：
 * ① **表格驱动**（正例逐条对拍 006 design §3 的表）；
 * ② **反例优先**（非法字符先于形态判定、相对路径、未知 UNC、非字符串、纯函数性）；
 * ③ **静态断言纯函数性**：剥注释后源码不得出现 `node:fs` / `node:child_process`（REQ-3.7）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

  it.each(['\\\\wsl.localhost\\..\\x', '\\\\wsl.localhost\\.\\x', '\\\\wsl.localhost\\..'])(
    'UNC 的发行版段是 `.`/`..`（%s）→ UnmappablePath，不当正常名字吞掉（自审缺陷①）',
    (input) => {
      const error = failed(winToWsl(input));
      expect(error.code).toBe('UnmappablePath');
      expect(error.message).toContain('不是可识别的 UNC');
    },
  );

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

  it.each(['a|b', '../x', 'a\\b', 'a/b', '..', '.', 'D.', 'D .', 'D..'])(
    '发行版名 %j 不能拼进 UNC → UnmappablePath',
    (distro) => {
      const error = failed(wslToWin('/home/u', distro));
      expect(error.code).toBe('UnmappablePath');
      expect(error.message).toContain('发行版名');
    },
  );

  it('尾随点/空格被拒（自审缺陷③：Windows 共享名不允许），合法形态照常放行', () => {
    expect(failed(wslToWin('/home/u', 'D.')).message).toContain('以 . 或空格结尾');
    // `$`（隐藏共享）与前导点合法；空格在名字中间合法
    expect(mapped(wslToWin('/home/u', 'D$'))).toBe('\\\\wsl.localhost\\D$\\home\\u');
    expect(mapped(wslToWin('/home/u', '.D'))).toBe('\\\\wsl.localhost\\.D\\home\\u');
    expect(mapped(wslToWin('/home/u', 'Ubuntu 22.04'))).toBe('\\\\wsl.localhost\\Ubuntu 22.04\\home\\u');
  });

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

  it('错误 message 不回显控制字符、且限长（自审缺陷②：UI/日志 ANSI 注入面）', () => {
    // ESC 原样进 UI/日志会注入 ANSI 转义 ⇒ 必须转成可见文本
    const esc = failed(winToWsl('E:\\x\u001b[31mred'));
    expect(esc.message).not.toContain('\u001b');
    expect(esc.message).toContain('\\u001b');
    // 任何控制字符都不许出现在消息里（包括 \n / \u0007）
    expect(failed(wslToWin('/home/a\u0007b')).message).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(failed(wslToWin('/home/u', 'D\u0007')).message).not.toMatch(/[\u0000-\u001f\u007f]/);
    // 超长脏输入不把消息撑爆：**消息长度只跟"位数的位数"有关**（都截断到 ECHO_MAX），且报出真实长度
    const huge = failed(winToWsl('a'.repeat(4096)));
    expect(huge.message).toContain('共 4096 字符');
    expect(huge.message.length).toBe(failed(winToWsl('a'.repeat(1000))).message.length);
    expect(huge.message.length).toBeLessThan(260);
    expect(failed(winToWsl(`E:\\x${'\u0007'.repeat(200)}?`)).message.length).toBeLessThan(260);
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
    // 更强的结构断言：依赖面被**枚举死** —— 只许 node:path（归一）与 ./errors.ts（错误工厂），
    // 加 `node:os` / 配置读取 / 任何第三方包都会在这里失败。
    const specifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual(['./errors.ts', 'node:path']);
  });
});

describe('T4.4+ 属性化不变量（固定种子 ⇒ 可复算）', () => {
  // 确定性 PRNG（不用 Math.random）：失败可原样复现，不需要记录"跑出问题的那一串"
  let seed = 20261008;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length) % arr.length] as T;
  const SEGS = ['x', 'my dir', '资料', 'a.b', '.hidden', 'D$share', 'ünïcode', '🙂', 'CON'] as const;
  const someSegs = (n: number): string[] => Array.from({ length: n }, () => pick(SEGS));

  it('Windows 路径往返回到归一原形，且输出形态恒为 /mnt/<小写盘符>/…', () => {
    for (let i = 0; i < 1500; i += 1) {
      const win = `${pick(['C', 'D', 'E', 'F'])}:\\${someSegs(1 + Math.floor(rnd() * 4)).join('\\')}`;
      const out = winToWsl(win);
      expect(out.ok, `${win} 被拒`).toBe(true);
      if (!out.ok) continue;
      expect(out.path, win).toMatch(/^\/mnt\/[a-z](\/|$)/);
      expect(out.path, win).not.toMatch(/\\|\/\/|\/$/);
      expect(mapped(wslToWin(out.path)), win).toBe(path.win32.normalize(win));
    }
  });

  it('Linux 路径往返：/mnt 分支与发行版 UNC 分支都回到归一原形', () => {
    for (let i = 0; i < 1500; i += 1) {
      const linux =
        rnd() < 0.5
          ? `/mnt/${pick(['c', 'd', 'e', 'f'])}/${someSegs(1 + Math.floor(rnd() * 4)).join('/')}`
          : `/home/${someSegs(1 + Math.floor(rnd() * 3)).join('/')}`;
      const win = wslToWin(linux, 'Ubuntu2204');
      expect(win.ok, `${linux} 被拒`).toBe(true);
      if (!win.ok) continue;
      expect(mapped(winToWsl(win.path)), linux).toBe(path.posix.normalize(linux));
    }
  });

  it('随机垃圾串永不抛异常，返回值形态始终合法（REQ-3.5）', () => {
    const JUNK = ['\\', '/', ':', '..', '.', '?', '*', '<', '>', '"', '|', '\u0000', '\u001b', ' ', 'é', '🙂', 'a', 'E', 'wsl', '$', '\\wsl.localhost'] as const;
    for (let i = 0; i < 2000; i += 1) {
      const junk = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pick(JUNK)).join('');
      for (const [fn, args] of [
        [winToWsl, [junk]],
        [wslToWin, [junk]],
        [wslToWin, [junk, 'Ubuntu2204']],
      ] as const) {
        const out = fn(...(args as [string]));
        expect(out.ok ? typeof out.path : typeof out.code, junk).toBe('string');
      }
    }
  });
});
