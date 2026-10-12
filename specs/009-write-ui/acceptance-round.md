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
