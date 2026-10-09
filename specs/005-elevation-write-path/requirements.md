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

> 🔴 **2026-10-09 登记：REQ-1.2 / REQ-1.3 有一处待主人拍板的张力（不改变上面两条的现行文字）**。REQ-1.3 里的「**本插件写入值**」需要**台账**才能判定，而本项目口径是**不建台账**（所有权纯声明式，见 [stack-decision.md](../../stack-decision.md) 的「端口所有权」维度；003 的 `src/diff/types.ts` 亦明写不建台账）⇒ 该子句**不可判定**，实现只能用**规则形态**代理（`connectPort` 不符 **或** `listenAddress ∉ {127.0.0.1, 0.0.0.0}`）。**后果**：一条 `connectAddress` 指向**第三方**地址（如 `192.168.1.50`）的规则会被 003 报成 **`drift`（可修）**，而 REQ-1.2 的删除前置**不授权**动它 ⇒ UI 可能引导一个**写路径必须拒绝**的修复。**两条出路**（集成方**推荐 ①**）：① 按声明式所有权**去掉 REQ-1.2 的 `connectAddress` 前置**（所有权由 `listenPort ∈ managedPorts` 界定 —— 这正是 REQ-1.1 的本意）；② 003 侧为「`connectAddress` 非 eth0 且归属不可判定」另设**只读态**（不进五态、不产生动作）。**拍板前的实现口径**：按 REQ-1.2 现文字**保守实现**（不满足前置 ⇒ 一个动作都不产生），读侧只报告不动手。背景订正见 [003 的 design §3 订正留痕](../003-wsl-docker-ports/design.md)。
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
- **REQ-3.4** 机制：SHALL 写临时 `.ps1`（结构化参数）并按下述**后端链**执行；子进程输出与退出码 SHALL 回传：
  - **后端优先级（2026-10-08 定案，见 A-3）**：① **`gsudo`**（**用户自装**；官方支持 StdOut/StdErr 捕获与退出码，**提权失败 exit code = 999**）→ 输出**直接经 stdio 回传**；② **`Start-Process -Verb RunAs`**（**永久回落，不依赖任何外部工具**）→ 输出经**临时文件**回传（完整性级别不同，无法管道回读）；③ **Windows 自带 `sudo`**（Win11 **24H2+**，须用户在「系统 > 高级」显式开启）→ **仅显式配置 `elevationBackend: winsudo` 时使用**（其默认模式 `forceNewWindow` **起新窗口、拿不到输出**，须为 `normal` / `disableInput` 才有意义 ⇒ 未验证前不进 `auto`）。
  - **SHALL NOT** 替用户安装任何工具（`gsudo` / winget / scoop 一律不碰）、**SHALL NOT** 改 PATH、**SHALL NOT** 执行 `gsudo config CacheMode …`（改的是用户全局配置）或 `sudo config --enable …`（需提权且属系统设置）。
  - GIVEN 检测到 `gsudo` **凭据缓存活跃**（`gsudo status` 的 `Credentials Cache.Available` 为真），THEN SHALL **回落到 ②**，SHALL NOT 调 `gsudo -k`（那是杀用户的缓存会话）—— 缓存活跃 = 免 UAC 提权，会抹掉本 Spec 依赖的系统闸门。
- **REQ-3.5** GIVEN 用户拒绝 UAC / 超时 / 脚本失败，THEN 系统 SHALL 优雅失败：报告原因，SHALL NOT 留下半成品（portproxy 与防火墙要么都成、要么都不成），SHALL 清理全部临时文件。
- **REQ-3.6** 临时 `.ps1` 与输出文件 SHALL 位于用户临时目录、文件名含随机段，且 SHALL 在成功、失败、超时三条路径上都被删除。
- **REQ-3.7** 提权脚本 SHALL 只接受**结构化参数**（动作 / 端口 / 地址 / 作用域），SHALL NOT 接受任意命令文本。

### REQ-4 来源约束（Agent）　← 003 的 REQ-8

