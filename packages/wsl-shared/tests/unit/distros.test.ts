/**
 * T2.1 / T2.2 / T2.4 发行版解析单测。
 *
 * 断言对象是**解析结论**，不是实现细节；每个用例对应 requirements 里的一条 REQ。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  guardDistroExists,
  parseDistroTable,
  resolveDistro,
  type WslDistro,
} from '../../src/distros.ts';
import { isWslFailure } from '../../src/errors.ts';

const EN_HEADER = '  NAME            STATE           VERSION\n';
const ZH_HEADER = '  名称            状态            版本\n';

/** 做「源码纯度」断言前先剥注释：文档里提到 `set-default` 是散文，不是调用 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('T2.1 解码容错（REQ-1.2）', () => {
  it('UTF-16LE 字节（真机形态）解码后可直接解析', () => {
    const bytes = Buffer.from(`${EN_HEADER}* Ubuntu2204    Stopped         2\n`, 'utf16le');
    const distros = parseDistroTable(new Uint8Array(bytes));
    expect(distros[0]?.name).toBe('Ubuntu2204');
  });

  it('剥 BOM、容忍 CRLF 与行尾空白（REQ-1.2）', () => {
    const text = `\uFEFF${EN_HEADER.replace('\n', '\r\n')}* Ubuntu2204   Stopped   2   \r\n`;
    const distros = parseDistroTable(text);
    expect(distros[0]?.name).toBe('Ubuntu2204');
    expect(distros[0]?.state).toBe('Stopped');
  });

  it('负例：同一批 UTF-16LE 字节按 UTF-8 解读会得到乱码（证明编码指纹必要）', () => {
    const bytes = Buffer.from(`${EN_HEADER}* Ubuntu2204    Stopped         2\n`, 'utf16le');
    const wrong = new TextDecoder('utf-8').decode(bytes);
    expect(wrong.includes('Ubuntu2204')).toBe(false);
    expect(wrong.includes('\u0000')).toBe(true);
  });
});

describe('T2.2 表格解析（REQ-1.1/1.3/1.4/1.6）', () => {
  it('英文表头 + `*` 默认项：名字/状态/版本/isDefault 齐全', () => {
    const distros = parseDistroTable(`${EN_HEADER}* Ubuntu2204    Stopped         2\n`);
    expect(distros).toHaveLength(1);
    expect(distros[0]).toEqual({
      name: 'Ubuntu2204',
      state: 'Stopped',
      version: 2,
      isDefault: true,
    });
  });

  it('REQ-1.4：名字含空格时不被截断', () => {
    const distros = parseDistroTable(`${EN_HEADER}* Ubuntu 22.04 LTS  Stopped  2\n`);
    expect(distros[0]?.name).toBe('Ubuntu 22.04 LTS');
    expect(distros[0]?.state).toBe('Stopped');
  });

  it('REQ-1.3：中文表头同样被跳过（不依赖表头字面量）', () => {
    const distros = parseDistroTable(`${ZH_HEADER}* Ubuntu2204       Running        2\n`);
    expect(distros).toHaveLength(1);
    expect(distros[0]?.name).toBe('Ubuntu2204');
    expect(distros[0]?.state).toBe('Running');
  });

  it('design §3.1：无 VERSION 列的数据行 → version: "unknown"', () => {
    const distros = parseDistroTable(`${EN_HEADER}  Ubuntu2204    Stopped\n`);
    expect(distros[0]?.version).toBe('unknown');
    expect(distros[0]?.state).toBe('Stopped');
  });

  it('无 `-v` 的两列表头 `NAME STATE` 本身不被当成数据（不会凭空造出名为 NAME 的发行版）', () => {
    expect(parseDistroTable('  NAME            STATE\n')).toEqual([]);
  });

  it('无 `-v` 的两列表头 + 两列数据行 → 只认数据行（version 为 unknown）', () => {
    const distros = parseDistroTable('  NAME            STATE\n  Ubuntu2204      Stopped\n');
    expect(distros).toHaveLength(1);
    expect(distros[0]?.name).toBe('Ubuntu2204');
    expect(distros[0]?.version).toBe('unknown');
  });

  it('已知局限：两列 + **本地化状态词** 的数据行会被跳过（宁可漏，不可编）', () => {
    expect(parseDistroTable('  Ubuntu2204      已停止\n')).toEqual([]);
  });

  it('REQ-1.6：纯表头 → `[]`（不是错误）', () => {
    expect(parseDistroTable(EN_HEADER)).toEqual([]);
    expect(parseDistroTable(ZH_HEADER)).toEqual([]);
  });

  it('REQ-1.6：空输入 / 纯空白 → `[]`', () => {
    expect(parseDistroTable('')).toEqual([]);
    expect(parseDistroTable('   \n\n\t\n')).toEqual([]);
  });

  it('REQ-1.6：非表格噪声（横幅）→ `[]`，且不抛异常', () => {
    expect(() => parseDistroTable('完全不是 wsl 输出的东西\n')).not.toThrow();
    expect(parseDistroTable('完全不是 wsl 输出的东西\n')).toEqual([]);
  });

  it('REQ-1.1：输入里出现两个 `*` 时，isDefault 至多一个', () => {
    const distros = parseDistroTable(
      `${EN_HEADER}* Ubuntu2204    Running         2\n* Debian        Stopped         2\n`,
    );
    expect(distros.filter((d) => d.isDefault)).toHaveLength(1);
    expect(distros[0]?.name).toBe('Ubuntu2204');
  });

  it('design §3.1：默认项置顶，其余保持原顺序', () => {
    const distros = parseDistroTable(
      `${EN_HEADER}  Debian        Stopped         2\n  Alpine        Stopped         2\n* Ubuntu2204    Running         2\n`,
    );
    expect(distros.map((d) => d.name)).toEqual(['Ubuntu2204', 'Debian', 'Alpine']);
  });

  it('未知状态词 → state:Unknown（不跳过该行）', () => {
    const distros = parseDistroTable(`${EN_HEADER}* Ubuntu2204    Paused          2\n`);
    expect(distros[0]?.state).toBe('Unknown');
  });

  it('状态词大小写不敏感（WSL 输出大小写随版本变）', () => {
    const distros = parseDistroTable(`${EN_HEADER}* Ubuntu2204    STOPPED         1\n`);
    expect(distros[0]?.state).toBe('Stopped');
    expect(distros[0]?.version).toBe(1);
  });

  it('多行真实形态：1 个默认 + 2 个非默认，顺序与字段都正确', () => {
    const text = `${EN_HEADER}* Ubuntu2204    Running         2\n  Debian        Stopped         2\n  Ubuntu 22.04 LTS  Stopped      2\n`;
    const distros = parseDistroTable(text);
    expect(distros.map((d) => d.name)).toEqual(['Ubuntu2204', 'Debian', 'Ubuntu 22.04 LTS']);
    expect(distros.map((d) => d.isDefault)).toEqual([true, false, false]);
  });
});

describe('T2.4 目标发行版解析（REQ-1.7 / D-4）', () => {
  const onlyNoFlag: WslDistro[] = [
    { name: 'Ubuntu2204', state: 'Stopped', version: 2, isDefault: false },
  ];
  const multi: WslDistro[] = [
    { name: 'Ubuntu2204', state: 'Stopped', version: 2, isDefault: false },
    { name: 'Debian', state: 'Stopped', version: 2, isDefault: true },
  ];
  const noFlag: WslDistro[] = [
    { name: 'Ubuntu2204', state: 'Stopped', version: 2, isDefault: false },
    { name: 'Debian', state: 'Stopped', version: 2, isDefault: false },
  ];

  it('③ 唯一发行版（且没被 `*` 标记）→ source:onlyOne（一个就是默认，不追问）', () => {
    expect(resolveDistro(onlyNoFlag)).toEqual({ ok: true, name: 'Ubuntu2204', source: 'onlyOne' });
  });

  it('② 优先于 ③：唯一但带 `*` → source:wslDefault（优先级顺序即 REQ-1.7 的枚举顺序）', () => {
    expect(
      resolveDistro([{ name: 'Ubuntu2204', state: 'Stopped', version: 2, isDefault: true }]),
    ).toEqual({ ok: true, name: 'Ubuntu2204', source: 'wslDefault' });
  });

  it('② 无配置 + 有 `*` → source:wslDefault', () => {
    expect(resolveDistro(multi)).toEqual({ ok: true, name: 'Debian', source: 'wslDefault' });
  });

  it('① 配置存在 → source:config，且优先于 `*`', () => {
    expect(resolveDistro(multi, 'Ubuntu2204')).toEqual({
      ok: true,
      name: 'Ubuntu2204',
      source: 'config',
    });
  });

  it('① 配置大小写不敏感，回填**列表里的真名**', () => {
    expect(resolveDistro(multi, 'ubuntu2204')).toEqual({
      ok: true,
      name: 'Ubuntu2204',
      source: 'config',
    });
  });

  it('④ 无配置 + 多个 + 无 `*` → source:first（列表首项）', () => {
    expect(resolveDistro(noFlag)).toEqual({ ok: true, name: 'Ubuntu2204', source: 'first' });
  });

  it('成功态带 `ok: true` ⇒ `isWslFailure()` 能收窄联合（Phase 4 自审补齐的一致性）', () => {
    const hit = resolveDistro(onlyNoFlag);
    expect(isWslFailure(hit)).toBe(false);
    if (isWslFailure(hit)) throw new Error('成功态不该被收窄成失败');
    expect(hit.name).toBe('Ubuntu2204'); // 收窄后可直接取字段（编译期保证，无需断言/强转）
    expect(isWslFailure(resolveDistro([], 'x'))).toBe(true);
  });

  it('⑤ 空列表 → NoDistro（SHALL NOT 返回空名）', () => {
    const result = resolveDistro([]);
    expect(isWslFailure(result)).toBe(true);
    if (!isWslFailure(result)) throw new Error('空列表必须失败');
    expect(result.code).toBe('NoDistro');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('配置了但没装 → DistroNotFound 且带可用发行版名列表（不静默换一个）', () => {
    const result = resolveDistro(multi, 'Fedora');
    expect(isWslFailure(result)).toBe(true);
    if (!isWslFailure(result)) throw new Error('未安装的配置必须失败');
    expect(result.code).toBe('DistroNotFound');
    expect(result.distros).toEqual(['Ubuntu2204', 'Debian']);
  });

  it('配置为空串/纯空白 → 视为未配置（走后续优先级）', () => {
    expect(resolveDistro(onlyNoFlag, '   ')).toEqual({ ok: true, name: 'Ubuntu2204', source: 'onlyOne' });
  });

  it('⑥ 纯函数性：源码里没有 `set-default`，也没有 spawn/文件系统调用', () => {
    const source = stripComments(
      readFileSync(new URL('../../src/distros.ts', import.meta.url), 'utf8'),
    );
    expect(source.includes('set-default')).toBe(false);
    expect(/node:child_process|node:fs/.test(source)).toBe(false);
  });
});

describe('T2.3 发行版存在性守卫（REQ-2.5）', () => {
  const distros: WslDistro[] = [
    { name: 'Ubuntu2204', state: 'Stopped', version: 2, isDefault: true },
    { name: 'Debian', state: 'Running', version: 2, isDefault: false },
  ];

  it('存在 → undefined（调用方继续）', () => {
    expect(guardDistroExists('Ubuntu2204', distros)).toBeUndefined();
    expect(guardDistroExists('debian', distros)).toBeUndefined();
  });

  it('不存在 → DistroNotFound，且 message 与 distros 都带可用列表', () => {
    const error = guardDistroExists('Fedora', distros);
    expect(error?.code).toBe('DistroNotFound');
    expect(error?.distros).toEqual(['Ubuntu2204', 'Debian']);
  });

  it('空列表 → DistroNotFound（distros 为空数组，不伪造）', () => {
    const error = guardDistroExists('Ubuntu2204', []);
    expect(error?.code).toBe('DistroNotFound');
    expect(error?.distros).toEqual([]);
  });
});

describe('复审补强：名字保真与错误码（2026-10-08 自审）', () => {
  it('名字里的**连续空格**原样保留（切词再拼会压缩，拿去 `-d <name>` 就找不到发行版）', () => {
    const distros = parseDistroTable(`${EN_HEADER}* Ubuntu  22.04   Stopped   2\n`);
    expect(distros[0]?.name).toBe('Ubuntu  22.04');
    expect(distros[0]?.state).toBe('Stopped');
    expect(distros[0]?.version).toBe(2);
  });

  it('名字以 `+` 开头时不被削掉（只剥 WSL 真正会打的 `*`）', () => {
    const distros = parseDistroTable(`${EN_HEADER}+weird   Running   2\n`);
    expect(distros[0]?.name).toBe('+weird');
    expect(distros[0]?.isDefault).toBe(false);
  });

  it('两列行同样原样保留名字空格，且 version 为 unknown', () => {
    const distros = parseDistroTable(`${EN_HEADER}My  Distro   Stopped\n`);
    expect(distros.map((d) => d.name)).toEqual(['My  Distro']);
    expect(distros[0]?.version).toBe('unknown');
  });

  it('一个发行版都没有时，即使配了也报 NoDistro（根因是没装，不是配置写错）', () => {
    const result = resolveDistro([], 'Ubuntu2204');
    expect(isWslFailure(result)).toBe(true);
    if (!isWslFailure(result)) throw new Error('空列表必须失败');
    expect(result.code).toBe('NoDistro');
  });

  it('configured 传非字符串（配置被写坏）不抛异常，按「未配置」回落', () => {
    const distros: WslDistro[] = [{ name: 'A', state: 'Running', version: 2, isDefault: true }];
    expect(resolveDistro(distros, 123 as unknown as string)).toEqual({
      ok: true,
      name: 'A',
      source: 'wslDefault',
    });
  });
});
