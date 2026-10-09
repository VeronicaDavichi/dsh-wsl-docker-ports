# 008 写入通道 —— 需求

> **2026-10-09 从 [005-elevation-write-path](../005-elevation-write-path/requirements.md) 派生**：005 拥有**写算法**（`src/write/`：所有权匹配 + 精确增删）与**提权后端链**（`src/elevate/`），003 拥有**读模型 / diff / 所有权推导**；但**没有任何界面或 HTTP 入口**能触发它们 ⇒ 写能力**不可达**（005 的 `plugin.ts` 里明确记着 `ElevationInvoker` 缺口，只有 GET 只读路由）。本 Spec 只做**通道**：把「已算好的动作」送到用户面前确认、再送进提权链执行、并留痕。**不改写算法、不改提权后端、不改读模型。**
>
> **为什么通道必须自带闸门**：真机实测本机 `ConsentPromptBehaviorAdmin = 0`（Elevate without prompting）⇒ **提权不弹 UAC**、`consent.exe` 零次出现，Agent 可零人工交互完成 `netsh` 写入与删除 ⇒ 「UAC = 人类闸门」在本机**不成立**。故闸门收回产品内（A 确认 + 预览 / B 审计），且**与 OS 是否弹窗解耦**。见 005 的 REQ-4.1–4.3。

## 1. 范围

- **做**：写操作的 HTTP 路由（独占前缀 + 方法判据 + 错误码）、**动作计划**（只读预览）、**确认闸门**、**执行**（调 005 的提权链）、**审计留痕**、以及客户端接线所需的契约。
- **不做**：写算法与 diff 逻辑的改动（005 / 003 的地盘）；容器启停与日志（003 的 P1）；无人值守自动写入；任何 `portproxy reset`；任何所有权集合外的规则操作。

## 2. 需求

### REQ-1 通道与路由（复用 003 已验证的宿主契约）

- **REQ-1.1** The system SHALL 在**独占前缀**（常量**不带尾斜杠**）下注册具名路由，且**每个 (kind, path) 只注册一次**；重复注册 SHALL NOT 抛错。
  > 依据：真机实证「带尾斜杠的前缀会注册成功但**永不被分派**（宿主兜底 404、零报错）」—— 这是本项目已修过一次的静默缺陷。
- **REQ-1.2** WHEN 插件被卸载 / effect 被释放，THEN 路由 SHALL 由 effect-scoped disposer 注销，且注销 SHALL 幂等。
- **REQ-1.3** The system SHALL 复用四类错误码语义：未知路径 `404 not-found`、方法不符 `405 method-not-allowed`、依赖不可用 `503 rules-unavailable`、内部错误 `500 internal`；**判据顺序 = 先路径、后方法**。
- **REQ-1.4** The system SHALL 返回**字节精确**的 `Content-Length`（UTF-8）且带 `Cache-Control: no-store`。

### REQ-2 动作计划（只读预览，零写入）

- **REQ-2.1** GIVEN 一个声明式写入目标（端口集合 + 作用域 + 动作），WHEN 客户端请求动作计划，THEN 系统 SHALL 返回**将执行的每条动作**，逐条含：作用域 · 监听地址 · 端口 · 连接地址 · 是否伴随防火墙规则 · **将执行的命令原文**，以及命令条数与影响面。
- **REQ-2.2** The 动作计划 SHALL **零副作用**：不写注册表/系统状态、不提权、不碰 `netsh`、不改任何文件。
- **REQ-2.3** IF 输入非法（端口越界 / 作用域非法 / 目标不在所有权集合内），THEN 系统 SHALL 返回**空计划 + 可读原因**，且 **SHALL NOT** 执行任何动作、**SHALL NOT** 因非法输入而写系统状态。
- **REQ-2.4** The 动作计划 SHALL 只覆盖**声明式所有权集合内**的端口；集合外一律 `port-not-managed` 且零动作。

### REQ-3 确认闸门（A · 强制）

