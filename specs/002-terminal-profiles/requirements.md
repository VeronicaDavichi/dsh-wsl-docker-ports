# 功能需求：dsh-terminal-profiles 可配置终端

> 需求驱动（**requirements-first**）：先定 REQ 与 EARS，[design.md](./design.md) 从需求派生。任务见 [tasks.md](./tasks.md)。

---

## 0. 项目文档摘要（docs/ 全量扫描）

本仓库**没有 `docs/` 目录**，全部子目录为空。

| 子目录 | 状态 | 本 Spec 使用方式 |
|--------|------|-----------------|
| `docs/architecture.md` | （空）| — |
| `docs/dev-guide.md` | （空）| — |
| `docs/api-contracts/` | （空）| — |
| `docs/db-schema/` | （空）| — |
| `docs/references/` | （空）| — |
| `docs/standards/` | （空）| — |

**替代真相来源（SSoT）**：`stack-decision.md`。为补上「来源精度」，每条 REQ 都标出所依据的**维度键**：

| 维度键 | 内容要点 | 本 Spec 使用方式 |
|---|---|---|
| `plugin.terminalEngine` | `spawnTerminal` 接受 `argv`+`cwd`+`env`+`rows/cols/terminalType`；标签布局/重连/滚动缓冲/主题自建 | REQ-3 / REQ-5 |
| `plugin.agentSurface` · `plugin.agentReadModel` | 完整工具族；屏幕快照 + 增量流两者都给 | **004**（屏幕模型本体 = REQ-6）|
| `plugin.agentPermission` | 受 `ctx.sandboxPolicy` + 审批；官方对 bash/fs/终端同策略 | **004** |
| `plugin.hostScreenModel` · `plugin.renderer` | `@xterm/headless` + serializer；`@xterm/xterm` + fit 落在**独立懒加载 chunk**（2026-10-09 订正留痕，见 REQ-5.1）| REQ-6 / REQ-5 |
| `plugin.clientTransport` | 自建 `ctx.webServer` 具名路由 + WS upgrade；认证与重连自建；**HTTP 用 prefix、upgrade 用单一 exact 端点** | REQ-7 |
| `plugin.tabKind` | 新 kind `managedTerminal` + extension 档 | REQ-4 |
| `plugin.configSchema` · `plugin.wslCwd` | `name/cwd/command/args/env`；后加 `cwdLinux` 双字段 | REQ-1 / REQ-3.2 |
| `plugin.configStore` · `plugin.profileConfigLiveness` | **静态 `Config` 导出 + 条目 id 作命名空间**；live 走 `settings` 三写操作（**不重挂载**）、完整配置走 `configEditor.edit()`（**会重挂载**）；`profiles` 整数组 `.volatile()`（读走 `.get()`）；三条已知限制 | REQ-2 / REQ-10 |
| `plugin.crossPackageService` | 包 B 可选注入包 A 服务 + 降级置灰；不建包依赖边 | REQ-11 |
| 冲突自检表 | 路由前缀独占、两份 xterm 共存、配置校验容错、Electron 未验 | REQ-1.2 / REQ-5.2 / REQ-7.1 / 已知限制 |
| 关键前置事实表 | 官方终端「输出不进 transcript」「cwd 锁死 Session 工作区」 | README 的差异化结论 |

---

## 1. 概述

见 [README.md](./README.md)。一句话：**profile 驱动的真 PTY 右栏终端，Agent 可通过工具族读写，且 Agent 的写操作受宿主沙箱策略约束。**

---

## 2. 交互控件清单

### 2.1 终端页（kind `managedTerminal`）

