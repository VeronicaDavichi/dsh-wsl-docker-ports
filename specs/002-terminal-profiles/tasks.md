# 实现任务：dsh-terminal-profiles 受管终端

> 任务引用 [requirements.md](./requirements.md) 的 REQ-N；设计依据见 [design.md](./design.md)。
> 完成定义（每个任务）：代码 + **验证命令跑绿** + 无遗留注册/监听/进程。
> 口径：`pnpm -C packages/terminal-profiles {typecheck,test,build}`。

---

## Phase 0：前置（阻塞项，必须先打掉）

- [x] **T0.1 [REQ-2.1]（B-1 行为链确认）`volatile` 端到端行为验证** —— **2026-10-08 五条全部定案**
  - **前置结论（2026-10-08，宿主源码实证，不必重验）**：整数组标 `.volatile()` **机制成立** —— `equal()` 首行 `if (schema?.meta?.volatile) return true`，递归到 `profiles` 键时立即判等；`.volatile()` 定义在 schemastery 的 `Schema.prototype` 上、不挑类型。依据见 [stack-decision.md](../../stack-decision.md) 的 `plugin.profileConfigLiveness.evidence`（含 app.asar 字节偏移）
  - 内容：最小插件 `profiles` 整数组标 `.volatile()`，跑以下 5 条（**证伪导向**，不再问「是否生效」）：
    1. ✅ **2026-10-08 真机定案**（临时 profile `volatile-probe` + 一次性探针插件，`--port 0`）：`settings.update('volatile-probe', { profiles: [{ name: 'a', cwd: 'C1' }] })` → **152ms 成功**；`applySeq 1→1`（**无** dispose/apply）**且** volatile 引用 `.get()` 从 `seed` 变 `C1`（**值真传播**）⇒ **不重挂载成立**。⚠️ 两个诚实的限定：① 该实例没产生日志文件，故 `loader/volatile-update` **事件名未经日志直接观测**（以「无重新 apply」为代理证据）② 「PTY pid 不变」由真实插件在自己的验收清单里补测（探索探针没有 PTY）
    2. ✅ **2026-10-08 真机定案**（对照组）：把 ordinary `label` 从 `L0` 改成 `L1`（volatile 部分逐字不变）→ **apply #2** ⇒ 判定在工作、**不是恒真**。附带：向 patch 层写入**完全相同**的内容 → **不触发任何更新**（无差异即无动作）
    3. ⚠️ **2026-10-08 真机部分定案**：写非法 config（`label: 42`，schema 要求 string）→ **不崩**（心跳持续）、**applySeq 不变**、旧值保留（该值来自 patch 层，校验在到达 volatile 提交前就被拒）⇒ 宿主**静默拒绝**非法值。**但原预期的「`_commitVolatile()` 失败后回落 remount」本次未被命中**（走的是 patch 层而非 live 写入路径）→ 该分支留待真实插件在 settings 写入路径上复测
    4. ✅ **2026-10-08 离线定案**（直接 require `@deepseek-ai/schemastery`）：标到**数组元素内** → **构造不抛错**，**parse/校验时抛 `ValidationError`**，原文 `$.profiles.*.cwd volatile fields require a fixed object path without an enclosing volatile field`（原措辞「预期构造时抛错」已订正；判定走 schemastery `validateVolatileSchema`）
    5. ✅ **2026-10-08 离线定案**：`config.profiles` **不是裸数组** —— `Array.isArray=false`、`typeof .get === 'function'`、下标 `profiles[0]` 为 `undefined`、`.get()` 值**深冻结**（`isFrozen=true`）→ **本 Spec 读配置必须走 `.get()`**
  - 验证：5 条各留一行证据（日志 / 错误原文 / 类型探测结果）→ 回写 design.md §4.1 与 requirements A-1。**5 条全部有证据**：第 4/5 条离线（schemastery 直跑）、第 1/2/3 条真机（临时 profile + 探针插件）。**额外真机发现（已另立 T0.6）**：`settings.update` 的值**没有落盘** —— 重启后 volatile 值回到 patch 层的旧值，全盘找不到 `settings.*` 文件
- [x] **T0.6 [REQ-2.2] `settings.update` 的落盘语义**（2026-10-08 真机新发现 → 当日定案）
  - 内容（当时待查的三问）：已知写入实时生效，但不知道**落没落盘** → ① settings 文档在什么条件下才创建/写入 ② 是否依赖**优雅退出** ③ 若确实只活内存，则「改配置不杀终端」**必须**另配落盘路径，否则重启即丢
  - 验证：`node --test` 契约测试 + 真机重启对照（优雅停止 vs 强杀各一次）；结论回写 design.md §4 与 requirements A-6
  - ✅ **2026-10-08 当日定案（结论：不是问题）**：`settings.documentPath` 直读出 settings 文档**就是** profile 的 `cordis.patch.yml`，`writable = true`；`settings.update` 后 **3s（进程仍在运行）文件内容已更新** ⇒ **立即落盘**（非退出时刷）；**重启后值被正常加载**（`[a,C1]` 复现）⇒ 「改配置不杀终端」+「改完不丢」双闭环，**不需要**额外落盘路径。⚠️ 我先前「不落盘」的判断是**自伤假阳性**：对照步手写了同一个 patch 文件（`profiles: seed`）把它覆盖了 —— 教训：**同一文件既是 patch 层又是 settings 落盘处，实验里不能再手写它**
  - 若第 1 条被推翻（真机不生效）：REQ-2.2 从安全网升级为主路径（弹确认框），**不假装无痛**
  - 🔴 红线：plugin config schema **必须用 Schemastery**。`equalExceptVolatile` 先做 `isSchemastery()`，非 Schemastery（Zod 等）直接退化为 `deepEqual` → volatile **静默失效**、每次保存都重挂载

- [x] **T0.2 基线能力复核（0.2.0-rc.2）· ✅ 2026-10-09 关闭（只读源码复核 = 等价取证；残余真机项并入 T0.5）**
  - 内容：确认 `ctx.subprocess.spawnTerminal` 的 spec 形状（`argv`/`cwd`/`env`/`rows`/`cols`/`terminalType`）、`ctx.sidebarRightTabs` + `ctx.sidebarRight.openTab`、`ctx.webServer` 具名路由与 upgrade、`ctx.sandboxPolicy`、`ctx.settings`、`ctx.configEditor.edit()`、`dsh-tools` 的 `defineTool` 均存在
  - **2026-10-08 部分结论（源码实证）**：`ctx.settings` ✅、`ctx.configEditor.edit()` ✅、`dsh-config-editor` 插件 ✅ 均存在；🔴 **`ctx.settings.register(ns, schema)` 已移除**（全包 0 命中，2026-10-09 复跑再证）→ schema 改由模块**静态 `Config` 导出**、命名空间 = **patch 条目 id**；live 字段走 `settings.{update,replace,mutate}`，`configEditor.edit()` 是**完整配置**路径（**会重挂载**）
  - **2026-10-09 补齐**：上述 7 项能力**全部核实存在**，契约逐条写入 [design.md](./design.md) §11（含 🔴 `resize(cols, rows)` **列在前且不夹紧**、失败**一律调用端抛错**、`cwd: undefined` 落**宿主进程 cwd**、Windows 上 `shellActivity:true` 是**反效果**、`@xterm/*` 必须**自声明依赖**、路由注册**必须 effect 收编**且**重复注册抛错**、`sidebarRightTabs` 属**浏览器侧**故 Host 拿不到）
  - 验证：✅ 结论已回写 design §11 与 README；**残余真机项**（node-pty 失败文案、ConPTY containment 强度、`resize` 越界行为、宿主对非法配置值的静默 vs 致命）**并入 T0.5**（需主人在场）

- [x] **T0.3 [REQ-7.1][REQ-7.6] 路由注册与卸载 · ✅ 2026-10-09 关闭（源码定案；真机行为项并入 T0.5）**
  - 前置结论（源码，2026-10-08）：匹配顺序 **exact → 最长 prefix → fallback**、注册顺序无语义、fallback 单座位且只答「无具名路由匹配」的请求 → **SPA 抢不走我们的具名路由**；**但 `registerUpgrade` 只接受 exact path** → 原「独占前缀的 upgrade 路由」写法被推翻，REQ-7.1 已修正
  - **2026-10-09 补齐（源码，宿主 0.2.0-rc.2）**：① 重复 `(kind, path)` **抛** `duplicate <kind> route "<path>"`（不覆盖）⇒ 禁用→启用必须靠 **effect disposer** 释放；② disposer 是**普通返回值**，宿主**不自动回收**、服务关闭时也**不清表** ⇒ **三处注册（HTTP/upgrade/tools）都必须 `ctx.effect(...)` 收编**（官方 5 个调用点无一例外，其中 `dsh-api-gateway` 是 generator 形态）；③ **generator 体**（逐 `yield`）在中段抛错时**会回滚**已收集的 disposal，**普通函数体只收编返回值**、体中段抛错**不回收**已发生的副作用 ⇒ 多路由注册优先用 generator 形态
  - 真机验证项（证伪导向，**并入 T0.5**）：① 注册 `/dsh-managed-terminal/ping` 能**被命中**（返回我们的响应，而非官方 404 / 405）② **卸载后**该 path 回落到官方 fallback（REQ-7.6）③ 重复注册同一 path 确认**抛**（源码已证，真机复证）④ upgrade 端点以 **exact path** 建连成功
  - 验证：源码侧 ✅ 已回写 design §11；真机项（命中 / 卸载回落 / 建连）**待 T0.5**

