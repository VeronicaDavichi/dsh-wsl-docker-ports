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
    choice: 完整工具族 new / list / read / write / resize / kill
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
    rationale: 用户第 2 轮明确选择；生产级、官方同款。以独立懒加载 chunk 打包，避免拖大启动 bundle。
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

## 讨论背景

### Step 1 · 背景锚定

| 问题 | 用户表态 |
|---|---|
| 项目性质 | DSH 右栏终端扩展插件；**先内部自用（本地 link），稳定后开源发布** |
| 技术水平/主力语言 | **TypeScript + React 18 + esbuild** |
| 已知硬约束 | **Windows + WSL2 双环境都要跑**；**内网/离线可用（不依赖 npx、CDN）** |
| 功能边界 | ① **Agent 能在终端里读写**；② **可配置启动** —— 指定在哪个文件夹下、用什么命令启动，启动时可附带参数 |
| 数据/持久化 | 无数据库；**配置型数据走 yaml 保存到 cordis 即可** |
| 目标版本基线 | 抬到 **0.2.0-rc.2**（放弃 rc.1 真机验证） |

## 目标、边界、不做什么

- **目标**：产出一份可执行的 `stack-decision.md`；每个维度由用户明确表态后增量写入。
- **边界**：本 skill 只产决策文件，**不写业务代码、不调用任何安装脚本、不改动 profile**。
- **不做什么**：不改动 DSH 官方包；讨论阶段不安装任何东西进 profile。

## 维度清单适配（与 skill 默认清单的差异）

skill 默认清单面向「前后端分离 + 数据库」工程。本项目是 **DSH 宿主内插件**，因此做两处适配并在此明示，避免偷偷改变量：

1. **后端 7 维**：`framework / orm / db / migration / auth / ai` 判为 `none`，`backend.test` 保留为真实维度。
2. **「布局侧 3 维」替换为「DSH 插件专属维度」**：`plugin.terminalEngine` / `plugin.agentSurface` / `plugin.agentReadModel` / `plugin.agentPermission` / `plugin.configSchema` / `plugin.hostScreenModel` / `plugin.renderer` / `plugin.clientTransport` / `plugin.tabKind` / `plugin.build` / `plugin.baselineCompat`；原 `backendDir / frontendDir / harnessDir` 不适用，改为 `layout.dirs`。
3. **Step 3 探索轮再增 11 维**（需求演进为双组件后）：`plugin.packageSplit` / `plugin.crossPackageService` / `plugin.configStore` / `plugin.configIsolation` / `plugin.profileConfigLiveness` / `plugin.elevationPolicy` / `plugin.natPrerequisite` / `plugin.portOwnership` / `plugin.portScope` / `plugin.dockerScope` / `plugin.wslCwd`。

## 关键前置事实（侦察证据，非决策）

来自本机 `D:\Programs\DeepSeek Harness\resources\app.asar`（0.2.0-rc.2）内的官方包文档与组合定义：

| 事实 | 证据位置 |
|---|---|
| 右栏带键座位 `sidebar.right.pane.tab`（正文）+ `sidebar.right.pane.tab.title`（chip） | `app.asar:737725`、`app.asar:737775` |
| 服务 `ctx.sidebarRightTabs`（注册页类型拿 id）与 `ctx.sidebarRight`（`openTab` / `openResource` / `mounted`） | `app.asar:668610`、`app.asar:464019` |
| 官方已占用的右栏页类型 | `files`、`text`、`changes-review`、`scheduleTask`、`browser`、`terminal` |
| 官方右栏终端 `dsh-client-ui-sidebar-terminal@0.2.0-rc.2` 已存在 | `app.asar:678229`、`app.asar:292057` |
| 官方 terminal-controller 明确「Terminal output stays outside the Agent transcript」 | `dsh-api-terminal-controller` README · Summary |
| 官方终端只能选 shell，**初始目录固定为 Session 工作区** | 同上 · Use this package |
| `ctx.subprocess.spawnTerminal(spec)` 为真 PTY，接受 `argv` + `cwd` + `env` + `rows/cols/terminalType` | `app.asar:1021862`（spec）、`app.asar:1003098`（实现） |
| `@deepseek-ai/dsh-subprocess-local` 在标准组合中挂载 | `app.asar:366599` |
| `ctx.sandboxPolicy` / `ctx.sandbox` / `dsh-fs-sandbox` 在标准组合中挂载 | `app.asar:366608`、`app.asar:366897` |
| Agent 工具用 `defineTool` 声明，经 `dsh-tools` 校验/策略/呈现 | `dsh-tools` README |
| 宿主 slot 渲染 React 节点 | `app.asar:737771` |
| `dsh-host-webserver` 允许其他插件注册具名路由与 upgrade 路由；匹配顺序 精确 → 最长前缀 → fallback | `dsh-host-webserver` README · Summary |

**差异化结论**：官方终端的两个空白正好是本项目的核心诉求 ——（a）输出不进 Agent transcript；（b）cwd 锁死 Session 工作区、只能起 shell。本项目定位为 **「profile 驱动的受管终端 + Agent 可读写」**，与官方 `ui-sidebar-terminal` 互补而非重复。

## B 方案可行性实测报告（用户指派验证，2026-10-08）

用户要求「验一下 Typert Remote namespace 能不能做」。验证在临时目录完成，**未安装任何东西进项目或 profile**。

| 检查项 | 实测结果 |
|---|---|
| 生成器是否公开可用 | ✅ npm 公开包 `@deepseek-ai/dsh-typert-generator`（`access: public`）。⚠️ **版本陷阱**：`latest` 标签为 `0.0.1-rc.1`，必须精确钉 `0.2.0-rc.2` |
| 有无 CLI | ❌ 无 `bin`。`.` 为分析器+发射器，`./tsdown` 为 tsdown 插件 `typertPlugin()` —— 只能作为库/构建插件调用 |
| Host 侧能否发现第三方产物 | ✅ `dsh-typert-loader` 已在标准组合中挂载（`app.asar:366425` 附近）。包导出 `./typert` → `lib/typert.host.js` 即被扫描注册；无该导出的包被静默跳过 |
| Client 侧挂载面 | ✅ `TypertClientRemote` 只公开 `$mount()` 与 `$on()`；`$mount` 接受「生成的 Host-for-Client 贡献项」，为发起调用的 fiber 安装方法 |
| ⚠️ 工程结构要求 | 需要 DSH 单体仓库式布局：`tsconfig.host.json` / `tsconfig.client.json` 双 face 聚合，靠 project references 判定 face 归属。`check` 模式对「缺少公开注解 / 跨包私有引用 / 无法无损保留的声明合并」直接构建失败 |
| ⚠️ 与已定 esbuild 冲突 | 官方路径为 tsdown 插件；要保留 esbuild 需自行调用 `WorkspaceAnalyzer` + `FaceModelEmitter` |
| ⚠️ 产物约束 | 发射物含 Zod schema factory（zod 成为运行时依赖）；Zod 发射仅支持 deliberate subset，泛型 schema 声明与条件/映射类型根会失败 |
| ⚠️ 生效方式 | 新增 `./typert` 导出后**必须重启进程**（判定结果按包名缓存且永不过期） |
| ❌ 第三方先例 | 本机 3 个成型插件无一使用；官方消费方全部位于 DSH monorepo 内，遇阻只能自行读源码 |

**结论**：B **技术上可行**，但不是白拿 —— 代价为改造为双 face TS 工程 + 换构建工具 + 受 Zod 子集限制 + 重启生效 + 无先例。

**用户裁定**：选择 **A（自建 webServer 路由 + WebSocket upgrade）**。

**残留未验证项**：`dsh-host-webserver` 文档写明它只服务浏览器，Electron 下 dist 走 `file://`、fetch 经 IPC 桥接 —— 本决策面向 Web GUI；若日后要支持 DSH Desktop，需单独验证这条路径。

## 已确认决策

### Step 1

- **`plugin.baselineCompat`**：`0.2.0-rc.2`。alternatives：`0.2.0-rc.1`（本机不可验证）、宽兼容矩阵（需能力探测+回退）。影响：验收按真机写，放弃 rc.1 用户。
- **技术底盘**：TypeScript + React 18 + esbuild。alternatives：JS(ESM)+React、Vite（偏离 ModuleLoader CJS 契约）。影响：`react` 走 peerDependencies，不打进 bundle。
- **交付形态**：先内部自用（本地 `link:`），稳定后开源。影响：目录与元数据预留发布位，首期不承担多版本兼容矩阵与发布回滚成本。

