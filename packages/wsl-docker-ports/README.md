# dsh-wsl-docker-ports · 用户手册

> WSL Docker 端口转发的**可配置管理器**（DeepSeek Harness `0.2.0-rc.2` 插件）。
> 本文件是给**使用者**的手册：安装与接入 · 配置 · 操作 · **提权与 UAC 自查** · FAQ · 限制。
> 实现细节、判定依据与逐条证据见 `specs/003-wsl-docker-ports/`、`specs/005-elevation-write-path/`。

---

## 1. 它能做什么（以及刻意不做什么）

**做**：读出 WSL 里 docker 实际映射的端口、把「Windows 侧 portproxy 规则 + 防火墙单条放行」两件事
合成**一次可预览的变更**，逐端口决定只对本机开放还是对局域网开放，并把每次写尝试留痕。

**刻意不做**（这些是设计边界，不是缺失）：

- 不写「一键全量放行」：`portproxy` 规则与防火墙规则**逐端口**管理，默认只对本机（`loopback`）开放。
- 不动**别人的**规则：只有你的 `managedPorts` 声明集合内的端口才进管理面，集合外一律只读展示。
- 不用 `netsh portproxy reset`（那会清空机器上**全部**规则，含他人规则）。
- 不装任何工具、不改 PATH、不改你的 `gsudo` 配置、不改 `.wslconfig`。
- 不代偿 UDP（见 §7）。

## 2. 安装与接入

1. 以 `link:` 方式接入本包（**路径即版本**，不需要 npm 账号）：
   在插件的消费方（profile）侧执行 `pnpm install`，让它解析 `dsh-wsl-docker-ports` → 本仓库
   `packages/wsl-docker-ports`。
2. 在目标 profile 的 `cordis.patch.yml` 里加入本插件的条目（`- id: dsh-wsl-docker-ports`）。
   设置项的**写入一律走产品自身的配置通道**（`ctx.settings.*`）⇒ **不要手写这个 YAML 的值**
   （它同时是 settings 的落盘处，手写会与产品写入互相覆盖）。
3. 「配置改动是否即时生效」由 profile 清单决定：`profiles/<name>/package.json` 的
   `dsh.profile.patchReload = "live"`。
4. 打开右栏「端口转发」页。**开页零副作用**：只读事实，不建规则、不提权。

> ⚠️ 请在自己使用的 profile 里接入。**不要**把插件装进他人/其他项目正在使用的 profile
> —— 那会把对方的插件清单一起改动。

## 3. 配置（5 个字段，命名空间 `dsh-wsl-docker-ports`）

| 字段 | 含义 | 默认 | 备注 |
| --- | --- | --- | --- |
| `managedPorts` | **所有权声明**：哪些端口归本插件管 | `[]` | 集合外的规则只读展示，绝不改动 |
| `scopes` | 逐端口作用域（`loopback` / `lan`） | `{}` ⇒ 每端口 `loopback` | 局域网是**逐端口显式 opt-in** |
| `distro` | 目标 WSL 发行版 | 留空 ⇒ 按四级优先级自动解析 | 自动发现自 `wsl -l -v`，不要手打 |
| `elevationPolicy` | 提权策略：`none` / `ask` / `passby` | `none`（**fail-safe**） | 写错/认不出 ⇒ 也落 `none` |
| `writeToken` | 写通道凭据（`role('secret')`） | 无 ⇒ 写入口一律 401 | 宿主每次请求**现读** ⇒ 改完即时生效 |

- **`elevationPolicy` 的三档**：`none` = 不做任何提权写操作（**推荐默认**）；
  `ask` = 每个写操作都走提权链（是否弹 UAC 见 §5）；`passby` = 缓存活跃时不再弹。
  **由 Agent 触发时一律降级为 `ask`**（不给你「静默自动写」的机会）。
- **改配置 ≠ 写系统**：改这五个字段只写配置（`remote.settings`），**不触发任何提权调用**。
  真正的系统改动只在 §4.3 的「确认 → 执行」那一步发生。
- `writeToken` 由配置页的「生成并保存」按钮产生；生成后**只显示一次**，刷新页面不再显示明文
  （凭据仍活在本次会话里，够用即可）。

## 4. 操作

### 4.1 只读查看

打开页面即读：容器映射 / 19 条（或你机器上的实际条数）portproxy 规则的五态判决
（`已就绪` / `缺少规则` / `地址漂移` / `冲突` / `多余规则`）、eth0 地址、NAT 判定、外部规则（只读）。
点「刷新」重读一次。取不到 eth0 时**整条判决都不给**（不把全部规则误标为漂移）。

### 4.2 逐端口切作用域

