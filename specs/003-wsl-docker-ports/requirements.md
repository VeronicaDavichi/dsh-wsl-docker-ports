# 功能需求：dsh-wsl-docker-ports Docker 管理器与端口转发

> 需求驱动（**requirements-first**）：先定 REQ 与 EARS，[design.md](./design.md) 从需求派生。任务见 [tasks.md](./tasks.md)。

---

## 0. 项目文档摘要（docs/ 全量扫描）

本仓库**没有 `docs/` 目录**，全部子目录为空。**替代 SSoT = `stack-decision.md`**，按维度键登记来源精度：

| 维度键 / 章节 | 内容要点 | 本 Spec 使用方式 |
|---|---|---|
| `plugin.dockerScope` | P0 只读+转发+漂移+UAC；P1 启停+日志；exec/compose/镜像下一期 | REQ-11 / REQ-12 / REQ-10 的分期边界 |
| `plugin.natPrerequisite` | **NAT 硬前提**；非 NAT → 置灰 + 原因 + 修复步骤；mirrored 方案被否决 | REQ-1 |
| `plugin.portOwnership` | 声明式 `managedPorts` 界定所有权；集合外一律不碰 | REQ-3.1 / REQ-4 |
| `plugin.portScope` | 本机 + 局域网**可切**；默认 loopback；原脚本 0.0.0.0 + 全量放行是攻击面 | REQ-5 |
| `plugin.elevationPolicy` | `none｜ask｜passby` 默认 `none`；UAC 不可绕过；失败须优雅 | REQ-7 |
| `plugin.crossPackageService` | 下一期 exec 走**可选注入** 002 的服务 + 降级置灰 | REQ-10 |
| 「真机事实」表 | WSL 2.7.3.0；eth0 `172.20.201.152`；既有 **19 条** portproxy；DSH 进程**非管理员**；docker server **29.5.3** | REQ-2 / REQ-6 / REQ-7 的真机基线 |
| 「原脚本 5 个坑」表 | reset 误伤 / 0.0.0.0 暴露 / 硬编码端口 / IP 漂移 / UDP 不支持 | REQ-4.4 / REQ-5 / REQ-3.1 / REQ-6 / REQ-9 |
| 冲突自检表 | 路由前缀独占、配置校验容错、UAC 不可绕过、portproxy 不支持 UDP | REQ-7 / REQ-9 |

---

## 1. 概述

见 [README.md](./README.md)。一句话：**把 `docker ps` 的真实端口映射与 `netsh portproxy` 的真实规则做 diff，只维护自己声明的那部分规则，默认不对局域网开放。**

---

## 2. 交互控件清单

| 控件 | data-testid | 触发行为 | 副作用（可观察）|
|------|-------------|---------|----------------|
| 刷新 | `btn-refresh` | 重拉 `docker ps` + `netsh show v4tov4` + eth0 | 两张表与「上次刷新」时间戳更新 |
| 容器表 | `tbl-containers` | 只读 | 展示 id/name/image/state/status |
| 端口表 | `tbl-ports` | 只读 | 每行带五态标签（ok/missing/drift/conflict/extra）|
| 作用域切换 | `sel-scope-<port>` | `loopback` ↔ `lan` | lan → 出现 portproxy 规则 + 该端口防火墙规则（需提权）；loopback → 两者移除 |
| 应用转发 | `btn-apply-<port>` | 添加缺失规则 | 提权 → 规则出现在 `netsh` 输出中，状态转 `ok` |
| 移除转发 | `btn-remove-<port>` | 删除**自己那条**规则 | 提权 → 该规则消失；他人规则条数不变 |
| 修复漂移 | `btn-fix-drift-<port>` | 把 `connectaddress` 重写为当前 eth0 | 提权 → 状态转 `ok` |
| 查看原始输出 | `btn-raw-output` | 展开 netsh / docker 原文 | 面板展开（脱敏）|
| 提权策略 | `sel-elevation` | `none` / `ask` / `passby` | 写配置；`none` 时全部写控件置灰 + 原因 |
| NAT 修复指引 | `btn-nat-guide` | 展开修复步骤 | 显示 `.wslconfig` 路径 + 命令文本（可复制）；**不**自动改文件 |
| UDP 提示 | `tip-udp` | 无交互 | 常驻说明「UDP 映射不支持转发」|
| 容器启停重启（P1）| `btn-cs-start` / `btn-cs-stop` / `btn-cs-restart` | `docker start/stop/restart` | 容器状态列变化 |
| 容器日志（P1）| `btn-cs-logs` | `docker logs --tail 200` | 日志面板出现内容 |
| 进容器 exec（下一期）| `btn-cs-exec` | 无（禁用）| 显示「下一期」原因；服务缺失也不报错 |

