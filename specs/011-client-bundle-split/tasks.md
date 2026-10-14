# 实现任务：dsh-wsl-docker-ports 客户端主包瘦身

> 任务引用 [requirements.md](./requirements.md)；设计依据见 [design.md](./design.md)。
> 完成定义（每个任务）：代码 + **验证命令跑绿** + 无残留临时文件/规则。
> 🔴 **准入闸门**：`Phase 0` 的 `T0.1` **未达** ⇒ `Phase 1`–`Phase 3` **不得开工**（**未通过不得进实现**）。
> 口径：`pnpm -C packages/wsl-docker-ports {typecheck,test,build}`（与 003 / 008 / 009 同包同口径）。

---

## Phase 0：闸门（准入）—— 🔴 **未通过不得进实现**

- [x] T0.1 [REQ-BS-6] **0.2.0-rc.2 的 `require.async` 语义真机验证**（§Z5 的残留未验项）
  - 内容：在 0.2.0-rc.2 上真机跑通「**异步取块 → 执行 → 注册页**」整链路：chunk 自注册（`window.__ModuleLoader__.load({ id, chunk, factory })`）→ `require.async("./client.<name>.js")` 取块 → chunk 导出的组件**真被渲染**、tab **真出现在右栏**。**不得**只看「文件生成了」就判过。
  - 环境红线：探针**只允许**用临时/一次性 profile（或主人指定），🔴 **绝不**装进 `desktop` / `web`；用完**逐字节还原**。语法用 `dsh --profile <name> --port N --no-open`（**不是** `dsh --profile <name> web …`；`--patch` 若有须写在 `--profile` **之前**）。
  - 验证（二值）：① 真机截图 / 路由响应证明 tab 已注册且 chunk 已取；② 产物里 `require.async` 命中 ≥ 1；③ 控制台**零**未声明 `require` 崩溃。三件齐 ⇒ 通过。
  - 🔴 **当前状态（2026-10-12）：未达** —— 0.2.0-rc.2 上**未验**；`Z5` 只把 §E14 的 0.1.7-rc.2 实证记为「宿主支持 chunk」，**没有**证明 rc.2 语义一致。 🔴 **订正（2026-10-13）：本行状态已过期 —— T0.1 已通过**（运行时链路已在真机 rc.2 上真观测，证据见文末「Phase 0 运行时证据」；口径边界见未验项 8），原文一字未删。

- [x] T0.2 [REQ-BS-5] **失败 / 离线行为**在真机上先记录基线
  - 内容：记录三态的可观测现象：① chunk 404（改名 / 不部署）② 执行期抛错 ③ 断网（离线）。**只记录**，本 Phase 不改代码。
  - 验证（二值）：每种情形的**原始现象**（截图 + Console 原文）落进本 Spec 的未验项节；三态各一条 ⇒ 完成。

- [x] T0.3 [REQ-BS-6] 闸门纪律核对
  - 内容：`T0.1` 未通过期间，本 Spec 的改动**只允许** `.md`。
  - 验证（二值）：`git status --porcelain` 在本 Spec 阶段**零** `packages/**` 改动 ⇒ 记一条证据（命令原文 + 输出）。

---

## Phase 1：切分与产物断言（闸门通过后）

- [ ] T1.1 [REQ-BS-1] **真构建基线复算**（先量后切）
  - 内容：真构建一次，复算 `lib/client.js` 字节与逐模块账；**解释**推算里的 **1,777 B 系统性偏移**（见 `N-1`）—— 若解释不了，**先查清再切**。
  - 验证：构建 exit 0 + 复算表（字节 + 逐模块）落进本 Spec；偏差有结论。

- [ ] T1.2 [REQ-BS-2] 切出**渲染面** 7 模块到 chunk
  - 内容：`pane.tsx` / `pane-settings.tsx` / `pane-tables.tsx` / `page.ts` / `write-panel.tsx` / `write-confirm.tsx` / `write-result.tsx` ⇒ 取块边界；**不改**组件内部逻辑。
  - 验证：产物里模块字节**离开**主包；tab 仍注册；页面仍能用。

- [ ] T1.3 [REQ-BS-2][REQ-BS-3] 切出**写路径内核**并**保常驻面**
  - 内容：切出 `write/plan.ts` / `ownership` / `diff/managed-ports-parse` / `write/scope-note` / `write/firewall` / `wire` / `diff/port-presets` / `transport/constants`；**保常驻** `rows.ts` + `write-channel` / `write-token` / `settings-pipe`。
  - ⚠️ 已知：4 条同步 import 边（合计 **5,171 B**）会把部分字节**拉回**主包（见 design §3.2）—— 本任务**不打断**这些边（改 import 关系属另一设计变更）。
  - 验证：主包 ≤ 65,536 B；常驻 4 模块仍在主包（产物断言）。

