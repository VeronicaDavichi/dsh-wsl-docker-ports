/**
 * 体积与单文件行数自检（001 校验门 + NFR-5）
 *
 * **口径（2026-10-08 主人拍板）**：算代码体积时**注释与空行不计入** ——
 * 统计对象是「去注释、去空行后」的 **UTF-8 字节数**（`SIZE_BUDGET_BYTES`）。
 * 那条是**软指标**：超限只打印醒目告警、不失败（与 `warn 200` 同一套口径）。
 * NFR-5 的「单文件 ≤ 400 行」是 **SHALL** ⇒ 超限**失败**；行数按**原始行数**算
 * （含注释 —— 那是可读性指标，不是体积指标，两者故意不同）。
 *
 * **预算值变更（2026-10-08 主人二次拍板）：15 KiB → 25 KiB**。理由：Phase 3 后实测
 * 15,318/15,360 字节（余 42），而本包还要落 Phase 4（pathmap）+ Phase 5（`.wslconfig`/NAT）
 * + 消费方复用的通用执行件（T3.4）⇒ 15 KiB 是「当初只有 3 个模块」时定的，必然被超。
 * **复算口径与判定逻辑不变，只换阈值**（留痕见 specs/001-wsl-shared/tasks.md 的口径节）。
 *
 * 去注释用正则启发式（本包不引解析器依赖，NFR-1）：块注释 + 行注释；
 * 行注释带 `(^|[^:])` 保护，避免把 `https://` 里的 `//` 当成注释起点。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 软指标：去注释、去空行后的源码 ≤ 25 KiB（2026-10-08 主人二次拍板：15 → 25） */
const SIZE_BUDGET_BYTES = 25 * 1024;
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

// 判定与告警都用**字节**，不用四舍五入后的 KB：15,318 与 15,360 都会显示成「15.0 KB」，
// 而小超限（例如 24 字节）会显示成「超出 0.0 KB」—— 两种都会让人读不出真实余量。
console.log(
  `${overBudget ? '⚠️' : '✓'} check-size: 去注释代码 ${kb(codeTotal)} / ${kb(SIZE_BUDGET_BYTES)}（` +
    `${codeTotal} / ${SIZE_BUDGET_BYTES} 字节 ⇒ ` +
    `${overBudget ? `超 ${codeTotal - SIZE_BUDGET_BYTES}` : `余 ${SIZE_BUDGET_BYTES - codeTotal}`} 字节；` +
    `原始 ${kb(rawTotal)}，注释+空行占 ${commentShare}%）`,
);
for (const row of rows) {
  console.log(
    `  ${row.name.padEnd(14)} ${kb(row.raw).padStart(8)} → ${kb(row.code).padStart(8)}` +
      `  ${String(row.lines).padStart(4)} 行`,
  );
}

if (overBudget) {
  console.log(
    `  ⚠️ 软指标超限：去注释代码 ${codeTotal} 字节，超出 ${SIZE_BUDGET_BYTES} 字节预算共` +
      ` ${codeTotal - SIZE_BUDGET_BYTES} 字节。要么瘦身，要么带理由改 Spec（tasks.md 校验门那行）` +
      '——不静默放过。',
  );
}
if (overLineLimit.length > 0) {
  console.error(`✗ check-size: NFR-5 单文件 > ${FILE_LINE_LIMIT} 行：${overLineLimit.join('、')}`);
  process.exit(1);
}
