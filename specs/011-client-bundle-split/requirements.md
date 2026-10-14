# 客户端主包瘦身 —— 需求

> 立项来源：本包 client 半属 [003-wsl-docker-ports](../003-wsl-docker-ports/README.md) 的面（2026-10-12 立项；**只立项、不实现**）。
> 🔴 **SSoT 声明（先读这条）**：**尺寸上限的规范原文**在 [client-contract.md §P2](../../client-contract.md) —— 64 KiB = 65,536 B 的**直接判据**，判据实现落点 = `packages/terminal-profiles/scripts/verify-client-loader.mjs` 的 `MAIN_BUNDLE_LIMIT_BYTES`（留痕 = `stack-decision-changelog.md` #50）⇒ 本文件**只做指针 + 本地需求**，两处不一致**以 §P2 为准**。
> 本地需求用 `REQ-BS-n` 前缀（BS = bundle split），**不占用** 003 的 `REQ-1`–`REQ-17` 段（010 亦已声明不占用 `REQ-18+`）。

## 1. 目标

把**渲染面 + 写路径内核**移入 `require.async` chunk；**保持** tab 注册常驻、**保持** 009 的 a11y 加固与 002 的会话语义不变 ✓；目标 = 主包 ≤ **64 KiB**（**先做到 ≤ 64 KiB**，若余量不足再谈上限，**禁止**先塞后抬 ✗）。

## 2. 现状事实（实测，**直接引用、不重新考古**）

| 项 | 实测值 | 含义 |
| --- | --- | --- |
| 本包 `lib/client.js` | **144,149 B**，**无 chunk**（`require.async` **0 处**） | 越 §P2 的 64 KiB 共 **78,613 B = 2.20×** |
| §P2 ① 不含 xterm | ✓ | 打包配置**无缺陷** |
| §P2 ② 不含内联 React | ✓（`require` 仅 `react` / `react/jsx-runtime`；`node_modules` 输入 **0**） | 纯**体积**问题，不是配置问题 |
| 构成 | `src/client/**` **80.2%**；被内联的**首方非 client 源码** **18.5%** | 见 §2.1 / §2.2 |
| 归属（逐提交重建） | `8bfb6fb` = **83,709 B**（第一天即越线 ✗）· `003 面` +3,365 · `008 面` +36,133（25.1%）· `009 面` +20,942（14.5%） | 四段和 = 144,149 B（**逐字节闭合**）⇒ **越线早于 008/009**、**不是任何单个 Spec 的缺陷** |

### 2.1 `src/client/**` 头部体量（80.2% 的主项）

`pane.tsx` 15,315 · `pane-settings.tsx` 14,387 · `write/plan.ts` 13,321 · `pane-tables.tsx` 10,680 · `rows.ts` 9,643 · `page.ts` 8,782 · `write-panel.tsx` 8,753 · `write-confirm.tsx` 8,342 · `settings-pipe.ts` 7,040 · `index.ts` 6,997 · `write-channel.ts` 6,189 · `write-result.tsx` 5,867 · `write-token.ts` 4,911 …

### 2.2 被内联进 client 的首方非 client 源码（18.5%）

`write/plan` 13,321 · `ownership` 3,359 · `diff/managed-ports-parse` 2,778 · `write/scope-note` 2,523 · `write/firewall` 2,001 · `wire` 1,135 …

## 3. 需求（`REQ-BS-n`）

- **REQ-BS-1（硬上限）** 本包客户端**主包**产物 SHALL ≤ **65,536 B**（64 KiB，按**原始产物字节**计）；SHALL NOT 抬高该上限来「达标」，SHALL NOT 用比例代理替换直接判据（口径 SSoT = §P2）。
  - **语义桥接（2026-10-12 追加）** `dsh-wsl-docker-ports` 的上限 **144,149 B**（`nature: debt` / 留痕 #52）是 §P2 的**棘轮基线**，语义 = 「**门不许再涨**」，**不是**本 Spec 的验收目标；本 Spec 的验收目标**仍是主包 ≤ 65,536 B**（U1），且 `Phase 1` 落地后 **SHALL 把该欠账行下调到实测值**（棘轮**只许降**）⇒ 与 REQ-BS-1 的「SHALL NOT 抬高上限来达标」**相容**：下调欠账行 ≠ 抬高 65,536 B 的硬上限。
