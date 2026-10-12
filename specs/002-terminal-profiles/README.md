---
status: in-progress
created: 2026-10-08
priority: high
tags:
- dsh-plugin
- terminal
- pty
- xterm
- agent-tools
- ui
depends_on:
- 001-wsl-shared
- 006-path-translation
created_at: 2026-10-08T09:43:13.130539300Z
updated_at: 2026-10-09T02:07:40.898759800Z
transitions:
- status: planned
  at: 2026-10-08T13:23:04.496516100Z
- status: in-progress
  at: 2026-10-09T02:07:40.898759800Z
---
# 可配置终端 · Agent 可读写（右栏受管终端）

**类型**: 需求驱动（requirements-first）
**状态**: in-progress（**2026-10-09 转 `in-progress`**：Phase 1「配置模型与容错」实现中；Phase 0 剩 **T0.2 / T0.3** 由**只读契约研究**并行核对（结论将回写本目录的 tasks/design）、**T0.5** 真机安装接入待主人在场时做）
**优先级**: high
**包名**: `dsh-terminal-profiles`（**插件包**）
**位置**: `packages/terminal-profiles/`
**依赖**: [001-wsl-shared](../001-wsl-shared/README.md) + [006-path-translation](../006-path-translation/README.md)（均为 `depends_on`）—— 用 001 的发行版发现生成 `cwdLinux`；**路径翻译自 2026-10-09 起属 006**（006 自身 `depends_on` 001 ⇒ 本包的路径翻译能力经 006 承接）。⚠️ **006 这条边是 2026-10-09 手工补的**：本机 CLI `rel` / `link` 未迁移、MCP `update` 不含 `depends_on` ⇒ **无任何工具路径**，经主人授权只在该列表加一行（其余字段一字未动），并经 MCP `get_dependencies` 复核生效；留痕见 `stack-decision.md` 变更记录

---

## 概述

官方右栏终端（`dsh-client-ui-sidebar-terminal`）有两个空白，正好是本组件的核心诉求：

1. **输出不进 Agent transcript**（官方 terminal-controller README 明写），Agent 看不到终端在跑什么
2. **初始目录固定为 Session 工作区、只能起 shell** —— 无法「在指定文件夹用指定命令带参数启动」

本组件是一个 **profile 驱动的受管终端**：每个 profile 声明 `name + command + args + cwd + cwdLinux + env`，起一个**真 PTY**；Agent 通过工具族对它读写。与官方终端**互补而非重复**。

    右栏（sidebar.right.pane.tab / .title，kind = managedTerminal）
    ┌──────────────┬────────────────────────────────────────────┐
    │              │ [Preview][终端 ×]                          │
    │    聊天       │ ┌ profile: pwsh-dev ─────────────────────┐ │
    │              │ │ PS E:\NodeProjects> _                  │ │
    │              │ └────────────────────────────────────────┘ │
    │              │ ┌ profile: wsl-ubuntu2204 ───────────────┐ │
    │              │ │ user@Ubuntu2204:/mnt/e/x$ _            │ │
    │              │ └────────────────────────────────────────┘ │
    └──────────────┴────────────────────────────────────────────┘

    Agent 面（defineTool，受 ctx.sandboxPolicy + 审批约束）：
      `managed_terminal_new` / `managed_terminal_list` / `managed_terminal_read` / `managed_terminal_write` / `managed_terminal_resize` / `managed_terminal_kill`
      → **2026-10-08 已拆出**：Agent 面的需求/设计/任务在 004-terminal-agent-surface

---

## 功能说明

### 配置模型（`profiles`，整数组 `.volatile()`）

| 字段 | 语义 | 备注 |
|---|---|---|
| `name` | profile 标识 | 唯一；重复时后者被拒并提示 |
| `command` | 可执行文件 | **不经 shell 切词**；`D:\...\pwsh.exe`、`C:\...\wsl.exe` |
| `args` | 参数数组 | 例：`["-d","Ubuntu2204"]`（发行版名由 001 自动发现，不手打）|
| `cwd` | Windows 视角工作目录 | 例：`E:\NodeProjects` |
| `cwdLinux` | WSL 视角工作目录 | 例：`/mnt/e/NodeProjects`；由 **006** 的路径翻译产出/校验 |
| `env` | 额外环境变量 | WSL2 场景用 |

**为什么整数组标 `.volatile()`**：官方 Loader 的 `equalExceptVolatile` 对 **volatile-only 变更不重挂载**，改走 `_commitVolatile` + `loader/volatile-update`。而 volatile **只在固定对象路径生效**，数组元素内的字段不是固定路径 —— 所以只能整数组标。**不这样做的后果**：用户每改一个 profile 的 cwd，`patchReload: live` 触发 remount，**正在运行的终端全部被杀**（`stack-decision.md` 的配置写入管道图）。**2026-10-08 源码实证**：`equal()` 首行就是 `if (schema?.meta?.volatile) return true` → 整数组标**机制成立**；但两条边界是硬的：① 标进元素内会被 `validateVolatileSchema` **拦下报错** ② schema **必须 Schemastery**，用 Zod 会**静默失效**、每次保存都重挂载。

