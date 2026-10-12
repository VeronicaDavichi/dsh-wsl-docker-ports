# 设计：配置写入管道（007）

> 本文件由 [`../002-terminal-profiles/design.md`](../002-terminal-profiles/design.md) **拆分而来**（2026-10-09）：002 侧 §4 留「已迁出」空位。
> 宿主契约事实（`remote.settings` 形状、patch 层序、`plugins.row.config` 槽位、volatile 真机行为）**不在此重复** —— 见 002 `design.md` §11 与 [`../../client-contract.md`](../../client-contract.md) §D13。

## 4. 配置写入管道（关键路径）

    配置页（自绘，configure({auto:false})）
      │  ctx.settings.{update,replace,mutate}   ← 命名空间 = 本包 patch 条目 id
      │  schema = 本包**静态 Config 导出**；volatileForm 只展开 volatile 子树
      │  陈旧写入被拒 → settings/conflict
      ▼
    ~/.dsh/profiles/<name>/cordis.patch.yml   ← patchReload: live
      ▼
    dsh-hmr → Loader.Entry.update
      ├─ 仅 volatile 变更 → equalExceptVolatile 判等（'~standard'.vendor === 'schemastery'）→ _commitVolatile + loader/volatile-update → ✅ 不重挂载
      └─ 任何 ordinary 变更 → remount（dispose + apply）→ 🔴 实例全死

    ⚠️ **另一条不走的路**：ctx.configEditor.edit()（@deepseek-ai/dsh-config-editor）是
       **完整配置**路径 —— 官方原文 "ordinary fields retain Loader's normal lifecycle"
       ⇒ 走它必重挂载。live 字段不得经它写（2026-10-08 源码实证）。

**因此**：整个 `profiles` 数组声明 `.volatile()`（volatile 只在固定对象路径生效，数组元素内字段不是固定路径 → 必须整数组，`plugin.profileConfigLiveness`）。**2026-10-08 宿主源码实证**：`equal()` 首行 `if (schema?.meta?.volatile) return true` → 递归到 `profiles` 键**立即判等**、机制成立（`.volatile()` 在 schemastery 的 `Schema.prototype` 上，不挑类型）；两条硬边界（整数组 / 必须 Schemastery）见文末「已知限制」表，字节偏移见 `stack-decision.md` 的 `evidence`。

**2026-10-08 真机实证（临时 profile `volatile-probe` + 一次性探针插件，未碰用户在跑的实例）**：① `settings.update(ns, patch)` → **152ms 生效、`apply` 不重跑（不重挂载）且 volatile 引用 `.get()` 值真传播** ⇒ 上图的 volatile 分支成立、不是空操作；② 改 ordinary 字段 → **`apply` 重跑**（remount）⇒ `equalExceptVolatile` 判定在工作、非恒真；③ 非法值 → **静默拒绝 + 不崩**；④ 混合变更 → **remount**（符合「混合退化」预期）。⚠️ **落盘语义（同日定案，结论：闭环）**：`settings.documentPath` 直读出 settings 文档**就是** profile 的 `cordis.patch.yml`（`writable = true`）；`settings.update` 后 3s（进程仍在运行）文件内容已更新 ⇒ **立即落盘**；重启后值被正常加载 ⇒ **「改配置不杀终端」+「改完不丢」双闭环，不需额外落盘路径**。⚠️ 注意**同一文件既是 patch 层又是 settings 落盘处** —— 实验/实现里对它手写会与 settings 写入互相覆盖（我踩过，见 `stack-decision.md` 变更记录第 22 条）。

### 4.1 若 B-1 被推翻（两套方案的切换点）

| 方案 | 行为 | 切换成本 |
|---|---|---|
| A（首选；机制已由源码确认，待 T0.1 行为链）| `profiles` 整数组 volatile → 编辑不杀终端 | 无（按本设计）|
| B（降级）| 保存前判定是否 volatile-only；非 volatile-only 时弹确认「将终止 N 个运行中实例」，确认后 remount | 改 `config-page` 一处 + REQ-2.2 从「提示」升为主路径；不改 session-manager |

