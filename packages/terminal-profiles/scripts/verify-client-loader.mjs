/**
 * 客户端产物**装载**自检（002 T4.1 / T4.2 / T4.3 的最重要证据）—— 薄壳：判据 + 打印
 *
 * 脚手架（假 `window.__ModuleLoader__` / 假 `require` / vm 沙箱 / 捕获式 ctx）在
 * `scripts/lib/loader-harness.mjs`；本文件只写**判据**。它验的不是源码而是**构建产物**。
 *
 * ## 判据出处（`client-contract.md`）
 *
 * **清单面** §A1/A2/§P3/§P4：`platform === 'web'`、`inject`/`external` 是数组、
 * `exports["./client"].default` 指向主产物、**chunk 不在 `exports` 里**、主产物名恰为 `client.js`、
 * chunk 名匹配 `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` 且与主产物同目录。
 *
 * **主 bundle** §A3/B5/B7/§P2/§P3：`load` 恰好 1 次、`id` 逐字 = 包名、**不带 `chunk` 字段**、
 * 出参 `{apply,inject,name}` 且**无 `default`**、`inject === ['slots']`、取块实参逐字
 * `"./client.terminal.js"` 且无裸 `require` 版本、含 `react` 的 external require（external 真生效）、
 * require ⊆ 基线 ∪ 清单声明、**不含 xterm 特征**、**不含内联 React**、
 * **体积 ≤ 明确上限**（§P2 直接判据 + 数值上限；2026-10-12 主人裁决的口径变更，见本文件 §P2 块注释）。
 *
 * **行为面（真跑 `apply`）** §C9/C10/§P4：材质化时**零 `require.async`**、**零 DOM 访问**（官方 README：
 * CSS injection 必须在 factory 闭包内）；`apply` 后恰好 1 个页类型 + 2 个右栏 seat + **1 个配置页槽位**
 * （`plugins.row.config`，Phase 6/T6.1）、`kind` 不与官方 9 个重名、`priority` 缺省、
 * `multiple`/`keepMounted` = true、右栏两个 seat 的 key = 包名、注册包在 `slots.inject` 里、
 * **5 次 `ctx.effect`**（样式 + 页类型 + 2 seat + 配置页）、关掉宿主自动表单
 * （`inject([settings])` + `configure({auto:false}, ctx.fiber)`）、卸载后注册与样式归零、
 * 缺 `sidebarRight` ⇒ 右栏降级不注册（配置页**仍**注册）+ console 出原因。
 *
 * **chunk** §P2/§P4：自注册带 `chunk: "client.terminal.js"`、导出 `{TerminalBody, installXtermStyles}`、
 * 内联 xterm 与 `xterm.css` 文本、require ⊆ 基线 ∪ 声明、不含 `react-dom`。
 *
 * **防呆 4 条反控**（否则「门瞎了还报绿」）：越界 require 抓得住、幽灵 external 抓得住、
 * chunk 名正则两个方向都对、官方 kind 名单非空含 `terminal`。
 *
 * 用法：`pnpm -C packages/terminal-profiles build && pnpm -C packages/terminal-profiles check:client`。
 * vitest 里直接 `import { verifyClientLoader }`（`tests/unit/client-artifacts.test.ts` 复用同一套判据）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BASELINE_MODULES,
  CHUNK_FILE,
  CHUNK_FILE_PATTERN,
  CHUNK_REQUEST,
  INLINED_REACT_MARKER,
  MAIN_BUNDLE_FILE,
  OFFICIAL_TAB_KINDS,
  PLUGIN_ID,
  STYLE_PLUGIN_ID,
  createCaptureCtx,
  createFakeDocument,
  ghostDeclarations,
  makeChecks,
  materialize,
  outOfSurface,
  packageRoot,
  readRequires,
  resolveAsyncRequests,
  selfRegisteringBundles,
} from './lib/loader-harness.mjs';
export {
  BASELINE_MODULES,
  CHUNK_FILE,
  CHUNK_FILE_PATTERN,
  CHUNK_REQUEST,
  MAIN_BUNDLE_FILE,
  OFFICIAL_TAB_KINDS,
  PLUGIN_ID,
  STYLE_PLUGIN_ID,
} from './lib/loader-harness.mjs';

import { checkApplyBehaviour } from './lib/loader-apply-checks.mjs';

/**
 * ⚠️ **2026-10-09 事故与复原留痕**：为把本文件压回「单文件 ≤ 400 行」，`checkApplyBehaviour` 被整体搬到
 * `./lib/loader-apply-checks.mjs`。搬迁脚本**写坏了锚点**，连带把 `runCanaries` / `checkManifest` /
 * `checkMainBundle` 与上面那个 `export { … } from` 块一起删掉了（本包 Phase 4/6 的代码当时**尚未提交**，
 * git 对象里没有副本，见报告）。下面这三个函数是**按本文件头注的判据清单 + `verify-client-loader.d.mts`
 * 的被复用面 + 消费者 `tests/unit/client-artifacts.test.ts` 的断言**逐条重写的 —— 判据语义、判据数量
 * （4 反控 + 10 清单面 + 16 主产物面）与测量管道都保持一致，但**判据文案不可能逐字复原**。
 */
