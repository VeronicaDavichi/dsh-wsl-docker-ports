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
| **导出预算只计运行时导出**          | 类型导出（`export type` / `interface`）编译后被完全擦除 ⇒ **不计入**「≤ 12 导出」的预算，由自检脚本单独统计并打印。类型总量的**软阈值 25**（**2026-10-08 主人同日二次拍板 20 → 25**：Phase 4 后实测运行时 7/12 ✅、类型 15 —— 而 15 个类型逐个都有消费方，故提阈值留痕而非砍类型/拆包）。**2026-10-08 主人拍板**；SSoT = [001 requirements.md](./specs/001-wsl-shared/requirements.md) 的 REQ-6.4（含两次订正留痕）|
| **代码体积不算注释**                | 体积 = **去注释、去空行**后的 UTF-8 字节数（≤ **40KB** 是**软指标**，超限只告警，不静默放过；判定与告警**按字节**，不用四舍五入后的 KB）；单文件 ≤ 400 行是 SHALL、按**原始**行数算（可读性指标，与体积故意分开）。**2026-10-08 主人三次拍板：15KB → 25KB → 40KB**（末次原话：「**40KB，再超了就是你的代码有问题或者 spec 拆分有问题**」⇒ 40KB 是宽裕到没有借口的额度，**此后不许再抬阈值**：告警先自证不是代码膨胀、也不是 Spec 拆分不当）。复算 `pnpm check:size`，口径 SSoT = [001 tasks.md](./specs/001-wsl-shared/tasks.md) 的校验门行 |
| **指标必须可复算**                  | 任何「软指标 / 预算 / 阈值」都要有脚本能当场算出数（现为 `pnpm check:exports` + `pnpm check:size` + `pnpm check:scope`；后者是 001 T6.2 的准入回归门 —— 剥注释后扫越界领域词汇，**范围严格等于 T6.2 的字面判据**，不夹带额外检查）；**不许各自解释口径**，改口径 = 改 Spec + 追加留痕 |

### 🚫 Common Mistakes

