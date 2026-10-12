---
status: in-progress
created: 2026-10-12
priority: high
tags:
- dsh-plugin
- wsl
- docker
- ports
- ui
- write
depends_on:
- 008-write-transport
created_at: 2026-10-12T00:43:44.591776577Z
updated_at: 2026-10-12T00:53:18.098715800Z
transitions:
- status: in-progress
  at: 2026-10-12T00:53:18.098715800Z
---
# 写入口 UI：凭据生成 · 客户端确认 · 结果四态反馈

**类型**: 需求驱动（requirements-first）
**状态**: **in-progress**（**2026-10-12 从 `008-write-transport` 拆出**；离线实现已由 008 的 `T3.1` 交付于工作区，**真机 UI 复核未做** —— 勾选状态与迁入记录见 [`tasks.md`](./tasks.md)）
**优先级**: high
**包名**: `dsh-wsl-docker-ports`（与 008 **同一个包**，本 Spec 只占「写入口的 UI 面」）
**位置**: `packages/wsl-docker-ports/src/client/{write-token.ts,write-channel.ts,write-dto.ts,write-confirm.tsx,write-panel.tsx,pane-settings.tsx,settings-pipe.ts}` + `tests/client/{write-token,write-channel,write-confirm,write-panel}.test.tsx` + `tests/client/write-fixtures.ts` + `tests/unit/client-settings.test.ts`
**依赖**: [008-write-transport](../008-write-transport/README.md)（`depends_on`）—— 服务端写通道（路由 / `plan` / `apply` / 票据 / 审计 / 401 鉴权）仍在 008，本 Spec **不重复**

## 1. 为什么单独成篇（拆分留痕）

- 008 的 `tasks.md` 在 `T3.1` 落地后达 **394 行**（LeanSpec `validation.maxLines` = **400**，只剩 **6** 行）⇒ 触发 008 自己写下的规则：「**接近 / 超过 400 ⇒ 必须拆 Spec（新增一篇）**，**不得**删已验证结论 / 未验项 / 裁定依据 / 命令原文证据」。
- 拆的是**文档与验收边界**，**不是包边界**（**同包不拆包**）：产物都在 `packages/wsl-docker-ports/` —— 008 拥有 `src/transport/**`（服务端写通道）与 `src/write/**` · `src/elevate/**` 的**调用面**；本 Spec 拥有 `src/client/**` 里的**写入口 UI**（凭据仓库 / 客户端通道 / 确认对话框 / 结果面板 / 配置页凭据块）。
- 与 004 / 005 / 006 / 007 **同款做法**：**同包不拆包**；008 侧**编号一律保留**（`T3.2` 与 清单里的 `V6` 留「已迁出」**空位**并注明「已迁至 009」），以免既有引用（008 的 T3.3 清单、`write-confirm.tsx` 里「与 T3.2 的边界」注释、其它 Spec）错位；`depends_on` **只在建 Spec 时**写得进去（`leanspec create --depends-on 008-write-transport`；事后**无工具路径**）。
- 008 保留：`T1.x` / `T2.x`（后端写路径，已真机验收）、`T3.1`（已完成，判据数字留 008）、`T3.3` 的 **V1–V5**（后端真机自验）、`T4.x`（008 收口）。本 Spec 承接：`T3.2`（结果四态）、`V6`（真机 UI 复核）、**007 配置页的「生成并保存写通道凭据」按钮**，以及只属于 UI 面的一切新判据。

## 2. 本 Spec 的判据入口

- 需求与**八条冻结契约**：见 [`requirements.md`](./requirements.md) §2 —— 🔴 那些契约在此**冻结**（依据 = 源码文件 + 主人 2026-10-10 / 2026-10-12 裁定），**下一轮不得重新发明**。
- 设计（组件边界 / 状态流 / 接口契约 / 真机复核配方）：见 [`design.md`](./design.md)。
- 任务与证据（含**逐字迁入**的 008 `T3.1` 记录）：见 [`tasks.md`](./tasks.md)。
- **服务端**事实（路由前缀、`planId` / 一次性票据、401 鉴权、审计不记拒绝、真机 19→20→19）：见 [`../008-write-transport/design.md`](../008-write-transport/design.md) 与它的 `tasks.md` 的 T2.8 / T2.9 / T2.10 真机 PASS 记录。
- 宿主客户端契约（`remote.settings` 形状、`ctx.slots`、bundle 形态与 external 列表）：见 [`../../client-contract.md`](../../client-contract.md)。

## 3. 验收总门（摘要 —— **全量 U1–U8 见 [`requirements.md`](./requirements.md) §4**）

| # | 判据 | 方式 |
| --- | --- | --- |
| U1 | 未点确认 ⇒ `apply` **恰好 0 次**（对话框**零副作用**：无 fetch / 无 settings / 无订阅） | 单测 + 真机 |
| U2 | 对话框逐条渲染服务端 `steps[].commandText` **原文**（逐字 `===`，不改写 / 拼接 / 换行重组）+ 影响面 + `notes` | 单测 + **真机 UI**（V6） |
| U3 | `writeToken` 未配置 ⇒ 写通道**恒 401**（fail-safe，**不许放宽**）；配置页「生成并保存」+ 重载插件行后 401 消失 | 单测 + 真机（V7） |
| U4 | 结果四态（成功 / 失败 / 跳过 / 回滚）各自可渲染且**分色不同**，失败态**必带**可读原因 | 单测 |
| U5 | `401` ⇒ 提示「凭据缺失或错误 + 去哪配置」且**不重试**；`409` / `403` ⇒ **重新 plan + 重新要求确认**（不静默重试） | 单测 |
| U6 | 凭据**只**存 `sessionStorage`（命名空间键），不落盘、不进日志 / 审计 / 错误文案；请求用 `Authorization: Bearer`（客户端**不主动**用 `?token=`） | 静态扫描 + 单测 |

## 4. Notes

- 本 Spec 属**需求驱动**（沿用 001–008 的既有体例：先 REQ-N + EARS，再派生 design）。
- 🔴 **红线沿用 003 / 005 / 008**：不 `portproxy reset`、不碰所有权集合外的规则、不建通配符防火墙规则、卸载不删东西；真机只用**临时 / 一次性 profile**（AGENTS.md 白名单：**不得**用 `desktop` / `web`），跑完**逐字节还原**。
- 🔴 **本 Spec 不新增任何执行能力**：客户端只回传 `planId` + `ticket`（+ `confirmed:true` / `origin:'user'`）与**声明式目标**，命令文本**没有入口**（见 `write-channel.ts` 的 `serializeTarget` / `serializeApplyBody`）。
- 行数门：LeanSpec `warnLines` = 200（提示）/ `maxLines` = 400（硬门）；本 Spec 的 `requirements.md` / `design.md` / `tasks.md` **一律 < 200**，别一建出来就贴线。