### Step 2 · 第 1 轮：终端内核与 Agent 面

| 维度 | 决策 | 关键取舍 |
|---|---|---|
| `plugin.terminalEngine` | `ctx.subprocess.spawnTerminal` 自建受管终端 | 唯一能同时满足「自定义 cwd + 任意命令 + 参数」的公开路径；代价是标签布局/重连/滚动缓冲/主题全部自建 |
| `plugin.agentSurface` | 完整族 `new/list/read/write/resize/kill` | 覆盖完整生命周期；工具面较大 |
| `plugin.agentReadModel` | 屏幕快照 **+** 增量流 | 最灵活；派生 Host 侧屏幕模型需求 |
| `plugin.agentPermission` | 受 `ctx.sandboxPolicy` + 工具审批约束 | 避免 Agent 借终端绕过 `read-only`/`workspace-write` 的安全洞 |
| `plugin.configSchema` | `name` + `cwd` + `command` + `args` + `env` | 正好覆盖诉求；`env` 供 WSL2 |

### Step 2 · 第 2 轮：通道、屏幕模型、渲染与 UI

| 维度 | 决策 | 关键取舍 |
|---|---|---|
| `plugin.hostScreenModel` | `@xterm/headless` + serializer | 官方同款，TUI 重绘快照正确；多一个 Host 依赖 |
| `plugin.renderer` | `@xterm/xterm` + `@xterm/addon-fit` | 生产级；以独立懒加载 chunk 打包 |
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

### Step 3（探索轮）：需求演进为双组件 + 配置写入管道

需求从「一个终端插件」演进为**两个子组件**，且明确要求「插件栏里各自的配置不要互相干扰」。

```
  组件①  terminal-profiles        组件②  wsl-docker-ports
  ─────────────────────────       ──────────────────────────────────
  自定义命令启动终端               维护 WSL 下的 docker 管理器
  · D:\...\pwsh.exe               并把 docker 暴露的端口按 netsh portproxy
  · C:\...\wsl.exe                  逻辑转发到 Windows
  · C:\...\wsl.exe -d Ubuntu2204  且「这种转发要可视化维护」
  Agent 可在其中读写
```

**真机事实（本机实测，2026-10-08）**

| 项 | 实测值 | 影响 |
|---|---|---|
| Windows | 11 23H2（10.0.22631.5335） | 支持 mirrored，但用户已裁定 NAT 为硬前提 |
| WSL | 2.7.3.0 | — |
| 发行版名 | **`Ubuntu2204`** | 用户示例中的 `-d Ubuntu` **在本机不存在** → 发行版名必须自动发现 |
| `.wslconfig` | 仅 `[wsl2] localhostForwarding=true` | NAT 模式（缺省），符合硬前提 ✅ |
| WSL 内 docker | `/usr/bin/docker`，server **29.5.3** | 引擎装在 WSL 内，非 Docker Desktop |
| WSL eth0 IP | `172.20.201.152` | 与现有 19 条 portproxy 规则的 connectaddress 完全一致（2026-10-08 实测**尚未漂移**）；**同日两次重建实测后仍为同一地址** |
| Windows 侧 WSL 网关 | `172.20.192.1/20`（`vEthernet (WSL (Hyper-V firewall))`，`SuffixOrigin=Manual`）| WSL 侧 eth0 属**同一 /20**（brd `172.20.207.255`）。⚠️ **不可用作存活信号**：它是 **Windows 自己的地址** ⇒ ping 由本机 IP 栈自答，实测**连 `wsl --shutdown` 全停后 1.7s 仍然通**（四次采样全通），且该网卡在全停时**依旧存在** |
| WSL 实例重建信号 | `vmmemWSL` 的 CIM `CreationDate`（**真名无 `.exe`**）| 实测其 `CreationDate` == 发行版内 `btime`（20:45:15 == 20:45:15）⇒ 等价于「VM 启动时间」。取法**必须** `Get-CimInstance Win32_Process -Filter "Name='vmmemWSL'"`（写成 `'vmmemWSL.exe'` → **0 命中**，我踩过）；`Get-Process` 的 `.StartTime` 对它有权限限制（**读不到**）。粒度 = **整台 VM**，**看不到单发行版重启** → 后者要用发行版内 `/proc/1` 启动时间 |
| `wsl` 调用成本 | 热 **~200ms**；冷启动 **11–12s** | 实测 `wsl -d X -- true` = 229 / 202 / 212 ms；`--terminate` 后再进 = **11,121 ms**、`--shutdown` 后再进 = **12,494 ms**。⇒ **自动探测必须门控**：每次调用都会阻止发行版空闲回收，而 `vmmemWSL` 实测占 **2,180 MB**（心跳的隐性代价远大于漂移检测本身）|
| `docker ps` 的 `--format` | **`--format json` 会挂住**（不可用）；必须 `--format '{{json .}}'` | 实测 `--format json` **两次被 `timeout` 杀掉**（rc=124：8s 与 15s 各一次，且守护进程已热）；`{{json .}}` 正常返回完整 JSON 行（含 `Ports`/`State`/`HealthStatus`/`Labels`）⇒ docker 调用**一律加硬超时**（T0.1/T0.2 定案）|
| 发行版空闲终止 | **正常行为，不是异常** | 实测：无 `wsl -d` 活动数分钟后发行版**自行 Stopped**（`wsl -l -v` 显示 Stopped），而工具 VM 仍活着（`vmmemWSL` 建于 20:45:15 未重建）；下次 `wsl -d` 会把它**冷启动 12.5s**，并**连带拉起 dockerd + 用户的 6 个容器** ⇒ **自动探测绝不能叫醒它**；同时意味着 REQ-6.4「发行版 Stopped / 取不到 eth0」是**主路径**而非边缘情况 |
| 零副作用状态轮询 | **`wsl -l -v` 不唤醒发行版**（A-4 守卫实测有效）| 连续两次 `wsl -l -v`，状态保持 `Stopped`、`vmmemWSL` 未重建 ⇒「先查状态、非 Running 就不执行 `wsl -d`」**成立**。⚠️ 但它**不便宜**：冷上下文下首次调用实测 **8,595 ms**（后续 93 / 107 ms）⇒ 状态查询同样要超时 + UI 反馈，不能同步阻塞 |
| VM 与发行版生命周期 | **VM 比发行版活得久** | 发行版 Stopped 时 `vmmemWSL` 仍存在（跨多次发行版重启创建时间不变）⇒「发行版重启」与「VM 重建」是**两个独立事件**：前者 `btime`/`boot_id` 不变、**`/proc/1` 变**；后者全都变 | 2026-10-08 T0.2 实测：① `wsl --terminate Ubuntu2204`（单发行版）→ eth0 **不变**、`btime`/`boot_id` **不变**、**PID1 启动时间变**；② `wsl --shutdown`（整台 VM）→ `btime`/`boot_id` **变**、`vmmemWSL` 重建、eth0 **仍不变**。⇒ 漂移在本机不可复现（NAT/HNS 给了稳定地址），**且原脚本「坑 #4」的静默失效在本机也未发生**。**结论**：REQ-6「检测 + 一键修复」**保留为安全网**（判决逻辑本就要做，边际成本≈0），但**不做** 60s 心跳 / 常驻守护 / storage 持久化 —— 「激活 + 刷新各查一次」+ **写入前强制现读** 已足够（C-4 的原始结论被实测**证实**）|
| 转发目标地址（唯一解） | **只能用 `connectaddress=<eth0 IP>`** | 主人 2026-10-08 经验定案：**eth0 是唯一可用解**。备选 `connectaddress=127.0.0.1`（靠 `localhostForwarding=true` 中继）**已评估并否决** —— 不可用，故**不存在**「让规则不依赖 eth0」的路径 → 每次 WSL 重建后**必然**需要一次人工修复（走 UAC），漂移检测 + 一键修复从「可选缓解」升为**唯一缓解路径** |
| 现有 portproxy | **19 条**，`0.0.0.0:<port> → 172.20.201.152` | **就是用户脚本的产物**，脚本已手工执行过 |
| 输出编码（T0.1 实测） | `wsl.exe -l -v` = **UTF-16LE** + 行尾 **CRLF** + 表头**英文**；`wsl.exe --version` = UTF-16LE 但表头**中文**；`netsh … show v4tov4` = **纯 ASCII**（高位字节 0%）+ **CRLF** | **同工具不同子命令本地化不一致** ⇒ 解析器不得依赖表头字面量；原「netsh 是 OEM/GBK 中文表头」的假设被**实测推翻**，`decodeNetshOutput()` 保留为唯一改点。⚠️ **行尾 2026-10-09 订正**：原写「LF」，实测为 **CRLF**（fixture 尾部 `32 00 0d 00 0a 00`）—— **无功能缺陷**（REQ-1.2 要求容忍 CRLF），详见本文件末条变更记录 |
| 唤醒后首次 docker 调用 | **会被硬超时砍掉**：发行版冷启动（**12,827 ms**）后第 1 次 `docker ps` 跑满 `timeout 20` 且输出 **0 字符**，5 s 后第 2 次 **637 ms** 成功 | ⇒ 调用方必须**超时 + 重试**，且**不得**把空输出当「没有容器」（否则 UI 谎报 0 容器） |
| `docker ps` 的 `Ports` 列形态 | ① IPv4+IPv6 双份 `0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp` ② **端口区间** `0.0.0.0:5002-5003->5002-5003/tcp` ③ **空串**（未发布任何端口）| 端口映射解析必须覆盖三态；IPv6 形态原样保留、由消费方按需去重 |
| DSH 进程是否管理员 | **False** | `netsh portproxy add` 与 `New-NetFirewallRule` 均需提权 → 必须走 UAC 辅助进程 |

