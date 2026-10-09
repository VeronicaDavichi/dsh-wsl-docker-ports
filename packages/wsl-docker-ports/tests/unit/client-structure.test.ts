/**
 * 结构性/静态判据（`node --test`，无 DOM）
 *
 * 这些断言检查的是**不可能靠运行时行为间接证到**的事实：文件行数、颜色来源、
 * 跨包引用、以及「配置写」与「提权写」在**语法层**就已分家。
 * 每条都打印扫描计数；计数为 0 一律判失败（恒真断言在这里最容易被写出来）。
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const pkgRoot = new URL('../../', import.meta.url);
const clientDir = new URL('../../src/client/', import.meta.url);

function listFiles(dir: URL, extensions: readonly string[]): string[] {
  return readdirSync(dir)
    .filter((name) => extensions.some((extension) => name.endsWith(extension)))
    .map((name) => path.join(dir.pathname.replace(/^\/([A-Za-z]:)/u, '$1'), name));
}

function listAllFiles(dir: URL, extensions: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) out.push(...listAllFiles(child, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) out.push(child.pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
  }
  return out;
}

/** 去注释、去空行后的 UTF-8 字节数（001 REQ-6.4 的体积口径） */
export function strippedBytes(text: string): number {
  const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//gu, '');
  const withoutLine = withoutBlock
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const body = withoutLine
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .join('\n');
  return Buffer.byteLength(body);
}

test('T6.4 单文件 ≤ 400 行（SHALL，按原始行数）：本包全部源文件 + 报出最大者', () => {
  const files = listAllFiles(new URL('../../src/', import.meta.url), ['.ts', '.tsx']);
  assert.ok(files.length > 0, '扫描文件数为 0 ⇒ 断言恒真');
  const measured = files.map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n').length }));
  const over = measured.filter((item) => item.lines > 400);
  const max = measured.reduce((best, item) => (item.lines > best.lines ? item : best));
  assert.deepEqual(over.map((item) => `${path.basename(item.file)}=${String(item.lines)}`), [], '以下文件超过 400 行');
  console.log(`  · 扫了 ${String(files.length)} 个源文件，最大 = ${path.basename(max.file)} ${String(max.lines)} 行（阈值 400）`);
});

test('NFR-7 零硬编码颜色：src/client/** 不含 hex 颜色，且颜色只来自宿主 token', () => {
  const files = listFiles(clientDir, ['.ts', '.tsx']);
  assert.ok(files.length > 0);
  const hits: string[] = [];
  let bytes = 0;
  let tokenRefs = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    bytes += Buffer.byteLength(text);
    for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b/gu)) hits.push(`${path.basename(file)}:${match[0]}`);
    tokenRefs += [...text.matchAll(/var\(--dsw-/gu)].length;
  }
  assert.deepEqual(hits, [], `命中 ${JSON.stringify(hits)}`);
  assert.ok(tokenRefs > 0, 'CSS 里必须真的引用宿主 token，否则「零 hex」可能只是「没有样式」');
  console.log(`  · 扫了 ${String(files.length)} 个文件 / ${String(bytes)} 字节，hex 命中 ${String(hits.length)} 处，var(--dsw-*) 引用 ${String(tokenRefs)} 处`);
});

test('跨包红线：客户端半不引用 dsh-terminal-profiles（跨包服务只能 ctx.inject 软取）', () => {
  const files = [...listFiles(clientDir, ['.ts', '.tsx']), path.join(pkgRoot.pathname.replace(/^\/([A-Za-z]:)/u, '$1'), 'lib', 'client.js')];
  let bytes = 0;
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    bytes += Buffer.byteLength(text);
    if (text.includes('dsh-terminal-profiles') || text.includes('terminal-profiles')) hits.push(path.basename(file));
  }
  assert.deepEqual(hits, [], `命中 ${JSON.stringify(hits)}`);
  console.log(`  · 扫了 ${String(files.length)} 个文件（含产物）/ ${String(bytes)} 字节，命中 ${String(hits.length)} 个`);
});

test('「配置写」与「提权写」在语法层分家：settings 管道里没有任何执行/提权字样', () => {
  const file = path.join(clientDir.pathname.replace(/^\/([A-Za-z]:)/u, '$1'), 'settings-pipe.ts');
  const text = readFileSync(file, 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//gu, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const forbidden = ['portproxy', 'invoke', 'gsudo', 'Start-Process', 'child_process', 'netsh', 'elevate', 'spawn'];
  const hits = forbidden.filter((word) => code.includes(word));
  assert.deepEqual(hits, [], `配置管道不得出现 ${JSON.stringify(hits)}`);
  console.log(`  · 扫了 ${String(forbidden.length)} 个禁用词 × ${String(code.length)} 字符代码，命中 ${String(hits.length)} 个`);
});

test('客户端半不 require react-dom（组件由宿主渲染，本半不自建 root）', () => {
  const files = listFiles(clientDir, ['.ts', '.tsx']);
  const hits: string[] = [];
  let scanned = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    scanned += 1;
    if (/['"]react-dom/u.test(text)) hits.push(path.basename(file));
  }
  assert.deepEqual(hits, [], `命中 ${JSON.stringify(hits)}`);
  console.log(`  · 扫了 ${String(scanned)} 个客户端文件，react-dom 命中 ${String(hits.length)} 个`);
});

test('入口静态形状：有 `export const inject`、无 `export default`（客户端半与宿主半形状相反）', () => {
  const file = path.join(clientDir.pathname.replace(/^\/([A-Za-z]:)/u, '$1'), 'index.ts');
  const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(/export const inject\b/u.test(code), '必须有模块级 inject');
  assert.equal(/export default/u.test(code), false, '客户端入口不得有 default 导出');
  assert.ok(/CLIENT_SERVICES/u.test(code), "inject 必须来自共享常量（避免与包名数组写混）");
  console.log(`  · 扫了入口 ${String(code.length)} 字符代码：inject ✅ / default ❌`);
});

test('体积（软指标）：src/client/** 去注释去空行后逐文件报数，单文件均远低于 40KB', () => {
  const files = listFiles(clientDir, ['.ts', '.tsx']);
  const measured = files.map((file) => ({ file: path.basename(file), bytes: strippedBytes(readFileSync(file, 'utf8')) }));
  const max = measured.reduce((best, item) => (item.bytes > best.bytes ? item : best));
  const total = measured.reduce((sum, item) => sum + item.bytes, 0);
  assert.ok(max.bytes < 40 * 1024, `${max.file} = ${String(max.bytes)} B 超过 40KB 软阈值`);
  console.log(`  · 扫了 ${String(files.length)} 个文件，合计 ${String(total)} B，最大 = ${max.file} ${String(max.bytes)} B（软阈值 40960 B）`);
});

test('产物存在且非空：lib/client.js 是客户端半的唯一交付形态', () => {
  const artifact = path.join(pkgRoot.pathname.replace(/^\/([A-Za-z]:)/u, '$1'), 'lib', 'client.js');
  const bytes = statSync(artifact).size;
  assert.ok(bytes > 0);
  const head = readFileSync(artifact, 'utf8').slice(0, 120);
  assert.match(head, /window\.__ModuleLoader__\.load\(\{ id: "dsh-wsl-docker-ports", factory: \(require\) => \{/u);
  console.log(`  · 扫了产物 ${String(bytes)} 字节，首层自注册形态 ✅`);
});
