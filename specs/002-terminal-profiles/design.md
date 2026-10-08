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

- **tab-registration**：`ctx.inject(['sidebarRightTabs','sidebarRight'], …)` 作用域内注册定义 → 正文 seat → 标题 seat，收集 disposer；缺能力时静默降级 + 原因（REQ-4.1/4.4/4.5）。
- **TerminalPane**：`useEffect` 内 `import('@xterm/xterm')` 动态加载（独立 chunk），`FitAddon` 在容器 resize 时 fit；`xterm.css` 以**局部作用域**方式注入（不写全局样式表，REQ-5.2）。
- **transport**：WS 客户端，重连时带 `sinceSeq`；收到 `lost` 时用快照重建（`term.reset()` + `write(snapshot)`）。
- **状态**：组件内 React state（`frontend.state` = 宿主 `dsh-client-store` 用在宿主集成处，终端画面状态**不复用**宿主 store —— 终端是高频流，走 ref 而非全局 store，避免整树重渲染）。
- React 从宿主来（peer，REQ/NFR-1）。

---

## 4. 配置写入管道（关键路径）

    配置页（自绘，configure({auto:false})）
      │  ctx.settings.{update,replace,mutate}   ← 命名空间 = 本包 patch 条目 id
      │  schema = 本包**静态 Config 导出**；volatileForm 只展开 volatile 子树
      │  陈旧写入被拒 → settings/conflict
      ▼
    ~/.dsh/profiles/<name>/cordis.patch.yml   ← patchReload: live
      ▼
    dsh-hmr → Loader.Entry.update
      ├─ 仅 volatile 变更 → equalExceptVolatile 判等（'~standard'.vendor === 'schemastery'）→ _commitVolatile + loader/volatile-update → ✅ 不重挂载
      └─ 任何 ordinary 变更 → remount（dispose + apply）→ 🔴 实例全死

    ⚠️ **另一条不走的路**：ctx.configEditor.edit()（@deepseek-ai/dsh-config-editor）是
       **完整配置**路径 —— 官方原文 "ordinary fields retain Loader's normal lifecycle"
       ⇒ 走它必重挂载。live 字段不得经它写（2026-10-08 源码实证）。

**因此**：整个 `profiles` 数组声明 `.volatile()`（volatile 只在固定对象路径生效，数组元素内字段不是固定路径 → 必须整数组，`plugin.profileConfigLiveness`）。**2026-10-08 宿主源码实证**：`equal()` 首行 `if (schema?.meta?.volatile) return true` → 递归到 `profiles` 键**立即判等**、机制成立（`.volatile()` 在 schemastery 的 `Schema.prototype` 上，不挑类型）；两条硬边界（整数组 / 必须 Schemastery）见文末「已知限制」表，字节偏移见 `stack-decision.md` 的 `evidence`。

**2026-10-08 真机实证（临时 profile `volatile-probe` + 一次性探针插件，未碰用户在跑的实例）**：① `settings.update(ns, patch)` → **152ms 生效、`apply` 不重跑（不重挂载）且 volatile 引用 `.get()` 值真传播** ⇒ 上图的 volatile 分支成立、不是空操作；② 改 ordinary 字段 → **`apply` 重跑**（remount）⇒ `equalExceptVolatile` 判定在工作、非恒真；③ 非法值 → **静默拒绝 + 不崩**；④ 混合变更 → **remount**（符合「混合退化」预期）。⚠️ **落盘语义（同日定案，结论：闭环）**：`settings.documentPath` 直读出 settings 文档**就是** profile 的 `cordis.patch.yml`（`writable = true`）；`settings.update` 后 3s（进程仍在运行）文件内容已更新 ⇒ **立即落盘**；重启后值被正常加载 ⇒ **「改配置不杀终端」+「改完不丢」双闭环，不需额外落盘路径**。⚠️ 注意**同一文件既是 patch 层又是 settings 落盘处** —— 实验/实现里对它手写会与 settings 写入互相覆盖（我踩过，见 `stack-decision.md` 变更记录第 22 条）。

### 4.1 若 B-1 被推翻（两套方案的切换点）

| 方案 | 行为 | 切换成本 |
|---|---|---|
| A（首选；机制已由源码确认，待 T0.1 行为链）| `profiles` 整数组 volatile → 编辑不杀终端 | 无（按本设计）|
| B（降级）| 保存前判定是否 volatile-only；非 volatile-only 时弹确认「将终止 N 个运行中实例」，确认后 remount | 改 `config-page` 一处 + REQ-2.2 从「提示」升为主路径；不改 session-manager |

**REQ-2.2 本来就在**，所以方案 B 是「把安全网变主路径」，不是重设计。

---

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

1. **一项已由源码确认、一项未验证**：① 数组路径 `.volatile()` —— **机制已确认可用**（源码实证，见 `plugin.profileConfigLiveness.evidence`）；剩余 5 条真机**行为链**见 tasks.md T0.1，若第 1 条不成立则走 §4.1 方案 B；② Electron 下的 `ctx.webServer` 路径（官方文档写明它只服务浏览器、Electron 走 `file://` + IPC 桥接；本 Spec 只覆盖 Web GUI，A-3）。
2. **WS 顶掉旧连接**：刷新期间可能出现一次 `superseded` 抖动（REQ-7.4 已择定该实现选择）。
3. **不做进程恢复**：Host 重启后 PTY 全丢，无重放（范围外）。
4. **两份 xterm 共存**：官方 `ui-sidebar-terminal` 自带 chunk，本包另带一份 → 体积翻倍（懒加载 + 局部样式只能缓解，不消除）；日志不落终端输出是隐私取舍（未做可选本地落盘）。
