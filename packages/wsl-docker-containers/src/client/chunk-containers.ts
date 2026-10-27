/**
 * **容器侧 chunk 入口**（015 `P4`）—— esbuild 的**第三个**入口 ⇒ `lib/client.containers.js`
 *
 * 与转发侧 chunk 同形：自注册成 `window.__ModuleLoader__.load({ id, chunk: "client.containers.js", factory })`，
 * 由主包里那一次 `require.async('./client.containers.js')` 取走。
 *
 * ## 边界纪律（与 `chunk-ports.ts` 同一条）
 *
 * - 这里**只**导出两个组件：`ContainersPane` / `ContainersConfigPage`；其余全靠在它们下面的
 *   静态 import 关系自动进 chunk（`./containers/pane.tsx` → `source.ts`；`config-page.tsx`）。
 * - **不许** import 主包侧注册壳（`index.ts` / `write-channel` / `settings-pipe` 的**值**）：
 *   `runtime.ts` 只 `import type` 了 `SettingsPipe` ⇒ 编译后零边。
 * - **不许**把它加进 `package.json` 的 `exports`（chunk 走 `require.async`）。
 * - 产物名 `client.containers.js` 与主包 `CONTAINERS_CHUNK` 常量**必须一致**。
 */

export { ContainersPane } from './containers/pane.tsx';
export { ContainersConfigPage } from './containers/config-page.tsx';