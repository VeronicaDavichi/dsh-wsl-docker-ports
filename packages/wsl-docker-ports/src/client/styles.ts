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

export const STYLE_ID = 'dsh-wsl-docker-ports/styles';
export const ROOT_CLASS = 'wdp-page';

/** 只用宿主 token，零硬编码颜色（回落值也刻意不是 hex —— 否则「零 hex」断言会变成文字游戏） */
export const PAGE_CSS = `
.wdp-page { color: var(--dsw-alias-label-primary, inherit); font-size: 13px; line-height: 1.6; padding: 8px 10px; display: flex; flex-direction: column; gap: 10px; }
.wdp-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wdp-muted { color: var(--dsw-alias-label-tertiary, inherit); }
.wdp-secondary { color: var(--dsw-alias-label-secondary, inherit); }
.wdp-card { border: 1px solid var(--dsw-alias-border-primary, currentColor); border-radius: 6px; padding: 8px 10px; background: var(--dsw-alias-bg-layer-1, transparent); }
.wdp-card > h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.wdp-gate { border-left: 3px solid var(--dsw-alias-state-warning, currentColor); }
.wdp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wdp-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border-top: 1px solid var(--dsw-alias-border-secondary, currentColor); padding: 4px 0; }
.wdp-table { width: 100%; border-collapse: collapse; }
.wdp-table th, .wdp-table td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--dsw-alias-border-secondary, currentColor); vertical-align: top; }
.wdp-tag { border: 1px solid var(--dsw-alias-border-primary, currentColor); border-radius: 999px; padding: 0 6px; font-size: 12px; }
.wdp-tag-ok { color: var(--dsw-alias-state-success, inherit); }
.wdp-tag-warn { color: var(--dsw-alias-state-warning, inherit); }
.wdp-tag-danger { color: var(--dsw-alias-state-danger, inherit); }
.wdp-tag-muted { color: var(--dsw-alias-label-tertiary, inherit); }
.wdp-pre { background: var(--dsw-alias-bg-layer-2, transparent); border-radius: 4px; padding: 6px 8px; overflow-x: auto; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; }
.wdp-btn { font: inherit; padding: 2px 8px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-primary, currentColor); background: var(--dsw-alias-bg-layer-2, transparent); color: inherit; cursor: pointer; }
.wdp-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.wdp-btn-primary { background: var(--dsw-alias-bg-accent, transparent); border-color: var(--dsw-alias-border-accent, currentColor); }
.wdp-field { display: flex; flex-direction: column; gap: 4px; }
.wdp-inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wdp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px 10px; }
.wdp-error { color: var(--dsw-alias-state-danger, inherit); }
/* 017：bundle 级配置页（卡片页「描述与组件行之间」）—— panel → section(h4) → field，底部一条保存行 */
.wdp-cfg { display: flex; flex-direction: column; gap: 12px; padding: 4px 2px; }
.wdp-cfg > h3 { margin: 0; font-size: 14px; font-weight: 600; }
.wdp-cfg-section { border: 1px solid var(--dsw-alias-border-secondary, currentColor); border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.wdp-cfg-section > h4 { margin: 0; font-size: 13px; font-weight: 600; }
.wdp-cfg-field { display: grid; grid-template-columns: minmax(96px, max-content) 1fr; gap: 4px 10px; align-items: center; }
.wdp-cfg-field > span:last-child { grid-column: 2; }
.wdp-cfg-save { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border-top: 1px solid var(--dsw-alias-border-secondary, currentColor); padding-top: 8px; }
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
    ctx.effect(() => remove, 'dsh-wsl-docker-ports: styles');
  }
  return remove;
}
