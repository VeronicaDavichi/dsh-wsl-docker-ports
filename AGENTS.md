# dsh-wsl-toolkit

> **技术栈已冻结** → 见文末「🧱 技术栈（已冻结）」。唯一真相来源是 [`stack-decision.md`](./stack-decision.md)；**改栈必须先改它并追加变更记录**，不要在 Spec 或代码里另开口径。

## 🚨 CRITICAL: Before ANY Task

**STOP and check these first:**

1. **Discover context** → Use `board` tool to see project state
2. **Search for related work** → Use `search` tool before creating new specs
3. **Never create files manually** → Always use `create` tool for new specs

> **Why?** Skipping discovery creates duplicate work. Manual file creation breaks LeanSpec tooling.

## 🔧 Managing Specs

### MCP Tools (Preferred) with CLI Fallback

| Action         | MCP Tool   | CLI Fallback                                   |
| -------------- | ---------- | ---------------------------------------------- |
| Project status | `board`    | `lean-spec board`                              |
| List specs     | `list`     | `lean-spec list`                               |
| Search specs   | `search`   | `lean-spec search "query"`                     |
| View spec      | `view`     | `lean-spec view <spec>`                        |
| Create spec    | `create`   | `lean-spec create <name>`                      |
| Update spec    | `update`   | `lean-spec update <spec> --status <status>`    |
| Link specs     | `link`     | `lean-spec link <spec> --depends-on <other>`   |
| Unlink specs   | `unlink`   | `lean-spec unlink <spec> --depends-on <other>` |
| Dependencies   | `deps`     | `lean-spec deps <spec>`                        |
| Token count    | `tokens`   | `lean-spec tokens <spec>`                      |
| Validate specs | `validate` | `lean-spec validate`                           |

## ⚠️ Core Rules

| Rule                                | Details                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **NEVER edit frontmatter manually** | Use `update`, `link`, `unlink` for: `status`, `priority`, `tags`, `assignee`, `transitions`, timestamps, `depends_on` |
| **ALWAYS link spec references**     | Content mentions another spec → `lean-spec link <spec> --depends-on <other>`                                          |
| **Track status transitions**        | `planned` → `in-progress` (before coding) → `complete` (after done)                                                   |
| **Keep specs current**              | Document progress, decisions, and learnings as work happens. Obsolete specs mislead both humans and AI                |
| **No nested code blocks**           | Use indentation instead                                                                                               |

### 🚫 Common Mistakes

| ❌ Don't                             | ✅ Do Instead                                |
| ----------------------------------- | ------------------------------------------- |
| Create spec files manually          | Use `create` tool                           |
| Skip discovery                      | Run `board` and `search` first              |
| Leave status as "planned"           | Update to `in-progress` before coding       |
| Edit frontmatter manually           | Use `update` tool                           |
| Complete spec without documentation | Document progress, prompts, learnings first |

## 📋 SDD Workflow

```
BEFORE: board → search → check existing specs
DURING: update status to in-progress → code → document decisions → link dependencies
AFTER:  document completion → update status to complete
```

**Status tracks implementation, NOT spec writing.**

## Spec Dependencies

Use `depends_on` to express blocking relationships between specs:
- **`depends_on`** = True blocker, work order matters, directional (A depends on B)

Link dependencies when one spec builds on another:
```bash
lean-spec link <spec> --depends-on <other-spec>
```

## When to Use Specs

| ✅ Write spec        | ❌ Skip spec                |
| ------------------- | -------------------------- |
| Multi-part features | Bug fixes                  |
| Breaking changes    | Trivial changes            |
| Design decisions    | Self-explanatory refactors |

## Token Thresholds

| Tokens      | Status               |
| ----------- | -------------------- |
| <2,000      | ✅ Optimal            |
| 2,000-3,500 | ✅ Good               |
| 3,500-5,000 | ⚠️ Consider splitting |
| >5,000      | 🔴 Must split         |

## Quality Validation

Before completing work, validate spec quality:
```bash
lean-spec validate              # Check structure and quality
lean-spec validate --check-deps # Verify dependency alignment
```

Validation checks:
- Missing required sections
- Excessive length (>400 lines)
- Content/frontmatter dependency misalignment
- Invalid frontmatter fields

