---
status: complete
created: 2026-10-08
priority: high
tags:
- wsl
- shared-lib
- base
- dsh-plugin
created_at: 2026-10-08T09:42:12.335682700Z
updated_at: 2026-10-09T01:55:09.491309800Z
completed_at: 2026-10-09T01:55:09.491309800Z
transitions:
- status: planned
  at: 2026-10-08T13:22:41.226365600Z
- status: in-progress
  at: 2026-10-08T13:25:44.483516200Z
- status: complete
  at: 2026-10-09T01:55:09.491309800Z
---
# 共享底座：WSL 发行版发现 · eth0 IP · NAT 判定（路径翻译 → 006）

**类型**: 需求驱动（requirements-first）
**状态**: **complete**（2026-10-09 收口 —— Phase 0–6 全部完成，**22/22 任务**勾完；六道门全绿：`typecheck` / `vitest` **220** / 契约 **17** / `check:exports` **8/12 + 类型 17** / `check:size` **25,859 / 40,960 字节** / `check:scope` **越界 0**。Phase 1–2 于 2026-10-08 实现并全绿，B-1 / B-2 均已定案）
**优先级**: high
**包名**: `dsh-wsl-shared` —— **非插件包**（无 cordis 行、无 UI、无配置页、无 PTY）
**位置**: `packages/wsl-shared/`

---

## 概述

组件②（`dsh-wsl-docker-ports`）要按 `netsh portproxy` 逻辑把 WSL 里 docker 暴露的端口转发到 Windows，组件①（`dsh-terminal-profiles`）要在 WSL 视角下用 Linux 路径启动终端。两件事都需要同一批「问 WSL 要事实」的能力：

1. 机器上有哪几个发行版、默认是哪个、跑没跑（`wsl -l -v`）
2. NAT 模式下 WSL 的 eth0 地址是多少（portproxy 的 `connectaddress`）
3. Windows 路径与 WSL 路径怎么互转（`E:\x` ↔ `/mnt/e/x`）→ ✅ **2026-10-09 拆为 [006-path-translation](../006-path-translation/README.md)**（代码仍在本包 `src/pathmap.ts`，Spec 与验收边界独立成篇）
4. 当前是 NAT 还是 mirrored（**NAT 是组件②的硬前提**）
5. 一个统一的「跑命令 + 拿结构化结果」封装，不让每个包各写一份 `spawn`

本 Spec 把五件事收进**一个非插件共享包**。它自己不注册任何东西 —— 没有 slot、没有模型工具、没有 HTTP 路由、没有 PTY。

    packages/wsl-shared            ← 本 Spec（非插件：无行、无 UI、无配置页）
        ▲                    ▲
        │ 依赖               │ 依赖
    packages/terminal-profiles   packages/wsl-docker-ports
    （组件①，002）                （组件②，003）

---

## 为什么单独成包

handover 已拍板「三包 —— 两个插件包 + 一个非插件共享包」，本 Spec 是第三包。**准入标准是硬的**：只有 **≥2 个消费者**都需要的能力才进这里。

| 能力 | 消费者 | 归属 |
|---|---|---|
| 发行版发现 | 2（① 校验发行版名与 `cwdLinux`；② 定 portproxy 目标）| ✅ 本包 |
| 路径翻译 | 2（① 生成 `cwdLinux`；② 错误文案与日志可读）| ✅ 本包（**Spec 已拆为 [006](../006-path-translation/README.md)**，模块与包不变）|
| networkingMode 判定 | 2（② 硬前提；① 网络异常提示）| ✅ 本包 |
| 结构化命令执行封装 | 2 | ✅ 本包 |
| eth0 IPv4 探测 | **1**（只有 ② 需要）| ⚠️ 例外，见下 |
| `netsh portproxy` 解析 | 1 | ❌ 留 003 |
| UAC 提权辅助进程 | 1 | ❌ 留 003 |
| `docker ps` 解析 | 1 | ❌ 留 003 |