### 其余机制一览

| 面 | 机制 | 依据 |
|---|---|---|
| 终端内核 | `ctx.subprocess.spawnTerminal(spec)`（真 PTY，接受 `argv`/`cwd`/`env`/`rows`/`cols`/`terminalType`）| `stack-decision.md` · `plugin.terminalEngine` |
| Host 屏幕模型 | `@xterm/headless` + serializer（官方 terminal-controller 同款）| `plugin.hostScreenModel` |
| 浏览器渲染 | `@xterm/xterm` + `@xterm/addon-fit`，**独立懒加载 chunk**（官方终端页实证：主 bundle 19,887 B + `require.async("./client.terminal.js")` 取 685,949 B 的 chunk，xterm 内联其中）| `plugin.renderer` |
| 通道 | 自建 `ctx.webServer` **具名路由 + WebSocket upgrade**（HTTP 用 prefix、**upgrade 只能 exact**）| `plugin.clientTransport` |
| 页类型 | 新 kind `managedTerminal` + 宿主默认 **extension 档** | `plugin.tabKind` |
| 配置页 | `plugins.row.config`（键 `<包名>#<行 id>`）+ `configure({ auto: false }, ctx.fiber)` 自绘 | `plugin.configStore` |
| 配置落盘（live） | **静态 `Config` 导出 + 条目 id 作命名空间** → `ctx.settings.{update,replace,mutate}`（**不重挂载**、**不自行手写 YAML**）| 同上 |
| ⚠️ 不走的路 | `ctx.configEditor.edit()` 是**完整配置**路径 —— `ordinary fields retain Loader's normal lifecycle` ⇒ 走它**必重挂载**；两服务**互补非管道**（2026-10-08 源码实证）| 同上 |
| Agent 工具（**004**）| `dsh-tools` 的 `defineTool` | `plugin.agentSurface` |
| 权限（**004**）| 受 `ctx.sandboxPolicy` + 工具审批约束 | `plugin.agentPermission` |
| 跨包服务 | 导出 `managedTerminal` 服务，供 003 **可选注入** | `plugin.crossPackageService` |

---

## 文档导航

| 文档 | 内容 |
|------|------|
| [requirements.md](./requirements.md) | REQ-1..7、REQ-10..13 与 EARS 验收标准、交互控件清单、NFR、约束与假设（**REQ-8/9 已迁出**，编号留空位）|
| [design.md](./design.md) | 双面架构（Host / Client）、PTY 与屏幕模型、WS 协议、服务契约、配置写入管道、测试策略、决策权衡 |
| [tasks.md](./tasks.md) | 按阶段拆分的任务、验证方法与 chrome-devtools MCP 真机验收清单 |
| [**004-terminal-agent-surface**](../004-terminal-agent-surface/README.md) | **Agent 工具面（2026-10-08 拆出）**：6 个 `defineTool` · 按键名映射 · 沙箱权限映射 · 工具错误语义 |

> **拆分说明**：本 Spec 拆前 `requirements.md` 与 `design.md` 各 **199 行**，贴着 `leanspec` 的 warn 阈值（200）。Agent 工具面有独立接口、独立安全语义与独立失败路径，却不拥有任何终端机制本体 → 独立成 **004**（**同一个包**，共享本 Spec 的 `session-manager` / `screen-model`；拆的是文档与验收边界，不是包边界）。

---

## 冻结决策速览

