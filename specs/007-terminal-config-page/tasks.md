# 任务：终端配置页（007）

> 本文件由 [`../002-terminal-profiles/tasks.md`](../002-terminal-profiles/tasks.md) **拆分而来**（2026-10-09）：`T6.1`–`T6.4` **编号原样保持**，002 侧 `Phase 6` 留「已迁出」空位。
> **准入/准出**：Phase 6 的代码与测试已交付于工作区（集成方复验记录见下）；**整包**的门（用例数 / 产物体积 / 单文件行数）留在 002 的 `T7.3`。
> **真机项**见文末 —— 与 002/003 的真机批次同场执行。

## Phase 6：配置页

- [x] T6.1 [REQ-10.1][REQ-10.2] 自绘配置页 + 写入管道
  - 📌 **2026-10-09 实物契约**：配置页注册 = `ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: '<包名>#<行 id>' }, (ownerProps) => ownerProps?.view === 'summary' ? 一行摘要 : 页面))`（**槽驱动**：宿主不声明该槽就只是**不注册、不炸 boot**）；**写管道首选宿主服务** `ctx.get('remote.settings').update(ns, patch, expectedRevision)`、读走 `describe()`（自建 HTTP 路由留给终端动作/大文件，**不再是配置写入的唯一管道**）；`ctx.slots.register` 是 **`(options, Component)` 两个位置参数**（`name` 在 options 内，写成 `(name, id, …)` 会编译不过）。见 [`client-contract.md`](../../client-contract.md) §C10/§D12/§D13。
  - 内容：`plugins.row.config`（键 `<包名>#<行 id>`）+ `configure({ auto: false })`；写入只经 **settings 三写操作**（live 字段），**不用** `ctx.configEditor.edit()`（完整配置路径会重挂载）
  - 验证：`vitest` + fake ctx —— 注册键正确、`auto: false` 生效；`grep` 断言本包**无** YAML 手写（无 `writeFile` 到 `cordis.patch.yml`）

- [x] T6.2 [REQ-2.2][REQ-2.3] volatile-only 判定与确认
  - 内容：保存前判定变更是否 volatile-only；否则弹确认「正在运行的终端将被终止」；不为 ordinary 字段声明造新实例的 transform
  - 验证：`vitest` —— volatile-only → 不弹确认且走 settings 路径；含 ordinary → 弹确认且**未**写盘（直到确认）；transform 断言（连续两次 parse 结构相等）

- [x] T6.3 [REQ-10.3][REQ-10.4][REQ-10.5] 失败与只读态
  - 验证：`vitest` —— home patch 覆盖 → 只读 + 原因 + 路径；revision 冲突 → 提示且**保留输入**；不满足唯一寻址 → 展示限制

- [x] T6.4 [REQ-1.2][REQ-2.4] 容错与语义明示
  - 验证：`vitest` —— 单条无效不影响保存其余；配置页文案含「改 cwd 只影响新建实例」

---

---

## 集成方复验记录（2026-10-09；独立复跑，不采信转述）

