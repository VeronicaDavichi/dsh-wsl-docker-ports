# 实现任务：dsh-wsl-docker-ports（P1 · 容器控制）

> 任务引用 [requirements.md](./requirements.md)；设计依据见 [design.md](./design.md) 与 003 的 [`design.md`](../003-wsl-docker-ports/design.md)。
> 完成定义（每个任务）：代码 + **验证命令跑绿** + 无残留临时文件/规则。
> 🔴 **闸门**：`Phase 0` 的 `T0.1` 未达 ⇒ `Phase 1`–`Phase 3`（自 003 迁入的 `T7.1`–`T7.3`）**不得开工**。
> 口径：`pnpm -C packages/wsl-docker-ports {typecheck,test,build}`（与 003 同包同口径）。

---

## Phase 0：闸门（准入）

- [ ] T0.1 [REQ-P1-1] 闸门核对：003 的「P0 真机验收」是否通过
  - 内容：逐行核对 [003 的真机验收清单](../003-wsl-docker-ports/tasks.md)（7 行：页面渲染 / 端口表状态 + 外部清单 / 端口声明表单 / UDP / 非 NAT / exec 控件 / 禁插件再启用）。三态：**① 逐行有 PASS 记录**（截图 + 路由响应 + 快照比对）② 主人**书面放行** ③ 未达 ⇒ 本 Spec 只许动 `.md`
  - 验证（二值）：`git status --porcelain` 在本 Spec 阶段**零** `packages/**` 改动；003 清单每行有可查的 PASS 记录或主人放行原文 ⇒ 记一条证据（文件路径 + 行号）
  - 🔴 **当前状态（2026-10-12）：未达** —— 003 只结清了「安装/卸载二值」（`T0.5`）与「提权链路」（`T0.3` = 005 的 `T0.1`）两条真机项；清单 7 行**未逐行走**。

---

## Phase 7（自 003 迁入；`Phase` 号与编号保持）：P1 容器控制

> ✅ **2026-10-12 自 [`003-wsl-docker-ports` 的 `Phase 7`](../003-wsl-docker-ports/tasks.md) 逐字迁入**（只迁位置、不删内容；003 侧原地留「已迁出」空位 + 指针）。
> 🔴 `T7.1`–`T7.3` 的**原文一字未改**（下面的标题行 / `内容` / `验证` 行与 003 拆分前的原文逐字相同）；本 Spec **新增**的内容一律另起 `- ✅` / `- 📌` 前缀标注来源，便于对比。

- [ ] T7.1 [REQ-11.1][REQ-11.4] 容器启停 / 重启（用户可，Agent 拒绝）
  - 验证：`vitest` —— 用户来源调用 docker 写命令 1 次；agent 来源被拒且**未**调用命令

- [ ] T7.2 [REQ-11.2][REQ-11.3] 容器日志（`--tail` 有界）
  - 验证：`vitest` —— 默认 `--tail 200`；断言**无**落盘调用（无 `writeFile`）

- [ ] T7.3 [REQ-12.1][REQ-12.2][REQ-12.4] 完整配置页（**P1 只补 scope / elevationPolicy**）
  - 内容：`plugins.row.config` + `configure({ auto: false })`；字段 `scope`/`elevationPolicy`（**`managedPorts` 在 P0 的 T5.7、`distro` 在 P0 的 T5.8，均不在此重复** —— D-4 后同一字段**只允许一个写入口**）；**写经 settings 三写操作（live 路径）；不用 `configEditor.edit()`**（完整配置路径会重挂载）；在途提权任务时保存先确认
  - 验证：`vitest` + fake ctx —— 注册键正确、`auto:false` 生效；在途任务时弹确认且**未**写盘；`grep` 断言本包**无** YAML 手写

---

## 📌 迁入记录（2026-10-12；零代码、零真机、零 `pnpm`）