每个端口一个下拉：`loopback`（仅本机）/ `lan`（局域网）。切到 `lan` 会同时带来
portproxy 的监听地址变化与**一条**对应的防火墙放行（只放这一个端口）。

### 4.3 应用 / 移除转发（四步，缺一不可）

1. **声明**：在 `managedPorts` 里写上端口并保存（只改配置）。
2. **计划（plan）**：产品算出这一步要做什么，生成**变更预览** —— 逐条列出将新增/删除的
   portproxy 规则与防火墙规则、端口号、作用域。此时**还没有碰系统**。
3. **确认**：你在预览上确认后，才会带着 **一次性票据（ticket）** 与凭据发起 `apply`。
   **未确认 ⇒ 零提权、零写入**。
4. **执行**：经提权链执行（后端为 `gsudo` 或 `Start-Process -Verb RunAs`），结果四态反馈：
   状态 · 实际后端 · 生效的提权档 · 耗时 · **是否回滚** · 中途未应用项（失败时逐条列出，不留半截）。

### 4.4 审计留痕

每次写**尝试**（成功与失败都算）写一条审计，**一行一条**，同时进插件运行时日志。
⚠️ `disabled`（提权档为 `none`）与 `no-actions`（没有要做的步骤）在执行前就返回 ⇒ **不算尝试、不写审计**。
只读接口：`GET /dsh-wsl-docker-ports/write/audit`（需带写通道凭据，否则 401），
返回最近 **50** 条 + 环状态（`size` / `dropped`，用来解释「尾部」的含义）。

真机原文示例（2026-10-15 实测，来自产品自己落的行）：

```
[dsh-wsl-docker-ports] audit seq=1 at=2026-10-15T04:22:59.337Z origin=user result=applied action=switch-scope scope=loopback ports=6379 steps=portproxy-delete@6379 policy=passby backend=gsudo exit=0 ms=7210 rolledBack=false planId=635b0cf3ac92
[dsh-wsl-docker-ports] audit seq=2 at=2026-10-15T04:23:43.586Z origin=user result=applied action=switch-scope scope=lan ports=6379 steps=portproxy-add@6379+firewall-add@6379 policy=passby backend=native exit=0 ms=3940 rolledBack=false planId=70fb2a0a2541
```

字段含义：`origin` = 谁触发（`user` / `agent`）· `result` = `applied` / `failed` ·
`policy` = **生效**的提权档（不是配置里写的那个）· `backend` = **实际**用的后端 ·
`rolledBack` = 是否发生回滚 · `planId` = 与票据/预览同源。

> 🔒 审计记录**按白名单拷贝**：凭据、原始请求体、环境变量等字段进不了记录；内嵌换行会被压成空格
> （一条永远只占一行）。当前**没有**页面内的审计查看器（如需请提需求）—— 直接用上面的只读接口。

## 5. 提权与 UAC 自查

🔴 **本机提权可能不会请你确认：若系统 UAC 策略为「不提示直接提权」（ConsentPromptBehaviorAdmin = 0），
提权链会静默执行 —— 此时「变更预览 + 确认」就是你唯一的人类闸门。**
自查：`reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v ConsentPromptBehaviorAdmin`
（0 = 不提示直接提权，2 = 安全桌面确认，5 = 默认；EnableLUA = 0 表示 UAC 整体关闭）。
完整取值表与逐步自查见本节。

> 这段与产品内「提权策略」区块显示的告知是**同一份文案**（单一真相来源在
> `src/client/rows.ts` 的 `ELEVATION_CONSENT_NOTICE`）；改一处必须同步另一处。

### 5.1 为什么必须自查

UAC 是**系统策略**，不是本插件能替你决定的：策略允许「不提示直接提权」时，提权链**不会**出现
任何弹窗确认 —— 你不会被问，也就没有「点一下才生效」这回事。本机实测正是这种状态（见 5.3）。

### 5.2 逐步自查（三条只读命令）

```bat
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v ConsentPromptBehaviorAdmin
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v EnableLUA
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v PromptOnSecureDesktop
```

| `ConsentPromptBehaviorAdmin` | 含义 |
| --- | --- |
| `0x0` | **不提示直接提权**（静默提权；管理员直接提权、标准用户直接失败） |
| `0x1` | 在安全桌面上要求**凭据** |
| `0x2` | 在安全桌面上要求**同意** |
| `0x3` | 要求凭据 |
| `0x4` | 要求同意 |
| `0x5` | **默认**：仅对非 Windows 自带程序要求同意 |

- `EnableLUA = 0x0` ⇒ **UAC 整体关闭** ⇒ 同样不会弹确认（与上表叠加判断）。
- `PromptOnSecureDesktop` 只在「需要同意/凭据」时有意义（是否切到安全桌面）。

