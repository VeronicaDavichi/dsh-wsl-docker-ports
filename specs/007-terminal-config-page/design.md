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
| **判据 1（打开即只读）·第二轮真机** | 带覆盖层 ⇒ 根 `data-readonly="true"`、`cfg-row-0` 行级只读、6 个 input 全 `disabled`、「新增/删除」置灰、`cfg-readonly` 显示**零写入推断**原因；`settings/update` **0**（只有 1 次 `describe`）；**fresh reload 后的第二次采样同样只读** ✅ | 第二轮证据目录（见 §5.1）：`RESULT.txt` 28,190 B / sha256 `8FDFB106…` |
| **判据 3（零落盘）·第二轮真机** | reload + 重开配置页 + **点保存**后，patch **sha 与 mtime 双证未动**（基线 343 B / mtime `17:30:52.1671984` / sha `cdc61a08…`）✅ ⚠️ 测量窗口**只限配置页交互路径**（**宿主自己也会写 patch**，见 §5.1 的 F1） | 同上 |
| **判据 4（兜底端到端）·第二轮真机** | 覆盖层取 schema 默认值（`config:{profiles:[]}`）⇒ **已知假阴性现场复现**（`value={profiles:[]}` / `base={profiles:[]}` / `user={}` ⇒ 推断不出）⇒ 页面**可编辑** ✓；真点保存 ⇒ **1 次** `settings/update`（`expectedRevision:0`）⇒ 宿主拒绝原文同本表首行 ⇒ **转锁定 + 显示真实宿主原因 + `cfg-error[data-notice-kind=readonly]` + 用户输入逐字保留 + patch sha/mtime 未变** ✅ | 同上 |
| **判据 5（流量计数）·第二轮真机** | 打开配置页只 **1 次 `describe`、0 次 `update`**；**锁定态**点保存只补发 1 次 `describe`、**仍 0 次 `update`** ✅ | 同上 |

🔴 **未踩实的假设（不许含糊）**：① `read-only provider` 分支**仍无真机样本**；② 「volatile live 写入 152ms 不重挂载」是 **002 的 2026-10-08 事实**，
本 Spec 本次**未复现**（本批只证了 `settings/update` 的**返回形状**与拒绝路径）；③ `auto:false` 是否真生效**仍无直接断言**（`934da46` 的自绘页渲染是必要证据，未单独断言「宿主默认表单未接管」）。

## 5.1 只读判据的**取值口径** + 第二轮真机闭环（2026-10-12-172155）

