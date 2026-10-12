---
status: in-progress
created: 2026-10-08
priority: medium
tags:
- dsh-plugin
- wsl
- docker
- portproxy
- elevation
- ui
depends_on:
- 001-wsl-shared
created_at: 2026-10-08T09:44:35.215830Z
updated_at: 2026-10-08T13:25:44.590630500Z
transitions:
- status: planned
  at: 2026-10-08T13:23:04.615453700Z
- status: in-progress
  at: 2026-10-08T13:25:44.590630500Z
---
# WSL Docker 管理器 + 端口转发可视化

**类型**: 需求驱动（requirements-first）
**状态**: in-progress（2026-10-08 开工；Phase 0 的 T0.1 / T0.2 / T0.4 **已完成**）；**2026-10-12 关闭评估轮**：Phase 5 的 **T5.1–T5.8 八条已按离线判据逐条结清**（判据 / 命令 / 原始输出见 [closure-round.md](./closure-round.md)），仍余 **6** 条（2 条真机项 + 1 条待拍板 + 3 条 P1）⇒ **状态仍 `in-progress`**
**优先级**: medium（P0 为组件主体，P1 + 下一期另有边界，见「分期」）
**包名**: `dsh-wsl-docker-ports`（**插件包**）
**位置**: `packages/wsl-docker-ports/`
**依赖**: [001-wsl-shared](../001-wsl-shared/README.md)（`depends_on`）；**可选消费** [002-terminal-profiles](../002-terminal-profiles/README.md) 的 `managedTerminal` 服务（不建包依赖边）

---

## 概述

WSL 里的 docker 引擎（本机实测：WSL 内 `/usr/bin/docker`，server **29.5.3**，非 Docker Desktop）把容器端口映射到 WSL 的 eth0；Windows 侧访问需要 `netsh interface portproxy` 把端口从 Windows 转发进 WSL。本机现存的 **19 条规则**（`0.0.0.0:<port> → 172.20.201.152`）就是这套手工脚本的产物。

本组件做两件事：

1. **看得见**：只读展示容器与其端口映射
2. **管得住**：把「期望的转发」与「实际的规则」做 diff，并**只维护自己声明的那部分**规则

### 原脚本的 5 个坑 → 本组件的设计约束

| # | 原脚本行为 | 问题 | 本组件的对策 |
|---|---|---|---|
| 1 | `netsh interface portproxy reset` | 清空**全部**规则（本机 19 条里含他人的）| **禁止 reset**；删除只针对匹配 `(listenport, connectaddress)` 的规则（REQ-4.2）|
| 2 | `listenaddress=0.0.0.0` + 防火墙全量放行 | 19 个端口暴露给局域网，含 5432/6379/5000-5003 | **默认 loopback**；局域网是逐端口显式 opt-in + **单端口**放行（REQ-5.2/5.3）|
| 3 | 硬编码 19 个端口 | 「docker 管理器」却不知道 docker 实际映射了什么 | 端口期望集来自 **实际 `docker ps` 输出** ∩ `managedPorts`（REQ-2/REQ-3）|
| 4 | `connectaddress=<eth0 IP>` | WSL 重启后 IP 变，规则**静默失效** | eth0 IP **漂移检测** + 一键修复（REQ-6）|
| 5 | portproxy 不支持 UDP | 容器 UDP 映射无法转发 | UI **明示不支持**（REQ-9），不假装能做 |

### 可视化的核心：期望 vs 实际 diff

    期望（docker 实际映射 ∩ managedPorts）        实际（portproxy 里属于我的规则）
    ┌──────────────────────────────┐            ┌────────────────────────────────────┐
    │ 8080/tcp  容器 web            │  ──diff──► │ 0.0.0.0:8080 → 172.20.201.152  ✅ ok │
    │ 5432/tcp  容器 pg             │            │ （无）                          ⚠️ missing │
    │ 3000/tcp  容器 ui             │            │ 0.0.0.0:3000 → 172.20.190.12   🔴 drift  │
    │ 6379/tcp  容器 redis (loopback)│           │ 0.0.0.0:6379 → …               🟡 conflict│
    └──────────────────────────────┘            └────────────────────────────────────┘

| 状态 | 含义 | 动作 |
|---|---|---|
| `ok` | 规则存在且 `connectaddress` = 当前 eth0 | 无 |
| `missing` | 期望有、实际无 | 可一键添加（需提权）|
| `drift` | 规则在，但指向**旧** eth0 IP | 可一键修复 |
| `conflict` | 同端口已有**非本插件**的规则 | **只报告，不动作**（REQ-4.3）|
| `extra` | 在 `managedPorts` 内、但 docker 已不映射 | 可提示移除（不自动）|

