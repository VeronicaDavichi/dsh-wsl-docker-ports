# 009 真机验收轮记录：前置铁律实证 · B-3 清除凭据落盘 PASS · 401 三态文案订正（2026-10-12）

> **本轮边界（先写死）**：**只改文档** —— 零代码、零真机、**零 `pnpm run`**（pnpm 11 的 `verify-deps-before-run` 会 auto-install 并写回 lockfile）、零新依赖；**不碰 `desktop` / `web`**、**不碰 `packages/terminal-profiles/**`**（另一轮正在改它）。改法走**字节级脚本**（`[IO.File]::ReadAllText` / `WriteAllText` + `UTF8Encoding($false)`；**不用 `edit` 工具** —— 它会静默归一 CRLF）；**原文一律保留、只追加订正痕**。
> **判据只留一份**：本文件装**逐字真机事实 + 命令 + 期望值 + 订正痕**；[`tasks.md`](./tasks.md) 的 Phase 9 只留勾选与指针（体例同 [008 关闭轮](../008-write-transport/closure-round.md) 与 [009 Phase 8 §1](./tasks.md)）。

## 0. 本文件里「真机事实」的两类标注（不许混淆）

| 标注 | 含义 | 本轮哪些条 |
| --- | --- | --- |
| 🔵 **当场复算** | 我在本机用字节级脚本重算过，**命令 + 期望值**都在下面 | §1 全部、§3 的服务端文案全文、§4 的产物侧、§7 的产物树 sha |
| 🟡 **引述** | 来自主人现场的**真机产物**，`E:\Temp` 下**无对应产物可重算** ⇒ **只记、不冒充复算** | §2 / §3 的真机观测、§5 / §6 的现场值 |

🔴 **取证边界（我自己的错，如实记）**：本轮开工时 `E:\Temp` 最新目录是 `flake-2026-10-12-evidence`（13:43，**与本轮无关**）⇒ 我**找不到**本轮真机产物的落盘目录。上面标 🟡 的条目因此**只做到逐字转写**；若派单方另有产物目录，应补成 🔵。

## 1. 🔴 前置铁律：真机验收前**必须重建 `lib/`**（本轮**被实际执行并生效**）

**原文（Phase 8 §1 才写下的那条 SHALL，逐字保留）**：「真机验收**开始前**，`packages/wsl-docker-ports/lib/**` 必须由**当前 HEAD 源码**当场重建并产出 per-file sha256 清单；验收后当场复算该清单与基线对比。**未重建 ⇒ 真机加载的是旧产物 ⇒「离线全绿」与「真机通过」脱钩，真机结论作废。**」

### 1.1 首次执行**失败**的留痕（原文保留，不删）

派单原文：第一次真机验收**没重建** ⇒ 验的是**旧代码** —— `lib/client.js` 里 `.mutate(` **0 命中**。

