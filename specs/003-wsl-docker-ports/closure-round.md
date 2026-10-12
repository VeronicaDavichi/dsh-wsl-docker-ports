# 003 关闭评估轮记录：14 条未勾项逐条结清 → 勾选 8 条 / 保留 6 条（2026-10-12）

> **本轮边界（先写死）**：**零真机** —— 未装任何 profile、未起任何实例、未跑 `netsh`、未开浏览器，**未碰** `desktop` / `web` / `volatile-probe`（另一轮 `c4252a12` 正在用 volatile-probe 做真机补证）；**未跑 `pnpm run`**（pnpm 11 的 `verify-deps-before-run` 会 auto-install 并写回 lockfile）⇒ 所有门一律 `node` 直调；**零新依赖**、**零产品代码改动**、**未碰** `packages/terminal-profiles/**`（已收口）。
> **判据只留一份**：本文件装**逐条判据 + 命令 + 原始输出**；[`tasks.md`](./tasks.md) 只留勾选与指针（体例同 [008 关闭轮](../008-write-transport/closure-round.md) 与 [009 验收轮](../009-write-ui/acceptance-round.md)）。
> **改法**：`.md` 一律走**字节级脚本**（`fs.writeFileSync` + 显式 EOL，**不用 `edit` 工具** —— 它会静默归一 CRLF）。`tasks.md` 本体是 **CRLF**（260 CRLF / 0 裸 LF）、`README.md` 是 **LF** ⇒ 两种 EOL **各自原样保留**（改后复算见 §4）。

## 0. 未勾项清单（开工时实测 **14** 条，口径 `^\s*-\s*\[ \]`；结清后 **6** 条）

| # | 行 | 条目 | 本轮结论 |
| --- | --- | --- | --- |
| 1 | 25 | `T0.3（已迁出）` 提权最小验证 | ✗ **不勾**（真机；内容已迁至 005 T0.1，**005 侧同为未勾**）⇒ §5.1 |
| 2 | 30 | `T0.5` 安装接入验证（D-1） | ✗ **不勾**（真机二值）⇒ §5.2 |
| 3–10 | 142 / 146 / 150 / 153 / 156 / 159 / 162 / 166 | `T5.1`–`T5.8` | ✅ **全部勾选**（离线判据逐条跑绿）⇒ §1 |
| 11 | 198 | `T6.7` 插件宿主入口 `apply` | ✗ **不勾**（⑤ 公开面收敛 = **主人待拍板**；①–④ 已验）⇒ §5.3 |
| 12–14 | 211 / 214 / 217 | `T7.1` / `T7.2` / `T7.3` | ✗ **不勾**（Phase 7 = P1；前置 = P0 真机验收；代码面零命中）⇒ §5.4 |

🔴 **两类「不是复选项」的内容本轮原样未动**：① 普通 bullet 的真机待办清单（未改写成 `- [ ]`）；② 「空位 / 已迁出」标记（`T0.3`、Phase 3 抬头、Phase 4 抬头、Phase 6 抬头的迁出说明）—— 只对**本来就有复选框**的 14 行作判断。

## 1. T5.1–T5.8：八条按**字面离线判据**逐条结清（判据即 tasks.md 的「验证」列）