- **REQ-BS-2（懒加载边界）** **渲染面**与**写路径内核** SHALL 移入 `require.async` 取块的 chunk；GIVEN 首开页面挂载右栏页，THEN 主包 SHALL **不含**这些模块的字节（除非被常驻模块同步 import —— 见 REQ-BS-3）。
- **REQ-BS-3（常驻面）** **tab 注册所需模块** SHALL 留在主包：`rows.ts` 9,643 + `write-channel` / `write-token` / `settings-pipe` 18,140 = **27,783 B**；GIVEN 宿主加载完主包、尚未取任何 chunk，THEN tab **SHALL** 已能注册（不依赖异步块）。
- **REQ-BS-4（功能等价）** GIVEN 切块完成，THEN 首开页面 SHALL **功能等价**：右栏页能用、**009 的凭据 a11y 判据仍全绿**、**008 的四态与 401 文案不变**；SHALL NOT 改交互、SHALL NOT 改文案。
- **REQ-BS-5（可解释降级）** GIVEN 异步取块**失败或离线**，THEN SHALL **可解释降级**（写明原因 + 可重试），SHALL NOT **白屏**、SHALL NOT **静默**（无提示地把页面留空亦视为违规）。
- **REQ-BS-6（准入闸门）** 本 Spec SHALL NOT 在 `Phase 0`（0.2.0-rc.2 的 `require.async` 语义真机验证）通过前改任何 `packages/**` 产品代码；此期间改动**只允许** `.md`。判据：`git status --porcelain` 出现 `packages/**` 即违规。
- **REQ-BS-7（零新依赖）** 本 Spec SHALL NOT 引入任何新依赖（含构建期依赖）；切分 SHALL 只用**既有**构建链能力（esbuild 的 dynamic import / 宿主 ModuleLoader 的 chunk 机制）。
- **REQ-BS-8（产物断言可复算）** 达标判定 SHALL 由**可复算的产物断言**给出（字节 + `require.async` 命中数 + 常驻模块存在性），SHALL NOT 依赖人眼观察或截图判读。
- **REQ-BS-9（变异哨兵）** 判据 SHALL 通过**变异哨兵**自证非恒真：人为把某个已切出模块**塞回主包** ⇒ 门**必须变红**。

## 4. 非目标（明示不做）

不重构 UI、不改交互、不动 §P2 的 ①②（已绿 ✓）、不引入新依赖、不做 `terminal-profiles` 的拆分（那是**另一份账** ✓）。

- **不做**：UI 结构重排 / 组件拆分 / 样式改写（切块**只搬字节、不改行为**）
- **不做**：`packages/terminal-profiles/` 的 bundle 拆分（本 Spec 只谈 `dsh-wsl-docker-ports`）
- **不做**：xterm / React 相关的构建配置改动（①② 已绿，无缺陷可修）
- **不做**：`configEditor` / settings / 写通道 / 提权链路的语义改动（008 / 009 / 005 的账）

## 5. 验收门（可二值判定）

| # | 判据 | 方式 |
| --- | --- | --- |
| U1 | 主包 ≤ **65,536 B**；`require.async` 命中 **≥ 1**；chunk 数 **≥ 1** | 产物字节断言 |
| U2 | **tab 注册所需模块仍在主包**（`rows.ts` / `write-channel` / `write-token` / `settings-pipe` 的存在性断言） | 产物断言（非人眼） |
| U3 | 首开页面功能等价；**009 凭据 a11y 判据全绿**；**008 四态 + 401 文案不变** | chrome-devtools MCP 真机 + 既有判据复跑 |
| U4 | 取块失败 / 离线 ⇒ **可解释降级**（有原因文案 + 可重试），**无白屏**、**无静默** | 真机（断网 / 篡改 chunk 名） |
| U5 | 变异哨兵：把已切出模块塞回主包 ⇒ 门变红 | 一次性变异 + 断言 |
| U6 | 既有质量门不回归：`typecheck` / `test` / `build` 三绿；单文件 ≤ **400** 行 | 命令 exit 0 + 既有口径复算 |

