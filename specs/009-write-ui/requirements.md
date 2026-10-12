# 009 写入口 UI —— 需求

> **2026-10-12 从 [008-write-transport](../008-write-transport/requirements.md) 拆出**：008 拥有**服务端**写通道（`src/transport/**`：路由 / `plan` / `apply` / 一次性票据 / 审计 / `401` 鉴权），但**写入口的用户界面**（拿凭据 → 看命令原文 → 点确认 → 看逐步结果）没有被任何一篇 Spec 完整拥有 ⇒ 独立成篇。**不改服务端写通道、不改写算法（005）、不改提权后端（005）、不改读模型与 diff（003）。**
>
> **为什么必须把契约冻结在正文里**：以下 §2 的契约是 008 的 `T3.1`（离线实现）逐条落下的，原文散在 5 个 `src/client/**` 文件的文件头注释里；而 008 的 `tasks.md` 已达 **394/400**、记录必须搬走 ⇒ 若不在本 Spec **冻结**，下一轮会**重新发明**（例如把凭据放进 `localStorage`、让客户端「顺手」把 `commandText` 拼回请求体、或把 `none` 提权档的确认按钮从置灰改成可点）。

## 1. 范围

- **做**：写入口的**全部 UI 面** —— ①凭据的生成 / 保存 / 持有 ②客户端到 `/write/plan` 与 `/write/apply` 的唯一路径 ③写前确认对话框 ④结果四态反馈 ⑤配置页的「生成并保存写通道凭据」按钮 ⑥真机 UI 复核清单。
- **不做**：服务端路由 / 计划 / 票据 / 审计 / 鉴权（008 的地盘）；写算法与提权链（005）；读模型与 diff（003）；007 配置页的**表单、只读态与 revision 冲突**（本 Spec 只在同一个页面上加**凭据块 + 写通道块**，与 007 的区块互不覆盖）。
- **边界一句话**：008 = 「服务端说了算」（命令原文由服务端算，客户端只回传 `planId` + `ticket`）；本 Spec = 「把服务端说的原样摆给人看，并把人的确认原样送回」。

## 2. 冻结契约（🔴 依据 = 源码 + 主人裁定；**不许放宽、不许重新发明**）

> 契约 1–8 由 **008 的 `T3.1`**（2026-10-12 离线）实现并逐条留下判据；本 Spec 把它们**升级为需求**：原先只是「实现与注释对称」，现在是「**必须如此**」。
> 源码出处（逐字依据）：`src/client/write-token.ts` 文件头 1–3 条 · `src/client/write-channel.ts` 文件头「信任边界 / 为什么 `declaration` 必须在 `target` 里 / 凭据怎么带 / 零请求是可断言的」· `src/client/write-confirm.tsx` 文件头 1–3 条 · `src/client/write-panel.tsx` 文件头 4 条规矩。

### REQ-1 凭据来源与默认值（fail-safe）

- **REQ-1.1** The `writeToken` **SHALL 默认为空**；未配置 ⇒ 写通道（`plan` / `apply` / `audit`）**恒 `401 unauthorized`**、零执行零写入。**SHALL NOT 放宽** —— 不许给默认值、不许自动生成、不许对本地回环放行（依据：008 `T2.9` 的主人裁定「无凭据 ⇒ 401」+ 它的真机 401 矩阵；`src/transport/write-auth.ts` 的 `trim` 口径 —— 空串算「没有凭据」）。
- **REQ-1.2** The 凭据 SHALL 由**用户在配置页显式点击**「生成并保存写通道凭据」产生（**32 字节随机 → 64 位小写十六进制**；只用 `[0-9a-f]` ⇒ 放进请求头 / 查询串 / YAML 双引号都无需转义），并经 **live 写入路径**落进插件配置：客户端 `remote.settings.update('dsh-wsl-docker-ports', { writeToken }, revision?)` —— 宿主侧**同义**写法 `ctx.settings.update('<patch 条目 id>', { writeToken })`（**条目 id = 包名**，**同一个字段** `config.writeToken`）。**SHALL NOT** 走 `configEditor.edit()`（完整配置路径**会重挂载**，技术栈已冻结该取舍）。
- **REQ-1.3** The 生成结果 SHALL **一次性显示**给用户：明文只出现在生成结果那一处；页面 **SHALL NOT** 提供「再显示一次」的入口，凭据仓库 `WriteTokenStore` **SHALL NOT** 有任何「打印 / 读回展示」的方法（只有 `read` / `save` / `clear` / `present`；`present()` 是**布尔事实**，可以进文案）。
- **REQ-1.4** IF 服务端写入失败，THEN 本会话 **SHALL NOT** 留下一个「服务端不认」的凭据（**只有服务端写入成功才存本会话** —— 否则用户会看到「已保存」却仍然 401，那是最难查的一类故障）；但该串 SHALL 仍交回页面显示一次（用户可手工填进配置）。