**原脚本的 5 个坑（本文件据此定下组件二的设计约束）**

| # | 脚本行为 | 问题 | 严重度 |
|---|---|---|---|
| 1 | `netsh interface portproxy reset` | 清空**全部**规则，不只自己那 19 条 → 他人配置一起陪葬 | 🔴 |
| 2 | `listenaddress=0.0.0.0` + 防火墙全量放行 | 19 个端口暴露给局域网，含 5432/6379/5000-5003 | 🔴 |
| 3 | 硬编码 19 个端口 | 「docker 管理器」却不知道 docker 实际映射了什么 | 🟡 |
| 4 | `connectaddress=<eth0 IP>` | WSL **实例重建**（`--shutdown` / `--terminate` / Windows 重启）后 IP 可能变，规则**静默失效** | ✅ 已定案 |
| 5 | portproxy 不支持 UDP | 容器 UDP 端口映射无法转发 | 🟡 |

**配置写入管道（本轮最关键的侦察结论）**

官方把「写配置」拆成两条路，机制在 `app.asar` 内可验证：

```
  自定义配置页（plugins.row.config）
     │  configure({ auto: false }, ctx.fiber)  ← 自绘页需显式关掉自动表单
     ▼
  ctx.settings  (@deepseek-ai/dsh-settings)
     · 只暴露 .volatile() 字段；表单投影「strips runtime references and ordinary fields」
     · revisioned descriptors；陈旧写入被拒（settings/conflict）
     · home patch / --patch 覆盖时【拒绝写入】
     ▼
  ctx.configEditor.edit()  (@deepseek-ai/dsh-config-editor)
     · 改盘前验证完整候选值；与 profile 变更、HMR 串行；原子替换
     · 保留 YAML 注释与 !!js 表达式；失败恢复原文档并回滚旧 patch
     ▼
  ~/.dsh/profiles/web/cordis.patch.yml    ← 用户指定落点
     ▼  patchReload: live（本机已确认开启）
  dsh-hmr 串行重载 → Loader.Entry.update
     ├─ 仅 volatile 变更 → _commitVolatile + loader/volatile-update → ✅ 不重挂载
     └─ 任何 ordinary 变更 → 普通 remount（dispose + apply）→ 🔴 终端全死
```

**这条机制直接决定组件一的配置设计**：把整个 `profiles` 数组声明为 `.volatile()`，编辑 profile 时**不重挂载、正在运行的终端存活**；否则用户每改一个 profile 的 cwd 就会瞬断所有终端。

**关键证据位置**

| 事实 | 证据 |
|---|---|
| `plugins.row.config` 以 `<包名>#<行 id>` 为键，一行一页 | `app.asar:439916`、`app.asar:439940` |
| 「需要在其他行关闭时仍保留页面的子插件，**应作为独立的包发布**」 | `app.asar:439966` |
| `@deepseek-ai/dsh-config-editor` 职责与三条已知限制 | `app.asar:972115` 邻域 README |
| `@deepseek-ai/dsh-settings` 只编辑 `.volatile()` 字段 | `app.asar:972522` 邻域 README |
| `Volatile configuration` 全文：`equalExceptVolatile` / `_commitVolatile` / `loader/volatile-update` / ordinary 重挂载 | `app.asar:272362` |
| `.volatile()` 声明样例 | `app.asar:282980`（provider/model/reasoningEffort）、`app.asar:288457`（selectedDefault） |
| HMR 监视 profile manifest 与两级 patch 文件并串行重载 | `app.asar:1083786` |
| mcp-manager 的单包双行实操记录（惰性伴生行 / 子路径 / locale / guard 顺序） | `E:\NodeProjects\DeepSeekHarness-MCP-Manager\docs\plans\2026-09-30-plugin-page-migration.md` |

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

## 下一步

1. ~~复核上面 6 项 `confirmed: implied`~~ → **已于 2026-10-08 完成**。
2. **最小验证（阻塞项）**：确认「`z.array(...).volatile()` 在数组路径上生效」在本基线真机可用 —— 这是 `plugin.profileConfigLiveness` 成立的前提。验证方式：写一个最小插件，profiles 数组标 volatile，改配置观察是否走 `loader/volatile-update` 而非 remount。
3. 确认无误后，即可按本文件合成骨架（`bootstrap-ai-first-sdd` 的 apply 阶段，不在本 skill 职责内）。
4. 若日后要支持 DSH Desktop，或要改用官方 Typert 通道，本文件可随时追加 `## 变更记录` 条目重开对应维度。

## 移交 bootstrap-ai-first-sdd（本轮未产出 Spec）

> 用户裁定：**本轮不产出 Spec 文件**，连 `.lean-spec/`、`AGENTS.md`、`harness/` 等基建一并交给 `bootstrap-ai-first-sdd`。
> 本节只捕捉已谈定的形状，避免探索成果丢失；**它不是 Spec**。

### 三 Spec 拆分方案（已拍板，待 bootstrap 落地）

| Spec | 包名 | 范围 | 依赖 |
|---|---|---|---|
| A | `dsh-wsl-shared` | 共享底座（**非插件包**） | — |
| B | `dsh-terminal-profiles` | 组件① 可配置终端 | A |
| C | `dsh-wsl-docker-ports` | 组件② WSL Docker 管理器 + 端口转发可视化 | A（并可选消费 B 的服务） |

**Spec A · `dsh-wsl-shared`**

- **做**：`wsl -l -v` 解析（发行版列表 / 默认发行版 / 状态）· eth0 IPv4 探测 · Windows ↔ WSL 路径翻译（`E:\x` ↔ `/mnt/e/x`，UNC 亦可）· `.wslconfig` 读取与 `networkingMode` 判定（nat / mirrored / 缺省）· 结构化命令执行封装 + 错误类型
- **不做**：不注册 slot / 工具 / 路由；不提供 PTY；不是插件包（无 `cordis.patch.yml`、无行、无配置页）
- **准入标准**：只有**两个以上消费者**需要的才进这里（提权辅助只有 C 用 → 留在 C）

**Spec B · `dsh-terminal-profiles`**

- **做**：`profiles` 配置（`name + command + args + cwd + cwdLinux + env`，**整数组 `.volatile()`**）· `ctx.subprocess.spawnTerminal` 真 PTY · 右栏 tab kind `managedTerminal`（extension 档）· xterm.js + fit（懒加载 chunk）· Host 侧 `@xterm/headless` + serializer · 自建 webServer 命名路由 + WS upgrade（独占前缀）· Agent 工具族 `new/list/read/write/resize/kill`（受 sandboxPolicy + 审批）· 配置页 `plugins.row.config` + `configure({ auto: false })` · 提供 `managedTerminal` 服务
- **不做**：不改官方 terminal 包；不做 tab 内分屏；不做 Host 重启后进程恢复；不做 docker 侧集成

