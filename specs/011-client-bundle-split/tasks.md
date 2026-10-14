# 实现任务：dsh-wsl-docker-ports 客户端主包瘦身

> 任务引用 [requirements.md](./requirements.md)；设计依据见 [design.md](./design.md)。
> 完成定义（每个任务）：代码 + **验证命令跑绿** + 无残留临时文件/规则。
> 🔴 **准入闸门**：`Phase 0` 的 `T0.1` **未达** ⇒ `Phase 1`–`Phase 3` **不得开工**（**未通过不得进实现**）。
> 口径：`pnpm -C packages/wsl-docker-ports {typecheck,test,build}`（与 003 / 008 / 009 同包同口径）。

---

## Phase 0：闸门（准入）—— 🔴 **未通过不得进实现**

- [x] T0.1 [REQ-BS-6] **0.2.0-rc.2 的 `require.async` 语义真机验证**（§Z5 的残留未验项）
  - 内容：在 0.2.0-rc.2 上真机跑通「**异步取块 → 执行 → 注册页**」整链路：chunk 自注册（`window.__ModuleLoader__.load({ id, chunk, factory })`）→ `require.async("./client.<name>.js")` 取块 → chunk 导出的组件**真被渲染**、tab **真出现在右栏**。**不得**只看「文件生成了」就判过。
  - 环境红线：探针**只允许**用临时/一次性 profile（或主人指定），🔴 **绝不**装进 `desktop` / `web`；用完**逐字节还原**。语法用 `dsh --profile <name> --port N --no-open`（**不是** `dsh --profile <name> web …`；`--patch` 若有须写在 `--profile` **之前**）。
  - 验证（二值）：① 真机截图 / 路由响应证明 tab 已注册且 chunk 已取；② 产物里 `require.async` 命中 ≥ 1；③ 控制台**零**未声明 `require` 崩溃。三件齐 ⇒ 通过。
  - 🔴 **当前状态（2026-10-12）：未达** —— 0.2.0-rc.2 上**未验**；`Z5` 只把 §E14 的 0.1.7-rc.2 实证记为「宿主支持 chunk」，**没有**证明 rc.2 语义一致。 🔴 **订正（2026-10-13）：本行状态已过期 —— T0.1 已通过**（运行时链路已在真机 rc.2 上真观测，证据见文末「Phase 0 运行时证据」；口径边界见未验项 8），原文一字未删。

- [x] T0.2 [REQ-BS-5] **失败 / 离线行为**在真机上先记录基线
  - 内容：记录三态的可观测现象：① chunk 404（改名 / 不部署）② 执行期抛错 ③ 断网（离线）。**只记录**，本 Phase 不改代码。
  - 验证（二值）：每种情形的**原始现象**（截图 + Console 原文）落进本 Spec 的未验项节；三态各一条 ⇒ 完成。

- [x] T0.3 [REQ-BS-6] 闸门纪律核对
  - 内容：`T0.1` 未通过期间，本 Spec 的改动**只允许** `.md`。
  - 验证（二值）：`git status --porcelain` 在本 Spec 阶段**零** `packages/**` 改动 ⇒ 记一条证据（命令原文 + 输出）。

---

## Phase 1：切分与产物断言（闸门通过后）

- [x] T1.1 [REQ-BS-1] **真构建基线复算**（先量后切）
  - 内容：真构建一次，复算 `lib/client.js` 字节与逐模块账；**解释**推算里的 **1,777 B 系统性偏移**（见 `N-1`）—— 若解释不了，**先查清再切**。
  - 验证：构建 exit 0 + 复算表（字节 + 逐模块）落进本 Spec；偏差有结论。

- [x] T1.2 [REQ-BS-2] 切出**渲染面** 7 模块到 chunk
  - 内容：`pane.tsx` / `pane-settings.tsx` / `pane-tables.tsx` / `page.ts` / `write-panel.tsx` / `write-confirm.tsx` / `write-result.tsx` ⇒ 取块边界；**不改**组件内部逻辑。
  - 验证：产物里模块字节**离开**主包；tab 仍注册；页面仍能用。
  - 🔴 **2026-10-13 实测（`T1.2` 落地；原文一字未删）**：7 模块**真离开**主包 —— 产物里 `// src/client/pane.tsx` / `page.ts` / `pane-settings.tsx` / `pane-tables.tsx` / `write-panel.tsx` / `write-confirm.tsx` / `write-result.tsx` **零命中**，同一批标记在 `lib/client.ports.js` 里**全命中** ⇒ 是**搬家**不是**删除**（chunk 侧实测：pane 15,310 · pane-settings 14,387 · pane-tables 10,680 · page 8,782 · write-panel 8,753 · write-confirm 8,342 · write-result 5,863 B）。「tab 仍注册」= **产物级**（`rows.ts` 标记仍在主包）+ **单测级**（`tests/client/entry*.test.tsx` 429 条全绿）双证；⚠️ **真机未跑**（未验项 8）⇒ 本行**不**宣称运行期通过。

- [x] T1.3 [REQ-BS-2][REQ-BS-3] 切出**写路径内核**并**保常驻面**
  - 内容：切出 `write/plan.ts` / `ownership` / `diff/managed-ports-parse` / `write/scope-note` / `write/firewall` / `wire` / `diff/port-presets` / `transport/constants`；**保常驻** `rows.ts` + `write-channel` / `write-token` / `settings-pipe`。
  - ⚠️ 已知：4 条同步 import 边（合计 **5,171 B**）会把部分字节**拉回**主包（见 design §3.2）—— 本任务**不打断**这些边（改 import 关系属另一设计变更）。
  - 验证：主包 ≤ 65,536 B；常驻 4 模块仍在主包（产物断言）。
  - 🔴 **2026-10-13 实测（`T1.3` 落地；原文一字未删）**：主包 **38,640 B ≤ 65,536 B** ✅（余 **26,896 B**，见文末证据）；写内核 4 件已离开主包 —— `write/plan.ts` 13,321 + `ownership` 3,359 + `scope-note` 2,523 + `firewall` 1,999 = **21,202 B**（判据：四者路径注释在主包**零命中**、在 chunk **全命中**）；常驻 4 模块 `rows.ts` / `write-channel` / `write-token` / `settings-pipe` 标记**全在主包** ✅。实现手段：把**唯一**触碰写内核的 `buildDriftFixView` 从 `rows.ts` 搬到 chunk 侧 `src/client/drift-fix.ts`（**原处不留再导出** —— 再导出仍是同步边）；**未打断**任何同步 import 边（design §3.2 的纪律照旧）。
  - 🔴 **订正痕（2026-10-13；原文一字未删）**：§3.2 列的 4 条同步边里 `diff/port-presets`（1,008 B）**被 tree-shaking 消除**（主包零命中、只在 chunk）⇒ 实际拉回 = `diff/managed-ports-parse` 2,778 + `wire` 1,135 + `transport/constants` 250 = **4,163 B**（比 §3.2 的 5,171 B 少 1,008 B）；主包 + chunk 合计 **149,138 B**（较切分前 **+4,989 B** = 两包各留一份常驻/共享字节，量级与 §3.2 的 5,171 B 一致）。口径全文见 design §13。