---

## 3. 功能需求

### REQ-1 NAT 硬前提与前置检查

- **REQ-1.1** GIVEN 001 判定 `networkingMode` 为非 NAT（`mirrored` / `other`）或**读取失败**，THEN 系统 SHALL 置灰全部转发写控件、显示原因与修复步骤，SHALL NOT 写入任何 portproxy 规则。
- **REQ-1.2** GIVEN 判定为 NAT，THEN 转发功能 SHALL 可用。
- **REQ-1.3** 系统 SHALL 在刷新时检查 docker 可用性与 IP Helper（`iphlpsvc`）状态；缺失 SHALL 以可区分的原因展示，SHALL NOT 用空列表冒充「没有容器」。
- **REQ-1.4** 修复指引 SHALL 含**具体文件路径与可复制命令文本**；系统 SHALL NOT 自动修改 `.wslconfig`（001 只读，且改网络模式会重启 WSL）。

### REQ-2 docker 只读展示

- **REQ-2.1** GIVEN docker 可用，WHEN 刷新，THEN 系统 SHALL 经 `wsl.exe -d <distro> -- docker ps --format '{{json .}}'` 获取容器列表；`<distro>` SHALL 由 **001 的 REQ-1.7** 解析（**不追问用户**，见 REQ-17）；该调用 SHALL 带**硬超时**（错形式 `--format json` **会挂住而非报错**，真机见 T0.2）。
- **REQ-2.2** 端口映射 SHALL 解析为 `{ hostIp, hostPort, containerPort, protocol }`，覆盖 `0.0.0.0:8080->80/tcp` 与 `[::]:8080->80/tcp` 两种形态。
- **REQ-2.3** GIVEN docker 未安装 / daemon 未运行 / 权限不足，THEN 系统 SHALL 分别给出可区分的原因与引导。
- **REQ-2.4** P0 阶段展示 SHALL 只读：SHALL NOT 对 docker 发起任何写命令（启停属 P1 / REQ-11）。
- **REQ-2.5**（**2026-10-08 T0.2 定案，取代原「先试再回落」写法**）系统 SHALL **直接**使用 `--format '{{json .}}'`；SHALL NOT 探测 `--format json` —— 真机实测它**会挂住**（rc=124，8s 与 15s 各一次，且守护进程已热），「先试再回落」只会让用户白等一个完整超时。每次 docker 调用 SHALL 有硬超时（001 的 REQ-5.3）。

### REQ-3 期望集与实际集

- **REQ-3.1** 期望集 SHALL = **docker 实际端口映射 ∩ `managedPorts`**；SHALL NOT 硬编码任何端口清单。
- **REQ-3.2** 实际集 SHALL 来自解析 `netsh interface portproxy show v4tov4`，至少取 `listenAddress` / `listenPort` / `connectAddress` / `connectPort`。
- **REQ-3.3** 每个期望端口 SHALL 被归入 `ok` / `missing` / `drift` / `conflict` / `extra` **恰好一个**状态（不重复计数）。
- **REQ-3.4** 归类 SHALL 只依据三条事实：① `listenPort` 是否 ∈ `managedPorts`；② `connectAddress` 是否等于当前 eth0 IPv4；③ 该端口上是否存在与本插件声明不符的既有规则。SHALL NOT 靠时间戳、条目顺序或名称相似度猜测。
- **REQ-3.5** GIVEN 解析失败（输出形态不可识别），THEN 系统 SHALL 报错并展示脱敏后的原始输出，SHALL NOT 猜结果。