### REQ-2 凭据的持有与携带

- **REQ-2.1** The 客户端 SHALL 把凭据存在 **`sessionStorage`**，键带**包名命名空间**（`dsh-wsl-docker-ports.writeToken`）：刷新不丢、**不落盘**、关掉会话即消失；**SHALL NOT** 写 `localStorage`、**SHALL NOT** 写任何文件。取不到 `sessionStorage`（隐私模式 / 无 DOM）⇒ 降级**内存**实现（刷新即丢，**仍然不落盘**：宁可丢凭据也不静默落盘）。
- **REQ-2.2** The 凭据 **SHALL NOT** 出现在日志 / 审计 / 错误文案里；对外文案只描述「去哪里配置」（不含凭据本体、期望值、长度）。
- **REQ-2.3** The 请求 SHALL 用 **`Authorization: Bearer <t>`** 携带凭据；客户端 **SHALL NOT 主动**使用 `?token=`（URL 会进访问日志与浏览器历史，正是「凭据绝不进日志」要避免的形态）。服务端**两种都收**（008 的真机 V2 就按 `?token=` 打过）—— 这是契约**允许的取舍**：服务端保留兼容面，客户端只选更安全的那种。
- **REQ-2.4** WHILE 本会话没有凭据，客户端 SHALL **本地拦下**（**零请求**）并给出指路文案（不发一个注定 401 的往返）；「零请求」SHALL 可被断言（`requestCount()` 只统计**真发出去**的请求）。 🔴 **2026-10-12 关闭轮口径订正（原文逐字保留，不删旧句）**：「零请求」一律读作「**零写通道请求**」—— `write/plan` / `write/apply` 的**计数为 0**（`requestCount()` 只统计真发出去的写通道请求，口径未变），但客户端**会先打一次** `settings/describe` 取 `declaration`（属**只读配置读取**，不计入写通道请求数）⇒ 引用本条时**必须**带这个前提，免得被读成「一个网络请求都没有」。同口径见 [tasks.md](./tasks.md) 的 Phase 5 ⑤ 与 `design.md` 的四处订正痕。

### REQ-3 `401` 的处理

- **REQ-3.1** IF 服务端返回 `401`，THEN 界面 SHALL 提示「凭据缺失或错误 **+ 去哪里配置**」，并 **SHALL NOT 重试**（无重试循环、无自动刷新凭据、无指数退避）；提示文案 SHALL 说明「改完配置需重载插件行」。

### REQ-4 写前确认对话框（A 闸门）

- **REQ-4.1** The 对话框 SHALL 逐条渲染服务端 `plan.ports[].steps[].commandText` 的**原文**（每个步骤一个元素，`textContent` 与服务端字符串 `===`），**SHALL NOT** 改写 / 拼接 / 换行重组；服务端拼好的多行版 `plan.commandText` **SHALL NOT** 被使用（那等于客户端参与生成命令文本）。
- **REQ-4.2** The 对话框 SHALL 同时展示**影响面**（条数与作用域，`lan` 逐字给出「N 条 portproxy + N 条防火墙」）与 **`notes`**（服务端给的可读原因 / 拒绝理由）。
- **REQ-4.3** The 对话框组件 **SHALL 零副作用**：无 `fetch`、无 `settings`、无事件订阅 ⇒ 「未点确认 ⇒ 零网络请求」在**结构上**成立。
- **REQ-4.4** GIVEN 用户未点确认（含点「取消」、关闭对话框），THEN `apply` SHALL **恰好 0 次**；取消后该计划**作废**（要执行必须重新预演）。