- [x] T1.4 [REQ-BS-8] **产物断言**落地（含落点确定）
  - 内容：断言 ① 主包 ≤ 65,536 ② `require.async` ≥ 1 ③ chunk 存在且被引用 ④ 常驻 4 模块标记在主包 ⑤ 已切出模块标记**不在**主包。落点见 `N-3`（本轮**未核**本包是否已有等价脚本）。
  - 验证：断言脚本 exit 0；故意构造超标产物 ⇒ exit ≠ 0。
  - ✅ **2026-10-13 落地（`T1.4`）**：落点 = **新增** `packages/wsl-docker-ports/scripts/assert-client-split.mjs`（`N-3` 关闭），并**串进**本包 `check:client`（`verify-client-loader.mjs && assert-client-split.mjs`）⇒ 门里不可跳过。五条判据全落地，另加三处**加严/定稿**：(a) ① 拆成 **①a ≤ 65,536 B**（`REQ-BS-1` 的硬判据）与 **①b ≤ SSoT 登记上限**（棘轮地板）**分开报**，避免拿棘轮地板替硬判据；(b) 每条断言带**扫描项计数**（为 0 即恒真 ⇒ 判失败，沿用主门纪律）；(c) ③ 一条覆盖三件事（chunk 存在 + 被主包引用 + **含 12 个切出标记** ⇒ 证「搬家不是删除」）。**标记口径定稿**（design §7「待定」项关闭）= esbuild 的**模块路径注释**、**整行锚定** `^// <相对路径>$`（`page.ts` 不会误命中 `page-tables.ts`）。**哨兵改内存合成**（不碰仓库、无需「跑完还原」）：6 组（size / ratchet / async / chunk / resident / cut）各证「**恰好**目标判据红」，期望值按**同一套边界现算**（棘轮一改不脱钩）。**红路径自证**：`DSH_SPLIT_ASSERT_FAULT=<key>` 把故障注入**真实读数** ⇒ 实测**6 个键各自 `exit 1`**，仓库零改动。
  - 验证（实测，全 exit 0）：`node scripts\assert-client-split.mjs` = **17 项断言 / 失败 0**；`node scripts\verify-client-loader.mjs` = **40 / 0**；两者串联（= `check:client` 语义）合并 **exit 0**。

- [x] T1.5 [REQ-BS-1] **上限口径不动**复核
  - 内容：确认没有偷改 §P2 上限、没有把直接判据换成比例代理。
  - 验证：`grep` 断言上限常量仍为 **65,536**；`stack-decision*` 零改动。

---

## Phase 2：功能等价与降级