- [x] T0.4 [REQ-全]（原阻塞 B-2，全线共用）6 项 `backend.*` 的 `confirmed: implied` 由主人逐条点头 —— ✅ **2026-10-08 确认全为 `none`**，结论记入 [stack-decision.md](../../stack-decision.md) 的「复核记录（已闭环）」
  - 验证：`stack-decision.md` 的 `pendingReview` 清空；本 Spec 不因此改动（全为 `none`）

- [ ] T0.5 [REQ-13.1][REQ-13.2][REQ-13.3][REQ-13.4] 安装接入验证（D-1）
  - 内容：按 `link:<绝对路径>` 写入 profile `package.json` 的 `dependencies` + `dsh.profile.bundles`（与同机 `@xxxyz/dsh-mcp-manager` 同型），`pnpm install` 后重载
  - 验证（真机，二值）：① 行出现在 profile 行列表 ② 终端页 kind 已注册 ③ **无** compatibility 预检 `disabled`（宿主 stderr 无 `disabling profile plugin`）④ 卸载后行消失、路由/页/工具注销、patch 无孤儿条目 ⑤ README 已明示 `link:` 模式「**路径即版本**」的开发工作流（改源码 → 重载/重启生效）

> **Phase 1 与 Phase 0 门的关系（2026-10-09）**：T1.1–T1.3 是**纯配置模型**（零 `ctx.subprocess` / `ctx.webServer` / `ctx.settings`、零真机），故 T0.2 / T0.3（只读核对中）与 T0.5（需真机改 profile + 重启）**未打掉也能独立落地** —— 本包不消费 Phase 0 的任何宿主 API 结论。

---

## Phase 1：配置模型与容错

- [x] T1.1 [REQ-1.1][REQ-1.2][REQ-1.3] `parseProfiles`
  - 内容：schemastery 声明 + 单条容错（跳过无效项并记警告）、重名拒绝、缺省 `args: []`/`env: {}`
  - 验证：`vitest` 覆盖 —— 有效项、缺 `command`、类型错、重名、空数组、全无效；断言无效项**未**影响其余项
  - ✅ **2026-10-09 落地**：`parseProfiles` 逐条容错全绿（正常/边界/异常三类）；`createProfilesSchema(注入的 z)` 只声明 `profiles` **整数组** `.volatile()`、元素用 `z.any()` —— **刻意不在 schema 层校验条目**（schemastery 按整数组校验 ⇒ 一条坏会让整数组失败，与 REQ-1.2 冲突；零依赖 ⇒ 不 import schemastery，Phase 6 的静态 `Config` = 一行包装）

- [x] T1.2 [REQ-1.4] `cwdLinux` 推导接线（消费 001）
  - 内容：只填 `cwd` 时经 001 的 `winToWsl` 推导；失败 → 该条标「需修复」且不可启动
  - 验证：`vitest` + fake 001 —— 推导成功、推导失败（`UnmappablePath`）、显式给了 `cwdLinux` 时不推导（不覆盖用户输入）
  - ✅ **2026-10-09 落地**：`deriveCwdLinux` 只包 `winToWsl`（真 001 验 UNC/裸盘符/`E:x` 形态 + fake 001 验「何时调、何时不调」）；显式 `cwdLinux` **不覆盖**、非 WSL **不**推导；失败 → `needsFix` 带 001 错误码 + 不可启动

- [x] T1.3 [REQ-1.5] 空配置引导态
  - 验证：`vitest` 渲染断言 —— 无 profile 时显示引导、不报错
  - ✅ **2026-10-09 落地**：`deriveConfigState` 出引导/就绪判定与文案；Phase 1 是纯模型层（React 在 T4.x）⇒ 本 Phase 的「渲染断言」= 对判定与文案的断言，`empty`/`all-invalid`/`all-needs-fix` 三态均不抛错

---

## Phase 2：Host PTY 与屏幕模型

- [x] T2.1 [REQ-3.1][REQ-3.2][REQ-3.4] session-manager 起实例
  - 内容：`spawnTerminal({ argv:[command,...args], cwd: cwdLinux ?? cwd, env, rows, cols, terminalType })`；每次启动新实例
  - 验证：`vitest` + fake spawnTerminal —— spec 字段逐项断言（含 WSL profile 用 `cwdLinux`）；同 profile 两次启动 → 两个不同 id
  - ✅ **2026-10-09 落地**：`src/session/{types,errors,spawn-spec,manager}.ts`。spec 六字段 `toStrictEqual` 逐项断言，另钉两条 design §11 陷阱：`'shellActivity' in spec === false`（Windows 上反效果）、`typeof spec.cwd === 'string'`（`cwd: undefined` 会落到宿主进程 cwd）。WSL 取 `cwdLinux`、只填 `cwd` 时经 001 推导（断言**与真 `winToWsl` 的结论对齐**，不抄字面量 ⇒ 翻译口径漂移会一起红）；非 WSL 取 `cwd`。id = `term-N` 单调计数 ⇒ 同 profile 两次启动得两个 id + 两个不同 handle，`list()` 按创建序。fake `ctx.subprocess` + fake handle（输出用真 `PassThrough`，与宿主传输形状一致）见 `tests/helpers/fake-pty.ts`

- [x] T2.2 [REQ-3.3][REQ-3.5] 失败路径
  - 验证：`vitest` —— cwd 不存在（fake 抛错）→ 错误含该路径且**未**回落工作区/`$HOME`；spawnTerminal 抛错 → UI 文案含原因且无幽灵实例
  - ✅ **2026-10-09 落地**：四条失败路径全绿（`session-manager.test.ts` / `session-resize-kill.test.ts`）——① cwd 不存在 ⇒ `spawn-failed`、message 含**该路径**与「未回落」，且 `spawnCalls[0].cwd` 就是那个坏路径（≠ `process.cwd()`、≠ `homedir()`，这是「不回落」的二值判据）② 程序不可解析 ③ 宿主以 **rejected promise** 失败（与同步抛同码同形状）④ 宿主返回空 handle ⇒ 全部收成可读错误且 `list()` 为空 —— **无幽灵实例**靠顺序保证：只有拿到 handle 才 `instances.set`。另证两条拒绝发生在**调宿主之前**（`spawnCalls.length === 0`）：WSL 无可用 cwd ⇒ `cwd-missing`、`needsFix` 条目 ⇒ `not-startable`（透传 001 错误码）。**夹紧自实现**：`resize(id, 30, 100)` ⇒ 宿主收到 `resize(cols=100, rows=30)`，断言**按位置**复查 `[cols, rows]` 且刻意用 `rows ≠ cols`（行列转置在 80×24 上看不出来）；**变异测试实证**：把 `manager.ts` 那一行的换序写反 ⇒ 3 条红（`expected [[30,100]] to strictly equal [[100,30]]`），改回 ⇒ 全绿

- [x] T2.3 [REQ-6.1][REQ-6.2][REQ-6.4] 屏幕模型与有界缓冲
  - 内容：`@xterm/headless` + serializer；`seq` 单调；双上限（块数/字节）FIFO 丢弃 + `dropped`
  - 验证：`vitest` —— 写入后快照含期望文本；超上限后 `dropped > 0` 且内存不随写入线性增长（块数 ≤ 常量）
  - ✅ **2026-10-09 落地**：`src/screen/{buffer,screen-model}.ts`，`@xterm/headless` **6.0.0** + `@xterm/addon-serialize` **0.14.0** 已写进本包 `dependencies`（宿主 `createLazyRequire` 按调用方解析 ⇒ 必须自声明；根 `pnpm-lock.yaml` 未动）。快照含期望文本 + 尺寸；TUI `\e[2J\e[H` 重画后**旧内容消失**（证明快照是 serializer 当前帧而非历史拼接）；`seq` = 下一号、从 1 起单调。**两条上限各自压到边界**：块数 `createTermBuffer(3,∞)` + 10 次 push ⇒ `blocks=3`/`dropped=7`/`oldestSeq=8`（不随写入线性增长）；字节 `(∞,10B)` + 4B×3 ⇒ `dropped=1`/`bytes=8`；单块本身超字节上限 ⇒ 它**自己**也被丢（有界优先）。⚠️ 实测订正：serializer **不传 `scrollback` 时吐出全部 scrollback** ⇒ 本包快照**永远显式**传该选项（REQ-6.2 的「有界」全靠它，默认 200 行、上限 1000）。另有 `tests/unit/session-utf8.test.ts`（3 条）钉住**跨块 UTF-8 解码**：把「中」（E4 B8 AD）切成两块发 ⇒ 快照仍是「中」；**变异测试**：把有状态 `StringDecoder` 换成逐块 `toString` ⇒ `'ok中!'` 变 `'ok\ufffd\ufffd!'`、2 条红

