---
schema: stack-decision/v1
project: dsh-terminal-extension
kind: dsh-plugin
title: DSH 双组件扩展 —— 可配置终端（Agent 可读写）+ WSL Docker 管理器与端口转发可视化
status: decided
decidedAt: 2026-10-08
decidedBy: 主人（EDY）
lastUpdated: 2026-10-08

host:
  product: DeepSeek Harness
  baseline: "0.2.0-rc.2"
  pluginApi: cordis-4
  runtimeVerified: "由 app.asar (0.2.0-rc.2) 内的官方包文档与组合定义实测得出"
  baselineNote: 原提基线 0.2.0-rc.1；本机 dsh --version 与全部 @deepseek-ai/dsh-client-ui-* 实测均为 0.2.0-rc.2，rc.1 在本机不可验证，故抬到 rc.2。

meta:
  delivery: internal-first-then-open-source
  packageFormat: local-link-then-npm
  pendingReview: []   # 2026-10-08：6 项 backend.* 已由主人逐条确认为 none，复核闭环

stack:
  # ══ 后端侧 7 维（DSH 插件形态：宿主进程内 cordis 插件，无独立服务端）══
  backend.framework:
    choice: none
    confirmed: true
    rationale: 插件以 cordis-4 形式挂载进 DSH 宿主 generation，不自建 HTTP 框架与分层。
  backend.orm:
    choice: none
    confirmed: true
    rationale: 无关系型数据访问需求。
  backend.db:
    choice: none
    confirmed: true
    rationale: 用户表态「配置型数据走 yaml 保存到 cordis 即可」；不引入数据库。
  backend.migration:
    choice: none
    confirmed: true
    rationale: 无 schema 演进载体；配置结构变更靠 cordis 配置兼容与版本字段。
  backend.auth:
    choice: none
    confirmed: true
    rationale: 不做独立认证；浏览器↔Host 通道复用宿主已认证的 loopback 连接。
  backend.ai:
    choice: none
    confirmed: true
    rationale: 不自建 LLM 调用；Agent 侧能力通过 dsh-tools 注册工具表达。
  backend.test:
    choice: vitest
    confirmed: true
    alternatives: [node --test]
    rationale: 用户第 3 轮明确选择；TS 原生体验好，同机 dsh-office-tools 已用。

  # ══ 前端侧 4 维 ══
  frontend.framework:
    choice: react-18
    version: "18.x"
    confirmed: true
    alternatives: [vue-3]
    rationale: Step 1「技术底盘」用户明确选择 TypeScript + React 18 + esbuild；宿主 slot 契约渲染 React 节点，Vue 需额外适配层。
    packaging: peerDependencies "^18.2.0"，不打进 bundle
  frontend.ui:
    choice: 宿主 ui-primitives
    confirmed: true
    alternatives: [自研组件 + 宿主 CSS token, 两者混用]
    rationale: 用户第 2 轮明确选择；外观与键盘导航与官方一致。
  frontend.state:
    choice: 宿主 dsh-client-store
    confirmed: true
    alternatives: [组件内 React state + context, 自研外部 store]
    rationale: 用户第 2 轮明确选择；与宿主一致，连接更换时按契约清空。
  frontend.test:
    choice: vitest 单元 + chrome-devtools MCP 真机验收
    confirmed: true
    alternatives: [只做 vitest 单元测试, 只做真机端到端]
    rationale: 用户第 3 轮明确选择；插槽渲染与真实终端行为只能靠真机验。

  # ══ DSH 插件专属维度 ══
  plugin.terminalEngine:
    choice: ctx.subprocess.spawnTerminal 自建受管终端
    confirmed: true
    alternatives:
      - 复用官方 remote.terminal（cwd 锁死 Session 工作区、只能起 shell，核心需求落不了地）
      - 直连宿主私有 node-pty（require 私有依赖属越界，宿主升级即坏）
      - ctx.subprocess 普通 spawn 无 PTY（交互式命令与 TUI 全不可用）
    rationale: 用户第 1 轮明确选择 A。spawnTerminal(spec) 实测接受 argv + cwd + env + rows/cols/terminalType，是唯一同时满足「自定义文件夹 + 任意命令 + 参数」的公开路径。
    consequence: 标签布局、重连、滚动缓冲、主题适配均需自建。
    verified: ctx.subprocess 由 @deepseek-ai/dsh-subprocess-local 在标准组合中挂载（app.asar:366599）
  plugin.agentSurface:
