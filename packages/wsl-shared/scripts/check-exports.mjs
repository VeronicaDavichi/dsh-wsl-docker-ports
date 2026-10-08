/**
 * 公开面预算自检（001 T0.2 / T6.1）
 *
 * **预算口径（REQ-6.4，2026-10-08 主人拍板订正）**：**运行时导出 ≤ 12**（`RUNTIME_BUDGET`）。
 * 类型导出（`export type …` / `interface` / `type`）**不计入**运行时预算 —— 类型在运行时被
 * 完全擦除，既不能 `import` 也不能进 bundle；REQ-6.4 的意图是「公开面不得退化成杂物袋」，
 * 约束对象是**可调用的运行时面**（原文曾写「含类型」，Phase 1+2 实测后按此订正并留痕）。
 * 两个数都打印，总量另设软阈值（`TOTAL_SOFT_MAX`），所以膨胀仍然看得见。
 *
 * 为什么用正则而不是 AST：本包不引入任何构建/解析依赖（离线可跑，NFR-1），
 * 而检查对象是**我们自己**的单一入口文件，形状受控。
 * 两道防呆：① 解析不到任何运行时导出 → 失败（正则失效必须响）
 *          ② 出现 `export * from` → 失败（无法静态枚举，预算会被绕过）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUNTIME_BUDGET = 12;
const TOTAL_SOFT_MAX = 20;

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const source = readFileSync(entry, 'utf8');

const fail = (message) => {
  console.error(`✗ check-exports: ${message}`);
  process.exit(1);
};

if (/^export\s+(?:type\s+)?\*\s+from/m.test(source)) {
  fail('index.ts 用了 `export * from`：无法静态核对预算，请改成显式列举导出');
}

const runtime = new Set();
const types = new Set();
const stripType = (name) => name.trim().replace(/^type\s+/, '');

// 形如 `export { a, b, type C } from './x.ts';` 与 `export type { A, B } from './x.ts';`
for (const match of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
  const blockIsTypeOnly = Boolean(match[1]);
  for (const item of (match[2] ?? '').split(',')) {
    const raw = item.trim();
    if (raw.length === 0) continue;
    const name = stripType(raw);
    if (name.length === 0) continue;
    if (blockIsTypeOnly || /^type\s+/.test(raw)) types.add(name);
    else runtime.add(name);
  }
}

// 形如 `export const x = …` / `export async function y() {}` / `export class Z {}`
for (const match of source.matchAll(
  /export\s+(?:async\s+)?(?:const|function|class|enum)\s+([A-Za-z0-9_$]+)/g,
)) {
  const name = match[1];
  if (name !== undefined) runtime.add(name);
}

// 形如 `export interface X {}` / `export type Y = …`
for (const match of source.matchAll(/export\s+(?:interface|type)\s+([A-Za-z0-9_$]+)/g)) {
  const name = match[1];
  if (name !== undefined) types.add(name);
}

for (const name of types) runtime.delete(name);

if (runtime.size === 0) {
  fail('未能从 src/index.ts 解析出任何运行时导出（检查正则是否失效）');
}
if (runtime.size > RUNTIME_BUDGET) {
  fail(`运行时导出 ${runtime.size} 个 > 预算 ${RUNTIME_BUDGET}：${[...runtime].join(', ')}`);
}

const total = runtime.size + types.size;
const softWarn = total > TOTAL_SOFT_MAX ? ` ⚠️ 合计超软阈值 ${TOTAL_SOFT_MAX}` : '';
console.log(
  `✓ check-exports: 运行时 ${runtime.size}/${RUNTIME_BUDGET}，类型 ${types.size}，合计 ${total}${softWarn}`,
);
console.log(`  运行时：${[...runtime].join(', ')}`);
console.log(`  类型：${[...types].join(', ')}`);
