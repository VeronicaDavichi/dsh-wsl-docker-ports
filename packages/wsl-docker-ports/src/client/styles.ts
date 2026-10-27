/**
 * 样式注入（003 NFR-7；contract §E / §P4）
 *
 * ## 三条硬约束
 *
 * 1. **CSS 注入必须发生在 factory 闭包内**（材质化时执行）—— 顶层副作用不在 loadCache 语义内
 *    （官方 README 逐字，contract §P4-4）。所以本文件只**导出**函数，注入由 apply() 调用。
 * 2. **作用域靠类名前缀 + 宿主主题变量**：全部选择器带 .wdp- 前缀（唯一 wdp-page 根），
 *    颜色一律 var(--dsw-alias-*)。测试静态断言：**CSS 文本里零 #rrggbb**（NFR-7）。
 * 3. **查重 → 注入 → 返回移除器**：重复挂载不产生第二个 <style>，卸载时精确移除自己那个
 *    （与 ctx.effect 的 disposer 语义对齐）。
 *
 * ## 版式（2026-10-27 主人：「把侧边栏的 css 也调整成配置页这种样式吧」）
 *
 * 右栏页此前是「1px 边框 + layer-1 底色的卡片堆」，配置页是宿主插件设置表单那套语法
 * ——两者视觉语言不统一。现在右栏页**逐条对齐配置页**（同一批 token、同一套尺寸）：
 *
 *   段落 `.wdp-sec` = 宿主的 field：纵向 gap 6 / 上下 padding 12，
 *                    相邻段落之间 **0.5px `border-l2`** 细分隔线（不再是独立卡片框）
 *   标题 `h3`      = 13px / 500 / `label-primary`（配置页 `.wdp-cfg-label` 同款）
 *   控件 `.wdp-input` = 高 34 / padding 0 12 / 0.5px `border-l4` / `radius-md` / `bg-layer-3`
 *   按钮 `.wdp-btn`   = 0.5px `border-l4` / `radius-sm` / `bg-layer-3`；`.wdp-save` 用主色填充
 *   提示 `.wdp-muted` = 12px / `label-tertiary`
 *   内嵌面板 `.wdp-card` = 0.5px `border-l2` + `radius-md` + `bg-layer-2`
 *                        （与配置页「计划 / 回执」那块完全同款：写通道、回执、确认框用它）
 *
 * ⚠️ `--dsw-alias-*` 的**具体 token 名**按宿主主题（`dsh-client-ui-theme`）的实物核对过；
 * 名字写错时表现为「颜色回落 currentColor / transparent」，不会崩，但**真机需目视核对**。
 * 颜色仍只从主题取（零 hex 不变，回落值也刻意不是 hex）。
 */

import type { ClientContextLike } from './host.ts';

export const STYLE_ID = 'dsh-wsl-docker-ports/styles';
export const ROOT_CLASS = 'wdp-page';

/**
 * 右栏页样式表：与配置页（`config-css.ts` 的 CONFIG_CSS）同一套宿主表单语法。
 *
 * 🔴 **体积纪律**：这是**主包**里的字符串，本包主 bundle 有「棘轮地板 56,350 B（只降不升）」的硬账
 * （`packages/wsl-shared/scripts/main-bundle-budgets.mjs` 的 SSoT）⇒ 下面刻意压缩：
 * 共用声明合并成多选择器、tone 类只改 `color`（边框走 `currentColor`）、
 * `outline` 只写一遍。省下的字节不是「少写样式」，是**同一个样式只写一次**。
 */