> 证据目录：`C:\Users\EDY\dsh-probe-artifacts\20261012-172155-auto-readonly\`（**只读**，未改一字）；`RESULT.txt` 28,190 B / sha256 `8FDFB1064FDE1AE229F3D0A8CB03D99978FA37671A69201C594B7D411BD6664D`。
> 与 §5 是**两轮不同批次**的真机产物 ⇒ 结论**并列**、不互相覆盖；本节**只追加**，§5 原文一字未删。

### (1) 判据口径订正：`data-readonly` **恒存在** ⇒ 判**取值**，**不是**判存在性 ✗

- 源码依据：`packages/terminal-profiles/src/client/config-page.tsx:238` 逐字为 `data-readonly={locked ? 'true' : 'false'}` ⇒ 该属性在**两种状态都在**（React 渲染成字符串 `"true"` / `"false"`）⇒「属性在不在」**恒真**、**不能**当判据。
- ⇒ 正确判据 = **取值**：只读 ⇒ `data-readonly="true"`；可写 ⇒ `data-readonly="false"`。
- **旁证一（结构）**：只读态**有** `cfg-readonly` 节点；可写态**无**该节点（真机可写态 = `data-readonly="false"` + **无** `cfg-readonly` 节点 + 「新增」`enabled`）。
- **旁证二（可交互性）**：可写态点「新增」后 **6 个 input 的 `disabled=false`**，且真实 CDP `fill` **写入成功**、`settings/update` **0**；只读态 6 个 input 全 `disabled`、「新增/删除」置灰。
- ⇒ 本 Spec 此后判定只读，**三条同时成立**才算通过：① `data-readonly` **取值**为 `"true"` / `"false"`；② `cfg-readonly` 节点有无；③ input 可编辑 / `disabled`（可写态再补 CDP `fill` 真写入 + `update` 计数 **0**）。

### (2) 🔴 零落盘的**测量边界**（F1 / F4）—— 跨整个浏览器会话测会误报

- **F1：宿主自己也会写 profile patch** —— 点 GUI 的「继续」关掉**预览版说明弹窗** ⇒ 宿主把 `ui-settings-general` / `welcomeNoticeVersion` 写进 `~/.dsh/profiles/<name>/cordis.patch.yml`（**218 B → 343 B**，mtime `17:30:52`）。
  ⇒ 零落盘类判据**必须限定在「打开配置页 → 编辑 → 保存」这条插件交互路径**上取前后快照；把窗口开成**整个浏览器会话**会把**宿主的写**误记成**插件的写** ✗。
- **F4：`cordis.yml` 启动时被重写但内容逐字节不变**（sha `c300dcf2…`）⇒ **只看 mtime 会误报**；零落盘判据一律 **sha + mtime 双证、以 sha 为准**。
- 同一事实的另两处落点：`AGENTS.md`「配置存活」行（**就地补**）与 [`../009-write-ui/acceptance-round.md`](../009-write-ui/acceptance-round.md) §10.1/§10.2。

### (3) 流量计数口径（F5）：`describe` / `update` 可当**可二值判定**的旁证

- 打开配置页 ⇒ **1 次 `describe`、0 次 `update`**；**锁定态**点保存 ⇒ 只补发 **1 次 `describe`**、**仍 0 次 `update`**（= 「不写盘」的证据面）。
- ⇒ 对表写法：`update` 计数**必须为 0**；`describe` 计数按「打开 1 次 / 锁定态保存再 +1 次」核对，超出一律视为**新证据需要解释**。

### (4) 路径订正（F2）被第二轮真机**再次钉死**

- `documentPath` 在真机 `settings/describe` **0 命中**（本轮**两次独立采样**：**35,246 B** / **34,474 B**、**21 命名空间**）⇒ 与 §5 的订正痕、`REQ-10.3` 的降级口径（「宿主提供时显示路径 / 未提供时如实说明」）**一致**；页面文案 `配置文件路径：宿主未提供` **不伪造路径** ✅。

### (5) 同代性（本轮产物 vs 实例）与**残留错配登记**

- **同代双证** ✅：`lib/` 最新 mtime **`17:23:14`**（**6 步构建全 `exitCode=0`**）、三实例起始 `17:28:17` / `17:33:21` / `17:35:14` ⇒ 产物**早于**实例 **275 s**；产物 sha：`lib/client.js` `c7cfbd23…` / **53,014 B** 等。
- 🔴 **残留错配（只登记，不改代码、不重建 `lib/`）**：`packages/terminal-profiles/src/client/index.ts` 于 **`17:27:21`** 被**并行提交 `ae9f74b`** 改动，而 `lib/`（`17:23:14`）**未重建** ⇒ **该轮真机结论不受影响** ✓（`ae9f74b` = pending-warn 宽限 + WS 重注册，自述**不触及**配置页与只读推断），但**要完全消解须在重建 `lib/` 后重跑同门**；全文见 [`tasks.md`](./tasks.md) 的「同代性错配登记」。

### (6) 本节未验（**不许勾** ✗）

- **home 层 patch**（`~/.dsh/cordis.patch.yml`）真机**仍无样本** —— 本批触发手段只有 `--patch` 覆盖层；拒绝文案同时覆盖两源，但 home 层**本身未创建**（红线范围外）。
- **混合行**（同一次写入里 ordinary + volatile 同时变）、**锁定态下的真实写入成功路径**、**`read-only provider` 分支**：三者本轮**都没有样本**。
- `revision 冲突` 本轮**无新样本**（上一轮 `C3-external-advance.txt` 的样本仍在盘上、**原样保留**；本节不新增、也不删）。
- `auto:false` 是否真生效**仍无直接断言**（§5 末尾的 ③ 原样保留）。