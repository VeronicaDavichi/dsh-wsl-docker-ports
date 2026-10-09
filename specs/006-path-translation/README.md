---
status: complete
created: 2026-10-09
priority: high
tags:
- wsl
- shared-lib
- pathmap
depends_on:
- 001-wsl-shared
created_at: 2026-10-09T00:36:59.345668800Z
updated_at: 2026-10-09T00:40:42.678866600Z
completed_at: 2026-10-09T00:40:42.678866600Z
transitions:
- status: complete
  at: 2026-10-09T00:40:42.678866600Z
---
# 路径翻译：Windows ↔ WSL 双向映射

**类型**: 需求驱动（requirements-first）
**状态**: **complete**（**2026-10-09 转 `complete`**；同日从 001-wsl-shared 拆出，代码与测试是 **2026-10-08** 交付的，本 Spec 承接其需求、设计与证据）
**优先级**: high
**包名**: `dsh-wsl-shared`（与 001 **同一个包**，本 Spec 只占 `src/pathmap.ts` 这一交付面）
**位置**: `packages/wsl-shared/src/pathmap.ts`（+ `tests/unit/pathmap.test.ts`）
**依赖**: [001-wsl-shared](../001-wsl-shared/README.md)（`depends_on`）—— 错误模型（`errors.ts` 的 `UnmappablePath` / `NoWindowsEquivalent` / `fail` / `isWslFailure`）与包骨架仍在 001，本 Spec **不重复**

---

## 为什么独立成 Spec

001 的 `tasks.md` 在 Phase 5 后已 **198 行**（`leanspec` warn 阈值 200），Phase 6 还要写收口与复盘；而「路径翻译」本身就是**独立可验收**的交付面：纯字符串变换，**不碰文件系统、不起进程、不依赖宿主**，有自己的 7 条需求、两个专属错误码，和一套「拿不准就报错」的失败语义 —— 绑在 001 的文档里，两边都读不清。

**拆的是文档与验收边界，不是包边界**：代码仍在同一个包，001 的 `index.ts` 依旧导出 `winToWsl` / `wslToWin`（导出预算 REQ-6.4 仍由 001 统计）。

**编号保持（关键取舍）**：REQ-3.1–REQ-3.7 与 T4.1–T4.4 **沿用 001 的原编号** —— `pathmap.ts` 与它的测试里已有 **20+ 处**按编号追溯（改编号等于让追溯链断掉）；001 侧留**空位**指向本 Spec，沿用 002 → 004 拆分时「保留空位以免引用错位」的先例。

---

## 概述

一句话：**`E:\x` ↔ `/mnt/e/x`，`\\wsl.localhost\<distro>\x` ↔ `/x`，拿不准就报错。**

    Windows（宿主）                              WSL（Linux）
    E:\x\y                  ── winToWsl ──▶      /mnt/e/x/y
    \\wsl.localhost\Ubuntu2204\home\u  ──▶       /home/u
    /mnt/e/x/y              ◀── wslToWin ──      （盘符挂载点）
    \\wsl.localhost\Ubuntu2204\home\u  ◀──       /home/u（**必须**给发行版名，否则报错）

消费者：**002**（`cwd` → `cwdLinux` 推导，其 REQ-1.4）与 **004**（工具参数里的 Linux 路径）。

---

## 范围外（本 Spec 不做）

1. **不校验存在性** —— 不 `stat`、不读 `/proc/mounts`、不判断 `/mnt/<盘>` 是否真的挂上了（纯函数，REQ-3.7）。
2. **不检查 MAX_PATH、不自动加 `\\?\` 长路径前缀**（实测 401 字符输入照译；能否使用取决于目标进程的长路径支持）。
3. **不猜盘符** —— 无发行版名的 Linux 路径一律 `NoWindowsEquivalent`（REQ-3.4）。
4. **不做引号包装 / shell 转义** —— 结果只作 `argv` 元素传递（REQ-3.6）。

---

## 冻结决策速览

| 决策点 | 结论 | 理由摘要 |
|---|---|---|
| 纯函数 vs 读 FS | **纯字符串变换** | 可离线单测、无 TOCTOU、无权限面（REQ-3.7）|
| 非法检查顺序 | **先于**形态判定 | 含 `?` 的输入上「这是不是 UNC」根本无法可靠回答（REQ-3.5）|
| 无盘符 Linux 路径 | 无发行版名 ⇒ **报错**；有 ⇒ `\\wsl.localhost\<distro>\…` | 猜盘符会让终端起在错误目录（REQ-3.4）|
| UNC 里的 `..` | **夹在共享根**（Win32 语义），**不是**错误 | 我曾误判为缺陷 ⇒ 实测推翻（design §4）|
| Linux → Windows 的反斜杠 | **拒** | Linux 合法、到 Windows 会变分隔符 ⇒ 静默错译 |
| 错误文案 | 控制字符**可见化** + 限长 ≤120 | ANSI 注入面（自审缺陷②）|
| 编号 | **沿用 001 的 REQ-3.x / T4.x** | 保 20+ 处代码与测试的追溯链 |

---

## 文档导航

| 文档 | 内容 |
|------|------|
| [requirements.md](./requirements.md) | REQ-3.1–3.7（**原编号**）、相关 NFR、约束与假设 |
| [design.md](./design.md) | 映射表、入参检查、`node:path` 实测语义、边界与限制、测试策略 |
| [tasks.md](./tasks.md) | T4.1–T4.4（**原编号**，均已完成）+ Phase 4 完成记录 |

---

## 下一步

1. 主人复核本 Spec，重点：**REQ-3.4「不猜盘符」** 与 **REQ-3.5 的保守拒绝面**。
2. **无阻塞项**：代码 + **87 条**单测已全绿（`pnpm -C packages/wsl-shared test`）⇒ 已转 `complete`（2026-10-09）。
3. ⚠️ 唯一未闭环项：**`002 → 006` 的 `depends_on` 边待补**（本机 CLI 无工具路径，见 `AGENTS.md`「本机 CLI 现状」）。
