# 008 写入通道 —— 任务

> 每行一个任务；`[REQ-N]` 指向 [requirements.md](./requirements.md)。**「判据」必须是可二值判定的**（跑得出来、看得见）。分期见 design §9。
> **行数门口径（2026-10-10 主人裁定）**：warn **200 只是提示、不强制压缩**；硬门 = **LeanSpec max 400 行**（本文件当前 **356**，余量 **44**）；🔴 一旦**接近 / 超过 400** ⇒ **必须拆 Spec（新增一篇）**，**不得**删已验证结论 / 未验项 / 裁定依据 / 命令原文证据。**本条已当场兑现一次**：2026-10-12 拆出 [009-write-ui](../009-write-ui/tasks.md)（UI 面：结果四态 / V6 真机 UI 复核 / 配置页凭据按钮），008 保留服务端写路径与收口。

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
- [x] T2.4 [REQ-4.2] 幂等：执行前现读，已满足的规则标 `skipped`。
  - 判据（**已订正 2026-10-10**）：**重复 apply 永不重复写规则、永不碰系统** —— 原字面判据「对同一目标连续 `apply` 两次 ⇒ 第二次 `executed` 为空、`skipped` 全中」**不可达**：第二次的 `add` 遇既有规则即被 `state-precondition` 拦下 ⇒ 无 `planId` ⇒ 无票据 ⇒ **409 `plan-mismatch`**（零执行、零重复规则，用例⑦钉住）。
- [x] T2.5 [REQ-4.3] 失败与回滚：中途失败 ⇒ 按 005 REQ-3.5 回滚本轮，回传 `{executed, rolledBack, skipped, failed}`。
  - 判据：让第 2 条失败 ⇒ 第 1 条被回滚、返回体三个清单齐全、无「半成品」残留（假后端的状态快照断言）。
- [x] T2.6 [REQ-5.1] **真正发生过的动作**各落一条审计（执行尝试：成功/失败/回滚/超时）；🔴 **被拒绝的 apply 不写审计**（2026-10-09 主人裁定，依据见下条）。
  - 判据（**已订正 2026-10-10**）：执行尝试（成功/失败/回滚/超时）各一条；字段齐全（at/origin/elevationPolicy/backend/ports/scope/action/result/exitCode/durationMs/rolledBack）；无凭据字段；**被拒绝的 apply（未确认 / 错票 / `plan-mismatch` / 401）审计环 size 不变**。
  - ⚠️ 订正留痕：原文字「每次 `apply`（含拒绝/超时/失败/回滚）落一条审计」「成功与拒绝各留一条」**已作废**（裁定：拒绝 = 没发生）⇒ `disabled` / `no-actions` / 全部拒绝路径**不写**。真机佐证：`confirmed:false` ⇒ 403 且**不留**审计记录（T2.8）；401 不记账（T2.9/T2.10）。
- [ ] T2.7 [REQ-6.2] 红线单测：无 `portproxy reset`、无通配符防火墙规则、集合外零动作。
  - 判据：对生成的命令**逐条断言**（正则白名单）：不含 `reset`；每条 `New-NetFirewallRule` 都带具体 `-LocalPort`。
  - [ ] [REQ-6.2] 红线单测（**008 自己的执行层专属判据**，2026-10-12 补；未勾选 = 未跑）：本包测试内断言无 `portproxy reset`、无通配符防火墙（`-LocalPort` 具体端口）、集合外零动作，且断言对象是 **008 自己的执行层**（003 的 `redline-guards` / 005 的 `elevate-script` 的既有用例**不能替 008 记账**）。
- [x] T2.8 [REQ-6.1] 真机复验 P2（**需主人在场**；本机 UAC 不弹窗 ⇒ 无需点 UAC，但会真改系统状态）：
  - 判据：① 写一轮 `add` 后「他人 19 条**逐字节不变**」（`ReadAllBytes` 全字节比对 + sha256）（G5）；② 再跑一次同目标 ⇒ 条数不增（幂等）；③ 用 `action:'remove'` 回滚到写前状态，`netsh` 与写前**逐字节相同**；④ 审计里能读出实际后端（`gsudo`/`native`）（G6）。

## Phase 3（P3）：界面接线

- [x] T3.1 [REQ-3.1] 客户端：写动作前弹**确认对话框**，逐条展示命令原文与影响面；未确认不发 `apply`。
  - 判据：单测断言「未点确认 ⇒ 零网络请求」；对话框文本含每条命令原文（不是「即将执行」这种空话）。
- [ ] T3.2（**已迁出**）结果逐步反馈：成功 / 失败 / 跳过 / 回滚分色展示 + 失败给出可读原因
  - 内容与验收**已迁至 [009-write-ui](../009-write-ui/tasks.md) 的 T1.1–T1.3**（2026-10-12 拆分；**只迁位置、不删内容**）。**编号 3.2 保留为空位**，以免 `T3.1` / `T3.3` 错位。
