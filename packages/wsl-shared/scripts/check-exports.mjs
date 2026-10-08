/**
 * 公开面预算自检（001 T0.2）：`src/index.ts` 的导出符号数必须 ≤ 12。
 *
 * 为什么用正则而不是 AST：本包不引入任何构建/解析依赖（离线可跑），
 * 而这个检查的对象是**我们自己**的单一入口文件，形状受控。
 * 解析不到任何导出 → 视为失败（防止正则失效后静默放行）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUDGET = 12;
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const source = readFileSync(entry, 'utf8');

const symbols = new Set();
const names = [];

// 形如 `export { a, b, type C } from './x.ts';` 与 `export const x = ...`
for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
  for (const raw of (match[1] ?? '').split(',')) {
    const name = raw.trim().replace(/^type\s+/, '');
    if (name.length > 0 && !symbols.has(name)) {
      symbols.add(name);
      names.push(name);
    }
  }
}
for (const match of source.matchAll(/export\s+(?:async\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g)) {
  const name = match[1];
  if (name !== undefined && !symbols.has(name)) {
    symbols.add(name);
    names.push(name);
  }
}

if (names.length === 0) {
  console.error('✗ check-exports: 未能从 src/index.ts 解析出任何导出（检查正则是否失效）');
  process.exit(1);
}
if (names.length > BUDGET) {
  console.error(`✗ check-exports: 导出 ${names.length} 个 > 预算 ${BUDGET}：${names.join(', ')}`);
  process.exit(1);
}
console.log(`✓ check-exports: ${names.length}/${BUDGET} 个导出 — ${names.join(', ')}`);
