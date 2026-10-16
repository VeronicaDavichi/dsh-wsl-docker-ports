# 任务：提权写路径

> 从 [requirements.md](./requirements.md) 与 [design.md](./design.md) 派生。
> **2026-10-08 从 [003-wsl-docker-ports](../003-wsl-docker-ports/tasks.md) 拆出**：原 T3.1–T3.4（所有权与写操作）、Phase 4（提权辅助进程，T4.1–T4.5）、T6.1–T6.3（红线自证与卸载清理）迁来并重编号。**原编号在新处不保留**（003 侧留空位指针）。

---

## Phase 0：前置（契约定案）

- [x] T0.1 [REQ-3.4][REQ-3.7] 真机核对提权链路一次
  - 内容：生成临时 `.ps1` + `Start-Process -Verb RunAs`（**人工点一次 UAC**）→ 主机读到 out 文件 JSON、退出码正确、两个临时文件被删除；**本次不写任何系统规则**（用只读动作或 `-Action` 空转验证）
  - 验证：退出码 `0`；out JSON 可解析；`%TEMP%` 无残留；结论写入 design.md §4
  - ⚠️ 本项**必须人工点 UAC**（无法自动化）
  - 🔵 **只读前置已核（2026-10-09，零 UAC、零写入）**：`gsudo` **在 PATH**（`D:\Program Files\gsudo\Current\gsudo.exe`，v2.6.1）· `%SystemRoot%\System32\sudo.exe` **不存在** · `netsh.exe` 与 `New-NetFirewallRule` 均可调 · 当前进程**非管理员**（⇒「写路径必经 UAC」这条前提成立）· 既有 **19 条**规则**仍在**（写验收的比对对象完好）· `gsudo --help` 含 `gsudo { Write-Output … } -args` 的 **stdio 回传**示例。**仍欠**：真的点一次 UAC，验通 stdio 回传 + 退出码 + 临时文件清理 ⇒ **本项保持未完成**
  - 🔴 **2026-10-12 真机留痕（本行「用只读动作空转」这条口径的必要性）**：脚本动作白名单只有 `add｜remove｜fix`（`src/elevate/script.ts`）⇒ **没有 no-op 成功动作**，「临时脚本 `exit 0`」与「零规则写入」在产品自身链路里**不可兼得**；2026-10-12 的真机红/绿因此改用**对不存在端口 45999 做 `remove`**（`netsh delete` 必然找不到条目 ⇒ `exit 2`，既跑通全链路又零系统写入，且前后 portproxy 19 条 + sha 不变自证）。新增 no-op 动作要同步改白名单 + 脚本模板 + 三处用例 ⇒ **本轮不新增**，只留痕（design §4 同条）
  - ✅ **2026-10-12 真机结清（证据 = 003 的 `T0.3` 同一条、同批；本代理当场读原件复算）**：批次 `C:\Users\EDY\dsh-probe-artifacts\20261012-150641-batch\` —— `D-E-result.json` 的 **`d1`**：`mechanism` = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru; exit $p.ExitCode`、`exitCode: 0`、`spawnError: null`、`elapsedMs: 1631`、`parsedFromOutFile.ok: true`（payload = `{ok:true, action:"probe-readonly", port:1, steps:[{name:"readonly-admin-check", ok:true}]}`）、`beforeRules: []` / `afterRules: []` ⇒ **本次不写任何系统规则**、**out JSON 可解析**；`cleanup: {scriptRemoved: true, outRemoved: true}` ⇒ **两个临时文件都删除**。驱动 `D-E-driver.mjs` 经**产品产物** `packages/wsl-docker-ports/lib/elevate/index.js` 的 `buildNativeCommand` 造载荷（`:19` 加载、`:102` 调用）⇒ 本行判据三项（**退出码 0 / out JSON 可解析 / `%TEMP%` 无残留**）全中，`F-baseline.log` 的 `TEMP dsh-ppp* = 0` 为收尾旁证。**UAC**：本机 `ConsentPromptBehaviorAdmin = 0`（stack-decision 已记录）⇒ 运行**未弹窗**，「人工点 UAC」在本机不适用（003 的 `T0.3` 记了同一条）。
  - ⚠️ **口径注意（不改本行判据，只留痕）**：`d1` 的脚本动作 `probe-readonly` 是**驱动自造**、**不在产品动作白名单**（`src/elevate/script.ts` = `add|remove|fix`）⇒ 「产品自身链路跑出 `exit 0` 且零写入」这一形态**仍不可兼得**（与上面那条 2026-10-12 留痕一致）；同批 **`d2`（`exitCode: 1`）/ `e2`（`status: "cancelled"`）是该形态下的失败观测**，其缺陷已由 commit `482f697` 修复并带变异哨兵回归门 `tests/unit/elevate-defects.test.ts` ⇒ **两条不计入本条证据**。

- [x] T0.2 [C-1/C-2] 继承 003 的前置结论（2026-10-09 完成）
  - 内容：`netsh` 的**输出编码与解析**（003 的 T0.1 —— 2026-10-08 实测是**纯 ASCII** + CRLF，原「OEM 代码页」假设**已推翻**）与 19 条规则 fixture（003 的 T0.2）**不重复做**
  - 验证：003 的 Phase 0 结论可见且在 fixtures 目录中；若 003 的编码结论变化 → 本 Spec 的脚本读取方式同步
  - ✅ **2026-10-09 完成（集成方独立核，未重复任何真机实验）**：① **结论可见** —— 003 `tasks.md` 的 T0.1/T0.2 均为 `[x]` + ✅ 2026-10-08；② **fixture 在库且可核字节** —— `tests/contract/fixtures/netsh-portproxy-v4tov4.raw`（**1,109 B**、**19 条**列式规则、端口 `80,443,3000,3128,5000-5003,5173,5432,6379,8080,8194,9000,9001,18080,30808,38080,50051`、connectaddress **去重后仅 `172.20.201.152`**、表头英文），**字节事实逐条对上「纯 ASCII + CRLF」结论**：NUL 字节 **0**、CRLF **25**、裸 LF **0**；③ **本 Spec 未另起编码假设** —— 005 侧 17 个源文件（`src/write/**` + `src/elevate/**`）对 `gbk|GBK|OEM|代码页`、`latin1|utf16|utf-16|ucs2`、`charset|TextDecoder|Buffer.from(…, 'utf'|'hex')` **命中全 0** ⇒ 无「OEM 代码页」旧假设的残影，也无需随 003 结论变化而改读取方式；④ **未重复造 fixture** —— 005 测试经 `tests/unit/fake-executor.ts` 走 `../contract/fixtures/<name>` 复用同一份实物。

---

## Phase 1：所有权与写操作

- [x] T1.1 [REQ-1.1][REQ-1.2][REQ-1.3] 所有权匹配算法
  - 验证：`vitest` —— 匹配「本插件规则」/ 拒绝「他人规则」/ `connectPort` 不符即 conflict；断言 conflict **无**任何写动作产生；集合外端口**零参与**（动作产生数 = 0）
  - ✅ 2026-10-09 完成：`src/write/ownership.ts`（`isDeletableRule` = REQ-1.2 的字面谓词；`classifyRuleOwnership` 四态 owned/conflict/not-owned/unmanaged；conflict 只报告不改动）+ `src/write/plan.ts` 的闸门。用例 `tests/unit/write-ownership.test.ts`（10 条：含「同端口既有他人规则 ⇒ 零动作」「集合外端口四种动作全 0 动作」「`eth0` 取不到 ⇒ 连本插件规则也不可删」）
  - 🔧 2026-10-09 集成期订正：本文件的 `OUR_LISTEN_ADDRESSES` **复制件已删除**，改为 `import { expectedListenAddress, OUR_LISTEN_ADDRESSES } from '../diff/engine.ts'`（该常量由 003 侧开出口，全仓唯一一份；脚本模板与 `plan.ts` 的地址字面量也一并收敛到同一来源）

- [x] T1.2 [REQ-2.3][REQ-2.6] 防火墙参数生成
  - 内容：`New-NetFirewallRule -DisplayName dsh-wsl-docker-ports-<port> -Direction Inbound -Action Allow -Protocol TCP -LocalPort <port>`
  - 验证：`vitest` —— 断言**无**通配端口、**无**全量放行；同名已存在 → 报错（不覆盖）
  - ✅ 2026-10-09 完成：`src/write/firewall.ts`（`localPort` 类型是 `number`，模块内不存在「按范围/通配放行」的实现痕；`looksLikeWildcardAllow` 是反向判据）。用例 `tests/unit/write-firewall.test.ts`（10 条：参数逐项、`-LocalPort 5000` 且生成文本里只有这一个端口号、同名已存在 ⇒ `firewall-rule-exists` 零动作、删除只按 `DisplayName`）

- [x] T1.3 [REQ-2.1][REQ-2.2][REQ-2.4] scope 切换序列
  - 验证：`vitest` —— loopback→lan 产生「portproxy add + 防火墙 add」顺序；lan→loopback 产生「两条 delete」；默认值为 loopback；断言切 lan 不是隐式批量
  - ✅ 2026-10-09 完成：`src/write/plan.ts`（`planSwitchScope`：loopback→lan = **恰好两步** `[portproxy-add, firewall-add]`；lan→loopback = `[portproxy-delete, firewall-delete]`；`resolveScope` 缺省 `loopback`）+ `src/write/scope-note.ts`。用例 `tests/unit/write-scope.test.ts`（11 条：顺序逐字比对、声明集合里另两个端口**一个动作都没有**、已是目标作用域 ⇒ 拦下零动作）
  - 🔧 2026-10-09 实现留痕：「一个端口恰好一条规则」的收尾放在**脚本内部**（`Add-Portproxy` 先清同端口另一 `listenaddress` 的残留，只可能命中本插件会写的两个地址之一），这样「切 lan」仍是一次 UAC、且与 T1.3 的两步顺序一致；若同端口存在**无法证明归属**的规则 ⇒ 切换动作在闸门处被拦下（`rule-not-owned`）

- [x] T1.4 [REQ-1.5][NFR-1] 前后快照与任务日志
  - 内容：每次写操作记录 `{ before, after, exitCode, stdout }`
  - 验证：`vitest` —— 日志含四项且 `before/after` 为完整实际集（不是 diff 摘要）
  - ✅ 2026-10-09 完成：`src/write/snapshot.ts`（复用 003 的只读探针，一条解析逻辑都不复制）+ `src/write/log.ts`（`createWriteLogEntry` 对**非完整集形态**抛 `TypeError` ⇒ diff 摘要进不来；`compareOthers` 提供 C-3 的「他人条目不变」判据）。用例 `tests/unit/write-log.test.ts`（9 条：以真机 fixture 的 **19 条**为基准、拒收 diff 摘要、`exitCode: null` 与 `0` 可区分、他人条目内容变了也判得出）+ 红线静态守卫 3 条

- [x] T1.5 [REQ-2.5] `localhostForwarding = false` 的差异说明
  - 验证：`vitest` —— 该键为 false 时 `loopback` 也生成显式规则，且 UI 文案含差异说明（**不静默**）
  - ✅ 2026-10-09 完成：`src/write/scope-note.ts`（`needsExplicitRule` 与文案同一判据；`true` ⇒ 零规则 + 说明；`false` ⇒ 显式规则 + 警示；`null` ⇒ 保守按「需要规则」并警示）。用例在 `tests/unit/write-scope.test.ts`：断言文案含 `localhostForwarding=false`、`与 NAT 缺省时相反`

---

## Phase 2：提权辅助进程

- [x] T2.1 [REQ-3.4][REQ-3.7] 脚本生成与参数结构
  - 内容：生成 `%TEMP%\dsh-ppp-<rand>.ps1`，参数 `-Action/-Port/-Address/-Scope`；**不接受任意命令文本**
  - 验证：`vitest` —— 生成内容只含白名单动作与数字端口；对含 `;`/`&`/反引号的输入断言被拒（不拼接）
  - ✅ 2026-10-09 完成：`src/elevate/script.ts`（模板固定、`param()` 带 `[ValidateSet('add','remove','fix')]` + `[ValidateRange(1,65535)]`；调用方数据**只走 argv**，正文里连端口数字都不出现；`assertScriptParams` 在**任何 IO 之前**校验）。用例 `tests/unit/elevate-script.test.ts`（12 条：`;` / `&` / 反引号 / 非 IPv4 / 端口越界 / 非本插件临时文件名逐项被拒；`$Address` 只允许出现在参数声明与 `connectaddress=` 两处）
  - 🔧 模板里唯一被插值的两个值是**模块常量**（`expectedListenAddress('lan'|'loopback')`）—— 与 T1.1 的订正同源，不是调用方数据

