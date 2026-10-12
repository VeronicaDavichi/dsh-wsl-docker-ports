# 容器控制（P1）—— 设计与契约

> 依据：003 的 [`design.md`](../003-wsl-docker-ports/design.md)（架构 / 数据模型 / 五态纯函数 / NAT 门 / 注入点）与 [`client-contract.md`](../../client-contract.md)（宿主客户端契约）。
> 🔴 **本文件是「P1 的设计边界 + 已冻结的复用口径」，不是完整实现设计** —— 闸门（P0 真机验收通过）未达，本 Spec 不发产品代码；P1 开工时在此补详细设计，**不另立第二套口径**。

## 1. 分层与预期落点（同包不拆包）

| 层 | 归属 | 预期文件 | 说明 |
| --- | --- | --- | --- |
| 事实层（只读） | **003**（已交付） | `src/read/docker-probe.ts` | 容器列表 / 端口映射的**唯一**来源；P1 只消费，**不改** |
| 快照与通道 | **003**（已交付） | `src/snapshot.ts` · `src/route.ts` · `src/wire.ts` | `GET /dsh-wsl-docker-ports/snapshot`；P1 复用 |
| 容器写动作 | **010**（P1） | 预期 `src/docker/**`（新目录） | `docker start|stop|restart` + 来源约束（`user` 允许 / `agent` 拒绝） |
| 日志读取 | **010**（P1） | 同上（或 `src/read/docker-logs.ts`） | `docker logs --tail <N>`，**仅内存** |
| 客户端页面 | **003**（骨架）/ **010**（补控件） | `src/client/pane.tsx` / `pane-tables.tsx` | 启停/重启按钮 + 日志抽屉；骨架与 testid 沿用 003 |
| 配置页（完整） | **003**（P0 的 `managedPorts` / `distro` 表单）/ **010**（补 `scope` / `elevationPolicy`） | `src/client/pane-settings.tsx` | **同一页面两阶段补字段** ⇒ 同一字段只允许一个写入口 |
| 写通道（系统级） | **008 / 009** | `src/transport/**` · `src/client/write-*` | 🔴 **与 P1 无交集**：容器写动作**不经** `/write/plan` · `/write/apply` |
| 提权 | **005** | `src/elevate/**` | P1 **预期不使用**（容器写动作在 WSL 内，不需要 UAC）—— **待真机确认**（见 requirements A-2） |

## 2. 状态流

    用户点击「启动 / 停止 / 重启」
      ├─ 来源判定：user ⇒ 放行；agent ⇒ 拒绝（0 次 docker 调用）
      ├─ 执行（WSL 内，硬超时 + 失败可读原因；沿用 003 的失败态模型）
      ├─ 刷新：重取快照（复用 003 的通道）⇒ 容器表状态更新
      └─ 失败：如实回报（不重试写动作；写动作**不幂等**推测不可靠）

    用户点击「日志」
      ├─ `docker logs --tail 200 <id>`（上界有界；切换容器重新取）
      ├─ 仅进内存视图（**不落盘、不进审计、不进错误文案**）
      └─ 失败：面板内可读原因（不抛、不静默）

    配置页保存（scope / elevationPolicy）
      ├─ 在途提权任务？⇒ 先确认（REQ-12.4），未确认 ⇒ **零写入**
      ├─ 写经 settings 三写操作（live 路径；命名空间 = 本包 patch 条目 id）
      └─ 被更高层覆盖 ⇒ 表单自绘只读原因 + 路径（REQ-12.3）

## 3. 契约（复用 003，不新造）

| 项 | 口径 | 来源 |
| --- | --- | --- |
| 服务身份 | `PORTS_SERVICE` | 003（跨插件服务身份；P1 不新增服务） |
| 只读快照 | `GET /dsh-wsl-docker-ports/snapshot?managedPorts=…&distro=…` | 003 `src/wire.ts` / `route.ts` |
| docker argv（只读） | `wsl.exe -d <distro> -- docker ps --format '{{json .}}'`（**不是** `--format json`） | 003 `src/read/docker-probe.ts`（真机结论 A-1） |
| docker argv（P1 写） | `wsl.exe -d <distro> -- docker start|stop|restart <id>` | **本 Spec**（预期） |
| docker argv（P1 日志） | `wsl.exe -d <distro> -- docker logs --tail <N> <id>` | **本 Spec**（预期） |
| 配置写入 | `ctx.settings.{update,replace,mutate}`（live） | 003 `REQ-12.1` / 002 同款口径 |
| 失败语义 | 沿用 003 的统一失败态（可区分 + 可读原因 + 不空列表冒充） | 003 `src/read/probe.ts` |

