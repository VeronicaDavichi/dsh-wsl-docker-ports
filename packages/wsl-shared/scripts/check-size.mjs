/**
 * 体积与单文件行数自检（001 校验门 + NFR-5）
 *
 * **口径（2026-10-08 主人拍板）**：算代码体积时**注释与空行不计入** ——
 * 统计对象是「去注释、去空行后」的 **UTF-8 字节数**（`SIZE_BUDGET_BYTES` = 15 KiB）。
 * 那条是**软指标**：超限只打印醒目告警、不失败（与 `warn 200` 同一套口径）。
 * NFR-5 的「单文件 ≤ 400 行」是 **SHALL** ⇒ 超限**失败**；行数按**原始行数**算
 * （含注释 —— 那是可读性指标，不是体积指标，两者故意不同）。
 *
 * 去注释用正则启发式（本包不引解析器依赖，NFR-1）：块注释 + 行注释；
 * 行注释带 `(^|[^:])` 保护，避免把 `https://` 里的 `//` 当成注释起点。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 软指标：去注释、去空行后的源码 ≤ 15 KiB */
const SIZE_BUDGET_BYTES = 15 * 1024;
/** NFR-5（SHALL）：单文件 ≤ 400 行 */
const FILE_LINE_LIMIT = 400;

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const files = readdirSync(srcDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const codeOnly = (source) =>
  stripComments(source)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const rows = [];
let rawTotal = 0;
let codeTotal = 0;
const overLineLimit = [];

for (const name of files) {
  const text = readFileSync(join(srcDir, name), 'utf8');
  const raw = Buffer.byteLength(text, 'utf8');
  const code = Buffer.byteLength(codeOnly(text), 'utf8');
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  rawTotal += raw;
  codeTotal += code;
  rows.push({ name, raw, code, lines });
  if (lines > FILE_LINE_LIMIT) overLineLimit.push(`${name}（${lines} 行）`);
}

const commentShare = rawTotal === 0 ? 0 : Math.round(((rawTotal - codeTotal) / rawTotal) * 100);
const overBudget = codeTotal > SIZE_BUDGET_BYTES;

console.log(
  `${overBudget ? '⚠️' : '✓'} check-size: 去注释代码 ${kb(codeTotal)} / ${kb(SIZE_BUDGET_BYTES)}` +
    `（原始 ${kb(rawTotal)}，注释+空行占 ${commentShare}%）`,
);
for (const row of rows) {
  console.log(
    `  ${row.name.padEnd(14)} ${kb(row.raw).padStart(8)} → ${kb(row.code).padStart(8)}` +
      `  ${String(row.lines).padStart(4)} 行`,
  );
}

if (overBudget) {
  console.log(
    `  ⚠️ 软指标超限：去注释代码超出 ${kb(SIZE_BUDGET_BYTES)} 共 ${kb(codeTotal - SIZE_BUDGET_BYTES)}。` +
      '要么瘦身，要么带理由改 Spec（tasks.md 校验门那行）——不静默放过。',
  );
}
if (overLineLimit.length > 0) {
  console.error(`✗ check-size: NFR-5 单文件 > ${FILE_LINE_LIMIT} 行：${overLineLimit.join('、')}`);
  process.exit(1);
}
