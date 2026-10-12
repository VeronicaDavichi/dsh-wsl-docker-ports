/**
 * 公开面预算自检（003 T6.7⑤「公开面收敛」的回归门）
 *
 * ## 口径（001 REQ-6.4 的 SSoT，本脚本不另立解释）
 *
 * **运行时导出 ≤ 12**（`RUNTIME_BUDGET`，SHALL）。类型导出（`export type …` / `interface` / `type`）
 * 编译后被完全擦除 ⇒ **不计入**运行时预算；类型总量另设**软阈值 25**（`TOTAL_SOFT_MAX`，只告警不失败）。
 * 判定手法（正则而非 AST）与 `packages/wsl-shared/scripts/check-exports.mjs` **逐条同口径**：本脚本是
 * 该门的**本包副本**，**没有**改共享门、**没有**把门扩到别的包（后者属 001 的口径变更，待主人拍板；
 * 见 `specs/003-wsl-docker-ports/tasks.md` 的 T6.7⑤ 建议登记行）。
 *
 * ## 三重防假绿
 *
 * ① **变异哨兵**：用**收敛前**的 33 个名字（逐字取自 git blob `f0585d02…`）
 *    当场喂给**同一个判定函数**，断言它**失败**；同时断言同一函数对 12 个名字**通过**
 *    ⇒ 证明这条门不是「恒真」也不是「恒假」。
 * ② **只做减法**：断言现清单 ⊆ 旧清单、且差额恰好 27；再断言 27 个已摘名字**真的不在**模块导出里
 *    ⇒ 悄悄把导出加回来会当场红。
 * ③ **宿主契约冒烟**：真 `await import('../src/index.ts')`，断言 (a) 类四个名字仍在、形态未变、
 *    默认对象键集恰好 `{Config, apply, inject, name}` 且与具名导出**同一份引用**。
 *    只跑 `tsc` 证明不了这些（类型检查看不见运行时的键集）。
 *
 * 每条断言都打印「扫到几项」；**扫描项为 0 一律判失败**（空扫描不算证据）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 001 REQ-6.4：运行时导出 ≤ 12（SHALL） */
const RUNTIME_BUDGET = 12;
/** 001 REQ-6.4：类型总量软阈值（只告警，不失败） */
const TOTAL_SOFT_MAX = 25;

const entryPath = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));

/**
 * **收敛前**的运行时导出清单（33 = Phase 0–2 barrel 27 + 入口 6）。
 * 逐字取自 `git show f0585d028d0d59cd4a348caf718f2bae2cd36e87`（commit `0b52dd9`）的 `src/index.ts`，
 * 只用于**变异哨兵**：证明「33 > 12」这条判定真的会红。
 */
const PRE_CONVERGENCE_RUNTIME = [
  'decodeNetshOutput', 'NetshParseError', 'parsePortproxyTable',
  'DockerParseError', 'parseDockerPorts', 'parseDockerPsJsonl',
  'probeFailure', 'redactOutput',
  'DOCKER_PS_ARGV', 'DOCKER_PS_ATTEMPTS', 'DOCKER_PS_TIMEOUT_MS', 'probeDockerPs',
  'NETSH_ARGV', 'NETSH_TIMEOUT_MS', 'probePortproxyRules',
  'parseLocalhostForwardingValue', 'readLocalhostForwarding',
  'createEth0Source',
  'intersectManagedRange', 'isManagedPort', 'singlePort',
  'buildExpectedForwards', 'classifyPorts', 'collectExternalRules', 'diff', 'expectedListenAddress',
  'PORT_STATES',
  'Config', 'apply', 'applyWslDockerPorts', 'inject', 'name', 'PORTS_SERVICE',
];

/**
 * **存留清单 = 逐名字的消费方登记表**。运行时导出必须在这里各有一条**具名消费方**，
 * 否则本门红（「新增导出必须显式登记」——与 `tests/unit/config.test.ts` 对 `config.ts` 的同款防呆）。
 */
const CONSUMERS = {
  name: '宿主加载契约（cordis loader 按名字读，patch 行的 id 必须与它逐字一致）',
  inject: '宿主加载契约（依赖列表；本包为空数组 = 无强依赖）',
  apply: '宿主加载契约（缺它 ⇒ profile 插了 patch 也不激活）',
  Config: '宿主加载契约（缺它 ⇒ 宿主不注册 settings 命名空间；2026-10-12 真机缺陷 1）',
  applyWslDockerPorts: 'scripts/verify-host-entry.mjs（对 lib/index.js 真 import 后调用并断言 gaps）',
  PORTS_SERVICE: '跨插件服务身份（ctx.provide 的服务名；包外经 ctx.inject/服务查找消费）',
};