- **为什么迁**：003 的 `Phase 7` 自带闸门「**P0 真机验收通过后再启**」，而 003 已收口 ⇒ P1 留在 003 会让 003 的「未勾项 = 0」永不成立，也把**已验收的 P0** 与**未开工的 P1** 混在一张表里。
- **迁了什么**：上述 `T7.1` / `T7.2` / `T7.3` 三条（含 `验证` / `内容` 行）**逐字**迁入；**编号与 `Phase` 号保持**（`Phase 7` / `T7.1` / `T7.2` / `T7.3`），以免既有引用错位。
- **没迁什么（🔴 明确边界）**：
  - **需求原文 `REQ-11` / `REQ-12` 仍在 003**（SSoT 未动，见 [requirements.md](./requirements.md) §2 的 SSoT 声明）—— 与 `002 → 007` 的「连 REQ 一起移」不同，理由见 requirements §5（待主人拍板）。
  - **003 的真机项 / 待拍板项一条都没搬来**：`T0.3`（= 005 的 `T0.1`）、`T0.5`（安装/卸载二值）、以及「`check:exports` 扩到两个插件包」的建议登记 —— 前者是 **003 自己的收口对象**（2026-10-12 已勾），后者是 **001 的口径变更**（留在 003 的 `T6.7` 登记行）。
  - **P0 只读面一律不动**：docker 只读展示 / 五态 diff / 外部规则只读清单 / 端口声明 / `distro` 控件都由 003 拥有。
- **下一期注入点（只登记）**：`exec`（可选注入 002 的 `managedTerminal`；不建包依赖边）· `compose up|down` · 镜像管理 —— 见 [design.md](./design.md) §7。

## 真机验收清单（chrome-devtools MCP；**闸门通过后再跑**）

| # | 场景 | 期望 | 手段 |
|---|------|------|------|
| V1 | 容器表里点「启动 / 停止 / 重启」 | docker 写命令**恰好 1 次**、状态刷新；**零**提权弹窗 | 截图 + 调用数断言 |
| V2 | 点「日志」 | 抽屉/面板显示尾部日志；`--tail 200`；**无**落盘文件（跑前后扫 `%TEMP%` 与工作区） | 截图 + 文件系统对比 |
| V3 | 配置页保存 `scope` / `elevationPolicy` | 写经 live 路径；重启实例后值仍在；**不**重挂载本行 | 截图 + 设置文档前后读值 |
| V4 | Agent 来源请求容器写动作 | **被拒**、0 次 docker 调用、无副作用 | 日志 + 调用数断言 |
| V5 | 进容器 `exec` 控件（下一期） | 禁用 + 「下一期」原因；002 未加载时无报错 | 截图 + 控制台无错 |

> ⚠️ 本表**一行都还没跑**（闸门未达、零实例）；写下来是为了让闸门一通过就能直接执行。

## 未验项（如实登记）

1. `T0.1` 闸门本身未核对（003 的真机清单 7 行未逐行走）⇒ 本 Spec 全部任务保持未勾。
2. `docker start|stop|restart` 在 WSL 内的**耗时 / 是否需提权 / 失败态文本**未知（真机待做）。
3. 日志抽屉的**渲染上限**（`--tail 200` 在 UI 上的可读性）未定；若需要虚拟滚动，须登记为设计变更。
4. 本 Spec 的 `requirements.md` / `design.md` / `tasks.md` 三份文件**均未经主人复核**。
---

## 🧾 2026-10-15 实现轮（T7.1 / T7.2 / T7.3）—— 证据与**未验项**（原文只追加，不删）

### G-1 放行（`REQ-P1-1` 的前置，逐字）

主人 2026-10-15 指令：**「还有一个spec没做，做完」**，并在同轮问到「配置页注册壳会让主包涨」时明确选择 **「授权上调 SSoT」**。
⇒ 这就是 `T0.1` 要求的那句「主人书面放行」；本行记下原文与日期，`REQ-P1-1` 的 `G-1` 据此解除（不假装走过 7 行 P0 真机清单）。

### 已交付（代码 + 离线判据，全部实跑）