**Spec C · `dsh-wsl-docker-ports`**

- **做（P0）**：消费 A（发行版发现 / **目标发行版四级解析（D-4）** / eth0 IP / NAT 判定）· docker 只读展示（容器 + 端口映射，**`--format '{{json .}}'`** —— 实测 `--format json` **会挂住**）· 端口转发可视化（期望 vs 实际 diff）· 声明式所有权（`managedPorts` 集合外一律不碰）· 本机 / 局域网逐端口可切（默认 loopback）· eth0 IP 漂移检测 · UAC 提权辅助进程（**后端链**：用户自装 `gsudo` 走 **stdio 回传** → `Start-Process -Verb RunAs` 回落走临时文件；不装工具 / 不改用户配置）· 提权策略 `none|ask|passby`（默认 `none`）· NAT 硬前提（非 NAT → UI 置灰 + 原因 + 修复步骤）
- **做（P1）**：启停 / 重启容器 · 容器日志 · 配置页 `plugins.row.config` + `configure({ auto: false })`
- **不做（下一期，Spec 里预留注入点）**：进容器 exec（可选注入 B 的 `managedTerminal`）· compose up/down · 镜像管理
- **明示**：**不支持 UDP 转发**
- **Spec 拆分（2026-10-08）**：本组件的**提权写路径**（声明式所有权 · 作用域与防火墙最小放行 · UAC 辅助进程 · 来源约束 · 卸载清理）改由 **Spec 005-elevation-write-path** 承载（**同包不拆包**，两 Spec 的产物都在 `packages/wsl-docker-ports/`）。上表写的是**组件**范围，与 Spec 的文档边界不必一一对应。

### 建 Spec 时的既定前提（不要再问一遍）

| 项 | 值 | 依据 |
|---|---|---|
| Spec 类型 | **需求驱动**（先 REQ-N + EARS，再由需求派生 design.md） | 用户本轮拍板 |
| 验收手段 | **vitest 单元 + node:test 离线契约测试 + chrome-devtools MCP 真机验收** | 用户本轮拍板；与 `frontend.test` 维度一致 |
| 不照搬 | propose skill 默认的 Playwright E2E + `harness/verify-e2e.sh` + 视觉对照 —— 该基建在本环境不存在；且本项目的验收口径已由用户拍板为 **chrome-devtools MCP 真机验收**（右栏 UI **确有**页面，只是不走 Playwright / 截图对照） | 同上 |
| 模板 | propose skill 期望的 `.lean-spec/templates/{requirements,design,tasks}-template.md` **在本环境不存在**（侦察时仅见一份手写 `bugfix-template.md`；`leanspec init` 之后实测该目录只有生成的 `spec-template.md`）。兄弟项目 `dsh-leanspec` 的实际约定是每 Spec 四份文件：`README.md` + `requirements.md` + `design.md` + `tasks.md` | 侦察 |
| 包名 | **无 scope**：`dsh-wsl-shared` / `dsh-terminal-profiles` / `dsh-wsl-docker-ports`。用户暂无 npm 账号，`link:` 交付不需要账号。**发布前需定 scope 并批量改名**（三包 `package.json` + 三份 cordis 行 `name` + profile patch + 测试断言） | 用户本轮拍板 |
| 项目根 | 已从 `dsh-terminal-extension` 迁到 **`E:\NodeProjects\dsh-wsl-toolkit`**（旧目录已空，待删） | 用户本轮拍板 |
| 依赖表达 | CLI 支持 `--depends-on` 与 parent/child 链接，`leanspec create` 时用上 | `leanspec create --help` |

### 阻塞项（进实现前必须打掉）

1. **`z.array(...).volatile()` 数组路径可行性** —— 官方样例只给了标量（`provider` / `model` / `selectedDefault` / `maxParallelToolCalls`），数组路径标 volatile 未找到直接样例。这是 `plugin.profileConfigLiveness`（编辑配置不杀终端）的成立前提。
2. ~~**6 项 `backend.*` 的 `confirmed: implied`** 待用户逐条点头~~ → **2026-10-08 已确认全为 `none`，本项清除**。

## 变更记录