- ✅ **T6.1–T6.4 判据完成**，四条均有**可被变异杀死**的判据（交付报告 §4 的 M-A…M-D 四处变异各自红在具体断言上、复原后源码 hash 与 bundle 字节数回到原值）。
- **复跑读数**：`typecheck` **exit 0** · `vitest` **33 文件 / 408 passed | 1 skipped（409）** · `build` 出主 bundle + 懒加载 chunk · `check:client` **60 条判据（含 4 条反控）全部通过** · `pnpm install --frozen-lockfile` **exit 0**，`pnpm-lock.yaml` SHA256 **`FEADFDB56EBAC31A…`** 与改动前逐字相同。
- **体积（本 Spec 产出的直接后果）**：主 bundle **43,537 B**（Phase 4 时 11,037 B ⇒ 配置页 +32,500 B）、chunk **447,255 B**。本包**无** `check:size` 脚本（001 才有）⇒ NFR-2 的「记账」由交付报告与 002 的 `T7.3` 承担。 🔴 **2026-10-12 订正痕（原文保留；原文在当时为真）**：**现状已变** —— 本包 `package.json` 现有 `"check:size": "node ../wsl-shared/scripts/check-size.mjs"`（`07d381b` 加入；`8bfb6fb` 拆分那一刻确实还没有）。本轮实跑 **exit 0**：去注释聚合（`packages/wsl-shared/src`，SSoT 口径）**25,859 / 40,960 字节**（余 15,101），扩面 `packages/*/{src,tests,scripts}/**` 共 **266** 文件（terminal-profiles **95**），NFR-5 单文件 ≤ 400 行的最大者 **396 行**（`wsl-docker-ports/tests/client/write-result.test.tsx`）⇒ NFR-2 的记账此后可由本包自己的门当场算，不必只依赖交付报告与 002 的 `T7.3`。
- **反向核对（集成方独立扫描）**：`src/` 下 `writeFile` / `cordis.patch.yml` / `configEditor` **0 命中**；**0 个文件 > 400 行**（最大 `src/plugin.ts` 394）；`peerDependencies.react = ^18.2.0` 且不在 `dependencies`。
- 🔴 **事故留痕（代理自报，原文已核实于 `scripts/verify-client-loader.mjs` L75–79）**：压 `417 → 327` 行时**搬迁脚本锚点写坏**，连带删掉 `runCanaries` / `checkManifest` / `checkMainBundle` 与一个 `export` 块；**当时未提交、git 无副本**（代理直读 `.git` 对象自证），故按契约**逐条重写** ⇒ `check:client` 判据 **59 → 60**，**文案不可能逐字复原**。⚠️ 这是本轮**唯一真实损失**；我复核后判定**判据有效性不受影响**（重写以 `.d.mts` 复用面 + 消费者断言为据，60/60 与 4 条反控齐全），但**「搬迁/重构脚本必须先备份或先提交」应升级为本仓规矩**。
- 🔵 **有意偏差（代理声明，我认同）**：`dsh.client.inject: []` / `external: []` 保持真实声明（确认框走原生 HTML 元素，不用 `@deepseek-ai/*` UI 原语 ⇒ §P4 的 external 供应商问题不触发）。
## 关闭轮复算（2026-10-12；离线复跑，零真机）

- **未勾项口径**：`Select-String -Path 'specs\007-terminal-config-page\tasks.md' -Pattern '^\s*-\s*\[ \]'` ⇒ **0 条**（`T6.1`–`T6.4` 四条均为 `[x]`，原文一字未删）⇒ 关闭前置满足；状态经 **CLI** `leanspec update 007-terminal-config-page --status complete` 由 `in-progress` 转 `complete`（`completed_at` = `2026-10-12T06:54:35.382343900Z`，`transitions` 追加一条；改完逐字节复核：README 行尾仍 LF、本文件行尾仍 CRLF、`loneCR` 0）。
- **本轮复跑读数（与上文 2026-10-09 读数并列，不覆盖）**：`vitest`（包内 cwd）**35 文件 / 430 passed | 1 skipped（431）· exit 0**（含 T6.1 回归门 `client-config-slot-render` **11 条断言**）· `check-size` **exit 0**（扩面 **266** 文件；最大 `wsl-docker-ports/tests/client/write-result.test.tsx` **396 行** < 400 SHALL）· `check-exports` **exit 0**（运行时 **8/12**、类型 17、合计 25 = 软阈值）· `verify-client-loader` **exit 0**（**60 条判据含 4 条反控**）⇒ 主 bundle **44,317 B**、懒加载 chunk **447,255 B**（`lib/client.js` SHA256 **63663408…** = `934da46` 重建后；上文 **43,537 B** 是 2026-10-09 的冻结值）。
- **T6.1 反向断言补口径（判据不变）**：**剥注释后**扫 `packages/terminal-profiles/src/**`（47 文件 / 182,249 字节）⇒ `writeFile` **0** / `cordis.patch.yml` **0** / `configEditor` **0**。⚠️ 不剥注释时三词各有命中、**全在注释里**（逐条写「不用它」）⇒ 上文「0 命中」的口径是**代码面**，此处补明，免得被读成「全文件 0 命中」。
- **真机侧补证（`934da46`，非本轮执行；本轮零真机）**：插件行「配置」按钮 ⇒ 锚点 `innerHTML` **0 → 554 B**、`innerText` **109 字**、`.dtp-*` 节点 **0 → 7** ⇒ **`plugins.row.config` 槽确被宿主提供、自绘页确渲染**。
- **未验项边界（不许含糊）**：`remote.settings` 的逐字形状、home patch ⇒ 只读、revision 冲突 ⇒ 保留输入、`auto:false` 是否真生效 —— 四者**仍只有离线覆盖**；**002 右栏页**能否在真机直接打开**仍未被直接确认**（只间接证过 `register()` 跑过），本 Spec 的复选框**不依赖**它。

