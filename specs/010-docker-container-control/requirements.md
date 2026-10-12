# 容器控制（P1）—— 需求

> 从 [`003-wsl-docker-ports` 的 `REQ-11` / `REQ-12`](../003-wsl-docker-ports/requirements.md) 拆出**施工与验收**（2026-10-12）。
> 🔴 **SSoT 声明（先读这条）**：本文件的 `REQ-11` / `REQ-12` 是**指针 + 逐条摘录**；**规范原文的 SSoT 仍在 003**，本 Spec **没有**把 `REQ-11` / `REQ-12` 从 003 移走 ⇒ 两处不一致时**以 003 为准**。
> 原因：003 的 `REQ-11` / `REQ-12` 被 `README.md` 分期表、`REQ-12.2` 的字段分工、`REQ-16.5` 等多处引用，移出必须同批改 003 的三份文档，**超出本轮「只迁 `Phase 7`（`T7.1`–`T7.3`）」的授权** ⇒ 登记为**待主人拍板项**（见 §5）。
> 本地需求用 `REQ-P1-n` 前缀，**不占用** 003 的 `REQ-18+` 段。

---

## 1. 目标

把 docker 容器的**日常操作**（启停 / 重启 / 看日志）与**参数面**（`scope` / `elevationPolicy` 的完整配置页）补齐到 003 的同一个插件包里，**不重做** 003 已交付的只读事实层与五态 diff。

## 2. 需求（`REQ-11` / `REQ-12`：编号沿用 003；逐条摘录，SSoT 在 003）

### REQ-11（P1）容器启停 / 重启 / 日志

- **REQ-11.1** 用户显式点击 SHALL 触发 `docker start/stop/restart <id>` 并刷新状态。
- **REQ-11.2** 日志 SHALL 取 `docker logs --tail <N>`（`N` 有界，默认 200），SHALL NOT 拉取全量。
- **REQ-11.3** 日志内容 SHALL NOT 落盘、SHALL NOT 外传（可能含敏感信息）；仅内存展示。
- **REQ-11.4** GIVEN 操作由 Agent 触发，THEN docker 写操作（start/stop/restart）SHALL 被拒绝（与 005 的 REQ-4.1 同源约束）。

### REQ-12（P1）配置页

- **REQ-12.1** 配置页 SHALL 经 `plugins.row.config` + `configure({ auto: false }, ctx.fiber)` 注册；写入 SHALL 走 **live 路径** `ctx.settings.{update,replace,mutate}`（命名空间 = 本包 patch **条目 id**，schema = 本包**静态 `Config` 导出**）；SHALL NOT 拿 `configEditor.edit()` 写 live 字段（**会重挂载**）；SHALL NOT 手写 YAML。
- **REQ-12.2** 配置字段 SHALL 为 `managedPorts`、逐端口 `scope`、`elevationPolicy`、可选 `distro` 覆盖。**分工（2026-10-08 D-4 修订）**：`managedPorts` 的声明入口已在 **P0**（REQ-16.5）；`distro` 也已在 **P0**（REQ-17）⇒ **本 P1 配置页只补 `scope` / `elevationPolicy`** 与自绘表单，SHALL NOT 把已在 P0 的字段挪回 P1，SHALL NOT 与 P0 的 `distro` 控件互相覆盖（同一字段两处写 = 后写覆盖先写）。
- **REQ-12.3** GIVEN 本行被更高层覆盖（`--patch` 覆盖层；本机不存在 home 层文件），THEN 表单 SHALL 显示只读原因与路径（**自绘**，SHALL NOT 依赖宿主报错）。
- **REQ-12.4** GIVEN 有提权任务在途，THEN 保存 SHALL 先要求确认（编辑可能触发本行重挂载而丢失在途任务）；是否把本行配置标 `.volatile()` SHALL 复用 002 的 B-1 结论，不另做假定。

## 3. 本 Spec 本地需求（`REQ-P1-n`）

