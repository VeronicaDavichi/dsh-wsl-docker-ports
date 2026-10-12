# 实现任务：dsh-wsl-docker-ports

> 任务引用 [requirements.md](./requirements.md) 的 REQ-N；设计依据见 [design.md](./design.md)。
> 完成定义（每个任务）：代码 + **验证命令跑绿** + 无残留临时文件/规则。
> 口径：`pnpm -C packages/wsl-docker-ports {typecheck,test,build}`。**P0 = Phase 0–6**，P1 = Phase 7。

---

## Phase 0：前置（阻塞项）

- [x] T0.1 捕获真机 fixture 并入库（脱敏）— ✅ **2026-10-08 完成**
  - 内容：`netsh interface portproxy show v4tov4` 原文（含既有 **19 条**）、`docker ps --format '{{json .}}'` 原文、`%USERPROFILE%\.wslconfig` 原文
  - ✅ **A-2 定案（推翻原假设）**：本机 `netsh` 输出是**纯 ASCII**（表头英文 `Listen on ipv4:`、高位字节 **0%**）、行尾 **CRLF** ⇒ **不存在** OEM/GBK 中文表头问题；解析器仍集中在 `decodeNetshOutput()` 一处，将来遇到 OEM 机器只改它
  - ✅ **A-1 解析形态定案**：结构 = 表头 → **纯分隔线**（`----- -----  ----- -----`）→ 4 列数据行；**无规则时没有分隔线** ⇒ 判据是「找不到分隔线 = 空表」（返回 `[]`），而形状脏的**数据行必须抛 `NetshParseError`**（静默丢行会让 005 的红线「他人规则条数不变」失真）
  - 🔴 **新事实（本次实测，已写进 design 与解析器注释）**：发行版冷启动后**第一次 `docker ps` 会被硬超时砍掉**（第 1 次跑满 `timeout 20`、**0 输出**；5 s 后第 2 次 **637 ms** 成功拿到 6 容器）⇒ 调用方必须**超时 + 重试**，且**不得**把空输出当成「没有容器」
  - 🔴 **`Ports` 列三种真实形态**（解析器已覆盖）：IPv4+IPv6 双份 / **区间** `5002-5003` / 空串（未发布）
  - 验证：`node --test "packages/wsl-docker-ports/tests/**/*.test.ts"` → **11/11 通过**（19 条规则一条不少且字段齐全、`netsh` 纯 ASCII 断言、空表 → `[]`、脏行抛错；6 容器字段齐全、IPv6 双份、区间、多段、未发布端口、5 条异常路径）；**泄漏扫描 0 命中**、未脱敏原文从未入库；溯源见 `packages/wsl-docker-ports/tests/contract/fixtures/README.md`

- [x] T0.2 [REQ-2.5][REQ-6.1] 真机确认两件事（**2026-10-08 完成，主人授权重启 WSL**）
  - 内容：① docker server **29.5.3** 是否支持 `docker ps --format json`（不支持则回落 `{{json .}}`）；② 记录一次重建前后对照，作为 T2.3 漂移判定的真机样本
  - ✅ **① 定案**：`--format json` **会挂住**（两次被 `timeout` 杀掉：rc=124，8s 与 15s 各一次，且守护进程已热）→ **必须** `--format '{{json .}}'`（返回完整 JSON 行，含 `Ports`/`State`/`HealthStatus`/`Labels`），且 docker 调用**一律加硬超时** ⇒ 解析器**只需单路径**（不必做双路径）。
  - ✅ **② 定案（两种重建都测了）**：单发行版 `wsl --terminate Ubuntu2204` → eth0 **不变**、`btime`/`boot_id` **不变**、**`/proc/1` 启动时间变**（17:08:10 → 20:44:54）、冷启动 **11.1s**；整台 `wsl --shutdown` → `btime`/`boot_id` **变**、`vmmemWSL` 重建（1s 内消失）、eth0 **仍不变**、冷启动 **12.5s**。⇒ **19 条规则零漂移、无需修复、无需 UAC**；端到端抽验 `127.0.0.1:{6379,5432,8080,5002}` **全通**。**结论**：漂移在本机**不可复现** → REQ-6 保留为**安全网**（判决逻辑本就随五态一起做），**不做**心跳/守护/持久化。
  - 验证：两条实测结论写入 design.md §13 与 requirements 的 A-1/A-3 状态；`--format` 结论决定解析器是否需要双路径 → **已回写（A-3 改为「实测反证」）**；完整数据见 `stack-decision.md` 变更记录第 23 条

