# 009 写入口 UI —— 任务

> 每行一个任务；`[REQ-N]` 指向 [requirements.md](./requirements.md)。**「判据」必须是可二值判定的**（跑得出来、看得见）。
> **来源**（2026-10-12 从 [008-write-transport](../008-write-transport/tasks.md) 拆出，**同包不拆包**）：承接 008 的 `T3.2`（结果四态）、008 `T3.3` 清单里的 **V6**（真机 UI 复核）、**007 配置页的「生成并保存写通道凭据」按钮**，以及只属于 UI 面的新判据。**008 侧保留 `T3.2` / `V6` 编号为空位并注明「已迁至 009」。**
> **行数门**：warn **200** 只是提示、不强制压缩；硬门 = LeanSpec `maxLines` **400**（本文件当前 **285**，余量 **115**；🔴 **2026-10-12 收口轮订正**：原记 **148** —— 它在本轮开始前就已过期（当时实测 **171**），回填真机证据与 Phase 7 后为 **256**，本轮追加 T3.2 判据摘要 + Phase 8 后为 **285**，口径一律以 `split('`n')` 当场复算为准）。接近 400 ⇒ 必须再拆 Spec，**不得**删已验证结论 / 未验项 / 裁定依据 / 命令原文证据。
> **真机白名单**：探针只许**临时 / 一次性 profile**（AGENTS.md：**不得**用 `desktop` / `web`），跑完逐字节还原。

## Phase 0：契约冻结（不写产品代码）

- [x] T0.1 [REQ-1..10] 把 008 `T3.1` 已实现的八条客户端契约**逐条冻结**进 [requirements.md](./requirements.md) §2（含源码出处与主人裁定日期）。
  - 判据：十组 REQ（REQ-1..10）每条都能指到一份源码文件或一次裁定；`requirements.md` 行数 ≤ **200**（实测 **99**）。
- [x] T0.2 [REQ-1.1] 复核服务端 fail-safe 的**边界**：`writeToken` 默认空 ⇒ `plan` / `apply` / `audit` 恒 **401**；**服务端证据不重复造**（008 的 `tests/unit/transport-write-auth.test.ts` 与 T2.9/T2.10 的真机 401 矩阵在册）。
  - 判据：指针可达；本 Spec 的 `git diff` 里 `src/transport/**` **零改动**（只迁文档，不碰服务端）。

## Phase 1：结果逐步反馈（四态；迁自 008 `T3.2`）

- [x] T1.1 [REQ-9.1] 结果区 `executed` / `failed` / `skipped` / `rolledBack` **四态分色**（各自 `data-testid` + 类名；颜色走 `--dsw-*` token）。**2026-10-12 实现**：结果区独立成文件 `src/client/write-result.tsx`（`write-panel.tsx` 只留外层 `section` 与状态机，241 → 234 行），四态 tone 复用 `styles.ts` 既有类名 `wdp-tag-ok` / `wdp-tag-danger` / `wdp-tag-muted` / `wdp-tag-warn`（**零自造类名、零 hex**）。
  - 判据：`vitest` —— `tests/client/write-result.test.tsx` **14** 条全绿：四态各有渲染分支用例（① executed / ② failed / ④ skipped / ⑤ rolledBack）；「无该项」与「有该项」可区分（某清单为空 ⇒ **连容器都不渲染**，四张全空时只给一条中性说明）。
  - 🔴 **现状如实（哪一态「不可区分」/ 缺什么字段）**：四态**都**有真实生产者（`src/transport/apply.ts` 的 `executed:383` / `skipped:384` / `failed:385-387` / `rolledBack:317-348`）⇒ **没有**「缺语义位」的那一态，三条判据均可勾选；真正不可区分的只有三处细节，本轮**不做**（也不编、不改服务端）：ⓐ `skipped` 只有 `WriteStepKind[]`、**无逐条原因字段** ⇒ 只能报「未执行」这一事实；ⓑ 响应里**没有**跨清单统一有序的 `steps[]` ⇒ 各清单**之间**的相对次序不可知（实现只在**清单内**保序，不合并、不排序）；ⓒ 005 脚本内回滚（`elevate/script.ts:283` 的 `Add-Step 'portproxy-rollback' $true '<原因>'`）经 apply 层只剩 `executed` 里的**名字**、**原因被丢弃** ⇒ 那句「已回滚 portproxy」在本响应里不可渲染（要显示需 008 在 `executed` 之外另给字段 = 契约变更，**服务端一行未动**）。
- [x] T1.2 [REQ-9.2] 失败项**必带可读原因**：每条失败渲染 `name` + `reason`（不是只给个数；`reason` 为空串时给兜底文案）。**2026-10-12 实现**：`write-result.tsx` 的 `readableReason()`（空串 ⇒ `FAILURE_REASON_FALLBACK`，明写「服务端未给出该步骤的原因」）；`apply.ts` 的 `reason` 实为 `StepReport.stderr`（类型标 `string | null`、运行时是 `string` ⇒ **空串是真实可能**）。
  - 判据：`vitest`（`tests/client/write-result.test.tsx`）：构造 `failed: [{name,reason}]` ⇒ 用例② 断言两条原因**各自只出现在自己那一条目内**（1 对 1、零串行）、条目数 == `failed.length`；用例②b 断言每条同时含「名称」与「失败：原因」两段；用例③ 断言空串走兜底文案（非空）。
- [ ] T1.3 [REQ-9.3] 零硬编码 hex（口径来源：003 `NFR-7` / 002 `NFR-4`；003 Phase 6 的门已在当时的 `src/client/**` 上真扫过）。
  - 判据：静态扫描 `src/client/**` 的 `#[0-9a-fA-F]{3,8}` 命中 **0**，且**非空扫描**（文件数 > 0）。**2026-10-12 复算**：`node --test` 的 `tests/unit/client-structure.test.ts` NFR-7 用例当场出数（全 `src/client/**`：hex 命中 **0** 处、`var(--dsw-*)` 引用数 > 0，两者由同一次扫描打印）；本轮**新增** vitest 用例⑨ 对两个结果区文件复扫（hex **0** 处，且用到的 **12** 个 `wdp-*` 类名**全部**能在 `styles.ts` 的 `PAGE_CSS` 里找到 ⇒ 白名单外零自造类名）。

## Phase 2：配置页「生成并保存写通道凭据」（迁自 007 配置页）

- [x] T2.1 [REQ-1.2–1.4 / REQ-2.1–2.4] 凭据块（`pane-settings.tsx` 的 `WRITE_TOKEN_TESTID` 区块 + `write-token.ts` + `settings-pipe.writeWriteToken`）：按钮「生成并保存写通道凭据」⇒ 32B 随机 hex ⇒ `remote.settings.update('dsh-wsl-docker-ports', { writeToken })` ⇒ **一次性显示**；**默认仍为空**（本 Spec 不改这个默认值）。
  - 判据（**离线已完成，由 008 `T3.1` 交付**）：见文末「迁入记录」§1 的 44 条 `vitest`（其中 `write-token` 10 条含「配置写失败 ⇒ 不入本会话」与「四个客户端文件零 `console`、零持久存储」）。
  - [x] T2.1.1 [REQ-1.2–1.4] **清除 / 轮换 / 服务端配置布尔态**（2026-10-12 `6e1f153` 交付，本轮只补留痕与判据指针）：判据 = `tests/client/write-token-pane.test.tsx` 的 **12** 条 `vitest`（轮换 = ①「再点一次仍是恰好一次写入」；清除 = ⑤「二次确认前零写入 ⇒ 确认后写空串 `{writeToken:''}` 并清本会话」与 ⑤b「取消 ⇒ 零写入、凭据原样」；服务端配置布尔态 = ③/③b「只显示布尔、值本体不进 DOM」；失败不静默 = ⑦/⑦b）。
  - 设计说明（2026-10-12 补记，主人点名要写进设计）：清除成功后的「服务端 `writeToken` = 未配置」是**由写入事实推出**（`clearWriteToken()` 写空串成功 ⇒ `pane.tsx` 直接置 `configured=false`），**不是**再读一次 `readConfig()`（免得「写成功却读回旧值 ⇒ 界面自相矛盾」）；判据⑤ 同时断言 `data-config-configured="0"`，而该用例**从未点过**「检查服务端配置状态」按钮 ⇒ 这个 `0` 只能来自写入事实。
