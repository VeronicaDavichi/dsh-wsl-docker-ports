# 功能需求：提权写路径（UAC 辅助进程 · 声明式所有权 · 防火墙最小放行）

> **2026-10-08 从 [003-wsl-docker-ports](../003-wsl-docker-ports/requirements.md) 拆出**：原 **REQ-4 / REQ-5 / REQ-7 / REQ-8 / REQ-13** 整体迁来，重编号为 **REQ-1..REQ-5**。内容**逐条保留、无删改**，仅修正跨 Spec 引用（凡指 003 处均写明「003 的 REQ-x」）。需求驱动（requirements-first），设计见 [design.md](./design.md)，任务见 [tasks.md](./tasks.md)。

---

## 0. 来源（SSoT）

`docs/` 为空 → 与 003 同口径：以 `stack-decision.md` 的维度键标来源精度 —— `plugin.elevationPolicy` · `plugin.portOwnership` · `plugin.portScope` · `plugin.natPrerequisite`。

---

## 1. 范围

**做**：声明式所有权与精确删除 · 作用域（loopback / lan）与防火墙最小放行 · UAC 提权辅助进程 · 来源约束（Agent）· 卸载与清理语义。

**不做**：docker / netsh 只读解析、五态分类、外部规则只读清单、端口声明表单、配置页、P1 容器控制 —— 全在 [003](../003-wsl-docker-ports/requirements.md)。本 Spec **只定义写路径与提权**，不复制 003 的任何只读逻辑（003 的五态 = 本 Spec 写操作的输入）。

---

## 2. 功能需求

### REQ-1 声明式所有权（安全红线）　← 003 的 REQ-4

- **REQ-1.1** `managedPorts` SHALL 为配置中显式声明的端口集合（**单端口与闭区间混写**，如 `[3306, "1000-3000", "4000-5000"]`，解析规则见 **003 的 REQ-16.1**）；集合外端口 SHALL NOT 进入五态、SHALL NOT 被修改或删除。**2026-10-08（D-2）修订**：集合外规则**可**出现在「外部规则」只读清单中（**003 的 REQ-15**），但仍**不进五态、不可操作、不可修复**。
- **REQ-1.2** 删除规则 SHALL 只针对 `listenPort ∈ managedPorts` **且** `connectAddress` 与本插件该端口的期望值一致的规则。
- **REQ-1.3** GIVEN 同端口已有非本插件规则（`connectAddress` 既非当前 eth0、也非本插件写入值），THEN 系统 SHALL 标 `conflict`，SHALL NOT 修改或删除该规则，SHALL 提示用户手工处理。
- **REQ-1.4** 系统 SHALL NOT 调用 `netsh interface portproxy reset` 或任何等价的全量清空操作。
- **REQ-1.5** 每次写操作 SHALL 在执行**前后各取一次实际集快照**，用于自证「只动了自己那一条」（写入任务日志，供真机验收比对）。

### REQ-2 作用域（loopback / 局域网）　← 003 的 REQ-5

- **REQ-2.1** 每个端口 SHALL 有 `scope ∈ { loopback, lan }`，**默认 `loopback`**。
- **REQ-2.2** `loopback`：GIVEN `localhostForwarding = true`（NAT 缺省），THEN 系统 SHALL 显示「无需 portproxy 规则」，SHALL NOT 为该端口添加规则。
- **REQ-2.3** `lan`：系统 SHALL 添加 `listenaddress=0.0.0.0` 的 portproxy 规则 **+ 仅放行该端口**的入站 TCP 防火墙规则；SHALL NOT 做全量放行（原脚本坑 #2）。
- **REQ-2.4** 切到 `lan` SHALL 是逐端口显式操作（无隐式批量、无默认开启）；切回 `loopback` SHALL 移除该端口的 portproxy 与本插件建的防火墙规则。
- **REQ-2.5** GIVEN `localhostForwarding = false`，THEN `loopback` 也需要显式规则；系统 SHALL 检测该键并在 UI 说明差异（**不静默**）。该键由本包自行读取（单消费者，不进 001）。
- **REQ-2.6** 防火墙规则 SHALL 使用可识别名称（`dsh-wsl-docker-ports-<port>`）；GIVEN 同名规则已存在，THEN 系统 SHALL 报错，SHALL NOT 覆盖。

### REQ-3 UAC 提权　← 003 的 REQ-7

