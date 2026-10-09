/**
 * 去注释（001 两道自检门共用：`check-size.mjs` 算体积、`check-scope.mjs` 扫越界词汇）
 *
 * ## 为什么要共用一份
 *
 * 两道门都必须「只看代码、不看注释」：体积不能把注释算进去（2026-10-08 主人拍板的口径），
 * 越界词汇扫描也不能被注释里的领域词误伤（`net.ts` 的注释里就有 `portproxy`）。
 * 各写一份正则 = 迟早漂移，而漂移的症状是**一道门悄悄失去判据**（本项目在守卫逻辑上已吃过
 * 同款亏：`execInDistro` 抽出来的理由就是「守卫分叉迟早漏一次」）⇒ 只留这一份。
 *
 * ## 两个模式的差别（唯一差别，必须显式选）
 *
 * - 默认（`keepLines: false`）：块注释**连内部换行一起删** ⇒ 输出只用来数**字节**。
 * - `keepLines: true`：块注释按内部换行数替换成等量 `\n` ⇒ **行号与原文一一对应**，
 *   供越界扫描报出真实行号。
 *
 * 体积口径不受影响：`check-size` 最后会 `trim()` 后丢掉空行，两种模式算出的字节数相同
 * （已实测：25,859 字节，与抽出前逐字节一致）。
 *
 * ## 已知局限（如实记录，不粉饰）
 *
 * 正则启发式，不是 AST（NFR-1：不引依赖）。字符串字面量里的 `//` 有 `(^|[^:])` 保护
 * （`https://` 不会被当注释起点），但字符串里的 `/*` 之类仍可能被误删。检查对象是
 * **本包自己的 8 个源文件**、形状受控，故接受该局限；若将来出现误判，先补用例再改正则。
 */

/** 块注释（非贪婪，跨行）；`keepLines` 时保留内部换行数，保证行号不漂 */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** 行注释；`(^|[^:])` 保护 `https://` 这类 `//` 不当成注释起点 */
const LINE_COMMENT = /(^|[^:])\/\/[^\n]*/g;

const countNewlines = (text) => {
  let count = 0;
  for (const char of text) if (char === '\n') count += 1;
  return count;
};

/**
 * @param {string} source 源码原文
 * @param {{ keepLines?: boolean }} [options] `keepLines: true` ⇒ 保留块注释占用的行数（行号不漂）
 * @returns {string} 去注释后的文本
 */
export function stripComments(source, options = {}) {
  const keepLines = options.keepLines === true;
  return source
    .replace(BLOCK_COMMENT, (block) => (keepLines ? '\n'.repeat(countNewlines(block)) : ''))
    .replace(LINE_COMMENT, '$1');
}
