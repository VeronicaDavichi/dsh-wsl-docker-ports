/**
 * §P2 **主 bundle 的三条不变量**（2026-10-12 口径变更，主人裁决；契约留痕见 `client-contract.md` §P2）
 *
 * 为什么单独成文件：① 本包既有规则是「单文件 ≤ **400 行** 是 SHALL」（`pnpm check:size` 扩面后连
 * `scripts/*.mjs` 一起扫）——把这一组判据挂在 `verify-client-loader.mjs` 上会把它顶到 **412 行**；
 * ② **不能**放进 `scripts/lib/`：`.gitignore` 第 3 行是 `lib/`，它**无视层级**地忽略任何 `lib/` 目录
 * ⇒ 放那里的模块**进不了版本库**（本包 `scripts/lib/loader-harness.mjs` 与 `loader-apply-checks.mjs`
 * 现状即是如此，已作为 🔴 既有缺陷上报，不在本次改动范围）。**判据本体一个字没改**，只是换了个文件住。
 *
 * **旧口径（作废）**：`mainBytes * 10 < chunkBytes`，标签写作「体积比 chunk 小**两个数量级**」——
 * ① 标签**错**（代码是 **10×**，不是 100×）；② 它在实测下**恒红**（主 53,014 B × 10 = 530,140 > chunk
 * 447,255 B），而**同一门里真正想要的实质判据一直是绿的**（主 bundle 里 xterm 指纹 **0** 命中）。
 * 用一条「比例」代理去表达「xterm 不许进主包」，既写错了量级、又把**合法功能增长**（007 只读态 +
 * 002 guide 入口进主包）误判成违规。
 *
 * **新口径（三条，全部可二值判定）**：
 * ① `XTERM_PURITY_CHECK_NAME` —— **直接判据**：主 bundle 不含 xterm 实现（指纹 `@xterm/xterm` + `.xterm-viewport`）。
 * ② `INLINED_REACT_CHECK_NAME` —— **直接判据**：主 bundle 不含**内联 React**（指纹见 `INLINED_REACT_MARKER`）。
 * ③ `MAIN_SIZE_CHECK_NAME` —— **明确上限**：`mainBytes <= MAIN_BUNDLE_LIMIT_BYTES`（**含等号**）。
 *
 * **「chunk 显著大于主 bundle」降为软提示**（`report.measurements.sizeHint`）：它是**记账**，
 * **不参与** `ok` / `failures` —— 因为「主 bundle 是否合法」与「chunk 有多大」没有逻辑蕴含关系。
 *
 * **上限的推导与「何时须重定」**见 `MAIN_BUNDLE_LIMIT_RATIONALE`（同一段文字也抄进契约 §P2 的变更记录）。
 */

import { INLINED_REACT_MARKER, makeChecks } from './lib/loader-harness.mjs';

/** 直接判据 ①（名字**逐字**沿用旧门，避免下游引用漂移） */
export const XTERM_PURITY_CHECK_NAME = '主 bundle: 不含 xterm 实现（指纹：模块名 + xterm 自己的 CSS 选择器；§P2 内联的是 chunk）';
/** 直接判据 ②（名字**逐字**沿用旧门） */
export const INLINED_REACT_CHECK_NAME = '主 bundle: react **没有**被打进包（内联标记不存在）';
/** 明确上限（名字里显式写出数值，且**不含**已作废的旧标签字样 —— 便于用「名字里不得再出现该字样」做二值断言） */
export const MAIN_SIZE_CHECK_NAME = '主 bundle: 体积 ≤ 明确上限 64 KiB（§P2：直接判据 + 数值上限，取代旧的比例代理判据）';

/** 上限 = **64 KiB = 65,536 B**（主人 2026-10-12 候选值，经构成与成长证据核算后采纳） */
export const MAIN_BUNDLE_LIMIT_BYTES = 64 * 1024;

/**
 * 上限的**推导**（可复算：见 `client-contract.md` §P2 的 2026-10-12 变更记录）——
 * 实测（`node scripts/build-client.mjs` 后读 `lib/client.js`，两次构建逐字节一致）：
 *   · 主 bundle **53,014 B**（构成：007 配置页族 34,530 B = 65.1%；002 标签壳 9,984 B = 18.8%；
 *     `row-rules` 4,596 B = 8.7%；终端薄壳 2,483 B = 4.7%；esbuild 包装/helper 1,421 B = 2.7%）
 *   · 懒加载 chunk **447,255 B**（xterm 内联其中）⇒ 主/chunk = **1:8.44**
 *   · 成长史：11,037（Phase 4）→ 43,537（Phase 6）→ 44,317 → 46,866 → **53,014**（HEAD，2026-10-12）；
 *     最大**单次**交付增量 = **+6,148 B**
 *   · 已交付面（002/007/009）**无**待进主 bundle 的客户端工件 ⇒ 余量只须容纳「同类细化的 1–2 次」
 * 取 64 KiB ⇒ 余 **12,522 B**（≈ 当前体积的 23.6%、≈ 最大单次增量的 **2.04×**）。
 * **这不是物理规律，只是当前证据下的合理值**；下列任一发生即**必须**改契约 + 追加留痕后重定：
 *   ① 002 / 007 / 009 的**新**客户端面要进主 bundle（P1 及「下一期」不在本 Spec 面内）；
 *   ② `mainBytes` 触到上限（此时**先拆**：把配置页族改懒加载 chunk，§E 允许，再谈抬上限）；
 *   ③ 余量 < 一次「同类细化」的实测增量（当前 ≈ 6 KB）时——不得先塞后抬。
 */
export const MAIN_BUNDLE_LIMIT_RATIONALE =
  '64 KiB = 65,536 B；实测主 bundle 53,014 B（余 12,522 B ≈ 最大单次交付增量 +6,148 B 的 2.04×）；超限即须拆分（配置页族 → 懒加载 chunk），重定条件见本段。';

/** 指纹命中清单（空数组 = 主 bundle 干净）；**返回清单**而不是布尔，便于报出「命中了哪几个」 */
export function xtermFingerprintHits(source) {
  return ['@xterm/xterm', '.xterm-viewport'].filter((marker) => source.includes(marker));
}

/**
 * §P2 三条不变量的**唯一实现**（门与变异哨兵用例共用 ⇒ 用例验的就是真门，不是影子实现）。
 * 入参是「读数」，所以可以用**人造读数**证明它不是恒真（超限 ⇒ 红）。
 */
export function mainBundleInvariantChecks(mainSource, mainBytes, chunkBytes = 0) {
  const { checks, check } = makeChecks();
  const hits = xtermFingerprintHits(mainSource);
  check(
    XTERM_PURITY_CHECK_NAME,
    hits.length === 0,
    `命中=${JSON.stringify(hits)}（@xterm/xterm=${mainSource.includes('@xterm/xterm')} .xterm-viewport=${mainSource.includes('.xterm-viewport')}）`,
  );
  check(INLINED_REACT_CHECK_NAME, !mainSource.includes(INLINED_REACT_MARKER), INLINED_REACT_MARKER);
  const headroom = MAIN_BUNDLE_LIMIT_BYTES - mainBytes;
  check(
    MAIN_SIZE_CHECK_NAME,
    mainBytes <= MAIN_BUNDLE_LIMIT_BYTES,
    `主 ${mainBytes} B / 上限 ${MAIN_BUNDLE_LIMIT_BYTES} B（余 ${headroom} B）；软提示（**非判据**）chunk=${chunkBytes} B`,
  );
  return checks;
}