- [x] T2.2 [REQ-1.1 / 1.2] **真机投递链复核**（2026-10-12 收口轮**真机跑通**；原文「本轮未跑」已作废，保留不删）：页面按钮点得动 ⇒ 写进 `profiles/<profile>/cordis.patch.yml` 的 `config.writeToken` ⇒ **重载插件行** ⇒ 服务端真读到。
  - 判据：写前 `POST …/write/plan?token=…` ⇒ **401**；点按钮 + 重载插件行后再打 ⇒ **200**；配置文件里的值与页面**一次性显示**的串**逐字相同**；跑完逐字节还原（`git status --porcelain` 空 + `portproxy` 19）。🔴 **2026-10-12 收口轮真机结论**：`POST /api/settings/describe` 的命名空间 **19 → 20**（末条 `dsh-wsl-docker-ports`），本包条目的 `secrets` 逐字为 `[{"path":["writeToken"],"set":true}]`、**明文凭据全响应 0 处**；写入走配置页按钮 ⇒ 落进 `profiles/<profile>/cordis.patch.yml` 的 `config.writeToken`；🔴 **轮换即时生效**（旧串立刻 **401**、新串立刻 **200**，无需重载插件行——原判据里「重载插件行」这一步真机上**不是必需的**，留痕不改判据）。⇒ 「settings → 插件 config 投递链**未验**」这条**正式关闭**。
- [x] T2.3 [REQ-1.2] **补一条离线判据**（本轮核对 T5.7 时发现的覆盖缺口）：`tests/unit/client-settings.test.ts` 的「每个写方法只产出恰好一个键的 patch」用例表目前只有 **4** 个写方法，`writeWriteToken` 只出现在导出面断言里 ⇒ 把它补进用例表。
  - 判据：用例表含 **5** 个写方法；`writeWriteToken('t')` ⇒ patch 键集合恰 `['writeToken']`、命名空间 = 包名、有能力时带 revision。**不得**改动 `forbidden`（`run/invoke/exec/elevate/spawn`）与「写配置零提权调用」两条断言（2026-10-12 已逐字核对**未被削弱**）。

## Phase 3：真机 UI 复核清单（V6 迁自 008 `T3.3`；V7 / V8 为本 Spec 新增）

**配方（安装 / 配置 / 端点基址）与收尾复算**：原文**逐字保留**在文末「迁入记录」§2/§4；V1–V5（后端写路径）的判据行留在 008 —— 两边**共用这一份配方**，不各自再写。
🔴 代理**不碰任何 profile**；**CLI 不能操作 `desktop`**（002 已证 `rejectElectronProfile`）⇒ 桌面实例请在**应用内**安装。

| # | 判据（可二值判定） | 通过 | 回归信号 |
| --- | --- | --- | --- |
| V6 | （**原文迁自 008 T3.3**，见 §3）🟡 **2026-10-12 真机「部分达成」**：确认对话框**真机弹得出** ✅、影响面文案**逐字** ✅、按钮**置灰 + 原因** ✅；🔴 **但零步骤 ⇒ 逐条 `commandText` 比对做不到** ❌（根因 = **缺陷 1**：真机 `settings/describe` 的 20 个命名空间里**没有**本包 ⇒ 客户端读默认值 ⇒ `declaration` 恒空 ⇒ 每个端口 `port-not-managed` ⇒ 计划永不 `ready`、0 步）；另 `policy=none` / `unknown` / 无票据三个分支因 `elevationGate()` **先判 `!ready`** 而在真机上**不可达** ⇒ 那三条只有离线覆盖。🔴 **2026-10-12 收口轮订正（真机通过）**：缺陷 1 真根因修好后同轮真机复跑 —— 确认对话框**点得开** ✅、逐条 `commandText` 与 **UI 网络面板 / API 响应体三方逐字节相同** ✅、`steps.length = 2` ✅、影响面文案逐字含「会新增 1 条 portproxy 规则 + 1 条防火墙规则」 ✅ ⇒ 状态由「部分达成」改为 **通过**。截图：`E:\Temp\dsh-ui-accept4\shots\v6-confirm-ready.png` | 通过（2026-10-12 真机） | 页面上**点得到**写入口却**没有**对话框 ⇒ 回归 |
| V7 | 配置页「生成并保存写通道凭据」点一次 ⇒ 页面**一次性显示**的 32B hex 与 `cordis.patch.yml` 的 `config.writeToken` **逐字相同**；重载插件行后同一页面点「预演」⇒ **200**（不再是 401） | 🔴 ~~**未验（真机被卡住，不得记成通过）**：按钮 `disabled`、`planId` / `ticket` 为空、**结果四态区从未出现**、**未留截图** ⇒ 无证据~~ ⇒ 🔴 **2026-10-12 收口轮订正：真机通过（成功态）**（原文保留不删）。UI 点确认 ⇒ `exitCode:0`、`executed:[portproxy-add, firewall-add]`、**4005ms**；`portproxy` **19 → 20**、我方防火墙 **0 → 1**、规则总数 **816 → 817**；点移除 ⇒ **20 → 19**、**1 → 0**、**817 → 816**，且 `portproxy` 抓取与写入前**逐字节相同**（sha 一致）；`audit` **2 条 applied**、凭据命中 **0**。**四态结果区真渲染出来了，但真机只出现 `executed` 一态**（`failed` / `skipped` / `rolledBack` 节点数 **0 / 0 / 0** —— 本轮**没有**人为制造失败）⇒ 🔴 **`failed` / `skipped` / `rolledBack` 三态真机未出现 ⇒ 仅离线覆盖，不得写成「四态真机全通过」**。截图：`E:\Temp\dsh-ui-accept4\shots\v7-result-add.png` / `v7-result-remove.png` | 通过（2026-10-12 真机·成功态；三态仅离线） | 点了按钮仍 401 / 明文出现第二次 / 明文落进 `localStorage` |
| V8 | 预演 ⇒ 对话框逐条显示**服务端命令原文**；点「取消」⇒ 请求数停在 **1**（零 `apply`）；点「确认」⇒ 恰好 **1** 次 `apply`，结果区**四态**可见且失败带原因 | 🟡 **可验部分**全中：401 文案含「凭据缺失或错误」+ 去哪里配置 + **不重试** ✅；实测 `write/plan` **恰好 1 次**且不重试 ✅；缺凭据 ⇒ **本地拦下**、**零写通道请求**（⚠️ 口径订正：仍会读一次 `settings/describe`，见 Phase 5 ⑤）✅；**「确认 ⇒ 四态可见」因与 V7 同一根因未验**（原文保留不删）⇒ 🔴 **2026-10-12 收口轮订正：真机通过** —— 错凭据 ⇒ 三条文案齐 + `write/plan` **恰好 +1**、不重试（截图 `v8-credential.png`）；「确认 ⇒ 结果区可见」由 V7 行同轮真机证到。⇒ 状态由「可验部分全中」改为 **通过** | 通过（2026-10-12 真机） | 取消后仍发 `apply` / 命令文本被改写 / 失败只给个数 |

- [x] T3.1 [REQ-10.1] 清单固化（V6–V8）+ 状态**如实标注**「未通过（未验）」（离线渲染证据**不冒充**真机）。**2026-10-12 第九轮回填**：三行状态已按真机实况改写 —— V6 部分达成 / V7 **未验**（真机被卡住、无截图）/ V8 可验部分全中。
  - 判据：本文件含 V6–V8 三行 + 状态标注；配方指针可达（「迁入记录」里确有原文，逐字可核）。**实测**：三行均在册，状态与真机记录逐条一致 ✓（离线可判定，已勾）。**2026-10-12 第十轮（收口轮）再次回填**：V6 / V7 / V8 三行状态由「部分达成 / 未验 / 可验部分全中」改写为 **通过 / 通过（成功态·三态仅离线）/ 通过**，依据逐条写在各行内（原文**保留不删**，订正痕追加在同格）。
