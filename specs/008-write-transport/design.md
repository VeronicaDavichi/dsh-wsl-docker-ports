# 008 写入通道 —— 设计

> 需求见 [requirements.md](./requirements.md)。本设计只覆盖**通道**：路由、动作计划、确认、执行、审计。写算法（005 `src/write/`）、提权后端（005 `src/elevate/`）、读模型与 diff（003）**一行不改**，只被调用。

## 1. 分层与文件

| 层 | 位置 | 职责 | 归属 |
| --- | --- | --- | --- |
| 路由 | `packages/wsl-docker-ports/src/transport/routes.ts` | 前缀注册 / 方法判据 / 错误码 / disposer | 本 Spec |
| 计划 | `src/transport/plan.ts` | 声明式目标 → 动作清单（只读） | 本 Spec |
| 确认 | `src/transport/confirm.ts` | 计划指纹 + 一次性票据（A 闸门） | 本 Spec |
| 执行 | `src/transport/apply.ts` | 调 005 提权链、逐步结果、幂等、回滚上报 | 本 Spec |
| 审计 | `src/transport/audit.ts` | 内存环形 + 单行日志（B 留痕） | 本 Spec |
| 复用 | `src/write/*` · `src/elevate/*` · `src/diff/*` · `src/read/*` | 算法与后端 | 005 / 003 |

## 2. 路由

- **前缀**：`/dsh-wsl-docker-ports/write`（**不带尾斜杠**）。
  - 为什么嵌在 003 的前缀之下：宿主分派顺序是 **exact → 最长 prefix → fallback**，故更长的前缀优先命中本通道，003 的 `/snapshot` 处理器**不会**看到本通道的路径（零改动 003 代码）。
  - **反例即回归用例**：前缀一旦带上尾斜杠 ⇒ 注册成功但**永不被分派**（真机实证见 §10）。单测必须钉住这条。
- **端点**（全部在 `ctx.inject(['webServer'], …)` 之后注册，幂等，disposer 进 `ctx.effect`）：

| 方法 | 路径 | 语义 | 可否写系统状态 |
| --- | --- | --- | --- |
| `POST` | `…/write/plan` | 由声明式目标算动作计划（REQ-2） | **否**（零副作用） |
| `POST` | `…/write/apply` | 执行（需 `planId` + `confirmed:true`，REQ-3/4） | 是（经提权链） |
| `GET` | `…/write/audit` | 审计尾部（REQ-5） | 否 |

- **错误码**：404 `not-found` / 405 `method-not-allowed` / 503 `rules-unavailable`（读模型或提权链不可用）/ 500 `internal`；**先判路径、后判方法**。`Content-Length` 按 UTF-8 字节算，`Cache-Control: no-store`。

## 3. 动作计划（只读）

输入（声明式目标）：`{ ports: number[], scope: 'local'|'lan', action: 'add'|'remove'|'fix' }`。

输出：`{ planId, steps: [{ port, scope, listenAddress, connectAddress, firewall, commandText }], commandCount, notes[] }`。

- 端口先经**所有权集合**过滤（REQ-2.4）：集合外 ⇒ `port-not-managed`，零动作。
- 非法输入（越界 / 未知作用域 / 非法动作）⇒ `steps: []` + `notes[]` 说明（REQ-2.3），**不返回 400**（与 003 读侧口径一致：非法值回落最保守默认，但写侧额外要求**拒绝执行**）。
- `planId` = 规范化计划的 SHA-256（前 16 hex）。规范化 = 端口升序、键序固定、剔除 `notes`。

## 4. 确认闸门（A）

1. `plan` 返回 `planId` + 逐条 `commandText`（用户要看到**将执行的命令原文**）。
2. `apply` 的请求体只允许携带 `{ target（同 plan 的声明式目标）, planId, confirmed: true }`。
   - 🔴 **绝不接受客户端传来的命令 / 规则文本** —— 服务端用 `target` **重新推导**计划，再比对 `planId`；不一致 ⇒ `409 plan-stale`（或 `plan-mismatch`），零执行。这是本通道唯一的安全命门。
   - `confirmed !== true` ⇒ `403`/`confirm-required`，零提权零写入（REQ-3.2）。
