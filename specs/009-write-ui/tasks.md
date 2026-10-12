# 009 写入口 UI —— 任务

> 每行一个任务；`[REQ-N]` 指向 [requirements.md](./requirements.md)。**「判据」必须是可二值判定的**（跑得出来、看得见）。
> **来源**（2026-10-12 从 [008-write-transport](../008-write-transport/tasks.md) 拆出，**同包不拆包**）：承接 008 的 `T3.2`（结果四态）、008 `T3.3` 清单里的 **V6**（真机 UI 复核）、**007 配置页的「生成并保存写通道凭据」按钮**，以及只属于 UI 面的新判据。**008 侧保留 `T3.2` / `V6` 编号为空位并注明「已迁至 009」。**
> **行数门**：warn **200** 只是提示、不强制压缩；硬门 = LeanSpec `maxLines` **400**（本文件当前 **121**，余量 **279**）。接近 400 ⇒ 必须再拆 Spec，**不得**删已验证结论 / 未验项 / 裁定依据 / 命令原文证据。
> **真机白名单**：探针只许**临时 / 一次性 profile**（AGENTS.md：**不得**用 `desktop` / `web`），跑完逐字节还原。

## Phase 0：契约冻结（不写产品代码）

- [x] T0.1 [REQ-1..10] 把 008 `T3.1` 已实现的八条客户端契约**逐条冻结**进 [requirements.md](./requirements.md) §2（含源码出处与主人裁定日期）。
  - 判据：十组 REQ（REQ-1..10）每条都能指到一份源码文件或一次裁定；`requirements.md` 行数 ≤ **200**（实测 **99**）。
- [x] T0.2 [REQ-1.1] 复核服务端 fail-safe 的**边界**：`writeToken` 默认空 ⇒ `plan` / `apply` / `audit` 恒 **401**；**服务端证据不重复造**（008 的 `tests/unit/transport-write-auth.test.ts` 与 T2.9/T2.10 的真机 401 矩阵在册）。
  - 判据：指针可达；本 Spec 的 `git diff` 里 `src/transport/**` **零改动**（只迁文档，不碰服务端）。

## Phase 1：结果逐步反馈（四态；迁自 008 `T3.2`）

- [ ] T1.1 [REQ-9.1] `write-panel.tsx` 结果区：`executed` / `failed` / `skipped` / `rolledBack` **四态分色**（各自 `data-testid` + 类名；颜色走 `--dsw-*` token）。
  - 判据：`vitest` —— 四态各有渲染分支用例（≥ 4 条）；「无该项」与「有该项」可区分（空态不渲染空段）。
- [ ] T1.2 [REQ-9.2] 失败项**必带可读原因**：每条失败渲染 `name` + `reason`（不是只给个数；`reason` 为空串时给兜底文案）。
  - 判据：构造 `failed: [{ name, reason }]` ⇒ 断言 `reason` 文本出现在**同一条目内**；条目数 == `failed.length`。
- [ ] T1.3 [REQ-9.3] 零硬编码 hex（口径来源：003 `NFR-7` / 002 `NFR-4`；003 Phase 6 的门已在当时的 `src/client/**` 上真扫过）。
  - 判据：静态扫描 `src/client/**` 的 `#[0-9a-fA-F]{3,8}` 命中 **0**，且**非空扫描**（文件数 > 0）。

## Phase 2：配置页「生成并保存写通道凭据」（迁自 007 配置页）

- [x] T2.1 [REQ-1.2–1.4 / REQ-2.1–2.4] 凭据块（`pane-settings.tsx` 的 `WRITE_TOKEN_TESTID` 区块 + `write-token.ts` + `settings-pipe.writeWriteToken`）：按钮「生成并保存写通道凭据」⇒ 32B 随机 hex ⇒ `remote.settings.update('dsh-wsl-docker-ports', { writeToken })` ⇒ **一次性显示**；**默认仍为空**（本 Spec 不改这个默认值）。
  - 判据（**离线已完成，由 008 `T3.1` 交付**）：见文末「迁入记录」§1 的 44 条 `vitest`（其中 `write-token` 10 条含「配置写失败 ⇒ 不入本会话」与「四个客户端文件零 `console`、零持久存储」）。
- [ ] T2.2 [REQ-1.1 / 1.2] **真机投递链复核**（需主人 / 探针 profile；**本轮未跑**）：页面按钮点得动 ⇒ 写进 `profiles/<profile>/cordis.patch.yml` 的 `config.writeToken` ⇒ **重载插件行** ⇒ 服务端真读到。
  - 判据：写前 `POST …/write/plan?token=…` ⇒ **401**；点按钮 + 重载插件行后再打 ⇒ **200**；配置文件里的值与页面**一次性显示**的串**逐字相同**；跑完逐字节还原（`git status --porcelain` 空 + `portproxy` 19）。