| 控件 | data-testid | 触发行为 | 副作用（可观察）|
|------|-------------|---------|----------------|
| 页眉入口按钮 | `btn-terminal-open` | 打开终端页 | 右栏出现 `managedTerminal` 标签并聚焦 |
| profile 下拉 | `sel-profile` | 选择 profile | 选中项变化；不启动 |
| 启动终端 | `btn-term-start` | 对选中 profile 起实例 | 实例列表 +1；新面板出现提示符 |
| 终止终端 | `btn-term-kill` | kill 该实例 | 实例列表 −1；面板变「已终止」占位 |
| 终端画布 | `term-surface` | 键盘输入 | PTY 收到字符（回显可见）；`write` 计数 +1 |
| 画布尺寸变化 | （fit 自动）| 容器 resize | `rows/cols` 更新；PTY 收到 resize |
| 滚动区 | `term-scrollback` | 滚轮 / 拖动 | 视口变化；**不**改变 Host 屏幕模型 |

### 2.2 配置页（`plugins.row.config`）（已迁出）

> ✅ **2026-10-09 已迁出至 [`007-terminal-config-page`](../007-terminal-config-page/README.md)**（与 `REQ-10`、design §4、`Phase 6` 同批；编号原样保持）。
## 3. 功能需求

### REQ-1 配置模型与容错

- **REQ-1.1** 配置 SHALL 为 `profiles` 数组，每项含 `name`、`command`（必填）与 `args`、`cwd`、`cwdLinux`、`env`（可选；缺省 `[]` / `{}`）。
- **REQ-1.2** GIVEN 某个 profile 校验失败（缺必填、类型错），THEN 系统 SHALL 跳过该条并记录警告，其余 profile SHALL CONTINUE TO 可用，SHALL NOT 让整个 profile 启动失败。
- **REQ-1.3** GIVEN 两个 profile 同名，THEN 系统 SHALL 拒绝后者并提示冲突来源，SHALL NOT 静默覆盖。
- **REQ-1.4** GIVEN WSL profile 只填 `cwd` 未填 `cwdLinux`，THEN 系统 SHALL 经 **006** 的路径翻译推导 `cwdLinux`；推导失败时该条 SHALL 标记为「需修复」且不可启动，SHALL NOT 猜路径。
- **REQ-1.5** GIVEN `profiles` 为空或全部无效，THEN 终端页 SHALL 显示配置引导，SHALL NOT 报错或空白。

### REQ-2 配置存活（编辑不杀终端）

- **REQ-2.1** GIVEN 存在运行中的终端实例，WHEN 用户保存 **volatile-only** 变更（改 `profiles`），THEN 行 SHALL NOT 重挂载，运行中终端 SHALL CONTINUE TO 存活（PTY pid 不变）。**成立前提 = B-1 ✅ 已闭环（2026-10-08 五条全定案）**：机制由宿主源码确认（整数组标 volatile 成立，见 `stack-decision.md` 的 `plugin.profileConfigLiveness.evidence`），**且真机已验证** live 写入 152ms 生效、不重挂载、值经 `.get()` 真传播（详见 tasks.md T0.1）。<br>⚠️ **2026-10-09 订正**：原文写「剩余 5 条真机行为链见 tasks.md T0.1」—— 真机链当日已跑完全部定案，属结论已出、正文未同步的**指令残留**。
- **REQ-2.2** GIVEN 待保存变更**含 ordinary 字段**（会退化为 remount），THEN 系统 SHALL 在写盘前提示「正在运行的终端将被终止」并要求确认，SHALL NOT 静默重挂载。
- **REQ-2.3** 本包 SHALL NOT 为 ordinary 字段声明「每次 parse 造新实例」的 transform（否则无变更也会 remount）。
- **REQ-2.4** 编辑 `cwd` / `cwdLinux` SHALL NOT 迁移已运行实例（只影响新建），并在配置页明示这一点。

### REQ-3 终端启动（真 PTY）

