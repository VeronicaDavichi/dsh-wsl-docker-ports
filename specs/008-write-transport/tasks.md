# 008 写入通道 —— 任务

> 每行一个任务；`[REQ-N]` 指向 [requirements.md](./requirements.md)。**「判据」必须是可二值判定的**（跑得出来、看得见）。分期见 design §9。

## Phase 0：契约核对（不写产品代码）

- [x] T0.1 [REQ-4.1] 核对 005 提权链的可用入口签名（`createElevationInvoker` / `detectBackend` / `probeElevationAvailability` 的实际导出与参数），写进 design 的接口小节。
  - 判据：把真实签名（文件:行 + 形参表）抄进 `design.md`；与代码不符即改文档，不改代码。
- [x] T0.2 [REQ-1.1] 核对宿主 `ctx.webServer` 的路由 API：前缀匹配顺序（exact → 最长 prefix → fallback）、`registerUpgrade` 的路径约束、disposer 归属（`ctx.effect`）。
  - 判据：三条结论各配一条源码位置或真机证据；「前缀不带尾斜杠」有实证。
- [x] T0.3 [REQ-2.4] 确认「所有权集合」的唯一来源（配置里的 `managedPorts` 解析结果）与读模型的现态入口。
  - 判据：写出「集合 → 计划过滤」的调用链（模块:函数）；集合外端口确实进 `port-not-managed`。

## Phase 1（P1）：**只读通道**（零写入，先拿 G1/G3/G4）

- [x] T1.1 [REQ-1.1–1.2] 新增 `src/transport/routes.ts`：常量 `WRITE_HTTP_PREFIX = '/dsh-wsl-docker-ports/write'`（**无尾斜杠**）、懒 `ctx.inject(['webServer'], …)`、幂等 `attach`、disposer 无条件进 `ctx.effect`。
  - 判据：重复 `attach` 只注册一次；disposer 调用两次不抛；**单测含反例**：常量改成带尾斜杠 ⇒ 至少 1 条红（REQ-1.1 的实证）。
- [x] T1.2 [REQ-1.3–1.4] 方法判据与错误码：`POST …/write/plan`、`GET …/write/audit`；其余路径 404、方法不符 405；`Content-Length` 按 UTF-8 字节、`Cache-Control: no-store`。
  - 判据：构造含中文与 emoji 的响应体，断言 `Content-Length` == `Buffer.byteLength(body)`；**先判路径后判方法**（错路径 + 错方法 ⇒ 404 而非 405）。