| ❌ Don't                             | ✅ Do Instead                                |
| ----------------------------------- | ------------------------------------------- |
| Create spec files manually          | Use `create` tool                           |
| Skip discovery                      | Run `board` and `search` first              |
| Leave status as "planned"           | Update to `in-progress` before coding       |
| Edit frontmatter manually           | Use `update` tool                           |
| Complete spec without documentation | Document progress, prompts, learnings first |
| 以为装了依赖用 `--lockfile=false` 就能不动 `pnpm-lock.yaml` | **依赖变更后必须跑 `pnpm install` 并复验 `pnpm install --frozen-lockfile` exit 0**（2026-10-09 实测：pnpm 11 `verify-deps-before-run` **默认开启**，任何一次 `pnpm run <script>` 前都会自动 install 并写回 lockfile ⇒ 只改 `package.json` 就必然改 lockfile；回滚 lockfile 反而制造不一致，`--frozen-lockfile` 会直接失败）|

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
| 终端渲染 | 浏览器 `@xterm/xterm` + `@xterm/addon-fit`（**独立懒加载 chunk**：官方终端页实证 —— 主 bundle **19,887 B** + `require.async("./client.terminal.js")` 取 **685,949 B** 的 chunk，xterm **内联在 chunk 里**、chunk 不在 `exports` 里；见 [`client-contract.md`](./client-contract.md) §P2）；Host `@xterm/headless` + serializer |
| 终端内核 | `ctx.subprocess.spawnTerminal`（真 PTY：`argv` + `cwd` + `env` + `rows/cols/terminalType`）—— 不复用官方 `terminal`，不 require 私有 `node-pty` |
| 配置字段（profile） | `name` + `command` + `args` + `env`；路径**两个字段**：`cwd`（Windows 路径）+ `cwdLinux`（WSL 路径）—— `E:\x` 与 `/mnt/e/x` 语义不同，两字段无歧义 |
| Agent 工具面 | 完整族 `managed_terminal_new` / `managed_terminal_list` / `managed_terminal_read` / `managed_terminal_write` / `managed_terminal_resize` / `managed_terminal_kill`（**2026-10-09 主人二次裁定**：原裸名与宿主内建 `read`/`write` 撞名；`terminal_` 一次裁定被官方 `dsh-tool-terminal` 证伪），经 `dsh-tools` 的 `defineTool` 注册 |
| Agent 读模型 | 屏幕快照 **+** 增量流**两者都给** → 派生「Host 侧必须持有屏幕模型」 |
| 前后端通道 | 自建 `ctx.webServer` 具名路由（**HTTP 用 `prefix`**）+ WebSocket upgrade（**仅支持 `exact` path**，多终端靠协议层会话 id 复用单一端点），**独占前缀**（不用官方 Typert Remote）；重复 `(kind, path)` 注册会抛错 → 必须登记 effect-scoped disposer |
| 右栏页类型 | 新 kind `managedTerminal`，`priority` **留空**（= 宿主默认 extension 档）。**2026-10-09 订正**：kind 是**开放字符串**（无枚举类型），0.1.7-rc.2 实测 **9 个**（`guide`/`files`/`browser`/`text`/`changes-review`/`terminal`/`scheduleTask`/`plan`/`subagentchat`）⇒ 判据 = **不与官方已用 kind 重名**（`managedTerminal` 未被占用 ✅）；官方 `terminal` 页自己用 `priority: "builtin"`，第三方**必须**留空或写 `extension` |
| 配置存储 | profile 层 `cordis.patch.yml`；**声明 = 模块静态 `Config` 导出 + patch 条目 id 作命名空间**；**live 字段经 `ctx.settings.{update,replace,mutate}`**（**不重挂载**），完整配置才用 `ctx.configEditor.edit()`（**会重挂载**）—— **两服务互补非管道**；🔴 `ctx.settings.register` 在 0.2.0-rc.2 **已移除**（**不手写 YAML**）。层序（真机 profile 根注释）：bundle 层 → `cordis.patch.yml` → `--patch` 覆盖层（**本机无 home 层**）；patch 是顶层 YAML 数组，元素为 `- id` + `config:` / `- id` + `disabled` / `- insert:`；存活开关在**清单**里 —— `profiles/<name>/package.json` 的 `dsh.profile.patchReload = "live"`（不在 yml 里）|
| 配置存活 | 整个 `profiles` 数组 `.volatile()`（**只在固定对象路径生效**；标进数组元素内 **parse 时**抛 `ValidationError`，不是构造时）；解析结果为**带 `.get()` 的深冻结对象**（**读配置必须走 `.get()`**，下标取值是 `undefined`）；🔴 **schema 必须 Schemastery** —— `isSchemastery()` 判的是 `schema['~standard'].vendor === 'schemastery'`，用 Zod 会让 volatile **静默失效**。**2026-10-08 真机**：live 写入 152ms 生效且**不重挂载**（值经 `.get()` 真传播）、ordinary 字段**真 remount** ⇒ 判定非恒真；**落盘已闭环** —— `settings.documentPath` 读出 settings 文档**就是** profile 的 `cordis.patch.yml`（`writable=true`），`update` 后 3s 文件已更新（**立即落盘**）、重启后值正常加载 ⇒ 「不重挂载」+「改完不丢」双证。⚠️ **同一文件既是 patch 层又是 settings 落盘处**，手写它会与 settings 写入互相覆盖 |
| 提权 | `none` / `ask` / `passby`，**默认 `none`**；后端链 = **用户自装 `gsudo`（stdio 回传，提权失败 exit code **999**；缓存活跃则回落）→ `Start-Process -Verb RunAs`（临时文件回传）**；Windows 自带 `sudo`（**24H2+**，默认模式拿不到输出）仅显式配置时用；**Agent 触发一律降级为 `ask`**；**不装工具、不改 PATH、不动用户 gsudo 配置** |
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

**真机事实（2026-10-08 实测，六份 Spec 的事实基础）**