| 条目 | 字面判据（tasks.md） | 在库用例（提交进仓，非临时脚本） | 实测 |
| --- | --- | --- | --- |
| **T5.1** 容器表 + 端口表（五态） | 五态标签各自可渲染；刷新后时间戳更新；打开页面**零**写操作（NFR-2） | `tests/unit/client-rows.test.ts` 的 `T5.1`×4（五态标签/色调互不相同 · 逐态建行 · conflict 零可点动作＋反向对照 · 刷新时间戳 · docker 失败不给空表 · 区间/未发布映射）· `tests/client/pane.test.tsx` `T5.1 开页只读（NFR-2）`×3（读 1 次 / 配置写 0 / 提权 0 · 五态各一行 · 刷新时间戳真变）· `tests/client/entry.test.tsx` `T5.1`×9 | ✅ 全绿 |
| **T5.2** NAT 门与前置检查 | 非 NAT 时**无**任何写控件可点；指引文本含路径与命令；断言**未**写 `.wslconfig` | `client-rows.test.ts` `T5.2`×3（gate 关闸 · 每一写控件不可点＋NAT 反向对照 · 指引含 `C:\Users\EDY\.wslconfig`＋`wsl --shutdown`＋note 匹配 `/不会自动修改/`）· `pane.test.tsx` `T5.2`×2（DOM 全灰＋`sel-elevation` 仍可用 · 指引 DOM 含路径与命令）· `tests/unit/localhost-forwarding.test.ts:127`（唯一读 `.wslconfig` 的文件：去注释后 `writeFile/appendFile/mkdir/rm(/unlink/copyFile/rename/chmod/process.env` **零命中**） | ✅ 全绿（第三句的字面缺口见 §6.4） |
| **T5.3** 作用域切换控件（写动作由 005 执行） | 每端口独立 scope 控件；默认 loopback；切 lan 需显式操作（无「全选局域网」入口） | `client-rows.test.ts` `T5.3`×2（3 端口 3 个不同 testId · 缺省 loopback · 只有 2 个选项 · 批量入口 **0** · 每端口独立回写）· `pane.test.tsx` `T5.3`×2（切一个端口只写 `{scopes:{"3306":"lan"}}` 且提权 **0** 次 · 反向对照点 apply 真触发提权 1 次） | ✅ 全绿 |
| **T5.4** UDP 明示 | 常驻提示存在；UDP 映射行标「不支持」 | `client-rows.test.ts` 用例名标 **`T5.5 UDP`**×2（提示点名 UDP · 行标「不支持」＋原因含 TCP · 未发布映射也标出）· `pane.test.tsx` `T5.5 / T5.7 只读区 > UDP 常驻提示可见，UDP 行标「不支持」` | ✅ 全绿（**测试标签与 tasks 编号错位一位**，见 §6.3） |
| **T5.5** exec 注入点（下一期） | 控件禁用 + 「下一期」原因；002 服务缺失时**无**报错、回调未触发；断言本包**未** import 002（静态 grep） | `pane.test.tsx` `exec 注入点恒禁用：002 缺失不报错，服务可用也只解释不放开`（两种可用性都禁用、`[data-testid="action-error"]` **0** 条）· `tests/unit/p0-redlines.test.ts` REQ-10.2（依赖白名单**恰好** `["dsh-wsl-shared"]` ＋源码零命中 `dsh-terminal-profiles`）· `tests/unit/client-structure.test.ts` 跨包红线 | ✅ 全绿 |
| **T5.6** 漂移高亮与修复入口 | drift 行显示「旧 → 新」；修复动作生成「先删后加」序列；失败时报告哪些未改 | `client-rows.test.ts` `T5.6`×3（两个地址都在文本里 · `["portproxy-delete","portproxy-add"]`＋顺序 1/2＋闸门 reason `rule-not-owned` · 半途失败如实报 `unapplied`）· `pane.test.tsx` `T5.4 失败态与漂移 > 漂移行显示「旧 → 新」…「先删后加」` | ✅ 全绿 |
| **T5.7** 外部规则清单 + 端口声明最小表单 | 本机 19 条落只读区且**无**任何动作控件；默认候选**恰好 13 项**（含 3306/1521/8080/5432/6379/5173/5000，**不含** 1433）；区间/勾选写回后**仅**改配置、**未**产生提权调用（调用数 0） | `client-rows.test.ts` `T5.7`×7（19 条真 fixture 进只读区＋区域无动作字段/函数 · 空清单不渲染 · 不进五态 · presets 恰好 13 且不含 1433 · 勾选态来自声明本身 · 区间＋勾选合并写入 · 原文回填）· `pane.test.tsx` `19 条外部规则进只读区，区域内没有任何可交互控件`（DOM `button, select, input, textarea, a[href]` = **0**）· `pane-write.test.tsx` `勾选 preset + 填区间 ⇒ 一次配置写入、零提权调用`（patch `{managedPorts:["3306","1000-3000","8080"]}`）· `tests/unit/client-settings.test.ts` `T5.7`×11（含 `零提权调用：写配置的一轮里提权计数器保持 0`＋反向对照「确有配置写入」） | ✅ 全绿 |
| **T5.8** 目标发行版控件 | ① 仅 1 个 ⇒ 直接认定且零提问 ② 配置空且有 `*` ⇒ `wslDefault` ③ 配置值 ⇒ `config` 且优先于 `*` ④ 配置值不存在 ⇒ `DistroNotFound`＋回落＋失效提示 ⑤ 全程**未**执行任何 `wsl -d` | `tests/unit/client-distro.test.ts` `T5.8`×6：`四种来源`（① 的 `onlyOne` 半边 · ② · ③）· `REQ-17.2 + 成本红线`（① 的「零提问」半边：注入 `ask` spy ⇒ `asked.length = 0`；⑤：`argvText` 恰 `["wsl.exe -l -v"]`）· `失效回落`（④）· 两条降级 | ✅ 全绿（④ 的字面 token 差异见 §6.4） |