### REQ-4（已迁出）

声明式所有权与安全红线**已迁至 [005-elevation-write-path](../005-elevation-write-path/requirements.md)** 的 REQ-1（2026-10-08 拆分；内容逐条保留）。**编号 4 保留为空位**，以免既有引用错位。003 侧与此相关的唯一约束是：集合外端口**不进五态、不可操作**（只读清单见 REQ-15）。

### REQ-5（已迁出）

作用域（loopback / 局域网）与防火墙最小放行**已迁至 [005](../005-elevation-write-path/requirements.md)** 的 REQ-2。**编号 5 保留为空位**。003 侧仍负责 `scope` 的**配置字段与表单**（REQ-12.2 / REQ-16），但「怎么写成规则」由 005 定义。

### REQ-6 eth0 IP 漂移

- **REQ-6.1** 系统 SHALL 逐条对比规则 `connectAddress` 与当前 eth0 IPv4。
- **REQ-6.2** 不一致 → `drift`；UI SHALL 高亮并显示「旧 → 新」两个地址。
- **REQ-6.3** 一键修复 SHALL 删除旧规则并添加新规则（需提权，机制见 **005 的 REQ-3**）；GIVEN 中途失败，THEN 系统 SHALL 明确报告哪些未改，SHALL NOT 静默留半截。
- **REQ-6.4**（**2026-10-08 升级为 P0 显式状态**）GIVEN 取不到 eth0（发行版 Stopped / 无 eth0），THEN 系统 SHALL 显示「**WSL 未运行**」的**显式状态**（不是静默降级），SHALL NOT 把全部规则误标为 `drift`；且 SHALL 提供**「启动并核验」按钮** —— 这是**唯一**允许启动发行版的路径（用户显式动作，例外见 001 REQ-2.4），点击前 SHALL 明示代价（约 **10–12 秒**、会拉起 WSL 内服务）。**实测依据**：发行版会**空闲自终止**（正常行为，非异常）⇒ 本状态是**主路径**而非边缘情况，UI 打开时点刷新大概率就撞上。

### REQ-7（已迁出）

UAC 提权（`none` / `ask` / `passby`、临时 `.ps1`、退出码与失败语义）**已迁至 [005](../005-elevation-write-path/requirements.md)** 的 REQ-3。**编号 7 保留为空位**。003 侧的提权相关动作（一键修复、apply/remove、显式清理）一律**调用 005 的实现**，不在本 Spec 定义机制。

### REQ-8（已迁出）

来源约束（Agent 不得走 `passby` 静默提权）**已迁至 [005](../005-elevation-write-path/requirements.md)** 的 REQ-4。**编号 8 保留为空位**。

### REQ-9 UDP 明示

- **REQ-9.1** UI SHALL 常驻明示「portproxy 不支持 UDP，容器 UDP 端口映射无法转发」（坑 #5）。
- **REQ-9.2** GIVEN 容器存在 UDP 映射，THEN 表格 SHALL 标出「不支持」状态，SHALL NOT 直接忽略该映射。
- **REQ-9.3** 系统 SHALL NOT 尝试用其他机制（`v6tov6`、第三方转发工具）代偿 UDP。

### REQ-10 下一期注入点（exec）

- **REQ-10.1** 「进容器 exec」控件 SHALL 存在且**默认禁用**，附「下一期」说明。
- **REQ-10.2** 依赖方向：本包 SHALL NOT import 002 的包；只可按字符串键**可选注入** `managedTerminal` 服务（不建包依赖边，保 L3）。
- **REQ-10.3** GIVEN 002 未加载（服务不存在），THEN 本包 SHALL NOT 报错、SHALL NOT 触发回调，SHALL 保持控件置灰并写明原因。
- **REQ-10.4** 本期 SHALL NOT 实现 exec 逻辑（本 Spec 只落注入点与降级语义）。