- [x] T3.3 主人环境自验清单（与 002 的 V1–V3 同格式：安装命令 + 判据 + 回归信号）。
  - 判据：清单写进本文件；当前状态标注「未通过（未验）」。

## Phase 4：收口

- [ ] **T4.1 [NFR-2]** 体积/行数/导出门：新增文件逐个报数（≤400 行原始、≤40KB 去注释去空行）。
  - 判据：脚本当场出数；超限则拆文件，**不抬阈值**。
- [ ] T4.2 文档同步：`README.md` 导航、`design.md` 接口小节、AGENTS.md / stack-decision 若需变更则留痕（不需要则写明「无需变更」）。
  - 判据：README 链接可达；本文件所有 REQ-N 都在 requirements 里存在。
- [ ] **T4.3 [NFR-1]** 依赖未增：`package.json` 依赖项数与写前一致；未引 E2E/HTTP 框架。
  - 判据：`git diff` 里 `package.json` 的 dependencies/devDependencies 无新增；`pnpm install --frozen-lockfile` exit 0。
- [ ] **T4.4 [NFR-2]** 改 `apply.ts` 前**先腾出行余量**（当前 **396/400**，仅剩 **4** 行；`plugin.ts` **393**）—— 腾不动就按顶部行数门口径**拆 Spec**；本轮**只记录、不动 `apply.ts`**。

> **T1.7 施工口径（2026-10-09 实测后定）**：`plugin.ts` 已达 **389 行**，直接内联接线会涨到 **418 行 ⇒ 违反
> 「单文件 ≤ 400 行」SHALL**（`tests/unit/client-structure.test.ts` 当场判红 ✓ 该门**绝不放宽**）。
> ⇒ 接线一律走**独立文件** `src/transport/wire-plugin.ts`（导出 `attachWriteChannel(ctx, facts)` ⇒
> `{ writeRoute, audit }`），`plugin.ts` 只加 3 行左右（import + 调用 + 句柄两行，需挪别处腾行数）。
> 另一并如实同步 003 的**计数型**断言（`tests/unit/plugin-entry.test.ts`）：本插件现在拥有 **2 条路由**
> ⇒ `ctx.inject(['webServer'])` **2 次**、`effectCount` **3 条**（2 路由 + 1 卸载钩）、路由表 2 条 prefix。
> 这些是**如实更新**（断言的是数量，行为由各自用例守着），不是放宽阈值。

> **T1.4/T1.7 完成留痕（2026-10-09）**：`plugin.ts` **399/400 行** —— 🔴 **只剩 1 行余量**，此后任何新增
> 一律进独立文件（`transport/wire-plugin.ts` 即范例），**绝不再往 `plugin.ts` 里塞**；下次若必须动它，先把既有段落外移腾额度（400 行是 SHALL）。
> 🔴 **当前口径（2026-10-10 实测，含 59b7301）**：`plugin.ts` **393**、`apply.ts` **396/400**（**全包最大文件，仅剩 4 行余量**）、`design.md` **187**、`tasks.md` **333** ⇒ 上文 **399/400** 是**按轮次的过往记录**（诚实演进史），**保留不动**。
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
> ④ `none` ⇒ `disabled` 零进程零审计、**`unknown` ⇒ 按 `none`**（2026-10-09 主人裁定后的**订正**；原记「按 ask」已作废，见文末补丁轮）、`passby`+`agent` ⇒ 降级 `ask`；⑤ 失败 ⇒ 第二次调用是
> `-Action remove`、**他人规则一条不动**、条数回到执行前；⑥ 什么都没写（UAC 被拒）⇒ **不回滚**（防误删）；
> ⑦ 同目标第二次 ⇒ 计划阶段被拦（无票据）⇒ 零执行零重复规则；⑧ 同一 `planId` 重复规划 ⇒ 旧票作废；⑨ HTTP 往返
> （`plan` 签票 → `apply` 消费 → 票据 `size` 1→0）；⑩ 缺执行器 ⇒ 503「写执行尚未接线」。
> 🔴 与 §14 的两点**如实偏差**（不假装达标）：**(a) T2.3「逐步耗时」做不到** —— 005 的 `StepReport` 只有
> `name/ok/stderr`（005 已真机验收，**一行未改**）⇒ 只回**整单** `durationMs` + 每步 name/ok/reason；
> **(b) T2.4 的字面判据不可达** —— 「同目标连续 apply 两次 ⇒ 第二次 `executed` 为空、`skipped` 全中」在「add 遇到既有规则即
> `state-precondition` 拦下」的口径下不可能出现（第二次的 `planId` 为 `null` ⇒ 无票据 ⇒ 409）；实际幂等保证 =
> **重复 apply 永不重复写规则、永不碰系统**（用例⑦钉住）。⇒ T2.4 的验收文字建议主人订正后再勾。
> ⚠️ **真机未验**：`apply` 的**真写**（netsh 19→20→19）属 T2.8，需主人在场；本轮**零真机动作**（未装插件、未起实例、未跑 netsh）。
> ⚠️ 另两处既有缺口**已有变化**（2026-10-09 补丁轮，见文末）：`firewallNames` **已接读取件**（计划阶段 `firewall-rule-exists`
> 门启用 + `apply` 下发前的存在性闸门）；`portState` 仍无读取件（该门未启用，偏保守）。
> `elevationPolicy` **已从插件 config 读**（读不到/认不出 ⇒ 事实面 `unknown` ⇒ 执行层按 SSoT 默认落到 **`none`**，不再按 `ask`；
> 生产清单当前没有 `config:` 块 ⇒ 缺省即不写，要真写须先在清单/配置页给值）。

