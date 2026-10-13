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
 *
 * ## 🔴 2026-10-12 扩面留痕（上面原文**一字未删**，只追加）
 *
 * 主人同日二次裁定「**§P2 三条判据适用于三包**（一宿主批不两套标准）」⇒ `wsl-docker-ports` 的
 * 主 bundle 也要判同样三条。而本仓既有规矩是「**不许各自解释口径**」（先例：`export-surface.mjs`
 * 三包共用、`strip-comments.mjs` 两门共用）⇒ **判据本体已提到**
 * [`packages/wsl-shared/scripts/lib/p2-main-bundle.mjs`](../../wsl-shared/scripts/lib/p2-main-bundle.mjs)，
 * 本文件改为对它的**薄转发**：**本包全部公开出口的名字与语义逐字不变**（`verify-client-loader.mjs`
 * 的再导出、`verify-client-loader.d.mts` 的手写声明、`tests/unit/client-artifacts.test.ts` 的按名断言
 * **一律不用改**）；**上限数值改从 SSoT 表取**
 * （[`main-bundle-budgets.mjs`](../../wsl-shared/scripts/main-bundle-budgets.mjs) 的
 * `dsh-terminal-profiles` 行 = **65,536 B / `nature: 'hard'`**，与契约文档的机器可读表逐字段绑定）。
 */

import { MAIN_BUNDLE_BUDGETS } from '../../wsl-shared/scripts/main-bundle-budgets.mjs';
import {
  INLINED_REACT_CHECK_NAME,
  XTERM_PURITY_CHECK_NAME,
  mainBundleInvariantChecks as runInvariantChecks,
  mainSizeCheckName,
  xtermFingerprintHits,
} from '../../wsl-shared/scripts/lib/p2-main-bundle.mjs';

/** 本包在 SSoT 表里的登记行（上限**不是**本文件硬编码的常量 ⇒ 改上限必须改表 + 改文档 + 留痕） */
const BUDGET = MAIN_BUNDLE_BUDGETS['dsh-terminal-profiles'];

/** 直接判据 ①（名字**逐字**沿用旧门，避免下游引用漂移） */
export { XTERM_PURITY_CHECK_NAME };
/** 直接判据 ②（名字**逐字**沿用旧门） */
export { INLINED_REACT_CHECK_NAME };
/** xterm 指纹命中清单（**唯一实现**在共享模块里） */
export { xtermFingerprintHits };

/**
 * 明确上限（名字里显式写出数值，且**不含**已作废的旧标签字样 —— 便于用「名字里不得再出现该字样」做二值断言）
 * ⚠️ 值来自 SSoT 表（**不是**本文件的字面量）：65,536 = 64 KiB。
 */
export const MAIN_BUNDLE_LIMIT_BYTES = BUDGET.limitBytes;
export const MAIN_SIZE_CHECK_NAME = mainSizeCheckName(BUDGET.limitBytes);

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
 * ⚠️ 上面这段推导是**只由本包**的构成与成长史得出的 ⇒ 它**不是**「三包通行的推导值」（扩面留痕见文件头）。
 */
export const MAIN_BUNDLE_LIMIT_RATIONALE =
  '64 KiB = 65,536 B；实测主 bundle 53,014 B（余 12,522 B ≈ 最大单次交付增量 +6,148 B 的 2.04×）；超限即须拆分（配置页族 → 懒加载 chunk），重定条件见本段。';
//
// ⚠️ 2026-10-12 重建后实测订正（原记一字不删，仅追加）：主 bundle 53,756 B / 余 11,780 B
//    （原记 53,014 B / 12,522 B；依据 = stack-decision-changelog.md #53）。
//    上面 RATIONALE 字面量保持原样 = #50 的推导记录；本包上限 65,536 B 未动。

/**
 * §P2 三条不变量的**本包入口**（位置参数签名**逐字不变** ⇒ 既有调用方与用例不用改）。
 * 实现 = 共享模块里的唯一一份 `mainBundleInvariantChecks`，预算 = 本包在 SSoT 表里的登记行
 * ⇒ 门与变异哨兵用例**验的就是真门**，且三包共用同一份判据**不复制**。
 * 入参是「读数」，所以可以用**人造读数**证明它不是恒真（超限 ⇒ 红）。
 */
export function mainBundleInvariantChecks(mainSource, mainBytes, chunkBytes = 0) {
  return runInvariantChecks({ mainSource, mainBytes, chunkBytes, budget: BUDGET });
}
