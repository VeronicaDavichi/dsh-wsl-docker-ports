/**
 * 公开面扫描 / 解析的**唯一实现**（001 REQ-6.4 口径；2026-10-12 口径变更：逐包预算 + 递归扫描）
 *
 * ## 为什么有这个文件
 *
 * REQ-6.4 的判定手法（正则而非 AST）原本在 `wsl-shared/scripts/check-exports.mjs` 里，
 * 又逐字复制到 `wsl-docker-ports/scripts/check-exports.mjs`（「本包副本」）。本次口径变更要
 * **扩到三个包**，若再复制两份，就有三份解析实现 ⇒ 漂移的症状是「一道门悄悄失去判据」。
 * 故把解析与「公开面」推导抽到这里，三个门**共用这一份**（AGENTS.md：「不许各自解释口径」）。
 *
 * ## 「公开面」的定义（递归语义，逐条可核对）
 *
 * **公开面文件集**（`files`）由两步得到，两步都必须成立：
 * 1. **声明入口**：`package.json` 的 `exports` 里每个**映射到本包 `src/` 的字符串出口**
 *    （`{".": "./lib/index.js"}`、`{"./client": {"default": "./lib/client.js", "types": "./lib/types/client/index.d.ts"}}`
 *    ⇒ `src/index.ts` / `src/client/index.ts`；`wsl-shared` 直接写 `./src/index.ts`）。
 *    这是**包外唯一可达的入口**——`exports` 没有 `"./*"` 通配 ⇒ 深路径导入一律不可达。
 * 2. **re-export 递归**：从声明入口出发，沿**相对 re-export 边**（`export … from './x'`）
 *    递归；只有当目标是 **`index.ts`（barrel）** 时才纳入 `files` 并继续递归。
 *
 * **不算公开面的**（这是「别把内部模块算进去」的判据）：
 * - **非 `index.ts` 的模块**（`plugin.ts` / `limits.ts` / `tools/keys.ts` …）——它们只是名字的
 *   **来源**（`modulesOf`，用于追溯），本身不是出口；
 * - **不可达的内部 barrel**——例如 `terminal-profiles/src/tools/index.ts`、
 *   `wsl-docker-ports/src/{write,elevate}/index.ts`：它们不在任何声明入口的 re-export 闭包里，
 *   包外**拿不到**（004 T1.1 原文亦称其为「`src/tools/**` 的对外面」，但那个「对外」指包内调用方）。
 *
 * ⚠️ **实测（2026-10-12）**：本仓当前**没有** barrel → barrel 的 re-export（所有 re-export 目标都
 * 不是 `index.ts`）⇒ 递归第 2 步的**实际增量 = 0 个文件**；真实增量来自第 1 步（把「只有根入口」
 * 扩成「`exports` 里全部声明入口」，两个插件包各多一个 `./client` 入口）。这条不留成口头结论：
 * `check-exports.mjs` 的**哨兵③**用「只扫第一个声明入口」的旧口径载荷当场判红。
 *
 * ## 计数口径（与旧脚本逐字一致，不新增解释）
 *
 * 名字 = `files` 里各文件**显式列举**的具名导出（`export {…} from` / `export const|function|class|enum`
 * / `export interface|type` / `export type {…} from`），**按名字去重求并集**，运行时与类型分开：
 * - `export type …` / `interface` / `type` ⇒ **类型**（运行时被擦除，不计入运行时预算）；
 * - 名字同时出现在两侧时**以类型为准**（旧口径的 `runtime.delete(name)`，逐字保留）；
 * - `export * from` ⇒ **直接判失败**（无法静态枚举，预算会被绕过）。
 *
 * 首见归属（`from`）用于报告与消费方追溯：按「声明入口顺序 → 递归发现顺序 → 文件内出现顺序」
 * 取第一个定义处，**不参与任何判定**。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** `export * from` ⇒ 不可静态核对预算（旧口径的同一道防呆，逐字保留） */
export const RE_EXPORT_STAR = /^export\s+(?:type\s+)?\*\s+from/m;