| 决策点 | 结论 | 理由摘要 |
|---|---|---|
| 终端引擎 | `ctx.subprocess.spawnTerminal` 自建受管终端 | 唯一同时满足「自定义 cwd + 任意命令 + 参数」的公开路径；代价是标签布局/重连/滚动缓冲/主题全自建 |
| Agent 面（**004**）| 完整族 `new/list/read/write/resize/kill` | 覆盖完整生命周期 |
| Agent 读模型（**004**）| **屏幕快照 + 增量流** 两者都给 | 快照给 TUI 正确画面，增量给低延迟；派生 Host 侧屏幕模型需求（屏幕模型本体仍在 002）|
| Agent 权限（**004**）| 受 `ctx.sandboxPolicy` + 工具审批 | 避免 Agent 借终端绕过 `read-only`/`workspace-write` |
| 配置存活 | `profiles` 整数组 `.volatile()` | 换「编辑配置不杀终端」；**B-1 五条已全定案（2026-10-08，含真机）** ⇒ 机制与行为**双双闭环**；落盘语义同日定案（A-6）|
| 通道 | 自建路由 + WS upgrade，**独占前缀** `/dsh-managed-terminal/…`；**upgrade 必须 exact path** | 官方 `dsh-host-webserver` 支持第三方具名路由（`exact`/`prefix`）与 upgrade（**仅 exact**）注册，匹配顺序 exact → 最长 prefix → fallback；Typert Remote 方案实测可行但需改双 face TS 工程 + 换 tsdown + 受 Zod 子集限制 + 重启生效（已否决）|
| 页类型 | 新 kind `managedTerminal` + extension 档 | 判据 = **不与官方已用 kind 重名**（0.1.7-rc.2 实测 **9 个**：`guide`/`files`/`browser`/`text`/`changes-review`/`terminal`/`scheduleTask`/`plan`/`subagentchat`；kind 是开放字符串，`managedTerminal` **未被占用** ✅）；官方 `terminal` 页自己用 `priority: "builtin"` ⇒ 第三方必须留空或 `extension` |
| 样式 | `xterm.css` **只在自有容器作用域内**加载，不注入全局 | 官方终端另有一份 xterm chunk，两份共存会互相污染 |
| React | `peerDependencies: ^18.2.0`，**不打进 bundle** | 宿主 slot 渲染 React 节点；Vue 需适配层 |
| 构建 | esbuild → CJS client bundle | 符合宿主 ModuleLoader 的 CJS 契约；与同机三个插件一致 |
| 体积基线（**2026-10-09 实测**）| 主 bundle **43,537 B**（**2026-10-09 Phase 6 后复算**；Phase 4 时为 11,037 B） + 懒加载 chunk **447,255 B**（官方终端页对照：19,887 B + 685,949 B）| 主产物名恰 `client.js`、chunk 为**兄弟文件** `client.terminal.js`、xterm **只**内联在 chunk（主产物里 3 处 "xterm" 全是注释/函数名）；两者 `require` 仅 `react` / `react/jsx-runtime`（**零** `react-dom`、零幽灵声明）⇒ 清单 `dsh.client.external = []` 合法；`pnpm -C packages/terminal-profiles check:client` **56 条判据（含 4 条反控）** 守这一条。⚠️ 测产物**必须在构建进程结束后**（同日实测过一次「react-dom 被内联」的中间态：主 126,358 B、字符串 `require` 0 处） ⚠️ **2026-10-12 订正（原文保留，本行两处）**：① 本行**首格**的体积基线 **43,537 B**（2026-10-09 Phase 6 后复算）**已陈旧** ⇒ **现行实测 = 主 bundle 53,014 B**（懒加载 chunk **447,255 B** 未变；原历史值 **43,537 B / Phase 4 11,037 B** 一律保留以备追溯）；② 本行的 `check:client` 判据数 **56 条（含 4 条反控）已陈旧** ⇒ **实跑读数 = 60 条（含 4 条反控）**。两处同一命令取自 cwd = `packages/terminal-profiles`：`node scripts/verify-client-loader.mjs` 自报 `✓ verify-client-loader: 60 条判据（含 4 条反控），产物目录 lib/` · `主 bundle lib/client.js = 53014 字节` · **exit 0**。| ⚠️ **2026-10-12 重建后订正（原文一字未删）**：上面那句「**现行实测 = 主 bundle 53,014 B**」在**产物重建后已陈旧** ⇒ **现行实测 = 53,756 B**（**原记 53,014 B**；余量 12,522 B → **11,780 B**）。懒加载 chunk **447,255 B 未变**（主/chunk = **8.32×**，软提示；原记 1 : 8.44）。变化来自**产物滞后于源码**（重建后仅 3 个产物动：`lib/client.js` +742、`lib/types/client/index.d.ts` +995、`lib/ws/routes.js` +2,337；全部归因 `ae9f74b`），**不是**新功能入主包；同一命令 `node scripts/verify-client-loader.mjs`（cwd = `packages/terminal-profiles`）仍 **60 条判据 / exit 0**。原值一律保留以备追溯；留痕 = `stack-decision-changelog.md` **#53**。
| 基线 | **0.2.0-rc.2** | 本机 `dsh --version` 与全部 `dsh-client-ui-*` 实测一致 |

---

## 范围外（本 Spec 不做）

1. **不改动 DSH 官方包**（不 patch 私有 DOM、不 require 私有 `node-pty`）。
2. **不做 tab 内分屏**（一个 tab 一个终端实例）。
3. **不做 Host 重启后的进程恢复** —— 重启即丢，如实记录在 README「已知限制」。
4. **不做 docker 侧集成**（属 003）。
5. **不做 `read-only` 沙箱下对终端的写操作** —— 会被 **004** 的 REQ-3.1 直接拒绝，不是「尽力而为」。

