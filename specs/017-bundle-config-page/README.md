---
status: complete
created: 2026-10-27
priority: medium
tags:
- dsh-plugin
- wsl
- docker
- ui
- config
created_at: 2026-10-27T03:09:57.611889800Z
updated_at: 2026-10-27T03:12:59.460282500Z
completed_at: 2026-10-27T03:12:59.460282500Z
transitions:
- status: in-progress
  at: 2026-10-27T03:10:08.907372800Z
- status: complete
  at: 2026-10-27T03:12:59.460282500Z
---
# 017 · 组合包级配置页（提权策略 / 刷新频次 / 目标发行版搬进插件内页）

> 起因（主人 2026-10-27 原话）：「我们把 提权策略，刷新频次，目标发行版 全部移到 插件内页的配置页」，
> 并给了参考插件 `@agents-anywhere/dsh-bridge-next` 的配置界面设计，「按照这个学」。
> 三个拍板（同日）：
> ① 页面挂在「插件进来但是没有点进子组件的地方」= bundle 卡片详情页，**描述与组件行之间**；
> ② 刷新频次要**两个值**，子配置写法抄 `luweiyabo/dsh-whale-pet`；
> ③ 页头上原来的控件**直接删掉**（不留双入口）。

## 背景事实（宿主源码 + 两个真实插件实证）

- `plugins.bundle.config`：**按 bundle 包名**注册，渲染位置就是「卡片描述之后、组件行之前」；
  表单带自己的保存控件（`view: 'page'`），离开即丢弃草稿。
- `plugins.row.config`：**按 `<包名>#<行 id>`** 注册。015/016 只写行 id（`wsl-ports` / `wsl-containers`）
  ⇒ 行上的「配置」控件查不到 ⇒ 自绘页**从未真正渲染**（本轮订正）。
- `settings.describe()` 返回**所有**命名空间；`settings.update({ns, patch})` 的 ns 由调用方给
  ⇒ 一个客户端既能读也能写别的命名空间（跨组件行写同一份配置，不需要第二条通道）。
- 参考实现：bridge-next 2.0.2 的 `SettingsPanel`（`section.panel` → `h3` → `label.field` →
  `div.save` + `role=status`「设置已保存」+ 未改动时 primary 置灰）；whale-pet 的
  `panel/field/singleSelect/numInput` 分工与「显式保存」形态。

## 需求

- REQ-1 卡片详情页在**描述与组件行之间**渲染配置页（`plugins.bundle.config`，key = bundle 包名）。
- REQ-2 三组控件都在这一页：目标发行版（下拉）、刷新频次（**两个**下拉：端口转发页 / 容器页）、提权策略（三档）。
- REQ-3 发行版下拉的候选来自**只读轻路由**，不跑 `docker ps`（唤醒后首次会 11–12s 且被硬超时砍掉）。
- REQ-4 **显式保存**：未改动时保存按钮置灰；`dirty` 用指纹判定（`JSON.stringify` 比较），不靠「点过没有」。
- REQ-5 提权策略是安全开关：改档后首次保存**只亮确认条**，未确认 ⇒ **零** `settings.update` 调用。
- REQ-6 一次保存写两个命名空间：`distro` 同时写 `wsl-ports` 与 `wsl-containers`（组件之间不许分叉）；
  刷新频次各写各的；**只写改动过的字段**。
- REQ-7 任一命名空间写失败 ⇒ 页面如实报失败，**不许**显示「设置已保存」。
- REQ-8 右栏页页头不再有频次下拉与「目标发行版：…」文字（单入口原则）。
- REQ-9 跨组件写不越界：`src/**` 不出现对方的路由前缀字面量（三包零交叉门 R4）。

## 交付形态