- [x] T2.2 [REQ-3.3][REQ-3.4] `Start-Process -Verb RunAs` 调用与回传解析
  - 验证：`vitest` + fake —— 退出码 `0/2/3/1` 四种映射；输出 JSON 解析；`ok:false` 时 steps 列表可展示
  - ✅ 2026-10-09 完成：`src/elevate/invoke.ts`（native 载荷 `Start-Process -Verb RunAs -Wait -PassThru; exit $p.ExitCode`；gsudo 走绝对路径 + stdio）+ `src/elevate/outcome.ts`（退出码表：`0` 成功 / `2` 部分失败 / `3` 前置不满足 / `1` 异常 / `999` 提权失败；`0` 但回传 `ok:false` ⇒ **按失败**，不做「非 0 的成功」）。用例 `tests/unit/elevate-outcome.test.ts`（9 条）+ `tests/unit/elevate-exec.test.ts`（10 条，含「`ok:false` 时 steps 逐条可展示且 hint 直接点出失败步骤」）
  - 🔴 **2026-10-12 真机订正（缺陷 1：native 载荷漏 `-File`）**：上面这行 native 载荷**少了 `-File`** ⇒ `powershell.exe <script.ps1> <args…>` 是**位置参数**形态，实测**把脚本自己的退出码吞成 `1`**（脚本真跑过、out 文件有载荷：`exit 3` ⇒ 报 `1`、`exit 2` ⇒ 报 `1`；`-File` 形态同条件 ⇒ 未提权 `3`、经 RunAs `2`）⇒ **判别式塌成 `{0,1}`，「逐条展示 steps」与「前置不满足」两个分支成了死代码**。已修（`buildNativeCommand` 改为 `-File` → 脚本 → 参数，与 gsudo/winsudo 的 `psArgs` 同序）+ 回归门 `tests/unit/elevate-defects.test.ts`（含**变异哨兵**：当场渲染旧载荷跑一遍，断言它得到 `1`/`failure` 而非 `3`/`2`）；真机复核见 tasks 的「2026-10-12 真机红/绿」。**能力边界**（不改工具，只留痕）：`gsudo` v2.6.1 经 `pwsh -Command` 包装时子进程退出码 `2/3/7/42/999` **一律塌成 1** ⇒ gsudo 后端下 `2`(partial) 不可区分，**只有 native 后端真能走到 `partial`**

- [x] T2.3 [REQ-3.5] 拒绝 UAC 的失败分支
  - 验证：`vitest` —— fake `Start-Process` 抛错（用户点「否」）→ 报「已取消」、**未**尝试任何回滚、**未**留文件
  - ✅ 2026-10-09 完成：`src/elevate/runner.ts` —— 判据是「**没有任何回传 JSON** 且退出码非 0 / 命中取消文案」；**有回传就绝不判取消**（脚本跑到了终点，归退出码表管）。用例 `tests/unit/elevate-exec.test.ts`：被拒时 `executor` 调用数 `= 1`、那次调用里**不含** `portproxy delete`（无回滚）、两个临时文件都已删；另一条指纹（无文案、仅非 0 退出 + 零回传）同样判 `cancelled`；「退出码 1 + 完整回传」判 `failure` 而非 `cancelled`
  - 🔴 **2026-10-12 真机订正（缺陷 2：非零退出分支从不赋 `stdout`，且 gsudo 不读 out 文件）**：真机 gsudo 回 `exitCode=1` 且 **stdout 151 字节合法载荷**（`steps` 里 `portproxy-delete` 失败），产品却报 `status='cancelled'` / `stdoutLen=0` / 文案「已取消：用户拒绝了 UAC…」⇒ 上面这行的判据「**有回传就绝不判取消**」在真机上**不成立**，因为回传被丢在两个地方：① `runner.ts` 的 `else` 分支只赋 `exitCode`/`stderr`；② **001 的 `createExecutor` 在 `NonZeroExit` 时用 `fail(code, message, { argv, exitCode, stderr })` 造失败对象 —— `stdout` 在 `exec.ts` 就被丢掉了**（不是只丢在 runner）。已修：`stdout = failureStdout(outcome)`（防御性取字段）+ **两条通道都读**（gsudo 优先 stdout、native/winsudo 优先 out 文件，缺一条用另一条兜底）+ 执行器丢掉 stdout 时用 **out 文件原文**补 `stdout`（同一份 JSON 只序列化一次，两通道逐字同源）。回归门同上（门 A：out 文件有载荷 ⇒ 必须 `failure` + 1 条 steps + 非空 stdout；门 B：执行器带回 stdout ⇒ 必须赋上；邻接检查：**连 out 文件都没有**时仍按真·拒绝 UAC 报 `cancelled`，不过度矫正）。**未修（留痕）**：001 的 `fail()` 应收 `stdout` —— 改它不在 005 的文件范围内（005 只拥有 `elevate/**`）；「out 文件存在但不可解析 + 非零退出」仍会判 `cancelled`（本机无法构造该形态，登记为未验证项）
  - 🔴 **2026-10-12 真机红/绿（零副作用配方，端口 45999 ⇒ `netsh delete` 必然找不到条目）**：**修前** `hasFileToken=false`、产品 argv 真跑 = `1`（应 `2`）、`runElevate(native)` = `failure`/`exit 1`/`steps 1`/`stdoutLen 0`；`runElevate(gsudo)` = `cancelled`/`stdoutLen 0`/`steps 0`（**连跑 2 次同形**）。**修后** `hasFileToken=true`（token 序列 `-File` → 脚本 → 参数）、产品 argv 真跑 = **`2`**、`runElevate(native)` = **`partial`**/`exit 2`/`steps 1`/`stdoutLen 152`/「部分失败（退出码 2）：1 个步骤失败」；`runElevate(gsudo)` = **`failure`**/`exit 1`/`stdoutLen 152`/`steps 1`/「脚本异常（退出码 1）」（`partial` 仍不可达 = 上面那条 gsudo 能力边界）。旁证（不经产品链路直连）：同一脚本 `-File` 未提权 ⇒ **`3`**、旧位置参数形态 ⇒ **`1`**、gsudo 直连 ⇒ `exit 1` + **stdout 151 字节** + out 文件 152 字节。系统状态自证：portproxy **19 条 + sha 不变**、防火墙 **816**、我方 group **0**、`DSH Desktop` **2 条**、临时文件两件全删

- [x] T2.4 [REQ-3.1][REQ-3.2][REQ-3.6][NFR-2] 策略与临时文件清理
  - 验证：`vitest` —— `none` 时**未**调用 `Start-Process`（断言调用数 0）；`ask` 时先出确认且命令原文可见；成功 / 失败 / 超时三条路径的临时文件删除各有断言
  - ✅ 2026-10-09 完成：`src/elevate/backend.ts`（策略解析 + 后端探测）+ `src/elevate/runner.ts`（策略门 → 确认 → 探测 → 前快照 → 写脚本 → 执行 → 解析 → **`finally` 里删两个临时文件** → 后快照 → 四项日志）。用例 `tests/unit/elevate-runner.test.ts`（18 条）+ `tests/unit/elevate-exec.test.ts`：`none` ⇒ `executor` 调用数 `0` 且**零快照零写文件**；`ask` 的确认请求带命令原文与两步动作；成功 / 部分失败 / 前置不满足 / 超时四条路径都断言 `cleanup = { scriptRemoved: true, outRemoved: true }`；默认超时 `90_000`；`ask` 但无确认通道 ⇒ 按拒绝处理（保守）

- [x] T2.5 [REQ-4.1][REQ-4.2] 来源约束（Agent）
  - 内容：服务层区分调用来源；**本期不注册任何模型工具**（REQ-4.2）；Agent 来源在 `passby` 下降级为 `ask`（**A-1 已于 2026-10-08 定案 = 方案 A**，切换成本极小）
  - 验证：`vitest` —— 同一动作分别以 `user` / `agent` 来源调用，断言 agent 路径**未**直接进入提权（先确认或拒绝）
  - ✅ 2026-10-09 完成：`src/elevate/backend.ts` 的 `resolvePolicy(policy, source)`（`agent` + `passby` ⇒ `ask`；`none` 不被任何来源提升）+ `runner.ts` 的确认闸门（`reason: 'agent-passby-downgraded'`）。用例在 `tests/unit/elevate-runner.test.ts`：`user`+`passby` ⇒ 确认调用数 `0`、直接执行一次；`agent`+`passby` ⇒ 确认调用数 `1` 且**确认事件在提权之前**；被拒 ⇒ `executor` 调用数 `0`；`none`/`ask` 下 `agent` 与 `user` 同权（不额外放行、不额外拦截）
  - ✅ REQ-4.2 自证：本期 `src/` 内**不存在** `defineTool`（写入路径只提供 `runElevate` 这一层服务函数），登记在 T3.6 的红线断言里

---

## Phase 3：红线与收口

- [x] T3.1 [REQ-1.4] 红线断言：不存在 `portproxy reset`
  - 验证：`grep -rn "portproxy reset" src/` 命中 **0**；`grep -rn "netsh" src/` 的每一处都带 `listenport` 参数（人工复核 + 断言脚本）
  - 🔵 **2026-10-09 D 交付时的口径警告（已归口此处）**：上面第二条 grep 的**朴素写法会误报** —— `src/read/` 与 `src/diff/` 里有**只读**的 `netsh interface portproxy show v4tov4` 散文/提示语（无 `listenport`，合法）。D 已在 `tests/unit/write-log.test.ts` 把它做成**三条可执行断言**：① 写路径内 `portproxy`+`reset` 零命中；② 每一处**可执行**的 `portproxy add|delete` 都带 `listenport`；③ 可执行 netsh 只有 `add`/`delete` 两个动词。⚠️ **这些守卫目前只覆盖 `src/write` + `src/elevate`；把等价断言扩到整个 `src/` 是 T3.1 的活**（别用 naive grep 交差）。
  - ✅ **2026-10-09 完成（集成方）**：`tests/unit/redline-guards.test.ts` 的 **8 条守卫覆盖整个 `src/`** —— ① 禁 `portproxy reset|dump|set`（**连注释也算**，判据用拼接构造以免守卫自命中）② 每处可执行写动作必带 `listenport`（报真实行号）③ 可执行 netsh 动词集合**恰好** `{add, delete}` ④ 写动作落点 = 白名单 `{write/plan.ts, elevate/script.ts}`（**新增调用点即红**，逼一次人工复核）⑤ 只读 `show` 必须精确 `show v4tov4` 且落点收白名单 ⑥ 探针 argv 做**行为断言**（`NETSH_ARGV` deepEqual，比 grep 文本强）⑦ 剥注释**复用 001 的 `strip-comments.mjs`**（SSoT；`write-log.test.ts` 曾自带一份本地正则，已一并替换，消掉口径分叉）⑧ 元断言：扫到 ≥15 个源文件且必需文件在列（**防「扫 0 个文件 ⇒ 全绿」的假绿**）。**变异自证**：拿掉 `listenport` ⇒ 红线②红；注入一条 `portproxy reset` ⇒ 红线①红；两次改回后**哈希一致**、8/8 复绿。
  - 🔵 **口径细化留痕（改口径必须留痕）**：本任务原文的第二条 grep「每一处 `netsh` 都带 `listenport`」被细化为「**可执行写动作**必带 `listenport` + 动词白名单 + 落点白名单」—— 因为 `read/netsh-probe.ts` 的只读 `show` 与 `runner.ts` 的用户提示文案**合法地不带** `listenport`，按原文必然假红（D 交付时已报告，见上一条）。细化后判据**更强**（白名单能抓「新增未审的调用点」，原文抓不到）。

