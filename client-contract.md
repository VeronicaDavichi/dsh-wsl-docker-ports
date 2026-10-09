# 客户端半契约（DSH 插件 · 只读研究，2026-10-09）

> **用途**：002（受管终端：右栏页 + 配置页）与 003（P0 页面）实现**客户端半**时的唯一口径。
> **证据等级**：全部为**实物**（本机已装第三方插件的 `package.json` / `lib/client.js` 产物 / 官方 **0.1.7-rc.2 离线 tarball** 内的 `.d.ts`），逐条带 `文件:行`。
> ⚠️ **版本落差**：官方 tarball 是 **0.1.7-rc.2**，本仓钉的是 **0.2.0-rc.2** ⇒ 凡标 `[0.1.7]` 的条目**必须在 0.2.0-rc.2 上复验**（已登记为真机项，见 §Z）。
> ⚠️ **为什么宿主源码读不到（实物原因，不再是猜测）**：`~/.dsh/.../node_modules/@deepseek-ai/*` 在本机是**悬空 junction**（指向已删除的临时目录）⇒ 直接读不到；`app.asar` 禁读。可用替代 = 官方离线 tarball `E:\NodeProjects\dsh-desktop\vendor\dsh-runtime\0.1.7-rc.2\*.tgz`（含 `dsh-client-ui-sidebar-right` / `-ui-slots` / `-ui-renderer` / `dsh-client-modules` 等）。

## 0. 结论速览（每条一句「影响」）

1. **清单三件**：`dsh.client = { platform: 'web', inject: [模块包名…], immediately? }` + `exports['./client'] → ./lib/client.js` + `dsh.bundle.patch` ⇒ 我们两个包**都还没接客户端半** ⇒ 右栏页与配置页在真机上**不会出现**（T0.5 此刻只能验宿主半）。
2. `dsh.client.inject` 是**客户端模块包名**数组（可空），**不是** cordis 服务名；**服务名在入口的 `export const inject`**（我们 = `['slots']`）。
3. 客户端入口导出 = `{ apply, inject, name? }` —— **没有默认导出**（与宿主半 `export default { name, inject, apply, Config }` **相反**，别照抄）。
4. 产物 = **自注册 CJS 工厂**：`window.__ModuleLoader__.load({ id, factory })`，`factory = (require) => { … return module.exports }`；`id` 用**包名**（我们行 id == 包名 == `dsh-terminal-profiles` ⇒ 无歧义）。
5. `require` 由**宿主注入** ⇒ `react` / `react/jsx-runtime` / `react-dom*` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-*` / `ui-primitives` **必须 external**；**未声明的 require 会静默崩**（有官方 verify 脚本为例）。
6. 页 / 面板 / 配置页**全部走 `ctx.slots`**（`slots.inject` 等槽 + `slots.register`，返回 disposer）；**没有** `ctx.pages`。
7. **右栏页** = `sidebarRightTabs.register(SidebarRightTabDefinition)` + 两个 keyed seat（`sidebar.right.pane.tab` / `…title`，key = `definition.id`）；`priority` **缺省即 `'extension'` 档**（正好是我们要的）；**同 band 重复注册、或 `id` 重复 ⇒ 抛错**。
8. **新增页类型只需客户端半**（宿主半零改动）⇒ 002 Phase 4 不必碰 `src/index.ts`。
9. **配置写管道首选** `ctx.get('remote.settings').update(ns, patch, expectedRevision)`（读 = `describe()`）；**自建 exact HTTP 路由是并存补充**（给大动作 / 非配置读，不是唯一管道）。
10. **样式** = CSS 字符串 → 注入 `<style data-plugin="<pkg>/styles">` → 返回移除器，由 `ctx.effect` 收编；作用域靠**类名前缀 + 宿主主题变量** `var(--dsw-alias-*)`。
11. 🔴 **两条未验证且直接改我们方案**：① ~~**xterm 独立懒加载 chunk 的做法**~~ ⇒ ✅ **已定案（见 §P2）：官方终端页就是这么做**（主 bundle 19,887 B + `require.async("./client.terminal.js")` 取 685,949 B chunk）；② **「官方恰好 6 个 kind」无实物支撑** ⇒ ✅ **已定案：0.1.7-rc.2 实测 9 个，且 kind 是开放字符串**（见 §P1）。

## A. 清单面

### A1 `dsh.client` 字段集（5 个第三方实例 + 2 个官方包）
- `dsh-desktop\dsh-community-market\package.json:39-53`：
  `"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-locale","…-ui-layout","…-ui-renderer","…-ui-settings","…-ui-sidebar"], "platform": "web" }, "bundle": { "patch": "./cordis.patch.yml" } }`
- `dsh-whale-pet\package.json:58-80` · `DeepSeekHarness-MCP-Manager\package.json:53-67` · `dsh-leanspec\package.json:42-52` 同形。
- **[0.1.7] 官方** `@deepseek-ai/dsh-client-modules/package.json`：`"dsh":{"client":{"platform":"web","inject":[],"immediately":true}}`；`dsh-client-ui-renderer` 同为 `immediately: true`。
- ⇒ **字段集 = `platform`（实测仅 `'web'`）+ `inject`（string[]，可空）+ `immediately`（boolean，可缺省）**；`client` 内**没有** `entry`/`bundle`/`patch`（后者属 `dsh.bundle`）。

### A2 客户端入口键
- `dsh-community-market\package.json:28-31`：`"./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }`；whale-pet / mcp-manager / leanspec / `[0.1.7] sidebar-right` 同键。
- 反例：安装版 `dshmarket` 用 `./client/client.js`（**键同、路径不同**）⇒ **路径是约定不是契约**。

### A3 产物格式（CJS 工厂 + 自注册）
- 逐字原文：`…\node_modules\dshmarket\client\client.js:1` = `window.__ModuleLoader__.load({ id: "dshmarket", factory: (require) => {`
- 第二例：`…\@luweiyabo\dsh-whale-pet\lib\client.js:1681-1685`（`id: '@luweiyabo/dsh-whale-pet'`，`factory: (require2) => {`）
- 第三例（TS 源直出）：`dsh-leanspec\scripts\build.mjs:20` `format: 'cjs'` + `:31-36` banner `window.__ModuleLoader__.load({ id: "dsh-leanspec", factory: (require) => {` / footer `return module.exports; } });`
- CJS 的配置证据：`dsh-community-market\tsdown.config.ts:10` `format: 'cjs'`、`:32` `entryFileNames: 'client.js'`。
- **反例（别照抄）**：whale-pet 用 esbuild `format: 'iife'`（`scripts\build-client.mjs:12`）⇒ 只要**执行时自注册**，iife 也被接受；但宿主的**文档化契约是 CJS**（`mcp-manager\lib\client.js:1` 注释自称 *"web bundle, ModuleLoader CJS format"*）⇒ 我们取 **CJS**。
- 我们本仓已核对：`stack-decision.md` 记的「esbuild → CJS client bundle」**正确，不需要改栈** ✓