## 补丁轮：安全默认值 + 防火墙存在性（2026-10-09，离线；零真机动作）

**三项施工**（严格按主人本轮裁定；005（`src/elevate/**`）、005 的 `src/write/**` **一行未改**）：

1. **策略默认值订正（🔴 安全默认）**：`transport/apply.ts:policyFor` 的「认不出 ⇒ `'ask'`」改为 **⇒ `'none'`**。
   依据 = SSoT（`stack-decision.md` 提权维度：`none`/`ask`/`passby`，**默认 `none`**）；**改默认值就是改技术栈**，
   只能在 SSoT 里改并留痕 ⇒ 代码不得另立一份口径。语义：`'unknown'` = **配置读不出来**（≠「用户关掉了提权」，
   ≠「用户选了每次确认」）⇒ fail-safe 取**不写**。⚠️ **为什么不是 `ask`**：`ask` 是用户**显式选择**的
   「允许提权、但每次确认」；把「读不到」升格成 `ask` = 替用户**打开**他从未打开的开关（真机上是真写 portproxy +
   防火墙规则）。`'none'` / `'ask'` / `'passby'` 原样透传、`passby`+Agent 仍降级 `ask`（既有行为未动）。
2. **`firewallNames` 读取件（补 REQ-2.6 的既有缺口）**：新增 `src/read/firewall-probe.ts`（147 行）——
   `powershell -NoProfile -NonInteractive -Command "Get-NetFirewallRule | Where-Object DisplayName -like 'dsh-wsl-docker-ports-*'
   | Select-Object -ExpandProperty DisplayName"`，**只读**（无 `New-`/`Set-`/`Remove-`/`netsh`）、零提权；
   接入 `real-facts.ts`（`PlanFactSources.firewallNames`）与 `wire-plugin.ts:createPluginFacts`。
   🔴 **读失败/形态不可识别一律抛**（不是空数组）⇒ `plan.ts`/`apply.ts` 回 `rules-unavailable`；
   只有「进程成功且输出为空」才是事实 `[]`。⇒ 计划阶段的 `firewall-rule-exists` 门**从不可用变为启用**。
3. **执行前存在性闸门（TOCTOU + 叠规则的真实缺陷）**：`apply.ts` 在票据门之后、`runElevate` 之前**再读一次**规则名；
   目标 `firewall-add` 的 `displayName` 已在 ⇒ **整单不下发**（连 portproxy 也不写），回 200 + `status:'no-actions'` +
   `executed:[]` + 全部步骤进 `skipped` + `backend:'not-attempted'` + 可读 `message`/`hint`；**不写审计**（什么都没发生）。
   为什么**不**只跳过「防火墙那一步」：005 的提权脚本按 `action` + `scope` 放行防火墙（`runner.ts:scriptCallFor` +
   `script.ts` 的 `add@lan`），**不看 `plan.steps`** ⇒ 单步滤不掉（005 已真机验收、一行不改）。
   本闸门**永不** Set-/覆盖/删除用户既有规则。读失败 ⇒ 503 + **零提权**（绝不把「读不到」当「没有」）。
   ⚠️ 未接线 `firewallNames`（降级事实面）⇒ 该门不启用，行为与接线前一致（两处口径一致）。

**配置读取（T3 的可知部分）**：`plugin.ts:PortsPluginConfigLike` 增 `elevationPolicy?: string`（**同线编辑、零行增长**：
`plugin.ts` 仍 **399/400 行**），并把它传进 `createPluginFacts`；`real-facts.ts` 校验只认 `none`/`ask`/`passby`，
**认不出（含空串/大小写不符）⇒ 事实面 `unknown`**（不原样透传，免得非法值显示得像真选过）。
⚠️ **未证的部分（如实标注，不猜 API）——「客户端 / 配置页」那一半已迁至 [009-write-ui](../009-write-ui/tasks.md) 的 T2.2 / V7**：客户端 `settings-pipe.ts` 的 `remote.settings.update('dsh-wsl-docker-ports', {elevationPolicy})` 是否投递到 bundle 条目的 `config:`（宿主 settings/`remote.settings` 实现不在本地可读范围：只有打包的 `app.asar`）⇒ 配置页接线前，生产缺省仍是 `unknown` ⇒ **不写**（绝不为了「能写」而放宽默认值）。

