# 客户端半契约 · 基础章节（§A–§F + §Z）

> **本文件是 [`client-contract.md`](./client-contract.md) 的拆分件**（2026-10-12；原文件 422 行 > 「单文件 ≤ 400 行」SHALL）：承接 §A / §B / §C / §D / §E / §F / §Z 的**全部正文**。
> **章节标题与正文逐字来自原文件，一字未改**；主线 `client-contract.md` 保留同名标题 + 一行指针（供仓内 `client-contract.md §A–§F`、`§C9/C10`、`§D12/D13`、`§E15`、`§Z` 一类锚点继续命中）。
> §P（增量修正 P1–P9）在 [`client-contract-incremental.md`](./client-contract-incremental.md)；`## 0. 结论速览` 与文末「研究方式」留在主线。

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