3. 确认票据：一次性 + TTL（默认 **120 s**） + 绑定 `planId`；重复使用 ⇒ 拒绝。票据只存在内存，不落盘、不进日志（REQ-4.4）。
4. Agent 触发一律降级 `ask`（REQ-3.4）：来源由调用方标注（`origin: 'agent'|'user'`），`agent` 时**不允许**跳过确认，且审计里如实记录来源。
5. **与 OS 弹窗解耦**（REQ-3.3）：闸门完全在应用内；后端是 `gsudo` 缓存命中、`native` 还是 UAC 不弹窗，都走同一条确认路径。

## 5. 执行（调 005）

- 顺序：`读现态（003）→ 算差量（003 diff）→ 逐条执行（005 提权链）→ 逐步回传`。
- **幂等**（REQ-4.2）：执行前现读，已满足的规则标 `skipped` 而不是重写；重复 `apply` 不增条数、不报错。
- **失败**（REQ-4.3）：按 005 REQ-3.5 的清理语义回滚本轮已建规则，回传 `{ executed, rolledBack, skipped, failed }`。
- **响应不含凭据**（REQ-4.4）：命令原文里只允许出现端口/地址/组名；出现 `password|token|secret|key` 形态的串即测试失败。

## 6. 审计（B）

- 结构（每条）：`{ at, origin, elevationPolicy, backend, ports, scope, action, result, exitCode, durationMs, rolledBack }`。
- 落点：**内存环形（最近 N=100）+ 单行人类可读日志**（`ctx.logger`）。🔴 **不写台账文件** —— 端口所有权是**声明式**的（AGENTS.md 冻结决策：不建台账文件、不用 `reset`），审计不是例外。
- 敏感词扫描：`password|passwd|token|secret|credential` 命中即测试失败（REQ-5.2）。

## 7. 安全与红线

- 只读入口（`plan`）**零副作用**：不调提权、不写盘、不动 `netsh`。
- 所有权集合外**一律不碰**（REQ-6.1）；真机验收断言「他人 19 条**逐字节不变**」。
- 无 `portproxy reset`（REQ-6.2）；防火墙规则 `-LocalPort` 必须具体端口，**禁通配符**。
- 卸载不清理（REQ-6.3，迁自 005）。

## 8. 测试策略

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 单测 | `vitest`（假 `webServer` + 假提权后端） | 路由匹配/方法/错误码、前缀尾斜杠反例、计划零副作用、未确认零调用（spy 全 0）、planId 不匹配拒绝、幂等、审计字段与敏感词 |
| 契约 | `node --test`（离线 fixture） | 响应形状、`Content-Length` 字节精确、`no-store` |
| 真机 | 探针 profile（**白名单：不得用 `desktop` / `web`**，用完逐字节还原） | `plan` 前后 `netsh` 逐字节相同（G1）；真写入一轮后「他人 19 条不变」+ 幂等（G5）；审计落一行（G6）；路由真被分派（G4，须见我们的 JSON 而非宿主兜底 404） |

## 9. 分期

1. **P1 只读**：路由骨架 + `plan` + `audit`（零写入）—— 先把 G1/G3/G4 拿到手。
2. **P2 执行**：`apply` + 确认票据 + 幂等 + 回滚上报（G2/G5）。
3. **P3 界面**：客户端接线（确认对话框展示命令原文 + 结果逐步反馈）—— UI 验收按主人环境自验清单。

## 10. 接口契约（Phase 0 侦察结果 · 2026-10-09 · 全部为文件:行 实证）

**路由（T0.2）** —— 已在 003 里落地、本通道**复用同一套**：
- `route.ts:115 isWebServerSurface(value: unknown): value is WebServerSurfaceLike`
- `route.ts:138 pathOf(url: string | undefined): string`
- `route.ts:173 registerPortsRoute(ctx: RoutePluginContextLike, builder: SnapshotBuilder): PortsRouteRegistration`
- `wire.ts:37 PORTS_HTTP_PREFIX = '/dsh-wsl-docker-ports'`（**无尾斜杠** ✓）· `wire.ts:104 PortsErrorCode = 'not-found' | 'method-not-allowed' | 'rules-unavailable' | 'internal'`
- 真机证据（2026-10-09）：前缀带尾斜杠 ⇒ 注册成功但**永不被分派**（宿主兜底 404、零报错）；去掉后同一请求得到我们的 JSON ✓