**逐条命令与原始输出**（cwd = `packages/wsl-docker-ports`）：

```text
$ node --test --test-concurrency=1 "tests/unit/client-rows.test.ts" "tests/unit/client-distro.test.ts" "tests/unit/client-settings.test.ts" "tests/unit/client-structure.test.ts" "tests/unit/p0-redlines.test.ts"
✔ T5.8 四种来源：config / wslDefault / onlyOne / first 各自可显示 (2.595ms)
✔ T5.8 失效回落：配置的发行版已不存在 ⇒ 明示失效 + 按 WSL 默认回落（不静默换一个） (0.4307ms)
✔ T5.8 REQ-17.2 + 成本红线：解析全程不追问、也不带 `-d`（不冷启动发行版） (0.8134ms)
✔ T5.1 五态：每一态都有专属标签与色调，且五态互不相同 (1.3753ms)
✔ T5.1 五态：conflict 恒无可用动作（REQ-1.3 只报告，不改动） (0.2935ms)
✔ T5.2 非 NAT：页面里每一个转发写控件都不可点，且放行时同样一批控件真的可点（防恒真） (0.4827ms)
✔ T5.2 非 NAT 修复指引：含具体文件路径 + 可复制命令，且明写不改文件 (0.2158ms)
✔ T5.3 逐端口作用域：每端口一个控件、默认 loopback、无任何批量入口 (1.369ms)
✔ T5.5 UDP：常驻提示存在、不可交互；UDP 行标记「不支持」并给出原因 (0.3238ms)
✔ T5.7 外部规则：19 条真规则全部进只读区，且区域里没有动作字段 (3.1608ms)
✔ T5.7 presets：恰好 13 项，且不含 1433（SQL Server 不在清单里） (0.2058ms)
✔ T5.6 漂移修复：序列是「先删后加」，且被所有权闸门拦下时如实报原因 (0.2107ms)
✔ T5.6 中途失败：如实报出未改动项（不静默留半截） (0.2797ms)
✔ NFR-2 结构证明：整棵视图模型里没有任何函数（无物可调 ⇒ 开页不可能写） (0.5432ms)
✔ T5.1 刷新时间戳：快照换了时间戳，页面文本跟着变 (0.2602ms)
✔ T5.7 零提权调用：写配置的一轮里提权计数器保持 0（且确有配置写入，非「什么都没发生」） (0.1994ms)
ℹ tests 63 / ℹ pass 63 / ℹ fail 0
[exit code: 0]
```

```text
$ node ..\..\node_modules\vitest\vitest.mjs run tests/client/pane.test.tsx tests/client/pane-write.test.tsx tests/client/entry.test.tsx --reporter=verbose
 ✓ pane.test.tsx > T5.1 开页只读（NFR-2） > 挂载后：快照读 1 次、配置写入 0 次、提权调用 0 次 58ms
 ✓ pane.test.tsx > T5.1 开页只读（NFR-2） > 五态各自渲染出一行，标签与状态位一一对应 28ms
 ✓ pane.test.tsx > T5.1 开页只读（NFR-2） > 刷新后「上次刷新」时间戳真的变了（不是静态文案） 29ms
 ✓ pane.test.tsx > T5.2 非 NAT：写控件全灰 + 修复指引 > 非 NAT 下没有任何可点的转发写控件，且提权策略控件仍可用（否则 none 会死锁） 35ms
 ✓ pane.test.tsx > T5.2 非 NAT：写控件全灰 + 修复指引 > 修复指引给出具体文件路径 + 可复制命令文本 26ms
 ✓ pane.test.tsx > T5.3 逐端口作用域 > 切换一个端口的作用域 ⇒ 只写该端口、只改配置（提权 0 次） 21ms
 ✓ pane.test.tsx > T5.5 / T5.7 只读区 > UDP 常驻提示可见，UDP 行标「不支持」 14ms
 ✓ pane.test.tsx > T5.5 / T5.7 只读区 > 19 条外部规则进只读区，区域内**没有任何**可交互控件 21ms
 ✓ pane.test.tsx > T5.5 / T5.7 只读区 > exec 注入点恒禁用：002 缺失不报错，服务可用也只解释不放开 29ms
 ✓ pane.test.tsx > T5.4 失败态与漂移 > 漂移行显示「旧 → 新」两个地址，并列出「先删后加」的修复序列 10ms
 ✓ pane-write.test.tsx > T5.7 端口声明写回 > 勾选 preset + 填区间 ⇒ 一次配置写入、零提权调用 85ms
 Test Files  3 passed (3) / Tests  30 passed (30)
[exit code: 0]
```