- [x] T2.4 [REQ-6.3] `lost` 语义
  - 验证：`vitest` —— `sinceSeq` 早于下界 → 返回 `lost: true` + 快照；`sinceSeq` 合法 → 只回增量块
  - ✅ **2026-10-09 落地**：`sinceSeq` 早于下界 ⇒ `lost: true` **并附快照**，且 `lost` 分支**没有 `chunks` 字段**（字面判据 `'chunks' in read === false`）⇒ 结构上不可能退化成「看起来像成功的空数组」；`sinceSeq` 合法 ⇒ 只回该序号起的块（`[2,3]`，不重复不遗漏）；`sinceSeq = nextSeq` ⇒ `lost:false` 且 **0 块**（「没有新输出」≠ 丢失）；缓冲被丢空后**下界 = 下一号** ⇒ 旧序号仍是 `lost`（不会把「空」当「没丢」）；`NaN` ⇒ 按下界处理、不崩。`ScreenIncrementalLost` 也带 `seq` ⇒ 消费方统一 `next = read.seq` 推进（否则丢失那一次没有推进值，两套写法迟早漂移）

- [x] T2.5 [REQ-6.5][REQ-5.4] 只读性
  - 验证：`vitest` —— 连续 `read` 后 PTY 的写入调用计数为 0（读不注入输入）
  - ✅ **2026-10-09 落地**：结构上保证 —— `read` 只调 `screen.snapshot()/incremental()`，本包不存在「读时写 PTY」的代码路径（`TerminalPtyHandle.write` 只在 `manager.write` 里被调）。行为上钉死：fake handle 计数，连续 5×(snapshot + incremental) + 缺省增量 + `scrollbackLines: 0` 之后 `writeCalls === []` **且** `resizeCalls === []`（读也不改尺寸），读后文本仍含期望内容；**对照组**证明 `write` 路径**会**调 `handle.write`（`['echo hi\r']`）⇒ 那个 0 不是「永远不会写」的假绿

---

## Phase 3：WS 通道

- [x] T3.1 [REQ-7.1][REQ-7.6] 路由与 upgrade 注册
  - 内容：`ctx.webServer` 具名路由 + upgrade；注册返回 disposer
  - 验证：`vitest` + fake webServer —— 注册/卸载计数归零；卸载后不劫持未知路径
  - ✅ **2026-10-09 落地**：`src/ws/routes.ts` —— `register({kind:'prefix', path:'/dsh-managed-terminal/'})` + `registerUpgrade({path:'/dsh-managed-terminal/ws'})`（upgrade **只能 exact**，多终端靠协议层 `instanceId`），两个 disposer **都经 `ctx.effect` 登记**；缺服务走非严格 `ctx.get('webServer')` + 自判（不 `static inject`）⇒ 不注册任何路由并给出原因。判据在 `tests/unit/ws-routes.test.ts`：只注册一次（fake 的宿主同名重复注册会抛错，`duplicateAttempts === 0`）、`ctx.effect` 恰好 2 次、`unload()` 后生效注册数 **2 → 0**、卸载前后 `/api/unknown` 都回落到官方行为（`handlerCalls === 0`）、前缀内未知名路径答 404（只答自己那一条）、dispose 幂等不会把计数减成负数

- [x] T3.2 [REQ-7.2][REQ-7.5] 握手校验
  - 内容：校验 `Origin` + 一次性短 TTL 令牌；list 路由同样校验
  - 验证：`vitest` —— 无令牌/错令牌/过期令牌/跨源 → 立即关闭且响应体**不含**实例信息；令牌只能用一次
  - ✅ **2026-10-09 落地**：`src/ws/auth.ts`（令牌表 + Origin 归一化 + `validateHandshake`，upgrade 与 list **共用同一函数** ⇒ 判据不可能漂移）+ `src/ws/upgrade-socket.ts`（拒绝即写固定文案响应再 `destroy`）。判据在 `tests/unit/ws-auth.test.ts`：无/错/过期/跨源/缺 Origin 分别为 401/401/401/403/403 且**立即关闭**；响应体断言用两根「哨兵串」（`inst-leak-canary` / `secret-profile-canary`）做 `not.toContain`，同时断言不含 101 头、不含 `Sec-WebSocket-Accept`、不回显令牌；令牌**只能用一次**（第二次 401；list 用掉后 upgrade 也 401 ⇒ 一次性是跨路由的）；合法路径的 `Sec-WebSocket-Accept` 与 RFC 6455 §1.3 官方向量一致且**不回显令牌**。**变异自证**：把 `redeem` 的过期分支改成恒 `ok` ⇒ 恰好 2 条过期用例变红，改回复绿

- [x] T3.3 [REQ-7.3][REQ-7.4] 重连续传与单活跃连接
  - 内容：重连带 `sinceSeq`；新连接顶掉旧连接（旧连接收 `error:'superseded'`）
  - 验证：`vitest` —— 断线重连后块连续无重复；并发两连接时旧连接被关闭且新连接正常收块
  - ✅ **2026-10-09 落地**：`src/ws/connection.ts` —— `attach` 带 `sinceSeq` 时走 `manager.read(incremental)`：区间在 ⇒ **先 `attached` 再按 seq 升序补发块**（跨连接的块 seq 全集连续、无重复），区间已丢 ⇒ `lost { snapshot }`（REQ-6.3）；顶替语义 = **顶掉旧的**（旧连接收 `error:'superseded'` 后 `destroy`），且**先顶后读** ⇒ 不存在两个连接都能写的窗口。判据在 `tests/unit/ws-resume.test.ts`：重连后 `[1,2] + [3]` 连续无重复（`Set` 去重后长度相等）、`lost` 附完整快照且 `seq` 为下一号、旧连接被顶后**一个字节都没再多写**、旧连接的 `input` **不落 PTY**（`writeCalls` 只有新连接那条）、未 attach 就 `input` ⇒ `not-attached`、`attach` 令牌与绑定值不符 ⇒ `unauthorized`、实例不存在 ⇒ `instance-not-found`、畸形帧 ⇒ `bad-message`，外加一条**端到端字节路径**（upgrade → 半包粘合 → 命令帧）证明两层拼得起来。**变异自证**：注掉 `supersede(...)` 调用 ⇒ 恰好 2 条顶替用例变红，改回复绿

- [x] T3.4 [REQ-7.7][REQ-6.4] 背压与丢弃
  - 验证：`vitest` —— 消费者暂停后缓冲触顶 → 触发丢弃策略；断言**未**出现无界队列（队列长度 ≤ 常量）
  - ✅ **2026-10-09 落地**：`src/ws/outbound.ts`（有界待发队列：块数 + 字节**双上限**，上限直接复用 `src/limits.ts` 的 `TERM_BUFFER_MAX_BLOCKS` / `TERM_BUFFER_MAX_BYTES`，测试引用常量不抄数字）+ `src/ws/frames.ts` 字节面。丢弃策略 = **丢新帧 + 置 `needsResync`**，下一轮 `pump` 下发 `lost { snapshot }` ⇒ 客户端自愈（丢弃 ≠ 静默，REQ-6.3）。⚠️ 顺手修掉一个真缺口：`pump` **不**再无条件 `flush()`（否则暂停期间每轮多灌 1 帧进内核 —— 单轮有界、总量无界），放行只认宿主的 `drain` 事件（`TextConnection.drain`，`socket.on('drain')` 转发）。判据在 `tests/unit/ws-backpressure.test.ts`：暂停后队列长度**恒等于** `TERM_WS_QUEUE_MAX_FRAMES`、`dropped > 0`、`needsResync === true`、内核里只有背压前那一帧；反复 `pump` 长度不增长且**没有 drain 就不许多写一帧**；恢复后先排空再用快照重同步（`lost` 附完整快照、`needsResync` 归 false、游标续推不回退）；一万次入队后长度仍 = 常量。**变异自证**：让 `withinLimits` 恒 `true`（队列变无界）⇒ 6/7 条用例变红，改回复绿

