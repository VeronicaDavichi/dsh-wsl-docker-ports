/**
 * 懒加载 chunk 入口（002 T4.2 / REQ-5.1 / NFR-2）—— **本文件是唯一静态 import 真 `@xterm/*` 的地方**。
 *
 * 产物形态（与官方 `dsh-client-ui-sidebar-terminal` 的 chunk 逐字同构，见 `client-contract.md` §P2）：
 *   `window.__ModuleLoader__.load({ id: "dsh-terminal-profiles", chunk: "client.terminal.js", factory: (require) => { … } })`
 *   ⇒ 由 `scripts/build-client.mjs` 的 banner/footer 包成自注册工厂，`exports` 里**不列**这个文件（§P3）。
 *
 * 🔴 **xterm 内联在 chunk 里**（不是宿主 external）：`@xterm/xterm` / `@xterm/addon-fit` 走 esbuild 正常打包；
 *    `xterm.css` 以**文本**内联（`loader: { '.css': 'text' }`），再在**视图挂载时**注入 —— 官方 chunk 的做法
 *    正是 `createElement("style")` + `dataset.plugin`（且官方 README 明写 *CSS injection 必须发生在 factory 闭包内*）。
 *
 * ⚠️ 本文件里**不得**出现 `react-dom`（组件由宿主渲染，本包不建 root；§P4）。
 */

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import xtermCss from '@xterm/xterm/css/xterm.css';

import { installStyleTag, resolveDocument, XTERM_CSS_TAG_ID } from './styles.ts';
import { createTerminalBody } from './xterm-body.tsx';
import type { XtermTerminalOptionsLike } from './xterm-body.tsx';

/**
 * 注入内联的 `xterm.css`（tagId = `dsh-terminal-profiles/xterm.css`，与官方那份**不同值** ⇒ 互不覆盖）。
 * 返回移除器；**调用点在视图挂载时**（不在模块顶层）⇒ 符合「injection 在 factory 闭包内」。
 */
export function installXtermStyles(doc: Document | undefined = resolveDocument()): { dispose(): void } {
  if (doc === undefined) return { dispose: () => undefined };
  return installStyleTag(doc, XTERM_CSS_TAG_ID, xtermCss);
}

/** 真正的 xterm 视图组件（真 `Terminal` / 真 `FitAddon` / 真内联 CSS 由这里注入） */
export const TerminalBody = createTerminalBody({
  createTerminal: (options: XtermTerminalOptionsLike) => new Terminal({ ...options }),
  createFitAddon: () => new FitAddon(),
  installStyles: () => {
    installXtermStyles();
  },
});