- [x] T2.1 [REQ-BS-4] 首开页面**功能等价**
  - 内容：右栏页能用（表格 / 设置 / 写面板入口都在），与切分前**逐项对照**。
  - 验证：chrome-devtools MCP 真机截图 + 逐项清单勾完。
  - ✅ **2026-10-14 实测（受控 A/B 真机对照）**：**唯一变量 = `lib/client.js`** —— host 半边 **90 个文件逐字节相同（差异 0）**、`package.json` / `cordis.patch.yml` 同字节；A 组 = 切分前主包 **144,149 B**（`git archive 3efb13c` 取切分前树 + 切分前构建选项重建，**逐字节命中 T1.1 锚点** SHA256 `FCB0A7DC222C1C70F46911FC9163B7E99B6F9A277F711746928F76B428DEE5A7`），B 组 = 现行 **38,640 B + chunk 110,498 B**；两轮都用**一次性 profile `011-probe`**（junction 挂载、**零安装**、用后删档还原）、**同一 WSL 状态**（`Ubuntu2204` Stopped）、同一页同一操作路径。
  - 结果（**全等**）：`innerText` **3,119 字符 / 127 行、逐行差异 0** · `outerHTML` **9,243 字符相等** · 标题 10 项（NAT 硬前提 / 目标发行版 / docker 读取失败（distro-not-running）/ 端口转发（五态）/ 外部规则（只读，19 条）/ 端口声明（managedPorts）/ 提权策略 / 写通道凭据 / 写通道（确认后执行）/ 下一期）· 按钮 9 个（含「进容器 exec [disabled]」）· 控件 19 个（含两个 `select` 的当前值 `Ubuntu2204` / `none` / `add` / `loopback`）· 逐项清单：**表格 1 张**（表头 端口/状态/作用域/动作/证据）、**设置区块** ✓（端口声明 + 提权策略 + 写通道凭据）、**写面板入口** ✓（「写通道（确认后执行）」+「预演（只读，零写入）」）、外部规则 **19** 条、下一期置灰 ✓。
  - 输入侧同源：路由载荷 `GET /dsh-wsl-docker-ports/snapshot` **除 `refreshedAt`（刷新时刻 epoch 毫秒）外逐字节相同**（深比差异路径数 = **1 / 1**，且该路径名命中「易变字段」）。**A/B 判别器**：A `chunkRequested=false`、B `chunkRequested=true`（且 B 的资源列表里出现 `client.ports.js`）。**Console 两轮均 0 错 0 警**。
  - ⚠️ **视觉凭证口径（诚实登记）**：两张截图已归档，但**视口不同**（A `929×917`、B `1400×900` —— `resize_page` 在 A 轮未生效，另 B 轮补拍同视口时 CDP 截图**连续超时**）⇒ **不做像素对照**（尺寸不同即不可比）；等价判定以 **DOM / 文本逐字节全等**为准（同一输入下比像素更强）。仓外归档：`C:\Users\EDY\dsh-probe-artifacts\20261014-011-t21\`（`captureA.json` / `captureB.json` / `build-pre.mjs` / `diff-snapshot.mjs` / `shotA-929x917.png` / `shotB-1400x900.png`）。
  - 佐证（源码级）：那次切分只改了 `src/client/{index.ts,page.ts,rows.ts}` + 新增 `chunk-ports.ts` / `drift-fix.ts`（`git diff --name-status 3efb13c HEAD -- packages/wsl-docker-ports/src` 逐条可查）⇒ 其余客户端模块（`pane.tsx` / `pane-settings.tsx` / `pane-tables.tsx` / 三个 `write-*.tsx` / `styles.ts` / `route-source.ts` / `types.ts` / `write-dto.ts` / `settings-pipe.ts` / `write-channel.ts` / `write-token.ts` / `host.ts`）**逐字节未动**。

- [x] T2.2 [REQ-BS-4] **009 的凭据 a11y 判据仍全绿**
  - 内容：复用 009 的判据（一次性写通道凭据**不进 a11y 树**：`aria-hidden` 明文 + 无障碍名不含值的复制按钮），**逐条复跑**。
  - 验证：既有判据用例全绿（不新增、不改写 009 的判据）。
  - ✅ **2026-10-14 实测（既有判据原样复跑：未新增、未改写一条）**：`node ..\..\node_modules\vitest\vitest.mjs run tests/client/write-token-a11y.test.tsx` ⇒ **Test Files 1 passed / Tests 5 passed (5)、exit 0**；五条读数照旧 —— 门① 「扫了 **199** 个凭据窗口 / a11y 节点 **225** 个（4049 字符）：命中 **0** 个」· 门② 「扫了 **155** 条属性：含凭据子串的 **0** 条」· 门③ 「复制按钮可访问名「复制写通道凭据」（含凭据窗口 **0** 个）；剪贴板收到 **1** 次、逐字相同；复制后 a11y 投影仍 **0** 命中」· 门④ 「失败提示里凭据窗口 **0** 命中、剪贴板 **0** 次写入」· 哨兵 「同一函数：修前 a11y 投影命中 **199** 个窗口（判红）、修后命中 **0** 个（判绿）」（⇒ 门不恒真）。
  - 🎁 **附加：真机 CDP 无障碍树实物**（只补 009 登记的未验① —— 其门①用的是 `@testing-library/dom` **投影**、不是 Chrome 的真 AX 树；**不新增任何 009 判据，是否据此关闭 009 未验① 请主人裁定**）。做法：一次性 profile 真机实例里经配置页「生成并保存写通道凭据」发出凭据（DOM 侧读数：`issuedTokenPresentInDom=true` / `issuedTokenLen=64` / `onceInsideAriaHidden=true`），再读**真** AX 树 ⇒ 凭据区**确实被投影**（`heading "写通道凭据"` · `StaticText "本会话持有凭据：" "是"` · `"；服务端配置 writeToken：" "已配置"` · `button "复制写通道凭据"`），而 **64 字符明文一个字都不在树里**（承载它的 `<code data-testid="write-token-once">` 被 prune，树中无任何 ≥40 字符令牌样长串）；复制按钮可访问名**不含值** ⇒ **判据非恒真、真机同结论**。证据档：`C:\Users\EDY\dsh-probe-artifacts\20261014-011-t22-t23\evidence.md` §1.1。

- [x] T2.3 [REQ-BS-4] **008 的四态与 401 文案不变**
  - 内容：写结果四态与 401 文案**逐字**比对切分前。
  - 验证：文案 diff 为空 + 真机走一遍 401。
  - ✅ **2026-10-14 实测（文案 diff 为空）**：**同一把尺子量两侧**（切分前 `3efb13c` vs 现在；`git show <rev>:<file>` 取源；8 个文案承载文件 = `write-result.tsx` / `write-panel.tsx` / `write-confirm.tsx` / `write-channel.ts` / `write-token.ts` / `pane-settings.tsx` / `transport/write-auth.ts` / `transport/routes.ts`）⇒ ① 字面量中文文案 **89 条 vs 89 条、diff 为空**（只在切分前 0 条、只在现在 0 条）；② JSX 文本中文文案 **41 条 vs 41 条、diff 为空**；③ 点名 **7 条**（四态「已执行（成功）」/「失败」/「未执行（跳过）」/「回滚」+ 服务端 401 三条「未配置写通道凭据：…」/「缺少写通道凭据：…」/「写通道凭据不正确：…」）两侧**逐字命中**。脚本与两侧清单落盘：`C:\Users\EDY\dsh-probe-artifacts\20261014-011-t22-t23\{copy-diff.mjs,copy-pre-literals.txt,copy-now-literals.txt,copy-pre-jsx.txt,copy-now-jsx.txt}`。
  - ✅ **2026-10-14 实测（真机走一遍 401）**：一次性 profile 真机实例（起完即删）打 `/dsh-wsl-docker-ports/write/*` **七连** —— 未配置态：`GET /audit` 无凭据 **401/`unauthorized`** + 文案（含 `WRITE_TOKEN_CONFIG_HINT` 全串）· `GET /audit?token=乱串` **401**（未配置 ≠ 放行）· `POST /plan` 无凭据 **401** · `GET` 未知路径 **401**（**鉴权优先于 404**）；生成凭据后：错凭据 **401**「写通道凭据不正确：拒绝本次请求（零执行、零写入、零审计）。」· 无凭据 **401**「缺少写通道凭据：拒绝本次请求（零执行、零写入、零审计）。」· 真凭据 `?token=` **200** 与 `Authorization: Bearer` **200**（**正向控制**：401 确因凭据而非通道坏）。另：`tokenEchoedInAnyResponseBody=false`（**401 与 200 的响应体都不回显凭据**）；树内状态由「本会话持有凭据：否；服务端配置 writeToken：未检查」变为「**是**；**已配置**」。readings 原文见证据档 `evidence.md` §3。

- [ ] T2.4 [REQ-BS-5] **可解释降级**实现
  - 内容：取块失败 ⇒ 页面壳保留 + 原因分类文案 + 可重试；**禁止**白屏 / 静默。
  - 验证：三种失败情形（404 / 执行抛错 / 断网）各跑一次；断言有文案、有重试、无空白页；控制台有明确错误。

---

## Phase 3：变异哨兵与收口

- [ ] T3.1 [REQ-BS-9] **变异哨兵**
  - 内容：临时把某个已切出模块**塞回主包** ⇒ 断言 ⑤ **必须**变红；跑完**还原**。
  - 验证：变异后断言 exit ≠ 0（红的原文留存）；还原后 `git status` 干净。

- [ ] T3.2 [REQ-BS-1] 三绿 + 行数门
  - 内容：`typecheck` / `test` / `build` 三绿；单文件 ≤ **400** 行（原始行数）。
  - 验证：三条命令 exit 0 + 行数复算。

- [ ] T3.3 [REQ-BS-8] 文档收口
  - 内容：把真构建数字、`Phase 0` 结论、变异哨兵原文、未验项回收写进本 Spec；**只许降不许抬**的余量（≈16,494 B）登记。
  - 验证：本 Spec 四份文档与实测一致；未勾项 = 0（除明确登记的未验项）。

---

## 真机验收清单（chrome-devtools MCP；**闸门通过后再跑**）

| # | 场景 | 期望 | 手段 |
| --- | --- | --- | --- |
| V1 | 打开右栏页（首开） | 主包 ≤ 65,536 B；Network 里**看到 chunk 被取**；页面功能与切分前一致 | Network + 截图 |
| V2 | tab 注册（未取 chunk 时） | tab **已注册**（常驻面足够）；**不依赖**异步块 | 截图 + 产物断言 |
| V3 | 篡改 chunk 名 / 不部署 chunk | **可解释降级**：有原因文案 + 可重试；**无白屏**、**无静默** | 截图 + Console |
| V4 | 离线（断网）打开 | 同上，文案区分「离线」；**不崩** | 截图 |
| V5 | 009 凭据 a11y 判据 | 逐条**仍全绿**（凭据不进 a11y 树） | 既有判据复跑 |
| V6 | 008 四态 + 401 文案 | **逐字不变** | 文案 diff |
| V7 | 变异哨兵（把模块塞回主包） | 断言**变红** | 断言 exit ≠ 0 |

> ⚠️ 本表**一行都还没跑**（闸门未达、零实例）；写下来是为了让闸门一通过就能直接执行。 🔴 **订正（2026-10-13）：闸门已通过**（见文末「Phase 0 运行时证据」）⇒ 本表**可开跑**，但**仍未跑**（`Phase 1` 产物尚不存在）。
>
> 🔴 **订正（2026-10-14）：`V1` 已跑通**（受控 A/B 真机对照，见 `T2.1` 条目的 ✅ 实测行）——三条判据逐条落地：主包 **38,640 ≤ 65,536** ✓ · Network 里**真取到 chunk**（`reqid=39 … client.ports.js?rev=… [200]`，本轮另以 `chunkRequested` 由 false→true 复核）✓ · **页面功能与切分前一致**（DOM/文本逐字节全等）✓。⚠️ **`V2` 的真机半仍未跑**：产物半由 `T1.4` 的 ④（`rows.ts` 等常驻标记在主包）覆盖 ✓，但「**未取 chunk 时 tab 已注册**」需要在**取块被拦**的会话里观测 ⇒ 与 `V3`/`T2.4`（可解释降级）同轮跑，本轮**不宣称**。`V3`~`V6` 同样未跑。
>
> 🔴 **订正（2026-10-14 第二轮）：`V5` / `V6` 的「判据与文案」半已跑通** —— `V5`：009 的既有 a11y 判据**原样复跑 5/5 绿**（另补**真机 AX 树**实物：凭据区在树里、值不在，见 `T2.2` 条目的 🎁 行）✓；`V6`：**文案 diff 为空**（89/89 + 41/41 + 点名 7/7 逐字在）且**真机走遍 401**（未配置 / 缺 / 错 / 正确四路，见 `T2.3` 条目）✓。⚠️ **仍未跑**：`V2` 真机半（未取 chunk 时 tab 已注册）· `V3`（可解释降级）· `V4`（离线）· `V7`（变异哨兵）⇒ 分别归 `T2.4` 与 `T3.x`。

## 未验项（如实登记）

1. **`Phase 0` 未验**：0.2.0-rc.2 的 `require.async` 语义**未验** ⇒ 全部任务保持未勾。 🔴 **订正（2026-10-13）：本项已验**（见文末「Phase 0 运行时证据」）；剩余口径边界改记在**未验项 8**（**本包自己的 chunk** 的运行期复验），原文一字未删。
2. **算术偏移未解释**：推算值（70,246 / 43,871）与直减值（72,023 / 45,648）差 **1,777 B**（两处一致）⇒ 实现前真构建复算。 🔴 **订正痕（2026-10-12 追加；本行原文一字未删）**：本处引用的**可达性估算值**（**70,246** / **43,871**）**原记为估算值被当直减结果**（**不是**直减结果）⇒ 直减为 **72,023** / **45,648**（`144,149 − 72,126` / `144,149 − 98,501`），两处**同差 1,777 B**；该差值与**未归属（banner/footer + 共享 helper）1,777 B** 那格**同值** ⇒ 差额来源**口径一致**（⚠️ 该诊断**不在本仓文件内**、本仓**无可复算坐标** ⇒ **不算复核**）；状态由「未解释 / 待核」改为「**来源已定位、数值待复算**」。**估算，实现前必须用真构建复算。** → ✅ **2026-10-13 复算闭环**：`1,777 = banner 142 + esbuild 前导段 804 + 注释 773 + 空行 28 + footer 29 + 末尾换行 1`（见 design §12 与文末「Phase 1 复算证据」）⇒ **本项关闭**，权威一阶值 = **72,023 / 45,648**，估算 70,246 / 43,871 作废。
3. **产物断言落点未定**：本包是否已有等价脚本**未核**（`packages/wsl-docker-ports/scripts/**` 本轮**避让**）。
4. **chunk 侧上限未设**：§P2 只读到主包上限；chunk 90–99 KB 为**推算**。
5. **标记字符串口径未定**（design §7）⇒ 变异哨兵实现细节待定。
6. **体积数字未由本轮复测**（遵「直接引用、别重新考古」）—— 本 Spec 不产生任何新测量值。
7. **三份子文档未经主人复核**。
8. **本包自己的 chunk 运行期复验（新增，2026-10-13）**：`T0.1` 已证的是**宿主 rc.2 语义**，**不等于**本包 chunk 可用 ⇒ Phase 1 产物出来后**必须**复跑同一条运行时链路（判据：本包 chunk 被宿主的插件路由**真取到** + chunk 导出的组件**真渲染** + tab **真注册** + 控制台**零** `require` 崩溃），作为 Phase 1 的**验收条件**（**不**阻塞 Phase 1 开工）。
9. **§P2 分片 / 机器表 / 本包 gate 的注释里仍写着已被本轮推翻的读数（2026-10-13 登记，本 Spec 未动）**：`client-contract-incremental.md`（§P2 适用范围订正 ④ 与 #52 行）、`packages/wsl-shared/scripts/main-bundle-budgets.mjs`（第 41 行注释）、`packages/wsl-docker-ports/scripts/p2-main-bundle-gate.mjs`（第 88 行 console）都写「只切渲染面切后 ≈ **70,246 B**、仍超 **4,710 B**」；`T1.1` 已复算为：**一阶预估 ≈ 71,770 B、超 6,234 B**（见 [design.md](./design.md) §12）—— **定性结论不变（仍不达门）**，只是数字过期。⚠️ 归属 = §P2 文档 + 门脚本（本 Spec `design.md` §6 明示本轮**避让**：`packages/wsl-docker-ports/scripts/**`、`client-contract-incremental.md`、`stack-decision*.md`）⇒ **须主人裁定何时订正**（口径未变、只订正数字陈述；`LOCK_FIELDS` 不含注释，订正不触发双重锁）。

## Phase 0 静态证据（2026-10-13，真机 rc.2 产物只读取证）

- 取证方式：解析本机 `D:\Programs\DeepSeek Harness\resources\app.asar`（归档表 **12,967** 个文件）后**只读**取出官方插件源码；**未起探针实例、未装任何 profile、未改任何配置**。
- 关键代码（`@deepseek-ai/dsh-client-ui-sidebar-terminal@0.2.0-rc.2` 的 `lib/client.js:167`）：
  `const LoadedTerminalBody = (0, react.lazy)(async () => ({ default: (await require.async("./client.terminal.js")).TerminalBody }));`
- 由此确认四项语义：① `require.async` 存在且可 `await`；② 解析值为 chunk 模块命名空间；③ 说明符相对**请求方模块**；④ 与 `react.lazy` / Suspense 兼容。
- 打包契约：该包 `package.json` 的 `files` = `["lib/index.js","lib/client.js","lib/client.*.js","lib/types/**/*.d.ts"]` ⇒ chunk 随包发出、**不登记在 `exports`**。
- 失败路径（`@deepseek-ai/dsh-client-modules/lib/client.js` 默认取块钩子 = 同源 classic script）：`script` 的 `error` ⇒ **reject** 并带明确文案 `client-modules: bundle script ${url} failed to load` ⇒ 本 Spec 的 C4「可解释降级」有真实实现可依。
- 实体体量：`lib/client.js` = **19,869 B**、`lib/client.terminal.js` = **685,927 B**、`lib/index.js` = **210 B**。
- ⚠️ 口径澄清：本文件早前记录的 **19,887 / 685,949 B** 是**服务端下发版**（比归档内产物各多 **18 / 22 B**，属下发包装）⇒ **C1 / C2 判据一律钉在构建产物**（即 `packages/*/lib/client.js` 这类文件）上，**不钉下发字节**。
- ⏳ **仍未勾**：`T0.1` 的**运行时**那一半（真浏览器里 `require.async` 真取 chunk、真走 error 分支）**尚未观测** ⇒ 动态验证仍需临时 profile 探针，**动手前先问主人**。 🔴 **订正（2026-10-13）：本行所记的「仍未勾」已作废 —— 该半已观测**（主人 2026-10-13 批准 `T0.1` + `T0.2` 一起做；动态验证已做，证据见文末「Phase 0 运行时证据」），原文一字未删。
## Phase 0 运行时证据（2026-10-13，真机 volatile-probe + 官方 chunk 同路径）

