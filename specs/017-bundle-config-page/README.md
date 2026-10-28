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
⇒ `defaultPrevented=true`、值变 `…, 8080, 9000`（截图 [evidence-ports-comma-backfill.png](./evidence-ports-comma-backfill.png)，**未保存**，配置仍是 `["3306"]`）。

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

### 右栏页 CSS 对齐配置页（同日第五轮：主人「把侧边栏的 css 也调整成配置页这种样式吧」）

**根因两处**（都在这轮修掉）：

1. **右栏页从来没有控件样式** —— `.wdp-input` / `.wdp-save` / `.wdp-textbtn` 此前**只写在 `CONFIG_CSS`**
   （配置页 chunk 才注入），而右栏页也在用它们 ⇒ 右栏页的下拉/输入框/主按钮一直是**浏览器默认样式**。
   现在这三族**只在 `PAGE_CSS` 定义一次**（主包常驻），配置页**复用**同一套规则（不再各写一份，避免漂移）；
   下拉的 ▼ 从「所有 `.wdp-input` 都画」收敛为 **`select.wdp-input` 才画**（文本输入框不再带箭头）。
2. **视觉语言不统一** —— 右栏页是「1px 边框 + layer-1 底色的卡片堆」，配置页是宿主插件设置表单那套。
   现在右栏页**逐条对齐**：段落 `.wdp-sec`（纵向 gap 6 / 上下 padding 12 / 相邻 0.5px `border-l2` 细分隔线）、
   标题 13px·500·`label-primary`、提示 12px·`label-tertiary`、表格 `th` 11px·`label-secondary` +
   0.5px `border-l4`、状态标签是 `currentColor` 描边的胶囊、按钮 28px（面板内 30px）/ `radius-sm` / `bg-layer-3`。
   `wdp-card` **降级为「内嵌面板」**（0.5px `border-l2` + `radius-md` + `bg-layer-2`）：写通道预演、回执、确认框用它
   —— 与配置页的「计划/回执」面板完全同款；右栏页的 12 个段落一律改成 `wdp-sec`。

**顺带修掉的真机缺陷**（同一张表的窄栏表现）：真机栏宽 380–420px 时，端口表把「动作」列压成**一个字一行**，
单行高 232px（截图见 evidence）。现在 `.wdp-table` 有 `min-width: 460px` + `.wdp-sec { overflow-x: auto }`
（宁可横向滚动），按钮与下拉 `white-space: nowrap` / `max-width` 截断 ⇒ 行高回落到 ~76px。

**体积**：`PAGE_CSS` 7,320 → **6,524 B**（合并多选择器、tone 类只改 `color`、`outline` 只写一遍 ——
主包有「棘轮地板 56,350 B 只降不升」的硬账）；主包 51,883 → **55,971 B**（余 379 B），chunk 166,124 → **163,930 B**。
判据：`write-style-gate.test.tsx` 新增 ⑩（控件唯一定义在 PAGE_CSS / 右栏页必须 `.wdp-sec` / 分隔线全 0.5px）。

**验证**（⚠️ 右栏页在 acceptance profile 里**打不开**页签：宿主丢弃未知 kind）：
- 静态渲染台架（**一次性、跑完即删**）：真组件 `PortsPane` + 真 `PAGE_CSS` + **真机取回的 19 个 `--dsw-alias-*` token 值**
  渲染成 HTML 再用 Chrome 截图 → [evidence-sidebar-restyle.png](./evidence-sidebar-restyle.png)；
- 配置页回归（同一次构建）：`SELECT.wdp-input` 34px/12px 圆角/`bg-layer-3` + ▼ 在；`TEXTAREA` 76px 未变；`wdp-save` 32px。

### 右栏页去滚轮 + 原始输出搬家 + 配置页「分组 / 卡片」版式（同日第六轮）

主人这一轮四条原话，逐条落地：

