# 技术设计：Agent 终端工具族与沙箱权限

> 从 [requirements.md](./requirements.md) 派生（requirements-first）。任务见 [tasks.md](./tasks.md)。
> **2026-10-08 从 [002-terminal-profiles](../002-terminal-profiles/design.md) 的 §2.4（工具族）与 §2.5（权限映射）拆出**，并补齐接口边界与错误语义两节。

---

## 1. 在包内的位置

    packages/terminal-profiles/
      src/session-manager/      ← 002：PTY 实例表（id → { pty, screen, buffer, size }）
      src/screen-model/         ← 002：@xterm/headless + serializer（快照 + seq 增量块）
      src/ws-router/            ← 002：ctx.webServer 具名路由 + upgrade
      src/agent-tools/          ← 本 Spec：defineTool ×6（唯一新增目录）
      src/config-page/          ← 002：plugins.row.config
      src/service-export/       ← 002：ctx.provide('managedTerminal', …)

**依赖方向**：本 Spec 的代码 → 002 的 `session-manager` / `screen-model`（**同包内直接调用**，不需要 `ctx.inject`，也不产生包依赖边）。反向无依赖：002 **不**知道工具面存在（工具注册是只读消费）。

---

## 2. 工具定义（`defineTool` ×6）

| 工具 | 参数 | 返回 | 沙箱 |
|---|---|---|---|
| `new` | `profile` | `{ id, pid }` | 受策略约束（REQ-3.1）|
| `list` | — | 实例数组（含 `dropped`）| 只读可用 |
| `read` | `id`, `mode: snapshot｜incremental`, `sinceSeq?` | 快照或块数组（含 `lost`）| 只读可用 |
| `write` | `id`, `data`（文本或按键名）| `{ written }` | 受策略约束 |
| `resize` | `id`, `rows`, `cols` | `{ rows, cols }` 实际生效值 | 受策略约束 |
| `kill` | `id` | `{ killed: true }` | 受策略约束 |

## 3. 按键名映射

`Enter`→`\r`、`Tab`→`\t`、`C-c`→`\x03`、`Esc`→`\x1b`、方向键→CSI 序列（`\x1b[A/B/C/D`）、`C-d`→`\x04`、`Backspace`→`\x7f`；**未识别键名 → 工具错误（不猜测、不丢弃）**（REQ-4.2）。

映射表是**纯函数 + 单测表驱动**：新增键名只改表，不改工具逻辑。

---

## 4. 权限映射

| 沙箱策略 | new | write | resize | kill | read/list |
|---|---|---|---|---|---|
| `read-only` | ❌ 拒绝 | ❌ 拒绝 | ❌ 拒绝 | ❌ 拒绝 | ✅ |
| `workspace-write` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 服务缺失 | ❌（最保守，REQ-3.4）| ❌ | ❌ | ❌ | ✅ |

判定**复用** `ctx.sandboxPolicy`（与官方 bash/fs 同源），不另起策略（REQ-3.3）。**拒绝是终态**：被拒的工具不进入业务逻辑、不产生副作用，返回可读原因（REQ-3.1/3.5）。

---

## 5. 错误语义

    所有失败 → 工具可读结果 { ok: false, code, message, hint? }（REQ-4.1）
    绝不 → throw（会中断 Agent 会话，是下游最贵的失败）

| 场景 | code（示意）| hint |
|---|---|---|
| profile 不存在 | `profile-not-found` | 附可用 profile 列表（REQ-1.2）|
| 实例不存在 | `instance-not-found` | 附 `list` 的 id 提示（REQ-1.7）|
| 沙箱拒绝 | `sandbox-denied` | 附当前策略与「为什么」 |
| 审批取消 | `cancelled` | **不是** error 语义（REQ-3.5）|
| 未识别键名 | `unknown-key` | 附已支持键名清单（REQ-4.2）|
| 参数非法 | `invalid-args` | 由 `defineTool` schema 在业务逻辑前拦下（REQ-1.8）|

---

## 6. 与 002 的接口边界

| 本 Spec 需要 | 来自 002 | 约束 |
|---|---|---|
| 起实例 | `session-manager.open(profile)` | 返回 id；失败语义由 002 定义 |
| 实例枚举 | `session-manager.list()` | 含 `dropped`（REQ-2.4）|
| 屏幕读 | `screen-model.snapshot(id)` / `sinceSeq` 增量 | `lost` 判定在 002（REQ-2.2）|
| 输入 | `session-manager.write(id, data)` | 字节原样，不经 shell 切词 |
| 尺寸 | `session-manager.resize(id, rows, cols)` | 返回**实际**生效值（夹紧在 002）|
| 终止 | `session-manager.kill(id)` | 含进程树 |

**红线**：本 Spec SHALL NOT 复制上表任何实现（NFR-3）。工具面是**薄适配层**：参数校验 → 权限判定 → 调用 002 → 结果整形。

---

## 7. 测试策略

| 层 | 载体 | 覆盖 |
|---|---|---|
| 纯函数/映射单测 | `vitest` | 按键名映射表全覆盖（含负例）、参数 schema 校验、结果整形 |
| 权限矩阵 | `vitest` + fake `sandboxPolicy` | 三种策略 × 6 工具逐格断言；`read-only` 下写操作**未**进入业务逻辑（调用数 0）|
| 假宿主集成 | `vitest` + fake session-manager | 工具注册/卸载计数归零；失败路径**无**抛出（`rejects` 计数 0）|
| 真机验收 | **chrome-devtools MCP + Agent 工具调用记录** | 见 tasks.md 的真机清单（`read` 两模式、`write` 发 `C-c`、`read-only` 被拒）|

---

## 8. 决策权衡与已知限制

| 决策 | 取舍 | 被否方案与原因 |
|---|---|---|
| 工具面独立成 Spec（与 002 同包）| 多一份文档 | 002 拆前已 199/199 行贴 warn 线；且工具面有独立接口与安全语义 → 混在一起两边都读不清 |
| 6 个工具全给 | 工具数多，Agent 选择面大 | 只给 `write`+`read` → 无法 `kill` 孤儿 PTY、无法 `resize` 适配 TUI |
| 薄适配层 | 多一层调用 | 复制 002 逻辑 → 两处实现必然漂移（尤其 `lost` 与夹紧语义）|

1. **已知限制**：`read` 的增量流受 002 的有界缓冲约束 —— 慢消费者会看到 `lost`（**设计如此**，不是缺陷）；`dropped` 计数已暴露（REQ-2.4）。
2. **已知限制**：工具面**没有**自己的实例生命周期 —— 插件卸载时实例由 002 终止（002 REQ-12.1），本 Spec 不重复该保证。
3. **待真机确认（A-1/A-2）**：`defineTool` 的参数 schema 与审批拒绝的结果形状按 rc.2 实测核对（Phase 0）。
