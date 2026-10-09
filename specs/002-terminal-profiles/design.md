# 技术设计：dsh-terminal-profiles 受管终端

> 从 [requirements.md](./requirements.md) 派生（requirements-first）。任务见 [tasks.md](./tasks.md)。

---

## 1. 双面架构

    ┌─ Host face（插件行：cordis 插件，Node 进程内）──────────────────────────┐
    │  session-manager   PTY 实例表（id → { pty, screen, buffer, size }）      │
    │  screen-model      @xterm/headless + serializer（快照 + seq 增量块）      │
    │  ws-router         /dsh-managed-terminal/{ws,list,…}（ctx.webServer）    │
    │  agent-tools       defineTool ×6（new/list/read/write/resize/kill）      │
    │  config-page       plugins.row.config + configure({ auto:false })       │
    │  service-export    ctx.provide('managedTerminal', …) → 供 003 可选注入    │
    └───────────┬───────────────────────────────────────────┬────────────────┘
                │ ctx.subprocess.spawnTerminal(spec)         │ WS（自建，独占前缀）
                ▼                                            ▼
        Windows PTY（conhost/ConPTY）            ┌─ Client face（浏览器）──────────┐
        └ pwsh.exe / wsl.exe -d Ubuntu2204       │  tab-registration  kind=        │
                                                 │    managedTerminal（extension） │
                                                 │  TerminalPane（React）          │
                                                 │  xterm-chunk（懒加载）          │
                                                 │  transport（WS 客户端 + 重连）   │
                                                 └────────────────────────────────┘

依赖方向：本包 → `node:` 内置 + 宿主公开服务 + **001（`dsh-wsl-shared`）**；003 → 本包**仅经可选注入服务**，无包依赖边。

---

## 2. Host 侧设计

### 2.1 实例表与会话状态

| 字段 | 说明 |
|---|---|
| `id` | 实例标识（工具面与 UI 共用）|
| `profileName` | 来源 profile（配置改后**不**迁移，REQ-2.4）|
| `pty` | `spawnTerminal` 返回的受管终端句柄 |
| `screen` | `@xterm/headless` 实例（列数/行数随 resize 更新）|
| `seq` / `buffer` | 单调递增序号 + **有界**增量块环形缓冲（REQ-6.4）|
| `dropped` | 因缓冲上限丢弃的块数（UI/日志可见）|
| `size` | 最近一次生效的 `rows/cols`（工具 resize 的实际值来源）|

### 2.2 屏幕模型

PTY 输出 → `headless.write(data)` → serializer 产出快照。**快照与增量同源**：增量块就是 `data` 分片，快照是 serializer 的当前帧。这样 TUI 重绘（清屏、光标跳转）后快照正确，而增量仍低延迟。

**有界策略**：`TERM_BUFFER_MAX_BLOCKS`（命名常量）与 `TERM_BUFFER_MAX_BYTES` 双上限；超限 FIFO 丢弃 `dropped++`。读取方 `sinceSeq < bufferOldestSeq` → 返回 `{ lost: true, snapshot }`（REQ-6.3）。

### 2.3 WS 协议（自建）

| 方向 | 消息 | 载荷 |
|---|---|---|
| C→H | `attach` | `{ instanceId, token, sinceSeq? }` |
| C→H | `input` | `{ data }`（原样写入 PTY；UI 侧不走工具面）|
| C→H | `resize` | `{ rows, cols }` |
| H→C | `attached` | `{ size, snapshot, seq }` |
| H→C | `chunk` | `{ seq, data }` |
| H→C | `lost` | `{ snapshot, seq }`（REQ-6.3）|
| H→C | `exit` | `{ code }` |
| H→C | `error` | `{ code, message }` |

- 握手：升级请求校验 `Origin` 与一次性令牌（Host 在页面挂载时下发，短 TTL、单次使用）；失败 → 立即 `close`，不回任何实例信息（REQ-7.2）。
- 每实例**一个**活跃连接：新连接到达时**顶掉旧的**（旧的收 `error:'superseded'` 后关闭）—— 择此案的理由：页面刷新后旧连接可能仍在半死状态，顶掉比拒绝更不容易把用户锁死。REQ-7.4 要求择一，此为实现选择，写入 README 已知限制。
- 背压：`buffer` 满即丢（REQ-7.7），**不**对 WS 做无界排队。