### REQ-11（P1）容器启停 / 重启 / 日志

- **REQ-11.1** 用户显式点击 SHALL 触发 `docker start/stop/restart <id>` 并刷新状态。
- **REQ-11.2** 日志 SHALL 取 `docker logs --tail <N>`（`N` 有界，默认 200），SHALL NOT 拉取全量。
- **REQ-11.3** 日志内容 SHALL NOT 落盘、SHALL NOT 外传（可能含敏感信息）；仅内存展示。
- **REQ-11.4** GIVEN 操作由 Agent 触发，THEN docker 写操作（start/stop/restart）SHALL 被拒绝（与 **005 的 REQ-4.1** 同源约束）。

### REQ-12（P1）配置页

- **REQ-12.1** 配置页 SHALL 经 `plugins.row.config` + `configure({ auto: false }, ctx.fiber)` 注册；写入 SHALL 走 **live 路径** `ctx.settings.{update,replace,mutate}`（命名空间 = 本包 patch **条目 id**，schema = 本包**静态 `Config` 导出**）；SHALL NOT 拿 `configEditor.edit()` 写 live 字段（**完整配置**路径，官方原文 `ordinary fields retain Loader's normal lifecycle` ⇒ **会重挂载**）；SHALL NOT 手写 YAML（与 002 同一套口径 —— **两服务互补非管道**，2026-10-08 源码实证）。
- **REQ-12.2** 配置字段 SHALL 为 `managedPorts`、逐端口 `scope`、`elevationPolicy`、可选 `distro` 覆盖。**分工（2026-10-08 D-4 修订）**：`managedPorts` 的声明入口已在 **P0**（REQ-16.5）；**`distro` 也已在 P0**（REQ-17：解析 + 显示 + 切换）；本 P1 配置页只补 `scope` / `elevationPolicy` 与自绘表单，SHALL NOT 把已在 P0 的字段挪回 P1，SHALL NOT 与 P0 的 `distro` 控件互相覆盖（同一字段两处写 = 后写覆盖先写）。
- **REQ-12.3** GIVEN 本行被更高层覆盖（`--patch` 覆盖层；**本机不存在 home 层文件**），THEN 表单 SHALL 显示只读原因与路径。**源码实证**：configEditor 对 *"higher-layer overrides"* 的行为是 *leave the file unchanged*（**静默不写**、不抛错）；`ctx.settings.writable` 字段**存在**（由 settings provider 透传，**rc.2 是否恒为 `true` 待复核**）→ 只读态与原因**必须由本行自绘**，SHALL NOT 依赖宿主报错。
- **REQ-12.4** GIVEN 有提权任务在途，THEN 保存 SHALL 先要求确认（编辑可能触发本行重挂载而丢失在途任务）；是否把本行配置标 `.volatile()` SHALL 复用 002 的 B-1 结论，不另做假定。

### REQ-14 安装与接入（D-1）

- **REQ-14.1** 本包 SHALL 以 `link:<绝对路径>` 加入目标 profile `package.json` 的 `dependencies`，包名 SHALL 加入 `dsh.profile.bundles`；安装为交付文档中的一次性显式步骤，**运行时 SHALL NOT 改写 profile 清单**。
- **REQ-14.2** GIVEN 首次激活（本机既有 **19 条**规则、而 `managedPorts` 默认为空），THEN 系统 SHALL NOT 自动接管、SHALL NOT 修改、SHALL NOT 删除这 19 条，且 SHALL 在「外部规则」只读清单中列出它们（REQ-15.1）；用户须先**显式声明端口**（REQ-16）才会进入五态。**2026-10-08 定案（D-2）**：原「完全不显示」的写法已废止 —— 主人拍板为**显示且只读**；「集合外零参与」的完整口径在 **005 的 REQ-1.1**。
- **REQ-14.3** 卸载 SHALL 注销路由与页类型、清理临时文件，且 SHALL NOT 自动删除任何规则（**005 的 REQ-5.1**）。

### REQ-13（已迁出）