- [x] T3.2 [REQ-10.2] 真机按清单跑一遍（**需主人在场**；本 Spec 本轮**未开浏览器、未装插件、未起实例、未跑任何 `netsh` / `New-NetFirewallRule`**）。
  - 判据：V6–V8 三行各自给出真机原文证据（响应体 / 页面文本 / 文件内容哈希）；跑完逐字节还原。**2026-10-12 第九轮实况**：真机**跑过一轮**（V1–V5 全过、V8 可验部分全中、还原逐字节 ✓），但 **V6 只到一半**（零步骤 ⇒ 逐条命令比对做不了）、**V7 未验且无截图** ⇒ 本条**不勾**（缺两行证据，见 Phase 5）。🔴 **第十轮（收口轮）订正并勾选**：缺陷 1 真根因修好后**再跑一轮**，V6 / V7 / V8 三行各自拿到真机证据（响应体 + 页面文本 + 哈希：见上表三行与 Phase 7 的证据清单）；**收尾复算全绿**（`portproxy` **19**、我方防火墙 **0**、`git status --porcelain` 空、`--frozen-lockfile` exit **0**）⇒ 勾选条件满足，原文「不勾」的理由**已随证据作废**（保留不删）。
  - 🔴 **2026-10-12 收尾轮真机判据摘要（本条勾选状态的直接依据；逐字节脚本当场复算，原始产物在盘）**：`POST /dsh-wsl-docker-ports/write/plan` ⇒ `ready:true`、**2 步**、add `planId` = `013f7123611f2fa4d1a4ac7ad733b52b2fb8ae81de3c81b1e01e331b68072bd1`、remove `planId` = `088f84280d45b8aa7c1e6427b3ef9d494cb8aab5980a4bd68b220f88942543be`（产物 `E:\Temp\dsh-ui-accept5\plan-add.raw.json` / `plan-remove.raw.json`；remove 的 `planId` 与第九轮**同值** ⇒ `REMOVE_PLANID_MATCH_ACCEPT4 = True`）；**两组数字** = ① V6 预演 **UI vs 服务端逐字全等** —— `portproxy-add` **123/123** + `firewall-add` **168/168**（`ALL_STEPS_VERBATIM_EQUAL = True`；影响面 164 字符逐字含「会新增 1 条 portproxy 规则 + 1 条防火墙规则」与「共 2 条」、**不含「未验证」**），② remove 逐字全等 —— `portproxy-delete` **78/78** + `firewall-delete` **64/64**（`REMOVE_ALL_STEPS_VERBATIM_EQUAL = True`）；配套计数：add ⇒ `portproxy` **19→20** / 我方防火墙 **0→1** / 全部规则 **816→817**，remove ⇒ **20→19**（抓取与写入前**逐字节相同**）/ **1→0** / **817→816**，`audit` **2 条 `applied`** 且凭据命中 **0**。**两张截图路径**：`E:\Temp\dsh-ui-accept5\shots\v6-regression-preview.png` 与 `E:\Temp\dsh-ui-accept5\shots\{v7-head-add,v7-head-remove}.png`（上一轮四张 `E:\Temp\dsh-ui-accept4\shots\{v6-confirm-ready,v7-result-add,v7-result-remove,v8-credential}.png` 已在 V6–V8 行内引用）。

## Phase 4：收口

- [ ] T4.1 [NFR-1] 依赖未增：`dependencies` / `devDependencies` 与拆分前一致；未引 E2E / 浏览器自动化框架。
  - 判据：`git diff -- packages/wsl-docker-ports/package.json packages/wsl-docker-ports/pnpm-lock.yaml` 空（本轮实测：**空** ✓）。
- [ ] T4.2 [NFR-2] 体积 / 行数门：本 Spec 涉面的 `src/client/**` 逐个报数（≤ 400 行原始、≤ 40KB 去注释去空行）。
  - 判据：脚本当场出数；超限则拆文件，**不抬阈值**（AGENTS.md：40KB 之后不许再抬）。
- [ ] T4.3 文档同步：008 的「已迁至 009」空位与指针、本 Spec 的 README 导航、`AGENTS.md` 的拆分留痕（若需变更则留痕）。
  - 判据：008 的 `T3.2` / `V6` 指针指向本文件真实存在的锚点；README 链接可达（本轮已落 008 侧指针，AGENTS.md 待补）。

## Phase 5：2026-10-12 真机复验回填 + 四个缺陷修复（本轮**零真机**、零新依赖）

**真机实况（第九轮，主人现场；V1–V5 的判据行归 008，本节只做同轮留痕）**：
① **V1–V5（后端写路径）全过**：`portproxy` **19 → 20 → 19**、我方防火墙 **0 → 1 → 0**、**他人规则 814 条未变**、`audit` **2 条 applied**（**来自 API**，UI 贡献 **0**）、401 矩阵 **4 条**且审计体积不变；
② **还原**：**MAP DIFF = 0**、`portproxy` 抓取**逐字节相同**（sha `b9d38664…`）；
③ **V6 = 部分达成 / V7 = 未验 / V8 = 可验部分全中** —— 三行状态已回填进上表（**未验就是未验，不写成通过**）；
④ 🔴 **旧判据订正**：「`~/.dsh` 无残留（文本命中 0）」**作废** —— 真机递归搜有 **30** 处命中，**全是历史日志 / 缓存、无一可加载** ⇒ 判据改为「**清单层引用 = 0**（`cordis.patch.yml` / `cordis.yml` / `package.json`）」（已在 008 `tasks.md:215` / `:326` 加订正留痕）；
⑤ 🔴 **口径订正**：「零请求」一律读作「**零写通道请求**（仍会读一次 `settings/describe`）」—— `write/plan` / `write/apply` 的计数器是 **0**，但 `readConfig()` 会先打一次 `settings/describe` 取 `declaration`。`requirements.md` REQ-2.4 与 `design.md` 的同一简写**以本节为准**（那两处原文本轮未改，见待办）。

**真机暴露的四个缺陷 → 修复（全部离线可判定；上一行状态即它们的来源）**：

- [x] T5.1 [REQ-8.1] **缺陷 1：配置投递链断**（真机 `POST /api/settings/describe` 的 20 个命名空间里**有** `dsh-terminal-profiles`、**没有** `dsh-wsl-docker-ports`）⇒ 客户端 `readConfig()` 全默认 ⇒ `declaration` 恒 `[]` ⇒ 每端口 `port-not-managed` ⇒ 计划永不 `ready`。**修**：新增 `src/config.ts` 声明**真** `Config`（Schemastery：`managedPorts` / `scopes` / `distro` / `elevationPolicy` / `writeToken`，**刻意不 `.volatile()`** —— 本入口按直接属性读取策略与凭据，标了会读成 `undefined`），入口两种形态都导出（`src/index.ts` 具名 + `default.Config`）；宿主依赖走**多锚点运行时解析**（profile 层是实测唯一命中的一族）。**零新增依赖**（`package.json` 一行未改）。
  - 判据（离线，已跑绿）：`tests/unit/config.test.ts` **10/10** —— `['~standard'].vendor === 'schemastery'`（**不是假 schema**）、缺省值 / 合法值 / 3 类类型错 / 语义未知值的行为与 002 同族、字段清单 **==** 客户端 5 个写方法产出的 patch 键集合、构建期 `volatile()` **0 次**、解析失败留 `MODULE_NOT_FOUND` 原话且 `Config === undefined`（**不造假 schema**）、运行时导出面白名单（无执行 / 提权类名字）。
  - 🔴 **2026-10-12 二次订正（Phase 6）**：本条的**根因与判据都已作废** —— 命名空间的存在性有**两道门**（导出 `Config` **且** 宿主 `volatileForm(schema) !== undefined`），「刻意不 `.volatile()`」正是缺陷 1 没修好的原因；「构建期 `volatile()` **0 次**」这条判据已**反向**（现为「五字段全标、调用次数 == 字段数，不许多标」）。**原文保留不删**，逐行证据与订正后判据见 Phase 6。
  - 🔴 **真机判据（待真机复验，本轮不勾）**：`settings/describe` 里**出现**本命名空间、且 `update` 不再报 unknown namespace。**本轮没上真机 ⇒ 只能写「待真机复验」。**
- [x] T5.2 [REQ-1.2] **缺陷 2：所有配置写入必失败**（真机原话 `client api: settings/update expected 3 argument(s), got 2`）。**根因**：`src/client/settings-pipe.ts` 在「取不到 revision」分支**只传两个实参**，而宿主 `prepareInvocation` 数的是 `values.length`。**修**：**恒传三个**（`revision === undefined` 时显式占位；`expectedRevision` 的 codec 是 `union([_undefined(), number()])` 且 `acceptsUndefined: true` ⇒ 显式 `undefined` 合法且等价于「无条件写」，**语义未变**）。
  - 判据（离线，已跑绿）：`tests/unit/client-settings.test.ts` —— 修后实参个数**恰好 3**（`revision === undefined` 时为 `undefined` 而非少传）；**反例对照**：同一条两参调用在同一份「按宿主规则校验」的假服务下**必抛** `expected 3 argument(s), got 2`（= 真机原话）。
