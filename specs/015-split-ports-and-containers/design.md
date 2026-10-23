# 把「Docker 管理」与「WSL 端口转发」拆成两个插件 —— 设计（只读研究结论）

> 需求：[README.md](./README.md)（REQ-1.1…1.6）。本轮**只做只读研究 + 本文件**：未改 `packages/**`、未改 profile、未改 `~/.dsh/**`、未 commit、未跑 `pnpm run`。
> 宿主源码坐标一律指 `D:\nodejs\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*`（0.2.0-rc.2 编译产物；`resources/app.asar\dsh` 在磁盘上不存在，asar 是单文件）。
> 基线实测（2026-10-23 16:33，真实执行 exit 0）：`node --test` **527/527 pass**；`vitest` **18 files / 159 tests**；`node scripts/assert-client-split.mjs` **17 断言 0 失败**（主包 **49,666 B** / 硬 65,536 / 棘轮地板 49,666 ⇒ 余 **0 B**；chunk `client.ports.js` **153,709 B**）。

## 1. 结论速查（每条都有源码坐标）

| # | 问题 | 结论 | 证据 |
| --- | --- | --- | --- |
| Q1 | `id` vs 模块 `name` | `id` = 行身份：开关寻址、`settings` 命名空间、patch 定位；`name` = 模块 specifier（ESM）。**同 name 两条不同 id 的行合法**（官方 bundle 里 `dsh-mcp-client` 就是 7 行） | `cordis-plugin-loader:328-332`（`id`=options.id，带父树前缀）；`dsh-settings:432,443,502`（`ns: entry.options.id`）；`dsh-config-editor:30-35`（**重复 id ⇒ 从配置清单剔除**）；`dsh-app-boot:95-107`（patch 按 id 定位，name 只做校验，不匹配即跳过） |
| Q2 | 子路径导出行 | 服务端**能**加载（ESM import 走 `exports`；官方 `dsh-plugin-manager/tools` 就是子路径行），但**该行拿不到客户端 bundle** ⇒ 不可作为本包的行 name | `cordis-plugin-loader:213-228`（`internal.import(name, baseUrl)`）；`dsh-base/cordis.patch.yml`（`id: tool-plugin-manager` / `name: '@deepseek-ai/dsh-plugin-manager/tools'`）；`dsh-client-modules:82-88,745-747`（子路径 ⇒ `exactPackageSpecifier` 返回 `undefined` ⇒ 无 client 源） |
| Q3 | 客户端 bundle 归属 | 客户端 bundle **按包**（`dsh.client` + `exports["./client"]`），**不按行**；包级图行 id = 包名，只加载一次；pane kind 由 bundle 的 `apply` 注册 | `dsh-client-modules:61-75,833-857`（只按 `entry.options.name` 归并；`entry.fiber===undefined或 disabled` 跳过）；`dsh-client-modules/lib/client.js:353-360`（每个包一个 EntryController，`{name:id}`）；`sidebar-right/client.js:8690-8721`（注册时校验 id/kind 唯一） |
| Q4 | 启用可见性 | 服务端**能**读对侧：`ctx.get('loader').entries()` 的 `options.id` + `disabled`；客户端**无逐行信号** ⇒ 每侧自带 `GET <prefix>/health`（未注册 ⇒ SPA 兜底 **404**） | `cordis-plugin-loader:594-603`（`provide("loader")`）；`dsh-host-plugin-inventory:121-135`（`enabled: !entry.disabled`）；`dsh-host-frontend-static`（未命中 ⇒ 404） |
| Q5 | 前缀/服务名 | 两条独立前缀**合法且互不吞并**（`(kind,path)` 唯一 + 最长前缀优先）；同名服务 `provide` **会抛** ⇒ 两个服务名 | `dsh-host-webserver:177-184,322-332`；`cordis:800-823`（L813 同名抛错） |
| Q6 | 体积 | 一个包只有一份主 bundle ⇒ 两个 UI 只能落**两个 chunk**；主包只涨「注册壳」 | `dsh-client-modules:169`（`client.<name>.js` 正则）+ `915-940`（`/plugins/<包名>/<file>`）；`main-bundle-budgets.mjs`（49,666 B，`debt`=地板） |
| Q7 | 两侧零交叉？ | 运行时共享面**只剩 4 个模块**（`config-read` / `route` / `transport/write-auth` / `wire`）+ 1 处**数据面**混装（容器表骑在转发侧 `/snapshot` 上）；转发业务（`diff/**`、`snapshot.ts`、`write/**`、`elevate/**`）与容器业务（`docker/**`）本身已分家 | 本轮用导入闭包实测：容器侧运行时闭包 = 7 模块（`docker/{route,control,wire}` + 上述 4 个）；转发侧 = 48 模块，交集 = 那 4 个（见 §4.2） |
| Q8 | 容器动作走哪条通道 | 现在走**转发侧的家门口**：`/dsh-wsl-docker-ports/container/{action,logs}`，且**复用转发侧 `writeToken` 与 `write-auth`** ⇒ 必须切断 | `docker/wire.ts:14-23`（前缀嵌在 `.../dsh-wsl-docker-ports` 下）；`docker/route.ts:10-18,32-34,60-66`；`transport/constants.ts:22-30` |
| Q9 | 容器动作要不要提权 | **不要**。全程 `wsl.exe -d <distro> -- docker start|stop|restart|logs`，不经 gsudo/UAC；`permission-denied` 的真因是 docker 组权限（提示即可） | `docker/control.ts:61-67,103-127`（`execInDistro`）；`wsl-shared/src/distro-exec.ts:103-118`（`['-d',row.name,'--',...argv]`，无提权）；`docker/control.ts:94-96` |
| Q10 | 客户端边界 | 容器 UI 现在**长在转发页里**（同一个 chunk、同一个 pane、共享 `write-token`）⇒ 拆成两个 pane + 两个 chunk，容器侧禁 import 转发侧业务模块（门禁见 §5.3） | `client/pane-tables.tsx`（容器表）、`client/container-control.ts:29-40`（import `../docker/wire` + 复用 `write-token`）、`client/rows.ts:27-29`（唯一 tab）、`scripts/build-client.mjs:110-111`（唯一 chunk） |

