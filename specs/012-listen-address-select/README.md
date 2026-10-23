---
status: complete
created: 2026-10-22
created_at: 2026-10-22T08:39:49.241276500Z
updated_at: 2026-10-22T09:52:36.951079100Z
completed_at: 2026-10-22T09:52:36.951079100Z
transitions:
- status: in-progress
  at: 2026-10-22T08:40:02.643390400Z
- status: complete
  at: 2026-10-22T09:52:36.951079100Z
---
# 011 · 监听地址可选（listenAddress 从 Windows 物理网卡 IP 里选）

## 背景（2026-10-22 主人真机反馈）

主人手工加了这条规则后指出：「192.168.31.129 这个值让用户选，从 ip 里面选（去掉 172 的这种抽象 ip）」。
现状：`expectedListenAddress(scope)` 只有两种硬编码值 —— `loopback` ⇒ `127.0.0.1`、`lan` ⇒ `0.0.0.0`。
`0.0.0.0` 会在**所有**网卡上监听（含 aTrust VPN / 蓝牙 / 未来新增网卡），主人要的是「只在我选定的那张网卡/IP 上转发」。

## 需求（EARS）

- REQ-1.1 当用户把某端口作用域切到「局域网」时，系统 SHALL 提供一个**监听地址**下拉，取值来自 Windows 侧的 IPv4 候选清单。
- REQ-1.2 候选清单 SHALL 过滤掉：`127.0.0.0/8`、`169.254.0.0/16`、`172.16.0.0/12`（WSL/Hyper-V 虚拟网段）、以及网卡别名命中 `vEthernet` / `aTrust` / `Tailscale` / `VMware` / `VirtualBox` / `Loopback` / `WSL` 的条目。
- REQ-1.3 默认值 SHALL 为 `0.0.0.0`（所有网卡），保持 010 及之前的行为不变；用户显式选了具体 IP 才写该 IP。
- REQ-1.4 用户选定具体 IP 时，写入 SHALL 用该 IP 作为 `netsh portproxy` 的 `listenaddress`，并 SHALL 把防火墙放行范围收窄到**该 IP 所在的网段**（按 prefixLength 计算 CIDR）。
- REQ-1.5 存量规则 SHALL NOT 被迁移：本需求只影响之后新建/编辑的受管端口；已有 19 条 `0.0.0.0` 规则与手工加的 3306 规则保持原样，最多在只读面被标为 `scopeMismatch`。
- REQ-2.1 候选清单读取失败时 SHALL 降级为「只有一个 `0.0.0.0` 选项 + 明示失败原因」，SHALL NOT 让整页不可用。

## 设计要点

- 读取：新增 `src/read/local-addresses.ts`，一条只读 PowerShell 调用枚举 IPv4（`InterfaceAlias`/`IPAddress`/`PrefixLength`），硬超时 + 失败可区分；过滤规则集中在**一个纯函数**里（可单测，不碰系统）。
- 作用域模型：`Scope` 从 `'loopback' | 'lan'` 扩成 `'loopback' | 'lan'`，另加**可选** `listenAddress?: string`（缺省 = `0.0.0.0`）。理由：保持 `scope` 语义与既有 19 条规则的判定不变，只加一个窄字段。
- 写入：`write/plan.ts` 的 portproxy 步骤参数化 `listenAddress`；防火墙步骤的 `RemoteAddress` 由「选中 IP + prefixLength」计算，`0.0.0.0` 时维持现状。
- 客户端：选择器落在**右栏页端口表**（懒加载 chunk），主包体积不得增长。
- 判定：`diff/engine.ts` 的 `OUR_LISTEN_ADDRESSES` 扩为「两种默认值 + 候选清单里的 IP」，避免用户选了具体 IP 后被判 `conflict`。

## 验收（可二值判定）