| 项 | 实测值 |
| --- | --- |
| Windows / WSL | Windows 11 23H2（10.0.22631.5335）/ WSL **2.7.3.0** |
| 发行版 | **`Ubuntu2204`**（用户示例里的 `-d Ubuntu` 本机不存在）|
| `.wslconfig` | **32 字节、无 BOM、行尾 CRLF、无尾换行**，仅 `[wsl2] localhostForwarding=true` → **NAT 缺省**，符合硬前提 ✅。⚠️ 路径解析陷阱（实测）：`USERPROFILE=''` 时 `??` **不回落**到 `os.homedir()`，而 `path.join('', '.wslconfig')` 是**相对路径**（会读工作目录下的同名文件）；且该情形下 `os.homedir()` **自己会抛** `ERR_SYSTEM_ERROR` ⇒ 必须 `?.trim() ||` + try/catch + **绝对路径校验** |
| WSL 内 docker | `/usr/bin/docker`，server **29.5.3**（引擎装在 WSL 内，**非** Docker Desktop）|
| WSL eth0 | `172.20.201.152`（2026-10-08 实测；与 19 条规则 connectaddress 一致 = **尚未漂移**）。**漂移（同日 T0.2 实测反证）**：单发行版 `--terminate` 与整台 `--shutdown` **两种重建都不换 IP**（前者 `PID1` 变而 `btime` 不变，后者 `btime`/`boot_id` 都变，eth0 两次都不变）⇒ 本机**不可复现**；REQ-6 保留为**安全网**，但**不做**心跳/守护/storage —— 「激活 + 刷新各查一次」+ **写入前强制现读** 即足够。⚠️ 网关 `172.20.192.1` 是 **Windows 自己的地址**，ping 它**连 WSL 全停都通**（实测）⇒ 不可当存活信号；重建信号用 `vmmemWSL` 的 CIM `CreationDate`（真名**无 `.exe`**，写成 `'vmmemWSL.exe'` 会 0 命中）|
| 现有 portproxy | **19 条** `0.0.0.0:<port> → 172.20.201.152`，**就是原脚本的产物**（已手工跑过一次）|
| DSH 进程管理员 | **False** → `netsh portproxy add` / `New-NetFirewallRule` 必须走 UAC 辅助进程 |
| 提权工具链（2026-10-09 只读核验）| **`gsudo` v2.6.1 已装且在 PATH**（`D:\Program Files\gsudo\Current`）。🔴 **2026-10-09 真机推翻我的旧结论**：本机 `ConsentPromptBehaviorAdmin = 0`（Elevate without prompting）⇒ **提权根本不弹 UAC**（`Get-Process consent` = 0；代理零人工交互完成了真写+真删）—— 「每次弹 UAC」是我按 gsudo 缓存语义**外推**的错误，已作废。同时实测：`backend.ts:68` 的正则 `/Available\s*:\s*(True|False)/` **不匹配** gsudo v2.6.1 的真实行 `Available for this process: False` ⇒ **生产链静默回落 `native`，gsudo 分支走不到**；`elevationAvailable` 在 `plugin.ts:251` 是 `?? (async () => false)` 硬编码兜底 ⇒ UI 会把提权入口置灰而机器其实能提权；**`%SystemRoot%\System32\sudo.exe` 不存在**（23H2）；🔴 **`Get-Command sudo -All` 唯一命中的是 gsudo 自带的 `sudo.exe`**（ProductName=gsudo 2.6.1）⇒ **后端探测必须按路径/产品名（`where.exe gsudo`），绝不按命令名 `sudo`**，否则会误判进 `winsudo` 分支 |
| 原脚本 5 个坑 | ① `portproxy reset` 清空**全部**规则（含他人）② `0.0.0.0` + 防火墙全量放行，19 个端口暴露给局域网（含 `5432`/`6379`/`5000-5003`）③ 硬编码 19 个端口，不知道 docker 实际映射了什么 ④ `connectaddress` 写成 eth0 IP → WSL 重启后**静默失效** ⑤ portproxy 不支持 UDP |
| WSL/docker 实测成本与坑（2026-10-08）| `wsl -d` 热 **~200ms**、**冷启动 11–12s**（且每次调用都阻止发行版空闲回收，`vmmemWSL` 实测占 **2,180 MB**）→ 自动探测必须门控；`docker ps --format json` **会挂住**（rc=124 两次）→ 必须 `--format '{{json .}}'` **且加硬超时**；`vmmemWSL` 真名**无 `.exe`**，其 CIM `CreationDate` == 发行版 `btime`；**编码指纹（T0.1 实测）**：`wsl -l -v` = **UTF-16LE** + 行尾 **CRLF** + 表头**英文**（而 `wsl --version` 表头是**中文** ⇒ 同工具不同子命令本地化不一致，解析器不得依赖表头字面量）、`netsh … show v4tov4` = **纯 ASCII** + **CRLF**（「OEM/GBK 中文表头」假设已被推翻）。⚠️ **行尾 CRLF 系 2026-10-09 订正**（原记 LF；fixture 尾部 `32 00 0d 00 0a 00`，探针三次实时捕获一致；**无功能缺陷** —— REQ-1.2 本就要求容忍 CRLF，已由 `packages/wsl-shared/tests/contract/distros.test.ts` 的字节事实用例钉死）；**唤醒后第一次 `docker ps` 会被硬超时砍掉**（0 输出；5 s 后第二次 637 ms 成功）⇒ 必须超时 + 重试，不得把空输出当「没有容器」 |