> **eth0 例外如实记录**：它只有一个消费者，但 handover 的 Spec A 范围明确列了它，且它与发行版发现**共用同一条「进发行版执行一条命令」的链路**（同一套编码、超时、错误语义）。拆出去等于让 003 再写一遍命令封装。因此保留在本包，并在 [requirements.md](./requirements.md) 的 REQ-6.1 里把这条例外写死 —— 不假装它满足「两个消费者」标准。

---

## 功能说明

### 四张解析表 + 一个执行器

| 模块 | 输入 | 输出 | 关键难点 |
|---|---|---|---|
| `distros` | `wsl.exe -l -v` 的原始字节 | `WslDistro[]` | 输出为 **UTF-16LE**；表头可能**本地化**；发行版名可含空格 |
| `net` | 在发行版内跑 `ip -4 -o addr show dev eth0` | IPv4 字符串 | 多地址取 primary；eth0 缺失必须报错而非回落 |
| `pathmap`（**属 [006](../006-path-translation/design.md)**）| 路径字符串（+ 可选发行版名）| 对侧路径 | `/mnt/<盘>` 与 `\\wsl.localhost\<distro>\…` 双向；无盘符路径**不许猜**（无发行版名 ⇒ `NoWindowsEquivalent`）；非法字符检查**先于**形态判定；纯字符串变换，不碰 FS |
| `wslconfig` | `%USERPROFILE%\.wslconfig` | `{ raw, resolved }` | 「文件不存在」= 缺省 NAT；「读不到」= **错误**，不许混为一谈 |
| `exec` | `argv[]` + 选项 | `{ exitCode, stdout, stderr }` | argv 传参（无 shell）、超时杀进程树、编码由调用方指定 |

### 判定表（networkingMode）

| 文件 | `[wsl2] networkingMode` | `raw` | `resolved` | 组件② 行为 |
|---|---|---|---|---|
| 不存在 | — | `default` | `nat` | 可用（缺省即 NAT）|
| 存在 | 缺键 | `default` | `nat` | 可用 |
| 存在 | `nat` | `nat` | `nat` | 可用 |
| 存在 | `mirrored` / `bridged` | `mirrored` / `other` | 非 `nat` | **置灰 + 原因 + 修复步骤**（REQ-4.4）|
| 存在 | 未来新值 / 拼写异常 | `other` | 非 `nat` | 同上（**保守**：不假定 NAT）|
| **读不到**（权限/IO）| — | — | — | **错误**，② 显示原因；**不得**当成缺省 NAT |

---

## 文档导航

| 文档 | 内容 |
|------|------|
| [requirements.md](./requirements.md) | REQ-1/2/4/5/6 与 EARS 验收标准、NFR、约束与假设（**REQ-3 为空位 → [006](../006-path-translation/requirements.md)**）|
| [design.md](./design.md) | 架构与依赖方向、模块划分、类型契约、四张解析表、执行器与错误模型、测试策略、决策权衡 |
| [tasks.md](./tasks.md) | 按阶段拆分的任务、验证方法与完成定义 |

---

## 冻结决策速览

