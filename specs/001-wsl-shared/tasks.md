# 实现任务：dsh-wsl-shared 共享底座

> 任务引用 [requirements.md](./requirements.md) 的 REQ-N；设计依据见 [design.md](./design.md)。
> 完成定义（每个任务）：代码 + **验证命令跑绿** + 无遗留副作用。
> 校验门（`.lean-spec/config.json`）：单文件 warn 200 行 / max 400 行；本包目标**代码**体积 ≤ 15KB（**注释与空行不计入** —— 2026-10-08 主人拍板，由 `scripts/check-size.mjs` 复算，软指标只告警）。

---

## Phase 0：前置（阻塞后续所有解析任务）

- [x] T0.1 从真机捕获 fixture 并入库（脱敏）— ✅ **2026-10-08 完成**
  - 内容：`wsl -l -v` **原始字节**（不是截图/不是手抄）、`wsl -d Ubuntu2204 -- ip -4 -o addr show dev eth0`、`%USERPROFILE%\.wslconfig` 原文、`wsl --version`；存 `tests/contract/fixtures/`
  - ✅ **A-1 定案**：`wsl -l -v` = **UTF-16LE**（前 12 字节 `20 00 20 00 4E 00 41 00 4D 00 45 00`，NUL 占比 **50%**），行尾 **LF**（无 CRLF）⇒ 必须剥 BOM 与 NUL
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

- [x] T1.1 [REQ-5.6] 定义 `ErrorCode` 与 `WslSharedError` 判别联合
  - 内容：`src/errors.ts`；工厂函数 `fail(code, message, extra)`；严禁 `throw` 裸 Error 出公开面
  - 验证：`vitest` 断言每个 code 都有工厂、`extra` 字段按 code 可选存在；`index.ts` 导出类型

- [x] T1.2 [REQ-5.1][REQ-5.2][REQ-5.5] `exec.ts` 基础执行路径
  - 内容：`spawn` + `argv` 数组 + `stdio: 'pipe'` + `windowsHide`；Buffer 收集后按 `options.encoding` 解码；成功态组装
  - 验证：`vitest` + fake spawn —— 正常退出、退出码非 0、`ENOENT` → `CommandNotFound`；断言**未**出现任何 shell 字符串拼接（grep `exec(`、`shell: true` 为 0 命中）

- [x] T1.3 [REQ-5.4] `stderr` 非空但退出码 0 判成功
  - 验证：`vitest` 一例断言 `ok: true` 且 `stderr` 原样保留

- [x] T1.4 [REQ-5.3] 超时与进程终止
  - 内容：`timeoutMs` 必填；超时 → `child.kill()` + `taskkill /PID <pid> /T /F` 兜底 → 返回 `Timeout`
  - 验证：`vitest` + 一个必然超时的 fake（或 `wsl.exe --sleep`）断言错误码为 `Timeout` 且 `settled === true`（不挂起）
  - 待验证项：真机 `taskkill /T` 是否回收发行版侧进程 → 结论回写 design.md §4

- [x] T1.5 [REQ-6.3] 可注入执行器
  - 验证：`vitest` —— 用 fake 执行器注入 `distros`/`net` 后，全程无真实进程产生（断言 spawn 调用次数 = 0）

---

## Phase 2：发行版发现

- [x] T2.1 [REQ-1.2] `decode` 与 BOM/CRLF 容错
  - 验证：`node --test` 用 T0.1 的真机字节 fixture 断言解码结果含 `Ubuntu2204`；另加 UTF-8 负例（证明按 UTF-16LE 解码会产生典型乱码 → 由 T0.1 结论定案是否调整）

- [x] T2.2 [REQ-1.1][REQ-1.3][REQ-1.4][REQ-1.6] `parseDistroTable`
  - 内容：行首 `*` 判默认、末列 `^[12]$` 判版本、中间拼回为名字；跳过表头与空行
  - 验证：`vitest` 覆盖 —— 含空格名（`Ubuntu 22.04`）、`*` 默认项、无 VERSION 列、纯表头、空输出（→ `[]` 且 `ok: true`）、`isDefault` 至多一个；**断言不依赖英文表头**（用中文表头 fixture 也应通过）

- [x] T2.3 [REQ-1.5][REQ-2.5] 失败路径
  - 验证：`vitest` —— `ENOENT` → `CommandNotFound`；退出码非 0 → `NonZeroExit`；`-d 不存在` → `DistroNotFound` 且 `distros` 列出可用名