- 授权：主人 **2026-10-13** 批准「`T0.1` + `T0.2` 一起做」。探针 = 临时 profile `volatile-probe`（**未装任何插件、未改任何 profile 文件**；零 `pnpm`、零 `node_modules` 变更、零仓库文件变更）。
- 实例命令：`node D:\nodejs\node_modules\@deepseek-ai\dsh\lib\bin.js --profile volatile-probe --host 127.0.0.1 --port 43311 --no-open` ⇒ `dsh web: http://127.0.0.1:43311/?token=<每次启动新发>`。
  - ⚠️ 启动时 stderr 有一行 `dsh: skipping profile bundle "dsh-volatile-probe": … cannot resolve profile bundle …`（其 `link:` 目标 `%TEMP%\dsh-volatile-probe` 已不存在）—— **该行只是「跳过这个 bundle」的警告**，进程照起、端口**真监听**（`Get-NetTCPConnection -LocalPort 43311 -State Listen` = True）⇒ 因此**没有**去摘那条悬空 link，**一个 profile 文件都没碰**（比预案更干净）。
- 驱动方式：零依赖 Node CDP 脚本（Node v24.15.0 自带 `fetch` + 全局 `WebSocket`）驱动独立 user-data-dir 的 Chrome（CDP `http://localhost:9333`）；**逐轮用全新 `about:blank` 页隔离**，并 `Network.setCacheDisabled(true)` 保证 chunk 真传输（而非命中缓存）。
- 证据归档（**仓外**，保证本仓 `git status` 干净）：`C:\Users\EDY\dsh-probe-artifacts\20261013-011-phase0\`（`cdp.mjs` + 4 张截图 + 5 份命令输出原文 `.log`）。

### T0.1 运行时链路（真机观测；三件齐 ⇒ 通过）

- 干净基线：`prep = { closedTabs: 0, tabsBefore: [], chunkBefore: 0 }` ⇒ 点击前**零 chunk 请求**、右栏**零 tab**（不是「boot 期已顺带取过」的假象）。
- 动作：右栏「新标签页」→ 弹出菜单里点「新建终端」（官方终端页的 guide chip，与 `Ctrl+反引号` 同一个入口）。
- 证据①-a（chunk **真取**；命令输出原文见 `T01-open.log`）：
  `chunkRequests = [{ url: "/plugins/@deepseek-ai/dsh-client-ui-sidebar-terminal/client.terminal.js?rev=437b2f67ec1f", status: 200, bytes: 175497, type: "Script" }]` ⇒ **恰好一次**懒取、200、**175,497 B**（gzip 传输字节；产物本体 685,961 B 未压缩）。
- 证据①-b（tab **真注册** + 组件**真渲染**）：`ui.tabs = ["cmd.exe"]`；`ui.terminalEcho = ["cmd.exe","Microsoft Windows [Version 10.0.22631.5335]","E:\IdeaProjects\mcp-rest-bridge> "]`（**真 PTY 回显**，非占位文本）；截图 `T01-chunk-loaded-terminal-rendered.png`（右栏 tab「cmd.exe」+ 回显 + 光标）。
- 证据②（产物里 `require.async` 命中 ≥ 1）：静态原文见本文件「Phase 0 静态证据」的 `lib/client.js:167`；本轮运行期真取块即**该调用的实际执行**。
- 证据③（控制台**零**未声明 `require` 崩溃）：`console = []`、`exceptions = []` ⇒ 三件齐。
- ⚠️ **口径与边界（必须与结论一起读）**：本轮链路走的是**官方插件自己的 chunk**（**同一宿主代码路径**：同一 `require.async`、同一 `__ModuleLoader__.load`、同一 `@deepseek-ai/dsh-client-modules` 取块钩子）⇒ 本闸门要证的 **rc.2 宿主语义**已证；**本包自己的 chunk 尚不存在**，其运行期复验 = `Phase 1` 产物的验收条件（**已登记为未验项 8**）。另：`volatile-probe` 起得来是因为其 bundle 含 `@deepseek-ai/dsh-web-app`（其 `dependencies` 已含该官方终端插件）⇒ **零安装**即可观测，未向任何 profile 装任何插件。

### T0.2 三态失败基线（**只记录**，本 Phase 未改一行代码）

| 态 | 制造方式（CDP 拦截 / 仿真，**零文件改动**） | Network 原文 | Console 原文（节选） |
| --- | --- | --- | --- |
| ① chunk 404 | `Fetch.enable` 拦 `*client.terminal.js*` → `Fetch.fulfillRequest` 404 | `status: 404`、`failed: net::ERR_ABORTED (canceled)` | ① `Failed to load resource: … 404 (Not Found)` ② `Error: client-modules: bundle script …client.terminal.js?rev=… failed to load`（`dsh-client-modules/client.js&rev=b7a0ef28df32:461`）③ `slot entry crashed in 'sidebar.right.pane.tab': Error: … failed to load` |
| ② 执行期抛错 | 同拦截，但 200 + body = `throw new Error("011-probe: 故意在 chunk 执行期抛错")`（123 B） | `status: 200`、`bytes: 123` | ① `client-modules: bundle … loaded without registering "…/client.terminal.js" via __ModuleLoader__.load`（`…:739`）② `slot entry crashed in 'sidebar.right.pane.tab'`；**`exceptions` = `Uncaught Error: 011-probe: 故意在 chunk 执行期抛错 … client.terminal.js?rev=…:1:7`** |
| ③ 断网（a：整页加载） | `Network.emulateNetworkConditions{offline:true}` ⇒ 再导航 | 无请求（导航即失败） | Chrome 自身离线页：`ERR_INTERNET_DISCONNECTED` +「未连接到互联网」 |
| ③ 断网（b：**已加载后**断网，更有信息量） | 在线加载 → 关空全部右栏 tab（`tabs = []`，历史 chunk 请求仅 1 次）→ 断网 → 点「新建终端」 | 第 2 条 chunk 请求 `failed: net::ERR_INTERNET_DISCONNECTED` | 3 × `Failed to load resource: net::ERR_INTERNET_DISCONNECTED` + `bundle script … failed to load` + `slot entry crashed in 'sidebar.right.pane.tab'` |

- 可观测 UI 现象（截图）：404 态 **tab 仍在**（`tabsAfter = ["cmd.exe"]`）但**面板空白**；断网(b) 态 tab 名退化为 `["终端"]`（真终端未起）。⇒ **现行官方实现不会白屏，但也没有任何原因文案 / 重试**（痕迹只在 Console）—— 这正是本 Spec `C4`「可解释降级」（`T2.4`）要补的缺口，与 `V3` / `V4` 的期望对得上。
- 归档：`T02a-chunk-404.png` / `T02b-chunk-throw.png` / `T02c-offline-whole-page.png` / `T02d-offline-chunk-failed.png` + 同名 `.log`（命令输出原文）。
- ⚠️ **如实登记两次无效观测**（均已作废并重跑）：ⓐ 首轮 `T0.2` 的 `mode` 参数把截图路径一并吞掉 ⇒ 拦截器**未启用**，那两次跑的是普通加载（结果作废）；ⓑ 首轮 `offline2` **忘了复位离线**，把下一轮拖进「连接丢失 / 选择工作区」降级态（该轮 T0.1 日志被污染，已弃用）⇒ 修好（**拦截器早于导航** + 每轮**复位离线** + 逐轮**全新页**）后全部重跑，**上表与 T0.1 结论一律取自重跑后的干净证据**。

### T0.3 闸门纪律证据

- 命令与输出原文（本 Spec 阶段全程）：`git status --porcelain` ⇒ **0 行（空）**；`HEAD = e11b503`。
- ⇒ 本 Spec 阶段**零** `packages/**` 改动；本轮改动**只有本文件自己**。探针脚本 / 截图 / 日志全部落在**仓外**（`C:\Users\EDY\dsh-probe-artifacts\` 与 `%TEMP%\dsh-011-probe\`）。
- 收尾核验：实例已停（端口 43311 **已释放**、`dsh\lib\bin.js` 进程数 = **0**、PTY 子进程**无孤儿**）；探针 Chrome 内的陈旧页已关闭。
## Phase 1 复算证据（`T1.1` + `T1.5`，2026-10-13；**只复算、未切分**）

- 命令（**不跑 `pnpm`**，逐条等价；Windows 侧，cwd = `packages/wsl-docker-ports`）：`node ..\..\node_modules\typescript\bin\tsc -p tsconfig.build.json` ⇒ **exit 0**；`node scripts\build-client.mjs` ⇒ `[build-client] lib/client.js = 144149 B`、**exit 0**；`node ..\..\node_modules\typescript\bin\tsc -p tsconfig.client.json` ⇒ **exit 0**。
- 产物指纹：**144,149 B** / SHA256 `FCB0A7DC222C1C70F46911FC9163B7E99B6F9A277F711746928F76B428DEE5A7`，与开工前副本**逐字节相同** ⇒ 构建**确定性可复现**、推算基线为真（三条命令可原样复跑）。
- 🔴 **新口径红线（本轮实测发现）**：esbuild 的 `absWorkingDir` **默认 = cwd**，模块路径注释随之变化 ⇒ 在**仓库根**构建得 **144,903 B**（+754 = **29 条注释行 × 26 字符** `"packages/wsl-docker-ports/"`）⇒ **任何字节断言必须钉 cwd = 包目录**（= `pnpm -C packages/wsl-docker-ports build` 的语义）。
- 逐模块账（metafile `bytesInOutput`；**27 模块、Σ = 142,372 B**）：文档三组数字**全部复算吻合** —— 渲染面 7 模块 **72,126** ✓ · 写路径内核 8 项（13,321 + 3,359 + 2,778 + 2,523 + 2,001 + 1,135 + 1,008 + 250 = **26,375**）⇒ ②累计 **98,501** ✓ · 常驻 4 模块（9,643 + 6,189 + 4,911 + 7,040）⇒ **27,783** ✓。
- 🎯 **`N-1` 的 1,777 B 已闭环**（本仓可复算）：`144,149 = Σ模块 142,372 + banner 142 + esbuild 前导段 804 + 注释 773 + 区内空行 28 + footer 29 + 末尾换行 1` ⇒ `未归属 = 1,777` ✓ ⇒ 文档「未归属（banner/footer + 共享 helper）1,777 B」**数字正确**；`70,246 / 43,871` 确认是**口径错**（把未归属 1,777 B 也当成随切分消失）⇒ 权威一阶值 = **72,023 / 45,648**。
- 一阶预估（含「模块路径注释随模块离开主包」）：① 切渲染面 ⇒ 主包 ≈ **71,770**（72,023 − 253）⇒ 仍超 **6,234 B** ✗ **不达门**（定性结论不变，缺口比原记 4,710 更大）；② 连带写路径内核 ⇒ ≈ **45,188** ⇒ ✅ 达门，计入 4 条同步 import 拉回 **5,171 B** 后 ≈ **50,359**（余 ≈ 15,177）。⚠️ 前导 helper 段（804 B）与空行会随切分变 ⇒ 达标判定**只认 `Phase 1` 实测产物**。
- `T1.5` 复核：上限常量仍为 **65,536**（SSoT = `packages/wsl-shared/scripts/main-bundle-budgets.mjs` 的 `limitBytes: 65536` / `nature: 'hard'`，经 `p2-main-bundle.mjs` 的 `MAIN_BUNDLE_LIMIT_BYTES` 转发）；本包欠账行 **144,149 / `nature: 'debt'`** 一个字节未动；`node scripts\verify-client-loader.mjs` = **40 项断言 / 失败 0 / exit 0**，门**自证非恒真**（② 上限恰好等于读数仍绿 ⇒ 判定是 `<=` 且边界含等号；③ 只抬机器表 ⇒ 红；④ 去掉字节判据退回旧口径 ⇒ 红；⑤a/⑤b 人造内联 React / xterm 指纹 ⇒ **恰好**那条直接判据红）；`stack-decision*` 改动 = **0**（`git status --porcelain` 空 + `e11b503..HEAD` 零提交）。
- 归档（仓外）：`C:\Users\EDY\dsh-probe-artifacts\20261013-011-t11\`（`metafile-ledger.json`、`closure.json`、`client.js.pre-build`、`mirror-pkgDir.js`、`mirror-repoRoot.js`）。

## Phase 1 实测证据（`T1.2` + `T1.3`，2026-10-13；命令原文 + 逐模块账）

- 口径：`pnpm run` 被红线禁用 ⇒ 直接执行等价命令，**Windows 侧**、cwd = `packages/wsl-docker-ports`，四条**全 exit 0**：
  `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json` · `node scripts/build-client.mjs` ·
  `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.build.json` · `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.client.json`。
- 产物：`lib/client.js` = **38,640 B**（SHA256 `F87B5191125EBE7B…`）· `lib/client.ports.js` = **110,498 B**（`D0386F2AC74BAF9E…`）；
  主包 `require.async(` 命中 **1**、`client.ports.js` 说明符 **1** ⇒ `U1` 的「`require.async` ≥ 1 + chunk ≥ 1」达门；
  chunk banner 逐字为 `window.__ModuleLoader__.load({ id: "dsh-wsl-docker-ports", chunk: "client.ports.js", factory: (require) => {`。
- 逐模块账（**镜像构建与真产物逐字节相同** ⇒ 账本对本产物有效：主包 true、chunk true）：
  主包 `Σ bytesInOutput` = **37,280 B / 13 模块**，闭合 `37,280 + banner 142 + footer 29 + 注释 371 + 残余 818 = 38,640` ✅；
  chunk `Σ` = **108,843 B / 21 模块**，闭合 `108,843 + 168 + 29 + 634 + 824 = 110,498` ✅。
  全账（含逐模块明细）：`C:\Users\EDY\dsh-probe-artifacts\20261013-011-t12-t13\ledger-t12-t13.json`（仓外归档）。
- 常驻面（`U2`）：4 个标记**全在主包** ✅；⚠️ 但**字节**不是 design §3.1 估的 27,783 B —— esbuild 只保留被 `index.ts` 真正用到的导出
  （`rows.ts` 9,643 → **1,279 B**、`write-token` 4,911 → **2,375 B**）⇒ `REQ-BS-3` 的判据是**存在性**，据此**仍达门**；数字口径订正见 design §13。
- 既有门回归（四条 exit 0）：`node --test --test-concurrency=1 "tests/**/*.test.ts"` **429 pass / 0 fail** ·
  `node ..\..\node_modules\vitest\vitest.mjs run` **12 文件 / 116 用例** · `node scripts\verify-client-loader.mjs` **40 断言 / 0 失败** ·
  `node scripts\verify-host-entry.mjs` **18 断言 / 0 失败** ⇒ `U6` 的「三道门不回归」本轮成立；另跑 `node ../wsl-shared/scripts/check-size.mjs`（284 文件、最大 396 行 ≤ 400 ✅）与 `node scripts/check-exports.mjs`（25 断言 / 0 失败 ✅）—— 两条 exit 0（`pnpm run` 被红线禁用 ⇒ 等价直接执行）。