## 2. 装载形态：**同一包、同一模块名、两条行 + 角色由「行 id」判定**

### 2.1 三个候选与判定

| 候选 | 服务端 | 客户端 | 判定 |
| --- | --- | --- | --- |
| A. 子路径导出（`name: dsh-wsl-docker-ports/docker`） | ✅ 能加载（Q2） | ❌ 该行**不产生 client 源** ⇒ 「只开容器」时浏览器端**完全没有本插件**，REQ-1.2/A2 直接不可达 | **否决** |
| B. 同包两个模块文件（两个不同 specifier） | ✅ | ❌ 同 A | **否决** |
| C. 单入口 + 两条行（`name` 都是 `dsh-wsl-docker-ports`）+ 角色分流 | ✅ 两个 Entry、两次 `apply`、两个配置命名空间 | ✅ 两行任一存活即加载**同一个**包级 bundle ⇒ 两种「只开一个」的组合都有页面 | ✅ **采用** |

C 的代价必须写明：**一个包只有一个 `Config`**（模块级静态导出，行无法分化 schema）⇒ 容器行沿用现有 7 字段 schema（§6 给了隔离落点与它的边界）。

### 2.2 角色**不能**只靠 `config.role`（这是本轮最重要的发现）

`applyEntryPatches` 对非 insert 补丁是 **整键替换**：`target[key] = value`（`dsh-app-boot:104-107`）。⇒ 用户在 profile 里给容器行写一行 `config:`，会把 bundle 层的 `config.role: containers` **整体覆盖掉** ⇒ 该行会**静默地按转发跑**（一个开关看着开着、实际没容器页）。

因此定 **判定优先级**（可单测、可离线复现）：

1. `config.role` 显式值（仅内部工厂/测试用，写进 bundle 行只为可读性）；
2. **行 id 后缀**：`options.id === 'dsh-wsl-docker-containers'`（或 `endsWith('-containers')`）⇒ `containers`；
3. 其它一律 `ports`。

取 id 的路径（按可靠性排序）：`ctx[Symbol.for('cordis.entry')]?.options?.id` → `ctx.fiber?.entry?.options?.id`。依据：`cordis-plugin-loader:310-322`（`Entry.key = Symbol.for("cordis.entry")`，且 `Entry.ctx = loader.ctx.extend({[Entry.key]: this})`，cordis ctx 是原型继承 ⇒ 子 ctx 可读）；`:52,135` 就是 `ctx.fiber.entry` 的现成用法。
🔴 注意用 **`options.id`（原始行 id）**，不要用 `entry.id` —— 后者会拼上父树前缀（`cordis-plugin-loader:328-332`，根 include 下会变成 `include:<id>`）。

### 2.3 两个服务名、两条前缀

| 面 | 转发（`id: dsh-wsl-docker-ports`） | 容器（`id: dsh-wsl-docker-containers`） |
| --- | --- | --- |
| cordis 服务 | `wslDockerPorts`（**保留**） | `wslDockerContainers`（新；同名 `provide` 会抛，见 `cordis:813`） |
| HTTP | `/dsh-wsl-docker-ports`（快照）+ `/dsh-wsl-docker-ports/write`（plan/apply/audit） | `/dsh-wsl-docker-containers`（快照）+ `/dsh-wsl-docker-containers/action`、`/logs`、`/health` |
| 提权 | `elevate/**`（gsudo → RunAs） | **无提权链**（Q9） |

## 3. 两条 cordis 行的实际写法

包内 `cordis.patch.yml`（bundle 层，替换现在的单行 L18-20）：

```yaml
- insert:
    - id: dsh-wsl-docker-ports
      name: dsh-wsl-docker-ports
      config:
        role: ports
    - id: dsh-wsl-docker-containers
      name: dsh-wsl-docker-ports   # 故意同名：包级客户端 bundle 只认包根名（Q3）
      config:
        role: containers
      disabled: true               # 默认关 ⇒ 现有用户升级后行为零变化
```

