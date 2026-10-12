/**
 * 公开面预算自检 —— **三个包共用的一道门**（001 REQ-6.4 的口径承载；2026-10-12 口径变更）
 *
 * ## 这道门在防什么
 *
 * 「公开面不得退化成杂物袋」。判据对象是**可调用的运行时导出**（类型编译后被完全擦除，
 * 既不能 `import` 也不能进 bundle）与**类型导出**（单列，软指标）。
 *
 * ## 口径变更史（原文保留，逐条可追）
 *
 * 1. **初版（2026-10-08）**：**运行时导出 ≤ 12**（`RUNTIME_BUDGET`），类型软阈值 25；
 *    扫描**非递归**（硬编码 `../src/index.ts`）⇒ **只覆盖 `wsl-shared`**。
 * 2. **003 T6.7⑤（2026-10-08）**：`wsl-docker-ports` 因公开面收敛（33 → 6）引入**本包副本门**，
 *    其文件头明写「**没有**把门扩到别的包（后者属 001 的口径变更，待主人拍板）」。
 * 3. **本版（2026-10-12 主人拍板）**：门扩到**三个包**，改成**逐包预算表 + 棘轮（只许降不许升）**，
 *    扫描改**递归**（`package.json#exports` 的全部声明入口 → 沿 re-export 边递归）。
 *    ⇒ **「≤ 12」从此只对 `wsl-shared` 与 `wsl-docker-ports` 成立；`terminal-profiles` 的
 *    31 / 45 是首次登记的「存量欠账」上限，不是认可值**（收敛方向见 `export-budgets.mjs` 头注）。
 *
 * ## 唯一实现（不许各自解释口径）
 *
 * - 解析与「公开面」推导：`./lib/export-surface.mjs`（三个门共用这一份；本文件**不**再内联正则）。
 * - 逐包预算表：`./export-budgets.mjs`（机器可读 SSoT；与 REQ-6.4 的 `<!-- export-budgets:SSoT -->`
 *   块**逐字相等**才放行 ⇒ 抬上限必须两边同改 + 追加 changelog 留痕）。
 *
 * ## 变异哨兵（🔴 门必须能杀旧行为；三个载荷都喂给**同一个**扫描器 / 判定函数）
 *
 * - ① **新增运行时导出**：真实入口字节 + N 行 `export const MUTANT_…` ⇒ 越线必红；
 * - ② **把上限调高**：只改机器表 ⇒ 红（表 ↔ 文档锁）；表与文档一起改而留痕号不存在 ⇒ 也红；
 * - ③ **扫描口径退回旧行为（非递归，只扫首入口）** ⇒ 覆盖面必红（声明入口未被扫到）。
 *
 * 哨兵本身也被断言（`record('⚑ …')`）：**没红就是门的错**，一样 `exit 1`。
 */
import { readFileSync } from 'node:fs';
import {
  RE_EXPORT_STAR,
  collectPublicFace,
  judgeSurface,
  sentinelEntryOnly,
  sentinelNewExport,
} from './lib/export-surface.mjs';
import {
  EXPORT_BUDGETS,
  PACKAGES,
  RATCHET_RULE,
  SSOT_DOC,
  changelogEntries,
  checkTraces,
  diffBudgets,
  readDocBudgets,
  repoPath,
} from './export-budgets.mjs';

let checks = 0;
const failures = [];
const alerts = [];

/** 一条断言：`ok` 为假即登记失败（每条都打印「扫到几项」；0 项视作恒真 ⇒ 失败） */
function record(label, ok, detail, scanned = 1) {
  checks += 1;
  if (scanned === 0) {
    failures.push(`${label}（扫描项 0，为 0 即恒真）`);
    console.log(`  FAIL ${label} — ${detail}（扫描项 0，为 0 即恒真）`);
    return;
  }
  if (!ok) failures.push(`${label} — ${detail}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} — ${detail}（扫描项 ${String(scanned)}）`);
}

const CHANGELOG = 'stack-decision-changelog.md';
const table = EXPORT_BUDGETS;
const docTable = readDocBudgets();
const changelogIds = changelogEntries(readFileSync(repoPath(CHANGELOG), 'utf8'));

console.log('=== 0. SSoT：逐包预算表 ↔ REQ-6.4 的机器可读表（棘轮 = 只许降不许升） ===');
console.log(`  机器表：packages/wsl-shared/scripts/export-budgets.mjs（${String(Object.keys(table).length)} 个包）`);
console.log(`  文档表：${SSOT_DOC.rel} 的 \`${SSOT_DOC.begin}\` 块`);
console.log(`  棘轮：${RATCHET_RULE.direction} — ${RATCHET_RULE.text}`);