- ❌ **本轮未做（如实登记，不宣称完成）**：① **棘轮下调**（`REQ-BS-1` 语义桥接的 SHALL）—— 落点在**三个避让区文件**
  （`packages/wsl-shared/scripts/main-bundle-budgets.mjs` 机器表 · `client-contract-incremental.md` §P2 的 `main-bundle-budgets:SSoT` 表 ·
  `stack-decision-changelog.md` 新留痕，且 `LOCK_FIELDS` 四字段须两表逐字段相等）⇒ **须主人裁定**（证据已备齐）；
  ② `T1.4` 产物断言脚本 —— 本包现有门**只覆盖 §P2 三条字节判据 + loader 形状**，`require.async` / chunk 存在且被引用 / 常驻在 / 切出不在**四项均无断言**；
  ③ 运行期复验（未验项 8）需临时 profile ⇒ **动手前先问**。
- ✅ **订正痕（2026-10-13 收口；原文一字未删）**：上面三条**已全部完成** ——
  ① **棘轮下调已执行**（主人授权「含顺带订正旧读数」）：机器表 `limitBytes 144,149 → 38,640` / `recorded → 2026-10-13` / `trace → #54` / `nature` 仍 `debt`（语义改为**棘轮地板**），契约文档 §P2 标记块同步为 `38640 / debt / 2026-10-13 / #54`（`LOCK_FIELDS` 四字段两表逐字段相等）；`stack-decision-changelog.md` 新增 **#54**、`stack-decision.md` 变更记录新增一行；两处过期读数（`main-bundle-budgets.mjs` 注释 + `p2-main-bundle-gate.mjs` 打印文本里的 **70,246 / 4,710 / ≈49 KB**）**加订正痕、原文保留**；另修一处**只有下调后才会暴露**的显示缺陷 —— 门的欠账分支改按 `overDerivation > 0` 判定（否则会打印「已越线 **−26,896 B（0.59×）**」这种负数）。
  ② **`T1.4` 已落地** —— 见 `T1.4` 条目的 ✅ 实测行与新增脚本 `scripts/assert-client-split.mjs`。
  ③ **运行期复验已跑通（未验项 8 关闭）** —— 一次性 profile `011-probe` 真机取块 + 真渲染，**已删档还原** ✓。

