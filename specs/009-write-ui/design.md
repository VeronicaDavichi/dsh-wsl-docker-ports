# 009 写入口 UI —— 设计

> 需求见 [requirements.md](./requirements.md)（**§2 是冻结契约**）。本设计只覆盖**UI 面**：凭据仓库、客户端通道、确认对话框、结果面板、配置页凭据块。服务端写通道（008 `src/transport/**`）、写算法与提权链（005 `src/write/**` · `src/elevate/**`）、读模型与 diff（003）**一行不改**，只被调用。

## 1. 分层与文件（行数 = 2026-10-12 实测，原始行）

| 层 | 位置 | 职责 | 行数 |
| --- | --- | --- | --- |
| 凭据 | `src/client/write-token.ts` | 32B 随机 → 64 位 hex；`sessionStorage` 命名空间键；**一次性显示**；服务端写失败则不入会话 | 188 |
| 通道 | `src/client/write-channel.ts` | `/write/plan` + `/write/apply` 的**唯一**客户端路径；请求体白名单；失败四分类；零请求可断言（🔴 **2026-10-12 订正**：「零请求」= **零写通道请求** —— 会先读一次 `settings/describe` 取 `declaration`，见 [requirements.md](./requirements.md) REQ-2.4 的订正痕） | 307 |
| DTO | `src/client/write-dto.ts` | 响应形状解读 + `commandText` **逐字搬运** | 170 |
| 对话框 | `src/client/write-confirm.tsx` | 逐条命令原文 + 影响面 + `notes`；`elevationGate()` 置灰 | 201 |
| 面板 | `src/client/write-panel.tsx` | 状态机（预演 → 确认 → 执行）+ **结果保留**（四态渲染在下一行） | 234 |
| 结果区 | `src/client/write-result.tsx` | 四态（成功 / 失败 / 跳过 / 回滚）分色 + 逐步「名称 / 结果 / 原因」+ 空态不渲染空段；**不编状态、不重排、不改写原因** | 202 |
| 配置页挂载 | `src/client/pane-settings.tsx` | 凭据块 + 写通道块（与 007 的表单 / 只读态**区块并列，不覆盖**） | 198 |
| 配置管道 | `src/client/settings-pipe.ts` | `writeWriteToken`（第 5 个写方法，走同一个 `write()` 单键 patch 路径） | 181 |
| 测试 | `tests/client/write-{token,channel,confirm,panel,result}.test.tsx` + `write-fixtures.ts`；`tests/unit/client-settings.test.ts` | 44 条 `vitest`（008 `T3.1`）+ **14** 条（009 T1.1–T1.3 结果区 ⇒ 客户端共 **58** 条）+ T5.7 管道面判据 | — |
> 🔴 **2026-10-12 文档一致性轮订正（本表是当日快照，原文逐格保留不删）**：表内 **6 行行数已过期** —— `write-token.ts` 188 → **254**、`settings-pipe.ts` 181 → **333**、`pane-settings.tsx` 198 → **268**、`write-confirm.tsx` 201 → **209**、`write-panel.tsx` 234 → **233**、`write-result.tsx` 202 → **201**（`write-dto.ts` **170**、`write-channel.ts` **307** 未变）⇒ **权威表 = [tasks.md](./tasks.md) 的 `T4.2`**（`src/client/**` **17 文件**逐个实测：原始行数 + 原始/去注释字节 + 逐条判定）；**本表不整表重写**，以 `T4.2` 为准。

**上限**：单文件 ≤ **400** 行（~~当前最大 `write-channel.ts` **307**~~ ⇒ 🔴 **2026-10-12 文档一致性轮订正（旧值保留不删；307 这个数本身仍准，作废的是「最大」二字）**：实测**现最大 = `pane.tsx` 379 行**，次之 `rows.ts` 364 / `settings-pipe.ts` 333 / `index.ts` 310；逐个实测口径与判定见本表下方的 **T4.2 指针**）；去注释去空行 ≤ **40KB**（AGENTS.md：40KB 之后不许再抬阈值）。

## 2. 组件边界与状态流