---

## 功能说明

### P0（本期主体）

- 消费 001：发行版发现 / eth0 IPv4 / `.wslconfig` 的 networkingMode 判定
- docker **只读**展示（容器 + 端口映射，`docker ps --format '{{json .}}'`）
- 端口转发可视化（期望 vs 实际 diff，五态）
- **端口声明**（区间 + presets 勾选，写 `managedPorts`）—— **D-3 提到 P0**
- **外部规则只读清单**（本机 19 条，不进五态、无动作）—— D-2
- eth0 IP **漂移检测**（一键修复的**触发**在 003，**执行**在 005）
- NAT 硬前提：非 NAT → UI 可见但置灰 + 原因 + 修复步骤
- ~~声明式所有权 / 逐端口 scope / **UAC 提权辅助** / 提权策略 `none｜ask｜passby`~~ → **已迁至 [005-elevation-write-path](../005-elevation-write-path/README.md)**（2026-10-08 拆分；003 只触发与展示）

### P1（同 Spec，后一阶段）

- 启停 / 重启容器
- 容器日志（`docker logs --tail`）
- 完整配置页 `plugins.row.config` + `configure({ auto: false })`（`scope` / `elevationPolicy`）；**`distro` 的目标发行版控件已在 P0**（D-4 → REQ-17 / T5.8）

### 下一期（**不在本 Spec 实现**，但预留注入点）

- 进容器 `exec`（**可选注入** 002 的 `managedTerminal` 服务；服务缺失 → 按钮置灰 + 写明原因，回调永不触发、不报错）
- `compose up/down`
- 镜像管理

---

## 文档导航

| 文档 | 内容 |
|------|------|
| [requirements.md](./requirements.md) | REQ-1..3、6、9..12、14..16 与 EARS 验收标准、交互控件清单、NFR、约束与假设（**REQ-4/5/7/8/13 已迁出**，编号留空位）|
| [design.md](./design.md) | 架构、数据模型、端口状态机（纯函数）、NAT 门、注入点、安全、测试策略、决策权衡 |
| [tasks.md](./tasks.md) | 按阶段拆分的任务与真机验收清单（**不触发提权**，故无需人工点 UAC）|
| [closure-round.md](./closure-round.md) | **2026-10-12 关闭评估轮**：14 条未勾项逐条判据与实测输出（T5.1–T5.8 结清；6 条留给真机批次 / 待拍板 / P1）|
| [**005-elevation-write-path**](../005-elevation-write-path/README.md) | **提权写路径（2026-10-08 拆出）**：声明式所有权 · 作用域与防火墙最小放行 · UAC 辅助进程 · 来源约束 · 卸载清理 |

> **拆分说明**：本 Spec 拆前四个文件为 **199 / 195 / 191 / 165** 行，`requirements.md` 与 `design.md` 双双贴 `leanspec` 的 warn 阈值（200）。拆的是**文档与验收边界**，**不是包边界** —— 003 与 005 的产物都在 `packages/wsl-docker-ports/`（003 拥有 `read/` `diff/` `ui/`，005 拥有 `write/` `elevate/`）。运行时是**同包内调用**：003 的按钮调 005 的写操作，因此**只有 005 → 003 的 `depends_on`**（反向不建边，避免成环）。

---

## 冻结决策速览

