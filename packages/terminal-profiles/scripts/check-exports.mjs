/**
 * `dsh-terminal-profiles` 公开面预算自检（001 REQ-6.4 的**逐包预算 + 棘轮**口径，2026-10-12）
 *
 * ## 本包的特殊性：**存量欠账**
 *
 * 本包 barrel 从未纳入任何导出预算。2026-10-12 首次登记时实测 **运行时 31 / 类型 45**，
 * 主人拍板**按现状设上限**（31 / 45）—— 目的是让「再涨一个」当场红，**不是**认可 31/45 是好数字。
 * 上限登记在 [`export-budgets.mjs`](../../wsl-shared/scripts/export-budgets.mjs)（机器可读 SSoT），
 * 与 REQ-6.4 的 `<!-- export-budgets:SSoT -->` 块逐字绑定（改一边必红）。
 *
 * **收敛方向与优先级**（照 003 T6.7⑤ 的先例）：
 * 1. 先做**可证明无消费者**的导出删减 —— 逐个名字核「入口级消费方」，**0 条**才可摘；
 * 2. 摘干净后再谈**阈值或拆分**（要主人拍板 + 改 SSoT 两边 + 追加 changelog 留痕）；
 * 3. 🔴 **禁止**为了过门而删有消费者的导出（那会红在 `tsc` / 单测 / `check:client` 上）。
 *
 * ## 这道门比「数数」多做了什么
 *
 * - **口径唯一实现**：解析 / 公开面推导走 `../wsl-shared/scripts/lib/export-surface.mjs`
 *   （三个门共用一份，不内联第二份正则）；
 * - **逐条消费方登记表（`CONSUMERS`）+ 机械复核**：登记表必须与实测的 31 个名字**一一对应**，
 *   且每条 `entry-import` 记录的消费方文件要与**真扫出来的进口清单**逐字相符（登记表不许写谎）；
 * - **宿主契约四件套**（`name` / `inject` / `apply` / `Config`）另立一条：消费方是宿主 loader，
 *   判据 = `cordis.patch.yml` 在场 + `exports["."]` 指向构建产物（不是源码入口）；
 * - **变异哨兵**：① 真实入口字节 + 1 行新导出 ⇒ 必须红（本包贴住上限，加一个就超）；
 *   ③ 退回旧口径（只扫首入口）⇒ 覆盖面必须红（`./client` 声明入口会漏）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_BUDGETS, PACKAGES, repoPath } from '../../wsl-shared/scripts/export-budgets.mjs';
import {
  RE_EXPORT_STAR,
  collectPublicFace,
  judgeSurface,
  sentinelEntryOnly,
  sentinelNewExport,
} from '../../wsl-shared/scripts/lib/export-surface.mjs';

const PKG_NAME = 'dsh-terminal-profiles';
const PACKAGE = PACKAGES.find((pkg) => pkg.name === PKG_NAME);
const PKG_DIR = repoPath(PACKAGE.dir);
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const budget = EXPORT_BUDGETS[PKG_NAME];

/** 宿主契约四件套（宿主 loader 按名字读；`Config` 决定 settings 命名空间是否注册） */
const HOST_CONTRACT = ['name', 'inject', 'apply', 'Config'];

/**
 * **逐条消费方登记表**（31 条，与实测名字一一对应）。
 * - `via: 'entry-import'`：经**包入口**（`exports["."]` / `exports["./client"]` 的源文件）import ⇒
 *   下面用机械扫描**逐字复核** `files`；
 * - `via: 'host-loader'`：消费方是宿主 loader（读构建产物 `lib/index.js`），源码里查不到 import ⇒
 *   判据改用「`cordis.patch.yml` 在场 + `exports["."]` 指向 `lib/`」；
 * - `via: 'none'`：**入口级消费方 0 条** ⇒ 记为**欠账候选**（机械扫描必须同样查到 0 条，否则红）。
 */