## First Principles (Priority Order)

1. **Context Economy** - <2,000 tokens optimal, >3,500 needs splitting
2. **Signal-to-Noise** - Every word must inform a decision
3. **Intent Over Implementation** - Capture why, let how emerge
4. **Bridge the Gap** - Both human and AI must understand
5. **Progressive Disclosure** - Add complexity only when pain is felt

---

**Remember:** LeanSpec tracks what you're building. Keep specs in sync with your work!

---

## 🧱 技术栈（已冻结）

> **唯一真相来源**：[`stack-decision.md`](./stack-decision.md)（`status: decided`，全部维度已拍板）。
> 本节只是索引：**改技术栈 = 改 `stack-decision.md` 并追加该文件的 `## 变更记录`**，然后在 `specs/*/design.md` 里同步，不在代码里另立口径。

| 维度 | 结论 |
| --- | --- |
| 宿主基线 | DeepSeek Harness **0.2.0-rc.2**（`cordis-4` 插件 API）；rc.1 本机不可验证，已放弃 |
| 语言 / 构建 | **TypeScript** + **esbuild → CJS client bundle**（符合宿主 ModuleLoader 契约） |
| 前端 | **React 18**（`peerDependencies: ^18.2.0`，**不打进 bundle**）+ 宿主 `ui-primitives` + 宿主 `dsh-client-store` |
| 终端渲染 | 浏览器 `@xterm/xterm` + `@xterm/addon-fit`（**独立懒加载 chunk**）；Host `@xterm/headless` + serializer |
| 终端内核 | `ctx.subprocess.spawnTerminal`（真 PTY：`argv` + `cwd` + `env` + `rows/cols/terminalType`）—— 不复用官方 `terminal`，不 require 私有 `node-pty` |
| 配置字段（profile） | `name` + `command` + `args` + `env`；路径**两个字段**：`cwd`（Windows 路径）+ `cwdLinux`（WSL 路径）—— `E:\x` 与 `/mnt/e/x` 语义不同，两字段无歧义 |
| Agent 工具面 | 完整族 `new` / `list` / `read` / `write` / `resize` / `kill`，经 `dsh-tools` 的 `defineTool` 注册 |
| Agent 读模型 | 屏幕快照 **+** 增量流**两者都给** → 派生「Host 侧必须持有屏幕模型」 |
| 前后端通道 | 自建 `ctx.webServer` 具名路由（**HTTP 用 `prefix`**）+ WebSocket upgrade（**仅支持 `exact` path**，多终端靠协议层会话 id 复用单一端点），**独占前缀**（不用官方 Typert Remote）；重复 `(kind, path)` 注册会抛错 → 必须登记 effect-scoped disposer |
| 右栏页类型 | 新 kind `managedTerminal` + 宿主默认 extension 档（与官方 6 个 kind 全部区分） |
| 配置存储 | profile 层 `cordis.patch.yml`；**声明 = 模块静态 `Config` 导出 + patch 条目 id 作命名空间**；**live 字段经 `ctx.settings.{update,replace,mutate}`**（**不重挂载**），完整配置才用 `ctx.configEditor.edit()`（**会重挂载**）—— **两服务互补非管道**；🔴 `ctx.settings.register` 在 0.2.0-rc.2 **已移除**（**不手写 YAML**）。层序（真机 profile 根注释）：bundle 层 → `cordis.patch.yml` → `--patch` 覆盖层（**本机无 home 层**）；patch 是顶层 YAML 数组，元素为 `- id` + `config:` / `- id` + `disabled` / `- insert:`；存活开关在**清单**里 —— `profiles/<name>/package.json` 的 `dsh.profile.patchReload = "live"`（不在 yml 里）|
| 配置存活 | 整个 `profiles` 数组 `.volatile()`（**只在固定对象路径生效**；标进数组元素内 **parse 时**抛 `ValidationError`，不是构造时）；解析结果为**带 `.get()` 的深冻结对象**（**读配置必须走 `.get()`**，下标取值是 `undefined`）；🔴 **schema 必须 Schemastery** —— `isSchemastery()` 判的是 `schema['~standard'].vendor === 'schemastery'`，用 Zod 会让 volatile **静默失效**。**2026-10-08 真机**：live 写入 152ms 生效且**不重挂载**（值经 `.get()` 真传播）、ordinary 字段**真 remount** ⇒ 判定非恒真；**落盘已闭环** —— `settings.documentPath` 读出 settings 文档**就是** profile 的 `cordis.patch.yml`（`writable=true`），`update` 后 3s 文件已更新（**立即落盘**）、重启后值正常加载 ⇒ 「不重挂载」+「改完不丢」双证。⚠️ **同一文件既是 patch 层又是 settings 落盘处**，手写它会与 settings 写入互相覆盖 |
| 提权 | `none` / `ask` / `passby`，**默认 `none`**；临时 `.ps1` + `Start-Process -Verb RunAs`，输出经**临时文件**回传 |
| 沙箱 | `ctx.sandboxPolicy`（与官方 bash / 文件系统**同一份**策略，不另起一套） |
| 端口所有权 | **声明式**：配置里的 `managedPorts` 集合界定所有权，集合外规则一律不碰（不建台账文件、不用 `reset`） |
| 端口作用域 | 本机 / 局域网**逐端口可切**，**默认 loopback**，局域网为逐端口显式 opt-in（原脚本 `0.0.0.0` + 防火墙全量放行 = 真实攻击面） |
| 分期边界（组件②） | **P0** 只读展示 + 转发可视化 + eth0 漂移检测 + UAC 提权 + **端口声明（区间 + presets，2026-10-08 D-3 提到 P0）** + **目标发行版解析/显示/切换（2026-10-08 D-4 提到 P0）**；**P1** 容器启停/重启 + 日志 + 完整配置页（scope/elevationPolicy；`distro` 已在 P0）；**下一期**进容器 exec / compose / 镜像管理（Spec 只预留注入点）；**明示不支持 UDP 转发**（portproxy 本身不支持） |
| 后端 7 维 | `framework` / `orm` / `db` / `migration` / `auth` / `ai` = **none**（无独立服务端、无数据库）；仅 `backend.test = vitest` |
| 布局 | **pnpm workspace**：`packages/{wsl-shared, terminal-profiles, wsl-docker-ports}`（1 个非插件共享包 + 2 个插件包，L3 生命周期隔离） |
| 跨包服务 | 组件② 经 `ctx.inject(['managedTerminal'], …)` **可选消费**组件① 的服务；**不建包依赖边**（建了就毁掉 L3）；组件① 不在 → 按钮置灰 + 写明原因，回调不触发、不报错。**仅用于「下一期」的进容器 exec —— P0/P1 不依赖组件①** |
| 测试 | `vitest`（单元）+ `node --test`（真机 fixture 离线契约）+ **chrome-devtools MCP 真机验收**；**不用** Playwright / `harness/verify-e2e.sh` / 视觉对照 |
| 环境 | Windows + WSL2（发行版 **`Ubuntu2204`**，由 `wsl -l -v` 自动发现，**不手打**）；内网/离线可用（有 npm 私有镜像，不依赖 npx / CDN） |