---

## Phase 4：客户端渲染与页类型

- [x] T4.1 [REQ-4.1][REQ-4.2][REQ-4.4][REQ-4.5] 页类型与 seat 注册（2026-10-09 完成）
  - 📌 **2026-10-09 实物契约（照抄，已不是设计口径）**：客户端入口 = `export const inject = ['slots']`（**只放稳定服务** —— 声明了却缺失会让**整个客户端插件 load 失败**）+ `{ apply, inject, name? }`、**没有默认导出**；注册 = `ctx.inject(['sidebarRightTabs','sidebarRight'], scope => scope.sidebarRightTabs.register({ id: 'dsh-terminal-profiles', kind: 'managedTerminal', multiple: true, title, keepMounted: true }))`，`priority` **留空**（= 默认 `extension` 档；官方 `terminal` 页自己用 `"builtin"`）；两个 **keyed seat** = `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title`，**key = `definition.id`**；`register` 返回**幂等 disposer**；**同 band 重复注册、或 `id` 重复 ⇒ 抛错**（⇒ 判据含「重复注册必须报错、不是静默」）。官方 d.ts 签名与真实调用点见 [`client-contract.md`](../../client-contract.md) §C9/C10。**宿主半零改动**（页类型/页体/标题全在客户端注册）。
  - 内容：kind `managedTerminal` + 标题 seat，走 extension 档；作用域注入 + disposer 收集；缺能力降级
  - 验证：`vitest` + fake ctx —— 注册 2 个 seat、缺 `sidebarRight` 时不注册且给原因、卸载后归零；断言 kind 不是官方 6 个中的任何一个

- [x] T4.2 [REQ-5.1][REQ-5.2] 打包形态 + 样式作用域（2026-10-09 完成）
  - 判据（**2026-10-09 二次订正，末次为准**）：客户端半 = **小主 bundle + 独立懒加载 chunk**。主 bundle 用 `await require.async("./client.terminal.js")` 在**终端视图首次挂载时**取 chunk；chunk 自身以 `window.__ModuleLoader__.load({ id: 'dsh-terminal-profiles', chunk: 'client.terminal.js', factory })` 自注册；**xterm 内联在 chunk 里**（不进主 bundle、也不作宿主 external）；chunk 文件**不进 `exports`**（按包内相对路径取）。`react` / `react-dom*` / `@deepseek-ai/*` **必须 external**（未声明的 `require` 会**静默崩** ⇒ 照 `dsh-community-market\scripts\verify-client-externals.mjs` 加自检），并按官方终端页的做法**全部声明为 `devDependencies`**。可断言判据：① 主 bundle **不含** xterm 代码且产物 << chunk；② 未挂载终端视图前 `require.async` **零调用**；③ chunk 头部含 `chunk:` 字段。证据（官方 `dsh-client-ui-sidebar-terminal`：主 19,887 B + chunk 685,949 B，逐字）见 [`client-contract.md`](../../client-contract.md) §P2。
  - 📌 **chunk 命名硬约束（2026-10-09 二次取证，宿主按需路由）**：主产物文件名**必须恰好 `client.js`**（宿主 `chunkUrl()` 断言主 bundle URL 的资源段 = `<rowId>/client.js`，不匹配**直接 throw**，不是静默）；chunk **必须与它同目录**（兄弟文件）且文件名匹配 **`/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`** ⇒ `lib/client.terminal.js` ✅ 合规；chunk **不进 `exports`**（宿主按 `<base>/<rowId>/<fileName>?rev=<rev>` 自己拼 URL）；`require.async` 的实参**解析后** = **兄弟文件名**（字面量**或其常量初值**；⚠️ **2026-10-09 实测**：源码写 `require.async(CHUNK_REQUEST)`（`CHUNK_REQUEST = \`./${CHUNK_FILE_NAME}\``）时 esbuild **把模板字面量保留成变量** ⇒ 静态抓字面量必得**空表**，断言须做**一层常量折叠**并打印走的是哪条路径；运行期语义不变，**不要为此把源码改成硬编码字面量**）。✅ **2026-10-09 集成方独立复算（不复用作者脚本）**：`lib/client.js` = **10,997 B**、`lib/client.terminal.js` = **447,255 B**；两者同步 `require` 均 = `["react","react/jsx-runtime"]`、**均无 `react-dom`、无非基线条目** ⇒ 清单 `dsh.client.external = []` **合法且无幽灵声明**；主产物含 `__ModuleLoader__.load({id, factory})` 且**无 `chunk` 字段**、chunk 含 `chunk:"client.terminal.js"`、chunk 文件名匹配宿主准入正则、主产物里 9 处 "xterm" 全是注释与函数名（**xterm 只内联在 chunk**）。逐字代码与推导见 [`client-contract.md`](../../client-contract.md) §P3。
  - ⚠️ **本条曾在同日被我误订正为「单产物」**（依据 = 另一个插件 `dsh-plugin-desktop` 的 `codeSplitting: false`），**随即被官方终端页实物推翻并撤回**。方法教训：否定性结论必须取自「做这件事的那个官方包」，不能从别的插件反推。
  - 内容：`import('@xterm/xterm')` 动态加载；`xterm.css` 局部作用域注入
  - 验证：`pnpm build` 产物中 xterm 落在**独立 chunk**（主 bundle 体积记账）；`grep` 断言无全局样式写入（无 `document.head` 全局注入路径）

- [x] T4.3 [REQ-5.3] fit 与尺寸同步（2026-10-09 完成）
  - 内容：容器 resize → `fit()` → 计算 `rows/cols` → 同步 PTY
  - 验证：`vitest` —— 尺寸变化时同步调用一次（节流断言）；夹具尺寸 → 期望 rows/cols

- [x] T4.4 [REQ-5.5] 主题 token（2026-10-09 完成）
  - 验证：`vitest` 样式断言 —— 零硬编码 hex，只用 `--dsw-*`

- [x] T4.5 [REQ-12.3][REQ-4.3] tab 关闭后实例存活 + 重开恢复（2026-10-09 完成）
  - 内容：tab `×` 只卸载视图；再开页从屏幕模型取快照重建；**每 tab 恰好承载一个实例，列表按创建序稳定**（REQ-4.3）
  - 验证：`vitest` + fake —— 卸载视图后实例表不变；重开走 `attached` 快照路径（**不**重放历史字节流）
  - ✅ **2026-10-09 集成方复核（逐条对到真用例，不复用作者自述）**：**T4.1** ← `tests/unit/client-tab.test.ts`（形状恰 `{id,kind,multiple,keepMounted,title}` 且 `priority` 缺省；kind 与官方 **9** 个不重名**先证名单非空**；2 个 keyed seat `key=definition.id`；卸载后计数归零 + dispose 幂等；**页类型重复 id 必须抛出、不吞**；第二个 seat 失败 ⇒ 第一个 seat 与页类型的清理都跑、不留半注册）＋`tests/unit/client-entry.test.ts`（入口恰 `{apply,inject,name}`、**无 default**、`inject=['slots']`、缺 `sidebarRight` ⇒ 不注册 + 警告 + 不抛、无 `effect` 时降级注册）。**T4.2** ← `tests/unit/client-artifacts.test.ts`（主产物名恰 `client.js`、chunk 大两个数量级、**材质化期零 async 调用**、取块实参走常量折叠、id=包名、判据名唯一/条数达标防「门瞎了」）＋集成方独立复算产物：**主 11,037 B / chunk 447,255 B**，两者 `require` 均 = `["react","react/jsx-runtime"]`、**零 `react-dom`、零幽灵声明**，xterm 只在 chunk（主产物 3 处均为注释/函数名）。**T4.3** ← `tests/unit/client-xterm-body.test.tsx`（夹具 24×80 → 报给 `onResize`；尾沿节流窗口内多次触发只 fit 一次且到点前不同步）＋`tests/unit/service-surface.test.ts`/`session-resize-kill.test.ts`（`rows≠cols` 防转置、夹紧后的值才落宿主 `[cols, rows]`）。**T4.4** ← `tests/unit/client-styles.test.ts`（选择器全在 `.dtp-` 命名空间、**零硬编码 hex**、`var(--dsw-*)` 只出现在两个已实证 token **且两个都真被用到**——反空转）。**T4.5** ← `tests/unit/ws-resume.test.ts`（全新 attach ⇒ `attached` 带快照与尺寸；**续传成功 ⇒ `snapshot: null`，不重发快照**＝不重放历史）＋`client-xterm-body.test.tsx`（卸载 = 断连 + 退订 + dispose，仅视图卸载）。**方法备注（本轮实测）**：产物字节数必须在代理 `inactive` 后读 —— 11:51 前后曾读到一次**生产构建中间态**（主 126,358 B、字符串 `require` **0 处**，即 react-dom 被内联），11:51:39 重建后恢复 11,037 B ⇒ 构建期间读产物会得到假状态。

