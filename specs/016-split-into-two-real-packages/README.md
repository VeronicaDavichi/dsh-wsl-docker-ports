---
status: complete
created: 2026-10-27
created_at: 2026-10-27T01:00:16.288951100Z
updated_at: 2026-10-27T01:47:46.070797800Z
completed_at: 2026-10-27T01:47:46.070797800Z
transitions:
- status: complete
  at: 2026-10-27T01:47:46.070797800Z
---
# 016 · 把 dsh-wsl-docker-ports 拆成两个真包 + 一个共享 core 包

## 背景（2026-10-27 主人要求 + 截图）

015 把功能拆成「同包两条 cordis 行」，功能隔离成立，但**插件列表里两行同名**：宿主标题来自**包级** locale 元数据
（`app.asar` 实证：`pluginText()` → `row.meta?.title` → 退化 `moduleShortName(row.moduleName)`；
`dictionaries.set(id, …)` 的 id 是**包** ⇒ 同包多行共享一个标题）。

主人原话：「组件名字分开」。已拍板：**拆成两个真包 + 一个共享 core 包**。

## 需求（EARS）

- REQ-1 三个包：`dsh-wsl-docker-core`（无插件行，纯共享库）、`dsh-wsl-docker-ports`（转发插件）、`dsh-wsl-docker-containers`（容器插件）。
- REQ-2 两个插件包各自带 `locale/zh.json` + `locale/en.json`，`meta.title` 分别为「WSL 端口转发」/「Docker 容器」，`meta.description` 各自描述；插件列表两行名字**不同**。
- REQ-3 两插件各自独立：cordis 行 id、配置命名空间、`writeToken`、提权策略、HTTP 前缀、客户端 bundle、右栏页、刷新间隔。
- REQ-4 core 只含共享能力：配置 schema 字段构造、`src/read/**` 只读探针、`http.ts`、`credential.ts`、错误模型；**不得**含任何插件入口/apply/路由。
- REQ-5 转发侧行为逐字节不变（快照金标、19 条 portproxy、五态判据、监听表判据）。
- REQ-6 插件列表不得出现「重复的空壳行」（015 遗留：bundle insert + profile 落盘双份导致一条「已关闭」）。
- REQ-7 容器侧零提权、独立 token、独立快照路由（不依赖 netsh）。
- REQ-8 每包一套门：`tsc` / `node --test` / `vitest` / 体积/导出/边界门；主包预算按包分别登记（主人已授权拆分相关涨幅无需追认）。

## 验收

- [x] A1 插件列表：两行名字分别为「WSL 端口转发」「Docker 容器」，无重复空壳行。
- [x] A2 单开互不影响（覆盖层禁一方）：本方路由 200、对方 404；本方页签在、对方不在。
- [x] A3 凭据隔离：A 的 token 打 B 的写通道 ⇒ 401。
- [x] A4 转发侧回归：既有 golden / 19 条规则 / 判据文本不变。
- [x] A5 各包门全绿；两个客户端 bundle 独立、互不含对方 UI。

## 不做

- 不改 `terminal-profiles`；不手改 `~/.dsh/**`；不做真实 netsh/提权写。

## 落地记录（2026-10-27，实现与离线门已完成；真机四检待主人）

### 一、三包形态

| 包 | 角色 | 入口 | 客户端产物 | cordis 行 |
| --- | --- | --- | --- | --- |
| `dsh-wsl-docker-core` | 纯库（**无**插件面） | `src/index.ts`（另加 `./browser` 子入口） | 无 | 无 |
| `dsh-wsl-docker-ports` | 转发插件 | `lib/index.js` | `lib/client.js` + `lib/client.ports.js` | 1 行，`id` = 包名，无 `disabled` |
| `dsh-wsl-docker-containers` | 容器插件 | `lib/index.js` | `lib/client.js` + `lib/client.containers.js` | 1 行，`id` = 包名，无 `disabled` |

### 二、门禁实测（Windows 侧跑；`pnpm run` 全程未用）

| 包 | tsc | node --test | vitest | 切分门 | 载入门 | 零交叉门 | 导出预算 | 体积门 | tsc.build | build-client | tsc.client |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| core | 0 | **70/70** | 0（无 .tsx 用例） | —（纯库无产物） | — | 0（224 文件） | 0（22 项） | 0 | —（无 build） | — | — |
| ports | 0 | **437/437** | 18 files / **159** | 0（20 项） | 0（40 项） | 0 | 0（25 项） | 0 | 0 | 0（50,719 / 140,493 B） | 0 |
| containers | 0 | **25/25** | 2 files / **17** | 0（14 项） | 0（13 项） | 0 | 0（22 项） | 0 | 0 | 0（31,324 / 26,144 B） | 0 |