| 日期 | 变更 | 说明 |
|---|---|---|
| 2026-10-08 | 初始建档 | Step 1 背景锚定完成；记录 4 项已确认决策与 10 项待定维度 |
| 2026-10-08 | Step 2 第 1 轮 | 确认 `terminalEngine` / `agentSurface` / `agentReadModel` / `agentPermission` / `configSchema`；新增 `hostScreenModel` 派生维度 |
| 2026-10-08 | Step 2 第 2 轮 | 确认 `hostScreenModel` / `renderer` / `frontend.ui` / `frontend.state`；确认内网 registry 可用 |
| 2026-10-08 | B 方案实测 | 应用户指派验证 Typert Remote namespace 可行性；结论「可行但代价高」，用户裁定改用 A |
| 2026-10-08 | Step 2 第 3 轮 + Step 4/5 | 确认 `clientTransport` / `tabKind` / `backend.test` / `frontend.test` / `layout.dirs`；完成冲突自检并汇总 |
| 2026-10-08 | **Step 3 探索轮（需求演进为双组件）** | 需求从单终端插件演进为「可配置终端 + WSL Docker 管理器与端口转发可视化」两个子组件，并要求插件栏配置互不干扰 |
| 2026-10-08 | **`layout.dirs` 变更（上一版失效）** | 单包 `src/ + lib/ + tests/ + docs/ + scripts/` → **pnpm workspace 三包** `packages/{terminal-profiles, wsl-docker-ports, wsl-shared}`；依据用户选择 L3 + 三包 + workspace |
| 2026-10-08 | **新增 11 个维度** | `packageSplit` / `crossPackageService` / `configStore` / `configIsolation` / `profileConfigLiveness` / `elevationPolicy` / `natPrerequisite` / `portOwnership` / `portScope` / `dockerScope` / `wslCwd`；全部 `confirmed: true` |
| 2026-10-08 | **用户更正硬前提** | 我原按「mirrored 为硬前提」理解，用户更正为 **「硬前提是 NAT」** → portproxy 整套保留，mirrored 方案被否决 |
| 2026-10-08 | **新增阻塞项** | `z.array(...).volatile()` 数组路径可行性需最小验证后才能进入实现 |
| 2026-10-08 | **项目改名** | `E:\NodeProjects\dsh-terminal-extension` → **`E:\NodeProjects\dsh-wsl-toolkit`**；决策文件已随迁（旧目录因被会话工作区占用无法删除，内容已清空） |
| 2026-10-08 | **三 Spec 方案定稿 + 本轮不产出 Spec** | 用户裁定：拆三 Spec（A 共享 / B 组件① / C 组件②），但**本轮不产出 Spec 文件**，连 `.lean-spec/`、`AGENTS.md`、`harness/` 一并交给 `bootstrap-ai-first-sdd`；已谈定形状记入「移交」章节 |
| 2026-10-08 | **文档一致性修订（纯文档，无决策变更）** | 三 Spec 落地后回读本文件，修正三处自相矛盾/失准表述：① Step 2 第 3 轮表的 `layout.dirs` 仍是单包值，与 Step 3 的三包 workspace 及变更记录冲突 → 标注失效并指向权威值；② 「不照搬 E2E」的依据栏原写「本项目无 web 页面可截图」，与右栏 UI 实际有页面不符 → 改为「基建不存在 + 验收口径已拍板为 chrome-devtools MCP 真机」（结论不变）；③ 模板侦察行补注 `leanspec init` 后的实测状态。**34 个维度的取值与 `confirmed` 状态一字未动。** |
| 2026-10-08 | **6 项 `backend.*` 复核闭环（阻塞项清除）** | 主人逐条确认 `framework` / `orm` / `db` / `migration` / `auth` / `ai` 全为 **`none`** → 6 处 `confirmed: implied` 改为 `confirmed: true`，`meta.pendingReview` 清空，「待用户复核项」改为「复核记录（已闭环）」。**已明确接受的代价**：① `db = none` → 不持久化插件状态、不建规则台账，组件②所有权必须是声明式 `managedPorts`（人工维护集合；任何「清空重写」为红线）② `migration = none` → 配置字段改名/挪位属破坏性变更，靠版本字段 + 文档拦截，不写迁移脚本。 |
| 2026-10-08 | **B-1 机制定案（源码实证，非真机）** | 直接检索 `app.asar` 字节流取得宿主实现：`equal()` 首行 `if (schema?.meta?.volatile) return true` → 整数组标 `.volatile()` **机制成立**（递归到 `profiles` 键即判等，不重挂载）；`.volatile()` 定义在 schemastery `Schema.prototype` 上、不挑类型。据此为 `plugin.profileConfigLiveness` 补 6 条源码级约束（**其中 2 条原文档缺失**：① 配置 schema 必须 Schemastery，用 Zod 则 volatile 静默失效 ② 标在数组元素内会被 `validateVolatileSchema` 拦下报错、非静默降级）与 `evidence` 字段。`pending` 从「机制未知」改写为「源码已定案，剩 5 条真机行为链」。**B-1 仍是开工阻塞项**（真机未走），但性质从「机制风险」变为「行为确认」。 |
| 2026-10-08 | **B-3 / C-3 源码+真机定案（含 1 处 Spec 错误、1 处本机事实订正）** | ① **B-3 定案**：官方 webServer 匹配顺序为 **exact → 最长 prefix → fallback**、注册顺序无语义、fallback 单座位且只答未匹配请求 → **SPA 抢不走我们的具名路由**；但 **`registerUpgrade` 只支持 exact path** → 推翻 Spec 里「独占前缀的 upgrade 路由」的写法（002 REQ-7.1 已修正为「HTTP 用 prefix、upgrade 用单一 exact 端点」）。② **C-3 清除**：其前提「本机存在 `~/.dsh/cordis.patch.yml`」经真机枚举**不成立**（该文件不存在），且 profile 根注释给出的层序中不含 home 层。③ 另修正 `plugin.configStore` 中同一条失准表述。④ 新增 `plugin.clientTransport.constraint` 8 条与 `evidence`。⑤ **Electron 路径**由官方文档定案（只服务浏览器、Electron 走 `file://` + IPC）→ 002 的 A-3 从假设升为已确认。⑥ T0.1 第 5 条同时定案：volatile 字段解析为 `Volatile<T>` 引用（`.get()`、深冻结快照、不得跨操作缓存）。 |
| 2026-10-08 | **C-4 定案：eth0 漂移触发条件 = WSL 实例重建** | 主人确认 + 实测（当前 eth0 `172.20.201.152` 与 19 条规则 connectaddress **一致 = 未漂移**）：`wsl --shutdown` / `--terminate` / Windows 重启导致 **VM 重建**后**可能**换 IP，**不重建则不变** → 定性为**低频事件**：检测**无需**常驻守护或启动钩子（激活 + 刷新各查一次足够），修复必然走 UAC → 003 的「检测 + 一键修复」形态成立；003 的 A-3 从假设升为**已确认**，真机项收窄为「记录一次重建前后对照」。 |
| 2026-10-08 | **D-2 / D-3 定案 + 拆出 Spec 004** | ① **D-2（端口所有权展示）**：本机 19 条**集合外**规则 → **显示且只读**（独立清单，不进五态、无动作）→ 003 新增 REQ-15 / REQ-16，并修订 REQ-4.1（「完全忽略」→「不进五态但可只读展示」）。② **D-3（分期）**：端口声明（`managedPorts` 支持**单端口 + 闭区间混写**；常见服务 **presets 快速勾选**）**提到 P0** —— 五态判定以前置声明为条件，否则 P0 只剩只读展示。③ **presets 首批 13 项**：`3306`/`1521`/`8080`/`5432`/`6379`/`27017`/`5672`/`9092`/`9200`/`8848`/`9000`/`5173`/`5000`（末项 = Flask 默认端口，Vite 默认 `5173`；**未收** SQL Server `1433`）。④ 新增 **Spec 004-terminal-agent-surface**（Agent 工具面，**同包不拆包**：002 的 REQ-8/9 与 Phase 5 留空位）。 |
| 2026-10-08 | **拆出 Spec 005-elevation-write-path（003 瘦身）** | 003 拆前四文件 **199 / 195 / 191 / 165** 行（`requirements.md` 与 `design.md` 双双贴 warn 200）→ 把「提权写路径」这一**面**独立成篇（与 004 同思路，**同包不拆包**）：005 收 003 的 **REQ-4 / 5 / 7 / 8 / 13 + NFR-1/3 + Phase 3 大部（T3.1–T3.4）+ Phase 4（T4.1–T4.5）+ T6.1–T6.3**，并在 005 内连续重编号为 **REQ-1..5**；003 的对应 REQ / NFR / Phase 号**保留为空位**（与 002→004 同约定）。拆后行数：003 = **175 / 145 / 151 / 169**，005 = **84 / 124 / 99 / 106**，五份 Spec 无一超 200。**依赖方向**：`depends_on` 只有 **005 → 003**（005 消费 003 的只读事实：NAT 判定 / eth0 / 实际集与期望集）；反向的运行时调用属同包内代码调用，**不建边**以免成环。**新增交叉引用约定**：跨 Spec 的任务标签写作 `[005-REQ-x.y]`（一致性闸门只认同 Spec 内的 `[REQ-x.y]`）。**同时修掉 1 处 D-2 残留**：003 的 REQ-14.2 仍写着 19 条规则「完全不显示、待主人拍板」→ 改为按 D-2 定案「显示且只读」。**34 个维度一字未动**（本行只改文档边界与验收归属）。 |
| 2026-10-08 | **配置写入路径源码订正（1 处 Spec 错误 + 1 处措辞过强）+ B-1 第 4/5 条定案** | ① **Spec 错误**：002 REQ-10.2 / 003 REQ-12.1 原写「写入经 `ctx.settings` → `ctx.configEditor.edit()`」—— 实为**两条互补路径**：settings 专做 **live（volatile）字段**（不重挂载），configEditor 做**完整配置**（`ordinary fields retain Loader's normal lifecycle` ⇒ **会重挂载、杀正在跑的终端**）。② **`ctx.settings.register` 在 0.2.0-rc.2 已移除**（app.asar **0 命中**）：schema 改为模块**静态 `Config` 导出**、命名空间 = **patch 条目 id**（`row.options.id === ns`）；同机插件 `dsh-whale-pet`（真跑在 desktop profile、`patchReload: live`）注释同口径。③ **复核为正确、不改**：`plugins.row.config` slot（键 `<包名>#<行 id>`）+ `configure({ auto: false }, ctx.fiber)`（官方代码有真实调用点）+ `settings.describe/update/replace/mutate` + `settings.writable` 均成立。④ **措辞过强降级**：「`ctx.settings.writable` 硬编码为 `true`」在 rc.2 **未复核** → 改为「由 provider 透传，值待复核」。⑤ **B-1 第 4/5 条离线定案**（直接 require 同机 `@deepseek-ai/schemastery`）：元素内标 volatile **构造不抛错、parse 时抛 `ValidationError`**，原文 `$.profiles.*.cwd volatile fields require a fixed object path without an enclosing volatile field`（原 Spec 措辞「构造时抛错」一并订正）；数组级 volatile 解析为**带 `.get()` 的对象**（`Array.isArray=false`、下标取值为 `undefined`、值**深冻结**）→ 002 读配置**必须走 `.get()`**。**B-1 剩第 1/2/3 条**（真机：不重挂载 / ordinary 反向对照 / 非法配置回落）。⑥ 环境事实：`@deepseek-ai/schemastery` **不在** profile 的 `node_modules` 里（裸名 `schemastery` 无法 require），离线验证从同机 `E:\NodeProjects\dsh-whale-pet\node_modules` 取。 |
| 2026-10-08 | **B-1 五条真机定案（B-1 清除）+ 2 项新发现** | 方法：`dsh --from-default-profile web` 建**临时 profile `volatile-probe`**（不动在跑的 `web`；`--port 0` 自选端口；`patchReload: live`）+ **一次性探针插件**（`%TEMP%\dsh-volatile-probe`，`profiles` 数组 `.volatile()` + ordinary 对照字段 + 模块级 apply 计数器）。**链条 1 ✅**：`settings.update(ns, {profiles:[…]})` → **152ms 成功**、`apply` **未重跑**（不重挂载）**且** volatile 引用 `.get()` 从 `seed` 变 `C1`（**值真传播**）⇒ 不是空操作假阳性。**链条 2 ✅（反向对照）**：只改 ordinary `label` → **apply 重跑**（真 remount）⇒ 判定非恒真。**链条 3 ⚠️ 部分**：非法值（`label: 42`）→ **静默拒绝、不崩、不重挂载**；但预期里的「`_commitVolatile()` 失败回落 remount」**未被命中**（实验走 patch 层而非 live 路径）→ 留待真实插件复测。**附加 ✅**：混合变更（ordinary+volatile）→ remount，符合「混合退化」预期；写入内容与现有**完全相同** → **不触发任何更新**。**第 4/5 条**（离线直跑 schemastery）：元素内标 volatile **parse 时**抛 `ValidationError`（原文见上一条记录）；数组级解析为**带 `.get()` 的深冻结对象** —— 真机再次印证（运行期 `config.profiles` 就是 `.get()` 对象）。**新发现 ①（当场误判，同日由本表第 22 条更正）**：一度记为「`settings.update` 的值未见落盘」→ 立 **T0.6 / 002 A-6**；**结论已被推翻，见下一条**（误判成因 = 我的对照步手写同名 patch 文件覆盖了自己的证据）。**新发现 ②**：宿主会在启动/`--dump-config` 时**规范化重写** profile 的 `cordis.yml`（`profiles/web/cordis.yml` mtime 被更新，**内容与模板逐字一致、用户层 `cordis.patch.yml` 未被动**）。**顺带查明**：`dsh --profile <name>` 后**不能再给 app 名**（`dsh --profile x web` 会报 `too many arguments`）；`ctx.get('settings')` 在 cordis 4 拿不到服务，**必须 `ctx.inject(['settings'], …)`**；在定时器里摸未注入的 `ctx.*` 属性会抛未捕获异常**直接崩进程**。**34 个维度取值未动。** |
| 2026-10-08 | **B-1 落盘语义定案（更正上一条的误判：不是「不落盘」，而是闭环）+ SSoT status 转 `decided`** | 上一条把 `settings.update` 记为「未见落盘」→ **同日 v5 专项实验推翻**。① **文档位置**：探针直读 `settings.documentPath` = `…\profiles\volatile-probe\cordis.patch.yml`、`writable = true` ⇒ **settings 文档就是 profile 的 patch 文件本身**（服务原型另暴露 `importLegacyDocument` / `prepareDocument` / `write`，可解释 `~/.dsh/settings.yaml.imported` 的来历）。② **落盘时机**：`settings.update` 后 **3s（进程仍在运行）** 文件内容已由 `cwd: C1` 变为 `cwd: CZ` ⇒ **立即落盘**，不是退出时刷。③ **跨重启**：重启后 `apply #1` 直接加载出新值（`[a,C1]`）⇒ **改完不丢**。④ **误判成因（自伤假阳性）**：上一条实验的「反向对照」步**手写同一个 patch 文件**（写入 `profiles: seed`），**覆盖了 settings 刚落盘的值**，重启自然读到 `seed` ⇒ 我把它错误归因成「不落盘」。**教训已写进 002 的 T0.1/T0.6/design**：**同一文件既是 patch 层又是 settings 落盘处，实验里不得再手写它**，否则自己覆盖自己的证据。⑤ 结论：002 REQ-2.2「改配置不杀终端 + 改完不丢」**双闭环，无需另配落盘路径**；A-6 由假设升为**已定案（成立）**、T0.6 关闭。⑥ **SSoT `status` 由 `decided-pending-review` 转为 `decided`**（34 维全 `confirmed: true`、B-1/B-2/B-3 全部清除，已无待复核项）。**34 个维度取值未动。** |
| 2026-10-08 | **T0.2 漂移实测（主人授权重启 WSL）：漂移不可复现 → 撤回我自己的心跳提案；4 项新真机事实** | 方法：脚本化两轮重建，每轮采 `vmmemWSL` 存在性/创建时间、Windows 侧网关、ping 网关、发行版内 `btime`/`boot_id`/**PID1**/eth0、portproxy 规则集。① **单发行版 `--terminate`**：eth0 **不变**、`btime`/`boot_id` **不变**、**PID1 变**（17:08:10 → 20:44:54）、冷启动 **11.1s**。② **整台 `--shutdown`**：`btime` 与 `boot_id` **变**、`vmmemWSL` 重建（1s 内消失）、eth0 **仍不变**、冷启动 **12.5s**。③ **规则侧**：19 条 connectaddress 始终 = 当前 eth0，**零漂移、无需修复、无需 UAC**；端到端抽验 `127.0.0.1:{6379,5432,8080,5002}` **全通**（规则+eth0+容器整链正常）。⇒ **结论**：漂移在本机不可复现 ⇒ **撤回**我上一轮基于「terminate 会变」提出的 **60s CIM 心跳 + storage 持久化**（过度设计）；C-4 原始结论「激活/刷新各查一次」被实测**证实**，另加**写入前强制现读**即可。④ **我的两处自伤（如实入账）**：ⓐ CIM 过滤器写成 `Name='vmmemWSL.exe'`（真名**无 `.exe`**）→ 实验里四次全报「vmmemWSL 不存在」，其中一次恰在 VM 活着时，差点误判成「VM 不存在」；ⓑ 把 `docker ps --format json` 的首次卡住归因于「守护进程恢复中」，放宽到 15s 重测后**仍 rc=124** ⇒ 确认是**该选项本身会挂住**，必须用 `--format '{{json .}}'`。⑤ `ping 172.20.192.1` 在**全停后 1.7s 仍通** ⇒ 主人提出的 ping 心跳方案**实测证伪**（测的是 Windows 自答，不是 WSL 死活）。⑥ 顺带确认：错形式 `--format json` **挂住而非报错** ⇒ docker 调用必须**硬超时**（与 001 的超时/回收设计呼应）。**34 个维度取值未动。** |
| 2026-10-08 | **T0.2 后半程：发行版空闲自终止 + 状态轮询守卫实测（含我自己的越界自纠）** | ① 发现容器 uptime 卡在 ~10s ⇒ 查明是**发行版空闲自终止后被我的探测叫醒**：`btime` 20:45:15 **不变**、**`/proc/1` 由 17:08:10 变为 20:51:50**、dockerd 20:52:10 重启、容器 `RestartCount=0`（**不是崩溃循环**）。⇒ 两个后果：(a) **REQ-6.4「发行版 Stopped / 取不到 eth0」是主路径而非边缘情况**（UI 开着点刷新大概率就撞上）；(b) 我的探测**冷启动了发行版并连带拉起用户整套 docker（6 容器）** —— 这正是 **001 A-4 明令禁止**的事，**我自己犯了一遍**，如实登记。② **守卫机制实测有效**：连续两次 `wsl -l -v` 后发行版仍为 `Stopped`、`vmmemWSL` 未重建 ⇒「先查状态、非 Running 就不执行 `wsl -d`」**成立**（001 REQ-2.4 的落法被证实）；但首次调用实测 **8,595 ms**（后续 93/107 ms）⇒ 状态查询同样需要超时与 UI 反馈。③ **VM 与发行版生命周期分离**：发行版 Stopped 时 `vmmemWSL` 仍在 ⇒ 解释了「发行版重启为何不换 `btime`」。④ eth0 第 **5** 次采样仍为 `172.20.201.152`（跨 5 次发行版重启 + 1 次 VM 重建）⇒ 漂移结论**加固**。⑤ 终态：已主动启动发行版恢复用户环境；19 条规则仍有效、端到端 3 个端口通。**34 个维度取值未动。** |
| 2026-10-08 | **主人拍板 4 项（含新需求「默认发行版」）→ 已落 Spec** | ① **001 REQ-2.4 加唯一例外**：自动路径**一律不启动**发行版，仅**用户显式动作**（「启动并核验」）可启动，且须先明示代价（10–12s）。② **`distro` 字段提到 P0**（原属 P1 配置页）—— P0 的 eth0 对比与 `docker ps` 执行都必须知道目标发行版。③ **003 REQ-6.4 升级为 P0 显式状态**（「WSL 未运行」+「启动并核验」按钮）—— 实测发行版**空闲自终止**属主路径。④ **新增 001 REQ-1.7 / 003 REQ-17（D-4）：目标发行版四级确定性解析** = ① 配置值 → ② `wsl -l -v` 的 `*`（**WSL 自己的默认发行版**）→ ③ **唯一发行版**（一个即认定，**零提问**）→ ④ 首个；**不阻塞提问**、**不执行 `wsl --set-default`**（不改用户的 WSL 全局默认）、解析**只读 `wsl -l -v`**（实测不唤醒）且**每次读取时解析、不持久化**；UI 显示「目标 + 来源」并可切换（写 `distro`，live 路径）。依据：一次 `wsl -l -v` 同时给出 `state` 与 `*`。**34 个维度取值未动。** |
| 2026-10-08 | **Phase 0 落地（T0.1 真机 fixture 入库 + 包骨架 + 最小解析器，测试 16/16 全绿）：5 项新真机事实 + 4 项工具链坑** | ① **编码定案**：`wsl -l -v` = **UTF-16LE**（NUL 占比 **50%**）+ 行尾 **LF**（⚠️ **2026-10-09 订正：实为 CRLF**，见本表末条）+ 表头**英文** `NAME STATE VERSION`；而**同一 exe** 的 `wsl --version` 表头是**中文**「WSL 版本」⇒ **同工具不同子命令本地化不一致** ⇒ 解析器**不得**依赖表头字面量（001 A-1/A-2 定案，实现改为「末列必须是 1/2」判数据行）。`netsh interface portproxy show v4tov4` 本机是**纯 ASCII**（高位字节 **0%**、表头英文 `Listen on ipv4:`）+ **CRLF** ⇒ **原假设「OEM/GBK 中文表头」被实测推翻**（003 A-2 定案；仍把解码集中在 `decodeNetshOutput()` 一处）。`.wslconfig` 仅 `[wsl2] localhostForwarding=true` ⇒ **NAT 缺省**，组件②硬前提成立。② **`docker ps` 新坑（第二次踩到超时）**：发行版冷启动（本次实测 **12,827 ms**）后**第一次** `docker ps` 跑满 `timeout 20` 且**输出 0 字符**，**5 s 后**第二次 **637 ms** 成功拿到 6 容器 ⇒ 调用方必须**硬超时 + 重试**，且**不得**把空输出当「没有容器」。③ **`Ports` 列三种真实形态**：IPv4+IPv6 双份（`0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp`）/ **端口区间**（`5002-5003`）/ **空串**（未发布）⇒ 端口映射解析必须覆盖三态。④ **工程落地**：`pnpm-workspace.yaml` + 根 `package.json` + `tsconfig.base.json` + `packages/{wsl-shared,wsl-docker-ports}`（`src/` + `tests/contract/fixtures/`）；**`node --test "…/**/*.test.ts"` 对 `.ts` 直接可用**（Node 24 type stripping；glob 形式成立，不必逐个列文件）；001 导出预算自检 **6/12**。⑤ **工具链四坑**：ⓐ **TS 7.0.2 不再自动纳入 `@types`** ⇒ `tsconfig` 必须显式 `"types": ["node"]`（否则 `TextDecoder` / `node:test` 全报 TS2304）；ⓑ `assert.ok(x)` 的收窄在 `noUncheckedIndexedAccess` 下**不生效** ⇒ 测试改用显式 `if (x === undefined) throw`；ⓒ **`mcp__leanspec__update_spec` 传 `status` 实测空操作**（只刷新 `updated_at`、字段不变）⇒ 状态流转**只能**用 `leanspec update <spec> --status <s>`（CLI 还会自动追加 `transitions`）；ⓓ **leanspec MCP server 的项目根 = 进程 cwd**（其 Rust 二进制无 `--root/--project` 选项），而本机 DSH app 的 cwd 不是工作区 ⇒ 原 `npx -y @leanspec/mcp` **永远返回 0 个 spec**，已改为 `cmd /c cd /d <仓库根> && npx -y @leanspec/mcp`（`profiles/desktop/cordis.patch.yml`，`patchReload=live` 热生效）。**34 个维度取值未动。** |
| 2026-10-08 | **A-2 定案（005）+ 仓库纳入 git（含 1 处会毁测试的环境隐患修复）** | ① 主人确认 **005 A-2**：**卸载不自动清理任何规则**（改为提供「本插件维护的规则」清单 + 手动清理入口，复用 REQ-1.2 的匹配算法）—— 理由：规则是用户可感知的系统状态，自动清理会误伤既有 19 条。⇒ REQ-5.1 口径不变，A-2 由「假设」转为「**已确认**」。**A-1（Agent 触发的提权在 `passby` 下：降级为 `ask` vs 直接拒绝）仍待主人择一**（→ **当日后续已定案 = 降级为 `ask`（方案 A），见本表下一行**），Spec 暂按「降级为 ask」写验收（切换成本 = 一处判定 + 两条断言）。② 仓库 `git init -b main` + 基线提交 `9927397`（**52 个文件**，含 `.lean-spec/`、五份 Spec、SSoT、AGENTS、包骨架与 fixture）；此前无版本历史 ⇒ `crystallize` 覆盖 `AGENTS.md` 这类事故无法回滚，现已可回滚。③ **环境隐患（本次发现并修）**：系统级 `core.autocrlf = true`（`C:/Program Files/Git/etc/gitconfig`）会在入库/检出时把 **CRLF 归一化为 LF**，**直接毁掉 003 的「CRLF」断言与 UTF-16LE fixture**；处置 = 仓库本地 `core.autocrlf false` + 新增 `.gitattributes` 把 `*.raw` / `*.jsonl` 标为 `-text`（双保险），并用 `git hash-object --no-filters` 与 blob SHA 逐一比对，**证明 6 个 fixture 的字节与真机原始捕获完全一致**。**34 个维度取值未动。** |
| 2026-10-08 | **A-1 定案（005）= 降级为 `ask`；提权后端链定案（含 1 处反直觉的技术判定）** | ① 主人定案 **A-1**：Agent 触发的提权在 `passby` 下 **降级为 `ask`**（应用内确认 + 展示命令原文），确认后才发 UAC；备选「直接拒绝」被否 —— 保住「Agent 帮你发起」的可用性，同时保证**每次都有一次人类显式点击**。② **后端链定案**（主人要求：不强制安装、用户自己配了 gsudo 就走 gsudo、也可以走 `sudo`）：**① 用户自装 `gsudo`** → **② `Start-Process -Verb RunAs`（永久回落）** → ③ **Windows 自带 `sudo`** 仅显式配置时用。**不装工具 / 不改 PATH / 不动用户 gsudo 配置**。③ **取证（官方文档 + 本机真机）**：本机已装 **gsudo v2.6.1**（`D:\Program Files\gsudo\Current\gsudo.exe`），`CacheMode = Explicit`、活跃缓存会话 **0** ⇒ **每次都会弹 UAC**（安全档）；gsudo **StdOut/StdErr 可捕获、退出码可取、提权失败 = 999**，且其官方 README 明写**凭据缓存的风险**（恶意进程可驱动活跃缓存**免 UAC 提权**）⇒ 故**检测到缓存活跃即回落 native，且绝不执行 `gsudo -k`**（那是杀用户的会话）。**Windows 自带 `sudo`** 经微软官方文档确认：**仅 Win11 24H2+**、须用户在「系统 > 高级」**显式开启**（默认关）、默认模式 **`forceNewWindow` 起新窗口 ⇒ 拿不到输出**，只有 `normal` / `disableInput` 才有意义，且**改模式必须从提权命令行**（属用户/系统设置，我们不碰）⇒ **列为未验证项 A-3，不进 `auto`**（本机 23H2 无法验证；影响=0 功能损失，24H2 未装 gsudo 时回落 native）。④ ⚠️ **本次新增的认识（A-1 与后端耦合）**：方案 A 的闸门是**应用内确认**，而 UAC 能否逐次弹出取决于后端；若用户开了 gsudo 缓存，UAC 闸门消失，则应用内确认成为**唯一**闸门 —— 这正是「缓存活跃即回落 native」的理由。**34 个维度取值未动**（提权维度的「机制」说明按上述细化）。 |
| 2026-10-09 | **拆出 Spec 006-path-translation（001 瘦身）** | 001 的 `tasks.md` 在 Phase 5 后 **198 行**（warn 200），Phase 6 收口（复核公开面 / `check-scope.mjs` / 质量门 / 复盘）还要约 15 行 ⇒ 主人裁定「**拆一个 spec 出来**」（备选「就地压缩」被否）。把 001 的**路径翻译面**独立成篇（**同包不拆包**：代码仍在 `packages/wsl-shared/src/pathmap.ts`，`index.ts` 照旧导出 `winToWsl` / `wslToWin`，导出预算 REQ-6.4 仍记在 001）：006 收 **REQ-3.1–3.7 + T4.1–T4.4 + Phase 4 完成记录**；**编号一律保持**（与 004/005 的「重编号」不同 —— `pathmap.ts` 与它的 87 条单测里有 **20+ 处**按编号追溯，改号=断链），001 的 REQ-3 段与 Phase 4 段**保留为空位**并指向 006（沿用 002→004「保留空位以免引用错位」的先例）。拆后行数：001 = **148 / 117 / 174 / 187**（tasks 198 → 187），006 = **86 / 42 / 78 / 69**，**六份 Spec 四文件全部 ≤ 200** ✅（次高：002 = 158 / 186 / 186 / 182）。`depends_on`：**006 → 001**（复用 `errors.ts` 的错误模型）；**`002 → 006` 的边待补** —— 本机 CLI 的 `rel` / `link` 未迁移、MCP `update_spec` 无 `depends_on` 字段、`update` 也无该选项 ⇒ **事后加边没有任何工具路径**（已在 AGENTS.md「本机 CLI 现状」留痕）。**代码与测试一字未动**（门禁复算：typecheck 0 / vitest **220** / 契约 **16** / 导出 **8/12 + 类型 17 = 25** / 体积 **25,859 / 40,960 字节**）。**34 个维度一字未动。** |
| 2026-10-09 | **001 Phase 6 收口完成（T6.1–T6.4 + 真机探针）：2 道坏门修 1 道、新门 1 道、抓到 1 个文档真缺陷** | ① **T6.2 判据修掉第二道坏门**：`tasks.md` 原判据「剥注释后 `netsh\|portproxy\|docker\|RunAs\|taskkill /PID` 命中 0」**根本跑不过** —— `exec.ts:113` 有**真的** `treeKill('taskkill', ['/PID', …])`，那是 **REQ-5.3 的进程树兜底杀**（属 001 自己，不是 005 的提权逻辑）。**定稿判据 = 逐词条 + 文件级白名单**（`taskkill` 仅允许 `exec.ts`，其余词条任何源文件都不得出现），落 `packages/wsl-shared/scripts/check-scope.mjs`；**四道防呆**（正控必须被命中 / 注释里的词必须不命中 / `keepLines` 保行号 / 源文件非空）任一失败即 `exit 1`，并**实测负控**（植入 `src/__scope-probe.ts` 越界代码 → **exit 1** 且报出 `__scope-probe.ts:1`，随后清理、`git status` 无残留）。**两道坏门的修订史写进脚本头部**，免得后人再按坏判据改代码。② **抽出 `scripts/strip-comments.mjs` 供两道门共用**（体积门与越界门都必须「只看代码不看注释」）—— 消除「各写一份正则必然漂移」的隐患（同一课本项目已上过：`execInDistro` 抽出来就是因为守卫分叉迟早漏一次）；抽出后体积口径**逐字节不变**（**25,859**），并用 `keepLines` 模式额外满足「报行号」的需求。③ **🔴 探针抓到 1 个文档真缺陷（本次最有价值的发现）**：**A-1 记的「`wsl -l -v` 行尾 LF（无 CRLF）」是错的** —— fixture 尾部即 `32 00 0d 00 0a 00`（**CRLF**，CR 2 / LF 2，**有尾换行**），`scripts/probe.mjs` 三次实时捕获 **3/3** 一致。**无功能缺陷**（REQ-1.2 明写 SHALL 容忍 CRLF，实现用 `split(/\r?\n/)` + 逐行 `trim()`），但这条事实**错了整整一天且无人能拦**：契约层原本只断言「解码不残 NUL / 能解析出名字」，**没钉行尾**。**根因**：T0.1 同批捕获两个 fixture，`ip-eth0.raw`（UTF-8）**确实**是 LF（`net.test.ts` 用 `includes(0x0d) === false` 钉着），这条性质被误写到了发行版表上。**处置**：ⓐ 订正 **8 处**（001 的 `requirements.md` A-1 / `tasks.md` T0.1 / `design.md` §8-1 / `README.md`、fixture 目录 README、**本文件第 401 行口径行 + 上一条历史记录**、`AGENTS.md` 真机事实表），全部带日期与证据、不静默改写；ⓑ **新增契约用例「T0.1 真机 fixture 字节事实」把字节事实钉成可复算断言**（CR=LF=2、NUL 恰 50%、无 BOM、**有**尾换行）⇒ 契约 **16 → 17**。**教训**：**同一阶段捕获的多个 fixture，性质必须逐个用字节断言钉住**，不能靠「同批所以同性质」。④ **T6.1 公开面复核**：运行时 **8/12**（`createExecutor` / `listDistros` / `resolveDistro` / `execInDistro` / `probeEth0` / `winToWsl` / `wslToWin` / `readNetworkingMode`），**逐个都有具名消费方**（002/003/004/005），无一是投机导出；**主动不导出**清单及理由已记入 `tasks.md` T6.1（典型：`isWslFailure` —— 消费方用字面判别式 `.ok` 即可收窄，导出等于给公开面加一个**零新能力**的名字；`parseEth0Address` / `guardDistroExists` / `parseDistroTable` 是内部件，已被 `probeEth0` / `execInDistro` 包装）。类型 17 ⇒ 合计 **25 = 软阈值**（不告警），**没有第三次抬阈值**。⑤ **T6.3 质量门（新门落地后复算）**：`typecheck` exit 0 · `vitest` **220/220**（7 文件）· 契约 **17/17** · `check:exports` **运行时 8/12 + 类型 17 = 25** · `check:size` **25,859 / 40,960 字节（余 15,101）** · **`check:scope` 越界 0 + 非插件包形态 ✓ + 零运行时依赖 ✓**（新增的第六道门；根 `pnpm check:scope` 已接线）· 单文件最高 **262 行**（NFR-5 限 400）。⑥ **探针真机结果（只读、零副作用，主人预批）**：`wsl -l -v` **152 字节 / NUL 50% / 无 BOM / CRLF**（UTF-16LE ✓ 与 A-1 一致）；`listDistros` **117ms** → `* Ubuntu2204 Stopped v2`；`resolveDistro`（不传配置）→ 来源 **`wslDefault`**（用 `wsl -l -v` 的 `*`，**未阻塞提问**，符合 D-4）；`readNetworkingMode` → `C:\Users\EDY\.wslconfig` / `mode=default` / **`resolved=nat`** ⇒ **组件②硬前提在本机成立**；`probeEth0` → **`DistroNotRunning`**（Stopped 时**不执行** `wsl -d`）；**副作用断言：探测前后 `Stopped → Stopped`** ⇒ **REQ-2.4「自动路径绝不唤醒」真机成立**。探针顺带修掉自己的一个显示缺陷（管道中 ANSI ESC 被渲染成 `[32m` 噪声 ⇒ 改为仅 `isTTY` 上色）。⑦ **A-6 仍是假设，不粉饰**：本机 `mode=default ⇒ resolved=nat` 只说明**这台机器**（Win11 23H2 / WSL 2.7.3.0）如此，**证不了**「WSL 缺省网络模式恒为 NAT」；真正的「规则通不通」留给 003 的转发自检。⑧ **001 收口后可转 `complete`**（六份 Spec 四文件行数逐一复核 ≤ 200）。**34 个维度取值未动**（本行只改文档事实与门禁实现）。 |
