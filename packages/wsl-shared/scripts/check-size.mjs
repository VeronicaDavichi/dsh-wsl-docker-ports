/**
 * 体积与单文件行数自检（001 校验门 + NFR-5）
 *
 * **口径（2026-10-08 主人拍板）**：算代码体积时**注释与空行不计入** ——
 * 统计对象是「去注释、去空行后」的 **UTF-8 字节数**（`SIZE_BUDGET_BYTES`）。
 * 那条是**软指标**：超限只打印醒目告警、不失败（与 `warn 200` 同一套口径）。
 * NFR-5 的「单文件 ≤ 400 行」是 **SHALL** ⇒ 超限**失败**；行数按**原始行数**算
 * （含注释 —— 那是可读性指标，不是体积指标，两者故意不同）。
 *
 * **预算值变更史（同一口径，只换阈值）**：**15 KiB**（初版，本包只有 3 个模块时定的）→ **25 KiB**
 * （2026-10-08 二次拍板：Phase 3 后已 15,318/15,360 字节，而 Phase 4 pathmap + Phase 5
 * `.wslconfig`/NAT 还要加）→ **40 KiB**（2026-10-08 三次拍板，主人原话：「**40KB，再超了就是你的
 * 代码有问题或者 spec 拆分有问题**」）。⇒ 40 KiB 是**宽裕到没有借口**的额度：此后若再告警，
 * 先自证「不是代码膨胀、也不是 Spec 拆分不当」，**不许**再来抬阈值。
 * **复算口径与判定逻辑不变**（留痕见 specs/001-wsl-shared/tasks.md 的口径节）。
 *
 * 去注释走**与 `check-scope.mjs` 共用**的 `strip-comments.mjs`（T6.2，2026-10-09）：
 * 两道门都「只看代码不看注释」，各写一份正则必然漂移，而漂移的症状是**一道门悄悄失去判据**。
 * 该模块的已知局限（正则启发式而非 AST，`(^|[^:])` 保护 `https://`）记在它的文件头。
 *
 * **2026-10-12 覆盖面扩展（收官补门）**：原实现**只扫本包 `src/` 的 `.ts`**，于是
 * `packages/<pkg>/tests/**` 与 `packages/<pkg>/scripts/**` **从未被 400 行 SHALL 拦过** ——
 * 这正是已登记的真缺口（`transport-apply.test.ts` 曾 747 行，而 `client-structure.test.ts`
 * 的 T6.4 只扫 `src/`，两处都放行）。现在**在同一个脚本内**把扫描面扩到
 * `packages/<pkg>/{src,tests,scripts}/**` 的 `.ts` / `.tsx` / `.mjs`（跳过 `node_modules` / `dist` / `lib`）。
 * 🔴 **口径同源**：行数走本文件唯一的一份 `rawLines()`、体积走唯一的一份 `codeOnly()` +
 * `SIZE_BUDGET_BYTES`，**不另造第二份公式**（AGENTS.md：「不许各自解释口径」）。
 * ⚠️ **40KB 软指标口径未变**：仍按**原有的 `wsl-shared/src` 聚合**报数（那串数已写进
 * `specs/001-wsl-shared/tasks.md` 的校验门行，属 SSoT ⇒ 不因扩面而漂移）；扩面部分只报
 * **逐文件**去注释字节数、单文件超 40KB 时告警，**不新增聚合预算、不改任何阈值**。
 * 防呆两道：扩面命中 0 文件 ⇒ `exit 1`；扩面集合未覆盖本包 `src` 全部文件 ⇒ `exit 1`。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './strip-comments.mjs';

/** 软指标：去注释、去空行后的源码 ≤ 40 KiB（2026-10-08 主人三次拍板：15 → 25 → 40） */
const SIZE_BUDGET_BYTES = 40 * 1024;
/** NFR-5（SHALL）：单文件 ≤ 400 行 */
const FILE_LINE_LIMIT = 400;

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const files = readdirSync(srcDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();

/** 原始行数（NFR-5 口径 SSoT；本文件两处扫描共用这一份实现，不复制第二份公式） */
const rawLines = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

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
  const lines = rawLines(text);
  rawTotal += raw;
  codeTotal += code;
  rows.push({ name, raw, code, lines });
  // 超限登记统一由下方扩面扫描完成（它覆盖本包 src、并用包内相对路径 ⇒ 同一文件不会报两次）；
  // 扩面若漏掉本包 src 任一文件，下方防呆会 exit 1 ⇒ 此处不登记不会丢覆盖面。
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
// ── 覆盖面扩展（2026-10-12）：packages/*/{src,tests,scripts}/** 的 .ts/.tsx/.mjs ──
// 行数一律走同一个 `rawLines()`、体积一律走同一个 `codeOnly()` + `SIZE_BUDGET_BYTES`
// ⇒ 与上方「原始行数 / 40KB」是**同一份口径实现**，此处**不复制第二份公式**。
const packagesDir = fileURLToPath(new URL('../../', import.meta.url));
const SCAN_SUBDIRS = ['src', 'tests', 'scripts'];
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.mjs'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'lib']);

const walk = (dir, out) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(child, out);
    } else if (SCAN_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(child);
    }
  }
  return out;
};