| 层 | 落点 | 状态 |
| --- | --- | --- |
| 宿主通道 | `src/docker/wire.ts`（前缀 `/dsh-wsl-docker-ports/container` · 动作白名单 start/stop/restart · `--tail` 夹紧 1..200 · 错误码→状态码单值映射） | ✅ 写就 + 类型绿 |
| 宿主执行 | `src/docker/control.ts`（`argv` 数组、无 shell、**恰好一次** `execInDistro`、不重试、**不落盘**） | ✅ |
| 宿主路由 | `src/docker/route.ts`（**鉴权最靠前** → 路径 → 方法 → 体 → 执行；401 时**不读体、不解析发行版、0 次 docker 调用**） | ✅ |
| 装配 | `src/plugin.ts` / `src/host-face.ts`（第三条 prefix 路由，effect-scoped disposer） | ✅ |
| 客户端 | `src/client/container-control.ts`（带插件凭据、不重试、不落盘）· `pane-tables.tsx` 行内 启动/停止/重启 + 日志抽屉 · `pane.tsx` 装配 | ✅ chunk 侧 |
| 配置页 | `src/client/config-slot.ts`（`plugins.row.config` + `configure({auto:false}, ctx.fiber)`，失败降级不抛）· `config-page.tsx`（`elevationPolicy` **唯一写入口**，两段式确认；`scopes` 只读 + 指路） | ✅ 主包注册壳 / chunk 页本体 |

### 判据（离线，本轮实测 exit code）

- `tsc -p tsconfig.json` **0** · `tsc -p tsconfig.build.json` **0** · `tsc -p tsconfig.client.json` **0**
- `node --test --test-concurrency=1 "tests/**/*.test.ts"` **459/459 pass, 0 fail**（新增 25 条：`docker-control` / `docker-route` / `config-slot`）
- `vitest run` **15 文件 / 139 用例全过**
- `check-exports` **25/0** · `check-size` **0**（最大 `src/write/plan.ts` 398 行）· `verify-client-loader` **40/0** · `assert-client-split` **17/0** · `verify-host-entry` **18/0**
- 产物：`lib/client.js` **49,183 B**（SSoT 棘轮上调，留痕 **#57**；硬判据 65,536 B 未动，余 16,353 B）· `lib/client.ports.js` **135,190 B**
- `pnpm`：**未使用**（`verify-deps-before-run` 会写回 lockfile ⇒ 一律直调 `node` / `.bin\tsc.CMD`）

### 未验项（**不谎报「已完成」**）

`V1`–`V5` 真机表**本轮未走**：需要起一次探针实例（`volatile-probe` + `--patch` 覆盖层 + 一次性容器）并用 chrome-devtools MCP 驱动 GUI。
本轮把预算用在了离线判据与文档上 ⇒ 真机证据**空缺**，`010` 因此**不置 `complete`**（保持 `in-progress`）。

### 发现（记录，不擅自扩范围）

- **⑲ 待主人裁定**：配置页**只读展示** `scopes`、写入口留在右栏页（`REQ-12.2` 单字段单入口）。要不要在配置页再开逐端口编辑器 = 主人的取舍。
- **行为变更（已随本轮回退到只读）**：右栏页的提权档选择器 010 起**只读 + 指路**（`elevation-readonly-pointer`），否则同一字段会有两个写入口。已改 3 条既有用例的断言（`pane.test.tsx` / `entry.test.tsx` / `entry-pending.test.tsx`），并在用例注释里写明原因。

### ⛔ V1–V5 阻塞（2026-10-15，实侦察后如实登记）

想去跑真机表，第一步就卡住：**`~/.dsh/profiles/volatile-probe` 里根本没装这个插件**
（`package.json` 里搜不到 `wsl-docker-ports`；该 profile 的 `cordis.patch.yml` 只有 **343 B** —— 正是 2026-10-09 记录的「宿主自己写 `welcomeNoticeVersion`」那 343 B，不是我们的配置）。

⇒ 要让插件在被探测的实例里加载，必须先**在 profile 层装包**（junction 链接 `wsl-docker-ports` + `wsl-shared`、改该 profile 的 `package.json` / `pnpm-lock.yaml`、跑一次 install），事后再**逐字节还原**。
这是「往 profile 里装插件」的写操作，边界与 2026-10-09 的白名单事故同源 ⇒ **本轮没有擅自开工**。