- **REQ-P1-1（闸门）** 本 Spec SHALL NOT 在「003 的 P0 真机验收通过」之前改任何 `packages/**` 产品代码；此期间的改动**只允许** `.md`。判据：`git status --porcelain` 里出现 `packages/**` 即违规。
- **REQ-P1-2（容器写动作的通道）** 容器启停 / 重启 SHALL NOT 经 008 的 `/write/plan` / `/write/apply`（那条通道是**系统级转发规则**的写路径，含票据 / 审计 / 401；容器写动作是 WSL 内 docker 调用，两者**不共用**）。判据：本 Spec 的静态扫描里 `/write/` 前缀命中 0。
- **REQ-P1-3（日志隐私）** 日志 SHALL 只在内存里存在；SHALL NOT 进审计、SHALL NOT 进错误文案、SHALL NOT 写文件。判据：静态断言无 `writeFile|appendFile|createWriteStream`，且行为用例断言返回值即全部暴露面。
- **REQ-P1-4（注入点）** 下一期的「进容器 `exec`」只 SHALL 以 `ctx.inject(['managedTerminal'], …)` **可选消费** 002 实现；服务缺失 ⇒ 控件禁用 + 写明原因、回调**不触发、不报错**；SHALL NOT 建包依赖边（否则毁掉 L3 生命周期隔离）。判据：`dependencies` 字段无 `dsh-terminal-profiles` + 单测断言「服务缺失 ⇒ 0 次调用且无异常」。

## 4. 验收门（可二值判定）

| # | 判据 | 方式 |
| --- | --- | --- |
| U1 | 用户来源调用 docker 写命令**恰好 1 次**；agent 来源**被拒且 0 次调用** | `vitest` + fake executor |
| U2 | 日志默认 `--tail 200`；`--tail` 上界有界；**无**落盘调用；日志内容不进审计/错误文案 | `vitest`（静态 + 行为） |
| U3 | 配置页注册键 = 本包 patch 条目 id、`auto:false` 生效；写走 live 路径；在途任务时保存**先确认**且未确认**未写盘** | `vitest` + fake ctx |
| U4 | 本包**无** YAML 手写；`managedPorts` / `distro` 在本 Spec 的配置面**零写入口** | `grep` / 静态扫描 |
| U5 | `typecheck` / `test` / `build` 三绿；单文件 ≤ **400** 行（原始行数） | 命令 exit 0 + `check:size` 口径复算 |

## 5. 待主人拍板项（登记，不在本轮）

- **`REQ-11` / `REQ-12` 要不要从 003 彻底搬来**（连原文一起移，003 留「已迁出」空位，如 `002 → 007`）：
  - 现状 = **不搬**：SSoT 在 003，本文件只有摘录 ⇒ 读的人要跨两篇，但**零连带改动**、不碰 003 的 `requirements.md` / `README.md` / `design.md`。
  - 备选 = **搬**：003 的 `REQ-11` / `REQ-12` 换成一页空位指针，`REQ-16.5` / `REQ-12.2` / README 分期表的引用同批改指向本文件。
  - 集成方**不擅自选**：迁移范围已由本轮授权钉死为「`Phase 7` 的 `T7.1`–`T7.3`」。

## 6. 假设与未验项

- **假设 A-1**：003 交付的只读快照通道（`GET /dsh-wsl-docker-ports/snapshot`）与页面骨架**在 P1 里原样复用**（容器列表已经能读）；若 P1 需要新的路由（如写动作端点），须按 003 的 `ctx.inject(['webServer'])` 口径注册并登记 effect-scoped disposer。
- **假设 A-2**：容器写动作**不需要 UAC**（WSL 内的 docker 调用）；若真机上 `docker start` 需要提权，则要复用 005 的提权链 —— **真机未验**（闸门未达，尚未动手）。
- **未验项 N-1**：本 Spec 的一切判据**均未开始执行**（闸门未达）—— 本文件与 `tasks.md` 的每一条都只有**判据**，没有实测记录。
- **未验项 N-2**：`Phase 7` 的闸门「P0 真机验收」是否该由**主人**书面放行（而不是等 003 清单 7 行逐行走完）—— 未裁定。