let checks = 0;
const failures = [];

/** 一条断言：先算出「扫到几项」，扫到 0 项直接失败（恒真断言不许过） */
function record(label, ok, detail, scanned) {
  checks += 1;
  if (scanned === 0) {
    failures.push(`${label}（扫描项 0，为 0 即恒真）`);
    console.log(`  FAIL ${label} — ${detail}（扫描项 0，为 0 即恒真）`);
    return;
  }
  if (!ok) failures.push(`${label} — ${detail}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} — ${detail}（扫描项 ${String(scanned)}）`);
}

/** 与共享门逐条同口径的解析：只认显式列举（`export * from` 直接判失败） */
function parseExports(source) {
  const runtime = new Set();
  const types = new Set();
  const stripType = (name) => name.trim().replace(/^type\s+/, '');
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
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:const|function|class|enum)\s+([A-Za-z0-9_$]+)/g)) {
    if (match[1] !== undefined) runtime.add(match[1]);
  }
  for (const match of source.matchAll(/export\s+(?:interface|type)\s+([A-Za-z0-9_$]+)/g)) {
    if (match[1] !== undefined) types.add(match[1]);
  }
  for (const name of types) runtime.delete(name);
  return { runtime, types };
}

/** 判定函数（**同一个**函数既判现清单，也判变异哨兵 —— 哨兵才有意义） */
function judgeRuntime(names) {
  const list = [...names];
  const over = list.length - RUNTIME_BUDGET;
  return {
    ok: list.length <= RUNTIME_BUDGET,
    detail: `运行时导出 ${String(list.length)} 个 / 预算 ${String(RUNTIME_BUDGET)}${over > 0 ? `（超 ${String(over)} 个）` : '（在预算内）'}`,
    list,
  };
}

const source = readFileSync(entryPath, 'utf8');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

console.log('=== 0. 解析 src/index.ts ===');
record('没有 `export * from`', !/^export\s+(?:type\s+)?\*\s+from/m.test(source), '显式列举才可静态核对预算', 1);

const { runtime, types } = parseExports(source);
record('解析出运行时导出（正则失效必须响）', runtime.size > 0, `运行时 ${String(runtime.size)} 个`, runtime.size);
record('解析出类型导出（同上）', types.size > 0, `类型 ${String(types.size)} 个`, types.size);
record('入口没有 `var`/`let` 形式的漏网导出', !/^export\s+(?:var|let)\s/m.test(source), '只允许 const/function/class/enum 形态', 1);

console.log('\n=== 1. 运行时预算（001 REQ-6.4） ===');
const judged = judgeRuntime(runtime);
record('运行时导出 ≤ 12', judged.ok, judged.detail, judged.list.length);
record('运行时导出全部登记了消费方', judged.list.every((name) => name in CONSUMERS), `未登记：${judged.list.filter((name) => !(name in CONSUMERS)).join(', ') || '（无）'}`, judged.list.length);
record('登记表与实现一一对应（不多不少）', Object.keys(CONSUMERS).sort().join(',') === judged.list.slice().sort().join(','), `实现 ${judged.list.slice().sort().join(',')} / 登记 ${Object.keys(CONSUMERS).sort().join(',')}`, Object.keys(CONSUMERS).length);

const total = runtime.size + types.size;
const softWarn = total > TOTAL_SOFT_MAX ? ` ⚠️ 合计超软阈值 ${String(TOTAL_SOFT_MAX)}（只告警）` : '';
console.log(`  · 运行时 ${String(runtime.size)}/${String(RUNTIME_BUDGET)}，类型 ${String(types.size)}，合计 ${String(total)}${softWarn}`);
console.log(`    运行时：${judged.list.join(', ')}`);
console.log(`    类型：${[...types].join(', ')}`);

