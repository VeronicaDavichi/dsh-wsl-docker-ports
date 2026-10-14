/**
 * §P2 三条字节判据 + 上限双重锁 + 变异哨兵（**本包的 §P2 门**，2026-10-12 扩面后新增）
 *
 * ## 为什么独立成文件（而不是塞进 `verify-client-loader.mjs`）
 *
 * 本仓「**单文件 ≤ 400 行**」是 SHALL，由 `packages/wsl-shared/scripts/check-size.mjs` 扫
 * 每个包的 `src` / `tests` / `scripts` 三个子目录（`.ts` / `.tsx` / `.mjs`）。把这一组判据挂在主门上
 * 会把它顶到 **410 行**（**实测已判红**，见本轮报告）—— 与 `terminal-profiles` 当初把 §P2 判据
 * 独立成 `scripts/p2-main-bundle.mjs` **同一个原因、同一套处置**：**判据本体一个字没改，只是换了个文件住**。
 *
 * ## 判据本体**不是本包新写的**
 *
 * 三条判据 = ① 主 bundle 不含 xterm 实现 ② 不含内联 React ③ `mainBytes <= 逐包上限`（含等号）；
 * **唯一实现**在 [`packages/wsl-shared/scripts/lib/p2-main-bundle.mjs`](../../wsl-shared/scripts/lib/p2-main-bundle.mjs)
 * （与 `terminal-profiles` 同一份；先例：`export-surface.mjs` / `strip-comments.mjs` 都是
 * 「一份实现、多处 import」，本仓规矩是**不许各自解释口径** ⇒ **不复制第二份判据**）。
 * 上限 / 性质 / 记录日 / 留痕取自机器可读 SSoT
 * [`packages/wsl-shared/scripts/main-bundle-budgets.mjs`](../../wsl-shared/scripts/main-bundle-budgets.mjs)，
 * 并与契约文档 `client-contract-incremental.md` §P2 的 `<!-- main-bundle-budgets:SSoT -->` 块
 * **逐字段绑定**（4 个锁字段，只改一边必红）。
 *
 * ## 🔴 本包登记 = 144,149 B、`nature: 'debt'` = **存量欠账，不是认可值**
 *
 * 相对 §P2 的推导口径（65,536 B，**当初只由 `terminal-profiles` 推导**）本包
 * **已越线 78,613 B（2.20×）**，且该越线**早于 008/009**（初始 client 半 `8bfb6fb` 即 83,709 B）
 * ⇒ 门口径 = **棘轮只许降**：「门绿」只表示「**没有再涨**」，**不表示达标**。
 * 收敛 = 拆懒加载 chunk（须**连带**拆写路径内核、须**单独立项**）；🔴 **不得为过门而删功能**。
 *
 * ## ✅ 订正痕（2026-10-13，原文一字未删）
 *
 * 上面「本包登记 = 144,149 B / 已越线 78,613 B（2.20×）」是**切分前**的记录。011 Phase 1 已把渲染面 7 模块 +
 * 写路径内核 21,202 B 移入懒加载 chunk ⇒ 实测 **38,640 B ≤ 65,536 B**（余 26,896 B），SSoT 上限随棘轮
 * **下调为 38,640 B**、记录日 2026-10-13、留痕 **#54** ⇒ 本包**已达标**；「门绿」的含义从「没有再涨」变为
 * 「守住切分后的水平 —— 再涨一个字节即红」。判据本体一个字未改。
 *
 * ## 断言记录器由调用方注入
 *
 * `check` / `expectScanned` 是主门里的**同一对**闭包（计数进同一个 `checks` / `failures`）
 * ⇒ 本模块**不另起一套记账**，主门的结果行自然把这 16 条算进去。
 */

import { readFileSync } from 'node:fs';