## Phase 1 收口证据（`T1.4` + 棘轮下调 + 运行期复验，2026-10-13）

### 1. `T1.4` 产物断言门（新增；`N-3` 落点关闭）

- 落点：新增 `packages/wsl-docker-ports/scripts/assert-client-split.mjs`（单文件 ≤ 400 行、**零新依赖**），并串进本包 `check:client`。命令（cwd = `packages/wsl-docker-ports`，Windows 侧）：`node scripts\assert-client-split.mjs` ⇒ **17 项断言 / 失败 0 / exit 0**。
- 真实读数（脚本自报）：**①a** 主 **38,640 B** / 上限 **65,536 B**（余 26,896）✅ · **①b** 主 38,640 / 登记上限 38,640（余 0 = **棘轮地板**）✅ · **②** `require.async(` 命中 **1** ✅ · **③** chunk `client.ports.js` = **110,498 B**、主包引用 `./client.ports.js` = true、**chunk 内含切出标记 12/12** ✅ · **④** 常驻 **4/4**（`rows.ts` / `write-channel` / `write-token` / `settings-pipe`）✅ · **⑤** 切出**仍留在主包 0/12** ✅。
- 变异哨兵（同批判定函数、内存合成）：**⓪** 真实读数红 0 条（非恒红）· **size** 读数 65,537 ⇒ **恰好 ①a** 红 · **ratchet** 读数 = 登记上限 + 1 ⇒ **恰好 ①b** 红（棘轮下调后该哨兵随之收紧）· **async** 抹掉 `require.async(` ⇒ 恰好 ②红 · **chunk** 说 chunk 不存在 ⇒ 恰好 ③红 · **resident** 抹掉常驻标记 ⇒ 恰好 ④红 · **cut** 注入切出标记 ⇒ 恰好 ⑤红（6 组全过）。
- 红路径自证（`T1.4` 的验证要求）：`DSH_SPLIT_ASSERT_FAULT=size|ratchet|async|chunk|resident|cut` ⇒ **6 个键逐个实测 `exit 1`**（故障注入**真实读数**，仓库文件零改动）。
- 标记口径（design §7 的「待定」项关闭）：**esbuild 模块路径注释**、整行锚定；两个已知前提由脚本当场兜住 —— 注释路径相对 `absWorkingDir`（构建脚本已钉死为包目录）· 一旦开 `minify` 注释消失 ⇒ ④ 会**响亮判红**（不静默变绿），⑤ 也不会退化为恒真（③ 要求 chunk 内 12 条全命中）。