**T5.2 第三句（未写 `.wslconfig`）的 🔵 当场复算**（`stripComments` 走 001 的 SSoT，非我另写正则）：

```text
scanned files = 18  codeOnlyBytes = 127599
write-API hits = 0
（src/client/** 17 个 + src/read/localhost-forwarding.ts；探针 = \b(writeFile|appendFile|mkdir|rmSync|rmdir|unlink|copyFile|rename|chmod|createWriteStream|openSync|writeSync|truncate)\s*\(）
（另：这 18 个文件对 `from "node:…"` **零命中** ⇒ 客户端半根本没有 fs 能力）
```

## 2. 各门输出与退出码（全部 `node` 直调；本轮零代码改动）

| 门 | 命令（cwd） | 实测 | 退出码 |
| --- | --- | --- | --- |
| 体积/行数 SSoT | `node packages\wsl-shared\scripts\check-size.mjs`（仓库根） | 扩面 **266** 文件（`terminal-profiles=95`、`wsl-docker-ports=148`、`wsl-shared=23`）；**超 400 行 = 0**；单文件 > 40KB = **0**；最大 `wsl-docker-ports/tests/client/write-result.test.tsx` = **396 行** / 去注释 **17,335** 字节；`wsl-shared/src` 聚合 **25,859 / 40,960** 字节（余 **15,101**） | **0** |
| 导出预算 | `node packages\wsl-shared\scripts\check-exports.mjs`（仓库根） | 运行时 **8/12**（SHALL 不超）、类型 **17**、合计 **25**（软阈值 25，**不告警**） | **0** |
| 类型 | `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json`（包内） | 无输出 | **0** |
| 离线契约+单元 | `node --test --test-concurrency=1 "tests/**/*.test.ts"`（包内） | **419 tests / 419 pass / 0 fail**（duration 11,518 ms） | **0** |
| 渲染 | `node ..\..\node_modules\vitest\vitest.mjs run`（包内） | **11 文件 / 111 通过 / 0 失败** | **0** |
| 客户端产物 | `node scripts\verify-client-loader.mjs`（包内） | **24 项断言 / 失败 0**；主 bundle `lib/client.js` = **141,884 B**；`window.__ModuleLoader__.load` 恰 1 次、id = 包名、`inject=["slots"]`；零硬编码 hex（源码 193,605 B 命中 0 · 产物命中 0） | **0** |

⇒ 三个预期值（**419/419**、**11 文件 111 条**、`check:client` exit 0）**与实测逐字相符**，未出现并行轮造成的浮动。

## 3. 文档同步（字面判据逐条）

| 判据 | 实测 |
| --- | --- |
| README 导航 4 条（requirements / design / tasks / 005） | 逐条 `Test-Path` = True（本轮新增第 5 行指向本文件） |
| 003 五份 md（四份正文 + 本文件）的**全部本地链接** | **50 条可达 / 0 不可达**（脚本对每一处 markdown 链接目标逐条 `fs.existsSync`；改前基线 = **42** 条） |
| `tasks.md` 引用的 REQ 编号存在性 | 引用**不同** REQ **46** 个；`requirements.md` 定义 **51** 个；**003 自身缺失引用 = `[]`** |
| 跨 Spec 编号限定 | 4 处全部带 Spec 前缀：`005-REQ-2.5` / `005-REQ-1.1` / `005-REQ-2.1` / `005-REQ-2.4` ⇒ 无「裸编号歧义」 |
| 空位指针可达 | `T0.3` → 005 `tasks.md` 的 `T0.1`（在册）· Phase 3 抬头 → 005 Phase 1（在册）· Phase 4 抬头 → 005 Phase 2（在册）· Phase 6 抬头 → 005 `T3.1`–`T3.3`（在册） |
| 行数自述 | `tasks.md:189` 是 **2026-10-09 的时点值**（`design 169 / README 175 / requirements 182 / tasks 187`）⇒ **原文保留**，本轮现值在 §4 与 `tasks.md` 关闭块里就地订正 |