function runCanaries(check, surface) {
  const outOfScope = outOfSurface(['@xterm/xterm'], surface);
  check('canary: 越界 require 抓得住（否则 require 面判据是空转）', outOfScope.length === 1, JSON.stringify(outOfScope));
  const ghosts = ghostDeclarations(['react'], []);
  check('canary: 幽灵 external 抓得住（声明了却没 require）', ghosts.length === 1, JSON.stringify(ghosts));
  check(
    'canary: chunk 名正则两个方向都对',
    CHUNK_FILE_PATTERN.test(CHUNK_FILE) && !CHUNK_FILE_PATTERN.test(MAIN_BUNDLE_FILE) && !CHUNK_FILE_PATTERN.test('client.terminal'),
    `${String(CHUNK_FILE_PATTERN)} vs ${CHUNK_FILE} / ${MAIN_BUNDLE_FILE}`,
  );
  check(
    'canary: 官方 kind 名单非空且含 terminal（防名单被清空后「不重名」恒真）',
    OFFICIAL_TAB_KINDS.length >= 9 && OFFICIAL_TAB_KINDS.includes('terminal'),
    `${OFFICIAL_TAB_KINDS.length} 个：${OFFICIAL_TAB_KINDS.join(',')}`,
  );
}

function checkManifest(check, manifest, libDir) {
  const client = manifest.dsh?.client ?? {};
  const declaredExternal = Array.isArray(client.external) ? client.external : null;
  check('清单: dsh.client.platform = web（§A1）', client.platform === 'web', `platform=${String(client.platform)}`);
  check('清单: inject 是数组（§A1）', Array.isArray(client.inject), `inject=${JSON.stringify(client.inject)}`);
  check('清单: external 是数组（§A1）', declaredExternal !== null, `external=${JSON.stringify(client.external)}`);
  const exportEntry = manifest.exports?.['./client'] ?? {};
  check(
    '清单: exports["./client"].default 指向主产物（§A2）',
    exportEntry.default === `./lib/${MAIN_BUNDLE_FILE}`,
    `default=${String(exportEntry.default)}`,
  );
  check('清单: exports["./client"].types 指向类型入口（§A2）', typeof exportEntry.types === 'string', `types=${String(exportEntry.types)}`);
  check(
    '清单: chunk **不在** exports 里（§P3：chunk 只能被 require.async 取）',
    !JSON.stringify(manifest.exports ?? {}).includes(CHUNK_FILE),
    JSON.stringify(manifest.exports ?? {}),
  );
  const selfRegistering = selfRegisteringBundles(libDir);
  check(
    '清单: lib/ 下自注册的产物恰好 {主产物, chunk} 两个（改名/多产物会被抓住）',
    selfRegistering.length === 2 && selfRegistering.includes(MAIN_BUNDLE_FILE) && selfRegistering.includes(CHUNK_FILE),
    JSON.stringify(selfRegistering),
  );
  check(
    '清单: 主产物与 chunk 都在 lib/ 里（清单承诺的文件真的存在）',
    existsSync(join(libDir, MAIN_BUNDLE_FILE)) && existsSync(join(libDir, CHUNK_FILE)),
    `${MAIN_BUNDLE_FILE} / ${CHUNK_FILE}`,
  );
  check('清单: chunk 名命中宿主准入正则（§P3）', CHUNK_FILE_PATTERN.test(CHUNK_FILE), CHUNK_FILE);
  check(
    '清单: chunk 与主产物同目录（§P3）',
    dirname(join(libDir, CHUNK_FILE)) === dirname(join(libDir, MAIN_BUNDLE_FILE)),
    dirname(join(libDir, CHUNK_FILE)),
  );
  return declaredExternal ?? [];
}

