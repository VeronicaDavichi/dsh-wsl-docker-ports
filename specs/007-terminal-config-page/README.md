---
status: complete
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
updated_at: 2026-10-12T06:54:35.382343900Z
completed_at: 2026-10-12T06:54:35.382343900Z
transitions:
- status: in-progress
  at: 2026-10-09T04:10:28.958907700Z
- status: complete
  at: 2026-10-12T06:54:35.382343900Z
---
# 终端配置页：自绘表单 · live 写入管道 · 只读与冲突态

**类型**: 需求驱动（requirements-first）
**状态**: **in-progress**（**2026-10-09 从 `002-terminal-profiles` 拆出**；Phase 6 的代码与测试已交付于工作区，勾选状态见 `tasks.md`） 🔴 **2026-10-12 关闭轮订正（原文保留）**：`T6.1`–`T6.4` 四条判据本轮离线结清（`^\s*-\s*\[ \]` = **0 条**，`vitest` / `check-size` / `check-exports` / `verify-client-loader` 全 exit 0 —— 读数见 [`tasks.md`](./tasks.md) 的「关闭轮复算」），并叠加 `934da46` 的**真机复验**（配置页空白已修：锚点 `innerHTML` **0 → 554 B**、`.dtp-*` **0 → 7**）⇒ 本 Spec 状态同步 **complete**（CLI 写入，`completed_at` = `2026-10-12T06:54:35.382343900Z`）。⚠️ **真机待办 4 条仍保留在 `tasks.md`**（`remote.settings` 逐字形状 / home patch 只读 / revision 冲突 / `auto:false` 生效；另「002 右栏页能否直接打开」**仍未被直接确认**）—— 它们是**非复选**小节，**未删、未勾**，留给真机轮。 🔴 **2026-10-12 真机轮订正（原文保留）**：上述 4 条里 **3 条已按真机证据结清 / 标态**（`remote.settings` 的 `{ok,value,error}` **两臂形状** ✅、覆盖层 ⇒ 只读 + 原因 + **零落盘** ✅、revision 冲突 ⇒ 保留输入 ✅），**「路径」那一半不可实现**（`documentPath` 在真机 `settings/describe` 里 **0 命中** ⇒ `REQ-10.3` 已追加订正痕、原文保留、**已获主人认可（认可日 2026-10-12；依据：真机 `settings/describe` 里 `documentPath` 0 命中）**），`auto:false` **仍无直接样本** ✗；另「**002 右栏页能否直接打开**」也已由同批 `D` 段真机闭环 ✅（真胶囊 + 点击开 `tab6` + a11y）。逐条证据路径见 [`tasks.md`](./tasks.md) 的「真机待办」段；🔴 **复选框口径未变** —— 这 4 条仍是**非复选**小节，`^\s*-\s*\[ \]` 复算 **0 条**。
**优先级**: high
**包名**: `dsh-terminal-profiles`（与 002 **同一个包**，本 Spec 只占「配置页」这一交付面）
**位置**: `packages/terminal-profiles/src/client/{config-page.tsx,config-pipe.ts,config-row.tsx,config-row-model.ts}` + `src/config/{row-rules.ts,profiles.ts}` + `tests/{unit/client-config-*,helpers/config-fixtures.ts}` 🔴 **2026-10-12 订正（原文保留）**：「位置」自述**漏列**一个本 Spec 的直接产物 —— `src/client/config-slot.ts`（**236 行**：`plugins.row.config` 槽位分派 + `configure({ auto: false })`；`934da46` 的真机修复就在其 **L89–L107**）。回归门 `tests/unit/client-config-slot-render.test.tsx`（104 行、自带变异哨兵）**已被自述里的 `client-config-*` 通配覆盖**，不算漏。
**依赖**: [002-terminal-profiles](../002-terminal-profiles/README.md)（`depends_on`）—— 配置模型（`parseProfiles` / `VOLATILE_FIELDS` / `.volatile()` 语义）、客户端骨架与行渲染仍在 002，本 Spec **不重复**

## 1. 为什么单独成篇（拆分留痕）

- 002 的 `tasks.md` 在 Phase 6 落地后达 **219 行**（warn 200）、`design.md` 恰 **200 行**（贴 warn）；而配置页的验收边界（**只读态 / revision 冲突 / volatile-only 确认 / 语义文案**）与终端会话验收**互不依赖** ⇒ 独立成篇后两侧都回到阈值内。 🔴 **2026-10-12 关闭轮复核（原文保留）**：前半句**逐字复核通过**（`git show 8bfb6fb^:specs/002-terminal-profiles/tasks.md` = **219 行**、`design.md` = **200 行**；⚠️ 要用 `(… | Measure-Object).Count` 计，`Measure-Object -Line` 会少算成 163/146、别用）；后半句「两侧都回到阈值内」**不成立** —— 拆分后（`8bfb6fb`）002 的 `tasks.md` 实测 **209 行**（> warn 200，仍在 max 400 内），HEAD 现状 **273 行**（002 自己后续追加收口记录所致，非本 Spec 造成）；本 Spec 自己的三份文档现为 tasks **42 行** / requirements **34 行** / design **48 行**，均在阈值内。
- 与 004（Agent 工具面）、005（提权写路径）、006（路径翻译）**同款做法**：**同包不拆包**、**编号一律保持**（`REQ-10.x` / `T6.x` 原样）、002 侧只留「**已迁出**」空位 —— 以免既有引用（含其它 Spec、`client-contract.md`、代码注释里的 `T6.x` / `REQ-10.x`）错位。
- 002 的 `REQ-1/2/3/4/11` 与 `Phase 1–5/7` **不动**；本 Spec 承接 `REQ-10`、§2.2、design §4（配置写入管道）与 `Phase 6` 的 T6.1–T6.4。

## 2. 本 Spec 的判据入口

- 需求：见本目录 [`requirements.md`](./requirements.md)（§2.2 交互控件 + REQ-10；NFR 沿用 002 的 NFR-1–6，不重复声明）。
- 设计：见本目录 [`design.md`](./design.md)（配置写入管道 = settings **三写操作** live 路径 + 只读/冲突态的判据来源）。
- 任务与证据：见本目录 [`tasks.md`](./tasks.md)（T6.1–T6.4 + 集成方复验记录 + 真机待办）。
- 宿主契约事实（`remote.settings` 形状、patch 层序、`plugins.row.config` 槽位）：见 [`../../client-contract.md`](../../client-contract.md) §A–§P9 与 [`../002-terminal-profiles/design.md`](../002-terminal-profiles/design.md) §11。