profile 层（`~/.dsh/profiles/<p>/cordis.patch.yml`）：转发那行**原地不动**（现有 `- id: dsh-wsl-docker-ports` + 7 字段），容器行由插件列表开关自动追加（`dsh-plugin-manager:881-912` 写 `{id, disabled:false}`），用户要给容器配 `distro`/`writeToken` 时再补 `config:`（此时 §2.2 的 id 判据兜住「role 被覆盖」）。

**为什么命名空间不撞**：命名空间 = `entry.options.id`（`dsh-settings:432,443,502`）⇒ `dsh-wsl-docker-ports` 与 `dsh-wsl-docker-containers` 天然两个命名空间；**撞的是 id 而不是 name**：同 id 两行会被合并成一个 Entry（`cordis-plugin-loader:60`）并从配置清单里消失（`dsh-config-editor:30-35`），且开关变成 unaddressable（`dsh-plugin-manager:1431-1450` 的 `candidates.length > 1`）—— 这正是「两个开关」必须有两个 id 的原因。

**已知外观代价**：两行同 `name` ⇒ 插件列表的包元信息（名称/版本/图标）相同（`dsh-plugin-package-inventory-deepseek:24-29` 把子路径归一到包名，同包即同元信息）；靠行 id 区分的两个开关在列表里靠条目行文本区分。若主人要求「一眼看出是两个插件」，只有**拆两个 npm 包**能给独立元信息（已否）。

## 4. 功能归属（2026-10-23 追加硬要求）：全部分开、零交叉

### 4.1 归属表（每条功能只有一个家）

| 功能 | 归属 | 现有落点 |
| --- | --- | --- |
| NAT 硬前提门 / `localhostForwarding` 提示 / eth0 与发行版漂移 | 转发 | `snapshot.ts:8-17`、`read/eth0-source.ts`、`read/localhost-forwarding.ts`、`diff/engine.ts` |
| 端口规则表（判据/五态/监听表 `ss -ltn`/多余规则）、`managedPorts`/`scopes`/`listenAddresses` | 转发 | `diff/**`、`read/{netsh,listeners}*`、`client/pane-tables.tsx`（端口部分） |
| portproxy 增删改 + 防火墙网段 + 确认/审计 + `elevationPolicy` | 转发 | `write/**`、`elevate/**`、`transport/**` |
| 容器列表（状态/镜像/端口映射列） | 容器 | `read/docker.ts`、`read/docker-probe.ts`（**只读探针，两侧可共享**）、`client/containers/pane.tsx`（D1 后容器列只在这里；转发侧不再画） |
| 启停重启 / 日志 | 容器 | `docker/control.ts`、`client/containers/source.ts`（取数）、`client/containers/pane.tsx`（动作/日志 UI）；旧 `client/container-control.ts` 已随 D1 删除 |
| 容器侧 `distro` / `refreshIntervalSec` / `writeToken` | 容器 | **各自命名空间里的同名字段**（§6） |
| 下一期：进容器 exec / compose / 镜像管理 | 容器 | 本期只留**注入点**（`src/containers/future.ts` 空壳 + 可选 `ctx.inject(['managedTerminal'])`，不建包依赖边） |

### 4.2 零交叉审计（现状实测，不是推测）

用「import 闭包」实测（运行时边；`import type` 单列）：

- 容器侧运行时闭包 **7 个模块**：`docker/{route,control,wire}` + `config-read.ts` + `route.ts` + `transport/write-auth.ts` + `wire.ts`。
- 转发侧 **48 个模块**；**交集 = 上面那 4 个**。
- 类型级额外可达（仅 `import type`）：`snapshot.ts`、`diff/{types,managed-ports}`、`read/{docker,docker-probe,eth0-source,listeners,listeners-probe,local-addresses,localhost-forwarding,netsh,netsh-probe,probe}`。

四条运行时跨界边逐条处置：

| 跨界 | 现在为什么跨 | 拆法 |
| --- | --- | --- |
| `docker/route.ts` → `transport/write-auth.ts`（复用转发凭据） | 省 20 行鉴权 | 抽 `src/shared/credential.ts`（常量时间比较 + bearer 解析 + 401 文案，**无业务**）；容器侧读**自己的** `writeToken` |
| `docker/route.ts` → `route.ts`（`isWebServerSurface`/`pathOf`） | 复用路由工具 | 抽 `src/shared/http.ts`（surface 形状 + `pathOf` + `readJsonBody` + JSON 出口）；`route.ts` 保留转发专属注册逻辑 |
| `docker/route.ts` → `wire.ts`（借类型与常量） | 顺带 import | 容器侧自有 `containers/wire.ts`（DTO/常量/白名单），只从 `shared/http.ts` 取通用类型 |
| **数据面**：容器表由转发侧 `/snapshot` 提供 | 一张快照喂一个页面 | 容器侧新 `GET /dsh-wsl-docker-containers/snapshot`（§7 P3）。**今日缺陷实证**：读不到 netsh ⇒ 整条路由 `rules-unavailable`（`snapshot.ts:33,182`）⇒ **连容器列表一起没了**；这既是耦合证据，也是拆分的用户价值 |