**提权链（T0.1）**：
- `elevate/backend.ts:235 detectBackend(deps)` · `:317 probeElevationAvailability(deps)` · `:352 createElevationAvailabilityProbe(deps)` · `:375 resolvePolicy(policy: ElevationPolicy, source: RequestSource): ElevationPolicy`
- `elevate/invoke.ts:85 buildInvocation(plan: …)` · `:28 DEFAULT_ELEVATE_TIMEOUT_MS = 90_000` · `:44 looksLikeUacRejection(…)`
- `elevate/outcome.ts` `parseElevatedOut(text | null)` · `ELEVATE_EXIT`（提权失败 999 ✓）

**写步骤构造器（直接给 T2.5 / T2.7 用）**：
- `write/firewall.ts:34 firewallRuleName(port)` · `:53 firewallAllowArgs(port)` · `:81 buildFirewallAddStep(port)` · `:100 buildFirewallDeleteStep(port)` · `:121 looksLikeWildcardAllow(text)` ⇒ T2.7 的「无通配符」红线**不用自己写正则** ✓
- `write/cleanup.ts:89 buildCleanupManifest(input)` · `:110 buildCleanupSteps(input)` ⇒ T2.5 的回滚清单 ✓

**所有权集合与读模型（T0.3）** —— 链为**声明式**，与「不建台账文件」的冻结决策一致 ✓：
```
调用方声明（query managedPorts / settings）
  → wire.ts:224 parseSnapshotQuery（读 QUERY_MANAGED_PORTS）
  → snapshot.ts:161 parseManagedPorts(declaration.managedPorts)
  → diff/managed-ports-parse.ts:140 parseManagedPorts(decls): ManagedPortsParseResult   // MIN_PORT 1 / MAX_PORT 65535
  → diff/engine.ts:206 diff(input): DiffOutcome · :67 expectedListenAddress(scope)
  → diff/expected.ts:41 buildExpectedForwards(…)
```

**写请求/报告的既有类型（本通道直接复用，不新造口径）**：
- `client/host.ts:124 ForwardAction = 'apply' | 'remove' | 'fix-drift' | 'switch-scope'` · `:126 ForwardWriteRequest` · `:134 ForwardWriteReport` · `:146 ElevationInvoker`（**正是 005 `plugin.ts` 记的那个缺口** ✓）
- `client/page.ts:46 writeGate(snapshot)` · `:192 summarizeWriteReport(…)`
- `wire.ts:74 SnapshotDeclaration { managedPorts, scopes, elevationPolicy }` ⇒ 本 Spec 的 `target` 就是它的写侧对偶 ✓

## 11. T1.3 落地补充（2026-10-09 · 实证）

**🔴 结论：计划算法不用重写** —— 005 的 `write/plan.ts:345 buildWritePlan()` 已是唯一真相，且**本身就带** `steps[].commandText`（REQ-3.2 展示命令原文）与 `port-not-managed` / `eth0-unknown` 等拦下原因
（`write/types.ts:56 WriteBlockReason`），`WriteBlock.steps` 是**空元组**（前置不满足 ⇒ 一个动作都不产生，类型层就说死）。 ⇒ 008 的 T1.3 只是**薄包装**：`src/transport/plan.ts` 做四件事 —— 白名单解析目标、注入现读事实、
规范化 + `planId`、盘成 DTO。

**安全命门（有测试钉死）**：目标只认 `action` / `ports` / `scope` / `fromScope`。所有权集合 （`managedPorts`）、`eth0Ip`、既有规则、防火墙规则名**一律服务端现读** —— 客户端伪造
`managedPorts:[{start:1,end:65535}]` 也**不能**把 9999 变成「我管的」（实测仍 `port-not-managed`）， 伪造 `eth0Ip` 也不会进 `connectaddress`（实测用服务端现读值）。

**`planId` 口径（与 §2 一致，无订正）**：`SHA-256(canonicalPlanText)`，规范文本**只含会改变系统状态的东西** （`action` / `scope` / `fromScope` / 端口**升序** / 每步 `kind`+`port`+`params`**按键升序**），
**不含** `notes` / `commandText` ⇒ 文案微调不换 id，任何一步实质变化必换 id（有六条断言钉死）。 `planId` **只在全部端口都可执行且非空时**才给；被拦下 ⇒ `null`（没有可用票据）。