---

## Phase 5（已迁出）：Agent 工具族与权限

T5.1–T5.4 **已整体迁至 [004-terminal-agent-surface](../004-terminal-agent-surface/tasks.md)** 的 Phase 1–2（2026-10-08 拆分；内容逐条保留）。**Phase 编号 5 保留为空位**，以免 T6.x / T7.x 等既有引用错位。

---


---

## Phase 6（已迁出）：配置页

> ✅ **2026-10-09 已迁出至 [`007-terminal-config-page`](../007-terminal-config-page/tasks.md)**（同款先例：`Phase 5 → 004`）。`T6.1`–`T6.4` **连同判据**一并移交，编号原样保持以免既有引用错位；**整包**质量门 `T7.3` 仍留在本文件。
## Phase 7：服务导出与收口

- [x] T7.1 [REQ-11.1][REQ-11.2][REQ-11.3] 导出 `managedTerminal` 服务
  - 内容：`open/list/read/write/resize/kill/subscribe`；本包不 import 003，也不要求 003 import 本包
  - 验证：`vitest` + fake —— 服务面方法齐全；无消费方时**不**报错、不注册多余内容；契约测试断言服务名与 design.md §5 一致
  - ✅ **2026-10-09 落地**：`src/service-export/{types,service,host-modules}.ts` + `src/plugin.ts`（`tests/unit/service-surface.test.ts` 24 条 + `tests/unit/plugin-entry.test.ts` 13 条）。服务面**恰好** 7 个方法（`Object.keys` 逐字断言 ⇒ 多一个就是第二份契约），全部转发到 `session/manager` —— **不另建实例表 / 不另建屏幕模型**，故 004 工具面、003 服务面、WS 通道看到**同一批实例**。**失败一律是结果、不是抛**：新增 `profile-not-found` / `sandbox-denied` / `internal` 三码（`Omit<SessionFailure,'code'>` 派生 ⇒ 字段跟会话层走、不漂移），会话层既有 7 码**原样透传**（NFR-3）；`internal` 只为兑现「端口抛错也不冒泡」。②「无消费方」两侧都钉：最小 ctx（无 webServer / subprocess / tools / 003）下 `apply` 不抛、服务照导出、`ctx.effect` **恰好 1 次**、页类型 **0 次**；服务面未订阅时 `listenerCount() === 0` 且 `tickerCount() === 0`（**惰性起表**）。③ 契约：`MANAGED_TERMINAL_SERVICE === 'managedTerminal'` 字面断言 + `ctx.provide` **恰好一次**且 `value` 就是那 7 方法对象。**resize 换序/夹紧的唯一入口仍是 `manager.ts:244`**（本层只同名字段转发、**不**二次夹紧）：`resize(id, rows=24, cols=100)` ⇒ 宿主收到 `[100,24]`，返回值 = 夹紧后的实际值（`rows=0`→1、`cols=1e9`→1000、`rows=501`→500、`cols=1`→2）；未知 id 时**零**宿主调用。`cwdOverride` 落 profile 本来就用的槽位（WSL ⇒ `cwdLinux`，其余 ⇒ `cwd`；空串 ⇒ `cwd-missing`），且**不**清 `needsFix`（REQ-1.4 不是后门）。`subscribe` 复用 `read` 的结果形状（零新词汇），失败也推送并自动注销。**变异自证 ×2**：① 转发写成 `(cols, rows)` ⇒ **3 条红**（`expected [ [ 24, 100 ] ] to strictly equal [ [ 100, 24 ] ]`），改回复绿；② `isSchemaFactory` 收紧成只认 `object` ⇒ 红 1 条（下方「可调用对象」回归条），改回复绿。**宿主模块取用缝（`host-modules.ts`）实测**：依赖落地后直读 `src/plugin.ts` ⇒ `Config !== undefined` 且 `Config['~standard'].vendor === 'schemastery'`（真 Schemastery ⇒ `.volatile()` 不会被静默降级）。🔴 该实测**抓到过一个真缺陷**：schemastery 的导出命名空间是**可调用对象**（`typeof z === 'function'`、挂 `any/array/object`、**无** `default`、**无** `Schema`）⇒ 初版只认 `object` 会把真实现判掉、`Config` 静默变 `undefined`（现已按 function 也收 + 回归条钉死）。残余真机项（并入 T0.5）：003 按**字符串键** `managedTerminal` 真机注入。**依赖落地后的端到端实测（真 schemastery + 真 dsh-tools，2026-10-09）**：`Config !== undefined` 且 `vendor === 'schemastery'` ✅；但 🔴 **6 个工具被真 `defineTool` 全部拒绝**（`unsupported JSON schema: … is not supported by the value schema DSL`，逐个命中：`new`/`resize`/`kill` = `schema.oneOf[0].required`、`list` = `schema.required`、`read` = `parameters.sinceSeq.minimum`、`write` = `parameters.data.minLength`）。根因线索：同族生产代码 `dsh-office-tools/src/tools/excel.ts` 用的是**扁平值 schema DSL**（`parameters: { path: { type: 'string', required: true } }`），**不是** JSON Schema。⇒ 已给插件加「工具面失败**不算**整包失败」的 try/catch + **半途回滚**（`guardTools` 记流水账，失败时把已注册项全部撤回）；实测结果：**不抛**、路由照常注册 2 条、`toolNames 0`、gap 带宿主原文。⚠️ 该缺陷归属 **004 的 `src/tools/**`**（本任务冻结边界外）⇒ 已在交付报告里单列，不计入 T7.1/T7.2 的完成判据

- [x] T7.2 [REQ-12.1][REQ-12.2] 卸载清理
  - 验证：`vitest` + fake —— 卸载后 WS 连接数、路由数、页类型数、工具数、resize 监听数全部归零；**全部实例被终止**（PTY kill 调用数 = 实例数）
  - ✅ **2026-10-09 落地（打底）**：`src/plugin.ts` 用**一个**幂等 `dispose()` 收全部 —— `channel.closeAll()`（WS 连接）→ `channel.dispose()`（路由）→ 工具面 `dispose()` → `serviceHost.dispose()`（清订阅 → 停定时器 → 逐个 `kill` 全部实例）；并收进 `ctx.effect`（宿主**不会**自动收编，design §11）。判据（`plugin-entry.test.ts`，卸载前后逐项）：WS 连接 `activeCount 1→0`、路由/升级 `liveCount 2→0`、`routeCount 2→0`、工具 `6→0`、订阅监听 `1→0`、定时器 `1→0`、`list() → []`、`terminateCount === [1,1]` 且 `terminated === true`（**kill 调用数 = 实例数**）、原 list 路由回落到官方行为（不是「注册着但答得动」）。**页类型数 = 0**：Phase 4 未实现 ⇒ fake ctx 装**计数版** `sidebarRightTabs`，真注册一次就变红（比「不写断言」强）；**resize 监听数 = 0** = 订阅监听 + 定时器，Phase 5 的 xterm fit 监听尚未实现 ⇒ 该项当前平凡为 0（已在测试头注写明代理口径）。另证**卸载后可重新装载**：同一 webServer 再 `apply` 一次仍 `registered === true` 且 `duplicateAttempts === 0`（REQ-7.6 的真实风险 = 残留路由撞「重复 `(kind,path)` 抛错」）。⚠️ 残余真机项并入 T0.5：真机装载 → 卸载后同样归零