客户端同样有 4 处混装：`client/{pane-tables.tsx,page.ts,rows.ts,types.ts}` 一个文件里同时装着端口表与容器表，`client/container-control.ts` 还直接复用转发侧 `write-token`（`sessionStorage` 同一把钥匙）。⇒ §5.3 的文件级边界 + §6 的两个 chunk。

### 4.3 共享层：只允许「只读探针 + 通用工具」（白名单式，可机器校验）

允许被两侧同时 import 的**全部**内容（白名单，其余一律算越界）：

| 白名单 | 内容 | 为什么允许 |
| --- | --- | --- |
| `dsh-wsl-shared`（独立包） | `execInDistro` / `listDistros` / `resolveDistro` / `readNetworkingMode` / 错误模型 | 事实层，无业务状态 |
| `src/read/**` | `docker.ts`、`docker-probe.ts`、`netsh.ts`、`netsh-probe.ts`、`listeners.ts`、`listeners-probe.ts`、`eth0-source.ts`、`localhost-forwarding.ts`、`local-addresses.ts`、`redact.ts`、`probe.ts` | **纯只读探针**：只吃 `Executor`、只吐数据；零写、零提权、零缓存 |
| `src/shared/**`（新，4 文件） | `http.ts`、`credential.ts`、`config-read.ts`（字段无关版本）、`fs-guard.ts`（如需） | 通用工具，不含任何一侧的业务常量 |

明确**不得**进白名单：`snapshot.ts`、`route.ts`、`wire.ts`、`config.ts`、`plugin.ts`、`diff/**`、`write/**`、`elevate/**`、`transport/**`、`client/{pane*,page,rows,write-*,settings-pipe,containers/**}`。

机器校验（P1 交付 `scripts/check-borders.mjs`，3 条规则 + 变异哨兵）：

- R1 容器侧（`src/containers/**`、`src/client/containers/**`）的 import 不得落在 §4.3 黑名单；
- R2 转发侧不得 import `src/containers/**` / `src/client/containers/**`；
- R3 `src/shared/**` 只能 import `src/shared/**`、`src/read/**`、`dsh-wsl-shared`、node 内置；
- 哨兵：临时注入一条越界 import 后门必须**判红**（照 `assert-client-split` 的 `DSH_SPLIT_ASSERT_FAULT` 手法）。

## 5. 客户端与 pane 注册

### 5.1 结论

- 一个包一份主 bundle（Q3）⇒ **两个 pane 由同一 bundle 的 `apply` 注册**，各自 seat 用 `ChunkBoot` 懒取**自己的** chunk：`client.ports.js`（现有）+ `client.containers.js`（新）。
- 两个 pane 需要**两套** `{id, kind, title, seats}`：`id` 与 `kind` 都不能重复（`sidebar-right/client.js:8690-8721` 重复即抛）。
- 建议命名：`kind: 'wslDockerPorts'`（保留）/ `'wslDockerContainers'`（新）；`id: 'dsh-wsl-docker-ports'` / `'dsh-wsl-docker-containers'`；标题「WSL Docker 端口」/「Docker 容器」；guide 条目 `ports`(40) / `containers`(41)。
- 官方已占用 kind 逐个核过（`guide`/`files`/`browser`/`text`/`changes-review`/`terminal`/`scheduleTask`/`plan`/`subagentchat`，另有 `approval`、`compact-checkpoint`），全仓 `wslDocker*` 零命中 ⇒ 无冲突（`BROWSER_KIND`/`FILES_KIND`/`GUIDE_KIND`/`TEXTPREVIEW_KIND`/`CHANGES_REVIEW_KIND`/`SCHEDULE_TASK_KIND`/`terminal`/`plan`/`subagentchat` 常量实证）。

### 5.2 「被关掉方不出页」怎么实现（唯一可行路）

`disabled` 只按**包**生效：本包两行共用包名 ⇒ 关掉容器行**不会**把包从客户端图里摘掉（`dsh-client-modules:833-857`），bundle 照样加载、pane 照样注册。故必须**自证**：

- 每侧注册一个**免鉴权只读** `GET <prefix>/health` ⇒ `{ plugin: 'ports'|'containers', rowId, ok: true }`（零命令、零文件）；
- 主包 `apply` 先 `Promise.allSettled` 打两个 health，**哪个 200 就注册哪个 pane**；对侧未注册路由 ⇒ 宿主 SPA 兜底回 **404** ⇒ 不注册（不是错误，不打红）；
- 探测超时/异常 ⇒ **保守注册**（宁可多一个页，也不让用户「插件明明开着却没有页」），并在页内显示降级说明；
- tab 注册允许晚到（`sidebar-right/client.js` 注册后自行 `refresh()`），故探测不阻塞首屏。

### 5.3 组件 / view model / chunk 边界