- [x] T5.3 [REQ-4.2] **缺陷 3：影响面文案高报** —— 计划不可执行 / 零步骤时仍写「会新增 1 条 portproxy 规则 + 1 条防火墙规则」，与同一弹窗里的「共 0 条」自相矛盾。**修**：`buildImpactLines()` 只在「`ready` 且 `planId` 非空且**真有步骤**」时才谈新增 / 删除；否则明写「当前计划不含可执行动作，不会改动任何规则（… 服务端共 N 条步骤，全部不执行）」。
  - 判据（离线，已跑绿）：`tests/client/write-confirm.test.tsx` **15/15** —— 不可执行（`planId=null` + `ready=false` + 0 步）与「`ready=true` 但 0 步」两种都**不出现**「会新增」、都**出现**「不会改动任何规则」，且「共 0 条」与「会新增」**互斥**；**反向对照**：真有 3 步时那句逐字照旧（证明不是「整句被删」）。
- [x] T5.4 [REQ-1.4] **缺陷 4：「保存声明」失败全静默** —— 真机现象：控制台只有 `Uncaught (in promise)`、没发 `update` 请求、文件没变、页面**零提示**。**修**：`settings-pipe.write()` 的 `describe` / `update` 都包 try/catch ⇒ 失败化成**可读结果**（含宿主原话 + 「不重试」）；`pane.tsx` 的 `savePorts` / `writeSettings` 收敛到**同一个出口** ⇒ 抛出 / 未接线 / 失败三种情况都给提示（**只发一次、不改状态**）。
  - 判据（离线，已跑绿）：`tests/unit/client-settings.test.ts` + `tests/client/pane.test.tsx` **19/19** —— 宿主抛错 ⇒ 提示含真机原话且 `update` **尝试恰好 1 次**；管道自身抛 ⇒ 面板兜底提示；宿主未提供 `remote.settings` ⇒ 提示含 `remote.settings`；**反向对照**：写入成功 ⇒ `action-error` **0 条**。
- [x] T5.5 [NFR-1] **零新增依赖 + 服务端零改动**：`package.json` 未改（`dependencies` 仍只有 `dsh-wsl-shared`）、`src/transport/**` 一行未改、未引 E2E / 浏览器自动化；改动面 = 新增 `src/config.ts` + 改 `src/index.ts` / `src/plugin.ts`（注释）/ `src/client/{settings-pipe.ts,write-confirm.tsx,pane.tsx}` + 四份测试。
  - 判据：`git diff --stat` 只含上述文件（`package.json` / `pnpm-lock.yaml` diff **空**）；三道门全绿：`tsc -p tsconfig.json` × 3 包 **exit 0**、`node --test --test-concurrency=1 "tests/**/*.test.ts"` **401/401（0 fail）**、`vitest run` **9 文件 / 108 通过**；包内自检 `check:host` **18/18**、`check:client` **24/24**。
- [ ] T5.6 [REQ-10.2] **待办（本轮未做，不勾）**：`requirements.md` REQ-2.4 与 `design.md:10/27/32/67` 的「零请求」简写是否统一改写为「零写通道请求」，以及 008 侧 V1–V5 的判据行是否回填本轮实况 —— **两件都要主人拍板**（前者是契约措辞、后者属 008 的记录面）。

## Phase 6：缺陷 1 的**真根因**（宿主 `volatileForm` 门）+ 读侧统一解包（本轮**零真机**、零新依赖）

**根因（宿主源码逐行；本机 `D:\nodejs\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-settings\lib\index.js`，本轮逐行读过并复算）**：
- **L122-131 `volatileForm(schema)`**：`schema.meta.volatile` ⇒ `plainSchema(schema)`；否则**只有** `schema.type === 'object'` 才递归 `schema.dict`，而递归结果为空时 `return void 0` ⇒ **零 volatile 字段的 `Config` 判 `undefined`**。
- **`describe()`（L413；门在 L416-419）**：`const schema = this.schema(entry); … const form = volatileForm(schema); if (form === void 0) return [];` ⇒ 命名空间**直接从 describe 列表里消失**（真机 `POST /api/settings/describe` 返回 **19** 个命名空间、其中**没有** `dsh-wsl-docker-ports`）。出口形状：**L436** `value = projectForm(form, plainConfig(entry.fiber.config))`、**L440** `redacted = redactSecrets(form, value)`、**L447/L450** `value: redacted.value` + `secrets: redacted.secrets`。
- **`write()`（L501；门在 L505-507）**：`const form = volatileForm(schema); if (form === void 0) throw new Error('Plugin entry "${ns}" has no volatile fields');`；`paths` 里任何非 volatile 路径 **L507** 抛 `Config field "…" is not volatile`（写文档的路径在 **L520** 同一句）⇒ **非 volatile 字段一个都写不进去**。
- ⇒ 🔴 **`896fa42` 的结论「导出 `Config` 就够」被真机证伪**：那一版确实导出了 `Config`，但字段**零 volatile** ⇒ 真机 `describe` 里仍然没有本包 ⇒ 缺陷 1 只修了一半。**T5.1 的两条文字（「刻意不 `.volatile()`」/「构建期 `volatile()` 0 次」）据此订正，原文保留不删**（订正标记已插在该条判据正下方）。
- **字段集定案 = 五个全标 + `writeToken` 另加 `role('secret')`**：逐条理由（命名空间门 / 写路径门 / `describe().value` 读回 / 凭据不回显）写在 `packages/wsl-docker-ports/src/config.ts` 文件头；**`package.json` 一行未改**（多锚点运行时解析，零新增依赖）。

**第二层陷阱（修缺陷 1 必然引入，必须在读侧解决）**：字段标了 volatile ⇒ `Schema.resolve` 走 `createVolatile(value)`（宿主 schemastery `src/index.ts:521-529`）⇒ 宿主交给 `apply` 的 config 是**带 `.get()` 的深冻结活体包装**（002 B-1 早已定案；本轮实测 `Config(undefined)` 的五个键**全部**是包装，`.get()` 分别给 `[]` / `{}` / `undefined`）。照旧**直接属性读** ⇒ 拿到的是**包装对象**：`elevationPolicy` 判不出 `ask` ⇒ 事实面 `'unknown'` ⇒ 执行层落 `'none'`（**永远写不动**）；`writeToken` 不是字符串 ⇒ 写通道**永久 401**。⇒ **修法**：新增 `src/config-read.ts`（统一解包 + **每次现读**），四个消费点全部改走它（`plugin.ts` 的 `distro` / 策略 / 凭据、`real-facts.ts` 的判决、`write-auth.ts` 的鉴权、`routes.ts` 的 `authConfigured`），且**不透传值、只透传现读函数**（volatile 写入是**原地**更新、不重挂载 ⇒ 拍快照就会永久 401 / 策略退化成 `none`）。