---

## 硬规则偏离说明

| 硬规则 | 状态 | 说明 |
|--------|------|------|
| 读 `.lean-spec/templates/requirements-template.md` | ⚠️ **偏离** | 模板库只有 `leanspec init` 生成的 `spec-template.md`；结构按 `leanspec-propose` 技能正文 + 兄弟项目 `dsh-leanspec` 实测四文件约定 |
| `docs/` 全量扫描 | ⚠️ **N/A** | 本仓库无 `docs/`；requirements.md 第 0 节标注「（空）」并列出替代 SSoT（`stack-decision.md`）|
| **UI 需求必须配 Playwright E2E** | ✅ **用户明确替代（本轮拍板）** | 替代口径 = **vitest 单元 + `node:test` 离线契约测试 + chrome-devtools MCP 真机验收**；handover 明确**不照搬** propose 默认的 `harness/verify-e2e.sh` 与视觉对照 —— 无 web 页面可截图，且该基建不存在。`leanspec-apply` 的 E2E 预检将不通过，属**显式记录后继续** |
| 原型资产归档 / 视觉对照 | ⚠️ **N/A** | 无原型输入（无 URL / 无截图）；形态以 ASCII 图描述 |
| 复核制两阶段提交 | ⚠️ **N/A** | 无审批/复核语义（唯一「确认」是 UAC 系统弹窗，属 003）|
| 交互控件登记 | ✅ **适用** | 见 requirements.md §2 控件清单（终端页 + 配置页）|
| 项目文档摘要 `grep -c "docs/"` ≥ 5 | ⚠️ **偏离** | 无 `docs/` 树可扫；改为以 `stack-decision.md` 的**维度键**为来源精度（每个 REQ 都标了维度键）|

---

## 阻塞项（进实现前必须打掉）

| # | 阻塞项 | 状态 |
|---|---|---|
| ~~B-1~~ | ~~**`z.array(...).volatile()` 在数组路径上是否生效**~~ → ✅ **2026-10-08 五条全部定案**：**真机** live 写入 152ms 生效、**不重挂载**且 `.get()` **值真传播**、ordinary 字段**真 remount**、非法值静默拒绝不崩；**离线**两条（元素内标 volatile 在 **parse 时**抛 `ValidationError`；数组级解析为带 `.get()` 的**深冻结**对象）。方法：临时 profile `volatile-probe` + 一次性探针插件（`--port 0`，不碰在跑的实例）| ✅ **已闭环**（T0.1 已打勾；落盘语义同日定案 → A-6）|

> ⚠️ **订正留痕（2026-10-09）**：B-1 行原写「🟡 仍是开工阻塞项（真机未走）」—— 与本仓 `AGENTS.md` / `stack-decision.md` 的 2026-10-08 定案记录**互相矛盾**，也**与** 002 自己的 T0.1 已打勾相矛盾。经复核，真机实验早已跑完（五条全定案），该行属**指令残留**（早期口径未随结论同步），本轮按 SSoT 订正。
| ~~B-2~~ | ~~6 项 `backend.*` 的 `confirmed: implied` 待主人逐条点头~~ → ✅ **2026-10-08 已确认全为 `none`，本项清除** | ✅ 已闭环（不影响本组件技术选型）|
| B-3 | 路由前缀独占性（是否被官方 SPA fallback 抢走）| ✅ **2026-10-08 源码定案：不会被抢**（匹配顺序 exact → 最长 prefix → fallback；fallback 单座位且只答无具名路由匹配的请求）。⚠️ 同时发现 **upgrade 仅支持 exact path**，已修正 REQ-7.1；真机只留 T0.3 的 4 条行为确认 |

**若 T0.1 第 1 条被推翻**（真机确认数组路径标 volatile 无效）：REQ-2 降级为「保存配置会重挂载 → 弹确认框 + 提示正在运行的终端会被终止」，**不**假装无痛；design.md §6 已写好两套方案的切换点。

## 下一步

1. 主人复核本 Spec，重点：REQ-6 的增量流缓冲策略与 REQ-7 的 WS 握手校验口径。
2. **B-1（五条全定案）/ B-2（清除）/ B-3（源码定案）均已闭环** ⇒ 002 **已于 2026-10-09 转 `in-progress`**，Phase 1 实现中（见 `tasks.md`）。
3. 剩余 Phase 0：**T0.2 / T0.3**（宿主 0.2.0-rc.2 基线能力与路由注册行为）由**只读契约研究**并行核对；**T0.5**（安装接入验证）需真机改 profile + 重启 DSH ⇒ **待主人在场时**排期。
