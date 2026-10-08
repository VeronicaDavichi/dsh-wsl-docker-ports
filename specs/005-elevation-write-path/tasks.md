# 任务：提权写路径

> 从 [requirements.md](./requirements.md) 与 [design.md](./design.md) 派生。
> **2026-10-08 从 [003-wsl-docker-ports](../003-wsl-docker-ports/tasks.md) 拆出**：原 T3.1–T3.4（所有权与写操作）、Phase 4（提权辅助进程，T4.1–T4.5）、T6.1–T6.3（红线自证与卸载清理）迁来并重编号。**原编号在新处不保留**（003 侧留空位指针）。

---

## Phase 0：前置（契约定案）

- [ ] T0.1 [REQ-3.4][REQ-3.7] 真机核对提权链路一次
  - 内容：生成临时 `.ps1` + `Start-Process -Verb RunAs`（**人工点一次 UAC**）→ 主机读到 out 文件 JSON、退出码正确、两个临时文件被删除；**本次不写任何系统规则**（用只读动作或 `-Action` 空转验证）
  - 验证：退出码 `0`；out JSON 可解析；`%TEMP%` 无残留；结论写入 design.md §4
  - ⚠️ 本项**必须人工点 UAC**（无法自动化）

- [ ] T0.2 [C-1/C-2] 继承 003 的前置结论
  - 内容：`netsh` 输出的 OEM 代码页（003 的 T0.1）与 19 条规则 fixture（003 的 T0.2）**不重复做**
  - 验证：003 的 Phase 0 结论可见且在 fixtures 目录中；若 003 的编码结论变化 → 本 Spec 的脚本读取方式同步

---

## Phase 1：所有权与写操作

- [ ] T1.1 [REQ-1.1][REQ-1.2][REQ-1.3] 所有权匹配算法
  - 验证：`vitest` —— 匹配「本插件规则」/ 拒绝「他人规则」/ `connectPort` 不符即 conflict；断言 conflict **无**任何写动作产生；集合外端口**零参与**（动作产生数 = 0）

- [ ] T1.2 [REQ-2.3][REQ-2.6] 防火墙参数生成
  - 内容：`New-NetFirewallRule -DisplayName dsh-wsl-docker-ports-<port> -Direction Inbound -Action Allow -Protocol TCP -LocalPort <port>`
  - 验证：`vitest` —— 断言**无**通配端口、**无**全量放行；同名已存在 → 报错（不覆盖）

- [ ] T1.3 [REQ-2.1][REQ-2.2][REQ-2.4] scope 切换序列
  - 验证：`vitest` —— loopback→lan 产生「portproxy add + 防火墙 add」顺序；lan→loopback 产生「两条 delete」；默认值为 loopback；断言切 lan 不是隐式批量

- [ ] T1.4 [REQ-1.5][NFR-1] 前后快照与任务日志
  - 内容：每次写操作记录 `{ before, after, exitCode, stdout }`
  - 验证：`vitest` —— 日志含四项且 `before/after` 为完整实际集（不是 diff 摘要）

- [ ] T1.5 [REQ-2.5] `localhostForwarding = false` 的差异说明
  - 验证：`vitest` —— 该键为 false 时 `loopback` 也生成显式规则，且 UI 文案含差异说明（**不静默**）

---

## Phase 2：提权辅助进程

- [ ] T2.1 [REQ-3.4][REQ-3.7] 脚本生成与参数结构
  - 内容：生成 `%TEMP%\dsh-ppp-<rand>.ps1`，参数 `-Action/-Port/-Address/-Scope`；**不接受任意命令文本**
  - 验证：`vitest` —— 生成内容只含白名单动作与数字端口；对含 `;`/`&`/反引号的输入断言被拒（不拼接）

- [ ] T2.2 [REQ-3.3][REQ-3.4] `Start-Process -Verb RunAs` 调用与回传解析
  - 验证：`vitest` + fake —— 退出码 `0/2/3/1` 四种映射；输出 JSON 解析；`ok:false` 时 steps 列表可展示

- [ ] T2.3 [REQ-3.5] 拒绝 UAC 的失败分支
  - 验证：`vitest` —— fake `Start-Process` 抛错（用户点「否」）→ 报「已取消」、**未**尝试任何回滚、**未**留文件