- [x] T1.3 [REQ-2.1] `src/transport/plan.ts`：声明式目标 → 动作清单（逐条作用域/监听地址/端口/连接地址/是否伴随防火墙规则/**命令原文** + 条数与影响面）。
  - 判据：`scope:'lan'` 的计划里每条 `commandText` 含具体端口且**不含通配符**；条数 == 端口数（范围内逐端口 1 条）。
- [x] T1.4 [REQ-2.2] 计划路径**零副作用**：不调提权、不写盘、不动 `netsh`。
  - 判据：注入的提权/执行器 spy **全 0**；`apply` 未被调用；真机复验计划前后 `netsh` 逐字节相同（并进 T1.7）。
- [x] T1.5 [REQ-2.3–2.4] 非法输入与集合外端口：返回空计划 + 可读原因，零动作。
  - 判据：`ports:[0]` / `ports:[70000]` / `scope:'wan'` / 集合外 `5173` ⇒ `steps: []` 且 `notes` 非空；**不是** 400。
- [x] T1.6 [REQ-5] `src/transport/audit.ts`：内存环形（N=100）+ 单行人类可读日志；`GET …/write/audit` 返回尾部。
  - 判据：**不产生任何文件**（用临时目录快照断言零新增文件）；敏感词扫描零命中。
- [x] T1.7 [REQ-6.1] 真机复验 P1：探针 profile（**白名单：不得用 `desktop` / `web`**）起实例，打 `plan` 与 `audit`。
  - 判据：① `plan` 前后 `netsh … show v4tov4` **逐字节相同**（G1）；② 未知路径/错方法真机返回**我们的 JSON**（不是宿主兜底 404）（G4）；③ 跑完逐字节还原 profile。

## Phase 2（P2）：**执行**（G2/G5/G6）

- [x] T2.1 [REQ-3.1] `src/transport/confirm.ts`：`planId` = 规范化计划 SHA-256（端口升序/键序固定/剔除 notes）；一次性票据 + TTL 120 s + 绑定 `planId`。
  - 判据：同一目标两次 `plan` 得到**相同** `planId`；端口顺序不同但集合相同 ⇒ 仍相同；票据二次使用被拒绝。
- [x] T2.2 [REQ-3.2–3.4] `apply` 校验：body 只允许 `{ target, planId, confirmed, origin, ticket }`；服务端**重新推导**计划并比对 `planId`；`confirmed !== true` ⇒ 拒绝。
  - 判据：① 未确认 ⇒ 提权 spy 全 0；② 篡改 `target` ⇒ `plan-mismatch`、零执行；③ 客户端塞 `commands:[…]` 字段 ⇒ **被忽略**（服务端仍按 `target` 推导）；④ `origin:'agent'` 时不能绕过确认。
- [x] T2.3 [REQ-4.1] `src/transport/apply.ts`：经 005 后端链执行，回传逐步结果（成功/失败/跳过 + 原因 + 耗时）。
  - 判据：后端返回 gsudo/native 各造一次假执行，逐步结果条数 == 计划条数；耗时字段为数字且 ≥ 0。
- [ ] T2.4 [REQ-4.2] 幂等：执行前现读，已满足的规则标 `skipped`。
  - 判据：对同一目标连续 `apply` 两次 ⇒ 第二次 `executed` 为空、`skipped` 全中，且不报错。
- [ ] T2.5 [REQ-4.3] 失败与回滚：中途失败 ⇒ 按 005 REQ-3.5 回滚本轮，回传 `{executed, rolledBack, skipped, failed}`。
  - 判据：让第 2 条失败 ⇒ 第 1 条被回滚、返回体三个清单齐全、无「半成品」残留（假后端的状态快照断言）。
- [ ] T2.6 [REQ-5.1] 每次 `apply`（含拒绝/超时/失败/回滚）落一条审计。
  - 判据：成功与拒绝各留一条；字段齐全（at/origin/elevationPolicy/backend/ports/scope/action/result/exitCode/durationMs/rolledBack）；无凭据字段。
  - ⚠️ 本行**判据已部分作废**（2026-10-09 主人裁定：**被拒绝的 apply 不写审计**）。已实现的是：执行尝试（成功/失败/回滚/超时）各一条，字段齐全、无凭据；`disabled` / `no-actions` / 全部拒绝路径**不写**（它们什么都没发生）。判据文字待主人订正后再勾。
- [ ] T2.7 [REQ-6.2] 红线单测：无 `portproxy reset`、无通配符防火墙规则、集合外零动作。
  - 判据：对生成的命令**逐条断言**（正则白名单）：不含 `reset`；每条 `New-NetFirewallRule` 都带具体 `-LocalPort`。
- [ ] T2.8 [REQ-6.1] 真机复验 P2（**需主人在场**；本机 UAC 不弹窗 ⇒ 无需点 UAC，但会真改系统状态）：
  - 判据：① 写一轮 `add` 后「他人 19 条**逐字节不变**」（`ReadAllBytes` 全字节比对 + sha256）（G5）；② 再跑一次同目标 ⇒ 条数不增（幂等）；③ 用 `action:'remove'` 回滚到写前状态，`netsh` 与写前**逐字节相同**；④ 审计里能读出实际后端（`gsudo`/`native`）（G6）。

## Phase 3（P3）：界面接线

- [ ] T3.1 [REQ-3.1] 客户端：写动作前弹**确认对话框**，逐条展示命令原文与影响面；未确认不发 `apply`。
  - 判据：单测断言「未点确认 ⇒ 零网络请求」；对话框文本含每条命令原文（不是「即将执行」这种空话）。
- [ ] T3.2 [REQ-4.1] 结果逐步反馈：成功/失败/跳过/回滚分色展示，失败给出可读原因。
  - 判据：四种结果的渲染分支各有单测用例；失败态一定带原因文本。
- [ ] T3.3 主人环境自验清单（与 002 的 V1–V3 同格式：安装命令 + 判据 + 回归信号）。
  - 判据：清单写进本文件；当前状态标注「未通过（未验）」。

## Phase 4：收口

- [ ] **T4.1 [NFR-2]** 体积/行数/导出门：新增文件逐个报数（≤400 行原始、≤40KB 去注释去空行）。
  - 判据：脚本当场出数；超限则拆文件，**不抬阈值**。
- [ ] T4.2 文档同步：`README.md` 导航、`design.md` 接口小节、AGENTS.md / stack-decision 若需变更则留痕（不需要则写明「无需变更」）。
  - 判据：README 链接可达；本文件所有 REQ-N 都在 requirements 里存在。
- [ ] **T4.3 [NFR-1]** 依赖未增：`package.json` 依赖项数与写前一致；未引 E2E/HTTP 框架。
  - 判据：`git diff` 里 `package.json` 的 dependencies/devDependencies 无新增；`pnpm install --frozen-lockfile` exit 0。

> **T1.7 施工口径（2026-10-09 实测后定）**：`plugin.ts` 已达 **389 行**，直接内联接线会涨到 **418 行 ⇒ 违反
> 「单文件 ≤ 400 行」SHALL**（`tests/unit/client-structure.test.ts` 当场判红 ✓ 该门**绝不放宽**）。
> ⇒ 接线一律走**独立文件** `src/transport/wire-plugin.ts`（导出 `attachWriteChannel(ctx, facts)` ⇒
> `{ writeRoute, audit }`），`plugin.ts` 只加 3 行左右（import + 调用 + 句柄两行，需挪别处腾行数）。
> 另一并如实同步 003 的**计数型**断言（`tests/unit/plugin-entry.test.ts`）：本插件现在拥有 **2 条路由**
> ⇒ `ctx.inject(['webServer'])` **2 次**、`effectCount` **3 条**（2 路由 + 1 卸载钩）、路由表 2 条 prefix。
> 这些是**如实更新**（断言的是数量，行为由各自用例守着），不是放宽阈值。

> **T1.4/T1.7 完成留痕（2026-10-09）**：`plugin.ts` **399/400 行** —— 🔴 **只剩 1 行余量**，此后任何新增
> 一律进独立文件（`transport/wire-plugin.ts` 即范例），**绝不再往 `plugin.ts` 里塞**；下次若必须动它，
> 先把既有段落外移腾额度（400 行是 SHALL）。
> 判据（`tests/unit/plugin-entry.test.ts` 新增用例 + 全包 **349/349** 绿）：写通道路由 `registered=true`、
> `registrationCount()=1`、两条独占前缀（`/dsh-wsl-docker-ports` + `/dsh-wsl-docker-ports/write`）、
> **装载期 `fake.calls.length === 0`（T1.4 的零外部命令判据）**、`requestCount()=0`、卸载后两路由注册数归零。
> 变异自证：把 `attachWriteChannel` 换成假对象 ⇒ 该用例必红；还原 hash 一致 ⇒ 绿。
> 003 的计数型断言已**如实同步**（2 条路由 ⇒ `host.effects` 3 条、`pending` 2 次注入、路由表 2 条 prefix）。
> ⚠️ 仍**未接真实现读**（缺省是保守降级面：零 IO、eth0 未知 ⇒ 计划恒被拦成 `eth0-unknown`）：
> 真机现读事实面 + `POST /write/plan` 端到端留到下一轮（探针 profile，动手前先问主人）。
> **Phase 2 增量（2026-10-09）**：新增 `src/transport/real-facts.ts` + `tests/unit/transport-real-facts.test.ts`
> （3 条判据 ✓）。固化的是**失败语义**：现读失败 ⇒ **抛** ⇒ `plan.ts` 回 `rules-unavailable` 503；
> 「确实没有规则」才回空数组；`eth0` / `localhostForwarding` 取不到 ⇒ `null`（不可判定 ⇒ 零动作 / 不猜 false）。
> `elevation().policy` 只反映配置档（缺省 `'unknown'`），**按触发方降级仍在执行层**（005 `resolvePolicy`）。
> 🔴 **已知缺口（不假装覆盖）**：`firewallNames` 未接 —— 本包没有防火墙规则读取件（005 的
> `existingFirewallNames` 是入参）⇒ **REQ-2.6「同名防火墙规则冲突」目前在计划阶段查不出来**；
> `portState` 亦未接（少过一道门 ⇒ 偏保守，宁可说「需要修」）。两项都待 Phase 2 后续补。
> ⚠️ 尚未接进 `plugin.ts`（`degradedPlanFacts()` 仍是现役缺省）；`plugin.ts` 只剩 1 行余量 ⇒ 接线时
> 需先外移 2 行注释腾额度。

## 真机验收记录（2026-10-09，探针 profile `volatile-probe`，端口 43311）

**方法**：临时装 `dsh-wsl-docker-ports@link:` + 临时禁用自退插件（`- id: volatile-probe / disabled: true`）⇒
用完**逐字节还原**（快照哈希对比差异 0，共 4 轮）。全程未碰 `desktop` / `web`。

**通过项**（真机实测）：
- `POST /write/plan`：`declaration` 合法 ⇒ 真 `planId`（SHA-256，64 位）；同入参重放**一致**；`scope` 实质变更**必换**。
- **命令原文可见**（REQ-3.2）：`scope:'lan'` + 端口 5900 ⇒ `ready:true`、`steps` **2 条**、`commandText` 精确为
  `netsh interface portproxy add v4tov4 listenport=5900 listenaddress=0.0.0.0 connectport=5900 connectaddress=172.20.201.152`
  + `New-NetFirewallRule -DisplayName "dsh-wsl-docker-ports-5900" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5900 -Profile Any -Group "dsh-wsl-docker-ports"`
  ⇒ 局域网**只放行该端口**（对比原脚本「全量放行」的真实攻击面）。
- `scope:'loopback'` + 本机 `localhostForwarding=true` ⇒ `steps:[]` + 说明「无需 portproxy 规则（WSL 自带的 localhost 转发已开启）」⇒ **合法 no-op**（不是缺陷）。
  ⇒ 闸门口径修正为：**有步骤** 或 **有明确的「无需规则」理由**（原拟「steps>0」硬闸**已作废**）。
- 所有权与语义：未声明 ⇒ `port-not-managed`；集合外端口 ⇒ `port-not-managed`；非法 `declaration` ⇒ 可读原因、不抛；多余字段被忽略；同入参三次响应逐字节相同。
- HTTP 语义：`GET /write/plan` → 405；`POST /write/audit` → 405；`GET /write/nope` → 404；路径先于方法。
- `GET /write/audit` ⇒ `{ok:true,records:[],size:0,dropped:0}`。
- 提权：真探测返回 `{policy:'unknown', backend:'gsudo', available:true}`（**005 正确，一行未改**）。
- 零动作红线：上述所有只读调用后 `netsh` 恒 **19** 条、防火墙规则总数恒 **811**。

**未通过 / 未实现（如实记录，不得写成通过）**：
- 🔴 **真写未发生**：`POST /write/apply`（`planId` + `confirmed:true`）⇒
  `{"ok":false,"error":{"code":"rules-unavailable","message":"写执行尚未接线：本请求零提权、零写入。"}}`
  ⇒ **零提权、零写入**（如实拒绝，不谎报成功）。写后 `netsh` 19→**19**、防火墙 811→**811**。
  ⇒ 结论：**008 Phase 2 的执行层（T2.x：确认票据 + 真执行 + 回滚）尚未实现**，写路径**未验收**。
- ✅ **已裁定（2026-10-09 主人）**：**被拒绝的 apply 不写审计** —— 审计只记「真正发生过的动作」（执行/回滚/结果），拒绝属「没发生」⇒ 不进审计环。本次审计环为 0 是**正确**行为，T2.x 无需补拒绝记录。

> **T2.1 完成（2026-10-09）**：新增 `src/transport/confirm.ts`（70 行）+ `tests/unit/transport-confirm.test.ts`（5 条判据全绿）。
> 契约：**绑定 `planId`** + **单次**（兑现即作废）+ **TTL 120s**（`WRITE_CONFIRM_TTL_MS`）+ 失败**三种分开报**
> （`unknown` / `mismatch` / `expired` —— 不合并成一句「无效」，调用方才能给准确文案）。
> 纯内存、零 IO、零进程、零定时器（签发时顺带清扫过期项 ⇒ 不会无界增长；时间可注入 ⇒ 边界可测）。
> `mismatch` **不吃掉**真票（一次手滑不必重新规划）。全包 node --test 357/357 绿。
> ⏳ 待接：`/write/plan` 响应回传票据、`/write/apply` 消费票据 + 真执行（T2.2/T2.3）。

> **T2.2 / T2.3 接线完成（2026-10-09，离线）**：严格按 `design.md` §14 蓝图施工（**未改设计口径**）。
> 改动：`plan.ts` 抽出 `computePlan`（plan/apply **唯一**规划代码路径 ⇒ `planId` 不可能分叉）+ `confirm` 字段按
> `planId` 签发；`routes.ts` 白名单**只加** `ticket` 一个字段；新增 `transport/apply.ts`（321 行）：确认门 ⇒ 重规划 ⇒
> `planId` 比对 ⇒ 票据门（三态分开报）⇒ `runElevate` ⇒ 失败回滚 ⇒ 审计；`wire-plugin.ts` 造**同一实例**的票据注册表
> 并喂给 plan 与 apply（缺执行器 ⇒ 不接线，仍回 503）；`plugin.ts` **同线编辑零行增长**（399/400 行不变）。
> 判据（新增 `tests/unit/transport-apply.test.ts`，12 条全绿；全包 **369/369**）：① 票据四态各自可区分且零执行零写入零审计
> （假执行器 `calls.length === 0` + 规则集合逐字节不变 + 审计环 0）；② 未确认/畸形/篡改 ⇒ 零执行零审计**且不吃掉真票**；
> ③ 真执行 ⇒ argv 逐字（`-Action add -Port 5900 -Address 172.20.201.152 -Scope lan`）+ 审计一条 `applied`；
> ④ `none` ⇒ `disabled` 零进程零审计、`unknown` ⇒ 按 `ask`、`passby`+`agent` ⇒ 降级 `ask`；⑤ 失败 ⇒ 第二次调用是
> `-Action remove`、**他人规则一条不动**、条数回到执行前；⑥ 什么都没写（UAC 被拒）⇒ **不回滚**（防误删）；
> ⑦ 同目标第二次 ⇒ 计划阶段被拦（无票据）⇒ 零执行零重复规则；⑧ 同一 `planId` 重复规划 ⇒ 旧票作废；⑨ HTTP 往返
> （`plan` 签票 → `apply` 消费 → 票据 `size` 1→0）；⑩ 缺执行器 ⇒ 503「写执行尚未接线」。
> 🔴 与 §14 的两点**如实偏差**（不假装达标）：**(a) T2.3「逐步耗时」做不到** —— 005 的 `StepReport` 只有
> `name/ok/stderr`（005 已真机验收，**一行未改**）⇒ 只回**整单** `durationMs` + 每步 name/ok/reason；
> **(b) T2.4 的字面判据不可达** —— 「同目标连续 apply 两次 ⇒ 第二次 `executed` 为空、`skipped` 全中」在「add 遇到既有规则即
> `state-precondition` 拦下」的口径下不可能出现（第二次的 `planId` 为 `null` ⇒ 无票据 ⇒ 409）；实际幂等保证 =
> **重复 apply 永不重复写规则、永不碰系统**（用例⑦钉住）。⇒ T2.4 的验收文字建议主人订正后再勾。
> ⚠️ **真机未验**：`apply` 的**真写**（netsh 19→20→19）属 T2.8，需主人在场；本轮**零真机动作**（未装插件、未起实例、未跑 netsh）。
> ⚠️ 另两处既有缺口不因本次而变：`firewallNames` / `portState` 无读取件（该两门未启用，偏保守）；
> `elevationPolicy` 配置读取未接 ⇒ 生产 `facts.elevation().policy` 恒 `'unknown'` ⇒ 本次按 **`'ask'`** 处理
> （`policyFor` 一处可改；若主人裁定未接线必须按 `'none'`，改那一行即可 —— 但那样真机将无法写入，直到配置页接线）。
