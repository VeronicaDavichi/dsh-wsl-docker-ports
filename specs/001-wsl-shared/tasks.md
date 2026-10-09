# 实现任务：dsh-wsl-shared 共享底座

> 任务引用 [requirements.md](./requirements.md) 的 REQ-N；设计依据见 [design.md](./design.md)。
> 完成定义（每个任务）：代码 + **验证命令跑绿** + 无遗留副作用。
> 校验门（`.lean-spec/config.json`）：单文件 warn 200 行 / max 400 行；本包目标**代码**体积 ≤ **40KB**（**注释与空行不计入** —— 2026-10-08 主人拍板；**同日三次拍板把阈值 15KB → 25KB → 40KB**，末次原话「**40KB，再超了就是你的代码有问题或者 spec 拆分有问题**」⇒ 此后**不许再抬阈值**，告警先自证不是代码膨胀、也不是 Spec 拆分不当；由 `scripts/check-size.mjs` 复算，软指标只告警）。

---

## Phase 0：前置（阻塞后续所有解析任务）

- [x] T0.1 从真机捕获 fixture 并入库（脱敏）— ✅ **2026-10-08 完成**
  - 内容：`wsl -l -v` **原始字节**（不是截图/不是手抄）、`wsl -d Ubuntu2204 -- ip -4 -o addr show dev eth0`、`%USERPROFILE%\.wslconfig` 原文、`wsl --version`；存 `tests/contract/fixtures/`
  - ✅ **A-1 定案**：`wsl -l -v` = **UTF-16LE**（前 12 字节 `20 00 20 00 4E 00 41 00 4D 00 45 00`，NUL 占比 **50%**）⇒ 必须剥 BOM 与 NUL。⚠️ **行尾 2026-10-09 订正**：原记「LF（无 CRLF）」，实测是 **CRLF**（尾部 `32 00 0d 00 0a 00`，CR 2 / LF 2，**有尾换行**）—— 见 [Phase 6 完成记录](#-phase-6-完成记录2026-10-09-收口--1-个真缺陷)
  - ✅ **A-2 定案（比假设更细）**：`wsl -l -v` 表头**英文** `NAME STATE VERSION`，而同一 exe 的 `wsl --version` 是**中文**「WSL 版本」⇒ **同工具不同子命令本地化行为不一致** ⇒ 解析器**不得**依赖任何表头字面量（本实现靠「末列必须是 1 或 2」判数据行，表头自然被跳过）
  - ✅ **A-3 定案**：`netsh` 在本机是**纯 ASCII**（高位字节 0%）⇒ **不存在** OEM/GBK 中文表头问题（fixture 与判定在 003 侧，结论回写其 A-2）
  - ✅ 附带定案：`.wslconfig` 仅 `[wsl2] localhostForwarding=true` ⇒ **NAT 缺省**（组件②硬前提成立）；eth0 = `172.20.201.152`（与 19 条规则 connectaddress 一致 = **未漂移**）
  - 验证：`node --test "packages/wsl-shared/tests/**/*.test.ts"` → **5/5 通过**（含「解码不残留 NUL/BOM」「Ubuntu2204 + Stopped + version 2 + isDefault」与 3 条反例：UTF-8 不误判、名字含空格、脏输入抛 `WslParseError`）；fixture 内无凭据 ✅；溯源与字节指纹见 `packages/wsl-shared/tests/contract/fixtures/README.md`
  - 备注：本次冷启动实测 **12,827 ms**（发行版 Stopped 态），与既有 11.1 s / 12.5 s 同量级；发行版名 **`Ubuntu2204`**、WSL **2.7.3.0** 均与 `stack-decision.md` 一致

- [x] T0.2 确认包骨架与公开面预算 [REQ-6.2][REQ-6.4] — ✅ **2026-10-08 完成**
  - 内容：workspace 根（`pnpm-workspace.yaml` + `package.json` + `tsconfig.base.json`）与 `packages/wsl-shared/{package.json,tsconfig.json,src/,tests/,scripts/}`；`package.json` **不带** `cordis.patch.yml`、无 `dsh-plugin` 字段；`scripts/check-exports.mjs` 写死预算 **12**（**运行时口径** —— 类型导出另计，2026-10-08 主人拍板，见 REQ-6.4）
  - 验证：`pnpm -C packages/wsl-shared typecheck` **干净**（tsc **7.0.2**；`tsconfig.base.json` 必须显式 `types: ["node"]` —— TS 7 不再自动纳入 `@types`）；`check:exports` → **6/12 通过**（`decodeWslOutput, parseDistroList, WslParseError, WslDistro, WslDistroState, WslVersion`）

---

## Phase 1：错误模型与执行器（其余任务的地基）

- [x] T1.1 [REQ-5.6] 定义 `ErrorCode` 与 `WslSharedError` 判别联合 · ✅ **5 条**（11 个 code 一一对应；`fail()` 单一工厂；未提供的可选字段不出现在结果里）
  - 内容：`src/errors.ts`；工厂函数 `fail(code, message, extra)`；严禁 `throw` 裸 Error 出公开面
  - 验证：`vitest` 断言每个 code 都有工厂、`extra` 字段按 code 可选存在；`index.ts` 导出类型

- [x] T1.2 [REQ-5.1][REQ-5.2][REQ-5.5] `exec.ts` 基础执行路径 · ✅ **8 条** + 静态断言（`shell:true` / `exec(` 零命中）；错误里的 `argv` 是**完整命令行**（005 REQ-3.2 可直接展示"将执行的命令原文"）
  - 内容：`spawn` + `argv` 数组 + `stdio: 'pipe'` + `windowsHide`；Buffer 收集后按 `options.encoding` 解码；成功态组装
  - 验证：`vitest` + fake spawn —— 正常退出、退出码非 0、`ENOENT` → `CommandNotFound`；断言**未**出现任何 shell 字符串拼接（grep `exec(`、`shell: true` 为 0 命中）

- [x] T1.3 [REQ-5.4] `stderr` 非空但退出码 0 判成功 · ✅ **1 条**（stderr `ok:true` 且原样保留）
  - 验证：`vitest` 一例断言 `ok: true` 且 `stderr` 原样保留

- [x] T1.4 [REQ-5.3] 超时与进程终止 · ✅ **4 条**（**迟到 close 不覆盖结论**；拿不到 pid 时跳过 taskkill 但仍 `kill()`；真机 A/B 结论见下）
  - 内容：`timeoutMs` 必填；超时 → `child.kill()` + `taskkill /PID <pid> /T /F` 兜底 → 返回 `Timeout`
  - 验证：`vitest` + 一个必然超时的 fake（或 `wsl.exe --sleep`）断言错误码为 `Timeout` 且 `settled === true`（不挂起）
  - 待验证项：真机 `taskkill /T` 是否回收发行版侧进程 → 结论回写 design.md §4

- [x] T1.5 [REQ-6.3] 可注入执行器 · ✅ **1 条**（注入后 `('wsl.exe', ['-l','-v'], { encoding:'utf16le' })` 契约被满足、零真实进程）
  - 验证：`vitest` —— 用 fake 执行器注入 `distros`/`net` 后，全程无真实进程产生（断言 spawn 调用次数 = 0）

---

## Phase 2：发行版发现

- [x] T2.1 [REQ-1.2] `decode` 与 BOM/CRLF 容错 · ✅ **3 条**（**双向负例**：UTF-16LE 字节按 UTF-8 解 → 乱码/NUL；UTF-8 文本不被误判为 UTF-16LE）
  - 验证：`node --test` 用 T0.1 的真机字节 fixture 断言解码结果含 `Ubuntu2204`；另加 UTF-8 负例（证明按 UTF-16LE 解码会产生典型乱码 → 由 T0.1 结论定案是否调整）

- [x] T2.2 [REQ-1.1][REQ-1.3][REQ-1.4][REQ-1.6] `parseDistroTable` · ✅ **15 条**（无 VERSION 列 → `version:'unknown'`；两列表头 `NAME STATE` 不被当数据 —— 否则会凭空造出名为 `NAME` 的发行版；默认项置顶；中英文表头都被结构跳过）
  - 内容：行首 `*` 判默认、末列 `^[12]$` 判版本、中间拼回为名字；跳过表头与空行
  - 验证：`vitest` 覆盖 —— 含空格名（`Ubuntu 22.04`）、`*` 默认项、无 VERSION 列、纯表头、空输出（→ `[]` 且 `ok: true`）、`isDefault` 至多一个；**断言不依赖英文表头**（用中文表头 fixture 也应通过）

- [x] T2.3 [REQ-1.5][REQ-2.5] 失败路径 · ✅ **3 条**（`guardDistroExists` 命中/未命中/带可用名列表；`ENOENT → CommandNotFound` 与「退出码非 0 → `NonZeroExit`」由 `exec.ts` 承担，见 T1.2）
  - 验证：`vitest` —— `ENOENT` → `CommandNotFound`；退出码非 0 → `NonZeroExit`；`-d 不存在` → `DistroNotFound` 且 `distros` 列出可用名

- [x] T2.4 [REQ-1.7] 目标发行版解析（D-4） · ✅ **11 条**（四级优先级全过；空列表 `NoDistro`；静态断言无 spawn/fs；**成功态补 `ok: true`** 见 design §2）
  - 内容：`resolveDistro(distros, configured?) → { ok: true, name, source }`，四级优先级（① `configured` → ② `isDefault` → ③ 唯一 → ④ 首个）；**纯函数** —— 不读配置、不执行命令、**不提问**；结果**不持久化**（每次调用时解析）
  - 验证：`vitest` —— ① 只有 1 个发行版 → `source='onlyOne'` 且**未**要求任何交互；② 存在 `*` 且无配置 → `wslDefault`；③ 配置存在 → `config` 且**优先于** `*`；④ 无配置 + 多个 + 无 `*` → `first`；⑤ 空列表 → typed error（SHALL NOT 返回空名）；⑥ 断言实现内**无** `wsl --set-default`（纯函数即证明无 spawn）

---

### ✅ Phase 1–3 完成记录（2026-10-08）— 共 **198 条**测试全绿（单测 187 + 契约 11；**Phase 5 后为 236 条 = 220 + 16**）

> Phase 4（路径翻译）的专属证据已拆至 [006](../006-path-translation/tasks.md)；此处只留**跨阶段**教训与包级门禁。

> 门禁（**Phase 5 落地后复算**）：`typecheck` **exit 0** · `vitest` **220/220**（7 文件）· `node --test` 契约 **16/16** · `check:exports` **运行时 8/12**（类型 17 ⇒ 合计 **25 = 软阈值**，不告警）· `check:size` **去注释 25,859 / 40,960 字节**（余 **15,101**；原始 58.7 KB，注释+空行占 57%）。

- 🐛 **T1.4 顺带修掉一个真缺陷（本阶段最有价值的发现）**：定时器原在挂事件处理器**之后**赋值 ⇒ 子进程若在注册阶段**同步** close，`finish()` 里的 `timer` 仍是 `undefined`，定时器永不清除、把事件循环拖到超时才退出（症状：契约层总耗时 **20,958ms**）。修法 = 定时器**先建**再挂事件 + `unref()` ⇒ 契约层 **129ms**（**160×**），并补了回归用例（design §8-7）。
- ✅ **T1.4 结案（A/B 对照）**：A 臂只 `child.kill()`、B 臂默认（kill + `taskkill /PID /T /F`），两臂超时后发行版内 `sleep` **都被回收**（每臂先 control 确认它在跑、事后清理残留）⇒ `taskkill /T` 是**保险**而非必需，**降级方案不需要启用**；局限：只测了单层直接子进程（design §8-12）。
- ⚠️ **口径修正（留痕）**：T0.1 期间我把「一个都解析不出来」判为抛 `WslParseError`；**REQ-1.6 定案为「命令成功但无发行版 → `[]` 且成功」** ⇒ 解析层**不再抛异常**，`WslParseError` 从公开面退役（Phase 0 的占位类）。「命令失败」由 `exec.ts` 的 `CommandNotFound`/`NonZeroExit` 承担 —— 两种事实不混。
- **真机复验**：真 `wsl.exe` 经 `listDistros(createExecutor())` → **115ms**、`Ubuntu2204 / Stopped / 2 / isDefault`；`resolveDistro` 四条路径（默认/配置/错名/空表）全对；**发行版仍为 `Stopped`（未被唤醒）**。副证：原文是 UTF-16LE 夹 NUL ⇒ PowerShell 直接 `Select-String Ubuntu2204` **匹配不到**，解码器不可省。

### 🔍 复审补强

57 条测试当时**全绿**却审出 **8 个真缺陷**（我上一条汇报里说成 7 个 —— 数错了，如实更正）：全部落在我"预设的输入分布"之外 ⇒ 说明那 57 条是**意图覆盖**，不是**边界覆盖**。8 处已全修 + 各补回归用例（单测 50 → **63**）。

| # | 缺陷（会错的情况） | 修法 |
|---|---|---|
| E1 | `void killTree(...)` 吞不掉**注入实现**的 rejection ⇒ unhandled rejection 在 Node 默认**崩宿主进程** | `void killTree(...).catch(() => undefined)` |
| E2 | `timeoutMs` 无校验：`setTimeout` 对 > 2³¹-1 的延时只警告并**按 1ms** 处理（`Infinity`/`NaN`/0/负数同理）⇒ **假超时**且文案写「命令在 Infinityms 内未结束」 | 入口校验 `0 < t ≤ 2147483647`，越界启动前 `Unexpected` 且**零 spawn** |
| E3 | Windows 上 **cwd 不存在**时 spawn 报的同样是 `ENOENT` ⇒ 报「找不到命令：wsl.exe」，而它明明存在（002 的 `cwd` 字段必踩） | 设了 `cwd` 时文案改为「找不到命令**或工作目录**：…（cwd=…）」 |
| E4 | 被外部终止时 `code === null` ⇒ 报「命令以退出码 **null** 结束」，而 003 的 UI 原样显示 | 单独文案「命令被外部终止（无退出码）」，`exitCode` 仍记 `-1` |
| D1 | `split(/\s+/)` 再 `join(' ')` **压缩名字里的连续空格**（`Ubuntu  22.04` → `Ubuntu 22.04`）⇒ 拿去 `-d <name>` **找不到发行版** | 改锚定正则 `^(?<name>.+?)\s+(?<state>\S+)\s+(?<version>[12])$` **原样捕获**（回溯保证末组锚定行尾）；代码同时变短 |
| D2 | 剥 `[*+]` 会把**以 `+` 开头**的名字削掉首字符（WSL 只用 `*`） | 只剥 `*` |
| R1 | 空列表 + 有配置 → 报 `DistroNotFound`（候选 `[]`）⇒ 把排查方向引到**配置**，而根因是**没装发行版** | 空集判定提到配置判定**之前** → `NoDistro` |
| R2 | `configured?.trim()` 在配置被写坏（非字符串）时抛 `TypeError` ⇒ **破坏"公开面不抛异常"硬契约**，且炸在 002 的回调里 | `typeof configured === 'string'` 守卫，非字符串按"未配置"回落 |

只写文档、不改代码的两条（已进 design §4/§8）：`env` 是**整份替换**（合并是调用方责任）；stdout/stderr **无大小上限**（本包命令有界故不加选项，将来接 docker 日志必须先限流）。**保留的设计确认**（不是缺陷）：优先级**不看 `state`**（Stopped 的默认项照样胜出 ⇒ UI 走 003 REQ-6.4「启动并核验」）；名字只作 **argv 元素**下发（`shell:false` ⇒ 无注入面）。
- 🔁 **属性化不变量固化成常驻用例**（先例见 [006](../006-path-translation/tasks.md)：1500+1500 次往返 + 2000×3 垃圾串，固定种子 ⇒ 可复算）—— 后续阶段沿用此法。

### ✅ Phase 3 完成记录（eth0 探测，2026-10-08）

- 新增 `src/net.ts`（124 行 / 1.8 KB 代码）+ `src/distro-exec.ts`（120 行 / 2.0 KB 代码，T3.4 通用件）：`parseEth0Address` + `probeEth0` + `execInDistro`；单测 **36 条**（net 21 + distro-exec 15）+ 契约 **4 条**。
- 🔴 **真机事实（编码分叉 —— 本阶段最重要的发现）**：`wsl.exe -d X -- ip -4 -o addr show dev eth0` 是 **UTF-8**（NUL **0.0%**、LF），而 `wsl -l -v` 是 **UTF-16LE** ⇒ 同一个 `wsl.exe`：**自带消息** UTF-16LE、**透传 Linux 子进程字节** UTF-8。猜错即**假阴性**（`inet 172.…` 解成乱码 ⇒ 误报「eth0 没有 IPv4」）⇒ 两条路都留了反例，模块内写死 `utf8` 不再猜。
- **成本实测 + fixture**：冷启动（Stopped → 命令返回）**12,637ms**；热路径 **192 / 218 / 237ms** ⇒ 默认超时 10s（40× 余量）、显式启动路径 30s。`ip-eth0.raw`（**118 字节**，blob `154d0f72`，`-text` 生效）解析出 `172.20.201.152` ✅ 与 19 条规则 connectaddress 一致；真机副作用（唤醒发行版 + 拉起用户容器）**已由主人预批**并如实报告。
- 🐛 **本轮自审发现**：① `check-size.mjs` 的**判定与告警用四舍五入后的 KB** ⇒ 15,318 与 15,360 都显示「15.0 KB」、小超限显示「超出 0.0 KB」⇒ 读不出真实余量（已改为**按字节**判定 + 打印余量/超出）；② `net.ts` 状态守卫有 **TOCTOU 窗口**（`listDistros` 快照与 `wsl -d` 之间发行版可能被空闲回收 ⇒ 静默冷启动）⇒ 记入 design §8 第 11 条，不加心跳（影响有界，缓解=紧接状态读取后探测）；③ **我自己的流程缺陷**：用 PowerShell 内联 `node -e "…$1…"` 复核体积时 `$1` 被 PS 展开成空 ⇒ 算出 15,384、**误判"超 24 字节"** ⇒ 数值复核**一律写临时文件跑**（真值 15,318）。

### ✅ 口径已定案（2026-10-08 主人拍板；不阻塞已完成项）

1. ~~**导出预算计不计类型？**~~ → ✅ **2026-10-08 主人拍板：类型不计入**（「那 10 个名词不算在 12 样里面」）⇒ **REQ-6.4 已订正**为「运行时导出 ≤ 12；类型导出单独统计并打印，软阈值 20」，`design.md` / `tasks.md` T0.2·T6.1 / 自检脚本注释 / README 冻结决策速览已同步。**Phase 3 后：运行时 5/12、类型 13（合计 18）；Phase 4 后：7/12、类型 15（合计 22）⇒ ✅ 2026-10-08 主人二次拍板：类型软阈值 20 → 25（留痕见 REQ-6.4）**。
2. ~~**`源码 ≤ 15KB` 软指标怎么算？**~~ → ✅ **2026-10-08 主人拍板：注释与空行不计入** —— 统计「**去注释、去空行后的 UTF-8 字节数**」（软指标，超限只告警；**单文件 ≤ 400 行**是 NFR-5 的 SHALL ⇒ 超限失败，且行数按**原始**行数算，与体积指标故意不同）。已落 `packages/wsl-shared/scripts/check-size.mjs` + 根/包 `check:size` 脚本。
   - **预算值变更（2026-10-08 主人三次拍板）：15 KB → 25 KB → 40 KB**。第一次理由：Phase 3 后实测 **15,318/15,360 字节（余 42 字节）**，而本包还要落 Phase 4（pathmap）+ Phase 5（`.wslconfig`/NAT）+ 消费方复用的通用执行件（T3.4）⇒ 15 KB 是**「当初只有 3 个模块」时定的**，必然被超。第二次（Phase 4 自审后，21,615/25,600 ⇒ 余 3,985）主人直接抬到 **40 KB** 并定调：**「40KB，再超了就是你的代码有问题或者 spec 拆分有问题」** ⇒ 40 KB 是**宽裕到没有借口的额度**，此后告警必须**先自证不是代码膨胀、也不是 Spec 拆分不当**，不许再来抬阈值。选择"提高软指标并留痕"而不是"删防御分支/拆包"（后者伤可读性与 L3 布局）。**复算口径与判定逻辑不变，只换阈值**。
   - ⚠️ **同时修掉一个判定缺陷**：`check-size.mjs` 原先把判定与告警建立在**四舍五入后的 KB** 上 ⇒ 15,318 与 15,360 都显示「15.0 KB」、小超限显示「超出 0.0 KB」（读不出真实余量）⇒ 已改为**按字节**判定并打印「余/超 N 字节」。**历史实算（同一口径）**：Phase 1+2 = 12.4 KB（原始 25.1 KB，注释+空行 51%）→ Phase 1–3 = **15,318 字节**（原始 32.2 KB，53%）→ 换阈值后（含 T3.4）= **16,831** → **Phase 4 = 20,975 → （自审修复后）21,615 / 40,960 字节，余 19,345**。**注**：复审补强只加约 **0.6 KB 代码**、却加约 **3.5 KB 注释与证据** —— 按"原始体积"看会以为涨了 16%，这正是注释不计入的意义。

---

## Phase 3：eth0 探测

- [x] T3.1 [REQ-2.1][REQ-2.2] 解析 `ip -4 -o addr` 输出
  - ✅ 单测 **5 条** + 契约 **2 条**：真机 fixture 断言 `172.20.201.152`；多地址取首个（非数组/非拼接）；UTF-8 字节输入；**反例**（同批字节按 UTF-16LE 解 → 解析失败）；CRLF

- [x] T3.2 [REQ-2.3] eth0 缺失/无 IPv4 → `NoInterface`
  - ✅ 单测 **9 条**：五个负例（空输出 / 只有 `inet6` / `lo` 输出 / `0.0.0.0` / 只有 `brd` 段）+ 前导零与越界 + `0.0.0.0` 跳过后仍取到真地址 + 探测层 `lo` → `NoInterface` 且 message 不含 `127.0.0.1` + **退出码非 0 原样透传** `NonZeroExit`（不吞成 `NoInterface`）

- [x] T3.3 [REQ-2.4] Stopped 发行版冷启动守卫
  - 内容：先查 `distros`（存在性 → 状态）；非 Running → `DistroNotRunning`，**不执行** `wsl -d`
  - ✅ 单测 **6 条** + 错误透传 1 条：Stopped/Installing → `DistroNotRunning` 且**零调用**；错名 → `DistroNotFound` 带列表且零调用；`allowColdStart`（REQ-2.4 唯一例外）→ 允许执行且用冷启动超时；Running → argv/编码/超时正确且用**权威名字**；`Timeout` 原样透传

- [x] T3.4 [REQ-6.1][REQ-2.4] 抽出通用「带守卫的发行版内执行」`execInDistro`（**2026-10-08 主人拍板新增**）
  - 内容：**存在性 → 状态 → 执行（+ 编码声明）**收在 `src/distro-exec.ts` **一处**；`probeEth0` 改为复用它；003 读层（`docker ps` 等）直接复用 ⇒ 守卫**不分叉**
  - 准入依据（REQ-6.1：能力需 ≥2 个消费方）：① eth0 探测（本包）② 003 读层
  - ✅ 单测 **15 条**：空 argv 拒绝且零调用（防 `wsl -d X --` 空命令变成交互式 shell —— 既挂住又唤醒发行版）；错名零调用；**五种**非 Running 状态全拦且零调用；Running → stdout/stderr 透传 + **权威名字** + 完整 argv；默认 `utf8` + 热路径超时；显式 `utf16le`；`allowColdStart` → 冷启动超时；三种底层错误（`NonZeroExit`/`Timeout`/`CommandNotFound`）原样透传
  - 结构防线：`probeEth0` **不透传** `encoding` ⇒ eth0 路径恒 `utf8`，谁也没法把它改坏

---

## Phase 4：路径翻译 → ✅ 已迁至 [006-path-translation](../006-path-translation/tasks.md)

> T4.1–T4.4（87 条单测的逐条证据）与「Phase 4 完成记录」于 **2026-10-09 原样迁入** 006，**编号不变**（T4.x / REQ-3.x，保代码与测试里 20+ 处追溯引用）。代码仍在 `packages/wsl-shared/src/pathmap.ts`（**同包不拆包**），`index.ts` 照旧导出 `winToWsl` / `wslToWin`。

---

## Phase 5：`.wslconfig` 与 networkingMode

- [x] T5.1 [REQ-4.2][REQ-4.3][REQ-4.5] INI 子集解析 + 缺省
  - ✅ 契约 **5 条**（`node --test`）：**真机 fixture 字节指纹**（32 字节 / 无 BOM / 无 NUL / 单处 CRLF / **无尾换行**）+ 缺键 ⇒ `default/nat` 且 `rawValue` 键**不出现**；负例两条（改成 `mirrored` ⇒ `non-nat`；`NAT` 大写 ⇒ `other` 且 `rawValue='NAT'`）
  - ✅ 单测 **11 条**：BOM、`#`/`;` 整行与行内注释、键值空白、CRLF 与**单 `\r`**、`[WSL2]` 大写、无关节忽略（**关键负例**：`[experimental] networkingMode=mirrored` 不得影响判定）、全局区键忽略、重复键最后一个胜出、`[wsl2] x` 不算节、未闭合 `[wsl2`、空值 ⇒ `other`、`"nat"` ⇒ `other`
  - 📌 **口径差异（留痕）**：原文写「`node --test` 用**本机真实** `.wslconfig`」—— 真读用户文件会让测试**随用户改配置而红/绿**，故契约层只吃 **fixture 字节**（就是当日真机原文），真机读取改由**探针实测**（结论见下）

- [x] T5.2 [REQ-4.1][REQ-4.4] 判定表全表
  - ✅ 单测 **9 条**（8 行表驱动 + 1 条保守性总断言）：文件不存在（`ENOENT`）/ 缺键 / `nat` / `mirrored` / `bridged` / `natx` / `NAT` / `virtioproxy` 逐条断言 `mode` + `resolved` + `rawValue`；总断言钉死「除 nat/default 外**任何**值都不得 `resolved:'nat'`」

- [x] T5.3 [REQ-4.6][REQ-4.7] 读不到 ≠ 缺省 NAT
  - ✅ 单测 **7 条**：`EACCES`/`EISDIR`/`EPERM`/未知 errno fake → `ConfigUnreadable` 带完整路径，失败态**不伪造** `mode`/`resolved`/`rawValue`；裸字符串抛掷也兜住；**errno 文案只出现一次**（真机实测抓到的缺陷）；只读性静态断言 + 依赖面枚举（`node:fs/promises`/`node:os`/`node:path`/`./errors.ts`）
  - 📌 **`rawValue` 口径澄清**：它在**成功态**且**只在真有该键时**出现（缺键/`ENOENT` ⇒ 字段不存在）；失败态本就没有 `rawValue` —— 原文「错误带 `rawValue`」按此落地

### ✅ Phase 5 完成记录（2026-10-08）— 真机实证 + 1 个真缺陷

- 🐛 **真机抓到真缺陷**：错误文案里 errno **出现两次**（`EISDIR: EISDIR: illegal operation on a directory, read`）—— Node 的 `error.message` **自带**前缀，我又加了一遍；这段文案会被 003 **原样显示** ⇒ 改为先判重再加（回归用例 + 真机复验：出现次数 = 1）。
- 🔴 **「先测再写」又救一次**：`USERPROFILE=''` 时 `??` **不回落**、`path.join('', '.wslconfig')` 是**相对路径** ⇒ 会读**工作目录**下的同名文件（静默错答）；且实测该情形下 `os.homedir()` **自己抛** `ERR_SYSTEM_ERROR` ⇒ 改 `?.trim() ||` + try/catch + **绝对路径校验**三道防线，各配一条用例。
- ✅ **真机实证（只读）**：`readNetworkingMode()` → `{ ok:true, path:'C:\\Users\\EDY\\.wslconfig', mode:'default', resolved:'nat' }`；真 `EISDIR` → `ConfigUnreadable` 带完整路径；真 `ENOENT` → `default/nat`（**不是**错误）；`USERPROFILE=''` → `ConfigUnreadable` 且**无 path**（未回落相对路径）。探针在 `%TEMP%`、**不入库**。
- 📌 **守阈值的取舍（留痕）**：类型 15 → 19 ⇒ 合计 27 **超类型软阈值 25**。**没有第三次抬阈值**（主人对体积已定调「再超就是代码或 Spec 拆分有问题」），而是把 `NetworkingModeKind`/`NetworkingModeResolution` 两个**别名留在模块内**（消费者写 `mode.mode === 'mirrored'` 或 `NetworkingMode['mode']` 即可）⇒ 运行时 8 + 类型 17 = **25，刚好不告警**。

---

## Phase 6：收口 — ✅ **已完成（2026-10-09）**，逐项证据见下 + 完成记录

- [x] T6.1 [REQ-6.4] 公开面收缩 · ✅ 运行时 **8/12**、类型 **17**（合计 **25 = 软阈值**，不告警）。**逐个复核消费方**：`createExecutor`（003/005 跑 netsh/docker）、`listDistros`（002 校验发行版名 / 003 目标解析）、`resolveDistro`（003 D-4）、`execInDistro`（003 读层）、`probeEth0`（003 REQ-6）、`winToWsl`/`wslToWin`（002/004）、`readNetworkingMode`（003 硬前提）—— **无一是投机导出**。**主动不导出**（连同理由，供复核）：`isWslFailure`（消费方用字面判别式 `.ok` 即可收窄，导出等于给公开面加一个**零新能力**的名字；包内与测试仍用）、`parseEth0Address`/`guardDistroExists`/`parseDistroTable`（内部件，已被 `probeEth0`/`execInDistro` 包装）、`DistroExecResult`/`ExecOutcome`/`Eth0ProbeOptions`/`SpawnLike`/`TreeKillLike`/`FailureExtra`、三个超时常量（调用方按需传 `timeoutMs`）。**第三次也没抬阈值**。历史：Phase 4 = 运行时 7/12 + 类型 15（曾报 ⚠️「22 > 20」，**未静默放过**，由主人拍板把类型软阈值提到 **25**）；Phase 5 = 8/12 + 17（把两个模式别名留在模块内守住阈值）。

- [x] T6.2 [REQ-6.1] 准入标准回归（防杂物袋）· ✅ **`scripts/check-scope.mjs`** 落地（根 `pnpm check:scope` 已接线）。**定稿判据 = 逐词条 + 文件级白名单**：`netsh`/`portproxy`（003）、`docker`（003）、`RunAs`/`gsudo`/`Start-Process`（005）**任何源文件都不得出现**；**`taskkill` 仅允许 `exec.ts`**。⚠️ **原判据是第二道坏门**：「剥注释后 `taskkill /PID` 命中 0」**跑不过** —— `exec.ts:113` 的 `treeKill('taskkill', ['/PID',…])` 是 **REQ-5.3 的进程树兜底杀**，属 001 自己（不是 005 的提权），禁掉它等于要求放弃「超时必杀干净」；**两道坏门的修订史已写进脚本头部**。**四道防呆**（正控必须被命中 / 注释里的词必须不命中 / `keepLines` 保行号 / 源文件非空）+ **实测负控**（植入越界文件 → **exit 1** 且报出 `__scope-probe.ts:1`，随后清理、无残留）。副产：抽出 **`scripts/strip-comments.mjs`** 供体积门共用（体积口径**逐字节不变 25,859**）。**范围收窄（2026-10-09 主人裁定）**：初版曾额外加「非插件包形态（REQ-6.2）+ 零运行时依赖（NFR-1）」两条断言，**已删除** —— 脚本严格对齐本任务的字面判据，不让「门的口径」与「Spec 任务口径」悄悄分叉；那两条需求回归**人工复核**。
  - 🧪 **2026-10-09 集成方「门自己也会红」端到端变异自证（不是只看代码，而是改真源码再跑门；每次还原后 SHA256 逐字节相同）**：
    - **check:scope ①**：把 `export const zzProbe = 'portproxy';` 追加进 **`distros.ts`** ⇒ **exit 1**，且报 **`distros.ts:264 [netsh / portproxy 解析]`**（**行号准确** ⇒ 防呆③在真源文件上也成立）。
    - **check:scope ②（白名单是文件级的，不是一刀切）**：`taskkill` 写进 **`distros.ts`** ⇒ **exit 1**（并打印「仅允许 exec.ts」）；同一行写进 **`exec.ts`** ⇒ **exit 0** ✓。
    - **check:exports**：临时加 5 个运行时导出（8 → **13 > 12**）⇒ **exit 1** 并逐个列出 13 个名字（**预算硬门**）。
    - **check:size 的软/硬边界（本轮新增的精度结论）**：追加 ~19KB **超长行**（越 40KB 但不越 400 行）⇒ **exit 0 + ⚠ 软指标超限告警**（46937 / 40960，超 5977 字节）；追加 200 行**普通**代码（越 400 行）⇒ **exit 1**（`NFR-5 单文件 > 400 行：distros.ts（463 行）`）。⇒ **逐字坐实** AGENTS.md 的口径：**字节预算是软指标（告警不拦）、单文件 400 行是 SHALL（硬拦）**。
    - 基线复算（同一轮内）：`check:scope` 越界 0 · `check:exports` 运行时 8/12 + 类型 17 = 25 · `check:size` 25859/40960 —— 与 T6.3 记录一致。

- [x] T6.3 [NFR-1][NFR-2][NFR-3][NFR-5] 质量门 · ✅ **六道全绿**：`typecheck` **exit 0** · `vitest` **220/220**（7 文件）· 契约 **17/17** · `check:exports` **运行时 8/12 + 类型 17 = 25** · `check:size` **25,859 / 40,960 字节（余 15,101）** · `check:scope` **越界 0**（范围收窄后 = REQ-6.1 越界词表）。另**人工复核**两项：`package.json` 的 `dependencies` 为空（NFR-1 零运行时依赖）、无 `cordis.patch.yml` 且无 `dsh` 字段（REQ-6.2 非插件包形态）；单文件最高 **262 行**（NFR-5 限 400）。

- [x] T6.4 把结论回写文档 · ✅ **A-1/A-2/A-3 早在 Phase 0/2/3 已落地**（本轮逐条复核确认，无需再动）；**本轮新增 1 处订正**：**A-1 的「行尾 LF」实为 CRLF**（探针抓出，**无功能缺陷**）⇒ 订正 **8 处** + 新增字节事实契约用例。`A-6`（「缺省即 NAT」）**已由主人 2026-10-09 定案为 ✅ 已确认**（原为假设 ⇒ 本轮关闭）。

### ✅ Phase 6 完成记录（2026-10-09）— 收口 + 1 个真缺陷（由探针抓出）

- **新增/改动**：`scripts/check-scope.mjs`（第六道门）· `scripts/strip-comments.mjs`（双门共用）· `scripts/probe.mjs`（真机探针）· `tests/contract/distros.test.ts`（+1 字节事实用例）· 两个 `package.json`（`check:scope` / `probe` 接线）。
- 🔴 **探针抓到的真缺陷（本轮最有价值的发现）**：A-1 的「`wsl -l -v` 行尾 **LF**（无 CRLF）」**是错的** —— fixture 尾部即 `32 00 0d 00 0a 00`（**CRLF**，CR 2 / LF 2，**有尾换行**），三次实时捕获 **3/3** 一致。**无功能缺陷**（REQ-1.2 明写 SHALL 容忍 CRLF；实现是 `split(/\r?\n/)` + 逐行 `trim()`），但**契约层原本没钉行尾** ⇒ 这条错事实**无人能拦**。**根因**：把同批捕获的 `ip-eth0.raw`（那个**确实**是 LF，`net.test.ts` 用 `includes(0x0d) === false` 钉着）的性质误写到了发行版表上。**教训：同一阶段捕获的多个 fixture，性质必须逐个用字节断言钉住**，不能靠「同批所以同性质」。
- **订正 8 处**（全部带日期与证据，不静默改写）：本 Spec 的 `requirements.md` A-1 · `tasks.md` T0.1 · `design.md` §8-1 · `README.md` · `tests/contract/fixtures/README.md`（+「订正留痕」小节）· **SSoT `stack-decision.md`**（第 401 行口径 + Phase 0 历史记录加指向 + 追加 2026-10-09 变更记录）· `AGENTS.md` 真机事实表；并把该事实**钉成可复算断言**（契约 **16 → 17**）。
- **真机探针实测（只读、零副作用，主人预批「不唤醒」）**：`wsl -l -v` **152 字节 / NUL 50% / 无 BOM / CRLF** ⇒ UTF-16LE ✓ 与 A-1 一致 · `listDistros` **117ms** → `* Ubuntu2204 Stopped v2` · `resolveDistro`（不传配置）→ 来源 **`wslDefault`**（**未阻塞提问**，符合 D-4）· `readNetworkingMode` → `C:\Users\EDY\.wslconfig` / `mode=default` / **`resolved=nat`**（组件② 硬前提**在本机成立**）· `probeEth0` → **`DistroNotRunning`**（Stopped 时**不执行** `wsl -d`）· **副作用断言 `Stopped → Stopped`** ⇒ **REQ-2.4「自动路径绝不唤醒」真机成立**。
- **探针顺带修掉自己的显示缺陷**：管道里 ANSI ESC 被渲染成 `[32m` 噪声 ⇒ 改为仅 `isTTY` 上色（`pnpm -C packages/wsl-shared probe | tee` 现在可读）。⚠️ **2026-10-09 命令精度订正**：原文把该命令写成**不带 `-C packages/wsl-shared` 的裸形态** —— 而 `probe` 脚本**只声明在 `packages/wsl-shared`**、根上**没有** ⇒ 照原文在仓库根执行会报 `Command not found`（本行由集成期的「门禁脚本引用对账」扫出，属**文档精度**问题、非门禁缺陷）
- **A-6 已由主人定案关闭（2026-10-09）**：探针的 `mode=default ⇒ resolved=nat` 只算**本机佐证**（Win11 23H2 / WSL 2.7.3.0），本不足以证明「恒为 NAT」；**主人明确背书「default 就是 NAT」** ⇒ A-6 由「假设」转 **✅ 已确认**。**保守面一字未改**（非 `nat` / 读不到一律不判 `nat`），「规则通不通」仍留 003 的转发自检兜底。
- **无遗留副作用**：越界负控文件已清理（`git status` 无残留）；探针与一次性脚本**不入库**（沿用 Phase 5 先例）。

---

## 真机验收

| 层 | 是否适用 | 说明 |
|---|---|---|
| vitest 单元 | ✅ | 纯函数与执行器（fake）|
| `node:test` 离线契约 | ✅ | 真机 fixture 驱动 |
| chrome-devtools MCP 真机 | ❌ **不适用** | 本包**无 UI**；真机层由 002（终端页）与 003（docker/端口页）承担 |
| 人工目视 | ✅（轻量）| **`scripts/probe.mjs` 已落地并真机跑过**（`pnpm -C packages/wsl-shared probe`，2026-10-09）：打印 5 项事实（`wsl -l -v` 字节指纹 / `listDistros` / `resolveDistro` / `readNetworkingMode` / `probeEth0`）+ **副作用断言**（探测前后状态必须不变，Stopped 被唤醒即 `exit 1`）—— 当次结论见「Phase 6 完成记录」。**只读、不唤醒**（Stopped 时守卫直接返回 `DistroNotRunning`）；探针**不入库**（沿用 Phase 5 先例）|
| 真机探测（只读 + 写入） | ✅ **Phase 2/3 已做** | 2026-10-08：真 `wsl.exe` → `listDistros` **115ms**、`Ubuntu2204 / Stopped / 2 / isDefault`、`resolveDistro` 四条路径全对且**未唤醒**；`wsl -d Ubuntu2204 -- ip …` 冷启动 **12,637ms** / 热 **192–237ms**、输出 **UTF-8**（NUL 0%）；`taskkill /T` A/B 对照（结论见 design §8 第 12 条）。探针在 `%TEMP%`，**不入库**（fixture 除外） |
