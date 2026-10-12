# 需求：终端配置页（007）

> 本文件由 [`../002-terminal-profiles/requirements.md`](../002-terminal-profiles/requirements.md) **拆分而来**（2026-10-09）：编号 `REQ-10.x` **原样保持**，002 侧留「已迁出」空位。
> **NFR 不重复声明** —— 沿用 002 的 `NFR-1`–`NFR-6`（含「零全局 CSS / 零硬编码 hex」「`typecheck`+`vitest`+`build` 三绿」「单文件 ≤ 400 行」）。

## 交互控件

### 2.2 配置页（`plugins.row.config`）

| 控件 | data-testid | 触发行为 | 副作用（可观察）|
|------|-------------|---------|----------------|
| 新增 profile | `btn-profile-add` | 追加空条目 | 表单 +1 行 |
| 删除 profile | `btn-profile-remove` | 移除条目 | 表单 −1 行 |
| 字段编辑 | `inp-profile-<field>` | 改 `name/command/args/cwd/cwdLinux/env` | 表单状态变化；**未**写盘 |
| 保存 | `btn-profile-save` | 写 profile patch | volatile-only → 终端**存活**；否则先弹确认（REQ-2.2）|
| 校验错误提示 | `cfg-error` | 校验/写盘失败 | 显示原因；**不**写盘；保留用户输入 |
| 只读原因提示 | `cfg-readonly` | home patch 抢占 | 显示「写入被拒」原因 + 路径 |

---


> 🔴 **§2.2「只读原因提示」行的订正痕（2026-10-12，与 REQ-10.3 是**同一条**）**：该行原写「显示「写入被拒」原因 + 路径」——
> 「**原因**」已真机闭环 ✅（真机拒绝原文 + 页面 `cfg-readonly` 文案）；「**路径**」按 REQ-10.3 的订正痕**降级为「宿主未提供时如实说明」**。原文保留。

## 功能需求

### REQ-10 配置页

- **REQ-10.1** 配置页 SHALL 经 `plugins.row.config`（键 `<包名>#<行 id>`）注册，并用 `ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))` 关闭自动表单、自绘界面。**2026-10-08 源码实证**：slot 名与键格式、以及 `configure({ auto: false }, ctx.fiber)` 的用法均有官方真实调用点。
- **REQ-10.2** 写入 SHALL 走 **live（volatile）字段路径**：`ctx.settings.{update,replace,mutate}`（三写操作，陈旧写入被拒）—— 命名空间 = **本包 patch 条目 id**，schema 由本包**静态导出 `Config`** 提供。SHALL NOT 拿 `ctx.configEditor.edit()` 写 live 字段（那是**完整配置**路径，官方原文 `ordinary fields retain Loader's normal lifecycle` ⇒ **会重挂载、杀正在跑的终端**）。本包 SHALL NOT 自行读写、拼接或重写 YAML。
- **REQ-10.3** GIVEN 本行被 home patch 或 `--patch` 覆盖（写入被拒），THEN 表单 SHALL 显示只读原因与文件路径，SHALL NOT 假装保存成功。
  > 🔴 **订正痕（2026-10-12 真机闭环；原文保留、不删）**：本条「文件**路径** SHALL 显示」在当前宿主载荷下**不可实现** ——
  > `settings/describe` 的真机原文里 `documentPath` **出现 0 次**（我当场复算三份载荷：`C1-settings-describe.raw.json` **35,168 字节**、
  > `C2b-describe-with-overlay.raw.json` 34,554 字节、`host-settings-describe.raw.json` 34,388 字节 ⇒ 三者 **0 命中**），
  > 即宿主**真不提供**该字段（`dsh-settings` 内部有 `documentPath`，但唯一远端出口 `settings/openSettingsDocument` 只回 `{opened:true}`）。
  > ⇒ 口径**降级为**：「**宿主提供路径时显示路径；宿主未提供时如实说明**」（实现取后者：文案 `配置文件路径：宿主未提供`，**不伪造路径**）。
  > 属**需求口径订正** ⇒ 按本仓规矩「追加订正痕 + 原文保留」处理，**列为「已订正 / 已确认」**（主人认可日 2026-10-12；依据：真机 `settings/describe` 对 `documentPath` **0 命中**）；证据见 [`tasks.md`](./tasks.md) 的真机闭环段与 [`design.md`](./design.md) §5。
- **REQ-10.4** GIVEN 保存失败（revision 冲突 / 校验失败），THEN 系统 SHALL 显示原因并保留用户输入（不清空表单）。
- **REQ-10.5** GIVEN 本行不满足宿主「唯一寻址且在 profile 根 Include 内」前提（**live 路径同样依赖它**：settings 按**条目 id** 寻址，源码 `row.options.id === ns`），THEN 表单 SHALL 展示该限制，SHALL NOT 让用户白填。


> 说明：`T6.2`/`T6.4` 引用的 `REQ-2.2`/`REQ-2.3`/`REQ-2.4`/`REQ-1.2` **仍属 002**（配置模型与存活语义），本 Spec 只消费不重述。

