---
status: in-progress
created: 2026-10-09
priority: high
tags:
- dsh-plugin
- wsl
- docker
- ports
- elevation
- write
- web-route
- ui
depends_on:
- 005-elevation-write-path
- 003-wsl-docker-ports
created_at: 2026-10-09T06:27:29.300072900Z
updated_at: 2026-10-09T06:37:34.724527300Z
transitions:
- status: in-progress
  at: 2026-10-09T06:37:34.724527300Z
---
# 写入通道：动作计划 → 变更预览 → 提权执行 → 审计留痕

> **Status**: planned · **Priority**: high · **Created**: 2026-10-09

## Overview

005 已经拥有**写算法**（`src/write/`：所有权匹配 + 精确增删）与**提权后端链**（`src/elevate/`），003 拥有**读模型 / diff / 所有权推导** —— 但**没有任何界面或 HTTP 入口**能触发它们，写能力**不可达**（005 的 `plugin.ts` 如实记着 `ElevationInvoker` 缺口，只有 GET 只读路由）。本 Spec 只做**通道**。

**为什么通道必须自带闸门**：真机实测本机 `ConsentPromptBehaviorAdmin = 0`（Elevate without prompting）⇒ **提权不弹 UAC**，「UAC = 人类闸门」在本机**不成立**。故闸门收回产品内：**A** 写入前显式确认 + 变更预览（含将执行的命令原文）、**B** 审计留痕，且**与 OS 是否弹窗解耦**。

## Design

见 [design.md](./design.md)。要点：

- **路由**：独占前缀 `/dsh-wsl-docker-ports/write`（**不带尾斜杠** —— 带尾斜杠会注册成功但**永不被分派**，这是本项目已修过一次的静默缺陷，单测必须钉住反例）。
- 🔴 **安全命门**：`apply` **绝不接受客户端传来的命令**；服务端用声明式目标**重新推导**计划并比对 `planId`，不一致即拒绝。确认票据一次性 + TTL 120 s。
- **幂等与回滚**：执行前现读，已满足的标 `skipped`；中途失败按 005 REQ-3.5 回滚本轮。
- **审计**：内存环形 + 单行日志，🔴 **不写台账文件**（所有权是声明式冻结决策），且不含任何凭据。

## Plan

见 [tasks.md](./tasks.md)：Phase 0 契约核对 → **P1 只读通道**（先拿 G1/G3/G4）→ **P2 执行**（G2/G5/G6）→ **P3 界面** → Phase 4 收口。

- [ ] P1 只读：`plan` + `audit` + 路由骨架（零写入）
- [ ] P2 执行：`apply` + 确认票据 + 幂等 + 回滚
- [ ] P3 界面：确认对话框 + 逐步结果反馈

## Test

验收总门见 [requirements.md](./requirements.md) §4（G1–G7，全部可二值判定）。关键两条：

- **G1**：`plan` 前后 `netsh … show v4tov4` **逐字节相同**（只读路径零副作用）。
- **G5**：真写入一轮后**他人 19 条逐字节不变** + 重复执行条数不增（幂等）。

真机验收只用**临时/一次性 profile**（AGENTS.md 白名单：**不得**用 `desktop` / `web`），跑完逐字节还原。

## Notes

- 本 Spec 属**需求驱动**（沿用 001–007 的既有体例：先 REQ-N + EARS，再派生 design）。
- 与 `leanspec-propose` 技能里**原型 / `docs/` 全量扫描 / Playwright E2E / 视觉对照**相关的硬规则**不适用本仓**：技术栈已冻结为「不用 Playwright / `verify-e2e.sh` / 视觉对照」，且本仓无 `docs/` 原型树 ⇒ 只遵循其核心流程（EARS、每任务带验证、≤300 行）。
- 依赖边在**建 Spec 时**写入（`--depends-on` 事后无工具路径）：`005`（写算法 + 提权链）与 `003`（读模型 + diff，预览要用）。