- [ ] T2.4 [REQ-3.1][REQ-3.2][REQ-3.6][NFR-2] 策略与临时文件清理
  - 验证：`vitest` —— `none` 时**未**调用 `Start-Process`（断言调用数 0）；`ask` 时先出确认且命令原文可见；成功 / 失败 / 超时三条路径的临时文件删除各有断言

- [ ] T2.5 [REQ-4.1][REQ-4.2] 来源约束（Agent）
  - 内容：服务层区分调用来源；**本期不注册任何模型工具**（REQ-4.2）；Agent 来源在 `passby` 下降级为 `ask`（A-1 口径，切换成本极小）
  - 验证：`vitest` —— 同一动作分别以 `user` / `agent` 来源调用，断言 agent 路径**未**直接进入提权（先确认或拒绝）

---

## Phase 3：红线与收口

- [ ] T3.1 [REQ-1.4] 红线断言：不存在 `portproxy reset`
  - 验证：`grep -rn "portproxy reset" src/` 命中 **0**；`grep -rn "netsh" src/` 的每一处都带 `listenport` 参数（人工复核 + 断言脚本）

- [ ] T3.2 [REQ-1.5][NFR-1][C-3] 真机自证：他人规则条数不变
  - 内容：真机上对一条 `managedPorts` 内端口做 add / remove / fix 各一次，前后各存 `netsh show v4tov4` 快照
  - 验证：**19 条既有规则（他人条目）条数与内容不变**；任务日志四项齐全；结论写入 tasks 与 README
  - ⚠️ 每次写操作**必须人工点 UAC**

- [ ] T3.3 [REQ-5.1][REQ-5.2][REQ-5.3][REQ-5.4] 卸载语义与清理清单
  - 验证：`vitest` —— 卸载**未**产生任何 delete 调用；清理清单含端口/规则名/地址且可复制；临时文件归零

- [ ] T3.4 [NFR-3][NFR-4] 质量门
  - 验证：`pnpm -C packages/wsl-docker-ports typecheck` + `test` + `build` 三绿并记录用例数；单文件 ≤ 400 行

- [ ] T3.5 文档回写
  - 内容：T0.1（提权链路真机结论）、T3.2（规则不变证据）→ 回写 requirements/design；并记 A-1 / A-2 的最终口径
  - 验证：`grep -n "A-1\|A-2\|reset" specs/005-elevation-write-path/*.md` 可见结论

- [ ] T3.6 [REQ-4.3] 红线断言：未注册 Agent 工具（来源约束的门禁）
  - 内容：本期**不注册任何 Agent 可调工具**；将来若注册，**必须先**补齐 REQ-4 的完整口径（错误语义、审批、日志）再放行，不得以「先能用」为由先行放行
  - 验证：`grep -rn "defineTool" src/` 命中 0，或命中处均附 REQ-4 口径补全的引用与用例；`vitest` 断言工具表内不存在本包来源的工具

---

## 真机验收清单（chrome-devtools MCP + **人工点 UAC**）

> 本清单是**写路径**的验收；只读展示与外部规则清单在 [003 的清单](../003-wsl-docker-ports/tasks.md)。UAC 弹窗**无法自动化**，以下每行都必须人工点击 —— 如实登记。

| # | 场景 | 期望 | 手段 |
|---|------|------|------|
| 1 | 加一条转发（loopback）| 提权 → 规则出现；`netsh` 总条数 +1，他人条目不变 | 人工 UAC + 前后快照 |
| 2 | 加一条转发（lan）| 规则 + **仅该端口**防火墙规则；`Get-NetFirewallRule` 核对 | 人工 UAC + 快照 |
| 3 | 移除自己那条 | 规则消失，他人条目不变 | 人工 UAC + 快照 |
| 4 | 漂移修复 | `connectAddress` 更新为当前 eth0；状态转 ok | 人工 UAC + 快照 |
| 5 | 拒绝 UAC | 显示「已取消」，规则零变化，临时文件已清理 | 人工点「否」+ `%TEMP%` 检查 |
| 6 | 提权策略 `none` | 写控件置灰 + 原因；点击无弹窗（**调用数 0**）| 截图 + 日志 |
| 7 | Agent 触发 + `passby` | **不静默执行**：降级为 ask（先确认）或直接拒绝 | 日志 + 截图 |
| 8 | 半成品防护 | 人为让防火墙步骤失败 → portproxy 被回滚、报告「未改」、无残留 | 人工 UAC + 快照 |
| 9 | 卸载后再看规则 | 规则**零变化**；清理清单可复制；临时文件归零 | 快照 + `%TEMP%` |