| 决策点 | 结论 | 理由摘要 |
|---|---|---|
| 包形态 | **非插件包**，无 `cordis.patch.yml` | handover 拍板；进本包的只有纯逻辑，没有生命周期要管 |
| 依赖方向 | 002 / 003 → 001，**单向**；001 只依赖 `node:` 内置 | 避免循环依赖；001 无宿主能力需求，可离线单测 |
| 执行器 | `spawn` + **argv 数组**，绝不拼 shell 字符串 | 注入面最小；路径含空格/中文不需要引号游戏 |
| 公开面预算 | **运行时**导出 ≤ 12；**类型导出不计入**（单独统计并打印，类型总量**软阈值 25**）| 类型编译后被完全擦除、不进 bundle，本条约束的是**可调用面**；**2026-10-08 主人拍板**（同日二次拍板软阈值 20 → 25），REQ-6.4 已订正留痕 |
| 逐包导出预算（**2026-10-12 扩展**）| `wsl-shared` **12 / 25** · `terminal-profiles` **31 / 45（存量欠账，非认可值）** · `wsl-docker-ports` **12 / 25**；**棘轮 = 只许降不许升**（改上限必须同时改机器表 + REQ-6.4 文档表 + 追加 changelog 留痕）| SSoT = [`packages/wsl-shared/scripts/export-budgets.mjs`](../../packages/wsl-shared/scripts/export-budgets.mjs)；三个门共用一份解析实现（`packages/wsl-shared/scripts/lib/export-surface.mjs`），扫描改**递归**（`exports` 全部声明入口），口径痕与欠账收敛方向见 [REQ-6.4](./requirements.md) |
| 编码 | 由调用方显式指定，**不猜** | `wsl.exe` 实测 UTF-16LE；`netsh` 实测**纯 ASCII**（原「OEM 代码页」假设已推翻，003 A-2 同步订正）—— 猜错就是乱码解析 |
| eth0 探测 | 失败**报错**，不回落 `127.0.0.1` / 空串 | 静默回落会让 portproxy 规则指向错误地址（handover 里的「坑 #4」）|
| 发行版 Stopped | 探测时**报 `DistroNotRunning`**，不静默冷启动 | 跑 `wsl -d X -- cmd` 会启动该发行版，属用户未预期的副作用 |
| 配置容错 | 解析**不抛裸异常**：脏输入按各自 REQ 收敛（发行版表「无数据行」→ `[]` 且成功，REQ-1.6；`.wslconfig`「读不到」→ typed error，REQ-4.6）| 上层要能把原因显示给用户，且「装好了但一个都没有」与「命令失败」不得混为一谈 |
| 测试双层 | vitest（纯函数）+ `node:test`（真机 fixture 契约）| handover 拍板的验收手段；本包无 UI，故**不适用** chrome-devtools 真机层 |

---

## 硬规则偏离说明

| 硬规则 | 状态 | 说明 |
|--------|------|------|
| 读 `.lean-spec/templates/requirements-template.md` 生成文档 | ⚠️ **偏离** | 本环境模板库只有 `leanspec init` 生成的 `spec-template.md`；结构按 `leanspec-propose` 技能正文 + 兄弟项目 `dsh-leanspec` 实测的四文件约定（README / requirements / design / tasks）生成 |
| `docs/` 全量扫描并提炼摘要 | ⚠️ **N/A** | 本仓库无 `docs/`；requirements.md 第 0 节显式标注「（空）」并列出替代真相来源（`stack-decision.md`）|
| UI 需求必须配 E2E | ⚠️ **N/A** | 本包**无 UI**。全局替代口径见 [002 的偏离说明](../002-terminal-profiles/README.md)：vitest + `node:test` 离线契约 + chrome-devtools MCP 真机验收（handover 明确否决 Playwright + `harness/verify-e2e.sh`）|
| 原型资产归档 / 视觉对照 | ⚠️ **N/A** | 无原型输入 |
| 复核制两阶段提交 | ⚠️ **N/A** | 无审批 / 复核语义 |
| 交互控件登记 | ⚠️ **N/A** | 无页面、无控件 |

---

## 阻塞项（进实现前必须打掉）

| # | 阻塞项 | 归属 | 状态 |
|---|---|---|---|
| ~~B-1~~ | ~~`z.array(...).volatile()` 在数组路径上是否生效~~ | **002**（本 Spec 不受阻）| ✅ **2026-10-08 五条全部定案**（真机 + 离线各两条，含 live 写入 152ms 生效、**不重挂载**）；见 [002/tasks.md](../002-terminal-profiles/tasks.md) 的 T0.1。⚠️ **2026-10-09 订正**：本行原写「🟡 机制已定案，剩真机行为链」—— 与本仓 SSoT 矛盾（真机实验当日已跑完），属结论已出、摘要未同步的**指令残留** |
| ~~B-2~~ | ~~6 项 `backend.*` 的 `confirmed: implied` 待主人逐条点头~~ | 全线 | ✅ **2026-10-08 已确认全为 `none`，本项清除**（结论不影响本包 —— 本包不注册后端能力）|

