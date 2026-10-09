/**
 * 002 T6.2（后半）/ T6.4 的**共用判定层**与 T7.3 的清单门。
 *
 * 三条判据为什么必须在这里、而不是别处：
 *   ① **单一判定层**：配置页与宿主 `parseProfiles` 必须对同一行给出**同一句话** —— 复制一套字段规则
 *      迟早会两处打架（`src/config/schema.ts` 的文件头就写了这条红线）。本文件用「同一输入、
 *      两边消息逐字相同」把它钉死；
 *   ② **不声明造新实例的 transform**（REQ-2.3）：判据 = 工厂只调 `object/array/any/volatile`
 *      （记账工厂）+ 真 schemastery 造出来的 schema 上没有 `transform` + **连续两次 parse 结构相等**
 *      （并附一个「结构不等就红」的反控，证明这条判据杀得死）；
 *   ③ **浏览器可安全 import**：`row-rules.ts` 不能有**运行时**依赖 006（否则会拖进
 *      `node:child_process`）—— 源码级扫描 + 注释剥离。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createProfilesSchema } from '../../src/config/schema.ts';
import type { SchemaFactory, SchemaLike } from '../../src/config/schema.ts';
import { parseProfiles } from '../../src/config/profiles.ts';
import { parseRowStructure } from '../../src/config/row-rules.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scan = { assertions: 0, files: 0, bytes: 0 };

function expectThat(label: string, actual: unknown, expected: unknown): void {
  scan.assertions += 1;
  expect(actual, label).toStrictEqual(expected);
}

/** 记账工厂：既是 `SchemaFactory`，又把它被调过的方法按顺序记下来 */
function recordingFactory(): { factory: SchemaFactory; calls: string[] } {
  const calls: string[] = [];
  const node = (kind: string): SchemaLike => ({
    volatile: () => {
      calls.push('volatile');
      return node(kind);
    },
  });
  const factory: SchemaFactory = {
    any: () => {
      calls.push('any');
      return node('any');
    },
    array: () => {
      calls.push('array');
      return node('array');
    },
    object: () => {
      calls.push('object');
      return node('object');
    },
  };
  return { factory, calls };
}

/** 两个值是否「结构相等」（宿主 `equalExceptVolatile` 的比对口径：不看引用、只看结构） */
function structurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