- [x] A1 右栏页「局域网」态出现下拉，选项含 `0.0.0.0（所有网卡）` + 物理网卡 IP（本机应为 `192.168.31.129`），且**不含** `172.20.201.152` / `172.20.192.1` / `127.0.0.1`（`tests/client/listen-address.test.tsx` 逐条断言；真机 GUI 未在本轮点验，见下「未做」）。
- [x] A2 选 `192.168.31.129` 后的计划预览里，portproxy 步骤的 `listenaddress` 就是该 IP，防火墙 RemoteAddress 为 `192.168.31.0/24`（`tests/unit/listen-address-select.test.ts` 的「lan + 选中 IP」与 `cidrFor` 用例）。
- [x] A3 不选（默认）时计划与 010 完全一致（`0.0.0.0`；命令原文逐字比对，且 `listenAddress` / `remoteAddress` 键**不出现**）。
- [x] A4 枚举失败时下拉只剩 `0.0.0.0` 且带原因文案，页面其余部分照常（`localAddressesError` 降级；快照仍 `ok:true`）。
- [x] A5 存量 19 条规则条数不变（19），手工 3306 规则不被改动（2026-10-22 只读复读：19 条 `0.0.0.0` + 1 条 `192.168.31.129:3306`，全程未执行任何 `netsh` 写）。
- [x] 回归（**第二轮闭环后实测**）：`tsc` ×3 exit 0 / `node --test` **488/488/0** / `vitest` **16 文件 148 用例全绿** / 主包 **49,500 B**（+317 B，**主人 2026-10-22 书面授权上限 +400 B**）/ `check-size` exit 0（最大 399 行）。
- [x] A6 **选择真的落地**：选中即写配置（`listenAddresses[端口]`），刷新后仍回显；计划里 `listenaddress=<所选 IP>` + 防火墙 `RemoteAddress=<该网卡网段>`；不选 ⇒ 与 010 逐字一致；非法/非候选 IP ⇒ `listen-address-invalid` + **零写入**（`tests/unit/listen-address-persist.test.ts` 10 条 + `tests/client/listen-address.test.tsx` 的写回断言）。
- [x] A7 提权脚本真的带上它：PS1 模板 `listenaddress=$listen` + `-RemoteAddress $RemoteAddress` + 三个新形参，argv 只在需要时追加（缺省 argv 与 010 逐字相同）。

## 交付记录（2026-10-22）

**已做**：`src/read/local-addresses.ts`（纯过滤 + 严格解析 + 只读探针，15 s 超时、失败可区分）；`wire.ts` 加
`localAddresses` / `localAddressesError`（读失败只降级这一栏）；`snapshot.ts` 接线并向 `diff` 传候选清单；
`diff/engine.ts` 的 `expectedListenAddress(scope, listenAddress?)` + `isOurListenAddress(value, allowed)`；
`write/firewall.ts` 的 `cidrFor` + 可选 `remoteAddress`；`write/plan.ts` 参数化 `listenaddress` 并 fail-closed
拦下 `listen-address-invalid`（拦下判据拆到 `write/guards.ts`，因为 `plan.ts` 触到 400 行 SHALL）；
客户端懒加载 chunk 新增 `sel-listen-address` 下拉（`pane-listen.tsx`）。

**未做（刻意，均有理由）**：

1. ~~**客户端选择不回传服务端**~~ → ✅ **第二轮闭环已关闭**（见下「A 计划闭环」）：`SettingsPatch.listenAddresses` + `writeListenAddress` + 选择即写配置 + 服务端现读并贯通到计划/脚本/防火墙。
2. ~~**提权脚本模板未改**~~ → ✅ **第二轮闭环已关闭**：`elevate/script.ts` 的 PS1 模板真的用 `$listen` 与 `-RemoteAddress`，`scriptAddressesOf` 从计划步骤反推 `-ListenAddress` / `-DeleteAddress` / `-RemoteAddress`。
3. **未在真机 GUI 点验**：两轮都只跑了离线门（`node --test` + jsdom）。真机点验需临时 profile + 浏览器会话（主人指定的 profile 白名单），本轮未做。
4. **未执行任何 `netsh` / 防火墙写**：A5 的「条数不变」是**只读复读**得到的事实，不是我改过又改回来；**真写由主人接手**（提权脚本的 `listenaddress` / `-RemoteAddress` 只做了模板与断言，未经真机执行）。

