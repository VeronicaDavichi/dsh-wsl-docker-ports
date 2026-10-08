---
status: in-progress
created: 2026-10-08
priority: high
tags:
- wsl
- shared-lib
- base
- dsh-plugin
created_at: 2026-10-08T09:42:12.335682700Z
updated_at: 2026-10-08T13:25:44.483516200Z
transitions:
- status: planned
  at: 2026-10-08T13:22:41.226365600Z
- status: in-progress
  at: 2026-10-08T13:25:44.483516200Z
---
# 共享底座：WSL 发行版发现 · eth0 IP · 路径翻译 · NAT 判定

**类型**: 需求驱动（requirements-first）
**状态**: in-progress（2026-10-08 主人拍板开工；Phase 0 的 T0.1 / T0.2 **已完成**、Phase 1（错误模型+执行器）与 Phase 2（发行版发现）**已实现并全绿**，B-1 / B-2 均已定案）
**优先级**: high
**包名**: `dsh-wsl-shared` —— **非插件包**（无 cordis 行、无 UI、无配置页、无 PTY）
**位置**: `packages/wsl-shared/`

---

## 概述

组件②（`dsh-wsl-docker-ports`）要按 `netsh portproxy` 逻辑把 WSL 里 docker 暴露的端口转发到 Windows，组件①（`dsh-terminal-profiles`）要在 WSL 视角下用 Linux 路径启动终端。两件事都需要同一批「问 WSL 要事实」的能力：

1. 机器上有哪几个发行版、默认是哪个、跑没跑（`wsl -l -v`）
2. NAT 模式下 WSL 的 eth0 地址是多少（portproxy 的 `connectaddress`）
3. Windows 路径与 WSL 路径怎么互转（`E:\x` ↔ `/mnt/e/x`）
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
| 路径翻译 | 2（① 生成 `cwdLinux`；② 错误文案与日志可读）| ✅ 本包 |
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
| `pathmap` | 路径字符串（+ 可选发行版名）| 对侧路径 | `/mnt/<盘>` 与 `\\wsl.localhost\<distro>\…` 双向；无盘符路径不许猜 |
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
| [requirements.md](./requirements.md) | REQ-1..6 与 EARS 验收标准、NFR、约束与假设 |
| [design.md](./design.md) | 架构与依赖方向、模块划分、类型契约、四张解析表、执行器与错误模型、测试策略、决策权衡 |
| [tasks.md](./tasks.md) | 按阶段拆分的任务、验证方法与完成定义 |

---

## 冻结决策速览

| 决策点 | 结论 | 理由摘要 |
|---|---|---|
| 包形态 | **非插件包**，无 `cordis.patch.yml` | handover 拍板；进本包的只有纯逻辑，没有生命周期要管 |
| 依赖方向 | 002 / 003 → 001，**单向**；001 只依赖 `node:` 内置 | 避免循环依赖；001 无宿主能力需求，可离线单测 |
| 执行器 | `spawn` + **argv 数组**，绝不拼 shell 字符串 | 注入面最小；路径含空格/中文不需要引号游戏 |
| 公开面预算 | **运行时**导出 ≤ 12；**类型导出不计入**（单独统计并打印）| 类型编译后被完全擦除、不进 bundle，本条约束的是**可调用面**；**2026-10-08 主人拍板**，REQ-6.4 已订正留痕 |
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
| B-1 | `z.array(...).volatile()` 在数组路径上是否生效 | **002**（本 Spec 不受阻）| 🟡 **机制已由源码定案（成立）**，剩真机行为链；见 [002/tasks.md](../002-terminal-profiles/tasks.md) 的 T0.1 |
| ~~B-2~~ | ~~6 项 `backend.*` 的 `confirmed: implied` 待主人逐条点头~~ | 全线 | ✅ **2026-10-08 已确认全为 `none`，本项清除**（结论不影响本包 —— 本包不注册后端能力）|

**本 Spec 自身的开工前置**（T0.1）**已于 2026-10-08 完成**：真机 fixture 已入库（`packages/wsl-shared/tests/contract/fixtures/`，字节级溯源见该目录 README），**编码与表头形态已实测定案** —— `wsl -l -v` = **UTF-16LE + 行尾 LF + 英文表头**（而 `wsl --version` 是中文表头）⇒ 解析器不依赖任何表头字面量。详见 [tasks.md](./tasks.md) 的 T0.1。

## 下一步

1. 主人复核本 Spec（重点：REQ-2.4 的「Stopped 不静默冷启动」、REQ-4.6 的「读不到 ≠ 缺省 NAT」两条保守取舍）。
2. ~~打掉 **B-1** 后把 Spec 转 `planned`，再进 `/leanspec-apply`~~ → ✅ **2026-10-08 已完成**：B-1 五条全部定案，五份 Spec 全部 `planned`。**本 Spec 已 `in-progress`**。
3. ✅ **Phase 0 / 1 / 2 / 3 已完成**（真机 fixture + 错误模型 + 执行器 + 发行版发现 + eth0 探测；`typecheck` / `vitest` **84** / `node --test` **11** / `check:exports` **运行时 4/12** / `check:size` **去注释 15,318/15,360 字节** 五道门全绿，真机复验 **115ms**，eth0 冷启动 **12,637ms** / 热 **192–237ms**）。证据见 [tasks.md](./tasks.md) 的「Phase 1–3 完成记录」；**两条口径均已由主人拍板**（导出预算只计运行时；体积按去注释、去空行计），**两轮自审共 11 项**（8 个真缺陷 + 本轮 3 项，见「复审补强」「Phase 3 完成记录」）。
4. ✅ **Phase 3 已完成**（T3.1–T3.3 + fixture `ip-eth0.raw`）。**关键收获**：`wsl -d X -- ip …` 的输出是 **UTF-8**，与 `wsl -l -v` 的 **UTF-16LE** 不同 —— 猜错就是「eth0 没有 IPv4」的假阴性。**T1.4 结案**：A/B 实测只杀 `wsl.exe` 也能回收发行版侧进程，`taskkill /T` 是保险而非必需。
5. 下一步：**Phase 4（路径翻译，T4.x）** —— 纯函数、无真机副作用；之后 Phase 5（`.wslconfig` + NAT 判定）。⚠️ **待主人拍板**：Phase 3 后去注释代码已到 **15,318/15,360 字节（余 42 字节）**，Phase 4–5 预计再加约 **3.5 KB** ⇒ 15 KB 软指标必然被超，需定新口径（建议提到 20 KB 并留痕）。