**本 Spec 自身的开工前置**（T0.1）**已于 2026-10-08 完成**：真机 fixture 已入库（`packages/wsl-shared/tests/contract/fixtures/`，字节级溯源见该目录 README），**编码与表头形态已实测定案** —— `wsl -l -v` = **UTF-16LE + 行尾 CRLF + 英文表头**（而 `wsl --version` 是中文表头）⇒ 解析器不依赖任何表头字面量。详见 [tasks.md](./tasks.md) 的 T0.1。⚠️ **2026-10-09 订正**：行尾原记为「LF（无 CRLF）」，实测是 **CRLF**（**无功能缺陷** —— 解析层本就容忍；已由字节断言钉死）。

## 下一步

1. 主人复核本 Spec（重点：REQ-2.4 的「Stopped 不静默冷启动」、REQ-4.6 的「读不到 ≠ 缺省 NAT」两条保守取舍）。
2. ~~打掉 **B-1** 后把 Spec 转 `planned`，再进 `/leanspec-apply`~~ → ✅ **2026-10-08 已完成**：B-1 五条全部定案，五份 Spec（当时）全部 `planned`。**本 Spec 已 `in-progress`**。
3. ✅ **Phase 0 / 1 / 2 / 3 已完成**（真机 fixture + 错误模型 + 执行器 + 发行版发现 + eth0 探测 + 通用发行版执行件；`typecheck` / `vitest` **99** / `node --test` **11** / `check:exports` **运行时 5/12** / `check:size` **去注释 16,831 字节** 五道门全绿，真机复验 **115ms**，eth0 冷启动 **12,637ms** / 热 **192–237ms**）。证据见 [tasks.md](./tasks.md) 的「Phase 1–4 完成记录」；**三条口径均已由主人拍板**（导出预算只计运行时；体积按去注释、去空行计；**同日三次拍板把体积阈值 15KB → 25KB → 40KB**，末次定调「再超就是代码或 Spec 拆分有问题」），**三轮自审共 14 项**（11 个真缺陷 —— 8 个 + Phase 4 的 3 个〔随 006 迁出〕，3 项工具/文档缺陷；另有 1 个"疑似项"被实测推翻，见「复审补强」「Phase 3 完成记录」与 **006 的 Phase 4 完成记录**）。
4. ✅ **Phase 3 已完成**（T3.1–T3.4 + fixture `ip-eth0.raw`）。**关键收获**：① `wsl -d X -- ip …` 的输出是 **UTF-8**，与 `wsl -l -v` 的 **UTF-16LE** 不同 —— 猜错就是「eth0 没有 IPv4」的假阴性；② **T1.4 结案**：A/B 实测只杀 `wsl.exe` 也能回收发行版侧进程，`taskkill /T` 是保险而非必需；③ **T3.4**：守卫与执行抽成 `execInDistro` 单份实现，003 读层直接复用（避免 REQ-2.4 被重犯）。
5. ✅ **Phase 4 已拆出为 [006-path-translation](../006-path-translation/README.md)**（2026-10-09）：`src/pathmap.ts` **206 行 / 4.5 KB 代码** + **87 条**单测仍在**本包**交付，但**需求 / 设计 / 任务与验收边界**整体迁到 006（**编号保持** REQ-3.x / T4.x，保代码与测试里 20+ 处追溯引用）。四条关键收获（① 先测再写抓到 `node:path` 四条咬人语义；② 自审 3 个真缺陷；③ 被实测**推翻**的「疑似缺陷」；④ 属性化不变量固化成常驻用例）见 006 的 `tasks.md`。
6. ✅ **Phase 5 已完成**（T5.1–T5.3，`src/wslconfig.ts`；`vitest` **220** / 契约 **16** / `check:exports` **运行时 8/12**（类型 17 ⇒ 合计 **25 = 阈值**，不告警）/ `check:size` **25,859 / 40,960 字节（余 15,101）**）。**关键收获**：① 真机实测 `%USERPROFILE%\.wslconfig` = **32 字节、无 BOM、CRLF、无尾换行**，缺键 ⇒ **NAT 缺省**，组件②的硬前提**成立** ✅；② **「先测再写」又救一次** —— `USERPROFILE=''` 时 `??` 不回落，而 `path.join('', '.wslconfig')` 是**相对路径**（会去读**工作目录**下的同名文件 = 静默错答），且该情形下 `os.homedir()` **自己会抛** `ERR_SYSTEM_ERROR` ⇒ 补三道防线（`?.trim() ||` + try/catch + 绝对路径校验）各配用例；③ 真机抓到文案缺陷：errno **重复两次**（`EISDIR: EISDIR: …`，会被 003 **原样显示**）⇒ 已修 + 回归 + 复验；④ 类型数 15→19 会破软阈值 ⇒ **没抬阈值**，把两个模式别名留在模块内。
7. ✅ **Phase 6 收口已完成**（2026-10-09）—— 详见 [tasks.md](./tasks.md) 的 Phase 6 完成记录。要点：**T6.2 的判据修了第二道坏门**（原判据要求剥注释后 `taskkill /PID` 命中 0，但 `exec.ts` 的 REQ-5.3 进程树兜底**就是**真的 `taskkill`）⇒ 改为「逐词条 + 文件级白名单」；**探针 `scripts/probe.mjs` 抓到 1 个文档真缺陷**（A-1 的「行尾 LF」实为 **CRLF**，**无功能缺陷**，已订正 8 处并钉成字节断言）。**真正的约束回到「单文件 ≤ 400 行 + 文档 ≤ 200 行」**（体积余 **15.1 KB**）。