## 6. 假设与未验项（**不会编数**）

- **N-1（算术待核，非新测量）** 按给定数字直减得 144,149 − 72,126 = **72,023**、144,149 − 98,501 = **45,648**，与给定的 **70,246** / **43,871** 各差 **1,777 B**（两处偏移**一致**）⇒ 差异来源（共享模块重复计账？）**未说明**，登记为待核；**实现前必须用真构建复算**，不得直接引用推算值当结论。
  - 🔴 **订正痕（2026-10-12 追加；本行原文一字未删）**：本行原记的 **70,246** / **43,871** 系**可达性估算被当数字转述**（**不是**直减结果）⇒ 直减应为 **72,023** / **45,648**（`144,149 − 72,126` / `144,149 − 98,501`），两处**同差 1,777 B**；该差值与派单诊断里「**未归属（banner/footer + 共享 helper）1,777 B**」那格**同值** ⇒ 差额来源**据此登记为已定位**（⚠️ 该诊断**不在本仓文件内**、本仓**无可复算坐标** ⇒ 只算**口径一致**，**不算复核**）；即 N-1 的状态由「来源未说明」改为「**来源已定位、数值待复算**」。**估算，实现前必须用真构建复算。** ✅ **2026-10-13 复算闭环（`T1.1`）**：`1,777 = banner 142 + esbuild 前导段 804 + 模块路径注释 773 + 区内空行 28 + footer 29 + 末尾换行 1`（`144,149 − Σ模块 142,372 = 1,777`，本仓可复算，账本与等式见 [design.md](./design.md) §12）⇒ **本项关闭**：逐模块账口径正确（metafile `bytesInOutput`、cwd = 包目录），**70,246 / 43,871 作废**（把未归属 1,777 B 当成随切分消失），权威一阶值 = **72,023 / 45,648**；切分后的达标判定**只认实测产物**。
- **N-2（Phase 0 未验）** **0.2.0-rc.2 的 `require.async` 语义未验**（§Z5 的残留真机项：0.1.7-rc.2 的语义是否与 0.2.0-rc.2 一致）⇒ **未验证不得进实现**。
- **N-3（本包产物断言脚本未核）** 本包是否已有等价的产物断言脚本**未核**（`packages/wsl-docker-ports/scripts/**` 本轮**避让**，未读未动）⇒ 断言**落点**待实现阶段确定（§P2 的先例落点在 `terminal-profiles`，**不可假设**本包已对齐）。
- **N-4（chunk 上限未定）** chunk **90–99 KB** 是**推算**值，且 chunk 侧**是否也有上限**未在 §P2 里读到 ⇒ 本轮**不新设** chunk 上限（避免自造口径）。
- **N-5（体积数字未复测）** 本文件与同批文档里的**所有体积数字均未由本轮复测**（遵「直接引用、别重新考古」）。
- **假设 A-1**：宿主 ModuleLoader 的 `chunk:` 自注册 + `require.async("./x.js")` 是**唯一**取块机制（§E14 有官方终端页逐字实证）；若 0.2.0-rc.2 另有机制，以 `Phase 0` 真机结论为准。
- **假设 A-2**：切块**不改变**客户端半的 `exports` / `dsh.client` 清单形状（chunk 不进 `exports`，与官方终端页一致）。
- **假设 A-3**：`write/plan` 等**首方非 client 源码**被内联进 client 半是**既有构建行为**，切出它们**不需要**改宿主半分包边界。