- **REQ-3.1** GIVEN 任何需要提权的写操作（无论触发者是 Agent 还是用户界面），THEN 系统 SHALL 在**执行前**获得**显式确认**，确认内容 SHALL 含 REQ-2.1 的完整变更预览（逐条规则 + 命令原文）。
- **REQ-3.2** IF 未确认 / 用户拒绝 / 确认超时，THEN 系统 SHALL **零提权、零写入**，并返回可读原因。
- **REQ-3.3** The 确认闸门 **SHALL NOT 依赖操作系统是否弹窗** —— 在 `ConsentPromptBehaviorAdmin = 0`（UAC 不弹窗）的机器上 SHALL 同样生效。
- **REQ-3.4** GIVEN 操作由 Agent 触发，THEN `passby` SHALL NOT 静默执行、SHALL **降级为 `ask`**（应用内确认 + 展示命令原文）。（迁自 005 REQ-4.1，语义一字不改。）

### REQ-4 执行（调 005 的提权链）

- **REQ-4.1** WHEN 确认通过，THEN 系统 SHALL 经 **005 的后端链**执行（`gsudo` → `native`，仅显式配置时 `winsudo`），并回传**逐步结果**（每条成功 / 失败 / 跳过 + 原因 + 耗时）。
- **REQ-4.2** The 执行 SHALL **幂等**：重复执行同一计划 SHALL NOT 产生重复规则，且 SHALL NOT 报错。
- **REQ-4.3** IF 执行中途失败，THEN 系统 SHALL **不留半成品**（按 005 REQ-3.5 的清理语义），并回传已完成 / 已回滚 / 未执行的清单。
- **REQ-4.4** The 响应 **SHALL NOT** 含任何凭据 / 口令 / 令牌。

### REQ-5 审计留痕（B · 强制）

- **REQ-5.1** GIVEN 一次写操作（含被拒绝 / 超时 / 失败 / 回滚），THEN 系统 SHALL 落**一条**审计记录：时间 · 触发来源（agent / user）· `elevationPolicy` · 实际后端（gsudo / native / winsudo）· 端口与作用域 · 结果与退出码 · 耗时 · 是否回滚。
- **REQ-5.2** The 审计记录 SHALL 人类可读（profile 日志）且 SHALL NOT 含任何凭据 / 口令。

### REQ-6 安全边界（红线）

- **REQ-6.1** The system SHALL NOT 触碰**所有权集合外**的规则；真机验收 SHALL 断言「他人 **19 条**规则前后**逐字节不变**」。
- **REQ-6.2** The system SHALL NOT 使用 `portproxy reset`；SHALL NOT 建通配符防火墙规则（`-LocalPort` 必须具体端口）。
- **REQ-6.3** GIVEN 插件被卸载，THEN SHALL NOT 自动删除任何规则（迁自 005 REQ-5.1，语义不变）。

## 3. 非功能需求

| # | 约束 | 判据 |
| --- | --- | --- |
| NFR-1 | **不引新依赖** | `package.json` 依赖项数不变；不引 Playwright / E2E 框架 / HTTP 框架（用宿主 `ctx.webServer` + Node 内置） |
| NFR-2 | 体积与行数门 | 单文件 ≤ **400** 行（原始行）、去注释去空行 ≤ **40KB**；复算脚本可当场出数 |
| NFR-3 | 真机验收不得污染用户环境 | 探针只能用**临时/一次性 profile**（AGENTS.md 白名单：**不得**用 `desktop` / `web`），用完逐字节还原 |
| NFR-4 | 失败可读 | 任何拒绝路径都给出人类可读原因（不许只有错误码） |

## 4. 验收总门（全部可二值判定）

| # | 判据 | 方式 |
| --- | --- | --- |
| G1 | 动作计划**零写入**：调用前后 `netsh … show v4tov4` 逐字节相同 | 真机 |
| G2 | 未确认 ⇒ 提权 spy **全 0**、零写入 | 单测（注入假后端） |
| G3 | 非法输入 ⇒ 空计划 + 原因，且零写入 | 单测 + 真机 |
| G4 | 路由：未知路径 404 / 方法不符 405 / 依赖缺失 503，且**前缀带尾斜杠即永不分派**的反例有回归用例 | 单测 + 真机（真机需看到我们的 JSON，而非宿主兜底 404） |
| G5 | 执行后「他人 19 条不变」+ 幂等（重复执行不增条数） | 真机 |
| G6 | 每次执行（含拒绝）都留一条审计，且敏感词扫描零命中 | 单测 + 真机 |
| G7 | 卸载后零规则被删 | 单测 |