export const PAGE_CSS = `
.wdp-page { display: flex; flex-direction: column; padding: 0 12px 12px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); }
.wdp-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2, transparent); }
.wdp-muted { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); }
.wdp-secondary { color: var(--dsw-alias-label-secondary, inherit); }
.wdp-sec { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; border-top: 0.5px solid var(--dsw-alias-border-l2, transparent); overflow-x: auto; }
.wdp-page > .wdp-sec:first-of-type { border-top: none; }
.wdp-sec > h3, .wdp-card > h3 { margin: 0; font-weight: 500; line-height: 1.5; }
.wdp-sec > h3 { font-size: 13px; color: var(--dsw-alias-label-primary, inherit); }
.wdp-card > h3 { font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.wdp-gate { border-left: 2px solid var(--dsw-alias-state-warn-primary, currentColor); padding-left: 10px; }
.wdp-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l2, currentColor); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2, transparent); }
.wdp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wdp-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 0; border-top: 0.5px solid var(--dsw-alias-border-l2, transparent); }
.wdp-row:first-child { border-top: none; }
.wdp-table { width: 100%; min-width: 460px; border-collapse: collapse; font-size: 12px; }
.wdp-table th { text-align: left; padding: 4px 6px; font-size: 11px; font-weight: 500; color: var(--dsw-alias-label-secondary, inherit); border-bottom: 0.5px solid var(--dsw-alias-border-l4, transparent); white-space: nowrap; }
.wdp-table td { text-align: left; padding: 4px 6px; vertical-align: middle; border-bottom: 0.5px solid var(--dsw-alias-border-l2, transparent); }
.wdp-table tbody tr:last-child td { border-bottom: none; }
/* 窄栏（真机 380–420px）里的表格：按钮不许折成一字一行；放不下就横向滚动 */
.wdp-table .wdp-btn { max-width: 132px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wdp-table select.wdp-btn { max-width: 116px; }
.wdp-tag { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border: 0.5px solid currentColor; border-radius: 999px; font-size: 11px; line-height: 1; white-space: nowrap; color: var(--dsw-alias-label-secondary, inherit); }
.wdp-tag-ok { color: var(--dsw-alias-state-success-primary, inherit); }
.wdp-tag-warn { color: var(--dsw-alias-state-warn-primary, inherit); }
.wdp-tag-danger { color: var(--dsw-alias-state-error-primary, inherit); }
.wdp-tag-muted { color: var(--dsw-alias-label-tertiary, inherit); }
.wdp-pre { margin: 0; padding: 8px 10px; border: 0.5px solid var(--dsw-alias-border-l2, transparent); border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-layer-2, transparent); overflow-x: auto; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.6; }
.wdp-input, .wdp-btn, .wdp-save { appearance: none; box-sizing: border-box; font: inherit; cursor: pointer; }
.wdp-input { width: 100%; height: 34px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l4, currentColor); border-radius: var(--dsw-radius-md, 8px); background-color: var(--dsw-alias-bg-layer-3, transparent); font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); }
.wdp-input:hover:not(:disabled), .wdp-btn:hover:not([disabled]) { border-color: var(--dsw-alias-border-l2, currentColor); }
.wdp-input:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary, currentColor); }
.wdp-input:disabled { color: var(--dsw-alias-label-tertiary, inherit); cursor: default; }
select.wdp-input { padding-right: 32px; background-image: linear-gradient(45deg, transparent 50%, var(--dsw-alias-label-tertiary, currentColor) 50%), linear-gradient(135deg, var(--dsw-alias-label-tertiary, currentColor) 50%, transparent 50%); background-position: calc(100% - 17px) 15px, calc(100% - 12px) 15px; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; }
.wdp-input.wdp-cfg-input-plain { padding: 0 12px; background-image: none; }
.wdp-input.wdp-textarea { height: auto; min-height: 74px; padding: 8px 12px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.6; background-image: none; }
.wdp-btn { height: 28px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l4, currentColor); border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-layer-3, transparent); font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); }
.wdp-btn[disabled] { opacity: 0.4; cursor: default; }
.wdp-btn-primary { border-color: transparent; background: var(--dsw-alias-label-primary, currentColor); color: var(--dsw-alias-bg-layer-3, transparent); }
.wdp-card .wdp-btn { height: 30px; padding: 0 12px; font-size: 13px; }
.wdp-save { flex: none; border: 1px solid transparent; border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px; font-size: 13px; line-height: 1.5; background: var(--dsw-alias-label-primary, currentColor); color: var(--dsw-alias-bg-layer-3, transparent); }
.wdp-save[disabled] { opacity: 0.4; cursor: default; }
.wdp-textbtn { appearance: none; border: none; background: none; padding: 0; font: inherit; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary, inherit); cursor: pointer; }
.wdp-textbtn:hover:not([disabled]) { color: var(--dsw-alias-label-primary, inherit); }
.wdp-textbtn[disabled] { cursor: default; opacity: 0.5; }
.wdp-btn:focus-visible, .wdp-save:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, currentColor)); outline-offset: 1px; }
.wdp-field { display: flex; flex-direction: column; gap: 4px; }
.wdp-inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wdp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px 12px; font-size: 12px; }
.wdp-listen { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.wdp-error { color: var(--dsw-alias-state-error-primary, inherit); }

`;

/** `document.querySelector` / `createElement` 的最小面（测试用假 doc 注入，生产走真 document） */
export interface StyleDocumentLike {
  querySelector(selector: string): { remove(): void } | null;
  createElement(tagName: string): { textContent: string; dataset: Record<string, string>; remove(): void };
  head: { append(node: unknown): void };
}

/**
 * 注入样式，返回**移除器**。重复调用（第二次挂载）会先移除同名旧节点，保证只有一份。
 * doc 缺省 = 全局 document（生产）；测试传假件，零 DOM 也能断言「注入了什么、移除了什么」。
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
 * apply() 里收编样式生命周期的唯一入口。
 * 没有 ctx.effect（宿主降级 / 测试的极简 ctx）时**仍然注入**并返回移除器，只是没人自动收编
 * —— 比「静默不注入样式」更可诊断。
 */
export function installStylesWith(ctx: ClientContextLike, doc?: StyleDocumentLike): () => void {
  const remove = installStyles(doc);
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => remove, 'dsh-wsl-docker-ports: styles');
  }
  return remove;
}
