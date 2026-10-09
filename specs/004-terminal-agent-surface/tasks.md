# 任务：Agent 终端工具族与沙箱权限

> 从 [requirements.md](./requirements.md) 与 [design.md](./design.md) 派生。
> **2026-10-08 从 002 的 tasks.md 拆出**（原 Phase 5 的 T5.1–T5.4），并补 Phase 0 的契约核对。

---

## Phase 0：契约核对（进实现前）

- [x] T0.1 [A-1][A-2] 核对 `defineTool` 契约 · ✅ **2026-10-09 关闭（只读源码复核 = 等价取证）**
  - 内容：对照宿主 `0.2.0-rc.2` 打包源码与官方首方调用点（`dsh-tool-pwsh` / `dsh-tool-fs` / `dsh-tool-jobs`），确认 ① 参数 schema 的声明形状 ② **错误/拒绝**是否以工具结果返回（而非抛出）③ 审批拒绝时的结果形状
  - 结论：① `defineTool` = **纯编译函数**，注册走 `ctx.tools.register(...)`（**返回 disposer**）；参数 DSL 是 **dsh-tools 自有**（`{type, required, description, enum?}`，`required` 写在**属性节点内**、编译成顶层 `required`），**不是 Schemastery**；`output:{schema, render}` **必填**。② 工具体 **throw 被归一化**成 `isError:true` 的结构化结果（`Error: <msg>`）且**不中断会话**；`defineTool` 自身以 `ToolArgsError` 抛出做参数校验。③ 宿主 ask 门禁把 `rejected`/`cancelled`/`unavailable` **一律**折成 `isError:true` ⇒ **只用官方门禁无法满足 REQ-3.5**，必须自调 `ctx.approval.request`
  - 验证：结论已回写 [design.md](./design.md) §5/§8 与 [requirements.md](./requirements.md) 的 A-1/A-2（两行均已改 ✅）；原设「若审批层直接抛错」→ **未命中**（宿主把拒绝折成**结果**，不是抛错）⇒ 本层兜底改为「**自调审批 + 映射 `cancelled`**」。⚠️ 取证方式 = **只读源码 + 官方调用点**（**未真机跑**）⇒ 残余真机项（node-pty 失败文案、`output.render` 呈现形状、ConPTY containment 强度）随 **002 的 T0.5** 一并复核

- [x] T0.2 [B-1 共用] 继承 002 的 volatile 真机结论 · ✅ **2026-10-09 关闭（继承完成）**
  - 内容：**不重复**该实验（在 [002 的 T0.1](../002-terminal-profiles/tasks.md)）；本 Spec 只继承结论
  - 继承到的结论：**五条全部定案** —— 真机：live 写入 **152ms** 生效、**不重挂载**且 `.get()` **值真传播**、ordinary 字段**真 remount**、非法值静默拒绝不崩；离线：元素内标 volatile 在 **parse 时**抛 `ValidationError`、数组级解析为带 `.get()` 的**深冻结**对象。落盘语义同日定案（→ 002 的 A-6）
  - 验证：002 的 T0.1 已 `[x]`；原设「若第 1 条被推翻」**未发生** ⇒ 本 Spec **不受影响**（工具面不碰配置存活），按预写口径关闭 ✓。⚠️ 本项自 2026-10-08 起一直挂 `[ ]`（结论已出但没人接），**2026-10-09 补齐**

---

## Phase 1：工具注册

- [ ] T1.1 [REQ-1.1][REQ-1.2][REQ-1.3][REQ-1.7] `new` / `list` / `kill`
  - 验证：`vitest` —— 工具注册表**恰好** 6 个名字；`new` 未知 profile 返回可用列表；`list` 含 `dropped`；`kill` 不存在 → 明确错误且**未**报成功。⚠️ **2026-10-09（复核）**：`kill` 的「含进程树」在 **Windows 上强度受限**（ConPTY 不进 Job containment，见 design §8-4①）⇒ 验收口径改为「**终止进程组 + 结果里明说尽力而为**」，真机项 #8 相应放宽

- [ ] T1.2 [REQ-1.4][REQ-1.5][REQ-1.6] `read` / `write` / `resize`
  - 内容：`read` 两模式；`write` 文本 + 按键名映射；`resize` 夹紧并回报实际值。🔴 **2026-10-09（复核）**：宿主 handle 是 **`resize(cols, rows)`（列在前）且不夹紧** ⇒ 002 的 `session-manager.resize(id, rows, cols)` **SHALL 在唯一入口显式换序**、夹紧自实现；写单测时**必须**用「rows ≠ cols」的用例（如 `resize(30, 100)`），否则行列转置**不会被测出来**
  - 验证：`vitest` —— 按键名表全覆盖（`Enter`/`Tab`/`C-c`/`Esc`/方向键）、未识别键名 → 工具错误（**不猜**）；`resize(0,0)` / 超界 → 返回夹紧后的实际值；**新增**：`rows ≠ cols` 时断言透传给宿主的参数**顺序正确**（fake handle 捕获 argv 形状）