**本轮判据（全部离线；三道门在 Windows 复算，基线 401/401 与 9 文件/108 通过）**：
1. `tests/unit/config-gate.test.ts`：**把宿主的真 `volatileForm` 切出来跑**（`tests/helpers/host-gate.ts` 按顶层 `function <name>(` 切 `isRecord`/`walk`/`redactSecrets`/`plainConfig`/`plainSchema`/`volatileForm`/`isExpression`/`projectForm` 八段**原文**，`new Function('z','isVolatile',…)` 求值，并打印每段的**宿主行号区间**）⇒ `volatileForm(Config) !== undefined` 且字段恰为五个；**反例**：零 volatile（手工一份 + `896fa42` 的字段集）都判 `undefined`，同字段集加 volatile 后过门（差异只有 volatile 一处 ⇒ 因果干净）。**宿主产物不在盘上 ⇒ 只能 skip 并打印每个锚点的原因**（不自写一份「等价判定」顶替）。
2. `tests/unit/config-read.test.ts`：**活体包装 / 平凡对象 / 零参取值函数**三形态逐项同判 —— 四个读取面、`createPlanFacts(…).elevation().policy === 'ask'`、`createWriteAuthenticator(…)` 正确凭据放行（**不出现 401**）、`declaration` 含 `43312`；并用宿主 cosmokit **真引用**（`createVolatile` + `updateVolatile` = 宿主 `_commitVolatile()` 那对）证**原地轮换**：写完下一个读者即看到新值，旧凭据立即失效；另含 `src/plugin.ts` 源码面扫描（直接属性读 **0** 处）。
3. `tests/unit/config.test.ts`：判据**反向订正** —— 五个字段**全部** `.volatile()`（`volatile()` 调用次数 == 字段数，不许多标）、`writeToken` 另带 `role('secret')` 且**只有**它带；真工厂下解析结果的五个键**全部是活体包装**（第二层陷阱的现场证据），值断言统一先解包。
4. `tests/unit/client-settings.test.ts`：「已配置」改从 **`secrets[]`** 读（`writeToken` 标了 `role('secret')` ⇒ 宿主 `describe()` 一律 `redactSecrets: true` ⇒ `value` 里**没有**它，只在 `secrets: [{path:['writeToken'], set}]` 留布尔）；`value.writeToken` 作为未脱敏调用方的**兜底**保留。
5. **未放松的安全断言**：401 语义（未配置 / 缺凭据 / 错凭据三条文案与码不变）、`forbidden` 列表与运行时导出白名单、零提权（本轮无任何提权调用）、凭据不进 DOM/console（`settings-pipe` 只产出布尔）。宿主真 `redactSecrets` 复算：`describe().value` 里可见字段只有 `managedPorts`/`scopes`/`distro`/`elevationPolicy`，凭据仅以 `secrets[{path:['writeToken'],set:true}]` 出现。

**🔴 调用方法订正（上一轮派单给的命令是错的，逐字留痕）**：上一轮写的是「`GET /api/settings/describe`」。**真机实测：`settings/describe` 是 POST + RPC 信封** —— `POST /api/settings/describe`，body `{"type":"client-request","rpcId":"…","method":"settings/describe","payload":{"args":{}}}`；且 banner 上那个 `?token=` **不能**直接当凭据用 —— 必须先 `GET /?token=<banner token>` 换 cookie（`303` + `Set-Cookie`），后续请求带该 cookie。⇒ 本轮所有「describe 里有多少命名空间」的复算都按**这个方法**做；别处若还留着 GET 写法，一律以本段为准。
🔴 **同一轮的第二个调用法坑（2026-10-12 收口轮；派单给错、实测纠正）**：`GET /?token=<banner>` ⇒ **303** + `Set-Cookie` ⇒ 后续带 cookie 打 `POST /api/settings/describe`，body 逐字为
`{"type":"client-request","rpcId":"r1","method":"settings/describe","payload":{"args":{}}}`。
而 **`POST /dsh-wsl-docker-ports/write/plan` 的 body 就是 target 本身**（`{action, ports, scope, declaration}`）——**只有** `/write/apply` 外面包一层 `target`；把 plan 也包成 `{target:{…}}` ⇒ 走 fail-safe 报 `action 必须是 add/remove/fix/switch-scope 之一，实际 undefined`，**零写入**（不是崩，是拦）。⇒ 两个端点的 body 形状**不同**，照抄 apply 的写法必踩。

**未验（如实，不写成通过；🔴 2026-10-12 收口轮逐条订正，原文保留不删）**：① ~~**真机 `settings/describe` 里是否真的出现 `dsh-wsl-docker-ports` 仍未验**~~（原文：本轮零真机；结论只到「宿主源码判据 + 真机症状 + 对照包三处一致」这一层，**判据本身已用宿主的真函数离线跑过**）⇒ 🔴 **已关闭**：真机 `POST /api/settings/describe` 命名空间 **19 → 20**，末条就是 `dsh-wsl-docker-ports`（原文证据见 Phase 7 §2）；**「settings → 插件 config 投递链未验」这条未验项据此一并关闭**；② 真机上 `secrets[]` 是否真的含 `writeToken` 未验（离线用宿主真 `redactSecrets` 复算通过）；③ 本机 19 个命名空间的「包 → 命名空间」映射是按 bundle patch 证据做的，与真机 profile 实际加载的 bundle 集合是否完全一致未验；④ **`lib/` 产物需重建后本轮源码改动才在真机生效**（`lib/` 是 gitignored）；⑤ 🔴 ~~**新发现（本轮不修，另立待办）**：「清除凭据」派发的是**空串**，而宿主 `walk()` 的 `set: value !== void 0`（L24-29）对空串**仍给 `true`** ⇒ 清除后重新载入页面会显示「已配置」而写通道实际 401（方向**更保守**，非安全退化）；根治办法是清除改走 `mutate({op:'unset', path:['writeToken']})`（宿主原文：Apply field edits without restating redacted secrets）⇒ 归零成 `set:false`。本轮不动客户端写路径，只在 `client-settings.test.ts` 钉住事实。~~ ⇒ 🔴 **2026-10-12 收口轮已根治（关闭）**：按原文那句话的原方案实现（清除 = `remote.settings.mutate(ns, [{op:'unset',path:['writeToken']}], revision)`，**恒 3 实参**），并在 `tests/unit/write-token-unset.test.ts` 用**宿主真函数**（`isPlainObject` / `applyPathOp` / `member` 原文切片）当场复算：空串 ⇒ `set:true`（错，修前症状）、`unset` ⇒ 键被 `Reflect.deleteProperty` 删掉 ⇒ `set:false`（对），两条结论都喂进**客户端真 `readConfig()`**。详见 Phase 7 §3。

---

## Phase 7：2026-10-12 **收口轮**（真机通过 + 四条离线根治 + 三个文件拆分；本轮代理人**零真机**）

> **本轮边界**（与 Phase 5/6 同一口径，逐条可核）：代理人**未开浏览器、未装插件、未起实例、未跑任何 `netsh` / `New-NetFirewallRule`**；
> `package.json` / `pnpm-lock.yaml` **一行未改**（零新依赖）；`src/transport/**` 的功能代码**一行未改**（唯一改动是一处**类型签名放宽**，见 §4 裁定）；
> **不碰 `desktop` / `web`**、不改 desktop 的 MCP 配置；全部 `pnpm run` 一律不跑（会触发 auto-install 写回 lockfile）。
> **真机证据**全部来自**上一轮主人现场**（第九轮 / 第十轮），本轮只做**回填 + 离线根治 + 拆分**。

### 1) V6 / V7 / V8：三行状态改为**通过**

| # | 本轮订正后的状态 | 依据（原文证据） |
| --- | --- | --- |
| V6 | **通过** | 对话框点得开；逐条 `commandText` **三方逐字节相同**（DOM 文本 / UI 网络面板 / API 响应体）；`steps.length = 2`；影响面文案逐字含「会新增 1 条 portproxy 规则 + 1 条防火墙规则」；截图 `v6-confirm-ready.png` |
| V7 | **通过（真机·成功态）** | 点确认 ⇒ `exitCode:0`、`executed:[portproxy-add, firewall-add]`、**4005ms**；`portproxy` **19 → 20**、我方防火墙 **0 → 1**、总数 **816 → 817**；移除 ⇒ **20 → 19**、**1 → 0**、**817 → 816**；`portproxy` 抓取与写入前**逐字节相同**（sha 一致）；`audit` **2 条 applied**、凭据命中 **0**。截图 `v7-result-add.png` / `v7-result-remove.png` |
| V8 | **通过** | 错凭据 ⇒ 三条文案齐 + `write/plan` **恰好 +1**、不重试；截图 `v8-credential.png` |

🔴 **不得改写成「四态真机全通过」**：四态结果区**真渲染出来了**，但真机上**只出现 `executed` 一态**
（`failed` / `skipped` / `rolledBack` 节点数 **0 / 0 / 0** —— 本轮**没有**人为制造失败）
⇒ **那三态只有离线覆盖**（`tests/client/write-result.test.tsx` 14 条：①executed/②failed/④skipped/⑤rolledBack 各有用例）。
「四态分色**真机**各态可区分」这句话本轮**不成立**。

### 2) 关闭的未验项：「settings → 插件 config 投递链未验」

🔴 **已关闭**（原判据 = Phase 2 `T2.2` 的判据行，本轮已勾选并在行内留痕）。真机原文结论：
- `POST /api/settings/describe` 的命名空间 **19 → 20**，末条 = `dsh-wsl-docker-ports`（**有**本包了）；
- 本包条目的 `secrets` 逐字为 `[{"path":["writeToken"],"set":true}]`，**明文凭据在全响应里 0 处**；
- **轮换即时生效**：旧串立刻 **401**、新串立刻 **200** ⇒ 原判据里「重载插件行」这一步**真机上不是必需的**（留痕不改判据）；
- 收尾：`git status --porcelain` 空、`portproxy` **19**、`--frozen-lockfile` exit **0**。

