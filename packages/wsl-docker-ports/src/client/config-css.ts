/**
 * 017：配置页的样式（**只在 chunk 里**注入，不占主包棘轮）。
 *
 * 主包 `styles.ts` 的 `PAGE_CSS` 是右栏页那套常驻样式；配置页自己的版式有 40 多行，
 * 塞进主包会把 `lib/client.js` 顶过棘轮地板（实测 +4 754 B）⇒ 搬到 chunk，
 * 挂载时注入、卸载时移除，和 `styles.ts` 同一手法（`data-plugin` 查重 + disposer）。
 *
 * 版式**逐条抄宿主的插件设置表单**（`@deepseek-ai/dsh-client-ui-primitives` 的
 * `lib/settings-form/fields.module.css` 与 `SettingsForm.module.css`；2026-10-27 读实物核对）：
 *
 *   field  = flex 纵向 gap 6px / padding 12px 0，相邻 field 之间 0.5px `border-l2` 分隔线
 *   label  = 13px / 500 / `label-primary`
 *   input  = 高 34 / padding 0 12 / 0.5px `border-l4` / `radius-md` / `bg-layer-3` / 13px
 *   hint   = 12px / `label-tertiary`
 *   footer = flex gap 8 / padding-top 16，左边状态字右边保存钮
 *   save   = `label-primary` 底 / `bg-layer-3` 字 / `radius-md` / 5px 14px / disabled 透明度 .4
 *
 * ⚠️ 旧版这里写的是 `--dsw-alias-border-primary` / `--dsw-alias-bg-accent` 之类的**不存在的名字**
 * （宿主主题里的真实 token 是 border-l1..l4 / bg-layer-1..3 / label-primary|secondary|tertiary /
 * state-*-primary / radius-xs|sm|md|lg|xl|panel），于是全部回落到 `currentColor` / `transparent`
 * —— 这就是「丑」的根因：没有层次、没有圆角、没有分隔。现在一律用**真名**，颜色只从主题取
 * （零 hex，NFR-7 不变）。
 */

export const STYLE_ID = 'dsh-wsl-docker-ports/config';
/** 当前有几个消费者共享这张表（侧栏页 / 配置内页 / 写通道面板） */
let configStyleRefs = 0;