**判据**：`tsc -p tsconfig.json` exit 0；全包 `node --test --test-concurrency=1 "tests/**/*.test.ts"` **381/381 绿**
（基线 369 + 新增 12：`tests/unit/firewall-probe.test.ts` 6 条 + `transport-apply` 4 条（④ 改判 + ⑪/⑪b/⑪c/⑫）+
`transport-real-facts` 1 条 + `plugin-entry` 1 条）。新增/改动文件行数：`read/firewall-probe.ts` 147（新）、
`apply.ts` 395、`real-facts.ts` 91、`wire-plugin.ts` 151、`plugin.ts` 399（**未涨**）、`design.md` 200（**未涨**）。
🔴 **真机未验**：真写（netsh 19→20→19）与真防火墙现读都属需主人在场的验收；本轮**未装插件、未起实例、未跑任何写命令**。

## ✅ T2.8 真机写入验收：PASS（2026-10-10，探针 profile `volatile-probe`，端口 43311）

**投递面（此前唯一未证的一环）已证实**：探针 profile 的 `cordis.patch.yml` 里
`- id: dsh-wsl-docker-ports` + `config: { elevationPolicy: ask }` ⇒ `plan` 响应实测
`elevation:{"policy":"ask","backend":"gsudo","available":true}`（三次一致）⇒ **配置真被插件读到并传到事实面**；
此前 `unknown` 的投递缺口**闭合**。

**真写确实发生，且完整回滚**（同一条命令内连做 add → remove）：

| 时点 | portproxy 规则 | 我方防火墙规则 |
| --- | --- | --- |
| apply 前 | **19** | **0** |
| apply（add）后 | **20** ⬆ | **1** ⬆ |
| apply（remove）后 | **19** ⬇ | **0** ⬇ |

- apply#1：`status:"ok"`、`exitCode:0`、`executed:["portproxy-add","firewall-add"]`、`backend:"gsudo"`、`elevationPolicy:"ask"`；
- apply#2：`status:"ok"`、`exitCode:0`、`executed:["portproxy-delete","firewall-delete"]`；
- 建的规则是**端口专属**（`-LocalPort 5900`，非通配符），`connectaddress` = 现读 eth0 `172.20.201.152`；
- `audit` 恰 **2 条** `result:"applied"`（内存环 + 一行日志）；额外验拒绝路径：`confirmed:false` ⇒ **403 `confirm-required`** 且 **不留审计记录**（符合 2026-10-09 裁定）；
- 命令原文（REQ-3.2）两条逐字：`netsh interface portproxy add v4tov4 listenport=5900 listenaddress=0.0.0.0 connectport=5900 connectaddress=172.20.201.152`
  与 `New-NetFirewallRule -DisplayName "dsh-wsl-docker-ports-5900" … -LocalPort 5900 …`；remove 侧为 `… delete v4tov4 listenport=5900 listenaddress=0.0.0.0` + `Remove-NetFirewallRule -DisplayName "dsh-wsl-docker-ports-5900"`。

**还原与红线**：`volatile-probe` 与快照 **四种哈希对比全 0**（74 文件，含与改动前基线的交叉验证）；
收尾 `portproxy` **19**、我方防火墙 **0**、`listenport=5900` **0**、node 回 **14**、43311 空闲、
`~/.dsh` 递归搜我方包名 **0** 命中、`dir /AL` 无软链、`pnpm install --frozen-lockfile` exit **0**、`git status` 空。
未做：UAC/注册表改动、`portproxy reset`、通配符防火墙规则、PATH/gsudo 配置改动。`desktop`/`web` 未被碰（mtime + 0 命中双证）。
⚠️ **订正留痕（2026-10-12 真机）**：上面「`~/.dsh` 递归搜我方包名 **0** 命中」**作废** —— 真机递归搜有 **30** 处命中，**全是历史日志 / 缓存、无一可加载**（无软链、无清单引用）⇒ 判据改为「**清单层引用 = 0**（`cordis.patch.yml` / `cordis.yml` / `package.json`）」，与 [009-write-ui/tasks.md](../009-write-ui/tasks.md) 的 Phase 5 ④ 同口径。


**⚠️ 计数口径陷阱（本次实测踩到，留痕以免后人误判）**：`netsh … show v4tov4` 的**朴素 4-token 正则会把表头 `Address Port Address Port` 与分隔行 `----- ---- ----- ----` 也数进去** ⇒ 会得出 **21** 而非 19。
真规则数必须用严格 IPv4 行匹配 `^\s*\d{1,3}(\.\d{1,3}){3}\s+\d+\s+\d{1,3}(\.\d{1,3}){3}\s+\d+\s*$`。
（我此前多轮报的 19 均为严格口径。）