**Spec 类型**：**六份** Spec 均为**需求驱动**（先 REQ-N + EARS，再由需求派生 `design.md`）。
**004 于 2026-10-08 从 002 拆出**：Agent 工具面独立成篇（**同包不拆包** —— 两 Spec 的产物都在 `packages/terminal-profiles/`，共享 `session-manager` / `screen-model`）；002 的 **REQ-8/9 与 Phase 5 保留为空位**，以免全部既有引用错位。拆分原因：002 的 `requirements.md` / `design.md` 拆前各 **199 行**，贴着 warn 阈值 200。
**005 于 2026-10-08 从 003 拆出**：提权写路径独立成篇（**同包不拆包** —— 两 Spec 的产物都在 `packages/wsl-docker-ports/`；003 拥有 `read/` `diff/` `ui/`，005 拥有 `write/` `elevate/`）。**003 的 REQ-4/5/7/8/13 与 NFR-1/3、Phase 4 保留为空位**；`depends_on` 只有 **005 → 003**（反向是同包内代码调用，不建边以免成环）。拆分原因：003 拆前 **199 / 195 / 191 / 165** 行，`requirements.md` 与 `design.md` 双双贴线；且写路径是唯一能改动用户系统状态的部分，需要独立的安全验收（红线断言 + 「他人规则条数不变」）。
**006 于 2026-10-09 从 001 拆出**：路径翻译独立成篇（**同包不拆包** —— 代码仍在 `packages/wsl-shared/src/pathmap.ts`，`index.ts` 照旧导出 `winToWsl` / `wslToWin`，导出预算仍记在 001）。**001 的 REQ-3 与 Phase 4 保留为空位**；**编号一律保持**（REQ-3.1–3.7 / T4.1–T4.4）—— 与 004/005 的「重编号」不同，因为 `pathmap.ts` 与它的 87 条单测里已有 **20+ 处**按编号追溯。`depends_on`：**006 → 001**（复用 `errors.ts` 的错误模型）；002 → 006 的边**已于 2026-10-09 手工补上**（无工具路径，主人授权，见文末「本机 CLI 现状」）。拆分原因：001 的 `tasks.md` 在 Phase 5 后 **198 行**（warn 200），Phase 6 收口还要写；且路径翻译是**零文件系统、零进程、零宿主**的纯字符串面，独立验收边界清晰。

**007 于 2026-10-09 从 002 拆出**：终端**配置页**独立成篇（**同包不拆包** —— 产物都在 `packages/terminal-profiles/`；002 拥有配置模型 `parseProfiles`/`.volatile()` 语义、客户端骨架与终端会话（Phase 1–5/7、REQ-1/2/3/4/11），007 拥有配置页 UI + live 写入管道 + 只读/冲突态（Phase 6、REQ-10、§2.2、design §4））。**002 的 REQ-10 与 Phase 6 保留为空位**；**编号一律保持**（`REQ-10.1–10.5` / `T6.1–T6.4`）。`depends_on`：**007 → 002**（建 Spec 时写入；反向是同包内调用，不建边以免成环）。拆分原因：002 的 `tasks.md` 达 **219 行**（warn 200）、`design.md` 恰 **200 行**贴线；配置页的验收边界（只读态 / revision 冲突 / volatile-only 确认 / 语义文案）与会话验收互不依赖。另：002 的**整包**质量门 `T7.3` 留在 002（记整包用例数与产物体积）。