export const CONFIG_CSS = `/* ── 017：bundle 级配置页（卡片页「描述与组件行之间」）──────────────────────────
 * 版式**逐条抄宿主的插件设置表单**（「@deepseek-ai/dsh-client-ui-primitives」 的
 * 「lib/settings-form/fields.module.css」 与 「SettingsForm.module.css」；2026-10-27 读实物核对）：
 *
 *   field  = flex 纵向 gap 6px / padding 12px 0，相邻 field 之间 0.5px border-l2 分隔线
 *   label  = 13px / 500 / label-primary
 *   input  = 高 34 / padding 0 12 / 0.5px border-l4 / radius-md / bg-layer-3 / 13px
 *   hint   = 12px / label-tertiary
 *   footer = flex gap 8 / padding-top 16，左边状态字右边保存钮
 *   save   = label-primary 底 / bg-layer-3 字 / radius-md / 5px 14px / disabled 透明度 .4
 *
 * ⚠️ 旧版这里写的是 --dsw-alias-border-primary / --dsw-alias-bg-accent 之类的**不存在的名字**
 * （宿主主题 dsh-client-ui-theme 里的真实 token 是 border-l1..l4 / bg-layer-1..3 /
 * label-primary|secondary|tertiary / state-*-primary / radius-xs|sm|md|lg|xl|panel），
 * 于是全部回落到 currentColor / transparent —— 这就是「丑」的根因：没有层次、没有圆角、
 * 没有分隔。现在一律用**真名**，颜色只从主题取（零 hex，NFR-7 不变）。
 */
.wdp-cfg { display: flex; flex-direction: column; color: var(--dsw-alias-label-primary, inherit); font-size: 13px; line-height: 1.5; }
/* 017 六订·六（主人 2026-10-27：「写通道预演 只读事实层 这两个的css保持和其他一致」）：
   两块都改成与其他项同构的 field；控件竖向排、原文占满整行。 */
/* 017 六订·八（主人 2026-10-27：「原始输出 这个标签离上面再远点」）：它与上面的保存条之间留足呼吸（28 → 52 px，主人连说两次「再远点」） */
.wdp-cfg-raw { margin-top: 52px; }
/* 主人 2026-10-27：「点击查看原始输出的时候下拉一个窗口展开里面是内容」⇒ 展开区是一块面板 */
.wdp-cfg-raw-panel { display: flex; flex-direction: column; align-self: stretch; max-width: 100%; max-height: 260px; overflow: auto; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.wdp-cfg-raw-panel .wdp-pre { margin: 0; }
/* 两行按钮：主标题一行 + 括号部分一行；括号整体不断行（模板字符串里不写反引号） */
/* 凭据 + 复制按钮一行：凭据吃剩余宽度（可断行不撑破），按钮不缩不换行 */
.wdp-once-row { display: flex; align-items: center; gap: 8px; }
.wdp-once-code { flex: 1 1 auto; min-width: 0; margin: 0; }
.wdp-once-code .wdp-pre { display: block; max-width: 100%; overflow-x: auto; white-space: pre; overflow-wrap: normal; }
.wdp-once-copy { flex: none; white-space: nowrap; }
.wdp-btn-stacked { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; height: auto; min-height: 34px; padding: 5px 14px; line-height: 1.35; text-align: center; }
.wdp-btn-stacked > .wdp-btn-sub { white-space: nowrap; }
.wdp-cfg-field-body { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.wdp-cfg-field-body .wdp-pre { align-self: stretch; max-width: 100%; }
.wdp-cfg-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.wdp-cfg-field + .wdp-cfg-field { border-top: 0.5px solid var(--dsw-alias-border-l2, transparent); }
.wdp-cfg-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wdp-cfg-label { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); }
.wdp-cfg-tag { flex: none; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); }
.wdp-cfg-sublabel { font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.wdp-cfg-presets { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 2px 0; }
.wdp-cfg-preset { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.wdp-cfg-issues { margin: 0; padding: 6px 10px; list-style: none; display: flex; flex-direction: column; gap: 4px; border: 0.5px solid var(--dsw-alias-state-error-primary, currentColor); border-radius: var(--dsw-radius-sm, 6px); font-size: 12px; color: var(--dsw-alias-state-error-primary, inherit); }.wdp-cfg-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); overflow-wrap: anywhere; }
.wdp-cfg-hint-error { color: var(--dsw-alias-state-error-primary, inherit); }
.wdp-cfg-scopes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
.wdp-cfg-scopes > li { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; line-height: 1.5; }
.wdp-cfg-scopes > li + li { border-top: 0.5px solid var(--dsw-alias-border-l2, transparent); }
.wdp-cfg-scope-port { flex: none; width: 64px; color: var(--dsw-alias-label-primary, inherit); font-variant-numeric: tabular-nums; }
.wdp-cfg-scope-value { color: var(--dsw-alias-label-secondary, inherit); }
.wdp-cfg-inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wdp-cfg-callout { display: flex; flex-direction: column; gap: 10px; margin: 4px 0 0; padding: 12px; border: 0.5px solid var(--dsw-alias-border-l2, transparent); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2, transparent); }
.wdp-cfg-callout-text { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, inherit); overflow-wrap: anywhere; }
.wdp-cfg-callout-actions { display: flex; align-items: center; gap: 8px; }
.wdp-cfg-footer { display: flex; align-items: center; gap: 8px; padding-top: 16px; border-top: 0.5px solid var(--dsw-alias-border-l2, transparent); }
.wdp-cfg-footer-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wdp-cfg-status { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); }
/* 017 三订：写通道预演在配置页里的宿主表单语法（标签在上 / 34px 控件 / 无内层卡片标题）。
   右栏页那张独立卡片仍走 wdp-card（variant=card），这套只作用于 variant=field。 */
.wdp-cfg-write { display: flex; flex-direction: column; gap: 10px; }
.wdp-cfg-write .wdp-cfg-label { flex: none; }
.wdp-cfg-rows { display: flex; flex-direction: column; gap: 10px; }
.wdp-cfg-row { display: flex; flex-direction: column; gap: 6px; }
.wdp-cfg-btn { appearance: none; align-self: flex-start; box-sizing: border-box; height: 34px; padding: 0 14px; border: 0.5px solid var(--dsw-alias-border-l4, currentColor); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-3, transparent); font: inherit; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); cursor: pointer; }
.wdp-cfg-btn:hover:not([disabled]) { border-color: var(--dsw-alias-border-l2, currentColor); }
.wdp-cfg-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, currentColor)); outline-offset: 1px; }
.wdp-cfg-btn[disabled] { opacity: 0.4; cursor: default; }
.wdp-cfg-notice { margin: 0; padding: 6px 10px; border: 0.5px solid var(--dsw-alias-state-error-primary, currentColor); border-radius: var(--dsw-radius-sm, 6px); font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-error-primary, inherit); overflow-wrap: anywhere; }
/* 计划 / 回执：配置页里是一块内嵌面板（0.5px 边 + layer-2 底），不再是第二张 wdp-card */
.wdp-cfg-plan .wdp-card { border: 0.5px solid var(--dsw-alias-border-l2, currentColor); border-radius: var(--dsw-radius-md, 8px); padding: 10px 12px; background: var(--dsw-alias-bg-layer-2, transparent); }
.wdp-cfg-plan .wdp-card > h3 { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary, inherit); }
/* 计划面板里的按钮跟配置页同一套尺寸（原来是右栏页那套 2px 内边距的小按钮，贴在 34px 控件下面像缩水了） */
.wdp-cfg-plan .wdp-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, currentColor)); outline-offset: 1px; }`;

/** 挂载时注入、返回移除器；同一 id 的旧节点先摘掉（重复挂载不产生第二份） */
export function installConfigStyles(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  // 017 六订·二十一：**引用计数**，不再"先删后插"。
  // 侧栏页与配置内页共用同一张表 ⇒ 谁后挂载就把前者的节点删掉、前者卸载时再删自己的，
  // 结果两边都没样式（实测：从配置页返回右栏，两行按钮与凭据行版式一起消失）。
  // 现在：第一个消费者进来插一次，最后一个离开摘一次。
  const selector = `style[data-plugin="dsh-wsl-docker-ports/config"]`;
  let style = document.querySelector(selector) as HTMLStyleElement | null;
  if (style === null) {
    style = document.createElement('style');
    style.dataset['plugin'] = STYLE_ID;
    style.textContent = CONFIG_CSS;
    document.head.append(style);
  }
  configStyleRefs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    configStyleRefs -= 1;
    if (configStyleRefs <= 0) {
      configStyleRefs = 0;
      style?.remove();
    }
  };
}