// §P2 的三条不变量（直接判据 ×2 + 明确上限 ×1）本体在 `./lib/p2-main-bundle.mjs`（单文件 ≤ 400 行是 SHALL，
// 与 `loader-harness.mjs` / `loader-apply-checks.mjs` 同因同法）；这里**原样再导出**，让门与用例共用一个入口。
export {
  INLINED_REACT_CHECK_NAME,
  MAIN_BUNDLE_LIMIT_BYTES,
  MAIN_BUNDLE_LIMIT_RATIONALE,
  MAIN_SIZE_CHECK_NAME,
  XTERM_PURITY_CHECK_NAME,
  mainBundleInvariantChecks,
  xtermFingerprintHits,
} from './p2-main-bundle.mjs';

import { MAIN_BUNDLE_LIMIT_BYTES, mainBundleInvariantChecks } from './p2-main-bundle.mjs';

function checkMainBundle(checks, check, mainSource, mainBytes, chunkBytes, declaredExternal) {
  const surface = new Set([...BASELINE_MODULES, ...declaredExternal]);
  const main = materialize({ source: mainSource, filename: MAIN_BUNDLE_FILE, document: undefined });
  check('主 bundle: __ModuleLoader__.load 恰好一次', main.record.loads.length === 1, `load ${main.record.loads.length} 次`);
  const load = main.record.loads[0] ?? {};
  check('主 bundle: id 逐字 = 包名（宿主按行 id 找产物）', load.id === PLUGIN_ID, `id=${String(load.id)}`);
  check('主 bundle: **不带** chunk 字段（chunk 只属于懒加载块）', !('chunk' in load), `keys=${Object.keys(load).join(',')}`);
  const loaded = typeof load.factory === 'function' ? load.factory(main.createRequire()) : undefined;
  const keys = Object.keys(loaded ?? {}).sort();
  check(
    '主 bundle: 出参恰好 {apply,inject,name} 且**无 default**（§B7）',
    JSON.stringify(keys) === JSON.stringify(['apply', 'inject', 'name']),
    `keys=${keys.join(',')}`,
  );
  check('主 bundle: apply 是函数', typeof loaded?.apply === 'function', typeof loaded?.apply);
  check('主 bundle: inject 逐字 = ["slots"]（稳定服务）', JSON.stringify(loaded?.inject) === JSON.stringify(['slots']), JSON.stringify(loaded?.inject));
  check(
    '主 bundle: name = <包名>-client（客户端半的模块名，实测值）',
    loaded?.name === `${PLUGIN_ID}-client`,
    String(loaded?.name),
  );

  const asyncRequests = resolveAsyncRequests(mainSource);
  check(
    '主 bundle: require.async 恰好 1 处，且实参折叠后 = 兄弟文件名（§P3）',
    asyncRequests.length === 1 && asyncRequests[0]?.value === CHUNK_REQUEST,
    JSON.stringify(asyncRequests.map((request) => `${request.raw} → ${JSON.stringify(request.value)}`)),
  );
  const bareAsync = readRequires(mainSource, 'async').length;
  check(
    '主 bundle: 没有裸字面量版取块调用（那一处的实参是常量，故字面量扫描应为 0）',
    bareAsync === 0,
    `${bareAsync} 处字面量`,
  );

  const mainRequires = readRequires(mainSource);
  check('主 bundle: require 面含 react（external 真生效，§P4）', mainRequires.includes('react'), JSON.stringify([...new Set(mainRequires)]));
  // §P2 三条不变量：直接判据 ①（不含 xterm 实现）+ ②（不含内联 React）+ ③（体积 ≤ 明确上限）
  // ⇒ 与 `tests/unit/client-artifacts.test.ts` 的变异哨兵**共用同一实现**（`mainBundleInvariantChecks`）
  checks.push(...mainBundleInvariantChecks(mainSource, mainBytes, chunkBytes));
  const outOfScope = outOfSurface(mainRequires, surface);
  check('主 bundle: require ⊆ 基线 ∪ 清单声明（§P4）', outOfScope.length === 0, JSON.stringify(outOfScope));
  const ghosts = ghostDeclarations(declaredExternal, mainRequires);
  check('主 bundle: 清单 external 无幽灵声明（§P4）', ghosts.length === 0, JSON.stringify(ghosts));
  check(
    '主 bundle: 材质化时零 require.async 调用（取块只在 useMemo/挂载时）',
    main.record.async.length === 0,
    `${main.record.async.length} 次`,
  );
  const documentAccessesAtMaterialization = main.record.documentAccesses;
  check(
    '主 bundle: 材质化时零 DOM 访问（CSS 注入必须在 factory 闭包内，§C9）',
    documentAccessesAtMaterialization === 0,
    `${documentAccessesAtMaterialization} 次`,
  );
  return { main, loaded, mainRequires, asyncRequests, documentAccessesAtMaterialization };
}