卸载与清理语义**已迁至 [005](../005-elevation-write-path/requirements.md)** 的 REQ-5（2026-10-08 拆分；内容逐条保留）。**编号 13 保留为空位**。003 侧只保留「卸载 SHALL 注销路由与页类型、清理临时文件」（REQ-14.3）。

### REQ-15 外部规则只读清单（D-2）

- **REQ-15.1** 系统 SHALL 在**独立区域**列出「既不在 `managedPorts`、也非本插件写入」的既有规则并标注「外部规则」；SHALL NOT 与五态混排、SHALL NOT 计入任何状态计数、SHALL NOT 提供动作（纯只读）；每行 SHALL 展示 `listenAddress:listenPort → connectAddress:connectPort` 与判定依据，清单为空时 SHALL NOT 渲染该区域；本机 19 条既有规则 SHALL 在首启即落此清单（真机验收点，配合 REQ-14.2）。

### REQ-16 接管声明：端口区间与常见服务 presets（D-2）

- **REQ-16.1** `managedPorts` SHALL 同时接受单端口与**闭区间**（如 `"1000-3000"`）并可混写；非法或倒置区间 SHALL 被拒并给出原因（含所在项）。
- **REQ-16.2** 期望集计算（REQ-3.1）SHALL 支持区间；SHALL NOT 无界枚举区间成员（先与 docker 实际映射求交）。
- **REQ-16.3** 接管 SHALL 只由用户**显式配置**驱动，SHALL NOT 由外部规则清单上的点击触发（REQ-15.1 只读约束）；GIVEN 区间与某条外部规则重叠，THEN 该端口 SHALL 从清单移入五态，SHALL NOT 两处同时出现。
- **REQ-16.4** 配置页 SHALL 提供常见服务端口**快速勾选**，结果直接写入 `managedPorts`（不另建存储）；勾选 SHALL NOT 触发写操作或提权；区间与 presets SHALL 声明同一组端口语义。首批 presets SHALL 含 **13 项**：MySQL `3306` · Oracle `1521` · Spring Boot `8080` · PostgreSQL `5432` · Redis `6379` · MongoDB `27017` · RabbitMQ `5672` · Kafka `9092` · Elasticsearch `9200` · Nacos `8848` · MinIO `9000` · Vite `5173` · Flask `5000`（末两项为框架默认端口）—— **不含** SQL Server `1433`（主人未选）；清单 SHALL 可配置扩展，SHALL NOT 硬编码进逻辑分支。
- **REQ-16.5**（**D-3**）端口声明（**区间输入 + presets 勾选**）SHALL 在 **P0** 交付（最小表单，只负责写 `managedPorts`），SHALL NOT 等 P1 的完整配置页；P1 只补 `scope` / `elevationPolicy`（**`distro` 按 D-4 已在 P0**，见 REQ-17）。

### REQ-17 目标发行版：解析、显示与切换（P0，D-4）

- **REQ-17.1** 目标发行版 SHALL 由 **001 的 REQ-1.7** 解析（① 配置 → ② **WSL 默认 `*`** → ③ **唯一发行版** → ④ 首个）。系统 SHALL NOT 为「用哪个发行版」阻塞提问；**只有一个发行版时 SHALL 直接认定它**（零配置、零提问）。
- **REQ-17.2** UI SHALL 显示当前目标发行版**及其来源**（`配置` / `WSL 默认` / `唯一发行版` / `首个`），并 SHALL 提供**切换控件**（列出全部发行版及各自 `state`）；切换 SHALL 写入 `distro`（live 路径 `ctx.settings.update`，**不重挂载**）并在**下次读取**生效；SHALL NOT 在刷新路径上弹模态询问。
- **REQ-17.3** 解析与状态展示 SHALL **只读 `wsl -l -v`**（实测**不唤醒**发行版）；SHALL NOT 为「判断发行版在不在跑」而执行 `wsl -d`（自动路径绝不冷启动）；该调用**自身也要超时**（实测首次 **8.6s**）且 SHALL NOT 同步阻塞界面。
- **REQ-17.4** GIVEN 配置的 `distro` 已不存在（被卸载/改名），THEN 系统 SHALL 报 `DistroNotFound`、**回落**按 REQ-17.1 重新解析，并在 UI 明示「配置的发行版已不存在」；SHALL NOT 静默沿用失效值。