## 4. 安全

1. **来源约束**：Agent 来源的容器写操作**一律拒绝**（REQ-11.4 / 005 的 REQ-4.1 同源）；判据是行为断言（0 次调用），不是文案。
2. **日志隐私**：可能含凭据 / 内网地址 / 业务数据 ⇒ 仅内存（REQ-11.3 / REQ-P1-3）。
3. **零提权假设**：P1 预期**不触发** UAC；若真机证明需要，则**复用 005**，SHALL NOT 自建第二套提权实现。
4. **不写 YAML**：配置面只用 settings 三写操作（REQ-12.1）。
5. **不越界**：`/write/*`（系统级写通道）与 002 的 `managedTerminal` 包依赖边**都不碰**（REQ-P1-2 / REQ-P1-4）。

## 5. 测试策略

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 单元 | `vitest`（+ 既有 fake executor / fake ctx） | 来源约束、`--tail` 上界、无落盘、配置页注册键与 `auto:false`、在途确认 |
| 离线契约 | `node --test`（003 同款 fixture 复用：真机 19 条规则 / 6 容器样本） | 解析与失败态（P1 不重复造 fixture） |
| 真机 | **chrome-devtools MCP**（禁用 Playwright / 视觉对照 —— 栈已冻结口径） | 启停 / 重启 / 日志抽屉 / 配置页保存 + 只读态 |
| 静态 | `grep` / 剥注释扫描（复用 001 的 `strip-comments.mjs`） | 无 YAML 手写、无 `/write/` 前缀、无包依赖边 |

## 6. 决策权衡

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 容器写动作走哪条通道 | **不经** 008 的 `/write/plan` · `/write/apply` | 那条通道是系统级转发规则的写路径（票据 / 审计 / 401）；容器写动作是 WSL 内 docker 调用，语义与风险面都不同 |
| 日志是否落盘 | **不落盘** | 可能含敏感信息；且落盘会引出保留期 / 清理 / 权限一串新问题 |
| 配置页字段分工 | P0 已占 `managedPorts` / `distro`；P1 只补 `scope` / `elevationPolicy` | 同一字段两个写入口 = 后写覆盖先写（D-4 的既有裁定） |
| `exec` 何时做 | **下一期**，本 Spec 只留注入点 | 栈级口径：P0/P1 **不依赖**组件①；过早建边会毁掉 L3 隔离 |
| `REQ-11` / `REQ-12` 是否搬来 | **不搬**（SSoT 留在 003），只搬 `T7.1`–`T7.3` | 搬 REQ 要同批改 003 三份文档 ⇒ 超出本轮授权；登记为待拍板（requirements §5） |

## 7. 下一期注入点（登记，不实现）

- **`exec`（进容器）**：`ctx.inject(['managedTerminal'], …)` **可选消费** 002；服务缺失 ⇒ 控件禁用 + 写明原因、回调不触发不报错；**不建包依赖边**。
- **`compose up|down`**：需要「多容器生命周期」的概念，**先定义编排边界再动手**（本轮不设计）。
- **镜像管理**：与「端口转发」目标正交，**单列一篇再评估**。

## 8. 未验项（如实登记）

- 本 Spec 的一切设计结论**未在真机上验证过**（闸门未达、零实例、零 `pnpm`）。
- `docker start|stop|restart` 在 WSL 内的**耗时 / 是否需要提权 / 失败态文本**：未知（真机待做）。
- 配置页 `scope` / `elevationPolicy` 的**落盘投递链**在真机上的表现：未知（002 的配置页同类链路已在真机验过，但本包这一页未验）。