**截图（真机，均在盘上）**：`E:\Temp\dsh-ui-accept4\shots\{v6-confirm-ready,v7-result-add,v7-result-remove,v8-credential}.png`。

### 3) 本轮四条**离线根治**（每条都有可证伪的反例对照，不靠「改了就对」）

- [x] T7.1 [REQ-1.3] **T2 文案订正：删掉已经过期的「未验证」**（`pane-settings.tsx` 的投递链说明）。
  - 判据：`tests/client/write-token-pane.test.tsx` 用例 **③d** —— `WRITE_TOKEN_TESTID.delivery` 的 `textContent` **不含**「未验证」、**含** `2026-10-12` / `settings/describe` / `secrets` / `轮换即时生效`，且**零凭据样值**（`TOKEN_SHAPE` 与那串 64 位 hex 在整棵 DOM 里 0 处）。实测：文案 **134** 字符、「未验证」**0** 处。
- [x] T7.2 [REQ-1.2] **T3 根治：「清除凭据」改走宿主 `mutate` 的 `unset`**（Phase 6 未验项 ⑤ 的那条待办）。
  - **修**：`RemoteSettingsLike` 增 `mutate(ns, ops, expectedRevision)`（**恒 3 实参**，同 `update` 的坑）；`settings-pipe.clearWriteToken()` 发**唯一一份冻结常量** `UNSET_WRITE_TOKEN_OPS = [{op:'unset', path:['writeToken']}]`；`pane.tsx` 的布尔**只**取 `mutate` 的**返回值**（宿主写入后重新 describe 的脱敏视图，`namespaceView(descriptor)`），取不到视图时**不猜**（`null`）；`write-token.ts` 的 `clearWriteToken` 由 `save('')` 改为 `unset()`。
  - 判据（离线，全部跑绿）：`tests/unit/write-token-unset.test.ts` —— 用**宿主真函数**（`isPlainObject` / `applyPathOp` / `member` **原文切片**，行号随 `slices` 打印）当场复算：**空串 ⇒ `set:true`**（修前症状，喂进客户端真 `readConfig()` 得 `true`）/ **`unset` ⇒ 键被 `Reflect.deleteProperty` 删掉 ⇒ `set:false`**（得 `false`）；反向对照 = 同一条路径的 `set` 仍能写回（`true`）、`unset` 他字段不碰凭据、空对象幂等。
  - 判据（组件面）：`vitest` **⑤**（确认前 `update`/`mutate` 均 0 ⇒ 确认后**恰好 1 次 `mutate`**、ops 逐字、实参 **3** 个、`update` **0** 次）/ **⑤c**（反例：写空串后宿主仍报 `set:true`）/ **⑤d**（清除后**重挂载**再检查 ⇒ 仍「未配置」，且**没清过的对照 runtime 仍报「已配置」** ⇒ 布尔随服务端视图走、不是内存推断）/ **⑤b** / **⑦b**（服务端拒绝 ⇒ 不静默、本会话**不**清）。
  - 🔴 **安全断言未放松**：凭据不进 DOM / console（⑥ 静态 + ⑥b 运行时本文件同步扩到新路径）、`forbidden`（`run/invoke/exec/elevate/spawn`）与「写配置零提权」两条断言**逐字未动**；`mutate` 的入参里**没有值**这一位（零凭据字节出门）。
- [x] T7.3 [REQ-1.2] **T4：007 的**同款**两参缺陷**（同包不同插件：`packages/terminal-profiles/src/client/config-pipe.ts`）。
  - **修**：`expectedRevision === undefined ? service.update(ns, patch) : service.update(ns, patch, rev)` ⇒ **恒传 3 个**（取不到 revision 时显式占位 `undefined`；codec 是 `union([_undefined(), number()])` 且 `acceptsUndefined: true` ⇒ 合法，投影时被丢弃 ⇒ **语义仍是「无条件写」**，未变）。
  - 判据：`tests/unit/client-config-pipe.test.ts` 三条 —— **反例必红**（按宿主 `prepareInvocation` 的实参计数规则写的严格假件：两参调用当场抛 `client api: settings/update expected 3 argument(s), got 2` = 真机原话）/ **正例必绿**（恰好 3 实参、`revisionPassed === false`）/ 无 revision 时 `argCount === 3`。实证：把 `config-pipe.ts` **临时改回**两参 ⇒ `27 tests | 2 failed`；改回修后 ⇒ `27 passed`。
  - 🔴 **007 真机已验过、本轮零回归**：`vitest run` 34 文件 **425 passed | 1 skipped**（基线 423 ⇒ **+2** 全来自这三条里的两条净增）。
- [x] T7.4 [NFR-1] **T5：三个超 400 行文件拆分**（「单文件 ≤ 400 行」是 SHALL，按**原始**行数、`split('\n')` 口径复算）。
  - `src/plugin.ts` **400 → 310** + 新增 `src/host-face.ts` **148**（切面 = **类型面 vs 装配面**：7 个纯类型声明搬出，`plugin.ts` 用 `export type {…} from './host-face.ts'` **再导出** ⇒ 公开面**一行未变**）；
  - `tests/client/pane.test.tsx` **455 → 244** + 新增 `tests/client/pane-write.test.tsx` **155** + `tests/client/pane-harness.ts` **131**（切面 = **只读展示面 vs 写回/失败态/样式注入**；台架两个文件共用）；
  - `tests/unit/plugin-entry.test.ts` **461 → 313** + 新增 `tests/unit/plugin-write-route.test.ts` **128** + `tests/helpers/plugin-rig.ts` **61**（切面 = **入口/装载/委派 vs 写通道路由+`/write/plan` 端到端**）；
  - 🔴 **用例一条没删**（脚本对拍，不是眼看）：`plugin-entry` 拆前 **16** = 拆后 **16**（名字集合 `Compare-Object` 空差）；`pane` 拆前 **19** = 拆后 **19**（同法）；新增的三个「台架/装配」文件**不含 `test()` / `it()`** ⇒ 不改变用例数。
  - 🔴 **第二批（同一轮，自证式补拆）**：本轮的 T2/T3 改动**自己**把两个原本合规的文件推过了 400 ⇒ 按同一条 SHALL 再切一次（**不是**扩大范围，是**修自己造成的违规**，如实记）：
    - `tests/client/write-token-pane.test.tsx` **359 → 245** + 新增 `tests/client/write-token-clear.test.tsx` **149** + `tests/client/write-token-harness.tsx` **166**（切面 = **生成/一次性显示/布尔态/console vs 清除（T3）/共用台架**；台架必须是 `.tsx` —— 它含 JSX，且**不含** `describe` / `it` ⇒ 不被 `vitest` 收集）；
    - `tests/unit/client-settings.test.ts` **308 → 329** + 新增 `tests/unit/client-clear-token.test.ts` **140**（切面 = **写值管道 vs 按路径 unset 管道**）。
    - 用例数不变的对拍口径：拆之前 `vitest` 报 `write-token-pane.test.tsx` **15** 条、拆之后 **10 + 5 = 15**；拆之前 `node --test` 全包 **414** 条、拆之后仍 **414** 条（逐条名字集合 `Compare-Object` 空差）。
  - 判据：**14 个**文件（含全部新建）逐个 `split('\n')` 复算，**全部 ≤ 400**（最大 = 313）。**没有**靠压缩注释凑行数（拆的是模块边界）。
  - ⚠️ **额外发现（不在本轮范围，未动）**：`tests/unit/transport-apply.test.ts` = **748** 行，**HEAD 就是 747**（本轮零改动）⇒ 它是一条**既存**的 SHALL 违规，如实记录、本轮不擅自扩大范围去拆。

### 4) 两条**口径订正**与一条**裁定留痕**（本轮新增，均为追加、不删原文）