## 🚧 开工前置（阻塞项，未打掉不得进实现）

| # | 阻塞项 | 归属 |
| --- | --- | --- |
| ~~B-1~~ | ~~`z.array(...).volatile()` 数组路径真机行为链~~ → ✅ **2026-10-08 五条全部定案**：机制（源码）+ 第 4/5 条（离线：元素内标 volatile 在 **parse 时**抛 `ValidationError`；数组级解析为带 `.get()` 的**深冻结**对象）+ 第 1/2/3 条（**真机**：live 写入 152ms 生效、**不重挂载**且 `.get()` **值真传播**；ordinary 字段**真 remount**；非法值静默拒绝不崩）。方法：临时 profile `volatile-probe` + 一次性探针插件（`--port 0`，不碰在跑的实例）。⚠️ 未命中项：`_commitVolatile()` 失败回落 remount 的分支未复现；落盘语义**当日已定案（闭环，非问题）** → T0.6 / A-6 | 002 |
| ~~B-2~~ | ~~6 项 `backend.*` 的 `confirmed: implied` 待主人逐条点头~~ → ✅ **2026-10-08 已确认全为 `none`，本项清除**（SSoT 34 维现已全部 `confirmed: true`）| 全线 |
| ~~B-3~~ | ~~自建路由前缀的独占性（不被官方 SPA fallback 抢走）~~ → ✅ **2026-10-08 源码定案：不会被抢**（匹配顺序 exact → 最长 prefix → fallback；fallback 单座位、只答无具名路由匹配的请求）。⚠️ 同时发现 **upgrade 只支持 exact path** → REQ-7.1 已修正 | 002 |

进展与验证方法见 `specs/*/tasks.md` 的 **Phase 0**。

## ⚠️ 本机 CLI 现状（与上文命令表的差异）

`lean-spec` 与 `leanspec` 两个 shim 都可用，但本机这一版有 **9 个子命令尚未迁移**，会报 *not yet migrated to the adapter API*（2026-10-08 实测；**2026-10-09 复测新增 `rel`**）：
`analyze` / `check` / `children` / `deps` / `files` / `gantt` / `rel`（`link` / `unlink` 的替代命令） / `tokens` / `validate`。

🔴 **跑探针实例的语法（2026-10-09 实测踩坑）**：`dsh --profile <name> --port N --no-open` —— **不是** `dsh --profile <name> web …`（`dsh web` 里的 `web` 是 **profile 名**，写成子命令会报 `error: too many arguments. Expected 0 arguments but got 1: web`，进程照起但**不监听** ✗）。另：**全新 profile 在离线/内网下起不来**（首次启动要装基础 bundle，会长期不监听 ✗）⇒ 探针请用已装好基础 bundle 的 profile；`volatile-probe` 里那个 B-1 探针插件会在探测结束后**自己 SIGINT 退出**（正常行为，别当成崩溃）。