## 附：C1/C2/C4 的锚点（2026-10-13 追加，静态取证）

- **C1（主包 ≤ 64 KiB）**：量测对象 = 构建产物 `packages/terminal-profiles/lib/client.js` 一类文件；当前基线 **53,756 B**（余 11,780 B）。**不**以服务端下发字节为准（下发版比归档产物大约 18 B 量级）。
- **C2（chunks ≥ 1 且 tab 注册模块仍在主包）**：chunk 的存在与命名以产物 `lib/client.*.js` 为准（官方先例 `client.terminal.js` = 685,927 B，主包 19,869 B）。
- **C4（异步取块失败可解释降级）**：以宿主 `dsh-client-modules` 的真实失败语义为锚 —— `script` 加载 `error` ⇒ **reject**，文案 `client-modules: bundle script <url> failed to load`。
- 静态取证来源与命令原文见本 Spec 的 `tasks.md`「Phase 0 静态证据」节；**运行时那半仍未验**。

## 附 2：`U1` 达标与棘轮下调待裁（2026-10-13 追加，`T1.2`/`T1.3` 实测）

- **`U1` 达标（实测，非推算）**：主包 **38,640 B ≤ 65,536 B** ✅ · `require.async` 命中 **1** ✅ · chunk **1** 个（`lib/client.ports.js` = 110,498 B）✅ ⇒ §5 的 `U1` 三件齐。命令原文与逐模块账见 [tasks.md](./tasks.md) 文末「Phase 1 实测证据」。
- ⚠️ **§2 表里的「144,149 B / 无 chunk / `require.async` 0 处」是切分前的现状**（原文一字未删 —— 它是立项依据）⇒ 与切分后读数**并列**，不覆盖（与 design §12/§13 的订正痕同一纪律）。
- ❌ **待主人裁定（本 Spec 未动）**：`REQ-BS-1` 语义桥接要求的「`Phase 1` 落地后把 `dsh-wsl-docker-ports` 的欠账行下调到**实测值**」**尚未执行**，因为落点全在**避让区**：`packages/wsl-shared/scripts/main-bundle-budgets.mjs` 的机器表 + `client-contract-incremental.md` §P2 的 `main-bundle-budgets:SSoT` 表（`LOCK_FIELDS` 四字段须逐字段相等）+ `stack-decision-changelog.md` 的留痕条目。**现状风险**：门目前仍按 144,149 B 判 ⇒ 切分后主包即使涨回 144 KB 也不会红（棘轮暂时失效），`REQ-BS-9`/`U5` 的哨兵强度同步下降。
- ✅ **订正痕（2026-10-13 收口；原文一字未删）**：主人已裁定「**授权棘轮下调 + 含顺带订正旧读数**」⇒ 本条**已执行**：`limitBytes 144,149 → 38,640`、`recorded → 2026-10-13`、`trace → #54`、`nature` 仍 `debt`（语义改为**棘轮地板**），契约文档 §P2 标记块同步、`stack-decision-changelog.md` 新增 **#54**、`stack-decision.md` 变更记录新增一行；⚠️ 上面写的「**棘轮暂时失效**」这一风险**已消除**（门现在按 38,640 B 判，实测哨兵「人造 38641 ⇒ 判红」通过）。本轮同时补上 **运行期复验**（未验项 8，已跑通并删档还原）与 **`T1.4` 产物断言门**（`scripts/assert-client-split.mjs`，17/0 + 6 个故障键各自 `exit 1`）。命令原文见 [tasks.md](./tasks.md)「Phase 1 收口证据」。
- ❌ **`U2` 的字节口径订正**：`REQ-BS-3` 的 27,783 B 是**整模块**口径的估算；实测主包里 `rows.ts` 只留 1,279 B、`write-token` 2,375 B（esbuild tree-shaking，见 design §13）⇒ 判据按**存在性**执行**仍达门**；本行**不**改 REQ-BS-3 的判据文字（改判据须主人拍板）。