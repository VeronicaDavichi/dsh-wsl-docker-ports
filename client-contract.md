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

> 🔴 **2026-10-12 拆分留痕（纯文档搬家：零内容删除、零标题改写）**：本文件拆前 **422 行**，超「单文件 ≤ 400 行」（SHALL）⇒ 按**既有章节结构**拆为「**主线（本文件：入口 + 指针 + §0 结论速览）+ 两份正文分片**」。**每一章的原标题都逐字保留在本文件**（供 `AGENTS.md` / `specs/**` / `packages/**` 里 `client-contract.md §P2`、`§C9/C10`、`§D12/D13`、`§E15`、`§Z` 一类锚点继续命中），正文一字未动地搬进分片。
> 分片：`§A–§F + §Z` → [`client-contract-base.md`](./client-contract-base.md)；`§P`（增量修正 P1–P9）→ [`client-contract-incremental.md`](./client-contract-incremental.md)。
> ⚠️ **本文件已不再含 §A–§F / §Z / §P 的正文** —— 引用这些章节请按下面的标题就近取分片；本文件保留标题只为不让既有引用错位。
> 📌 **一处原始「裸行号」引用（本次未改他文件，仅登记）**：`specs/008-write-transport/tasks.md` 写「已由 `client-contract.md:408` 的真机实测钉住」—— 该行（§P9 第 1 条：对象式 `register` 签名）现位于 [`client-contract-incremental.md`](./client-contract-incremental.md) 的 §P9 第 1 条；拆分必然让裸行号失准，故登记新坐标而不擅改。

## A. 清单面

> 本节正文（A1–A4）见 [`client-contract-base.md`](./client-contract-base.md) 的「## A. 清单面」——**标题原文未改、正文一字未动**。

## B. 入口形状与会话面

> 本节正文（B5–B7）见 [`client-contract-base.md`](./client-contract-base.md) 的「## B. 入口形状与会话面」——**标题原文未改、正文一字未动**。

## C. 页类型与扩展槽

> 本节正文（C8–C11）见 [`client-contract-base.md`](./client-contract-base.md) 的「## C. 页类型与扩展槽」——**标题原文未改、正文一字未动**。

## D. 配置页与写管道

> 本节正文（D12–D13）见 [`client-contract-base.md`](./client-contract-base.md) 的「## D. 配置页与写管道」——**标题原文未改、正文一字未动**。

## E. 懒加载与样式

> 本节正文（E14–E15）见 [`client-contract-base.md`](./client-contract-base.md) 的「## E. 懒加载与样式」——**标题原文未改、正文一字未动**。

## F. 我们两个包的**最小可装载客户端半**清单（照实物）

> 本节正文（F 的清单表）见 [`client-contract-base.md`](./client-contract-base.md) 的「## F. 我们两个包的**最小可装载客户端半**清单（照实物）」——**标题原文未改、正文一字未动**。

## Z. 未验证清单（**不得当成已验**）

> 本节正文（Z1–Z8 表）见 [`client-contract-base.md`](./client-contract-base.md) 的「## Z. 未验证清单（**不得当成已验**）」——**标题原文未改、正文一字未动**。

---

## P. 🔴 增量修正（同日第二轮回收，**覆盖 §C8 / §E14 / §D13 / §E15 与 §Z 的相应条目**）

> 本节正文（P1–P9；含同日历史重号 P3 / P4 / P5 各两组，原文顺序与编号一律未改）见 [`client-contract-incremental.md`](./client-contract-incremental.md) 的同名「## P.」小节——**标题原文未改、正文一字未动**。
> 🔴 **2026-10-12 §P2 追加变更记录（尺寸口径：比例代理 → 直接判据 + 64 KiB 明确上限）** —— 原文在分片 [`client-contract-incremental.md`](./client-contract-incremental.md) 的 **§P2 段末**（新坐标 = 该文件的小节「**P2·2026-10-12 追加变更记录**」，位于 §P2 正文之后、`### P3 第三条客户端→宿主通道` 之前）。**§P2 原正文一字未改**，只追加；判据实现落点 = `packages/terminal-profiles/scripts/verify-client-loader.mjs`（`MAIN_BUNDLE_LIMIT_BYTES` = 65,536 B、`mainBundleInvariantChecks`），留痕 = `stack-decision-changelog.md` **#50**。
> 📌 **2026-10-12 §P2 适用范围订正指针（`wsl-docker-ports` 存量欠账 + 双重锁 + 棘轮；逐包上限表以标记块为准）** —— 规范原文在分片 [`client-contract-incremental.md`](./client-contract-incremental.md) 的小节「**P2·适用范围订正（2026-10-12）**」：`dsh-wsl-docker-ports` 欠账行 **144,149 B** / `nature: debt` / 留痕 **#52**（🔴 **不是认可值** —— 「门绿」只表示**没有再涨**）；**双重锁** = 机器表 ↔ 该分片的 `<!-- main-bundle-budgets:SSoT -->` 标记块**逐字段相等**（只改一边必红）；**棘轮只许降**；机器可读 SSoT = [`packages/wsl-shared/scripts/main-bundle-budgets.mjs`](./packages/wsl-shared/scripts/main-bundle-budgets.mjs) ⇒ **逐包上限表以该分片的标记块为准**，本文件**不复写第三份表格**。
> ✅ **订正痕（2026-10-13，原文一字未删，只追加）**：上面的「欠账行 **144,149 B** / 留痕 **#52**」是**切分前**的登记；011 Phase 1 落地后**现行登记** = **38,640 B** / `nature: debt`（**棘轮地板**，仍只许降）/ 记录日 2026-10-13 / 留痕 **#54**，标记块已同步（`client-contract-incremental.md` §P2 的 `main-bundle-budgets:SSoT` 块）。

---

**研究方式（可复现）**：只读遍历本机检出 + 用 `node -e` 在内存里 gunzip/解 tar 读官方 tarball（**未落任何文件**）；官方包在 `node_modules` 下是悬空 junction（读不到），故以第三方实物 + 官方 tarball 的 `.d.ts` 为证据源。第二轮增量补丁的 4 条覆盖见 §P。

> ✅ **订正痕（2026-10-14，原文一字未删，只追加）**：011 `T2.4`（可解释降级）落地后**现行登记 = 43,857 B / `nature: debt`（棘轮地板，仍只许降）/ 记录日 2026-10-14 / 留痕 #55**（分片 `<!-- main-bundle-budgets:SSoT -->` 标记块已同步）；原因 = `REQ-BS-5` 的降级面**必须常驻主包**（失败的那一半正是 chunk），+5,217 B、**未删功能**；🔴 **§P2 硬判据 65,536 B 不动**。