| # | 原话 | 落地 |
| --- | --- | --- |
| 1 | 「所有的纵向滚轮都不应该存在，因为我是长条结构，不够的就应该自动向下扩展」 | `pane-scroll.ts` 从「把本页根变成滚动容器」改成**自然高度**（`height:auto` / `overflow-y:visible`），滚动交回宿主壳（往上找第一层非 `visible` 的祖先设成可滚）；配置页 textarea 改成**随内容长高**（`overflow:hidden` + `resize:none`，实测 3 行 76px → 12 行 248px） |
| 2 | 「这句话不用重复那么多遍，在描述的地方给他一个标记例如 ⚠，然后把 ⚠ 插在每条的解释，这样也不用那么多的分割线了」 | `rows.ts` 的说明句带 ⚠ 只在描述里出现**一次**，19 行外部规则每行只留一个 `⚠`（`title` 悬停看整句）；`.wdp-row` 去掉 `border-top` 分割线（行高 28px） |
| 3 | 「下一期的内容隐藏掉」 | `pane.tsx` 不再挂 `NextPhaseBlock`（组件留在 `pane-settings.tsx`，服务接入时挂回）；判据改成「两种服务可用性都不渲染 `btn-cs-exec`、全文无「下一期」」 |
| 4 | 「原始输出请放到配置页的转发的子组件下面的地方」+「它的组件配置页面，在子组件的下面，而不是在子组件的外面」（照 [@luweiyabo/dsh-whale-pet](https://github.com/luweiyabo/dsh-whale-pet) 的组件配置页截图） | 右栏页删掉 `RawOutputBlock`；配置页把写通道改成**分组 + 卡片**：`wdp-cfg-group`「写通道」里横排两张 `wdp-cfg-card`——「写通道预演」与「原始输出」，**兄弟卡片、原始输出在后面**；展开时该卡片 `flex-basis:100%` 独占一行（9 KB JSON 不挤 379px 窄栏）。数据**按需**：点开才经主包壳注入的 `loadRawOutput` 跑一次 `docker ps`（读成功给解析后的 JSON，读失败给服务端原文），加载期零读、反复展开不重复读 |

**体积**：主包 56,046 B（棘轮地板 56,350 B，**余 304 B**）；chunk 168,772 B。新增样式全在 `CONFIG_CSS`（chunk 侧），主包只增了 `index.ts` 的取数闭包 —— 为压回 400 行 SHALL 顺手合并了 3 处注释、删掉两条死规则（`.wdp-field`、`.wdp-cfg-input-plain`）。

**判据**：`write-style-gate.test.tsx` ⑩ 加「限定作用域的补充允许、裸选择器重定义判红」；`config-page.test.tsx` C14 改成「同一分组内、`wdp-cfg-card` 兄弟卡片、`compareDocumentPosition` 在预演之后、加载期 0 读、点开读 1 次、反复展开仍 1 次」；`pane.test.tsx` 外部规则加「整句只出现 1 次 + 19 行都带 ⚠」、下一期改成「不渲染」。

**验证**：
- 右栏页（acceptance profile 打不开页签 ⇒ 一次性静态渲染台架：真组件 + 真 `PAGE_CSS` + 真机 token 值）：`verticalScrollContainers = []`、`下一期` 不存在、19 行各带 1 个 ⚠、分割线 0 → [evidence-external-rules-marker.png](./evidence-external-rules-marker.png)；
- 配置页（真机）：分组 + 两张卡片 → [evidence-config-write-cards.png](./evidence-config-write-cards.png)；点开后卡片宽 379 → **768**（= 分组内容宽），pre 收起/展开只读 1 次；
- textarea 自动长高：DOM 实测 `before 76 → after 248`（12 行），`overflow-y: hidden`。

#### 订正（同日，主人第三次拍板：「我说让你放到组件下面去」）

上表第 4 行的第一版把两张卡片做成了 `flex-wrap: wrap` **横排并排** —— 那是「旁边」，不是「下面」。
改为 `.wdp-cfg-cards { flex-direction: column }` + `.wdp-cfg-card { flex: none; width: 100% }`：
「原始输出」卡片整宽落在「写通道预演」卡片**正下方**（实测 `gap 10px`、`raw.top ≥ preview.bottom`），
仍在同一个 `wdp-cfg-group`「写通道」框内。判据补进 `write-style-gate.test.tsx` ⑩：
`.wdp-cfg-cards` 规则必须含 `flex-direction: column`、且**不许**再出现 `flex-wrap: wrap`。
证据图已按竖排重拍：[evidence-config-write-cards.png](./evidence-config-write-cards.png)。

#### 订正（同日，主人第四次、也是最终定位：「位置在：点击 wsl port forwarding 子组件名字，之后打开的新页面里面」）

前面三版我都把「配置页」当成了**组合包卡片页**（`plugins.bundle.config`）—— 那不是主人说的那一页。
主人指的是**行级配置页**：`plugins.row.config`，键 = 宿主 `rowConfigKey(bundle, rowId)` = **`包名#行 id`**
（`dsh-wsl-docker-ports#wsl-ports`）。注册这个键之后，组合包页「包含的组件」里 `wsl-ports` 那一**行**才可点，
点进去就是 `WSL Port Forwarding` 自己的页面（面包屑 ← WSL Port Forwarding + 标题 + 描述），
`原始输出` 就在这一页、描述**下面**（分组「只读事实层」→ 卡片「原始输出」→「查看原始输出」）。

- 组件：`RawOutputPage`（`config-write.tsx`，chunk 侧），经 `chunk-ports.ts` 导出，主包只放一个取块座位；
  组合包页的「写通道」分组里**不再**放原始输出（避免两处重复）。
- 判据：`tests/client/config-raw-page.test.tsx` R1–R4（页面在 / 点开才读一次 / 未接线置灰 / 读失败报原因）、
  `entry.test.tsx` 断言两个配置槽的槽名与键（`plugins.bundle.config`+`dsh-wsl-docker-ports`、
  `plugins.row.config`+`dsh-wsl-docker-ports#wsl-ports`）。
- 真机：点 `wsl-ports` 行 → `config-raw-page` 在、`raw.top` 在描述下方、点按钮 3 秒读到 9,225 字符 JSON、
  再点收起后不再读。证据图：[evidence-row-page-raw-output.png](./evidence-row-page-raw-output.png)。
- 主包 56,279 B（地板 56,350，余 71 B）；chunk 168,860 B。

#### 六订·五（同日，主人第五次拍板：「把 写通道 / 写通道预演 / 端口声明（managedPorts）/ 端口转发页刷新频次 / 提权策略 / 端口作用域 都放进去」）

「进去」= 上一轮定位的那一页：**点 `WSL Port Forwarding` 那一行进去的行级配置页**（`plugins.row.config`，
键 `dsh-wsl-docker-ports#wsl-ports`）。做法：新增 `config-row-page.tsx` 的 `RowConfigPage` ——
上半是**整张 `ConfigPage`**（六件事 + 保存按钮），下半是「只读事实层 / 原始输出」；chunk 入口
改导出 `RowConfigPage`，主包座位表把行级槽的 `exportName` 从 `RawOutputPage` 换成 `RowConfigPage`
（主包字节不变：56,279 B）。

- 真机（行级页）实测：`config-page` / `config-write-channel` / `config-write-preview` /
  `config-managed-ports` / `config-policy` / `config-scope` / `config-refresh-ports` / `config-raw-page`
  **同一页**全在；分组标题只有「写通道」与「只读事实层」两个；进页原始输出读 **0** 次。
- 判据：`config-page.test.tsx` **C15**（六处 testid 全在 + 原始输出在配置页**之后** + 进页零读）。
- 组合包卡片页仍保留整页（今早主人拍板「插件进来但没有点进子组件的地方」），两页共用同一份
  `settings` 管道与 `write` 接线 ⇒ 同一份 live 状态的两个入口，保存后刷新即见。
- 证据：[evidence-row-page-config-all.png](./evidence-row-page-config-all.png)、
  [evidence-row-page-write-and-raw.png](./evidence-row-page-write-and-raw.png)。

#### 六订·六（同日，主人第六次拍板：「写通道预演 只读事实层 这两个的css保持和其他一致，以及内页有了的外页就不需要了」）

两件事一起做：

1. **版式统一到 `ConfigField`**：`写通道预演` 与 `原始输出` 不再是「分组框 + 卡片」
   （`.wdp-cfg-group` / `.wdp-cfg-cards` / `.wdp-cfg-card*` 规则已从 `config-css.ts` 删除），
   改成与页面上其他项**同构**的一个 field：标签行（可带右侧小字）→ 控件 → 一句说明，
   相邻项之间走 `.wdp-cfg-field + .wdp-cfg-field` 的 0.5px 分隔线。
   新增 `.wdp-cfg-field-body`（控件竖向排、原文占满整行）。
2. **组合包卡片页不再挂配置页**（原话「内页有了的外页就不需要了」）：`index.ts` 只注册
   **行级**槽（`plugins.row.config`，键 `dsh-wsl-docker-ports#wsl-ports`），`chunk-ports.ts`
   不再导出 `ConfigPage`，只导出 `RowConfigPage`；`config-slot.ts` 的 `CONFIG_SLOT_NAME` 常量保留
   （工具文档/测试仍引用），但不再有调用方。

- 判据：`write-style-gate.test.tsx` ⑩ 改为「`CONFIG_CSS` 里不许再有 `.wdp-cfg-group` / `.wdp-cfg-card`，
  且必须有 `.wdp-cfg-field-body`」；`config-raw-page.test.tsx` R1 断言 `config-raw-output-card`
  的 class 是 `wdp-cfg-field-body`、标题 class 是 `wdp-cfg-label`；`entry.test.tsx` 断言
  组合包级槽 `toHaveLength(0)`、总注册 3 个、effect 3 个。
- 真机：行级页 `.wdp-cfg-field` 共 **8** 个 —— 目标发行版 / 端口转发页刷新频次 / 容器页刷新频次 /
  提权策略 / 端口声明（managedPorts）/ 写通道预演 / 端口作用域 / 原始输出；`.wdp-cfg-group` 与
  `.wdp-cfg-card` 命中 **0**；组合包卡片页 `config-row-page` 命中 **0**（不再有配置页）。
- 体积：主包 **56,145 B**（地板 56,350，余 205 B —— 删掉组合包座位反而腾出 186 B）。
- 证据：[evidence-row-page-unified-fields.png](./evidence-row-page-unified-fields.png)。

#### 六订·九 / 六订·十（同日，主人第七次、第八次拍板）

主人原话：「容器页刷新频次 把这个移到容器的内页里面」「原始输出 这个标签离上面再远点」「再远点」。

1. **容器页刷新频次搬进容器行自己的配置页**：转发行配置页不再渲染它、不再写
   `wsl-containers.refreshIntervalSec`（`config-page.tsx` 删字段、`config-model.ts` 删
   `containersRefresh`）；容器行配置页（`wsl-docker-containers` 的
   `containers/config-page.tsx`）新增「容器页刷新频次」下拉（关闭 / 15 / 30 / 60 / 5 分钟，
   改一次写一次，读自本行命名空间）。转发行保存时容器命名空间**只**收共用的 `distro`。
2. **原始输出与上面拉开距离**：`.wdp-cfg-raw { margin-top: 52px; }`（28 → 52，主人连说两次）。
3. 🔴 **顺带修掉一个真机缺陷（不属加戏，是第 1 条能成立的前提）**：容器行的配置页
   **一直进不去** —— 宿主 `dsh-client-ui-plugin-manager/lib/client.js:2357` 用
   `ledger.rows.has(rowConfigKey(pkg.name, row.rowId))` 查键，`pkg.name` 是**卡片所属包**
   （= `dsh-wsl-docker-ports`），而容器包按「本包名」注册成
   `dsh-wsl-docker-containers#wsl-containers` ⇒ 查不到 ⇒ 该行没有「配置」按钮。
   改成 `dsh-wsl-docker-ports#wsl-containers` 后按钮出现、页面可达（截图已验）。

- 判据：`containers-config-page.test.tsx` R1–R3（初值 30 秒 / 关闭档文案 / 无管道不装成能用）；
  `config-page.test.tsx` C1 断言本页**没有** `config-refresh-containers`、C3 断言容器命名空间
  只收 `distro`、C5 用 distro 触发容器命名空间失败；`containers-surface.test.ts` 改为断言复合键。
- 真机：容器行页 `inp-containers-config-refresh` 在、值 0、选项五档、文案「容器页不自动刷新（只手动）」；
  转发行页 8 个字段里**没有**「容器页刷新频次」，`.wdp-cfg-raw` 与上方保存条的实测间距 **52 px**。
- 证据：[evidence-containers-row-refresh.png](./evidence-containers-row-refresh.png)、
  [evidence-ports-row-gap-52.png](./evidence-ports-row-gap-52.png)。

#### 六订·十一（同日，主人第九次拍板）

主人原话：「查看原始输出/收起原始输出 理应是两个按钮，点击查看原始输出的时候下拉一个窗口展开里面是内容，点收起的时候收回」。

- **两个独立按钮**：`config-raw-output`（只看展开，文案「查看原始输出」/ 读取中「读取中…」）与
  `config-raw-output-collapse`（只看收回，文案「收起原始输出」）；展开后第一个按钮**不渲染**，
  收起后第二个**不渲染** —— 不是同一个按钮换字。
- **下拉一个窗口**：原文包在 `.wdp-cfg-raw-panel`（1px 边框 + `radius-md` + `bg-layer-2` +
  `padding 10/12` + `max-height 260px` 可滚）里，`config-raw-output-panel` 是它的 testid。
- 缓存语义不变：展开读一次，收起/再展开**零新增读**（`reads` 仍为 1）。
- 🔴 **订正（六订·十一补）**：主人紧接着说「我是让你把它变成按钮！！！」—— 先前用了 `wdp-textbtn`
  （文字链外观）⇒ 改成真按钮：`className="wdp-btn wdp-cfg-raw-btn"`，状态 ≈ **122 × 30 px**、
  `border 1px`、`radius 8px`、`bg rgb(53,54,56)`（layer-3）；CONFIG_CSS 里自带一份
  `.wdp-cfg-raw-btn`（边框/圆角/底色/`:hover`/`[disabled]`/`:focus-visible`），不依赖主包样式是否已装。
  判据：`config-raw-page.test.tsx` R1 断言 `tagName === 'BUTTON'` 且 `className` 含 `wdp-btn`。
- 🔴 **订正（六订·十一再补）**：主人又指「css 和其他按钮保持一致」—— 我先自造了一套
  `.wdp-cfg-raw-btn`（30 px 高 / 12 px 内边距 / 1 px 边框 / `radius 8`）⇒ 与同页「预演（只读，零写入）」
  对不上。**改法**：删掉自造皮，直接用配置页共享的 `.wdp-cfg-btn`（`height 34` / `padding 0 14` /
  `0.5px border-l4` / `radius-md 12` / `bg-layer-3` / `13px`）。实测两颗按钮除宽度（文字长度）外
  完全一致：`wdp-cfg-btn · 34 px 高 · radius 12 px · bg rgb(53,54,56) · padding 14 px · 13 px`。
  判据：`config-raw-page.test.tsx` R1 断言 `className === 'wdp-cfg-btn'`（不再允许自造类）。
#### 六订·十二（2026-10-28，主人第十次拍板）

主人原话：「把 WSL Docker 容器（本行配置）『只显示容器行独占的字段：刷新频次与通道凭据。目标发行版是
两个组件共用的……』这些字去掉 剩下的东西保持 css 和其他的一致」。

- **删字**：容器行配置页不再自带 `<h3>WSL Docker 容器（本行配置）</h3>` 与那段说明（宿主已经在上方画了
  「Docker Containers」标题与行描述，重复讲一遍只是噪音）。
- **换版式**：字段语法与转发侧配置页同一套 —— `.wdp-cfg` / `.wdp-cfg-field`（`padding 12px 0`、
  相邻 0.5px `border-l2` 分隔）/ `.wdp-cfg-label`（13px / 500）/ `.wdp-cfg-input`
  （34px / `radius-md` / `bg-layer-3` / 0.5px `border-l4`）/ `.wdp-cfg-btn`（34px / 14px 内边距）/
  `.wdp-cfg-hint`（12px / `label-tertiary`）。实测：`select` 34px / radius 12 / `rgb(53,54,56)`；
  「保存凭据」34px / radius 12；label 13px；field 上内边距 12px ⇒ 与转发侧逐项一致。
- 🔴 **体积账**：这 15 条规则塞进主包 `styles.ts` 会让容器主包 **31,324 → 34,202 B**，顶穿棘轮地板
  （`main-bundle-budgets.mjs` 的 `dsh-wsl-docker-containers: 31,324` 只降不升）⇒ 搬到 chunk 侧新模块
  `containers/config-css.ts`（挂载时注入、卸载时移除），主包回到 **31,324 B**、
  `client.containers.js` 23,700 → **27,282 B**（chunk 无地板），`assert-client-split` 14/14 绿。
- 判据：`containers-config-page.test.tsx` R1 增加「没有『本行配置』/『只显示容器行独占』字样」+
  `label`/`select`/`button` 的 `className` 分别是 `wdp-cfg-label` / `wdp-cfg-input` / `wdp-cfg-btn`。
- 证据：[evidence-containers-row-config-clean.png](./evidence-containers-row-config-clean.png)。
#### 六订·十三（2026-10-28，主人第十一次拍板）

主人原话：「这个页面缺少保存键」。

- **补一条页脚**：`.wdp-cfg-footer`（`padding-top 16` + 0.5px `border-l2` 上分隔）左边状态字右边
  「保存设置」，与转发侧同一条版式；保存键用 `.wdp-cfg-save`（主色填充 / `radius-md` / `5px 14px` /
  disabled 透明 .4），实测 **82 × 32 px / radius 12**。
- **改成草稿语义**：改下拉或填凭据 = 「有未保存的改动」⇒ 保存键才可点；点一次只写**脏了的那几项**，
  写完状态回「设置已保存」+ 一行 `设置已保存：容器页刷新 → N 秒`。原先「下拉一改就写」与单独的
  「保存凭据」按钮一并收进这条页脚 —— **一页一个保存键**（转发侧同理）。
- 判据：`containers-config-page.test.tsx` R1（初值 30 → 改 60：**改完 0 写**、状态转「有未保存的改动」、
  保存键解禁 → 点保存后**恰好 1 写** `refreshIntervalSec:60` → 状态回「设置已保存」）、
  R3（凭据填了就脏、保存才写 `writeWriteToken`、写完清空并标「已配置」、`refresh` 没动就不写）、
  R4（无管道时连保存键都不出现）。
- **真机**（acceptance 实例 43391）：`0 → 15 秒` 点保存 → 提示「设置已保存：容器页刷新 → 15 秒」，
  `~/.dsh/profiles/accept-docker-ports/cordis.patch.yml` 的 `wsl-containers.refreshIntervalSec` 落盘为 `15`；
  随后 `15 → 关闭(0)` 再保存 → 落盘回 `0`（**验收后已还原**）。
- 证据：[evidence-containers-row-save.png](./evidence-containers-row-save.png)（「有未保存的改动」+ 保存键亮点）。
#### 六订·十四（2026-10-28，主人第十二次拍板）

主人原话：「回到侧边栏这边，这个css和插件配置内页保持一致」（截图指向右侧栏容器页的「刷新」键）。

根因：侧边栏 `pane.tsx` 的按钮**一个 className 都没有**（`<button>` 裸元素 ⇒ 吃宿主默认外观，
截图里那种白描边就是这么来的），而配置内页用的是 `.wdp-cfg-btn` / `.wdp-cfg-input`。

- **同一份样式、同一个类**：`pane.tsx` 挂载时 `installConfigStyles()`（幂等），按钮改用
  `wdp-cfg-btn`、凭据输入框改用 `wdp-cfg-input` ⇒ 与配置内页**字面同一套规则**，不是抄数值。
- 表格行内动作（启动/停止/重启/日志）用 `wdp-cfg-btn wdp-cfg-btn-sm`（26px，否则 34px 会把行撑开）；
  `.wdp-actions { display:flex; flex-wrap:wrap; gap:4px }` 让它们横排（原先竖着堆 4 层）。
- 实测（侧边栏 417 px）：刷新 **34 × 56**、保存凭据 **34 × 82**、行内动作 **26 × 30**，
  三者 `radius 12` / `bg rgb(53,54,56)` / 边框 `1px rgba(255,255,255,0.2)` —— 与配置内页「保存设置」逐项一致。
- 判据：`containers-pane.test.tsx` 断言 `btn-containers-refresh` 的 `className === 'wdp-cfg-btn'`。
- 证据：[evidence-containers-pane-buttons.png](./evidence-containers-pane-buttons.png)。
- ⚠️ **未做（留给你拍板）**：侧边栏表格仍是 5 列铺在 417 px 里，「状态」「动作」列换行/横向溢出，
  行高被文字换行撑到 124 px。这属于**布局**不是按钮样式，未擅自改。
#### 六订·十五（2026-10-28，主人第十三次拍板）

主人原话：「你先把两个侧边栏的css都和内页配置页统一好吗？剩下的我们挨个调整」。

**先把「统一」定义成可复算的四件事**（不然「看起来差不多」永远说不清）：

| 维度 | 口径 | 改前 | 改后 |
| --- | --- | --- | --- |
| 按钮盒子 | 34px 高 / `padding 0 14` / `radius-md` / `bg-layer-3` | 转发侧 `.wdp-btn` 28px+`radius-sm`；容器侧按钮**无 className** | 全部 34 / 0 14 / radius 12 |
| 保存键 | 同一个盒子里只换「主色填充」 | `.wdp-cfg-save` 靠 `padding 5px 14` 拼出 32px | `height 34` / `padding 0 14` ⇒ 34px |
| 输入框/下拉 | 34px / `radius-md` / `bg-layer-3` | 转发侧 `.wdp-input` 已是 34；容器侧裸元素 | 容器侧改挂 `.wdp-cfg-input` |
| 表格分隔线 | `0.5px solid var(--dsw-alias-border-l2)` | 容器侧写着**宿主不存在的** `--dsw-alias-border-secondary` ⇒ 回落 `currentColor`（惨白 1px） | 0.5px / `border-l2`（实测 `rgba(255,255,255,0.12)`） |

**两个侧边栏各自动了什么**

- **转发侧（chunk `client.ports.js`）**：`styles.ts` 的 `.wdp-btn` 从 `28px/0 10/radius-sm/12px` 抬到
  `34px/0 14/radius-md/13px`（与 `.wdp-cfg-btn` 逐项同值，主包**零字节增长**：四处替换都等长）；
  删掉 `.wdp-card .wdp-btn` 与 `.wdp-cfg-plan .wdp-btn` 两条 30px 特例 —— 内页那排按钮也回到 34px。
- **容器侧（chunk `client.containers.js`）**：`PAGE_CSS` 重写 —— 删掉 14 条**没人用**的死选择器与
  7 处**假 token**（`border-primary` / `border-secondary` / `border-accent` / `bg-accent` /
  `state-danger` / `state-success` / `state-warning`），只留侧栏骨架（`.wdp-containers` / `.wdp-row` /
  `.wdp-toolbar` / `.wdp-table` / `.wdp-muted` / `.wdp-note` / `.wdp-warn` / `.wdp-danger` /
  `.wdp-pre` / `.wdp-logs` / `.wdp-notes` / `.wdp-actions` / `.wdp-tab-title`），颜色一律真名 token。
  按钮/输入框/保存键由 chunk 的 `config-css.ts` 供给（`installConfigStyles()` 在 `pane.tsx` 与配置页都调）。
- **主包反而瘦了**：31,324 B → **30,961 B**（删死代码 + 假 token 名换短名）。

**新增两条静态门（可复算，不是「看着像」）**

- `packages/wsl-docker-ports/tests/client/sidebar-style-parity.test.tsx`：逐条比 `.wdp-btn` 与
  `.wdp-cfg-btn` 的高度/内边距/圆角 token/底色 token，四项全同；再验输入框共用 `.wdp-input`。
- `packages/wsl-docker-containers/tests/client/sidebar-style-parity.test.tsx`：`PAGE_CSS` **零假 token**、
  表格线 = `0.5px border-l2`、侧栏控件只认 `.wdp-cfg-*`、`pane.tsx` 与配置页都注入同一份表。

**真机实测（acceptance 实例 43391）**

- 侧边栏（417px）：刷新 **34 × 56** / 保存凭据 **34 × 82** / 行内动作 **26 × 30**，`radius 12`、
  `bg rgb(53,54,56)`；表格 `td` 分隔线 `1px rgba(255,255,255,0.12)`（改前是 `currentColor` 近白）。
- 内页：下拉 **34 × 799**、保存设置 **34 × 82**（改前 32），`radius 12`。
- 证据：[evidence-sidebar-containers-unified.png](./evidence-sidebar-containers-unified.png)（侧栏）、
  [evidence-inner-config-34.png](./evidence-inner-config-34.png)（内页）。

**没做（按主人「剩下的我们挨个调整」）**：转发页表格仍是 5 列挤在 417px、容器页「状态/动作」列
换行与横向溢出（布局问题）；`.wdp-sec` vs `.wdp-cfg-field` 两套段落壳的取舍；`.wdp-muted` vs
`.wdp-cfg-hint` 是否合并成一个名字。这些都不影响「按钮/输入框/表格线已经同值」这条判据。
#### 六订·十六（2026-10-28，主人第十四次拍板）

主人原话：「你看到右侧的这下滚动条了吗？我希望长度能够自动满足，不要每块都加一个滚动条，不够的
自动挤占下方空间，整个侧边栏应该只有一个总的滚动条」。

**根因（真机 43391 / 侧栏 417px 实测，不是猜）**

- 宿主的 tab body 是滚动容器（`.P3OORG_tabBody`，`overflow-y: auto`），并且它给页面根**内联**写了
  `height: auto; min-height: 0; overflow-y: visible` ⇒ 页面根自己不滚。
- `.wdp-page` 是 `display: flex; flex-direction: column` ⇒ 每个 `.wdp-sec` 是 flex item，会被**压缩**。
  实测六个段落：`h 49 / sh 95`、`129 / 307`、`44 / 75`、`269 / 728`、`86 / 182`、`170 / 429`。
- 而 `.wdp-sec` 上那句 `overflow-x: auto` 按 CSS 规范会把**另一轴**也算成 `auto`
  ⇒ 被压缩的每块**自己长出一条竖向滚动条** = 主人截图里那一列小滚动条。

**改法（3 处，主包 56,238 → 56,245 B）**

- `.wdp-page > * { flex: none; }` —— 子块**不许被压缩**，内容撑开、往下挤（新增一条规则）。
- `.wdp-sec` 去掉 `overflow-x: auto`；`.wdp-pre` 的 `overflow-x: auto` 换成 `overflow-wrap: anywhere`
  —— 谁都不许自滚，长串靠断行。
- 顺带治掉两条**横向**溢出：`.wdp-table` 的 `min-width: 460px` 删除（侧栏只有 412px）、
  `.wdp-gate` 加 `overflow-wrap: anywhere`（提权提示里那句 `HKLM\SOFTWARE\…` 原来溢出 38px）。

**真机复测（同一个实例）**

```
六个段落：h 95/340/76/729/202/443 —— 每块 scrollHeight == clientHeight（squished 0）
横向溢出：0（改前 提权策略 426>388、端口转发 460>388）
滚动容器：只有宿主 tab body 一个（overflow-y auto，scrollHeight 2003 / clientHeight 879）
```

- 新判据：`packages/wsl-docker-ports/tests/client/sidebar-scroll-gate.test.tsx`（4 条静态门：
  `.wdp-sec` 不许自滚 / `.wdp-page > *` 必须 `flex: none` / `.wdp-pre` 断行 / 表格不许写死 460px）。
- 证据：[evidence-ports-single-scroll.png](./evidence-ports-single-scroll.png)。
- 备注：容器页那一栏本来就是单滚（实测块内滚动容器 **0** 个），这次没有它的改动。

#### 六订·十七 ~ 六订·二十一（2026-10-28，主人第十五~十九次拍板，七条一起收）

主人这一轮把待办编号发下来（P1–P7），逐条落地如下。

**P1 括号前转行 + 按钮加高**（原话：「在括号前转行并让按钮加高」）

- 两个按钮的字面拆成「主文本 + `<span class="wdp-btn-sub">（…）</span>`」，主文本一行、括号整体一行，
  括号**不许**再从中间断开（改前侧栏 417px 里是 `（二次确` / `认）`）。
- 版式走 **chunk**（`config-css.ts` 的 `.wdp-btn-stacked`：`inline-flex / column / height auto /
  min-height 34 / padding 5px 14px / line-height 1.35`，`.wdp-btn-sub` = `white-space: nowrap`）
  —— 主包当时只剩 **105 B**，塞不进 163 B 的规则；同时让右栏页也 `installConfigStyles()`
  （此前只有配置页装这张表）。
- 真机：两枚按钮 **34 → 47px**，`flex-direction: column`，`sub nowrap`。

**P2 凭据与复制按钮同一行，凭据横向滚**（原话：「把生成的凭据和按钮放到一行，压缩凭据的宽度…
宽度不够不要自动向下扩展高度，直接用横向滚轮。宽度随窗口宽度调整」）

- 结构：`.wdp-once-row`（flex / gap 8）+ `.wdp-once-code`（`flex: 1 1 auto; min-width: 0`）
  + `.wdp-once-copy`（`flex: none`）；`.wdp-once-code .wdp-pre` 回到 `white-space: pre` +
  `overflow-x: auto`（**只这一处**允许横向滚，六订·十六 的「谁都不许自滚」讲的是纵向）。
- 顺序也按主人要求挪了：**生成键 → 凭据行 → 「再点一次 = 轮换…」提示**（原来提示在凭据前面）。
- 真机（388px 行宽）：凭据框 **42px 高（单行）**、宽 259（`scrollWidth 404 > clientWidth 259` ⇒
  出横向滚轮、不换行不长高），复制键 34px、同一行、间距 8。

**P3 勾选维护的端口一律用逗号**（原话：「通过打勾维护上来的都用逗号维护」）

- `managedPortsText` 的回填从 `\n` 改成 `', '`；读入侧继续认换行 / 全角逗号 / 顿号（两种写法等价）。
- 勾选本身当场按逗号重排（`togglePreset` 纯函数）：勾上并进原文、取消从原文里摘掉**恰好等于该端口号**
  的那一项（否则「取消了却还在」）。已知取舍写进代码注释：用户自己敲的同一个数字，勾一次再取消会被摘掉。
- 真机：配置页 textarea 回填 = `3306, 1521, 8080, 5432, 6379, 27017, 5672, 9092, 9200, 8848, 9000, 5173, 5000`
  （13 个 preset 全勾，零换行）。证据：[evidence-ports-comma-backfill.png](./evidence-ports-comma-backfill.png)。

**P4 三个动作按钮改名**（原话：「这三个按钮上的字改名为 转发 移除 修复」）

- `buildForwardActions`：`应用转发 → 转发`、`移除转发 → 移除`、`修复漂移 → 修复`（`testid` 与
  `kind` 一字不动，只是字面变短；侧栏 417px 里不再挤成两行）。

**P5 容器页凭据行 + 保存键 + 表格距离**（原话：「把粘贴凭据的输入框和按钮放到一行，压缩凭据的宽度…
把【保存凭据】改为【保存】且下方表格距离需要再远点」）

- `.wdp-token-row`：`flex-wrap: nowrap` + 输入框 `flex: 1 1 auto; min-width: 0; width: auto` +
  按钮 `flex: none`（改前输入框 `width: 100%` 把按钮挤到下一行）；密码输入框天然横向滚、宽度随窗口。
- 按钮字面 `保存凭据 → 保存`；表格 `.wdp-table` 加 `margin-top: 6px`（真机：输入框与保存键同一行、
  输入框 348px，**表格顶距保存键底 20px**）。

**P6 表头字号加大加粗**（原话：「表头字号加大加粗」）—— `.wdp-table th` `11px/500 → 12px/600`
（真机 `12px/600`）。

**P7 全页纵向滚动条**（原话：「缺少全页纵向滚动条」）

- 根因与转发侧六订·十六同源：宿主的零高包装盒 + `overflow: hidden` 祖先把内容裁住。容器页原先**没有**
  `usePageScrollFix` ⇒ 只能看第一屏、滚不动。
- 改法：容器侧补 `src/client/containers/page-scroll.ts`（与转发侧 `pane-scroll.ts` 同一手法：页根自然高度、
  往上第一层非 `visible` 的祖先设成 `overflow-y: auto`），`pane.tsx` 用根 ref 调用。
- 真机：滚动容器只剩 `.P3OORG_tabBody` 一个（`scrollHeight 4848 / clientHeight 879`，滚动 ✓），块内 0 个。

**顺带修掉的真 bug（六订·二十一）：chunk 样式被「先删后插」互踩**

- 现象：从插件配置页返回右栏，转发侧两行按钮与凭据行版式**一起消失**（实测
  `style[data-plugin="dsh-wsl-docker-ports/config"]` 不存在，`.wdp-btn-stacked` 计算值退回 `block`）。
- 根因：侧栏页与配置内页**共用同一个 STYLE_ID**，而 `installConfigStyles` 是「先删同名节点再插自己 +
  卸载时删自己」⇒ 后挂载者删掉前者、前者卸载时再删自己 ⇒ 两边都没了。
- 改法：**引用计数**（第一个消费者插入、最后一个离开摘除），两包同步改。真机复测：切到容器页再切回转发页，
  `dsh-wsl-docker-ports/config` 在场、两行按钮 47px 稳定。

**判据（新增/更新，全部二值）**

- `tests/client/sidebar-style-parity.test.tsx` +4 条：两行版式（column / height auto / min-height 34）、
  `.wdp-btn-sub` nowrap、两个按钮字面已拆 `span`（且原文整串不再出现）、右栏也装 chunk 表。
- `tests/unit/config-managed-text.test.ts` 4 条：勾选并进原文用逗号、取消摘掉该项、多行归并成逗号、
  按端口号去重。
- `tests/unit/client-rows.test.ts` 回填判据改成逗号（并加「读入侧仍认换行」的等价性）。
- `tests/client/config-page.test.tsx` C12 改成「回填逗号、不含换行」。

**门（本轮实跑）**

| 包 | node --test | vitest | tsc ×3 | borders | exports | split | loader | p2 | size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wsl-docker-ports | 448/448 | 24 files / 195 | 0 / 0 / 0 | 245 绿 | 25/25 | 20/20（主 **56,245** / 上限 56,350，余 105） | 40/40 | 0 | 0 |
| wsl-docker-containers | 26/26 | 4 files / 25 | 0 / 0 / 0 | 245 绿 | 22/22 | 14/14（主 **31,141** / 上限 31,324） | 13/13 | 无此脚本 | 0 |

**证据**：[evidence-ports-stacked-and-credential-row.png](./evidence-ports-stacked-and-credential-row.png)
（两行按钮 + 凭据行 + 顺序）、[evidence-containers-token-row-p5-p7.png](./evidence-containers-token-row-p5-p7.png)
（容器页：凭据输入框与「保存」同一行、表头加粗、表格拉开、整页一条滚动条）、
[evidence-ports-comma-backfill.png](./evidence-ports-comma-backfill.png)（端口声明逗号回填）。

**没做（照旧只报不改）**：转发侧表头**实测已跟着变成 12px/600** —— 因为两包都在同一文档里定义 `.wdp-table th`（跨包同名类，本轮未动，见报告）；端口声明 textarea
仍是 `rows={3}` 的最小高（一行内容也占三行高度的空白）；5 列挤 417px 的换行问题。

#### 六订·二十二（2026-10-28，主人第二十次拍板）

主人原话：「这里显示端口声明的时候按照 数字从小到大排序」（截图 = 右栏页只读的「端口声明（managedPorts）」块）。

**改法（只动展示，不动数据）**

- 新增纯函数 `sortDeclaredText`（`src/client/rows.ts`）：按每项的**前导数字**排序
  （`3306` 与 `1000-3000` 都拿起始号 1000 比），不是数字开头的项（非法项）**排最后且保持原顺序**
  —— 非法项要原样看得见，不许被排序藏起来或被「修好」；分隔符与 `mergeManagedPortsDecl` 同一套
  （逗号 / 换行 / 全角逗号 / 顿号），输出统一半角逗号。
- 只读块 `ManagedPortsSummary` 用它渲染；**草稿 / 写入口 / 保存一律仍用原始顺序的那一份**
  ⇒ 排序不会制造「假脏」（改了顺序不会让保存键无故解禁）。
- 版式零改动（仍在 chunk 里，主包 56,245 B 不变）。

**真机复测（43391）**

```
改前：3306, 1521, 8080, 5432, 6379, 27017, 5672, 9092, 9200, 8848, 9000, 5173, 5000
改后：1521, 3306, 5000, 5173, 5432, 5672, 6379, 8080, 8848, 9000, 9092, 9200, 27017
       ascending = true（13 项，逐项 <= 后一项）
```

- 判据：`tests/unit/client-rows.test.ts` T5.10 一条 5 组断言（乱序升序 / 区间按起始号 / 非法项排最后 /
  换行·全角逗号·顿号照认 / 空串不炸）。
- 证据：[evidence-ports-declared-sorted.png](./evidence-ports-declared-sorted.png)。

**没做**：配置页 textarea 仍按**原始顺序**回填（那是可编辑草稿，排序会把用户刚敲的顺序打乱）；
常用端口那一行的中文标签顺序也没动（它跟 preset 表序走）。

#### 六订·二十三（2026-10-28，主人第二十一次拍板）

主人原话：「docker容器页面的总margin和端口转发的保持一致」。

**改前实测（43391 / 侧栏 412px）**

```
转发页 .wdp-page      padding: 0px 12px 12px   首个子元素相对页面左内边距 = 12px
容器页 .wdp-containers padding: 0px            首个子元素相对页面左内边距 = 0px   ← 贴边
```

**改法（一行，主包 31,141 → 31,163 B）**

`.wdp-containers` 补上 `padding: 0 12px 12px;` —— 与转发侧 `.wdp-page` **逐字同值**（左右各 12、底部 12、顶部 0）。
内部 `gap` 仍是 10px（转发侧是 `.wdp-sec` 的 `padding: 12px 0` 自己撑出的 24px 间距）—— 这一项没动，
因为主人这句点的是**总留白**；要连内部节奏一起并轨再说一声。

**真机复测（同一个实例）**

```
容器页 .wdp-containers  padding = "0px 12px 12px"  首个子元素左内边距 = 12px
转发页 .wdp-page        padding = "0px 12px 12px"  首个子元素左内边距 = 12px
```

- 判据：`tests/client/sidebar-style-parity.test.tsx` 第 ⑤ 条（`.wdp-containers` 必须带 `padding: 0 12px 12px`，
  且与写死的转发侧同值 `padding: 0 12px 12px;` 对齐 —— 改一边不改另一边就红）。
- 证据：[evidence-containers-page-padding.png](./evidence-containers-page-padding.png)。

**订正（同日，主人第二十二次拍板）**：「容器margintop还是小了」⇒ 顶留白 `0 → 8px`
（`padding: 8px 12px 12px`）。为什么是 8 而不是 12：首行那枚 34px 按钮在 42px 行高里**自带 4px 居中留白**，
所以 8 + 4 = **12px** 才是「首屏内容距侧栏顶」与转发侧（`.wdp-sec` 的 12px）真正齐平的那个数。
真机复测：容器页 `padding = 8px 12px 12px`、首个控件距侧栏顶 **12px**（= 转发侧 12px）；
判据同步改成第 ⑤ 条（`padding: 8px 12px 12px`）。证据：[evidence-containers-page-padding.png](./evidence-containers-page-padding.png)。

**没做（老问题，仍只报不改）**：容器页 5 列表格实测 `width 558px` > 内容宽 388px ⇒ 右边「状态/动作」
两列被裁到侧栏外（本轮加了左右各 12px 的内边距后更明显）。要修得先定一条：缩列宽 / 横向滚 / 改两行卡片，
三条都动版式，等主人拍。

#### 六订·二十四（2026-10-28，主人第二十三次拍板）

主人原话：「端口转发（五态）的名字改为 端口转发 并且把位置提到刷新按钮的下面」。

**改法（两处）**

- 标题：`pane-tables.tsx` 的 `<h3>端口转发（五态）</h3>` → `<h3>端口转发</h3>`。
- 位置：`pane.tsx` 里把 `<PortsBlock …/>` **连同紧跟它的 `udpTip` 提示**整块上移到
  `PaneHeader`（刷新那一行）之后、`NatGateBlock` 之前 ⇒ 右栏第一块就是端口表。
- 顺带说明一条**与旧记录相反**的取舍：010 那次拍板要求「提权档放最上面」（当时主人两次找不到），
  这次主人明确要端口表紧跟刷新行 ⇒ 提权档退到第三块。两次都是主人明令，以最新为准，旧注释保留在代码里备查。

**真机复测（43391，右栏 412px）**

```
子块顺序：.wdp-head(刷新/上次刷新/eth0) → section h3「端口转发」(带表) → p.udpTip
          → section h3「NAT 硬前提」 → section h3「提权策略」 → 外部规则 → 端口声明 → 写通道凭据
h3 文本：["端口转发","NAT 硬前提","提权策略","外部规则（只读，13 条）","端口声明（managedPorts）","写通道凭据"]
端口表是第一个 section ⇒ true
```

- 判据：`tests/client/sidebar-style-parity.test.tsx` 新增 describe 三条 ——
  ① 标题已去「（五态）」且旧串不再出现；② `<PortsBlock>` 在 `<PaneHeader>` 之后、`<NatGateBlock>` 之前，
  且两者之间**不许夹** Elevation / ManagedPorts / WriteToken / ExternalRules 任何一块；
  ③ `udpTip` 必须在端口表与 NAT 块之间（跟着表走）。
- 证据：[evidence-ports-first-and-renamed.png](./evidence-ports-first-and-renamed.png)。

**关于「nat」**：这句尾巴只有一个词，我按最保守的读法处理 —— NAT 硬前提块**留在端口表下面**（不改它的内容）。
若主人是想让「NAT 硬前提」也一起上移到刷新行下面（或者指非 NAT 时的置灰提示），说一声，一行就能换。

#### 六订·二十五（2026-10-28，主人第二十四次拍板，四小项一起收）

主人原话：「端口转发（五态）的名字改为 端口转发 并且把位置提到刷新按钮的下面，nat硬前提的上面，表格去掉证据列。
监听地址与声明作用域不一致（事实位，不判冲突）这个字改为监听地址与声明作用域不一致，
表格内其他按钮的大小和 docker 容器页的表格内的按钮字号都和表格内其他字号保持一致」。

**逐项落点**

1. **改名 + 位置**（六订·二十四已做，这次确认口径）：`端口转发` 是 `PaneHeader` 之后的第一个
   `section`，顺序恒为 **刷新行 → 端口转发 → NAT 硬前提 → 提权策略 → …**（判据见六订·二十四的第 ② 条）。
2. **表格去掉「证据」列**：表头从 5 列变 4 列（端口 / 状态 / 作用域 / 动作）。
   原证据列里的**漂移原文**与**修复序列（先删后加）**没有丢 —— 它们**并入「状态」列**末尾，
   `data-testid="drift-<port>"` / `fix-<port>` 一字不动（既有 009 用例仍按这两个 testid 取文本）。
3. **事实位文案收紧**：`监听地址与声明作用域不一致（事实位，不判冲突）` →
   `监听地址与声明作用域不一致`（括号里的解释交给 Spec，界面只留事实）。
4. **表格内按钮与表格正文同字号同高**：新增 `.wdp-table .wdp-btn { height: 26px; padding: 0 8px; font-size: 12px; … }` ——
   与 `.wdp-table` 的正文 `font-size: 12px` **同值**，也与容器页表格行内动作 `.wdp-cfg-btn-sm`（26px / 12px）**同值**。
   同一行的作用域下拉带着 `wdp-btn` 类 ⇒ 一并变 26px / 12px（同一行里不出现两种高度）。

**真机复测（43391 / 右栏 412px）**

```
端口表：heads = ["端口","状态","作用域","动作"]（4 列，无「证据」）
        td 字号 12px · 行内按钮 12px / 高 26px（文本「转发」）· 作用域下拉 12px / 高 26px
        事实位文案 = "监听地址与声明作用域不一致"
容器表：heads = ["名称","镜像","状态","端口","动作"]
        td 12px · th 12px · 行内按钮 12px / 高 26px（文本「启动」）   ← 本来就是同值，这轮无需改
```

- 判据：`tests/client/sidebar-style-parity.test.tsx` 新增 describe 四条 ——
  ① thead 恰好 4 列且不含「证据」；② `drift-` / `fix-` testid 仍在；③ 事实位文案已收紧（`不判冲突` 不再出现）；
  ④ `.wdp-table .wdp-btn` = 26px / 12px，且 `.wdp-table` 正文 12px 是基准（改一边就红）。
- 证据：[evidence-ports-table-4col-26px.png](./evidence-ports-table-4col-26px.png)。

#### 六订·二十六（2026-10-28，主人第二十五次拍板）

主人原话：「⚠️ **2026-10-12 真机已订正**：…**不需要重载插件行**。 这行字去掉」。

**改法**

- `pane-settings.tsx` 的 `WriteTokenBlock` 末尾那整段 `<p data-testid="write-token-delivery">` 删除；
  同时把 `WRITE_TOKEN_TESTID.delivery` 常量一并摘掉（此后没有消费方，留着就是死码）。
- **不动**的：`写通道凭据` 块本身、布尔报数、`后果：写入口会 401…` 那段、「再点一次 = **轮换**…」提示、
  `检查服务端配置状态（只报布尔）` / `清除凭据（二次确认）` 两个按钮 —— 只删这一行说明。

**为什么可以放心删**：那段话是**给开发者/验收者的结论留痕**（2026-10-12 真机订正），不是操作说明；
结论本身仍完整记在 Spec（009 的 acceptance-round 与 017 的六订·七）与 changelog 里，界面上不必重复。

**真机复测（43391 / 右栏 412px）**

```
[data-testid="write-token-delivery"] 存在？ false
页面文本含「2026-10-12」 false ·「轮换即时生效」false ·「未验证」false ·「settings/describe」false
h3 顺序：端口转发 → NAT 硬前提 → 提权策略 → 外部规则（只读，13 条）→ 端口声明（managedPorts）→ 写通道凭据
写通道凭据块仍在（高度 464px）：本会话持有凭据：否；服务端配置 writeToken：未检查
```

- 判据：`tests/client/write-token-pane.test.tsx` 的 ③d **改写**为「这块必须不存在」——
  `queryByTestId('write-token-delivery')` 为 null，且 `2026-10-12` / `settings/describe` / `轮换即时生效` / `未验证`
  四条关键串在整块 DOM 里 0 处，凭据样值 0 处（原用例断言的是「这段话必须写全」，现在反转为「必须没有」）。
- 证据：[evidence-write-token-note-removed.png](./evidence-write-token-note-removed.png)。

#### 六订·二十七（2026-10-28，主人第二十六次拍板）

主人发来一张截断的截图（`仅本机（loopba…`）并写下：「宽度+20%」。

**改法（一字符数不变的替换）**

- `.wdp-table select.wdp-btn { max-width: 116px; }` → `max-width: 139px;`
  （116 × 1.2 = **139.2** ⇒ 取整 **139**，实测 **+19.8%**；两个值同为 5 字符 ⇒ 主包字节零增长）。

**真机复测（43391 / 右栏 412px）**

```
6 个作用域下拉实测宽度：139 / 139 / 139 / 139 / 139 / 139（改前 116）
computed max-width = 139px
表格总宽仍 388px；动作列 81px → 65px（三个按钮仍恰 42px、无截断）
标签仍是「仅本机（loopback，默认）」—— 12px 下整串约 150px，139px 仍截掉末尾 3 字，属「+20%」这一档的正常结果
```

- 判据：`tests/client/sidebar-style-parity.test.tsx` 新增 describe 一条 ——
  `max-width: 139px` 必须在场，且旧值 `max-width: 116px` 不得再出现（这条同时钉住「116 × 1.2」的换算口径）。
- 证据：[evidence-scope-select-139.png](./evidence-scope-select-139.png)。

**如果主人要的是「整串不截断」**：12px 下实测需要 ≈ **152px**（再 +9%）。那是另一个数，一句话我就改；
现在这版严格按「+20%」执行，没有擅自加码。

#### 六订·二十八（2026-10-28，主人第二十七次拍板）

主人原话：「本会话持有凭据：是；服务端配置 writeToken：未检查（这里**只报布尔**，不回显凭据本体） 和
再点一次 = **轮换**（新值覆盖旧值）… **即时生效**（旧串立即 401、新串立即 200），不需要重载插件行。 和
写操作会改动本机 `netsh portproxy` 与 Windows 防火墙规则… 这里的特殊字体没有正常加粗反而显示了 markdown 语法」。

**根因**：这些都是 JSX 里的**纯文本**（或 `string` 类型的 note），`**…**` 与反引号从来没有被解析 ⇒ 原样上屏。

**改法**

| 位置 | 修前 | 修后 |
| --- | --- | --- |
| `pane-settings.tsx` 凭据布尔行 | `**只报布尔**` | `<strong>只报布尔</strong>`（真粗体，700） |
| `pane-settings.tsx` 改动面说明 | `netsh portproxy` 带反引号 | `<code>netsh portproxy</code>` |
| `pane-settings.tsx` 401 后果行 | `plan` / `apply` / `audit` / `writeToken` + `**即时生效**` | 四个 `<code>` + `<strong>即时生效</strong>` |
| `pane-settings.tsx` 一次性凭据提示 | `**离开后将不再显示，请立即复制**` / `**不进无障碍树**` | 两个 `<strong>` |
| `pane-settings.tsx` 轮换说明 | `**轮换**`、`writeToken`、`**即时生效**` | `<strong>` + `<code>` + `<strong>` |
| `pane-settings.tsx` 确认清除提示 | `**unset**` / `**不是写空串**` | 两个 `<strong>` |

**只能出纯文本的地方**（`string` 通道，给标签就等于把标签当字显示）⇒ 把记号换成中文「」并去掉反引号：
`pane.tsx` 的 tokenNote（「已配置」/「未配置」）、`settings-pipe.ts` 的清除回执（「已配置」）、
`write-token.ts` 的 `CREDENTIAL_REJECTED_HINT` 与「只显示这一次」提示、`transport/write-auth.ts` 的 401 配置说明。

**真机复测（43391 / 右栏 412px）**

```
整页文本含 "**" ？ false       整页文本含反引号？ false
写通道凭据块里 strong = ["只报布尔","即时生效","轮换","即时生效"]   computed font-weight = 700
写通道凭据块里 code   = ["netsh portproxy","plan","apply","audit","writeToken","writeToken"]  font-family = monospace
```

- 新判据：`tests/client/raw-markdown.test.tsx`（2 条）—— 首帧与生成后各扫一遍**渲染出来的 textContent**：
  `**` 0 处、反引号 0 处；并断言 `<strong>` 里确实有「只报布尔/轮换/即时生效/离开后将不再显示，请立即复制」，
  `<code>` 里确实有「netsh portproxy / plan / writeToken」。**这条门只看渲染结果，不看源码**。
- 既有判据订正：`write-token-a11y.test.tsx` 门① 原断言「a11y 树里没有 `code` 角色」——
  那在「文案里出现真 `<code>`」之后就成了误判。已收窄为「树里没有任何 `code` 节点**承载凭据**」
  +「凭据那个 `code` 不在树里」（`isInaccessible(once) === true` 原样保留）。
- 证据：[evidence-write-token-bold-fixed.png](./evidence-write-token-bold-fixed.png)。

**只报不改**：`<code>` 走浏览器默认样式 `font-size: 0.92em` ⇒ 实测 **12px**（正文 13px），等宽字体看着略小一号。
要完全等大加一条 `.wdp-page code { font-size: inherit; }` 即可（≈55 B，主包余 73 B 够），等主人点头再动。

#### 六订·二十九（2026-10-28，主人第二十八次拍板）

主人先发一张被截断的页签截图（`WSL Docker 容…`）说「这个改名叫做 wsl 端口转发」，紧接着补一句「WSL 端口转发」
⇒ 最终定名 **`WSL 端口转发`**（WSL 大写）。

**改法（标题 + 所有指路文案必须同步，否则用户按提示去找一个不存在的名字）**

| 文件 | 改前 | 改后 |
| --- | --- | --- |
| `tab-def.ts` `PAGE_TITLE` | `WSL Docker 端口` | **`WSL 端口转发`** |
| `config-write.tsx` 预演提示 | 「WSL Docker 端口」右栏页 | 「WSL 端口转发」右栏页 |
| `write-token.ts` 两条凭据提示 | 「WSL Docker 端口」右栏页 | 「WSL 端口转发」右栏页 |
| `chunk-degrade.test.tsx` 台架标题 | `WSL Docker 端口` | `WSL 端口转发` |

**真机复测（43391 / 右栏 412px）**

```
页签文本：["WSL Docker 容器"(121px), "WSL 端口转发"(102px)]
新标题文本宽 82px = 客户端宽 82px ⇒ **不再被截断**（旧名 101px 在窄栏里会被切）
```

- 判据：`sidebar-style-parity.test.tsx` 新增 describe 一条 —— `PAGE_TITLE` 必须是 `WSL 端口转发`，
  且 `config-write.tsx` / `write-token.ts` 的指路文案必须同步到新名字（旧名 `「WSL Docker 端口」右栏页` 0 处）。
- 证据：[evidence-tab-renamed-wsl-ports.png](./evidence-tab-renamed-wsl-ports.png)。

**只报不改**：容器页页签仍是 `WSL Docker 容器`（121px，窄栏里会被截成 `WSL Docker 容…` —— 就是主人截图里那个样子）。
要不要一起改成 `WSL 容器`（≈70px，不会被截）？一个常量的事，等一句话。

#### 六订·三十（2026-10-28，主人第二十九次拍板）

主人（截图：卡片大标题 `WSL Docker Ports`、组件行也被跟着改成同名）：「你改上面的不要把下面包含组件改了，
现在把包含组件改回 WSL Port Forwarding」。问过一轮后主人选 **C：拆一个壳包**。

**根因（读宿主源码确认，不是猜）**

| 界面位置 | 宿主取值 |
| --- | --- |
| 卡片大标题 | `packageText(pkg)` ⇒ **组合包** `locale/*.json` 的 `meta.title` |
| 「包含的组件」行标题 | `rowText(row)` ⇒ 该行 `name` 指向的**那个包**的 `meta.title` |

拆包前本包既是组合包又是自己的第一行 ⇒ 两处读同一份文件，**必然同名**，改一个就是改两个。

**改法**

1. 新壳包 `packages/wsl-docker-ports-bundle`（**零代码**）：`package.json`（`dsh.bundle.patch`）+
   `cordis.patch.yml`（插 `wsl-ports` / `wsl-containers` 两行，行 id 不变）+ `locale/{zh,en}.json`
   （`meta.title` = `WSL Docker Ports`）+ `README.md`。
2. `dsh-wsl-docker-ports`：摘掉 `dsh.bundle`、交出 `cordis.patch.yml`；locale 标题回 `WSL Port Forwarding`。
3. 组合包名变了 ⇒ 客户端两个配置槽的键跟着改（宿主按 `entryKey: pkg.name` / `${bundle}#${rowId}` 匹配）：
   `CONFIG_ROW_KEY` = `dsh-wsl-docker-ports-bundle`、行级键 = `dsh-wsl-docker-ports-bundle#wsl-ports`。
   **若不改，卡片页上的「目标发行版」配置区会整块空掉** —— 这是拆包的唯一副作用，已用真机反证。
4. 验收 profile：`dependencies` 增壳包 `link:`、`dsh.profile.bundles` 改指壳包（两个真实包仍 `link:` 装，
   因为 `link:` 不装依赖），`pnpm install` exit 0。

**真机复测（43391 / 插件页）**

```
卡片大标题：WSL Docker Ports        包 id：dsh-wsl-docker-ports-bundle
包含的组件（2）：WSL Port Forwarding（wsl-ports / dsh-wsl-docker-ports）
                 Docker Containers（wsl-containers / dsh-wsl-docker-containers）
目标发行版配置区：在场（证明新的组合包键匹配成功）
右侧页签：["WSL Docker 容器", "WSL 端口转发"] 都在，无「配置页未注册」告警
```

- 判据：`tests/unit/locale-title.test.ts` 重写为 3 条**文件级**断言 ——
  ① 壳包 locale = `WSL Docker Ports` 且 `dsh.bundle.patch` 指向的文件真实存在；
  ② 本包 locale = `WSL Port Forwarding` 且 `dsh.bundle` 已摘、`cordis.patch.yml` 不在了；
  ③ 壳包 patch 插的两行 name 就是两个真实包名（反向断言：行 name 不得是壳包自己）。
- 键的判据同步：`config-slot.test.ts` 3 处、`entry.test.tsx` 3 处改为新组合包键。
- 证据：[evidence-card-vs-row-titles.png](./evidence-card-vs-row-titles.png)。

**超出主人原话的一处改动（已在报告里点名）**：`src/client/config-slot.ts` / `src/client/index.ts`
两个槽键 + 三处注释——不改则卡片配置区消失，属「拆包的必然连带」，不是顺手改。