- 🔴 **依赖边只在「建 Spec 时」写得进去**：`leanspec create --depends-on` 可用，但**事后加边没有任何工具路径** —— `link` / `rel` 未迁移、MCP `update_spec` 的字段里没有 `depends_on`、`update` 也没有该选项 ⇒ 事后新增依赖边只能**手改 frontmatter（违反硬规则）**或等 CLI 升级。**2026-10-09 复测加证**：MCP `update_spec` 传 `depends_on` → `validation failed: unknown field 'depends_on' on schema 'leanspec:markdown'`（此时 MCP 的根目录**已修好**，见下条 ⇒ 不是 0-spec 假象）；显式给 `--specs-dir`（相对 + 绝对）、改用目录路径、去掉 `add` 子命令 —— 四种写法**全部**同一句错误 ⇒ 确认是**命令层未实现**，与 cwd / git / specsDir 都无关。
  - ✅ **处置（2026-10-09，主人授权「手工」）**：无工具路径这一条**确认成立**后，主人裁定**手工补边**。边界写死：**只允许改 `depends_on` 列表**（加/删一行），**绝不碰** `status` / `transitions` / 时间戳（那些是工具专属）。本次据此在 `specs/002-terminal-profiles/README.md` 加了一行 `- 006-path-translation`。
  - ✅ **复核通过**：MCP `get_dependencies` → `["001-wsl-shared","006-path-translation"]`；CLI `view` → `Depends on: 001-wsl-shared, 006-path-translation` ⇒ **已知缺口 `002 → 006` 已关闭**。
  - ✅ **「手改会不会被 CLI 吃掉」已实验证明不会**：对 002 与 006 各跑一次 CLI 写 → frontmatter **确实被整体重写**（文件 hash 变化），但 **`depends_on` 逐行幸存**；同名状态写入**不追加 transition**，只 bump `updated_at` ⇒ 将来 `--status in-progress` 不会静默吃掉这条边。**结论：`depends_on` 手改是「无工具路径」下的唯一例外，改完必须复核。**

- 已实测可用的检查手段：`leanspec board` / `list` / `view <spec>` / `stats` / `capabilities` / `templates`；行数阈值见 [`.lean-spec/config.json`](./.lean-spec/config.json)（warn 200 / max 400），依赖与引用一致性用本地脚本核对。
- 建 Spec：`leanspec create <name> -f <body.md>`（正文一次性写入，frontmatter 由 CLI 生成）；状态流转用 `leanspec update <spec> --status <status>`，**不手改 frontmatter**。
- 🚨 **`leanspec crystallize` 会整体覆盖 `AGENTS.md`**（实测：把本文件替换成一段 `<!-- BEGIN crystallize:generated -->` 块，并额外写入 `.claude/skills/*.md`）。**跑它之前先确认工作区干净** —— 本仓库**已是 git 仓库**（2026-10-08 起，`main` 分支有提交），覆盖后可 `git checkout -- AGENTS.md` 回滚；但**未提交**的改动仍会丢。
- 🔴 **MCP 写 `status` 一律无效**（**2026-10-09 在 MCP 根目录已修好后复测**：`create_spec` 传 `status: planned` → 落盘**仍是 `draft`**；`update_spec` 传 `status: in-progress` → 落盘**不变**，只有 `updated_at` 会动 ⇒ 这**不是**「MCP 只看到 0 个 spec」造成的假象）⇒ **状态流转一律用 CLI** `leanspec update <spec> --status <status>`（CLI 同时自动追加 `transitions` 记录）。MCP 的**只读**工具（`list_specs` / `get_spec` / `get_dependencies` / `stats`）正常，写入类工具只有 `title` / `content` / `created` 这类字段真落盘。
- 🔴 **leanspec MCP server 只按「进程 cwd」认项目根**（2026-10-09 三组对照实测：cwd = 本工作区 → `list_specs` **6 个** ✅；cwd = `C:\Users\EDY` → **0 个**；cwd = home 且 **`LEANSPEC_SPECS_DIR` = 本仓库 `specs`** → **仍然 0 个** ⇒ **该环境变量不被采用，旧口径「只读 `LEANSPEC_SPECS_DIR`」已推翻**）。Rust 二进制没有 `--root` / `--project` 选项 ⇒ 唯一解法是**把它的 cwd 钉到本工作区**：`~/.dsh/profiles/desktop/cordis.patch.yml` 的 `mcp-leanspec` 条目里加 **`cwd: 'E:\NodeProjects\dsh-wsl-toolkit'`**（DSH 的 `dsh-mcp-client` **支持 `cwd` 字段** ✅；实测 `list_specs` **0 → 6**）。生效必须**重启该 server**（`mcp_manager_restart` 之后工具名会短暂报 `unknown tool`，约 10 s 恢复）。⚠️ 旧写法（`command: cmd` + `args: ["/c","cd","/d",…,"&&","npx",…]`）**已被 `dsh-mcp-manager` 的某次写入抹掉**，而管理器**只有 add / enable / restart、没有「改」**且 add 拒绝同名 ⇒ 只能手改该 yml，**改完复核一次**（写入时机不明）。