## A 计划闭环（2026-10-22 第二轮）

**目标**：选择 → 写配置 → 计划 → 提权脚本 → 防火墙，全链 fail-closed。

**判定口径**（新增用例逐条钉死，`tests/unit/listen-address-persist.test.ts`，10 条）：

1. 配置 `listenAddresses['3306'] = '192.168.31.129'` ⇒ 计划两步：`portproxy-add … listenaddress=192.168.31.129` + `firewall-add … -RemoteAddress 192.168.31.0/24`（网段来自候选条目自己的 `prefixLength`）。
2. 没传也没配 ⇒ 与 010 **逐字节一致**（`listenaddress=0.0.0.0`、无 `RemoteAddress` 键、**候选网卡一次都不探测**；显式选 `0.0.0.0` 与缺省的 `planId` 相同）。
3. 非法 IPv4 / 合法但非候选 / 候选清单为空 ⇒ `listen-address-invalid` + **`steps: []`**（绝不静默回退 `0.0.0.0`）；候选来源抛异常 ⇒ `503 rules-unavailable`（不把「读不到」当「没有网卡」）。
4. 请求体 `listenAddress` 覆盖配置值（同端口两处不同 ⇒ 以请求为准，且仍过候选门槛）。
5. 快照带 `listenAddresses`（回填下拉的**唯一**来源；客户端不从 `describe()` 读第二份）。
6. PS1 模板含 `listenaddress=$listen` / `-RemoteAddress $RemoteAddress` / 三个新形参；`scriptArgs` 缺省时与 010 逐字相同。

**改动面**（单包，`packages/wsl-docker-ports`）：`config.ts`（第 6 字段）、`config-read.ts`（`listenAddresses()` 读法）、
`wire.ts` / `snapshot.ts` / `plugin.ts`（快照透出 + 两处事实注入）、`write/types.ts` / `write/guards.ts` / `write/plan.ts`
（`allowedListenAddresses` + 候选门）、`transport/{plan,plan-port,listen-address,real-facts,wire-plugin}.ts`
（请求覆盖 > 配置 > 缺省的唯一解析点）、`elevate/{types,script,invoke,runner}.ts`（三个新形参 + 从步骤反推）、
`client/{settings-pipe,write-channel,page,pane}.tsx`（选择即写 + 请求透传）。

**体积**：主包 49,183 → **49,500 B（+317 B）**，依据 = **主人 2026-10-22 授权「012 listenAddress 贯通」**，
授权上限 +400 B，**未超额、未预借**；chunk 143,674 → **145,459 B**（切分边界未动）。第一版实测 +679 B
（超授权 279 B）⇒ 把**无人消费**的 `readConfig().listenAddresses` 读回路径整段删掉（回填走快照）后回到 +317 B。
SSoT / 文档表 / changelog 三处同步为 `49500 / debt / 2026-10-22 / #58`。

## 验收期缺陷与修复（2026-10-23，真机 F1：自己写的规则被自己判成 conflict）

### 症状（主人真机反馈，原样）

```
listenAddress=192.168.31.129  listenPort=3306  connectAddress=172.20.201.152  connectPort=3306
POST /dsh-wsl-docker-ports/write/plan {"action":"fix","ports":[3306],"scope":"lan"}
  ⇒ ports[0].blocked.reason = "state-conflict"
    message: 端口 3306 上有 1 条形态不符的既有规则：listenAddress=192.168.31.129 不在本插件会写的
             {127.0.0.1, 0.0.0.0} 内：只报告不改动（REQ-1.3）
```

同一条规则在**页面快照**里是 `ok`（读侧 012 已把「候选清单里的 IP」算作我方形态）⇒ **两侧口径分叉**：
用户对自己刚让插件写出来的规则点「移除 / 修复漂移」被挡住，自相矛盾。

### 根因

012 只放宽了**读侧**（`diff/engine.ts:isOurListenAddress(value, 候选清单)`），写侧所有权闸门
（`write/ownership.ts`）当时仍是 `OUR_LISTEN_ADDRESSES.includes(rule.listenAddress)` —— 只认两个默认
字面量。这正是 AGENTS.md「不许各自解释口径」所忌：判据有两份解释，必然漂移。