**包名**：无 scope —— `dsh-wsl-shared` / `dsh-terminal-profiles` / `dsh-wsl-docker-ports`；`link:` 交付不需要 npm 账号，**发布前需定 scope 并批量改名**（三包 `package.json` + cordis 行 `name` + profile patch + 测试断言）。

**硬前提**：组件②（WSL Docker 端口转发）要求 **NAT 网络模式** —— mirrored 下 eth0 语义改变、规则会指向失效地址；非 NAT 时 UI 置灰 + 给修复指引，**不自动改** `.wslconfig`。

**真机事实（2026-10-08 实测，五份 Spec 的事实基础）**

| 项 | 实测值 |
| --- | --- |
| Windows / WSL | Windows 11 23H2（10.0.22631.5335）/ WSL **2.7.3.0** |
| 发行版 | **`Ubuntu2204`**（用户示例里的 `-d Ubuntu` 本机不存在）|
| `.wslconfig` | 仅 `[wsl2] localhostForwarding=true` → **NAT 缺省**，符合硬前提 ✅ |
| WSL 内 docker | `/usr/bin/docker`，server **29.5.3**（引擎装在 WSL 内，**非** Docker Desktop）|
| WSL eth0 | `172.20.201.152`（2026-10-08 实测；与 19 条规则 connectaddress 一致 = **尚未漂移**）。**漂移（同日 T0.2 实测反证）**：单发行版 `--terminate` 与整台 `--shutdown` **两种重建都不换 IP**（前者 `PID1` 变而 `btime` 不变，后者 `btime`/`boot_id` 都变，eth0 两次都不变）⇒ 本机**不可复现**；REQ-6 保留为**安全网**，但**不做**心跳/守护/storage —— 「激活 + 刷新各查一次」+ **写入前强制现读** 即足够。⚠️ 网关 `172.20.192.1` 是 **Windows 自己的地址**，ping 它**连 WSL 全停都通**（实测）⇒ 不可当存活信号；重建信号用 `vmmemWSL` 的 CIM `CreationDate`（真名**无 `.exe`**，写成 `'vmmemWSL.exe'` 会 0 命中）|
| 现有 portproxy | **19 条** `0.0.0.0:<port> → 172.20.201.152`，**就是原脚本的产物**（已手工跑过一次）|
| DSH 进程管理员 | **False** → `netsh portproxy add` / `New-NetFirewallRule` 必须走 UAC 辅助进程 |
| 原脚本 5 个坑 | ① `portproxy reset` 清空**全部**规则（含他人）② `0.0.0.0` + 防火墙全量放行，19 个端口暴露给局域网（含 `5432`/`6379`/`5000-5003`）③ 硬编码 19 个端口，不知道 docker 实际映射了什么 ④ `connectaddress` 写成 eth0 IP → WSL 重启后**静默失效** ⑤ portproxy 不支持 UDP |
| WSL/docker 实测成本与坑（2026-10-08）| `wsl -d` 热 **~200ms**、**冷启动 11–12s**（且每次调用都阻止发行版空闲回收，`vmmemWSL` 实测占 **2,180 MB**）→ 自动探测必须门控；`docker ps --format json` **会挂住**（rc=124 两次）→ 必须 `--format '{{json .}}'` **且加硬超时**；`vmmemWSL` 真名**无 `.exe`**，其 CIM `CreationDate` == 发行版 `btime`；**编码指纹（T0.1 实测）**：`wsl -l -v` = **UTF-16LE** + 行尾 **LF** + 表头**英文**（而 `wsl --version` 表头是**中文** ⇒ 同工具不同子命令本地化不一致，解析器不得依赖表头字面量）、`netsh … show v4tov4` = **纯 ASCII** + **CRLF**（「OEM/GBK 中文表头」假设已被推翻）；**唤醒后第一次 `docker ps` 会被硬超时砍掉**（0 输出；5 s 后第二次 637 ms 成功）⇒ 必须超时 + 重试，不得把空输出当「没有容器」 |