`WriteChannelBlock`（`write-panel.tsx`）是页面上唯一的写入口；输入 `action` / `portsText` / `scope`，状态 `pending` / `plan` / `report` / `notice` / `busy`。

1. **`preview()`**：本地校验端口文本（1..65535、去重升序、≤ 256）⇒ 读 `declaration`（所有权集合）⇒ 只发 **1 个** `plan` 请求；`pending`（target）与 `plan` **成对**存在 —— 确认时必须**原样复用**（REQ-8.2）。
2. **`confirm()`**：只在确认按钮回调里发生，且 `busy` 期间两个按钮都不可点 ⇒ 双击也只有一个在途请求；body 只有白名单字段（REQ-7）。
3. **`cancel()`**：清空 `plan` / `pending` + 中性文案「已取消：零请求」⇒ 要执行必须重新预演（REQ-4.4）。 🔴 **2026-10-12 订正痕**：文案里的「零请求」= **零写通道请求**（取消 ⇒ `write/plan` / `write/apply` 计数 **0**；已发生的那一次 `settings/describe` 属只读读取、**不计入**）。**文案本身不改** —— 改它要动代码，本轮是**零代码**收口。
4. **失败**：先作废本次确认（不留可复用票据），再按四分类决定下一步 —— `replan`（409 / 403）⇒ **自动重新预演**并要求用户**重新确认**（REQ-6）；`credential`（401）⇒ 只指路（REQ-3）；`unavailable`（503）/ `protocol` ⇒ 如实报。

5. **结果保留**（状态 `report`）：最近一次 `apply` 的回执**不被重新预演 / 取消清掉**（只被下一次 `apply` 的新回执替换）—— 免得「预演一下就看不到刚才到底发生了什么」；四态渲染与原因在 `write-result.tsx`，空清单**不渲染空段**。

**本地拦截（零请求）**：端口文本非法 / 无凭据（REQ-2.4）/ 声明读取失败 / 超 256 端口 / 未接线（没拿到 `remote.settings` 或 `fetch`）。 🔴 **2026-10-12 订正痕**：「零请求」= **零写通道请求** —— 无凭据时仍会先读一次 `settings/describe` 取 `declaration`（只读，不计入）。

**对话框**（`WriteConfirmDialog`）：props = `plan` / `busy` / `blocked` / `onConfirm` / `onCancel`；组件**零副作用**（无 `fetch`、无 `settings`、无订阅）⇒「未点确认 ⇒ 零网络请求」在结构上成立（REQ-4.3）。
**置灰顺序**（`elevationGate()`）：① 计划不可执行（`ready === false` / `planId === null`）② `policy === 'none'` ③ `policy === 'unknown'` ④ `ticket === null` ⇒ 全部 `allow:false` + **可操作的原因**（REQ-5）。⚠️ `elevation.available` 只**展示**、不参与置灰（REQ-5.2）。

## 3. 接口契约（客户端只碰两个端点）

| 方法 | 路径 | 请求体（白名单，逐字） | 成功 | 失败分类 |
| --- | --- | --- | --- | --- |
| `POST` | `/dsh-wsl-docker-ports/write/plan` | `{ action, ports, scope, declaration }` | `{ planId, ticket, expiresAt, ready, blockedReason, elevation: { policy, backend, available }, ports[].{ ready, commandText, notes, blocked, steps[].{ kind, port, commandText } }, notes }` | `401` 凭据 / `503` 现读失败 / `404`·`405`·`500` 协议 |
| `POST` | `/dsh-wsl-docker-ports/write/apply` | `{ target: { action, ports, scope, declaration }, planId, ticket, confirmed: true, origin: 'user' }` | `{ status, backend, elevationPolicy, durationMs, executed, failed, skipped, rolledBack, message, hint }` | 同上 + **`409` 票据/计划不符 ⇒ 重新预演** |

- **命令文本没有入口**：请求体里不存在任何承载 `commandText` 的字段；服务端用 `target` 重新推导计划并比对 `planId`（008 §4）—— 客户端**不需要**、也**不允许**证明自己老实，方向本身保证了这一点（REQ-7.1）。
- `GET …/write/audit` 属 008 的服务端面（本 Spec 不消费；真机复核清单里直接打 HTTP）。
- **凭据携带**：`Authorization: Bearer <t>`（首选）。服务端**也**接受 `?token=`（008 的真机 V2 就是那样打的）—— 契约允许的取舍，但客户端**不主动**用（URL 会进访问日志与浏览器历史）。