| 决策点 | 结论 | 理由摘要 |
|---|---|---|
| NAT 前提 | **NAT 为硬前提**；非 NAT 置灰 + 原因 + 修复步骤 | 用户更正：NAT 下 WSL 才有独立 eth0，portproxy 才有意义；mirrored 下 eth0 语义改变、规则指向失效地址（mirrored 方案已被否决）|
| 所有权（**005**）| **声明式** —— 配置里的 `managedPorts` 集合 | 集合外一律不碰，彻底避免 `reset` 误伤；无需额外台账文件 |
| 禁止操作（**005**）| **禁止 `portproxy reset`**（写进验收）| 坑 #1 |
| 默认作用域（**005**）| **loopback**；局域网逐端口 opt-in | 坑 #2（原脚本 0.0.0.0 + 全量放行是真实攻击面）|
| 防火墙（**005**）| 只放行**具体端口**，不做全量 | 同上 |
| 期望集来源 | 实际 `docker ps` 端口映射 ∩ `managedPorts` | 坑 #3（不硬编码端口）|
| 漂移 | 检测 + 一键修复（`connectaddress` 重写；执行在 **005**）| 坑 #4 |
| UDP | **明示不支持** | 坑 #5；portproxy 只支持 TCP |
| 提权（**005**）| `none｜ask｜passby`，**默认 none** | 用户 Step 3 要求；且本机 DSH 进程**非管理员**，必须走 UAC |
| 提权机制（**005**）| 临时 `.ps1` + `Start-Process -Verb RunAs`；输出经**临时文件**回传 | 完整性级别不同，**无法管道回读**子进程输出 |
| 提权失败（**005**）| 拒绝/超时 → **优雅失败，不留半成品规则** | UAC 弹窗程序无法绕过 |
| 跨包服务 | 下一期 `exec` 走**可选注入** 002 的服务 | 不建包依赖边（保 L3）|
| 配置落点 | profile 层 `cordis.patch.yml`；**live 字段经 settings 三写操作**（不重挂载），完整配置才用 `configEditor` | 与 002 同一套**两路**口径，不手写 YAML |
| 交付分期 | P0 = 只读 + 转发 + 漂移 + UAC + **端口声明（区间 + presets）** + **目标发行版（D-4）**；P1 = 启停 + 日志 + **完整配置页**（scope / elevationPolicy）| 用户「六项全选但分期」；**未把后三项悄悄塞进一期**。**2026-10-08 D-3 修订**：端口声明提到 P0 —— 它是 P0 主路径的前置（不声明端口就只能看外部清单、进不了五态）。**2026-10-08 D-4 修订**：`distro` 提到 P0 —— P0 的 eth0 对比与 `docker ps` 执行**都必须知道目标发行版**，且「默认解析不追问」本身是主路径行为 |

---

## 硬规则偏离说明

| 硬规则 | 状态 | 说明 |
|--------|------|------|
| 读 `.lean-spec/templates/requirements-template.md` | ⚠️ **偏离** | 模板库只有 `leanspec init` 生成的 `spec-template.md`；结构按 `leanspec-propose` 技能正文 + 兄弟项目四文件约定 |
| `docs/` 全量扫描 | ⚠️ **N/A** | 本仓库无 `docs/`；requirements.md 第 0 节标注「（空）」并列出替代 SSoT（`stack-decision.md`）|
| UI 需求必须配 Playwright E2E | ✅ **用户明确替代（本轮拍板）** | 替代口径 = vitest 单元 + `node:test` 离线契约 + **chrome-devtools MCP 真机验收**；`leanspec-apply` 的 E2E 预检将不通过，属**显式记录后继续** |
| 原型资产归档 / 视觉对照 | ⚠️ **N/A** | 无原型输入；diff 表以状态语义描述 |
| 复核制两阶段提交 | ⚠️ **N/A（但语义有近亲）** | 本项目无「复核/审批」业务链路。**近亲是 UAC 提权**：同样有「用户同意才落地、拒绝则零副作用」的语义，已按同样标准要求 —— 拒绝/超时 SHALL 不留半成品规则（REQ-7.5）|
| 交互控件登记 | ✅ **适用** | 见 requirements.md §2（容器页 + 端口页 + 配置页）|
| `grep -c "docs/"` ≥ 5 | ⚠️ **偏离** | 无 `docs/` 树可扫；改为以 `stack-decision.md` 的**维度键**标来源精度 |

---

## 必须遵守的安全红线

**五条红线的完整口径（无 `reset` / 不碰集合外 / 不默认局域网 / 不留半成品 / Agent 不得 `passby`）已迁至 [005 的安全对照表](../005-elevation-write-path/design.md)**（2026-10-08 拆分；提权与写操作属 005）。003 侧仍受其约束，但**自己不发任何写命令**：

1. 本 Spec 的 UI **SHALL NOT** 自行拼装 netsh / 防火墙命令 —— 一切写操作**只能**调用 005 的接口。
2. SHALL NOT 把「外部规则」清单渲染成可操作控件（只读，REQ-15.1）。
3. SHALL NOT 打开页面即触发提权（NFR-2 零副作用）。
4. 非 NAT 或提权策略 `none` 时，SHALL NOT 出现可点击的写控件（置灰 + 写明原因）。

---

## 阻塞项与前置