- [x] T2.4 [REQ-1.7] 目标发行版解析（D-4）
  - 内容：`resolveDistro(distros, configured?) → { name, source }`，四级优先级（① `configured` → ② `isDefault` → ③ 唯一 → ④ 首个）；**纯函数** —— 不读配置、不执行命令、**不提问**；结果**不持久化**（每次调用时解析）
  - 验证：`vitest` —— ① 只有 1 个发行版 → `source='onlyOne'` 且**未**要求任何交互；② 存在 `*` 且无配置 → `wslDefault`；③ 配置存在 → `config` 且**优先于** `*`；④ 无配置 + 多个 + 无 `*` → `first`；⑤ 空列表 → typed error（SHALL NOT 返回空名）；⑥ 断言实现内**无** `wsl --set-default`（纯函数即证明无 spawn）

---

### ✅ Phase 1–3 完成记录（2026-10-08）— 共 **95 条**测试全绿（单测 84 + 契约 11）

> 门禁（Phase 3 后）：`typecheck` **exit 0** · `vitest` **84/84**（4 文件）· `node --test` 契约 **11/11** · `check:exports` **运行时 4/12**（类型 11）· `check:size` **去注释 15,318 / 15,360 字节**（原始 32.7 KB，注释+空行占 53%）⇒ **余 42 字节**。

- **T1.1** `src/errors.ts`：`ErrorCode` **11 个**（含为 REQ-1.7 空列表路径新增的 **`NoDistro`**；design §2 的表已同步加行）；`WslSharedError` 是 `ok:false` 的**返回值**（不是异常），与 `ExecResult` 构成判别联合；`fail()` 单一工厂，**未提供的可选字段不出现在结果里**（不伪造 `undefined`）；`ERROR_CODES`/`ERROR_HINTS` 与 code 一一对应；`isWslFailure()` 守卫留模块内（消费者用 `if (!r.ok)`）。验证 `tests/unit/errors.test.ts` **5 条**。
- **T1.2** `src/exec.ts`：`argv` 数组 + `stdio:'pipe'` + `windowsHide:true` + **`shell:false`**；Buffer 收集后按声明编码解码；**解码器在启动命令之前解析** ⇒ 非法编码标签返回 `Unexpected` 且**完全不启动进程**；错误里的 `argv` 是**完整命令行**（含 exe ⇒ 005 REQ-3.2 可直接展示「将执行的命令原文」）。验证 **9 条** + 静态断言（`shell:true` / `exec(` 零命中）。
- **T1.3** stderr 非空 + 退出码 0 → `ok:true` 且 stderr **原样保留**（1 条）。
- **T1.4** 超时 → 先 `kill()`，有 pid 时再 `taskkill /PID <pid> /T /F` → `Timeout`；**迟到 close 不覆盖结论**；拿不到 pid 时跳过 taskkill 但仍 `kill()`。
  - 🐛 **顺带修掉一个真缺陷（本次最有价值的发现）**：定时器原在挂事件处理器**之后**赋值 ⇒ 子进程若在注册阶段**同步** close，`finish()` 里的 `timer` 仍是 `undefined`，定时器永不清除、把事件循环拖到超时才退出（症状：契约层总耗时 **20,958ms**）。修法 = 定时器**先建**再挂事件 + `unref()` ⇒ 契约层 **129ms**（**160×**），并补了回归用例。
  - ⏳ ~~**待验证项（保留）**：真机 `taskkill /T` 能否回收 `wsl.exe` 拉起的**发行版侧**进程~~ → ✅ **2026-10-08 Phase 3 结案（A/B 对照）**：A 臂只 `child.kill()`、B 臂默认（kill + `taskkill /PID /T /F`），两臂超时后发行版内 `sleep` **都被回收**（每臂先 control 确认它在跑、事后清理残留）⇒ `taskkill /T` 是**保险**而非必需，**降级方案不需要启用**；局限：只测了单层直接子进程（详见 design §8 第 12 条）。
- **T1.5** `createExecutor(spawnImpl, treeKillImpl)` 双注入点（第二个只给测试）；fake 执行器注入 `listDistros` → 只走注入件，且 `('wsl.exe', ['-l','-v'], { encoding:'utf16le' })` 契约被满足。
- **T2.1** 解码按**字节指纹**兜底（BOM 或 NUL > 25%）；**双向负例**：UTF-16LE 字节按 UTF-8 解 → 乱码/NUL；UTF-8 文本不被误判为 UTF-16LE。
- **T2.2** `parseDistroTable`：`*` 判默认（**至多一个**）、末列 `^[12]$` 判版本、中间拼回为名字；**无 VERSION 列的两列数据行 → `version:'unknown'`**；**两列表头 `NAME STATE` 不被当数据**（末列必须是**已知状态词**才认两列行 —— 否则会凭空造出名为 `NAME` 的发行版）；默认项置顶；中文/英文表头都被结构跳过。另记一条**已知局限**：两列 + **本地化状态词** 的行会被跳过（宁可漏，不可编）。
  - ⚠️ **口径修正（留痕）**：T0.1 期间我把「一个都解析不出来」判为抛 `WslParseError`；**REQ-1.6（T2.2）定案为「命令成功但无发行版 → `[]` 且成功」** ⇒ 解析层**不再抛异常**，`WslParseError` 从公开面退役（Phase 0 的占位类）。「命令失败」由 `exec.ts` 的 `CommandNotFound`/`NonZeroExit` 承担 —— 两种事实不混。
