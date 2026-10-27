/**
 * 右栏页的高度策略（010 真机反馈 → **2026-10-27 主人改成「长条结构」**）。
 *
 * 010 的旧做法：把本页根变成 `overflow-y: auto` 的**内层滚动容器** —— 那时宿主把本页挂进一个
 * `height: 0` 的 div、外层 `tabBody` 又是 `overflow: hidden`，不这样内容整块看不见。
 *
 * 🔴 主人 2026-10-27：「所有的纵向滚轮都不应该存在，因为我是长条结构，不够的就应该自动向下扩展」
 * ⇒ 本页根改为**自然高度**（`height: auto` / `overflow-y: visible`），页面内容多高就多高；
 * 滚动**只允许**发生在宿主自己的滚动盒子上（往上找到第一层非 `visible` 的祖先，把它设成可滚）。
 * 这样只有**一条**滚动条、且在壳上，页面内部一个内层滚轮都没有。
 */

import { useEffect, type RefObject } from 'react';

/** 往上最多找几层（宿主外壳的嵌套深度稳定在 3–4 层；再深就不是滚动盒了） */
const MAX_ANCESTOR_WALK = 6;

/** 让本页按自然高度向下长，把「滚动」这件事交回宿主壳 */
export function usePageScrollFix(rootRef: RefObject<HTMLElement | null>, dependency: unknown): void {
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    // ① 本页根：自然高度、零内层滚动
    root.style.height = 'auto';
    root.style.minHeight = '0';
    root.style.overflowY = 'visible';
    root.style.boxSizing = 'border-box';

    // ② 宿主的零高包装盒：让它随内容长（010 的 height:100% 会把内容裁在那一格里）
    const host = root.parentElement;
    if (host !== null) {
      host.style.height = 'auto';
      host.style.minHeight = '0';
    }

    // ③ 最近的滚动盒子（第一层 overflowY 非 visible 的祖先）→ 交给它滚；找不到就退回文档根
    let node = host?.parentElement ?? null;
    for (let depth = 0; depth < MAX_ANCESTOR_WALK && node !== null; depth += 1) {
      if (getComputedStyle(node).overflowY !== 'visible') {
        node.style.overflowY = 'auto';
        return;
      }
      node = node.parentElement;
    }
    document.documentElement.style.overflowY = 'auto';
  }, [rootRef, dependency]);
}