const CONSUMERS = {
  name: { via: 'host-loader', note: '宿主 loader（patch 行 id / bundle 清单）' },
  inject: { via: 'host-loader', note: '宿主 loader（依赖列表）' },
  apply: { via: 'host-loader', note: '宿主 loader（缺它 ⇒ 插了 patch 也不激活）' },
  Config: { via: 'host-loader', note: '宿主 loader（据此注册 settings 命名空间）' },
  createScreenModel: { via: 'entry-import', files: ['tests/unit/screen-model.test.ts'] },
  createSessionManager: {
    via: 'entry-import',
    files: ['tests/unit/session-manager.test.ts', 'tests/unit/session-resize-kill.test.ts', 'tests/unit/session-utf8.test.ts'],
  },
  createTermBuffer: { via: 'entry-import', files: ['tests/unit/screen-buffer.test.ts', 'tests/unit/screen-model.test.ts'] },
  DEFAULT_COLS: { via: 'entry-import', files: ['tests/unit/session-manager.test.ts'] },
  DEFAULT_ROWS: { via: 'entry-import', files: ['tests/unit/session-manager.test.ts'] },
  DEFAULT_TERMINAL_TYPE: { via: 'entry-import', files: ['tests/unit/session-manager.test.ts'] },
  parseProfiles: { via: 'entry-import', files: ['tests/unit/session-manager.test.ts'] },
  TERM_BUFFER_MAX_BLOCKS: { via: 'entry-import', files: ['tests/unit/screen-buffer.test.ts'] },
  TERM_BUFFER_MAX_BYTES: { via: 'entry-import', files: ['tests/unit/screen-buffer.test.ts'] },
  TERM_MAX_COLS: { via: 'entry-import', files: ['tests/unit/session-resize-kill.test.ts'] },
  TERM_MAX_ROWS: { via: 'entry-import', files: ['tests/unit/session-manager.test.ts', 'tests/unit/session-resize-kill.test.ts'] },
  TERM_MIN_COLS: { via: 'entry-import', files: ['tests/unit/session-manager.test.ts', 'tests/unit/session-resize-kill.test.ts'] },
  TERM_MIN_ROWS: { via: 'entry-import', files: ['tests/unit/session-manager.test.ts', 'tests/unit/session-resize-kill.test.ts'] },
  TERM_SNAPSHOT_SCROLLBACK_LINES: { via: 'entry-import', files: ['tests/unit/screen-model.test.ts'] },
  TERM_SNAPSHOT_SCROLLBACK_MAX: { via: 'entry-import', files: ['tests/unit/screen-model.test.ts'] },
  buildSpawnSpec: { via: 'none', note: 'barrel 出口无入口级消费方（实现被包内按模块直接 import）' },
  clampInt: { via: 'none', note: '同上' },
  clampSize: { via: 'none', note: '同上' },
  createProfilesSchema: { via: 'none', note: '同上' },
  deriveConfigState: { via: 'none', note: '同上' },
  deriveCwdLinux: { via: 'none', note: '同上' },
  isStartable: { via: 'none', note: '同上' },
  isWslProfile: { via: 'none', note: '同上' },
  PROFILE_FIELD_KEYS: { via: 'none', note: '同上' },
  resolveCwd: { via: 'none', note: '同上' },
  ROOT_INDEX: { via: 'none', note: '同上' },
  TERM_SCREEN_SCROLLBACK_LINES: { via: 'none', note: '同上' },
};

let checks = 0;
const failures = [];
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

/**
 * 机械扫描：真找「经包入口 import 到本包导出」的文件。
 * 入口 = `exports` 的两个声明入口源文件；说明符支持裸包名（`dsh-terminal-profiles` /
 * `.../client`）与相对路径（`../../src/index.ts`，按 posix 归一后比对）。
 */
function scanEntryImports(entryRels) {
  const found = new Map();
  const skip = new Set(['node_modules', 'lib', 'dist', '.git']);
  const walk = (dir, out) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.startsWith('.tmp-')) continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child, out);
      else if (/\.(?:ts|tsx|mjs|js)$/.test(entry.name)) out.push(child);
    }
    return out;
  };
  for (const file of walk(REPO_ROOT, [])) {
    const rel = file.slice(REPO_ROOT.length).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const spec = match[2];
      const target = spec === PKG_NAME
        ? `${PACKAGE.dir}/src/index.ts`
        : spec === `${PKG_NAME}/client`
          ? `${PACKAGE.dir}/src/client/index.ts`
          : spec.startsWith('.')
            ? posix.normalize(posix.join(posix.dirname(rel), spec))
            : null;
      if (target === null || !entryRels.includes(target)) continue;
      for (const raw of match[1].split(',')) {
        const name = raw.trim().replace(/^type\s+/, '');
        if (!found.has(name)) found.set(name, new Set());
        found.get(name).add(rel);
      }
    }
  }
  return found;
}

console.log(`=== ${PKG_NAME}：公开面预算（SSoT = packages/wsl-shared/scripts/export-budgets.mjs） ===`);
const face = collectPublicFace(PKG_DIR);
const judged = judgeSurface(face, budget);
const entryRels = face.files.map((rel) => `${PACKAGE.dir}/${rel}`);
const scanned = scanEntryImports(entryRels);

record(
  '预算已登记且性质标记为 debt（存量欠账，不是认可值）',
  budget !== undefined && budget.nature === 'debt',
  budget === undefined ? '未登记' : `上限 ${String(budget.runtime)}/${String(budget.types)}、nature=${String(budget.nature)}、留痕 ${String(budget.trace)}`,
  budget === undefined ? 0 : 1,
);
const starFiles = face.files.filter((rel) => RE_EXPORT_STAR.test(readFileSync(`${PKG_DIR}/${rel}`, 'utf8')));
record('没有 `export * from`（显式列举才可静态核对预算）', starFiles.length === 0, starFiles.join('、') || '全部为显式列举', face.files.length);
record(
  `运行时 ${String(judged.runtime.length)}/${String(budget.runtime)}（贴住上限 ⇒ 多一个就红）`,
  judged.reasons.filter((reason) => reason.includes('运行时')).length === 0,
  judged.reasons.join('；') || '在预算内',
  judged.runtime.length,
);
record(
  `类型 ${String(judged.types.length)}/${String(budget.types)}（软指标：记录在案的上限）`,
  judged.types.length <= budget.types,
  judged.warnings.join('；') || '在记录上限内',
  judged.types.length,
);
record(
  `覆盖面：${String(face.entries.length)} 个声明入口（递归）全部被扫到`,
  judged.ok,
  judged.reasons.join('；') || `扫描面 ${face.files.join('、')}`,
  face.entries.length,
);