- **T2.3** `ENOENT → CommandNotFound`；退出码非 0 → `NonZeroExit`（带 `exitCode`/`stderr`/`argv`）；新增 `guardDistroExists(name, distros)` → `DistroNotFound` 且错误里带**可用发行版名列表**（供 Phase 3 与写路径在拼 `-d` 之前调用）。
- **T2.4** `resolveDistro(distros, configured?) → { name, source }`：四级优先级 + `source`；**纯函数**（不读配置、不执行命令、不提问、不持久化）；**配置了但没装 → `DistroNotFound`**（不静默换一个）；空列表 → `NoDistro`（SHALL NOT 返回空名）；静态断言（**剥注释后**源码无 `set-default`、无 `node:` 依赖即无 spawn/无 fs）。
- **真机复验**：真 `wsl.exe` 经 `listDistros(createExecutor())` → **115ms**、`Ubuntu2204 / Stopped / 2 / isDefault`；`resolveDistro` 四条路径（默认/配置/错名/空表）全对；**发行版仍为 `Stopped`（未被唤醒）**。副证：原文是 UTF-16LE 夹 NUL ⇒ PowerShell 直接 `Select-String Ubuntu2204` **匹配不到**，解码器不可省。

### 🔍 复审补强（2026-10-08，主人要求逐处自审 →「改，都得改」）

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

只写文档、不改代码的两条（已进 design §4/§8）：`env` 是**整份替换**（合并是调用方责任）；stdout/stderr **无大小上限**（本包命令有界故不加选项，将来接 docker 日志必须先限流）。
**保留的设计确认**（不是缺陷）：优先级**不看 `state`**（Stopped 的默认项照样胜出 ⇒ UI 走 003 REQ-6.4「启动并核验」）；名字只作 **argv 元素**下发（`shell:false` ⇒ 无注入面）。

### ✅ Phase 3 完成记录（eth0 探测，2026-10-08）

- 新增 `src/net.ts`（138 行 / 2.5 KB 代码）：`parseEth0Address` + `probeEth0`；单测 **21 条** + 契约 **4 条**。
- 🔴 **真机事实（编码分叉 —— 本阶段最重要的发现）**：`wsl.exe -d X -- ip -4 -o addr show dev eth0` 是 **UTF-8**（NUL **0.0%**、LF），而 `wsl -l -v` 是 **UTF-16LE** ⇒ 同一个 `wsl.exe`：**自带消息** UTF-16LE、**透传 Linux 子进程字节** UTF-8。猜错即**假阴性**（`inet 172.…` 解成乱码 ⇒ 误报「eth0 没有 IPv4」）⇒ 两条路都留了反例，模块内写死 `utf8` 不再猜。
- **成本实测**：冷启动（Stopped → 命令返回）**12,637ms**；热路径 **192 / 218 / 237ms** ⇒ 默认超时 10s（40× 余量）、显式启动路径 30s。
- **fixture**：`tests/contract/fixtures/ip-eth0.raw`（**118 字节**，blob `154d0f72`；`.gitattributes` 的 `-text` 生效），解析值 `172.20.201.152` ✅ 与 19 条规则 connectaddress 一致。真机副作用（唤醒发行版 + 拉起用户容器）**已由主人预批**，事后如实报告。
- 🐛 **本轮自审发现**：① `check-size.mjs` 的**判定与告警用四舍五入后的 KB** ⇒ 15,318 与 15,360 都显示「15.0 KB」、小超限显示「超出 0.0 KB」⇒ 读不出真实余量（已改为**按字节**判定 + 打印余量/超出）；② `net.ts` 状态守卫有 **TOCTOU 窗口**（`listDistros` 快照与 `wsl -d` 之间发行版可能被空闲回收 ⇒ 静默冷启动）⇒ 记入 design §8 第 11 条，不加心跳（影响有界，缓解=紧接状态读取后探测）；③ **我自己的流程缺陷**：用 PowerShell 内联 `node -e "…$1…"` 复核体积时 `$1` 被 PS 展开成空 ⇒ 算出 15,384、**误判"超 24 字节"** ⇒ 数值复核**一律写临时文件跑**（真值 15,318）。

