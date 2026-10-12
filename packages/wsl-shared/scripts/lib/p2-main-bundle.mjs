/**
 * §P2「主 bundle 三条不变量」的**唯一实现**（2026-10-12 口径变更 + 同日**适用范围扩到三包**）
 *
 * ## 三条判据（全部可二值判定）
 *
 * ① `XTERM_PURITY_CHECK_NAME` —— **直接判据**：主 bundle 不含 xterm 实现（指纹 `@xterm/xterm` + `.xterm-viewport`）。
 * ② `INLINED_REACT_CHECK_NAME` —— **直接判据**：主 bundle 不含**内联 React**（`INLINED_REACT_MARKER`）。
 * ③ `mainSizeCheckName(limit)` —— **明确上限**：`mainBytes <= limit`（**含等号**）。
 *
 * ## 为什么判据本体住在这里（而不是某个包自己的 `scripts/`）
 *
 * §P2 原只由 `terminal-profiles` 一道门守（判据本体在它自己的 `scripts/p2-main-bundle.mjs`）。
 * 2026-10-12 主人裁定「**§P2 三条判据适用于三包**（一宿主批不两套标准）」⇒ `wsl-docker-ports`
 * 的 loader 门也要判同样三条。本仓既有规矩是「**不许各自解释口径**」（先例：
 * `export-surface.mjs` 三包共用、`strip-comments.mjs` 两门共用）⇒ 判据本体**提到本文件**，
 * 两边 import，**不复制第二份**。
 *
 * ## 上限是**逐包参数**，不是本模块的常量
 *
 * 每个包的上限 / 性质 / 记录日 / 留痕登记在 [`../main-bundle-budgets.mjs`](../main-bundle-budgets.mjs)
 * （机器可读 SSoT，并与契约文档的标记块**逐字段绑定**）。本模块只**接收**读数与预算 ⇒
 * 可以拿**人造读数**（上限 + 1、或只改表的一侧）证明判据**不恒真**、棘轮**真会红**。
 *
 * ⚠️ **`nature: 'debt'` 的含义**：那是**存量欠账**（按现状设的上限），**不是认可值** ——
 * 判红语义不变（`<=` 就是 `<=`），但「现在绿」**不等于**「达标」；门口径见
 * [`../main-bundle-budgets.mjs`](../main-bundle-budgets.mjs) 头注。
 */

/**
 * 「react 被**打进包**了」的判据串：React 18 开发版内部的东西，任何**由宿主供给**的正确产物里都不会出现
 * （自有源码里也不会有）⇒ 用来抓「`external` 漏声明导致基线模块被内联」这一类静默错误。
 */
export const INLINED_REACT_MARKER = '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED';

/** xterm 指纹（命中任一 ⇒ 主 bundle 里内联了 xterm 实现；§P2 要求它只出现在懒加载 chunk） */
export const XTERM_FINGERPRINTS = ['@xterm/xterm', '.xterm-viewport'];

/** 直接判据 ① 的名字（**逐字**沿用 2026-10-12 起的门，避免下游引用漂移） */
export const XTERM_PURITY_CHECK_NAME =
  '主 bundle: 不含 xterm 实现（指纹：模块名 + xterm 自己的 CSS 选择器；§P2 内联的是 chunk）';
/** 直接判据 ② 的名字（**逐字**沿用） */
export const INLINED_REACT_CHECK_NAME = '主 bundle: react **没有**被打进包（内联标记不存在）';

/**
 * 断言收集器（**唯一一份**；`terminal-profiles` 的 `scripts/lib/loader-harness.mjs` 从这里再导出）。
 * 只认字面 `true`：`Boolean(x)` 会把「错类型的真值」也放过（门变瞎的一种）。
 */
export function makeChecks() {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: ok === true, detail: String(detail) });
    return ok === true;
  };
  return { checks, check };
}

/** 指纹命中清单（空数组 = 主 bundle 干净）；**返回清单**而不是布尔，便于报出「命中了哪几个」 */
export function xtermFingerprintHits(source) {
  return XTERM_FINGERPRINTS.filter((marker) => source.includes(marker));
}

/**
 * 上限判据的**名字**（数值写进名字里 ⇒ 「哪条红了」自带读数）。
 * 正好整 KiB 时写 `64 KiB`（保持 2026-10-12 起的原标签逐字不变），否则写千分位字节数。
 * ⚠️ 不用 `toLocaleString` —— 它依赖 ICU 数据，判据名必须**确定性**。
 */
export function mainSizeCheckName(limitBytes) {
  const kib = limitBytes % 1024 === 0 ? limitBytes / 1024 : null;
  const label = kib === null ? `${String(limitBytes).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')} B` : `${String(kib)} KiB`;
  return `主 bundle: 体积 ≤ 明确上限 ${label}（§P2：直接判据 + 数值上限，取代旧的比例代理判据）`;
}

/** 预算行必须是完整登记（缺字段 ⇒ 抛，**绝不静默默认**） */
function requireBudget(budget) {
  const missing = ['limitBytes', 'nature', 'trace'].filter((field) => budget?.[field] === undefined);
  if (missing.length > 0) throw new Error(`§P2 预算缺字段：${missing.join('、')}（不许默认通过）`);
  return budget;
}

/**
 * §P2 三条不变量的**唯一实现**（门与变异哨兵用例共用 ⇒ 用例验的就是真门，不是影子实现）。
 * 入参是「读数」+「预算」，所以可以用**人造读数**证明它不是恒真（超限 ⇒ 红），
 * 也可以用**另一个包的预算**证明同一份实现能服务三包（不复制判据）。
 */
export function mainBundleInvariantChecks({ mainSource, mainBytes, chunkBytes = 0, budget }) {
  const row = requireBudget(budget);
  const { checks, check } = makeChecks();
  const hits = xtermFingerprintHits(mainSource);
  check(
    XTERM_PURITY_CHECK_NAME,
    hits.length === 0,
    `命中=${JSON.stringify(hits)}（@xterm/xterm=${mainSource.includes('@xterm/xterm')} .xterm-viewport=${mainSource.includes('.xterm-viewport')}）`,
  );
  check(INLINED_REACT_CHECK_NAME, !mainSource.includes(INLINED_REACT_MARKER), INLINED_REACT_MARKER);
  const headroom = row.limitBytes - mainBytes;
  check(
    mainSizeCheckName(row.limitBytes),
    mainBytes <= row.limitBytes,
    `主 ${mainBytes} B / 上限 ${row.limitBytes} B（余 ${headroom} B，性质=${row.nature}）；软提示（**非判据**）chunk=${chunkBytes} B`,
  );
  return checks;
}

/** 某个包**必备**的判据名（按名字逐字）；缺一条 ⇒ 门必须红（防「判据被悄悄摘掉」） */
export function requiredCriteriaNames(budget) {
  const row = requireBudget(budget);
  return [XTERM_PURITY_CHECK_NAME, INLINED_REACT_CHECK_NAME, mainSizeCheckName(row.limitBytes)];
}

/**
 * 齐备性核对：返回**缺失**的必备判据名（空数组 = 三条都在）。
 * 这是「退回旧口径（去掉字节判据）⇒ 判红」的机械半边：判据集合少一条，这里就非空。
 */
export function missingCriteria(checks, budget) {
  const present = new Set(checks.map((entry) => entry.name));
  return requiredCriteriaNames(budget).filter((name) => !present.has(name));
}