**Spec 类型**：**五份** Spec 均为**需求驱动**（先 REQ-N + EARS，再由需求派生 `design.md`）。
**004 于 2026-10-08 从 002 拆出**：Agent 工具面独立成篇（**同包不拆包** —— 两 Spec 的产物都在 `packages/terminal-profiles/`，共享 `session-manager` / `screen-model`）；002 的 **REQ-8/9 与 Phase 5 保留为空位**，以免全部既有引用错位。拆分原因：002 的 `requirements.md` / `design.md` 拆前各 **199 行**，贴着 warn 阈值 200。
**005 于 2026-10-08 从 003 拆出**：提权写路径独立成篇（**同包不拆包** —— 两 Spec 的产物都在 `packages/wsl-docker-ports/`；003 拥有 `read/` `diff/` `ui/`，005 拥有 `write/` `elevate/`）。**003 的 REQ-4/5/7/8/13 与 NFR-1/3、Phase 4 保留为空位**；`depends_on` 只有 **005 → 003**（反向是同包内代码调用，不建边以免成环）。拆分原因：003 拆前 **199 / 195 / 191 / 165** 行，`requirements.md` 与 `design.md` 双双贴线；且写路径是唯一能改动用户系统状态的部分，需要独立的安全验收（红线断言 + 「他人规则条数不变」）。

## 🚧 开工前置（阻塞项，未打掉不得进实现）