choice: 完整工具族 managed_terminal_new / managed_terminal_list / managed_terminal_read / managed_terminal_write / managed_terminal_resize / managed_terminal_kill（**2026-10-09 起加 `managed_terminal_` 前缀**：原裸名与宿主内建 `read`/`write` **及官方 `dsh-tool-terminal` 的 `terminal_read`/`terminal_list`** 撞名）
    confirmed: true
    alternatives: [最小两个 read / write, 只提供 service 不注册模型工具]
    rationale: 用户第 1 轮明确选择完整族；覆盖「Agent 能在终端里读写」的完整生命周期。
    mechanism: dsh-tools 的 defineTool
  plugin.agentReadModel:
    choice: 屏幕快照 + 增量流 两者都给
    confirmed: true
    alternatives: [仅屏幕快照 + 有界 scrollback, 仅增量流]
    rationale: 用户第 1 轮明确选择两者都给。
    consequence: Host 侧必须持有屏幕模型 → 见 plugin.hostScreenModel
  plugin.agentPermission:
    choice: 受 ctx.sandboxPolicy + 工具审批约束
    confirmed: true
    alternatives:
      - 不接沙箱，与官方用户终端一致（存在 Agent 借终端绕过 read-only/workspace-write 的安全洞）
      - 按 profile 单独声明是否受限
    rationale: 用户第 1 轮明确选择受约束；官方 dsh-sandbox-policy 文档写明对 bash / 文件系统 / 终端统一施加同一份策略。
    verified: ctx.sandboxPolicy 与 ctx.sandbox 均在标准组合中挂载（app.asar:366608）
  plugin.configSchema:
    choice: "name + cwd + command + args + env"
    confirmed: true
    alternatives: [再加 shell 包装 / 启动超时 / 字体主题覆盖, 最小 cwd + command 字符串切词]
    rationale: 用户第 1 轮明确选择该字段集；正好覆盖「指定文件夹 + 命令 + 参数」，env 供 WSL2 场景使用。
    storage: cordis 配置（YAML）+ schemastery 校验
  plugin.hostScreenModel:
    choice: "@xterm/headless + serializer"
    confirmed: true
    alternatives: [自研有界文本缓冲, 不存屏幕靠重放增量]
    rationale: 用户第 2 轮明确选择；官方 terminal-controller 同款做法（headless xterm + serializer 产出 opening screen）。
  plugin.renderer:
    choice: "@xterm/xterm + @xterm/addon-fit"
    confirmed: true
    alternatives: [xterm.js + 额外插件, 自研渲染器]
    rationale: 用户第 2 轮明确选择；生产级、官方同款。**2026-10-09 订正留痕（一日内二次，末次为准）**：原记「以独立懒加载 chunk 打包」**正确** —— 同日曾据**另一个插件**（dsh-plugin-desktop）的 `codeSplitting: false` 一度改为「单产物 + 首屏不解析」，随即被**官方终端页实物推翻并撤回**：`dsh-client-ui-sidebar-terminal` 主 bundle **19,887 B** + `require.async("./client.terminal.js")` 取 **685,949 B** 的 chunk（xterm 内联其中，chunk 不在 exports 里）。证据见 client-contract.md §P2 与本文末变更记录。
  plugin.clientTransport:
    choice: 自建 ctx.webServer 命名路由 + WebSocket upgrade
    confirmed: true
    alternatives:
      - 官方 Typert Remote namespace（实测可行但代价高，见「B 方案可行性实测」）
      - 混合：控制面走 Remote / 数据面自建 WS
    rationale: 用户第 3 轮明确选择 A。官方 dsh-host-webserver 文档写明支持第三方插件注册具名路由与 upgrade 路由；同机 @xxxyz/dsh-mcp-manager 已实战跑通同型路径。
    constraint:
      - 路由前缀必须独占；认证与重连需自建
      - 匹配顺序（官方原文）：**exact 全表 → 最长 prefix → fallback**；**注册顺序无语义**（具名路由要求互不重叠，重叠即 throw）
      - 重复 (kind, path) 注册直接抛 `webserver: duplicate <kind> route "<path>"` → 必须 effect-scoped 登记 disposer，否则重挂载时第二次注册必炸
      - 🔴 **`registerUpgrade` 只接受 exact path**（原文 "Register an exact-path HTTP upgrade route. Duplicate paths throw because one socket can have only one protocol owner"）→ 「独占前缀的 upgrade 路由」**不成立**；多终端需复用**单一 exact 端点 + 协议层会话 id**
      - fallback 是**单一座位**（`registerFallback`，二次注册 throw）：官方 `dsh-host-frontend-static`（SPA dist）占着它，且只答**没有具名路由匹配**的请求 → SPA **不可能**抢走我们的具名路由
      - `host` 只接受两个字面量：`127.0.0.1`（默认 loopback）或 `0.0.0.0`
      - 只服务浏览器：Electron 走 `file://` + IPC 桥接，不经过 webServer → 桌面版终端页不在本 Spec 范围
      - 客户端 WS 地址应随文档 base 构造（官方 `<base href="./">` 冻结入口目录，支持 prefix-stripping 反代场景），不要硬写站点根绝对路径
    evidence: 官方 @deepseek-ai/dsh-host-webserver 与 @deepseek-ai/dsh-host-frontend-static 文档（app.asar 偏移 51668321 / 51451901 起）
  plugin.tabKind:
    choice: 新 kind（managedTerminal）+ 宿主默认 extension 档
    confirmed: true
    alternatives: [复用官方 terminal kind, 每个 profile 注册一个 kind]
    rationale: 用户第 3 轮明确选择；与官方 files / text / changes-review / scheduleTask / browser / terminal 全部区分，互不干扰。
  plugin.build:
    choice: esbuild → CJS client bundle
    confirmed: true
    rationale: Step 1「技术底盘」用户明确选择 esbuild；与同机 dsh-whale-pet / dsh-office-tools 一致，符合宿主 ModuleLoader 的 CJS bundle 契约。
  plugin.baselineCompat:
    choice: "0.2.0-rc.2"
    confirmed: true
    rationale: Step 1「版本基线」用户明确选择抬到 0.2.0-rc.2。
  layout.dirs:
    choice: "pnpm workspace: packages/{terminal-profiles, wsl-docker-ports, wsl-shared}"
    confirmed: true
    alternatives: [单包 src/ + lib/ + tests/ + docs/ + scripts/, 两个平级目录, 两个独立仓库]
    rationale: 用户 Step 3 明确选择「要 L3：双包」+「三包：两个插件包 + 一个非插件共享包」+「单仓库 pnpm workspace，packages/*」。**本文件上一版的单包布局已失效**，见变更记录。
    note: 各插件包内部沿用 src/ + lib/ + tests/ + locale/ + cordis.patch.yml 的 mcp-manager 同款结构；wsl-shared 不是插件、无 UI、不出现在插件栏。

  # ══ Step 3（探索轮）新增维度 ══
  plugin.packageSplit:
    choice: 三包 —— terminal-profiles + wsl-docker-ports + wsl-shared（非插件共享包）
    confirmed: true
    alternatives: [单包双行 + 惰性伴生行（mcp-manager 模式）, 两包各自复制薄逻辑, 两包 B 依赖 A]
    rationale: 用户 Step 3 明确选择 L3（生命周期隔离）。官方原话「需要在其他行关闭时仍保留页面的子插件，应作为独立的包发布」。双包 → 两张卡 / 两行 / 两页 / 两套启停，且完全不需要 mcp-manager 那套「惰性伴生行 + 子路径 exports + locale 补映射」技巧。
    rejected: 单包双行只满足 L1+L2 —— 两页都挂在包根行的浏览器半上，关掉包根行两页一起消失。
  plugin.crossPackageService:
    choice: 包 B 经 ctx.inject(['managedTerminal'], …) 可选消费包 A 服务
    confirmed: true
    rationale: 组件二的 exec 要复用组件一终端，但不能建包依赖边（会毁掉 L3）。可选注入 + 明确降级：A 不在则按钮置灰并写明原因，回调永不触发、不报错。
    appliesTo: 组件二「进容器 exec」（已推至下一期）
  plugin.configStore:
    choice: profile 层 cordis.patch.yml；**声明**用插件模块静态 `Config` 导出（Schemastery + `.volatile()`），**命名空间 = patch 条目 id**；**写**分两条互补路径 —— live 字段走 `ctx.settings.{update,replace,mutate}`（不重挂载），完整配置走 `ctx.configEditor.edit()`（重挂载）
    confirmed: true
    alternatives: [包内台账文件, 两个包共用一份配置文件的两个 section, 全放浏览器 localStorage]
    rationale: 用户 Step 3 明确选择「搁 profile 层级的 cordis.patch.yml 下」；**不自行手写 YAML**。官方专责包两个：`@deepseek-ai/dsh-config-editor`（完整配置，原子替换 + 保留 YAML 注释与 `!!js` + 失败回滚）与 `@deepseek-ai/dsh-settings`（**只做 live 字段**的表单）。**两者互补、不是管道** —— 详见 knownLimitations 第 3 条（2026-10-08 源码实证）。
    knownLimitations:
      - 层序（真机 profile 根注释原文）：`package.json` 的 `dsh.profile.bundles` 各 bundle 层 → 本 profile 的 `cordis.patch.yml` → 任一 `--patch` 覆盖层。**我们写入 profile 层 patch**，其上只有一次性 `--patch` 覆盖层
      - 2026-10-08 真机订正：**`~/.dsh/cordis.patch.yml` 在本机不存在**（`~/.dsh` 下无此文件；实际为 `~/.dsh/profiles/{web,desktop}/cordis.{yml,patch.yml}`）→ 原「home 层覆盖 → 表单写入被拒」在本机**不成立**（该条曾写成本机事实，已改）。若日后出现 home 层文件，须先确认它在合成顺序中的位置
      - **配置写入是两条路，不是一条管道（2026-10-08 源码定案）**：① **live 路径 = `settings` 服务** —— 命名空间 = patch **条目 id**（源码 `row.options.id === ns`），schema 由 `this.schema(entry)` 取得（= 插件模块**静态 `Config` 导出**），`volatileForm(schema)` 只把 volatile 子树展开成表单，写操作是 `settings.update` / `.replace` / `.mutate`（陈旧写入被拒）→ **不重挂载**；命名空间没有 live 字段时抛 `Plugin entry "<ns>" has no volatile fields`、条目不存在时抛 `No configurable plugin entry "<ns>"`。② **完整配置路径 = `ctx.configEditor.edit()`**（`@deepseek-ai/dsh-config-editor`）—— 官方原文：*"Use settings for forms restricted to live fields. Callers that edit complete configuration can use `ctx.configEditor.edit()`; **ordinary fields retain Loader's normal lifecycle**"* ⇒ **走它会重挂载、杀正在跑的终端**。③ 🔴 `ctx.settings.register(ns, schema, …)` **在 0.2.0-rc.2 已移除**（app.asar `settings.register` **0 命中**；同机插件 `dsh-whale-pet` 注释同口径：改用静态导出 + 条目 id 作命名空间）。④ **复核为正确、不必改**：`plugins.row.config` slot（键 `<包名>#<行 id>`，给该行一个 Configure 控件打开该行页面）与 `configure({ auto: false }, ctx.fiber)` 均在官方代码里有真实调用点；`settings.describe/update/replace/mutate`、`settings.writable` 均存在（`autoGenerate` 是 `describe()` 每个命名空间视图上的字段）
      - ✅ **落盘语义（2026-10-08 定案，见变更记录第 22 条）：`settings.documentPath` 即 profile 的 `cordis.patch.yml`** —— `settings.update` **立即落盘**（写入后 3s 进程仍在跑，文件内容已更新）且**跨重启保持** ⇒ 「编辑配置不杀终端」+「改完不丢」双闭环，**无需**另配落盘路径。⚠️ **同一文件既是 patch 层又是 settings 落盘处**：手写它会与 settings 写入互相覆盖（我因此误判过一次，见该条）
      - configEditor 确有拒绝路径（官方原文 *"Invalid values and higher-layer overrides leave the file unchanged"*）：症状是**文件不变（静默不写）**、**不是**抛错；`ctx.settings.writable` 由 settings provider 透传（**rc.2 是否恒为 `true` 待复核**，2026-10-08 只确认字段存在）→ 自绘配置页须**自行**对「被更高层覆盖」给出写明原因的只读态，不能指望宿主报错
      - profile patch 真实形状（真机 235 行样例）：顶层 YAML **数组**，元素为 ① `- id: <entry-id>` + `config:`（按 id 覆盖）② `- id: x` + `disabled: true|false` ③ `- insert:` + 嵌套子列表（**新增行**，`dsh-mcp-manager` 即此形，块首带 `# dsh-mcp-manager:server:<name>` 注释）
      - 配置存活开关是**清单字段**、不是 cordis 字段：`~/.dsh/profiles/<name>/package.json` 的 `dsh.profile.patchReload = "live"`（本机实测）—— 排查时别在 yml 里找
      - 安装先例（同机）：第三方插件经 profile `package.json` 的 `dependencies` 以 `link:<绝对路径>`（`@xxxyz/dsh-mcp-manager`）或 `github:<user>/<repo>`（`dsh-web-noopenbrowser`）引入，并列入 `dsh.profile.bundles` → 三包 `link:` 交付可照此落地
      - 完整配置覆盖会把普通字段的当前原始值钉在 profile 层，插件升级后的新默认值到不了用户
      - 只有唯一寻址、且属于 profile 根 Include 的条目可编辑
  plugin.configIsolation:
    choice: L3 —— 两个组件的数据、页面、生命周期三层全部隔离
    confirmed: true
    rationale: 用户 Step 3 明确选择 L3。
  plugin.profileConfigLiveness:
    choice: 整个 profiles 数组声明 .volatile()
    confirmed: true
    alternatives: [profiles 当普通字段接受重挂载, 终端会话与配置分属不同行]
    rationale: 用户 Step 3 明确选择。官方 Loader 的 equalExceptVolatile 对 volatile-only 变更**不重挂载**，改走 _commitVolatile + loader/volatile-update 事件；否则任何 ordinary 字段变更都会 remount，正在运行的终端会被杀掉。
    constraints:
      - volatile 只在固定对象路径生效 → 数组元素内的字段不是固定路径，必须整数组标 volatile
      - 混合变更（volatile + ordinary 同时改）退化为重挂载
      - ordinary 字段若 transform 每次 parse 造新实例，无变更也会重挂载
      - 🔴 配置 schema **必须用 Schemastery**：equalExceptVolatile 先做 isSchemastery()（检查 schema['~standard'].vendor === 'schemastery'），非 Schemastery（Zod / 自写校验器）直接退化为 deepEqual → volatile **静默失效**、每次保存都重挂载。禁止用 Zod 声明 plugin config。
      - 标在数组元素内（z.array(z.object({ cwd: z.string().volatile() }))）会被 schemastery 的 validateVolatileSchema 拦下报错（沿 dict 递归时 blocked 保持 false，沿 inner(*)/list(下标)/sKey 时置 true），**不是**静默降级
      - volatile-only 需同时满足五个条件：changes 恰为 ['config']、fiber 为 ACTIVE、context 原型未变、equalExceptVolatile 为真、_commitVolatile() 成功；任一不满足 → 普通更新（重挂载）
      - _commitVolatile() 解析失败（新配置非法）→ **安全回落**为普通更新（重挂载），不是继续沿用旧值
      - 同一个 schema 不能重复标 volatile（schemastery 抛 TypeError('volatile schema is already wrapped')）
      - volatile 字段的解析结果是「volatile 引用」（官方注释：a stable reference containing immutable data，output supports get()）→ 读 profiles 需走引用 API（.get() / cosmokit volatileEntries），不宜当裸数组下标取值 —— 形态待 T0.1 第 5 条确认
    evidence: 宿主源码实证（2026-10-08 直接检索 app.asar 归档字节流，偏移为上文字节位置）：equalExceptVolatile / equal 定义 @13918300–13918700；Loader.Entry.update 的 volatileOnly 判定 @13923513；schemastery Schema.prototype.volatile @68622896；validateVolatileSchema @68623200+；官方文档「Volatile configuration」@13889000+。**只读不推断**：机制结论全部来自上述源码，未执行任何推测性补充
    pending: 机制已由源码定案 —— 整数组标 volatile **可用**。剩余为真机行为链（证伪导向），见 002/tasks.md T0.1：① 改 profiles[0].cwd → 走 loader/volatile-update 且 PTY 存活 ② 对照组：改 name 等 ordinary 字段 → 必须真的 remount ③ 提交非法 config → 回落 remount 且不崩 ④ 标在数组元素上 → 录下抛错原文 ⑤ config.profiles 是裸数组还是带 .get() 的引用
  plugin.elevationPolicy:
    choice: 三值 none | ask | passby，默认 none
    confirmed: true
    rationale: 用户 Step 3 明确要求「配置，用户选 none/ask/passby」+ 默认 none。同时约束 Agent 触发提权与 Agent 对 docker 的写操作。
    constraint: 即使 passby，UAC 弹窗也无法被程序绕过；拒绝/超时须优雅失败，不留半成品规则。**Agent 触发的提权在 passby 下一律降级为 `ask`**（应用内确认 + 展示命令原文；**2026-10-08 A-1 定案 = 方案 A**）—— 若用户开启了 gsudo 凭据缓存、UAC 不再逐次弹出，则该应用内确认是**唯一**闸门（故要求「缓存活跃即回落 native」）。
    mechanism: 临时 .ps1（结构化参数）+ **后端链**：① **用户自装 `gsudo`**（stdio **直接回传** stdout/stderr/退出码，**提权失败 exit code = 999**；检测到其**凭据缓存活跃**则回落 ②）→ ② **`Start-Process -Verb RunAs`**（**永久回落**；输出经**临时文件**回传 —— 完整性级别不同，无法管道回读）→ ③ **Windows 自带 `sudo`**（**仅 Win11 24H2+**、须用户显式开启、**默认模式 `forceNewWindow` 拿不到输出**）**仅显式配置 `elevationBackend: winsudo` 时启用**。**不装工具 / 不改 PATH / 不动用户 gsudo 配置（尤其 `CacheMode`）、不执行 `sudo config`**。（2026-10-08 定案）
  plugin.natPrerequisite:
    choice: NAT 网络模式为硬前提；非 NAT 时 UI 可见但置灰 + 写明原因与修复步骤
    confirmed: true
    rationale: 用户 Step 3 更正「硬前提是 NAT」。NAT 下 WSL 有独立 eth0 IP，portproxy 才有意义；mirrored 下 eth0 语义改变、规则指向失效地址。
    rejected: mirrored 替代方案（用户明确否决，改为警告用户；用户不改则该功能不可用）
  plugin.portOwnership:
    choice: 声明式 —— config 里的 managedPorts 集合界定所有权
    confirmed: true
    alternatives: [外部台账文件记录本插件加过的规则, 两者结合]
    rationale: 用户 Step 3 明确选择。集合外的 portproxy 规则一律不碰，彻底避免原脚本 netsh interface portproxy reset 误伤他人规则；且无需额外状态存储。
  plugin.portScope:
    choice: 本机 + 局域网可切（逐端口 / 逐 profile）
    confirmed: true
    rationale: 用户 Step 3 明确选择「两者都有，要可切」。本机走 localhostForwarding 无需规则；局域网需 portproxy + 防火墙放行 + UAC。
    default: 建议默认 loopback，局域网开放为逐端口显式 opt-in（原脚本的 0.0.0.0 + 全量防火墙放行构成真实攻击面）
  plugin.dockerScope:
    choice: "本期 P0：只读展示 + 端口转发可视化 + eth0 IP 漂移检测 + UAC 提权 + 端口声明（区间 + presets，D-3 提到 P0）+ 目标发行版解析与切换（D-4 提到 P0）；P1：启停/重启容器 + 容器日志 + 完整配置页（scope / elevationPolicy）；下一期：exec / compose / 镜像管理"
    confirmed: true
    rationale: 用户 Step 3 六项全选但分期选「P0+P1 一次做完」；本文件按分期落边界，**未把后三项悄悄塞进一期**。
  plugin.wslCwd:
    choice: 两个字段 —— cwd（Windows 路径）+ cwdLinux（WSL 路径）
    confirmed: true
    alternatives: [显式 cwdStyle: host | wsl, 自动探测 command 是否为 wsl.exe]
    rationale: 用户 Step 3 明确选择两个字段。WSL profile 下 Windows 路径 E:\x 在 WSL 视角是 /mnt/e/x，宿主 cwd 与 Linux cwd 语义不同，两字段无歧义。
    note: 本机实测发行版名为 Ubuntu2204，用户示例里的 "Ubuntu" 不存在 → 发行版名应从 wsl -l -v 自动发现，不手打。

constraints:
  confirmed: true
  items:
    - id: windows-wsl2
      text: Windows + WSL2 双环境都要跑
    - id: offline-intranet
      text: 内网/离线可用（不依赖 npx、CDN）
  resolved:
    - id: npm-registry
      text: 内网有 npm registry / 私有镜像可用（用户第 2 轮确认）→ xterm 等依赖可正常安装并打进 bundle，部署侧无需联网
---

# 技术栈决策 · dsh-terminal-extension

> 由 `stack-decision` skill 主持产出。**每一维都必须由人明确拍板**，未确认项一律写 `TBD` / `confirmed: false`，skill 不代为选择。
> 状态：**全部维度已拍板并逐条确认** —— 34 维全部 `confirmed: true`（6 项 `backend.*` 于 2026-10-08 复核闭环）。

> 🔴 **2026-10-12 拆分留痕（纯文档搬家：零决策变更、零内容删除）**：本文件拆前 **615 行**，超「单文件 ≤ 400 行」（SHALL；口径 = `packages/wsl-shared/scripts/check-size.mjs` 的 `split('\n').length - (以 \n 结尾 ? 1 : 0)`）⇒ 按「**YAML frontmatter（34 维结论 + 硬前提 + 约束）/ 冻结栈表格（Step 1 + Step 2 三轮 + Step 3 决策表）/ 冲突自检（Step 4）/ 复核记录 / `## 变更记录` 留在主线；历史长记录搬家**」拆分。**frontmatter 一行未动**，`status: decided` 与全部维度键仍是本文件的 SSoT。
>
> 下表列出**已搬去** [`stack-decision-changelog.md`](./stack-decision-changelog.md) 的小节（标题为原文，一字未改；行数 = 拆分前在本文件中的行数）。正文里出现的「本文末变更记录 / 本文件末条变更记录 / 见变更记录 / 变更记录第 N 条 / 配置写入管道图 / 真机事实表 / 原脚本的 5 个坑 / B 方案可行性实测」一律按**本表 + changelog 内同名标题**定位。

| 已搬走的小节（原文标题，一字未改） | 拆分前行数 | 新位置 |
| --- | --- | --- |
| `## 讨论背景`（含 `### Step 1 · 背景锚定` 表） | 13 | [changelog](./stack-decision-changelog.md) 同名标题 |
| `## 目标、边界、不做什么` | 6 | [changelog](./stack-decision-changelog.md) 同名标题 |
| `## 维度清单适配（与 skill 默认清单的差异）` | 8 | [changelog](./stack-decision-changelog.md) 同名标题 |
| `## 关键前置事实（侦察证据，非决策）` | 21 | [changelog](./stack-decision-changelog.md) 同名标题 |
| `## B 方案可行性实测报告（用户指派验证，2026-10-08）` | 22 | [changelog](./stack-decision-changelog.md) 同名标题 |
| `### Step 3（探索轮）：需求演进为双组件 + 配置写入管道` 的**叙事段** —— 含 `**真机事实（本机实测，2026-10-08）**` 表 · `**原脚本的 5 个坑（本文件据此定下组件二的设计约束）**` · `**配置写入管道（本轮最关键的侦察结论）**` 图 · `**关键证据位置**` 表 | 87 | [changelog](./stack-decision-changelog.md) 同名标题 |
| `## 下一步` | 7 | [changelog](./stack-decision-changelog.md) 同名标题 |
| `## 移交 bootstrap-ai-first-sdd（本轮未产出 Spec）`（含 `### 三 Spec 拆分方案（已拍板，待 bootstrap 落地）` / `### 建 Spec 时的既定前提（不要再问一遍）` / `### 阻塞项（进实现前必须打掉）`） | 49 | [changelog](./stack-decision-changelog.md) 同名标题 |
| `## 变更记录` 的历史条目 #1–#45（完整 48 条在 changelog，那里每行带显式 `#` 序号列） | 45 | [changelog](./stack-decision-changelog.md)「变更记录（完整历史 #1–#48）」 ⚠️ **2026-10-12 订正（原文保留）**：本格的「**完整 48 条**」与「**#1–#48**」是**归档当时**的范围；changelog 现为 **完整 50 条 = #1–#50**（#49 = 2026-10-12 宿主运行时版本取数口径、#50 = 2026-10-12 客户端契约 §P2 尺寸口径 + 64 KiB 上限）⇒ 引用请写 **#1–#50**。本行 **#1–#45 仍准确** ✓（= 本文件正文 `## 变更记录` 里保留的历史条目，共 45 行，一条未移）。原括注标题写法见本文件 L369 的订正痕。 |

## 已确认决策

### Step 1

- **`plugin.baselineCompat`**：`0.2.0-rc.2`。alternatives：`0.2.0-rc.1`（本机不可验证）、宽兼容矩阵（需能力探测+回退）。影响：验收按真机写，放弃 rc.1 用户。
- **技术底盘**：TypeScript + React 18 + esbuild。alternatives：JS(ESM)+React、Vite（偏离 ModuleLoader CJS 契约）。影响：`react` 走 peerDependencies，不打进 bundle。
- **交付形态**：先内部自用（本地 `link:`），稳定后开源。影响：目录与元数据预留发布位，首期不承担多版本兼容矩阵与发布回滚成本。

### Step 2 · 第 1 轮：终端内核与 Agent 面

| 维度 | 决策 | 关键取舍 |
|---|---|---|
| `plugin.terminalEngine` | `ctx.subprocess.spawnTerminal` 自建受管终端 | 唯一能同时满足「自定义 cwd + 任意命令 + 参数」的公开路径；代价是标签布局/重连/滚动缓冲/主题全部自建 |
| `plugin.agentSurface` | 完整族 `managed_terminal_new`/`managed_terminal_list`/`managed_terminal_read`/`managed_terminal_write`/`managed_terminal_resize`/`managed_terminal_kill` | 覆盖完整生命周期；工具面较大 |
| `plugin.agentReadModel` | 屏幕快照 **+** 增量流 | 最灵活；派生 Host 侧屏幕模型需求 |
| `plugin.agentPermission` | 受 `ctx.sandboxPolicy` + 工具审批约束 | 避免 Agent 借终端绕过 `read-only`/`workspace-write` 的安全洞 |
| `plugin.configSchema` | `name` + `cwd` + `command` + `args` + `env` | 正好覆盖诉求；`env` 供 WSL2 |

### Step 2 · 第 2 轮：通道、屏幕模型、渲染与 UI

| 维度 | 决策 | 关键取舍 |
|---|---|---|
| `plugin.hostScreenModel` | `@xterm/headless` + serializer | 官方同款，TUI 重绘快照正确；多一个 Host 依赖 |
| `plugin.renderer` | `@xterm/xterm` + `@xterm/addon-fit` | 生产级；**独立懒加载 chunk**（官方终端页实证：主 bundle **19,887 B** + `require.async("./client.terminal.js")` 取 **685,949 B** 的 chunk，xterm **内联在 chunk 里**）—— 2026-10-09 同日**先误订正、后撤回**，见 `client-contract.md` §P2 与本文末变更记录 |
| `frontend.ui` | 宿主 `ui-primitives` | 外观与键盘导航一致；绑定宿主内部包 |
| `frontend.state` | 宿主 `dsh-client-store` | 与宿主一致；需遵循其用法 |

### Step 2 · 第 3 轮：通道定稿与收尾

| 维度 | 决策 | 关键取舍 |
|---|---|---|
| `plugin.clientTransport` | 自建 `ctx.webServer` 命名路由 + WebSocket upgrade | 官方支持第三方注册；认证与重连自建；Electron 路径待验 |
| `plugin.tabKind` | 新 kind `managedTerminal` + extension 档 | 与官方 6 个页类型全部区分 |
| `backend.test` | vitest | TS 原生体验好 |
| `frontend.test` | vitest 单元 + chrome-devtools MCP 真机验收 | 插槽渲染与真实终端行为只能真机验 |
| `layout.dirs` | ~~`src/` + `lib/` + `tests/` + `docs/` + `scripts/`~~ → **pnpm workspace 三包**（Step 3 变更，权威值见上方 `layout.dirs`） | 与同机三个插件一致；**原单包方案已失效**，勿按本行实现 |

### Step 3 · 决策表

| 维度 | 决策 | 关键取舍 |
|---|---|---|
| `plugin.packageSplit` | 三包 workspace（2 插件包 + 1 非插件共享包） | 官方建议路径，天然 L3，免掉惰性伴生行技巧 |
| `plugin.crossPackageService` | 包 B 可选注入包 A 服务 + 降级置灰 | 保住 L3（不建包依赖边） |
| `plugin.configStore` | profile 层 `cordis.patch.yml`；**静态 `Config` 导出** + **条目 id 作命名空间**；live 字段走 settings 三写操作 / 完整配置走 `configEditor.edit()` | 两服务**互补非管道**；`settings.register` 已移除；已知限制须记入 Spec |
| `plugin.configIsolation` | L3 三层隔离 | 用户明确要求 |
| `plugin.profileConfigLiveness` | 整个 `profiles` 数组 `.volatile()` | 换取「编辑配置不杀终端」；须先做最小验证 |
| `plugin.elevationPolicy` | `none` / `ask` / `passby`，默认 `none`；后端链 **`gsudo` → `Start-Process` 回落**（Windows `sudo` 仅显式配置）；**Agent 触发一律降级为 `ask`** | UAC 不可绕过；失败须优雅；不装工具 / 不改用户配置 |
| `plugin.natPrerequisite` | NAT 硬前提；非 NAT → 置灰 + 修复指引 | 用户更正；mirrored 方案被否决 |
| `plugin.portOwnership` | 声明式 `managedPorts` 界定所有权 | 免台账文件，免误伤他人规则 |
| `plugin.portScope` | 本机 / 局域网可切，默认 loopback | 原脚本 0.0.0.0 + 全量放行是攻击面 |
| `plugin.dockerScope` | P0 只读+转发+IP漂移+UAC+**端口声明**+**目标发行版（D-4）**；P1 启停+日志+完整配置页（scope / elevationPolicy）；exec/compose/镜像下一期 | 六项全选但分期只到 P1，边界已落；**2026-10-08 D-3**：端口声明（区间 + presets）提到 P0 —— 否则 P0 进不了五态；**2026-10-08 D-4**：`distro` 提到 P0 —— P0 的 eth0 对比与 `docker ps` 执行都必须知道目标发行版，且「默认解析不追问」本身是主路径行为 |
| `plugin.wslCwd` | `cwd` + `cwdLinux` 双字段 | 两套路径语义无歧义 |

## 冲突自检（Step 4）

> skill 默认要求对照 `capabilities/*/manifest.json` 的 `requires` / `conflicts` 矩阵；本机不存在该目录（属 `bootstrap-ai-first-sdd` 体系），故替换为 **DSH 宿主专属检查项**，在此明示。

| 检查项 | 结论 |
|---|---|
| 单一 subprocess provider（Cordis「一个上下文一个服务」） | ✅ 本插件只**消费** `ctx.subprocess`，不注册 provider，无冲突 |
| 右栏页类型 kind 冲突 | ✅ `managedTerminal` 与官方 `files`/`text`/`changes-review`/`scheduleTask`/`browser`/`terminal` 均不同 |
| React 版本冲突 | ✅ 声明 `peerDependencies: react ^18.2.0`，不打进 bundle |
| 与官方终端的重复度 | ✅ 定位互补（Agent 可读写 + 自定义 profile），非重复实现 |
| 沙箱一致性 | ✅ 已决策接入 `ctx.sandboxPolicy`，与 bash / fs 同策略；两者均在标准组合中 |
| ✅ 路由前缀独占（B-3 已定案） | 官方占用 `/api` 桥接、插件 bundle、HMR 事件流、SPA dist fallback；官方匹配顺序 **exact → 最长 prefix → fallback**、注册顺序无语义、fallback 单座位且**只答「无具名路由匹配」的请求** → 本插件用独占前缀 `/dsh-managed-terminal/` 即互不干扰，**抢不到、也不会被抢**；真正的失败模式是 `(kind, path)` 重叠 → **注册直接抛错**。⚠️ upgrade 侧只能 **exact path**（详见 `plugin.clientTransport`）|
| ⚠️ 两份 xterm 实例共存 | 官方 `ui-sidebar-terminal` 自带懒加载 xterm chunk，本插件另行 bundle 一份 → 体积翻倍 + `xterm.css` 全局样式污染风险。缓解：只在自有容器作用域内加载样式，不注入全局 CSS |
| ⚠️ 配置校验容错 | 配置来自 cordis config + schemastery；**schema 校验失败不得弄坏整个 profile 启动** → 必须有默认值与容错 |
| ✅ Electron 路径（已定案） | 官方 `dsh-host-webserver` 原文「It serves browsers only; Electron loads dist over `file://` and carries fetch over an IPC bridge」→ 本决策仅覆盖 Web GUI，桌面版**结构性**不在范围（不再是待验项）|
| ✅ 离线可行性 | 内网有 npm registry / 私有镜像；xterm 等依赖安装后打进 bundle，部署侧无需联网 |
| ⚠️ 配置写入与 HMR 交互 | 保存配置 → 写 profile patch → `patchReload: live` 触发串行重载。**volatile-only 变更不重挂载**；任何 ordinary 字段变更会 remount → 组件一正在运行的终端会被杀。→ 已决策 `profiles` 整数组 volatile |
| ⚠️ volatile 固定路径约束 | volatile 只在**固定对象路径**生效；数组元素内的字段不是固定路径 → 必须整数组标 volatile，不能只标元素里的字段 |
| ⚠️ ordinary 字段的隐性重挂载 | 官方实现文档明载：ordinary 字段若 transform 每次 parse 造新实例，**无变更也会 remount**。设计时须避免此类 transform |
| ~~⚠️ home patch 抢占写入权~~ → ✅ **本机不适用** | 2026-10-08 真机枚举：`~/.dsh/cordis.patch.yml` **不存在**（只有 `profiles/{web,desktop}/cordis.{yml,patch.yml}`），且 profile 根注释给出的层序为 bundle 层 → `cordis.patch.yml` → `--patch` 覆盖层，**无 home 层** → 本机无此风险。⚠️ 但 configEditor 的拒绝路径**真实存在**（官方原文 *"Invalid values and higher-layer overrides leave the file unchanged"*）：症状是**静默不写**、宿主不报错，且 `ctx.settings.writable` 恒为 `true` → 若日后出现更高层，UI 必须**自绘**只读原因 |
| ⚠️ 完整覆盖钉死默认值 | configEditor 的完整覆盖会把普通字段原始值钉在 profile 层，插件升级的新默认值到不了用户 → 优先用 volatile + settings，而非整体覆盖 |
| ⚠️ 跨包服务依赖 | 组件二 exec 消费组件一服务必须走**可选注入 + 降级**，不能建包依赖边，否则破坏 L3 |
| ⚠️ UAC 不可绕过 | 即使策略 `passby`，UAC 弹窗仍需用户点击；拒绝/超时须优雅失败，不留半成品 netsh / 防火墙规则 |
| ⚠️ portproxy 不支持 UDP | 作用域限于 TCP；容器 UDP 端口映射须在 UI 明示不支持 |
| ✅ 双包天然满足唯一寻址 | 两包各 1 行、行 id 唯一 → 满足 configEditor「只有唯一寻址条目可编辑」的限制 |