- [x] T3.2 [REQ-1.5][NFR-1][C-3] 真机自证：他人规则条数不变
  - 内容：真机上对一条 `managedPorts` 内端口做 add / remove / fix 各一次，前后各存 `netsh show v4tov4` 快照
  - 验证：**19 条既有规则（他人条目）条数与内容不变**；任务日志四项齐全；结论写入 tasks 与 README
  - ⚠️ 每次写操作**必须人工点 UAC**
  - ✅ **2026-10-12 真机自证（部分结清：`add` / `remove` 已闭环；`fix` 本轮未跑 ✗）** —— 证据目录 `C:\Users\EDY\dsh-probe-artifacts\20261012-154451-final\`
    - **实际执行的是「同端口 45999 + `scope=lan`」的加 / 删各一次**（**不是**「新端口新装」—— 那条按设计不成立，见下）：`A6-plan-add-lan.json` / `A7-apply-add-lan.raw.json` ⇒ `plan steps=2`、`apply status=ok / backend=gsudo / exitCode=0 / executed=[portproxy-add, firewall-add] / 4054ms`，规则 `0.0.0.0 45999 172.20.201.152 45999` 与防火墙 `dsh-wsl-docker-ports-45999` **均出现**；`A8-plan-remove-lan.json` / `A9-apply-remove-lan.raw.json` ⇒ `executed=[portproxy-delete, firewall-delete] / exitCode=0`、**45999 残留 0**。
    - **判据「19 条既有规则（他人条目）条数与内容不变」** ✅：终态 portproxy **19 条 + sha `b9d38664ebb234be8b74945362d86a6c3608d96e6764cbc903b11de955d1056d`**（== 期望值）、防火墙总数 **816** / 我方 **0** / DSH Desktop **2**、`TEMP dsh-ppp*` 残留 **0**（`A10-A-postpilot-recount.txt`）。
    - **判据「任务日志四项齐全」** ✅：`{ before, after, exitCode, stdout }` —— `before`/`after` 由 `B-driver.json` 的 `showV4tov4CallCount=2`（写前写后各**现读**一次 `netsh show v4tov4`）与 `log.before=19 / log.after=19` 坐实；`exitCode` / `stdout` 在「修前 → 修后」表里逐字给出（`482f697` 前 gsudo 分支丢 stdout、修后 `stdoutLen=151/152`）。
    - 🔴 **「新端口」路径按设计不成立（不是缺陷）**：本机 `localhostForwarding=true` ⇒ loopback 下 plan 返回 `steps:[]`、apply 返回 `status:"no-actions"`（`A2-plan-add-response.masked.json` / `A3-apply-add-response.masked.json`，`notes` 逐字「无需 portproxy 规则（WSL 自带的 localhost 转发已开启，NAT 缺省）」）⇒ 本轮改走**同端口 scope 变更**（`loopback → lan`）才拿到真写入。
    - 🔴 **第三动作 `fix` 本轮未跑** ✗ ⇒ 严格按本条字面判据「add / remove / **fix** 各一次」，本条**仍欠一次 `fix`**；我**不**把它写成「三者齐全」。**本行的勾选只代表「add/remove + 他人规则不变」这一半成立**；若主人要求三者齐全 ⇒ 本条应回退为未完成。
    - ⚠️ **UAC 口径**：本机 `ConsentPromptBehaviorAdmin = 0` ⇒ 全程**未弹窗**（`stack-decision.md` 已记录），原文案「必须人工点 UAC」在本机不适用。
    - ✅ **2026-10-16 第三动作 `fix` 真机取证（结清上面那条 🔴 的欠账；🔴 原文保留不改写）** —— 拿到**两条互不掩盖**的结论，驱动 `F-driver.mjs`、证据 `C:\Users\EDY\dsh-probe-artifacts\20261016-005-fix\`（`F-run.log` + `F-driver.json`，**driver exit 0**）：
      - **① 规划层：`fix` 对漂移规则必然被拦下（`rule-not-owned`、**0 步**）** ⇒ 合成漂移与**真机真实规则**两种输入结论一致，且**不给 `portState`** 也一样（结论不依赖我传的状态）。同一门也拦 `remove` ⇒ **漂移规则在当前口径下既不能 `fix` 也不能删**：`plan.ts` 的 `planFix` 成功分支（`[portproxyDeleteStep, portproxyAddStep]`）是**死代码** —— 因为 drift 的定义就是 `connectAddress ≠ 当前 eth0`，而 REQ-1.2 的删除前置要求等号成立。拦下文案逐字：「漂移规则的 connectAddress 是旧 eth0，而不建台账无法证明它是本插件写入的历史值 ⇒ 按字面口径不受理；需集成方裁定 REQ-1.2 与 REQ-1.3 的差集口径」。
      - **② 提权脚本 + 执行链：`fix` 真机可跑、且真把地址修回来** —— 手工构造计划（**明确声明：这是绕过规划层的能力测试，构造用的是产品自己的 `portproxyDeleteStep` / `portproxyAddStep`**）：造漂移 `add`（旧地址 `172.20.201.199`，`status=ok / exit 0 / backend=gsudo`）⇒ **`fix`**（`status=ok / exit 0 / steps=[portproxy-delete ok, portproxy-add ok]`、`log{before=20, after=20, exitCode=0, stdoutLen=181}` ⇒ **T3.2 的「任务日志四项齐全」在 `fix` 上单独成立**）⇒ 规则地址真变回 `172.20.201.152` ⇒ `remove` 复原（三条全 `exit 0`）。
      - **副作用边界与终态自证**：只动端口 **45999**（基线必须不存在 —— 驱动内硬守卫，否则直接中止）、`scope=loopback`（**不碰防火墙**）；终态 **19 条 + sha 与本次基线逐字节相同（`a3210c43db6b4eec…`）**、45999 残留 **0**、防火墙 `823 / 我方 0 / DSH Desktop 2`（前后同一读数）、`TEMP dsh-ppp*` **0**、两个临时文件已删。
      - 🔴 **由此产生的口径裁定项（登记；我没擅自改产品）**：二选一 —— (a) 裁定 REQ-1.3（**声明集合内**且 `connectAddress` 是「非当前 eth0 的合法 IPv4」⇒ 视为本插件历史写入，允许 `fix`/删），或 (b) 保持拦截、把「修复」按钮改成**只报告 + 给手工清理命令**（现状 = UI 会显示上面那段拦下文案）。**在这条裁定前，用户遇到真实漂移时我们这个按钮帮不上忙** —— 这是本 Spec 现在最值得优先处理的一条。
    - ✅ **2026-10-16 裁定 (a) 已实施 + 真机复跑（产品路径；上面那条 🔴 的处置，原文与两份结论都保留不改写）** —— 主人令「先走推荐」= 采纳 **(a)**：**只放宽 `fix`**，`remove` 保持 REQ-1.2 字面（删除是破坏性的）。REQ 侧的口径订正见 [requirements.md](./requirements.md) 的 REQ-1.2 条目下方新增块。
      - **实施点（3 个源文件）**：① `src/write/ownership.ts` 新增 `fixableDriftRule(match, expectedConnectAddress)`（判据 = `listenPort ∈ managedPorts` **且** `listenAddress ∈ {127.0.0.1, 0.0.0.0}` **且** `connectPort === listenPort` **且** `connectAddress` 是**合法 IPv4 且 ≠ 当前 eth0**）+ 把 `isIpv4` 从 `plan.ts` 挪来（**单一真相来源**，顺带让 `plan.ts` 守住 ≤400 行）；`isDeletableRule` 的注释写明它**只**服务 `remove`/`switch-scope`。② `src/write/plan.ts` 的 `planFix` 用它挑目标，**作用域沿用既有规则**（`scopeFromRules([rule])`）而**不是**入参 `scope`：入参来自用户配置的 `scopes`（缺省 loopback），照它重建会把 lan 规则**悄悄降级成 loopback**（真机 19 条全是 `0.0.0.0`）⇒ 作用域变更只属 `switch-scope`（REQ-2.4）。③ `src/client/drift-fix.ts` **只改注释**（口径留痕；`blocked === null` 即成功 ⇒ **零 UI 变更**）。
      - **测试**：`tests/unit/write-ownership.test.ts` 三处改写 + 新增边界 6 例（非 IPv4 ⇒ 仍 `rule-not-owned`；`listenAddress=192.168.1.5` ⇒ `state-conflict`；`connectPort=6001` ⇒ `state-conflict`；集合外端口 ⇒ `port-not-managed`；`portState=ok` ⇒ `state-precondition`；`eth0Ip=null` ⇒ `eth0-unknown`）；`tests/unit/client-rows.test.ts` 改为断言 `fix.blocked === null` + 新增非 IPv4 负例控（旧断言作为原文留痕保留）。
      - **整包质量门（全绿；日志 `20261016-fix-a\{gates-1..5}.log`）**：`tsc -p tsconfig.json` exit 0 · `node --test` **431/431 pass** · `vitest run` **15 文件 / 133 用例全通过** · `check-exports` **25 断言 0 失败** · `check-size` exit 0（最大文件 396 行）· `build` 三步 exit 0（**主 bundle 44,621 B 一字未变** = 棘轮余量 0 B 守住；渲染面 chunk `lib/client.ports.js` 111,947 → **113,289 B**，chunk 无预算上限）· `verify-client-loader` **40 断言 0 失败** · `assert-client-split` **17 断言 0 失败**（12 个 CUT_MARKERS 齐备）· `verify-host-entry` **18 断言 0 失败**。
      - **真机复跑（全程走产品规划层，不再手工造步骤）**：驱动 `G-driver.mjs`、证据 `20261016-fix-b\{G-run.log,G-driver.json}`（**driver exit 0**）。读数：[A] 规划层 loopback 漂移 `fix` **放行 2 步**（scope=loopback）、**lan 漂移 `fix` 放行 2 步且 scope=lan**（入参故意给 loopback，钉住「不静默降级」）、负例控（非 IPv4 / 漂移 `remove`）**仍拦**；[B] 用**规划层自己的 `add` 计划**造漂移（`0.0.0.0:45999 → 172.20.201.199`，`status=ok / exit 0 / backend=gsudo`，脚本步骤 `portproxy-add+firewall-add`）；[C] **真机真实规则喂规划层 ⇒ `fix = 放行(2 步, scope=lan)`**（F 轮此处是 `rule-not-owned` —— **这就是本裁定修好的那一点**）；[D] **把规划层产出的计划对象直接喂执行链**：`status=ok / exit 0`、脚本步骤 `[portproxy-delete, portproxy-add, firewall-add]`、地址真变回 `172.20.201.152`；[E2] 规划层 `remove` 复原（`exit 0`）；[F] 终态 **19 条 + sha 与基线逐字节相同（`a3210c43…`）**、`ourName` 0、`ourGroup` 0、fwTotal 823 = 基线、`TEMP dsh-ppp*` 0、临时文件已删。
      - 🔴 **本轮新发现（三条，都不是「已修」）**：**(i)** `fix@lan` 会**无条件** `New-NetFirewallRule`（`script.ts:295` → `254-263`）；`apply.ts:248` 的存在性闸门只按**步骤表**里的 firewall-add 判（`firewallAddNames(only.steps)`），而 fix 计划里没有该步 ⇒ **拦不住** ⇒ 同名规则已存在时会**叠一条**（真机实测 `ourName` 1 → 2，`apply.ts:285-287` 的 hint 自己就承认「脚本按动作+作用域决定放行，不看步骤表」）。`remove`/`switch-scope` 的 `Remove-Firewall` 按 DisplayName 删，能一并清掉 ⇒ 终态回 0。**(ii)** `remove` 的 `plan.scope` **不随既有规则**（`planOf` 留入参）而脚本按 `plan.scope` 分派（`script.ts:288-291`）⇒ 用户配置缺省（loopback）时删 lan 规则会去删 `127.0.0.1`（失败、且不删防火墙），而步骤表（`removalSteps` 用 `scopeFromRules`）却写着 `firewall-delete` ⇒ **步骤表与真实执行分叉**（与 `fix` 同源、不同动作；本轮**未修**，超出裁定 (a) 范围；零写入旁证见 G 的 `[E1]`）。**(iii)** `fix` **没有用户可达路径**：行内「修复」按钮的 `ElevationInvoker` 未实现（`pane.tsx:278` ⇒「写路径不可用：本行只做只读展示」；`plugin.ts:236-243` 登记为 gap），而写面板的目标动作按 009 `REQ-7.2` 只有 `add`/`remove` ⇒ **裁定 (a) 的产品价值要等这条接线才落地**。⇒ 「真的点一次修复」在本轮**做不到** —— 不是「没跑」，是**没有这条路径**；故取证停在「规划层 + 执行链」这一层（真机真写、真复原）。三条均已进收口记录遗留清单（⑫ / ⑬ / ⑭）。

- [x] T3.3 [REQ-5.1][REQ-5.2][REQ-5.3][REQ-5.4] 卸载语义与清理清单
  - 验证：`vitest` —— 卸载**未**产生任何 delete 调用；清理清单含端口/规则名/地址且可复制；临时文件归零
  - ✅ **2026-10-09 完成（子代理 I，离线零真机 / 零提权）**：`src/write/cleanup.ts`（118 行，纯函数：结构化清单 + 可复制文本 + 显式清理步骤；判定复用 REQ-1.2 的 `isDeletableRule`，命令文本复用写路径既有渲染器 ⇒ 清单与真机执行的命令**逐字同源**）+ `src/write/uninstall.ts`（254 行：`dispose()` 零写调用 + 临时文件**二次扫描**归零 + `runExplicitCleanup()` 显式入口）+ `tests/unit/uninstall-cleanup.test.ts`（279 行，7 条用例）。
  - 证据逐条：① **REQ-5.1** = 注入 fake 执行器（写通道）后 `dispose()` 的 `calls.length === 0`、`report.systemStateTouched === false`（类型层写死 `false`），且同一次 dispose 仍交付清单；② **REQ-5.2** = 清单逐项断言端口 / 规则名（`firewallRuleName`）/ 地址，`text` **逐字等于** 4 行命令（`v4tov4 … listenport=<p> listenaddress=<addr>` + `Remove-NetFirewallRule -DisplayName "<规则名>"`），并断言 `text` 每一行都是命令、不含「请手工清理」空话；③ **REQ-5.3 / NFR-2** = 两个崩溃残留（`<TEMP_PREFIX>-<rand>.ps1` 与 `-out.json`，即 runner 三条路径没来得及删的两种产物）删 2 个 / 残留 0（**二次扫描**得出，不靠本地账），同前缀非产物只 `skipped` 报告不删；④ **REQ-5.4** = 显式清理恰好 4 步（2 条转发删除 + 2 条防火墙删除），`listenPort ∈ managedPorts` 但 `connectAddress ≠ 期望 eth0` 的 6001 与集合外的 5432 **零动作**。**分界留痕**：显式清理**不**挂在 `dispose()` 上，两个入口在 `uninstall.ts` 文件头注释里写明。
  - **变异自证**：① 让 `dispose` 多发一次写调用（`await writeChannel([])`）⇒ 「T3.3 ①」**红**（1 fail）；② `targets.slice(0,1)` 漏删一个残留 ⇒ 「T3.3 ①/③ + 稳健性」**红**（3 fail）；两次回滚后三文件 SHA256 **与改前一致**、225/225 复绿。`typecheck` exit 0；`test` **218（基线）→ 225（+7）全绿**（同包 `tests/unit/managed-ports-*.test.ts` 由另一代理并行，本次未触碰）。

> 🔵 **2026-10-09 T3.3 交付时的两处集成缺口（子代理只报不改 ⇒ 登记在案，接线前必须处置）**
> ① 🔴 **「显式清理」与提权请求形状不匹配**：`ElevateRequest.plan` 是**单端口**形状（`action` / `port` / `scope` / `eth0Ip` / `steps`）、`WriteAction` **没有 cleanup 取值**，而清理步骤天然**跨端口**（本机 19 条 ⇒ 直接循环就是 **19 次 UAC**，不可接受）。**集成方裁定：一次用户动作 = 一次提权 = 一个批量 plan**（`steps` 本来就是数组），在 `write/plan.ts`（**T3.1 落点白名单内的文件**）里生成清理 plan、给 `WriteAction` 增一个取值并明确 `port` 语义。**安全边界不放宽**：每个 step 仍是 `portproxyDeleteStep(rule)` 的输出、**逐条带 `listenport`** ⇒ T3.1 守卫②（写动作必须带 listenport）与动词白名单 `{add, delete}` 原样成立；「批量」不得成为绕过精确四元组的借口。本项**不改任何栈维度**，落地时机 = Phase 5 清理按钮接线 / 收口。
> ② ⚠️ **eth0 漂移 × 本插件自己写过的规则（需主人裁决）**：严格照 REQ-1.2 字面，`connectAddress ≠ 当前 eth0` 的规则**既不在清理清单、显式清理也不删**（保守 = 少删）。后果：漂移后又换过地址时，用户拿不到那几条的命令。三选项：**保持现状**（现状） / 按「历史 eth0」放宽 / 清单里单列「疑似本插件旧规则（仅展示、不删）」一节。这与「005 REQ-1.2 的 `connectAddress` 前置条件」是**同一处口径** ⇒ 与该项**一并请主人裁决**；当前保持现状。

- [x] T3.4 [NFR-3][NFR-4] 质量门 · ✅ **2026-10-09 通过（集成方复算）**
  - 验证：`pnpm -C packages/wsl-docker-ports typecheck` + `test` + `build` 三绿并记录用例数；单文件 ≤ 400 行
  - ✅ **复算（命令 + 结果，全部本机实跑）**：① `typecheck` ⇒ **exit 0**；② `test`（`node --test`）⇒ **225 tests / 225 pass / 0 fail**；③ `build` ⇒ **exit 0**（第 4 件「构建产物入口」由 T3.4 之后的入口交付，见下）；④ **构建后真 `import('lib/index.js')`** ⇒ 成功、**27 导出**（004 T3.2 同款防假绿要求：只跑 `tsc` 不 import 产物会漏掉 CJS 互操作类缺陷）；⑤ **单文件 ≤ 400 行（SHALL，原始行数）**：本包（003+005 共用）`src/` + `tests/` 最大 **392 行**（`src/read/connection.ts`）⇒ 本 Spec 范围**零超线** ✓
  - 🔴 **跨 Spec 如实披露（不是本门的问题，但同一把尺子量出来的）**：全仓扫 **142 个源文件**（`packages/*/{src,tests}`，排除 `node_modules` / `lib`）后，**唯一**超线者是 `packages/terminal-profiles/tests/unit/plugin-entry.test.ts` = **401 行**，属 **002** 的在制品（该文件本轮 397 → 401 仍在增长，作者代理**正在跑**）⇒ 已**当场通知**该代理压回 ≤ 400，并把「最终最大行数」列为它收工自证项。另有 `service-surface.test.ts` = 398 行（2 行余量，同为 002 在制品）。
  - ⚠️ **本门只算「三绿 + 行数」**，不代替 T3.2（真机「他人规则条数不变」）与 T3.7（真机 UAC 链路）—— 那两项需主人在场。
  - 📌 附带发现（已入 stack）：构建门让「清单四件套」的第 4 件（产物入口）成为**唯一的清单缺口**；本包 `exports["."]` 仍指 `./src/index.ts`（尚无 `apply` 入口）⇒ `cordis.patch.yml` 文件头已写明「入口交付前**不得**用于 T0.5 装载验证」。

- [x] T3.5 文档回写
  - 内容：T0.1（提权链路真机结论）、T3.2（规则不变证据）→ 回写 requirements/design；**A-1（降级为 `ask`）与 A-2（卸载不自动清理）均已于 2026-10-08 定案** ⇒ 本任务只剩真机结论回写
  - 验证：`grep -n "A-1\|A-2\|reset" specs/005-elevation-write-path/*.md` 可见结论（**A-1 已于 2026-10-08 定案 = 降级为 `ask`**；A-2 已确认）
  - 🟡 **2026-10-09 集成方预核：本行**故意不勾**（判据已过、内容未齐）** —— 验证判据（`grep`）实测**已通过**：`A-1|A-2|reset` 在四份文档里分别命中 design **6**（L27/30/78/120/122）/ README **7**（L23/43/70/71/105）/ requirements **5**（L30/58/66/89/90）/ tasks **7**（L71/80-83）；但**内容**要求的「T0.1（提权链路真机结论）+ T3.2（他人规则条数不变证据）」两项**都还没跑**（每次要人工点 UAC）⇒ 本任务只剩的那部分**仍被真机阻塞**，等主人到场后与本 Spec 的 T0.1 / T3.2 一起收口。
  - ✅ **2026-10-12 内容回写已完成（本行据此勾掉）**：`requirements.md` 新增 **§5「真机结清记录（T0.1 / T3.2，2026-10-12）」**、`design.md` 新增 **§9 同名小节** —— 两处都写进 **T0.1 的提权链路真机结论**（`D-E-result.json` 的 `d1`：`exitCode 0` / `parsedFromOutFile.ok=true` / `cleanup.scriptRemoved=true & outRemoved=true` / `beforeRules=[] & afterRules=[]`）与 **T3.2 的「他人规则条数不变」证据**（portproxy `19` + sha `b9d38664…` / 防火墙 `816 / 0 / 2` / `TEMP dsh-ppp* 0`），并逐条附**证据路径**。⇒ 本条的两项内容要求（真机结论 + 规则不变证据）**都已有实物**，不再处于「判据已过、内容未齐」。
  - ⚠️ **回写的诚实边界（已一并写进那两节）**：`d1` 的脚本动作 `probe-readonly` 是**驱动自造、不在产品动作白名单**（`add|remove|fix`）⇒ 「产品自身链路跑出 `exit 0` 且零系统写入」这一形态**仍不可兼得**；`999` / `cancelled` 两条分支在本机**不可复现**（`ConsentPromptBehaviorAdmin=0`）。

- [x] T3.7 [REQ-3.4] 提权后端链（`gsudo → native`，A-3）
  - 内容：探测**用户自装**的 `gsudo`（用 `where.exe gsudo`，**不认 `sudo` 别名** —— gsudo 安装器会造同名别名）；有则走其 **stdio 回传**，并把 **exit code 999** 判为「提权失败」；`gsudo status` 显示**缓存活跃** ⇒ 回落 `Start-Process -Verb RunAs` + 临时文件；**不安装 / 不改 PATH / 不动 gsudo 配置**（尤其 `CacheMode`）。Windows 自带 `sudo` 仅 `elevationBackend: winsudo` 时启用（本机 23H2 无法验证 ⇒ 登记为未验证项）
  - 🔴 **「不认 `sudo` 别名」已由本机实测坐实（2026-10-09，只读）**：`Get-Command sudo -All` 在本机**只有一条**，指向 `D:\Program Files\gsudo\Current\sudo.exe`（`CompanyName = Gerardo Grignoli`、`ProductName = gsudo`、`FileVersion = 2.6.1.0`），而 **`%SystemRoot%\System32\sudo.exe` 不存在**（`Test-Path` = False，23H2 符合预期）⇒ **凡按命令名 `sudo` 探测者，在本机必然误判「Windows 自带 sudo 可用」并走进 winsudo 分支**（实际执行的还是 gsudo，语义完全不同）。本规则不是预防性洁癖，而是本机**真实陷阱**；探测必须走 `where.exe gsudo` / 按**路径 + 产品名**判定
  - 验证：真机各跑一次 —— ① `gsudo` 路径下 stdout / stderr / exit code 三样都拿得到（含故意失败 → **999**）② 造一个活跃缓存 → 回落 native 且**无临时文件残留** ③ `elevationBackend: native`（或未装 gsudo）仍成功
  - 🔵 **离线面已实现（2026-10-09，零真机）**：`src/elevate/backend.ts`（按**路径**认 `gsudo`、读 `gsudo status`、`winsudo` 仅显式配置且固定路径存在才用、其余一律回落 native）+ `src/elevate/invoke.ts` 的三条调用形态 + `runner.ts` 的 `999 ⇒ elevation-failed`。用例 `tests/unit/elevate-backend.test.ts`（10 条，含**反向断言**：任何一次探测都不许以 `sudo` 为命令名）+ `tests/unit/elevate-exec.test.ts` 的 gsudo 两组。**本项仍未完成**：真机弹窗 / 真缓存 / 真实 999 未验（每次都要人工点 UAC）
  - 🔵🔴 **2026-10-12 真机逐条标态（判据不勾 —— ② 越界未跑 ⇒ 本行保持 `[ ]`）**：
    ① ✅ **stdout / stderr / exit code 三样都拿得到**（含**故意失败 999**）：`B-driver.json` 的 `execs` 里 gsudo 调用 `keys=[ok,code,message,argv,exitCode,stderr,stdout]`、`stdoutLen=151`、`exitCode=1`；**`999` 的真机形态**见同批 `gsudoExitCollapse` = `child_0→0 / child_1→1 / child_2→1 / child_3→1 / child_7→1 / child_42→1 / child_999→1` ⇒ 只有 gsudo **自身**调用失败才是 `999`（子进程退出码会被 `pwsh -Command` 包装塌成 `1`；`design.md` §4 已留痕）。
    ② ✗ **未跑（越界）**：造一个**活跃 gsudo 凭据缓存**要改用户 gsudo 全局配置（违反「不装工具 / 不改 PATH / 不动用户 gsudo 配置」）⇒ 本轮**不执行**，**native 回落分支没有真机样本**。
    ③ ✅ **native 后端机制**：`B-driver.json` 的 `defect1` ⇒ `runElevateNative status="partial" / exitCode=2 / backend="native" / steps=[portproxy-delete ok=false] / cleanup 两文件已删`；「产品链退出码」由 `482f697` 修复并被真机复核（修前 `cancelled`、修后 `partial`/`failed` 正确）。
    ④ ✅ **2026-10-15 ② 真机结清（判据 ② 由「越界未跑」转为已跑 ⇒ 本行据此勾掉）** —— 方法与实物：
      - **造活跃缓存（含一条订正事实）**：`gsudo cache on` 实测**看不见** —— 凭据缓存按**控制台**绑定，随创建它的进程/控制台退出即消失（同一条 pwsh 里 `Available for this process: True` + `CacheSessionsCount: 1`，**下一条命令（新控制台）读回 `CacheAvailable:false / CacheSessionsCount:0`**）；探针实例自己两发生效后，我的新控制台读到 `CacheSessionsCount:2` 而 `CacheAvailable:false` ⇒ **控制台绑定被双向证实**。因此改用**主人本轮授权**的 `gsudo config CacheMode Auto`（⚠️ 它写的是 **HKLM 全局系统设置**、需提权；**已还原为 `Explicit`**，我早先误写的 `HKCU\Software\gsudo` 键也已删除、该键原本不存在）。
      - **回落 native 真机发生**：`switch-scope` 6379（`lan→loopback`）那发走 **`gsudo`**（`status:"ok"` / `backend:"gsudo"` / `executed:[portproxy-delete,firewall-delete]` / `durationMs:7210`）—— 这一次 gsudo 调用在**实例自己的控制台**里按 `Auto` 自动建了缓存；**紧接的** `loopback→lan` 那发 `probeOf` **重新探测**并读出缓存活跃 ⇒ **`backend:"native"`**（`status:"ok"` / `executed:[portproxy-add,firewall-add]` / `durationMs:3940`）✅
      - **零临时文件残留（有正证据，不是空断言）**：100 ms 轮询 `%TEMP%\dsh-ppp*` 抓到**两条链各自的**产物 —— gsudo 那发 `dsh-ppp-f615ac3fc991.ps1` 4961 B + `dsh-ppp-f615ac3fc991-out.json` 188 B；**native 那发 `dsh-ppp-0525b06f15a2.ps1` 4961 B + `dsh-ppp-0525b06f15a2-out.json` 179 B`；事后计数 **0**（`temp-poller3.log`）
      - **顺带真机证实两条既有设计**：① **计划面的探测结果被缓存**（同一目标 `plan` 仍报 `elevation.backend:"gsudo"`，而 `apply` 面重探得 `native`）⇒ 正是「缓存的陈旧值**不可能造成一次错误的写**」（`backend.ts:343-350`）的口径；② **策略门 fail-safe**：`elevationPolicy` 未配置时 `plan` 报 `policy:"unknown"` 而 **`apply` 一律 `status:"disabled"` / `executed:[]` / `elevationPolicy:"none"`**（「未配置」被保守判成 `none` ⇒ 零提权零写入）
      - **系统状态逐项还原**：portproxy **19 条、与改动前基线集合差异 0 缺失 / 0 多出**；防火墙 **总 821 / 入站 Allow 532 / 6379 相关 1 条（`WSL2 Port 6379`）**＝改动前基线（插件新建的 `dsh-wsl-docker-ports-6379` 已用 `gsudo netsh advfirewall firewall delete rule` 删除）；`%TEMP%` 净
      - 证据目录：`C:\Users\EDY\dsh-probe-artifacts\20261015-statenote\`（`temp-poller3.log` / `cordis.patch.before-005.yml`）

- [x] T3.6 [REQ-4.3] 红线断言：未注册 Agent 工具（来源约束的门禁）
  - 内容：本期**不注册任何 Agent 可调工具**；将来若注册，**必须先**补齐 REQ-4 的完整口径（错误语义、审批、日志）再放行，不得以「先能用」为由先行放行
  - 验证：`grep -rn "defineTool" src/` 命中 0，或命中处均附 REQ-4 口径补全的引用与用例；`vitest` 断言工具表内不存在本包来源的工具
  - ✅ **2026-10-09 完成（静态面，集成方）**：`redline-guards.test.ts` 的 T3.6 守卫对**整个 `src/`** 断言 `defineTool` / `tools.register` / `ctx.tools` **三处零命中**（可执行断言，替代人工 grep）。本包的确认通道是**注入的** `ElevationDeps.confirm`（由调用方接 UI），与宿主工具/审批面零耦合。
  - 🔵 **残余项转移（不是丢弃）**：验证里的第二条「断言工具表内不存在本包来源的工具」需要**工具表存在**才有断言对象 —— 本包至今没有任何注册代码，工具表要到收口阶段（002 T7.1 导出服务 / 004 注册 6 工具）才出现。该断言**并入 004 的 T3.2**（那里本就要求「卸载后工具数归零」），在本 Spec 记为已转移。

---

## Phase 2b：产品内闸门（A）与审计留痕（B）　← 2026-10-09 主人拍板新增

> 背景：真机实测本机 `ConsentPromptBehaviorAdmin = 0` ⇒ **UAC 不弹窗**，「UAC = 人类闸门」不成立，Agent 可零交互提权改写系统状态。闸门因此收回产品内，且**与 OS 行为解耦**。**阻塞**：写入传输尚未接 HTTP/UI（005 当前的 gap），本 Phase 的验收要等它接线后才能做端到端。✅ **2026-10-15 阻塞已解除**（008-write-transport / 009-write-ui 均已 `complete`，写通道已接 HTTP 与 UI）⇒ 本 Phase 终判本轮已做。

- [x] **T2b.1（A·强制）** 提权写入前的应用内确认 + **变更预览**：逐条列出将新增/删除的规则（作用域 · 监听地址 · 端口 · 连接地址 · 是否伴随防火墙规则）、命令条数与影响面。判据：① 未确认 ⇒ 零提权、零写入（spy 全 0）；② 拒绝 ⇒ 失败可读且零残留；③ 确认文案含每条规则的端口与作用域（不是「即将执行」这种空话）；④ **在 UAC 不弹窗的机器上同样生效**（与 OS 行为解耦，用假后端断言）。
  - 🔵 **2026-10-12 真机部分证据（判据只中 ③；本行保持 `[ ]`）**：③ ✅ **确认文案含每条规则的端口与作用域** —— `A6-plan-add-lan.json` 的 `ports[].steps[].commandText` 逐字含 `listenport=45999` / `listenaddress=0.0.0.0` / `connectport=45999` / `connectaddress=172.20.201.152`，`notes` 写「局域网作用域：需要 0.0.0.0 的 portproxy 规则 + 仅放行该端口的入站 TCP 规则」；plan 回包带 `confirm.ticket` + `expiresAt`，apply 必须带 `confirmed:true` + `ticket`（`A-write-pilot.log` / `A2-lan-pilot.log`）⇒ 闸门**存在且被满足**。④ ⚪ **部分**：本机 `ConsentPromptBehaviorAdmin=0`（**UAC 不弹窗**）而产品内闸门照常要 ticket ⇒ 「与 OS 行为解耦」有正向现场，但**未**用假后端断言。① ✗ **未跑**：无「确认缺失 ⇒ 零提权零写入（spy 全 0）」样本（本轮 apply 一律带 `confirmed:true`）。② ✗ **未跑**：无「拒绝确认 ⇒ 失败可读且零残留」样本（近似的 `B-driver.json` `gsudoDirect` 失败带 `cleanup` 两文件已删，但那**不是**「用户拒绝」）。
    - ✅ **2026-10-15 结清（⇒ 本行据此勾掉；上面 2026-10-12 那行里的「本行保持 `[ ]`」是当时的现场记录，保留不改写）** —— ① ② ④ 由「未跑」转为**已跑绿的可执行断言**，③ 沿用 2026-10-12 真机现场；本轮**零生产代码改动**：
      - ① **未确认 ⇒ 零提权、零写入** ✔ `tests/unit/transport-apply-plan.test.ts` 两条：`T2.2 ② 确认门：未确认 / 畸形 body / 篡改目标 ⇒ 零执行零审计，且**不吃掉票据**`、`T2.2 ① 票据门四态：无票 / 错票 / 从未签发 / 过期 ⇒ 四种可区分拒绝 + 零执行 + 零写入 + 零审计` —— 台架执行器调用数 0、审计 0 条（就是「spy 全 0」的可执行形态）。
      - ② **拒绝 ⇒ 失败可读且零残留** ✔ 拒绝原因是**四种可区分**的具名值（不是「即将执行失败」这类空话）；「零残留」由三条覆盖：`T2.5 ⑥ 什么都没写（UAC 被拒 / 脚本没跑起来）⇒ **不做任何回滚**（防误删他人规则）`、`T2.3 用户拒绝 UAC（native：Start-Process 抛错 + 无 out 文件）⇒ 报「已取消」且不做回滚`、`T2.3 超时：按失败处理，且两个临时文件照样清理` ⇒ 拒绝/超时都不进提权、无半成品、临时文件清零。
      - ④ **与 OS 行为解耦（用假后端断言）** ✔ 上面两条断言的后端是注入的**假执行器**（零提权、零进程），闸门照样拦下 ⇒ 「UAC 不弹窗的机器上同样生效」这条是**可执行**判据；真机侧同一现场仍在（本机 `ConsentPromptBehaviorAdmin=0`、UAC 不弹，而 apply 必须带 `confirmed:true` + `ticket`）。
      - **实跑证据**：`node --test --test-concurrency=1 <4 个文件>` ⇒ `tests 18 / pass 18 / fail 0 / exit 0`；同轮 `vitest run` ⇒ `14 files / 128 tests / exit 0`。日志 `C:\Users\EDY\dsh-probe-artifacts\20261015-statenote\gates-005-focused.log`。⚠️ 同轮**全量** `node --test` 是 `429 tests / 424 pass / 5 fail`，那 5 条**与本判据无关**（根因：本机 `@deepseek-ai/schemastery@3.18.4` 只存在于 `D:\nodejs\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\schemastery`，而 `src/config.ts` 的 9 个锚点全 `MODULE_NOT_FOUND` ⇒ `Config === undefined`），按「额外发现只记录、不顺手改」留待主人裁定。
- [x] **T2b.2（B·强制）** 审计留痕：每次提权写操作（含拒绝/超时/失败/回滚）落一条人类可读记录（时间 · 来源 agent/user · `elevationPolicy` · 实际后端 · 端口与作用域 · 结果与退出码 · 耗时 · 是否回滚），**不含任何凭据/口令**。判据：① 成功与失败各留一条；② 记录里能读出实际后端（`gsudo` / `native`）；③ 敏感词扫描零命中。
  - 🔵 **2026-10-12 真机部分证据（判据 ① 未跑 ⇒ 本行保持 `[ ]`）**：路由**存在**且受令牌保护 —— `A0-route-probe.txt` 里 `POST /dsh-wsl-docker-ports/write/audit => 401`（无令牌被拒）。② ✅/⚪ **实际后端可读出**：`A2-lan-pilot.log` 的 apply 回包含 `"backend":"gsudo"`，`B-driver.json` 的 native 侧含 `"backend":"native"` ⇒ 记录里**能**读出后端。① ✗ **未跑**：本轮**没有**读回一条审计记录的实物（「成功与失败各留一条」无样本）。③ ✗ **未跑**：没有对审计文本做敏感词扫描的样本。
    - ✅ **2026-10-15 结清（⇒ 本行据此勾掉；上面 2026-10-12 那行的「本行保持 `[ ]`」为当时现场记录，保留不改写）** —— ① 的成功侧取到**真机实物**、② 两条链都留痕、③ 为可执行扫描；本轮**零生产代码改动**：
      - ① **真机 2 条**（上一批 `switch-scope` 6379 往返时**产品自己落的行**，本轮从探针实例 stdout 原件读回，不是测试造物）：
        - `[dsh-wsl-docker-ports] audit seq=1 at=2026-10-15T04:22:59.337Z origin=user result=applied action=switch-scope scope=loopback ports=6379 steps=portproxy-delete@6379 policy=passby backend=gsudo exit=0 ms=7210 rolledBack=false planId=635b0cf3ac92 note=提权脚本执行成功（退出码 0）`
        - `[dsh-wsl-docker-ports] audit seq=2 at=2026-10-15T04:23:43.586Z origin=user result=applied action=switch-scope scope=lan ports=6379 steps=portproxy-add@6379+firewall-add@6379 policy=passby backend=native exit=0 ms=3940 rolledBack=false planId=70fb2a0a2541 note=提权脚本执行成功（退出码 0）`
        - 原件 `C:\Users\EDY\dsh-probe-artifacts\20261015-statenote\probe2.out.log`；字段齐备：时间 · 来源 · 生效档 · **实际后端** · 端口与作用域 · 结果与退出码 · 耗时 · 是否回滚。
      - ① **失败侧**（口径诚实：样本是**可执行断言**，真机上我**没有**制造过一发失败的提权写 —— 那会动系统状态）：`tests/unit/transport-apply-rollback.test.ts:48-51` 的「失败也要留一条审计（这是真发生过的动作）」＝ `result='failed'` + `rolledBack=true` + `audit.size()===1`；`T2.5 ⑥` 尾部同样断言「尝试过但失败 ⇒ 审计记 failed」⇒ 「成功与失败**各留一条**」在记录层成立。
      - ② **实际后端可读出** ✔ 上面两条真机行分别是 `backend=gsudo` 与 `backend=native`（**两条链各一条**），并带**生效档** `policy=passby` 与 `origin=user`（不是配置档、不是「猜是用户」）。
      - ③ **敏感词扫描零命中** ✔ `T1.6 ③ 🔴 白名单拷贝：凭据/原始请求体等额外字段进不了记录` —— 字段白名单恰 15 项（`action/at/backend/durationMs/elevationPolicy/exitCode/note/origin/planId/ports/result/rolledBack/scope/seq/steps`），逐词断言 `绝密-令牌` / `绝密-口令` / `绝密-环境变量` / `portproxy reset` **不出现**在格式化行里，且 `JSON.stringify` 无 `token`；另有 `T1.6 ② 防日志注入（任何内嵌换行压成空格 ⇒ 恰一行）`。
- [x] **T2b.3（C·附带）** UI 与用户手册明说「本机提权可能不会请你确认（取决于系统 UAC 策略）」，并指引用户如何自查 `ConsentPromptBehaviorAdmin`。
  - ⚪ **2026-10-12 复核：未跑** ✗ —— 本批真机证据全在**写通道与只读态**（`A`/`B`/`C` 段），**没有** UI 文案与用户手册的核对样本 ⇒ 本行保持 `[ ]`，不许写成通过。
    - 🔴 **2026-10-15 判定：仍是缺口（保持 `[ ]`）** —— ① **UI 侧零命中**：`packages/*/src` 里 `ConsentPromptBehaviorAdmin` / `不会请你确认` / `可能不会请你` 全部 0 命中，最接近的只有 `src/client/page.ts:253` 的档位标签 `ask（每次写操作都弹 UAC）`（那是**档位说明**，不是「本机可能不弹」的告知）；`elevation` 视图（`src/client/page.ts:248-258`）只有三档 + `note: '提权策略只改配置（remote.settings），不触发任何提权调用'`。② **用户手册整份不存在**：`packages/**/*.md` 只有两个 fixture `README.md`，仓库根也没有 README/用户手册 ⇒ 「并指引用户如何自查 `ConsentPromptBehaviorAdmin`」**无处落地**。⇒ 本判据要**新增** UI 文案 + 用户手册（属**实现**工作，待主人点头后另起一轮）。
    - ✅ **2026-10-15 结清（⇒ 本行据此勾掉；上面 2026-10-12 与 2026-10-15 那两行是**缺口现场记录**，保留不改写）** —— 两处缺口都补上，判据按本行字面（「**明说** + **指引自查**」）二值判定为**通过**：
      - ① **UI 侧**：`src/client/rows.ts` 新增 `ELEVATION_CONSENT_NOTICE`（302 字，**唯一字面量**）⇒ `elevation` 视图新增 `notice` 字段（`types.ts` / `page.ts:257`）⇒ `pane-settings.tsx` 的 `ElevationBlock` 在档位下拉与既有 `note` **之后**渲染 `<p class="wdp-secondary wdp-gate" data-testid="elevation-consent-notice">`。文案明说「**本机提权可能不会请你确认**」（触发条件直写 `ConsentPromptBehaviorAdmin = 0`）、给出可照抄的 `reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v ConsentPromptBehaviorAdmin`（0 / 2 / 5 三档含义 + `EnableLUA = 0` 陷阱）、并指向用户手册「提权与 UAC 自查」节。
      - ② **用户手册（本轮**新建** —— 此前整份不存在）**：`packages/wsl-docker-ports/README.md` —— 能做什么 / 刻意不做什么 · 安装与接入 · 5 个配置字段表 · 操作四步（声明 → 计划 → 确认 → 执行）· 审计（真机原文两行 + 字段释义 + 只读接口 `GET /dsh-wsl-docker-ports/write/audit`）· **§5 提权与 UAC 自查**（三条只读命令 + `ConsentPromptBehaviorAdmin` **0–5 全表** + `EnableLUA` / `PromptOnSecureDesktop` 含义 + **本机 2026-10-15 实测三行原文** + 「靠什么当闸门」五条 + 降险建议三条）· FAQ · 限制 · 相关文档。口径与本机实测一致：`ConsentPromptBehaviorAdmin=0x0` + `EnableLUA=0x1` ⇒ **UAC 没关，但提权静默**。
      - **判据的可执行形态**：`tests/client/elevation-consent-notice.test.tsx` **5 条** —— ① 告知在渲染结果里**逐字等于** SSoT 常量（先解 `&quot;` 等实体再比，避开「比到第一个引号就绿」的假绿）② 三要件齐（`可能不会请你确认` / `ConsentPromptBehaviorAdmin` / 整条 `reg query`）③ 取值含义与手册节名齐（0 / 2 / 5 / `EnableLUA = 0` / `提权与 UAC 自查`）④ **反控**：`notice` 传空串 ⇒ 段落仍在但警告语消失（证明内容来自视图字段，不是渲染层硬编码）⑤ 既有 `note` 未被顶掉。
      - **实跑证据**：`tsc -p tsconfig.json` exit 0 · `node --test` **430 / 430 / fail 0** exit 0 · `vitest run` **15 files / 133 tests** exit 0 · `check:exports` **25 项 / 失败 0** exit 0 · `check:size` exit 0 · `build` 三步 exit 0（主 bundle **44,621 B** = P2 上限、余 0 B；告知文本落在 chunk `lib/client.ports.js` **111,947 B**）· `check:client` **40 + 17 项 / 失败 0** · `check:host` **18 项 / 失败 0**。日志 `C:\Users\EDY\dsh-probe-artifacts\20261015-statenote\gates-t2b3-after-fix.log`。
      - 🔴 **过程中红过一次（有价值，留痕）**：首版把告知块的 `data-testid` 塞进了 `rows.ts` 的 `TESTID` ⇒ `T5.4 端口行证据`（`tests/unit/client-rows.test.ts:301` 逐字断言 `TESTID` 恰 **11** 个，口径 = requirements §2 的**控件**清单）判红（`node --test` 430/429）。**判据是对的，是我用错了表** ⇒ 改法 = 告知块按 `pane-settings.tsx` 既有 `WRITE_TOKEN_TESTID` 先例自带一份 `ELEVATION_NOTICE_TESTID`，`TESTID` 表与 T5.4 **一字未动**。
      - 🔴 **本行未做的部分（口径诚实，不许读成「全链已验」）**：**活页级 UI 验证未做** —— 判据只证到「真组件 + 真装配函数渲染出的 HTML 里逐字有它」（渲染级）；真机页面上的核对需要**探针 profile + 新浏览器实例**，按红线（不得把插件装进 `desktop` / `web`）**先问再做**。`[x]` 只按本行字面判据判定。
      - ✅ **2026-10-16 活页级真机验证（⇒ 上面那条 🔴「未做」据此结清；🔴 原文保留不改写）** —— 真机页面上**看到了**这条告知，判据从「渲染级」升到「活页级」：
        - **装置**（一次性，线内不碰任何既有 profile）：新建临时 profile `t2b3-probe`（4 个小文件 + **一条 junction** 指向插件包；profile 的 `nodeLinker: hoisted` ⇒ 与 pnpm 装出来等价）⇒ `dsh --profile t2b3-probe --port 43331 --no-open` ⇒ headless Chrome（`--remote-debugging-port=9422` + **独立 user-data-dir**）经 **CDP 直连**驱动。`desktop` / `web` / `volatile-probe` **全程未改**。
        - **先证插件在真机上活着（宿主侧）**：`GET /dsh-wsl-docker-ports/snapshot` ⇒ **HTTP 200 / 6,592 B** 真快照（`docker.ok=true`、6 个容器、`eth0 172.20.201.152`、`Ubuntu2204 Running`、NAT 缺省）；页面注入样式表里含 **`dsh-wsl-docker-ports/styles`** ⇒ 客户端 `apply()` 真跑过。
        - **判据读数**：开右栏 → 点入口 `端口转发 查看容器的端口映射与 portproxy 规则，逐端口应用／移除转发（只读事实层，开页零副作用）` ⇒ `[data-testid="elevation-consent-notice"]` **存在且可见**（`getClientRects().length > 0`，rect **670×104 @ y=419**），`innerText` **302 字**逐字命中 **5/5** 要件（`本机提权可能不会请你确认` / `ConsentPromptBehaviorAdmin` / **整条** `reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v ConsentPromptBehaviorAdmin` / `提权与 UAC 自查` / `EnableLUA = 0`）；同区块上方紧邻 `sel-elevation`（value=`none`、options `none/ask/passby`）⇒ **与 `note` 的先后位置**也真机确认；**控制台错误 0 条**；整页 `data-testid` **41** 个（11 个控件 + 本告知块 + 凭据块 ⇒ 与 T5.4 的「11 个控件」口径互证）。
        - **实拍与原件**：`t2b3-notice-viewport.png`（提权策略区块实拍：下拉 `none` + `note` + ⚠️ 告知带警告左边框）、`t2b3-notice-fullpage.png`（整页）、`t2b3-live-notice.png`（页面全貌 + 容器表）；DOM 原件 `t2b3-live-result.json`。目录 `C:\Users\EDY\dsh-probe-artifacts\20261016-t2b3-live\`。
        - **方法学留痕（第一轮的假红是我造成的）**：首轮报「页面外壳没渲染」= **我的选择器写错** —— 右栏开关用的是 **`aria-label="打开右侧边栏"`**（不是 `title`），且只等了 20 s（真机首屏要等 bundle 拉完）。12 s 时序采样（`t2b3-watch.json`：`elems/btns/bodyLen` 全程不变）证明页面**没有**抖动或重挂载 ⇒ 结论是「**测量方法错**」，不是「产品坏」；这条与 T2b.3 的成品无关，但记下来免得下次再踩。
        - **收尾与还原（逐条对比开工前基线）**：杀掉只属于本轮的 Chrome 与实例（两个后台作业因此以 exit 1「被终止」收场，**不是命令失败**）⇒ **先 `cmd /c rmdir` 删 junction**（绝不 `Remove-Item -Recurse` 穿透）再删 profile 目录 ⇒ `profiles` 回到原 4 项、`t2b3-probe` 不存在、**无残留 reparse point**；**插件包本体完好**（`lib/client.js` 44,621 B、`lib/client.ports.js` 111,947 B、11 文件 236,775 B）；`volatile-probe` 全部文件 hash 与基线一致（`package.json=33ED2615`）；监听只剩主人的 **19387 / 9222**；`netsh` 仍 **19 条**；仓库工作树**干净**。

## 真机验收清单（chrome-devtools MCP；⚠️ **UAC 可能不弹窗** —— 见 Phase 2b 的真机事实）

> 本清单是**写路径**的验收；只读展示与外部规则清单在 [003 的清单](../003-wsl-docker-ports/tasks.md)。UAC 弹窗**无法自动化**，以下每行都必须人工点击 —— 如实登记。

| # | 场景 | 期望 | 手段 |
|---|------|------|------|
| 1 | 加一条转发（loopback）| 提权 → 规则出现；`netsh` 总条数 +1，他人条目不变 | 人工 UAC + 前后快照 |
| 2 | 加一条转发（lan）| 规则 + **仅该端口**防火墙规则；`Get-NetFirewallRule` 核对 | 人工 UAC + 快照 |
| 3 | 移除自己那条 | 规则消失，他人条目不变 | 人工 UAC + 快照 |
| 4 | 漂移修复 | `connectAddress` 更新为当前 eth0；状态转 ok | 人工 UAC + 快照 |
| 5 | 拒绝 UAC | 显示「已取消」，规则零变化，临时文件已清理 | 人工点「否」+ `%TEMP%` 检查 |
| 6 | 提权策略 `none` | 写控件置灰 + 原因；点击无弹窗（**调用数 0**）| 截图 + 日志 |
| 7 | Agent 触发 + `passby` | **不静默执行**：降级为 `ask`（先应用内确认，展示命令原文）| 日志 + 截图 |
| 8 | 半成品防护 | 人为让防火墙步骤失败 → portproxy 被回滚、报告「未改」、无残留 | 人工 UAC + 快照 |
| 9 | 卸载后再看规则 | 规则**零变化**；清理清单可复制；临时文件归零 | 快照 + `%TEMP%` |

### ✅ 2026-10-09 真机核验（提权写路径 · 完整报告在 %TEMP%\uac-verify-20261009-125427\REPORT.md）

**结论句（代理原文）**：本机提权链实测走的是 **native（不是 gsudo）**；`999` / `cancelled` 两条失败分支**本机不可复现**；**gsudo stdio 回传通道经注入验证为「成立」**；**全程无需任何人类交互**。

- **适用范围**：写入传输未接线（`plugin.ts` 只注册只读快照路由；实测 `GET /…/snapshot` 200、`/…/` 404、`POST|PUT|DELETE /…/snapshot` 405、`/write`·`/apply`·`/plan`·`/elevation` 全 404）⇒ 本轮**不经插件/UI/HTTP**，直接 import 已构建 `lib/` 驱动。
- **逐门**：`elevationPolicy=none` ⇒ `status=disabled`、六个 spy 全 0、文案可读（**零弹窗**）；未声明端口 5173 ⇒ `add/remove/fix` 均 `port-not-managed`、零步 ⇒ `no-actions`；区间 `60000-60002` 不展开但逐端口受管、各规划**恰好 1 步**、`60003` blocked；`scope=lan` **只读**计划 2 步（逐端口 `0.0.0.0` + `New-NetFirewallRule … -LocalPort 59999 -Profile Any -Group "dsh-wsl-docker-ports"`，**无通配/无全量放行**，`-Profile Any` 含 Public 记事实）**一个字节未写**。
- **REQ-2.2 真机正向事实**：真实输入（`localhostForwarding=true`）⇒ `ok=true steps=0 notes=['无需 portproxy 规则（WSL 自带的 localhost 转发已开启，NAT 缺省）']` ⇒ **恒 0 步、恒不提权**（不是「未验」）。
- **真写（native 生产链 + 伪造 `localhostForwarding:false`）**：`status:ok exitCode:0 backend:"native" steps:[{portproxy-add,ok:true}] cleanup:{scriptRemoved:true,outRemoved:true}`、3261 ms；`netsh` 新增**仅** `127.0.0.1 59999 → 172.20.201.152 59999`。
- **gsudo 通道（注入 `probeBackend`，gsudo 本体/真 UAC/真 netsh 均为真）**：写 2058 ms、删 1828 ms，均 `status:ok exitCode:0 backend:"gsudo"`；stdout 原文含 `{"action":"remove",…,"steps":[{"ok":true,"stderr":"","name":"portproxy-delete"}],"port":59999}`、`stderr=""` ⇒ **stdio 回传成立**。
- **红线（逐字节）**：`before` = 1109 B sha256 `B9D38664…D1056D` → 写入后 1160 B → **两轮（native + gsudo）真写真删后全部回到 `B9D38664…D1056D`**；`[IO.File]::ReadAllBytes` 全字节比对 True；**19 条内容+集合+顺序逐字节不变**。防火墙：`*dsh-wsl*` 规则 0 条、引用 59999 的 0 条 ⇒ 本路径**不写防火墙**；回滚用**插件自身能力** `action:remove` 完成。
- **不可复现项（含条件）**：用户点「否」取消（native ⇒ `cancelled`）❌ 条件 = `ConsentPromptBehaviorAdmin != 0`；gsudo **999** ⇒ `elevation-failed` ❌ 条件 = 同上**且**先修 `backend.ts:68`；`looksLikeUacRejection` 本地化取消文案匹配 ❌ 同上；eth0 漂移 / `docker ps` 解析 ⚪ 未验（发行版 Stopped，快照如实 `distro-not-running`、**未自动启动**，符合设计）；`scope=lan` 真写 ⚪ **刻意未验**（已明令禁止）。
- **同类判据审计**：🔴 有风险 = gsudo status 解析（§上面）；⚠️ 有风险但本机不可验 = `looksLikeUacRejection` 的本地化取消文案（不匹配会落到 `out-file-missing` 而非 `cancelled`）；✅ 无风险 = `where.exe` basename 判据（**确实按路径/产品名，不按命令名 `sudo`**）、`netsh` 表格解析、`wsl -l -v`；✅ 非缺陷 = `script.ts` 的 `beforeRules/afterRules` 恒 `[]`（契约保留字段，权威快照在主机侧）。
- **收尾**：`--dump-config` BEFORE vs AFTER **47075/47075 字节逐字节相同、差异 0 行**；5 个 profile 文件还原、残留软链已删、`install --frozen-lockfile` exit 0；代理起的实例 PID 43176/44004 已停、43199 无监听；**主人 DSH 进程 17168/28228/31736/39088/39556 存活且 StartTime 未变**、`desktop` profile mtime 早于会话开始 ⇒ 未被触碰；`netsh` 终态 19 条 sha256 与开工前一致。
- **三条待办**：① `elevationAvailable` 恒 false（`plugin.ts:251`）⇒ UI 置灰而机器其实能提权；② `backend.ts:68` 正则 ⇒ gsudo 分支在本机永远走不到、提权链静默退化为 native（建议改用 `gsudo status --json`，实测 `"CacheAvailable":false`）；③ **REQ-4.1 立论需重审**（本机 UAC 不构成人类闸门）。

### ✅ 2026-10-09 真机复验（我亲自跑 · 只读 · 零写入）

**复验配方（无需重启 DSH、无需提权）**：写一个 `.cjs` 探针，`require` 已构建的 `lib/elevate/backend.js` + **`packages/wsl-shared/src/index.ts`**（Node v24 默认剥类型；⚠️ `dsh-wsl-shared` **没有 build**，`require('dsh-wsl-shared')` 解析到的就是 `.ts` ⇒ 直接 require 会失败，必须给源码路径），然后：
`detectBackend({ executor: createExecutor() })` 与 `probeElevationAvailability({ executor })`。

**修前 → 修后（同一台机、同一调用）**

| 调用 | 修前（真机实测） | 修后（本轮实测） |
| --- | --- | --- |
| `detectBackend` | `{"backend":"native","gsudoPath":"…gsudo.exe","cacheActive":false,"note":"gsudo status 输出里没有可识别的 Available 行；保守回落 native（同上）"}` | ✅ `{"backend":"gsudo","gsudoPath":"D:\\Program Files\\gsudo\\Current\\gsudo.exe","cacheActive":false,"note":"gsudo 已装且凭据缓存未激活（Mode=Explicit；判据=gsudo status --json）…"}` |
| `probeElevationAvailability` | 硬编码 `false`（`plugin.ts:251` 无调用方） | ✅ `{"available":true,"backend":"gsudo","reason":"提权后端探测成功：backend=gsudo；…（判据=gsudo status --json）…"}` |

⇒ **两处未接线在真机上确认修好**：提权链不再静默退化 native（走 gsudo 的 stdio 回传 + exit code），`elevationAvailable` 不再把能提权的机器报成不可用；**结构化出口 `--json` 那一路在真机确实可用**。
核对：探针全程零写入（`netsh` 始终 **19 条**）、临时目录已删、无提权、无弹窗。
**仍然不可复现**：`999` / `cancelled`（本机 `ConsentPromptBehaviorAdmin=0` ⇒ 无「用户取消」事件）—— 本次改动未触及这两条分支。

---

## ✅ 收口记录（2026-10-16 · 状态 → `complete`）

**准入**（本仓规则：未勾项 = 0 ⇒ 可做关闭评估）：本 Spec 勾 **22 / 未勾 0**。**状态流转用 CLI，不手改 frontmatter** ——

    lean-spec update 005-elevation-write-path --status complete
    ✓ Updated: 005-elevation-write-path  Fields: status → complete
    ✓ Successfully updated 1 spec(s), 0 errors          （exit 0）

复核（`lean-spec view`）：`Status: complete`；frontmatter 新增 `completed_at: 2026-10-16T08:33:37.372308800Z` 与 `transitions` 第三条 `{status: complete, at: 同上}`（前两条 `planned` / `in-progress` 原样保留）。`board`：**planned 1 / in-progress 0 / complete 10**。

### 整包质量门（收口轮实测 · HEAD = `497ee26` · cwd = `packages/wsl-docker-ports`，**直跑二进制**不用 `pnpm run`）

| 门 | 读数 | exit |
|---|---|---|
| `node_modules/.bin/tsc.CMD -p tsconfig.json` | 无输出 | **0** |
| `node --test --test-concurrency=1 "tests/**/*.test.ts"` | **tests 430 / pass 430 / fail 0** | **0** |
| `node node_modules/vitest/vitest.mjs run` | **Test Files 15 / Tests 133** | **0** |
| `node scripts/check-exports.mjs` | **25 项断言 / 失败 0** | **0** |
| `node packages/wsl-shared/scripts/check-size.mjs` | 最大 **396 行**（`tests/client/write-result.test.tsx`）< 400 | **0** |
| `build` 三步（`tsc -p tsconfig.build.json` → `scripts/build-client.mjs` → `tsc -p tsconfig.client.json`） | `lib/client.js` **44,621 B** / `lib/client.ports.js` **111,947 B** | **0** |
| `node scripts/verify-client-loader.mjs` | **40 项断言 / 失败 0**（含 §P2 造价判据：主 44,621 / 上限 44,621，**余 0 B**，性质 = debt） | **0** |
| `node scripts/assert-client-split.mjs` | **17 项断言 / 失败 0** | **0** |
| `node scripts/verify-host-entry.mjs` | **18 项断言 / 失败 0** | **0** |

日志原件：`C:\Users\EDY\dsh-probe-artifacts\20261016-t2b3-live\gates-005-closure.log`。

### 真机验收清单 9 行逐行标态（**不并账**：可执行断言 ≠ 真机样本）

| # | 场景 | 标态 |
|---|---|---|
| 1 | 加一条转发（loopback）| ⚪ **本机不可执行**（不是「未做」）：`localhostForwarding=true` ⇒ loopback 下 plan `steps:[]`、apply `no-actions`（`A2`/`A3`，`notes` 逐字「无需 portproxy 规则…」）|
| 2 | 加一条转发（lan）| ✅ 真机 `A7`：规则 `0.0.0.0 45999 172.20.201.152 45999` + 防火墙 `dsh-wsl-docker-ports-45999` **均出现** |
| 3 | 移除自己那条 | ✅ 真机 `A9`：`executed=[portproxy-delete, firewall-delete]`、45999 残留 **0**、他人 19 条 sha 不变 |
| 4 | **漂移修复（`fix`）** | ✗ **真机未跑** —— 见遗留 ①，**这是本次收口唯一的真机动作缺口**。**（2026-10-16 已补：见 `T3.2` 的新增条目 —— 规划层拦下 + 提权链真修好，两条结论）** |
| 5 | 拒绝 UAC | ⚪ 本机不可复现（`ConsentPromptBehaviorAdmin=0` ⇒ 无「取消」事件）；覆盖 = `T2.3` 的可执行断言 + 2026-10-12 真机旁证（「无文案 / 非 0 退出 / 零回传 ⇒ `cancelled`」，且「**有回传绝不判取消**」已修）|
| 6 | 提权策略 `none` | ✅ 真机 2026-10-09：`status=disabled`、六个 spy 全 **0**、零弹窗；+ `T2.4` 断言（`none` ⇒ 执行器调用数 0、零快照零写文件）|
| 7 | Agent 触发 + `passby` | ✅ 可执行断言（`T2.5`：`agent`+`passby` ⇒ 确认调用数 **1** 且**确认事件在提权之前**；被拒 ⇒ 执行器 **0** 次）；真机侧**未造** Agent 场景 ⚪ |
| 8 | 半成品防护（回滚）| ✅ 可执行断言（`rolledBack` / `T2.5 ⑥`）；真机侧取到 `B-driver.json` 的 native `partial`（1 步失败 + 两临时文件已删）⚪，而「**人为让防火墙步骤失败 ⇒ portproxy 被回滚**」的真机形态**未跑** |
| 9 | 卸载后再看规则 | ✅ 可执行断言（`T3.3`：`dispose()` 写调用 **0** 次 + 清单可复制 + 临时文件二次扫描归零）；真机「装过再卸」⚪ 未跑（本插件**从未**在主人的 profile 上安装过）|

### 遗留与转移（**随收口带走 —— 逐条有主、有原文、有下一步**）

1. ✅ **`T3.2` 第三动作 `fix` 真机取证 —— 2026-10-16 已做，本条结清**（上面的原文与「先问再做」的处置**都保留不改写**；主人 2026-10-16 授权「做真机」后执行）。取证结论 = **两条互不掩盖**：**①** 规划层对漂移规则的 `fix`/`remove` **必然拦下**（`rule-not-owned`、0 步）⇒ 用户点「修复」拿不到动作；**②** 提权脚本 + 执行链**真能修**（`portproxy-delete` + `portproxy-add` 两步 ok、地址真变回 `172.20.201.152`、`exit 0`、任务日志四项齐全）。终态 **19 条 + sha 与本次基线逐字节相同**、防火墙与 TEMP 前后同读数。明细与「口径裁定项」见 `T3.2` 的 2026-10-16 新增条目；驱动 `F-driver.mjs`、证据 `20261016-005-fix\{F-run.log,F-driver.json}`（**driver exit 0**）。**注意：本条结清的是「真机取到结论」，不是「`fix` 已可被用户使用」** —— 后者卡在下面第 9 条的口径裁定。（本条**不**回退 Spec 状态：结论已取证且是**拦下**，不是「没跑」。）
2. 🔴 **「批量清理 plan」未接线**（2026-10-09 集成缺口 ①，原文把落地时机写成「Phase 5 清理按钮接线 / 收口」）—— **本次收口没有把它做成**。实物证据：`src/write/types.ts:22` 仍是 `export type WriteAction = 'add' | 'remove' | 'fix' | 'switch-scope';`，**没有 `cleanup` 取值**；`plan.ts` 只有 `case 'fix'`，无清理 plan 生成。⇒ 单元层的清单 / 步骤 / 显式入口（`T3.3`）**已交付且有断言**，缺的只是**写通道图层**。**不阻塞本次状态流转**（`REQ-5.1–5.4` 的字面判据都不要求「清理必须经提权通道执行」），但它是**真实的未交付面**，登记待办。
3. ⚠️ **eth0 漂移 × 本插件自己写过的规则**：三选项（保持现状 / 按「历史 eth0」放宽 / 清单里单列「疑似本插件旧规则，仅展示不删」）**仍需主人裁决**；当前**保持现状**（保守 = 少删）。
4. ⚠️ **A-3 的 `winsudo` 分支本机不可验**（Windows 自带 `sudo` 需 24H2+，本机 23H2；`%SystemRoot%\System32\sudo.exe` 实测**不存在**）。
5. ⚠️ **001 的 `fail()` 应收 `stdout`**（`T2.3` 订正时发现；改它不在 005 的文件范围内）⇒ 跨 Spec 登记。
6. ⚠️ **§P2 主 bundle 余量 0 B**（44,621 / 上限 44,621，`nature: debt`，trace `#56`）：**任何往主包模块加字都会判红**；本轮 `T2b.3` 的文案落在 chunk（`client.ports.js`）故未触及 —— 属 003 / 011 的额度欠账，登记。
7. ⚠️ **写确认弹窗未同步这条 UAC 告知**（`write-confirm.tsx`）：`T2b.3` 的范围只含「提权策略区块 + 用户手册」⇒ **刻意不动**（该文件的档位门已有 `policy=unknown ⇒ 置灰 + fail-safe` 断言），登记。
8. ⚪ **本机不可复现项（条件已写死，不许当已验）**：用户点「否」取消（需 `ConsentPromptBehaviorAdmin != 0`）· gsudo 子进程 `999` 形态（需 gsudo 自身失败）· gsudo 后端下的 `partial` 判别（`pwsh -Command` 把 `2/3/7/42/999` 一律塌成 `1`）。
9. ✅ **[2026-10-16 已裁定 (a) 并实施收口 —— 下面这条「二选一待主人拍板」的原文与 🔴 标记保留不改写；收口读数见 `T3.2` 的 2026-10-16 裁定条目]** **`fix` 的口径裁定（2026-10-16 真机取证时新立；`plan.ts` 文件头「已知张力」的正式登记）**：`planFix` 的成功分支在当前 REQ-1.2 字面口径下**永不执行** ⇒ 用户遇到**真实漂移**（老规则 `connectAddress = 旧 eth0`）时，我们的「修复」帮不上忙，**连「移除」也会被同一道门拦下**（同一门 = `rule-not-owned`，真机实测两种输入一致）。二选一待主人拍板：**(a)** 裁定 REQ-1.3（声明集合内 + `connectAddress` 是「非当前 eth0 的合法 IPv4」⇒ 视为本插件历史写入 ⇒ 允许 `fix`/删）；**(b)** 保持拦截，把「修复」改成**只报告 + 给手工清理命令**（`netsh interface portproxy delete v4tov4 listenport=<p> listenaddress=<a>`）。**这是本 Spec 现在最值得优先处理的一条**（其余遗留都是欠账面，这条是**功能面**）。
10. ✅ **[2026-10-16 口径已订正：本条建议被采纳 —— 判据自此为「集合 + 逐条内容」/ 顺序无关（产品已有 `compareOthers`）；下面的原文保留不改写，历史 sha 读数也**不改写**（它们是当时当境的真实读数）]** **「他人条目不变」的判据曾是顺序敏感 byte-sha ⇒ 期望值已过期，建议改口径（2026-10-16 查清，附根因）**：收口记录与 `E4` 用的期望 sha `b9d38664…` 与机器现状 `a3210c43…` **不一致**，但**19 条内容逐条相同、端口集合完全相同**，唯一差异是 **6379 从第 10 位挪到末位**（`netsh` 枚举顺序 = 注册表插入顺序）。**根因是我们自己人**：`20261015-statenote` 的两条真写审计 —— `at=2026-10-15T04:22:59Z origin=user result=applied action=switch-scope scope=loopback ports=6379 steps=portproxy-delete@6379 policy=passby backend=gsudo exit=0` 与 `at=2026-10-15T04:23:43Z … scope=lan ports=6379 steps=portproxy-add@6379+firewall-add@6379 backend=native exit=0` ⇒ **6379 被删后重加** ⇒ 键位后移。⇒ 该判据应改为**顺序无关**（产品里已有 `compareOthers`）或「集合 + 逐条内容」比对，**不要**再用整段文本的 sha 当「他人条目不变」的唯一证据。⚠️ **2026-10-16 我的运行自身前后 sha 完全一致**（`a3210c43…` → `a3210c43…`，且 45999 全程唯一新增/删除）⇒ **与本次取证无关**。
11. ⚠️ **10-15 那次 `switch-scope` 的副作用复核（已查，无残留；不改动任何非我方对象）**：审计显示它 `firewall-add@6379` 过一条 ⇒ 今日实测 `Get-NetFirewallRule -Group 'dsh-wsl-docker-ports'` = **0 条**、`DisplayName -like '*dsh-wsl*'` = **0 条** ⇒ **我方防火墙零残留**；6379 的 portproxy 内容 = `0.0.0.0 6379 → 172.20.201.152 6379`，与 10-08 fixture **逐字相同** ⇒ 作用域也被还原。另有**非我方**规则 `WSL2 Port 6379`（GUID 名、`Group` 空、`Enabled=True`）—— 命名与分组都不属本插件 ⇒ **未触碰，仅登记**（若主人要清理由主人决定）。
12. 🔴 **`fix@lan` 会叠出重复的防火墙放行（2026-10-16 裁定 (a) 真机复跑时实测新立，附读数）**：脚本的 `fix` 分支在 `$Scope -eq 'lan'` 时**无条件** `New-NetFirewallRule`（`src/elevate/script.ts:295` → `254-263`），而 `apply.ts:248` 的存在性闸门只按**步骤表**判（`firewallAddNames(only.steps)`）—— `fix` 计划的步骤表只有「先删后加转发」，**没有** firewall-add ⇒ 闸门 `wantedNames.length === 0` **不启用** ⇒ 同名规则已存在时照样再建一条（Windows 允许 DisplayName 重名）。**真机读数**：`ourName`（`dsh-wsl-docker-ports-45999`）在 `add` 后 = **1**，`fix` 后 = **2**（`20261016-fix-b\G-driver.json` 的 `addDrift.after.ourName` / `fixReal.after.ourName`）。**收口现状**：`remove` / `switch-scope` 的 `Remove-Firewall` 用 `Remove-NetFirewallRule -DisplayName`（删**所有**同名）⇒ 终态能回到 0（本轮实测 = 0）；`apply.ts:285-287` 的 hint 自己已承认「脚本按动作+作用域决定放行，不看步骤表」。⇒ **影响**：反复对同一端口做 lan 修复会累积同名放行条目（语义上不放大暴露面 —— 同一端口同一动作，但会让「按名清理」与审计计数失真）。**本轮未修**（改脚本分支 = 动 005 的执行层语义，超出裁定 (a) 范围）。
13. 🔴 **`remove` 的 `plan.scope` 与脚本分派分叉（2026-10-16 同一轮零写入旁证新立）**：`planRemove` 的**步骤表**用 `scopeFromRules(input.rules)` 推出 `[portproxy-delete, firewall-delete]`，但 `planOf` 把 `plan.scope` 留成**入参** `scope`（用户配置里 `scopes` 缺省 ⇒ `loopback`）；而提权脚本按 `plan.scope` 分派（`script.ts:288-291`：只有 `$Scope -eq 'lan'` 才 `Remove-Firewall`，且 `Remove-Portproxy` 删的是 `127.0.0.1`）⇒ 对一条 **lan** 规则按缺省配置发 `remove`，脚本会去删 `127.0.0.1`（**失败**、且防火墙放行留着），而步骤表却宣称要删防火墙。**旁证**：G 的 `[E1]`（零写入纯规划）实测 `步骤=portproxy-delete+firewall-delete / plan.scope=loopback`（`20261016-fix-b\G-driver.json` 的 `removePlanDefaultScope`）；本轮真删改走**显式 `scope:'lan'`**（`[E2]` 成功、终态 `ourName=0`）。**与 ⑨ 同源**（`fix` 那条已按裁定 (a) 用「沿用既有规则作用域」修好；`remove` 这条按字面口径**不动**，因为放宽删除属禁止面）⇒ 触发条件 = 用户对 lan 规则发 `remove` 且其 `scopes` 配置缺省/写错；**本轮未修**。
14. 🔴 **`fix` 没有用户可达路径 ⇒ 裁定 (a) 的产品价值尚未对用户可见（2026-10-16 复跑时确认）**：① 行内「修复」按钮走 `runtime.elevation`（`src/client/pane.tsx:278`：`elevation === undefined` ⇒ 只提示「写路径不可用：本行只做只读展示」，**不执行**），而 `ElevationInvoker` 的**实现**在本包不存在（`src/plugin.ts:236-243` 明确登记为 gap：「仍未接线的是客户端确认对话框 ⇒ 页面上点不到写入口」）；② 009 的写面板（HTTP `/write/plan` + `/write/apply`，2026-10-12 真机验过 add/remove）其**目标动作按 `REQ-7.2` 只有 `add`/`remove`**（009 `requirements.md:56` 逐字「本页不做服务端的 `fix` / `switch-scope`」）。⇒ 本轮**无法**执行「活页点一次修复」：**不是没跑，是没有这条路径**；取证因此停在「规划层 + 执行链」（真机真写、真复原）。**要落地二选一**：**(甲)** 实现行内按钮的执行器（把 `ElevationInvoker` 接到 008 的票据/apply 通道）；**(乙)** 扩 009 `REQ-7.2`，把 `fix` 纳入写面板目标（改动小、复用已验的 HTTP 面）。⚠️ 传输层本身**不构成阻碍**（读代码即可定）：`transport/real-facts.ts:22` 明确**不给** `portState` ⇒ `plan.ts:311-323` 不带该字段 ⇒ `fix` 的「五态必须是 drift」前置在传输层不启用；`apply.ts` 的存在性闸门对 fix 计划同样不启用（见 ⑫）。

