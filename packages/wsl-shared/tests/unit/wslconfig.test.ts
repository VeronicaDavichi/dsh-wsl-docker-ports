/**
 * T5.1–T5.3 `.wslconfig` 单测：解析走合成文本、读取走 **fake 读文件**，不碰真实文件系统。
 * 真机字节的断言在 `tests/contract/wslconfig.test.ts`（只有那层允许出现 fixture）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { isWslFailure } from '../../src/errors.ts';
import {
  createWslConfigReader,
  parseWslConfig,
  readNetworkingMode,
  type NetworkingModeKind,
  type NetworkingModeResolution,
  type ReadFileLike,
  type WslConfigDeps,
} from '../../src/wslconfig.ts';

/** 真机 fixture 原文：32 字节、CRLF、**无尾换行**、只有 `[wsl2]` + `localhostForwarding` */
const REAL_TEXT = '[wsl2]\r\nlocalhostForwarding=true';
const TARGET = 'C:\\Users\\probe\\.wslconfig';
const ENV = { USERPROFILE: 'C:\\Users\\probe' };

const readText =
  (text: string): ReadFileLike =>
  async () =>
    text;

/** 造一个带 `code` 的 errno 异常（`EACCES`/`EISDIR` 在本机造不出来，只能 fake） */
const readFails =
  (code: string, message = `${code}: mocked failure, read`): ReadFileLike =>
  async () => {
    const error = Object.assign(new Error(message), { code });
    throw error;
  };

const reader = (deps: WslConfigDeps = {}) => createWslConfigReader({ env: ENV, ...deps });