## 4. 行数前后两口径（SSoT = `check-size.mjs` 的 `rawLines()`；另一口径 = `split('\n').length`）

| 文件 | 改前（SSoT / split） | 改后（SSoT / split） | EOL 改前 → 改后 | 裸 CR | 控制字符 | ≤400 |
| --- | --- | --- | --- | --- | --- | --- |
| `tasks.md` | **260** / 261 | **270** / 271 | CRLF 260 → 270 · 裸 LF 0 | **0** | **0** | ✅ |
| `README.md` | **175** / 176 | **176** / 177 | LF 175 → 176 · CRLF 0 | **0** | **0** | ✅ |
| `closure-round.md`（新增） | — | **150** / 151 | LF（新文件） | **0** | **0** | ✅ |
| `design.md`（未改） | 171 / 172 | 171 / 172 | LF | 0 | 0 | ✅ |
| `requirements.md`（未改） | 182 / 183 | 182 / 183 | LF | 0 | 0 | ✅ |

🔴 **`tasks.md` 270 行 > LeanSpec 的 `warn 200`**（`max 400` 未过）⇒ **既有状态**（本轮只追加 10 行，未删任何已验证结论 / 未验项 / 裁定依据 / 命令原文），按规矩**登记不修**、不抬阈值。

## 5. 未勾的 6 条：判据 + 为什么本轮不勾

### 5.1 `T0.3（已迁出）` 提权最小验证 —— 真机项
- **判据（005 T0.1 原文）**：生成临时 `.ps1` + `Start-Process -Verb RunAs`（**人工点一次 UAC**）⇒ 主机读到 out 文件 JSON、退出码 `0`、两个临时文件被删除；**本次不写任何系统规则**。⚠️ 必须人工点 UAC（无法自动化）。
- **为什么是「已迁出」而不是空洞位**：003 侧只留编号 3 的空位与指针（内容在 [005 的 T0.1](../005-elevation-write-path/tasks.md)），**同一条真机验证不重复做**。
- **005 侧现状（本轮当场读）**：`005 tasks.md:10` = `- [ ] T0.1 …`；其 `:14` 记「只读前置已核（gsudo v2.6.1 在 PATH · 当前进程非管理员 · 19 条规则完好）· **仍欠**真的点一次 UAC」⇒ 🔴 **目标未完成 ⇒ 003 侧不勾**（不冒充）。
- **留给**：真机批次（与 002 `T0.5`、005 `T0.1`/`T3.2`/`T3.5`/`T3.7` 同场）。

### 5.2 `T0.5` 安装接入验证（D-1）—— 真机项
- **判据（二值）**：① `link:<绝对路径>` 写入 profile `dependencies` + `dsh.profile.bundles`、`pnpm install` 后重载 ⇒ 行出现在 profile 行列表且**无** compatibility `disabled`；② 卸载后行消失、路由/页注销、临时文件清空、**规则数不变**（REQ-14.3）。
- **代码前置已齐**：`T6.7` ①–④（入口 `apply` + `exports["."] = ./lib/index.js` + 清单四件套 + `files`）已验；`cordis.patch.yml` 头注已由「不得用于 T0.5」改为「可以用于 T0.5，跑前先 `build`」。
- **已有真机「部分」事实（引述前轮记录，本轮零真机、未复算）**：2026-10-09 探针装载 —— 路由端到端 200 / 404 / 405；运行时关插件 4 s 后同 URL 回到宿主兜底 404（disposer 真摘路由）；再开回 200（attach 幂等）⇒ 本条 ②的**路由注销**半边已有真机证据，但**整条二值**（行出现/消失 · `%TEMP%` 清空 · 规则数不变）**未按本清单跑过** ⇒ **不勾**。
- **引用裁定**：`failed` / `skipped` / `rolledBack` 三态真机构造**已裁定建议不做**（风险 > 收益）⇒ 本条**不需要**它们，也不再列为待办。

