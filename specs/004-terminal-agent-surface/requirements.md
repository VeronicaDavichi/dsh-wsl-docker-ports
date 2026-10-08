# 需求：Agent 终端工具族与沙箱权限

> 派生自 [README.md](./README.md) 的概述与冻结决策；技术设计见 [design.md](./design.md)，任务见 [tasks.md](./tasks.md)。
> **2026-10-08 从 [002-terminal-profiles](../002-terminal-profiles/requirements.md) 拆出**：原 REQ-8（工具族）与 REQ-9（权限）整体迁来并重编号为 REQ-1..REQ-4，内容除编号与下述边界外**逐条保留**。

---

## 0. 来源（SSoT）

`docs/` 为空，本 Spec 的事实来源与 002 一致：`stack-decision.md` 的维度键 —— 主要引用 `plugin.agentSurface`、`plugin.agentReadModel`、`plugin.agentPermission`、`plugin.terminalEngine`（复用）、`plugin.sandboxPolicy`。

---

## 1. 范围

**做**：6 个 `defineTool` 工具（`new`/`list`/`read`/`write`/`resize`/`kill`）· 按键名映射 · 沙箱权限映射 · 工具错误语义。

**不做**：任何终端机制（PTY、屏幕模型、有界缓冲、resize 生效逻辑）与任何浏览器侧通道 —— 全在 [002](../002-terminal-profiles/requirements.md)。本 Spec **只定义 Agent 面**，机构本体一律消费 002。

---

## 2. 需求

### REQ-1 工具注册面

- **REQ-1.1** 系统 SHALL 经 `dsh-tools` 的 `defineTool` 注册 **6** 个工具：`new` / `list` / `read` / `write` / `resize` / `kill`；SHALL NOT 注册额外工具（范围外第 3 条）。
- **REQ-1.2** `new` SHALL 接受 profile 名并返回实例 id；GIVEN profile 不存在，THEN SHALL 返回可用 profile 列表。
- **REQ-1.3** `list` SHALL 返回实例的 id / profile / pid / 尺寸 / 存活状态。
- **REQ-1.4** `read` SHALL 支持 `snapshot`（默认）与 `incremental`（带 `sinceSeq`）两种模式。
- **REQ-1.5** `write` SHALL 接受文本或按键名（如 `Enter`、`Tab`、`C-c`），编码后写入 PTY 主端。
- **REQ-1.6** `resize` SHALL 接受 `rows/cols`；越界值 SHALL 被夹紧并回报**实际生效值**。
- **REQ-1.7** `kill` SHALL 终止实例（含进程树）并释放屏幕模型；GIVEN 实例不存在，THEN SHALL 返回明确错误，SHALL NOT 静默成功。
- **REQ-1.8** 工具的参数与描述 SHALL 由 `defineTool` 声明；GIVEN 参数不合法，THEN SHALL 在进入业务逻辑前被拒并给出可读原因。

### REQ-2 读模型（消费 002，不另建）

- **REQ-2.1** `read` 的两模式 SHALL 直接映射到 002 的屏幕模型：`snapshot` → 当前帧快照，`incremental` → `sinceSeq` 之后的增量块。
- **REQ-2.2** GIVEN `sinceSeq` 早于 002 缓冲下界，THEN `read` SHALL 返回 `lost: true` + 快照（语义同 002 REQ-6.3），SHALL NOT 返回空数组冒充「无输出」。
- **REQ-2.3** 本 Spec SHALL NOT 自建屏幕模型、缓冲或序号；SHALL NOT 让工具面与浏览器通道看到不同的画面（同一实例同一屏幕状态）。
- **REQ-2.4** `list` SHALL 暴露 002 的 `dropped` 计数（缓冲丢弃可见），SHALL NOT 隐藏。

### REQ-3 权限（沙箱一致性）

- **REQ-3.1** `new` / `write` / `kill` / `resize` SHALL 受 `ctx.sandboxPolicy` 与工具审批约束；GIVEN 策略为 `read-only`，THEN 上述工具 SHALL 被拒绝并返回原因，SHALL NOT 借终端绕过沙箱。
- **REQ-3.2** `read` / `list` SHALL 在 `read-only` 下可用（只读语义）。
- **REQ-3.3** 权限判定 SHALL 与官方 bash / 文件系统使用**同一份** `ctx.sandboxPolicy`，SHALL NOT 另起一套策略。
- **REQ-3.4** GIVEN 宿主未提供沙箱服务，THEN 系统 SHALL 取**最保守**行为（拒绝写），SHALL NOT 默认放行。
- **REQ-3.5** GIVEN 工具审批被用户拒绝，THEN 结果 SHALL 为「已取消」类可读结果，SHALL NOT 执行任何副作用、SHALL NOT 标记为系统错误。

### REQ-4 错误语义

- **REQ-4.1** 所有失败 SHALL 以工具可读结果返回，SHALL NOT 抛出以致中断 Agent 会话。
- **REQ-4.2** 未识别的按键名 SHALL 返回错误，SHALL NOT 猜测或静默丢弃该次输入。
- **REQ-4.3** 错误结果 SHALL 含可读原因与（可用时）可执行的下一步；SHALL NOT 只返回 `internal error`。
- **REQ-4.4** 失败 SHALL NOT 留半成品状态（`new` 失败不留实例条目、`write` 失败不写半个转义序列、`kill` 失败不谎报成功）。

---

## 3. 非功能需求

- **NFR-1** 工具注册 SHALL 可完全卸载：卸载后工具数归零、无遗留监听（与 002 的卸载计数断言共用一条）。
- **NFR-2** `typecheck` + `vitest` + `build` 三项 SHALL 全绿。
- **NFR-3** 工具实现 SHALL NOT 复制 002 的业务逻辑；跨面调用 SHALL 走 002 的模块接口（单一实现）。
- **NFR-4** 单文件 ≤ 400 行、单 Spec 文档 ≤ 200 行（`leanspec` warn 200 / max 400）。
- **NFR-5** 本 Spec **无 UI**：SHALL NOT 引入任何前端依赖（React/xterm/CSS 均与本题无关）。

---

## 4. 约束与假设

| # | 内容 | 影响 |
|---|------|------|
| C-1 | 基线锁 **0.2.0-rc.2**；不改官方包、不 require 私有依赖 | `defineTool` 契约按 rc.2 实测 |
| C-2 | 只用宿主公开插槽/服务；所有注册必须有 disposer | REQ-1.1 / NFR-1 的基础 |
| C-3 | 本 Spec 与 002 **同包**（`packages/terminal-profiles/`），共享 `session-manager` / `screen-model` | 拆的是文档与验收边界，**不是**包边界；不产生跨包依赖 |
| A-1（**假设**）| `defineTool` 的参数 schema 与错误返回形状在 rc.2 上如预期 | ⏳ Phase 0 对照同机已有插件真机核对；不成立则本 Spec 的工具声明层需改写 |
| A-2（**假设**）| 工具审批与沙箱策略**叠加**生效（拒绝审批 ≠ 抛错，而是可读失败结果）| REQ-3.5 / REQ-4.1 的前提；若审批层直接抛错，需在本层兜住 |
| A-3（**已确认**）| 沙箱策略对终端一致施加（官方文档写明对 bash/fs/终端同策略）| REQ-3.3 的依据（与 002 的 A-4 同源）|