**⚠️ 未处置的安全观察（A4，交主人裁定，本轮未扩大范围）**：`/dsh-wsl-docker-ports/write/{plan,apply,audit}`
在**不带 GUI `?token=`** 时也返回 200 ⇒ 虽只绑 `127.0.0.1`，但**本机任意进程都可调用写端点**。
建议：给写通道挂宿主鉴权（或要求与宿主同源的 token），并把「无凭据 ⇒ 401」写成判据。

**探针 profile 的既有副作用（与 008 无关，仅记录）**：① B-1 探针插件会在首启后 ~7.5s 自己 SIGINT，
并经 `settings.update` 往 `cordis.patch.yml` 写入测试条目（`- id: volatile-probe` + `label/profiles`）——
本次`[]` 起始的 patch 就是被它写脏的；② `dsh plugin add` 会把 `node_modules` 下的包目录换成 **SymbolicLink**
（旧目录改名为 `.ignored_*`）⇒ 探针流程必须「整目录删除 + 快照整份还原」，不能只删 yml 条目。

## ✅ T2.9 写通道鉴权：宿主无可接的鉴权面 ⇒ 插件自有凭据（2026-10-10，离线判据全绿）

**缺口来源**：T2.8 的 A4 真机观察 —— 不带宿主 GUI 的 `?token=` 时，`/dsh-wsl-docker-ports/write/{plan,apply,audit}`
仍返回 **200** ⇒ 插件的具名路由**不被**宿主 token 门覆盖，本机任意进程都能调写端点。

**第一步侦察（只读；🔴 全程未读 `app.asar`）⇒ 结论：宿主没有可用的鉴权/凭据 API，走方案 (B)**
- 证据①（本仓的注册契约）：`src/route.ts:57-65` 的 `WebServerRoute` **只有** `kind` / `path` / `handler`；
  `WebServerSurfaceLike` **只有** `register(route)` ⇒ 没有 auth / token / guard / authorize 字段
  （该对象式签名已由 `client-contract.md:408` 的真机实测钉住，不是我猜的）。
- 证据②（可读依赖面）：`node_modules/.pnpm` 共 **154** 个包，`@deepseek-ai/*` **23** 个；对其中
  **1,816** 个 js/d.ts/json 产物跑 `Select-String -Pattern webServer` ⇒ **零命中**
  ⇒ 宿主的 web-server 插件**不在可读依赖面内**，它的 `.d.ts` 读不到。
- 证据③（`ctx` 侧）：可读声明里**没有** `ctx.auth` / `ctx.webServer.token` 之类成员；`AGENTS.md` /
  `client-contract.md` 也没记录任何面向插件的 token 投递 API（宿主 token 只以 GUI 入口 `?token=` 的形态出现）。
- ⇒ **不臆造 API**：改用「插件自有凭据」；若日后发现宿主其实有机制，本条目应改判为 (A)。

**实现（新增 `src/transport/write-auth.ts` 161 行；`routes.ts` 362 / `wire-plugin.ts` 155）**
- 事实来源：插件 config 的 **`writeToken`**（`PortsPluginConfigLike`，与 `elevationPolicy` 同一处；
  `plugin.ts` 一行透传且**同线压缩了一行注释 ⇒ 零行增长**）。
- **fail-safe 默认**：未配置/空白 ⇒ `plan` / `apply` / `audit` **一律 401**
  （`{ok:false,error:{code:'unauthorized',message:…}}`），文案含「未配置写通道凭据」并给出配置方法
  （patch 里 `config: { writeToken: "<随机长串>" }`，与 `elevationPolicy` 同一处）。
- 已配置 ⇒ **常量时间比较**：两侧先 `sha256` 再 `timingSafeEqual` ⇒ 任何长度**走同一条路径、不抛**
  （002 的 `safeEqual` 是长度不等直接 false；这里刻意更强）。凭据读法沿用既有习惯：`?token=`（优先）
  → `Authorization: Bearer`（与 002 `readHandshakeToken` 同序；**不新造头名**）。
- 🔴 凭据**不进**日志/审计/响应：拒绝文案是**固定文本**（不含凭据本体与期望值）；`audit.ts` 的白名单
  拷贝从结构上杜绝凭据入环；允许记录的只有布尔事实 `WriteAuthFailure.presented`（是否带凭据）。
- 判定顺序：**鉴权最先**（早于路径/方法/请求体）⇒ 未带凭据时连 404/405 都不给、请求体一个字节不读、
  `deps` 一次不调、审计一条不写；已鉴权 ⇒ 404/405/503/403/409 语义**逐字不变**。
- `unauthorized` 只加在 008 自己的 `WriteErrorCode` 上（**未动** 003 的 `PortsErrorCode` ⇒ 只读契约零变化）。