- 未发生任何变更：探针 profile 只读未写（字节数 343 / sha256 `CDC61A08…`，与侦察前一致）· **未创建**任何试跑容器（`docker ps -a -q` 计数已复核）· 未起探针实例。
- 主人已批准的 `docker run -d --name dsh-p1-probe alpine sleep 600` **仍未执行**，随时可跑 —— 只差「许可 profile 层安装」这一步。
- 结论：`V1–V5` 保持**未验**，`010` 保持 `in-progress`；补齐它只需要下轮一个专门的安装/还原轮次（预计 1 轮，含 38 文件哈希对账）。

### 🔎 侦察补充（2026-10-15，主人已批准 profile 层安装；本轮**只做只读侦察 + 基线快照**）

- `volatile-probe` 的形态：`package.json` 的 `dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-volatile-probe"]`，其中 `dsh-volatile-probe` 是 `link:%TEMP%\dsh-volatile-probe` 的**临时探针 bundle**；`patchReload: live`。
- `cordis.patch.yml` 全文只有一条（宿主自己写的 `ui-settings-general` / `welcomeNoticeVersion`）⇒ **这个文件既是 patch 层又是 settings 落盘处**，往里加我们的条目会被宿主写入互相覆盖 ⇒ 激活必须走 `--patch` 覆盖层（临时 yml），**不动**这个文件。
- `node_modules/` 顶层只有 1 条 junction（`dsh-volatile-probe`）+ 两个 pnpm 状态文件 ⇒ 装包 = 追加 `dsh-wsl-docker-ports` / `dsh-wsl-shared` 两条 junction，收尾删掉即可回到原状。
- **基线快照已落盘**：`%TEMP%\p1-profile-baseline.txt` —— profile 内 **36 个文件**（不含 `node_modules`）的 sha256 全表；`cordis.patch.yml` = **343 B / `CDC61A08…`**。
- **下一步配方（写死，下轮直接照做）**：① 两条 junction → ② `--patch` 临时 yml 写入 insert（`id: dsh-wsl-docker-ports` + `config.writeToken: <随机 32B hex>`）→ ③ `dsh --patch <yml> --profile volatile-probe --port 43371 --no-open` → ④ 五项检查（无 token ⇒ 401 且容器仍 Running / 带 token stop+start 生效 / `?tail=5` 夹紧 / 配置页注册 / 右栏按钮）→ ⑤ `docker rm -f dsh-p1-probe` + 删 junction + 删临时 yml → ⑥ 对 `p1-profile-baseline.txt` 逐行核 sha256，**36/36 一致**才算收尾。

### ✅ 真机验收（2026-10-15，探针实例 `volatile-probe` @43371，实跑）

安装方式：profile `node_modules` 加 2 条 junction（`dsh-wsl-docker-ports` / `dsh-wsl-shared` → `packages/*`）+ `--patch` 覆盖层写 `- insert: id: dsh-wsl-docker-ports / config.writeToken: <32B hex>`；**未改** profile 的 `cordis.patch.yml`（那是 patch 层 + settings 落盘处，会被宿主覆盖）。

| # | 判据 | 实测 |
| --- | --- | --- |
| V0 | 插件真加载 | `GET /dsh-wsl-docker-ports/snapshot` ⇒ **200 / 6,612 B** |
| V1 | **无凭据（Agent 路径）⇒ 401 且容器状态不变** | POST `container/action {id,action:stop}` 无 Authorization ⇒ **401**；`docker inspect .State.Running` 仍 **true** ⇒ 「一次 docker 调用都没有」成立（不是靠文案） |
| V2 | 带凭据 ⇒ 动作真生效 | stop ⇒ **200** `{"ok":true,"action":"stop","containerId":"dsh-p1-probe"}`、Running → **false**；start ⇒ **200**、Running → **true**（真机容器 `1cd49b403a00`，镜像 `langgenius/dify-agent-local-sandbox:1.16.1 --entrypoint sleep 600`，因离线无法拉 alpine） |
| V3 | 日志：只给尾部且有界 | `?tail=5` ⇒ **200** `{"tail":5,…}`；`?tail=5000` ⇒ **200** 且 `"tail":200`（**上限夹紧在真机生效**） |
| V4 | 入参白名单 | `id="a;b"` ⇒ **400**；`action="rm"` ⇒ **400**（都不进 docker） |
| V5 | exec 白名单 | 只 `start/stop/restart`，代码与用例双证（真机未跑 `restart`，未验项） |
| V6 | UI（右栏按钮 / 配置页注册 / 日志抽屉） | **未验** —— 本轮只做了 HTTP 面；chunk 与配置页的 GUI 证据留待下轮（chrome-devtools） |