const diff = diffBudgets(table, docTable);
const diffRows = diff.rows.map((row) => `${row.pkg}.${row.field}=${String(row.table)}/${String(row.doc)}(${row.direction})`);
record('机器表 ↔ 文档表逐字段相等', diff.ok, diffRows.join('、') || '（无字段）', diff.rows.length);

const traces = checkTraces(table, changelogIds);
const traceList = Object.entries(table).map(([pkg, budget]) => `${pkg}=${String(budget.trace)}`);
record(
  `留痕号可追（${CHANGELOG} 的 #N 真存在）`,
  traces.ok,
  `${traceList.join('、')}${traces.ok ? '' : ` ⇒ ${traces.reasons.join('；')}`}`,
  traceList.length,
);

console.log('\n=== 1. 三包公开面（递归：exports 全部声明入口 → 沿 re-export 边递归） ===');
const faces = new Map();
for (const pkg of PACKAGES) {
  const pkgDir = repoPath(pkg.dir);
  const budget = table[pkg.name];
  const face = collectPublicFace(pkgDir);
  faces.set(pkg.name, face);
  const judged = judgeSurface(face, budget);
  const nature = budget.nature === 'debt' ? '存量欠账（非认可值）' : '硬预算';
  console.log(`\n### ${pkg.name}（上限 ${String(budget.runtime)}/${String(budget.types)}，${nature}，留痕 ${String(budget.trace)}；Spec ${pkg.specs}）`);
  console.log(`  · 声明入口（package.json#exports）：${face.entries.map((entry) => `${(entry.subpaths ?? [entry.subpath]).join('/')} → ${entry.rel}`).join('；')}`);
  console.log(`  · 公开面文件（递归）：${face.files.join('、')}`);
  console.log(`  · 名字来源模块（非 barrel ⇒ **不算公开面**，只用于追溯）：${face.modules.join('、') || '（无）'}`);
  console.log(`  · 每入口读数：${face.perEntry.map((row) => `${(row.subpaths ?? [row.subpath]).join('/')} = ${String(row.runtime.length)}r/${String(row.types.length)}t`).join('；')}`);

  const sourceList = face.files.map((rel) => ({ rel, source: readFileSync(`${pkgDir}/${rel}`, 'utf8') }));
  const starFiles = sourceList.filter((item) => RE_EXPORT_STAR.test(item.source)).map((item) => item.rel);
  record('没有 `export * from`（显式列举才可静态核对预算）', starFiles.length === 0, starFiles.join('、') || '全部为显式列举', sourceList.length);
  record(
    `运行时 ${String(judged.runtime.length)}/${String(budget.runtime)}（超限即红，SHALL）`,
    judged.runtime.length <= budget.runtime,
    judged.reasons.filter((reason) => reason.includes('运行时')).join('；') || '在预算内',
    judged.runtime.length,
  );
  record(
    `类型 ${String(judged.types.length)}/${String(budget.types)}（软指标：记录在案的上限，超限告警）`,
    judged.types.length <= budget.types,
    judged.warnings.join('；') || '在记录上限内',
    judged.types.length,
  );
  record(
    `覆盖面：${String(face.entries.length)} 个声明入口全部被扫到`,
    judged.ok,
    judged.reasons.join('；') || `扫描面 ${face.files.length} 个文件覆盖 ${String(face.entries.length)} 个声明入口`,
    face.entries.length,
  );
  if (judged.warnings.length > 0) alerts.push(`${pkg.name}：${judged.warnings.join('；')}`);
  console.log(`  运行时（${String(judged.runtime.length)}）：${judged.runtime.join(', ')}`);
  console.log(`  类型（${String(judged.types.length)}）：${judged.types.join(', ')}`);
  if (budget.nature === 'debt') {
    console.log(`  ⚠️ **存量欠账**：${String(judged.runtime.length)}/${String(judged.types.length)} 是**按现状设的上限**，不是达标值；`);
    console.log('     收敛方向：① 先删「可证明无消费者」的导出（逐条 grep 到 0 条才可摘）→ ② 再谈阈值/拆分（要主人拍板 + 改 SSoT + 留痕）；');
    console.log('     🔴 禁止为了过门而删有消费者的导出。');
  }
}