- [ ] T1.4 [REQ-BS-8] **产物断言**落地（含落点确定）
  - 内容：断言 ① 主包 ≤ 65,536 ② `require.async` ≥ 1 ③ chunk 存在且被引用 ④ 常驻 4 模块标记在主包 ⑤ 已切出模块标记**不在**主包。落点见 `N-3`（本轮**未核**本包是否已有等价脚本）。
  - 验证：断言脚本 exit 0；故意构造超标产物 ⇒ exit ≠ 0。

- [ ] T1.5 [REQ-BS-1] **上限口径不动**复核
  - 内容：确认没有偷改 §P2 上限、没有把直接判据换成比例代理。
  - 验证：`grep` 断言上限常量仍为 **65,536**；`stack-decision*` 零改动。

---

## Phase 2：功能等价与降级

- [ ] T2.1 [REQ-BS-4] 首开页面**功能等价**
  - 内容：右栏页能用（表格 / 设置 / 写面板入口都在），与切分前**逐项对照**。
  - 验证：chrome-devtools MCP 真机截图 + 逐项清单勾完。

- [ ] T2.2 [REQ-BS-4] **009 的凭据 a11y 判据仍全绿**
  - 内容：复用 009 的判据（一次性写通道凭据**不进 a11y 树**：`aria-hidden` 明文 + 无障碍名不含值的复制按钮），**逐条复跑**。
  - 验证：既有判据用例全绿（不新增、不改写 009 的判据）。

- [ ] T2.3 [REQ-BS-4] **008 的四态与 401 文案不变**
  - 内容：写结果四态与 401 文案**逐字**比对切分前。
  - 验证：文案 diff 为空 + 真机走一遍 401。

- [ ] T2.4 [REQ-BS-5] **可解释降级**实现
  - 内容：取块失败 ⇒ 页面壳保留 + 原因分类文案 + 可重试；**禁止**白屏 / 静默。
  - 验证：三种失败情形（404 / 执行抛错 / 断网）各跑一次；断言有文案、有重试、无空白页；控制台有明确错误。

---

## Phase 3：变异哨兵与收口

- [ ] T3.1 [REQ-BS-9] **变异哨兵**
  - 内容：临时把某个已切出模块**塞回主包** ⇒ 断言 ⑤ **必须**变红；跑完**还原**。
  - 验证：变异后断言 exit ≠ 0（红的原文留存）；还原后 `git status` 干净。

- [ ] T3.2 [REQ-BS-1] 三绿 + 行数门
  - 内容：`typecheck` / `test` / `build` 三绿；单文件 ≤ **400** 行（原始行数）。
  - 验证：三条命令 exit 0 + 行数复算。

- [ ] T3.3 [REQ-BS-8] 文档收口
  - 内容：把真构建数字、`Phase 0` 结论、变异哨兵原文、未验项回收写进本 Spec；**只许降不许抬**的余量（≈16,494 B）登记。
  - 验证：本 Spec 四份文档与实测一致；未勾项 = 0（除明确登记的未验项）。

---

## 真机验收清单（chrome-devtools MCP；**闸门通过后再跑**）

| # | 场景 | 期望 | 手段 |
| --- | --- | --- | --- |
| V1 | 打开右栏页（首开） | 主包 ≤ 65,536 B；Network 里**看到 chunk 被取**；页面功能与切分前一致 | Network + 截图 |
| V2 | tab 注册（未取 chunk 时） | tab **已注册**（常驻面足够）；**不依赖**异步块 | 截图 + 产物断言 |
| V3 | 篡改 chunk 名 / 不部署 chunk | **可解释降级**：有原因文案 + 可重试；**无白屏**、**无静默** | 截图 + Console |
| V4 | 离线（断网）打开 | 同上，文案区分「离线」；**不崩** | 截图 |
| V5 | 009 凭据 a11y 判据 | 逐条**仍全绿**（凭据不进 a11y 树） | 既有判据复跑 |
| V6 | 008 四态 + 401 文案 | **逐字不变** | 文案 diff |
| V7 | 变异哨兵（把模块塞回主包） | 断言**变红** | 断言 exit ≠ 0 |