- [x] T7.3 [NFR-1..NFR-6] 质量门
  - 验证：`pnpm -C packages/terminal-profiles typecheck` + `test` + `build` 三项全绿；记录用例数、主 bundle 与 xterm chunk 体积；`package.json` 的 `peerDependencies.react` = `^18.2.0` 且**不在** `dependencies`；单文件 ≤ 400 行
  - 🔵 **2026-10-09 集成方提示（体积基线必须用冻结后的数）**：T7.4 已写入 README 的基线 **11,037 B** 是 **Phase 4 交付时**的主 bundle 数；**Phase 6 配置页进 bundle 后**实测已变为 **41,757 B**（`lib/client.js`；chunk `client.terminal.js` 仍 447,255 B）⇒ 本门记录**以构建冻结后的复算值为准**，并**由集成方**同步更新 README 那一行（代理**不要**改 README，那是集成方的文件）。同时记录对照：官方终端页主 bundle **19,887 B** ⇒ 本包主 bundle 现为它的 **2.1×**（配置页 + 标签壳都在主 bundle）；若主人要压，**可选**把配置页改为懒加载 chunk（§E 允许），但**不是**本门的硬要求 —— 记数、说明、不擅自改架构。
  - ✅ **2026-10-09 清单判据已满足（集成方读值）**：`peerDependencies.react = "^18.2.0"` ✓ 且 `dependencies` 里**无** `react`（本包 `dependencies` = `@xterm/addon-serialize` / `@xterm/headless` / `dsh-wsl-shared`）✓；`devDependencies.react = 18.2.0` 是**测试期**用（判据只禁 `dependencies`）✓。🔵 **顺带钉死一个幻影**：`peerDependencies` **不进 lockfile** —— 实测三个 importer 段（`packages/terminal-profiles` L21 / `wsl-docker-ports` L76 / `wsl-shared` L110）**全无** `peerDependencies:` 键，全文件的 30 处同名键**都在 package 级** ⇒ 改 peer **不会**让 `pnpm install --frozen-lockfile` 失败（无需为它跑 install）；整合时仍会复验一次 `--frozen-lockfile` exit 0。
  - 🔴 **2026-10-09 12:06 收口快照（代理仍在飞 ⇒ T6.1–T6.4 与 T7.3 均不勾选；代码在工作区未提交，本包 21 个文件）**：**已独立核验通过** —— ① `typecheck` **exit 0**（1.1s）；② `vitest` **33 文件 / 408 passed | 1 skipped / exit 0**（10s，含 Phase 6 配置页 4 个测试文件 1,296 行 + `tests/helpers/config-fixtures.ts`）；③ 判据关键词覆盖齐：volatile-only **26** / 确认 **16** / 只读+原因+路径 **58**（用例原文「只读 ⇒ 同时显示原因与文件路径，且点保存也**不写盘**（REQ-10.3）」）/ revision 冲突 **43** + **保留输入 8**（断言到字面值，含**尾随空格未被重置**）/ 单条无效 **12** / 语义文案 **3**（含「改 cwd 只影响新建实例」）；④ `configEditor` 仅注释 **3** 处、写入走 `remote.settings.update` 两参形式；⑤ 清单判据已满足（见上一条）。🔴 **不勾选的理由**：剩余 6 条要靠**代理自己的收尾报告**确认「T6.1–T6.4 判据全部完成」，我**不替它宣布**；体积基线仍需**构建冻结后**复算并更新 README（集成方负责）。**复跑命令**：`pnpm -C packages/terminal-profiles typecheck && pnpm -C packages/terminal-profiles test && pnpm -C packages/terminal-profiles build`。
  - ✅ **2026-10-09 T7.3 收工（集成方独立复跑）**：`typecheck` **exit 0** · `vitest` **33 文件 / 408 passed | 1 skipped** · `build` 出两份产物（主 bundle **43,537 B** / chunk **447,255 B**）· `check:client` **60/60（含 4 条反控）** · `pnpm install --frozen-lockfile` **exit 0** 且 lockfile SHA256 **`FEADFDB56EBAC31A…`** 与改动前逐字相同 · **0 个文件 > 400 行**（最大 394）。
  - 🔵 本包**无** `check:size` 脚本 ⇒ NFR-2 的「主 bundle 记账」以本行实测数为准；README 基线行已同步为 43,537 B（Phase 4 的 11,037 B 保留为历史值）。
  - 🔴 **Phase 6 已迁出**（见上「已迁出」空位）：`T6.1`–`T6.4` 连同判据移入 [`007-terminal-config-page`](../007-terminal-config-page/tasks.md)，本文件只保留**整包**质量门。
- [x] T7.4 文档回写（2026-10-09 完成）
  - 内容：T0.1（B-1 结论）、T0.3（前缀）、体积基线、REQ-7.4 的顶掉策略 → 回写 README/design
  - 验证：`grep -n "B-1\|B-3\|superseded" specs/002-terminal-profiles/*.md` 可见结论；`leanspec validate` 无新增告警
  - ✅ **2026-10-09 回写完成（集成方自查，逐项落点）**：**B-1 结论** = README L114/L153/L155 + design L106/L184；**B-3（前缀独占性）** = README L157；**T0.3 独占前缀** = README L115 + design L141；**REQ-7.4 顶掉策略（`superseded`）** = design L65/L185；**体积基线** = README **L120（本轮新增）** —— 主 **11,037 B** + chunk **447,255 B**（官方终端页对照 19,887 / 685,949），并写明「**产物体积必须在构建进程结束后测**」（同日实测到一次 react-dom 被内联的中间态）。⚠️ **判据替代说明**：`leanspec validate` 属本机 **9 个未迁移子命令**之一（已知缺口，见 `AGENTS.md`）⇒ 以 `grep -n` + 行数阈值替代复核：requirements **186** / design **200** / README **165** / tasks **216** —— 本次回写只让 README **+1 行**，**未新增越阈文件**（tasks.md 的 >200 为**存量**，见待拍板项）。

> 🔵 **2026-10-09 Phase 2 交付时的越界发现（E 只报不改 ⇒ 归口到本阶段处理）**：① 🔴 **`build` 缺口**：本包 T4.2 / T7.3 与 003 T6.4 / 004 T3.2 / 005 T3.4 都引用 `pnpm … build`，而**全仓没有 `build` 脚本**（跨 4 个 Spec 共 **5 处**）⇒ 收口前必须先交付 esbuild 构建，否则那些门当场红。② `tsconfig` 是 `erasableSyntaxOnly` + `exactOptionalPropertyTypes` ⇒ 可选参数必须显式写 `?: T | undefined` 才能在调用点传 `undefined`（Phase 2 唯一的类型噪音源，建议进编码约定）。③ `@xterm/addon-serialize` 的 `.d.ts` import 了**未安装**的 `@xterm/xterm`，靠 `skipLibCheck: true` 掩盖 ⇒ 关掉它立刻炸；本阶段需定「装 `@xterm/xterm` 作 devDependency」还是打 patch。④ 依赖变更会经 **pnpm 11 `verify-deps-before-run`** 自动写回 lockfile（Phase 2 实测）⇒ 见 `AGENTS.md` 的对应条。

> 📌 **2026-10-09 集成方离线核查（把上面③与 T7.3 的未决项各推进一步；**只查不装**，装配留到 Phase 4 与客户端半一起做）**：
> - ③ **已定案（有实物证据）**：`@xterm/addon-serialize/typings/addon-serialize.d.ts:6` 原文 `import { Terminal, ITerminalAddon, IMarker, IBufferRange } from '@xterm/xterm';` ⇒ 本仓 `skipLibCheck: true` 确实在掩盖它。**处置 = 走前者**（Phase 4 把 `@xterm/xterm` 作为 **devDependency + peerDependency** 装上）：① 客户端半本来就要它（栈已冻结「浏览器 `@xterm/xterm` + `@xterm/addon-fit` 独立懒加载 chunk」）；② 装它同时消掉这个 d.ts 洞，**不用**打 patch。**不提前装**（此刻无消费方 = 悬空依赖）。
> - **版本可得性（镜像实测）**：`@xterm/xterm` **6.0.0**、`@xterm/addon-fit` **0.11.0**、`esbuild` **0.28.2**、`react@18.2.0`、`react-dom@18.2.0`、`@types/react@18.3.12`、`@types/react-dom@18.3.1` **全部可解析** ⇒ T7.3 的 `peerDependencies.react = ^18.2.0` 可满足（注意镜像 `latest` 已是 React **19.3.0**，**必须显式钉 18**，否则与栈冻结的 React 18 相悖）。
> - ⚠️ **仍未验证**：`@xterm/addon-fit` / `@xterm/addon-serialize` **都没有声明 `peerDependencies`**（镜像实测为空）⇒ 与 xterm 6 的**兼容性无约束证据**，只能等 Phase 4 真装上跑一次（列入 T4.2 的验证项）。
> - ⚠️ **仍未完成**：`dsh.client` + `exports["./client"]` + 客户端 chunk（T4.1/T4.2）与配置页（T6.x）**都在等客户端半契约**（宿主客户端 API / 页类型注册 / 打包 external 列表）—— 集成方本轮已派**只读契约研究**代理从本机实物检出（`dsh-whale-pet` / `DeepSeekHarness-MCP-Manager` / `dsh-desktop` 的 `dsh-community-market` 客户端 API 测试 / `dsh-terminal-extension`）挖取，结论回写本 Spec 的 design。

---

## 真机验收清单（chrome-devtools MCP，替代 Playwright E2E）