### 可复用教训（各一行留痕）

- **槽位分派函数必须返回「元素」，返回「组件本身」在生产构建下静默空白**：旧写法 `return view === 'summary' ? components.summary : components.page` 让宿主 `entry.component(props)` 拿到一个**函数** ⇒ React 不报错、直接渲染成空面板（真机 `[data-slot="plugins.row.config"]` 的 `innerHTML` 恒为 `""`）；修法 = **调用**选中的组件拿元素（`chosen(ownerProps)`），见 `src/client/config-slot.ts` L89–L107。
- **回归门必须自带「变异哨兵」（当场证明它能杀掉旧实现），否则是假绿**：`tests/unit/client-config-slot-render.test.tsx` 渲染旧写法并断言 `textContent.length === 0` —— 旧离线用例只断言「分派函数返回了哪个对象」，所以真机空白时它**全绿**。⚠️ 实测 dev/JSDOM 下另可见逐字警告 `Functions are not valid as a React child…`（stderr 1 条），**但它没有被断言**，只是观测输出（生产构建 0 warning）。

### 待办指针（不在本 Spec 修 —— 002 的事）

- 002 的**假告警**：`packages/terminal-profiles/src/client/index.ts` L115–119 在 `apply` 末尾**同步**打「右栏页尚未注册…（不是失败）」⇒ 建议照 `schedulePendingWarn()` 的 **2 s 宽限期**收窄；🔴 **不许**把「warn 消失」当验收判据（正确判据 = 插件行「配置」按钮在锚点有内容）。

## 真机待办（主人场；与 002/003 同批）

- `remote.settings` 的真机形状核对（§D13 逐字：`{ ok, value, error }`）与 **volatile live 写入 152ms 不重挂载**的现场复现。 ⏳ **仍待真机轮**（本轮的 007 真机复验只证「页面有内容」，**未**读 `remote.settings`；152ms 不重挂载是 002 的 2026-10-08 真机事实，不是本 Spec 的复现）。
- **home patch 覆盖 ⇒ 只读 + 原因 + 路径**的真机复现（离线只有 `writable:false` / `readOnly:true` 的注入态）。 ⏳ **仍待真机轮**（判据：真机写被拒 ⇒ 表单显示只读原因 + 文件路径，且点保存**不写盘**）。
- **revision 冲突 ⇒ 保留输入**的真机复现（需并发写触发）。 ⏳ **仍待真机轮**（判据：冲突提示 + 表单**保留**输入，不清空）。
- T0.5 装载链路：`plugins.row.config` 槽位是否真被宿主提供、`auto:false` 是否真生效。 ✅ **前半句已由 `934da46` 真机关闭**（槽位确被提供、自绘页确渲染：锚点 `innerHTML` **0 → 554 B**、`.dtp-*` **0 → 7**）；⏳ **后半句（`auto:false` 是否真生效）仍待真机轮**。