### ✅ 口径已定案（2026-10-08 主人拍板；不阻塞已完成项）

> 两条均已由主人拍板，口径写死如下；将来复算按同一口径，不再各自解释。

1. ~~**导出预算计不计类型？**~~ → ✅ **2026-10-08 主人拍板：类型不计入**（「那 10 个名词不算在 12 样里面」）⇒ **REQ-6.4 已订正**为「运行时导出 ≤ 12；类型导出单独统计并打印，软阈值 20」，`design.md` / `tasks.md` T0.2·T6.1 / 自检脚本注释 / README 冻结决策速览已同步。当前实测：**运行时 3/12**，类型 10（合计 13）。
2. ~~**`源码 ≤ 15KB` 软指标怎么算？**~~ → ✅ **2026-10-08 主人拍板：注释与空行不计入** —— 统计「**去注释、去空行后的 UTF-8 字节数 ≤ 15 KiB**」（软指标，超限只告警；**单文件 ≤ 400 行**是 NFR-5 的 SHALL ⇒ 超限失败，且行数按**原始**行数算，与体积指标故意不同）。已落 `packages/wsl-shared/scripts/check-size.mjs` + 根/包 `check:size` 脚本。**Phase 1+2 实算：去注释 12.4 KB / 15 KB**（原始 25.1 KB，注释+空行占 **51%**）⇒ **达标，余量 2.6 KB**；Phase 3–5 还会涨，到时按同一口径复算。**注**：本阶段复审补强只加了约 **0.6 KB 代码**、却加了约 **3.5 KB 注释与证据** —— 若按"原始体积"看会以为涨了 16%，这正是注释不计入的意义。

---

## Phase 3：eth0 探测

- [x] T3.1 [REQ-2.1][REQ-2.2] 解析 `ip -4 -o addr` 输出
  - ✅ 单测 **5 条** + 契约 **2 条**：真机 fixture 断言 `172.20.201.152`；多地址取首个（非数组/非拼接）；UTF-8 字节输入；**反例**（同批字节按 UTF-16LE 解 → 解析失败）；CRLF

- [x] T3.2 [REQ-2.3] eth0 缺失/无 IPv4 → `NoInterface`
  - ✅ 单测 **9 条**：五个负例（空输出 / 只有 `inet6` / `lo` 输出 / `0.0.0.0` / 只有 `brd` 段）+ 前导零与越界 + `0.0.0.0` 跳过后仍取到真地址 + 探测层 `lo` → `NoInterface` 且 message 不含 `127.0.0.1` + **退出码非 0 原样透传** `NonZeroExit`（不吞成 `NoInterface`）

- [x] T3.3 [REQ-2.4] Stopped 发行版冷启动守卫
  - 内容：先查 `distros`（存在性 → 状态）；非 Running → `DistroNotRunning`，**不执行** `wsl -d`
  - ✅ 单测 **6 条** + 错误透传 1 条：Stopped/Installing → `DistroNotRunning` 且**零调用**；错名 → `DistroNotFound` 带列表且零调用；`allowColdStart`（REQ-2.4 唯一例外）→ 允许执行且用冷启动超时；Running → argv/编码/超时正确且用**权威名字**；`Timeout` 原样透传

---

## Phase 4：路径翻译

- [ ] T4.1 [REQ-3.1][REQ-3.2] 盘符双向翻译
  - 内容：`winToWsl` / `wslToWin`；盘符小写、分隔符归一、重复分隔符折叠
  - 验证：`vitest` 表格驱动 —— `E:\x\y`、`e:/x/y`、`E:x`、带空格与中文路径、末尾反斜杠

- [ ] T4.2 [REQ-3.3] UNC 双向（`\\wsl.localhost\` 与 `\\wsl$\`）
  - 验证：`vitest` 两种前缀 → `/home/u`；大小写不敏感前缀；发行版名含空格

- [ ] T4.3 [REQ-3.4] 无盘符 Linux 路径的策略
  - 验证：`vitest` —— 无发行版名 → `NoWindowsEquivalent`；有发行版名 → `\\wsl.localhost\<distro>\home\u`；断言**未**猜盘符（无 `C:\` 兜底）

- [ ] T4.4 [REQ-3.5][REQ-3.6][REQ-3.7] 非法输入与纯函数性
  - 验证：`vitest` —— 空串/相对路径/`\\server\share`/含 `<>:"｜?*` 全部 `UnmappablePath`；断言输出**不含**引号；断言函数内无 `fs` 调用（用 fake 或静态 grep 断言零 `node:fs` 引用）