> ⚠️ 本表**一行都还没跑**（闸门未达、零实例）；写下来是为了让闸门一通过就能直接执行。 🔴 **订正（2026-10-13）：闸门已通过**（见文末「Phase 0 运行时证据」）⇒ 本表**可开跑**，但**仍未跑**（`Phase 1` 产物尚不存在）。

## 未验项（如实登记）

1. **`Phase 0` 未验**：0.2.0-rc.2 的 `require.async` 语义**未验** ⇒ 全部任务保持未勾。 🔴 **订正（2026-10-13）：本项已验**（见文末「Phase 0 运行时证据」）；剩余口径边界改记在**未验项 8**（**本包自己的 chunk** 的运行期复验），原文一字未删。
2. **算术偏移未解释**：推算值（70,246 / 43,871）与直减值（72,023 / 45,648）差 **1,777 B**（两处一致）⇒ 实现前真构建复算。 🔴 **订正痕（2026-10-12 追加；本行原文一字未删）**：本处引用的**可达性估算值**（**70,246** / **43,871**）**原记为估算值被当直减结果**（**不是**直减结果）⇒ 直减为 **72,023** / **45,648**（`144,149 − 72,126` / `144,149 − 98,501`），两处**同差 1,777 B**；该差值与**未归属（banner/footer + 共享 helper）1,777 B** 那格**同值** ⇒ 差额来源**口径一致**（⚠️ 该诊断**不在本仓文件内**、本仓**无可复算坐标** ⇒ **不算复核**）；状态由「未解释 / 待核」改为「**来源已定位、数值待复算**」。**估算，实现前必须用真构建复算。**
3. **产物断言落点未定**：本包是否已有等价脚本**未核**（`packages/wsl-docker-ports/scripts/**` 本轮**避让**）。
4. **chunk 侧上限未设**：§P2 只读到主包上限；chunk 90–99 KB 为**推算**。
5. **标记字符串口径未定**（design §7）⇒ 变异哨兵实现细节待定。
6. **体积数字未由本轮复测**（遵「直接引用、别重新考古」）—— 本 Spec 不产生任何新测量值。
7. **三份子文档未经主人复核**。
8. **本包自己的 chunk 运行期复验（新增，2026-10-13）**：`T0.1` 已证的是**宿主 rc.2 语义**，**不等于**本包 chunk 可用 ⇒ Phase 1 产物出来后**必须**复跑同一条运行时链路（判据：本包 chunk 被宿主的插件路由**真取到** + chunk 导出的组件**真渲染** + tab **真注册** + 控制台**零** `require` 崩溃），作为 Phase 1 的**验收条件**（**不**阻塞 Phase 1 开工）。

## Phase 0 静态证据（2026-10-13，真机 rc.2 产物只读取证）

- 取证方式：解析本机 `D:\Programs\DeepSeek Harness\resources\app.asar`（归档表 **12,967** 个文件）后**只读**取出官方插件源码；**未起探针实例、未装任何 profile、未改任何配置**。
- 关键代码（`@deepseek-ai/dsh-client-ui-sidebar-terminal@0.2.0-rc.2` 的 `lib/client.js:167`）：
  `const LoadedTerminalBody = (0, react.lazy)(async () => ({ default: (await require.async("./client.terminal.js")).TerminalBody }));`
- 由此确认四项语义：① `require.async` 存在且可 `await`；② 解析值为 chunk 模块命名空间；③ 说明符相对**请求方模块**；④ 与 `react.lazy` / Suspense 兼容。
- 打包契约：该包 `package.json` 的 `files` = `["lib/index.js","lib/client.js","lib/client.*.js","lib/types/**/*.d.ts"]` ⇒ chunk 随包发出、**不登记在 `exports`**。
- 失败路径（`@deepseek-ai/dsh-client-modules/lib/client.js` 默认取块钩子 = 同源 classic script）：`script` 的 `error` ⇒ **reject** 并带明确文案 `client-modules: bundle script ${url} failed to load` ⇒ 本 Spec 的 C4「可解释降级」有真实实现可依。
- 实体体量：`lib/client.js` = **19,869 B**、`lib/client.terminal.js` = **685,927 B**、`lib/index.js` = **210 B**。
- ⚠️ 口径澄清：本文件早前记录的 **19,887 / 685,949 B** 是**服务端下发版**（比归档内产物各多 **18 / 22 B**，属下发包装）⇒ **C1 / C2 判据一律钉在构建产物**（即 `packages/*/lib/client.js` 这类文件）上，**不钉下发字节**。
- ⏳ **仍未勾**：`T0.1` 的**运行时**那一半（真浏览器里 `require.async` 真取 chunk、真走 error 分支）**尚未观测** ⇒ 动态验证仍需临时 profile 探针，**动手前先问主人**。 🔴 **订正（2026-10-13）：本行所记的「仍未勾」已作废 —— 该半已观测**（主人 2026-10-13 批准 `T0.1` + `T0.2` 一起做；动态验证已做，证据见文末「Phase 0 运行时证据」），原文一字未删。
## Phase 0 运行时证据（2026-10-13，真机 volatile-probe + 官方 chunk 同路径）