import {
  LOCK_FIELDS,
  MAIN_BUNDLE_BUDGETS,
  RATCHET_RULE,
  SSOT_DOC,
  changelogEntries,
  checkTraces,
  diffBudgets,
  readDocBudgets,
  repoPath,
} from '../../wsl-shared/scripts/main-bundle-budgets.mjs';
import {
  INLINED_REACT_CHECK_NAME,
  INLINED_REACT_MARKER,
  XTERM_PURITY_CHECK_NAME,
  mainBundleInvariantChecks,
  mainSizeCheckName,
  missingCriteria,
  requiredCriteriaNames,
} from '../../wsl-shared/scripts/lib/p2-main-bundle.mjs';

/** 未登记时的兜底预算（只为让 `missingCriteria` 有个名字可用；**登记缺失本身会被判红**） */
const FALLBACK_BUDGET = { limitBytes: 0, nature: 'debt', trace: '#0' };

export function runP2MainBundleGate({ pkgName, source, mainBytes, check, expectScanned }) {
  console.log('\n=== 6. §P2 三条字节判据（2026-10-12 扩面：三包同一套判据，判据本体只有一份） ===');
  const p2Budget = MAIN_BUNDLE_BUDGETS[pkgName];
  console.log('  · 判据实现（唯一一份）：packages/wsl-shared/scripts/lib/p2-main-bundle.mjs（terminal-profiles 与本包共用 ⇒ 不复制第二份）');
  check(
    '§P2 预算已在机器表里登记（未登记 = 不放行，不许静默默认）',
    p2Budget !== undefined,
    `${pkgName} = ${JSON.stringify(p2Budget ?? null)}`,
  );
  const sizeCheckName = p2Budget === undefined ? '' : mainSizeCheckName(p2Budget.limitBytes);
  console.log(
    `  · 本包登记：上限 ${String(p2Budget?.limitBytes)} B、nature=${String(p2Budget?.nature)}、记录日 ${String(p2Budget?.recorded)}、留痕 ${String(p2Budget?.trace)}`,
  );
  if (p2Budget?.nature === 'debt') {
    /** §P2 的**推导口径**（65,536 B）—— 当初只由 `terminal-profiles` 推导；这里只用它算「越线多少」，不改本包上限 */
    const derivationLimit = MAIN_BUNDLE_BUDGETS['dsh-terminal-profiles'].limitBytes;
    const overDerivation = mainBytes - derivationLimit;
    if (overDerivation > 0) {
      const ratio = (mainBytes / derivationLimit).toFixed(2);
      console.log(
        `  🔴 **存量欠账**：本包主 bundle 上限 = ${String(p2Budget.limitBytes)} B = 按现状（${String(mainBytes)} B）登记的**上限**，` +
          '**不是认可值** —— 它**不表示本包达标**。',
      );
      console.log(
        `     相对 §P2 的推导口径（${String(derivationLimit)} B）本包**已越线 ${String(overDerivation)} B（${ratio}×）**，` +
          '且该越线**早于 008/009**（初始 client 半 `8bfb6fb` 即 83,709 B > 64 KiB）。',
      );
      console.log('     收敛方向：① **先拆懒加载 chunk** —— 只切渲染面**不够**（按本轮构成推算：切后主包仍 ≈ 70,246 B，');
      console.log('       仍超 65,536 B 共 **4,710 B**）⇒ 须**连带**拆**写路径内核**，预期主包 ≈ 49 KB；');
      console.log('     ② 该拆包动作**须单独立项**（不在本轮、也不在本 Spec 面内）。');
      console.log('     🔴 **不得为过门而删功能** —— 上限的意义是「棘轮只许降」，删功能过门 = 把可验收的东西藏起来。');
      /** 订正痕（2026-10-13，原文一字未删）：上面几行的 `70,246 / 4,710 / ≈49 KB` 是**切分前的一阶推算**；
       *  011 Phase 1 实测已收敛到 38,640 B（连带写内核进 chunk、未删功能），SSoT 上限随棘轮下调到实测值（留痕 #54）
       *  ⇒ **本分支当前不可达**（登记上限 38,640 < 65,536 ⇒ `overDerivation` 恒 ≤ 0）。原文保留作留痕。 */
    } else {
      console.log(
        `  ✅ **已达标**：主 bundle ${String(mainBytes)} B ≤ §P2 推导口径 ${String(derivationLimit)} B（余 ${String(-overDerivation)} B）` +
          ' —— 011 Phase 1 切分（渲染面 + 写路径内核入 chunk），留痕 #54。',
      );
      console.log(
        `     本行上限 ${String(p2Budget.limitBytes)} B = **切分后实测值的棘轮地板**（性质 debt：不是推导值，但**只许降**）` +
          '；旧读数 144,149 / 70,246 / 4,710 是切分前的记录（原文保留，见 changelog #52 与 #54）。',
      );
      console.log('     🔴 **不得为过门而删功能** —— 上限的意义是「棘轮只许降」，删功能过门 = 把可验收的东西藏起来。');
    }
  }
  const invariant = p2Budget === undefined ? [] : mainBundleInvariantChecks({ mainSource: source, mainBytes, chunkBytes: 0, budget: p2Budget });
  for (const entry of invariant) check(entry.name, entry.ok, entry.detail);
  expectScanned(
    '§P2 三条判据都产出了读数（条数为 0 即恒真）',
    invariant.length,
    invariant.length === 3,
    `实到 ${String(invariant.length)} 条：${JSON.stringify(invariant.map((entry) => entry.name))}`,
  );
  const requiredNames = p2Budget === undefined ? [] : requiredCriteriaNames(p2Budget);
  const missingRequired = missingCriteria(invariant, p2Budget ?? FALLBACK_BUDGET);
  expectScanned(
    '§P2 判据**齐备**（三条必备判据按名字逐字都在；缺一条即红 ⇒ 挡住「悄悄摘掉字节判据」）',
    requiredNames.length,
    missingRequired.length === 0,
    `必备 ${String(requiredNames.length)} 条、实到 ${String(invariant.length)} 条、缺 ${JSON.stringify(missingRequired)}`,
  );

  console.log('\n=== 7. 上限的双重锁 + 棘轮 + 留痕（机器表 ↔ 契约文档 §P2 标记块） ===');
  const docTable = readDocBudgets();
  const changelogIds = changelogEntries(readFileSync(repoPath('stack-decision-changelog.md'), 'utf8'));
  const maxChangelogId = changelogIds.size === 0 ? 0 : Math.max(...changelogIds);
  console.log(`  机器表：packages/wsl-shared/scripts/main-bundle-budgets.mjs（${String(Object.keys(MAIN_BUNDLE_BUDGETS).length)} 个包）`);
  console.log(`  文档表：${SSOT_DOC.rel} 的 \`${SSOT_DOC.begin}\` 块`);
  console.log(`  棘轮：${RATCHET_RULE.direction} — ${RATCHET_RULE.text}`);
  console.log(`  锁字段（一个不落）：${LOCK_FIELDS.join('、')}`);
  const budgetDiff = diffBudgets(MAIN_BUNDLE_BUDGETS, docTable);
  const budgetRows = budgetDiff.rows.map((row) => `${row.pkg}.${row.field}=${String(row.table)}/${String(row.doc)}(${row.direction})`);
  expectScanned(
    '① 机器表 ↔ 契约文档表**逐字段相等**（只改一边必红）',
    budgetDiff.rows.length,
    budgetDiff.ok,
    `${budgetRows.join('、')}${budgetDiff.ok ? '' : ` ⇒ ${budgetDiff.reasons.join('；')}`}`,
  );
  expectScanned(
    '② 棘轮：没有任何字段被**上调**（方向 up 一律红）',
    budgetDiff.rows.length,
    budgetDiff.up.length === 0,
    `上调 ${String(budgetDiff.up.length)} 处 ${JSON.stringify(budgetDiff.up.map((row) => `${row.pkg}.${row.field}`))}；下调 ${String(budgetDiff.down.length)} 处`,
  );
  const traces = checkTraces(MAIN_BUNDLE_BUDGETS, changelogIds);
  expectScanned(
    '③ 留痕号可追（门**自己数行**：`| N |` 行数与最大编号自洽，且 trace 指向的编号真存在）',
    traces.targets.length,
    traces.ok && changelogIds.size > 0 && changelogIds.size === maxChangelogId,
    `${traces.targets.map((target) => `${target.pkg}=${target.trace}`).join('、')}；changelog 计得 ${String(changelogIds.size)} 条 \`| N |\` 行、最大 #${String(maxChangelogId)}${traces.ok ? '' : ` ⇒ ${traces.reasons.join('；')}`}`,
  );

  console.log('\n=== 8. §P2 变异哨兵（喂给**同一个**实现 / 同一个判定函数；没红就是门的错） ===');
  const cleanRed = invariant.filter((entry) => !entry.ok).map((entry) => entry.name);
  console.log(`  ⚑ ⓪ 基线对照：真实产物先证「判据不是恒红」 ⇒ 红 ${String(cleanRed.length)} 条 ${JSON.stringify(cleanRed)}`);
  expectScanned(
    '⚑ ⓪ 真实产物判绿（下面 5 组哨兵的红才是「新引入的红」，不是门一直红）',
    invariant.length,
    cleanRed.length === 0,
    `红 ${String(cleanRed.length)} 条 ${JSON.stringify(cleanRed)}`,
  );

  const overLimit = p2Budget === undefined ? [] : mainBundleInvariantChecks({ mainSource: source, mainBytes: p2Budget.limitBytes + 1, chunkBytes: 0, budget: p2Budget });
  const overRed = overLimit.filter((entry) => !entry.ok).map((entry) => entry.name);
  console.log(`  ⚑ ① 人造超限读数 ${String(p2Budget?.limitBytes + 1)}（= 上限 + 1） ⇒ ${overRed.length === 1 && overRed[0] === sizeCheckName ? '判红 ✓' : '未红 ✗'}（红 ${String(overRed.length)} 条：${overRed.join('、') || '（无）'}）`);
  expectScanned(
    '⚑ ① 人造超限读数（上限 + 1）⇒ 判红，且**恰好**是那条上限判据',
    overRed.length,
    overRed.length === 1 && overRed[0] === sizeCheckName,
    `红 ${JSON.stringify(overRed)}；detail=${String(overLimit.find((entry) => entry.name === sizeCheckName)?.detail)}`,
  );

  const atLimit = p2Budget === undefined ? [] : mainBundleInvariantChecks({ mainSource: source, mainBytes: p2Budget.limitBytes, chunkBytes: 0, budget: p2Budget });
  const atLimitRed = atLimit.filter((entry) => !entry.ok).map((entry) => entry.name);
  const atLimitSize = atLimit.find((entry) => entry.name === sizeCheckName);
  console.log(`  ⚑ ② 上限**恰好**等于读数（${String(p2Budget?.limitBytes)}） ⇒ ${atLimitRed.length === 0 && atLimitSize?.ok === true ? '判绿 ✓' : '未绿 ✗'}（红 ${String(atLimitRed.length)} 条）`);
  expectScanned(
    '⚑ ② 上限恰好等于读数 ⇒ 判绿（证明判定是 `<=`、边界含等号，且与 ① 合起来证明它既不恒真也不恒假）',
    atLimit.length,
    atLimitRed.length === 0 && atLimitSize?.ok === true,
    `红 ${String(atLimitRed.length)} 条；上限判据 ok=${String(atLimitSize?.ok)}；detail=${String(atLimitSize?.detail)}`,
  );

  /** 哨兵的对照基线：文档表可用就用它，否则退化为机器表快照 ⇒ 哨兵**不依赖仓库状态**（文档块缺失由 §7 负责报红） */
  const baseDoc = Object.keys(docTable).length > 0 ? docTable : { ...MAIN_BUNDLE_BUDGETS };
  const raisedTable = { ...MAIN_BUNDLE_BUDGETS, [pkgName]: { ...p2Budget, limitBytes: Number(p2Budget?.limitBytes) + 1 } };
  const raisedDiff = diffBudgets(raisedTable, baseDoc);
  const raisedUp = raisedDiff.up.map((row) => `${row.pkg}.${row.field} ${String(row.doc)} → ${String(row.table)}`);
  console.log(`  ⚑ ③ 只改机器表抬上限（${String(p2Budget?.limitBytes)} → ${String(Number(p2Budget?.limitBytes) + 1)}，文档表不动） ⇒ ${raisedDiff.ok === false && raisedUp.length > 0 ? '判红 ✓' : '未红 ✗'}`);
  console.log(`     门会报：${raisedDiff.reasons.join('；') || '（无）'}`);
  expectScanned(
    '⚑ ③ 只改机器表抬上限 ⇒ 判红（棘轮 + 双重锁）',
    raisedUp.length,
    raisedDiff.ok === false && raisedUp.length > 0,
    `抓到上调 ${String(raisedUp.length)} 处：${raisedUp.join('、') || '（无）'}`,
  );

  const legacyChecks = invariant.filter((entry) => entry.name !== sizeCheckName);
  const legacyMissing = missingCriteria(legacyChecks, p2Budget ?? FALLBACK_BUDGET);
  console.log(`  ⚑ ④ 退回旧口径（判据集合里**去掉**那条数值上限） ⇒ ${legacyMissing.length === 1 ? '判红 ✓' : '未红 ✗'}（齐备性核对报缺 ${JSON.stringify(legacyMissing)}）`);
  expectScanned(
    '⚑ ④ 去掉字节判据（退回旧口径）⇒ 判红',
    legacyMissing.length,
    legacyMissing.length === 1 && legacyMissing[0] === sizeCheckName,
    `旧口径判据数 ${String(legacyChecks.length)}、缺 ${JSON.stringify(legacyMissing)}`,
  );

  const reactMutant = p2Budget === undefined ? [] : mainBundleInvariantChecks({ mainSource: `${source}\n/* ${INLINED_REACT_MARKER} */\n`, mainBytes, chunkBytes: 0, budget: p2Budget });
  const reactRed = reactMutant.filter((entry) => !entry.ok).map((entry) => entry.name);
  console.log(`  ⚑ ⑤a 人造**内联 React** 指纹 ⇒ ${reactRed.length === 1 && reactRed[0] === INLINED_REACT_CHECK_NAME ? '判红 ✓' : '未红 ✗'}（红 ${JSON.stringify(reactRed)}）`);
  expectScanned(
    '⚑ ⑤a 人造内联 React 指纹 ⇒ 判红，且**恰好**是那条直接判据',
    reactRed.length,
    reactRed.length === 1 && reactRed[0] === INLINED_REACT_CHECK_NAME,
    `红 ${JSON.stringify(reactRed)}；期望恰好 ${JSON.stringify([INLINED_REACT_CHECK_NAME])}`,
  );
  const xtermMutant = p2Budget === undefined ? [] : mainBundleInvariantChecks({ mainSource: `${source}\n/* @xterm/xterm */\n`, mainBytes, chunkBytes: 0, budget: p2Budget });
  const xtermRed = xtermMutant.filter((entry) => !entry.ok).map((entry) => entry.name);
  console.log(`  ⚑ ⑤b 人造 **xterm** 指纹 ⇒ ${xtermRed.length === 1 && xtermRed[0] === XTERM_PURITY_CHECK_NAME ? '判红 ✓' : '未红 ✗'}（红 ${JSON.stringify(xtermRed)}）`);
  expectScanned(
    '⚑ ⑤b 人造 xterm 指纹 ⇒ 判红，且**恰好**是那条直接判据',
    xtermRed.length,
    xtermRed.length === 1 && xtermRed[0] === XTERM_PURITY_CHECK_NAME,
    `红 ${JSON.stringify(xtermRed)}；期望恰好 ${JSON.stringify([XTERM_PURITY_CHECK_NAME])}`,
  );
}