- [ ] T1.3 [REQ-1.8][REQ-4.2][REQ-4.4] 参数校验与半成品检查
  - 验证：`vitest` —— 非法参数在业务逻辑前被拒（002 的调用计数为 0）；`new` 失败后实例表**无**新条目

- [ ] T1.4 [REQ-2.1][REQ-2.2][REQ-2.3][REQ-2.4] 读模型接线（消费 002）
  - 内容：`snapshot` / `incremental` 直接映射 002 的屏幕模型；**不自建**缓冲或序号
  - 验证：`vitest` + fake 002 —— `sinceSeq` 过期 → `lost: true` + 快照（**不**返回空数组）；静态 grep 断言本 Spec **无**自建缓冲/序号实现（NFR-3）

---

## Phase 2：权限

- [ ] T2.1 [REQ-3.1][REQ-3.2][REQ-3.3][REQ-3.4] 沙箱映射
  - 内容：按 design.md §4 表实现；复用 `ctx.sandboxPolicy`。⚠️ **2026-10-09（复核）**：服务获取 SHALL 用**非严格 `ctx.get('sandboxPolicy')`**（拿不到返回 `undefined`）+ 工具体内自判 —— **不用** `static inject`（官方 fail-fast 范式会让缺服务时工具**不激活**，与 REQ-1.1「恰好 6 个」冲突）；`ctx.approval` 同理
  - 验证：`vitest` —— 三种策略（`read-only` / `workspace-write` / 服务缺失）**逐工具逐格**断言；`read-only` 下 `new/write/resize/kill` 全部被拒且原因可读、且 002 的调用计数为 0；`read`/`list` 仍可用

- [ ] T2.2 [REQ-3.5] 审批拒绝路径
  - 验证：`vitest` + fake —— 审批被拒 → `cancelled` 结果、**无**副作用、**未**标记为系统错误（断言 error 通道计数 0）。⚠️ **2026-10-09（复核）**：宿主 ask 门禁**必然**把 `cancelled` 折成 `isError:true` ⇒ 本项 SHALL **自调 `ctx.approval.request`** 并映射；fake 必须能模拟 `rejected` / `cancelled` / `unavailable` 三种返回

---

## Phase 3：错误语义与收口

- [ ] T3.1 [REQ-4.1][REQ-4.3] 错误以工具结果返回
  - 验证：`vitest` —— 所有失败路径返回可读结果且含原因；**口径订正（2026-10-09）**：~~断言 `rejects` 计数为 0~~ → 改为**断言「失败呈现为 `isError:true` 的可读结果、且不中断会话」**（`defineTool` 自身以 `ToolArgsError` 抛出做参数校验，原断言会与宿主内建机制打架）；抽样断言 `hint` 非空

- [ ] T3.2 [NFR-1][NFR-2][NFR-3][NFR-4][NFR-5] 质量门
  - 验证：`pnpm -C packages/terminal-profiles typecheck` + `test` + `build` 三绿并记录用例数；卸载后**工具数归零**；静态断言本 Spec 目录**无**前端依赖、无 002 逻辑复制；单文件 ≤ 400 行

- [x] T3.3 文档回写 · ✅ **2026-10-09 完成**
  - 内容：T0.1（`defineTool` 契约结论）、T0.2（B-1 继承结论）→ 回写 design/README
  - 验证：已回写 [design.md](./design.md) §5/§7/§8、[requirements.md](./requirements.md) 的 A-1/A-2（✅）、[README.md](./README.md) 的阻塞表 A-1/A-2 两行与「下一步」；`grep -n "A-1\|A-2" specs/004-terminal-agent-surface/*.md` 可见结论；本 Spec 文档均 ≤ 200 行

---

## 真机验收清单（Agent 面，手工 + 工具调用记录）

| # | 场景 | 期望 | 手段 |
|---|------|------|------|
| 1 | Agent `read`（`snapshot`）| 快照含屏幕当前文本 | 工具调用记录 |
| 2 | Agent `read`（`incremental` + 合法 `sinceSeq`）| 按 seq 连续、无重复 | 工具调用记录 |
| 3 | Agent `read`（过期 `sinceSeq`）| `lost: true` + 快照（**不是**空数组）| 工具调用记录 |
| 4 | Agent `write` 发送 `C-c` | 前台命令被中断（副效应可见）| 工具 + 截图 |
| 5 | Agent `resize` 超界值 | 返回夹紧后的**实际**值，终端按实际值重排 | 工具返回 + `stty size` |
| 6 | Agent `new` 未知 profile | 错误结果含可用 profile 列表 | 工具调用记录 |
| 7 | `read-only` 沙箱下 Agent `write` | 被拒绝 + 原因；页面键盘输入仍可用 | 工具输出 |
| 8 | Agent `kill` 后再 `list` | 实例消失、无孤儿 PTY | 工具调用记录 |
| 9 | 禁用插件再启用 | 工具注册无重复（注册数 = 6 而非 12）| 日志 + 工具列表 |