describe('T6.2 REQ-2.3：不为 ordinary 字段声明「每次 parse 造新实例」的 transform', () => {
  it('工厂只调 object / array / any / volatile（没有 transform，也没有别的花样）', () => {
    const recorded = recordingFactory();
    createProfilesSchema(recorded.factory);
    // 顺序是 JS 实参求值的副产物（`z.array(z.any())` 先于 `z.object(...)`），不是契约 ⇒ 比**多重集**
    expectThat('用到的工厂方法', [...recorded.calls].sort(), ['any', 'array', 'object', 'volatile']);
    expectThat('零 transform 调用', recorded.calls.filter((call) => call.includes('transform')), []);
    expectThat('零未知方法调用', recorded.calls.filter((call) => !/^(any|array|object|volatile)/.test(call)), []);
  });

  it('真 schemastery：连续两次 parse 同一输入 ⇒ 结构相等（无变更不会被判成变更）', async () => {
    const module = (await import('@deepseek-ai/schemastery')) as unknown as { default?: SchemaFactory } & SchemaFactory;
    const z = (module.default ?? module) as SchemaFactory;
    const schema = createProfilesSchema(z) as unknown as {
      (value: unknown): unknown;
      transform?: unknown;
      '~standard'?: { vendor?: string };
    };
    const input = { profiles: [{ name: 'a', command: 'wsl.exe', args: ['-d', 'Ubuntu2204'], env: { K: 'v' } }] };
    const first = schema(input);
    const second = schema(input);
    expectThat('两次结构相等', structurallyEqual(first, second), true);
    expectThat('不是同一个引用（所以比对必须是结构比）', first === second, false);
    expectThat('零 transform 成员', typeof schema.transform, 'undefined');
    // REQ-2.1 的机制前提：schemastery 的 vendor 标记必须还在（换实现会让 volatile 静默失效）
    expectThat('vendor', schema['~standard']?.vendor, 'schemastery');
  });

  it('溯源 + 反控：本机 schemastery **没有** `.transform()`（8 个节点逐个探过），而结构比对杀得死', async () => {
    const module = (await import('@deepseek-ai/schemastery')) as unknown as { default?: unknown } & Record<string, unknown>;
    const z = (module.default ?? module) as Record<string, (...args: unknown[]) => { transform?: unknown; volatile?: unknown }>;
    const probes: ReadonlyArray<{ readonly name: string; readonly node: () => { transform?: unknown; volatile?: unknown } }> = [
      { name: 'string', node: () => z['string']?.() ?? {} },
      { name: 'number', node: () => z['number']?.() ?? {} },
      { name: 'natural', node: () => z['natural']?.() ?? {} },
      { name: 'boolean', node: () => z['boolean']?.() ?? {} },
      { name: 'any', node: () => z['any']?.() ?? {} },
      { name: 'const', node: () => z['const']?.(1) ?? {} },
      { name: 'array', node: () => z['array']?.(z['any']?.()) ?? {} },
      { name: 'lazy', node: () => z['lazy']?.(() => z['any']?.()) ?? {} },
    ];
    const withTransform: string[] = [];
    const withVolatile: string[] = [];
    for (const probe of probes) {
      const node = probe.node();
      if (typeof node.transform === 'function') withTransform.push(probe.name);
      if (typeof node.volatile === 'function') withVolatile.push(probe.name);
    }
    expectThat('探过的节点数', probes.length, 8);
    expectThat('本机**没有**任何节点带 transform（REQ-2.3 的风险在当前版本无法用 transform 构造）', withTransform, []);
    expectThat('volatile 在全部节点上都在（这是我们要的机制）', withVolatile.length, probes.length);

    // 反控：判据本身杀得死 —— 只要解析结果里出现「每次变一点」的字段，结构比就变红
    const stable = { profiles: [{ value: 'a', nonce: 0 }] };
    expectThat('同一结构 ⇒ 绿', structurallyEqual(stable, { profiles: [{ value: 'a', nonce: 0 }] }), true);
    expectThat('变了字段 ⇒ 红', structurallyEqual(stable, { profiles: [{ value: 'a', nonce: 1 }] }), false);
  });
});