console.log(`  · 声明入口：${face.entries.map((entry) => `${(entry.subpaths ?? [entry.subpath]).join('/')} → ${entry.rel}`).join('；')}`);
console.log(`  · 每入口读数：${face.perEntry.map((row) => `${(row.subpaths ?? [row.subpath]).join('/')} = ${String(row.runtime.length)}r/${String(row.types.length)}t`).join('；')}`);
console.log(`  · 运行时名单（${String(judged.runtime.length)}）：${judged.runtime.join(', ')}`);
console.log(`  · 类型名单（${String(judged.types.length)}）：${judged.types.join(', ')}`);

console.log('\n=== 逐条消费方登记表 ↔ 机械复核 ===');
const registryNames = Object.keys(CONSUMERS).sort();
const measuredNames = judged.runtime.slice().sort();
record(
  '登记表与实测名字一一对应（不多不少）',
  registryNames.join(',') === measuredNames.join(','),
  `实测 ${String(measuredNames.length)} / 登记 ${String(registryNames.length)}`,
  registryNames.length,
);
for (const name of measuredNames) {
  const item = CONSUMERS[name];
  if (item === undefined) {
    record(`${name}：有登记`, false, '未登记（新增导出必须显式登记消费方）', 1);
    continue;
  }
  if (item.via === 'entry-import') {
    const actual = [...(scanned.get(name) ?? [])].filter((file) => file !== `${PACKAGE.dir}/src/index.ts`).sort();
    const declared = item.files.map((file) => `${PACKAGE.dir}/${file}`).sort();
    const same = actual.length > 0 && actual.join(',') === declared.join(',');
    record(`${name}：入口级消费方与登记一致`, same, `实测 ${actual.join('、') || '（0 条）'} / 登记 ${declared.join('、')}`, actual.length);
  } else if (item.via === 'host-loader') {
    const patch = existsSync(join(PKG_DIR, 'cordis.patch.yml'));
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
    const built = typeof pkg.exports?.['.'] === 'string' && pkg.exports['.'].startsWith('./lib/');
    record(`${name}：宿主契约（patch 在场 + 入口指向构建产物）`, HOST_CONTRACT.includes(name) && patch && built, `cordis.patch.yml=${String(patch)}、exports["."]=${String(pkg.exports?.['.'])}`, 1);
  } else {
    const actual = [...(scanned.get(name) ?? [])].filter((file) => file !== `${PACKAGE.dir}/src/index.ts`);
    record(`${name}：登记为「入口级消费方 0 条」且实测确实 0 条`, actual.length === 0, actual.join('、') || '（0 条，与登记一致）', 1);
  }
}
const debts = measuredNames.filter((name) => CONSUMERS[name]?.via === 'none');
console.log(`  ⚠️ **存量欠账**：${String(judged.runtime.length)} 个运行时导出里有 **${String(debts.length)} 个**「barrel 出口无入口级消费方」⇒ 欠账候选；`);
console.log(`     候选名单：${debts.join(', ')}`);
console.log('     收敛方向：① 先摘这些**出口**（实现若仍被包内按模块 import，则「摘出口」≠「删实现」）→ ② 再谈阈值/拆分（要主人拍板 + 改 SSoT 两边 + 留痕）；');
console.log('     🔴 禁止为了过门而删有消费者的导出。');

console.log('\n=== 变异哨兵（本包贴住上限，载荷最纯） ===');
const additive = sentinelNewExport(PKG_DIR, budget, { count: 1 });
console.log(`  ⚑ ① ${additive.label} ⇒ ${additive.red ? '判红 ✓' : '未红 ✗'}（${additive.detail}）`);
if (additive.red) console.log(`     门会报：${additive.reasons.join('；')}`);
record('⚑ ① 新增 1 个运行时导出 ⇒ 判红', additive.red, additive.detail, additive.payload.length);
const legacy = sentinelEntryOnly(PKG_DIR, budget);
console.log(`  ⚑ ③ ${legacy.label} ⇒ ${legacy.red ? '判红 ✓' : '未红 ✗'}（${legacy.detail}）`);
if (legacy.red) console.log(`     门会报：${legacy.reasons.join('；')}`);
record('⚑ ③ 退回旧口径（非递归）⇒ 判红', legacy.red, legacy.detail, face.entries.length);

console.log(`\n=== 结果：${String(checks)} 项判定，失败 ${String(failures.length)} 项 ===`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
console.log('  注：本门绿 ≠ 本包公开面达标 —— 31/45 是**存量欠账**上限（见 REQ-6.4 的订正痕与 changelog #51）。');
process.exitCode = failures.length === 0 ? 0 : 1;
