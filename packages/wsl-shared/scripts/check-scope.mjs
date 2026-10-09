/**
 * 准入标准回归自检（001 T6.2，2026-10-09）
 *
 * ## 这道门在防什么
 *
 * REQ-6.1：只有 **≥2 个消费者**的能力才进本包；单消费者能力（`netsh portproxy` 解析、UAC 提权、
 * `docker ps` 解析）SHALL 留在 003/005。判据不是「注释里别提到」—— 注释里提到恰恰是**好事**
 * （说明边界被写下来了）。判据是：**剥掉注释后的代码里，不得出现这些领域逻辑**。
 *
 * ## 判据修订史（两道坏门，都留在此处免得再犯）
 *
 * 1. 初版判据：「`netsh|portproxy|docker|RunAs` 命中只允许出现在 `exec.ts` 注释里」
 *    ⇒ 2026-10-08 预检出 **7 处命中全在注释**（`index.ts` 的 `dsh-wsl-docker-ports` 是**包名**、
 *    `net.ts` / `wsl-config` 的 `portproxy` / `dockerd` / `docker ps` 是**领域词汇**），
 *    按字面判据**无论如何都过不去**。
 * 2. 二版判据（写在 `tasks.md`）：「剥注释后 `netsh|portproxy|docker|RunAs|taskkill /PID` 命中 0」
 *    ⇒ **仍然过不去**：`exec.ts:113` 有**真的** `treeKill('taskkill', ['/PID', …])` ——
 *    那是 REQ-5.3 的**进程树兜底杀**，属本包自己的职责，不是 005 的提权逻辑。
 *    把 `taskkill` 一律禁掉等于要求本包放弃「超时必杀干净」这条硬口径。
 *
 * **定稿判据**：逐词条扫描 + **文件级白名单**。`taskkill` 允许且**仅**允许出现在 `exec.ts`
 * （注入点 `treeKill` 的默认实现）；其余词条在任何源文件里都不得出现在代码中。
 *
 * ## 判据之外还没忘的（防呆四道）
 *
 * 判据一旦写出，最危险的失败模式是**门瞎了还报绿**（正则写错、剥注释失效、文件没扫到）。
 * 故四道防呆全部会 `exit 1`：① 正控样本必须被命中 ② 注释里的词必须**不**被命中
 * ③ `keepLines` 必须保行号（否则报出的行号是错的）④ 源文件列表不得为空。
 *
 * 另有 REQ-6.2 / NFR-1 的三条**包形态**断言（非插件包 + 零运行时依赖），见文件末。
 *
 * 用途：`pnpm -C packages/wsl-shared check:scope`（根 `pnpm check:scope` 会递归）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './strip-comments.mjs';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(pkgDir, 'src');

const fail = (message) => {
  console.error(`✗ check-scope: ${message}`);
  process.exit(1);
};

/**
 * 越界词表。`allow` 是**文件级**白名单（只写文件名），空数组 = 任何文件都不许有。
 */
const RULES = [
  {
    label: 'netsh / portproxy 解析',
    owner: '003（只读事实层）',
    pattern: /\bnetsh\b|\bportproxy\b/i,
    allow: [],
  },
  {
    label: 'docker 解析',
    owner: '003（只读事实层）',
    pattern: /\bdocker\b/i,
    allow: [],
  },
  {
    label: 'UAC 提权辅助',
    owner: '005（提权写路径）',
    pattern: /\bRunAs\b|\bgsudo\b|Start-Process/i,
    allow: [],
  },
  {
    label: '进程树兜底杀（taskkill）',
    owner: '001 自己的 REQ-5.3（**唯一允许的例外**）',
    pattern: /\btaskkill\b/i,
    allow: ['exec.ts'],
  },
];

/** 扫一段源码，返回命中（行号取自 `keepLines` 的保行号模式） */
function scan(source) {
  const hits = [];
  const lines = stripComments(source, { keepLines: true }).split('\n');
  for (const [index, line] of lines.entries()) {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        hits.push({ line: index + 1, rule, text: line.trim() });
      }
    }
  }
  return hits;
}

// ── 防呆①：正控 —— 词表必须还能咬住真实代码 ────────────────────────────────
const canary = 'const child = spawn("netsh", ["interface", "portproxy", "show", "v4tov4"]);';
if (scan(canary).length === 0) {
  fail('正则失效：正控样本（含 netsh/portproxy 的代码行）未被命中 —— 这道门现在是瞎的');
}

// ── 防呆②：反控 —— 注释里的词不得被当成违例 ───────────────────────────────
const commented = [
  '/* 003 的 netsh portproxy 解析、docker ps 解析、RunAs 提权、taskkill /PID 全在别处 */',
  '// net.ts 的注释里就有 portproxy 与 dockerd，这是允许的',
  'const ok = 1;',
].join('\n');
if (scan(commented).length !== 0) {
  fail(`剥注释失效：注释里的领域词被当成代码命中 → ${JSON.stringify(scan(commented))}`);
}

// ── 防呆③：keepLines 必须保行号（否则下面报的行号是假的）──────────────────
if (stripComments(commented, { keepLines: true }).split('\n').length !== commented.split('\n').length) {
  fail('stripComments(keepLines) 未保留行数 —— 报出的行号会与源文件对不上');
}

// ── 防呆④：必须真的扫到源文件 ─────────────────────────────────────────────
const files = readdirSync(srcDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();
if (files.length === 0) fail(`src/ 下没有扫到任何 .ts（路径：${srcDir}）`);

const violations = [];
for (const name of files) {
  const source = readFileSync(join(srcDir, name), 'utf8');
  for (const hit of scan(source)) {
    const allowed = hit.rule.allow.includes(name);
    if (!allowed) violations.push({ file: name, ...hit });
  }
}

console.log(`✓ check-scope: 扫描 src/ 下 ${files.length} 个源文件（剥注释后）`);
for (const rule of RULES) {
  const scope = rule.allow.length === 0 ? '任何文件都不得出现' : `仅允许 ${rule.allow.join(' / ')}`;
  console.log(`  · ${rule.label}（应留 ${rule.owner}）：${scope}`);
}

if (violations.length > 0) {
  console.error(`✗ check-scope: 越界命中 ${violations.length} 处（REQ-6.1）`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule.label}]  ${v.text}`);
  }
  process.exit(1);
}
console.log('  越界命中 0 处 ✓');

// ── REQ-6.2：非插件包形态（不得注册任何宿主能力）─────────────────────────
if (existsSync(join(pkgDir, 'cordis.patch.yml'))) {
  fail('本包是**非插件包**（REQ-6.2），不得带 cordis.patch.yml');
}
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
if (pkg.dsh !== undefined) {
  fail('本包不得有 `dsh` 字段（那是插件包的清单约定，REQ-6.2）');
}
console.log('✓ check-scope: 非插件包形态 ✓（无 cordis.patch.yml、package.json 无 dsh 字段）');

// ── NFR-1：零运行时依赖（离线可用）───────────────────────────────────────
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
if (runtimeDeps.length > 0) {
  fail(`NFR-1 零运行时依赖：dependencies 非空 → ${runtimeDeps.join(', ')}`);
}
console.log('✓ check-scope: 零运行时依赖 ✓（dependencies 为空）');
