/**
 * 客户端样式注入与移除（002 T4.2 / REQ-5.2 / REQ-5.5 / NFR-4）
 *
 * 📌 **契约来源 = 实物**（`client-contract.md` §E15 + §P2 的官方终端页 chunk 逐字）：
 *   - 做法：CSS 字符串 → 查重 → `<style data-plugin="<id>">` → 返回**移除器**，由 `ctx.effect` 收编；
 *   - 官方终端页 chunk 的原样写法：`document.querySelector("style[data-plugin-css=" + … + "]")` 查重后
 *     `document.createElement("style")` + `tag.dataset.plugin = "<包名>"` + `head.appendChild`；
 *   - 作用域手段 = **类名前缀**（本包 `dtp-`）+ **宿主主题变量** `var(--dsw-alias-*)`。
 *
 * 🔴 **两条硬约束**：
 *   ① **零硬编码 hex**（只用宿主 token；REQ-5.5）—— 单测逐字符扫本文件的 CSS 常量；
 *   ② **注入动作只能发生在函数体内**（官方 README：*CSS injection 必须发生在 factory 闭包内*）
 *      ⇒ 本模块顶层**不得**触碰 `document`；自检脚本用「materialize 时 document 访问计数 = 0」钉这一条。
 *
 * ⚠️ 本文件**不含 xterm.css**：那是官方终端页 **chunk** 才会注入的东西（`terminal-chunk.ts` 用同一个
 * `installStyleTag` + 另一个 tagId 注入），主 bundle 里连 xterm 的 CSS 都不该出现。
 */

/** 自有样式的 tagId（查重键；与官方终端页的 `"<包名>/xterm.css"` 同构但**不同值** ⇒ 互不覆盖） */
export const STYLE_PLUGIN_ID = 'dsh-terminal-profiles/styles';

/** 内联的 xterm.css 用的 tagId（由 chunk 注入；与官方那份的 tagId 不同 ⇒ 两份共存不打架） */
export const XTERM_CSS_TAG_ID = 'dsh-terminal-profiles/xterm.css';

/**
 * 自有样式（类名前缀 `dtp-`）。
 * ⚠️ 只用**已实证**的两个宿主 token：`--dsw-alias-bg-layer-1` / `--dsw-alias-label-primary`
 * （§E15 的原始证据）；不发明第三个 token 名 —— 未定义的 `var()` 在浏览器里会退化成 `inherit`，
 * 那是「看着像能用、其实没生效」的典型。
 */
export const TERMINAL_PANE_CSS = [
  '.dtp-pane{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
  '.dtp-title{color:var(--dsw-alias-label-primary)}',
  '.dtp-surface{flex:1 1 auto;min-height:0;overflow:hidden}',
  '.dtp-status{display:flex;align-items:center;justify-content:center;height:100%;padding:12px;color:var(--dsw-alias-label-primary);font-size:12px}',
  '.dtp-status-error{white-space:pre-wrap;word-break:break-word}',
].join('\n');

export interface StyleInstallation {
  readonly tagId: string;
  /** 真的注入进文档 ⇒ true；没有文档可注入 ⇒ false（`reason` 非空，且**不抛**） */
  readonly installed: boolean;
  readonly reason?: string | undefined;
  /** 幂等移除器（未注入时是 no-op） */
  dispose(): void;
}

const noop = (): void => undefined;

/**
 * 取宿主文档。浏览器里必有；Node 单测 / 自检脚本里没有 ⇒ 返回 `undefined`（调用方降级，不抛异常）。
 * ⚠️ 这个函数是**唯一**允许触碰 `document` 全局的地方。
 */
export function resolveDocument(): Document | undefined {
  return typeof document === 'undefined' ? undefined : document;
}

/**
 * 注入一个带 `data-plugin` 标记的 `<style>`（同 tagId 先清后插 ⇒ 幂等，不会堆积重复节点）。
 * 返回移除器：只移除**自己那一个**节点，重复调用是 no-op。
 */
export function installStyleTag(doc: Document, tagId: string, css: string): StyleInstallation {
  const existing = doc.querySelector(`style[data-plugin="${tagId}"]`);
  if (existing !== null) existing.remove();
  const tag = doc.createElement('style');
  tag.dataset.plugin = tagId;
  tag.textContent = css;
  doc.head.append(tag);
  let alive = true;
  return {
    tagId,
    installed: true,
    dispose: () => {
      if (!alive) return;
      alive = false;
      tag.remove();
    },
  };
}

/** 移除某个 tagId 的样式节点（不存在 ⇒ no-op；**按 tagId 现查现删** ⇒ 也能删掉 chunk 后来注入的那个） */
export function removeStyleTag(doc: Document, tagId: string): boolean {
  const existing = doc.querySelector(`style[data-plugin="${tagId}"]`);
  if (existing === null) return false;
  existing.remove();
  return true;
}

/** 注入自有样式（`styles.ts` 的对外入口；由客户端入口的 `ctx.effect` 收编） */
export function installTerminalStyles(doc: Document | undefined = resolveDocument()): StyleInstallation {
  if (doc === undefined) {
    return {
      tagId: STYLE_PLUGIN_ID,
      installed: false,
      reason: '当前环境没有 document（Node 单测 / 自检脚本）：样式未注入，其余注册照常。',
      dispose: noop,
    };
  }
  const own = installStyleTag(doc, STYLE_PLUGIN_ID, TERMINAL_PANE_CSS);
  return {
    tagId: STYLE_PLUGIN_ID,
    installed: true,
    /**
     * 插件的样式收尾**必须**同时收掉 chunk 内联的 xterm.css（它由视图挂载时才注入 ⇒ 这里只能现查）。
     * 漏掉它 = 卸载后文档里留一个孤儿 `<style>`（REQ-12.2 的「不残留」含样式节点）。
     */
    dispose: () => {
      own.dispose();
      removeStyleTag(doc, XTERM_CSS_TAG_ID);
    },
  };
}