---

## 4. 非功能需求

- **NFR-2** 打开页面 SHALL 零副作用：只读路径 SHALL NOT 触发任何写操作或提权。
- **NFR-1 / NFR-3（已迁出）**：写操作可追溯（四项齐全）与提权临时文件三路径删除，**已迁至 [005](../005-elevation-write-path/requirements.md)** 的 NFR-1 / NFR-2。**编号 1 与 3 保留为空位**。
- **NFR-4** 内网/离线可用：SHALL NOT 依赖 CDN、SHALL NOT 运行 `npx`。
- **NFR-5** `typecheck` + `vitest` + `build` 三项 SHALL 全绿。
- **NFR-6** 单文件 ≤ 400 行、单 Spec 文档 ≤ 200 行（`leanspec` 校验门 warn 200 / max 400）。
- **NFR-7** UI 零硬编码 hex（只用宿主 `--dsw-*` token）。

---

## 5. 约束与假设

| # | 内容 | 影响 |
|---|------|------|
| C-1 | 依赖 001；**不** import 002 | REQ-10.2 的依据 |
| C-2 | 本机 DSH 进程**非管理员** → 一切 netsh / 防火墙写操作必须走 UAC | **005 的 REQ-3** 的存在理由（本 Spec 不定义提权机制）|
| ~~C-3~~ | ~~本机存在 `~/.dsh/cordis.patch.yml`，可能覆盖本行导致配置页只读~~ → ✅ **2026-10-08 真机枚举：该文件不存在，前提推翻，本项清除** | ~~REQ-12.3~~ → REQ-12.3 保留为防御性只读态（自绘）|
| C-4 | 本机既有 **19 条** portproxy 是用户真实数据 | 所有写操作的真机验收对象：**他人规则条数必须不变** |
| A-1（**2026-10-08 已证否并定案**）| `docker ps --format json` 在 server 29.5.3 可用 | **不成立**：实测该选项**会挂住**（rc=124，8s 与 15s 各一次，守护进程已热）⇒ 系统**直接**使用 `--format '{{json .}}'`，**不做**探测式回落（REQ-2.5）；每次 docker 调用 SHALL 带硬超时 |
| A-2（**假设**）| `netsh` 输出为 OEM 代码页（zh-CN 下 GBK）| C 负责指定 `encoding`（001 的 exec 支持）；T0.1 捕获 fixture |
| A-3（**已确认 → 2026-10-08 实测反证**）| 原假设：eth0 在 **WSL 实例重建**后可能变 | 主人 2026-10-08 确认「`--terminate` 会变」→ **T0.2 实测不支持**：单发行版 `--terminate` 与整台 `--shutdown` **两次重建后 eth0 都是同一地址**（`172.20.201.152`），19 条规则**零漂移**、端到端 4 个端口**全通** ⇒ 漂移在本机**不可复现**。**处理**：REQ-6 作为**安全网保留**（判决逻辑本就随五态一起做，边际成本≈0），但**不**做心跳/守护/持久化；检测时机 = 激活 + 刷新 + **写入前强制现读**。⚠️ 反面同样登记：本机不可复现 **≠** 其他机器/版本不会（DHCP 语义非契约），故不删该需求 |
| A-4（**假设**）| portproxy 依赖 IP Helper（`iphlpsvc`）服务 | 服务未运行时 `netsh add` 会失败 → REQ-1.3 前置检查 |
| A-5 / A-6（**已迁出**）| Agent 触发提权降级为 `ask`（备选直接拒绝）；卸载不自动清理规则 | **已迁至 [005](../005-elevation-write-path/requirements.md)** 的 A-1 / A-2（内容不变）；**编号 5 / 6 保留为空位** |
| A-7（**已确认**）| 内网有 npm registry / 私有镜像 | 依赖可安装并打进 bundle |