**判据覆盖**：`tests/unit/transport-plan.test.ts` 7 条 ✔（含变异自证：去掉升序排序 ⇒ 排序用例必红）。

## 12. 所有权集合的来源：方案 (a)（2026-10-09 · **需主人确认的口径**）

**决策**：写通道的 `target` 仍只认 `action` / `ports` / `scope` / `fromScope`（🔴 因此客户端伪造 `target.managedPorts` **无效**，有测试钉死）；所有权集合另走一个**显式 `declaration` 字段**
（`{start,end}[]`，最多 64 个区间）—— 与 003 的 `snapshot?managedPorts=…` 同构，不另开口径。

**缺省语义**：请求没给 `declaration` ⇒ 交给接线方的是 `undefined`（不是空数组）：
- 给将来的 **host 侧默认值**（读 profile settings）留接口 ⇒ 方案 (c) 的升级路径已经预埋；
- 接线方默认按**空集**处理 ⇒ 一切都 `port-not-managed`。**失败方向永远是最保守的「什么都不做」**，
  绝不因为「没声明」而放宽。

🔴 **显式假设（请主人拍板）**：所有权集合是**用户自己声明的护栏**，**不是**防恶意本地调用者的信任边界 —— 持有 token 的调用方可以把 `declaration` 写宽（这与 003 完全一致）。**真红线在 (a)/(c) 下都成立**：
绝不 `portproxy reset`、绝不碰集合外规则、绝不建通配符规则、卸载不删东西。 若要求字面做到「调用方无法写宽集合」⇒ 改走 **(c)**：host 读 `ctx.settings` 优先、请求声明回落。

**判据**：`tests/unit/transport-plan.test.ts` 共 8 条 ✔（含变异自证：把缺省退化成空集 ⇒ 声明用例必红）。

## 13. Phase 2 侦察：现读件的接口契约（2026-10-09 实测导出面）

接 `deps.writeFacts` 前必须照单对接（全部已在 003/005 存在，**不新写探针**）：

| 事实 | 来源 | 签名/形状（实测） |
| --- | --- | --- |
| `rules(port)` | `read/netsh-probe.ts` | `PortproxyOutcome = PortproxySuccess \| ProbeFailure<NetshProbeReason>`；`NetshProbeReason = 'netsh-missing'\|'timeout'\|'non-zero-exit'\|'parse-error'\|'unexpected'`；`NetshProbeOptions{timeoutMs?}` |
| `eth0Ip()` | `read/eth0-source.ts` | `createEth0Source(executor, distro, distros, options) ⇒ Eth0Source`（另有 `Eth0ProbeOverride` / `Eth0SourceOptions`） |
| `localhostForwarding` | `read/localhost-forwarding.ts` | `LocalhostForwardingOutcome = LocalhostForwarding \| ProbeFailure<'config-unreadable'>`；`LocalhostForwardingSource = 'default'\|'explicit'\|'fallback'` |
| `elevation()` | `elevate/backend.ts` | 🔴 `ElevationAvailability = { available: boolean; backend: ElevationBackend \| null; reason: string }` —— **没有 `policy`** ✗；策略要向 `resolvePolicy(policy: ElevationPolicy, source: RequestSource)` 要（`ElevationPolicy = 'none'\|'ask'\|'passby'`，`RequestSource = 'user'\|'agent'`）⇒ 🔴 **写通道必须按触发方算策略**（Agent 触发一律降级 `ask`，REQ-4.5） |
| 计划入参 | `write/types.ts` | `WritePlanInput { action, port, scope, managedPorts, eth0Ip: string\|null, rules: readonly PortproxyRule[], portState?, fromScope?, localhostForwarding?, existingFirewallNames? }`（**复核通过**；`eth0Ip=null` ⇒ 不产生任何动作） |

🔴 **陷阱留痕**：`elevation()` 里**不能**自己造 `policy` —— 必须走 `resolvePolicy`，否则 Agent 触发会拿到用户档策略而**绕过降级**。