### 5.3 本机实测样例（2026-10-15，只读）

```
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System
    ConsentPromptBehaviorAdmin    REG_DWORD    0x0
    EnableLUA                     REG_DWORD    0x1
    PromptOnSecureDesktop         REG_DWORD    0x1
```

⇒ 结论：**UAC 没有被整体关闭**（`EnableLUA=1`），但策略是 `0` ⇒ **提权静默执行、不弹确认**
（同日实测 `Get-Process consent` 计数为 0）。**不要**把「没看到弹窗」当成「没有提权」。

### 5.4 那我们靠什么当闸门

既然 OS 层可能不拦，产品把闸门放在**应用内**（与 OS 行为解耦）：

1. **变更预览**：执行前列出将新增/删除的每一条规则（端口 + 作用域）。
2. **应用内确认**：未确认 ⇒ **零提权、零写入**（有断言守着）。
3. **一次性票据**：`planId` 绑定本次预览，错票/过期票/从未签发各有可区分的拒绝理由。
4. **写通道凭据**：`plan` / `apply` / `audit` 共用同一份 `writeToken`，没有就 401。
5. **审计留痕**：成功与失败各留一条，含**实际**后端与生效提权档。

### 5.5 降低风险的三条建议

- 平时把 `elevationPolicy` 留在 `none`：只读查看不需要任何提权。
- 需要改系统时临时切到 `ask`，改完切回 `none`（Agent 触发本来就会降级为 `ask`）。
- 定期看一眼 §4.4 的审计接口：`backend` / `policy` / `rolledBack` 三个字段能回答「刚才到底做了什么」。

## 6. FAQ

**Q：写操作全报 401？**
`writeToken` 没配置或被清除。到配置页点「生成并保存写通道凭据」；清除后 `plan` / `apply` / `audit`
一律 401（这是 fail-safe，不是故障）。

**Q：端口声明了但没生效？**
按顺序查：① 是否处于 NAT 模式（mirrored 下 eth0 语义变了，页面会置灰并给指引，**不会**自动改
`.wslconfig`）；② eth0 是否漂移（点「启动并核验」重新读）；③ 是否只保存了声明而没走 §4.3 的确认执行。

**Q：为什么 UDP 端口转发不了？**
`portproxy` 本身不支持 UDP，本插件**不用**其他机制代偿（见 §7）。

**Q：写控件是灰的？**
说明提权可用性探测为 false（后端不可用，例如 `gsudo` 未安装/被移动）。页面会写出原因；
把 `elevationBackend` 改为 `native` 可回落到 `Start-Process -Verb RunAs`。

**Q：确认了还是失败？**
看结果区四态与 §4.4 的审计行：`exit` 是退出码、`backend` 是实际后端、`rolledBack` 说明是否回滚
（回滚**只**撤本轮刚加的规则，绝不碰他人规则）。

**Q：Agent 会自己提权写我的系统吗？**
不会「静默自动写」：Agent 触发的策略一律降级为 `ask`，且仍需票据 + 凭据。
策略为 `none` 时：确认面板直接判定「不可能成功」⇒ 按钮置灰，即使绕过 UI 也会在执行层拿到
`disabled`，而 `disabled` 不算「尝试」⇒ **零提权调用、不写审计**。

## 7. 限制与已知边界

- **只支持 TCP**：`portproxy` 不支持 UDP/SCTP，本插件不做代偿。
- **硬前提 NAT**：非 NAT（mirrored）下不提供写操作，只给指引。
- **不改系统级配置**：`.wslconfig`、PATH、提权工具的配置一律不动。
- **不接管他人规则**：所有权由 `managedPorts` 声明界定，集合外只读。
- **不打守护/心跳**：eth0 漂移靠「激活 + 刷新各查一次」与**写入前强制现读**兜住，不常驻轮询。
- **Windows 自带 `sudo` 仅限 24H2+** 且默认模式拿不到输出 ⇒ 不作为默认后端（需显式配置）。
- **`distro` 解析**：自动发现优先，手填的值只作兜底，写错会得到可读的失败原因。

## 8. 相关文档

| 想了解 | 去哪看 |
| --- | --- |
| 只读事实层与五态判决的设计 | `specs/003-wsl-docker-ports/` |
| 提权写路径与安全验收（红线、闸门、审计） | `specs/005-elevation-write-path/` |
| 写入通道服务端（plan/apply/audit、票据、凭据） | `specs/008-write-transport/` |
| 写入口 UI（确认、结果四态、凭据按钮） | `specs/009-write-ui/` |
| 配置字段的宿主 schema（volatile 语义） | `src/config.ts` 文件头表格 |
