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

- [ ] T0.3（已迁出）提权最小验证
  - 内容与验收**已迁至 [005 的 T0.1](../005-elevation-write-path/tasks.md)**（2026-10-08 拆分；**同一条真机验证，不重复做**）。**编号 3 保留为空位**，以免 T0.4 / T0.5 错位。

- [x] T0.4 [REQ-12.3] 复核 C-3 → ✅ **2026-10-08 已定案（真机枚举 + 源码）**：`~/.dsh/cordis.patch.yml` **不存在**，层序（profile 根注释原文）为 bundle 层 → `cordis.patch.yml` → `--patch` 覆盖层，**无 home 层** → 原前提推翻、**本项关闭**（无需真机）。REQ-12.3 保留为「若日后出现更高层」的**防御性**只读态，且须**自绘**（`settings.writable` 恒 true，宿主不会报错）

- [ ] T0.5 [REQ-14.1][REQ-14.3] 安装接入验证（D-1）
  - 内容：`link:<绝对路径>` 写入 profile `dependencies` + `dsh.profile.bundles`，`pnpm install` 后重载
  - 验证（真机，二值）：① 行出现在 profile 行列表且无 compatibility `disabled` ② 卸载后行消失、路由/页注销、临时文件清空、**规则数不变**（REQ-14.3）

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

## Phase 4（已迁出）：提权辅助进程

T4.1–T4.5 **已整体迁至 [005-elevation-write-path](../005-elevation-write-path/tasks.md)** 的 Phase 2（脚本生成与参数结构 / RunAs 调用与回传解析 / 拒绝 UAC 分支 / 策略与临时文件清理 / 来源约束）。**Phase 编号 4 保留为空位**，以免 T5.x / T6.x / T7.x 等既有引用错位。

---

## Phase 5：UI（只读展示与门禁）

- [ ] T5.1 [REQ-2.1][REQ-2.2][REQ-3.2] 容器表 + 端口表（五态）
  - 📌 **客户端半契约已实物定案（2026-10-09，与 002 Phase 4 共用同一套）**：见 [`client-contract.md`](../../client-contract.md) —— 清单三件（`dsh.client` + `exports['./client']` + `dsh.bundle.patch`）、产物 = **自注册 CJS 工厂** `window.__ModuleLoader__.load({ id, factory })`、页/面板/配置页**全走 `ctx.slots`**、写管道**优先 `ctx.get('remote.settings')`**、样式 = `<style data-plugin>` + 类名前缀 + `--dsw-alias-*`。⇒ 本任务开工时**照该文件实现**，不要再各自设计；未验项（懒加载/external/`immediately`/0.2.0 差异）在该文件 §Z 与 §P5。
  - 验证：`vitest` 渲染断言 —— 五态标签各自可渲染；刷新后时间戳更新；打开页面**零**写操作（NFR-2）

- [ ] T5.2 [REQ-1.1][REQ-1.2][REQ-1.3][REQ-1.4] NAT 门与前置检查
  - 内容：非 NAT / 读取失败 → 写控件置灰 + 原因 + 修复指引（含 `.wslconfig` 路径与命令文本，可复制）；只读展示保留
  - 验证：`vitest` —— 非 NAT 时**无**任何写控件可点、指引文本含路径与命令；断言**未**写 `.wslconfig`

- [ ] T5.3 [005-REQ-2.1][005-REQ-2.4] 作用域切换控件（写动作由 005 执行）
  - 验证：`vitest` —— 每端口独立 scope 控件；默认 loopback；切 lan 需显式操作（无「全选局域网」入口）

- [ ] T5.4 [REQ-9.1][REQ-9.2] UDP 明示
  - 验证：`vitest` —— 常驻提示存在；UDP 映射行标「不支持」

- [ ] T5.5 [REQ-10.1][REQ-10.3] exec 注入点（下一期）
  - 验证：`vitest` —— 控件禁用 + 「下一期」原因；002 服务缺失时**无**报错、回调未触发；断言本包**未** import 002（静态 grep）

- [ ] T5.6 [REQ-6.2][REQ-6.3] 漂移高亮与修复入口
  - 验证：`vitest` —— drift 行显示「旧 → 新」；修复动作生成「先删后加」序列；失败时报告哪些未改

- [ ] T5.7 [REQ-15.1][REQ-16.4][REQ-16.5] 外部规则清单 + 端口声明最小表单（P0，D-2/D-3）
  - 内容：外部规则独立区域（只读、无动作、空则不渲染）+ **区间输入框**（写 `managedPorts`）+ 常见服务端口勾选
  - 验证：`vitest` 渲染 —— 本机 19 条落只读区且**无**任何动作控件；默认候选**恰好 13 项**（含 3306/1521/8080/5432/6379/5173/5000，**不含** 1433）；区间/勾选写回后**仅**改配置、**未**产生提权调用（调用数 0）