---

## Phase 5：`.wslconfig` 与 networkingMode

- [ ] T5.1 [REQ-4.2][REQ-4.3][REQ-4.5] INI 子集解析 + 缺省
  - 验证：`node --test` 用**本机真实 `.wslconfig`**（仅 `[wsl2] localhostForwarding=true`）断言 `{ mode:'default', resolved:'nat' }`；另测 BOM、`#`/`;` 注释、行内注释、键值空白、CRLF、`[WSL2]` 大写节、无关节忽略

- [ ] T5.2 [REQ-4.1][REQ-4.4] 判定表全表
  - 验证：`vitest` 表格驱动 —— 文件不存在 / 缺键 / `nat` / `mirrored` / `bridged` / 拼写错误 / 未来新值，逐条断言 `mode` 与 `resolved`；断言未知值**不**被判为 nat

- [ ] T5.3 [REQ-4.6][REQ-4.7] 读不到 ≠ 缺省 NAT
  - 验证：`vitest` —— `EACCES`/`EISDIR` fake → `ConfigUnreadable` 且带完整路径与 `rawValue`（缺省时 `rawValue` 为 `undefined` 且不得伪造）；断言错误**未**被转成 `default`
  - 验证（只读性）：断言本包对 `.wslconfig` **无写调用**（grep `writeFile` / `appendFile` 命中 0）

---

## Phase 6：收口

- [ ] T6.1 [REQ-6.4] 公开面收缩
  - 内容：`src/index.ts` 只导出消费方真正需要的符号与类型
  - 验证：自检脚本断言**运行时**导出数 ≤ 12（类型导出单独打印，超软阈值 20 需说明，见 REQ-6.4 的订正留痕）；`grep -n "export" src/index.ts` 人工复核一遍

- [ ] T6.2 [REQ-6.1] 准入标准回归（防杂物袋）
  - 验证：`grep -ri "netsh\|portproxy\|docker\|RunAs\|taskkill /PID" src/` 的命中**只允许**出现在 `exec.ts` 的兜底注释里；出现 netsh/docker 解析即判失败（应留 003）

- [ ] T6.3 [NFR-1][NFR-2][NFR-3][NFR-5] 质量门
  - 验证：`pnpm -C packages/wsl-shared typecheck` + `test`（vitest）+ `test:contract`（node --test）三项全绿，并记录用例数；`package.json` 的 `dependencies` 为空（零运行时依赖）；`check:size`（去注释代码 ≤ 15KB 软指标 + 单文件 ≤ 400 行 NFR-5）

- [ ] T6.4 把结论回写文档
  - 内容：T0.1 的编码/表头结论、T1.4 的 `taskkill` 结论 → 更新 design.md §4/§8 与 requirements 的 A-1/A-2/A-3 状态（假设 → 已确认/已推翻）
  - 验证：`grep -n "A-1\|A-2\|A-3" specs/001-wsl-shared/*.md` 能看到结论落地；`leanspec validate` 无新增告警

---

## 真机验收

| 层 | 是否适用 | 说明 |
|---|---|---|
| vitest 单元 | ✅ | 纯函数与执行器（fake）|
| `node:test` 离线契约 | ✅ | 真机 fixture 驱动 |
| chrome-devtools MCP 真机 | ❌ **不适用** | 本包**无 UI**；真机层由 002（终端页）与 003（docker/端口页）承担 |
| 人工目视 | ✅（轻量）| `scripts/probe.mjs` 在真机打印 5 项事实，与 `.wslconfig` / `wsl -l -v` 人工输出的肉眼比对 —— ⏳ **尚未创建**（5 项事实跨 Phase 3–5，与 T3.x/T5.x 一起落） |
| 真机只读探测 | ✅ **Phase 2 已做** | 2026-10-08：真 `wsl.exe` → `listDistros` **115ms**、`Ubuntu2204 / Stopped / 2 / isDefault`；`resolveDistro` 四条路径全对；**未唤醒发行版**（仍 `Stopped`）。临时探针在 `%TEMP%`，**不入库** |
| 真机写入探测 | ✅ **Phase 3 已做** | 2026-10-08：`wsl -d Ubuntu2204 -- ip …` 冷启动 **12,637ms** / 热 **192–237ms**、输出 **UTF-8**（NUL 0%）；`taskkill /T` 的 A/B 对照（结论见 design §8 第 12 条）；探针脚本在 `%TEMP%`，**不入库**（fixture 除外） |
