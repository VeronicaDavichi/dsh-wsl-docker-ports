---
status: in-progress
created: 2026-10-22
created_at: 2026-10-22T08:39:49.241276500Z
updated_at: 2026-10-22T08:40:02.643390400Z
transitions:
- status: in-progress
  at: 2026-10-22T08:40:02.643390400Z
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
- [x] 回归：`tsc` 0 / `node --test` 全绿（477）/ `vitest` 全绿（148）/ 主包体积零增长（49,183 B）。

## 交付记录（2026-10-22）

**已做**：`src/read/local-addresses.ts`（纯过滤 + 严格解析 + 只读探针，15 s 超时、失败可区分）；`wire.ts` 加
`localAddresses` / `localAddressesError`（读失败只降级这一栏）；`snapshot.ts` 接线并向 `diff` 传候选清单；
`diff/engine.ts` 的 `expectedListenAddress(scope, listenAddress?)` + `isOurListenAddress(value, allowed)`；
`write/firewall.ts` 的 `cidrFor` + 可选 `remoteAddress`；`write/plan.ts` 参数化 `listenaddress` 并 fail-closed
拦下 `listen-address-invalid`（拦下判据拆到 `write/guards.ts`，因为 `plan.ts` 触到 400 行 SHALL）；
客户端懒加载 chunk 新增 `sel-listen-address` 下拉（`pane-listen.tsx`）。

**未做（刻意，均有理由）**：

1. **客户端选择不回传服务端**：`SettingsPatch` / `write target` / 快照查询串都在**常驻主包**
   （`lib/client.js` 49,183 B 零余量棘轮）⇒ 加字段即破 ①b。故选择目前只活在本组件内（视图形参），
   真实写入仍按配置里的 `scope` 走默认地址。要闭环须先给主包腾出预算（另立 Spec）。
2. **提权脚本模板未改**：真实执行走 `elevate/script.ts` 的固定 PS1 模板，其 `listenaddress` 由
   `plan.scope` 推导、且不支持 `-RemoteAddress`。本轮只做**计划层**参数化（A2 的判据即计划预览）。
3. **未在真机 GUI 点验**：本会话只跑了离线门（含 8 个 jsdom 用例）。真机点验需临时 profile + 浏览器会话。
4. **未执行任何 `netsh` / 防火墙写**：A5 的「条数不变」是**只读复读**得到的事实，不是我改过又改回来。