- **REQ-3.1** GIVEN 用户对某 profile 点启动，THEN 系统 SHALL 以 `argv = [command, ...args]`、`cwd`、`env`、初始 `rows/cols` 与 `terminalType` 调 `ctx.subprocess.spawnTerminal` 起**真 PTY**。
- **REQ-3.2** GIVEN 目标是 WSL profile（`command` 为 `wsl.exe`），THEN PTY 的 `cwd` SHALL 取 `cwdLinux`（宿主与 Linux 的路径语义不同，不得混用）。
- **REQ-3.3** GIVEN `cwd` / `cwdLinux` 不存在或不可访问，THEN 系统 SHALL 明确报错并指出该路径，SHALL NOT 静默回落到 Session 工作区或 `$HOME`。
- **REQ-3.4** GIVEN 同一 profile 再次点启动，THEN 系统 SHALL 起**新实例**，SHALL NOT 劫持或复用已有实例。
- **REQ-3.5** GIVEN `spawnTerminal` 失败或抛错，THEN 系统 SHALL 在 UI 显示原因（含被拒绝的能力名），SHALL NOT 留下无内容的幽灵标签。

### REQ-4 右栏页类型

- **REQ-4.1** 系统 SHALL 注册 kind 为 `managedTerminal` 的页类型与标题 seat（`sidebar.right.pane.tab` + `.title`），走宿主默认 **extension** 档。
- **REQ-4.2** 该 kind SHALL NOT 与官方已用 kind 重名；SHALL NOT 复用官方 `terminal`。**2026-10-09 订正（实物契约研究）**：原文写「官方 6 个 kind（`files`/`text`/`changes-review`/`scheduleTask`/`browser`/`terminal`）」—— 实物证明 **0.1.7-rc.2 实为 9 个**（`guide`/`files`/`browser`/`text`/`changes-review`/`terminal`/`scheduleTask`/`plan`/`subagentchat`），且 `kind` 是**开放字符串**（无枚举、无 `PageKind` 类型）⇒ 判据改为「不与官方已用重名」（可二值判定），`managedTerminal` 未被任何官方包占用 ✅。证据逐条见 [`client-contract.md`](../../client-contract.md) §P1；「0.2.0-rc.2 的 kind 总数」仍属未验证项（真机 `sidebarRightTabs.entries()` 打印）。
- **REQ-4.3** GIVEN 多个实例，THEN 每个 tab SHALL 只承载一个实例，列表顺序 SHALL 稳定（按创建序）。
- **REQ-4.4** 页类型注册 SHALL 返回 disposer；卸载后 SHALL NOT 残留注册。
- **REQ-4.5** GIVEN 宿主缺少右栏能力，THEN 系统 SHALL 不注册并给出明确原因，SHALL NOT 抛错。

### REQ-5 渲染与尺寸同步

- **REQ-5.1** `@xterm/xterm` + `@xterm/addon-fit` SHALL 落在**独立懒加载 chunk**（主 bundle SHALL NOT 因它增长）：主 bundle 用 `await require.async("./client.terminal.js")`（宿主 ModuleLoader 的**异步块 API**）在**终端视图首次挂载时**取它；chunk 自身以 `window.__ModuleLoader__.load({ id, chunk: 'client.terminal.js', factory })` 自注册。**2026-10-09 订正留痕（一日内二次）**：本条原判据即此、**正确**；同日曾据另一个插件（`dsh-plugin-desktop` 的 `codeSplitting: false`）改成「单产物」，**随即被官方终端页实物推翻并撤回** —— 官方 `dsh-client-ui-sidebar-terminal` 主 bundle **19,887 B**、懒加载 chunk **685,949 B**（xterm 内联其中），`require.async` 调用点、`chunk:` 字段、chunk 不在 `exports` 里均有逐字证据，见 [`client-contract.md`](../../client-contract.md) §P2。**方法教训：否定性结论必须取自「做这件事的那个官方包」，不能从别的插件反推。**
- **REQ-5.2** `xterm.css` SHALL 只在自有容器作用域内生效，SHALL NOT 注入全局样式（官方终端另有同源 chunk，两份共存会互相污染）。
- **REQ-5.3** GIVEN 容器尺寸变化，THEN 系统 SHALL 先 fit 再计算 `rows/cols`，并把新尺寸同步到 PTY。
- **REQ-5.4** Agent 的 `read` SHALL NOT 改变用户所见画面（读是纯只读）。
- **REQ-5.5** 渲染 SHALL 只用宿主 `--dsw-*` token，SHALL NOT 出现硬编码 hex。