| # | 阻塞项 | 归属 |
| --- | --- | --- |
| ~~B-1~~ | ~~`z.array(...).volatile()` 数组路径真机行为链~~ → ✅ **2026-10-08 五条全部定案**：机制（源码）+ 第 4/5 条（离线：元素内标 volatile 在 **parse 时**抛 `ValidationError`；数组级解析为带 `.get()` 的**深冻结**对象）+ 第 1/2/3 条（**真机**：live 写入 152ms 生效、**不重挂载**且 `.get()` **值真传播**；ordinary 字段**真 remount**；非法值静默拒绝不崩）。方法：临时 profile `volatile-probe` + 一次性探针插件（`--port 0`，不碰在跑的实例）。⚠️ 未命中项：`_commitVolatile()` 失败回落 remount 的分支未复现；落盘语义**当日已定案（闭环，非问题）** → T0.6 / A-6 | 002 |
| ~~B-2~~ | ~~6 项 `backend.*` 的 `confirmed: implied` 待主人逐条点头~~ → ✅ **2026-10-08 已确认全为 `none`，本项清除**（SSoT 34 维现已全部 `confirmed: true`）| 全线 |
| ~~B-3~~ | ~~自建路由前缀的独占性（不被官方 SPA fallback 抢走）~~ → ✅ **2026-10-08 源码定案：不会被抢**（匹配顺序 exact → 最长 prefix → fallback；fallback 单座位、只答无具名路由匹配的请求）。⚠️ 同时发现 **upgrade 只支持 exact path** → REQ-7.1 已修正 | 002 |

进展与验证方法见 `specs/*/tasks.md` 的 **Phase 0**。

## ⚠️ 本机 CLI 现状（与上文命令表的差异）

`lean-spec` 与 `leanspec` 两个 shim 都可用，但本机这一版有 **8 个子命令尚未迁移**，会报 *not yet migrated to the adapter API*（2026-10-08 实测）：
`analyze` / `check` / `children` / `deps` / `files` / `gantt` / `tokens` / `validate`。

- 已实测可用的检查手段：`leanspec board` / `list` / `view <spec>` / `stats` / `capabilities` / `templates`；行数阈值见 [`.lean-spec/config.json`](./.lean-spec/config.json)（warn 200 / max 400），依赖与引用一致性用本地脚本核对。
- 建 Spec：`leanspec create <name> -f <body.md>`（正文一次性写入，frontmatter 由 CLI 生成）；状态流转用 `leanspec update <spec> --status <status>`，**不手改 frontmatter**。
- 🚨 **`leanspec crystallize` 会整体覆盖 `AGENTS.md`**（实测：把本文件替换成一段 `<!-- BEGIN crystallize:generated -->` 块，并额外写入 `.claude/skills/*.md`）。**跑它之前先备份本文件** —— 本仓库尚未 `git init`，覆盖了没有版本历史可回滚。
- 🔴 **MCP `update` 对 `status` 是空操作**（2026-10-08 实测：`mcp__leanspec__update_spec` 传 `status: planned` 只刷新 `updated_at`，frontmatter 字段**不变**）⇒ **状态流转一律用 CLI** `leanspec update <spec> --status <status>`（CLI 同时自动追加 `transitions` 记录）。MCP 的**只读**工具（`list_specs` / `get_spec` / `board` / `stats`）正常。
- 🔴 **leanspec MCP server 的项目根 = 该 server 进程的 cwd**（其 Rust 二进制没有 `--root` / `--project` 选项，只读 `LEANSPEC_SPECS_DIR`），而本机 DSH app 的 cwd **不是**本工作区 ⇒ 直接写 `npx -y @leanspec/mcp` 会**永远返回 0 个 spec**。已在 `~/.dsh/profiles/desktop/cordis.patch.yml` 改成 `command: cmd` + `args: ["/c","cd","/d","E:\\NodeProjects\\dsh-wsl-toolkit","&&","npx","-y","@leanspec/mcp"]`（`patchReload: live` 热生效，无需重启 app）。⚠️ `dsh-mcp-manager` **只有 add / enable / restart，没有「改」**，且 add 拒绝同名 ⇒ 改这条配置只能手改该 yml（改完别让管理器写回）。另：server 进程若早于 `.lean-spec/` 创建而启动，即使 cwd 正确也必须重启它才会看到项目。