### REQ-5 不可能成功的操作不提供

- **REQ-5.1** IF `plan.elevation.policy` ∈ {`none`, `unknown`} —— 或计划本身不可执行（`planId === null` / `ready === false`）—— 或服务端没签发票据（`ticket === null`），THEN 确认按钮 SHALL **置灰**并**写明可操作的原因**（NFR-4：拒绝路径不许只有错误码）。
- **REQ-5.2** The `plan.elevation.available` **SHALL 只展示、不参与置灰** —— 真机上它可能是一个过期的探测值（008 曾因只读 `peek()` ⇒ 恒 `null` 而误判），拿它当门会**误灰掉可用路径**。

### REQ-6 票据过期 / `plan-mismatch`（`409`）

- **REQ-6.1** IF `apply` 返回 `409`（票据过期 / `plan-mismatch`）或 `403`，THEN 客户端 SHALL **重新 plan + 重新要求用户确认**（旧计划与旧目标先作废），**SHALL NOT 静默重发 `apply`** —— 静默重发等于把「用户确认过的那份命令」换成「另一份命令」。
- **REQ-6.2** The 失败分类 SHALL 分得开（决定 UI 下一步动作）：`credential`（401 ⇒ 指路不重试）/ `replan`（409 / 403 ⇒ 重新预演）/ `unavailable`（503 ⇒ 环境问题，重试无益）/ `protocol`（404 / 405 / 500 / 网络异常 ⇒ 如实报，不猜）。

### REQ-7 信任边界（本 Spec 存在的第一理由）

- **REQ-7.1** The 命令原文 **SHALL 只来自服务端 plan**；客户端 **SHALL** 只回传 `planId` + `ticket`（+ `confirmed: true`、`origin: 'user'`）与**声明式目标**；**SHALL NOT** 回传、拼接、构造任何命令文本 —— 「命令文本没有入口」靠**数据流方向**保证，不靠自觉。
- **REQ-7.2** The 声明式目标 SHALL 只有 `{ action, ports, scope, declaration }` 四个字段（`action` ∈ {`add`, `remove`}；本页不做服务端的 `fix` / `switch-scope`）。
- **REQ-7.3** The 客户端 **SHALL NOT** 新增任何执行 / 提权入口：配置管道的导出面 SHALL 只有 `readConfig` / `updateCount` / `writeDistro` / `writeElevationPolicy` / `writeManagedPorts` / `writeScope` / `writeWriteToken`，且 `run` / `invoke` / `exec` / `elevate` / `spawn` **零命中**（008 的 T5.7 判据，逐字保留）。

### REQ-8 `declaration` 与 `target` 的逐字一致

- **REQ-8.1** The 声明式目标 SHALL 携带 `declaration`（所有权集合）；服务端的事实面里**没有**所有权集合（`managedPorts = declaration ?? []`）⇒ 不带声明则一切都 `port-not-managed`。
- **REQ-8.2** The `declaration` SHALL 在**预演时读一次**并**原样复用**到确认：`apply` 会**重算**计划并比对 `planId` ⇒ 两次请求的 `target`（含 `declaration`）必须**逐字相同**，否则**必然 `409 plan-mismatch`**。客户端 **SHALL NOT** 去猜、**SHALL NOT** 补默认值。

### REQ-9 结果逐步反馈（四态）—— **迁自 008 `T3.2`；2026-10-12 已实现（离线判据见 [tasks.md](./tasks.md) 的 T1.1–T1.3，真机未跑）**