## 4. 凭据流程（生成 / 保存 / 持有）

1. 用户点「生成并保存写通道凭据」⇒ `generateWriteToken()`（32B → 64 位小写 hex）。
2. 先写服务端配置：`remote.settings.update('dsh-wsl-docker-ports', { writeToken })`（宿主侧同义 `ctx.settings.update('<patch 条目 id>', …)`，条目 id = 包名）。**SHALL NOT** 走 `configEditor.edit()`（会重挂载）。
3. **只有写入成功才存本会话**（`sessionStorage`，键 `dsh-wsl-docker-ports.writeToken`）；失败 ⇒ 会话里不留「服务端不认」的凭据，但明文仍交回页面**显示一次**（REQ-1.4）。
4. 之后每次请求都从仓库 `read()` 取，唯一去处是请求头；仓库没有「打印」方法，`present()` 只有布尔事实（REQ-1.3）。
5. 服务端侧 fail-safe 不变：`writeToken` 为空 ⇒ 一律 401（008 `src/transport/write-auth.ts`，本 Spec 一行不改）。

## 5. 真机 UI 复核配方

- **探针 profile 白名单**（AGENTS.md）：只许**临时 / 一次性 profile**（如 `volatile-probe`），**不得**用 `desktop` / `web`；跑完逐字节还原。
- **CLI 不能操作 `desktop`**（002 已证 `rejectElectronProfile`）⇒ 桌面实例请在**应用内**安装。
- 配方（安装命令 / `config:` 两道闸门 / 端点基址）与**收尾复算**原文见 [tasks.md](./tasks.md) 的「迁入记录」§2（逐字来自 008 的 T3.3 清单，**只留一份**）。
- 真机行 = `tasks.md` 的 **V6–V8**；任何一条没有真机原文证据，就记「未通过（未验）」，**离线渲染不算真机**（REQ-10.1）。

## 6. 测试策略与门

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 组件 / 接线 | `vitest run`（`include` 只列 `tests/client/**`，见 `vitest.config.ts`；`.tsx` 扩展名本身就是与 `node:test` 的隔离手段） | 命令原文逐字、影响面、`notes`、未确认零请求、取消零请求、401 指路不重试、409 重新预演、置灰原因、凭据一次性 / 不落盘 / 不引 localStorage、**结果四态分色 / 失败必带原因 / 清单内保序 / 结果保留**（🔴 「零请求」= **零写通道请求**，见 REQ-2.4 订正痕） |
| 单元（无 DOM） | `node --test --test-concurrency=1 "tests/**/*.test.ts"` | 凭据仓库与生成（可注入随机源）、配置管道面（T5.7：7 项导出、`forbidden` 5 个执行入口零命中、写配置零提权调用） |
| 静态 | 脚本复算 | `src/client/**` 零硬编码 hex（003 `NFR-7` / 002 `NFR-4` 同口径）；凭据不进日志（`console.` 与 `localStorage` 用法零命中） |
| 真机 | 主人 / 探针 profile | V6–V8（**当前状态：未通过（未验）**）⇒ 🔴 **2026-10-12 文档一致性轮订正（原文保留不删）**：**V6 / V7 / V8 均已真机通过** —— `0f5c4ed`（缺陷 1 真根因）⇒ `47d19b7`（收口轮真机复跑）两轮；UI vs 服务端 `commandText` **逐字全等** —— add `portproxy-add` **123/123** + `firewall-add` **168/168**、remove `portproxy-delete` **78/78** + `firewall-delete` **64/64**。🔴 **如实边界（不得读成「四态全通过」）**：`failed` / `skipped` / `rolledBack` **三态真机从未出现** ⇒ **仅离线覆盖**（真机只出 `executed` 一态）。原文证据见本目录 [tasks.md](./tasks.md) 的 **Phase 7 §1** 与该轮判据摘要（`:51`） |