8. ✅ **2026-10-12 跨 Spec 欠账已补：`NonZeroExit` 的失败对象带上 `stdout` 原文**（005 真机挖掘、主人裁定「现在补」；**005 的 out 文件兜底保留不变** ⇒ 向后兼容）。**根因 = 两者都有**：`src/errors.ts` 的 `WslSharedError`（旧 :59–:71）与 `FailureExtra`（旧 :74–:80）**都不声明 `stdout`**，而 `fail()`（`errors.ts:87`）是**白名单式条件展开**（`...(extra.X === undefined ? {} : { X })`）⇒ 调用点 `src/exec.ts:227`（旧行号）的 `fail('NonZeroExit', …, { argv, exitCode, stderr })` 漏传的那一份 `stdout` **在结果里连字段都不出现**；而 `stdout` 在 `exec.ts:213` **已解码且同一作用域可得** ⇒ **不是「值已被丢弃」**，无需去更早处保留。**真机证据（只读；离线轮之外，未由本轮复跑）**：`C:\Users\EDY\dsh-probe-artifacts\20261012-152929-elevfix\X1-executor-stdout.{mjs,txt}`（**生产** `createExecutor` + `Write-Output 'PAYLOAD…'; exit 3`）⇒ `keys=[ok,code,message,argv,exitCode,stderr]`、`hasStdoutField:false`、`stdout:null`、`code:'NonZeroExit'`。**修法（最小面：2 文件 2 处 + 一行）**：`errors.ts` 两个接口各加**可选** `stdout?: string` + `fail()` 加一行同构条件展开；`exec.ts` 非零退出分支改传 `{ argv: command, exitCode: code ?? -1, stdout, stderr }`。**向后兼容的三条依据**：① 成功路径 `{ ok: true, exitCode: 0, stdout, stderr }` **一字未动**（有专门用例钉字段集）；② 新字段**可选**，未提供时**字段缺席**（没进程的启动前失败**不得**伪造空串）⇒ 002/003/008 的既有读取零影响；③ 005 的 `failureStdout()`（`wsl-docker-ports/src/elevate/runner.ts:125`，本就按可选字段防御式取值）与 **out 文件回落**（同文件 :288）**保留**，001 补了字段后它们只是**更少被用到**、行为只会更好。**回归门 + 3 个变异哨兵**（改**真源码**当场跑红，随后**逐字节还原**，SHA256 前后一致）：`tests/unit/exec.test.ts` 新增 T7.1 **4 条**（非零退出带 `stdout` 原文 + 字段集**不多不少** = 真机 keys + `stdout`；零输出时**字段仍在且为空串**；**成功路径字段集逐字未变**；启动前失败**不带** `stdout`）· `tests/unit/errors.test.ts` 补 2 处（空串算「有值」；未提供则字段缺席）⇒ `vitest` **220 → 224**（7 文件）；哨兵原文摘要：旧调用形态 ⇒ `expected undefined to be 'PAYLOAD-151B'`（exit 1）；旧工厂（去掉 stdout 白名单）⇒ `expected undefined to be '{"payload":"PAYLOAD"}'`（exit 1）；成功态回归（去掉 `stderr`）⇒ `expected [ 'exitCode', 'ok', 'stdout' ] to deeply equal [ Array(4) ]`（exit 1）。**同一族字段核对**：`argv` 各路径一致（含可执行文件）；`exitCode` 非零退出仍 `code ?? -1`；`stderr` 非零退出仍带。⚠️ **`Timeout` 路径仍只带 `argv`**（超时时 `outChunks`/`errChunks` 已有部分数据）⇒ **同族的另一条路径、本轮未动**，见下条。**顺带被自己的门拦下一次**：新增用例把 `exec.test.ts` 顶到 **433 行 > 400**（NFR-5 SHALL；`check-size.mjs` 的 2026-10-12 扩面已把 `tests/**` 纳入）⇒ 抽出台架 `tests/unit/exec-rig.ts`（72 行），用例**一条不删、一条不改名**，`exec.test.ts` 回到 **376 行**。
9. ⏳ **待办（本轮明确未做，等裁定；不擅自扩范围）**：① `design.md` 的类型表行与 `requirements.md` 的 **REQ-5.6** 字段清单**仍按旧口径（未列 `stdout`）** —— 需求口径变更需主人点头，本轮只做「代码 + 测试 + 本条留痕」；② **`Timeout` 的部分输出**（与上条同族、另一条路径）未纳入；③ 本轮是**纯离线**验证：**真机未复验**（未起实例、未跑探针、未重建任何 `lib/`），`stdout` 在真机 gsudo 分支上的实际收益留 005 的下一次真机收口确认。