### A4 打包器与 external（无强制打包器，但 external 必须对）
- 打包器在野三种：esbuild（leanspec / whale-pet）、tsdown（community-market）、**零构建手写入库**（mcp-manager，`package.json:32` 只有 `tsc`）。
- external 原文：`dsh-community-market\tsdown.config.ts:17-30`（`react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-locale/client` / `-store` / `-ui-layout/client` / `-ui-primitives` / `-ui-settings/client` / `-ui-sidebar/client` / `-ui-slots`）；`dsh-leanspec\scripts\build.mjs:24-30`（前五项）。
- **未声明 external 的 `require` 会静默崩**：`dsh-community-market\scripts\verify-client-externals.mjs:40-43` ⇒ 我们照它加一个 `scripts/verify-client-*.mjs` 自检。

## B. 入口形状与会话面

### B5 导出三件套（无默认导出）
- `dsh-community-market\src\client\index.ts:24` `export const inject = ['slots','locale']`；`:27` `export function apply(ctx: ClientContext): void {`
- `dsh-leanspec\src\client\index.ts:9,11,13`：`inject = ['slots']` + `name = 'leanspec-web-viewer-client'` + `apply(ctx)`
- 纯 CJS 形态：`@luweiyabo\dsh-whale-pet\lib\client.js:6098-6100` `exports.apply = apply; exports.inject = inject; exports.name = name;`
- 官方 d.ts 背书：`@agents-anywhere\dsh-bridge-next\lib\client.d.ts` `declare const inject: string[]; declare function apply(ctx: Context): void; export { apply, inject };`

### B6 `apply(ctx)` 实际能拿到什么（真实调用点）
| 能力 | 证据 |
| --- | --- |
| `ctx.slots.inject(name, fn)` / `ctx.slots.register(opts, Comp)` | `dsh-community-market\src\client\index.ts:32,40,48` · `whale-pet\src\client\index.js:4849,4874` · `leanspec\src\client\index.ts:41` |
| `ctx.locale.register(ns,{zh,en})` / `.bind` / `.getLocale()` | `dsh-community-market\src\client\index.ts:29,30,36` |
| `ctx.effect(cb, label)` → disposer | 同上 `:30,31`；`dsh-desktop-next\src\client\index.ts:33,38` |
| `ctx.get('slots'/'locale'/'sidebarRight'/'remote.settings')` 软取 | `mcp-manager\lib\client.js:134`；`whale-pet\src\client\index.js:6020,6027` |
| `ctx.inject([svc…], scope => …)` | `leanspec\src\client\tab-registration.ts:217` |
| `ctx.interval` / `ctx.timeout` | `mcp-manager\lib\client.js:172,176,430,431` |
| `ctx.theme.getTheme()` / `ctx.on('theme/change')` | `dsh-plugin-desktop\src\client\advanced-shell.ts:35-36` |
| `ctx.layout.selectPanel(id)` | `dsh-desktop-next\src\client\index.ts:81` |
⇒ 客户端 `ctx` 就是 cordis `Context`（`get`/`inject`/`effect`/`on` 都在）。

### B7 声明了却缺失的服务 ⇒ **整个客户端插件 load 失败**（不是局部失效）
- `dsh-leanspec\src\client\tab-registration.ts:4-11` 注释原文：*"Those services are internal to the pinned host and only **some** versions provide them, so they are never added to the client entry's module-level `inject` array: a hard dependency that went missing would take the whole client plugin down — popup included."*
⇒ **我们照抄这个保守做法**：入口 `inject` 只放**稳定**的（`['slots']`），内部/版本相关服务一律用 `ctx.get` 软取。

## C. 页类型与扩展槽

### C8 「官方 6 个 kind」**未验证**
- `[0.1.7] dsh-client-ui-sidebar-right\lib\types\client\tab-registry.d.ts`：`readonly kind: string;`（**开放字符串，无枚举**）
- `[0.1.7] dsh-client-ui-layout\lib\types\client\service.d.ts:15`：`export type MainPanelId = Branded<'MainPanelId'>;`
- 第三方只用一个自造值：`dsh-leanspec\src\client\tab-surface.ts:30` `LEANSPEC_TAB_KIND = 'leanspec'`
⇒ 「`managedTerminal` 与官方不冲突」**结构性成立**（kind 开放）；但「官方恰好 6 个」这个**数字**无实物支撑 ⇒ 规格里的该处措辞已降为「不与官方已用 kind 冲突」，数字留给真机 `sidebarRightTabs.entries()` 打印核实。

### C9 注册新页类型的**权威签名** `[0.1.7]`
```ts
export type SidebarRightTabPriority = 'extension' | 'builtin' | 'fallback';
export interface SidebarRightTabDefinition {
  readonly id: string; readonly kind: string;
  readonly multiple?: boolean; readonly keepMounted?: boolean;
  readonly patterns?: readonly string[]; readonly priority?: SidebarRightTabPriority;
  readonly canOpen?: (address: string) => boolean;
  readonly title: (address: string) => string;
  readonly guide?: readonly SidebarRightTabGuideEntry[];
}
register(definition: SidebarRightTabDefinition): () => void;   // 幂等 disposer
```
- 同文件注释原文：*"Defaults to `extension`: a type that says nothing is one from outside the product."*；*"An `extension` may register a kind a `builtin` already holds and takes it over until it unregisters; a second registration in the same band … is a wiring mistake, and so is an `id` already in use."* ⇒ **同 band 重复注册 / 重复 id 会抛错**。
- 真实调用点：`dsh-leanspec\src\client\tab-registration.ts:294-297`；其 definition（`tab-surface.ts:56-62`）**刻意不写 `priority`** ⇒ 落 `extension` 档。