### 5.3 `T6.7` ⑤ 公开面收敛 —— **主人待拍板项**（非真机项）
- ①–④ 已验（2026-10-09 记录在册）；⑤「收敛后 `src/index.ts` 运行时导出数**下降**」**未做**。
- 🔵 **本轮当场复算**：`src/index.ts` 运行时导出 = **33**（其中 Phase 0–2 barrel **27** + 入口 6 = `Config` / `apply` / `applyWslDockerPorts` / `inject` / `name` / `PORTS_SERVICE`）；**包外消费方仍 = 0** —— 全仓（排除 `node_modules` / `lib` / 本包 / `specs`）扫包名，命中 9 处**全是文档或扫描器字面量**（`packages/wsl-shared/scripts/check-scope.mjs`、`packages/wsl-shared/src/index.ts` 注释、`AGENTS.md`×2、`client-contract-incremental.md`×2、`stack-decision-changelog.md`×3），**没有任何 `import … from 'dsh-wsl-docker-ports'`**。
- ⇒ 收敛会砍掉 27 个零消费方导出，属**改口径**，`T6.7` 自己的时序注记写明「动手前先出示消费方清单」⇒ 本轮**只出示、不动手**，**不勾**。

### 5.4 `T7.1` / `T7.2` / `T7.3` —— P1（Phase 7）
- **闸门**：`tasks.md:209` = 「Phase 7：P1（**P0 真机验收通过后再启**）」；而 P0 的 `T0.5` 未做 ⇒ 闸门**现在就是关的**。
- 🔵 **本轮当场复算（`stripComments` 后 67 个 `src/**` 文件 / 347,564 字节）**：`'docker','(start|stop|restart|rm|run)'` **0** 命中 · `'logs'|--tail` **0** · `row.config` **0** · `configure({` **0**（`portproxy reset` 亦 **0**，顺带复算 T6.6 的红线）⇒ **代码面零命中 = 未开工**，与「闸门关着」自洽。
- ⇒ 三条**不勾**；判据（vitest）原文留在 `tasks.md`，等 P0 真机验收通过后再启。

## 6. 未验项 / 我自己的错 / 登记不修（如实）

1. **零真机**：本轮未装 profile、未起实例、未跑 `netsh`、未开浏览器 ⇒ 所有「真机二值」判据**一律未验**（`T0.3` / `T0.5`）。前轮的 `lib/client.js = 85,199 B` / `141,320 B` 等历史值**未复算**（本轮实测 **141,884 B**）。
2. **`git add` 只加显式 3 条路径**（`tasks.md` / `README.md` / 本文件），**不用 `git add -A`**；并行轮的工作区改动不纳入本次提交。
3. **测试标签错位（登记不修）**：`tasks.md` 的 `T5.4` = UDP、`T5.5` = exec 注入点；而测试里 UDP 标 `T5.5`、exec 也标 `T5.5`（`client-rows.test.ts:122/131`、`pane.test.tsx:146`）。⇒ **按内容对应**结清，**不改测试名**（改了对功能零收益，而 009/008 的收口轮刚对拍过用例名集合）。
4. **两处字面口径差异（登记，不算未验）**：① `T5.2` 第三句「断言未写 `.wslconfig`」在仓内**没有**一条同名常驻用例 —— 最接近的两条是「指引文案必须写『不会自动修改』」+「唯一读该文件者零写 API」（均已入库），另加我上面那次一次性静态扫描（**未入库**）；② `T5.8` ④ 判据写 `DistroNotFound`，003 侧实际字段是 `staleConfig`（`src/wire.ts:162`）+ docker 探针的 `distro-missing`（`src/read/docker-probe.ts:122` 才消费 001 的 `DistroNotFound` 错误码）⇒ **意图已验**（明示失效、不静默换、可判定），**字面 token 不在 003 的 UI 面**。
5. **`README.md:25` 的状态行括号自述已过时**（只列 Phase 0 完成）⇒ 本轮**追加订正痕**（原文保留，未改旧措辞）。
6. **我自己的错（如实留痕）**：为 T5.2 第三句做静态扫描时**连错三次** —— ① 第一版用**朴素子串**清单（含 `rm(`）⇒ 命中 `form(` / `confirm(` 两处**假阳性**；② 第二版把正则写进 PowerShell 双引号字符串 ⇒ `["']` 被吃掉，`ParserError: Missing ']'`；③ 第三版用 `E:/…` 绝对路径 `import` ⇒ `ERR_UNSUPPORTED_ESM_URL_SCHEME`（Windows 绝对路径必须写成 `file:///`）。改走**临时脚本落盘 + `file:///`** 后 0 命中。（三次都只影响我自己的取证脚本，**未触碰仓库任何文件**。）
7. **本 Spec 范围外的发现**：本轮未发现新的跨 Spec 缺陷；`tasks.md:244` 记的那条（`packages/terminal-profiles/src/ws/routes.ts` 的同类注册缺陷）**已另派修复**，本轮**未碰**该包。