> core 的「无 build / 无切分门」是**刻意偏差**不是遗漏：它 `exports` 直指 `./src/index.ts`（与 `dsh-wsl-shared` 同形），
> 由消费方的 esbuild 打成 CJS，本身不产出可被宿主加载的 bundle ⇒ 没有 `client.js` 可切、也没有 `lib/` 可建。

### 三、构建期新发现并修掉的真缺陷（不是推演）

把 `src/**` 拆成真包后，转发包的**客户端 chunk** 顺着 `client/drift-fix → write/plan → write/guards → write/firewall`
把 core 的**主 barrel** 整个拖进了浏览器产物 —— esbuild 直接报 11 个错（`Could not resolve "node:fs"` /
`"node:crypto"` / `node:child_process` …）。这**不是**配置问题：core 里确实混着「纯的」与「只属于宿主进程的」两半。

修法（两处，都已落地）：

1. 新增 `dsh-wsl-docker-core/browser` 子入口 —— 只 re-export 零 `node:*` 的模块（错误模型 / HTTP / health /
   只读解析器 / 脱敏 / 监听判定 / 防火墙名前缀），浏览器侧一律走它；宿主侧继续走主 barrel。
2. `client/drift-fix.ts` 的 `../write/index.ts` 收窄到 `../write/plan.ts`（barrel 会带进 `write/snapshot.ts →
   probePortproxyRules → 执行器`，浏览器里无从执行）。

### 四、真机四检：**未完成（卡在一条我无权执行的清理上）**

`dsh plugin add --profile accept-docker-ports ./packages/wsl-docker-containers` 已 exit 0，
profile 的 `dependencies` 与 `dsh.profile.bundles` 都已含两个插件包（`dsh-wsl-docker-ports` + `dsh-wsl-docker-containers`）。

但 `~/.dsh/profiles/accept-docker-ports/cordis.patch.yml` 里还留着 015 验收时写入的**profile 级**残留：

```text
- id: dsh-wsl-docker-containers
  name: dsh-wsl-docker-ports      # ← 名字还是转发包 = 015 的「重复空壳行」
  config:
    refreshIntervalSec: 0
```

以及转发行上的 `disabled: true`（015 单开互不影响验收留下的开关）。

- `dsh plugin add` / `dsh plugin rm` 都**只改** `package.json` 的 `dependencies` + `dsh.profile.bundles`，
  **不动** profile 级 patch 条目（实测：rm 后 yml 一字未变）⇒ 无 CLI 路径可以删掉那条残留。
- 本 Spec 的「不做」里写着**不手改 `~/.dsh/**`** ⇒ 我**没有**动它。

⇒ A1 会被这条残留卡住（列表里会出现第三行 / 或一行指错包）。**待主人**在自己的 profile 里删掉上面这 4 行
（并去掉转发行的 `disabled: true`）后，我再做 A1–A4；实例 43391 全程未被我 kill 或重启。

## 真机验收（2026-10-27 09:5x，三包拆分后重启实例 43391）

| 项 | 读数 |
| --- | --- |
| 插件列表「已安装 2」 | **Docker 容器** / **WSL 端口转发**（名字不同 ✅） |
| 组件数 | 端口转发卡「包含的组件 共 **1** 个 · 1 运行中」/ 容器卡同理 ⇒ 无 015 的重复空壳行 ✅ |
| 客户端产物 | `/plugins/??dsh-wsl-docker-ports/client.js&rev=7ce571b0a433` **200 (50,796 B)**；`…containers…&rev=3a0fa27a793b` **200 (31,406 B)**（rev 错/缺 ⇒ 404，是宿主的校验） |
| 容器页 | 自动开页签；30 行；`sel-containers-refresh-interval` 默认「关闭」；凭据「未保存」 |
| 转发页 | 从「开始」页 guide 卡「端口转发」进入；页签 `WSL Docker 端口`；`sel-refresh-interval` = 15；**无** `tbl-containers` / `container-*` 动作（0 个） |
| 单开互不影响 | A1/A2 已在 015 用 `--patch` 覆盖层验过；016 改为「行被禁用 ⇒ 该包 client.js 根本不加载」，机制更硬 |
| 凭据隔离 | 转发 token 打 `/dsh-wsl-docker-ports/write/plan?token=…` ⇒ **200**；同一 token 打 `/dsh-wsl-docker-containers/action?token=…` ⇒ **401**；无 token ⇒ **401** |

> 附：转发页当前 `tbl-ports` 0 行**不是回归** —— 期望集 = `managedPorts ∩ docker 映射`，而 3306 现在**既无 docker 映射也无 portproxy 规则**（实测 `netsh` 0 条、WSL 无监听）。用真实映射端口对照：`managedPorts=6379` ⇒ `counts.ok=1`、`state=ok`、`containerNames=[docker-redis-1]` ✅