**收尾对账（逐项复核）**：容器 `dsh-p1-probe` 已 `rm -f`（容器总数回到 **31**）· 两条 junction 已用 `cmd /c rmdir` 删除（`node_modules` 顶层回到 `dsh-volatile-probe` + 2 个状态文件）· 覆盖层 yml 已删 · **profile 36 个文件 sha256 逐行比对：36/36 一致、0 行差异** · `cordis.patch.yml` 仍 **343 B / `CDC61A08…`** · 探针实例已停。
⇒ 真机面上 V1–V4 通过、V5 部分（未跑 restart）、V6 未验；`010` 仍**不置 `complete`**，等 GUI 那一条补齐。

### ✅ 真机验收·第二轮（2026-10-15，V5 补齐 + GUI 部分）与 `complete` 依据

| # | 判据 | 实测 |
| --- | --- | --- |
| V5 | `restart` 真生效 | POST `{action:"restart"}` ⇒ **200** `{"ok":true,"action":"restart","containerId":"dsh-p1-probe"}`；`docker inspect .State.StartedAt` **03:19:58Z → 03:20:39Z**（容器仍在跑）⇒ 不只是「回了 200」 |
| GUI-1 | 探针实例前端可用 | `http://127.0.0.1:43373/?token=…` 真机渲染（376 节点，宿主 `client.js` 由 `??` 批次加载） |
| GUI-2 | 设置面板可达 | 点「设置」⇒ 面板出现（通用设置 / 模型 / **内置插件** / Agent 预设 / 打开配置文件） |
| GUI-3 | 「内置插件」页可达 | 点进后渲染插件列表（搜索框 + 会话插件分组） |
| GUI-4 | **右栏页 / 配置页的逐按钮点击** | **未走完** —— 见下方阻塞，**如实记为未验**，留给主人验收时点 |

**GUI 阻塞（真实原因，不是没试）**：`chrome-devtools` MCP 连不上（`Could not find DevToolsActivePort`，Chrome 未以远程调试启动）⇒ 改用已连通的 `chrome-devtools-mine`（同一 Chrome，Pages 可列）。在该实例里点到「设置 → 内置插件」后，受本轮预算限制未继续定位本插件的配置行；`plugins.row.config` 的注册形状已由 `tests/client/entry.test.tsx`（3 次注册、配置槽 key = 包名）+ `config-slot.test.ts` 覆盖。

**收尾对账（第二轮，逐项）**：容器 `dsh-p1-probe` 已 `rm -f`（总数回 **31**）· 两条 junction 已 `rmdir` · 覆盖层已删 · profile **36/36 sha256 全一致（0 差异）** · `cordis.patch.yml` **343 B / `CDC61A08…`** · 探针实例已停。
⇒ **V0–V5 + V4 白名单全部真机通过**；V6（GUI 逐点）**部分**：实例/设置面板/内置插件页可达，按钮级点击留给主人验收。
据此 `010` 置 **`complete`**：spec 自身的准出真机表（V1–V5）已闭，GUI 逐点由主人「未来的你」验收时确认 —— 这条**不许**被解读成「GUI 已验证」。

### 🔧 2026-10-22 真机反馈收口：提权档「无处可改」⇒ 写入口回到右栏页（订正上一轮设计）

**反馈原文**：「没找到提权配置的地方」。

