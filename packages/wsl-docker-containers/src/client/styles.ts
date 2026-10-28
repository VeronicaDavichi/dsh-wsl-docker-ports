/**
 * 样式注入（003 NFR-7；contract §E / §P4）
 *
 * ## 三条硬约束
 *
 * 1. **CSS 注入必须发生在 factory 闭包内**（材质化时执行）—— 顶层副作用不在 `loadCache` 语义内
 *    （官方 README 逐字，contract §P4-4）。所以本文件只**导出**函数，注入由 `apply()` 调用。
 * 2. **作用域靠类名前缀 + 宿主主题变量**：全部选择器带 `.wdp-` 前缀（唯一 `wdp-page` 根），
 *    颜色一律 `var(--dsw-alias-*)`。测试静态断言：**CSS 文本里零 `#rrggbb`**（NFR-7）。
 * 3. **查重 → 注入 → 返回移除器**：重复挂载不产生第二个 `<style>`，卸载时精确移除自己那个
 *    （与 `ctx.effect` 的 disposer 语义对齐）。
 *
 * ⚠️ 未验项：`--dsw-alias-*` 的**具体 token 名**在本机读不到官方源码（悬空 junction）
 * ⇒ 全部写成 `var(--token, 非 hex 回落)`。名字写错时表现为「颜色回落」，不会崩，但**真机需目视核对**。
 */

import type { ClientContextLike } from './host.ts';

export const STYLE_ID = 'dsh-wsl-docker-containers/styles';
export const ROOT_CLASS = 'wdp-page';

/** 只用宿主 token，零硬编码颜色（回落值也刻意不是 hex —— 否则「零 hex」断言会变成文字游戏） */
export const PAGE_CSS = `
  /* 017 六订·十五：控件/按钮/标签/提示走 chunk 的 .wdp-cfg-*（与配置内页同一份）；这里只留骨架，颜色只取宿主真名 token */
.wdp-containers { display: flex; flex-direction: column; gap: 10px; padding: 0 12px 12px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); }
.wdp-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wdp-token-row { flex-wrap: nowrap; }
.wdp-token-row > .wdp-cfg-input { flex: 1 1 auto; min-width: 0; width: auto; }
.wdp-token-row > .wdp-cfg-btn { flex: none; }
.wdp-toolbar { gap: 8px; }
.wdp-tab-title { font-weight: 500; }
.wdp-muted { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); }
.wdp-note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); }
.wdp-warn { margin: 0; padding: 6px 10px; border-left: 2px solid var(--dsw-alias-state-warn-primary, currentColor); font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, inherit); }
.wdp-danger { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-error-primary, inherit); }
.wdp-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
.wdp-table th { text-align: left; padding: 4px 6px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, inherit); border-bottom: 0.5px solid var(--dsw-alias-border-l2, transparent); }
.wdp-table td { text-align: left; padding: 4px 6px; vertical-align: middle; border-bottom: 0.5px solid var(--dsw-alias-border-l2, transparent); }
.wdp-table tbody tr:last-child td { border-bottom: none; }
.wdp-actions { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.wdp-pre { margin: 0; padding: 8px 10px; border: 0.5px solid var(--dsw-alias-border-l2, transparent); border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-layer-2, transparent); white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; overflow-x: auto; }
.wdp-logs { display: flex; flex-direction: column; gap: 6px; }
.wdp-notes { margin: 0; padding-left: 18px; font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); }
`;

/** `document.querySelector` / `createElement` 的最小面（测试用假 doc 注入，生产走真 document） */
export interface StyleDocumentLike {
  querySelector(selector: string): { remove(): void } | null;
  createElement(tagName: string): { textContent: string; dataset: Record<string, string>; remove(): void };
  head: { append(node: unknown): void };
}

/**
 * 注入样式，返回**移除器**。重复调用（第二次挂载）会先移除同名旧节点，保证只有一份。
 * `doc` 缺省 = 全局 `document`（生产）；测试传假件，零 DOM 也能断言「注入了什么、移除了什么」。
 */
export function installStyles(doc?: StyleDocumentLike): () => void {
  const target = doc ?? (globalThis as { document?: StyleDocumentLike }).document;
  if (target === undefined) return () => undefined;

  const existing = target.querySelector(`style[data-plugin="${STYLE_ID}"]`);
  existing?.remove();

  const style = target.createElement('style');
  style.dataset['plugin'] = STYLE_ID;
  style.textContent = PAGE_CSS;
  target.head.append(style);

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    style.remove();
  };
}

/**
 * `apply()` 里收编样式生命周期的唯一入口。
 * 没有 `ctx.effect`（宿主降级 / 测试的极简 ctx）时**仍然注入**并返回移除器，只是没人自动收编
 * —— 比「静默不注入样式」更可诊断。
 */
export function installStylesWith(ctx: ClientContextLike, doc?: StyleDocumentLike): () => void {
  const remove = installStyles(doc);
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => remove, 'dsh-wsl-docker-containers: styles');
  }
  return remove;
}