| # | 项 | 状态 |
|---|---|---|
| C-1 | **本机组装前提**：NAT + 非管理员 + 19 条既有规则（真机事实已由 `stack-decision.md` 记录）| ✅ 已知 |
| ~~C-2~~ | ~~6 项 `backend.*` 的 `confirmed: implied` 待主人点头（全线共用）~~ → ✅ **2026-10-08 已确认全为 `none`**（`db = none` 正是「不建规则台账、所有权必须声明式」的根据）| ✅ 已闭环 |
| ~~C-3~~ | ~~本机存在 `~/.dsh/cordis.patch.yml`；若它覆盖本行，配置页写入会被拒（settings 既定行为）~~ | ✅ **2026-10-08 真机枚举推翻该前提**：`~/.dsh/cordis.patch.yml` **不存在**（`~/.dsh` 下只有 `profiles/{web,desktop}/cordis.{yml,patch.yml}`）；且 profile 根注释给出的层序为 bundle 层 → `cordis.patch.yml` → `--patch` 覆盖层，**不含 home 层** → **本项清除** |
| ~~C-4~~ | ~~eth0 漂移的**触发条件**需真机确认~~ | ✅ **2026-10-08 定案（T0.2 真机实测，含反证）**：单发行版 `--terminate`（`PID1` 变而 `btime` 不变）与整台 `--shutdown`（`btime`/`boot_id` 都变）**两次重建后 eth0 都是 `172.20.201.152`**，19 条规则**零漂移**、端到端 4 端口全通 ⇒ **漂移在本机不可复现**。→ 检测**无需常驻守护/心跳**（激活 + 刷新各一次 + **写入前强制现读**足够），修复必然走 UAC →「检测 + 一键修复」**保留为安全网**。⚠️ **同日另一条实测改变了优先级**：发行版会**空闲自终止**（正常行为）⇒「发行版 Stopped / 取不到 eth0」是**主路径**，REQ-6.4 已升级为 P0 显式状态 + 「启动并核验」按钮 |
| **D-3（已定案）** | **分期冲突**：P0 的五态判定需要**已声明**的 `managedPorts`，但声明界面（区间输入 + presets 勾选）原属 **P1 配置页** → P0 只能看外部清单、进不了五态 | ✅ **2026-10-08 主人拍板：端口声明（区间 + presets）提到 P0**。落法：**P0** 交付「端口声明」最小表单（区间输入 + presets 勾选，写 `managedPorts`）+ 外部规则只读清单；**P1** 保留完整配置页（`scope` / `elevationPolicy`；`distro` 见 D-4）。任务见 T5.7（P0）与 T7.3（P1）|
| **D-4（已定案）** | 目标发行版从哪来、要不要每次询问 | ✅ **2026-10-08 主人拍板：四级确定性解析** —— ① 配置值 → ② **WSL 默认 `*`** → ③ **唯一发行版**（只有它就直接认定，**零提问**）→ ④ 首个；**SHALL NOT 阻塞提问**、**SHALL NOT 执行 `wsl --set-default`**（不改用户的 WSL 全局默认）。UI 显示「目标 + **来源**」并可切换；`distro` 字段**提到 P0**。依据：`wsl -l -v` **一次调用**同时给出「哪些在跑（`state`）+ 默认是谁（`*`）」，且实测**不唤醒**发行版。落处：001 REQ-1.7 / 003 REQ-17 / T5.8 |
| **D-2（已定案）** | 本机 19 条**集合外**规则是否在 UI 展示 | ✅ **2026-10-08 主人拍板：显示且只读** → REQ-15（独立只读清单，不进五态、无动作）+ REQ-16（区间声明接管 + 常见服务 presets）|

## 下一步

1. 主人复核，重点：**REQ-15 / REQ-16 的所有权与声明口径（D-2 / D-3）**、**REQ-17 的目标发行版解析（D-4）**、以及 REQ-11 / REQ-12 的 P1 边界。
   写路径的复核点（防火墙放行粒度、Agent 不得 `passby` 提权、卸载不自动清理）**已随内容迁至 [005 的下一步](../005-elevation-write-path/README.md)**（2026-10-08 拆分）。
2. 001 落地后开工 P0；P1 在 P0 真机验收通过后再启。**005 与 003 同包，可并行开工**（005 的 write/elevate 不依赖 003 的 UI）。
   ✅ **2026-10-08 起 003 已 `in-progress`**：Phase 0 完成（真机 fixture 入库 + 两条新结论：`netsh` 是纯 ASCII、唤醒后首次 `docker ps` 会被硬超时砍掉），进 **Phase 1（只读事实层）**。