- [ ] T5.8 [REQ-17.1][REQ-17.2][REQ-17.3][REQ-17.4] 目标发行版控件（P0，D-4）
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

- [ ] T6.7 [REQ-14.1][REQ-14.3] 插件宿主入口 `apply`（**T0.5 的前置** —— 兑现 T6.4 那条「清单缺口」的处置口径）
  - 内容：实现插件入口（**与 002 宿主半同口径**，回报里写清依据）；把 `src/index.ts` 从「纯函数 barrel」**收敛成入口**（同包内部件继续走相对路径；T6.4 审计到的 **27 个零消费方导出**随之收敛 —— 001 REQ-6.4）；`exports["."]` 改指 **`./lib/index.js`**；补 `files`（覆盖 `lib/**`）；删掉 `cordis.patch.yml` 文件头「入口交付前**不得**用于 T0.5」那句
  - 验证：① `pnpm -C packages/wsl-docker-ports build` ⇒ exit 0，**且构建后真 `import('./lib/index.js')`**（打印入口导出名与数量 —— 只跑 `tsc` 会假绿）② 读 `package.json` 断言 `exports["."] === './lib/index.js'`（**读值，不靠 grep 注释**）③ 清单四件套齐（`dsh.bundle.patch` / `cordis.patch.yml` 实物 / `exports["./package.json"]` / 入口 = **构建产物**）④ 与本机 profile 的 **8/8** 可安装 bundle 逐项对照并打印对照表 ⑤ 收敛后 `src/index.ts` 运行时导出数**下降**，并逐条列出存留导出的消费方
  - ⚠️ **时序（必须遵守）**：本任务与 Phase 5 **同包** ⇒ 等 Phase 5 交付后再动手（并发写会互相砸构建）；且「公开面收敛」属**主人待拍板项**（T6.4 审计行的推荐方案 ①）⇒ 动手前先出示 ⑤ 的消费方清单
  - 🟡 **2026-10-09 部分交付（集成方复验；① –④ ✅，⑤ 待主人拍板 ⇒ 本行**故意不勾**）**：`src/index.ts` 现在是入口（`export default { name, inject, apply }`、`inject: []`、`name` = 包名），**未**收敛那 27 个导出（按「主人未拍板不得扩大范围」执行 ⇒ 这是唯一未兑现的子项）。**① ** `build` exit 0，且**真 `import('./lib/index.js')`** 成功 ⇒ **33 个命名导出** + `default` 恰 `{apply, inject, name}`、`typeof apply === 'function'`、`name === 'dsh-wsl-docker-ports'`（**不是**只跑 `tsc` 的假绿）；**②** 读值断言 `exports["."] === './lib/index.js'` ✅；**③** 四件套齐 ✅（`dsh.bundle.patch` 为字符串且 `cordis.patch.yml` **实物存在**、`exports["./package.json"] = './package.json'`、入口 = 构建产物、`files = ["lib/**"]`），且 patch 头注已由「不得用于 T0.5」改为「**可以**用于 T0.5，跑前先 `build`」；**④** 作者自检 `scripts/verify-host-entry.mjs`（178 行）= **18 项断言 / 0 失败**，含「本机 9 个第三方 bundle 逐项对照（严格四件套 7/9、多数派入口指产物 7/9）」与「本包入口**真**导出 `apply`」（`import()` 取到 function，比正则存在性扫描更强）；**⑤ 未做** —— 收敛会砍掉 27 个零消费方导出，属主人拍板项（清单与两条证据见 T6.4 L148，**现状未变**：包外消费方仍为 0）。**回归**：`build` / `typecheck` / `test`（275 + 23）/ `check:client`（24/24）全绿。**待主人一句话**：收敛（推荐 ①，砍到只剩入口）还是保留宽 barrel（则 T6.7 可即刻勾）。

