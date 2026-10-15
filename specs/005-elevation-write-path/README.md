---
status: in-progress
created: 2026-10-08
priority: high
tags:
- dsh-plugin
- elevation
- uac
- security
depends_on:
- 003-wsl-docker-ports
created_at: 2026-10-08T10:35:07.728372800Z
updated_at: 2026-10-09T02:20:55.172792200Z
transitions:
- status: planned
  at: 2026-10-08T13:23:04.841303700Z
- status: in-progress
  at: 2026-10-09T02:20:55.172792200Z
---
# 提权写路径：UAC 辅助进程 · 声明式所有权 · 防火墙最小放行

**类型**: 需求驱动（requirements-first）
**状态**: in-progress（**2026-10-09 转 `in-progress`**；2026-10-08 建 Spec 时曾为 `planned` —— 本行原写「planned」未随 frontmatter 的 `transitions` 更新，**2026-10-15 按 frontmatter 订正**；**同日从 003-wsl-docker-ports 拆出**；**A-1 / A-2 均已定案**，未验证项见文末 **A-3**）
**优先级**: high
**包名**: `dsh-wsl-docker-ports`（与 003 **同一个包**，本 Spec 只占其中「写路径与提权」这一交付面）

---

## 为什么拆

003 拆前四个文件为 **199 / 195 / 191 / 165** 行，`requirements.md` 与 `design.md` 双双贴 `leanspec` 的 warn 阈值（200）—— 再加内容只能靠删字，不是长久之计。

而「提权 + 写路径」这一块有三个独立成篇的理由：

1. **风险最高**：它是唯一能**改动用户系统状态**的部分（portproxy / 防火墙），一旦出错会静默断掉用户的服务 → 需要独立的安全验收（红线断言 + 「他人规则条数不变」）。
2. **最可复用**：「下一期」的进容器 exec / compose / 镜像管理都要复用同一套提权管道，独立成篇将来直接引用。
3. **耦合最松**：它只依赖 003 的**只读事实**（NAT 状态 / eth0 IP / 实际集），不碰 UI 与五态分类。

## 覆盖划分（003 vs 005）

| 面 | 归属 |
|---|---|
| docker / netsh 只读解析 · 五态分类 · 外部规则只读清单 · 端口声明表单（区间 + presets）· 配置页 · P1 容器控制 | **003** |
| 声明式所有权与精确删除 · 作用域与防火墙最小放行 · UAC 辅助进程 · 来源约束（Agent）· 卸载清理语义 | **005（本 Spec）** |

## 写路径一张图

    Host 进程（非管理员）                        elevated child（UAC 之后）
    ┌──────────────────────────┐                ┌──────────────────────────────┐
    │ 1. 生成 %TEMP%\dsh-ppp-  │ Start-Process  │ 6. 读结构化参数（非命令文本） │
    │    <rand>.ps1 + out 路径 │ ──── RunAs ───►│ 7. 执行 portproxy / 防火墙动作│
    │ 3. （ask）先确认命令原文 │                │ 8. 结果 JSON 写 out 文件      │
    │ 4. 等退出码 / 90s 超时   │◄─── 退出码 ────│ 9. 退出码 0 / 2 / 3 / 1      │
    │ 5. 读 out 文件           │                └──────────────────────────────┘
    │ 10. 删除 .ps1 与 out     │
    └──────────────────────────┘

## 文档导航

| 文件 | 内容 |
|---|---|
| [requirements.md](./requirements.md) | REQ-1..5 与 EARS 验收标准、NFR、约束与假设（迁自 003 的 REQ-4/5/7/8/13）|
| [design.md](./design.md) | 写操作算法、防火墙最小放行、提权辅助进程契约、安全对照表、测试策略 |
| [tasks.md](./tasks.md) | 按阶段拆分的任务与真机验收清单（**UAC 弹窗必须人工点**）|

## 冻结决策速览

| 决策 | 结论 | 理由 |
|---|---|---|
| 所有权 | **声明式**（`managedPorts` 界定），集合外一律不碰 | 不建台账文件、不用 `reset`（SSoT `plugin.portOwnership`）|
| 删除 | **精确四元组**（带 `listenport`），**永不** `reset` | 原脚本坑 #1 会清空他人规则 |
| 作用域 | 默认 **loopback**；`lan` 逐端口显式 + **仅该端口**防火墙放行 | 原脚本坑 #2 = `0.0.0.0` + 全量放行 |
| 提权 | `none`（默认）/ `ask` / `passby`；临时 `.ps1` + `Start-Process -Verb RunAs`，输出经**临时文件**回传 | 完整性级别不同，无法管道回读 |
| 参数 | 仅**结构化**（动作 / 端口 / 地址 / 作用域），不接受命令文本 | 注入面收敛 |
| 来源 | Agent 触发**不得**走 `passby` 静默执行 | 避免 Agent 越过用户点 UAC |
| 卸载 | **不**自动删规则，改提供清单 + 显式清理 | 规则是用户可感知的系统状态 |

