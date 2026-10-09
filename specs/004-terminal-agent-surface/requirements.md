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
- **REQ-1.6** `resize` SHALL 接受 `rows/cols`；越界值 SHALL 被夹紧并回报**实际生效值**。**2026-10-09 补（宿主契约复核，详见 design §6）**：宿主 handle 的签名是 **`resize(cols, rows)`（列在前！）且不夹紧** ⇒ 实现 SHALL 在**唯一入口**显式换序并自实现夹紧；弄反**不会报错**，只会让行列**静默转置**（本 Spec 唯一会静默出错的点）。
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
- **REQ-3.4** GIVEN 宿主未提供沙箱服务，THEN 系统 SHALL 取**最保守**行为（拒绝写），SHALL NOT 默认放行。**2026-10-09 补（宿主契约复核）**：官方对「缺服务」的既有做法是**加载期 fail-fast**（`static inject`；`dsh-tool-bash` / `dsh-tool-pwsh` / `dsh-tool-fs` 三族同形）—— 若照抄，缺服务时工具**根本不激活**（0 个），与 REQ-1.1「恰好 6 个」冲突 ⇒ 本 Spec 改用**非严格的 `ctx.get('sandboxPolicy')`**（拿不到返回 `undefined`）+ 工具体内自判拒绝；**仍 SHALL 注册 6 个**。
- **REQ-3.5** GIVEN 工具审批被用户拒绝，THEN 结果 SHALL 为「已取消」类可读结果，SHALL NOT 执行任何副作用、SHALL NOT 标记为系统错误。**2026-10-09 补（宿主契约复核）**：宿主的 ask 门禁（`tools/pre-execute` → `serviceAsk`）会把 `rejected` / `cancelled` / `unavailable` **一律**折成 `isError: true` 的结果 ⇒ **只用官方 ask 门禁无法满足本 REQ**；实现 SHALL 自行调用 `ctx.approval.request(...)`，并把 `cancelled` 映射为**非 error** 的可读结果（副作用由本层自证为零）。

### REQ-4 错误语义

- **REQ-4.1** 所有失败 SHALL 以工具可读结果返回，SHALL NOT 抛出以致中断 Agent 会话。**2026-10-09 澄清（宿主契约复核）**：「不中断会话」是**目的**，不等于「零 throw」—— 宿主会把工具体的 throw 归一化成 `isError: true` 的结构化结果（`Error: <msg>`）且**不中断会话**；`defineTool` **自身**就以 `ToolArgsError` 抛出实现参数校验。故验收 SHALL NOT 写成「断言 `rejects` 计数为 0」（会与宿主内建机制打架），口径是「**失败必须呈现为可读结果、且不中断会话**」。
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
| A-1（**✅ 已确认，2026-10-09 只读源码复核**）| `defineTool` 的参数 schema 与错误返回形状在 rc.2 上如预期 | ✅ **复核定案**：`defineTool` 是**纯编译函数**，注册走 `ctx.tools.register(definition)`（**返回注销 disposer**，注册本身已 effect-scoped）；参数 DSL 是 **dsh-tools 自有**（`{type:"string", required:true, description, enum?}` —— `required` 写在**属性节点内**），**不是 Schemastery**（与本包 `Config` 的 schemastery 红线是两套系统，互不约束）；`output:{schema, render}` **必填**；工具体 throw → `isError:true` 结果、**不中断会话**。证据：`dsh-tools/lib/index.js` `:838-916`（defineTool）/ `:802-811`（DSL 编译成顶层 required）/ `:2878-2887`（register 返回 disposer）/ `:3306-3318` + `:3616-3630`（throw → 错误结果）；范本调用点 `dsh-tool-pwsh/lib/index.js:457-520`。⚠️ 未复核项：`output.render` 的呈现形状只读到契约文字 |
| A-2（**✅ 已确认（含 1 处冲突订正），2026-10-09 只读源码复核**）| 工具审批与沙箱策略**叠加**生效（拒绝审批 ≠ 抛错，而是可读失败结果）| ✅ **沙箱侧确认**：`ctx.sandboxPolicy` 是**策略解析器**（`resolve()` / `overrideOf()` / `defaultMode` / `setSandboxMode`），官方 bash / pwsh / fs / terminal 四族确实共用同一份 ⇒ REQ-3.3 成立。🔴 **审批侧与原文冲突**：用宿主 ask 门禁时 `rejected` / `cancelled` / `unavailable` **一律**是 `isError:true`（`dsh-tools/lib/index.js:3439-3490` → `:3243-3257`）⇒ 要满足 REQ-3.5 必须**自行调 `ctx.approval.request`** 并映射 `cancelled`。另：`ctx.sandboxPolicy` **不是逐次调用门禁**（门禁在 `tools/pre-execute` + `ctx.tools.guard()`），故本 Spec 的权限判定是「解析策略 + 自判」而非依赖宿主拦截 |
| A-3（**已确认**）| 沙箱策略对终端一致施加（官方文档写明对 bash/fs/终端同策略）| REQ-3.3 的依据（与 002 的 A-4 同源）|