| 边界 | 转发 | 容器 |
| --- | --- | --- |
| 常驻（主包，注册壳） | `client/shell/registry.ts`：两个 tab 定义 + 4 个 seat + guide + health 探测 | 同左（一个文件同时注册两侧，别让它们互相 import 业务） |
| chunk | `client.ports.js`：`ports/{pane,pane-tables,pane-settings,page,rows,drift-fix,write-*,config-page}` | `client.containers.js`：`containers/{pane,tables,control,rows,page,config-page}` |
| 允许共享 | `client/shared/{chunk-degrade,styles,host,route-source(FetchLike),pane-scroll}.ts` | 同左 |
| 禁止 | 容器 chunk 不得 import `client/ports/**`、`write-*`、`settings-pipe`（凭据存储走 §6 的独立键） | 转发 chunk 不得 import `client/containers/**` |

体积口径：新增注册壳（第二个 tab + 两个 seat + 探测）≈ +0.6–1.2 KB；抵消手段 = 把 `rows.ts`（16,897 B，现属**常驻面**）里**纯视图装配**部分迁进各自 chunk，常驻只留 `tabDefinition/seats/guide`。**目标：主包 ≤ 49,666 B（不抬棘轮）**；若实测仍超，才走「`main-bundle-budgets.mjs` + `client-contract-incremental.md` 表 + changelog `#N`」三处同步抬地板（`checkTraces` 会验 `#N` 存在）。

## 6. 配置与凭据隔离

| 面 | 转发 | 容器 | 备注 |
| --- | --- | --- | --- |
| 命名空间 | `dsh-wsl-docker-ports` | `dsh-wsl-docker-containers` | = 行 id（`dsh-settings:432`） |
| `writeToken` | 现有 | **新生成**（同名字段、不同命名空间） | 互不通用：A 的 token 打 B 的通道 ⇒ **401**（P2 用例） |
| `distro` | 现有 | 同名字段，独立值/独立默认 | 容器动作的 `wsl -d` 目标 |
| `refreshIntervalSec` | 现有 | 同名字段，独立值 | 两页各刷各的。**D2（2026-10-23 真机）实作**：容器页在 `containers/pane.tsx` 自带 `setInterval`（卸载清理），选项/归一化复用 `client/refresh.ts` 的 `REFRESH_INTERVAL_OPTIONS` / `normalizeRefreshIntervalSec`；**未**复用 `use-auto-refresh.ts`，因为该 hook 的比较写死 `refreshedAt`，容器快照的时间戳叫 `generatedAt` |
| `elevationPolicy` | 现有 | **不消费**（无提权动作，Q9） | 容器配置页不渲染该字段 |
| `managedPorts`/`scopes`/`listenAddresses` | 现有 | **不消费** | 容器配置页不渲染 |
| schema | **一字不改**（7 字段，全 `.volatile()`，`writeToken` 带 `role('secret')`） | 同一 schema | 模块级 `Config` 无法按行分化（§2.1 C 的代价） |

落地要求：①服务器侧每侧只读自己命名空间的字段（`config-read.ts` 泛化为按字段名现读）；②**配置页按角色渲染字段白名单**，非本角色字段不渲染、写明「由另一方管理」；③schema 不动 ⇒ 现有 profile 行**零迁移**、`describe()` 视图不新增字段。

## 7. 分期实施计划（每期独立可验收）

| 期 | 内容 | 文件级改动 | 新增测试（估） | 验收门 |
| --- | --- | --- | --- | --- |
| **P1** 边界与共享层（零行为变化） | 抽 `shared/{http,credential,config-read}.ts`（旧文件改薄壳 re-export）；`scripts/check-borders.mjs` | 新 3 + 1 脚本；改 `route.ts`/`transport/write-auth.ts`/`config-read.ts`/`docker/route.ts` 的 import | ~18（边界门 8 + 抽取等价 10） | **转发侧零行为变化门**：`node --test` 527/527、`vitest` 159/159 全绿且**旧断言零改动**；`lib/client.js` 字节不变；`check:exports` 6/9 不变；`check-borders` 3 规则 + 哨兵绿 |
| **P2** 服务端 role 分流 + 容器独立写通道 | `src/containers/{plugin,route,wire,credential,health}.ts`；`src/plugin.ts` 按角色委派（`apply` 分流，服务名/前缀/依赖各一套）；包内 `cordis.patch.yml` 两行 | 新 5 + 改 3（`plugin.ts`、`index.ts`、`cordis.patch.yml`） | ~52（角色判定 12、容器通道鉴权/路径/方法/体 18、跨 token 401 4、health 6、两命名空间隔离 6、双 apply 幂等 6） | 两行同时启用时两条前缀都 200；跨 token 401 且 **0 次 docker 调用**；`wslDockerContainers` 服务名可注入；转发侧 527 全绿 |
| **P3** 容器读路径独立 | `src/containers/snapshot.ts`（只 `probeDockerPs` + `resolveDistro`，**不碰 netsh**）；`GET /dsh-wsl-docker-containers/snapshot` | 新 2 + 改 2 | ~28（装配 10、docker 三失败态 8、distro 解析 6、**netsh 不可读时容器快照仍 200** 4） | 断网/无网卡场景下容器列表仍可读（对标 `rules-unavailable` 缺陷）；转发快照 JSON **逐字段不变**（golden 对比） |
| **P4** 客户端两 pane / 两 chunk | `client/shell/registry.ts`（两 tab + 4 seat + health gating）；`client/ports/**`、`client/containers/**`；`chunk-containers.ts`；`build-client.mjs` 第三入口 | 新 ~9 + 改 5 | ~46（注册/gating 10、容器 UI 16、chunk 断言 8、两页互不干扰 8、降级态 4） | `assert-client-split` 扩到两 chunk 全绿；主包 ≤ 49,666 B；只开一侧时另一侧 pane **不出现**（真机） |
| **P5** profile 两行 / 迁移 / 收口 | profile patch 形状文档 + 用户手册；`tasks.md` 计数订正 | 改 2（文档）+ 1（`tasks.md`） | ~12（patch 形状 6、`disabled:true` 默认关 3、开关往返 3） | 真机：插件列表两个开关、开/关四组合各验一次；19 条 portproxy 零改动 |