## 范围外

1. **不做** docker / netsh 的只读解析与五态分类（003）。
2. **不做**任何 UI 渲染与表单（003；本 Spec 只暴露写操作与状态回报）。
3. **不做** UDP 任何形式的代偿（003 REQ-9：`v6tov6` / 第三方工具一律不用）。
4. **不做**「卸载即自动清理规则」（005 REQ-5.1 明示相反）。

## 依赖方向

- 本 Spec **依赖 003** 的只读事实：NAT 判定（001 提供）、eth0 IPv4、实际集与期望集（`connectAddress` 该怎么写）。
- 反向的运行时耦合（003 的按钮调用本 Spec 的写操作）是**同包内的代码调用**，不构成 Spec 级阻塞边 —— 否则两边互相 `depends_on` 会成环。
- 不 import 002；不建任何包依赖边（保 L3）。

## 硬规则偏离说明

| 硬规则 | 状态 | 说明 |
|--------|------|------|
| **UI 需求必须配 Playwright E2E** | ⚠️ **N/A** | 本 Spec **无 UI**；口径同 003 = `vitest`（脚本生成/退出码/清理三路径）+ `node --test` 离线契约 + chrome-devtools MCP 真机验收 |
| 读 `.lean-spec/templates/requirements-template.md` | ⚠️ **偏离** | 模板库只有 `spec-template.md`；`leanspec create` 只产出 `README.md` → requirements/design/tasks 按本仓库既有四文件约定补（`leanspec view` 会读取）|
| 项目文档摘要 `grep -c "docs/"` ≥ 5 | ⚠️ **偏离** | 无 `docs/` 树；以 `stack-decision.md` 的维度键标来源精度 |

## 阻塞项与前置

| # | 项 | 状态 |
|---|---|---|
| C-1 | **本机组装前提**：DSH 进程**非管理员** → 一切 netsh / 防火墙写操作必须走 UAC（`stack-decision.md` 真机事实）| ✅ 已知 |
| C-2 | 本机既有 **19 条** portproxy 是用户真实数据 | ✅ 所有写验收的比对对象 |
| A-1 | **（原 003 的 A-5）**：Agent 触发的提权在 `passby` 下**降级为 `ask`** | ✅ **2026-10-08 主人定案 = 方案 A**（备选「直接拒绝」被否）|
| A-3 | **提权后端链**：用户自装 `gsudo` → `Start-Process -Verb RunAs` 回落；Windows 自带 `sudo` 仅显式配置时用 | ✅ **2026-10-08 定案**；⚠️ **未验证项**：`sudo` 需 **24H2+**（本机 23H2 无法验证），且默认模式拿不到输出。<br>🔵 **本机只读核验（2026-10-09）**：`gsudo` **v2.6.1 在 PATH**（与 `stack-decision.md` 2026-10-08 记录一致，本次**独立复现**）· `%SystemRoot%\System32\sudo.exe` **不存在** · 🔴 **`Get-Command sudo -All` 唯一命中的是 gsudo 自带的 `sudo.exe`**（ProductName=gsudo 2.6.1）⇒ **后端探测必须按路径/产品名，绝不按命令名 `sudo`**。**仍欠**：真机点一次 UAC 走通 stdio 回传（T0.1，需主人在场）|
| A-2 | **（原 003 的 A-6）**：卸载**不**自动清理规则 | ✅ **2026-10-08 主人确认**（本 Spec 既定口径，**零改动**）|

## 下一步

1. 主人复核本 Spec，重点：**REQ-3.4 提权后端链（A-3）**、**REQ-5 卸载清理边界**。**A-1（Agent 触发降级为 `ask`）与 A-2（卸载不清理）均已于 2026-10-08 定案**；新增未验证项 **A-3**（Windows 自带 `sudo`，需 24H2 机器实测）。
2. 003 的 Phase 0 真机契约（`netsh` 编码、`--format`）通过后，本 Spec 可并行开工；真机验收需**人工点 UAC**。