## 复核记录（已闭环）

以下 6 维原先按 `none` 记录并标记 `confirmed: implied` —— 依据是用户「配置型数据走 yaml 保存到 cordis 即可」的表态，**用户当时并未逐条点击确认**：

`backend.framework` / `backend.orm` / `backend.db` / `backend.migration` / `backend.auth` / `backend.ai`

**2026-10-08 复核结论：6 项全部确认为 `none`**（已改为 `confirmed: true`）。主人明确接受的代价有两条：

- **`backend.db = none`** → 插件**不持久化任何自己的状态**，因此不建「本插件加过哪些规则」的台账。组件② 的端口所有权**必须**是声明式的 `managedPorts`（集合由用户手工维护）；由此，任何形式的「清空重写」（`portproxy reset` 之类）被列为红线。
- **`backend.migration = none`** → 配置字段**改名 / 挪位属破坏性变更**，靠 cordis 配置兼容 + 版本字段 + 文档拦截，不写迁移脚本。

## 变更记录

> 🔴 **拆分留痕（2026-10-12）**：本节的**完整历史（条目 #1–#48（⚠️ **2026-10-12 订正**：本行两处「**#1–#48**」是归档当时的范围，该编号范围**随 changelog 增长而更新** —— 现为 **#1–#50**），带显式 `#` 序号列）**已归档到 [`stack-decision-changelog.md`](./stack-decision-changelog.md) 的「## 变更记录（完整历史 #1–#48）」。**规则不变 —— 改技术栈 = 改本文件并在本节追加一条记录**（新条目按原表格形状追加；更早的条目按归档节奏移入 changelog，序号连续、不重排）。 ⚠️ **2026-10-12 订正（原文保留，使引用可追）**：本行引用的标题写法「`## 变更记录（完整历史 #1–#48）`」在 [`stack-decision-changelog.md`](./stack-decision-changelog.md) 里**没有逐字对应** —— 该文件的**真实标题就是 `## 变更记录`**（L220，**无**括号后缀）⇒ 定位请按真实标题；括号内的编号范围是本行的旧标注，**现为 `#1–#50`**（真实表 = 该标题下 L224 起的 `| # | 日期 | 变更 | 说明 |` 表，末行 **#50**）。
> 正文里的「本文末变更记录」「本文件末条变更记录」「见变更记录」「变更记录第 N 条」**一律指 changelog 的完整历史表**（`#N` = 该表行序，表头不计）。