### C10 扩展槽注册式 + 位置名清单
- 注册式（3 实例同形）：`ctx.slots.inject(NAME, () => ctx.slots.register({ name, id|key, order?, label?, locale?, store?, inject? }, Component))`，**返回 disposer**；证据 `dsh-community-market\src\client\index.ts:32-39` · `whale-pet\src\client\index.js:6054-6074` · `leanspec\src\client\tab-registration.ts:288-292`。
- **位置名**（每条有证据；我们只用得到前两条 + `plugins.row.config`）：
  | slot 名 | kind | 证据 |
  | --- | --- | --- |
  | `sidebar.right.pane.tab` | keyed | `[0.1.7] sidebar-right\…\contract\slots.d.ts:53-58`；调用 `leanspec\…\tab-registration.ts:298` |
  | `sidebar.right.pane.tab.title` | keyed | 同上 `:67-72`；调用 `:299` |
  | `sidebar.right.tab.guide` / `.guide.entry` / `.tab.menu.item` | chain/keyed/list | 同 `:78-109` |
  | `rightbar.session` / `rightbar` | single | 同 `:37-45`；`dsh-plugin-desktop\src\client\advanced-shell.ts:48` |
  | `sidebar` / `main` / `shell.overlay` / `root` | single/keyed/list | 同 `:44-49` |
  | `plugins.row.config` | keyed | `mcp-manager\lib\client.js:511`；`whale-pet\src\client\index.js:6076` |
  | `settings.plugins.tab` / `settings.section` / `settings.action` | — | `community-market\…\index.ts:32`；`desktop-next\…\index.ts:79,83` |
  | `conversation.session.header.utilities` | — | `leanspec\src\client\index.ts:41-47` |
⇒ 「右栏」在 API 里有四个名字：服务 `sidebarRight` / seat `sidebar.right.*` / 布局列 `rightbar` / 会话内容槽 `rightbar.session`。

### C11 宿主半**不需要**配合
- 页类型 + 页体 + 标题**全在客户端半注册**（`leanspec\src\client\tab-registration.ts:294-299`；其宿主半 `src/index.ts` 无任何 kind 声明）。
- 只有「要替换整个外壳、拥有 root slot」的插件才在客户端做（`dsh-plugin-desktop\src\client\advanced-shell.ts:43-52` —— 也是**客户端**代码）。
⇒ **002 Phase 4 不动 `src/index.ts`** ✓

## D. 配置页与写管道

### D12 注册 / 打开
- **注册** = 槽注册，无独立 API：`plugins.row.config`（`key = '<包名>#<行 id>'`，`ownerProps.view === 'summary'` 时给一行摘要，否则给整页）—— 证据 `mcp-manager\lib\client.js:511-521` · `whale-pet\src\client\index.js:6076-6095`；另一路线是 `settings.plugins.tab`（`community-market\…\index.ts:32-39`，带 `order`）。
- **打开**：`ctx.layout.selectPanel(id as MainPanelId)`（`dsh-desktop-next\src\client\index.ts:81`）。
- 客户端**没有** `ctx.settings` / `ctx.configEditor`（名字换成了下面的远端服务）。

### D13 写管道（两条并存，**首选服务**）
- 取服务：`whale-pet\src\client\index.js:6020` `getSettings: () => ctx.get('remote.settings')`（**惰性软取**，等远端就绪）
- 形状探测：`whale-pet\src\client\host-api.js:1629-1630` `typeof s?.describe === 'function' && typeof s?.update === 'function'`
- **写**：`host-api.js:1667` `svc.update(ns, patch, expectedRevision)` → `{ ok, value, error }`（`ok !== true` 即抛）
- **读**：`svc.describe()` → `{ ok, value: { namespaces: [{ ns, value }] } }`
- 自建 **exact HTTP** 路由（并存补充，用于大动作/非配置读）：`whale-pet\src\client\index.js:2275` `fetch('/whale-pet/api/actions')` · `mcp-manager\lib\client.js:100-104` `fetch('/dsh-mcp-manager/api', {POST})` · `community-market\src\client\api.ts:42` `fetch('/api/community-market/state')`
⇒ **T6.1（自绘配置页 + 写入管道）改为首选 `remote.settings.update/describe`**（零新路由、零鉴权面），自建路由留给 `cwdLinux` 探测 / 终端动作；但 §2.3 的 **WS 终端流**仍走自建 upgrade（那是高频流，不是配置）。

## E. 懒加载与样式

### E14 懒加载 chunk —— ✅ **已定案（§P2 取代本节结论）**
- **官方终端页做法的逐字证据**：主 bundle `lib/client.js`（**19,887 B**）内 `const LoadedTerminalBody = (0, react.lazy)(async () => ({ default: (await require.async("./client.terminal.js")).TerminalBody }))`，注释逐字 *"Load xterm only after a terminal body is mounted."*；chunk `lib/client.terminal.js`（**685,949 B**）头部 `window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-ui-sidebar-terminal", chunk: "client.terminal.js", factory: (require) => { … } })` ⇒ **宿主 ModuleLoader 支持 chunk**。
- ~~检出的两个打包实例**产物都是单文件**，配置里**无** `manualChunks` / `splitVendorChunk`，且全仓 grep 动态 `import(` **零命中**。~~ ⇒ 该观察**只对那两个第三方插件成立**，**不能**推广成宿主契约（这正是 §P2 记录的方法错误：否定性结论必须取自「做这件事的那个官方包」）。
- 唯一带「加载时机」语义的实物是 `[0.1.7]` 的 `dsh.client.immediately`（`dsh-client-modules` / `-ui-renderer` 均 `true`），**语义未验证**。
⇒ 002 T4.2 的「xterm 独立 chunk」**暂无实物支撑** ⇒ 先按「**单文件 + xterm 进主 bundle 亦可接受**」的降级路径准备，真机验证后再决定（避免为无法验证的优化卡住 Phase 4）。

### E15 样式作用域（有实物，照抄）
- 做法：CSS 字符串 → 查重 → 注入 `<style data-plugin="<pkg>/styles">` → 返回移除器：
  `dsh-community-market\src\client\styles.ts:836-844`（`style.dataset.plugin = STYLE_ID; style.textContent = css; document.head.append(style); return () => style.remove()`），由 `ctx.effect(() => installMarketStyles(), 'community-market: styles')` 收编（`index.ts:31`）。
- 作用域手段 = **类名前缀**（`.dshMarket*` / whale-pet 的 `.wp-root`）+ **宿主主题变量** `var(--dsw-alias-label-primary)` / `var(--dsw-alias-bg-layer-1)`（`styles.ts:11,114-117`）。
- **未见** CSS-in-JS / CSS Modules / `ui-primitives` 的样式原语（`ui-primitives` 只给组件与图标：`MarketSettingsTab.tsx:2-22` 导入 `Button/Input/Modal/Pill/StateDot/Tooltip/Icon*`）。

## F. 我们两个包的**最小可装载客户端半**清单（照实物）