const RE_NAMED_BLOCK = /export\s+(type\s+)?\{([^}]*)\}/g;
const RE_RUNTIME_DECL = /export\s+(?:async\s+)?(?:const|function|class|enum)\s+([A-Za-z0-9_$]+)/g;
const RE_TYPE_DECL = /export\s+(?:interface|type)\s+([A-Za-z0-9_$]+)/g;
const RE_REEXPORT = /export\s+(?:type\s+)?\{[^}]*\}\s*from\s*['"]([^'"]+)['"]/g;

/** 与三份门逐字同口径的解析（**唯一实现**） */
export function parseExports(source) {
  const runtime = new Set();
  const types = new Set();
  const stripType = (name) => name.trim().replace(/^type\s+/, '');
  for (const match of source.matchAll(RE_NAMED_BLOCK)) {
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
  for (const match of source.matchAll(RE_RUNTIME_DECL)) {
    if (match[1] !== undefined) runtime.add(match[1]);
  }
  for (const match of source.matchAll(RE_TYPE_DECL)) {
    if (match[1] !== undefined) types.add(match[1]);
  }
  for (const name of types) runtime.delete(name);
  return { runtime, types };
}

/** re-export 边的相对目标（非相对说明符 = 包外依赖，不参与公开面） */
export function reexportTargets(source) {
  const targets = [];
  for (const match of source.matchAll(RE_REEXPORT)) {
    const specifier = match[1];
    if (specifier === undefined || !specifier.startsWith('.')) continue;
    targets.push(specifier);
  }
  return targets;
}

/**
 * `exports` 出口字符串 → 本包源文件的**候选**路径（相对包根的 posix 路径，按优先序）。
 * 形态：`./src/index.ts`（源码入口）· `./lib/index.js` / `./lib/client.js`（构建产物入口）
 * · `./lib/types/client/index.d.ts`（类型入口，与 `default` 同源 ⇒ 去重）。
 *
 * ⚠️ **两个插件包的 `./client` 出口是目录入口**：`{"./client": {"default": "./lib/client.js"}}`
 * 的实际源文件是 `src/client/index.ts`（双证：`scripts/build-client.mjs` 的 esbuild entryPoint、
 * `tsconfig.client.json` 的 `outDir: lib/types` + `rootDir: src`）⇒ `lib/x.js` 必须**先试
 * `src/x.ts`、再试 `src/x/index.ts`**，取**存在**的那个（不做目录猜测之外的推断）。
 */
export function sourceCandidatesFromExportValue(value) {
  if (typeof value !== 'string') return [];
  const raw = value.trim();
  if (!raw.startsWith('./')) return [];
  let rel = raw.slice(2);
  if (rel === 'package.json') return [];
  if (!/\.(?:js|mjs|cjs|ts)$/.test(rel)) return [];
  rel = rel.replace(/\.d\.ts$/, '.ts').replace(/\.(?:js|mjs|cjs)$/, '.ts');
  if (rel.startsWith('lib/types/')) rel = `src/${rel.slice('lib/types/'.length)}`;
  else if (rel.startsWith('lib/')) rel = `src/${rel.slice('lib/'.length)}`;
  const primary = rel.split(sep).join('/');
  const candidates = [primary];
  if (!primary.endsWith('/index.ts')) candidates.push(primary.replace(/\.ts$/, '/index.ts'));
  return candidates;
}

/** 从 `package.json#exports` 收集**声明入口**（每个出口去重；同源出口合并 `subpaths`） */
export function resolveEntrySources(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const exportsField = pkg.exports ?? {};
  const entries = [];
  const byFile = new Map();
  const record = (subpath, value) => {
    const candidates = sourceCandidatesFromExportValue(value);
    if (candidates.length === 0) return;
    const rel = candidates.find((candidate) => existsSync(join(pkgDir, candidate))) ?? candidates[0];
    const existing = byFile.get(rel);
    if (existing === undefined) {
      const entry = {
        subpath,
        subpaths: [subpath],
        rel,
        file: join(pkgDir, rel),
        exists: existsSync(join(pkgDir, rel)),
      };
      byFile.set(rel, entry);
      entries.push(entry);
    } else if (!existing.subpaths.includes(subpath)) {
      existing.subpaths.push(subpath);
    }
  };
  for (const [subpath, value] of Object.entries(exportsField)) {
    if (typeof value === 'string') record(subpath, value);
    else if (value !== null && typeof value === 'object') {
      for (const nested of Object.values(value)) record(subpath, nested);
    }
  }
  return { pkgName: pkg.name, entries };
}

/**
 * 递归推导公开面。
 *
 * `mutation` 参数**只给变异哨兵用**（`'entry-only'` = 旧口径：只扫第一个声明入口）；
 * 常规调用**不传**，且门会断言常规路径的 `files` 覆盖全部声明入口。
 */
export function collectPublicFace(pkgDir, options = {}) {
  const { entries } = resolveEntrySources(pkgDir);
  // ⚠️ 变异哨兵只缩小**扫描根**，绝不动 `entries`（声明入口集）⇒ 覆盖面判据仍按全量声明入口核对，
  //    于是「回退到非递归（只扫首入口）」当场红。常规路径 `mutation` 为空 ⇒ 扫描根 = 全部声明入口。
  const scanRoots = options.mutation === 'entry-only' ? entries.slice(0, 1).map((entry) => entry.rel) : entries.map((entry) => entry.rel);
  const files = [];
  const modules = [];
  const seen = new Set();
  const queue = [...scanRoots];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (rel === undefined || seen.has(rel)) continue;
    seen.add(rel);
    const file = join(pkgDir, rel);
    if (!existsSync(file)) continue;
    const source = readFileSync(file, 'utf8');
    files.push(rel);
    for (const specifier of reexportTargets(source)) {
      const target = relative(pkgDir, join(dirname(file), specifier)).split(sep).join('/');
      if (!existsSync(join(pkgDir, target))) continue;
      if (target.endsWith('index.ts')) queue.push(target);
      else if (!modules.includes(target)) modules.push(target);
    }
  }

  const runtime = new Map();
  const types = new Map();
  const perFile = [];
  for (const rel of files) {
    const source = readFileSync(join(pkgDir, rel), 'utf8');
    const parsed = parseExports(source);
    perFile.push({ rel, runtime: [...parsed.runtime].sort(), types: [...parsed.types].sort() });
    for (const name of parsed.runtime) if (!runtime.has(name)) runtime.set(name, rel);
    for (const name of parsed.types) if (!types.has(name)) types.set(name, rel);
  }
  const perEntry = entries.map((entry) => {
    const row = perFile.find((item) => item.rel === entry.rel);
    return {
      subpath: entry.subpath,
      subpaths: entry.subpaths ?? [entry.subpath],
      rel: entry.rel,
      exists: entry.exists,
      scanned: row !== undefined,
      runtime: row?.runtime ?? [],
      types: row?.types ?? [],
    };
  });
  return {
    pkgName: (() => {
      try {
        return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).name;
      } catch {
        return '<unknown>';
      }
    })(),
    pkgDir,
    mutation: options.mutation ?? 'recursive',
    entries,
    scanRoots,
    declaredCount: entries.length,
    files,
    modules,
    perFile,
    perEntry,
    runtime: [...runtime].map(([name, from]) => ({ name, from })).sort((a, b) => a.name.localeCompare(b.name)),
    types: [...types].map(([name, from]) => ({ name, from })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * 判定：上限（棘轮）+ 覆盖面。**同一个函数**既判真实读数、也判变异载荷 ⇒ 哨兵才有意义。
 *
 * 绑定力沿用 REQ-6.4 原文与 AGENTS.md：**运行时超限 = 红（SHALL）**；
 * **类型超限 = 告警（`warnings`，软指标口径未变）** —— 但表里登记的 types 数同样是**棘轮上限**
 * （改它必须「机器表 + REQ-6.4 文档表」两边同改并留痕，见 `export-budgets.mjs`）。
 * 返回 `{ ok, reasons, warnings, runtime: string[], types: string[] }`。
 */
export function judgeSurface(face, budget) {
  const runtime = face.runtime.map((item) => item.name);
  const types = face.types.map((item) => item.name);
  const reasons = [];
  const warnings = [];
  if (!Number.isInteger(budget?.runtime) || !Number.isInteger(budget?.types)) {
    reasons.push('预算缺失或非整数（SSoT 未登记 ⇒ 不许放行）');
  } else {
    if (runtime.length > budget.runtime) {
      reasons.push(`运行时导出 ${runtime.length} 个 > 上限 ${budget.runtime}（超 ${runtime.length - budget.runtime} 个）`);
    }
    if (types.length > budget.types) {
      warnings.push(`类型导出 ${types.length} 个 > 记录上限 ${budget.types}（软指标，只告警；但上限数受棘轮约束）`);
    }
  }
  if (face.files.length === 0) reasons.push('公开面文件集为空 ⇒ 判据恒真（防呆）');
  const scanned = new Set(face.files);
  const label = (entry) => `${(entry.subpaths ?? [entry.subpath]).join(' / ')} → ${entry.rel}`;
  for (const entry of face.entries) {
    if (!entry.exists) reasons.push(`声明入口指向的源文件不存在：${label(entry)}`);
    if (!scanned.has(entry.rel)) reasons.push(`声明入口未扫到：${label(entry)}（扫描面回退）`);
  }
  for (const row of face.perEntry) {
    if (!row.scanned) continue; // 已在上面按「未扫到」登记，避免同因两报
    if (row.runtime.length + row.types.length === 0) {
      reasons.push(`声明入口解析出 0 个导出：${(row.subpaths ?? [row.subpath]).join(' / ')} → ${row.rel}（正则失效必须响）`);
    }
  }
  return { ok: reasons.length === 0, reasons, warnings, runtime, types };
}

/**
 * **变异哨兵①：新增运行时导出**。载荷 = 把**真实的**入口字节 + N 行 `export const MUTANT_… = n;`
 * 重新喂给**同一个** `parseExports` ⇒ 判定必须红。
 *
 * `count` 省略时取 `上限 − 实测 + 1`（**刚好越线 1 个**）——因为预算有余量时「加一个」本来就不该红，
 * 那是余量的定义；要紧的是「**越线必红**」。调用方可显式给 `count: 1` 作最纯形态的载荷
 * （只在「实测已经贴住上限」的包上才会红，例如 `terminal-profiles` 的 31/45）。
 */
export function sentinelNewExport(pkgDir, budget, options = {}) {
  const face = collectPublicFace(pkgDir);
  const entry = face.entries[0];
  const count = options.count ?? budget.runtime - face.runtime.length + 1;
  const payload = Array.from({ length: Math.max(count, 1) }, (_, index) => `export const MUTANT_ADDED_EXPORT_${String(index + 1)} = ${String(index + 1)};`).join('\n');
  const source = `${readFileSync(entry.file, 'utf8')}\n${payload}\n`;
  const parsed = parseExports(source);
  const runtime = new Map(face.runtime.map((item) => [item.name, item.from]));
  const added = [];
  for (const name of parsed.runtime) {
    if (!runtime.has(name)) {
      runtime.set(name, entry.rel);
      added.push(name);
    }
  }
  const mutant = { ...face, runtime: [...runtime].map(([name, from]) => ({ name, from })).sort((a, b) => a.name.localeCompare(b.name)) };
  const judged = judgeSurface(mutant, budget);
  return {
    id: '①',
    label: `新增运行时导出（${entry.rel} +${String(added.length)} 行载荷 ⇒ ${String(mutant.runtime.length)} 个）`,
    red: judged.ok === false,
    reasons: judged.reasons,
    detail: `${String(mutant.runtime.length)} 个 / 上限 ${String(budget.runtime)}`,
    payload: added,
  };
}

/**
 * **变异哨兵③：把扫描口径退回旧行为（非递归）**。载荷 = 只扫**第一个**声明入口
 * ⇒ 覆盖面判据必须红（声明入口未被扫到）。单入口包（`wsl-shared`）此哨兵**天然不适用**
 * —— 旧口径与新口径等价，故返回 `applicable: false`（不许假装它红了）。
 */
export function sentinelEntryOnly(pkgDir, budget) {
  const face = collectPublicFace(pkgDir, { mutation: 'entry-only' });
  const judged = judgeSurface(face, budget);
  return {
    id: '③',
    applicable: face.declaredCount > 1,
    label: `旧口径（只扫首入口 ${face.files.join(', ')}）`,
    red: judged.ok === false,
    reasons: judged.reasons,
    detail: `扫描面 ${face.files.length}/${String(face.declaredCount)} 个声明入口`,
  };
}
