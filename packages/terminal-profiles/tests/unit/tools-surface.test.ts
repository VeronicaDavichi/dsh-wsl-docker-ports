/**
 * T1.4 / NFR-2 / NFR-3 / NFR-4 —— 结构性自证（**静态**，不需要真机也不需要 002 跑起来）
 *
 * 这一组用例的用途是**挡住「实现漂移」**，而不是重复功能测试：
 * - T1.4 的验收原文是「read 的两种模式**直接映射** 002 的屏幕模型（快照 / 增量），**不自建**缓冲或
 *   序号」。功能测试只能证明「这次结果对」，证明不了「我们没有第二份实现」—— 后者只能靠**看源码**。
 *   于是这里对 `src/tools/**` 做**结构断言**：不许出现 `createTermBuffer` / `nextSeq++` /
 *   `spawnTerminal` / `handle.resize` / `ctx.get('subprocess')` 这类「自己又做了一遍机制」的痕迹。
 * - NFR-4 的单文件 ≤ 400 行**按原始行数**算 ⇒ 这里真的去数行（软指标可复算的同一思路）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { TERMINAL_TOOL_NAMES } from '../../src/tools/register.ts';

const TOOLS_DIR = fileURLToPath(new URL('../../src/tools/', import.meta.url));
const HELPERS_DIR = fileURLToPath(new URL('../helpers/', import.meta.url));
const UNIT_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Windows 下 `fileURLToPath` 给的是反斜杠 ⇒ 统一成正斜杠再比路径（断言才可跨平台） */
function posix(path: string): string {
  return path.replace(/\\/g, '/');
}

/** 原始行数（NFR-4 的口径：**含**空行与注释，与「代码体积去注释」是两套指标） */
function lineCount(path: string): number {
  const text = readFileSync(path, 'utf8');
  const newlines = (text.match(/\n/g) ?? []).length;
  // 末尾没有换行的最后一行也要算进去
  return text.endsWith('\n') ? newlines : newlines + 1;
}

const SOURCES = [
  'host.ts',
  'keys.ts',
  'failure.ts',
  'policy.ts',
  'schemas.ts',
  'read-model.ts',
  'register.ts',
  'index.ts',
] as const;

function readSource(name: string): string {
  return readFileSync(`${TOOLS_DIR}${name}`, 'utf8');
}

/** 去掉注释与空行后的「代码」（行数/体积类指标的既有口径：注释不算） */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('T1.4 REQ-2.3 工具面不自建机制（结构断言）', () => {
  it('🔴 `src/tools/**` 里没有第二份缓冲 / 屏幕 / **自建序号状态**', () => {
    const forbidden = [
      'createTermBuffer', // 002 的有界缓冲
      'createScreenModel', // 002 的屏幕模型
      'new Terminal(', // @xterm/headless 直连
      'SerializeAddon',
      // 自建序号「状态」的痕迹：`oldestSeq` / `seq` 作为**字段名或读取**是搬运（允许），
      // 但推进/初始化一个自己的计数器就是第二份实现（不允许）⇒ 只查赋值与自增形态。
      'nextSeq++',
      'nextSeq +=',
      'nextSeq =',
      'let nextSeq',
      'oldestSeq++',
      'oldestSeq +=',
      'oldestSeq =',
      'let oldestSeq',
      'let seq',
      'seq++',
      'seq +=',
    ];
    for (const name of SOURCES) {
      const code = stripComments(readSource(name));
      for (const token of forbidden) {
        expect(code.includes(token), `${name} 不应出现「${token}」（NFR-3 / T1.4）`).toBe(false);
      }
    }
  });

  it('🔴 工具面**零前端依赖**（`src/tools/**` 源码 + `package.json` 依赖表，双重断言）', () => {
    // T3.2 的验收原文是「静态断言本 Spec 目录**无**前端依赖、无 002 逻辑复制」。此前只有
    // 「无 002 逻辑复制」那一半落了断言 ⇒ **缺一半 = 门会静默放过前端依赖混入**（假绿），故补齐。
    const frontend = [
      "from 'react'",
      'from "react"',
      'react-dom',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client',
      'dsh-client-store',
      'ui-primitives',
      'createRoot(',
      'ReactDOM',
      "from '@xterm/xterm'", // 浏览器侧 xterm：Host 侧只能用 `@xterm/headless`
    ];
    for (const name of SOURCES) {
      const code = stripComments(readSource(name));
      for (const token of frontend) {
        expect(code.includes(token), `${name} 不应出现前端依赖「${token}」（NFR-1 / T3.2）`).toBe(false);
      }
    }

    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {});
    const banned = deps.filter((d) => /^(react|react-dom|@xterm\/xterm)$|^@deepseek-ai\/dsh-client/.test(d));
    expect(banned, '`package.json` 的 `dependencies` 不应含前端包（NFR-1）').toEqual([]);

    // 反假绿：断言必须**真的扫到了东西** —— 否则「文件列表为空」或「依赖表读不到」也会显示全绿
    expect(SOURCES.length, '必须扫到 ≥ 8 个工具面源文件').toBeGreaterThanOrEqual(8);
    expect(deps.length, '必须读到 `dependencies` 表（≥ 3 项）').toBeGreaterThanOrEqual(3);
  });

  it('🔴 `src/tools/**` 里没有直接碰 PTY handle / spawn（薄适配层：只调 002 的模块接口）', () => {
    const forbidden = [
      'spawnTerminal',
      'handle.resize',
      'handle.write',
      'handle.terminate',
      'handle.output',
      'ctx.get(\'subprocess\')',
      'ctx.get("subprocess")',
      'sandboxMode', // 沙箱词汇只能来自 ctx.sandboxPolicy 的 resolve 结果
    ];
    for (const name of SOURCES) {
      const code = stripComments(readSource(name));
      for (const token of forbidden) {
        expect(code.includes(token), `${name} 不应出现「${token}」（design §6 红线）`).toBe(false);
      }
    }
  });

  it('NFR-5 / C-1：`src/tools/**` 不 import 任何宿主私有包或前端依赖', () => {
    for (const name of SOURCES) {
      const imports = [...readSource(name).matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        // `host.ts` 的文件头**引用**了官方包名（说明「为什么把 defineTool 作为参数注入」）。
        // 那是散文、不是 import：源码里没有任何指向它的 `import … from '@deepseek-ai/…'`。
        if (specifier.startsWith('@deepseek-ai')) {
          expect(name, '只有 host.ts 的注释会提到官方包名').toBe('host.ts');
          expect(readSource(name)).not.toMatch(/^import[^\n]*from '@deepseek-ai/m);
          continue;
        }
        expect(specifier.startsWith('.'), `${name} 的 import「${specifier}」必须是相对路径`).toBe(true);
        expect(specifier.endsWith('.ts'), `${name} 的相对 import「${specifier}」必须带 .ts 后缀`).toBe(true);
      }
    }
  });

  it('NFR-3：工具面只消费 002 的**类型**与调用方注入的实例，不 import 002 的机制实现', () => {
    // `read-model.ts` 是唯一声明「我要一个 002 manager」的地方，且必须是 `import type`
    const readModel = stripComments(readSource('read-model.ts'));
    expect(readModel).toContain("from '../session/manager.ts'");
    expect(readModel).toMatch(/^import type \{/m);
    // 其余文件连 002 的类型都不需要（`register.ts` 通过参数拿到 manager 的类型，同样走 import type）
    for (const name of ['register.ts', 'policy.ts', 'keys.ts', 'failure.ts', 'schemas.ts', 'host.ts'] as const) {
      const code = stripComments(readSource(name));
      for (const match of code.matchAll(/^import (?!type)[^\n]*from '([^']+)'/gm)) {
        expect(match[1]!.startsWith('.'), `${name} 有非相对的运行时 import「${match[1]}」`).toBe(true);
        expect(match[1]!.startsWith('../screen/'), `${name} 不应 import 002 的屏幕模型实现`).toBe(false);
      }
    }
  });
});