**REQ-2.2 本来就在**，所以方案 B 是「把安全网变主路径」，不是重设计。

---


## 与 002 的边界

- **本 Spec 拥有**：配置页 UI（`config-page.tsx` / `config-row.tsx` / `config-row-model.ts`）、写入管道（`config-pipe.ts`）、行规则（`src/config/row-rules.ts`）与它们的测试。
- **002 拥有**：配置模型（`parseProfiles`）、`.volatile()` 语义与 `VOLATILE_FIELDS`、客户端骨架/行渲染/终端会话、服务导出（`managedTerminal`）。
- 两侧同包、**不建反向边**（L3 生命周期隔离；`depends_on` 只有 `007 → 002`）。


## 决策留痕

- ✅ **2026-10-09（主人裁定）设置命名空间不加宿主侧 schema**：`ctx.settings.register` 在宿主 `0.2.0-rc.2` 已移除 ⇒ 本包的 settings 声明走**我们自己的 `cordis.patch.yml` 的 `- insert:` 条目**，**不引 `@deepseek-ai/schemastery`**、不加依赖。真机只需验证该条目被正常加载。

---

## 5. 只读与冲突态：真机闭环 + 路径订正痕（2026-10-12）

> 证据目录：`C:\Users\EDY\dsh-probe-artifacts\20261012-154451-final\`（`RESULT.txt` 全文 + `MANIFEST.txt`）。触发手段 = **`--patch` 覆盖层**
> （该 profile 的 app 是 `web` ⇒ `--patch` 必须写在 profile 名**之前**，写法陷阱见 `AGENTS.md` 的「本机 CLI 现状」）；
> **home 层 patch 本身未创建**（`~/.dsh/cordis.patch.yml` 是全局层、影响 `desktop`/`web`，属红线范围外）—— 拒绝文案同时覆盖两种来源。

| 判据 | 真机结果 | 证据文件 |
|---|---|---|
| 被覆盖层抢占 ⇒ 写被拒（**原文**） | `{"ok":false,"error":{"code":"settings/rejected","message":"Configuration for \"dsh-terminal-profiles\" is overridden by a home patch or command-line overlay","details":{"ns":"dsh-terminal-profiles"}}}` ⇒ 命中 `isReadOnlyRefusal` 的**覆盖层分支** ✅；⚠️ **`read-only provider` 分支仍无样本** ✗（如实标） | `C2b-readonly-refusal.raw.json`（255 B） |
| 被拒 ⇒ 页面只读 + 原因 | 根 `data-readonly="true"`、6 个 input 全 `disabled`、行级 `data-readonly="true"`、`btn-profile-add` 置灰、`cfg-readonly` 显示原因 | `RESULT.txt` §3 的 DOM 原文 |
| 被拒 ⇒ **零落盘** | `cordis.patch.yml` sha 前后**都是** `4a2c0a4a…`（553 B） | `C2b-patch-first.log` |
| revision 冲突 ⇒ 提示 + 保留输入 + 零落盘 | 外部推进 `revBefore=0 → revAfter=1`（`ok=True`）；保存报冲突、输入 `c3-conflict-row` / `pwsh.exe` / `-NoLogo` 全保留、sha C == sha B | `C3-external-advance.txt` + `RESULT.txt` §3 |
| **路径不可得（订正痕）** | `documentPath` 在 `settings/describe` 真机载荷里 **0 次** ⇒ 页面按设计显示 `配置文件路径：宿主未提供` ⇒ REQ-10.3 降级为「宿主未提供时如实说明」 | `C1-settings-describe.raw.json`（**35,168 B**，我当场复算 0 命中）/ `host-settings-describe.raw.json`（34,388 B，0 命中） |

🔴 **未踩实的假设（不许含糊）**：① `read-only provider` 分支**仍无真机样本**；② 「volatile live 写入 152ms 不重挂载」是 **002 的 2026-10-08 事实**，
本 Spec 本次**未复现**（本批只证了 `settings/update` 的**返回形状**与拒绝路径）；③ `auto:false` 是否真生效**仍无直接断言**（`934da46` 的自绘页渲染是必要证据，未单独断言「宿主默认表单未接管」）。