- [ ] T6.8 [REQ-1.1][REQ-2.1][REQ-2.2] 客户端数据通道（宿主快照装配 + 传输）—— **T0.5 的唯一代码前置**（2026-10-09 集成方登记）：Phase 5 的页面需要 `PortsSource`，而宿主侧「快照装配（001 执行器跑 `docker ps` + `netsh` + eth0 + `.wslconfig`/distro）+ 传输（自建 `ctx.webServer` 具名路由，独占前缀，登记 effect-scoped disposer）」尚未实现 ⇒ 当前页面按 `ports-source-missing` **不注册**（代理**如实登记、未造假实现** ✓）。判据：① 宿主路由返回快照（离线 fixture = 真 19 条 portproxy + 真 docker ps 样本），且**失败态**走 T5.4 既有分支；② 客户端拿到源 ⇒ 页面注册、拿不到 ⇒ 仍按 `ports-source-missing` 降级且不抛；③ 不新增依赖、`check:scope`/`check:size`/`check:exports` 三绿；④ 传输契约（路由前缀/形状/错误）回报给集成方写入 [`client-contract.md`](../../client-contract.md) 新增 §P9；⑤ 关键判据做一次变异自证。
  - 🔴 **2026-10-09 12:06 收口快照（代理仍在飞 ⇒ 本项不勾选，代码在工作区未提交）**：产物已落地 —— `src/wire.ts`(229) · `src/snapshot.ts`(208) · `src/route.ts`(177) · `src/plugin.ts`(303, 已接线路由) · `src/client/route-source.ts`(92) + 测试 `tests/unit/snapshot.test.ts`(299→276) · `route.test.ts`(353) · `route-source.test.ts`(131)，共 **25 个未提交文件**。**已独立核验通过**：① 独占前缀 `'/dsh-wsl-docker-ports/'`、`GET …/snapshot`、不蹭 002；② **零** `spawnSync`/`execSync`（命令全走 `probePortproxyRules(deps.executor)`）；③ 零新增依赖（`dependencies` 仍只有 `dsh-wsl-shared`）+ `dsh.client.inject` 未变；④ 新产物 92–353 行**全 ≤400**；⑤ §P8 官方准入预检 **5/5**（`lib/client.js` 83,709 B）；⑥ 测试的**反恒真**设计过硬（19 端口逐个硬编码、明写「不从被测代码里取」、fake executor 不跑真进程）。🔴 **仍红 ⇒ 不得勾选**：`typecheck` 4 错与 `node --test` 1 失败**全在代理自己 T6.7 时期的 `tests/unit/plugin-entry.test.ts`**，根因是**期望陈旧**（缺口清单已因 T6.8 从 `PortsSource` 变为 `webServer`；新增缺口条目缺「归属阶段」标注）—— 代理 **12:05:45 正在改该文件**。**复跑命令**：`pnpm -C packages/wsl-docker-ports typecheck && pnpm -C packages/wsl-docker-ports test`（`node --test` 绿了才会跑到 vitest 半边，故 vitest 状态**至今未知**）。：Phase 5 的页面需要 `PortsSource`，而宿主侧「快照装配（001 执行器跑 `docker ps` + `netsh` + eth0 + `.wslconfig`/distro）+ 传输（自建 `ctx.webServer` 具名路由，独占前缀，登记 effect-scoped disposer）」尚未实现 ⇒ 当前页面按 `ports-source-missing` **不注册**（代理**如实登记、未造假实现** ✓）。判据：① 宿主路由返回快照（离线 fixture = 真 19 条 portproxy + 真 docker ps 样本），且**失败态**走 T5.4 既有分支；② 客户端拿到源 ⇒ 页面注册、拿不到 ⇒ 仍按 `ports-source-missing` 降级且不抛；③ 不新增依赖、`check:scope`/`check:size`/`check:exports` 三绿；④ 传输契约（路由前缀/形状/错误）回报给集成方写入 [`client-contract.md`](../../client-contract.md) 新增 §P9；⑤ 关键判据做一次变异自证。

---

## Phase 7：P1（P0 真机验收通过后再启）

- [ ] T7.1 [REQ-11.1][REQ-11.4] 容器启停 / 重启（用户可，Agent 拒绝）
  - 验证：`vitest` —— 用户来源调用 docker 写命令 1 次；agent 来源被拒且**未**调用命令

- [ ] T7.2 [REQ-11.2][REQ-11.3] 容器日志（`--tail` 有界）
  - 验证：`vitest` —— 默认 `--tail 200`；断言**无**落盘调用（无 `writeFile`）

- [ ] T7.3 [REQ-12.1][REQ-12.2][REQ-12.4] 完整配置页（**P1 只补 scope / elevationPolicy**）
  - 内容：`plugins.row.config` + `configure({ auto: false })`；字段 `scope`/`elevationPolicy`（**`managedPorts` 在 P0 的 T5.7、`distro` 在 P0 的 T5.8，均不在此重复** —— D-4 后同一字段**只允许一个写入口**）；**写经 settings 三写操作（live 路径）；不用 `configEditor.edit()`**（完整配置路径会重挂载）；在途提权任务时保存先确认
  - 验证：`vitest` + fake ctx —— 注册键正确、`auto:false` 生效；在途任务时弹确认且**未**写盘；`grep` 断言本包**无** YAML 手写

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
