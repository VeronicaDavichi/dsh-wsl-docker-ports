---
status: complete
created: 2026-10-08
priority: high
tags:
- dsh-plugin
- agent-tools
- sandbox
depends_on:
- 002-terminal-profiles
created_at: 2026-10-08T10:27:50.382553300Z
updated_at: 2026-10-09T03:09:53.248739300Z
completed_at: 2026-10-09T03:09:53.248739300Z
transitions:
- status: planned
  at: 2026-10-08T13:23:04.726640Z
- status: in-progress
  at: 2026-10-09T02:36:44.318787Z
- status: complete
  at: 2026-10-09T03:09:53.248739300Z
---
# Agent 工具面：终端受管工具族与沙箱权限

**类型**: 需求驱动（requirements-first）
**状态**: planned（2026-10-08 已 `planned`；**同日从 002-terminal-profiles 拆出**；A-1 见文末）
**优先级**: high
**包名**: `dsh-terminal-profiles`（与 002 **同一个包**，本 Spec 只占其中「Agent 工具面」这一交付面）
**位置**: `packages/terminal-profiles/src/agent-tools/`
**依赖**: [002-terminal-profiles](../002-terminal-profiles/README.md)（`depends_on`）—— 终端引擎、屏幕模型、WS 通道、配置页、跨包服务全部仍在 002，本 Spec **不重复**

---

## 为什么独立成 Spec

002 的 `requirements.md` 与 `design.md` 拆前各 **199 行**，贴着 `leanspec` 的 warn 阈值（200），再加任何内容都会破线。同时「Agent 能读写终端」本身就是一个**独立可验收**的交付面：它有自己的接口（6 个工具）、自己的安全语义（沙箱映射）和自己的失败路径，却不拥有任何终端机制本体 —— 绑在同一份 199 行文档里，两边都读不清。

| Spec | 覆盖 |
|---|---|
| [002-terminal-profiles](../002-terminal-profiles/README.md) | 配置模型 · PTY 会话 · 屏幕模型 · WS 通道 · 右栏页类型 · 配置页 · 跨包服务 · 安装接入 |
| **004-terminal-agent-surface**（本 Spec）| **6 个 `defineTool` 工具** · 按键名映射 · **沙箱权限映射** · 工具错误语义 |

**拆的是文档与验收边界，不是包边界**：两个 Spec 的产物同属 `packages/terminal-profiles/`，共享 002 的 `session-manager` 与 `screen-model`。本 Spec **不新增任何终端机制**。

---

## 概述

Agent 面是这个组件的**主要卖点**（002 的概述已写死：官方右栏终端的输出不进 Agent transcript，Agent 看不见终端在跑什么）。本 Spec 把这个面写死：

    Agent ──defineTool──▶ managed_terminal_new / list / read / write / resize / kill
                            │  受 ctx.sandboxPolicy + 工具审批（与官方 bash / fs 同源）
                            ▼
                    002 的 session-manager / screen-model（本 Spec 不重新实现）

---

## 文档导航

| 文档 | 内容 |
|------|------|
| [requirements.md](./requirements.md) | REQ-1..4 与 EARS 验收标准、NFR、约束与假设 |
| [design.md](./design.md) | 工具定义表、按键名映射、权限矩阵、错误语义、与 002 的接口边界、测试策略 |
| [tasks.md](./tasks.md) | 按阶段拆分的任务与验证方法 |

---

## 冻结决策速览

| 决策点 | 结论 | 理由摘要 |
|---|---|---|
| 工具族 | 完整 6 个（`new`/`list`/`read`/`write`/`resize`/`kill`）| 覆盖完整生命周期；缺 `kill` 会留孤儿 PTY（`plugin.agentSurface`）|
| 注册方式 | `dsh-tools` 的 `defineTool` | 宿主唯一公开的工具注册面 |
| 读模型 | **快照 + 增量流都给**（`read` 的两种模式）| 快照给 TUI 正确画面，增量给低延迟（`plugin.agentReadModel`）|
| 权限 | 受 `ctx.sandboxPolicy` + 工具审批 | 避免 Agent 借终端绕过 `read-only` / `workspace-write`（`plugin.agentPermission`）|
| 失败语义 | 一律作为**工具可读结果**返回；throw 由宿主归一化成 `isError:true` 结果、**不中断会话**（**2026-10-09 订正**：原文「绝不抛出」过严 —— `defineTool` 自身即以 `ToolArgsError` 抛出做参数校验）| 目的不是「零 throw」，而是**失败可读 + 不中断会话**（下游最贵的失败是会话被打断）|
| 服务面 vs 工具面 | `managedTerminal` **服务**（给 003）留 002；**工具面**（给 Agent）在本 Spec | 消费者与安全语义不同：服务是包间契约，工具是 Agent 权限面 |