> 依据：handover 明确「vitest 单元 + `node:test` 离线契约 + chrome-devtools MCP 真机验收」，**否决** propose 默认的 `harness/verify-e2e.sh` 与视觉对照。

| # | 场景 | 期望 | 手段 |
|---|------|------|------|
| 1 | 打开终端页 | 右栏出现 `managedTerminal` 标签，与官方 `terminal` 并存不互踩 | chrome-devtools 截图 + 快照 |
| 2 | 启动 pwsh profile | 面板出现提示符，PTY pid 可见 | 截图 + list 工具输出 |
| 3 | 键盘输入 `echo hi` | 回显 `hi`，无字符丢失 | 截图 |
| 4 | 启动 `wsl.exe -d Ubuntu2204` profile | 提示符在 `cwdLinux` 下（`pwd` 验证）| 截图 |
| 5 | 拉伸窗口 / 收窄右栏 | 终端重排，`rows/cols` 同步（`stty size` 验证）| 截图 + 工具 resize 返回 |
| 6 | 配置页改 profile 的 `cwd` 并保存 | **运行中终端仍存活**（B-1 的最终真机证据）| 截图（终端未重挂载）+ 日志 |
| 7 | 关闭 tab `×` 后再打开 | 实例存活，画面从快照恢复（`dropped` 计数可见）| 截图 |
| 8 | 禁用插件再启用 | 无重复页类型/路由（`grep` 日志），无孤儿 PTY | 日志 + 快照 |
| 9 | 窗口很宽 / 很窄（宿主两栏布局）| 终端画布自适应，无横向溢出 | 两种视口截图 |

> ⚠️ **2026-10-09 订正**：上表第 9 行原为**拆分残留** —— 它以裸表格行的形式挂在下方引用块之后、脱离了表头（渲染时会被当成普通文本），已归位并把原编号 `12` 改为 `9`（表内本就只到 8）。

> **Agent 面**的真机清单（`read` 两模式 / `write` 发 `C-c` / `resize` 夹紧 / `read-only` 拒绝 / `kill` 后 `list`）**已迁至 [004-terminal-agent-surface](../004-terminal-agent-surface/tasks.md)**（2026-10-08 拆分），此处不再重复。

### ✅ 2026-10-09 真机复验：缺陷 A / B 修好（探针实例 43311 · 证据为真机原文）

方法：把两个插件 `link:` 装进**临时探针 profile**（备份 5 个 live 文件 → `pnpm install --frozen-lockfile` → 起实例 → 打端点 → 逐字节还原 + 删软链），**未触碰 `desktop`**。真实 CLI 语法教训：`dsh --profile <name> --port N --no-open`（`dsh web` 的 `web` 是 **profile 名**，当子命令写会 `too many arguments` ✗）；**全新 profile 离线起不来**（要装基础 bundle，卡住不监听 ✗）⇒ 用已装好基础 bundle 的探针 profile。

| 请求 | 修前（真机） | 修后（本轮真机原文） |
| --- | --- | --- |
| `GET /dsh-managed-terminal/instances` | 宿主兜底 **404**、无 JSON、无正文 | ✅ **403 Forbidden** + `Content-Type: application/json; charset=utf-8` + `Content-Length: 98` ⇒ **路由真的被分派**（403 = 我们的授权判定，未带令牌） |
| `GET /dsh-managed-terminal/nope` | 宿主兜底 404 | ✅ **404** + 我们的 JSON（91 B）⇒ 前缀内只答自己那一段 |
| `POST /dsh-managed-terminal/instances` | 宿主兜底 404 | ✅ **405 Method Not Allowed** + JSON（80 B）⇒ 方法判据可达 |
| `GET /dsh-managed-terminal/ws`（raw 握手：Upgrade/Connection/Key/Version） | 宿主兜底 404 | ✅ **403** + JSON + `Connection: close` ⇒ **upgrade 路由被分派**（403 = 无令牌） |
| 对照组 `GET /dsh-wsl-docker-ports/snapshot?managedPorts=59999&distro=Ubuntu2204` | 200 | ✅ **200 / 4642 B / application/json; charset=utf-8** |
| 兜底对照 `GET /nope` | 404 | ✅ 404 |

**仍未验**：① 拿到**令牌后**的 200 与列表正文（需会话令牌，未走）；② **浏览器侧**的 `guide` 入口可点 / 正常启动零 warn / 007 配置页 —— 该探针 profile **不含** `@deepseek-ai/dsh-client-ui-sidebar-right`（`bundles` = `dsh-base` / `dsh-web-app` / 探针插件 + 本仓两包）⇒ 客户端会走**设计好的降级**（`sidebar-right-unavailable`），**验不了 guide 入口**；要验必须用含官方侧栏 bundle 的 profile（需主人授权）。

### 2026-10-09 浏览器侧：**不可验**（证据充分，且不是缺陷）

工具：**Playwright MCP**（⚠️ 偏离：技术栈写的是 chrome-devtools MCP —— 后者在本机连不上，它只认默认 Chrome 用户目录里的 `DevToolsActivePort`，而本机 Chrome 未以远程调试启动、且新版 Chrome 拒绝在默认 profile 上开调试口 ⇒ 经主人批准改用 Playwright 并留此痕）。

在一个**含 `@deepseek-ai/dsh-base` + `dsh-web-app`** 的临时探针 profile 上（官方侧栏插件被临时禁用自杀行为后起实例，跑完**逐字节还原**）：

| 项 | 真机结果 |
| --- | --- |
| 页面加载 | 0 error、**1 warning** |
| 那条 warning | `[dsh-terminal-profiles] 右栏页尚未注册：已登记 ctx.inject([sidebarRightTabs, sidebarRight]) 等待宿主服务（不是失败）` ⇒ **我们自己的降级提示**，文案已写明不是失败 ✓ |
| `browser_find("端口")` | **0 命中** ⇒ 右栏里既没有 guide 胶囊、也没有端口页 |
| 控制台请求 URL 里的 client bundle 列表 | 共 **8** 个：`dsh-client-ui-deliverables` / `dsh-wsl-docker-ports` / `dsh-terminal-profiles` / `dsh-typert-registry` / `dsh-client-connection` / `dsh-api-workspace-controller` / `dsh-api-session-controller` / `dsh-client-ui-directory-picker-native` ⇒ **不含官方 `dsh-client-ui-sidebar` / `sidebar-right`** |

⇒ **根因**：该 profile 里官方侧栏 **client 插件根本没被加载** ⇒ 宿主服务 `sidebarRightTabs` / `sidebarRight` **永远不会到达** ⇒ 我们的插件**按设计降级**（响一声、说清原因、零报错）✓ —— **这不是缺陷** ✓。
⇒ **结论**：「guide 入口可点」与「007 配置页」两项**必须在官方侧栏 client 插件真被加载的 profile 里验**（即主人的真实桌面环境）；在纯探针 profile 里**物理上不可验** ✗，**不记为通过**。

### 📋 交给主人在真实环境验证（2026-10-09 主人选择：自己验，代理不动任何 profile）

**安装（主人自己跑，代理不碰 profile）**：

    dsh plugin --profile desktop add "dsh-terminal-profiles@link:E:\NodeProjects\dsh-wsl-toolkit\packages\terminal-profiles"
    dsh plugin --profile desktop add "dsh-wsl-docker-ports@link:E:\NodeProjects\dsh-wsl-toolkit\packages\wsl-docker-ports"

| # | 判据（可二值判定） | 通过 | 回归信号 |
| --- | --- | --- | --- |
| V1 | 右栏**空态**里出现「端口转发」胶囊（003 的 `guide` 条目：id `ports`、order 40），**点得进去**，右栏切到「WSL Docker 端口」页且页内有端口列表 / 转发状态 | 胶囊出现 + 点开有页 | 无胶囊、点了没反应、控制台出现 `sidebar-right-unavailable` |
| V2 | F12 Console：**正常启动零 warn**（宽限窗口 2s 之后才允许响我们的等待提示） | `[dsh-terminal-profiles]` / `[dsh-wsl-docker-ports]` 的「尚未注册」警告 **0 条** | 一进页面就响、或服务到了还响 |
| V3 | 设置 → 插件行 `dsh-terminal-profiles` 有**配置页入口**（slot `plugins.row.config`），点开能看到 profile 列表（只读态 / 冲突态按设计显示） | 入口存在且可开 | 入口不存在（= `config-slot` 软取回归） |

⚠️ 注意：在**没有**官方侧栏 client 插件的 profile 里，V1/V3 **必然**失败且**不是缺陷**（本文件上一节已用 client bundle 列表证明）；V2 在这种情况下**预期有 1 条**我们自己的降级提示（文案含「不是失败」）。
⇒ 本三项**当前状态：未通过（未验）**，不得记为完成。

