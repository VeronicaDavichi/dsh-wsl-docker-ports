---
status: complete
created: 2026-10-12
priority: medium
tags:
- dsh-plugin
- wsl
- docker
- portproxy
- containers
- ui
depends_on:
- 003-wsl-docker-ports
created_at: 2026-10-12T07:50:06.862400200Z
updated_at: 2026-10-21T03:21:56.819999100Z
completed_at: 2026-10-21T03:21:56.819999100Z
transitions:
- status: in-progress
  at: 2026-10-21T03:04:33.353379Z
- status: complete
  at: 2026-10-21T03:21:56.819999100Z
---
# 容器控制（P1）：容器启停 / 重启 · 容器日志 · 完整配置页

**类型**: 需求驱动（requirements-first）
**状态**: planned（**2026-10-12 从 [`003-wsl-docker-ports`](../003-wsl-docker-ports/README.md) 的 `Phase 7` 拆出**）；🔴 **闸门 = 「P0 真机验收通过后再启」** —— 闸门**未达** ⇒ 本 Spec 现在**不发任何产品代码**（本轮只落文档与验收边界）
**优先级**: medium（与母 Spec 同档；P1 是「P0 验收通过后」的下一阶段，不是并行支线）
**包名**: `dsh-wsl-docker-ports`（与 003 / 005 / 008 / 009 **同一个包**；本 Spec 只占「容器控制的 P1 面」）
**位置（预期，未落地）**: `packages/wsl-docker-ports/` —— 容器写动作与日志读取（宿主侧）· 完整配置页（客户端）· 下一期 `exec` 的注入点
**依赖**: [003-wsl-docker-ports](../003-wsl-docker-ports/README.md)（`depends_on`，**建 Spec 时由 CLI 写入** —— 事后无工具路径）；复用 003 的 `PORTS_SERVICE` / 只读快照通道 / 页面骨架 / `read/` 事实层，**不重复造**

## 1. 为什么单独成篇（拆分留痕）

- **主因 = 闸门**：003 的 `Phase 7` 自己写着「**P0 真机验收通过后再启**」，而 003 已进入收口（P0 离线判据全绿；真机侧只结清了「安装/卸载二值」与「提权链路」两条）⇒ P1 留在 003 会让 003 的「未勾项 = 0」**永远不成立**，也会把**已验收完的 P0** 与**未开工的 P1**混在同一张任务表里。
- **同款先例**：004 / 005 / 006 / 007 / 009 都是从母 Spec 拆出、**同包不拆包**。003 侧按 `002 → 004 / 007`、`001 → 006`、`008 → 009` 的写法留「已迁出」**空位**，**编号与 Phase 号一律保持**（`Phase 7` / `T7.1` / `T7.2` / `T7.3`），以免既有引用错位。
- **名字**：`010-docker-container-control` —— 沿用母 Spec 的领域词（docker / 容器控制），**不写阶段标记**（阶段是**闸门**、不是身份）。⚠️ 如实说明：本 Spec 的范围除容器控制外还含**容器日志**与**完整配置页（`scope` / `elevationPolicy`）**，名字略窄，取「控制」为统称（配置页是控制的参数面）。
- 🔴 `depends_on` **只在建 Spec 时写得进去**（`leanspec create --depends-on 003-wsl-docker-ports`）；事后**无工具路径**（`link` / `rel` 未迁移、`update` 无该选项、MCP `update_spec` 无该字段）。

## 2. 🔴 闸门（准入 / 准出）

| # | 闸门 | 判据（可二值判定） | 当前 |
| --- | --- | --- | --- |
| G-1 | **P0 真机验收通过** | 003 的「真机验收清单」7 行逐行有 PASS 记录（截图 / 路由响应 / 快照比对），**或**主人明确书面放行 | ❌ **未达**（003 只结清了安装/卸载与提权链路两条真机项；清单 7 行未逐行走） |
| G-2 | **准入前只许动文档** | 闸门未达时本 Spec 的改动**只允许** `.md`；出现任何 `packages/**` 改动 ⇒ 违规 | ✅ 本轮（2026-10-12）**零代码** |

**准出（P1 收口）**：`T7.1`–`T7.3` 全部 `[x]` 且有实测证据；`typecheck` / `test` / `build` 三绿；单文件 ≤ 400 行；真机清单（下面的 V 表）逐行走过。

## 3. 范围

### 3.1 做（P1）

- **容器启停 / 重启**：用户显式点击触发 `docker start|stop|restart <id>` 并刷新状态；**Agent 来源一律拒绝**（与 005 的来源约束同源）
- **容器日志**：`docker logs --tail <N>`（`N` 有界，默认 **200**）；**SHALL NOT** 拉全量 · **SHALL NOT** 落盘/外传（可能含敏感信息），仅内存展示
- **完整配置页**：`plugins.row.config` + `configure({ auto: false })`，**只补** `scope` / `elevationPolicy` 两个字段（写经 settings 三写操作 = live 路径，**不用** `configEditor.edit()`）