## 缺陷 A 离线修复轮（2026-10-12；🔴 **零真机** —— 真机复验已延后到下一批）

- **根因（真机症状 + 宿主源码双向确定）**：`settings/describe` 的线上载荷 = `{writable,hasDocument,namespaces}`；外层 `writable` 是**恒真桩**（`dsh-settings/lib/index.js:395-398`，真机实测恒 `true`）、`SettingsNamespaceView` 字段表**没有**可写性/路径、`hasDocument` 注释逐字 *"without exposing its Host path"* ⇒「本行被 home patch / `--patch` 覆盖」在**载荷里读不出来**。旧实现把拒绝（宿主原文 `dsh-config-editor/lib/index.js:122`：`Configuration for "dsh-terminal-profiles" is overridden by a home patch or command-line overlay`）归进 `failed` ⇒ 页面只说「写入配置失败：…」，**表单仍完全可编辑**（= 条款 REQ-10.3 的真机反例）。
- **最小修复**：`src/client/config-pipe.ts` 新增 `isReadOnlyRefusal()` —— **只认宿主自己的词汇**（`overridden by a home patch` / `command-line overlay` / `read-only provider`；**故意不认裸的「只读 / read-only」**，免得把 `磁盘只读` 这类存储故障误锁成永久只读）⇒ 该拒绝归成 `readonly`；`config-page.tsx` 据此**粘性**只读 + 根节点 `data-readonly`；`config-row.tsx` 新增 `readOnly` ⇒ 输入框 / 行内删除 / 「新增 profile」全 `disabled`（「保存」**故意保留可点** —— 它是「不写盘」的证据面：第二次点击零 `update`）。⚠️ 语义边界：判定**必须**靠第一次被拒（载荷无线索），该次 `update` **零字节落盘**（宿主拒绝 ⇒ patch 文件 sha 不变，真机已证）。
- **路径**：宿主**有** `documentPath`（`dsh-settings/lib/index.js:399-408`）但**客户端取不到**（唯一远端出口 `settings/openSettingsDocument` 只回 `{opened:true}` 且副作用是打开系统编辑器，`configEditor` 不在远端命名空间）⇒ 文案用 `（宿主未提供配置文件路径）` **如实降级、不伪造路径**。两个**可选口径**（本轮**未改 requirements**，等主人拍板）：① 改 REQ-10.3 措辞（路径降为「若宿主提供」）② 只回显可得字段（原因 + `details.ns`）；本实现取 ②。
- **回归门 + 变异哨兵**：`tests/unit/client-config-readonly.test.tsx`（6 例 / **33 断言**）用**真机载荷逐字夹具**（`B2-…-with-overlay.raw.json`，34,521 B / sha256 `BE00EE3D…`）断言「载荷无线索 ⇒ 只认拒绝」+「页面不可编辑 + 原因显示」；哨兵逐字复刻旧行为（`failed`）并打印 `cfg-readonly=缺失 data-readonly=false input.disabled=false` ⇒ 旧实现**当场判错**。
- **离线门（cwd = `packages/terminal-profiles`，实测）**：`tsc` **exit 0** · `vitest` **37 文件 / 440 passed | 1 skipped（441）· exit 0**（= 基线 35/430|1 **加上本缺陷两个新门文件**）· `check-size` **exit 0**（`config-pipe.ts` **399 行 / 400** —— 仅 1 行余量，**下次改动必须先拆模块**）· `verify-client-loader` **exit 0**（60 条判据；⚠️ 校验对象是**未重建**的 `lib/`，**不含**本轮源码改动，按派单「不重建 lib/」）。
- ⏳ **未验（全部延后到下一批真机轮）**：真机被拒 ⇒ 表单只读 + 原因的**现场**渲染（DOM/a11y 前后对照）、本轮 patch sha 不变的复跑、revision 冲突真机复现。