**判据（离线，全绿）**：新增 `tests/unit/transport-write-auth.test.ts` **5 条**（386 − 381）：
① 未配置 ⇒ 三端点 401 + `authConfigured:false` + **零 deps 调用**（连带上凭据也拒）；
② 缺失/错误/长/超长凭据 ⇒ 401 且**不回显**凭据（含畸形 url 不抛）；
③ 凭据正确 ⇒ plan 200 / apply 走到既有票据门 / audit 200，且 **401 优先于 404/405**（未鉴权时连路径/方法都不泄露）；
④ **401 不写审计**（真审计环 `size()===0`、也不签发确认票据）+ **真插件装配**下「未配 `writeToken` ⇒ plan 401 且零外部命令」；
⑤ 取凭据的优先级与边界（query 优先于头、空串 = 没带、空白 = 未配置）。
既有用例一律改为「已配置 + 每请求带对凭据」⇒ 它们的断言**逐字未改**（等于反证「已鉴权行为与今天一致」）。

**终值**：`tsc -p tsconfig.json` exit **0**；`node --test --test-concurrency=1 "tests/**/*.test.ts"` =
**386 tests / 386 pass / 0 fail**（基线 381 ⇒ +5）；vitest **31 pass / 0 fail**。
单文件行数：`plugin.ts` **399**（**零增长**，SHALL ≤400）、`routes.ts` 362、`write-auth.ts` 161（新）、
`design.md` **200**（**未变长**）。未改：`src/elevate/**`、`src/write/**`、`package.json`、`pnpm-lock.yaml`、
`stack-decision.md`（本轮未跑 `pnpm run`，故 lockfile 未被动过）。

🔴 **未验**：① 真机的 401 行为（需起实例/探针 profile；本轮**未装插件、未起实例、未跑任何写命令**）；
② 「patch 里 `config.writeToken` 真被读到」的**投递链路**（T2.8 已用 `elevationPolicy: ask` 间接证明同一处
config 真送达，但 `writeToken` 本身未在真机验过）；③ 客户端拿到 401 时的 UX **属 UI 面 ⇒ 已迁至 [009-write-ui](../009-write-ui/tasks.md)**（008 只负责服务端 401 本身，客户端行为在 009 的清单里）。

## ✅ T2.9 写通道鉴权 · 真机验证：PASS（2026-10-10，`volatile-probe` / 43311 / HEAD 37ed40e）

**实测矩阵（11 项，10 项符合期望；第 7 项「带正确凭据调 apply」按红线故意未调用）**：
`plan` 无凭据 ⇒ **401** ✓；`plan` 错凭据 ⇒ **401** ✓；`plan` `?token=<正确>` ⇒ **200** ✓；`plan` `Authorization: Bearer <正确>` ⇒ **200** ✓；
`apply` 无凭据 ⇒ **401** ✓；`apply` 错凭据 ⇒ **401** ✓；`audit` 无凭据 ⇒ **401** ✓；错凭据 ⇒ **401** ✓；正确（两种携带方式）⇒ **200** ✓。
401 文案为 `unauthorized`，且**不回显凭据本体/期望值/长度**；401 发生在路径/方法/请求体判定**之前**（未鉴权方拿不到本前缀下有哪些路径与方法）。
正向证据：实测文案是「**缺少**写通道凭据…」而非「**未配置**…」⇒ 证明 `config.writeToken` 被插件**真读到**（投递链路在上机层面证实）。

**零真实写入的证据（逐次 + 内容级）**：11 次调用逐次采集 `portproxy` 恒 **19**、我方防火墙恒 **0**；
且 `netsh interface portproxy show v4tov4` **全文 SHA256 前后逐字节相同** ⇒ 不只条数不变，表内容也没变。
`GET /write/audit?token=<正确>` ⇒ `{"ok":true,"records":[],"size":0,"dropped":0}` ⇒ **401 不记账、只读 plan 不记账**（合 2026-10-09 裁定）。

**还原与红线**：`volatile-probe` 与快照 `Compare-Object` **差异 0**（74 文件；相对路径→hash 映射 diff = 0）；
`cordis.patch.yml` 回到原始 `[]`（hash `8C2D1F55…`）；`package.json` 回到原样（bundles 无本插件）；
profile 内 ReparsePoint **0**、`node_modules` 无本包软链；`portproxy` **19**、我方防火墙 **0**、node **14**、43311 空闲；
`pnpm install --frozen-lockfile` exit **0**、`git status --porcelain` **空**。

**⚠️ 本轮修正了我此前的一条探针配方错误**：B-1 探针**不在** `cordis.patch.yml` 里（该文件是 `[]`），
而是经 `package.json` 的 `dsh.profile.bundles`（`link:…\Temp\dsh-volatile-probe`）装载 ⇒ 它才在运行中
`settings.update` 写脏 `cordis.patch.yml`、并在 ~7.5s 后 SIGINT 自杀。**确定性做法 = 从 `dsh.profile.bundles` 摘除该 bundle**
（探针未加载的三条独立证据：stdout 零 `[PROBE5]`、存活 ~100s 远超 7.5s、patch 文件未被重写）。
（「`- id: dsh-volatile-probe` + `disabled: true`」是否等效 —— **未验证**，如实记录。）