function checkChunk(check, chunkSource, declaredExternal) {
  /**
   * ⚠️ **实测发现**：内联的 xterm 在**模块顶层**就做特性探测（`document.queryCommandSupported("copy")`
   * ⇒ 真机上材质化 chunk 时**会**读 `document`）。所以这里**不**断言「零 DOM 访问」（那会把 xterm 自己的
   * 行为算成我们的违规），改成断言更准的两条：① 材质化时**零样式注入**（CSS 注入确实在视图挂载时）
   * ② 调 `installXtermStyles(fakeDoc)` 后才出现**恰好一个**带 tagId 的 `<style>`。
   */
  const fakeDocument = createFakeDocument();
  const chunk = materialize({ source: chunkSource, filename: CHUNK_FILE, document: fakeDocument });
  check('chunk: __ModuleLoader__.load 恰好一次', chunk.record.loads.length === 1, `load ${chunk.record.loads.length} 次`);
  const chunkLoad = chunk.record.loads[0] ?? {};
  check('chunk: chunk 字段逐字 = client.terminal.js', chunkLoad.chunk === CHUNK_FILE, `chunk=${String(chunkLoad.chunk)}`);
  check('chunk: id 与主产物一致', chunkLoad.id === PLUGIN_ID, `id=${String(chunkLoad.id)}`);
  check(
    'chunk: 材质化时零样式注入（xterm.css 注入在视图挂载时，不在模块顶层）',
    fakeDocument.nodes.length === 0,
    `材质化后 style 节点 ${fakeDocument.nodes.length} 个（xterm 顶层探测读 document ${chunk.record.documentAccesses} 次，属其自身行为）`,
  );
  const chunkExports = typeof chunkLoad.factory === 'function' ? chunkLoad.factory(chunk.createRequire()) : undefined;
  check(
    'chunk: 导出 { TerminalBody, installXtermStyles }',
    typeof chunkExports?.TerminalBody === 'function' && typeof chunkExports?.installXtermStyles === 'function',
    `keys=${Object.keys(chunkExports ?? {}).join(',')}`,
  );
  const installation = typeof chunkExports?.installXtermStyles === 'function' ? chunkExports.installXtermStyles(fakeDocument) : undefined;
  check(
    'chunk: installXtermStyles 注入恰好 1 个 xterm.css 节点（tagId 区别于自有样式）',
    fakeDocument.nodes.length === 1 && fakeDocument.nodes[0].dataset.plugin === `${PLUGIN_ID}/xterm.css`,
    JSON.stringify(fakeDocument.nodes.map((node) => node.dataset.plugin)),
  );
  check(
    'chunk: installXtermStyles 返回移除器（重复调用幂等 ⇒ 仍只有 1 个节点）',
    typeof installation?.dispose === 'function' && chunkExports.installXtermStyles(fakeDocument) !== undefined && fakeDocument.nodes.length === 1,
    `节点 ${fakeDocument.nodes.length} 个`,
  );
  check('chunk: 内联 xterm 库（FitAddon 真实现）', chunkSource.includes('FitAddon'), `FitAddon ${(chunkSource.match(/FitAddon/g) ?? []).length} 次`);
  check(
    'chunk: 内联 xterm.css 文本（`.xterm {` 规则 + `.xterm-viewport`）',
    chunkSource.includes('.xterm {') && chunkSource.includes('.xterm-viewport'),
    `marker 命中 .xterm {=${chunkSource.includes('.xterm {')} .xterm-viewport=${chunkSource.includes('.xterm-viewport')}`,
  );
  const chunkRequires = readRequires(chunkSource);
  const surface = new Set([...BASELINE_MODULES, ...declaredExternal]);
  check('chunk: require 实参 ⊆ 基线 ∪ 清单声明的 external', outOfSurface(chunkRequires, surface).length === 0, `越界=${JSON.stringify(outOfSurface(chunkRequires, surface))}`);
  check('chunk: 不含 react-dom（组件由宿主渲染，§P4）', !chunkRequires.includes('react-dom') && !chunkRequires.includes('react-dom/client'), JSON.stringify([...new Set(chunkRequires)]));
  const chunkReactInlined = chunkSource.includes(INLINED_REACT_MARKER);
  check('chunk: 未内联 react（chunk 与主产物共用同一份 external 口径）', !chunkReactInlined, `内联标记 ${chunkReactInlined ? '命中' : '未命中'}`);
  return chunkRequires;
}