### 3.2 明示不做

- **P0 只读面**（003 已交付：docker 只读展示 / 五态 diff / 外部规则只读清单 / 端口声明 / `distro` 控件）—— 本 Spec **不重做、不改写**
- **`/write/plan` · `/write/apply` 相关**（008 的写通道与 009 的写入口 UI）：本 Spec 的**容器写动作不经它们**；008/009 的服务端票据/审计/401 口径与本 Spec **无交集**
- **已在 P0 的字段不许挪回 P1**：`managedPorts` 在 P0 的 `T5.7`、`distro` 在 P0 的 `T5.8` ⇒ 同一个字段**只允许一个写入口**（两处写 = 后写覆盖先写）
- **不承接 003 的 `check:exports` 扩包建议**（把导出预算门扩到两个插件包）：那是 **001 的口径变更**（`REQ-6.4` 是唯一 SSoT），**留在 003 的 `T6.7` 登记行**，**不随 Phase 7 迁来**（理由：口径变更与 P1 功能交付是两件事，混在一篇会污染验收边界）
- **下一期不做**（只留注入点）：容器 `exec` · `compose up|down` · 镜像管理

### 3.3 下一期注入点（本 Spec 只登记，不实现）

- `exec`：经 `ctx.inject(['managedTerminal'], …)` **可选消费** 002 的服务；服务缺失 ⇒ 控件**禁用 + 写明原因**、回调**永不触发、不报错**；**不建包依赖边**（建了就毁掉 L3 生命周期隔离）

## 4. 与 003 的边界（哪些字仍留在 003）

- 🔴 **需求原文的 SSoT 仍在 003**：[003 requirements.md](../003-wsl-docker-ports/requirements.md) 的 `REQ-11`（容器启停 / 日志）与 `REQ-12`（配置页）**没有搬家**；本轮只移**施工与验收**（`T7.1`–`T7.3`）。本 Spec 的 [requirements.md](./requirements.md) 是**指针 + 逐条摘录**；若两处不一致 ⇒ **以 003 为准**。
- **为什么不像 `002 → 007` 那样连 REQ 一起移**：003 的 `REQ-11` / `REQ-12` 被 `README.md` 的分期表、`REQ-12.2` 的字段分工、`REQ-16.5` 等多处引用 ⇒ 移出必须同批改 003 的 `requirements.md` / `README.md` / `design.md` **三份**，**超出本轮「只迁 Phase 7」的授权** ⇒ 登记为**待主人拍板项**（登记结论：现状「REQ 留在 003、T7 迁到 010」是**可用**的，只是读的人要跨两篇）。

## 5. 文档导航

| 文档 | 内容 |
|------|------|
| [requirements.md](./requirements.md) | `REQ-11` / `REQ-12` 的**指针 + 逐条摘录**（SSoT 在 003）+ 本 Spec 本地需求 `REQ-P1-1`–`REQ-P1-4` + 验收门 |
| [design.md](./design.md) | 分层与预期文件、状态流、契约（复用 003 的通道）、安全、测试策略、决策权衡、下一期注入点 |
| [tasks.md](./tasks.md) | `Phase 0` 闸门 + **自 003 逐字迁入的 `T7.1`–`T7.3`**（编号保持）+ 真机清单 + 未验项 |
| [003-wsl-docker-ports](../003-wsl-docker-ports/README.md) | 母 Spec：P0 只读面 / 五态 diff / 端口声明 / `distro`；**`Phase 7` 原地留「已迁出」空位** |

## 6. 验收总门（摘要 —— 全量见 requirements.md §4）

| # | 判据 | 方式 |
| --- | --- | --- |
| U1 | 用户点击启停/重启 ⇒ docker 写命令**恰好 1 次**且状态刷新；Agent 来源 ⇒ **被拒且 0 次调用** | 单测 + 真机 |
| U2 | 日志默认 `--tail 200`；断言**无**任何落盘调用（无 `writeFile`/`appendFile`），日志不进审计/错误文案 | 单测（静态 + 行为） |
| U3 | 配置页注册键 = 本包 patch 条目 id、`auto:false` 生效；写入走 live 路径；在途提权任务时保存**先确认**且未确认**未写盘** | 单测（fake ctx） |
| U4 | 本包**无** YAML 手写（`grep` 断言）；已在 P0 的字段（`managedPorts` / `distro`）在本 Spec 的配置面**零写入口** | 静态扫描 |