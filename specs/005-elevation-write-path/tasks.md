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

- [ ] T3.2 [REQ-1.5][NFR-1][C-3] 真机自证：他人规则条数不变
  - 内容：真机上对一条 `managedPorts` 内端口做 add / remove / fix 各一次，前后各存 `netsh show v4tov4` 快照
  - 验证：**19 条既有规则（他人条目）条数与内容不变**；任务日志四项齐全；结论写入 tasks 与 README
  - ⚠️ 每次写操作**必须人工点 UAC**

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

- [ ] T3.5 文档回写
  - 内容：T0.1（提权链路真机结论）、T3.2（规则不变证据）→ 回写 requirements/design；**A-1（降级为 `ask`）与 A-2（卸载不自动清理）均已于 2026-10-08 定案** ⇒ 本任务只剩真机结论回写
  - 验证：`grep -n "A-1\|A-2\|reset" specs/005-elevation-write-path/*.md` 可见结论（**A-1 已于 2026-10-08 定案 = 降级为 `ask`**；A-2 已确认）
  - 🟡 **2026-10-09 集成方预核：本行**故意不勾**（判据已过、内容未齐）** —— 验证判据（`grep`）实测**已通过**：`A-1|A-2|reset` 在四份文档里分别命中 design **6**（L27/30/78/120/122）/ README **7**（L23/43/70/71/105）/ requirements **5**（L30/58/66/89/90）/ tasks **7**（L71/80-83）；但**内容**要求的「T0.1（提权链路真机结论）+ T3.2（他人规则条数不变证据）」两项**都还没跑**（每次要人工点 UAC）⇒ 本任务只剩的那部分**仍被真机阻塞**，等主人到场后与本 Spec 的 T0.1 / T3.2 一起收口。

- [ ] T3.7 [REQ-3.4] 提权后端链（`gsudo → native`，A-3）
  - 内容：探测**用户自装**的 `gsudo`（用 `where.exe gsudo`，**不认 `sudo` 别名** —— gsudo 安装器会造同名别名）；有则走其 **stdio 回传**，并把 **exit code 999** 判为「提权失败」；`gsudo status` 显示**缓存活跃** ⇒ 回落 `Start-Process -Verb RunAs` + 临时文件；**不安装 / 不改 PATH / 不动 gsudo 配置**（尤其 `CacheMode`）。Windows 自带 `sudo` 仅 `elevationBackend: winsudo` 时启用（本机 23H2 无法验证 ⇒ 登记为未验证项）
  - 🔴 **「不认 `sudo` 别名」已由本机实测坐实（2026-10-09，只读）**：`Get-Command sudo -All` 在本机**只有一条**，指向 `D:\Program Files\gsudo\Current\sudo.exe`（`CompanyName = Gerardo Grignoli`、`ProductName = gsudo`、`FileVersion = 2.6.1.0`），而 **`%SystemRoot%\System32\sudo.exe` 不存在**（`Test-Path` = False，23H2 符合预期）⇒ **凡按命令名 `sudo` 探测者，在本机必然误判「Windows 自带 sudo 可用」并走进 winsudo 分支**（实际执行的还是 gsudo，语义完全不同）。本规则不是预防性洁癖，而是本机**真实陷阱**；探测必须走 `where.exe gsudo` / 按**路径 + 产品名**判定
  - 验证：真机各跑一次 —— ① `gsudo` 路径下 stdout / stderr / exit code 三样都拿得到（含故意失败 → **999**）② 造一个活跃缓存 → 回落 native 且**无临时文件残留** ③ `elevationBackend: native`（或未装 gsudo）仍成功
  - 🔵 **离线面已实现（2026-10-09，零真机）**：`src/elevate/backend.ts`（按**路径**认 `gsudo`、读 `gsudo status`、`winsudo` 仅显式配置且固定路径存在才用、其余一律回落 native）+ `src/elevate/invoke.ts` 的三条调用形态 + `runner.ts` 的 `999 ⇒ elevation-failed`。用例 `tests/unit/elevate-backend.test.ts`（10 条，含**反向断言**：任何一次探测都不许以 `sudo` 为命令名）+ `tests/unit/elevate-exec.test.ts` 的 gsudo 两组。**本项仍未完成**：真机弹窗 / 真缓存 / 真实 999 未验（每次都要人工点 UAC）

- [x] T3.6 [REQ-4.3] 红线断言：未注册 Agent 工具（来源约束的门禁）
  - 内容：本期**不注册任何 Agent 可调工具**；将来若注册，**必须先**补齐 REQ-4 的完整口径（错误语义、审批、日志）再放行，不得以「先能用」为由先行放行
  - 验证：`grep -rn "defineTool" src/` 命中 0，或命中处均附 REQ-4 口径补全的引用与用例；`vitest` 断言工具表内不存在本包来源的工具
  - ✅ **2026-10-09 完成（静态面，集成方）**：`redline-guards.test.ts` 的 T3.6 守卫对**整个 `src/`** 断言 `defineTool` / `tools.register` / `ctx.tools` **三处零命中**（可执行断言，替代人工 grep）。本包的确认通道是**注入的** `ElevationDeps.confirm`（由调用方接 UI），与宿主工具/审批面零耦合。
  - 🔵 **残余项转移（不是丢弃）**：验证里的第二条「断言工具表内不存在本包来源的工具」需要**工具表存在**才有断言对象 —— 本包至今没有任何注册代码，工具表要到收口阶段（002 T7.1 导出服务 / 004 注册 6 工具）才出现。该断言**并入 004 的 T3.2**（那里本就要求「卸载后工具数归零」），在本 Spec 记为已转移。

---

## Phase 2b：产品内闸门（A）与审计留痕（B）　← 2026-10-09 主人拍板新增

> 背景：真机实测本机 `ConsentPromptBehaviorAdmin = 0` ⇒ **UAC 不弹窗**，「UAC = 人类闸门」不成立，Agent 可零交互提权改写系统状态。闸门因此收回产品内，且**与 OS 行为解耦**。**阻塞**：写入传输尚未接 HTTP/UI（005 当前的 gap），本 Phase 的验收要等它接线后才能做端到端。

- [ ] **T2b.1（A·强制）** 提权写入前的应用内确认 + **变更预览**：逐条列出将新增/删除的规则（作用域 · 监听地址 · 端口 · 连接地址 · 是否伴随防火墙规则）、命令条数与影响面。判据：① 未确认 ⇒ 零提权、零写入（spy 全 0）；② 拒绝 ⇒ 失败可读且零残留；③ 确认文案含每条规则的端口与作用域（不是「即将执行」这种空话）；④ **在 UAC 不弹窗的机器上同样生效**（与 OS 行为解耦，用假后端断言）。
- [ ] **T2b.2（B·强制）** 审计留痕：每次提权写操作（含拒绝/超时/失败/回滚）落一条人类可读记录（时间 · 来源 agent/user · `elevationPolicy` · 实际后端 · 端口与作用域 · 结果与退出码 · 耗时 · 是否回滚），**不含任何凭据/口令**。判据：① 成功与失败各留一条；② 记录里能读出实际后端（`gsudo` / `native`）；③ 敏感词扫描零命中。
- [ ] **T2b.3（C·附带）** UI 与用户手册明说「本机提权可能不会请你确认（取决于系统 UAC 策略）」，并指引用户如何自查 `ConsentPromptBehaviorAdmin`。

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