### 🔴 2026-10-09 更正：V1/V3 **CLI 侧永久不可验**（三条独立证据 + 官方护栏）

**结论**：官方右栏是**应用级**界面，**不属于任何 profile** ⇒ 任何用 CLI 起的 profile 都长不出它 ⇒ **V1（guide 胶囊可点）在 CLI 侧不可能验**；V3 同理（它挂在应用的设置/插件页那套 client 插件上）。

| # | 证据 | 事实 |
| --- | --- | --- |
| E1 | **新建** profile `ui-probe`（从 `volatile-probe` 的 `dsh-base`+`dsh-web-app` 起，剥掉自杀探针插件，装入本仓两包，真机起实例） | 页面 0 error / 1 warning；client bundle 请求 URL 里**仍是那 8 个**，**不含** `dsh-client-ui-sidebar` / `-sidebar-right`；`browser_find("端口")` 0 命中 |
| E2 | **`web` profile 自己的 bundle 清单**（只读已捕获） | `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` / `dsh-webview-clipboard` / `@deepseek-ai/dsh-acp-app` / `dsh-web-noopenbrowser` / `@xxxyz/dsh-mcp-manager` ⇒ **一个 sidebar 包都没有** ⇒ 侧栏不可能来自 bundles |
| E3 | **共享 `profiles/node_modules/@deepseek-ai` 里的 4 个 sidebar 包** | 全是 **Junction**，指向 `%TEMP%\dshstudio-runtime\0.1.5-rc.2\node_modules\@deepseek-ai\…`，而**该目标目录已空** ⇒ `package.json` 不存在 ⇒ **断链**（真右栏在应用打包资源里） |

**官方护栏（与上表独立的一条事实）**：`dsh` CLI **按名字**禁止操作 `desktop` —— `D:\nvm\v24.15.0\node_modules\@deepseek-ai\dsh\lib\bin.js:35` 的 `rejectElectronProfile()`，`line 36`：`profile.toLowerCase() === "desktop"` ⇒ `error: profile "desktop" is managed exclusively by the Electron application`。**只有应用自己**能绕过（`parseDshArgs(argv, version, manageDesktopProfile=false)` 的**第二个参数**，`line 101/119`）—— **没有 CLI flag、没有环境变量**。
⇒ 故 `dsh plugin --profile desktop add …` **注定失败**（官方设计，不是社区版残留 ✓：`desktop` 目录本身是普通 profile，`dsh.profile.bundles` 11 项、`patchReload: live`，**无任何 electron/managed 标记**）。

**处置**：
- V1 / V3 ⇒ 状态改为「**仅应用内可验**（CLI 侧永久不可验）」；**不记为通过**；将来在应用内正式装上本仓插件时再顺手确认。
- V2 ⇒ 正向分支（服务准时到达 ⇒ **零** warn）**同因不可验**；**已验的是降级分支**：真机 0 error + 恰 1 条我们自己写明「不是失败」的提示、不崩不静默 ⇒ 注册路径由单测（假 sidebar 服务）覆盖。

### 🔴 缺陷 B 离线修复轮（2026-10-12；**零真机** —— 真机复验延后到下一批）+ 对上文 L141 判据的**订正痕（原文保留）**

- **缺陷（真机症状）**：`openTab('managedTerminal')` 能真加出本页（`term-title` + 真面板 `term-pane`），但右栏**开始页**里只有「工作区文件 / 新建终端」，用户**在 UI 里点不到**本页。
- **根因（file:line）**：`packages/terminal-profiles/src/client/tab.ts` 的 `buildTabDefinition()` **没有 `guide`** —— 页类型注册成功 ≠ 有可发现入口；同形对照 = `packages/wsl-docker-ports/src/client/rows.ts:120-136` 的 `portsTabDefinition()`（**有** `guide:[{id:'ports',order:40,…}]`，官方形状引文见同文件 L38-69）。
- **最小修复**：`buildTabDefinition()` 补 `guide:[{id:'managed-terminal',order:40,title:()=>…,description:()=>…}]`。文案一律 **thunk**（官方每次使用都重读）；`order=40` **大于**官方 files=10 / terminal=20 / browser=30，不挤官方档位；**不写 `icon`**（官方类型只要求 `id`/`order`/`title`，缺 `icon` 时 guide 自绘占位符）。
- 🔴 **订正痕（原文保留）**：上文 L141 记的 T4.1 判据「形状恰 `{id,kind,multiple,keepMounted,title}`」**自本轮起已不完整** —— 现为 `{id,kind,multiple,keepMounted,title,guide}`；`tests/unit/client-tab.test.ts` 的对应断言已同步。**不删原文**，以本行为准。
- **回归门 + 变异哨兵**：`tests/unit/client-tab-guide.test.ts`（4 例 / **14 断言**）用**同一份判据函数**同时判「定义对象里那一份」与「真注册给宿主的那一份」（防只在纯函数里好看）；哨兵逐字复刻修复前的定义（无 `guide`）并打印 `旧实现（无 guide）⇒ 违反 1 条：页类型没有 guide ⇒ 右栏开始页里没有入口，用户点不到（缺陷 B 的真机症状）；修好后 ⇒ 违反 0 条`。
- **离线门（cwd = `packages/terminal-profiles`，实测）**：`tsc` **exit 0** · `vitest` **37 文件 / 440 passed | 1 skipped（441）· exit 0** · `check-size` **exit 0** · `verify-client-loader` **exit 0**（60 条判据；⚠️ 校验对象是**未重建**的 `lib/`）。
- ⏳ **未验，且本修复不关闭上文 V1**（「胶囊出现 + 点得进去」）—— V1 按上面三条证据（E1–E3）**只能在应用内验**，本轮**零真机** ⇒ 真机点开对照（DOM/a11y 前后）**延后到下一批**。先例诚实标注：003 的 `680a445` 用**同一形状**修过同款缺陷，但其「点了能开」**同样尚无真机取证**；本轮依据 = 官方 bundle 的 guide 形状引文 + 同一条注册路径。

### ✅ 缺陷 B 真机闭环（2026-10-12；证据目录 `C:\Users\EDY\dsh-probe-artifacts\20261012-154451-final\`）

- **判据（缺陷 B）：「右栏开始页里出现本页入口，且点得进去」⇒ 真机两侧全中** ✅
  - 开始页出现**真胶囊** `<button data-sidebar-right-guide-entry="managedTerminal">`，标题「受管终端」、描述「按 profile 起真 PTY 终端：配置名称、命令、参数与 cwd；开页零副作用」（`RESULT.txt` §1 的 `D.1` 行 + §3 的 DOM 原文）⇒ `guide` 形状被宿主正常消费。
  - 点击后**新建 `tab6`（`kind=managedTerminal`）并激活**：`[data-testid=term-pane]` **417×879**（且无隐藏祖先；`tab5` 那份是 0×0 隐藏）、`term-surface` **417×879**、`term-title` **×2**、xterm 挂载 **×2**（`RESULT.txt` §1 的 `D.2` 行）；a11y 原文含 `tab "受管终端 关闭" selectable selected` + `textbox "Terminal input"`（§3）⇒ **「胶囊出现 + 点得进去」两条判据都中** ✅。
  - ⇒ 上文 ⏳「真机点开对照（DOM/a11y 前后）延后到下一批」**已兑现**；本结清痕与离线门 `tests/unit/client-tab-guide.test.ts`（同一判据函数判「定义对象」与「真注册给宿主的那一份」+ 变异哨兵）**互为独立证据**。
- 🔴 **本批未验（不许冒充）**：① 003 的 `guide` 胶囊**确实也出现了**（`D.1` 行注明「另有「端口转发」胶囊」，§3 的点击前文本含「端口转发 / 查看容器的端口映射与 portproxy 规则…」），点击后右栏也有 `tab "WSL Docker 端口" selectable`（**未选中**）—— 但**「去点 003 的那个胶囊 ⇒ 切到端口页」这一步本批没做** ⇒ 003 的 `V1`「点得进去」**仍未被直接确认** ✗（不并账、不冒充）。
- 🔴 **002 的关闭评估本轮未做**（未勾项数未复算、`T7.3` 的整包质量门未重跑）⇒ **状态不动**（仍 `in-progress`），只补痕。
- ⚠️ **证据计数口径**：`MANIFEST.txt` 自报「文件数 = 79」（含 `ORIG/`、`ORIG-full/` 两个子目录），而派单文字写「77 文件」⇒ **两者不一致**；我按 `MANIFEST.txt` 的原文标注，**未把 77 当既成事实**。