### 2. 棘轮下调（`REQ-BS-1` 语义桥接；主人授权「含顺带订正旧读数」）

- 机器表（SSoT）：`packages/wsl-shared/scripts/main-bundle-budgets.mjs` —— `limitBytes: 144149 → 38640`、`recorded: '2026-10-12' → '2026-10-13'`、`trace: '#52' → '#54'`、`nature` 仍 `'debt'`（语义 = **棘轮地板**）、`note` 重写；头部注释与「欠账」节**加订正痕、原文一字未删**。
- 文档面（`LOCK_FIELDS` 四字段 ↔ 标记块逐字段绑定）：`client-contract-incremental.md` §P2 的 `main-bundle-budgets:SSoT` 表行换成 `| dsh-wsl-docker-ports | 38640 | debt | 2026-10-13 | #54 |`，③/④ 两处加订正痕（原文保留）；`client-contract.md` 指针行加订正痕；`stack-decision-changelog.md` 新增 **#54**（CRLF 文件、原文逐行保全）；`stack-decision.md` 变更记录新增一行。
- 显示缺陷修复（**只有下调后才会暴露**）：`p2-main-bundle-gate.mjs` 的欠账分支改按 `overDerivation > 0` 判定并补 `else` 达标分支 —— 否则 `38640 − 65536` 会打印「已越线 **−26,896 B（0.59×）**」。
- 门自证（`node scripts\verify-client-loader.mjs` ⇒ **40 项 / 0 失败 / exit 0**）：自报 `· 本包登记：上限 38640 B、nature=debt、记录日 2026-10-13、留痕 #54` · `✅ 已达标：主 bundle 38640 B ≤ §P2 推导口径 65536 B（余 26896 B）` · 判据行 `主 bundle: 体积 ≤ 明确上限 38,640 B（…）— 主 38640 B / 上限 38640 B（余 0 B，性质=debt）` · ① 双重锁 **8 字段全 same** · ② 棘轮**上调 0 处** · ③ `changelog 计得 54 条 | N | 行、最大 #54`（`Set` 口径：id 去重 54、缺号 0） · 哨兵 **① 人造 38,641 ⇒ 判红**（下调后**自动收紧**）· ③ 只抬机器表 ⇒ 红 · ④ 去掉字节判据 ⇒ 红。
- **未改**：§P2 判据本体（`packages/wsl-shared/scripts/lib/p2-main-bundle.mjs`）一个字未动；`dsh-terminal-profiles` 行（65,536 / `hard` / 2026-10-12 / #50）一字未动。