const wideFiles = [];
const widePerPackage = [];
for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!pkg.isDirectory() || SKIP_DIRS.has(pkg.name)) continue;
  const before = wideFiles.length;
  for (const sub of SCAN_SUBDIRS) {
    try {
      if (statSync(join(packagesDir, pkg.name, sub)).isDirectory()) {
        walk(join(packagesDir, pkg.name, sub), wideFiles);
      }
    } catch {
      // 该包没有这个子目录 ⇒ 跳过，不是错误
    }
  }
  widePerPackage.push(`${pkg.name}=${wideFiles.length - before}`);
}
wideFiles.sort();
widePerPackage.sort();

if (wideFiles.length === 0) {
  console.error('✗ check-size: 扩面扫描命中 0 个文件 ⇒ 判据恒真，拒绝放行（防呆）');
  process.exit(1);
}
// 防呆：扩面集合必须是上方「本包 src」集合的超集，否则上一条去掉的超限登记会静默丢覆盖面
const wideSet = new Set(wideFiles);
const missingFromWide = files.map((name) => join(srcDir, name)).filter((file) => !wideSet.has(file));
if (missingFromWide.length > 0) {
  console.error(`✗ check-size: 扩面扫描漏掉本包 src 下 ${missingFromWide.length} 个文件 ⇒ 覆盖面回退，拒绝放行（防呆）`);
  process.exit(1);
}

console.log(
  `\n✓ check-size（扩面 2026-10-12）：packages/*/{${SCAN_SUBDIRS.join(',')}}/** 的 ` +
    `${SCAN_EXTENSIONS.join(' / ')} ⇒ 扫到 ${wideFiles.length} 个文件（${widePerPackage.join('、')}）`,
);

let wideMax = null;
const wideOverSoft = [];
for (const file of wideFiles) {
  const text = readFileSync(file, 'utf8');
  const lines = rawLines(text);
  const code = Buffer.byteLength(codeOnly(text), 'utf8');
  const rel = file.slice(packagesDir.length).split(sep).join('/');
  if (wideMax === null || lines > wideMax.lines) wideMax = { rel, lines, code };
  if (code > SIZE_BUDGET_BYTES) wideOverSoft.push(`${rel}（${code} 字节）`);
  if (lines > FILE_LINE_LIMIT) overLineLimit.push(`${rel}（${lines} 行）`);
}
if (wideMax !== null) {
  console.log(
    `  · 最大：${wideMax.rel} = ${wideMax.lines} 行 / 去注释 ${wideMax.code} 字节` +
      `（判据：${FILE_LINE_LIMIT} 行 SHALL 失败 / ${SIZE_BUDGET_BYTES} 字节软指标只告警）`,
  );
}
if (wideOverSoft.length > 0) {
  console.log(`  ⚠️ 软指标（逐文件 > ${kb(SIZE_BUDGET_BYTES)}，只告警）：${wideOverSoft.join('、')}`);
}
if (overLineLimit.length > 0) {
  console.error(`✗ check-size: NFR-5 单文件 > ${FILE_LINE_LIMIT} 行：${overLineLimit.join('、')}`);
  process.exit(1);
}