- [x] T2.3 [REQ-1.2] **补一条离线判据**（本轮核对 T5.7 时发现的覆盖缺口）：`tests/unit/client-settings.test.ts` 的「每个写方法只产出恰好一个键的 patch」用例表目前只有 **4** 个写方法，`writeWriteToken` 只出现在导出面断言里 ⇒ 把它补进用例表。
  - 判据：用例表含 **5** 个写方法；`writeWriteToken('t')` ⇒ patch 键集合恰 `['writeToken']`、命名空间 = 包名、有能力时带 revision。**不得**改动 `forbidden`（`run/invoke/exec/elevate/spawn`）与「写配置零提权调用」两条断言（2026-10-12 已逐字核对**未被削弱**）。

## Phase 3：真机 UI 复核清单（V6 迁自 008 `T3.3`；V7 / V8 为本 Spec 新增）

**配方（安装 / 配置 / 端点基址）与收尾复算**：原文**逐字保留**在文末「迁入记录」§2/§4；V1–V5（后端写路径）的判据行留在 008 —— 两边**共用这一份配方**，不各自再写。
🔴 代理**不碰任何 profile**；**CLI 不能操作 `desktop`**（002 已证 `rejectElectronProfile`）⇒ 桌面实例请在**应用内**安装。

| # | 判据（可二值判定） | 通过 | 回归信号 |
| --- | --- | --- | --- |
| V6 | （**原文迁自 008 T3.3**，见 §3）🟡 **T3.1 已离线接线（2026-10-12）；真机 UI 复核未做**：客户端确认对话框（逐条命令原文）已接到页面上（预演 → 确认两段式），离线判据 44 条全绿；T3.2 结果四态分色**未接线** | 见左（离线层已验） | 页面上**点得到**写入口却**没有**对话框 ⇒ 回归 |
| V7 | 配置页「生成并保存写通道凭据」点一次 ⇒ 页面**一次性显示**的 32B hex 与 `cordis.patch.yml` 的 `config.writeToken` **逐字相同**；重载插件行后同一页面点「预演」⇒ **200**（不再是 401） | 三处一致 | 点了按钮仍 401 / 明文出现第二次 / 明文落进 `localStorage` |
| V8 | 预演 ⇒ 对话框逐条显示**服务端命令原文**；点「取消」⇒ 请求数停在 **1**（零 `apply`）；点「确认」⇒ 恰好 **1** 次 `apply`，结果区**四态**可见且失败带原因 | 见左 | 取消后仍发 `apply` / 命令文本被改写 / 失败只给个数 |

- [ ] T3.1 [REQ-10.1] 清单固化（V6–V8）+ 状态**如实标注**「未通过（未验）」（离线渲染证据**不冒充**真机）。
  - 判据：本文件含 V6–V8 三行 + 状态标注；配方指针可达（「迁入记录」里确有原文，逐字可核）。
- [ ] T3.2 [REQ-10.2] 真机按清单跑一遍（**需主人在场**；本 Spec 本轮**未开浏览器、未装插件、未起实例、未跑任何 `netsh` / `New-NetFirewallRule`**）。
  - 判据：V6–V8 三行各自给出真机原文证据（响应体 / 页面文本 / 文件内容哈希）；跑完逐字节还原。

## Phase 4：收口

- [ ] T4.1 [NFR-1] 依赖未增：`dependencies` / `devDependencies` 与拆分前一致；未引 E2E / 浏览器自动化框架。
  - 判据：`git diff -- packages/wsl-docker-ports/package.json packages/wsl-docker-ports/pnpm-lock.yaml` 空（本轮实测：**空** ✓）。
- [ ] T4.2 [NFR-2] 体积 / 行数门：本 Spec 涉面的 `src/client/**` 逐个报数（≤ 400 行原始、≤ 40KB 去注释去空行）。
  - 判据：脚本当场出数；超限则拆文件，**不抬阈值**（AGENTS.md：40KB 之后不许再抬）。
- [ ] T4.3 文档同步：008 的「已迁至 009」空位与指针、本 Spec 的 README 导航、`AGENTS.md` 的拆分留痕（若需变更则留痕）。
  - 判据：008 的 `T3.2` / `V6` 指针指向本文件真实存在的锚点；README 链接可达（本轮已落 008 侧指针，AGENTS.md 待补）。

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