### 3. 运行期复验（未验项 8 关闭；一次性 profile `011-probe`）

- 起法（**不跑 `pnpm`**）：新建 `~/.dsh/profiles/011-probe/`（`package.json` 的 `dsh.profile.bundles` = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + 本包；`node_modules/dsh-wsl-docker-ports` 用 **junction** 挂到本包目录 —— 与 pnpm `link:` 在 `nodeLinker: hoisted` 下的产物同形）⇒ `node D:\nodejs\node_modules\@deepseek-ai\dsh\lib\bin.js --profile 011-probe --host 127.0.0.1 --port 43321 --no-open` ⇒ 首行即 `dsh web: http://127.0.0.1:43321/…`（**零安装**）。
- CDP（`chrome-devtools` MCP，**只开一个新页签**、不碰主人既有页签）原文：`reqid=4 GET /plugins/??…dsh-wsl-docker-ports/client.js… [200]`（主 bundle 随插件包下发）· **`reqid=39 GET http://127.0.0.1:43321/plugins/dsh-wsl-docker-ports/client.ports.js?rev=0fe0177eabc7 [200]`**（`content-type: text/javascript; charset=utf-8`、`cache-control: public, max-age=31536000, immutable`；响应体首行逐字 = `window.__ModuleLoader__.load({ id: "dsh-wsl-docker-ports", chunk: "client.ports.js", factory: (require) => {`）· `reqid=41 GET /dsh-wsl-docker-ports/snapshot [200]`（真 pane 的数据路径）。
- 结论：点开右栏页 ⇒ `Suspense` 兜底**消失**、真 pane 渲染实况（`suspenseFallbackPresent=false`、`hasWdpRoot=true`、正文含「上次刷新 / 目标发行版 Ubuntu2204（Stopped）/ 外部规则（只读，19 条）」——**19 条**与真机既有事实吻合，属交叉印证）；**Console 0 错 0 警**；tab 名「WSL Docker 端口」注册成功。
- 还原（逐字节）：实例停止（端口 43321 **已释放**）· junction 用 `cmd /c rmdir` 摘除（**未穿透**：目标包 `lib/client.ports.js` 仍 110,498 B）· `011-probe` 目录**已删** · `desktop` / `web` / `volatile-probe` 的 6 个清单文件 SHA256 **与探针前完全一致** · `profiles/node_modules` 顶层条目数 **31 → 31**。