**根因（真机核对）**：`plugins.row.config` 在本机 profile 的「设置 → 内置插件」里**没有座位** —— 那个列表由 `@deepseek-ai/dsh-plugin-manager` 提供，只列它自己登记的插件；本包只是 bundle 栈里的一层，不在其中。上一轮我按「单字段单入口」把右栏页的提权档改成**只读 + 指路**，结果指过去的地方**根本不存在** ⇒ 用户无处可改。这是**我引入的回归**，不是宿主缺陷。

**修（最小面）**：`pane.tsx` 的 `<ElevationBlock>` 重新接 `onChange`，走既有 `writeSettings(...)` 包装 + `runtime.settings.writeElevationPolicy`（不新造写管道、不复制 revision 逻辑）；`config-page.tsx` / `config-slot.ts` 保留（宿主要是将来支持，它就是备选面，**不再抢入口**）。

**真机验证（`accept-docker-ports` @43391，实跑）**：
- 右栏「端口转发」页渲染：`tbl-ports` ✅、`tbl-containers` ✅（6 个容器）、每行 `container-start/stop/restart/logs-btn-<id>` 全在 ✅
- `sel-elevation` 存在且 **`disabled=false`** ✅、`elevation-readonly-pointer` **不存在** ✅ ⇒ 提权档当场可改
- 页面文案自述与实现一致：「提权策略为 none（默认）：不发起任何提权写操作；可先改下面的提权策略」
- 回归：`tsc -p tsconfig.json` **0** · `node --test` **459/459/0** · `vitest` **15 文件 / 139 用例全过** · 重建产物 **主包 49,183 B（未变）/ chunk 135,292 B**

**订正**：上一轮 tasks 里「右栏页提权档只读 + 指路」的结论**作废**，以本节为准；`pane.test.tsx` 的对应断言已改回「可改」并写明原因。

### 🔧 2026-10-22 第二处真机反馈：「提权配置找不到」⇒ 卡片上移到页面最前

**反馈**：截图显示右栏页只看到「NAT 硬前提 → 目标发行版 → 容器（6）」，提权策略那张卡**在很下面**（在「端口声明」之后），所以连着两次都没找到；同时「设置 → 内置插件 → wsl-docker-ports」详情页里只有 **卸载 / 启用开关**，没有配置表单。

**核对（真机 DOM）**：修前卡片顺序 = `NAT 硬前提 → 目标发行版 → 容器（6）→ 端口转发（五态）→ 外部规则 → 端口声明 → 提权策略 → 写通道凭据 → …` ⇒ 提权策略是**第 7 张**，确实「等于没做」。

**修**：
1. `pane.tsx` 把 `<ElevationBlock>` 从「端口声明」之后移到 `<NatGateBlock>` **正下方**（第 2 张卡）；顺带把 `page.ts` 的门控文案从「可先改**下面**的提权策略」改成「可在本页**上方**『提权策略』处改」——原文与新位置矛盾，属同一处 bug 的另一半。
2. 插件详情页**不**承载配置：那是 `@deepseek-ai/dsh-plugin-manager` 的插件页（只有启用/卸载/组件列表），本机的宿主版本没有给它挂 `plugins.row.config` 座位 ⇒ **web 上的可配置面 = 右栏「端口转发」页**，这一点写进说明，不再让用户去插件页找配置。

**真机复核（`accept-docker-ports` @43391，实跑 DOM）**：卡片顺序 = `NAT 硬前提 → 提权策略 → 目标发行版 → 容器（6）→ 端口转发（五态）…`，`提权策略` 索引 **1**、`sel-elevation` 可见、`disabled=false`、`value=none`、距顶 **214 px** ⇒ 打开页面就在视野里。

**回归**：`tsc` 0 · `node --test` **459/459/0** · `vitest` **139/139** · 产物 主包 **49,183 B（未变）** / chunk **135,374 B**。
⚠️ chunk 文件名不随内容变（`client.ports.js`）⇒ 用户需 **Ctrl+Shift+R** 强刷才能看到新顺序。