### 本 Spec「完成」的含义（口径写死，避免后人误读）

`complete` = **本 Spec 22 条任务的判据在现有证据下全部成立**（真机样本与可执行断言**分别标注**，见上表），**不等于**「写路径的所有集成面 100% 交付」—— 上面 8 条遗留就是那部分差额，它们**逐条有主、有原文、有下一步动作**。

> **2026-10-16 追加（不改上文）**：① 已由真机取证**结清**（结论 = 规划层拦下 + 提权链真修好，两条）；同时新立 **⑨ `fix` 口径裁定**（功能面，最优先）、**⑩ 判据顺序敏感**（含根因审计原文）、**⑪ 10-15 副作用复核**（我方零残留）。⇒ **遗留项数从 8 变为 11**（上文「上面 8 条」是收口当时的计数，保留原样）。

> **2026-10-16 第二次追加（不改上文）**：主人令「先走推荐」⇒ 采纳裁定 **(a)** 并**已实施收口**：**⑨ `fix` 口径裁定 → ✅ 结清**（只放宽 `fix`，`remove` 保持字面；真机复跑 `G-driver` **exit 0**，读数见 `T3.2` 的 2026-10-16 条目）、**⑩ 顺序敏感判据 → ✅ 口径已订正**（自此为「集合 + 逐条内容」/ 顺序无关，产品已有 `compareOthers`；历史 sha 读数不改写，差异根因已查清 = 我们自己 10-15 对 6379 的 delete+add）。同一轮真机复跑**新立 3 条**：**⑫ `fix@lan` 叠防火墙放行**（真机 `ourName` 1 → 2 实测）· **⑬ `remove` 的 `plan.scope` 与脚本分派分叉**（零写入旁证 `[E1]`）· **⑭ `fix` 无用户可达路径**（`ElevationInvoker` gap + 009 `REQ-7.2` 只含 add/remove ⇒ 「活页点一次修复」本轮**做不到**，不是没跑）。⇒ **遗留项数 11 → 14**（其中 ⑨ 结清、⑩ 订正；⑫⑬⑭ 为新立）。