```
packages/wsl-docker-ports/src/client/config-slot.ts   → slots.register({ name: 'plugins.bundle.config', key: 'dsh-wsl-docker-ports' })
packages/wsl-docker-ports/src/client/config-page.tsx  → 三组控件 + 指纹脏判定 + 两段式提权确认 + 双命名空间写
packages/wsl-docker-ports/src/client/settings-pipe.ts → readNamespace / writeNamespace（同一个 remote.settings）
packages/wsl-docker-ports/src/route.ts                → GET /dsh-wsl-docker-ports/distros（只跑 wsl -l -v）
packages/wsl-docker-containers/src/client/config-slot.ts   → 行配置键订正为 `dsh-wsl-docker-containers#wsl-containers`
packages/wsl-docker-containers/src/client/containers/config-page.tsx → 收窄为「容器通道凭据」一页
```

## 验收标准（二值判定）

| # | 判据 | 证据 |
| --- | --- | --- |
| A-1 | 卡片页里配置页出现在描述与「包含的组件」之间 | 真机快照（heading「WSL Docker 工具箱 · 配置」在描述之后、`包含的组件` 之前）+ 截图 |
| A-2 | 三组控件与两个刷新值在场，初值读自配置 | `config-page.test.tsx` C1（distro=Ubuntu2204 / ports=15 / containers=30） |
| A-3 | 未改动 ⇒ 保存置灰、零写入 | C2 |
| A-4 | 一次保存写 `wsl-ports`（distro / refresh）+ `wsl-containers`（refresh + distro） | C3 三条 patch 逐字断言 |
| A-5 | 改提权档未确认 ⇒ 零 `update`；确认后才写 | C4 |
| A-6 | 写失败不谎报「已保存」 | C5 |
| A-7 | 页头无频次下拉 / 无发行版文字 | `refresh-interval.test.tsx` A1/A2（`sel-refresh-interval` 为 null）+ `containers-pane.test.tsx` D2-1/D2-5 + 真机快照 |
| A-8 | `/distros` 只读、零 docker、失败原样透出 | `distros-route.test.ts` D1–D5（快照装配 0 次） |
| A-9 | 零交叉门 R4 绿（230 文件），主包体积不越地板 | `check-borders` exit 0；ports 51,734 ≤ 56,350、containers 31,322 ≤ 31,324 |

## 真机证据（2026-10-27，profile `accept-docker-ports`，端口 43391）

- 卡片页快照：`heading "WSL Docker 工具箱 · 配置"` → 「目标发行版 / 刷新频次（端口转发页 15 秒、容器页 关闭）/ 提权策略 每次询问 / 端口作用域（只读）」→ `heading "包含的组件"`（共 2 个 · 2 运行中）。
- 保存前后：`保存设置` 由 disabled → enabled，状态文字「有未保存的改动」→「设置已保存」。
- 落盘（`cordis.patch.yml` 真字节）：
  `wsl-ports: { distro: Ubuntu2204, refreshIntervalSec: 60 }`、`wsl-containers: { refreshIntervalSec: 30, distro: Ubuntu2204 }`。
- 截图：`evidence-bundle-config-page.png`（本目录；929×917，卡片页三组控件 + 「设置已保存」）、`evidence-config-page-restyle.png`（版式订正后、脏态：保存钮亮起 + 「有未保存的改动」）。

## 版式订正（2026-10-27 第二轮：主人「你就不能学学人家ui么，你这ui好丑啊」）

**根因不是审美，是 token 名字写错了**：上一版 CSS 用的是 `--dsw-alias-border-primary` /
`--dsw-alias-border-secondary` / `--dsw-alias-bg-accent` / `--dsw-alias-state-danger` ——
这些名字在宿主主题 `@deepseek-ai/dsh-client-ui-theme@0.2.0-rc.2` 里**一个都不存在**
（真名是 `border-l1..l4` / `bg-layer-1..3` / `label-primary|secondary|tertiary` /
`state-*-primary` / `radius-xs|sm|md|lg|xl|panel`，逐条从该包 `lib/client.js` 枚举核对），
于是全部回落到 `currentColor` / `transparent` ⇒ 没有层次、没有圆角、没有分隔线，
就是主人看到的那张「丑」图。

**改法 = 逐条抄宿主的插件设置表单**（`@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2` 的
`lib/settings-form/fields.module.css` + `SettingsForm.module.css`，读实物 CSS 后照抄数值）：

| 件 | 宿主规格 | 本页落地 |
| --- | --- | --- |
| field | `flex` 纵向 / `gap 6px` / `padding 12px 0`，相邻 field 之间 `0.5px border-l2` | `.wdp-cfg-field` 同值 |
| label | 13px / 500 / `label-primary` | `.wdp-cfg-label` |
| 控件 | 高 34 / `padding 0 12` / `0.5px border-l4` / `radius-md` / `bg-layer-3` / 13px | `.wdp-input`（`select` 加 `appearance:none` + 双 `linear-gradient` 画的 ▼，零 hex） |
| 说明 | 12px / `label-tertiary` | `.wdp-cfg-hint` |
| 底栏 | `flex` / `gap 8` / `padding-top 16`，左状态右保存 | `.wdp-cfg-footer` |
| 保存 | `label-primary` 底 / `bg-layer-3` 字 / `radius-md` / `5px 14px` / disabled 透明度 .4 | `.wdp-save` |

另外**删掉自绘标题**「WSL Docker 工具箱 · 配置」和那段开场白：卡片页上方本来就有包名 + 描述，
再放一个 `h3` 只会跟宿主标题打架（bridge-next 的 `PluginSettings` 也只返回控件、不返回标题）。

**体积**：这套 CSS 有 4.7 KB，塞进主包会把 `lib/client.js` 从 51.7 KB 顶到 57.4 KB（越 56,350 地板）
⇒ 搬到 chunk 侧 `config-css.ts`（挂载注入 / 卸载移除，`data-plugin` 查重），主包反而**降到 51,734 B**；
单文件 354 + 164 行，未越 400 行 SHALL（`config-fields.tsx` 就是为此拆出来的）。

真机复核（同 profile 同端口，截图 `evidence-config-page-restyle.png`）：
改「端口转发页刷新频次」15 秒 → 60 秒后，`保存设置` 由 disabled → enabled、
状态由「设置已保存」→「有未保存的改动」（evaluate 返回值逐字：`{"before":{"disabled":true,"status":"设置已保存"},"after":{"value":"60","disabled":false,"status":"有未保存的改动"}}`）。
## 二订（2026-10-27 第三轮：端口声明搬家）

**主人原话**：「端口声明（managedPorts） 放到插件页面的配置里，展示放在外面容器的侧边栏里」；
拍板一问：「端口声明搬进配置页后，保存动作怎么算？」→ **并入「保存设置」**（不再有第二个保存钮）。

**落点与理由**

| 面 | 之前 | 现在 |
| --- | --- | --- |
| 编辑 | 右栏页「端口声明」块（textarea + 13 个 presets + 独立「保存声明」钮） | **bundle 卡片页配置页**新字段「端口声明（managedPorts）」：标签行 + 区间 textarea + presets 勾选 + 就地报非法原因；**共用底部那一个「保存设置」** |
| 展示 | 无（同一块既编辑又展示） | **右栏页只读块**：声明原文 + 已声明的常用端口一句话 + 非法原因 + 「要改请去插件卡片页配置区」；**不携带 `data-write-control`**、不因提权档置灰 |
| 写路径 | `runtime.settings.writeManagedPorts(mergeManagedPortsDecl(...))`（右栏页） | 同一函数，调用点搬到配置页的 `commit()`（一次保存里与 distro / 刷新 / 提权档并列） |

**语义一字未动**：区间原文 + presets → `mergeManagedPortsDecl` 合成**同一个** `managedPorts` 数组（REQ-16.4 不另建存储）；
勾选本身零写入（REQ-16.4）；非法项**原样留在输入里**并报原因（REQ-16.1），且此时保存闸门关闭（`disabled = … || issues.length > 0`）。

**顺手拆出两个文件**（`config-page.tsx` 已 379 行，贴着 400 行 SHALL）：
`config-model.ts`（Draft / EMPTY_DRAFT / `policyOf` / `refreshOf` / `distroOf` / `presetPortsOf` / `mergedManagedPorts` /
`checkedPresetsOf` / `draftIssues` / `declaredText`，80 行）与 `config-managed-ports.tsx`（编辑块本体，97 行）。

**用例跟着搬家**（没有一条被删掉，只是换了断言对象）：

| 旧用例（右栏页，`pane-write.test.tsx`） | 新家 |
| --- | --- |
| T5.7 勾 preset + 填区间 ⇒ 一次写入、零提权 | 配置页 **C6**（同一断言 + 顺带断言「其它字段没动就不产生多余写」＝ `writes.length === 1`） |
| T5.7 非法声明就地报原因、零写入 | 配置页 **C7** + 右栏页「只报原因不给改法」 |
| 009 缺陷 4：保存失败给可读原因、尝试 1 次、不重试 | 配置页 **C8**（`failNs: 'wsl-ports'` ⇒ 提示含「保存失败」、成功写入 0 次） |
| 右栏页编辑控件存在 | **反向**断言：`inp-managed-ports` / `btn-save-managed-ports` / `chk-preset-mysql` **全为 null**、开页零配置写 |

**真机**（同 profile 同端口 43391，截图 `evidence-config-managed-ports.png`）：勾「Spring Boot 应用（8080）」→ 状态「有未保存的改动」→ 点「保存设置」→
evaluate 实测 `{"after":{"status":"设置已保存","note":"设置已保存：端口声明 → 3306, 8080","saveDisabled":true}}`；
`cordis.patch.yml` 真字节出现
`managedPorts: ["3306","8080"]`（写的就是合并后的数组，presets 没有另立存储）。

**门**：ports `node --test` **442/442**、vitest **19 files / 165 tests**（+1：共 8 条配置页用例）、三个 tsconfig exit 0、
`check-borders` **232 文件** R1–R6 全绿、`check-exports` 25/25、`assert-client-split` 20/20、`verify-client-loader` 40/40、
`check-size` 375 文件最大 399 行、`p2-main-bundle-gate` exit 0；主包 **51,734 B**（地板 56,350，未动）、chunk 160,283 B。

**已知边界**：真机这个临时 profile 里**开不出「WSL Docker 端口」页签**（宿主只认已注册 kind，该页签从未在此 profile 打开过，
手工往 `localStorage` 的布局记录里塞 `tab3` 也会在下次启动被宿主按「未注册」丢弃）⇒ 右栏页只读块的行为证据是
jsdom 那 4 条用例（`pane-write.test.tsx`）；主人 desktop 里页签本来就在，打开即可看到。
## 不做（本轮边界）

- 不做 whale-pet 那种 **600ms 防抖自动保存**（提权档是安全开关，显式保存 + 二次确认才符合 REQ-12.4）。
- 不改 `refreshIntervalSec` 的存储位置（仍是各命名空间一个值，符合「两个值」）。
- 不合并两个组件包（015/016 的拆包结论不动）。

## 三订（2026-10-27 第四轮：写通道预演搬进配置页 + 侧栏去掉目标发行版）

**主人原话**：「侧边栏里面的目标发行版可以去掉了      写通道预演也放到配置页里面去」。
两问两答（开工前一次问完）：
① 搬多少 → **只搬「写通道预演」整块**（预演 → 确认 → 执行 → 回执），**凭据块留在右栏页**（它管 token，不属预演）；
② NAT 硬前提 → **不做置灰**：配置页只写一句前提，点了预演由服务端如实回原因。

### 落点

| 面 | 之前 | 现在 |
| --- | --- | --- |
| 写通道预演（`WriteChannelBlock`） | 右栏页最下面 | **配置页**「写通道预演」区（标签行 + NAT 前提 + 凭据指路 + 整块），与配置字段同页；**共用页面的空转零请求**（渲染期不预演 = 零写通道请求） |
| 写通道凭据（`WriteTokenBlock`） | 右栏页 | **仍在右栏页**（主人拍板只搬预演）；配置页给一句指路 |
| 目标发行版（`DistroBlock` 下拉） | 右栏页 | **删掉**；下拉只在配置页（上一轮已搬） |
| 发行版告警（漂移 / 解析失败 / stateNote） | 混在 `DistroBlock` 里 | **`DistroAlarmBlock`**：正常态**整块不渲染**；有漂移/错误/stateNote 时才出现（REQ-6 安全网不跟着搬走） |

### 为什么不给写通道做置灰（这轮唯一的降级，主人已拍板）

右栏页能置灰是因为快照里有 `view.nat`。配置页只有 `settings` 管道，要判 NAT 就得**额外读一次快照**
（`docker ps`，冷启实测 2–5 秒）—— 为一行提示让整页慢这么多不划算。
⇒ 不改判据、不静默：前提写在明处，NAT 不满足时 `/write/plan` 会带着原因失败，页面原样显示。
🔴 **009 的 T3.1（「不可能成功的操作不提供」）在配置页降级为「提供但如实报错」**，右栏页那套判据
（`write-confirm` / `write-panel` / `pane.test` T5.2）**一条没删**：它们测的是组件本身与右栏页的
`data-write-control` 闸门，仍然逐条通过。

### 顺带修的两处「话不对版」

- `CREDENTIAL_MISSING_HINT` / `CREDENTIAL_REJECTED_HINT` 原来说「请到**本插件配置页**点『生成并保存写通道凭据』」——
  凭据块留在右栏页了，照原话说用户会去配置页结果找不到 ⇒ 改成「到『WSL Docker 端口』右栏页的『写通道凭据』块」。
  对应两条断言从 `toContain('配置页')` 改为 `toContain('右栏页')`（判据还是「指路要指向一个真能点的地方」）。
- 配置页新加一句 `config-write-token-pointer`：明确「凭据不在这儿 + 去哪生成 + 没有凭据会本地拦下（零请求）」。

### 用例

| 文件 | 变化 |
| --- | --- |
| `tests/client/config-page.test.tsx` | **+C9**（写通道在配置页：整块在、前提含 NAT、预演**不置灰**、渲染期零写通道请求 —— 用「fetch 一被调用就抛」的真 `WriteWiring` 证）、**+C10**（宿主没给 `write` ⇒ 置灰 + 原因含 `remote.settings`）；C9 另断言凭据指路含「右栏页」 |
| `tests/client/pane-write.test.tsx` | **+2**：右栏页 `write-channel` / `distro-panel` / `sel-distro` / `distro-alarm` 全为 null（正常态）+ 反向对照「真有漂移时 `distro-alarm` 必须出现」 |
| `tests/client/distro-state-note.test.tsx` | 被测组件从 `DistroBlock` 换成 `DistroAlarmBlock`（两条断言逐字保留），**+③** 三样全空 ⇒ 整块不渲染 |
| `tests/client/write-channel.test.tsx` / `write-panel.test.tsx` | 仅「指路文案」断言 `配置页` → `右栏页`（意图不变，跟着真实位置走） |

### 真机（同 profile 43391，截图 `evidence-config-write-channel.png`）

配置页实测：`{"hasSection":true,"tokenPointer":"凭据（token）不在这儿：到「WSL Docker 端口」右栏页的「写通道凭据」块生成","previewDisabled":false,"wired":"1"}`
⇒ 写通道整块在、预演可点、`data-wired=1`（真接到 `remote.settings` 那条管道）。
点预演（本会话没凭据）得到**本地拦下、零请求**的可读提示：「本会话没有写通道凭据（本地拦下，零请求）：请到
『WSL Docker 端口』右栏页的『写通道凭据』块点『生成并保存写通道凭据』…」

### 门

ports `node --test` **442/442**、vitest **19 files / 170 tests**（165 → 170）、三 tsconfig 0、
`check-borders` **233 文件** R1–R6 绿、`check-exports` 25/25、`assert-client-split` 20/20、
`verify-client-loader` 40/40、`check-size` 最大 399 行、`p2-main-bundle-gate` 0；
主包 **51,883 B**（地板 56,350，余 4,467 B）、chunk 161,379 B。
拆文件：`config-write.tsx`（52 行，把写通道区连同前提/指路拆出来，`config-page.tsx` 388 行守 400 SHALL）。

### 版式返工（同日第二轮：主人「ui！！！！」）

**问题**：写通道块搬进配置页后仍穿右栏页那身衣服 —— 自带 `<h3>`（和外层「写通道预演」标题**重复一遍**）、
一个 1px 边框 + layer-1 底的 `.wdp-card` 盒子（嵌套在配置页字段流里像「贴了别人的卡片」）、
三个控件挤在一行（`wdp-inline`）且用 2px 内边距的小 `.wdp-btn`（高度 ~26px，而上面字段是 34px）。

**改法**：给 `WriteChannelBlock` 加 `variant`（`card` 缺省 / `field`），配置页用 `field`：

| 项 | `card`（右栏页，原样不动） | `field`（配置页） |
| --- | --- | --- |
| 容器 | `.wdp-card`（1px 边 + layer-1 底） | `.wdp-cfg-write`（无色无框，纯行流） |
| 标题 | 自带 `<h3>写通道（确认后执行）</h3>` | **无**（标题由外层「写通道预演」那一行给） |
| 控件 | 一行 `.wdp-inline` + `.wdp-btn` | 逐行 `.wdp-cfg-row`：`13px/500` 标签在上 → `.wdp-input`（34px，`radius-md`，layer-3 底）在下 |
| 端口输入 | `.wdp-btn` | `.wdp-input.wdp-cfg-input-plain`（去掉 select 那颗 ▼ 背景图） |
| 预演按钮 | `.wdp-btn` | `.wdp-cfg-btn`（34px 次级按钮，0.5px 边 + layer-3 底） |
| 提示 / 报错 | `.wdp-muted` / `.wdp-error` | `.wdp-cfg-sublabel` / `.wdp-cfg-notice` |
| 计划 / 回执 | 各自一张 `.wdp-card` | `.wdp-cfg-plan` 内嵌面板（0.5px 边 + layer-2 底，标题 12px 次级色），里面的按钮统一 30px |

**另外两处**：
① 两段提示（NAT 前提 + 凭据指路）原来各占一段，中间空出一条「像漏了一段」的间距 ⇒ 合成一段两行
（`<br/>` 分开，`config-write-premise` / `config-write-token-pointer` 两个 testid 保留）；
② `write-result.test.tsx` 的第 ⑨ 条门（「组件里用到的类名必须在样式表里」）原来只认 `PAGE_CSS`；
`write-panel.tsx` 现在一个组件两种版式、样式分居两张真表 ⇒ 白名单改取 **PAGE_CSS ∪ CONFIG_CSS**
并各要求至少命中 1 个（防止并集放过「写错表」）；零 hex 与 `var(--dsw-*)` 断言不变。

**真机实测（同 instance）**：`{"row":{"h":60},"action":{"h":34,"cls":"wdp-input"},"ports":{"h":34,"cls":"wdp-input wdp-cfg-input-plain"},"preview":{"h":34,"cls":"wdp-cfg-btn"},"hasNestedCard":false}`
⇒ 控件 34px 与上方字段一致、无嵌套卡片；预演真跑通（8080 不在声明集合 ⇒ 服务端回「被拦下、零动作」，
计划面板里「确认并执行」置灰 + 写明 `ports[].blocked`，与本轮版式无关的既有语义未被改动）。
截图：[evidence-config-write-field.png](./evidence-config-write-field.png)。

**用例**：`write-panel.test.tsx` **+2**（field 版式：无 `h3` / 容器类 `wdp-cfg-write` / 三个控件含 `wdp-input` /
预演 `wdp-cfg-btn`；card 版式反向对照：`h3` 仍在、控件仍是 `wdp-btn`）⇒ vitest **19 files / 172 tests**。
门：`node --test` 442/442、三 tsconfig 0、borders 233 文件 R1–R6 绿、exports 25/25、split 20/20、loader 40/40、
p2 0、主包 51,883 B、chunk **165,887 B**。

### 端口声明输入形态（同日第三轮：主人「不能每行，要支持半角逗号分隔」）

**原话**：「端口或区间（每行一项，如 3306 或 1000-3000）这个不行不能每行，要支持半角逗号分隔」。

**改法**（分隔符语义与控件形态一起改，只改录入侧，解析器与写入口一行未动）：

| 项 | 之前 | 现在 |
| --- | --- | --- |
| 控件 | `<textarea rows=3>`（`.wdp-input.wdp-textarea`，min-height 74px） | `<input type="text" class="wdp-input wdp-cfg-input-plain">`（34px 单行，与其它字段同高） |
| 提示 | 「端口或区间（每行一项，如 3306 或 1000-3000）」 | 「端口或区间，用半角逗号分隔（如 3306, 5432, 1000-3000）；从别处粘贴「每行一项」的旧文本会自动转成逗号」 |
| 占位符 | 无 | `3306, 5432, 1000-3000`（把写法直接示范出来） |
| 回填 | `decls.join('\n')`（打开就变成一列，像强制每行一项） | `decls.join(', ')` |
| 分隔符 | `split(/[\n,]/)` | `split(/[\n,，、]+/u)`：半角逗号为主 + 换行（旧配置/粘贴）+ 全角逗号/顿号（中文输入法顺手打的不算数据） |
| 空格 | — | **不当分隔符**：`1000 - 3000` 是**一项**，原样进解析器（那侧本来就容忍区间两侧的排版空格）—— 静默拆开会改写用户原意 |

**一个必须拦粘贴的原因**：单行 `<input>` 的浏览器行为会**吃掉换行**（`3306\n1000-3000` 落进 value 变成 `33061000-3000`），
所以 `onPaste` 里把 `换行 / 全角逗号 / 顿号` 先规范成「半角逗号 + 空格」再落值，并在需要时补分隔逗号、丢掉空段
（尾随换行不留孤零零的逗号）。⇒「旧的每行一项」照样粘得进来，而输入框本身坚持单行形态。

**顺带把静态样式门迁出**：`write-result.test.tsx` 上一轮被我加的行数顶到 **409 行**（NFR-5 SHALL ≤ 400），
其中 ⑨ 那条是纯静态扫描（零 hex + 类名都在真样式表里），与结果区行为无共享状态 ⇒ 挪到
`tests/client/write-style-gate.test.tsx`（vitest lane；**不能**叫 `.test.ts` —— `node --test "tests/**/*.test.ts"`
会把 vitest 用例一起抓进去而报错）。`write-result.test.tsx` 回到 **377 行**，用例数不变（13）。

**用例**：`client-rows.test.ts` +2（分隔符矩阵 5 种写法 ⇒ 同一数组；空格不当分隔符）、
`config-page.test.tsx` +2（C11 粘贴多行自动转逗号 + 写出的数组；C12 三项回填是逗号形态）、
静态样式门迁出 1 条 ⇒ **`node --test` 444/444、vitest 20 files / 174 tests**。
**真机**：输入 `3306, 1000-3000, 5432` ⇒ 无非法项、保存亮起；`onPaste` 派发 `8080\n9000\n`
⇒ `defaultPrevented=true`、值变 `…, 8080, 9000`（截图 [evidence-managed-ports-comma.png](./evidence-managed-ports-comma.png)，**未保存**，配置仍是 `["3306"]`）。

### 端口声明控件回退成 textarea（同日第四轮：主人「还是做成 textarea 吧」）

**原话**：「这个还是做成 textarea 吧，如果多了的话这里一个长条会很难维护」。

**判定**：第三轮把控件压成单行 `<input>` 是**过度修正** —— 逗号分隔是对的，单行形态不是。
真到了十几二十个声明（本机原有 19 条规则），一个横向长条根本没法逐项看/逐项改。

**最终形态**（第二轮「逗号」与第四轮「多行」都保住）：

| 项 | 第三轮（单行 input） | 现在（textarea） |
| --- | --- | --- |
| 控件 | `<input type="text">` 34px | `<textarea rows=3>`，min-height 74px、`resize: vertical`、等宽字体（`.wdp-input.wdp-textarea`，样式行按原字节恢复） |
| 回填 | `join(', ')` | `join('\n')`（一行一项，多了好改） |
| 提示 | 「用半角逗号分隔…粘贴旧文本会自动转成逗号」 | 「端口或区间，半角逗号或换行分隔都行（如 3306, 5432, 1000-3000；一行一项也可以，多了分行更好改）」 |
| 占位符 | `3306, 5432, 1000-3000` | 不变 |
| 分隔符 | `split(/[\n,，、]+/u)` | **不变**（半角逗号为主 + 换行 + 全角逗号/顿号；空格仍不当分隔符） |
| `onPaste` | 必须拦（单行 input 会吃掉换行） | **删除** —— textarea 天然保留换行，不再有那类陷阱 |

**用例**：`client-rows.test.ts` 的回填断言改回 `'3306\n1000-3000'`；`config-page.test.tsx` 的
C11 改「逗号写法能保存」、C12 改「控件是 TEXTAREA + 一行一项回填」、新增 C13「换行 / 逗号 / 混写 ⇒
同一个声明数组」⇒ **`node --test` 444/444、vitest 20 files / 175 tests**。
**真机**（最终包）：`tag=TEXTAREA`、`rows=3`、高 76px、`resize: vertical`、等宽字体；填
`3306\n1000-3000, 5432\n\n8080`（换行 + 逗号 + 空行混写）⇒ 无非法项、保存亮起；
截图 [evidence-managed-ports-textarea.png](./evidence-managed-ports-textarea.png)（**未保存**，profile 仍 `["3306"]`）。