describe('NFR-4 单文件 ≤ 400 行（原始行数，**含 tests/**）', () => {
  it('`src/tools/**` + 本 Spec 的 tests/helpers/tools-* + tests/unit/tools-* 全部 ≤ 400 行', () => {
    // 目录扫描而不是硬编码清单：新加文件自动纳入，不会「忘了把它算进去」
    const files = [
      ...readdirSync(TOOLS_DIR).filter((name) => name.endsWith('.ts')).map((name) => `${TOOLS_DIR}${name}`),
      ...readdirSync(HELPERS_DIR).filter((name) => name.startsWith('tools-')).map((name) => `${HELPERS_DIR}${name}`),
      ...readdirSync(UNIT_DIR)
        .filter((name) => name.startsWith('tools-') && name.endsWith('.test.ts'))
        .map((name) => `${UNIT_DIR}${name}`),
    ];
    expect(files.length).toBeGreaterThanOrEqual(11);
    const counts = files.map((path) => ({ path, lines: lineCount(path) }));
    for (const item of counts) {
      expect(item.lines, `${posix(item.path)} 超 400 行`).toBeLessThanOrEqual(400);
    }
    // 最大的那个应是注册表（6 个工具定义都在里面）。它离 400 还有余量，但余量在缩小：
    // 这条断言的作用是「下次有人往里塞第 7 个工具时先炸测试，而不是先炸 SHALL」。
    const max = counts.reduce((best, item) => (item.lines > best.lines ? item : best));
    expect(posix(max.path).endsWith('src/tools/register.ts')).toBe(true);
    expect(max.lines).toBeLessThanOrEqual(400);
  });
});

describe('design §5 错误码与工具名（防改名漂移）', () => {
  it('工具名**恰好** 6 个且与 design §2 表格逐字一致', () => {
    expect([...TERMINAL_TOOL_NAMES]).toStrictEqual(['managed_terminal_new', 'managed_terminal_list', 'managed_terminal_read', 'managed_terminal_write', 'managed_terminal_resize', 'managed_terminal_kill']);
    expect(new Set(TERMINAL_TOOL_NAMES).size).toBe(6);
  });

  it('design §5 的五个自产错误码都作为字面量出现在失败词汇里', () => {
    const failure = readSource('failure.ts');
    for (const code of ['profile-not-found', 'instance-not-found', 'sandbox-denied', 'cancelled', 'unknown-key']) {
      expect(failure, `失败词汇里缺「${code}」`).toContain(`'${code}'`);
    }
  });

  it('`output.schema` + `output.render` 是每个工具都有的（A-1 的 ③）', () => {
    const register = readSource('register.ts');
    expect([...register.matchAll(/name: '([a-z_]+)',/g)].map((match) => match[1])).toStrictEqual([
      'managed_terminal_new',
      'managed_terminal_list',
      'managed_terminal_read',
      'managed_terminal_write',
      'managed_terminal_resize',
      'managed_terminal_kill',
    ]);
    expect([...register.matchAll(/output: \{/g)]).toHaveLength(6);
    expect([...register.matchAll(/render: /g)]).toHaveLength(6);
  });
});