10. ✅ **2026-10-12 文档同步轮：第 9 条的 ① ② 两项已结清**（③ 是**真机项**、不属本轮，仍挂在 005 的下一次真机收口）。
    ① **`design.md` 的类型表 `WslSharedError` 行 + `requirements.md` 的 `REQ-5.6` 字段清单已补 `stdout`** —— 只补字段、不改语义、不改编号，两处各留一条留痕（原文一字未删）。
    ② **`Timeout` 的部分输出已同族补齐**：`src/exec.ts` 超时分支回传超时时**已收集到**的 `stdout` / `stderr`（零输出为**空串**、字段不缺席 —— 与 `NonZeroExit` 同一语义）。门 = `tests/unit/exec-timeout-echo.test.ts`（**6 条 + 变异哨兵**，判据函数只写一份、同时判哨兵载荷与真实现载荷）：哨兵原文 `旧实现（Timeout 只带 argv）⇒ 违反 2 条：缺 stdout 字段；缺 stderr 字段` / `新实现（Timeout 带 stdout/stderr）⇒ 违反 0 条`；并断言**成功路径与其它分支（启动前失败 / `CommandNotFound` / 非 ENOENT 的 `error`）字段集未被改变**。**改真源码当场跑红**：把超时载荷改回 `{ argv: command }` ⇒ 该文件 **4 failed | 2 passed（6）、exit 1**；随后**逐字节还原**，SHA256 `406AEB79352367D66E7D00BD32A992AE63D7B90878FBF527523FB2E3944DEC56` 前后一致并复绿。
    本包五门读数（全部本机实跑、cwd 分别为包内 / 仓库根）：`tsc -p tsconfig.json` **exit 0** · `vitest run` **230/230（8 文件）· exit 0**（基线 224 + 新增 6）· `node --test --test-concurrency=1 "tests/contract/**/*.test.ts"` **17/17 · exit 0** · `check-size.mjs` **exit 0**（去注释 **26,084 / 40,960 字节**、扩面 **273** 文件、最大 **396 行**）· `check-exports.mjs` **exit 0**（运行时 **8/12** 不变、类型 17、合计 25）。
