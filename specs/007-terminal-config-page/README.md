---
status: in-progress
created: 2026-10-09
priority: high
tags:
- wsl
- plugin
- terminal
- config-ui
depends_on:
- 002-terminal-profiles
created_at: 2026-10-09T04:10:11.623070Z
updated_at: 2026-10-09T04:10:28.958907700Z
transitions:
- status: in-progress
  at: 2026-10-09T04:10:28.958907700Z
---
# 终端配置页：自绘表单 · live 写入管道 · 只读与冲突态

**类型**: 需求驱动（requirements-first）
**状态**: **in-progress**（**2026-10-09 从 `002-terminal-profiles` 拆出**；Phase 6 的代码与测试已交付于工作区，勾选状态见 `tasks.md`）
**优先级**: high
**包名**: `dsh-terminal-profiles`（与 002 **同一个包**，本 Spec 只占「配置页」这一交付面）
**位置**: `packages/terminal-profiles/src/client/{config-page.tsx,config-pipe.ts,config-row.tsx,config-row-model.ts}` + `src/config/{row-rules.ts,profiles.ts}` + `tests/{unit/client-config-*,helpers/config-fixtures.ts}`
**依赖**: [002-terminal-profiles](../002-terminal-profiles/README.md)（`depends_on`）—— 配置模型（`parseProfiles` / `VOLATILE_FIELDS` / `.volatile()` 语义）、客户端骨架与行渲染仍在 002，本 Spec **不重复**

## 1. 为什么单独成篇（拆分留痕）

- 002 的 `tasks.md` 在 Phase 6 落地后达 **219 行**（warn 200）、`design.md` 恰 **200 行**（贴 warn）；而配置页的验收边界（**只读态 / revision 冲突 / volatile-only 确认 / 语义文案**）与终端会话验收**互不依赖** ⇒ 独立成篇后两侧都回到阈值内。
- 与 004（Agent 工具面）、005（提权写路径）、006（路径翻译）**同款做法**：**同包不拆包**、**编号一律保持**（`REQ-10.x` / `T6.x` 原样）、002 侧只留「**已迁出**」空位 —— 以免既有引用（含其它 Spec、`client-contract.md`、代码注释里的 `T6.x` / `REQ-10.x`）错位。
- 002 的 `REQ-1/2/3/4/11` 与 `Phase 1–5/7` **不动**；本 Spec 承接 `REQ-10`、§2.2、design §4（配置写入管道）与 `Phase 6` 的 T6.1–T6.4。

## 2. 本 Spec 的判据入口

- 需求：见本目录 [`requirements.md`](./requirements.md)（§2.2 交互控件 + REQ-10；NFR 沿用 002 的 NFR-1–6，不重复声明）。
- 设计：见本目录 [`design.md`](./design.md)（配置写入管道 = settings **三写操作** live 路径 + 只读/冲突态的判据来源）。
- 任务与证据：见本目录 [`tasks.md`](./tasks.md)（T6.1–T6.4 + 集成方复验记录 + 真机待办）。
- 宿主契约事实（`remote.settings` 形状、patch 层序、`plugins.row.config` 槽位）：见 [`../../client-contract.md`](../../client-contract.md) §A–§P9 与 [`../002-terminal-profiles/design.md`](../002-terminal-profiles/design.md) §11。