**⚠️ 未验（如实）**：本轮只验「鉴权门」，**未**回归「鉴权通过后的原有语义」（403/409/503 与真写）；
其中**真写**已由 T2.8 独立验证过（netsh 19→20→19），但「T2.9 鉴权 + 真写」的**组合**尚未在一次运行里同时验证。
`desktop` 下 `.playwright-mcp\console-*.log` 在测试窗口内 `desktop` mtime 有变动 ⇒ 属**主人正在运行的实例**自身行为（我方对 `desktop` 零写入）。

## ✅ T2.10 组合验收（鉴权 + 提权档 ask + 真写）：PASS（2026-10-10，`volatile-probe` / 43311 / HEAD b64570f）

**一次运行内同时验证「鉴权门」与「真写」**（此前两者分别验过、组合未验）：
`plan?token` ⇒ 200 且 `elevation.policy:"ask"`（配置真送达）⇒ `apply(add)?token` ⇒ `status:"ok"`、`executed:["portproxy-add","firewall-add"]`、`exitCode:0`；
`portproxy` **19→20**、我方防火墙 **0→1**（规则文本行实测 `0.0.0.0  5900  172.20.201.152  5900`；
防火墙 `dsh-wsl-docker-ports-5900`，Inbound/Allow/TCP/`-LocalPort 5900`/`-Group dsh-wsl-docker-ports` = **端口专属，非通配符**）；
`plan(remove)` + `apply(remove)` ⇒ `executed:["portproxy-delete","firewall-delete"]` ⇒ **20→19**、**1→0**、5900 规则行 **0**。
`audit?token` ⇒ 恰 **2 条** `result:"applied"`，**审计里无凭据**。

**反面对照（证明令牌是真闸门，不是摆设）**：同一次运行内，`plan` **不带** token ⇒ **401**
`{"code":"unauthorized","message":"缺少写通道凭据…"}`；`audit?token=deadbeef` ⇒ **401**「写通道凭据不正确…」。

**探针禁用（修正后的确定性做法）**：从 `package.json` 的 `dsh.profile.bundles` 摘除 `dsh-volatile-probe`
（`dependencies` 不动）⇒ 三条证据：stdout 零 `[PROBE5]`、实例存活 **109.2s**（≫7.5s 自杀点）、
`cordis.patch.yml` 在 uptime 21.2s 与 109.2s 两次读取 hash 均为注入版本（未被 `settings.update` 重写）。

**还原**：先对 profile 内 2 个 reparse point 用 `[IO.Directory]::Delete(path,false)` **只删链接**（保护链接目标），
再清空目录、整份复制回 ⇒ 「相对路径→hash」映射 `Compare-Object` **差异 0**（74 文件，带 `-Force`）；
另比「相对路径|Attributes」差异 **0**。收尾：`portproxy` **19**、我方防火墙（按名与按组两种查法）**0**、5900 规则 **0**、
node **14**、43311 空闲、profile 内 ReparsePoint **0**、`~/.dsh` 与仓库 `node_modules` 搜我方包名 **0** 命中；
`cordis.patch.yml` 回到基线 `[]`（hash `8C2D1F55…`）；`pnpm install --frozen-lockfile` exit **0**；`git status` 空。
⚠️ **订正留痕（2026-10-12 真机）**：上面「`~/.dsh` 递归搜我方包名 **0** 命中」**作废** —— 真机递归搜有 **30** 处命中，**全是历史日志 / 缓存、无一可加载**（无软链、无清单引用）⇒ 判据改为「**清单层引用 = 0**（`cordis.patch.yml` / `cordis.yml` / `package.json`）」，与 [009-write-ui/tasks.md](../009-write-ui/tasks.md) 的 Phase 5 ④ 同口径。


**⚠️ 未验（如实）**：① `writeToken` **未配置** ⇒ 401 的 fail-safe 分支未上真机（仅离线单测）；② `origin:"agent"` + `passby` 的**降级为 ask** 未验（本次 policy 本就是 `ask`，无法区分）；③ 本次为**直接 HTTP 调用**，未经过客户端确认对话框（该期未接线）⇒ 现阶段「人在回路」的证据**只有票据门**（一次性 + 绑 `planId` + TTL 120s），**不是** UI 确认 —— **该 UI 面（含真机复核）已迁至 [009-write-ui](../009-write-ui/tasks.md)**。

## 📋 T3.3 主人环境自验清单（2026-10-10；**当前状态：未通过（未验）**）