- **REQ-9.1** GIVEN 服务端返回逐步结果（`executed` / `failed` / `skipped` / `rolledBack` + `status` / `backend` / `elevationPolicy` / `durationMs` / `message` / `hint`），THEN 界面 SHALL 按**四态分色**渲染：成功 / 失败 / 跳过 / 回滚。
- **REQ-9.2** The 失败项 SHALL **必带可读原因**（每条失败给出 `name` + `reason`，不是只给个数）；空态与有态 SHALL 可区分（该项为空时不渲染空段）。
- **REQ-9.3** The 判定色 **SHALL NOT** 硬编码 hex —— 沿用 003 `NFR-7` / 002 `NFR-4` 的口径（只用宿主 `--dsw-*` token + 类名前缀；003 Phase 6 的门已在不含写入口的 `src/client/**` 上真扫过一遍，命中 0）。

### REQ-10 真机 UI 复核

- **REQ-10.1** The Spec SHALL 带一份**可二值判定**的真机 UI 复核清单（V6–V8，格式与 008 的 T3.3 清单同构：判据 + 通过 + 回归信号），并**如实标注当前状态**（未跑就是「未通过（未验）」，**离线渲染证据不冒充真机**）。
- **REQ-10.2** The 真机复核 SHALL 只用**临时 / 一次性 profile**（AGENTS.md 白名单：**不得**用 `desktop` / `web`），跑完**逐字节还原**；`CLI` 不能操作 `desktop`（002 已证 `rejectElectronProfile`）⇒ 桌面实例在**应用内**安装。

## 3. 非功能需求

| # | 约束 | 判据 |
| --- | --- | --- |
| NFR-1 | **不引新依赖** | `package.json` 依赖项数不变；不引 E2E / 浏览器自动化 / UI 框架（React 只作 `peerDependencies`，宿主提供） |
| NFR-2 | 体积与行数门 | 单文件 ≤ **400** 行（原始行）、去注释去空行 ≤ **40KB**；复算脚本可当场出数 |
| NFR-3 | 真机验收不得污染用户环境 | 探针只用临时 / 一次性 profile，用完逐字节还原（与 008 NFR-3 同口径） |
| NFR-4 | 失败可读 | 任何拒绝 / 置灰路径都给出人类可读且**可操作**的原因（不许只有错误码），且**不含凭据** |
| NFR-5 | 文档不贴线 | 本 Spec 的 `requirements.md` / `design.md` / `tasks.md` 均 **< 200 行**（warn 阈值） |

## 4. 验收总门（可二值判定）

| # | 判据 | 方式 |
| --- | --- | --- |
| U1 | 未点确认 ⇒ `apply` **恰好 0 次**（取消同样 0 次） | 单测（`fetch` 计数器）+ 真机 |
| U2 | 对话框逐条渲染服务端 `steps[].commandText` **原文**（`===`）+ 影响面 + `notes` | 单测 + **真机 UI**（V6） |
| U3 | `writeToken` 默认空 ⇒ **恒 401**；配置页「生成并保存」+ 重载插件行 ⇒ 401 消失 | 单测 + 真机（V7） |
| U4 | 结果四态各自可渲染、**分色不同**、失败**必带原因** | 单测 |
| U5 | `401` 指路**不重试**；`409` / `403` ⇒ 重新 plan + 重新确认（不静默重试） | 单测 |
| U6 | 凭据只在 `sessionStorage`（命名空间键）；请求只用 `Authorization: Bearer`；客户端**发请求处**零 `?token=`（源码里只有一处**注释**提到「契约允许它」） | 静态扫描 + 单测 |
| U7 | 配置管道导出面 7 项、`forbidden` 5 个执行入口零命中（T5.7 逐字保留） | 单测 |
| U8 | 真机 UI 复核清单（V6–V8）三行都有真机原文证据 | 真机（**当前：未通过（未验）**） |

> **⚠️ 状态如实**：U8 与真机部分**未验** —— 2026-10-12 拆分的这一轮**未开浏览器、未装插件、未起实例、未跑任何 `netsh` / `New-NetFirewallRule`**。U1–U7 的离线部分见 008 `T3.1` 的判据（44 条 `vitest` 全绿）与迁入记录（[tasks.md](./tasks.md) §迁入记录）。