- **REQ-4.1** GIVEN 操作由 Agent 触发，THEN `passby` SHALL NOT 静默执行，SHALL **降级为 `ask`**（应用内确认 + 展示将执行的命令原文），确认后才发起 UAC。
- **REQ-4.2** GIVEN 任何需要提权的写操作（无论触发者是 Agent 还是界面、无论 `elevationPolicy` 取何值），THEN 应用内确认 SHALL 展示**变更预览**：逐条列出将新增/删除的规则（作用域 · 监听地址 · 端口 · 连接地址 · 是否伴随防火墙规则）、预计命令条数与影响面；确认后才发起提权。该闸门 **SHALL NOT 依赖操作系统是否弹窗**。
- **REQ-4.3** GIVEN 一次提权写操作（含被拒绝 / 超时 / 失败 / 回滚），THEN SHALL 落一条**审计记录**：时间 · 触发来源（agent / user）· `elevationPolicy` · 实际后端（gsudo / native / winsudo）· 端口与作用域 · 结果与退出码 · 耗时 · 是否回滚。记录 SHALL 位于 profile 日志且人类可读，且 SHALL NOT 包含任何凭据 / 口令。
> 🔴 **2026-10-09 真机事实 + 主人拍板（A+B）**：本机 `ConsentPromptBehaviorAdmin = 0`（Elevate without prompting）⇒ **提权根本不弹 UAC**、`consent.exe` 零次出现；实测 Agent **零人工交互**即完成 `netsh` 写入与删除（3261 ms / 3028 ms）⇒ REQ-4.1 依赖的「UAC = 人类闸门」在本机**不成立**（仅在 `ConsentPromptBehaviorAdmin != 0` 的机器上成立）。故把闸门**收回产品内**：**A（强制）** = REQ-4.2 的显式确认 + 变更预览（与 OS 行为解耦）；**B（强制）** = REQ-4.3 的审计留痕；**C（附带）** = UI 与用户手册明说「本机提权可能不会请你确认」。`elevationPolicy` 语义与「Agent 触发降级 `ask`」**均不变**。
  > **✅ 已确认（A-1，迁自 003 的 A-5；2026-10-08 主人定案 = 方案 A「降级为 `ask`」）**：备选是「直接拒绝」（Agent 完全不能触发提权）。选 A 的理由：保住「Agent 帮你发起、你只需点一次确认」的可用性，同时保证**每次都有一次人类显式点击**；与「默认 `none`」「`passby` 不静默执行」的保守取向一致。
  > ⚠️ **与后端的耦合（重要）**：方案 A 的闸门是**应用内确认**，而 UAC 能否每次都弹取决于后端 —— 若用户开了 `gsudo` 凭据缓存，UAC 那道闸门消失，此时**唯一**的闸门就是本 REQ 的应用内确认（这正是 REQ-3.4 要求「缓存活跃即回落 native」的原因）。
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
- **NFR-2** 提权临时文件 SHALL 在成功 / 失败 / 超时三条路径上都被删除（各有断言）。`gsudo` 后端不需要临时**输出**文件，但临时 `.ps1` 仍须删除 —— 三条清理路径对两种后端都要过。
- **NFR-3** 内网/离线可用：SHALL NOT 依赖 CDN、SHALL NOT 运行 `npx`。
- **NFR-4** `typecheck` + `vitest` + `build` 三项 SHALL 全绿；单文件 ≤ 400 行、单 Spec 文档 ≤ 200 行。

---

## 4. 约束与假设

| # | 内容 | 影响 |
|---|------|------|
| C-1 | 依赖 001（NAT 判定 / eth0 / argv 执行）；依赖 **003** 的只读事实（实际集与期望集）；**不** import 002 | REQ-1.4 / REQ-3.7 的基础 |
| C-2 | 本机 DSH 进程**非管理员** → 一切 netsh / 防火墙写操作必须走 UAC | REQ-3 的存在理由 |
| C-3 | 本机既有 **19 条** portproxy 是用户真实数据 | 所有写操作验收的比对对象：**他人规则条数必须不变** |
| A-1（**✅ 已确认**）| Agent 触发的提权在 `passby` 下**降级为 `ask`** | REQ-4.1；**2026-10-08 主人定案 = 方案 A**（备选「直接拒绝」被否）|
| A-2（**✅ 已确认**）| 卸载**不**自动清理规则，改提供清单 + 显式清理 | REQ-5.1；**2026-10-08 主人确认**，本 Spec 口径零改动 |
| A-3（**新·假设**）| 提权后端链 = `gsudo → native`（`auto`）；Windows 自带 `sudo` 只在显式配置时用 | 依据：微软官方文档（**24H2+**、默认关闭、默认 `forceNewWindow` **拿不到输出**、改模式须提权命令行）；**本机 23H2 无法验证** ⇒ 不进 `auto`。影响：24H2 且未装 gsudo 时回落 native（**功能无损**，只多一个临时文件）<br>🔵 **2026-10-09 本机只读核验**：`%SystemRoot%\System32\sudo.exe` **不存在**（23H2 预期吻合）；`Get-Command sudo -All` **唯一命中 gsudo 的 shim**（`D:\Program Files\gsudo\Current\sudo.exe`，ProductName=gsudo 2.6.1）⇒ 佐证 REQ-3.4 的「探测不得按命令名 `sudo`」（否则必然误判进 winsudo 分支）。`gsudo` 本机可用且 v2.6.1 与 2026-10-08 记录一致 |