| 日期 | 变更 | 说明 |
|---|---|---|
| 2026-10-09 | 提权 | 🔴 **订正（真机）**：`ConsentPromptBehaviorAdmin=0` ⇒ 本机提权**不弹 UAC**（旧记「每次弹 UAC」系我按 gsudo 缓存语义外推，作废）；实测生产链**静默回落 native**（`backend.ts:68` 正则不匹配 gsudo v2.6.1 的 `Available for this process:` 行）；`elevationAvailable` 为 `plugin.ts:251` 硬编码兜底。REQ-4.1「UAC 是人类闸门」在本机不成立 ⇒ 待主人重审（显式确认 / 审计留痕 / 文案告知） |
| 2026-10-09 | 提权 | ✅ **gsudo stdio 回传通道真机成立**（注入 `probeBackend` 跳过坏探测后）：写 2058ms / 删 1828ms 均 `status:ok exitCode:0 backend:"gsudo"`、stdout JSON 完整、`stderr:""`；两轮真写真删后 `netsh` 逐字节复原（19 条，sha256 `B9D38664…D1056D`） |
| 2026-10-09 | 提权 | 🆕 **主人拍板（A+B）**：闸门收回产品内且与 OS 行为解耦 —— A 写入前显式确认 + 变更预览（强制）、B 审计留痕（强制）、C 文案告知（附带）。背景：真机 `ConsentPromptBehaviorAdmin=0` ⇒ UAC 不弹窗，「UAC=人类闸门」不成立。落点：005 REQ-4.1–4.3 + Phase 2b（T2b.1–T2b.3），验收需等写入传输接线 |
| 2026-10-12 | 宿主运行时版本口径 | 🆕 **口径钉死（只钉取数口径，34 维取值一个未动）**：唯一合法口径 = **实际被加载到的 `@deepseek-ai/dsh-app-boot/package.json` 的 `version`**（宿主 `getDshRuntimeVersion()` 逐字如此，本机实测 = `0.2.0-rc.2`）；真机旧读法「宿主运行时目录 = `0.1.5-rc.2`」**作废**（该目录不在 CLI 解析路径上，`resolveBundleDir` 是 installation-first 契约）；**禁止**用目录名 / junction Target / `Test-Path` 判版本（悬空 junction 的 `Test-Path` 仍为 `True` ⇒ 假阳性，须 `fs.statSync` / `Get-ChildItem` 才报 `ENOENT`）⇒ 完整条目（含口径纪律、`0.1.5-rc.2` 两处真身、桌面旁证、**4 条未验项**、577 条悬空 junction 遗留）见 [`stack-decision-changelog.md`](./stack-decision-changelog.md) 变更记录 **#49** |
| 2026-10-12 | 客户端契约 §P2 尺寸口径 | 🆕 **口径变更（34 维取值一个未动）**：保留实质判据（主 bundle 不含 xterm 实现 / 不含内联 React），把 `mainBytes * 10 < chunkBytes`（标签误写「两个数量级」，代码实为 **10×**，实测**恒定红**）换成 **`mainBytes <= 65,536 B`（64 KiB 明确上限）**；「chunk 显著大于主 bundle」降为**软提示**（不参与 `ok` / `failures`）。实测主 **53,014 B** / chunk **447,255 B**（1 : 8.44）⇒ 余 **12,522 B**；**超限即须拆分**（配置页族 → 懒加载 chunk），构成推导与重定条件见 [`stack-decision-changelog.md`](./stack-decision-changelog.md) 变更记录 **#50** 与 [`client-contract.md`](./client-contract.md) §P2 的追加变更记录 |