合计：**5 期 + 本轮研究**，新增测试约 **156** ⇒ 总规模约 527+159+156 ≈ **842**。每期都可单独交付、单独回滚（P1 纯重构、P2/P3 只加新面、P4 只在浏览器面、P5 只动配置与文档）。

### 7.1 「转发侧零行为变化」回归门（可执行定义，逐期都跑）

全部**直接跑二进制**（不 `pnpm run`：pnpm 11 的 `verify-deps-before-run` 会顺带 install 并写回 lockfile）：

| 命令（cwd = `packages/wsl-docker-ports`） | 判据 |
| --- | --- |
| `node --test --test-concurrency=1 "tests/**/*.test.ts"` | `pass 527 / fail 0`，且**既有测试文件零改动**（`git status` 里 `tests/**` 无 diff） |
| `node node_modules/vitest/vitest.mjs run` | `Test Files 18 passed / Tests 159 passed` |
| `node scripts/assert-client-split.mjs` | 17 断言 0 失败；主包 **≤ 49,666 B**；chunk 4/4 常驻标记 + 12/12 切分标记 |
| `node scripts/check-exports.mjs` | 运行时 **6** / 类型 **9** 不变（容器侧**不进** `exports`） |
| 转发快照 golden | `GET /dsh-wsl-docker-ports/snapshot` 的 JSON **逐字段不变**（除 `docker.*` 的容器态可随时间变化的部分，用固定 fake 执行器比对） |
| 19 条 portproxy | `netsh interface portproxy show v4tov4` 规则条数与内容不变（P5 真机前后各一次） |

### 7.2 REQ → 验收映射

| REQ | 落在哪期 | 可二值判定 |
| --- | --- | --- |
| REQ-1.1 两个可分别启停的条目 | P2 / P5 | 清单里两个 `entryId` 各一个开关；四种开/关组合各起一次实例可复现 |
| REQ-1.2 关一方不影响另一方、且被关方不出页 | P3 / P4 | 只开容器：容器页在、转发页不在、`/dsh-wsl-docker-ports/*` 全 404；只开转发：反向成立 |
| REQ-1.3 独立命名空间与凭据 | P2 | `describe()` 两个 `ns`；A 的 token 打 B 的 `/action` ⇒ 401 且 0 次 docker 调用 |
| REQ-1.4 转发侧逐字节不变 | P1 起每期 | §7.1 全表绿 + `git status` 里转发侧源码零改动（P1 只改 import 薄壳） |
| REQ-1.5 共用只读探针、不复制 | P1 / P3 | `src/read/**` 无新增副本；`check-borders` R1/R2 绿 |
| REQ-1.6 体积 | P4 | 主包 ≤ 49,666 B ⚠️ **实测算未达成（56,182 B），见 §10.2 第 1 条**；两 chunk 各自独立、互不包含对方 UI（chunk 内 `CUT_MARKERS` 按侧分组） |


## 8. 风险清单

