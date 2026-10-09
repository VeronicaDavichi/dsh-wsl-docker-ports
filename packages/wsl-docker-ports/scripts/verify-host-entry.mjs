/**
 * T6.7 验收：宿主入口是否**真能装载**（不是「跑过 tsc 就算」）
 *
 * 四项，全部先算出数再断言（计数为 0 一律判失败 —— 空的扫描不算证据）：
 * ① 构建产物**真** `import('./lib/index.js')`，打印入口导出名与数量；
 * ② 读 `package.json` 断言 `exports["."] === './lib/index.js'`（**读值**，不 grep 注释）；
 * ③ 清单四件套：`dsh.bundle.patch` / patch 实物 / `exports["./package.json"]` / 入口 = **构建产物**；
 * ④ 与本机 profile 的 `dsh.profile.bundles` **逐项对照**并打印对照表（含官方基线行，作为对照锚点）。
 *
 * 用法：`node scripts/verify-host-entry.mjs`（npm script `check:host`）。任一项失败 ⇒ exit 1。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
let failures = 0;

/** 一条断言：先打印**扫描到的数**，再判真假（`scanned === 0` 的断言直接失败） */
function check(label, ok, detail, scanned) {
  checks += 1;
  if (scanned === 0) {
    failures += 1;
    console.log(`  FAIL ${label} — ${detail}（扫描项 0，为 0 即恒真）`);
    return;
  }
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} — ${detail}（扫描项 ${String(scanned)}）`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 清单四件套的判定（**同一口径**用于本包与 profile 里的既有 bundle） */
function inspectManifest(dir) {
  const pkgFile = path.join(dir, 'package.json');
  if (!existsSync(pkgFile)) return { resolvable: false };
  const pkg = readJson(pkgFile);
  const patchRel = pkg.dsh?.bundle?.patch;
  const entryRel = typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.'] : pkg.exports?.['.']?.default;
  const entryAbs = typeof entryRel === 'string' ? path.join(dir, entryRel) : undefined;
  const patchAbs = typeof patchRel === 'string' ? path.join(dir, patchRel) : undefined;
  return {
    resolvable: true,
    name: pkg.name,
    kind: String(pkg.name ?? '').startsWith('@deepseek-ai/') ? '官方基线' : '第三方',
    patchRel,
    patchExists: patchAbs !== undefined && existsSync(patchAbs) && statSync(patchAbs).size > 0,
    packageJsonExport: pkg.exports?.['./package.json'] === './package.json',
    entryRel,
    entryIsArtifact: typeof entryRel === 'string' && entryRel.startsWith('./lib/'),
    entryExists: entryAbs !== undefined && existsSync(entryAbs) && statSync(entryAbs).size > 0,
    hasApply: entryAbs !== undefined && existsSync(entryAbs) && /(^|\n)\s*(export\s+(async\s+)?function\s+apply|export\s*\{[^}]*\bapply\b)/u.test(readFileSync(entryAbs, 'utf8')),
    clientPlatform: pkg.dsh?.client?.platform,
  };
}

const pkg = readJson(path.join(pkgRoot, 'package.json'));

console.log('① 构建产物真 import（只跑 tsc 会假绿）');
const artifactRel = pkg.exports?.['.'];
const artifactAbs = path.join(pkgRoot, String(artifactRel));
const loadable = existsSync(artifactAbs);
check('入口产物存在', loadable, `${String(artifactRel)} → ${String(statSync(artifactAbs).size)} B`, loadable ? 1 : 0);
if (loadable) {
  const mod = await import(pathToFileURL(artifactAbs).href);
  const names = Object.keys(mod).sort();
  const dflt = mod.default;
  console.log(`  · 入口导出 ${String(names.length)} 个：${JSON.stringify(names)}`);
  check('导出 apply', typeof mod.apply === 'function', `typeof apply = ${typeof mod.apply}`, names.length);
  check('导出 name == 包名', mod.name === pkg.name, `name = ${String(mod.name)} / package = ${String(pkg.name)}`, names.length);
  check('导出 inject 是数组', Array.isArray(mod.inject), `inject = ${JSON.stringify(mod.inject)}`, names.length);
  check(
    '默认对象形态 { name, inject, apply }',
    typeof dflt === 'object' && dflt !== null && typeof dflt.apply === 'function' && dflt.name === pkg.name && Array.isArray(dflt.inject),
    `default = ${JSON.stringify(Object.keys(dflt ?? {}).sort())}`,
    names.length,
  );
  // 不抛：给一个空 ctx（既没有 provide 也没有 effect）也要走完并给出 gaps
  const handle = mod.applyWslDockerPorts({}, undefined, { executor: async () => ({ ok: false, code: 'Unexpected', message: 'stub' }) });
  check(
    '空 ctx 上 apply 不抛且给出 gaps',
    handle.gaps.length > 0 && handle.provided === false,
    `gaps = ${JSON.stringify(handle.gaps.map((gap) => gap.what))} / provided = ${String(handle.provided)}`,
    handle.gaps.length,
  );
}

console.log('② exports["."] 读值');
check('exports["."] === ./lib/index.js', artifactRel === './lib/index.js', `实际 ${JSON.stringify(artifactRel)}`, 1);
check('files 覆盖 lib/**', Array.isArray(pkg.files) && pkg.files.includes('lib/**'), `files = ${JSON.stringify(pkg.files)}`, Array.isArray(pkg.files) ? pkg.files.length : 0);

console.log('③ 清单四件套');
const mine = inspectManifest(pkgRoot);
check('dsh.bundle.patch 字段', typeof mine.patchRel === 'string' && mine.patchRel.length > 0, `patch = ${String(mine.patchRel)}`, 1);
check('patch 实物非空', mine.patchExists === true, `存在且非空 = ${String(mine.patchExists)}`, 1);
check('exports["./package.json"]', mine.packageJsonExport === true, `${String(mine.packageJsonExport)}`, 1);
check('入口 = 构建产物', mine.entryIsArtifact === true && mine.entryExists === true, `entry = ${String(mine.entryRel)}（存在 ${String(mine.entryExists)}）`, 1);
check('dsh.client.platform = web', mine.clientPlatform === 'web', `${String(mine.clientPlatform)}`, 1);
const clientRel = pkg.exports?.['./client'];
const clientAbs = path.join(pkgRoot, typeof clientRel === 'string' ? clientRel : String(clientRel?.default));
check('客户端 bundle 实物非空', existsSync(clientAbs) && statSync(clientAbs).size > 0, `${String(clientRel?.default)} = ${String(existsSync(clientAbs) ? statSync(clientAbs).size : 0)} B`, 1);

console.log('④ 与本机 profile 的既有 bundle 逐项对照');
const profileDir = path.join(homedir(), '.dsh', 'profiles', 'desktop');
const profilePkgFile = path.join(profileDir, 'package.json');
if (!existsSync(profilePkgFile)) {
  check('profile 清单可读', false, `${profilePkgFile} 不存在 ⇒ 对照无法进行`, 0);
} else {
  const bundles = readJson(profilePkgFile).dsh?.profile?.bundles ?? [];
  console.log(`  · profile 声明 ${String(bundles.length)} 个 bundle`);
  const rows = [];
  for (const bundleName of bundles) {
    const dir = path.join(profileDir, 'node_modules', bundleName);
    const info = inspectManifest(dir);
    rows.push({ bundleName, ...info });
  }
  const header = ['bundle', '类型', 'patch 字段', 'patch 实物', './package.json', '入口指产物', '入口存在', '入口有 apply'];
  const lines = rows.map((row) => [
    row.bundleName,
    row.resolvable ? row.kind : '（不可解析）',
    row.resolvable ? String(typeof row.patchRel === 'string') : '-',
    row.resolvable ? String(row.patchExists) : '-',
    row.resolvable ? String(row.packageJsonExport) : '-',
    row.resolvable ? String(row.entryIsArtifact) : '-',
    row.resolvable ? String(row.entryExists) : '-',
    row.resolvable ? String(row.hasApply) : '-',
  ]);
  lines.push(['dsh-wsl-docker-ports（本包）', mine.kind, String(typeof mine.patchRel === 'string'), String(mine.patchExists), String(mine.packageJsonExport), String(mine.entryIsArtifact), String(mine.entryExists), String(mine.hasApply)]);
  const widths = header.map((title, index) => Math.max(title.length, ...lines.map((line) => (line[index] ?? '').length)));
  const render = (cells) => `  | ${cells.map((cell, index) => String(cell ?? '').padEnd(widths[index] ?? 0)).join(' | ')} |`;
  console.log(render(header));
  console.log(`  |${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`);
  for (const line of lines) console.log(render(line));

  const installable = rows.filter((row) => row.resolvable && row.kind === '第三方');
  const strict = installable.filter((row) => row.patchExists && row.packageJsonExport && row.entryIsArtifact && row.entryExists);
  const artifactEntries = installable.filter((row) => row.entryIsArtifact);
  // 对照，不是判别人：本机既有 bundle 里确实有**不满足**这套严格定义的两家
  // （`whale-persona` 是源码 link 包 ⇒ 入口不指产物、也没给 `./package.json` 导出；
  //  `dsh-web-tinyfish` 的入口不在 `lib/` 下）⇒ 它们只是**不同构**，不是错的。
  // 故这里断言的是「本包属于多数派 + 与多数派逐字段一致」，而不是「所有既有包都必须合规」。
  for (const row of installable) {
    const miss = [];
    if (!row.patchExists) miss.push('patch 实物');
    if (!row.packageJsonExport) miss.push('./package.json 导出');
    if (!row.entryIsArtifact) miss.push(`入口指产物（实际 ${String(row.entryRel)}）`);
    if (!row.entryExists) miss.push('入口实物');
    if (miss.length > 0) console.log(`  · 不同构：${row.bundleName} → 缺/异 ${miss.join('、')}`);
  }
  check('本机有可对照的第三方 bundle', installable.length > 0, `${String(installable.length)} 个`, installable.length);
  check(
    '本包与**多数派**同构（严格四件套）',
    strict.length > 0 && strict.length >= Math.ceil(installable.length / 2) && mine.patchExists && mine.packageJsonExport && mine.entryIsArtifact && mine.entryExists,
    `严格齐备 ${String(strict.length)}/${String(installable.length)}；本包 ${String(mine.patchExists)}/${String(mine.packageJsonExport)}/${String(mine.entryIsArtifact)}/${String(mine.entryExists)}`,
    strict.length,
  );
  check(
    '多数派入口都指构建产物（本包同此）',
    artifactEntries.length >= Math.ceil(installable.length / 2) && mine.entryIsArtifact === true,
    `${String(artifactEntries.length)}/${String(installable.length)} 指产物；本包 ${String(mine.entryRel)}`,
    artifactEntries.length,
  );
  check(
    '本包入口**真**导出 apply（比表里的正则更强，表内 apply 列只做存在性扫描）',
    typeof (await import(pathToFileURL(artifactAbs).href)).apply === 'function',
    'import(lib/index.js).apply === function',
    1,
  );
}

console.log(`\n=== 结果：${String(checks)} 项断言，失败 ${String(failures)} 项 ===`);
process.exit(failures === 0 ? 0 : 1);
