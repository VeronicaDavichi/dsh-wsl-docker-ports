/**
 * **渲染面 chunk 入口**（011 `T1.2`，2026-10-13）
 *
 * 这个文件是 esbuild 的**第二个入口**（`scripts/build-client.mjs` 的 `chunkOutfile`）：
 * 产物 `lib/client.ports.js` 自注册成 `window.__ModuleLoader__.load({ id, chunk: "client.ports.js", factory })`，
 * 由主包里那一次 `require.async('./client.ports.js')` 取走。
 *
 * ## 只放「懒加载边界另一侧的根」
 *
 * 这里**只**再导出 `PortsPane` —— 其余全部靠静态 import 关系自动进 chunk：
 * `pane.tsx` → `pane-tables` / `pane-settings` / `write-panel` → `write-confirm` / `write-result`
 * → `page.ts` → `rows.ts`（视图装配部分）→ `drift-fix.ts` → `../write/index.ts`（写路径内核）。
 * 换句话说：**切分点是 import 图上的边，不是这个文件里的清单** ⇒ 新增组件只要挂在 `pane.tsx`
 * 下面，就自动留在 chunk 侧，不会悄悄涨主包。
 *
 * ## 边界纪律（改这个文件前先读）
 *
 * - **不许**在这里 `import` 主包侧模块（`index.ts` 的注册壳、`write-channel` / `write-token` /
 *   `settings-pipe`）—— 那会把常驻面复制进 chunk（chunk 侧体积翻倍、收益为零）。
 * - **不许**把它加进 `package.json` 的 `exports`：chunk 走 `require.async` 取，不进 `exports`
 *   （§P2 / 假设 A-2，官方终端页同形）。
 * - 产物名 `client.ports.js` 与主包 `PANE_CHUNK` 常量**必须一致**，改名两边同改。
 */

export { PortsPane } from './pane.tsx';
/**
 * 010 `T7.3` → 017 六订·六：**行级**配置页（点「WSL Port Forwarding」那一行进去的页面）。
 * 与右栏页同住这个 chunk —— 主包棘轮零余量，任何 UI 都只能长在 chunk 侧。
 * 组合包卡片页不再挂配置页（主人原话：「内页有了的外页就不需要了」）。
 */
/** 017 六订·五：**行级**配置页（点「WSL Port Forwarding」那一行进去的页面）= 属于本插件的各项 + 原始输出 */
export { RowConfigPage } from './config-row-page.tsx';
/** 017 六订·七：**组合包卡片页**只放两个组件共用的 `目标发行版` */
export { BundleConfigPage } from './config-bundle-page.tsx';