### 修复（判据只剩一处）

- **集合与判据的本体**搬到 `src/diff/listen-allowed.ts`（`OUR_LISTEN_ADDRESSES` + `isOurListenAddress`，
  `diff/engine.ts` 原样转出，既有 import 路径一字不改）。
- **allowed 的唯一组装点** = `allowedListenAddressesFor({ configured, candidates })`：
  `{127.0.0.1, 0.0.0.0}` ∪ 该端口配置 `listenAddresses` 登记过的值 ∪ 候选清单里的 IP。
- 读侧（`diff/engine.ts:classifyPorts`）与写侧（`write/guards.ts:matchOf`）**调同一个函数**；
  `write/ownership.ts` 的 `classifyRuleOwnership` / `fixableDriftRule` 都走 `isOurListenAddress`。
- 连带修 `write/plan.ts:scopeFromRules`：原判据「`=== 0.0.0.0` 才算 lan」会把一条 `192.168.31.129`
  规则推成 `loopback` ⇒ `remove/fix` 的脚本拿 `127.0.0.1` 去删一条监听 `192.168.31.129` 的规则
  （删不掉 + 防火墙放行留着）。现判据 = 「非 `127.0.0.1` 即 lan」，`switch-scope` 的 `lanRules` 同步。
- 候选清单读取**懒且可降级**：`transport/plan-port.ts` 只在「两个默认值 + 配置值覆盖不了该端口规则」
  时才读网卡（默认路径**零探测**不变）；所有权判据用的 `candidates()` **读失败降级为缺席**（只认配置值）。
  012 的**选择门**语义一个字没动：`add` 一个具体地址而候选清单读不到 ⇒ 仍 `503 rules-unavailable`。
- 新字段：`WritePlanInput.listenForms`（形态事实）与 `listenAddressInPlace`（`fix` 重写规则**自己那条**
  地址 ⇒ 不新增暴露面，可跳过候选门；`remove` 则完全不解析监听地址，不再因网卡读不到而 503）。

### 行为（可二值判定，`tests/unit/listen-address-form.test.ts` 10 条新增用例）

| 输入 | 修复前 | 修复后 |
| --- | --- | --- |
| 真机那条 `192.168.31.129:3306`（配置已登记）+ `fix` | `state-conflict`，零动作 | `portproxy-delete + portproxy-add`，地址原样 |
| 同上 + `remove` | `state-conflict` | `portproxy-delete + firewall-delete`（`plan.scope=lan`） |
| 快照判定同一条规则 | `ok` | `ok`（两侧现在一致） |
| `10.9.9.9`（未登记、非候选）+ `fix`/`remove` | `state-conflict` | **仍** `state-conflict`，零写入 |
| `0.0.0.0` / `127.0.0.1`（任意动作） | 逐字不变 | 逐字不变（含候选清单零探测） |
| 候选清单读失败 + `remove`/`fix`（地址已在规则上） | — | `ready: true`（不 503、不误拦） |
| 候选清单读失败 + `add` 具体地址 | 503 | **仍** 503（fail-closed 未放宽） |

### 回归实测（Windows 侧，`packages/wsl-docker-ports`）

8 道门 exit 0：`tsc -p tsconfig.json` / `node --test` **522/522**（原 511 + 新增 11）/
`vitest` **17 文件 154 用例**（未变）/ `assert-client-split`（17 项断言、
主包 **49,500 B** = 棘轮上限，**零增长**）/ `check-size`（最大 `script.ts` 399 行，仍 < 400）/
`tsc -p tsconfig.build.json` / `build-client` / `tsc -p tsconfig.client.json`。
chunk `client.ports.js` 146,798 → **148,301 B（+1,503 B）**（`diff/`、`write/` 本来就在懒加载 chunk 里）。

**未做（刻意）**：真机 `netsh` / 防火墙写（零执行；本修复只改判据与计划，不经手系统状态）；
真机 GUI 点验（需临时 profile + 浏览器会话）；`013` 未提交的工作树改动一行未碰。