### REQ-6 Host 屏幕模型与读模型

- **REQ-6.1** Host SHALL 为每个实例维护 `@xterm/headless` + serializer 的屏幕模型。
- **REQ-6.2** **快照** SHALL 返回当前屏幕文本（serializer 产出）与尺寸；GIVEN 请求 scrollback 尾部，THEN SHALL 返回有界尾部内容。
- **REQ-6.3** **增量流** SHALL 返回自 `sinceSeq` 起的块，每块带单调递增 `seq`；GIVEN `sinceSeq` 早于缓冲下界，THEN 系统 SHALL 明确返回「已丢失」并附快照，SHALL NOT 静默丢块。
- **REQ-6.4** 每实例增量缓冲 SHALL 有界（命名常量上限）；超限 SHALL 按 FIFO 丢弃并累计 `dropped` 计数供 UI/日志显示。
- **REQ-6.5** 快照与增量 SHALL NOT 修改 PTY 状态，SHALL NOT 注入输入。

### REQ-7 传输通道（自建）

- **REQ-7.1** 系统 SHALL 注册**独占前缀** `/dsh-managed-terminal/` 的**具名 HTTP 路由**（`kind = prefix`），并注册**单一 exact 路径**的 upgrade 路由（如 `/dsh-managed-terminal/ws`，多终端在协议层用会话 id 复用同一端点）；SHALL NOT 占用 `/api` 或与官方任何 `(kind, path)` 重叠。**源码实证**：官方匹配顺序为 **exact 全表 → 最长 prefix → fallback**、注册顺序无语义、fallback 单座位且只答「无具名路由匹配」的请求 → 不重叠即互不干扰（**与 SPA fallback 无关**）；而重叠会直接抛 `webserver: duplicate <kind> route "<path>"`。⚠️ **`registerUpgrade` 只接受 exact path** —— 「独占前缀的 upgrade 路由」不成立，故拆成 prefix（HTTP）+ exact（upgrade）两种注册。
- **REQ-7.2** WS 握手 SHALL 校验来源与一次性令牌（令牌由 Host 在页面挂载时下发）；GIVEN 校验失败，THEN SHALL 立即关闭连接，SHALL NOT 泄露实例信息。
- **REQ-7.3** GIVEN 连接断开后重连，THEN 系统 SHALL 按 `seq` 续传；无法续传时 SHALL 下发快照。
- **REQ-7.4** 每个实例 SHALL 至多一个活跃 WS；GIVEN 新连接到达，THEN 系统 SHALL 明确「顶掉旧的」或「拒绝新的」（须择一实现并记录），SHALL NOT 双写。
- **REQ-7.5** 实例枚举（list）SHALL 同样经过握手校验，SHALL NOT 对未授权页面开放。
- **REQ-7.6** 路由/upgrade 注册 SHALL 可卸载（登记 effect-scoped disposer）；卸载后 SHALL 回落到官方行为，SHALL NOT 劫持未知路径。**源码实证**：`register` / `registerUpgrade` 均返回 disposer，且重复 `(kind, path)` 注册**抛错** → SHALL NOT 依赖注册顺序，也 SHALL NOT 在重挂载时二次注册同一路径。
- **REQ-7.7** 增量扇出 SHALL NOT 无界排队：GIVEN 消费者慢，THEN 系统 SHALL 触发 REQ-6.4 的丢弃策略，SHALL NOT 拖垮宿主事件循环。

### REQ-8 / REQ-9（已迁出）