- [x] T0.3（已迁出）提权最小验证
  - 内容与验收**已迁至 [005 的 T0.1](../005-elevation-write-path/tasks.md)**（2026-10-08 拆分；**同一条真机验证，不重复做**）。**编号 3 保留为空位**，以免 T0.4 / T0.5 错位。
  - ✅ **2026-10-12 真机证据结清（与 005 的 `T0.1` 是**同一条**、同一批证据；本代理当场读原件复算）**：批次目录 `C:\Users\EDY\dsh-probe-artifacts\20261012-150641-batch\` —— **`D-1` 真跑**：`D-E-result.json` 的 `d1` = `mechanism:"Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru; exit $p.ExitCode"`、`exitCode: 0`、`signal: null`、`elapsedMs: 1631`、`spawnError: null`、`parsedFromOutFile: {ok: true, payload: {ok: true, action: "probe-readonly", port: 1, steps: [{name: "readonly-admin-check", ok: true}]}}`、`beforeRules: []` / `afterRules: []` ⇒ **本次不写任何系统规则**、**out JSON 可解析**；`cleanup: {scriptRemoved: true, outRemoved: true}` ⇒ **两个临时文件都被删除**。驱动 `D-E-driver.mjs` 走的是**产品**产物 `packages/wsl-docker-ports/lib/elevate/index.js` 的 `buildNativeCommand`（`D-E-driver.mjs:19` 加载、`:102` 调用）⇒ 载荷形态来自产品。**零残留旁证**：同批 `F-baseline.log` 的 `TEMP dsh-ppp* = 0`（期望 0）。**未弹 UAC**：本机 `ConsentPromptBehaviorAdmin = 0`（stack-decision 已记录）⇒「人工点 UAC」这条前提在本机不适用。
  - ⚠️ **同批的 `d2` / `e2` 两条失败如实登记、不计入本条证据**（`d2.exitCode = 1`、`e2.status = "cancelled"`）—— 那是**后续缺陷轮**的对象：native 载荷缺 `-File` 把子进程退出码吞成 1、gsudo 后端不读 out 文件把合法载荷判成 cancelled；已由 commit `482f697`（`fix(005)`）修复，并带变异哨兵回归门 `tests/unit/elevate-defects.test.ts`（6 条）。**本条只以 `d1` 结清**（判据 = 退出码 / out JSON / 临时文件，`d1` 三条全中）。

- [x] T0.4 [REQ-12.3] 复核 C-3 → ✅ **2026-10-08 已定案（真机枚举 + 源码）**：`~/.dsh/cordis.patch.yml` **不存在**，层序（profile 根注释原文）为 bundle 层 → `cordis.patch.yml` → `--patch` 覆盖层，**无 home 层** → 原前提推翻、**本项关闭**（无需真机）。REQ-12.3 保留为「若日后出现更高层」的**防御性**只读态，且须**自绘**（`settings.writable` 恒 true，宿主不会报错）

- [x] T0.5 [REQ-14.1][REQ-14.3] 安装接入验证（D-1）
  - 内容：`link:<绝对路径>` 写入 profile `dependencies` + `dsh.profile.bundles`，`pnpm install` 后重载
  - 验证（真机，二值）：① 行出现在 profile 行列表且无 compatibility `disabled` ② 卸载后行消失、路由/页注销、临时文件清空、**规则数不变**（REQ-14.3）
  - ✅ **2026-10-12 真机二值结清**：批次目录 `C:\Users\EDY\dsh-probe-artifacts\20261012-150641-batch\`（profile = `volatile-probe`；`desktop` / `web` **未触碰**，批次 `MANIFEST.txt` 头部自述 + 本代理只读复核）。**① 装后**：`A2-package.json.with-both-plugins`（523 B，与 `profile-package.json.after-load.txt` **逐字节同内容**）= `dependencies` 里两条 `link:`（`dsh-terminal-profiles` / `dsh-wsl-docker-ports`）+ `dsh.profile.bundles` 里两个包名，**条目内不存在 `disabled` 字段**；装载走 `pnpm-install-profile.log`（56 B）。⚠️ **半留档如实登记**：批次**没有**留「装后运行时清单」的独立快照（只有**卸后**的 inventory）⇒ 「无 `disabled`」这半边以**配置面 + 卸后零命中**为准，不是独立观测。
  - ✅ **② 卸载后（逐条，本代理当场读原件复算）**：a) **名字命中 0** —— `A2-pluginInventory-after-uninstall.json`（76,941 B）里 `dsh-wsl-docker-ports` / `dsh-terminal-profiles` / `wslDockerPorts` / `managedTerminal` 命中**各 0**（正则逐个数，产物结构为 `result.value.entries`）；b) **路由/页注销** —— `A2-route-probe.txt` 原文五行：`POST /dsh-managed-terminal/instances => 405`、`POST /dsh-wsl-docker-ports/snapshot => 405`、`POST /dsh-wsl-docker-ports/write/audit => 405`、`GET /dsh-wsl-docker-ports/snapshot => 404`、`POST /api/settings/describe => 200`（对照组仍 200）；c) **临时文件清空 + 规则数不变** —— `F-baseline.log`：`TEMP dsh-ppp* = 0`、`TEMP vp-43311* = 0`、`portproxy rules = 19`（期望 19）、`sha 一致 = True`、`our firewall = 0 / 0`、`node 进程数 = 14`（期望 14）。⚠️ **未独立复算的两项**（批次记录值，非本代理复算）：`namespace 21 → 19`、`portproxy 19 + 同 sha` 之外的其它计数 ⇒ 只做转述。
  - ✅ **批次自身摘要**：`probe-map-PRE.txt` vs `probe-map-POST.txt` 各 36 行、**按行集合比对差 0 行**（3819 B / 3819 B；⚠️ **顺序不同** ⇒ 两文件 sha **不同**：`E086E2F4…` vs `CCAA0264…` —— 本代理当场核实「**集合相同、顺序不同**」，不说成「逐行相同」）；`lib-sha-PRE vs POST 行差 = 0 / 0`。⇒ **装载→卸载**一轮对 profile 与 `lib/` 的净影响 = 0。

---

## Phase 1：数据层（只读解析）

- [x] T1.1 [REQ-2.1][REQ-2.2][REQ-2.3][REQ-2.5] `parseDockerPs` — ✅ **2026-10-09 完成（Phase 1）**
  - 内容：经 001 的 `run` 执行 `wsl.exe -d <distro> -- docker ps --format '{{json .}}'`（**不是** `--format json`，实测会挂住）；解析 `0.0.0.0:8080->80/tcp` 与 `[::]:8080->80/tcp`；UDP 标记保留（供 REQ-9.2）
  - ✅ 落地：`src/read/docker-probe.ts`（`probeDockerPs`，261 行）+ `src/read/probe.ts`（统一失败态，69 行）+ `src/read/redact.ts`（脱敏，38 行）。**解析器一字未改**（复用 T0.1 的 `parseDockerPsJsonl`）
  - 验证：`pnpm -C packages/wsl-docker-ports test` → **71/71 通过、0 失败**（本任务 **14 条**：真机 fixture 3 + 边界/异常 11）；`typecheck` exit 0
  - ✅ 关键断言：① argv 逐字 = `['-d','Ubuntu2204','--','docker','ps','--format','{{json .}}']`，并**静态断言**「`--format` 只出现在一个数组字面量里、且不存在 `--format json` 回落形态」（口径订正 2026-10-09：原写法数**裸词** `--format`，会被提示文案里的正当提及判红 = 假阳性 ⇒ 改为断言**禁止形态**，源码不动）② 三种失败可区分（`docker-missing` / `daemon-down` / `permission-denied`；权限**优先**判——两者 stderr 都含 “docker daemon”）③ `Timeout` → 重试（`attemptCount=2`）、**两次都超时 → `timeout` 失败**且 `'containers' in outcome === false`（REQ-1.3：绝不空列表冒充）④ 空输出**复核**后才 `emptyAfterRetry=true`（`attempts:1` 时为 false）⑤ **发行版 Stopped 时执行器调用数 = 0**（REQ-2.4 不冷启动）
  - ⚠️ 口径替代：验证行原写 `vitest` → 实际用 **`node --test`**（包内既有 `test` 脚本，契约与单元同跑、零新依赖、不动 `pnpm-lock.yaml`）

- [x] T1.2 [REQ-3.2][REQ-3.5] `parsePortproxy` — ✅ **2026-10-09 完成（Phase 1）**
  - 内容：解析 `netsh … show v4tov4` 的 v4 表；跳过表头（**不依赖表头字面量**，`netsh` 输出会本地化）
  - ✅ 落地：`src/read/netsh-probe.ts`（`probePortproxyRules`，117 行）；解析器复用 T0.1 的 `parsePortproxyTable`
  - 验证：**8 条**（真机 fixture 1 + 边界/异常 7）——19 条一条不少且 `connectAddress` 全为 eth0；只走 `netsh.exe`（**不经 WSL ⇒ 不可能冷启动**、`show` 只读 ⇒ 不提权）；空表（无分隔线）→ **成功且 `[]`**；列数不对 / 端口越界 → `parse-error` + **脱敏**原文（`C:\Users\EDY` → `C:\Users\<user>`、`token=abc123` → `token=<已脱敏>`）；`non-zero-exit` / `netsh-missing` / `timeout`（不重试：本地毫秒级调用）

- [x] T1.3 [005-REQ-2.5] 读取 `localhostForwarding`（本包自读，单消费者）— ✅ **2026-10-09 完成（Phase 1）**
  - ✅ 落地：`src/read/localhost-forwarding.ts`（174 行）；路径解析**借 001 的 `readNetworkingMode().path`**（该函数成功/失败两路都带 `path`）⇒ **不复制** 001 那套 `USERPROFILE=''` 守卫（复制品迟早分叉，而分叉后果是静默读错文件）
  - 验证：**10 条** —— 缺省 `true`（ENOENT / 无该键 / 键在别的节）；显式 `false` ⇒ `enabled=false`（由 T2.1 的 `missing②` 证明它走「loopback 需显式规则」分支）；值不可识别 ⇒ **保守 `false`** + `source='fallback'` + `warning`（不静默；方向理由：说成 true 而其实需要 = 连不上且不报错，说成 false 最多多一条可见可删的规则）；读不了（非 ENOENT）⇒ `config-unreadable` + path；容忍 BOM / CRLF / 单 CR / 行内注释 / 大小写 / 重复键最后一个胜出
  - ✅ **「未改文件」的可执行形式**：静态断言（剥注释后源码里 `writeFile`/`appendFile`/`mkdir`/`rm(`/`unlink`/`copyFile`/`rename`/`chmod`/`process.env` **零命中**）
  - ⚠️ 已知重复（**未越界修改**，建议 001 后续导出「按节取键」的通用纯函数）：`parseWslConfig` 未在 001 公开面 ⇒ 这里的 INI 子集解析是**第二份实现**（只复制骨架：节跟踪 + 注释剥离 + 最后一个键胜出）

---

## Phase 2：diff-engine（纯函数，五态）

- [x] T2.1 [REQ-3.1][REQ-3.3][REQ-3.4] 期望集与五态分类 — ✅ **2026-10-09 完成（Phase 2）**
  - 内容：期望集 = mappings ∩ `managedPorts`；分类只依据三条事实（REQ-3.4）
  - ✅ 落地：`src/diff/managed-ports.ts`（区间表示 + 成员判定 + 求交，70 行）· `src/diff/types.ts`（类型契约，156 行）· `src/diff/expected.ts`（期望集构造，110 行）· `src/diff/engine.ts`（五态引擎，229 行）
  - 验证：**16 条**（表格驱动 `ok`/`missing`/`drift`/`conflict`/`extra` 各 ≥2 + 区间求交 3 条 + `scopeMismatch` 事实位 + 每端口恰好一个状态 + `counts` 之和 = 归类条数 + 输出**无任何函数**）——每条断言「恰好一条状态」（REQ-3.3）
  - ✅ 期望集口径：**未发布到宿主**的映射（`8080/tcp` 无 `host->`）不进期望集（没有宿主端口可听）；`docker 映射区间 ∩ 声明区间` **先求交再展开**（声明 5001 个端口而 docker 只映射 2 个 ⇒ 只有 2 条期望项，REQ-16.2）；映射区间**横跨**两个声明区间时只收交集中的端口（5004 不在集合 ⇒ 不出现）
  - ⚠️ **口径判断（design §3 与 005 REQ 的张力，已在报告登记）**：`listenAddress` 与声明作用域不一致（声明 loopback 而规则监听 `0.0.0.0`）**不判 `conflict`**，只置事实位 `scopeMismatch`。理由：005 REQ-1.3 把 conflict 定义为按 `connectAddress` 判，且 REQ-1.2 允许删/改 connectAddress 匹配的规则；若按 design 判 conflict（= SHALL NOT 修改或删除），则本机 19 条 `0.0.0.0` 既有规则一旦被声明就**再也删不掉**（写路径锁死）⇒ **以 requirements 为准**
  - ✅ 优先级 `conflict > drift > ok`：同端口「一条好 + 一条陈旧」⇒ `drift`（不许把陈旧规则藏进 `ok`）

- [x] T2.2 [005-REQ-1.1][REQ-15.1] `managedPorts` 之外零参与（只读清单侧）— ✅ **2026-10-09 完成（Phase 2）**
  - 验证：**1 条**（真机 fixture 19 条 + 注入 1 条「绑具体网卡地址 + 指向别的地址」的集合外规则 = 20 条）——只声明 `8080` ⇒ `ports` **恰好** `[[8080,'ok']]`；集合外的 19 条**不进任何状态**、`counts.conflict === 0`、全部落只读清单（`reason='port-not-managed'`）

- [x] T2.3 [REQ-6.1][REQ-6.2][REQ-6.4] 漂移判定与「取不到 eth0」— ✅ **2026-10-09 完成（Phase 2）**
  - 内容：**校准（T0.2 实测）**：本机两次重建 eth0 都未变 ⇒ 漂移是**安全网**而非主路径，**不要**为它加定时器/守护/持久化；判定在**激活 / 刷新 / 写入前**执行，其中**写入前必须强制现读**（不吃缓存 —— 否则等于拿旧地址亲手造一条新的坏规则）
  - ✅ 落地：`src/read/eth0-source.ts`（`cachedIp()` / `probe()` 两件事分型，76 行）；守卫与执行仍全在 001 的 `probeEth0`（只有一份实现）
  - 验证：**6 条** —— `connectAddress` ≠ eth0 → `drift` 且返回「旧→新」两个地址；`eth0Ip === null` → `ok:false / reason='eth0-unknown'` + 「无法确定 WSL 地址」，**无 `result` 字段 ⇒ 一条判决都没有**（自然也不会全标 drift），但 `external` 只读清单照给；**写入路径绕过缓存**：fake 执行器断言 `probe()` 连续两次 ⇒ 调用数 **1 → 2（+1）**，而 `cachedIp()` 全程 **0 次调用**；探测**失败后缓存清空**（`cachedIp() === null`，不留可能失效的地址）；`Stopped` 时默认 `probe()` **0 次执行**、只有显式 `{allowColdStart:true}` 才执行（001 REQ-2.4）

- [x] T2.4 [REQ-9.2] UDP 标记 — ✅ **2026-10-09 完成（Phase 2）**
  - 验证：**1 条**（含 4 个非 TCP 映射：udp v4/v6 各一 + sctp 一条 + **未发布**的 `8081/udp` 一条）——全部进 `unsupported`（`reason='portproxy-tcp-only'`）、**期望集里零条**、同一端口上 `tcp` 与 `udp` 并存时**只有 tcp** 进期望集；未发布的那条也标出来（REQ-9.2「不许直接忽略该映射」）；`sctp` 顺手同办（portproxy 同样只支持 TCP）且**未**做任何代偿（REQ-9.3）

- [x] T2.5 [REQ-15.1][REQ-14.2] 外部规则只读集合（D-2）— ✅ **2026-10-09 完成（Phase 2）**
  - 内容：把「∉ `managedPorts` 且非本插件写入」的规则归入独立集合（不属于五态）
  - ✅ 落地：`collectExternalRules()`（`src/diff/engine.ts`）+ `ExternalRule.display`（`监听地址:端口 → 目标地址:端口`）
  - 验证：**4 条** —— `managedPorts` 为空 ⇒ 本机 **19 条全部**落外部清单（`reason='port-not-managed'`）且 `ports === []`、`counts` **全 0**、**动作产生数 = 0**（`assertNoFunctions` 走遍整棵结果对象）；展示串逐条为 `0.0.0.0:80 → 172.20.201.152:80` 形态；集合内 2 个端口 ⇒ 其余 17 条仍是只读清单且集合内的落 `extra`（不双现）；无任何规则 ⇒ 空数组（UI 据此不渲染区域）
  - ⚠️ 判据只有「`listenPort ∉ managedPorts`」一条：本插件**不建台账**（stack-decision 定案）⇒ 无法从形态上分辨「谁写的」（原脚本那 19 条 connectAddress 就是 eth0，与插件写的规则同形）；声明式所有权正是靠这条判据落地

---

## Phase 3：期望集声明侧（所有权声明）

> **原 T3.1–T3.4（所有权匹配算法 / 防火墙参数生成 / scope 切换序列 / 前后快照与任务日志）已迁至 [005-elevation-write-path](../005-elevation-write-path/tasks.md)** 的 Phase 1（2026-10-08 拆分；内容逐条保留）。本 Spec 只保留**声明侧**：区间与期望集。

- [x] T3.5 [REQ-16.1][REQ-16.2][REQ-16.3] 区间声明与接管转移（D-2）— ✅ **2026-10-09 完成（Phase 3）**
  - 内容：`managedPorts` 解析单端口 + 闭区间混写；期望集 = 映射 ∩（区间展开）
  - 验证：`vitest` —— 区间正例/倒置/非法各一例被拒并给出项；区间∩映射求交（**不**枚举全体）；重叠端口从外部清单**移入**五态且**不**双现
  - ✅ 落地：`src/diff/managed-ports-parse.ts`（文本 → 区间解析 + 非法/倒置拒绝，132 行）· `src/diff/port-presets.ts`（13 项 presets 声明数据 + `portOf` 纯查表，59 行）· 引擎**一行未改**（接管直接复用 `isManagedPort` / `classifyPorts` / `collectExternalRules`，两个函数读**同一个**判据 ⇒ 「移入」与「从清单消失」不可能只发生一半）
  - 验证：**33 条**（`tests/unit/managed-ports-parse.test.ts` 23 + `tests/unit/managed-ports-takeover.test.ts` 10）——正例（单端口 / 闭区间 / 混写 / `'80-80'` 按单端口）· 倒置一例被拒且给出**所在项**（下标 + 原文 + 可读原因）· 非法项逐类各一例（空串 / `'1-'` / `'-5'` / 越界 `0` 与 `65536` / 垃圾 `'abc'` / 小数 `'1.5'` / 多段 `'1-2-3'`）· **不展开**：`'1-65535'` = **1 个区间**，求交量上界 = **映射宽度**（声明宽 65535 与宽 1000 落在同一映射上逐位相同，期望集 1000 条）· 接管：同一条 2000 对照「未声明 ⇒ 只在只读清单」vs「声明 `1000-3000` ⇒ 进五态且清单里没有」，闭区间两端 1000/3000 算接管而 999/3001 不算，重叠区间下每端口仍恰好一条；真机 19 条 fixture 上声明 `9000-9001` ⇒ 恰好 2 条移入 + 17 条留在清单，声明 `1-65535` ⇒ 五态仍 19 条
  - ✅ 错误模型（取舍）：**全有或全无** —— 任一项非法 ⇒ `ok:false`，失败结果里**没有 `ports` 字段**（类型层面拿不到「解析到一半」的集合，杜绝半套声明静默生效），且**全部**非法项一次报完（非首错即停）；数字项与字符串项先归一成文本 ⇒ **同一判据**（`-5` 与 `'-5'` 同判「缺起点的区间」，均被拒）
  - ✅ presets（REQ-16.4）：恰好 13 项、**不含** `1433`、端口两两不同、每项中文 label；**纯数据 + 纯查表**（零 `import`、零 `fetch`/`process`/`spawn`），另有一条静态用例扫源码钉死「勾选不得触发写操作 / 提权 / 联网」
  - ⚠️ 留痕：两个新文件的**运行时导出面未接进 `src/index.ts`**（由集成方按导出预算统一决定）；本任务新增 33 条，包内 `pnpm -C packages/wsl-docker-ports test` **218/218 全绿**、`typecheck` exit 0（同批集成方的 `p0-redlines.test.ts` 另占 7 条）

---


## 🔴 2026-10-09 真机装载发现（volatile-probe profile 实测，非推测）

**方法**：`dsh plugin --profile volatile-probe add "dsh-wsl-docker-ports@link:…"`（CLI 自动写好 dependencies + `dsh.profile.bundles`，并把包自带 `dsh.bundle.patch` 的 `- insert:` 并入合成树）→ `dsh --profile volatile-probe --port 43199 --no-open`。验证后 profile 已完全还原（`--dump-config` 前后 sha256 相同），**desktop profile 零改动**。

### ✅ 真机上被证实的假设（这些可以放心）
- **`HttpResponseLike` 成立**：`response.statusCode = …; setHeader(); end()` 在真宿主上正确落地 —— 用「纠正前缀的孪生 handler + 本包真实 `snapshotBuilder`」拿到端到端 `200`、`Content-Type: application/json; charset=utf-8`、`Content-Length` 正确、`Cache-Control: no-store` 正确；反例 404/405 亦按 JSON 返回。
- **注册签名正确**：宿主的 `register(route)` 就是 `{ kind, path, handler }` 对象式形状。
- **真数据全部对得上**：19 条规则 = `diff.external` **17** + 受管 2（8080/5432）· `connectaddress` 全 `172.20.201.152` · `listenAddress` 全 `0.0.0.0` · `eth0Ip = 172.20.201.152`（**未漂移**）· `distro = Ubuntu2204` · NAT + `localhostForwarding=true` · UDP `[]`。
- **冷启动行为如实**：首次 `docker.ok:false, reason:"timeout"`（10 s 硬超时砍掉，正是已知行为），5 s 后重试 `ok:true`、**6 个容器**、`t=1.17s` ⇒ 「超时 + 重试、不把空输出当没有容器」的纪律在真机上被复验。

### 🔴 缺陷 A：路由注册的启动时序竞态（静默，功能不通）
- 实测时间线：`+68ms ctx.get('"'webServer"') === undefined` → `+755ms` 本包 `inject(['"'webServer"'])` 才 FIRED；当前实现在 `apply` 里**同步**取服务 ⇒ 拿 `undefined` ⇒ 走「不注册 + 记 gap」⇒ **路由从未进入宿主路由表**（插件面板仍显示「运行中」，**零报错**）。
- 修法判据：改为宿主可用时机注册（`ctx.inject(['"'webServer"'])` 等），断言 = 启动后 `registrationCount() === 1`；**对抗性测试必须模拟真机时序**（服务只在后续 tick/inject 后才可用），且在旧代码上会**红**。

### 🔴 缺陷 B：`PORTS_HTTP_PREFIX` 尾斜杠导致永不匹配 + 405 不可达
- 宿主 `dsh-host-webserver/lib/index.js:328` 判定 = `pathname !== prefix && !pathname.startsWith(`${prefix}/`)`；本包常量**带尾斜杠** ⇒ 实际要求 `startsWith("/dsh-wsl-docker-ports//")` ⇒ `/…/snapshot` **永远不匹配**（被宿主兜底 404 吃掉：无 Content-Type、无 body）。
- 实测对照：`/…/snapshot` → 宿主 404；`/dsh-wsl-docker-ports/`（正好等于 prefix）→ **我们的 JSON** 404；`/…//snapshot` → 命中 handler 后被自己的路径判等拒掉；`POST /dsh-wsl-docker-ports/` → **JSON 404**（⇒ handler **先判路径后判方法**，**405 真机不可达**）。
- 修法判据：常量去尾斜杠为 `'/dsh-wsl-docker-ports'`（对外端点 URL **不变** ⇒ `client-contract.md` §P9 不受影响）；handler 改为「已知路径 + 非 GET ⇒ 405 / 未知路径 ⇒ 404」；两条都要有会红的回归。

### 🔴 缺陷 C：客户端半同类的时序隐患（页不出现，未证实）
- 真机：客户端 bundle **已加载**（`__DSH_BOOT__.entries` 有本包、`inject:["@deepseek-ai/dsh-client-ui-sidebar-right"]`、我们的 CSS 已注入），但**右栏没有我们的页**、**无任何 `/dsh-wsl-docker-ports/snapshot` 请求**、**控制台 0 error / 0 warning**。
- 可疑点：客户端半**先同步软取** `sidebarRightTabs`/`sidebarRight`，**之后**才 `ctx.inject` 注册 ⇒ 与 A 同类。**尚未证实** ⇒ 由修复任务查清（若为别因，如 kind/priority/slot 名或清单字段，也须如实报告并修）。

### ⚠️ 顺带发现的不可信字段（须处理或如实标注）
- `elevationAvailable` 目前是 `async () => false` 的**占位**，**不是真探测**（本机 gsudo 2.6.1 已装）⇒ 该字段现在**不可信**；要么实现真探测（按路径/产品名 `where.exe gsudo`，**绝不按命令名 `sudo`**），要么在契约里如实标注「未实现、恒 false」。
- `iphlpsvcRunning` 恒 `null`（未实现探测）—— 同上，标注或实现。
- 冷启动那次响应内部不自洽：`diff` 已取到 eth0，而同一份 JSON 里 `distro.state` 仍是 `"Stopped"`（状态读取与启动竞态）；重试后为 `Running` ⇒ 须修或标注。

### 🔸 真机副作用（如实记录，非仓库改动）
- 为取 docker/eth0 数据发过一次 `allowColdStart=1` ⇒ 启动过 `Ubuntu2204`（约 20.7 s，拉起 dockerd 与 6 个容器）；事后 `wsl -l -v` 自行回到 `Stopped`，与开工前一致。**未做任何 portproxy / 防火墙 / 注册表写操作**。

## Phase 4（已迁出）：提权辅助进程

T4.1–T4.5 **已整体迁至 [005-elevation-write-path](../005-elevation-write-path/tasks.md)** 的 Phase 2（脚本生成与参数结构 / RunAs 调用与回传解析 / 拒绝 UAC 分支 / 策略与临时文件清理 / 来源约束）。**Phase 编号 4 保留为空位**，以免 T5.x / T6.x / T7.x 等既有引用错位。

---

## Phase 5：UI（只读展示与门禁）

- [x] T5.1 [REQ-2.1][REQ-2.2][REQ-3.2] 容器表 + 端口表（五态）
  - 📌 **客户端半契约已实物定案（2026-10-09，与 002 Phase 4 共用同一套）**：见 [`client-contract.md`](../../client-contract.md) —— 清单三件（`dsh.client` + `exports['./client']` + `dsh.bundle.patch`）、产物 = **自注册 CJS 工厂** `window.__ModuleLoader__.load({ id, factory })`、页/面板/配置页**全走 `ctx.slots`**、写管道**优先 `ctx.get('remote.settings')`**、样式 = `<style data-plugin>` + 类名前缀 + `--dsw-alias-*`。⇒ 本任务开工时**照该文件实现**，不要再各自设计；未验项（懒加载/external/`immediately`/0.2.0 差异）在该文件 §Z 与 §P5。
  - 验证：`vitest` 渲染断言 —— 五态标签各自可渲染；刷新后时间戳更新；打开页面**零**写操作（NFR-2）

- [x] T5.2 [REQ-1.1][REQ-1.2][REQ-1.3][REQ-1.4] NAT 门与前置检查
  - 内容：非 NAT / 读取失败 → 写控件置灰 + 原因 + 修复指引（含 `.wslconfig` 路径与命令文本，可复制）；只读展示保留
  - 验证：`vitest` —— 非 NAT 时**无**任何写控件可点、指引文本含路径与命令；断言**未**写 `.wslconfig`

- [x] T5.3 [005-REQ-2.1][005-REQ-2.4] 作用域切换控件（写动作由 005 执行）
  - 验证：`vitest` —— 每端口独立 scope 控件；默认 loopback；切 lan 需显式操作（无「全选局域网」入口）

- [x] T5.4 [REQ-9.1][REQ-9.2] UDP 明示
  - 验证：`vitest` —— 常驻提示存在；UDP 映射行标「不支持」

- [x] T5.5 [REQ-10.1][REQ-10.3] exec 注入点（下一期）
  - 验证：`vitest` —— 控件禁用 + 「下一期」原因；002 服务缺失时**无**报错、回调未触发；断言本包**未** import 002（静态 grep）

- [x] T5.6 [REQ-6.2][REQ-6.3] 漂移高亮与修复入口
  - 验证：`vitest` —— drift 行显示「旧 → 新」；修复动作生成「先删后加」序列；失败时报告哪些未改

- [x] T5.7 [REQ-15.1][REQ-16.4][REQ-16.5] 外部规则清单 + 端口声明最小表单（P0，D-2/D-3）
  - 内容：外部规则独立区域（只读、无动作、空则不渲染）+ **区间输入框**（写 `managedPorts`）+ 常见服务端口勾选
  - 验证：`vitest` 渲染 —— 本机 19 条落只读区且**无**任何动作控件；默认候选**恰好 13 项**（含 3306/1521/8080/5432/6379/5173/5000，**不含** 1433）；区间/勾选写回后**仅**改配置、**未**产生提权调用（调用数 0）

- [x] T5.8 [REQ-17.1][REQ-17.2][REQ-17.3][REQ-17.4] 目标发行版控件（P0，D-4）
  - 内容：显示当前目标发行版 + **来源**（配置 / WSL 默认 / 唯一发行版 / 首个）+ 切换下拉（列出全部及各自 `state`）；**只读 `wsl -l -v`**，绝不用 `wsl -d` 探状态；配置已失效时回落解析并明示
  - 验证：`vitest` + fake 执行器 —— ① 仅 1 个发行版 → **直接认定**且**零提问**（断言无询问调用）；② 配置为空且存在 `*` 项 → 取 `*`、`source='wslDefault'`；③ 配置值存在 → `source='config'` 且**优先于** `*`；④ 配置值已不存在 → `DistroNotFound` + 回落 + 失效提示；⑤ 断言全程**未**执行任何 `wsl -d`（spawn 调用里不含该 argv）

---

## Phase 6：门禁与收口（P0 完成门）

> **原 T6.1（红线断言：无 `portproxy reset`）、T6.2（真机自证：他人规则条数不变）、T6.3（卸载语义与清理清单）已迁至 [005-elevation-write-path](../005-elevation-write-path/tasks.md)** 的 Phase 3（T3.1–T3.3）。本 Spec 只保留质量门与文档回写。

- [x] T6.4 [NFR-4..NFR-7] 质量门（2026-10-09 完成）
  - 验证：`pnpm -C packages/wsl-docker-ports typecheck` + `test` + `build` 三绿并记录用例数；单文件 ≤ 400 行；UI 零硬编码 hex
  - ✅ **2026-10-09 五条全部真验通过（集成方独立复算；⑤ 的解封点 = Phase 5 UI 落地）**：① `typecheck` ⇒ **exit 0**；② `test` ⇒ **`node --test` 287 / 287 pass / 0 fail** + **vitest 2 文件 / 23 用例全过**，exit 0（用例数由 225 增至 287）；③ `build` ⇒ **exit 0** 且构建后**真 `import('lib/index.js')`** 成功（33 导出、`apply` 是函数 —— 只跑 `tsc` 会假绿）；④ 单文件 ≤ 400 行 ⇒ **全仓 193 个源文件（排除 `node_modules`/`lib`）超 400 行者 = 0 个**，最大为 002 的 `src/plugin.ts` 394 行，**本包最大** `src/write/plan.ts` 378 行（原记的 392 行 `src/read/connection.ts` 已被后续改动取代，实测现为 392→**未再居首**，此处按本轮实测更新）；⑤ **UI 零硬编码 hex 现可真扫**（Phase 5 的 UI 落在 `src/client/**`，`src/ui/` 从未建立 ⇒ 口径按实际路径记）⇒ 扫 **44 个源文件 / 309,450 字节，命中 0 处**，产物侧作者自检另扫 **88,769 字节命中 0**、内联 CSS 字符串命中 0 ⇒ **非空扫描**。⚠️ 遗留（不属本门）：本轮 T6.8 的宿主数据通道未交付前，页面因 `ports-source-missing` **不注册**（已如实登记为 T0.5 的代码前置）。
  - 🔵 **2026-10-09 部分复算（集成方；⚠️ 本项不勾选 —— 判据里有一项当前无法验）**：① `typecheck` ⇒ **exit 0**；② `test`（`node --test`）⇒ **225 tests / 225 pass / 0 fail**；③ `build` ⇒ **exit 0**，且**构建后真 `import('lib/index.js')` 成功**（27 导出；只跑 `tsc` 不 import 产物会漏掉 CJS 互操作类缺陷）；④ 单文件 ≤ 400 行 ⇒ 本包最大 **392 行**（`src/read/connection.ts`）✓。🔴 **⑤「UI 零硬编码 hex」现在无法验**：`packages/wsl-docker-ports/src/ui/` **目录尚不存在**（Phase 5 未实现）⇒ 此刻写这条断言只能是**空扫描（假绿）**，故**留到 Phase 5 落地后再跑本门并勾选**（这正是 004 T3.2 那半条缺口的教训：要么真扫到、要么明说没扫）。跨 Spec 披露（与 005 T3.4 同一把尺子）：全仓 142 个源文件里唯一超 400 行者 = 002 的在制品 `tests/unit/plugin-entry.test.ts`（401 行，已通知其作者压回）。
  - 🔵 **2026-10-09 门覆盖范围的事实澄清（集成方；⚠️ 属主人待拍板项，非本包缺陷）**：根 `pnpm check:size|check:exports|check:scope` 的实现是 `pnpm -r --if-present` ⇒ **只有带同名脚本的包会被跑到**，而三个脚本都住在 `packages/wsl-shared/scripts/`、且用**非递归** `readdirSync(join(pkgDir,'src'))` **只看自己包的 `src`**；001 `tasks.md` L5 的原话也是「**本包**目标代码体积 ≤ 40KB」⇒ **范围限定是有意的，不是缺口**。事实后果：① 报「根三门全绿」时，它**只证明了 `wsl-shared`**，对本包**零覆盖**（本包只有 `check:client` / `check:host` 两道自有门 + 人工数 400 行）；② 本包的**体积与导出预算至今没有定义**（本包运行时导出 **33** 个 —— 若按 001 REQ-6.4「≤12 且必须有具名消费方」的尺子量，**当场超标**，这正是 T6.7⑤ 收敛项的实质）⇒ 两条绑在一起等主人一句话：**(a)** 明确插件包豁免体积/导出预算（记录在案即可）；**(b)** 给两个插件包补同款门（脚本复制 + 改递归），**并据此执行 T6.7⑤ 的收敛**。集成方推荐 **(b)**（001 REQ-6.4 的立意是防投机导出，插件包的 33 个零消费方导出正是该形态）。
  - ✅ **2026-10-09 主人裁定（④+⑪ 绑定项）**：采纳 **(b)** —— 给**两个插件包**补同款门（`check:size` / `check:exports` 脚本复制过来并把扫描改为**递归**），据此**再收敛本包的导出面**（现 33 个运行时导出、零外部消费方）。**不采纳 (a)**（「插件包豁免 001 REQ-6.4」）—— 因为老板原话是「40KB 再超了就是你的代码有问题或者 spec 拆分有问题」，豁免会让这句话对插件包失效。**排期**：004 工具改名落地并提交后执行（避免与改名同批改动混在一起）。
  - 🔴 **2026-10-09 预检（插件清单缺口 ⇒ T0.5 安装接入前必须补）**：对照本机 profile 里**全部 8 个可安装 bundle 条目**的 `package.json`（**8/8** 都声明 `dsh.bundle.patch: ./cordis.patch.yml`，入口**无一例外是构建产物 JS**），本包**缺** `dsh` 字段（`dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client` + `dsh.compatibility`）、缺 `cordis.patch.yml` 实物、`exports` 只有 `"."`、且**入口是 `./src/index.ts`**（栈已冻结 **esbuild → CJS**，宿主 ModuleLoader 要的是构建产物 `lib/index.js`）⇒ **本任务里的 `pnpm -C packages/wsl-docker-ports build` 今天会当场失败**（脚本不存在，显式调用**不会**像 `--if-present` 那样跳过）。**处置**：Phase 5 交付插件入口时一并补齐「清单四件套 + `build` 脚本」再跑本门；证据见 [stack-decision.md](../../stack-decision.md) 的 2026-10-09「插件清单契约审计」行。✅ **2026-10-09 部分解除（commit `65bde79`／`3c0e925`）**：**四件套已落地三件** —— ① `dsh.bundle.patch` 字段 ✓ ② `cordis.patch.yml` 实物 ✓（`- insert: [{id, name}]`，id/name = 包名逐字）③ `exports["./package.json"]` ✓；**`build` 脚本也已落地**（`tsc -p tsconfig.build.json` → `lib/`，实测 exit 0）⇒ 本门的 `build` 一栏现在**可跑**。**仍缺**：`exports["."]` 仍指 `./src/index.ts`（本包**没有**插件入口 `apply`）⇒ 本包的 patch **在入口交付前不得用于 T0.5 装载验证**（已写进 `cordis.patch.yml` 文件头）。🔴 **本门须同时做「构建后真 `import()` 产物」**（只跑 `tsc` 会假绿，理由见 004 T3.2 同款注记）。 🔴 **追加一项（2026-10-09 集成方读值发现）：本包缺 `peerDependencies.react`** —— 002 有 `^18.2.0`，而**栈级**（`stack-decision.md` 的 `packaging` 维度「peerDependencies "^18.2.0"，不打进 bundle」+ 风险表「React 版本冲突」+ `AGENTS.md` 栈索引）、以及 **002 NFR-1** 都要求它；本包有 **3 个 `.tsx`**（`pane.tsx` / `pane-tables.tsx` / `pane-settings.tsx`）却**没声明**。运行时无害（React 是宿主 **baseline** 模块，不经 npm 解析；`link:` 交付也不装包），但**清单不完整**，与冻结栈不一致 ⇒ 属本门（T0.5 前的清单补齐）范围，**一并补上**。旁证：实测本包 `lib/client.js` **未内联 React**（标记只命中 `jsx-runtime` / `createElement`，**无** `__SECRET_INTERNALS` / `ReactCurrentOwner`）⇒ 与「peer 而非 bundle」的栈口径一致。
  - 🔵 **2026-10-09 预检（公开面审计；⚠️ 待主人拍板后再动手，本波**未**改动）**：本包 `src/index.ts` 现有 **27 个运行时导出**，而**包外消费方 = 0** —— ① 全仓**无人**按包名 `dsh-wsl-docker-ports` import（该字符串仅出现在本包 `package.json` 与一句注释里）；② 003 自己的 10 个测试文件**全走相对模块路径**（`../../src/read/netsh.ts` / `../../src/diff/engine.ts` 等，走 barrel `src/index.ts` 的次数 = **0**）；③ 005（写路径）与本 Spec 的 Phase 5 UI 都在**同一个包**里 ⇒ 亦走相对路径。⇒ 今天这个 barrel 是**零消费者的「公开面」**，正是 001 REQ-6.4（导出必须有具名消费方）所防的**投机导出**形态，且文件头自称「公开面」与事实不符。**两条出路**（集成方**推荐 ①**）：① 待 Phase 5 插件入口落地时，把 `src/index.ts` 收敛成**插件入口**（只导出入口所需），同包内部件继续相对路径引用；② 保留现状，但本任务必须**逐条列出消费方**并订正「公开面」措辞。**集成方明确不动手**（第二波有代理在同包写 `write/`，此刻收缩会砸掉它的构建）⇒ 按主人裁定在 Phase 6 执行

- [x] T6.5 文档回写 · ✅ **2026-10-09 完成（集成方）**
  - 内容：T0.1（编码）、T0.2（`--format`、漂移复现）→ 回写 README/design；**并记 D-2（外部规则只读清单）与 D-3（端口声明提到 P0）的最终口径**；提权相关真机结论（005 的 T0.1 / T3.2）由 **005** 回写
  - 验证：`grep -n "A-1\|A-2\|A-3\|superseded\|reset" specs/003-wsl-docker-ports/*.md` 可见结论；`leanspec` 行数无新增超线
  - ✅ **2026-10-09 复核（集成方）**：① **T0.1/T0.2 结论早已在册** —— `requirements.md` 的 A-1（`docker ps --format json` **会挂住** rc=124，故必须 `--format '{{json .}}'` + 硬超时）· A-2（原「OEM/GBK 中文表头」假设**已推翻** ⇒ 纯 ASCII + **CRLF**，见 2026-10-08 订正）· A-3（漂移**反证**：两种重建方式 eth0 都不变）+ `design.md` §12-4 + `README.md` 的 C-4 行；② **D-2 / D-3 最终口径在册** —— `design.md` §12 的两行权衡 + `README.md` 的「D-3（已定案）/ D-2（已定案）」行 + `requirements.md` REQ-15 / REQ-16.5；③ **本次补上 T6.6 并入的那一项**：`design.md` 新增 **§9.1**「四条禁止性需求的可执行红线」（四条判据表 + 复算命令 + 4 组变异自证 + 🔴 **① 的范围口径**：P0 只读的扫描范围 = `src/read/**` + `src/diff/**`，**不是**整个 `src/` —— 否则 Phase 7 的 T7.1（P1 启停，REQ-11.1 明文允许）一落地就假红）。
  - 复核命令与输出：判据 grep **命中 25 行**（`superseded` 亦有 1 处字面命中）；行数 `design.md 169 / README.md 175 / requirements.md 182 / tasks.md 187`（**四份全部 < warn 200**，`.lean-spec/config.json` 未改）；红线复算 `pnpm -C packages/wsl-docker-ports exec node --test tests/unit/p0-redlines.test.ts` ⇒ **7 tests / 7 pass / 0 fail**。

- [x] T6.6 [REQ-2.4][REQ-9.3][REQ-10.2][REQ-10.4] 红线断言（四条禁止性需求的可二值判定）
  - ✅ **2026-10-09 落地（集成方）**：`tests/unit/p0-redlines.test.ts`（7 条）+ 共享脚手架 `tests/helpers/src-scan.ts`（同一份「走 `src/` 全树 + 剥注释复用 001 的 `strip-comments.mjs`」，不再各写正则）。四条各留证据（命令 `pnpm -C packages/wsl-docker-ports exec node --test tests/unit/p0-redlines.test.ts` ⇒ **7/7 pass**）：**①** ①-a `DOCKER_PS_ARGV` deepEqual `['docker','ps','--format','{{json .}}']`（行为断言）+ ①-b P0 内带引号的写子命令命中 `[]` + ①-c P0 的 docker 调用点白名单 = `['src/read/docker-probe.ts']`；**②** `v6tov6` / `socat` / `wsl2host` / `netsh2ip` 命中 `[]`，且唯一 netsh argv 不含 `udp`/`listenprotocol`/`protocol`；**③** `dependencies` 白名单**恰好** `['dsh-wsl-shared']`、四个依赖字段均无 `dsh-terminal-profiles`、源码零命中；**④** `'exec'` / `docker exec` / `execInContainer` / `containerExec` 全树命中 `[]`。🔴 **①的范围留痕（本条最要紧的口径决定）**：「P0 只读」钉死在 **`src/read/**` + `src/diff/**`** —— 若照字面写成「整个 `src/` 不许出现 `docker start`」，**T7.1（P1 容器启停/重启）一落地就假红**（那是 REQ-11.1 明文允许的）；④ **没有**这个例外（exec 属「下一期」）故扫全树。判据刻意精确到「**带引号的 argv 元素**」⇒ `execInDistro`（001 的 API 名）、`'running'`（状态值）不误伤。**变异自证 4 组**（均改回后哈希一致、复绿）：加 docker 写动作 const ⇒ ①-b 红；换一个 P0 文件加 docker 调用点 ⇒ ①-c 红（**白名单**被突破）；注入 `socat` + `['docker','exec']` ⇒ ②④ 红；注入 `'dsh-terminal-profiles'` ⇒ ③ 红。⚠️ **诚实缺口**：③ 的 `package.json` 白名单**半边未做变异自证**（改 `package.json` 会触发 pnpm 11 `verify-deps-before-run` 自动 install 并写回 lockfile，代价不值当）⇒ 该半边只以读到的实际清单为准。验证第②项「回写 `design.md`」并入 **T6.5**（与真机结论一次写完）。
  - 内容：四条 `SHALL NOT` 各配一条可判定断言 —— ① **P0 只读**（REQ-2.4）：P0 路径不存在 docker 写子命令（`start`/`stop`/`restart`/`rm`/`run`/`exec`），只用 `ps`/`inspect` ② **不代偿 UDP**（REQ-9.3）：不引入 `v6tov6` / 第三方转发工具 ③ **不建包边**（REQ-10.2）：依赖里没有 `dsh-terminal-profiles`，只用字符串键 `managedTerminal` 可选注入 ④ **不实现 exec**（REQ-10.4）：无容器 exec 调用，控件只有禁用态
  - 验证：四条断言各对应一条 `vitest`/脚本用例且全绿；每条留一行证据（命令 + 输出）→ 回写 design

---

- [x] T6.7 [REQ-14.1][REQ-14.3] 插件宿主入口 `apply`（**T0.5 的前置** —— 兑现 T6.4 那条「清单缺口」的处置口径）
  - 内容：实现插件入口（**与 002 宿主半同口径**，回报里写清依据）；把 `src/index.ts` 从「纯函数 barrel」**收敛成入口**（同包内部件继续走相对路径；T6.4 审计到的 **27 个零消费方导出**随之收敛 —— 001 REQ-6.4）；`exports["."]` 改指 **`./lib/index.js`**；补 `files`（覆盖 `lib/**`）；删掉 `cordis.patch.yml` 文件头「入口交付前**不得**用于 T0.5」那句
  - 验证：① `pnpm -C packages/wsl-docker-ports build` ⇒ exit 0，**且构建后真 `import('./lib/index.js')`**（打印入口导出名与数量 —— 只跑 `tsc` 会假绿）② 读 `package.json` 断言 `exports["."] === './lib/index.js'`（**读值，不靠 grep 注释**）③ 清单四件套齐（`dsh.bundle.patch` / `cordis.patch.yml` 实物 / `exports["./package.json"]` / 入口 = **构建产物**）④ 与本机 profile 的 **8/8** 可安装 bundle 逐项对照并打印对照表 ⑤ 收敛后 `src/index.ts` 运行时导出数**下降**，并逐条列出存留导出的消费方
  - ⚠️ **时序（必须遵守）**：本任务与 Phase 5 **同包** ⇒ 等 Phase 5 交付后再动手（并发写会互相砸构建）；且「公开面收敛」属**主人待拍板项**（T6.4 审计行的推荐方案 ①）⇒ 动手前先出示 ⑤ 的消费方清单
  - 🟡 **2026-10-09 部分交付（集成方复验；① –④ ✅，⑤ 待主人拍板 ⇒ 本行**故意不勾**）**：`src/index.ts` 现在是入口（`export default { name, inject, apply }`、`inject: []`、`name` = 包名），**未**收敛那 27 个导出（按「主人未拍板不得扩大范围」执行 ⇒ 这是唯一未兑现的子项）。**① ** `build` exit 0，且**真 `import('./lib/index.js')`** 成功 ⇒ **33 个命名导出** + `default` 恰 `{apply, inject, name}`、`typeof apply === 'function'`、`name === 'dsh-wsl-docker-ports'`（**不是**只跑 `tsc` 的假绿）；**②** 读值断言 `exports["."] === './lib/index.js'` ✅；**③** 四件套齐 ✅（`dsh.bundle.patch` 为字符串且 `cordis.patch.yml` **实物存在**、`exports["./package.json"] = './package.json'`、入口 = 构建产物、`files = ["lib/**"]`），且 patch 头注已由「不得用于 T0.5」改为「**可以**用于 T0.5，跑前先 `build`」；**④** 作者自检 `scripts/verify-host-entry.mjs`（178 行）= **18 项断言 / 0 失败**，含「本机 9 个第三方 bundle 逐项对照（严格四件套 7/9、多数派入口指产物 7/9）」与「本包入口**真**导出 `apply`」（`import()` 取到 function，比正则存在性扫描更强）；**⑤ 未做** —— 收敛会砍掉 27 个零消费方导出，属主人拍板项（清单与两条证据见 T6.4 L148，**现状未变**：包外消费方仍为 0）。**回归**：`build` / `typecheck` / `test`（275 + 23）/ `check:client`（24/24）全绿。**待主人一句话**：收敛（推荐 ①，砍到只剩入口）还是保留宽 barrel（则 T6.7 可即刻勾）。
  - ✅ **2026-10-12 T6.7⑤ 结清：公开面收敛 33 → 6（运行时）/ 45 → 7（类型）** —— 零真机、未跑 `pnpm`、零新依赖、**产品逻辑零改动**（`src/**` 只动 `index.ts` 的导出块 + 文件头：**只摘导出、不删实现** ⇒ 实现/测试/调用点一行未改）。**收敛前 33** = Phase 0–2 barrel **27** + 入口 **6**；**收敛后 6**。**逐条消费方证据**（`node` 直调扫全仓，排除 `node_modules`/`lib`）：那 27 个**包外消费方 0**、**经 barrel 的包内消费方也是 0**（包内一律走 `../../src/read/netsh.ts` / `../../src/diff/engine.ts` 这类**具体模块**路径；全仓只有 2 处 `await import('../../src/index.ts')` = `tests/unit/plugin-entry.test.ts:42` 与 `tests/unit/config.test.ts:276`，两者只断言入口形状 ⇒ **本轮无 (b) 类调用点需要改写**）。分类：**(a) 宿主加载契约 4 个**（`name` / `inject` / `apply` / `Config` —— 宿主按**包根导出**按名字读，**绝不能删**：缺 `apply` 不激活、缺 `Config` 不注册 settings 命名空间）+ **入口面 2 个**（`applyWslDockerPorts` 的**产物级**消费方 = `scripts/verify-host-entry.mjs`（178 行 / 18 断言，`import('./lib/index.js')` 之后**真调用**它）；`PORTS_SERVICE` = 跨插件服务身份）⇒ **存留 6 个**；**(b) 已走具体模块的包内跨模块引用 = 23 个**（`diff` 10 处、`singlePort` 10 处、`parsePortproxyTable` 8 处 …）；**(c) 连包内都没有 import 的零消费方 = 4 个**（`DOCKER_PS_ATTEMPTS` / `DOCKER_PS_TIMEOUT_MS` / `NETSH_TIMEOUT_MS` / `classifyPorts`，只在各自定义文件内自用）。类型一并收敛 **45 → 7**（同为「只导出入口所需」：38 个已摘 API 的类型留在 barrel 就是零消费方类型面，且会让软阈值 25 长期超限；**实现处的类型定义一个未动**）。**回归门**：新增本包 `scripts/check-exports.mjs`（`package.json` 加 `check:exports`；**未改共享门、未把门扩到别的包**）⇒ **23 项断言 / 0 失败 / exit 0**，运行时 **6/12**、类型 7、合计 13；门内含 ① **变异哨兵**（收敛前 33 个名字喂**同一个**判定函数 ⇒ 判**失败**「超 21 个」，同一函数对 12 个名字判**通过** ⇒ 既非恒真也非恒假）② **只做减法**（现清单 ⊆ 旧清单、差额恰 27、27 个已摘名字真的不在模块导出里）③ **宿主契约冒烟**（真 `import('../src/index.ts')`：`name` === 包名、`apply`/`applyWslDockerPorts` 是函数、`inject` = `[]`、`Config` 在场、`default` 键集恰 `{Config, apply, inject, name}` 且与具名导出**同一份引用**）。**其余离线门（逐条实测）**：`tsc -p tsconfig.json` **exit 0**；`node --test --test-concurrency=1 "tests/**/*.test.ts"` = **425 / 425 pass / 0 fail** —— 其中 **6 条来自未跟踪的 `tests/unit/elevate-defects.test.ts`**（同包**另一轮**的在制品，非本轮）⇒ **减去它 = 419**，与预期一致；`vitest run` = **11 文件 / 111 通过 / exit 0**；`node packages/wsl-shared/scripts/check-size.mjs`（仓库根）= **exit 1**，唯一超 400 行者是 **`terminal-profiles/src/client/config-pipe.ts` 461 行**（HEAD 里 **324** 行 ⇒ **同批另一轮的在制品，非本轮改动**；本包 0 处超限，本轮三个文件 = `src/index.ts` **55** / `scripts/check-exports.mjs` **182** / `package.json` **53** 行）⇒ 🔴 **本条门本轮未获绿，归因于别人的在制品**；`node scripts/verify-client-loader.mjs` = **24 项断言 / 0 失败 / exit 0**。🔴 **产物口径（必读）**：本轮**未重建 `lib/`**（另一轮在同包改 `src/elevate/**` ⇒ 避免两份不一致产物）⇒ ① `verify-client-loader.mjs` 验的是**盘上既有** `lib/client.js`（141,884 B、mtime `2026-10-12 15:07:09`、sha256 `18FA9D51…`）；② 盘上 `lib/index.js`（3,990 B、sha256 `DFE8D84A…`）仍是**收敛前**产物（34 键 = 33 + default）⇒ 它**不能**当「收敛后入口」的证据。为补这段缺口另做**一次性临时产物核验**（`tsc -p tsconfig.build.json --outDir %TEMP%\dsh-ports-emit` ⇒ exit 0，**盘上 `lib/index.js` 哈希未变**；临时目录已删、未入库）：对临时产物跑 `verify-host-entry.mjs` 的**同款断言** ⇒ **12 项 / 0 失败**（含 `hasApply` 正则命中、空 ctx 调 `applyWslDockerPorts` 得 `gaps=[provide, webServer, ElevationInvoker, effect]` / `provided=false`）⇒ **下次 `build` 之后既有产物级门仍会过**。🔴 **未验项**：真机装载（**T0.5**）**未做** ⇒ 宿主契约目前只由「**源码真 `import` 冒烟** + **临时产物级断言** + `verify-client-loader`（客户端 bundle）」**间接**证明，**没有**在任何宿主实例里装载过、**没有**起实例/探针。**勾选态**：T6.7 的 `[ ]` 与 L267「T6.7 只差 ⑤」按「原文保留 + 追加订正痕」**未改**（订正留痕 = 本行）。
  - 📌 **建议登记（属 001 口径变更，待主人拍板；本轮不做）**：把导出预算门 `check:exports` 扩到**两个插件包**（本包 = 本轮已落；**仍是空白的 = `terminal-profiles`** —— 只读同口径复算 `packages/terminal-profiles/src/index.ts` = **运行时 31 / 类型 45**，未跑其门）。实现上需复制脚本并把 `src` 扫描改**递归**（`wsl-shared/scripts/check-exports.mjs:28` 现为**非递归**，且根 `pnpm check:exports` = `pnpm -r --if-present check:exports` ⇒ 只有带同名脚本的包会被跑到）。🔴 本轮**只在本包**落门，`specs/001-wsl-shared/requirements.md` 的 REQ-6.4 仍是唯一 SSoT。
  - ✅ **2026-10-12 勾选依据（本代理；⚠️ 判据只在 commit 与门里，未找到独立运行输出）**：⑤ 的收敛**已提交** = commit **`e1135d8`**（`git log` 原文：`refactor(003): T6.7⑤ 公开面收敛 —— 运行时导出 33 → 6（类型 45 → 7）+ 本包导出预算门`；其正文记 `check-exports 23/0 exit 0`、运行时 **6/12**、类型 **7**）；**门实物** = `packages/wsl-docker-ports/scripts/check-exports.mjs`（182 行，头部写明**变异哨兵**：收敛前的 33 个名字喂**同一个**判定函数 ⇒ 判失败，12 个名字 ⇒ 判通过；另有「只做减法」与「宿主契约冒烟」两重防假绿），`package.json` 同步新增 `check:exports`。🔴 **诚实缺口**：在 `C:\Users\EDY\dsh-probe-artifacts\` **全量递归**搜 `check:exports` / `23 断言` / `check-exports` **无该轮记录** ⇒ 那一轮的哨兵输出**没有独立留档**；本轮**零 `pnpm`**（任务硬约束）故**未重跑**该门 ⇒ **判据落在 commit `e1135d8` 与门脚本本体上**，不编路径。
  - 📌 **迁出裁决（本代理，2026-10-12）：「`check:exports` 扩到两个插件包」这条建议留在 003，不迁 010**。理由：① 它是 **001 口径变更**（REQ-6.4 是唯一 SSoT），触发点是 **003 自己的 T6.7⑤**，与本 Spec 的 P1 功能交付是两件事；② 010 的验收边界是「容器启停 / 日志 / 配置页」，把仓库级质量门口径塞进去会污染该边界（010 的 README §3.2 已明示不承接）；③ 003 翻 `complete` 后本条仍以「**登记不修**」形态留在案（不删留痕），待主人一句话再动。

- [x] T6.8 [REQ-1.1][REQ-2.1][REQ-2.2] 客户端数据通道（宿主快照装配 + 传输）—— **T0.5 的唯一代码前置**（2026-10-09 集成方登记）：Phase 5 的页面需要 `PortsSource`，而宿主侧「快照装配（001 执行器跑 `docker ps` + `netsh` + eth0 + `.wslconfig`/distro）+ 传输（自建 `ctx.webServer` 具名路由，独占前缀，登记 effect-scoped disposer）」尚未实现 ⇒ 当前页面按 `ports-source-missing` **不注册**（代理**如实登记、未造假实现** ✓）。判据：① 宿主路由返回快照（离线 fixture = 真 19 条 portproxy + 真 docker ps 样本），且**失败态**走 T5.4 既有分支；② 客户端拿到源 ⇒ 页面注册、拿不到 ⇒ 仍按 `ports-source-missing` 降级且不抛；③ 不新增依赖、`check:scope`/`check:size`/`check:exports` 三绿；④ 传输契约（路由前缀/形状/错误）回报给集成方写入 [`client-contract.md`](../../client-contract.md) 新增 §P9；⑤ 关键判据做一次变异自证。
  - ✅ **2026-10-09 T6.8 收工（代理交付 + 集成方独立复验，判据①–⑤ 逐条）**：① 端到端 `GET /dsh-wsl-docker-ports/snapshot?managedPorts=…` ⇒ **200 / 9565 B**，`snapshot.diff` 与「同批事实直接喂 `diff()`」**逐字 deepEqual**；命令集恰好 **4 条只读**（`wsl -l -v` / `netsh show v4tov4` / `docker ps --format '{{json .}}'` / `ip -4 -o addr show dev eth0`），**零写/提权命令**。② 失败态走 T5.4 既有分支：eth0 失败 ⇒ `diff.ok:false` + `reason:'eth0-unknown'`，`external`/`unsupported` 与成功态**逐字相等**（19 条），页面端口 **0 行**、`counts` 全 0。③ **零新依赖**（`dependencies` 仍只有 `dsh-wsl-shared`，`inject` 未变）+ 门全绿（**集成方复跑**：`typecheck` exit 0 · **`node --test` 313 / 313 pass / 0 fail** · **`vitest` 2 文件 25 通过** · `check:client` **24 断言 0 失败** · `check:host` **18 断言 0 失败** · §P8 官方准入 **5/5** · `pnpm install --frozen-lockfile` exit 0）。④ **变异自证（集成方独立复算哈希）**：拆掉「规则读不到」守卫 ⇒ 313→**311 pass / 2 fail**（503→**200**、`ok:false`→**true**）；还原后 `src/snapshot.ts` SHA256 = **`9A9DDE6FCCDA2D189042A2DD5EE502C9857974AEDED934F65CC1F87F8807BAA8`**（208 行）—— 我独立重算一致 ⇒ 自证真做过。⑤ **≤400 行**：集成方独立复算 **0 个超限**（最大 `plan.ts` 379；本次最大 `route.test.ts` 353）。   - 🔵 **非平凡结论（集成方独立复算；我两次自纠后才确认）**：19 条规则 vs docker 现实**不是全 ok** —— 已发布宿主端口 = **7**（`5002,5003,5432,6379,8080,8194,50051`，含**区间** `5002-5003`）⇒ 正确判决 `{ok:7, missing:0, drift:0, conflict:0, extra:12}`，那 12 条是**原脚本硬编码、docker 已不再映射的陈旧规则**（坑 #3 的实证）。⚠️ 我头两次扫错（先扫了测试文件、正则又漏区间 `a-b`）⇒ 0/5 命中皆我之误，第三次修正后与代理数一致。   - 🔵 **偏差如实登记（代理上报，集成方核实）**：`src/client/distro.ts` → **`src/distro.ts`**（纯搬移、0 逻辑改动，已核实 `src/client/distro.ts` 不存在）：实证 `tsconfig.build.json` 的 `exclude:["src/client/**"]` **拦不住**被 type-only import 的客户端文件发射 ⇒ 宿主侧文件**不得** import `src/client/**`（方向收敛为「客户端 → 宿主」单向）；视图类型搬到宿主 `src/wire.ts`，客户端 `types.ts`/`host.ts` **再导出**（客户端内部 import 一字未改）；`iphlpsvcRunning` 恒 `null`（**不编造**）、`elevationAvailable` 无注入时**保守 false**。   - 🔴 **仍未验证（真机 / 主人场，已在 §P9 与本表隔离）**：T0.5 装载链路 · `HttpResponseLike` 方法名与真宿主是否一致（现用 `statusCode` 赋值 + `setHeader` + `end`）· 浏览器能否**同源**打到该前缀 · 设置命名空间是否需宿主侧 schema（✅ 2026-10-09 主人裁定：**不加**、不引 `@deepseek-ai/schemastery`，用自家 `cordis.patch.yml` 的 `- insert:` 条目） · 提权接线（005 的 `ElevationInvoker` 缺口）。另代理如实记一条 **flake**（node 测试运行器的 IPC 反序列化错误曾丢整文件 12 用例；单跑 13/13、连跑 3 次全量 313/313 绿）—— 按 flake 记录、未做规避性改动。

---

## Phase 7（已迁出）：P1 容器控制（P0 真机验收通过后再启）

> ✅ **2026-10-12 已迁出至 [`010-docker-container-control`](../010-docker-container-control/tasks.md)**（同款先例：`Phase 5 → 004`、`Phase 6 → 007`、`001 Phase 4 → 006`）。`T7.1`–`T7.3` **连同判据与闸门「P0 真机验收通过后再启」一并移交**（**只迁位置、不删内容** —— 三条的标题 / `内容` / `验证` 行在 010 的 `tasks.md` 与「迁入记录」里**逐字保留**）；**`Phase 7` 与 `T7.1` / `T7.2` / `T7.3` 编号原样保持为空位**，以免既有引用错位。
> 🔴 **为什么迁**：003 已收口（P0 离线判据全绿、真机侧结清「安装/卸载二值」与「提权链路」两条），而 P1 的前置闸门**未达** ⇒ P1 留在 003 会让「未勾项 = 0」永不成立，也会把**已验收的 P0** 与**未开工的 P1** 混在同一张表里。
> ⚠️ **归口（本轮刻意不搬的一块）**：需求原文 `REQ-11` / `REQ-12` **仍留在 [requirements.md](./requirements.md)（SSoT 未动）** —— 与 `002 → 007` 的「连 REQ 一起移」**不同**，理由：这两条被本文件 `README.md` 的分期表、`REQ-12.2` 的字段分工、`REQ-16.5` 等多处引用，移出必须同批改三份文档，**超出本轮「只迁 `Phase 7`」的授权** ⇒ 已在 010 的 `requirements.md` §5 登记为**待主人拍板项**。
> 📌 **迁出时的两条边界（逐条登记）**：① **003 的真机 / 待拍板项一条都没进 010**（`T0.3` / `T0.5` 是 003 的收口对象，`check:exports` 扩包建议是 001 的口径变更）；② **P0 的字段不重复**（`managedPorts` 在 `T5.7`、`distro` 在 `T5.8` ⇒ 同一字段只允许一个写入口，010 的配置页只补 `scope` / `elevationPolicy`）。
> 📌 **下一期**（`exec` / `compose` / 镜像管理）**仍只留注入点**，不随本轮迁出（010 的 `design.md` §7）。

---

## 真机验收清单（chrome-devtools MCP + **人工点 UAC**）

> 依据：handover 拍板「vitest 单元 + `node:test` 离线契约 + chrome-devtools MCP 真机验收」，**否决** Playwright E2E 与视觉对照。UAC 弹窗**无法自动化**，提权相关行必须人工点击 —— 如实登记。

| # | 场景 | 期望 | 手段 |
|---|------|------|------|
| 1 | 打开页面（NAT 机器）| 容器表 + 端口表渲染；**零**提权弹窗（NFR-2）| chrome-devtools 截图 |
| 2 | 端口表状态 + 外部清单 | 19 条既有规则中落在 `managedPorts` 内的被正确标 `ok`/`drift`；**其余全部落在「外部规则」只读清单**（不进五态、无动作，REQ-15）| 截图 + 与 `netsh` 原文比对 |
| 3 | 端口声明表单（区间 + presets）| 输入 `1000-3000`、勾选 presets 后**仅改配置**、**未**产生提权调用；与 docker 实际映射求交后进五态（交集非空时）| 截图 + 调用数断言 |
| 4 | UDP 映射存在时 | 表格标「不支持」，无对应转发项 | 截图 |
| 5 | 非 NAT（临时改 `.wslconfig`）| 全部写控件置灰 + 修复指引含路径与命令；只读展示仍在 | 截图（改完**改回**，并记录）|
| 6 | 进容器 exec 控件 | 禁用 + 「下一期」原因；002 未加载时无报错 | 截图 + 控制台无错 |
| 7 | 禁插件再启用 | 无重复页/无临时文件残留；规则零变化 | 日志 + `%TEMP%` + 快照 |

> **写路径与 UAC 的真机行（原第 3–8 行：加转发 loopback/lan、移除、漂移修复、拒绝 UAC、策略 `none`）已迁至 [005-elevation-write-path 的真机清单](../005-elevation-write-path/tasks.md)**（2026-10-08 拆分）—— 那里每行都需**人工点 UAC**。本清单只保留**不触发提权**的只读与门禁场景。

### ✅ 2026-10-09 缺陷 A/B/B2/C 修复交付（已独立复验）

- **改动**：`src/wire.ts`（前缀去尾斜杠、快照路径由前缀派生，对外 URL 逐字不变）· `src/route.ts`（注册改走 `ctx.inject(['webServer'], …)`；状态改活 getter `registered/state/reason`；attach 幂等 + disposed 挡后到回调 + disposer 无条件进 `ctx.effect`；handler 改为**先认路径、已知路径才谈方法**）· `src/plugin.ts`（`gaps` 改 getter：注册到位后缺口自己消失）· `src/client/index.ts`（删掉注入前同步判空早退，一律惰性注入；`sidebar-right-pending`(deferred) ≠ `unavailable`；降级写 `console.warn`）· 新增 `tests/unit/route-fakes.ts`（逐字复刻宿主分派判据）+ `route-timing.test.ts`（4 条对抗性回归）。
- **我的独立复验**：`typecheck` exit 0 · `vitest` 2 文件 26 通过 · `build` `lib/client.js = 85,199 B` · `check:client` 24 断言 0 失败 · `check:host` 18 断言 0 失败 · `node --test` **318/318**（串行）。
- **我自己的变异测试**（不采信代理自证）：把 `PORTS_HTTP_PREFIX` 改回带尾斜杠 ⇒ `route-timing.test.ts` **B 与 B2 两条真红**；还原后 hash 逐字节一致、4/4 全绿 ⇒ 对抗性用例**确实能抓这个缺陷**。
- ⚠️ **顺带发现（本包范围外，未修）**：`packages/terminal-profiles/src/ws/routes.ts` 有**同一个**「在 apply 里同步 `ctx.get('webServer')` 决定注册」的缺陷（同一类 A）⇒ 002 的 WS 端点在真机上**很可能同样静默不注册**，已另派修复。
- ⚠️ **环境级抖动（非断言失败，已钉住门禁）**：Node **v24.15.0** 的 `node --test` 在**默认并行**下偶发 `Unable to deserialize cloned data … test_runner/runner:410 #processRawBuffer`（**掉文件、零 AssertionError**）；实测默认并行 **2/2 红**（`tests 316/319`、`pass 315/318`、`fail 1`），`--test-concurrency=1` 与 `=2` 均 **318/318 绿**（本机 14 个常驻 node = MCP server，非残留子进程）⇒ 已把本包 `scripts.test` 钉成 `--test-concurrency=1`（慢到 ~4.6 s，换稳定；Node 修好后可回退）。

### ✅ 2026-10-09 真机复验（修复后，第二次装载）：四个缺陷全部真修好

- **路由端到端 200（上次拿不到的那条）**：GET /dsh-wsl-docker-ports/snapshot?managedPorts=8080&managedPorts=5432&distro=Ubuntu2204 → 200 / application/json; charset=utf-8 / 4280 B / 0.243s + Content-Length + Cache-Control: no-store。WSL 停止时如实 docker.ok:false, reason:"distro-not-running"（**没有任何东西去启动它** ⇒ 语义正确）。
- **冷启动链**：allowColdStart=1 → 200 / 4559 B / 20.714s、docker.ok:false, reason:"timeout"（10 s 硬超时如实回报）；5 s 后重试 → 200 / 7323 B / 1.574s、docker.ok:true、containers=6、counts={ok:2,missing:0,drift:0,conflict:0,extra:0}、expected=2 / external=17 / unsupported=0 ⇒ **17 + 2 受管 = 19**，eth0 仍未漂移 ✅。
- **反例全部走插件自己的 URL**：GET /nope → 404 + JSON（not-found，含可读 message）；POST /snapshot → **405 可达** ✅（method-not-allowed，82 B）；PUT 同 405。
- **卸载态（首次验证 disposer）**：运行时关掉插件 → 4 s 后同 URL = **宿主兜底 404**（无 Content-Type、无 body）⇒ disposer 真把路由摘了；再开回 → 5 s 后 200 / 4458 B / 0.221s ⇒ **attach 幂等、无重复 (kind,path) 抛错**；纯重启对照亦 200 ✅。
- **浏览器半边（C 的三条间接硬证）**：① 页面内 GET /dsh-wsl-docker-ports/snapshot => 200（上次**零请求**）② 右栏 tablist 出现 tab "WSL Docker 端口" [selected] ③ 面板 DOM .wdp-page + **28 个 testid 齐全**、正文含「外部规则（只读，19 条）」（与真机 19 条吻合）、发行版面板、NAT 门如实显示「取不到 eth0：期望地址不可判定」。⚠️ 未读到 apply() 返回值（无观测点）⇒ C 是**间接三证**，不是直接读状态。

### 🔴 真机复验新发现（两处，均非本次修复回归；已派修）

- **① sidebar-right-pending 的 warn 打在正常路径上**：探针实测宿主服务 **约 240 ms 后**（APPLY @1051ms 两服务 undefined → INNER-INJECT-FIRED @1317ms 均为 object）就到齐并完成注册，但那条 warn 每次启动都打 ⇒ **会训练人忽略真告警**。判据：pending 超过 grace（如 2 s）才 warn，或降为 info/debug；正常启动应**零 warn**，真缺服务仍要有可见告警。
- **② 页类型缺 guide 入口 ⇒ 页存在但用户在 UI 里点不到**：真机复现 —— 未程序化 openTab("wslDockerPorts") 之前，右栏空态只列「工作区文件」/「新建终端」（官方各家都注册了 guide chip）。判据：照官方 tabs.register({ …, guide }) 形状补入口，并从 UI 点进去能到 .wdp-page。
- ③（建议，非缺陷）客户端模块级 inject 可补上两个服务名（官方 6 家都写）；A 探针证明与官方同款声明照样 fire ⇒ **不是必须**，当前写法功能无误。
- ⚠️ 仍未修的老问题：冷启动那份响应内部不自洽（diff 已取到 eth0、同响应 distro.state 仍是 Stopped）；elevationAvailable=false / iphlpsvcRunning=null 仍是占位（复验确认行为未变）。

---

## ✅ 003 关闭评估轮：**14 条未勾项逐条结清 → 勾选 8 条 / 保留 6 条**（2026-10-12；**零真机**、未跑 `pnpm`、零新依赖、零产品代码改动）

- **结清（8 条）**：**T5.1–T5.8** 全部勾选 —— 判据 = 各条「验证」列的字面**离线**断言（逐条用例名 / 命令 / 原始输出只留一份 ⇒ 见 [closure-round.md](./closure-round.md) §1）。
- **仍留（6 条；本块**不改其勾选态**）**：**T0.3**（已迁出 ⇒ 其真机判据在 [005 的 T0.1](../005-elevation-write-path/tasks.md)，**005 侧同为未勾**）与 **T0.5**（安装/卸载二值）⇒ 两条**留给真机批次**（与 002 `T0.5`、005 `T0.1`/`T3.2`/`T3.5`/`T3.7` 同场）；**T6.7** 只差 ⑤（公开面收敛 = **主人待拍板**：本轮复算 `src/index.ts` 运行时导出仍 **33**、包外消费方仍 **0**）；**T7.1 / T7.2 / T7.3** = Phase 7（P1），前置「P0 真机验收通过」未达且代码面零命中 ⇒ 三条不勾。
- **状态**：仍有 6 条未勾（含真机项）⇒ **不翻状态**，`status` 保持 `in-progress`（判据：`Select-String -Path 'specs\003-wsl-docker-ports\tasks.md' -Pattern '^\s*-\s*\[ \]'` 返回 **6** 条）。
- **行数自述订正痕（原文保留）**：`:189` 的 `design 169 / README 175 / requirements 182 / tasks 187` 是 **2026-10-09** 时点值；本轮当场复算 = `design **171** / README **176** / requirements **182** / tasks **270**`（SSoT = `check-size.mjs` 的 `rawLines()`）。🔴 `tasks.md` **270 行 > warn 200**（`max 400` 未过）⇒ 既有状态，**登记不修**、不抬阈值。
- **本轮改动**：`tasks.md` 8 个复选框 + 本块 · `README.md` 1 行导航 + 状态行订正痕 · 新增 `closure-round.md`。**未碰** `packages/terminal-profiles/**`、**未碰**任何 profile、**未跑** `netsh` / 实例 / 浏览器、**未用** `git add -A`。


---

## ✅ 003 收口轮（2026-10-12：`Phase 7` 迁出 + 3 条证据勾选 ⇒ 未勾项 0 ⇒ 状态翻 `complete`）

> 体例同上一块（关闭评估轮）：**只追加、不删原文** —— 上面「仍留 6 条 / 不翻状态 / tasks 270 行」是**关闭评估轮**的时点记录，**原文保留**；本块记录**同日晚些的收口轮**如何把这 6 条清到 0。

- **① 迁出（3 条不再计数）**：`Phase 7`（`T7.1` / `T7.2` / `T7.3`）**整体迁至 [010-docker-container-control](../010-docker-container-control/tasks.md)**（同包不拆包；**只迁位置、不删内容** —— 三条的标题 / `内容` / `验证` 行在 010 侧**逐字保留**，见 010 的「迁入记录」）。原地留 **`## Phase 7（已迁出）` 空位 + 指针**（照 `002 → 004 / 007`、`001 → 006`、`008 → 009` 的写法），**`Phase 7` 与 `T7.1`/`T7.2`/`T7.3` 编号保持**。⚠️ 空位是**散文**、不再有复选框行 ⇒ 未勾项计数里不再出现（与 002 的 `Phase 5` / `Phase 6` 同款）。
- **② 勾选（3 条，逐条证据路径）**：
  - `T0.3`（已迁出 = 005 的 `T0.1`，**同一条真机验证**）：`C:\Users\EDY\dsh-probe-artifacts\20261012-150641-batch\D-E-result.json` 的 `d1` + 驱动 `D-E-driver.mjs`（经产品 `lib/elevate/index.js` 的 `buildNativeCommand`）+ `F-baseline.log`（`TEMP dsh-ppp* = 0`）；**005 的 `T0.1` 已同批勾选**。
  - `T0.5`（安装/卸载二值）：同批 `A2-package.json.with-both-plugins` / `profile-package.json.after-load.txt`（装后两个 `link:` + 两个 bundle 名、条目无 `disabled`）· `A2-pluginInventory-after-uninstall.json`（卸后四个名字命中**各 0**）· `A2-route-probe.txt`（405/405/405/404 + 对照组 `/api/settings/describe` 200）· `F-baseline.log`（`portproxy rules = 19` + `sha 一致 = True` + `TEMP` 净）· `probe-map-PRE/POST` **集合相同**（各 36 行、差 0 行；⚠️ **顺序不同** ⇒ sha 不同：`E086E2F4…` vs `CCAA0264…`）。
  - `T6.7`（只差 ⑤）：commit **`e1135d8`**（运行时 `33 → 6`、类型 `45 → 7`；正文记 `check-exports 23/0 exit 0`）+ 门实物 `packages/wsl-docker-ports/scripts/check-exports.mjs`（含变异哨兵）。🔴 该项**无独立运行输出文件**（`dsh-probe-artifacts` 全量递归搜无命中）⇒ **判据落在 commit 与门里**，未重跑（本轮零 `pnpm`）。
- **③ 未勾项复算**：`Select-String -Pattern '^\s*-\s*\[ \]'` ⇒ **0** 条（迁出/勾选前是 6 条：`T0.3` / `T0.5` / `T6.7` / `T7.1` / `T7.2` / `T7.3`）。
- **④ 状态流转（CLI，未手改 frontmatter）**：`leanspec update 003-wsl-docker-ports --status complete` ⇒ `status: complete`、`completed_at: 2026-10-12T07:52:07.273297800Z`、`transitions` 追加第三条 `- status: complete  at: 2026-10-12T07:52:07.273297800Z`。
- **⑤ 行数复核（两口径）**：本文件 `rawLines = 275`（SSoT = `check-size.mjs` 的 `rawLines()`）/ `split('\n') = 276` —— **已超 warn 200（既有状态、登记不修、不抬阈值）、max 400 未过**；`README.md = 191`（两口径 191 / 192）。**loneCR delta = 0**（改前 0 ⇒ 改后 0）、控制字符 0。
- **⑥ 本轮改动**：`tasks.md`（3 处勾选 + `Phase 7` 空位 + 本块）· `README.md`（状态行追加 + 文档导航新增 010 行 + P1 块指针 + 「收口轮留痕」块）· **新增** `specs/010-docker-container-control/**`（CLI `create` + 三份内容文件）。**未碰** `packages/**`（零代码）· **未碰**任何 profile · **未跑** `pnpm` / 实例 / 浏览器 · **未用** `git add -A`。
- **⑦ 仍留的未验项（不因翻状态而消失）**：本文件「真机验收清单」7 行**仍未逐行走**；`iphlpsvcRunning` 恒 `null` / `elevationAvailable` 保守 `false` 两个占位未变；`check:exports` 扩到两个插件包 = **001 口径变更，登记不修、待主人拍板**（该建议**留在本 Spec**、不随 `Phase 7` 迁走）。