---

## 范围外（本 Spec 不做）

1. **不重新实现终端机制** —— PTY、屏幕模型、有界缓冲、resize 全在 002。
2. **不做浏览器侧任何东西** —— WS 通道、页类型、xterm 渲染全在 002。
3. **不新增工具**（`exec`、文件读写、多实例复用等）—— 本期就是这 6 个。
4. **不允许 Agent 绕过沙箱** —— `read-only` 下写操作是**拒绝**，不是「尽力而为」（与 002 的范围外第 5 条同一口径）。

---

## 阻塞项（进实现前必须打掉）

| # | 阻塞项 | 状态 |
|---|---|---|
| ~~B-1（**共用**，不重复）~~ | ~~`z.array(...).volatile()` 的 5 条真机行为链 → 见 [002 的 Phase 0](../002-terminal-profiles/tasks.md)~~ | ✅ **2026-10-08 五条全部定案，本 Spec 已继承关闭**（工具面不碰配置存活 ⇒ 无论结论如何本 Spec 都不受阻）。⚠️ **2026-10-09 订正**：本行原写「🟡 只等结论」，而结论当日就已出、004 的 T0.2 一直没接住 ⇒ 属**继承迟滞**，本轮补上 |
| A-1（**本 Spec**）| `defineTool` 在 rc.2 上的**参数 schema 与错误返回形状**契约 | ✅ **2026-10-09 已定案（只读源码级复核）**：`defineTool` = **纯编译函数**、注册走 `ctx.tools.register(...)`（**返回 disposer**）；参数 DSL 是 **dsh-tools 自有**（`required` 写在属性节点内），**不是 Schemastery**；`output:{schema, render}` **必填**；工具体 throw → `isError:true` 结果且**不中断会话**；🔴 宿主 ask 门禁把 `cancelled`/`rejected` **一律**折成 `isError:true` ⇒ 满足 REQ-3.5 SHALL 自调 `ctx.approval.request`。结论已回写 design §5/§8 与 requirements 的 A-1/A-2（含 1 处冲突订正）|
| A-2（**本 Spec**）| `resize` 参数顺序与夹紧 | 🔴 **2026-10-09 复核发现冲突并订正**：宿主 handle 是 **`resize(cols, rows)`（列在前）且不夹紧**，而本 Spec 原文写 `resize(id, rows, cols)`「夹紧并回报实际值」⇒ 002 SHALL 在**唯一入口**显式换序 + 自实现夹紧；**弄反不会报错，只会静默转置**（全套契约里唯一会静默出错处），已写进 REQ-1.6 / design §6 / tasks T1.2 |

---

## 硬规则偏离说明

| 硬规则 | 状态 | 说明 |
|--------|------|------|
| **UI 需求必须配 Playwright E2E** | ⚠️ **N/A** | 本 Spec **无 UI**（Agent 工具面）；口径同 002 = `vitest` + `node --test` 离线契约 + chrome-devtools MCP 真机验收 |
| 读 `.lean-spec/templates/requirements-template.md` | ⚠️ **偏离** | 模板库只有 `leanspec init` 生成的 `spec-template.md`（`leanspec templates` 实测只有它）；且 `leanspec create` **只产出 `README.md`** → `requirements.md` / `design.md` / `tasks.md` 按本仓库既有的**四文件约定**补（`leanspec view` 会读取它们，已实测）|
| 原型资产归档 / 视觉对照 | ⚠️ **N/A** | 无原型、无视觉 |
| 复核制两阶段提交 | ⚠️ **N/A** | 唯一「确认」是工具审批与 UAC（属 003）|
| 项目文档摘要 `grep -c "docs/"` ≥ 5 | ⚠️ **偏离** | 无 `docs/` 树；以 `stack-decision.md` 的**维度键**为来源精度 |

---

## 下一步

1. 主人复核本 Spec，重点：**REQ-3 权限映射的拒绝粒度** 与 **REQ-4 的错误语义**（两者均已于 2026-10-09 按宿主契约复核结果订正）。
2. **B-1 已继承关闭**（2026-10-08 定案）⇒ 004 现在的真实阻塞只剩 **`depends_on` 的 002**：本 Spec 的 T1.4 要消费 002 的 `session-manager` / 屏幕模型（**Phase 2 产物**），故 002 的 Phase 2 未落地前 004 不转 `in-progress`。
3. ✅ **Phase 0 已全部关闭（2026-10-09）**：T0.1（`defineTool` 契约）与 T0.2（B-1 继承）均结案并回写 design/requirements；**残余真机项**（node-pty 失败文案、`output.render` 呈现形状、ConPTY containment 强度、`resize` 越界行为）**随 002 的 T0.5 安装接入验证一并复核**（需主人在场）。