console.log('\n=== 2. 变异哨兵（用收敛前的 33 个名字喂**同一个**判定函数） ===');
const mutant = judgeRuntime(PRE_CONVERGENCE_RUNTIME);
record('旧清单本身 = 33 个（未篡改）', PRE_CONVERGENCE_RUNTIME.length === 33, `实际 ${String(PRE_CONVERGENCE_RUNTIME.length)} 个`, PRE_CONVERGENCE_RUNTIME.length);
record('⚑ 旧清单被判**失败**（33 > 12）', mutant.ok === false && mutant.detail.includes('超 21 个'), mutant.detail, mutant.list.length);
record('⚑ 同一函数对 12 个名字判**通过**（证明不是恒假）', judgeRuntime(PRE_CONVERGENCE_RUNTIME.slice(0, 12)).ok === true, judgeRuntime(PRE_CONVERGENCE_RUNTIME.slice(0, 12)).detail, 12);
record('本门若在收敛前跑 ⇒ 真红（哨兵结论逐字复述）', mutant.ok === false, `✗ check-exports: 运行时导出 ${String(mutant.list.length)} 个 > 预算 ${String(RUNTIME_BUDGET)}：${mutant.list.join(', ')}`, mutant.list.length);

console.log('\n=== 3. 收敛只做减法（防止悄悄加回来） ===');
const pre = new Set(PRE_CONVERGENCE_RUNTIME);
const added = judged.list.filter((name) => !pre.has(name));
const removed = PRE_CONVERGENCE_RUNTIME.filter((name) => !runtime.has(name));
record('现清单 ⊆ 旧清单（没有新名字混进来）', added.length === 0, `新名字：${added.join(', ') || '（无）'}`, judged.list.length);
record('差额恰好 27（33 → 6）', removed.length === 27, `已摘 ${String(removed.length)} 个：${removed.join(', ')}`, removed.length);

console.log('\n=== 4. 宿主契约冒烟（真 import 源入口，不看类型） ===');
const mod = await import(pathToFileURL(entryPath).href);
const keys = Object.keys(mod).sort();
console.log(`  · 入口运行时键 ${String(keys.length)} 个：${JSON.stringify(keys)}`);

record('name === 包名（patch 行 id 才能命中）', mod.name === pkg.name, `name=${String(mod.name)} / package=${String(pkg.name)}`, 1);
record('apply 是函数', typeof mod.apply === 'function', `typeof apply = ${typeof mod.apply}`, 1);
record('inject 是空数组（无强依赖，别把可选依赖写进去）', Array.isArray(mod.inject) && mod.inject.length === 0, `inject=${JSON.stringify(mod.inject)}`, Array.isArray(mod.inject) ? mod.inject.length + 1 : 0);
record('Config 在场（宿主据此注册 settings 命名空间）', mod.Config !== undefined && mod.Config !== null, `typeof Config = ${typeof mod.Config}`, 1);
record('applyWslDockerPorts 是函数（产物级门要用）', typeof mod.applyWslDockerPorts === 'function', `typeof = ${typeof mod.applyWslDockerPorts}`, 1);
record('PORTS_SERVICE 是非空字符串', typeof mod.PORTS_SERVICE === 'string' && mod.PORTS_SERVICE.length > 0, `PORTS_SERVICE=${JSON.stringify(mod.PORTS_SERVICE)}`, typeof mod.PORTS_SERVICE === 'string' ? mod.PORTS_SERVICE.length : 0);

const dflt = mod.default;
const defaultKeys = dflt === null || typeof dflt !== 'object' ? [] : Object.keys(dflt).sort();
record('默认对象键集恰好 {Config, apply, inject, name}', defaultKeys.join(',') === 'Config,apply,inject,name', `实际 ${JSON.stringify(defaultKeys)}`, defaultKeys.length);
record('默认对象与具名导出是**同一份引用**', dflt?.apply === mod.apply && dflt?.Config === mod.Config && dflt?.name === mod.name && dflt?.inject === mod.inject, 'apply/Config/name/inject 四项逐一 === ', 4);

console.log('\n=== 5. 已摘导出的「真的不在」核对 ===');
const stillExported = removed.filter((name) => Object.prototype.hasOwnProperty.call(mod, name));
record('27 个已摘名字都不在模块导出里', stillExported.length === 0, `残留：${stillExported.join(', ') || '（无）'}`, removed.length);
record('模块键集 ⊆ 存留清单 ∪ {default}', keys.every((key) => key === 'default' || judged.list.includes(key)), `越界键：${keys.filter((key) => key !== 'default' && !judged.list.includes(key)).join(', ') || '（无）'}`, keys.length);

console.log(`\n=== 结果：${String(checks)} 项断言，失败 ${String(failures.length)} 项 ===`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;