| # | 风险 | 影响 | 处置 |
| --- | --- | --- | --- |
| R1 | **同模块双装载**：模块级可变状态（计数器/单例/闭包缓存）被两行共享 | 两页互相污染，且只有「两行都开」才复现 | 禁止模块级可变状态（P2 加 lint 式门：`src/containers/**` 与转发侧 `src/{diff,write,elevate,transport}/**` 顶层不得有 `let`/单例 Map）；`provide`、路由、ticket 环全部 `ctx.effect` scoped |
| R2 | **`settings` 命名空间**：两行若同 id（复制粘贴错）⇒ 合并成一个 Entry、清单里消失、开关 unaddressable | 用户看到「只有一个开关」，配置写丢 | 包内两行 id 硬编码 + 测试断言两 id 不同；`dsh-config-editor:30-35` 的剔除行为作为回归用例 |
| R3 | **pane 注册竞态**：health 探测晚到/超时；或两 chunk 同时取块；或 `kind`/`id` 重复直接抛 | 一个页面都不出现，且控制台一行红 | 探测失败**保守注册**；两个 `kind`/`id` 常量单点定义 + 单测断言互不相等；注册全部走 `ctx.effect` disposer |
| R4 | **客户端体积**：主包棘轮**余 0 B**；新增注册壳必然涨 | `assert-client-split` 红，或被迫抬地板 | 先把 `rows.ts` 视图装配迁进 chunk 抵消（§5.3）；只有实测仍超才走三处同步抬地板（含 changelog `#N`） |
| R5 | **profile patch 迁移**：容器行若默认开 ⇒ 现有用户升级后凭空多一个开关和一条新前缀 | 违反「转发侧零行为变化」 | 包内 `disabled: true` 默认关（`dsh-app-boot` 的 insert 支持行内 `disabled`）；`dsh-plugin-manager:881-912` 的开关写入路径已实证 |
| R6 | **config 整键替换**：profile 行写 `config:` 会顶掉 bundle 行的 `role` | 容器行**静默按转发跑** | §2.2 的 id 判据（不依赖 config）；P2 用例：显式写一个只有 `distro` 的容器 config，断言仍走容器分支 |
| R7 | **同包多 Loader 源**：若两行被插到**不同 include 树**（不同 baseUrl），`client-modules` 直接抛 `resolves from multiple active Loader sources` | 整个客户端图报错 | 两行必须在**同一层**插入（包内 bundle patch 一处 `- insert:` 两条）；文档写明「不要用嵌套 include 再插一次」 |
| R8 | 双 `apply` 的副作用叠加：审计环/定时器/票据表各建两份；两页同时自动刷新放大 WSL 唤醒成本 | 后台开销翻倍 | 每侧只服务自己的路由；不用第二侧就不建定时器（页面驱动）；P2 断言「只开一侧时另一侧 0 次探针」 |

## 9. 待主人拍板 / 需真机实验

1. **统一 schema 可接受吗**（§2.1 C 的代价）：容器命名空间里也会出现 `managedPorts`/`elevationPolicy` 等转发字段（值独立，配置页按角色隐藏）。要「两个真独立 schema」只有拆两个 npm 包（已否）。**推荐：接受统一 schema + 配置页字段白名单**。
2. **容器侧要不要 `elevationPolicy` 字段**：Q9 证明容器动作不需要提权。**推荐：不要**（配了也没用；`permission-denied` 用文案引导修 docker 组）。
3. **容器行默认关还是默认开**：**推荐默认关**（R5，保护现有用户）。
4. 需真机实验（都不写系统状态，P1/P2 首日各做一次）：①`ctx[Symbol.for('cordis.entry')]?.options?.id` 在真实 `apply` 里能否读到（3 行探针打印）；②`disabled: true` 的 insert 行启动后清单显示「已停用」且开关能写回 profile；③只开容器行时包级 bundle 仍被加载（浏览器 Network 里 `client.js` + `client.containers.js` 各一次）；④对侧未注册前缀的 `GET /health` 确实回 **404**（而非 200 的空 SPA 页）；⑤两行都开时 `settings.describe()` 出现**两个** `ns`。

---

## 10. 结案（2026-10-23，P1–P5 一轮落地后）

### 10.1 §9 待定项 —— 主人裁定（**覆盖本文档原推荐**，以本节为准）

| §9 项 | 本文档原推荐 | **主人裁定（生效）** | 落地位置 |
| --- | --- | --- | --- |
| ① 统一 schema | 接受 + 配置页字段白名单 | **接受统一 schema**：每包仍只有一个 `Config`（7 字段），容器行字段名完全一致、**值独立**；**配置页按角色隐藏非本行字段** | `src/client/containers/config-page.tsx`（只画 `distro`/`refreshIntervalSec`/`writeToken`）；`src/client/config-slot.ts` 按 `key` 分槽 |
| ② 容器侧 `elevationPolicy` | 不要 | **不要**（与推荐一致；字段仍在统一 schema 里，容器行不读它） | `src/containers/control.ts` 无提权分支 |
| ③ 容器行默认开/关 | **默认关**（R5） | **默认开**（裁定 6）——但**转发侧必须零差异** | `cordis.patch.yml` 两条 insert 行**均不带 `disabled: true`**；转发侧 golden 未动（门 2 逐字节断言） |
| ④ 五项真机实验 | P1/P2 各做一次 | **本轮未做**（如实登记；见 README「未做」），其中 ③④ 的等价判据已由离线门覆盖 | `check-borders` R1–R5 + `assert-client-split` + `tests/client/containers-side.test.tsx` |

### 10.2 与本文档 §5/§7 原判据的**偏差**（如实登记）

1. **§7.2 REQ-1.6 的「主包 ≤ 49,666 B」未达成**：实测 **56,182 B（+6,516 B / 13.1%）**，仍 ≤ §P2 硬判据 65,536 B。
   原因：第二个页的**注册面不可进 chunk**（`tab` 注册、两个 seat、配置槽、探活必须发生在客户端 `apply()` 期间），
   而挪动 009 的常驻模块（`settings-pipe` / `write-channel`）属跨 Spec 重构、不在本轮范围。
   处置：三处尺寸 SSoT 同步（`main-bundle-budgets.mjs` 机器表 + `client-contract-incremental.md` §P2 表 + changelog **#60**），
   **地板待主人追认**。