- 🔴 **口径订正（探针 profile 的基线不算「零软链」）**：收尾复算里的「软链数必须为 **0**」**作废** ——
  探针 profile 基线里**允许**存在 `node_modules/dsh-volatile-probe` 软链（指向 `%LOCALAPPDATA%\Temp\dsh-volatile-probe`，**是该 profile 自带的探针插件**、属 bundle 的一部分）。
  ⇒ 判据改为「**不允许有我方两个包的链接**（`dsh-terminal-profiles` / `dsh-wsl-docker-ports`）」；数软链总数会把别人的合法内容算成残留。008 侧同一判据行已同步订正（见 008 `tasks.md`）。
- 🔴 **裁定（`0f5c4ed` 把 `src/transport/**` 的签名放宽：参数 `string` → `unknown`）＝ 事后**接受****，理由三条：
  ① `unknown` 是 `string` 的**超集** ⇒ 调用方一个都不用改；② 运行时协议**未变**（同一份编解码、同一份路径）；③ 「**每次请求现读凭据**」这条要求**必须**这样放宽才能落实（否则拍快照 ⇒ 轮换后**永久 401**），所以它不是「顺手扩大改动面」。
- 🔴 **但记一条流程违规（不因结果对就抹掉）**：派单原文是「**确需变更就停下报告**」——它**改了且没停**。
  **披露不等于授权**：事后追认只对**这一次**有效，规则本身**不变**（下次仍必须停下来问）。⇒ 结论：**接受改动、记违规**。

### 5) 未验项（如实；本轮**零真机**，以下都不写成通过）

① 🔴 **`failed` / `skipped` / `rolledBack` 三态的「真机各态可区分」仍未验**（真机只走到成功态，见 §1）——
   要验必须在真机上**人为制造**一次失败（例如故意给一个会被防火墙门拦下的端口，或让 `portproxy` 在两步之间被外部改动）并**留下还原证据**；本轮**没有**做，所以不勾。
② `mutate` 的真机行为（`unset` 后落盘、重载插件行后仍为未配置）**只有离线证据**（宿主真函数 + 组件面）；**真机未跑**。
   离线已证的边界：`applyPathOp` 的 `unset` = `Reflect.deleteProperty`（键消失）；**未证**的边界：真机 settings 文档里该键是否被**物理删除**（而不是写成 `null` / 空串）—— 落盘形态属宿主实现，本轮未读那一层。
③ 007 的同款修复**真机未复跑**（007 的 `expectedRevision` 分支在本机真实 profile 里**没被走到**，离线反例/正例已双向证）。
④ 三个拆分文件**只动了位置**：`src/host-face.ts` 的类型再导出链在本分包 `tsc` 下 exit 0，但**未**在真机 bundle 重建 + 实例加载下复验（`lib/` 是 gitignored，需重建才生效）。
⑤ 「`secrets` 位图与真机 `writeToken` 的实际落盘位置」的**一一对应**未验（真机只验到 `set:true` 与轮换即时生效两件事）。

### 6) 本轮三道门复算（Windows 侧；基线 = 拆分/根治**之前**的实测值）

| 门 | 基线 | 本轮实测 | 结论 |
| --- | --- | --- | --- |
| `tsc -p tsconfig.json` × 3 包 | 全部 exit 0 | 全部 exit 0 | 未回归 |
| `node --test --test-concurrency=1 "tests/**/*.test.ts"`（wsl-docker-ports） | **409 / 409**（exit 0） | **414 / 414**（exit 0） | **+5**（T3 四条 + 宿主真函数门一条），零失败 |
| `node --test …`（terminal-profiles） | exit 1（4 个文件是 vitest-only，**既有**） | exit 1，同样这 4 个 | 与基线**逐条相同**，非回归 |
| `vitest run`（wsl-docker-ports） | **9 文件 / 108 通过** | **11 文件 / 111 通过** | **+2 文件**（`pane-write.test.tsx` / `write-token-clear.test.tsx`）**+3 用例**（③d / ⑤c / ⑤d）；台架 `*.tsx` 不被收集 |
| `vitest run`（terminal-profiles） | **34 文件 / 423 通过 \| 1 skipped** | **34 文件 / 425 通过 \| 1 skipped** | **+2**（T4 三条净增），零回归 |

## Phase 8：2026-10-12 收尾轮 —— `lib/` 重建**硬判据** + 未验项台账 + 验收环境备注（本轮**只改文档**：零代码、零真机、零新依赖、不跑 `pnpm run`）

### 1) 🔴 新增硬判据（SHALL）：交付 / 真机验收前**必须重建 `lib/` 并记录 sha**

- **判据（可二值判定）**：真机验收**开始前**，`packages/wsl-docker-ports/lib/**` 必须由**当前 HEAD 源码**当场重建并产出 per-file sha256 清单；验收后当场复算该清单与基线对比。**未重建 ⇒ 真机加载的是旧产物 ⇒「离线全绿」与「真机通过」脱钩，真机结论作废。**
- **真凭实据（本轮实测；`lib/` 当时仍停在 `0f5c4ed` 的产物上）**：① `lib/**` mtime **11:08:17** vs `src/**` **11:40:48**（**差 32 分钟** —— 源码已改、产物未换）；② `unset` 在 HEAD `src/client/**` 复算 **25** 处（大小写敏感；不敏感 **29**）而基线 `lib/client.js` **0** 处（🔴 派单原文记 **28**，我复算不出该值 ⇒ **以复算为准**；「基线 **0** 处」这条判据本身不受影响）；③ `lib/` 在 `.gitignore` 第 **3** 行 ⇒ **`git status` 看不见它过期**（`git check-ignore -v packages/wsl-docker-ports/lib/client.js` ⇒ `.gitignore:3:lib/`）—— 这正是「不重建也能 `git status` 空」的原因。
- **本轮处理（顺序固定、可复现）**：① 先**逐字节备份** `lib/`（**88** 文件 + per-file sha256 tsv）→ ② **直接 `node` 调用**既有构建脚本重建（🔴 **不经 `pnpm run`**：pnpm 11 的 `verify-deps-before-run` 会 auto-install 并写回 `pnpm-lock.yaml`）→ ③ 真机验收后**逐字节还原**。
- **还原判据（当场复算，非引述）**：基线 tsv（**88** 行）vs 还原后当场重算（**88** 行）`Compare-Object` = **差异 0**；`lib/client.js` 回到 **137,864 B** / sha256 `683faa83…`。**整树 sha 记「相等」** —— 派单记录 `a8e4da21…`，🔴 我**未复现**该前缀（自定可复现口径：per-file tsv 88 行按路径排序、LF 连接、对 UTF-8 字节取 sha256 ⇒ 当场得 `72a135c8…`）；**能独立二值判定的只有 per-file `88/88 diff 0`**，整树前缀按派单记录标注，不谎称复算过。
- **产物与备份（在盘，可核对）**：`E:\Temp\dsh-ui-accept5\{lib-baseline\,lib-baseline.sha256.tsv,lib-head.sha256.tsv,lib-restored.sha256.tsv,build-2-client.log}`；`lib-head.sha256.tsv` = **89** 行（重建版）、与基线 tsv diff **11** 行 ⇒「过期」与「重建」两态都在盘上可核；当前盘上 `lib/` = 基线（**88** 文件、`lib/client.js` **137,864 B**）。

### 2) 未验项台账（如实；**一律不写成通过**）

① 🔴 `failed` / `skipped` / `rolledBack` **三态真机未出现**（真机只走到成功态，三态节点数 **0 / 0 / 0**）⇒ **仅离线覆盖**（`tests/client/write-result.test.tsx` **14** 条）⇒「四态真机各态可区分」**不成立**。
② 🔴 **「清除凭据」的真机落盘未验**：`mutate({op:'unset', path:['writeToken']})` 之后 `describe.secrets[].set` 是否真变 **`false`**、写入口是否真回到**一律 401** —— 本轮只做到**两段式二次确认的形态观测**，**未点确认**；离线证据（宿主真函数 `applyPathOp` + 组件面）在册，**真机未跑**。
③ `mutate` 的**真机落盘形态**未验（该键是被物理删除，还是被写成 `null` / 空串 —— 属宿主实现，未读那一层）。
④ **007 的同款修复真机未复跑**（`expectedRevision` 分支在本机真实 profile 里没被走到；离线正/反例已双向证）。
⑤ `host-face.ts` 的**再导出链**只在 `tsc` 下验过（`lib/` 重建后已在真机加载，但**类型面未单独复验**）。

### 3) 验收环境备注（本轮为验收真实动过的唯一环境项）