### 2.4 工具族与权限映射（已迁出）

`defineTool` ×6 与沙箱权限映射**已迁至 [004-terminal-agent-surface](../004-terminal-agent-surface/design.md)** 的 §2–§4（2026-10-08 拆分）。包内目录仍是 `src/agent-tools/`，但它**由 004 拥有**：002 不知道工具面存在 —— 工具面只**只读消费**本包的 `session-manager` / `screen-model`，不反向依赖（004 的 NFR-3）。

---

## 3. Client 侧设计

> 📌 **客户端半的完整装载契约已实物定案**（清单三件 / CJS 工厂自注册 / `ctx.slots` 注册 / 写管道 / 样式作用域），逐条带 `文件:行` 的证据在 **[`client-contract.md`](../../client-contract.md)**（§A–F + §P 增量覆盖段）。**本节只留本 Spec 的选择，不复制契约**（避免两处漂移）。

- **装载**：`dsh.client = { platform:'web', inject:[客户端模块包名…] }` + `exports['./client'] → ./lib/client.js`；入口导出 `{ apply, inject: ['slots'], name? }`（**无默认导出**，与宿主半相反）；产物 = **自注册 CJS 工厂** `window.__ModuleLoader__.load({ id: 'dsh-terminal-profiles', factory })`。
- **右栏页**：`sidebarRightTabs.register({ id: 'dsh-terminal-profiles', kind: 'managedTerminal', multiple: true, keepMounted: true, title })`（`priority` **留空** = `extension` 档）+ 两个 keyed seat（`sidebar.right.pane.tab` / `.title`，key = `id`）；**宿主半零改动**；缺能力 ⇒ 不注册 + 给原因（REQ-4.1/4.4/4.5）。
- **终端视图**：xterm 落在**独立懒加载 chunk**，由主 bundle 在**终端视图首次挂载时** `await require.async("./client.terminal.js")` 取（**REQ-5.1 原判据正确**；2026-10-09 我一度误订正为「单产物」，同日已撤回，见 `client-contract.md` §P2）；`FitAddon` 在容器 resize 时 fit；样式 = CSS 字符串 → `<style data-plugin="dsh-terminal-profiles/styles">` + 类名前缀 + `--dsw-alias-*`（零硬编码 hex，REQ-5.2/NFR-4）。
- **transport 与状态**：自建 WS（重连带 `sinceSeq`；`lost` ⇒ `term.reset()` + 快照重建）；**配置读写**走 `remote.settings.update/describe`（即 §4 的 settings 路径），自建 HTTP 路由只承载终端动作与大文件；终端画面走 ref（高频流，避免整树重渲染），宿主 `dsh-client-store` 只用在宿主集成处。

---

## 4. 配置写入管道（已迁出）

> ✅ **2026-10-09 已迁出至 [`007-terminal-config-page`](../007-terminal-config-page/design.md)**（含 4.1 方案切换点）；本文件 §11 的宿主契约事实**仍在此处**（两侧共用 SSoT）。
## 5. 服务契约（供 003 可选注入）

    ctx.inject(['managedTerminal'], scope => { scope.managedTerminal.open({ profile }) })

| 方法 | 语义 | 失败 |
|---|---|---|
| `open({ profile, cwdOverride? })` | 起实例，返回 `{ id }` | typed error（profile 不存在 / 沙箱拒绝 / cwd 不可用）|
| `list()` | 实例摘要数组 | — |
| `read({ id, mode, sinceSeq? })` | 同工具面 | typed error |
| `write({ id, data })` | 同工具面 | typed error |
| `resize({ id, rows, cols })` | 返回实际值 | typed error |
| `kill({ id })` | 终止 | typed error |
| `subscribe(id, cb)` | 增量推送（003 若要做嵌入视图）| 返回 unsubscribe |

**L3 约束**：003 **不** import 本包（无包依赖边），只按 `ctx.inject` 的字符串键消费；本包不加载时 003 侧置灰（`plugin.crossPackageService`）。