describe('T6.4 单一判定层：配置页与宿主对同一行给出同一句话', () => {
  const rows: ReadonlyArray<{ readonly label: string; readonly raw: unknown }> = [
    { label: '缺 name', raw: { command: 'wsl.exe' } },
    { label: 'name 空白', raw: { name: '   ', command: 'wsl.exe' } },
    { label: 'command 类型错', raw: { name: 'a', command: 42 } },
    { label: 'args 元素类型错', raw: { name: 'a', command: 'wsl.exe', args: ['-d', 7] } },
    { label: 'env 不是对象', raw: { name: 'a', command: 'wsl.exe', env: [] } },
    { label: 'env 值类型错', raw: { name: 'a', command: 'wsl.exe', env: { K: 1 } } },
    { label: 'cwd 类型错', raw: { name: 'a', command: 'wsl.exe', cwd: 5 } },
    { label: '非对象', raw: 'nope' },
  ];

  it('逐条比对：客户端校验消息 == 宿主诊断消息（逐字，不靠人眼）', () => {
    for (const row of rows) {
      const client = parseRowStructure(row.raw, 0);
      const host = parseProfiles([row.raw]);
      expectThat(`${row.label}：客户端应判无效`, client.ok, false);
      expectThat(`${row.label}：宿主诊断`, host.diagnostics[0]?.message, client.ok ? '' : client.diagnostic.message);
      expectThat(`${row.label}：宿主丢弃该条`, host.diagnostics[0]?.skipped, true);
      expectThat(`${row.label}：宿主结果无条目`, host.profiles.length, 0);
    }
    expectThat('比对行数（防漏喂）', rows.length, 8);
  });

  it('合法行两边都通过，且宿主补默认值 + 保留原始顺序', () => {
    const raw = [
      { name: ' a ', command: ' wsl.exe ' },
      { name: 'b', command: 'pwsh.exe', args: ['-NoLogo'], cwd: 'E:\\w', env: { K: 'v' } },
    ];
    const host = parseProfiles(raw);
    expectThat('零诊断', host.diagnostics, []);
    expectThat('默认值补齐', host.profiles[0], { name: 'a', command: 'wsl.exe', args: [], env: {} });
    expectThat('第二条第 env 原样', host.profiles[1]?.env, { K: 'v' });
    const client = parseRowStructure(raw[0], 0);
    expectThat('客户端结果与宿主第一条一致', client.ok ? client.value : undefined, host.profiles[0]);
  });

  it('006 的推导**仍只在宿主**（拆层没把它挪进共用规则）', () => {
    const host = parseProfiles([{ name: 'wsl', command: 'wsl.exe', cwd: 'E:\\work' }]);
    expectThat('推导出 cwdLinux', host.profiles[0]?.cwdLinux, '/mnt/e/work');
    expectThat('客户端结构校验不做推导（它拿不到 006）', parseRowStructure({ name: 'wsl', command: 'wsl.exe', cwd: 'E:\\work' }, 0).ok, true);
    expectThat('客户端结果里没有 cwdLinux', Object.keys(caseKeys()).includes('cwdLinux'), false);
  });

  it('浏览器可安全 import：`row-rules.ts` 无运行时依赖（只有 type-only 的 006 引用）', () => {
    const files = readdirSync(join(packageRoot, 'src/config')).sort();
    const hits: string[] = [];
    for (const name of files) {
      if (name !== 'row-rules.ts') continue;
      const full = join(packageRoot, 'src/config', name);
      scan.files += 1;
      const raw = readFileSync(full, 'utf8');
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      scan.bytes += Buffer.byteLength(code, 'utf8');
      for (const line of code.split('\n')) {
        const isTypeOnly = /^\s*import\s+type\b/.test(line);
        if (!isTypeOnly && /from\s+['"](dsh-wsl-shared|\.\/cwd-linux)/.test(line)) hits.push(line.trim());
        if (/(?:node:)?child_process|require\(/.test(line)) hits.push(line.trim());
      }
      expectThat('文件存在且非空', code.length > 0, true);
    }
    expectThat('扫到的文件数', scan.files >= 1, true);
    expectThat('运行时越界 import', hits, []);
  });
});

/** 客户端结构校验的结果里**不该**出现 006 才有的字段（用键名列表断言，避免断言恒真） */
function caseKeys(): Record<string, unknown> {
  const parsed = parseRowStructure({ name: 'wsl', command: 'wsl.exe', cwd: 'E:\\work' }, 0);
  return parsed.ok ? { ...parsed.value } : {};
}

describe('T7.3 清单门（NFR-1：react 走 peerDependencies，不打进 bundle）', () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    dsh?: { client?: { platform?: string; inject?: string[]; external?: string[] } };
    exports?: Record<string, unknown>;
    files?: string[];
  };

  it('peerDependencies.react = ^18.2.0，且 react 不在 dependencies（NFR-1 / NFR-2）', () => {
    expectThat('react peer', manifest.peerDependencies?.['react'], '^18.2.0');
    expectThat('react 不在 dependencies', manifest.dependencies?.['react'], undefined);
    expectThat(
      'dependencies 里没有任何 react/react-dom/xterm（宿主供给或打进 chunk）',
      Object.keys(manifest.dependencies ?? {}).filter((name) => /^(react|react-dom|@xterm\/xterm)/.test(name)),
      [],
    );
    expectThat('devDependencies 里有 react（本地开发/测试要用）', manifest.devDependencies?.['react'], '18.2.0');
  });

  it('dsh.client 声明保持真实（platform=web；不 require 任何 @deepseek-ai/* ⇒ external 空）', () => {
    expectThat('platform', manifest.dsh?.client?.platform, 'web');
    expectThat('inject（信息性包名数组）', manifest.dsh?.client?.inject, []);
    expectThat('external', manifest.dsh?.client?.external, []);
  });

  it('exports["./client"] 指向构建产物（主文件名恰好 client.js）', () => {
    expectThat('exports["./client"]', manifest.exports?.['./client'], {
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    });
    expectThat('files 含 lib/**', manifest.files, ['lib/**']);
  });
});

describe('扫描面统计（判据自己会说扫了多少）', () => {
  it('打印断言数与源码扫描量', () => {
    console.log(
      `[scan] client-config-rules：断言 ${scan.assertions} 条 · 源码 ${scan.files} 个文件 / ${scan.bytes} 字节`,
    );
    expectThat('断言数 > 0', scan.assertions > 0, true);
    expectThat('清单真的读到了', statSync(join(packageRoot, 'package.json')).size > 0, true);
  });
});