- 为验收曾把 `desktop` 的 `mcp-chrome-devtools` **临时**改为 `--browserUrl http://127.0.0.1:9223`（专用 Chrome + CDP 9223，不碰主人正在跑的实例）⇒ **已回退为 `--autoConnect`**（临时改动已回退）。**当场只读复核**：`C:\Users\EDY\.dsh\profiles\desktop\cordis.patch.yml` 里该条目 `args[0] = "--autoConnect"` ✅。
- **备份文件路径**：`C:\Users\EDY\.dsh\profiles\desktop\cordis.patch.yml.bak-20261012-v6v8`（**10,192 B**，2026-10-12 09:30:05）—— 与当前配置逐行 `Compare-Object` **差异 0**；逐字节比到 **10,192** 字节**全等**，唯一差异是当前文件多一个**尾换行**（`0a`）⇒ 回退干净。

---

## 迁入记录（🔴 **原文逐字保留**，只迁位置、不删内容；来源 = 008 `tasks.md`，2026-10-12 拆分）

### 1) 008 `T3.1` 客户端写前确认对话框：离线完成（2026-10-12，零真机、零提权、零写入）

**施工**（新增 5 文件 / 改动 6 文件，全在 `src/client/**`；🔴 `src/elevate/**`、`src/write/**`、`package.json`、`pnpm-lock.yaml` 一行未改）：
`write-token.ts`（凭据仓库：sessionStorage 命名空间键 + 32B 随机十六进制 + **一次性**显示）、
`write-channel.ts`（`/write/plan`+`/write/apply` 客户端 + 白名单序列化 + 失败四分类 + 声明读取器）、
`write-dto.ts`（响应解读：`commandText` **逐字搬运**）、`write-confirm.tsx`（确认对话框 + 提权档置灰）、
`write-panel.tsx`（预演 → 确认 → 执行状态机）；改动：`wire.ts`（`init.body` 可选字段）、`settings-pipe.ts`（+`writeWriteToken`）、
`host.ts`（`ClientRuntime.write`）、`index.ts`（组装 wiring）、`pane.tsx` / `pane-settings.tsx`（挂载凭据块 + 写通道块，**挂载期零 IPC**）。

**契约落地（逐条）**：① 凭据默认仍空，由配置页「生成并保存写通道凭据」经 `remote.settings.update('dsh-wsl-docker-ports', {writeToken})` 写入并一次性显示；
② 客户端存 **sessionStorage**（刷新不丢、不落盘、绝不进日志/审计/错误文案 —— 静态扫描 `console.` 与 `localStorage` 用法 **0 处**）；③ 401 ⇒ 指路 + **不重试**（请求数停在该次）；
④ 对话框逐条渲染服务端 `steps[].commandText` **原文** + 影响面（`lan` 逐字含「会新增 1 条 portproxy 规则 + 1 条防火墙规则」）+ notes；
⑤ **未点确认 ⇒ 零请求**（对话框零副作用；apply 只在确认回调里发一次）；⑥ `policy` 为 `none`/`unknown` ⇒ 按钮置灰 + 写明原因；
⑦ 409/403 ⇒ **重新 plan + 重新要求确认**（不静默重试）；⑧ 客户端只回传 `planId`+`ticket`（+`confirmed:true`/`origin:'user'`）与声明式 target，**命令文本没有入口**。

**判据**：`tsc -p tsconfig.json` **exit 0**；全包 `node --test --test-concurrency=1 "tests/**/*.test.ts"` **386/386（0 fail）**
（其中 T5.7 由「5 个方法」订正为 **6**：新增的 `writeWriteToken` 是**配置写入**、不是执行/提权入口，`forbidden` 断言未动）；
`vitest run` **75/75**（7 文件；新增四份共 **44** 条：`write-token` 10 / `write-channel` 11 / `write-confirm` 12 / `write-panel` 11）；
`lib/client.js` 由既有 esbuild 脚本重建（**123,207 B**，首行自注册形态未变）。

**顺带对齐复选框**：T2.4（订正后判据 + 用例⑦）、T2.5（判据本就是假后端快照断言 + 用例⑤）、T2.6（T2.8 的 `audit` 恰 2 条 + 403 不留审计；T2.9/T2.10 的 401 不记账）、T2.8（本节 PASS 表）改为 `[x]`；
**T2.7 留空** —— 正文**无任何** PASS 记录提及它的三条红线单测（`redline-guards` / `elevate-script` 里的 `reset` 白名单属 003/005 既有测试，不能拿来勾 008 的 T2.7）。

🔴 **未验（如实）**：**真机 UI（V6）未跑** —— 本轮代理人未开浏览器、未装插件、未起实例、未跑任何 `netsh`/`New-NetFirewallRule`
⇒「页面上真能点出对话框并弹命令原文」只有**离线渲染证据**；另「配置页按钮写入 → 插件 config 投递」这条链路在真机**未验证**
（服务端真读到 `writeToken` 已由 T2.9 证实，但把值**写进去**的这步未上真机；UI 文案已明写「若无效应重载插件行」）。

> **迁入备注（2026-10-12）**：以上各段与 008 原文**逐字相同**；008 侧只留「判据数字 + 指针」三行，以免两处漂移。

### 2) 008 `T3.3` 清单：配方原文（安装 / 配置 / 端点基址）

**安装（主人自己跑）**：

    dsh plugin --profile <profile> add "dsh-wsl-docker-ports@link:E:\NodeProjects\dsh-wsl-toolkit\packages\wsl-docker-ports"

**配置（`profiles/<profile>/cordis.patch.yml` 里 `- id: dsh-wsl-docker-ports` 的 `config:`）** —— 两道闸门都得给值，缺任一即进 fail-safe（写通道 401 / 策略认不出 ⇒ `none` ⇒ 不写）：

    config: { elevationPolicy: ask, writeToken: "<随机长串>" }

**端点基址**：`http://127.0.0.1:<GUI端口>/dsh-wsl-docker-ports/write/{plan,apply,audit}`；凭据走 `?token=<writeToken>`（或 `Authorization: Bearer`）。

### 3) 008 `T3.3` 清单：V6 判据行原文（**编号 V6 在 008 侧保留为空位**）

| V6 | 🟡 **T3.1 已离线接线（2026-10-12）；真机 UI 复核未做**：客户端确认对话框（逐条命令原文）已接到页面上（预演 → 确认两段式），离线判据 44 条全绿；T3.2 结果四态分色**未接线** | 见左（离线层已验） | 页面上**点得到**写入口却**没有**对话框 ⇒ 回归 |

### 4) 008 `T3.3` 清单：收尾复算原文（每次必查）

**收尾复算（每次必查）**：`portproxy` 严格 IPv4 行数回 **19**（⚠️ 朴素 4-token 正则会数进表头/分隔行 ⇒ 误报 **21**；口径见 T2.8 留痕）；
我方防火墙规则 **0**；规则名与听端口的残留 **0**；node 进程回 **14**；探针端口空闲；`pnpm install --frozen-lockfile` exit **0**；`git status --porcelain` 空。

### 5) 008 `T3.3` 清单：未验项原文（**008 侧只留了 ① 的压缩版**）

⚠️ **未验（如实）**：① 本节**尚未整份跑过**（V1–V5 的等价断言由 T2.8/T2.10 当场验过，但**不是**在「按本清单逐条」的形式下）；② V6 的**离线**部分已由 T3.1 接线并验（44 条 vitest 判据全绿），但**真机 UI 复核仍未做**（该轮代理人未开浏览器）；T3.2 结果四态分色未接线；③ `writeToken` **未配置**时 401 的 fail-safe 分支只有离线单测（未上真机）；④ `origin:"agent"` + `passby` 的降级为 `ask` 未验。

### 6) 008 `T3.3` 清单：为什么本轮只做 T3.3（推导原文，**裁定依据**）

> **为什么本轮只做 T3.3**（Phase 3 未勾选者：T3.1 / T3.2 / T3.3）：T3.1（确认对话框）与 T3.2（结果四态分色）都要求客户端先接上写通道，
> 而 `plugin.ts:324` 明记「仍未接线 ⇒ **页面上点不到写入口**」，且客户端侧连 `ElevationInvoker` 都还是 gap（`plugin.ts:321`）
> ⇒ 两者**不能独立完成**（还要先定客户端如何拿写通道凭据：T2.9 后无 `writeToken` 一律 401）。T3.3 不依赖它们，故为**最小且可独立完成**的一个。