| # | 文件 / 字段 | 照抄来源 |
| --- | --- | --- |
| 1 | `packages/terminal-profiles/src/client/index.ts` = `export const inject = ['slots']` + `export const name = 'dsh-terminal-profiles-client'` + `export function apply(ctx)` | `dsh-leanspec\src\client\index.ts:9-20` |
| 2 | `…/src/client/tab.ts` = `ctx.inject(['sidebarRightTabs','sidebarRight'], scope => …)` → `register({ id: 'dsh-terminal-profiles', kind: 'managedTerminal', title: (a) => …, keepMounted: true })` + 两个 seat | `leanspec\…\tab-registration.ts:217,288-299` |
| 3 | `…/src/client/pane.tsx`（页体）+ 终端视图 | 我们自己的 REQ-4/5 |
| 4 | `…/src/client/styles.ts` = CSS 字符串 + `<style data-plugin="dsh-terminal-profiles/styles">` | `community-market\src\client\styles.ts:836-844` |
| 5 | 构建：**esbuild `format:'cjs'`** + banner/footer 自注册（`window.__ModuleLoader__.load({ id: 'dsh-terminal-profiles', factory })`） | `dsh-leanspec\scripts\build.mjs:20,31-36` |
| 6 | `scripts/verify-client-externals.mjs` 自检（未声明的 `require` 必须报错） | `community-market\scripts\verify-client-externals.mjs:40-43` |
| 7 | `package.json`：`exports["./client"] = "./lib/client.js"` · `dsh.client = { platform:'web', inject:['@deepseek-ai/dsh-client-ui-sidebar-right'], immediately:false }` · `peerDependencies.react = "^18.2.0"` | A1/A2 + `community-market\package.json:289-290` |

## Z. 未验证清单（**不得当成已验**）

| # | 问题 | 为什么验不了 | 怎么验 |
| --- | --- | --- | --- |
| Z1 | 客户端半未被装载时的可观测后果 | 无日志/错误面实物 | 造临时 profile 插件故意写坏 inject，看 `dsh` 日志与页面 console |
| Z2 | `dsh.client.inject` 的宿主消费语义（强制预加载 vs 仅声明） | 装载器在 `app.asar` 内，禁读 | 临时插件里 `require` 一个**未列 inject** 的模块，看是否解析失败 |
| Z3 | `immediately` 布尔语义 | 仅官方 2 包出现，无文档 | 读同 tarball 内 `dsh-client-modules` 的 `lib/client.js` |
| Z4 | 官方 kind 是否恰好 6 个 | kind 是开放字符串；唯一封闭列表在 `app.asar` | 真机 `ctx.sidebarRightTabs.entries()` 打印 kind 列表 |
| ~~Z5~~ | ~~大依赖独立懒加载 chunk~~ | ✅ **已关闭（改判，见 §P2）** | 宿主 ModuleLoader **支持 chunk**：`chunk:` 字段自注册 + `require.async("./x.js")` 取块，官方终端页即此做法（主 19,887 B / chunk 685,949 B）。**残留真机项**：0.2.0-rc.2 的 `require.async` 语义是否与 0.1.7-rc.2 一致（Z6 一并核）|
| Z6 | **0.1.7-rc.2 → 0.2.0-rc.2 的全部差异** | 本机只有 0.1.7-rc.2 tarball | 取 0.2.0-rc.2 同包 tarball 重跑同一探针 |
| Z7 | 「同 band 重复注册 / 重复 id 抛错」在 0.2.0 是否仍成立 | 只有 0.1.7 的 d.ts 注释 | 真机故意重复注册一次看报错 |
| Z8 | 宿主半 `export default` 是否必需（我们在默认导出之外**同时**给了命名导出） | 装载器不可读 | 真机装载即验；两种形态都给我方，风险已对冲 |

---

## P. 🔴 增量修正（同日第二轮回收，**覆盖 §C8 / §E14 / §D13 / §E15 与 §Z 的相应条目**）