/** 做「源码纯度」断言前先剥注释：文档里提到写文件是散文，不是调用 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('T5.1 INI 子集解析（REQ-4.5）', () => {
  it('真机原文（CRLF、无尾换行、无 networkingMode）⇒ default/nat，且 rawValue 键**不出现**', async () => {
    const outcome = await reader({ readFile: readText(REAL_TEXT) }).read(TARGET);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.mode).toBe('default');
    expect(outcome.resolved).toBe('nat');
    expect(outcome.path).toBe(TARGET);
    expect('rawValue' in outcome).toBe(false);
  });

  it('BOM + 整行注释 + 行内注释 + 键值空白 + `[WSL2]` 大写 ⇒ nat，rawValue 保留原值', async () => {
    const text = '\uFEFF# 顶部注释\r\n; 另一种注释\r\n[WSL2]\r\n  networkingMode   =   nat   # 行内注释\r\n';
    const outcome = await reader({ readFile: readText(text) }).read(TARGET);
    expect(outcome.ok && outcome.mode).toBe('nat');
    expect(outcome.ok && outcome.rawValue).toBe('nat');
  });

  it('节名/键名大小写不敏感，但**值**大小写敏感：`NAT` ⇒ other（REQ-4.4 保守）', () => {
    expect(parseWslConfig('[Wsl2]\nNetworkingMode = NAT')).toBe('NAT');
    expect(parseWslConfig('[ wsl2 ]\n  networkingmode  = nat')).toBe('nat');
  });

  it('🔴 无关节被忽略：`[experimental] networkingMode=mirrored` **不得**影响判定（REQ-4.5）', async () => {
    const text = '[experimental]\nnetworkingMode=mirrored\n[wsl2]\nlocalhostForwarding=true';
    const outcome = await reader({ readFile: readText(text) }).read(TARGET);
    expect(outcome.ok && outcome.mode).toBe('default');
    expect(outcome.ok && outcome.resolved).toBe('nat');
    expect(parseWslConfig(text)).toBeUndefined();
  });

  it('键出现在任何节之前（全局区）⇒ 忽略', () => {
    expect(parseWslConfig('networkingMode=mirrored\n[wsl2]\n')).toBeUndefined();
  });

  it('重复键 ⇒ **最后一个**胜出（INI 惯例）', () => {
    expect(parseWslConfig('[wsl2]\nnetworkingMode=nat\nnetworkingMode=mirrored')).toBe('mirrored');
  });

  it('尾部带杂物的「节」行不算节（`[wsl2] x`）⇒ 其后的键不属于 wsl2', () => {
    expect(parseWslConfig('[wsl2] x\nnetworkingMode=mirrored')).toBeUndefined();
  });

  it('未闭合 `[wsl2`、空节名、裸行无 `=` 一律忽略', () => {
    expect(parseWslConfig('[wsl2\nnetworkingMode=mirrored')).toBeUndefined();
    expect(parseWslConfig('[]\nnetworkingMode=mirrored')).toBeUndefined();
    expect(parseWslConfig('[wsl2]\nnetworkingMode\n')).toBeUndefined();
  });

  it('空值 ⇒ rawValue 为**空串**（键存在，值是空）且判为 other —— 不得当缺省', async () => {
    const outcome = await reader({ readFile: readText('[wsl2]\nnetworkingMode=') }).read(TARGET);
    expect(outcome.ok && outcome.mode).toBe('other');
    expect(outcome.ok && outcome.resolved).toBe('non-nat');
    expect(outcome.ok && 'rawValue' in outcome).toBe(true);
    expect(outcome.ok && outcome.rawValue).toBe('');
  });

  it('带引号 `"nat"` ⇒ other（不猜、不去引号）', () => {
    expect(parseWslConfig('[wsl2]\nnetworkingMode="nat"')).toBe('"nat"');
  });

  it('只有 `\\r`（老 Mac）行尾也能解析；纯函数**无跨调用状态**（两次结果一致）', () => {
    expect(parseWslConfig('[wsl2]\rnetworkingMode=mirrored\r')).toBe('mirrored');
    const once = parseWslConfig('[wsl2]\nnetworkingMode=nat');
    expect(parseWslConfig('[wsl2]\nnetworkingMode=nat')).toBe(once);
  });
});

describe('T5.2 判定表全表（REQ-4.1 / REQ-4.2 / REQ-4.4）', () => {
  const TABLE: readonly {
    label: string;
    impl: ReadFileLike;
    mode: NetworkingModeKind;
    resolved: NetworkingModeResolution;
    rawValue?: string;
  }[] = [
    { label: '文件不存在（ENOENT）', impl: readFails('ENOENT'), mode: 'default', resolved: 'nat' },
    { label: '文件存在但缺键', impl: readText(REAL_TEXT), mode: 'default', resolved: 'nat' },
    { label: 'nat', impl: readText('[wsl2]\nnetworkingMode=nat'), mode: 'nat', resolved: 'nat', rawValue: 'nat' },
    {
      label: 'mirrored',
      impl: readText('[wsl2]\nnetworkingMode=mirrored'),
      mode: 'mirrored',
      resolved: 'non-nat',
      rawValue: 'mirrored',
    },
    {
      label: 'bridged（WSL 已知但本包不支持）',
      impl: readText('[wsl2]\nnetworkingMode=bridged'),
      mode: 'other',
      resolved: 'non-nat',
      rawValue: 'bridged',
    },
    {
      label: '拼写错误 natx',
      impl: readText('[wsl2]\nnetworkingMode=natx'),
      mode: 'other',
      resolved: 'non-nat',
      rawValue: 'natx',
    },
    {
      label: '大小写异常 NAT',
      impl: readText('[wsl2]\nnetworkingMode=NAT'),
      mode: 'other',
      resolved: 'non-nat',
      rawValue: 'NAT',
    },
    {
      label: '未来新值 virtioproxy',
      impl: readText('[wsl2]\nnetworkingMode=virtioproxy'),
      mode: 'other',
      resolved: 'non-nat',
      rawValue: 'virtioproxy',
    },
  ];

  it.each(TABLE)('$label ⇒ mode=$mode / resolved=$resolved', async (row) => {
    const outcome = await reader({ readFile: row.impl }).read(TARGET);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.mode).toBe(row.mode);
    expect(outcome.resolved).toBe(row.resolved);
    expect(outcome.path).toBe(TARGET);
    expect(row.rawValue === undefined ? 'rawValue' in outcome : outcome.rawValue).toBe(
      row.rawValue === undefined ? false : row.rawValue,
    );
  });

  it('保守性总断言：除 nat/default 外，**任何**值都不得判成 resolved=nat（REQ-4.4）', async () => {
    for (const row of TABLE) {
      const outcome = await reader({ readFile: row.impl }).read(TARGET);
      if (!outcome.ok) continue;
      if (row.mode === 'other' || row.mode === 'mirrored') {
        expect(outcome.resolved).not.toBe('nat');
      }
      expect(['nat', 'non-nat']).toContain(outcome.resolved);
    }
  });
});

describe('T5.3 读不到 ≠ 缺省 NAT（REQ-4.6 / REQ-4.7）', () => {
  it.each([
    ['EACCES（权限）', 'EACCES'],
    ['EISDIR（把目录当文件读）', 'EISDIR'],
    ['EPERM', 'EPERM'],
    ['未知 errno', 'EWEIRD'],
  ])('%s ⇒ ConfigUnreadable，带完整路径、**不**转成 default', async (_label, code) => {
    const outcome = await reader({ readFile: readFails(code) }).read(TARGET);
    expect(outcome.ok).toBe(false);
    if (!isWslFailure(outcome)) return;
    expect(outcome.code).toBe('ConfigUnreadable');
    expect(outcome.path).toBe(TARGET);
    expect(outcome.message).toContain(TARGET);
    expect(outcome.message).toContain(code);
    // 失败态不得**伪造**成功态的字段
    expect('mode' in outcome).toBe(false);
    expect('resolved' in outcome).toBe(false);
    expect('rawValue' in outcome).toBe(false);
  });

  it('非 Error 抛掷（裸字符串）也兜进 ConfigUnreadable —— 公开面不抛异常', async () => {
    const outcome = await reader({
      readFile: async () => {
        throw 'boom';
      },
    }).read(TARGET);
    expect(outcome.ok).toBe(false);
    expect(isWslFailure(outcome) && outcome.code).toBe('ConfigUnreadable');
  });

  it('🔴 errno 在文案里只出现一次（真机实测抓到过 `EISDIR: EISDIR: …`）', async () => {
    // Node 的 message 自带 errno 前缀（真机 EISDIR 就是这样）⇒ 不得再加一遍
    const prefixed = await reader({ readFile: readFails('EISDIR') }).read(TARGET);
    expect(isWslFailure(prefixed) && prefixed.message.match(/EISDIR/g)?.length).toBe(1);
    // message 不带 errno 前缀时，仍必须把 code 补进去（否则用户看不到原因）
    const plain = await reader({ readFile: readFails('EACCES', 'permission denied') }).read(TARGET);
    expect(isWslFailure(plain) && plain.message).toContain('EACCES: permission denied');
  });

  it('静态断言：剥注释后源码**没有任何写文件调用**（只读，NFR-4 / REQ-4.3）', () => {
    const code = stripComments(readFileSync(new URL('../../src/wslconfig.ts', import.meta.url), 'utf8'));
    expect(/\b(?:writeFile|appendFile|createWriteStream|unlink|rm|rmdir|mkdir|rename|truncate|chmod|utimes)\w*\s*\(/i.test(code)).toBe(
      false,
    );
    // 依赖面枚举：只许 node 内置三件 + 自家 errors（零第三方依赖，NFR-1）
    const specifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]).sort();
    expect(specifiers).toEqual(['./errors.ts', 'node:fs/promises', 'node:os', 'node:path']);
    expect(typeof readNetworkingMode).toBe('function');
  });
});

describe('默认路径解析（实测踩过的坑，逐条钉住）', () => {
  it('USERPROFILE 正常 ⇒ 读到的是 join(profile, .wslconfig)，且原样回传 path', async () => {
    const seen: string[] = [];
    const outcome = await reader({
      readFile: async (filePath) => {
        seen.push(filePath);
        return REAL_TEXT;
      },
    }).read();
    expect(seen).toEqual([TARGET]);
    expect(outcome.ok && outcome.path).toBe(TARGET);
  });

  it("USERPROFILE 为空白 ⇒ 回落 os.homedir()（**不是** `??` 那种不回落的写法）", async () => {
    const seen: string[] = [];
    const outcome = await createWslConfigReader({
      env: { USERPROFILE: '   ' },
      homedir: () => 'D:\\Home',
      readFile: async (filePath) => {
        seen.push(filePath);
        return REAL_TEXT;
      },
    }).read();
    expect(seen).toEqual(['D:\\Home\\.wslconfig']);
    expect(outcome.ok).toBe(true);
  });

  it('🔴 USERPROFILE 为空串且 homedir 抛 ERR_SYSTEM_ERROR（真机实测行为）⇒ ConfigUnreadable', async () => {
    const outcome = await createWslConfigReader({
      env: { USERPROFILE: '' },
      homedir: () => {
        throw Object.assign(new Error('uv_os_homedir returned ENOENT'), { code: 'ERR_SYSTEM_ERROR' });
      },
      readFile: readText(REAL_TEXT),
    }).read();
    expect(outcome.ok).toBe(false);
    if (!isWslFailure(outcome)) return;
    expect(outcome.code).toBe('ConfigUnreadable');
    expect(outcome.message).toContain('ERR_SYSTEM_ERROR');
    // 关键：绝不能回落到**相对** `.wslconfig` ⇒ 也就不会读到工作目录下的同名文件
    expect(outcome.path).toBeUndefined();
  });

  it('默认路径不是绝对路径 ⇒ 拒绝读取（防"读到工作目录下的同名文件"）', async () => {
    let called = false;
    const outcome = await createWslConfigReader({
      env: { USERPROFILE: '' },
      homedir: () => 'relative-dir',
      readFile: async () => {
        called = true;
        return REAL_TEXT;
      },
    }).read();
    expect(called).toBe(false);
    expect(outcome.ok).toBe(false);
    expect(isWslFailure(outcome) && outcome.code).toBe('ConfigUnreadable');
    expect(isWslFailure(outcome) && outcome.path).toBe('relative-dir\\.wslconfig');
  });

  it('调用方显式给路径 ⇒ 原样使用（相对路径是调用方自己的意图）', async () => {
    const seen: string[] = [];
    const outcome = await reader({
      readFile: async (filePath) => {
        seen.push(filePath);
        return '[wsl2]\nnetworkingMode=mirrored';
      },
    }).read('fixtures/custom.wslconfig');
    expect(seen).toEqual(['fixtures/custom.wslconfig']);
    expect(outcome.ok && outcome.mode).toBe('mirrored');
  });
});

describe('属性化：垃圾输入不抛异常（固定种子 ⇒ 可复算）', () => {
  it('3000 个随机串喂 parseWslConfig：只返回 string|undefined，绝不抛', async () => {
    let seed = 20261008;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alphabet = ['[', ']', 'w', 's', 'l', '2', '=', 'n', 'a', 't', '\r', '\n', '#', ';', ' ', '\\', '\u0000', '\uFEFF', '中'];
    for (let index = 0; index < 3000; index += 1) {
      let text = '';
      const length = Math.floor(rand() * 40);
      for (let position = 0; position < length; position += 1) {
        text += alphabet[Math.floor(rand() * alphabet.length)] ?? '';
      }
      const parsed = parseWslConfig(text);
      expect(parsed === undefined || typeof parsed === 'string').toBe(true);
      const outcome = await reader({ readFile: readText(text) }).read(TARGET);
      expect(typeof outcome.ok).toBe('boolean');
      if (outcome.ok) {
        expect(['nat', 'non-nat']).toContain(outcome.resolved);
        expect(['nat', 'mirrored', 'default', 'other']).toContain(outcome.mode);
      }
    }
  });
});