- **REQ-3.1** `none`（**默认**）：SHALL NOT 执行任何需提权的操作；相关控件置灰并说明原因。
- **REQ-3.2** `ask`：每次操作前 SHALL 请求确认，并展示**将执行的命令原文**；确认后才发起 UAC。
- **REQ-3.3** `passby`：SHALL 自动发起 UAC，SHALL NOT（也无法）绕过系统弹窗。
- **REQ-3.4** 机制：SHALL 写临时 `.ps1` 并以 `Start-Process -Verb RunAs` 执行；子进程输出 SHALL 经**临时文件**回传（完整性级别不同，无法管道回读）。
- **REQ-3.5** GIVEN 用户拒绝 UAC / 超时 / 脚本失败，THEN 系统 SHALL 优雅失败：报告原因，SHALL NOT 留下半成品（portproxy 与防火墙要么都成、要么都不成），SHALL 清理全部临时文件。
- **REQ-3.6** 临时 `.ps1` 与输出文件 SHALL 位于用户临时目录、文件名含随机段，且 SHALL 在成功、失败、超时三条路径上都被删除。
- **REQ-3.7** 提权脚本 SHALL 只接受**结构化参数**（动作 / 端口 / 地址 / 作用域），SHALL NOT 接受任意命令文本。

### REQ-4 来源约束（Agent）　← 003 的 REQ-8

- **REQ-4.1** GIVEN 操作由 Agent 触发，THEN `passby` SHALL NOT 静默执行，SHALL 降级为 `ask` 或直接拒绝。
  > **待主人择一（A-1，迁自 003 的 A-5）**：降级为 `ask`（Agent 可发起，但每次要点 UAC）**还是**直接拒绝（Agent 完全不能触发提权）。本 Spec 按「降级为 ask」写验收，切换成本 = 一处判定 + 两条断言。
- **REQ-4.2** 本期本包 SHALL NOT 注册模型工具（不在 handover 的做清单内）；REQ-4.1 的落地形式为**服务层区分调用来源**。
- **REQ-4.3** GIVEN 将来为本包注册工具，THEN SHALL 先补齐本 REQ 的完整口径（错误语义、审批、日志），SHALL NOT 以「先能用」为由先行放行。

### REQ-5 卸载与清理语义　← 003 的 REQ-13

- **REQ-5.1** GIVEN 插件被卸载，THEN 系统 SHALL NOT 自动删除任何 portproxy 或防火墙规则（避免误伤既有 19 条），SHALL 提供「本插件维护的规则」清单 + 手动清理入口。
  > **✅ 已确认（A-2，迁自 003 的 A-6，2026-10-08 主人确认）**：卸载不清理是有意为之 —— 规则是用户可感知的系统状态，删错了会静默断掉用户的服务。反面方案（卸载即清理自己建的规则）更「干净」但风险更高；**主人已裁定按保守方案定案**（REQ-5.1 口径不变），若将来要求自动清理，改 REQ-5.1 并复用 **REQ-1.2** 的匹配算法。
- **REQ-5.2** 清理清单 SHALL 含端口、规则名与地址，可复制；SHALL NOT 只给一句「请手工清理」。
- **REQ-5.3** 卸载 SHALL 清理临时文件（`.ps1` 与输出文件）。
- **REQ-5.4** 用户显式执行「清理」时（需提权），系统 SHALL 只删除本插件建的规则（复用 **REQ-1.2**）。

---

## 3. 非功能需求

- **NFR-1** 每次写操作 SHALL 可追溯：执行前后的实际集快照 + 提权脚本退出码 + 回传输出，四项齐全。
- **NFR-2** 提权临时文件 SHALL 在成功 / 失败 / 超时三条路径上都被删除（各有断言）。
- **NFR-3** 内网/离线可用：SHALL NOT 依赖 CDN、SHALL NOT 运行 `npx`。
- **NFR-4** `typecheck` + `vitest` + `build` 三项 SHALL 全绿；单文件 ≤ 400 行、单 Spec 文档 ≤ 200 行。

---

## 4. 约束与假设

| # | 内容 | 影响 |
|---|------|------|
| C-1 | 依赖 001（NAT 判定 / eth0 / argv 执行）；依赖 **003** 的只读事实（实际集与期望集）；**不** import 002 | REQ-1.4 / REQ-3.7 的基础 |
| C-2 | 本机 DSH 进程**非管理员** → 一切 netsh / 防火墙写操作必须走 UAC | REQ-3 的存在理由 |
| C-3 | 本机既有 **19 条** portproxy 是用户真实数据 | 所有写操作验收的比对对象：**他人规则条数必须不变** |
| A-1（**假设·待选**）| Agent 触发的提权在 `passby` 下**降级为 `ask`**（备选：直接拒绝）| REQ-4.1 的验收口径；切换成本极小 |
| A-2（**✅ 已确认**）| 卸载**不**自动清理规则，改提供清单 + 显式清理 | REQ-5.1；**2026-10-08 主人确认**，本 Spec 口径零改动 |