> 证据源同前（官方 `0.1.7-rc.2` tgz 只读探针 + `E:\NodeProjects\dsh-desktop` 源码）；版本落差不变：**只对 0.1.7-rc.2 成立**（`vendor\dsh-runtime\0.1.7-rc.2\runtime.json:2` 是 0.2.0-rc.2，但 `resources\` 下除 `app.asar` 外无松散 `dsh-client-ui-*` 文件）。

### P1 官方页类型 kind = **9 个**（**推翻**「6 个」；概念名 = page/tab kind，无 `PageKind` 类型）

| # | kind | 出处（tgz :: member:line） |
| --- | --- | --- |
| 1 | `guide` | sidebar-right :: `lib/types/client/contract/seed.d.ts:26` `GUIDE_KIND = "guide"` |
| 2 | `files` | sidebar-files :: `lib/types/client/definition.d.ts:4` |
| 3 | `browser` | sidebar-browser :: 同上 |
| 4 | `text` | sidebar-documentpreview :: `definition.d.ts:13` `TEXTPREVIEW_KIND` |
| 5 | `changes-review` | deliverables :: `lib/types/client/review-definition.d.ts:13` |
| 6 | `terminal` | **sidebar-terminal** :: `lib/client.js:440` `kind: "terminal"` |
| 7 | `scheduleTask` | schedule :: `lib/types/client/definition.d.ts:15` |
| 8 | `plan` | plan :: `lib/client.js:630` 附近 |
| 9 | `subagentchat` | subagent :: `lib/client.js:808` 附近 |

- 参数表类型名：`SidebarRightTabParamsMap`（sidebar-right :: `…/contract/params.d.ts:28`）。
- `dsh-client-ui-chat` 的 `COMPACT_KIND = "compact-checkpoint"` **未出现在任何注册调用点** ⇒ 是否页类型未验证。
- **`'editor'` / `'diff'` / `'preview'` 作为 kind 全库 grep 0 命中**（不存在）。
- ⚠️ 别混：`kind: 'single'|'keyed'|'list'|'chain'` 是**槽基数**（slots :: `lib/types/index.d.ts:83` `SlotKind`），与页类型无关。
- ⇒ **判据改口**：可证的只有「**0.1.7-rc.2 有 9 个，且 `managedTerminal` 未被任何官方包占用 ⇒ 仍安全**」；「官方恰好 6 个」**无实物支撑**，该数字从规格里撤下（真机 `sidebarRightTabs.entries()` 打印后再写死）。
- ⚠️ 注意第 6 项：官方**已经有一个 `terminal` kind**（`dsh-client-ui-sidebar-terminal`）⇒ 我们选 `managedTerminal` 是对的（**不抢占**官方 kind），且应在设计里写明「与官方 `terminal` 区分」的理由。

### P8 ✅ **可复算的「清单预检」**（把官方准入逻辑搬来离线跑，2026-10-09 实测两包全过）

**做法**：把官方宿主侧 `clientExportOf` 与 `CLIENT_CHUNK` **逐字**搬进一段 node 片段，对自己包的 `package.json` 跑一遍 —— 等于**提前走一遍宿主的准入**，比「看代码猜」可靠。五个判定：

| # | 判定 | 依据 |
| --- | --- | --- |
| ① | `clientExportOf(pkg.name, pkg.exports)` 能解析出 `./lib/client.js` | §P3/P7 的官方函数（形状错会 **throw**） |
| ② | 主产物**文件名恰好 `client.js`** | §P3 `chunkUrl()` 的 `<rowId>/client.js` 断言（不匹配 **throw**） |
| ③ | `dsh.client.platform === 'web'`，`inject`/`external` 若存在则必须是 `string[]` | §P5 权威 schema |
| ④ | `dsh.bundle.patch` 是字符串**且实物存在** | §P7 清单四件套 |
| ⑤ | `lib/` 里除主产物外的 `client.*` 文件名**匹配** `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` | §P3 宿主按需路由准入正则 |

**2026-10-09 实测结果**：`dsh-terminal-profiles`（`inject: []`、`external: []`）与 `dsh-wsl-docker-ports`（`inject: ["@deepseek-ai/dsh-client-ui-sidebar-right"]`）**五项全过**；⑤ 当时两包尚未构建（`lib/` 为空），构后需复跑。
**注意**：`inject` 是**信息性**的（§P5），声明了不 require 的包**不会**被 composition 拒绝；会被拒绝的是 **`external` 里声明的非基线请求缺供给方**。

---

- 🔁 **2026-10-09 12:01 复跑（T6.7 改过 003 清单之后 + Phase 6 改过 002 bundle 之后）**：**002 = 5/5** ✓；**003 = 4/5**，红在 **①**（`exports["./client"]` 解析出 `./lib/client.js` 但**文件不存在**），**⑤** 也因此扫到 0 个产物。⚠️ **这不是缺陷、是构建中间态**：`packages/wsl-docker-ports/lib/` 在 **11:57:04** 被清理（顶层只剩 `index.js` / `plugin.js`），而该包代理此刻（**12:01:09–12:01:21**）仍在改 `src/`。⇒ **本轮结论：002 通过；003 待其收工后复跑**（这是本仓第三次因「代理在飞时测产物」得到假结论 —— 已升格为硬规矩：**产物类判据一律在代理 `inactive` 后跑**）。

### P7 📋 **官方客户端插件的清单参照物**（2026-10-09 六次取证：`dsh-client-ui-sidebar-terminal` 的 package.json）

**证据源**：官方 `deepseek-ai-dsh-client-ui-sidebar-terminal-0.1.7-rc.2.tgz :: package/package.json`（逐字）。这是**唯一一个「官方自己写的浏览器客户端插件」清单**，可直接当我们的比对基准。

```json
{
  "name": "@deepseek-ai/dsh-client-ui-sidebar-terminal",
  "dsh": { "client": {
    "inject": ["@deepseek-ai/dsh-api-terminal-controller","@deepseek-ai/dsh-client-ui-sidebar-right",
               "@deepseek-ai/dsh-api-remotes","@deepseek-ai/dsh-client-ui-theme",
               "@deepseek-ai/dsh-client-shortcuts"],
    "platform": "web" } },
  "exports": {
    ".":        { "types": "./lib/types/index.d.ts",        "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*": "./src/*", "./package.json": "./package.json" },
  "main": "lib/index.js",
  "files": ["lib/index.js", "lib/client.js", "lib/client.*.js", "lib/types/**/*.d.ts"],
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.4" }
}
```

**可照抄的结论**
1. **`exports["./client"]` 形状** = `{ types, default: './lib/client.js' }` ✅ 与我们计划一致；主入口 `.` 同时给 `types`/`default`。
2. 🔴 **`files` 必须覆盖 chunk**：官方写 **`"lib/client.*.js"`** —— **chunk 靠这个 glob 才会进发布包**。我们走 `link:` 交付时不受影响（磁盘上就在 `lib/`），但**将来发布前必须补**（已要求两个代理补 `files`）。
3. **最小化声明**：官方 `dsh.client` **只有 `inject`（包名数组）+ `platform`** —— **没有 `external`、没有 `manifestVersion`、没有 `immediately`** ⇒ 印证「**零非基线 require**」是官方做法（能只依赖基线就不写 `external`）。
4. **`peerDependencies` 只有 cordis**（`~4.0.4`）⇒ react / 各 `@deepseek-ai/dsh-client-*` / xterm **全在 devDependencies**（§P2 的结论在此再次印证）。
5. ⚠️ **别误读**：官方这个包**没有** `dsh.bundle.patch` —— 它是「客户端半」形态；**我们两个包是宿主插件**（要注册服务/工具、要有插件行），所以 **`dsh.bundle.patch` 仍必须保留**，不能因为参照物没有就删。

**rc.1 → rc.2 的差异**（顺带留痕）：`inject` 增加了 `@deepseek-ai/dsh-client-shortcuts`、各 devDep 从 `0.1.7-rc.1` 升到 `rc.2`、版本号变化 —— 即 **`inject` = 所消费的客户端包名清单**（信息性依赖），与 §P5 的类型注释一致。

---

### P6 📊 **跨版本稳定性弱证据**（2026-10-09 五次取证：0.1.7-rc.1 ↔ 0.1.7-rc.2 逐字节对照）

**动机**：我们离线只有 `0.1.7-*` 的 tarball，而宿主基线是 **0.2.0-rc.2**（§Z6 版本差）⇒ 想知道「这套客户端契约是稳定接口，还是某个 rc 的临时形态」。做法：同包两个版本**逐字节 sha256 对照** + 关键片段双版本命中。

| 产物 | rc.1 | rc.2 | 判定 |
| --- | --- | --- | --- |
| `dsh-client-modules :: package/lib/client.js` | 40,277 B | 40,277 B | ✅ **逐字节相同**（sha256 前 12 位 `6fa57df9f122`） |
| `dsh-client-modules :: package/lib/index.js` | 41,704 B | 41,704 B | ✅ 逐字节相同（`03ea21df5562`） |
| `dsh-package-manifest :: package/lib/types/types.d.ts` | 4,169 B | 4,169 B | ✅ 逐字节相同（`8ce89a258667`） |
| `dsh-client-ui-sidebar-terminal :: package/lib/client.js` | 18,073 B | 19,887 B | ❌ 有差异（**插件实现变了**） |
| `dsh-client-ui-sidebar-terminal :: package/package.json` | 2,420 B | 2,520 B | ❌ 有差异 |

| 关键片段 | rc.1 | rc.2 |
| --- | --- | --- |
| 宿主 `CLIENT_CHUNK` 正则 | ✅ | ✅ |
| 宿主 `clientExportOf` 报错文案（`… a string or an object with a string default`） | ✅ | ✅ |
| 浏览器 `chunkUrl` 的 `!== \`${row.id}/client.js\`` 断言 | ✅ | ✅ |
| 浏览器 `chunkId(ownerId, fileName)` | ✅ | ✅ |

**解读（谨慎版）**：**插件在变、宿主契约逐字节没变** ⇒ §P3/§P4/§P5 描述的是**稳定接口**（`CLIENT_CHUNK` 命名规则、`chunkUrl` 的 `client.js` 断言、`exports['./client']` 形状校验、`DshClientManifest` 字段集），不是某个 rc 的偶然形态。
**但这不是真机验证**：① 样本只有 rc.1→rc.2 一步，**不能外推**到 `0.2.0-rc.2`；② 本机 vendor 目录**没有 0.2.0-rc.2 的 tarball**（只有 0.1.5-rc.2 / 0.1.7-alpha.2 / 0.1.7-rc.1 / 0.1.7-rc.2）⇒ **§Z6 / §Z10 的真机项依然成立、依然要做**，本表只用于**排优先级**（先验「产物文件是否被服务」这类形态问题，再怀疑契约本身）。

---

### P5 📌 **权威 manifest schema**（2026-10-09 四次取证：`dsh-package-manifest` 的 `.d.ts` 逐字）

**证据源**：官方 `deepseek-ai-dsh-package-manifest-0.1.7-rc.2.tgz :: package/lib/types/types.d.ts`（**类型定义**，最高证据级）。

```ts
export interface DshClientManifest {
    /** Client platform identifier; the Web consumer selects `web`. */
    platform: string;
    /** Informational package-name dependencies, not Cordis service injection. */
    inject?: string[];
    /** Boot phase-one registration barrier; absent means the shared application batch. */
    immediately?: boolean;
    /**
     * Exact module-table requests beyond the implicit client baseline, including
     * subpaths such as `<pkg>/client`; absent means baseline externals only.
     * Type-only imports are erased and create no module request.
     */
    external?: string[];
}
export interface DshManifest {
    manifestVersion?: 1;                    // 清单格式版本（与 npm/Session 版本无关）
    bundle?: DshBundleManifest;             // { patch: string | string[] } —— 相对**声明包根**
    profile?: DshProfileManifest;           // { bundles?: string[] } —— profile 目录自己的清单
    client?: DshClientManifest;
}
export interface DshPackageManifest {
    name: string; version: string; description?: string;
    icon?: string;        // SVG/PNG/JPEG/WebP，**≤ 256 KiB**，相对本清单目录且 realpath 后仍在其内
    private?: boolean; dependencies?: ...; peerDependencies?: …;
    engines?: { dsh?: string /* SemVer 区间 */, node?: string, npm?: string, [engine: string]: string | undefined };
    dsh?: DshManifest;
}
```

**🔴 两处口径纠正（此前我混为一谈）**
1. **`dsh.client.inject` = 包名列表，且注释逐字说明 *"Informational package-name dependencies, **not** Cordis service injection"*** ⇒ 它是**信息性依赖声明**（官方终端页写的正是包名：`@deepseek-ai/dsh-api-terminal-controller` / `…-client-ui-sidebar-right` / `…-api-remotes` / `…-client-ui-theme` / `dsh-client-shortcuts`）。**它不是 Cordis 服务注入** —— 与之同名但**完全不同**的是**客户端入口模块自己导出的 `inject`**（那是 Cordis 服务名数组，我们 = `['slots']`）。两个 `inject` 不要互相抄。
2. **`immediately`** = *"Boot **phase-one registration barrier**; absent means the shared application batch"* ⇒ 语义定案（原 §Z3 关闭；我们**不写**它 = 走共享批）。

**其它可用于 T0.5 安装接入的字段**：`dsh.manifestVersion = 1`（可选，声明格式版本）· `dsh.bundle.patch` 可为**字符串或有序数组**（相对声明包根）· `engines.dsh` 是 **SemVer 区间**（对 DSH 的兼容声明，读取方是否强制未定）· `private: true` 阻止发布（本仓三包都是 private ✓）。

---

### P4 📌 manifest 的**第四个字段 `dsh.client.external`** + 机制逐字确认（2026-10-09 三次取证）

**证据源**：官方 `deepseek-ai-dsh-client-modules-0.1.7-rc.2.tgz :: package/README.md`（**规范文档**，非推断）。逐字引用：

- L34 `### Declaring a client plugin`：*"A browser plugin package declares `dsh.client` in its `package.json` with `platform: 'web'`, exports a `./client` bundle, and **lists any non-baseline module requests under `dsh.client.external`**. The host half turns each declaration into a served bundle **under `/plugins`**, ordered so dynamic providers load before their consumers."*
- L46 `### Sharing modules`：*"The shell seeds a frozen module table (**`PLATFORM_MODULES`: React, Cordis, and static UI libraries**); every dynamic bundle resolves its externals against exactly that baseline. **`dsh.client.external` adds only exact non-baseline requests**, each answered by the dynamic package row it names or an exact static-table key. **Type-only imports are erased and create no request.** Composition **rejects malformed requests, missing suppliers, self-requests, and synchronous request cycles**."*
- L38：*"A source `import()` split by tsdown compiles to **`require.async("./client.<name>.js")`**; its versioned sibling script arrives only when that expression runs."*（⇒ 与 §P3 的 `client.<name>.js` 正则**互相印证**）
- L38：*"`<id>/client` and the bare id resolve to the same exports, because a plugin bundle is its package's client half."*
- L50 `### Build requirements`：*"The host serves built client bundles, so **`pnpm run build` must have produced each `lib/client.js` before launch**; a missing bundle **fails activation loudly** with one build instruction and a package/path list."*
- L68 `### Lazy-CJS model`：*"Executing a plugin bundle only registers its factory; **every module-body side effect (CSS injection included) lives in the factory closure and runs at materialization** (`factory(require)` → exports, memoized in `loadCache`)."*

**⇒ 对本项目两个客户端半的硬要求（**两个包都适用**）**
1. **manifest 至少四件**：`dsh.client = { platform:'web', inject:[…], external?:[…], immediately? }` + `exports['./client']` + `dsh.bundle.patch` + 构建产物 `lib/client.js`（缺产物 = **激活期响亮失败**）。
2. **require 面越小越好**：基线 = React / Cordis / **静态 UI 库**（官方终端页 require 了 `@deepseek-ai/dsh-client-ui-primitives` 却**没有**写 `external` ⇒ 它属基线）。**非基线的 require 必须逐条写进 `dsh.client.external`**，否则会被 composition **拒绝**（missing supplier）。
3. **不要 require `react-dom`**：我们的组件由宿主渲染进它的树，自己**不建 root** ⇒ 客户端半只需要 `react`（+ `react/jsx-runtime`）。（`react-dom` 只出现在**测试**里。）
4. **CSS 注入必须发生在 factory 闭包内**（材质化时执行），不要在模块顶层做副作用（顶层副作用不在 `loadCache` 语义内）。
5. 自检脚本应断言：**主 bundle 的 require 集合 ⊆（基线 ∪ 清单里声明的 `external`）**，且清单里声明的 `external` **每一条**都真被 require（避免幽灵声明）。

⚠️ 与 §A 的关系：§A 的清单描述**漏了 `external` 字段**，以本节为准；`inject` 与 `external` 是**两件事**（前者 = 客户端服务注入，后者 = 非基线**模块**请求）。

---

### P3 📌 chunk 的**命名与取用规则**（2026-10-09 二次取证，逐字）

**证据源**：官方 `deepseek-ai-dsh-client-modules-0.1.7-rc.2.tgz`（宿主侧 `lib/index.js`、浏览器侧 `lib/client.js`）。

宿主侧 `lib/index.js`：
- `const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;` 注释逐字 *"Published package-local client chunk names **accepted by the on-demand route**."*
- `clientExportOf(pkgName, exportsField)`：`exports["./client"]` 必须是**字符串**或**带字符串 `default` 的对象**，否则 `throw new Error('client-modules: … must be a string or an object with a string default')`。

浏览器侧 `lib/client.js`：
- `function chunkId(ownerId, fileName) { return `${ownerId}/${fileName}`; }`
- `function chunkUrl(row, fileName, rev) { const url = atRevision(row.url, rev); const resourceStart = url.indexOf("/??"); const revisionStart = url.indexOf("&rev=", resourceStart + 3); if ((resourceStart < 0 || revisionStart < 0 ? void 0 : url.slice(resourceStart + 3, revisionStart)) !== `${row.id}/client.js`) throw new Error(`client-modules: cannot resolve chunk ${JSON.stringify(fileName)} from bundle URL ${url}`); return `${url.slice(0, resourceStart)}/${row.id}/${fileName}?${url.slice(revisionStart + 1)}`; }`

**⇒ 推导出的硬要求（我们的构建必须满足，否则运行时才炸）**
1. **主 bundle 的文件名必须恰好是 `client.js`** —— `chunkUrl` 会断言 URL 的资源段等于 `<rowId>/client.js`，不匹配**直接 throw** ⇒ 我们把 `exports["./client"]` 指向 `./lib/client.js` ✅ 正确。
2. **chunk 必须与 `client.js` 同目录（兄弟文件）**，且文件名**必须匹配 `client.<name>.js`**（`<name>` 首字符须为字母/数字）⇒ `lib/client.terminal.js` ✅ 合规；叫 `terminal-chunk.js` ❌ 会被按需路由拒掉。
3. 运行时 chunk URL = **`<base>/<rowId>/<fileName>?rev=<rev>`**（宿主**按需路由**）⇒ **chunk 不出现在 `exports` 里是正常的**，不是遗漏。
4. `require.async("./client.terminal.js")` 的实参就是**兄弟文件名**（URL 由 loader 自己拼），**不要**写绝对/带目录的路径。
5. `exports["./client"]` 形状错会**抛错**（不是静默）⇒ 我们的 `{ "types": …, "default": "./lib/client.js" }` ✅ 合规（字符串形式也合规）。

**新增未验项**：**Z10** 0.2.0-rc.2 是否仍用同一套 `??` 单资源 URL + `&rev=` 结构（真机看一次实际请求即可）；**Z11** 浏览器侧注释提到 *"the runtime mirror of the **build-time bundle purity gate**"* ⇒ 宿主可能另有**构建期 bundle 纯净性门**（未找到实现），真机/构建时留意。

---

### P2 🔴 **已撤回**：原判「独立懒加载 chunk 是逆契约」—— **错**（同日二次取证推翻）

> **本节撤回原 §P2 的结论，并覆盖 §0-11 / §E14 / §Z5 的对应条目。** 下面的机制才是契约。

**为什么错（方法教训，写给未来的自己）**：我只看了 `dsh-plugin-desktop` —— 那是**一个外壳插件自己的选择**（`vite.client.config.ts:41` `codeSplitting: false`），却把它当成**宿主契约**推广；**没有去查「真正做终端页的那个官方包」**。⇒ **否定性结论必须取自「做这件事的那个官方包」，不能从别的插件反推。**

**实证（官方 `deepseek-ai-dsh-client-ui-sidebar-terminal-0.1.7-rc.2.tgz`，逐字）**

- **主 bundle** `package/lib/client.js` = **19,887 B**，其中一行：
  `const LoadedTerminalBody = (0, react.lazy)(async () => ({ default: (await require.async("./client.terminal.js")).TerminalBody }))`
  其注释原文：`/** Load xterm only after a terminal body is mounted. */`
- **懒加载 chunk** `package/lib/client.terminal.js` = **685,949 B**，文件头逐字：
  `window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-ui-sidebar-terminal", chunk: "client.terminal.js", factory: (require) => { var module = { exports: {} }; … } })`
- 该 chunk 内 `@xterm/xterm` / `@xterm/addon-fit` **各命中 1 次**（`FitAddon` ×5）⇒ **xterm 内联进 chunk**，**不是**宿主 external。
- **chunk 文件不在 `exports` 里**（exports 只有 `.` / `./client` / `./src/*` / `./package.json`）⇒ 宿主按**包内相对路径**取它。

⇒ **官方契约 = 小主 bundle + `chunk:` 文件，经 `require.async("./<file>.js")` 取**。`codeSplitting: false` 只是某个插件自己的选择，**不是契约**。**我们原栈「独立懒加载 chunk」正确**，判据恢复，并具体化为上述 API。

**顺带（Phase 4 直接可用）**：官方终端页的 `devDependencies` 同时含 `@xterm/xterm`、`@xterm/addon-fit`、`react`、`react-dom`、`@types/react`、`@types/react-dom`、`@testing-library/react`、`clsx`，以及它 `require` 的**每一个** `@deepseek-ai/dsh-client-*` 包；`peerDependencies` 只有 `@deepseek-ai/cordis: ~4.0.4` ⇒ **external 的声明方式 = 全部进 devDependencies**（宿主在运行时供给），组件测试用 `@testing-library/react`（需 jsdom 环境）。

### P3 第三条客户端→宿主通道：`ctx.remote.<service>.<method>()` + `ctx.remote.$on(event, fn)`

- `dsh-desktop-next\src\client\computer-use.tsx:28` `context.remote.pluginManager.listPlugins()`；`:41` `context.remote.pluginManager.setPluginEnabled(row.entryId, enabled)`；`:20-21` `context.remote.$on('plugin-manager/changed', reload)` + `context.on('connection/reset', reload)`
- 5 仓里 `typert` / `ctx.api` / `ctx.client` 字面量 **0** 命中 ⇒ 名字就是 **`ctx.remote.<service>.<method>()`**。
- 另：community-market 宿主侧路由**全是 `kind: 'exact'`**（`dsh-community-market\src\host\routes.ts:698`），依赖声明 `src\index.ts:18` `export const inject = ['webServer']` ⇒ 与我们「HTTP 用 `prefix`」不矛盾（两种都支持），但**官方范例偏 `exact`**。
- ⇒ 002 的通道优先级更新为：**① `remote.settings`（配置读写）→ ② 自建 exact HTTP/WS 路由（终端流与动作）→ ③ `ctx.remote.*`（若 0.2.0 提供且更省事，作为备选）**。

### P4 样式作用域的**真手段**是构建期 `@scope`（手写 CSS 字符串只是命名前缀）

- `dsh-plugin-desktop\vite.client.config.ts:21-22`：`const css = \`@scope (:root:has(.dshDesktopOnboardingContent)) { ${source} }\`` → 再 `document.createElement('style')` 注入。
- ⇒ 我们若走**手写 CSS 字符串**（community-market / whale-pet 路线），作用域**只靠类名前缀**（可接受，REQ-5.2 的「不写全局样式表」应改述为「不引入**未加前缀**的全局选择器」）；要真作用域需在**构建期**包 `@scope`。
- 另确认：`ctx.slots.register` 签名 = **`(options, Component)` 两个位置参数**，`name` 在 `options` 内（slots :: `lib/types/index.d.ts:597-613, 789-791`）—— 002 若按 `(name, id, Component, options)` 写会**编译不过**。
- 另更正：`dsh-community-market\tests\client-api.spec.ts` **不是** slots 的活文档（11 个 `it` 全测它自己的 HTTP 客户端）；真回归门是 `dsh-community-market\tests\client-index.spec.ts:75-79`（把三个 slot 注入钉死：`['settings.plugins.tab','sidebar.footer.action','shell.overlay']`）。

### P5 §Z 更新

| # | 状态 | 说明 |
| --- | --- | --- |
| Z4 | **已关闭（改）** | 0.1.7-rc.2 = **9 个** kind（见 P1）；**0.2.0-rc.2 的数量仍未验证** |
| Z5 | **改判** | 不再问「怎么做懒加载 chunk」，改问「**宿主是否提供 `@xterm/xterm` 作 external**」（否则 xterm 必须进 bundle） |
| Z9 | **新增** | `context.remote` 在 **0.2.0-rc.2** 的名字与形状（只有 0.1.7 系的三方用法，**无官方 d.ts**） |
| Z1/Z2/Z3/Z6/Z7/Z8 | 不变 | 见 §Z 原表 |

### P9 📌 003 的宿主↔客户端**数据通道**（2026-10-09 在制品实测：`packages/wsl-docker-ports/src/{wire,route,snapshot}.ts` + `src/client/route-source.ts`）

- **传输 = 自建 `ctx.webServer` 具名路由、HTTP-only**：`register({ kind: 'prefix' })`，**不用** `registerUpgrade`（快照是「一问一答的只读数据」，无服务端推送需求）。独占前缀字面量 `PORTS_HTTP_PREFIX = '/dsh-wsl-docker-ports/'`；快照端点 `PORTS_SNAPSHOT_PATH = '/dsh-wsl-docker-ports/snapshot'`、`PORTS_SNAPSHOT_METHOD = 'GET'`。**不蹭 002 的 `/dsh-managed-terminal/`**（源码注释里明写）。
- 🔴 **disposer 必须登记进 `ctx.effect`** —— 宿主**不会**自动收编 `register()`/`registerUpgrade()` 的返回值；重复 `(kind,path)` 会抛错 ⇒ 漏登记 = 卸载后残留、重装必撞（与 002 同款陷阱，两包各自踩过一次）。
- **查询参数是「声明」不是「事实」**：`managedPorts` / `scope` / `distro` / `elevationPolicy` / `allowColdStart`；作用域对分隔符 `':'`；`ELEVATION_POLICIES = ['none','ask','passby']`、缺省 `'none'`。🔴 **非法值一律落到最保守默认、不返回 400**（客户端自己拼参数，回 400 只会让右栏页白屏）。
- **响应形状**：`{ ok: true; snapshot } | { ok: false; error: { code, message } }`；**路由级错误只有两条** —— `rules-unavailable` **503**（读不到 netsh 规则 ⇒ 事实不可信，必须整体失败）与 `internal` **500**（未预期抛出）。**其余降级全部走 200 + 快照内字段**（`docker.ok:false` / `diff.ok:false` / `distroError`）⇒ 页面照样渲染出可读的降级态。
- **客户端取用点**：`src/client/route-source.ts` 把响应映射成 `PortsSource`；HTTP 失败 ⇒ `error.code`（或兜底 `http-<status>`）+ 可读 message；环境无 `fetch` ⇒ `no-fetch`。**取不到源时右栏页不注册**（`ports-source-missing`，即 T6.8 存在的原因）。
- ⚠️ **状态：在制品**（T6.8 未收口）。以上字面量取自 **2026-10-09 12:00 的源码直读**（非代理转述）；代理回报若与本节不符，**以本节为准**并追加订正条目（§P 系列的既定口径：较新的 P 覆盖较早的）。

---

**研究方式（可复现）**：只读遍历本机检出 + 用 `node -e` 在内存里 gunzip/解 tar 读官方 tarball（**未落任何文件**）；官方包在 `node_modules` 下是悬空 junction（读不到），故以第三方实物 + 官方 tarball 的 `.d.ts` 为证据源。第二轮增量补丁的 4 条覆盖见 §P。