console.log('\n=== 2. 变异哨兵②（棘轮：把上限调高必须红） ===');
// 载荷自带的对照基线：文档表可用就用它，否则退化为「表自身的快照」——
// 这样哨兵**不依赖仓库状态**（文档块缺失那件事由第 0 节负责报红），棘轮机制本身永远被验到。
const baseDoc = Object.keys(docTable).length > 0 ? docTable : Object.fromEntries(Object.entries(table).map(([name, budget]) => [name, { ...budget }]));
const cloneTable = (source) => Object.fromEntries(Object.entries(source).map(([name, budget]) => [name, { ...budget }]));

const raisedOnlyTable = cloneTable(table);
raisedOnlyTable['dsh-terminal-profiles'].runtime += 1;
const diffRaiseOnly = diffBudgets(raisedOnlyTable, baseDoc);
const upRows = diffRaiseOnly.up.map((row) => `${row.pkg}.${row.field} ${String(row.doc)} → ${String(row.table)}`);
console.log('  载荷②a：机器表 terminal-profiles.runtime 31 → 32（文档表不动）');
console.log(`    ⇒ ${upRows.length === 0 ? '未抓到上调（门的错）' : `抓到上调 ${String(upRows.length)} 处：${upRows.join('、')}`}`);
record('⚑ ②a 只改机器表抬上限 ⇒ 判红（棘轮）', diffRaiseOnly.ok === false && upRows.length > 0, upRows.join('、') || '未抓到上调', upRows.length);

const raisedBothTable = cloneTable(table);
const raisedBothDoc = cloneTable(baseDoc);
for (const side of [raisedBothTable, raisedBothDoc]) {
  if (side['dsh-terminal-profiles'] === undefined) side['dsh-terminal-profiles'] = { runtime: 0, types: 0, trace: '#999' };
  side['dsh-terminal-profiles'] = { ...side['dsh-terminal-profiles'], runtime: 32, trace: '#999' };
}
const diffRaiseBoth = diffBudgets(raisedBothTable, raisedBothDoc);
const traceRaiseBoth = checkTraces(raisedBothTable, changelogIds);
console.log('  载荷②b：机器表与文档表一起抬到 32，但留痕号写不存在的 #999');
console.log(`    ⇒ 表 ↔ 文档 ${diffRaiseBoth.ok ? '相等（单靠表比对抓不住）' : `不等：${diffRaiseBoth.reasons.join('；')}`}；留痕核验 ${traceRaiseBoth.ok ? '未红（门的错）' : traceRaiseBoth.reasons.join('；')}`);
record('⚑ ②b 两边同改但留痕号不存在 ⇒ 判红（抬上限必须留痕）', traceRaiseBoth.ok === false, `trace=#999 命中 ${String(changelogIds.has(999))}`, traceRaiseBoth.reasons.length);

console.log('\n=== 3. 变异哨兵①（新增运行时导出）与③（扫描口径退回非递归） ===');
for (const pkg of PACKAGES) {
  const pkgDir = repoPath(pkg.dir);
  const budget = table[pkg.name];
  const additive = sentinelNewExport(pkgDir, budget);
  console.log(`  ⚑ ① ${pkg.name}：${additive.label} ⇒ ${additive.red ? '判红 ✓' : '未红 ✗'}（${additive.detail}）`);
  if (additive.red) console.log(`     门会报：${additive.reasons.join('；')}`);
  record(`⚑ ① ${pkg.name} 新增运行时导出（越线）⇒ 判红`, additive.red, `${additive.detail}；载荷 ${additive.payload.join(', ')}`, additive.payload.length);

  const legacy = sentinelEntryOnly(pkgDir, budget);
  if (!legacy.applicable) {
    console.log(`  ⚑ ③ ${pkg.name}：${legacy.label} ⇒ **不适用**（单声明入口包：旧口径与新口径等价，不许假装它红了）`);
    record(`⚑ ③ ${pkg.name} 旧口径不适用（单入口，等价）`, legacy.red === false, legacy.detail, 1);
  } else {
    console.log(`  ⚑ ③ ${pkg.name}：${legacy.label} ⇒ ${legacy.red ? '判红 ✓' : '未红 ✗'}（${legacy.detail}）`);
    if (legacy.red) console.log(`     门会报：${legacy.reasons.join('；')}`);
    record(`⚑ ③ ${pkg.name} 退回非递归口径 ⇒ 判红`, legacy.red, legacy.detail, 1);
  }
}

console.log(`\n=== 结果：${String(checks)} 项判定，失败 ${String(failures.length)} 项 ===`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
for (const alert of alerts) console.log(`  ⚠️ ${alert}`);
process.exitCode = failures.length === 0 ? 0 : 1;