---

## 6. 安全

| 面 | 措施 |
|---|---|
| **终端 = 逃逸面** | 沙箱策略与官方 bash/fs 同源；`read-only` 下 `new/write/resize/kill` 一律拒绝（**004** 的 REQ-3.1）|
| WS 未授权访问 | 同源 + 一次性短 TTL 令牌；失败即关（REQ-7.2）；list 也过握手（REQ-7.5）|
| 路由抢占 | 前缀 `/dsh-managed-terminal/` 独占；官方匹配顺序 **exact → 最长 prefix → fallback**、注册顺序无语义 → 不抢 SPA fallback（REQ-7.1）。⚠️ **upgrade 侧只能 exact path**（前缀式 upgrade 不存在）→ 单一端点 + 会话 id |
| 注入 | 命令与参数以 `argv` 进 `spawnTerminal`，**不经 shell 切词**（REQ-3.1）|
| 样式污染 | `xterm.css` 局部作用域，不写全局（REQ-5.2）——防两份 xterm 实例互相踩 |
| 配置写入 | live 字段**只经 settings 三写操作**（不重挂载）；`configEditor.edit()` 是完整配置路径（会重挂载），live 字段不用它；**不手写 YAML**（REQ-10.2）|
| 数据泄露 | WS 错误不回实例细节；日志不记终端原始输出（可能含密钥）|

---

## 7. 错误处理

各失败路径的行为已在 [requirements.md](./requirements.md) 逐条写成 EARS（REQ-1.2 / 3.3 / 3.5 / 6.3 / 7.2 / 10.3 / 10.4），**Agent 面**的在 [004 的 requirements.md](../004-terminal-agent-surface/requirements.md)（REQ-1.7 / 3.1 / 3.5 / 4.1），此处不重复。统一口径：**任何失败都必须让用户在界面上看到原因，且不留半成品状态**（幽灵标签 / 半死 WS / 被清空的表单 / 未杀掉的 PTY）。

---

## 8. 测试策略

| 层 | 载体 | 覆盖 |
|---|---|---|
| 纯函数/状态机单测 | `vitest` | `parseProfiles`（容错/重名/默认值）、按键名映射、缓冲环形丢弃与 `lost` 判定、权限映射表、size 夹紧、`cwdLinux` 推导接线（fake 001）|
| 假宿主集成 | `vitest` + fake ctx | 页类型注册/卸载计数、路由注册与 404 回落、WS 握手拒绝路径、工具注册与参数校验、卸载后监听归零 |
| 离线契约测试 | `node --test` | spawnTerminal 的 **spec 形状**（argv/cwd/env/rows/cols/terminalType 的键名与类型）与 001 的返回结构契约 |
| 真机 UI 验收 | **chrome-devtools MCP** | 见 tasks.md 的「真机验收清单」：页类型出现、profile 起终端、键盘回显、resize、Agent 工具读写、配置保存后终端存活（B-1 的真机证据点）|

**E2E 口径**：handover 已否掉 Playwright + `harness/verify-e2e.sh`；本 Spec 的替代是上表第 4 行（chrome-devtools MCP 真机）+ 人工目视清单。

---

## 9. 决策权衡

| 决策 | 取舍 | 被否方案与原因 |
|---|---|---|
| 自建 WS 通道 | 认证/重连自建，换来不改造工程形态 | **Typert Remote**：需双 face TS 工程 + 换 tsdown + Zod 子集限制 + 重启生效 + 无第三方先例（实测报告在 `stack-decision.md`）|
| 新 kind `managedTerminal` | 多写注册代码 | 复用官方 `terminal` 会与官方终端互踩（kind 冲突 + 关闭语义不清）|
| Host 侧 headless 屏幕模型 | 多一个 Host 依赖 | 不存屏幕靠重放增量 → TUI 重绘后快照错误 |
| `profiles` 整数组 volatile | 只能整数组，粒度粗 | 标进元素内 → 被 schemastery 的 `validateVolatileSchema` **拦下报错**；schema 用 Zod → volatile **静默失效**（源码实证）|
| 一个 tab 一个实例 | 不做分屏 | 分屏会让 fit/resize 与工具面 id 语义变复杂；handover 明确不做 |
| 新连接顶掉旧 WS | 简单、抗半死连接 | 拒绝新连接 → 页面刷新后可能被自己的旧连接锁死 |
| 卸载即杀实例 | 语义简单、无孤儿进程 | 保留进程 → 插件已卸载却仍在跑终端，用户无法从 UI 管理（危险）|