Agent 工具族与沙箱权限**已整体迁至 [004-terminal-agent-surface](../004-terminal-agent-surface/requirements.md)** 并重编号为 REQ-1..REQ-4（2026-10-08 拆分；原 REQ-8/REQ-9 的内容**逐条保留、无删改**）。本 Spec 自即日起**不再定义** Agent 面 —— 它属于 004。编号 **8/9 保留为空位**，以免下方全部既有引用错位。

### REQ-10 配置页（已迁出）

> ✅ **2026-10-09 已迁出至 [`007-terminal-config-page`](../007-terminal-config-page/requirements.md)** —— `REQ-10.1`–`REQ-10.5` 与本文件 §2.2 **一并移交**，编号不变。
### REQ-11 跨包服务（供 003 消费）

- **REQ-11.1** 本包 SHALL 导出 `managedTerminal` 服务，面为 `open` / `list` / `read` / `write` / `resize` / `kill` 的能力子集。
- **REQ-11.2** 服务消费方（003）SHALL 能经可选注入使用它，SHALL NOT 因此建立包依赖边（保住 L3 隔离）。
- **REQ-11.3** GIVEN 本包未加载，003 的消费点 SHALL 由 003 侧置灰；本包 SHALL NOT 因「无人消费」而报错或注册多余内容。

### REQ-12 生命周期与清理

- **REQ-12.1** GIVEN 插件行被卸载或禁用，THEN 系统 SHALL 关闭全部 WS、注销路由/页类型/工具，并**终止全部实例**（不假装 PTY 能跨卸载存活），且 SHALL 记录该行为到日志。
- **REQ-12.2** 卸载后 SHALL NOT 遗留 resize 监听、WS 定时器、事件订阅（可用计数断言归零）。
- **REQ-12.3** GIVEN 用户关闭终端 tab（`×`）但插件仍加载，THEN 实例 SHALL CONTINUE TO 运行（会话归 Host）；再次打开页 SHALL 从屏幕模型恢复画面（不重放历史字节流）。

### REQ-13 安装与接入（D-1）

- **REQ-13.1** 本包 SHALL 以 `link:<绝对路径>` 加入目标 profile `package.json` 的 `dependencies`，包名 SHALL 加入同一文件的 `dsh.profile.bundles`（与同机 `@xxxyz/dsh-mcp-manager` 同型先例）；安装 SHALL 为交付文档中的一次性显式步骤，**本包运行时 SHALL NOT 改写 profile 清单**（自举风险）。
- **REQ-13.2** 安装完成的判定 SHALL 为三件同时成立：行出现在 profile 行列表、终端页 kind 已注册、**无 compatibility 预检 `disabled`**（官方 `prepareProfileEntries` / `evaluatePluginCompatibility` 会把不兼容行 disable 并写 stderr —— 不兼容时 SHALL 依宿主结果说明原因，SHALL NOT 自行绕过）。
- **REQ-13.3** 卸载 SHALL 表现为行消失 + 页/工具/路由全部注销（REQ-12.1）；SHALL NOT 在 profile patch 留下孤儿 `- id:` 条目（patch 由宿主 loader / `configEditor` 管理，本包不手写）。
- **REQ-13.4** `link:` 模式下 SHALL 明示「路径即版本」的开发工作流（改源码 → 重载/重启生效），SHALL NOT 声明不存在的版本号语义。

---

## 4. 非功能需求

- **NFR-1** `react` 走 `peerDependencies: ^18.2.0`，SHALL NOT 打进 bundle。
- **NFR-2** xterm 两个包 SHALL 落在**独立的客户端 chunk** 里（`require.async("./client.<name>.js")` + `chunk:` 字段自注册），主 bundle 体积 SHALL 记录基线并在实现后对比（不设硬阈值，但须记账）；**`react` / `react-dom*` / `@deepseek-ai/*` SHALL 保持 external**（`require` 由宿主供给，按官方终端页的做法全部声明为 `devDependencies`）。**2026-10-09 订正留痕**：原文即「落在懒加载 chunk」（**正确**）；同日一度改为「单产物」并**被实物推翻撤回**，理由与证据见 REQ-5.1 与 [`client-contract.md`](../../client-contract.md) §P2。
- **NFR-3** 内网/离线可用：SHALL NOT 依赖 CDN、SHALL NOT 运行 `npx`；依赖安装后打进 bundle（handover 硬约束）。
- **NFR-4** 零全局 CSS、零硬编码 hex（只用 `--dsw-*` token）。
- **NFR-5** `typecheck` + `vitest` + `build` 三项 SHALL 全绿。
- **NFR-6** 单文件 ≤ 400 行、单 Spec 文档 ≤ 200 行（`leanspec` 校验门 warn 200 / max 400）。