🔵 **我当场复现了这条「旧产物」**（基线备份在盘，`E:\Temp\dsh-ui-accept5\lib-baseline\`）：

```powershell
$b = 'E:\Temp\dsh-ui-accept5\lib-baseline\client.js'
(Get-Item $b).Length                                              # ⇒ 137864
([regex]::Matches([IO.File]::ReadAllText($b),'\.mutate\(')).Count # ⇒ 0
```

⇒ 「首次因陈旧产物 FAIL」**可复算**，不是口述。

### 1.2 重建后的**准出判据**（命令 + 期望值；🔵 全部当场复算）

```powershell
function N($p,$s){ ([regex]::Matches([IO.File]::ReadAllText($p),[regex]::Escape($s))).Count }
$d = 'packages\wsl-docker-ports\lib\client.js'      # cwd = 仓库根
$t = 'packages\terminal-profiles\lib\client.js'
```

| # | 判据（命令） | 期望值 | 复算 |
| --- | --- | --- | --- |
| 1 | `(Get-Item $d).Length` | **141320**（基线 **137864** ⇒ +3456） | ✅ |
| 2 | `N $d '.mutate('` | **1**（基线 **0**） | ✅ |
| 3 | `N $d 'UNSET_WRITE_TOKEN_OPS'` | **2** | ✅ |
| 4 | `N $d 'op: "unset"'` | **1** | ✅ |
| 5 | `(Get-Item 'packages\wsl-docker-ports\lib\host-face.js').Length` | **1406**（**新增**文件） | ✅ |
| 6 | `N $t 'expectedRevision === void 0'` | **0**（三元分支写法**不在产物里**） | ✅ |
| 7 | `N $t 'service.update(SETTINGS_NAMESPACE, { [CONFIG_PATCH_FIELD]: valid }, expectedRevision)'` | **1**（**恒 3 实参**） | ✅ |

🔴 **逐字订正（我的复算 vs 派单文字）**：派单把该字段写成 `CONFIG_PATCH_KEY`；**产物与源码逐字为 `CONFIG_PATCH_FIELD`**（`packages/terminal-profiles/src/client/config-pipe.ts:344`）⇒ 以实测为准。
🔵 **补记（派单未给的值）**：`packages/terminal-profiles/lib/client.js` = **44,229 B**。

### 1.3 产物树 sha256（自定可复现口径：per-file sha256 tsv / 按**路径序数**排序 / LF 连接 / 对 UTF-8 字节取 sha256）

| 树 | 行数 | 整树 sha256 |
| --- | --- | --- |
| 基线（`lib-baseline.sha256.tsv`） | **88** | `a8e4da212cea46ac5282e840293e765f1c8865adff2276891d75e8f1d8ccd2dc` |
| 还原（`lib-restored.sha256.tsv`） | **88** | 同上（与基线**逐行相同**） |
| 重建后（`lib-head.sha256.tsv`） | **89** | `797b0b987d0f3ccfbc9a2c8a0207bfc78705a525d97979fa671978a8153b5337` |
| **当前盘上 `lib/`** | **89** | **`797b0b98…`**（与重建版 **set-diff 0**） |

- 🔴 **Phase 8 §1 的「派单记录 `a8e4da21…`，我未复现该前缀」—— 本轮复现成功**：`a8e4da21…` = **基线 / 还原树**（88 行），**不是**重建树。我两种排序口径（序数 / 文化相关）**同值**。
- 🔴 **上一轮自定的 `72a135c8…` 我仍未复现**（既不是基线树、也不是重建树）。我试过 7 种口径**全不命中**：原始文件字节 / 排序 LF 加尾换行 / 排序 CRLF / 不排序 LF / 只取哈希列（排序与不排序）⇒ `72a135c8…` **标注为未复现**（不冒充）；**以 `a8e4da21…` / `797b0b98…` 为准**。
- **重建版 vs 基线 = 11 行差异**（= **5 改 + 1 增**，与 Phase 8 §1 记的「diff 11 行」一致 ✅）：改 = `client.js` / `types/client/{host,pane-settings,settings-pipe,write-token}.d.ts`；增 = `host-face.js`。基线 `client.js` 旧 sha 前缀 = **`683faa83…`**（与 Phase 8 §1 记录**逐字相同** ✅），重建后 = **`695fa1bb…`**。

## 2. 🔴 B-3「清除凭据真机落盘」= **PASS**（关闭 Phase 7 §5 ②③ / Phase 8 §2 ②③）

**真机动作**：UI 真点「清除凭据」⇒「确认清除」（🟡 引述主人现场记录）。

| # | 观测（逐字） | 判定 |
| --- | --- | --- |
| 1 | `settings/describe` 原文 = `secrets:[{"path":["writeToken"],"set":false}]` | ✅ **`set:false`** |
| 2 | 该键**仍在 `secrets` 列表里、没有消失** | ✅ 两种可能里真机发生的是**这一种** |
| 3 | 落盘真实形状 = **整个 `writeToken` 键被删掉** | ✅ 不是 `null`、不是空串 |
| 4 | `cordis.patch.yml` 里**连空的 `- id: dsh-wsl-docker-ports` 条目一起消失** | ✅ 条目整体被回收 |
| 5 | 文件回到写凭据**之前**的 **771 B**，且 sha 与之前**相同** | ✅ 逐字节回到原状 |
| 6 | 旧串在 profile 树与整个 `~/.dsh` **0 命中** | ✅ 无残留 |
| 7 | 旧串打 `/write/plan` ⇒ **401** | ✅ 旧凭据立即失效 |
| 8 | UI 再点「生成并保存」**轮换** ⇒ 新串 `/write/plan` ⇒ **200** | ✅ `ready:true` |
| 9 | 轮换后响应：`planId` = **64 hex**、命令原文**无通配符、无 `reset`**、`elevation available:true` | ✅ 四条红线未破 |

🔴 **结论**：「空串仍算已配置」的病**已根治**。病根原文（Phase 6 未验项 ⑤ / `src/client/settings-pipe.ts:94-97`）是宿主 `walk()` 的 `set: value !== void 0` 对**空串仍给 `true`**；改走 `mutate({op:'unset',path:['writeToken']})` 后 `Reflect.deleteProperty` 把键**物理删除** ⇒ `set:false`。**离线（宿主真函数 + 组件面）与真机（本节）双向一致。**
⚠️ **口径提醒**：`set:false` 与「键从列表里消失」是**两件事** —— 真机是 **`set:false` + 键在册**；不要写成「键也没了」。

## 3. 🔴 三种鉴权态的 401 文案（逐字全文；**纠正上一轮的判据错**）

**SSoT = `packages/wsl-docker-ports/src/transport/write-auth.ts:160-170`**（🔵 当场读源码逐字抄录）。

**① 未配置**（含**空串 / 空白被归一成 `undefined`** 的情形；`:143-144` 的 trim 口径）：

```text
未配置写通道凭据：拒绝所有写请求（plan / apply / audit 一律 401，fail-safe）。配置方法：① 本包配置页的「生成并保存写通道凭据」（写进 settings 命名空间的 `writeToken` 字段，推荐）；或 ② profile 的 cordis.patch.yml 里给 `- id: dsh-wsl-docker-ports` 条目加一项 `config: { writeToken: "<随机长串>" }`（与 elevationPolicy 同一处）。两种写法都**即时生效**（字段是 volatile，宿主每次请求现读凭据，不需要重载插件）。之后以 `Authorization: Bearer <令牌>` 或 `?token=<令牌>` 调用本通道。
```

**② 已配置 + 不带凭据**：

```text
缺少写通道凭据：拒绝本次请求（零执行、零写入、零审计）。
```

**③ 已配置 + 错串**：

```text
写通道凭据不正确：拒绝本次请求（零执行、零写入、零审计）。
```

### 3.1 🔴 判据错订正（原文保留，不静默改写）

**错在哪**：**上一轮把「缺少…」当成「未配置」态的判据是错的** —— `缺少写通道凭据：` 只在**已配置**（凭据存在）而**本次没带**时出现；看见它**恰恰证明凭据已配置**。两态的分辨点只在开头：`未配置写通道凭据：` vs `缺少写通道凭据：`。

**原文留痕（两处，逐字保留）**：
1. 008 `tasks.md:337-338`：「同一次运行内，`plan` **不带** token ⇒ **401** `{"code":"unauthorized","message":"缺少写通道凭据…"}`」—— 这一行**自身没有错标状态**（当时确为已配置），但它是被后续引用去代表「未配置」的那句服务端原文。
2. 009 `tasks.md:45`（V8 行）：「401 文案含「凭据缺失或错误」+ 去哪里配置 + **不重试** ✅」——「凭据缺失或错误」是**客户端合并文案**（`src/client/write-token.ts:54`），它把服务端的**两个态合并成一句** ⇒ **不能用它做二值状态判定**。

⚠️ **如实交代我的取证边界**：我**没有**在 009 / 008 的任何 `.md` 里找到**逐字**写着「『缺少写通道凭据』⇒ 未配置态」的行 ⇒ 该错判的**原始落点很可能是上一轮的报告 / 口头面**。故本节只**订正判据口径**并留上面两条相关原文，**不虚构原文**。

✅ **客户端文案侧未受影响**：REQ-3.1 / U5 说的「凭据缺失或错误 + 去哪里配置」是**客户端**提示，逐字为「写通道凭据缺失或错误（服务端 401，零执行零写入）：请到本插件配置页重新「生成并保存写通道凭据」，并确认服务端已读到该值（改完配置需重载插件行）。本客户端**不重试**，也不会把凭据写进日志。」⇒ 它**不是**服务端态判据，本轮**不改**它。

## 4. 🔴 协议口径订正：JSON 里**无法表达「显式 undefined」**

- 「不带 `expectedRevision`」的**唯一线上写法**是**省略该键**。
- 传 **`null`** 会被**网关边界校验**拦下：`gateway/input-invalid` ⇒ `wire field "expectedRevision" failed boundary validation`；**revision 不动、零副作用**（🟡 引述真机观测）。
- ⇒ 客户端「**总是传 3 个实参**」这一点，由 **产物字节**（§1.2 判据 7：恒 3 实参）+ **离线红/绿**（`packages/terminal-profiles/tests/unit/client-config-pipe.test.ts`：两参调用必红 / 恰好 3 实参必绿）**共同支撑**，**不是**靠线上观察到的「显式 undefined」。
- 🔴 **宿主机限制（不许越写）**：`revisionOf()`（`src/client/settings-pipe.ts:201`）真机返 **`0`**（**非 `undefined`**）⇒ 007 的三元分支②（`expectedRevision === undefined` 那一支）在本机**运行期不可达** ⇒ **不得**写成「运行期已验证分支②」；本轮只到「产物字节里**没有**这个三元（§1.2 判据 6）+ 离线正 / 反例双向证」这一层。

## 5. 零副作用证据（🟡 引述真机观测）

| 项 | 实测 | 判定 |
| --- | --- | --- |
| `netsh portproxy` 规则数 | **19** 条 | ✅ 与基线同 |
| `portproxy` 抓取 sha | 与基线**逐字节相同**（`b9d38664…d1056d`） | ✅（只给前后缀 ⇒ 判据按「逐字节相同」这一条） |
| 我方防火墙规则 | **0 / 0** | ✅ |
| 全部防火墙规则 | **816**（其中 `DSH Desktop` **2** 条**非我方**、InstanceID **未变**） | ✅ |
| `/write/audit` 的 `size` | **全程 0** | ✅ 零拒绝也零写入 |
| `/write/apply` 调用次数 | **0**（本轮**一次都没调**） | ✅ 无写动作 |

## 6. 新缺陷（007）：**只登记一行指针**

🔴 007 的右栏页注册缺陷（真机 `[data-slot="plugins.row.config"]`.innerHTML === ""、console 报「右栏页尚未注册…等待宿主服务」、`.dtp-*` 样式在 ⇒ `apply()` 跑了 `register()` 没跑；同环境下组件② **0 条 console** ⇒ 包特异性）**已另立一轮修**，落点 = [007-terminal-config-page](../007-terminal-config-page/README.md)。**009 只留这一行指针，不展开、不代 007 记账。**

## 7. 🟡 环境披露（面向主人）

- 重建后的**新产物保留在原位**（🔵 §1.3 的整树 sha `797b0b98…` 即**当前盘上**状态）⇒ `desktop` / `web` **下次重启**会加载新产物（= **修复版**）。
- 本轮**未重启**任何实例。🔵 我只**读**过两个 profile 的 patch 文件元数据：`desktop` = **10,193 B** @ 2026-10-12 14:02:02、`web` = **6,455 B** @ 2026-09-29 14:55:33 ⇒ 「未改其配置」这句**只对我自己成立**（本轮我对该路径**只有读操作**）；`desktop` 那个 mtime 是**别的轮次**动的，不是本轮。

## 8. 未验项 + 我自己的错（如实，一律不写成通过）

**未验**：
1. §2 / §3 / §5 / §6 的**现场观测值盘上无产物** ⇒ 只到「逐字转写」这一层（§0 的 🟡）。
2. `portproxy` 的 `b9d38664…d1056d` **只给了前后缀**；全量 sha 我**未复算**（本轮**零真机** ⇒ 不跑 `netsh`）。
3. 「旧串在 profile 树与 `~/.dsh` **0 命中**」**无法复算**（旧串已不在手）。
4. `failed` / `skipped` / `rolledBack` 三态**真机仍未出现**（沿用 Phase 7 §5 ① / Phase 8 §2 ①）⇒「四态真机各态可区分」**不成立**。
5. 007 缺陷的**根因与修复**属另一轮 ⇒ 本文件只登记指针，**不代 007 记账**。
6. 落盘 `cordis.patch.yml` **回到 771 B** 的那份文件我**未亲自量**（🟡）；且**不知道**真机用的是哪个 profile ⇒ 未在盘上定位该文件。
7. 🔴 **本轮新发现的待办（只记录，未改）**：客户端 401 文案里「**改完配置需重载插件行**」（`src/client/write-token.ts:54`）与真机事实「**轮换即时生效**」（Phase 7 §2）**互相矛盾**，也与配置页自述（`src/client/pane-settings.tsx:234`「轮换即时生效」）不一致 ⇒ 措辞待主人拍板（涉及 `requirements.md` REQ-3.1 末句「提示文案 SHALL 说明「改完配置需重载插件行」」）。**不在本轮派单范围 ⇒ 只登记，不动任何 `.md` 的该句。**

**我自己的错**：
1. 取证时我把 PowerShell 命令写坏**三次**（`'op: "unset"'`、裸行 `--- xxx ---`、把函数命名成保留字 `Try`）⇒ 全部 `ParserError` / `[exit code: 1]`；改引号、加 `-` 前缀引号、换名后才拿到数。**错的不是仓库，是我的命令。**
2. 我第一次比对 tsv 时用 `Sort-Object` 直接比，得到 **175 行差异**的假象；根因是 tsv 是 **CRLF**、我按 `\n` 切分后每行尾部都留了 `\r` ⇒ 归一后真相是 **11 行**（= 5 改 + 1 增）。**这是我自己的比对口径错误**，不是产物问题。
3. §1.2 的 `CONFIG_PATCH_KEY` → `CONFIG_PATCH_FIELD` 订正（派单文字 vs 实测）已写在 §1.2；我**没有**为迁就派单文字而改实测值。
4. §1.3 里我**没能**复现上一轮的 `72a135c8…`（试了 7 种口径）⇒ 我把它记成**未复现**，而不是硬凑一个「看起来对」的说法。

## 9. 🔴 §8 未验项收口（2026-10-12 **文档轮**：盘上产物当场复算 —— **零真机**）

> **本节口径**：§0–§8 原文（含 §0 的取证边界**错述**、§8 的 7 条未验项）**逐字保留、一字不删**；一切订正只写在本节。
> 🔵 = 本轮**当场复算**（命令/口径写在句内）；🟡 = 只有**转写**、盘上无产物可重算；🔴 = 订正或未复现。
> **本节零真机**：未起实例、未跑 `netsh` / `New-NetFirewallRule`、未碰 `desktop` / `web`、未碰 `packages/terminal-profiles/**`、未跑任何 `pnpm` 命令；只做**盘上字节**的读取与哈希。

### 9.1 🔴 先订正 §0 的取证边界（**我上次找错了地方**）

产物**分三处**（都在 `C:\Users\EDY\dsh-probe-artifacts\`）：

| 目录 | mtime 窗口 | 装什么 | 对应本文件哪一节 |
| --- | --- | --- | --- |
| `20261012-135023\` | 13:50–14:02 | **原始 HTTP 逐字 dump**：`a1-describe-raw.txt`(34,765 B) / `a3-describe-after.txt` / `b2…` / `b3-describe-after-clear.json` / `b4-describe.json` / `b2b-plan-with-token.txt` / `b3c-plan-oldtoken.txt` / `b3c2-plan-oldtoken-header.txt` / `b4-plan-newtoken.txt` / `b4-plan-oldtoken-again.txt` / `b4-plan-nocred.txt` / `c1-plan-no-token.txt` / `b2b-audit-before.txt` / `b4-audit-after.txt` / `baseline.map` / `vp-cordis.patch.yml.ORIG`(218 B) / `desktop-cordis.patch.yml.BEFORE`(10,193 B) | **§2 / §3 / §5 的现场观测值** |
| `20261012-140444\` | 14:04–14:29 | **重建轮**：`lib-*.{BEFORE,AFTER}.sha256` / `blobs.{BEFORE,AFTER}.txt` / `B3-portproxy.{before,after}.txt` / `portproxy.baseline.txt` / `final-portproxy.txt` / `round2-{start,final}.map` / `A-round2-evidence.md` / `B-round2-evidence.md` / `A|B-{stdout,stderr}.log` / `A-token.txt` / `snippet-unset-ops.txt` / `rpc.ps1` | **§1.3 / §2 / §4 / §5 的产物侧** |
| `20261012-143729\` | 14:35–14:38 | `lib-baseline-rebuilt.sha` / `lib-before-any-rebuild.sha` / `ORIG-cordis.patch.yml`(218 B) / `ORIG-package.json` / `profile-before.sha` / `build-baseline.log` / **`probe-instance.log`（被进程占用）** | 属**另一轮**；本轮**只读**，不当 009 证据引用 |

🔴 **三条订正（都是我的错）+ 一条本轮补算**：

1. §0 写的「`E:\Temp` 下无对应产物可重算」**过于笼统**：产物不在 `E:\Temp`，在 `dsh-probe-artifacts\` 的三个时间戳目录里。
2. 派单点名的 `b*-plan-*.txt` / `b4-audit-after.txt` / `a1-describe-raw.txt`(34,765 B) **不在 `140444`** —— 该目录里的 `A1-describe-raw.txt` 只有 **388 B**，内容是 `HANDSHAKE status=303` + `HTTP=404` + `not found`（**不是** describe 响应）。真 dump 全在 `135023`。
3. 🔴 **`135023` 是「重建前 / 陈旧产物」窗口**：其 dump 的 mtime（13:54:30 / 13:57:56）**早于** `lib-wsl-docker-ports.BEFORE.sha256` 的 14:04:50；而该 BEFORE 里 `client.js` = `683faa83…` / **137,864 B**（= §1.1 那条「无 `.mutate(`」的旧产物），重建后（`…AFTER.sha256`，14:05:27）才是 `695fa1bb…` / 141,320 B。⇒ **`135023` 的观测值只能当「修前」用，不得代表修后行为。** 这正是 §8 未验 1 的根因：我把两个窗口当成了一个。
4. 🔵 **本轮补算**：当前盘上 `lib/` **89 文件**与 `…AFTER.sha256`（89 行）**逐行相同（mismatch = 0）**；`lib-terminal-profiles.AFTER.sha256` 与 BEFORE 亦各自成对（4,573 B / 4,573 B）⇒ 那批产物就是重建版；`blobs.{BEFORE,AFTER}.txt`（745 B×2）**逐字节相同**（`232039e6…`）⇒ `package.json` / `pnpm-lock.yaml` 的 blob 与 sha256 前后无变化。

### 9.2 §8 未验项逐条处置（一览）

| §8 条目 | 本轮结论 | 复算等级 |
| --- | --- | --- |
| 1 现场观测值盘上无产物 | **大部分收成 🔵**：describe 原文 + 401 三态 + plan/audit 的**原始 dump 都在 `135023`**（逐字比对见 9.3）；仍 🟡 的只剩「**修后**清除 ⇒ `set:false`」这一条（只有 `B-round2-evidence.md` §3 转写，无 raw dump） | 🔵 + 🟡 |
| 2 `portproxy` 全量 sha | **🔵 全量复算**：`b9d38664ebb234be8b74945362d86a6c3608d96e6764cbc903b11de955d1056d` | 🔵 |
| 3 旧串 `~/.dsh` 0 命中 | **半可复算，且被我自己的取证污染**（见 9.5） | 🔵 + 🟡 |
| 4 `failed`/`skipped`/`rolledBack` 三态 | **保留未验**，并加一条**「建议不做」**的理由（见 9.6） | 🟡 |
| 5 落盘 `cordis.patch.yml` 回到 771 B | **口径待定**：218 B（ORIG）已复算；771 B / `77afca6c…` 盘上**无对应文件**（见 9.7） | 🟡 |
| 6 007 根因与修复 | 仍是另一轮的事，本节**不代记账**（§6 指针不变） | — |
| 7 401 文案「需重载插件行」与真机矛盾 | 🔴 **本轮已订正**（① 产品代码 + 规格三处，见 9.8） | ✅ |

### 9.3 未验 1：现场观测值 ⇒ **有产物、可复算**（🔵）

**目录路径**：`C:\Users\EDY\dsh-probe-artifacts\20261012-135023\` 与 `…\20261012-140444\`（逐文件 sha256 见下）。**复算口径**：`[IO.File]::ReadAllBytes` → 原始字节 sha256（**不做**换行归一、不转码）。

`20261012-135023\`（13:50–14:02，**原始 HTTP dump 窗口 / 陈旧产物**） —— 逐文件 sha256（对**文件原始字节**取 sha256，未做任何换行归一）：

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `_check.map` | 3783 | `f82b4d3e7d415cb0ea76be82c7c09c3f05cc010b73061abd713d6490b1926d2a` |
| `a1-describe-raw.txt` | 34765 | `b411228493e5ec6b876418ca96fdfa43d5242bc615d6a3ac78ad4837f550bece` |
| `a2-update-body.json` | 305 | `773e8187d86e904cc573934725622c22dc540225988d8e2f8e25774420cb0d55` |
| `a2-update-with-rev.txt` | 1096 | `2a1c8485066b66dbf972233b680c1c5a846712e3097d3e445e58e2077ae1ee28` |
| `a3-describe-after.txt` | 35633 | `5b20030f225e482953d0ba2baf19f738aebd24732c2eb374946c770ea784b4a3` |
| `a3-update-no-rev.txt` | 1434 | `cecff4040324374e399343bb4246065d57dbd92f84c04c86576af98e92f3eb7a` |
| `b2-describe-with-token.json` | 35825 | `bb680be9f062cb133a8ff1f8e547d0d2c2483d46caba23bc68d9b33f40b42f14` |
| `b2b-audit-before.txt` | 423 | `0328ecf6418352d1de4524585b435bc4436406b0f2c3e55961e29c64b6bc1893` |
| `b2b-plan-with-token.txt` | 978 | `98556600982d997649537ad1a0dafab4741c3105ae8bff65772997ecdd528814` |
| `b3-describe-after-clear.json` | 35825 | `ff4e1b79cc703debb8c1facbd78fd9b8c9453e69fe2ec3d3b900abe081c844eb` |
| `b3c-plan-oldtoken.txt` | 1046 | `6d21e65f2917daa396be675111247901cdc4eb120e23d3a982e3fe0009ebf03e` |
| `b3c2-plan-oldtoken-header.txt` | 1046 | `ac49eaa3ce2c7b0aa71f1cd5285a045c8b998e3c6a4ea4bb8d9a3b20fb0356fe` |
| `b4-audit-after.txt` | 423 | `c8036d5a764fac1a2feba6ff465b705e4e3feb0106d26b8c8c0f7fb990e62919` |
| `b4-describe.json` | 35825 | `b8443ff979f6768b2f5ff02fc17ebda6bbc675bc76e0d808507860f464b220cd` |
| `b4-plan-newtoken.txt` | 978 | `884460439de8d892dd85260bcf9bbca92fa1577b1514dbfbfbe7c54c7ae53804` |
| `b4-plan-nocred.txt` | 519 | `2a84965556826d6b4eb23fc4b1ebd3cecf9df67c2c1d709cf7e509013bd2c209` |
| `b4-plan-oldtoken-again.txt` | 522 | `35823fe5df03dd1792e50dd0291665f9300654ee6a5884aee2ca5d1a6080c1e2` |
| `baseline.map` | 3783 | `f82b4d3e7d415cb0ea76be82c7c09c3f05cc010b73061abd713d6490b1926d2a` |
| `c1-plan-no-token.txt` | 1046 | `fb94147ad4b448d4aaee60223db119e5912567148dda8c5748ef013d57cd87b0` |
| `desktop-cordis.patch.yml.BEFORE` | 10193 | `c77ff9867dfe27a07efe7730c315283b9d288a924e60b15c7f06165dc54a3e63` |
| `final.map` | 3783 | `f82b4d3e7d415cb0ea76be82c7c09c3f05cc010b73061abd713d6490b1926d2a` |
| `final2.map` | 3783 | `f82b4d3e7d415cb0ea76be82c7c09c3f05cc010b73061abd713d6490b1926d2a` |
| `final3.map` | 3783 | `f82b4d3e7d415cb0ea76be82c7c09c3f05cc010b73061abd713d6490b1926d2a` |
| `rpc.ps1` | 1182 | `4b0bd998fdbfc93f888f1eb33aee1a89d3424127922bb22a5fe479d0853db3b1` |
| `snapshot.ps1` | 518 | `fbe855d23d013617bb66b14e82857fdaf1e98fadbac56ae093f9eb61357661c1` |
| `vp-cordis.patch.yml.ORIG` | 218 | `8c2d1f557ff4d18f5d3c1b284a7246cacc571853b468ff56e4fa33204827c1f6` |
| `vp-package.json.ORIG` | 381 | `33ed261562cfc42021566bf3b43b3a0de97f0683092c183b2bd638e587bece88` |

`20261012-140444\`（14:04–14:29，**重建轮**） —— 逐文件 sha256（对**文件原始字节**取 sha256，未做任何换行归一）：

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `A-pid.txt` | 7 | `444799939c8769b4f8165708b0dc2ab0a8f7b04c069c697bf0ae71a930350538` |
| `A-round2-evidence.md` | 4543 | `7d335ac88af76cbf04d86e2dc92d921d414645c2f7337359bd187651ca75d205` |
| `A-stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `A-stdout.log` | 83 | `90a81fcf70d82f212b57fb7e7561e8c24c927fd28b4403ccbd038673663ddb73` |
| `A-token.txt` | 45 | `2644022c95850c1e37e00350ec4f2c917fe2932a6b3668a1596b8d02323d3471` |
| `A1-describe-raw.txt` | 388 | `3c4bc82aa6beea55444c02e18fdeded1f34b11a2672e4853bb1821a2744e5733` |
| `B-round2-evidence.md` | 8120 | `940f31fd473e184d6dd8b48ca7ec72acf96598155948a3c0507f0f8f77add680` |
| `B-stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `B-stdout.log` | 83 | `a3b1ef9ded4f763ebb6b4652e81b663f99093e7697ff1bfdafe67dea2000eaf5` |
| `B3-portproxy.after.txt` | 1109 | `b9d38664ebb234be8b74945362d86a6c3608d96e6764cbc903b11de955d1056d` |
| `B3-portproxy.before.txt` | 1109 | `b9d38664ebb234be8b74945362d86a6c3608d96e6764cbc903b11de955d1056d` |
| `DevToolsActivePort.BEFORE` | 60 | `08f6e85e7f090273926055383632b8ec35dc329a10981259234801dac4753c78` |
| `blobs.AFTER.txt` | 745 | `232039e6977fcb37e36f49a71595c09d141687bf55675f4489c622d236f82599` |
| `blobs.BEFORE.txt` | 745 | `232039e6977fcb37e36f49a71595c09d141687bf55675f4489c622d236f82599` |
| `final-portproxy.txt` | 1109 | `b9d38664ebb234be8b74945362d86a6c3608d96e6764cbc903b11de955d1056d` |
| `lib-terminal-profiles.AFTER.sha256` | 4573 | `fe27b5440478e8f0ee6da14dc9d9a9421a1dc3bd35ecc932fecf5e2d962685e8` |
| `lib-terminal-profiles.BEFORE.sha256` | 4573 | `3116cd8ea35ebf7e418178fbd8f0196662ac63ca131ab2400ef9af84c5cc9eb9` |
| `lib-wsl-docker-ports.AFTER.sha256` | 8389 | `147362e1e3f44d52b11538120d9d46959ae321b0bf2a675c405e37fa2ec818ce` |
| `lib-wsl-docker-ports.BEFORE.sha256` | 8303 | `1c07e3a90c22581f903817009ccca4b9c769142c4efa47aec1731ceecfd9b1bc` |
| `portproxy.baseline.txt` | 1109 | `b9d38664ebb234be8b74945362d86a6c3608d96e6764cbc903b11de955d1056d` |
| `round2-final.map` | 3783 | `f82b4d3e7d415cb0ea76be82c7c09c3f05cc010b73061abd713d6490b1926d2a` |
| `round2-start.map` | 3783 | `f82b4d3e7d415cb0ea76be82c7c09c3f05cc010b73061abd713d6490b1926d2a` |
| `rpc.ps1` | 1182 | `4b0bd998fdbfc93f888f1eb33aee1a89d3424127922bb22a5fe479d0853db3b1` |
| `snippet-unset-ops.txt` | 522 | `100fa4312030ddebc7be3d38376dba806f93da6e842c26872b55197d4f34a8bc` |
**逐字比对结果**（脚本：`fs.readFileSync` 原文 + `JSON.parse` + 字符串 `===` / `startsWith`，逐条打印 PASS）：

| # | 观测项（逐字） | 出处（raw dump） | 比对 |
| --- | --- | --- | --- |
| 1 | `"secrets":[{"path":["writeToken"],"set":false}],"revision":0` | `a1-describe-raw.txt`（同值亦见 `a3-describe-after.txt`） | ✅ 逐字一致 |
| 2 | `"secrets":[{"path":["writeToken"],"set":true}],"revision":1` | `b2-describe-with-token.json`（UI 点「生成并保存」之后） | ✅ |
| 3 | `"secrets":[{"path":["writeToken"],"set":true}],"revision":2` | `b3-describe-after-clear.json`（**陈旧产物窗口**） | 🔴 **修前症状**：清除后**仍报 `set:true`** ⇒ §2 第 1 行要求的 `set:false` 在 **`135023` 这一轮并没有出现**；`set:false` 只出现在 `140444\B-round2-evidence.md` §3 的**转写**里（🟡，无 raw dump） |
| 4 | `"secrets":[{"path":["writeToken"],"set":true}],"revision":3` | `b4-describe.json`（轮换之后） | ✅ |
| 5 | `未配置写通道凭据：…（fail-safe）。配置方法：① … ② … 不需要重载插件）。之后以 …` | `b3c-plan-oldtoken.txt` / `b3c2-plan-oldtoken-header.txt` / `c1-plan-no-token.txt`（三份**逐字节同文**，HTTP=**401**，message 长 **349** 字符） | ✅ 与源码 `src/transport/write-auth.ts:162` **逐字一致**（含 `WRITE_TOKEN_CONFIG_HINT` 293 字符） |
| 6 | `缺少写通道凭据：拒绝本次请求（零执行、零写入、零审计）。` | `b4-plan-nocred.txt`（HTTP=**401**，28 字符） | ✅ 与 `write-auth.ts:167` 逐字一致 |
| 7 | `写通道凭据不正确：拒绝本次请求（零执行、零写入、零审计）。` | `b4-plan-oldtoken-again.txt`（HTTP=**401**，29 字符） | ✅ 与 `write-auth.ts:170` 逐字一致 |
| 8 | `"planId":"72f7234b…"`（**64 hex**；2026-10-12 脱敏：原值为真机 `planId`，仅保留首 8 位）、`confirm.ticket` 为 UUID、`elevation={"policy":"unknown","backend":"gsudo","available":true}`、`commandText` 无 `reset`/通配符 | `b2b-plan-with-token.txt` / `b4-plan-newtoken.txt`（HTTP=**200**，两份 planId **相同**（原值已于 2026-10-12 脱敏为仅首 8 位 ⇒ 该「相同」结论**不可由本文件复算**，依据为当次真机证据） —— 同 scope/端口 ⇒ 同计划内容） | ✅（本轮 regex 复算：`^[0-9a-f]{64}$`、UUID、`/reset|\*/` 均通过） |
| 9 | `{"ok":true,"records":[],"size":0,"dropped":0}` | `b2b-audit-before.txt` / `b4-audit-after.txt`（HTTP=**200**） | ✅ 零副作用（审计 `size` 全程 0） |
| 10 | 🔴 **口径差异（必须写明）**：上面 5 份 describe **都是 21 个命名空间**（19 宿主 + `dsh-terminal-profiles` + `dsh-wsl-docker-ports`）⇒ 那一轮**两个插件都装了**；而 §2 的「**20** 个命名空间（只装组件②）」是**另一轮**、且**没有 raw dump** | `135023` 的 5 份 dump | ⇒ 两个数字都对，但**不是同一次运行**，**不得互相引用**；§2 的 20 仍是 🟡 |

### 9.4 未验 2：`portproxy` 全量 sha ⇒ **一致**（🔵，不跑 `netsh`）

```powershell
# 口径：对文件原始字节取 sha256（4 份快照同值），并逐字节比对
Get-FileHash B3-portproxy.before.txt,B3-portproxy.after.txt,portproxy.baseline.txt,final-portproxy.txt -Algorithm SHA256
```

| 文件 | 字节 | sha256（全量） |
| --- | ---: | --- |
| `B3-portproxy.before.txt` | 1109 | `b9d38664ebb234be8b74945362d86a6c3608d96e6764cbc903b11de955d1056d` |
| `B3-portproxy.after.txt` | 1109 | 同上 |
| `portproxy.baseline.txt` | 1109 | 同上 |
| `final-portproxy.txt` | 1109 | 同上 |

- ✅ **与 §5 的前后缀一致**：前缀 `b9d38664` ✔、后缀 `d1056d` ✔ ⇒ 「前后缀」与「全量」**同一口径**（对同一字节流取 sha256），不是两套算法。
- ✅ 4 份**逐字节相同**（`SequenceEqual` = True）；`0.0.0.0` 规则行 **19** 条、非空行 **22** 行 ⇒ 与 §5「19 条 / 22 行」一致（22 = 19 + 表头 3 行；该输出**碰巧不含**字面 `v4tov4`）。
- ⚠️ **边界**：这是**盘上快照的复算**，不是现场重查（本轮不跑 `netsh`）⇒ 它证明「当时前后一致 + 与 baseline 一致」，**不证明此刻系统仍是 19 条**。

### 9.5 未验 3：旧串 0 命中 ⇒ **profile 树内可复算；`~/.dsh` 全树已不可复算（我污染了它）**

- ✅ **可复算的一半**：`C:\Users\EDY\.dsh\profiles` 全树递归检索，旧串 **0 命中**、新串 **0 命中**（两次独立复算：`Select-String` 全树 + node `readFileSync` 递归，均 0）。
- 🔴 **不可复算的一半 + 我的错**：`~/.dsh` **全树**的「0 命中」我**不写通过** —— 本轮 node 全树扫描**捕到 1 次瞬时命中**：`C:\Users\EDY\.dsh\storages\session_projcache\sessions\560cc201-2c59-41f0-adb7-5b6cfb9580db.json`（= **DSH 自己的会话转录缓存**）；随后同一个文件的复查**又是 0**（mtime 14:49:11），与另一次全树扫描的 0 一致。根因：**我把两个串打进了终端输出** ⇒ 被会话缓存落盘，**我的取证动作变成了新的取证对象**。
- 口径必须写明：「0 命中」当时的原始口径**必然排除了证据文件自身**（旧串原文本来就**写在** `B-round2-evidence.md` 第 34 行）⇒ **不冒称本轮可复算**，只保留「profile 树内 0 命中」这一层（🔵）。
- ⇒ 未经证实的写法（禁止）：「整个 `~/.dsh` 0 命中 ✅ 已复算」。正确写法：「**profile 树内 0 命中**（🔵）；`~/.dsh` 全树（🟡，本轮被会话缓存污染 ⇒ 不可复算）」。

### 9.6 未验 4：`failed` / `skipped` / `rolledBack` 三态 ⇒ **保留未验 + 建议不做**

- 事实不变：真机只出现 `executed` 一态（`140444\B-round2-evidence.md` 亦未记三态）⇒ **「四态真机各态可区分」不成立**（沿用 Phase 7 §5 ① / Phase 8 §2 ①）。
- 🔴 **建议不做**（理由：**构造风险 > 收益**）：
  1. 要在真机看到 `failed`，必须让 `netsh … add` 或 `New-NetFirewallRule` **真的失败**（占位/同名/权限）；要看到 `rolledBack`，必须让「**第一条成功、第二条失败**」在同一次 apply 里发生。这两件事都意味着**真的改动主人的系统**（转发规则 + 防火墙规则），且可能留下**半成品规则**。
  2. 收益只是**结果区的分色与文案渲染**，而这部分**离线已被充分覆盖**：`tests/client/write-result.test.tsx` 有 ⑥「四态同时非空、四个 tone 互不相同」、⑩「预演→确认后四态 4 组可见」等 **14** 条用例（`it(` 计数；本轮 `vitest run` = **11 文件 / 111 通过**，含该文件）。
  3. 结论：**不动真机**。若将来非做不可，边界应是「一次性 profile + 只碰一个**未被占用**的端口 + 先写好回滚脚本 + 事前抓 `portproxy` 快照」，并在同一轮里把快照 sha 复算回来。

### 9.7 未验 5：`cordis.patch.yml` 回到 771 B ⇒ **口径待定**（218 B 已复算）

- 🔵 **`vp-cordis.patch.yml.ORIG`**（`135023\`）= **218 B**，sha256 `8c2d1f557ff4d18f5d3c1b284a7246cacc571853b468ff56e4fa33204827c1f6`；`143729\ORIG-cordis.patch.yml` **同值**（两目录一致，`SequenceEqual` = True）。内容 = 3 行注释 + `[]`。该 sha **逐字出现在** `round2-start.map` / `round2-final.map` 的 `cordis.patch.yml` 行（36 行快照清单）⇒ **ORIG = 该 map 的基线** ✅。
- 🔴 **771 B 在盘上找不到**：`135023` / `140444` / `143729` / `E:\Temp` / `~/.dsh\profiles` 内**没有任何 771 B 的 yml**（按字节数筛出的全是无关 `node_modules` 文件）；`B-round2-evidence.md` 第 53 行自己给的 sha `77afca6c…` 也**没有对应文件**（除该 md 自身外全树 0 命中）。
- ⇒ **口径待定**：**218 B（探针 profile 的 ORIG）** 与 **771 B（§4 说的「写凭据之前的 settings 文档」）** 是**两个不同对象**，本轮**只复算了前者**；后者（含 `77afca6c…`）记 **未复现**（不冒充、不硬凑）。
- 🔴 活 profile 现状（**只读，且不作为证据**）：`~/.dsh\profiles\volatile-probe\cordis.patch.yml` = **343 B** / sha `cdc61a08…`（= ORIG 的 3 行注释 + `ui-settings-general` 一条 patch），**既不是 218 也不是 771**；且**另一轮正在跑探针实例**（`143729\probe-instance.log` 被占用）⇒ 活 profile 的尺寸/内容**本轮不稳定**，不据此推断任何结论。

### 9.8 未验 7 ⇒ **关闭**：401 文案「改完配置需重载插件行」已订正（①）

**真机事实（`writeToken` 是 `.volatile()`、宿主每请求现读）**：轮换/清除**即时生效**，一次重载都没做。

| # | 位置（原文逐字） | 判定 | 处置 |
| --- | --- | --- | --- |
| 1 | `src/client/write-token.ts:55`「并确认服务端已读到该值（**改完配置需重载插件行**）」 | 🔴 **错**（与真机事实矛盾） | 已改为「`writeToken` 是 **volatile** 字段、宿主**每次请求现读** ⇒ 改完**即时生效**，**不需要**重载插件行」 |
| 2 | `src/client/pane-settings.tsx:233`（delivery）「⚠️ **服务端要读到新值需要重载插件行**。**2026-10-12 真机已订正**：…且**轮换即时生效**」 | 🔴 **错且自相矛盾**（同一段先说需重载、后说即时生效） | 已改为「…**轮换即时生效**（旧串立即 401、新串立即 200）、**清除同样即时生效**，**不需要重载插件行**」（保留 ③d 用例要的 `2026-10-12` / `settings/describe` / `secrets` / `轮换即时生效` 四个字面量） |
| 3 | `specs/009-write-ui/requirements.md:34` REQ-3.1 末句「提示文案 SHALL 说明「**改完配置需重载插件行**」」 | 🔴 **错**（把错话写成了 SHALL） | 已改为「SHALL 说明「**去哪里配置**」且 **SHALL NOT** 要求用户重载插件行」，并**保留原文作订正痕** |
| 4️⃣ 额外发现（派单未点名，同文件同主张） | `pane-settings.tsx:176`「…请先「生成并保存写通道凭据」，**再重载插件行使服务端读到新值**」；`:189`「…**服务端要读到新值需要重载插件行**」 | 🔴 **同错**（同一文件里两处；不改则与 :233 自相矛盾） | 一并订正（同文件、同一主张，最小改动） |
| 5️⃣ 额外发现（同一条判据的另两张表） | `requirements.md:91` / `README.md:54` 的 U3 行「配置页「生成并保存」**+ 重载插件行** ⇒ 401 消失」 | 🔴 **同错**（判据里把「重载」当必需步骤） | 一并订正为「⇒ 401 **立即**消失（volatile 现读，**不需要**重载插件行）」 |

**🔴 保留项（其实是**对的**，一字未改，附理由）**：

- `src/transport/write-auth.ts:59`「两种写法都**即时生效**（字段是 volatile，宿主每次请求现读凭据，**不需要重载插件**）」—— **本来就是真机事实**，它是这次的**正确 SSoT**。
- `src/client/write-token.ts:217` / `src/client/settings-pipe.ts:97` 的「重载**页面**」—— 讲的是**刷新浏览器页面**后 `describe()` 仍报 `set:true` 的**修前症状**（与 `set:false` 对照），**不是**「重载插件行」⇒ **保留**。
- `stack-decision.md:346` / `stack-decision-changelog.md:144` 的「HMR 串行重载 / remount」—— 讲的是 **ordinary 字段变更会 remount** 与 `patchReload: live` 机制（**另一件事**：`elevationPolicy` 之类普通字段确实会 remount），**保留**。
- `tasks.md` **未动**：其 `T2.2` 判据行（`:31-32`）与 `V7` 行（`:44`）已**自带**「原判据里「重载插件行」真机上**不是必需的**（留痕不改判据）」的订正痕（`:32` / `:161`），且 `:299` 写明该段「与 008 原文**逐字相同**」⇒ 单方面改会造两处漂移。⚠️ **遗留**：`tasks.md:297` 的转述「UI 文案已明写「若无效应重载插件行」」**因 ① 的订正而变旧**，与 008 侧同句一起留待统一处理（**登记，不在本轮回改**）。

**验证**：**未改任何行为 / 接口 / 判据语义**（只改字符串与 markdown 文字）；仓库内**没有任何测试断言旧措辞**（`grep` 在 `tests/**`：`重载插件行` **0 命中**；只有 4 处「重载**页面**」= 浏览器刷新语义）⇒ 无需同步测试；三道门全绿见 9.9。

### 9.9 本轮自检（**每步字节级**）与**我自己的错**

**字节级自检（每次写盘后立刻跑）**：`loneCR = 0`、控制字符（TAB 之外）= 0、`BOM = False`、行数 ≤ 400 ⇒
`requirements.md` **98** 行 / `README.md` **64** 行 / `acceptance-round.md` **< 400**（本文件写完后复算在报告里给出）/ `tasks.md` **330** 行（**本轮未动**）。⚠️ 全部 `.md` 与源码改动**都走** `[IO.File]::ReadAllBytes` / `WriteAllBytes` + `UTF8Encoding($false)`，**不用 `edit` 工具**（它会静默归一 CRLF）；每个锚点**先断言恰命中 N 次**，不命中就**整批拒绝**（本轮 7 个锚点首次全部 `anchors=1`，退出码 0）。

**我自己的错（如实，不掩饰）**：

1. 🔴 **取证污染了取证对象**：`Select-String` 全树先报「旧串 0 命中」，而我随后用 node 复扫同一棵树**捕到 1 次命中**（DSH 会话转录缓存）—— 根因是**我把两个凭据串打进了终端输出**。⇒ 处置：`~/.dsh` 全树**标不可复算**，只保留「profile 树内 0 命中」（9.5）。这也直接说明：**凭据值不该进报告正文**。
2. 🔴 **解析口径错**：`a3-describe-after.txt` 我第一版脚本按「整文件 JSON」解析 ⇒ `SyntaxError: Unexpected non-whitespace character after JSON`；真相是该 dump 是**裸数组体**（`{..},{..}`，**没有**外层 `[]`）⇒ 补 `[]` 后解析成功。**错的是我的脚本，不是产物。**
3. 🔴 **窗口混淆（本次订正的核心）**：我上次把 `140444` 当唯一产物目录 ⇒ 现在订正为三目录并**明确标注 `135023` = 陈旧产物窗口**（9.1 第 3 条）。**`135023` 的 `b3-describe-after-clear.json` = `set:true`**，若不当心，会被误引成「修后仍 `set:true`」的反证 —— 这条**必须先讲清窗口**。
4. 🟡 **未复现的仍写未复现**：`77afca6c…`（771 B）与上一轮的 `72a135c8…` 一样，**盘上无文件 ⇒ 不硬凑**（9.7）。

## 10. 另一轮真机结论：只读判据**取值口径** · 零落盘的**测量边界**（2026-10-12 第二轮）

> 证据目录：`C:\Users\EDY\dsh-probe-artifacts\20261012-172155-auto-readonly\`（**只读**，未改一字）；`RESULT.txt` 28,190 B / sha256 `8FDFB1064FDE1AE229F3D0A8CB03D99978FA37671A69201C594B7D411BD6664D`。
> 与 §1–§9 是**两轮不同批次**的真机产物 ⇒ 结论**并列**、不互相覆盖；本节**只追加**。

### 10.1 F1 🔴 **宿主自己也会写 profile patch** ⇒「零落盘」必须限定在**插件交互路径**上测量

- 实测：点 GUI 的「继续」关掉**预览版说明弹窗** ⇒ 宿主把 `ui-settings-general` / `welcomeNoticeVersion` 写进 `~/.dsh/profiles/<name>/cordis.patch.yml`（**218 B → 343 B**，mtime `17:30:52`）。
- ⇒ 若把测量窗口开成**整个浏览器会话**，会把**宿主自己的写盘**误记成**插件写盘** ✗。
- ⇒ 正确口径：零落盘类判据一律**限定在「打开配置页 → 编辑 → 保存」这条插件交互路径**上取 before / after 快照。
- 同一事实的另两处落点：`AGENTS.md`「配置存活」行（**就地补**）、[`../007-terminal-config-page/design.md`](../007-terminal-config-page/design.md) §5.1(2)。

### 10.2 F4 `cordis.yml` 启动时被重写但**内容逐字节不变** ⇒ 只看 mtime 会误报

- 实测：启动时 `cordis.yml` 被**重写**，内容 sha 仍 `c300dcf2…`（逐字节不变）⇒ **mtime 变了 ≠ 内容变了**。
- ⇒ 零落盘判据必须 **sha + mtime 双证**，并**以 sha 为准**；单看 mtime 会报假阳性。

### 10.3 F5 `describe` / `update` 计数（配置页的最小流量面）

- 打开配置页 ⇒ **1 次 `describe`、0 次 `update`**；**锁定态**下点保存 ⇒ 只补发 **1 次 `describe`**、**仍 0 次 `update`**（=「不写盘」的证据面）。
- ⇒ 计数可当**可二值判定**的旁证：`update` 计数**必须为 0**；`describe` 计数按「打开 1 次 / 锁定态保存 +1 次」对表。

### 10.4 F6 已知**假阴性**形态被兜底接住（真机证据；对应 007 的判据 4）

- 覆盖层取 schema 默认值（`config:{profiles:[]}`）⇒ `value={profiles:[]}` / `base={profiles:[]}` / `user={}` ⇒ **推断不出** ⇒ 零写入推断如实降级为**可写**（保守口径 ✓）。
- 真点保存 ⇒ **1 次 `settings/update`**（`expectedRevision:0`）⇒ 宿主拒绝原文 `{"ok":false,"error":{"code":"settings/rejected","message":"Configuration for \"dsh-terminal-profiles\" is overridden by a home patch or command-line overlay",…}}` ⇒ 页面**转锁定 + 显示真实宿主原因 + `cfg-error[data-notice-kind=readonly]` + 用户输入逐字保留 + patch sha/mtime 未变** ✅。
- ⇒ 007 的保守设计「**不确定 ⇒ 可写；被拒 ⇒ 锁定**」**获真机证实**：假阴性（少锁一次）由「被拒 ⇒ 锁定」这一路接住，**不是缺口**。

### 10.5 本节未验（**不许勾** ✗）

- **home 层 patch**（`~/.dsh/cordis.patch.yml`）真机**仍无样本** —— 本批触发手段只有 `--patch` 覆盖层（拒绝文案同覆盖两源，但 home 层**本身未创建**，属红线范围外）。
- **混合行**（同一次写入里 ordinary + volatile）、**锁定态下真实写入成功路径**、`read-only provider` 分支：三者本轮**都没有样本**。
- `revision 冲突` 本轮**无新样本**（上一轮样本仍在盘上、原样保留，本节不新增也不删）。
- 🔴 **同代性错配（只登记，不改代码）**：`packages/terminal-profiles/src/client/index.ts` 于 `17:27:21` 被并行提交 `ae9f74b` 改动，而 `lib/` 未重建（`lib/` 最新 mtime `17:23:14`）⇒ 本轮真机结论**不受影响**（改动 = pending-warn 宽限 + WS 重注册，不触及配置页/只读推断），**要完全消解须在重建 `lib/` 后重跑同门**；全文见 [`../007-terminal-config-page/tasks.md`](../007-terminal-config-page/tasks.md) 的「同代性错配登记」。

### 10.6 本节字节级自检 + **我自己的错**

- 本文件在本节追加后仍 **< 400** 行 ✓（实测行数 / 字节 / `loneCR` 在本轮报告给出）；行尾**保持 LF**（本文件全 LF，**不引入 loneCR**）；`BOM = False`；控制字符（TAB 外）= 0；写盘走 `[IO.File]::ReadAllBytes` / `WriteAllBytes` + `UTF8Encoding($false)`（**不用 `edit` 工具**），锚点**先断言恰 1 次**、不命中就整批拒绝。
- **我的错（如实）**：派单把 `revision 冲突` 也列入「仍无样本」，但**盘上上一轮已有样本**（`C3-external-advance.txt`）⇒ 我按**盘上事实**记为「本轮**无新样本**」，旧样本**原样保留**，既不新勾也不删（§10.5）。