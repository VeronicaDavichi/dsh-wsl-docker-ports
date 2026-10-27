/**
 * 右栏页的**滚动修复**（010 真机反馈 2026-10-22：「没法滚动，下面的东西看不到」）。
 *
 * 实测根因（真机 DOM）：宿主把本页挂进一个 **`height: 0`** 的 div，再外面那层 `tabBody`
 * 是 `overflow: hidden` ⇒ 3,532 px 的内容被整块裁掉，**连滚动条都不产生**。
 *
 * 为什么在这里而不是 `styles.ts`：
 * ① 只在本页挂载时生效，别的页零影响；
 * ② 主包棘轮是地板（SSoT 49,183 B，零余量）—— 往主包 CSS 里加字节会直接判红，
 *    这段逻辑落在 chunk 侧，主包一个字节不涨。
 */

import { useEffect, type RefObject } from 'react';

/** 让「零高包装盒 + 本页根」一起撑满，并让**本页根**成为滚动容器 */
export function usePageScrollFix(rootRef: RefObject<HTMLElement | null>, dependency: unknown): void {
  useEffect(() => {
    const root = rootRef.current;
    const host = root?.parentElement;
    if (!root || !host) return;
    host.style.height = '100%';
    host.style.minHeight = '0';
    root.style.height = '100%';
    root.style.minHeight = '0';
    root.style.overflowY = 'auto';
    root.style.boxSizing = 'border-box';
  }, [rootRef, dependency]);
}