---

## 10. 已知限制

1. **B-1 已全部闭环（2026-10-08）**：数组路径 `.volatile()` 的 5 条行为链**全部定案**（真机 3 + 离线 2，见 tasks.md T0.1 与 A-6）⇒ §4.1 的方案 B **未启用**。② Electron 下的 `ctx.webServer` 路径**仍未覆盖**（官方只服务浏览器、Electron 走 `file://` + IPC；本 Spec 只覆盖 Web GUI，A-3）。
2. **WS 顶掉旧连接**：刷新期间可能出现一次 `superseded` 抖动（REQ-7.4 已择定该实现选择）。
3. **不做进程恢复**：Host 重启后 PTY 全丢，无重放（范围外）。
4. **两份 xterm 共存**：官方 `ui-sidebar-terminal` 自带 chunk，本包另带一份 → 体积翻倍（懒加载 + 局部样式只能缓解，不消除）；日志不落终端输出是隐私取舍（未做可选本地落盘）。

---

## 11. 宿主契约事实（2026-10-09 只读源码复核定案：宿主 `0.2.0-rc.2` + 官方首方调用点；零真机；残余真机项见 tasks.md T0.5）

| 能力 | 事实（**实现必须照此**）|
|---|---|
| `spawnTerminal` | **单对象入参**（必填 `argv`/`terminalType`/`rows`/`cols`）；**立即返回 live handle**（`terminate` **幂等**）；🔴 **`resize(cols, rows)` 列在前且不夹紧** ⇒ 本包 `resize(id, rows, cols)` **必须在唯一入口换序**、夹紧自实现（弄反**静默转置**）；**失败一律调用端抛错**（程序/cwd 不存在时是 node-pty 原始报错 ⇒ 要稳定错误码须自调 `resolveExecutable()`）|
| ⚠️ 参数/依赖陷阱 | `cwd: undefined` ⇒ 落**宿主进程 cwd**（node-pty 不校验）⇒ 必须显式传；Windows 上 `shellActivity: true` 是**反效果**（activity 无效，却**跳过** done 后自动 `terminate`）⇒ 不照抄官方 controller；`@xterm/headless` **6.0.0** + `addon-serialize` **0.14.0** 随宿主可用（CJS），但 `createLazyRequire` **按调用方解析** ⇒ **本包必须自声明依赖** |
| `ctx.webServer` | HTTP `register({kind,path,handler})` / WS `registerUpgrade({path,handler})`（**仅 exact pathname**）；**重复 `(kind,path)` 抛错**；disposer 是**普通返回值** ⇒ **必须 `ctx.effect` 收编**（服务关闭也不清表）；generator 体可回滚中途抛错，普通函数体**只收返回值** |
| `ctx.sidebarRightTabs` | `register({id,kind,…,keepMounted?})` 返回 disposer；⚠️ **浏览器侧服务**（`dsh-client-ui-sidebar-right`）⇒ **Host 侧拿不到** |
| `ctx.sandboxPolicy` | **策略解析器**（`resolve()`/`overrideOf()`/`defaultMode`/`setSandboxMode`），官方 bash/pwsh/fs/terminal **四族同源** ✓；**不是逐次门禁**（门禁在 `tools/pre-execute` + `ctx.tools.guard()`）；缺服务的官方做法是**加载期 fail-fast** |
| ⚠️ containment | Windows 上 `spawnTerminal` **不进 Job**（源码自述「Windows ConPTY remains outside Job containment」）⇒ 本包「`kill` 含进程树」的强度**只到进程组**，逃逸子孙不保证被终止 ⇒ 结果里明说「尽力而为」（**未真机验证**）|