- 授权：主人 **2026-10-13** 批准「`T0.1` + `T0.2` 一起做」。探针 = 临时 profile `volatile-probe`（**未装任何插件、未改任何 profile 文件**；零 `pnpm`、零 `node_modules` 变更、零仓库文件变更）。
- 实例命令：`node D:\nodejs\node_modules\@deepseek-ai\dsh\lib\bin.js --profile volatile-probe --host 127.0.0.1 --port 43311 --no-open` ⇒ `dsh web: http://127.0.0.1:43311/?token=<每次启动新发>`。
  - ⚠️ 启动时 stderr 有一行 `dsh: skipping profile bundle "dsh-volatile-probe": … cannot resolve profile bundle …`（其 `link:` 目标 `%TEMP%\dsh-volatile-probe` 已不存在）—— **该行只是「跳过这个 bundle」的警告**，进程照起、端口**真监听**（`Get-NetTCPConnection -LocalPort 43311 -State Listen` = True）⇒ 因此**没有**去摘那条悬空 link，**一个 profile 文件都没碰**（比预案更干净）。
- 驱动方式：零依赖 Node CDP 脚本（Node v24.15.0 自带 `fetch` + 全局 `WebSocket`）驱动独立 user-data-dir 的 Chrome（CDP `http://localhost:9333`）；**逐轮用全新 `about:blank` 页隔离**，并 `Network.setCacheDisabled(true)` 保证 chunk 真传输（而非命中缓存）。
- 证据归档（**仓外**，保证本仓 `git status` 干净）：`C:\Users\EDY\dsh-probe-artifacts\20261013-011-phase0\`（`cdp.mjs` + 4 张截图 + 5 份命令输出原文 `.log`）。

### T0.1 运行时链路（真机观测；三件齐 ⇒ 通过）

- 干净基线：`prep = { closedTabs: 0, tabsBefore: [], chunkBefore: 0 }` ⇒ 点击前**零 chunk 请求**、右栏**零 tab**（不是「boot 期已顺带取过」的假象）。
- 动作：右栏「新标签页」→ 弹出菜单里点「新建终端」（官方终端页的 guide chip，与 `Ctrl+反引号` 同一个入口）。
- 证据①-a（chunk **真取**；命令输出原文见 `T01-open.log`）：
  `chunkRequests = [{ url: "/plugins/@deepseek-ai/dsh-client-ui-sidebar-terminal/client.terminal.js?rev=437b2f67ec1f", status: 200, bytes: 175497, type: "Script" }]` ⇒ **恰好一次**懒取、200、**175,497 B**（gzip 传输字节；产物本体 685,961 B 未压缩）。
- 证据①-b（tab **真注册** + 组件**真渲染**）：`ui.tabs = ["cmd.exe"]`；`ui.terminalEcho = ["cmd.exe","Microsoft Windows [Version 10.0.22631.5335]","E:\IdeaProjects\mcp-rest-bridge> "]`（**真 PTY 回显**，非占位文本）；截图 `T01-chunk-loaded-terminal-rendered.png`（右栏 tab「cmd.exe」+ 回显 + 光标）。
- 证据②（产物里 `require.async` 命中 ≥ 1）：静态原文见本文件「Phase 0 静态证据」的 `lib/client.js:167`；本轮运行期真取块即**该调用的实际执行**。
- 证据③（控制台**零**未声明 `require` 崩溃）：`console = []`、`exceptions = []` ⇒ 三件齐。
- ⚠️ **口径与边界（必须与结论一起读）**：本轮链路走的是**官方插件自己的 chunk**（**同一宿主代码路径**：同一 `require.async`、同一 `__ModuleLoader__.load`、同一 `@deepseek-ai/dsh-client-modules` 取块钩子）⇒ 本闸门要证的 **rc.2 宿主语义**已证；**本包自己的 chunk 尚不存在**，其运行期复验 = `Phase 1` 产物的验收条件（**已登记为未验项 8**）。另：`volatile-probe` 起得来是因为其 bundle 含 `@deepseek-ai/dsh-web-app`（其 `dependencies` 已含该官方终端插件）⇒ **零安装**即可观测，未向任何 profile 装任何插件。

### T0.2 三态失败基线（**只记录**，本 Phase 未改一行代码）

| 态 | 制造方式（CDP 拦截 / 仿真，**零文件改动**） | Network 原文 | Console 原文（节选） |
| --- | --- | --- | --- |
| ① chunk 404 | `Fetch.enable` 拦 `*client.terminal.js*` → `Fetch.fulfillRequest` 404 | `status: 404`、`failed: net::ERR_ABORTED (canceled)` | ① `Failed to load resource: … 404 (Not Found)` ② `Error: client-modules: bundle script …client.terminal.js?rev=… failed to load`（`dsh-client-modules/client.js&rev=b7a0ef28df32:461`）③ `slot entry crashed in 'sidebar.right.pane.tab': Error: … failed to load` |
| ② 执行期抛错 | 同拦截，但 200 + body = `throw new Error("011-probe: 故意在 chunk 执行期抛错")`（123 B） | `status: 200`、`bytes: 123` | ① `client-modules: bundle … loaded without registering "…/client.terminal.js" via __ModuleLoader__.load`（`…:739`）② `slot entry crashed in 'sidebar.right.pane.tab'`；**`exceptions` = `Uncaught Error: 011-probe: 故意在 chunk 执行期抛错 … client.terminal.js?rev=…:1:7`** |
| ③ 断网（a：整页加载） | `Network.emulateNetworkConditions{offline:true}` ⇒ 再导航 | 无请求（导航即失败） | Chrome 自身离线页：`ERR_INTERNET_DISCONNECTED` +「未连接到互联网」 |
| ③ 断网（b：**已加载后**断网，更有信息量） | 在线加载 → 关空全部右栏 tab（`tabs = []`，历史 chunk 请求仅 1 次）→ 断网 → 点「新建终端」 | 第 2 条 chunk 请求 `failed: net::ERR_INTERNET_DISCONNECTED` | 3 × `Failed to load resource: net::ERR_INTERNET_DISCONNECTED` + `bundle script … failed to load` + `slot entry crashed in 'sidebar.right.pane.tab'` |

- 可观测 UI 现象（截图）：404 态 **tab 仍在**（`tabsAfter = ["cmd.exe"]`）但**面板空白**；断网(b) 态 tab 名退化为 `["终端"]`（真终端未起）。⇒ **现行官方实现不会白屏，但也没有任何原因文案 / 重试**（痕迹只在 Console）—— 这正是本 Spec `C4`「可解释降级」（`T2.4`）要补的缺口，与 `V3` / `V4` 的期望对得上。
- 归档：`T02a-chunk-404.png` / `T02b-chunk-throw.png` / `T02c-offline-whole-page.png` / `T02d-offline-chunk-failed.png` + 同名 `.log`（命令输出原文）。
- ⚠️ **如实登记两次无效观测**（均已作废并重跑）：ⓐ 首轮 `T0.2` 的 `mode` 参数把截图路径一并吞掉 ⇒ 拦截器**未启用**，那两次跑的是普通加载（结果作废）；ⓑ 首轮 `offline2` **忘了复位离线**，把下一轮拖进「连接丢失 / 选择工作区」降级态（该轮 T0.1 日志被污染，已弃用）⇒ 修好（**拦截器早于导航** + 每轮**复位离线** + 逐轮**全新页**）后全部重跑，**上表与 T0.1 结论一律取自重跑后的干净证据**。

### T0.3 闸门纪律证据

- 命令与输出原文（本 Spec 阶段全程）：`git status --porcelain` ⇒ **0 行（空）**；`HEAD = e11b503`。
- ⇒ 本 Spec 阶段**零** `packages/**` 改动；本轮改动**只有本文件自己**。探针脚本 / 截图 / 日志全部落在**仓外**（`C:\Users\EDY\dsh-probe-artifacts\` 与 `%TEMP%\dsh-011-probe\`）。
- 收尾核验：实例已停（端口 43311 **已释放**、`dsh\lib\bin.js` 进程数 = **0**、PTY 子进程**无孤儿**）；探针 Chrome 内的陈旧页已关闭。