---

## 5. 约束与假设

| # | 内容 | 影响 |
|---|------|------|
| C-1 | 基线锁 **0.2.0-rc.2**；不改官方包、不 require 私有依赖 | 官方终端的 seat 与 kind 契约按 rc.2 实测 |
| C-2 | 只用宿主公开插槽/服务；所有注册必须有 disposer | REQ-4.4 / REQ-12.2 的基础 |
| C-3 | 会话与配置**分属同一行的两半**：终端实例是 Host 状态，`profiles` 是配置 | REQ-2.4 与 REQ-12.3 的语义边界 |
| A-1（**2026-10-08 五条全部定案**）| `z.array(...).volatile()` 整数组标生效 | REQ-2.1 的成立前提，**成立**。① 机制（源码）：`equalExceptVolatile` 只在**固定对象路径**忽略 volatile，`isSchemastery()` 判 `schema['~standard'].vendor === 'schemastery'`。② **离线定案（第 4/5 条）**：元素内标 volatile → **parse 时**抛 `ValidationError`（非构造时）；数组级解析为**带 `.get()` 的深冻结对象**（下标取值 `undefined`）⇒ **读配置必须走 `.get()`**。③ **真机定案（第 1/2/3 条，临时 profile + 探针插件）**：live 写入 152ms 生效、**不重挂载**且 volatile 引用 `.get()` **值真传播**；改 ordinary 字段**真的 remount**（判定非恒真）；非法值**静默拒绝、插件不崩**。⏳ 唯一未命中项：`_commitVolatile()` 失败回落 remount 的分支未复现 → 真实插件复测 |
| A-2（**假设**）| 宿主 slot 渲染 React 节点，`react ^18.2.0` 由宿主提供 | 不成立需自带 React 或换适配层 |
| A-3（**源码已确认**）| `ctx.webServer` 的自定义具名路由与 upgrade 在 Web GUI 下可用；Electron 走 `file://` + IPC 桥接 | 已定案：官方 `dsh-host-webserver` 原文「It serves browsers only; Electron loads dist over `file://` and carries fetch over an IPC bridge」→ 桌面版不在本 Spec 范围（不再是未知项）|
| A-4（**假设**）| 沙箱策略对终端一致施加（官方文档写明对 bash/fs/终端同策略）| **004** 的 REQ-3.3 的依据；若不成立须改口径并在 README 明示 |
| A-5（**已确认**）| 内网有 npm registry / 私有镜像 | 依赖可安装并打进 bundle |
| A-6（**2026-10-08 已定案，假设成立**）| `settings.update` 的值**会落盘**（重启不丢）| **成立**：`settings.update` 的值**立即**写进 profile 的 `cordis.patch.yml` —— 探针直接读出 `settings.documentPath = …\profiles\volatile-probe\cordis.patch.yml`、`writable = true`；`update` 后 **3s（进程仍在跑）文件内容已更新**；**重启后该值被正常加载**（`[a,C1]`）。⇒ REQ-2.2 的「改配置不杀终端 + 改完不丢」**两条路径都闭环**，**无需**另配落盘路径。⚠️ 反面教训：先前一度记为「不落盘」，是我的对照步**手写同一 patch 文件**造成的自伤假阳性（详见 `stack-decision.md` 变更记录第 22 条）|