export function verifyClientLoader(options = {}) {
  const libDir = options.libDir ?? join(packageRoot, 'lib');
  const { checks, check } = makeChecks();
  runCanaries(check, new Set(BASELINE_MODULES));

  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const declaredExternal = checkManifest(check, manifest, libDir);

  const mainPath = join(libDir, MAIN_BUNDLE_FILE);
  const chunkPath = join(libDir, CHUNK_FILE);
  if (!existsSync(mainPath) || !existsSync(chunkPath)) {
    return {
      ok: false,
      checks,
      failures: checks.filter((entry) => !entry.ok),
      measurements: { mainBytes: 0, chunkBytes: 0 },
      reason: `产物不存在（${mainPath}）：先跑 pnpm -C packages/terminal-profiles build`,
      checkCount: checks.length,
    };
  }

  const mainSource = readFileSync(mainPath, 'utf8');
  const chunkSource = readFileSync(chunkPath, 'utf8');
  const mainBytes = statSync(mainPath).size;
  const chunkBytes = statSync(chunkPath).size;
  const mainScan = checkMainBundle(checks, check, mainSource, mainBytes, chunkBytes, declaredExternal);
  const { main, loaded, mainRequires, asyncRequests, documentAccessesAtMaterialization } = mainScan;
  const run = checkApplyBehaviour(check, main, loaded);
  const chunkRequires = checkChunk(check, chunkSource, declaredExternal);

  const failures = checks.filter((entry) => !entry.ok);
  /**
   * **软提示（非判据）**：`chunk / 主 bundle` 的比值。它**不参与** `ok` / `failures` ——
   * 「主 bundle 是否合法」由上面三条不变量判定（不含 xterm 实现 / 不含内联 React / ≤ 上限），
   * 而「chunk 有多大」只是 xterm 落在懒加载块里的**旁证**。旧口径把这条旁证当硬判据，才有 2026-10-12 的误红。
   */
  const sizeHint = {
    chunkIsLarger: chunkBytes > mainBytes,
    mainToChunkRatio: Number((chunkBytes / mainBytes).toFixed(2)),
    headroomBytes: MAIN_BUNDLE_LIMIT_BYTES - mainBytes,
    limitBytes: MAIN_BUNDLE_LIMIT_BYTES,
    note: 'chunk 显著大于主 bundle 只是**旁证/记账**（软提示），不是判据；超限与否只由 mainBytes <= MAIN_BUNDLE_LIMIT_BYTES 决定。',
  };
  return {
    ok: failures.length === 0,
    checks,
    failures,
    measurements: {
      mainBytes,
      chunkBytes,
      sizeHint,
      mainRequires: [...new Set(mainRequires)],
      mainAsyncRequests: asyncRequests.map((request) => `${request.raw} → ${JSON.stringify(request.value)}`),
      chunkRequires: [...new Set(chunkRequires)],
      declaredExternal,
      asyncCallsDuringMaterialization: main.record.async.length,
      /** 材质化期间 = 0（判据）；apply 期间 = 4（`resolveDocument`/`querySelector`/`createElement`/`head.append`） */
      documentAccessesDuringMaterialization: documentAccessesAtMaterialization,
      documentAccessesAfterApply: main.record.documentAccesses,
      effectsDuringApply: run.captured.effects.length,
      seatsRegistered: run.captured.seats.length,
      warnings: main.record.warnings,
    },
    reason: null,
    checkCount: checks.length,
  };
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const report = verifyClientLoader();
  const { mainBytes, chunkBytes } = report.measurements;
  console.log(`✓ verify-client-loader: ${report.checkCount} 条判据（含 4 条反控），产物目录 lib/`);
  console.log(`  主 bundle lib/${MAIN_BUNDLE_FILE} = ${mainBytes} 字节`);
  console.log(`  懒加载块 lib/${CHUNK_FILE} = ${chunkBytes} 字节`);
  console.log(`  主 bundle require = ${JSON.stringify(report.measurements.mainRequires ?? [])}`);
  console.log(`  取块实参折叠路径 = ${JSON.stringify(report.measurements.mainAsyncRequests ?? [])}`);
  console.log(`  chunk require    = ${JSON.stringify(report.measurements.chunkRequires ?? [])}`);
  console.log(`  清单 external    = ${JSON.stringify(report.measurements.declaredExternal ?? [])}`);
  const hint = report.measurements.sizeHint;
  console.log(
    `  §P2 上限 = ${hint?.limitBytes} B；实测主 ${mainBytes} B（余 ${hint?.headroomBytes} B）· 软提示（**非判据**）chunk/主 = ${hint?.mainToChunkRatio}×`,
  );
  if (typeof report.reason === 'string') console.error(`✗ verify-client-loader: ${report.reason}`);
  for (const failure of report.failures) console.error(`  ✗ ${failure.name} :: ${failure.detail}`);
  if (!report.ok) {
    console.error(`✗ verify-client-loader: ${report.failures.length}/${report.checkCount} 条判据未通过`);
    process.exitCode = 1;
  } else {
    console.log('  全部判据通过 ✓');
  }
}