> **V6（真机 UI 复核）+ 结果四态分色 + 配置页凭据按钮的真机投递已迁至 [009-write-ui](../009-write-ui/tasks.md)**（2026-10-12 拆分；**编号 V6 保留为空位**）—— 本表只留**后端写路径**的 V1–V5。
> 格式与 002 的 V1–V3 同构：**安装命令 + 判据 + 回归信号**。代理**不碰任何 profile** ⇒ 安装/卸载由主人自己跑。
> 🔴 **CLI 不能操作 `desktop`**（002 已证：`rejectElectronProfile` ⇒ `error: profile "desktop" is managed exclusively by the Electron application`）
> ⇒ 桌面实例请在**应用内**安装；命令行的 `<profile>` 只能填非 `desktop` 的 profile。
> 判据来源 = T2.8 / T2.10 的真机记录（**等价断言已验过**），本节把它固化成**可重复跑**的清单 ⇒ 但**清单本身尚未按此格式整份跑过**，故状态记「未通过（未验）」。

> **配方（安装命令 / `config:` 两道闸门 / 端点基址）与收尾复算只留一份 —— 已迁至 [009-write-ui 的 Phase 3 与迁入记录](../009-write-ui/tasks.md)**（同一份，避免两处漂移）：本表的 V1–V5 按那份配方跑。

| # | 判据（可二值判定） | 通过 | 回归信号 |
| --- | --- | --- | --- |
| V1 | `GET …/write/audit` **不带**凭据 ⇒ **401** `unauthorized`；带正确凭据 ⇒ **200**；错凭据 ⇒ **401** | 三态各就各位 | 不带凭据也 200（鉴权门失效） |
| V2 | `POST …/write/plan?token=…`：`planId` = 64 位 hex 且同入参重放**一致**；`steps[].commandText` 含**具体端口**、**无通配符**；调用前后 `netsh … show v4tov4` 条数**不变** | 见左 | 命令里出现 `*` 或 `reset`；只读调用后条数变化 |
| V3 | `apply(add)`（`confirmed:true` + 票据）⇒ `status:"ok"`、`executed` 含 `portproxy-add`+`firewall-add`；`portproxy` **19→20**、我方防火墙 **0→1**（规则为 `-LocalPort <port>`，**非通配符**） | 三处同时变化 | 建出通配符规则 / 他人 19 条被动过 |
| V4 | 同端口 `apply(remove)` ⇒ `portproxy` **20→19**、我方防火墙 **1→0**、该端口规则行 **0**，且 `netsh … show v4tov4` 全文 SHA-256 回到 V2 之前 | 逐字节回到写前 | 残留规则 / 条数不回落 |
| V5 | `apply` 不带 `confirmed:true` ⇒ **403**；随后 `GET …/write/audit?token=…` 的 `size` **不变**（拒绝不记账） | 403 + size 不变 | 被拒绝的 apply 也进审计环 |
| V6 | 🟡 **已迁出**（判据原文在 [009 的迁入记录 §3](../009-write-ui/tasks.md)）：客户端确认对话框的真机 UI 复核 + 结果四态分色 ⇒ **见 [009-write-ui 的 V6–V8](../009-write-ui/tasks.md)**；**编号 V6 保留为空位** | 见 009 | 页面上**点得到**写入口却**没有**对话框 ⇒ 回归 |

⚠️ **未验（如实）**：① 本节（V1–V5）**尚未整份跑过**（V1–V5 的等价断言由 T2.8/T2.10 当场验过，但**不是**在「按本清单逐条」的形式下）；②③④（V6 的离线/真机、`writeToken` 未配置时的 401 fail-safe、`passby` 降级为 `ask`）**原文已迁至 [009 的迁入记录 §5](../009-write-ui/tasks.md)**。

## ✅ T3.1 客户端写前确认对话框：离线完成（2026-10-12）—— **施工清单 / 八条契约 / 真机未验项已整体迁至 [009-write-ui](../009-write-ui/tasks.md) 的「迁入记录」§1（只迁位置、不删内容）**

- **判据（留痕）**：`tsc -p tsconfig.json` **exit 0**；全包 `node --test --test-concurrency=1 "tests/**/*.test.ts"` **386/386（0 fail）**；`vitest run` **75/75**（7 文件；新增四份共 **44** 条：`write-token` 10 / `write-channel` 11 / `write-confirm` 12 / `write-panel` 11）；`lib/client.js` 由既有 esbuild 脚本重建 **123,207 B**（首行自注册形态未变）。
- **顺带对齐复选框**：T2.4 / T2.5 / T2.6 / T2.8 已按真机 PASS 记录勾选；**T2.7 留空**（正文无任何 PASS 记录 ⇒ 其**专属**判据见上面的 **T2.7 未勾选子项**）。**UI 面（原 T3.2 / V6 / 配置页凭据按钮）归 [009-write-ui](../009-write-ui/README.md)**。