## §14 T2.2/T2.3/T2.4 接线蓝图（2026-10-09 实测签名，落地时**无需再侦察**）

**实测接口**（`elevate/types.ts:111/123/138`、`elevate/runner.ts:118/359`）：

    ElevateRequest = { plan: { ok:true; action; port; scope:'loopback'|'lan'; eth0Ip; steps: WriteStep[]; commandText },
                       policy: ElevationPolicy; source: RequestSource }
    ElevationDeps  = { executor; snapshot?; probeBackend?;
                       confirm?: (req: ConfirmRequest) => Promise<boolean>;   // 不注入 = 按拒绝处理
                       writeFile?; readFile?; removeFile?; tempDir?; randomSuffix?; … }
    defaultElevationDeps(executor) ⇒ { executor, snapshot }（已实现，勿重写）
    ConfirmRequest = { action; port; commandText; steps; reason:'policy-ask'|'agent-passby-downgraded'; message }
    runElevate(request, deps): Promise<ElevateResult>（policy='none' ⇒ SHALL NOT 提权；空 steps ⇒ no-actions）

**票据坐在 `deps.confirm` 位上**：票据有效 ⇔ 「用户已确认命令原文」⇒ `confirm: async () => true`； 无票/错票/过期 ⇒ **根本不到 `runElevate`**，或注入 `confirm: async () => false` ⇒ 005 按拒绝处理 ⇒ 零提权。

**逐文件改法**
1. `transport/plan.ts`：`PlanResponse` 增 `confirm:{ ticket: string; expiresAt: number }`（由 `createConfirmTickets` 签发， 绑定本响应的 `planId`；同一 `planId` 重复规划 ⇒ 旧票作废）；`confirm` 不进 `canonicalPlanText`（不参与 planId 计算）。
2. `transport/routes.ts`：apply 依赖签名加 `ticket`（从请求体白名单取，**只加一个字段**，path-first/method-second 与 405/404 语义不动）。
3. `transport/wire-plugin.ts`：`apply` = ① 重规划（同一 facts）⇒ 得 `planId`/`steps`/`eth0Ip`/`commandText`； ② **票据门**：`consume(planId, ticket)` ⇒ `unknown`/`mismatch`/`expired` 各自错误码 + **零执行**；
③ `facts.firewallNames` 存在性闸门（T2.6）：下发**前**再读一次规则名，目标名已在 ⇒ **整单不下发**（`no-actions` + 全部步骤进 `skipped`、零命令、零审计）； ④ 通过 ⇒ `runElevate({ plan, policy: facts 的 policy, source: origin }, { ...defaultElevationDeps(executor), confirm: async () => true })`；
   ⑤ 失败 ⇒ **回滚**刚加的 portproxy（红线：**他人规则条数不变**）⇒ 结果如实回传；⑥ **审计**只记**真正发生过的动作**（执行/回滚/结果），**被拒绝的 apply 不记**（主人 2026-10-09 裁定）。
4. 单测（离线、零真机）：票据门四种结果；无票 ⇒ **零提权零写入**；执行失败 ⇒ 回滚被调用；拒绝 ⇒ **不进审计环**。
5. 双门 ⇒ 真机：`plan` ⇒ `apply` ⇒ 断言 `netsh` **19→20** ⇒ `remove` ⇒ 断言 **19**（**同一条命令内连做**，不留多余规则） ⇒ 逐字节还原 `volatile-probe` + 红线段复核（`netsh`=19、防火墙=811、node 回基线、端口空闲、软链 0、frozen exit 0）。

**已具备的前提**：T2.1 票据（`transport/confirm.ts`，5 条判据全绿）；plan 侧真机已验（`planId` 三语义、命令原文可见、所有权闸门）。
**缺口现状（2026-10-09 补丁轮订正）**：`firewallNames` **已接**（新 `read/firewall-probe.ts` 只读 `Get-NetFirewallRule`；读不到/读不懂 ⇒ 抛 ⇒ 503 / 拒绝执行）⇒ REQ-2.6 有**两层**：计划阶段 `firewall-rule-exists` + `apply.ts` 执行前闸门；`portState` 仍无读取件 ⇒ 该门未启用（偏保守，不因本次而变）。