2. **§8 R5 的处置被裁定反转**：原文「包内 `disabled: true` 默认关」⇒ 现行 **默认开**。
   风险本身仍成立（升级后多一个开关 + 一条新前缀），因此**补偿判据**是：转发侧零差异（golden / 19 条规则 / 判据文本）
   + 容器侧**零提权**、**只读探针复用**、**独立命名空间**。
3. **§7.1 的「19 条规则真机前后各一次」未做**：本轮不执行真实 `netsh` 写（红线），只到计划 + 脚本生成 + golden 断言。

### 10.3 真机缺陷修正（D1/D2，2026-10-23 傍晚）

| 缺陷 | 真机形态 | 处置 | 离线判据 |
| --- | --- | --- | --- |
| **D1** 转发页仍带整套容器表 | 只开转发（实例 `43393`）时 DOM 仍有 `tbl-containers` 30 行 + 120 个 `container-start/stop/restart/logs` 按钮 | 删除 `pane-tables.tsx` 的 `ContainersBlock`、`pane.tsx` 的 `containerControl`、`page.ts` 的 `buildContainerRows`/`containers`/`containerCount`/`containerListNote`、`rows.ts` 的 `TESTID.containers`/`buildContainerRows`、`types.ts` 的 `ContainerRowView`；删除 `client/container-control.ts`（容器动作取数只留在容器 chunk） | `tests/client/pane.test.tsx` 反向断言（快照含 2 个容器，DOM 里 `tbl-containers`/`container-*` 必须为 0）；`tests/unit/client-rows.test.ts`、`snapshot.test.ts` 断言视图**没有**容器字段；`assert-client-split` 新增 ⑥（容器模块标记 + 5 个 testid 字面量在转发 chunk 零命中，故障注入 `leak` 判红） |
| **D2** 容器页没有刷新间隔控件 | 只开容器（实例 `43395`）时 `selects: []`，只有 `btn-containers-refresh` | 容器页新增 `sel-containers-refresh-interval`（五档 `关闭/15 秒/30 秒/60 秒/5 分钟`），**默认 `0` = 关闭**；写回容器行自己的 `refreshIntervalSec`；轮询比较忽略 `generatedAt`，数据未变不 `setState`；卸载清理定时器 | `tests/client/containers-pane.test.tsx` 的 D2-1…D2-5（默认 120 s 零轮询、15 s 到点、仅时间戳变零重绘、真变重绘、卸载清零、改档写回 60）；`tests/unit/containers-surface.test.ts` 断言写回命名空间 = `dsh-wsl-docker-containers` |

**D1 的边界解释**：转发页保留 `DockerFailureBlock` / `RawOutputBlock` 两个**诊断**入口（不是容器表、不是动作按钮），
以免把「转发页原有的 docker 读失败说明」一并删掉而改变转发侧行为；容器行/容器动作/容器取数已全部不在转发 chunk。
**残留观察**：只开转发时仍会看到 1 条 `/dsh-wsl-docker-containers/health` 404（常驻注册壳的保守探活，不是容器表/动作）；
清零它需要把行角色传给客户端，属额外范围。

**尺寸读数（D1/D2 后，全部 exit 0）**：主包 **56,350 B 不变**（棘轮上限 56,350，余 0）；
`client.ports.js` **153,709 → 139,980 B**（−13,729 B）；`client.containers.js` **23,210 → 26,139 B**（+2,929 B：五档选择器 + 比较器 + 选项复用）。
`CUT_MARKERS` 仍 12 条（`pane-tables.tsx` 模块本身没有离开转发 chunk，只删了其中的容器块），故以 ⑥ 反向清单兜住 D1。

**真机复验（2026-10-23 19:17，页面重载；客户端改动，进程未重启）**：
只开转发 `43393` ⇒ `tbl-containers`/`container-*` 全 **0**、`tbl-ports` 1 行、只加载 `client.ports.js`；
只开容器 `43395` ⇒ `sel-containers-refresh-interval` 值 **0**、五档文案齐全、`tbl-containers-side` 30 行、只加载 `client.containers.js`；
默认档 20 s 快照计数 **1→1**（零轮询），改 15 s 后 33 s **1→3**，改回 0 后 20 s **3→3**，重载仍为 0；
`43393` 的 `sel-refresh-interval` 仍为 15（容器写回不串到转发命名空间）。`43393` 唯一的 404 是
`/dsh-wsl-docker-containers/health`（容器行禁用时的保守注册路径，不是容器表/动作）。



### 10.4 结论

REQ-1.1–1.7 的**离线可证部分全部落地并被门钉住**；D1/D2 已在临时实例 `43391/43393/43395` 真机复验。
剩余真机项（§9 ④ 的五项实验、A3 凭据隔离重测、真实提权写）在 README「未做」里逐条列出，不冒充已完成。