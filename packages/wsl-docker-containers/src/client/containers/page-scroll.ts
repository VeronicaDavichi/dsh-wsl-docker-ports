/**
 * 右栏页的高度策略（017 六订·二十，**与转发侧 `pane-scroll.ts` 同一手法**）。
 *
 * 主人 2026-10-28（P7）：「缺少全页纵向滚动条」。
 *
 * 现象：容器页内容比面板高，但页面被宿主的零高包装盒 + `overflow: hidden` 祖先裁住 ⇒ 看不见滚动条、
 * 也滚不动（只能看到第一屏）。做法：本页根按**自然高度**长、零内层滚动；往上找第一层非
 * `visible` 的祖先，把它设成可滚 ⇒ 全页**只有一条**滚动条，且在壳上。
 */

import { useEffect, type RefObject } from 'react';

/** 往上最多找几层（宿主外壳嵌套深度稳定在 3–4 层） */
const MAX_ANCESTOR_WALK = 6;

export function usePageScrollFix(rootRef: RefObject<HTMLElement | null>, dependency: unknown): void {
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    root.style.height = 'auto';
    root.style.minHeight = '0';
    root.style.overflowY = 'visible';
    root.style.boxSizing = 'border-box';

    const host = root.parentElement;
    if (host !== null) {
      host.style.height = 'auto';
      host.style.minHeight = '0';
    }

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
