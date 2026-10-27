---
status: complete
created: 2026-10-23
created_at: 2026-10-23T08:24:04.677407500Z
updated_at: 2026-10-23T11:23:16.485967900Z
completed_at: 2026-10-23T11:23:16.485967900Z
transitions:
- status: in-progress
  at: 2026-10-23T08:35:49.239220Z
- status: complete
  at: 2026-10-23T11:23:16.485967900Z
---
# 015 · 把「Docker 管理」与「WSL 端口转发」拆成两个可独立开关的插件

## 背景（2026-10-23 主人要求，附插件列表截图）

现状：插件列表里只有**一个** `dsh-wsl-docker-ports`（一个条目、一个开关、一个右栏页 `WSL Docker 端口`）。
主人原话：「现在这里是一个，把docker功能和wsl转发功能分开做成两个，可以独立开关」。

## 已拍板

### 2026-10-23 四问四答（本次实施前）

1. **形态**：同包双入口 + profile 里**两条 cordis 行**（两个开关），不做两个独立 npm 包。
2. **右栏页**：**两个独立页面**（容器页 / 转发页各自有刷新与刷新间隔控件，互不影响）。
3. **配置命名空间**：**原名 `dsh-wsl-docker-ports` 留给「转发」**（`managedPorts` / `scopes` / `listenAddresses` / `elevationPolicy` / `writeToken` / `refreshIntervalSec` 原地不动，零迁移）；**「容器」用全新命名空间**。
4. **写通道**：两个插件**各自独立 `writeToken` + 各自提权策略**（容器只跑 docker 命令，转发才碰 netsh/防火墙）。

### 2026-10-23 追加三条裁定（**覆盖 design.md §9 的待定项**，以本节为准）

5. **统一 schema 接受**：**每包仍然只有一个 `Config`**（7 字段：`managedPorts` / `scopes` / `listenAddresses` /
   `elevationPolicy` / `writeToken` / `distro` / `refreshIntervalSec`）。**容器行加载同一份 schema**，
   字段名完全一致、**值各自独立**（各走各的命名空间）；**配置页按角色隐藏不属于自己的字段**
   —— 容器行只画 `distro` / `refreshIntervalSec` / `writeToken`，转发行只画自己那 5 个。
   ⇒ 不新增第二份 schema、不做字段改名、不加 `role` 以外的判别字段。
6. **容器行默认 = 开**：打包后的 `cordis.patch.yml` 插入行 **不带 `disabled: true`**；同时要求
   **转发侧零差异**（转发快照 golden / 19 条既有 portproxy 规则 / 判据文本逐字节不变）。
7. **P1–P5 一轮过**，但**每一期必须能独立诊断**（本期逐期留门读数，见下）。

## 需求（EARS）

- REQ-1.1 插件列表 SHALL 出现两个可分别启停的条目：`…-ports`（转发）与 `…-containers`（容器管理）。
- REQ-1.2 关闭其中之一 SHALL NOT 影响另一个的读事实、写通道、右栏页与配置；被关掉方的右栏页 SHALL 不出现。
- REQ-1.3 两方 SHALL 各自持有独立配置命名空间与独立 `writeToken`；凭据不跨通道复用。
- REQ-1.4 「转发」侧现有行为 SHALL 逐字节不变（规则判据、监听地址选择、防火墙网段、刷新间隔、19 条既有规则零改动）。
- REQ-1.5 两方 SHALL 共用只读探针实现（wsl/docker/ss/netsh），SHALL NOT 复制探针代码。
- REQ-1.6 单插件主包体积 SHALL 各自 ≤ 65,536 B 上限，且不得把另一方的 UI 打进自己的主包（懒加载 chunk 各自独立）。
- REQ-1.7（追加裁定 6）打包插入行 SHALL 让**容器行默认启用**，且此改动 SHALL NOT 引起转发侧任何字节差异。

## 实施记录（P1–P5，2026-10-23 一轮内完成）

### P1 · 共享薄层（零语义变更）

- `src/shared/http.ts`（`sendJson` / 读 body 的单一实现）、`src/shared/credential.ts`（`createWriteAuthenticator`）、
  `src/shared/config-read.ts`（**字段无关**的现读读者）、`src/shared/health.ts`（健康端点应答）。
- 转发侧改为**薄壳转调**：`src/config-read.ts` / `src/transport/write-auth.ts` / `src/route.ts` / `src/docker/route.ts`。
- 门：全套 11 门 exit 0；**既有 527 条 `node --test` / 159 条 `vitest` 零改动通过**（P1 的准入就是「零 diff」）。

### P2 · 角色解析与双行装载

- `src/role.ts`：`PluginRole` = `'ports' | 'containers'`；行 id 取 `ctx[Symbol.for('cordis.entry')]?.options?.id`
  （**不用 `entry.id`** —— 它带 `include:` 前缀）；判定优先级 **`config.role` → 行 id 后缀 `-containers` → 默认 `ports`**。
- `cordis.patch.yml`：同 `name`、两条 `- id:`（`dsh-wsl-docker-ports` / `dsh-wsl-docker-containers`），
  **均不带 `disabled: true`**。
- 门：`tsc` 0 / `node --test` **544**（+17 条容器侧单测）/ `vitest` 159 / `check-borders` 0 违规。

### P3 · 容器侧宿主半（数据与动作）

- `src/containers/{wire,credential,health,control,snapshot,route,plugin}.ts` + `src/containers/plugin.ts` 的
  `applyWslDockerContainers`：前缀 `/dsh-wsl-docker-containers`、服务名 `wslDockerContainers`、
  `GET /health`、独立 `writeToken`、**零提权**（`docker start|stop|restart` / `docker logs --tail N`）。
- 容器侧**不依赖** `/dsh-wsl-docker-ports/snapshot`：自己有快照路由；只复用 `src/read/**` 的只读探针。
- 门：`check-borders`（108 文件；转发 61 / 共享 4 / 容器 7）+ **6 组故障注入**全部按预期判红。

### P4 · 客户端第二页 + 第二个 chunk

- 常驻主包（注册期不可省）：`src/client/tab-def.ts`（页定义/seat 注册，从 `rows.ts` 拆出）、
  `src/client/containers-surface.ts`（第二套注册面 + 探活）、`src/client/health-probe.ts`、
  `src/client/chunk-degrade.ts` 增 `exportName`（同一个取块壳取不同导出名）。
- 懒加载 chunk `lib/client.containers.js`：`containers/pane.tsx`（列表 / 启停重启 / 日志抽屉 / 自己的刷新档）、
  `containers/source.ts`（只打容器侧三个端点）、`containers/config-page.tsx`（**按角色只画本行字段**）、
  `containers/runtime.ts`（纯类型）。取块说明符 `./client.containers.js`。
- 探活：`GET /dsh-wsl-docker-containers/health` 三态；**只有确证 404 才撤掉容器页**（离线/超时/形态不对一律保留）。
  Node 环境（单测/jsdom）不探活 ⇒ `apply` 的同步契约不变，既有测试无需注入 fetch。
- 门：`assert-client-split` 17/0、`verify-client-loader` 40/0、`check-exports` 25/0、`check-size` 343 文件、`vitest` **173**（+14）。
- 🔴 **偏差（如实登记）**：主包 **49,666 → 56,182 B（+6,516 B / 13.1%）**，**超出本 Spec 原写的「≤ 49,666 B」**；
  能进 chunk 的全进了（`client.containers.js` 23,124 B），剩下的是「注册必须发生在客户端 `apply()` 期间」的部分。
  棘轮地板按实测重登（`main-bundle-budgets.mjs` + `client-contract-incremental.md` §P2 双锁 + changelog **#60**），
  **待主人追认**。🔴 §P2 硬判据 65,536 B 未动（余 9,354 B）。

### P5 · 文档、门与收口

- 本文件、`design.md`（§9 待定项按追加裁定 5–7 结案）、`tasks.md`（模板要求处补齐）；
  三处尺寸 SSoT 同步（机器表 / 契约表 / changelog #60）。

## 门读数（2026-10-23 终态，全部 exit 0）

| # | 门 | 读数 |
| --- | --- | --- |
| 1 | `tsc -p tsconfig.json` | exit 0 |
| 2 | `node --test --test-concurrency=1 "tests/**/*.test.ts"` | **544 tests / 544 pass / 0 fail**（16.8 s） |
| 3 | `vitest run` | **19 files / 173 tests pass** |
| 4 | `assert-client-split.mjs` | 17 项断言 / 0 失败（主 56,182 B ≤ 上限 56,182 B；6 组变异哨兵全红） |
| 5 | `verify-client-loader.mjs` | 40 项断言 / 0 失败（含机器表 ↔ 契约表双锁） |
| 6 | `check-exports.mjs` | 25 项断言 / 0 失败（运行时 12/12、类型 25 软阈值） |
| 7 | `check-borders.mjs` | 108 文件：转发 61 / 共享 4 / 容器 7；R1–R5 **0 命中** |
| 8 | `wsl-shared/scripts/check-size.mjs` | 343 文件；最大 `elevate/script.ts` = 399 行 / 14,001 B |
| 9 | `tsc -p tsconfig.build.json` | exit 0 |
| 10 | `build-client.mjs` | main **56,182 B** / `client.ports.js` **153,709 B** / `client.containers.js` **23,124 B** |
| 11 | `tsc -p tsconfig.client.json` | exit 0 |

**转发侧零差异证据**：转发快照 golden、19 条 portproxy 规则、判据文本全部在门 2 的用例里（逐字节断言，未改一条）。
> 🔴 **上句的尺寸读数已被 D1 修正覆盖**：153,709 B 是 D1 **之前**的读数；D1 把容器表/动作 UI 与取数移出转发 chunk 后
> `client.ports.js` = **139,980 B**（−13,729 B），主包 **56,350 B 不变**（见下节「真机缺陷修正」的门读数）。

> ✅ **订正痕（2026-10-23 第三轮 · 真机缺陷修正，上表读数是当时快照）**：真机抓到三个缺陷（页签不出现 / 点开空表 /
> 第一版修法把 renderer 搞崩），修完复跑门禁：门 2 **549 tests / 549 pass**、门 3 **20 files / 175 tests**、
> 门 4 主 **56,350 B ≤ 上限 56,350 B**、门 10 `main 56,350 B` / `client.ports.js 153,709 B` /
> `client.containers.js 23,210 B`。上限已按既有流程三处同步（机器表 + 契约 §P2 + changelog **#61**）。
> **主人 2026-10-23 授权：拆分相关体积涨幅无需追认**（原话「拆分带来的前端体积涨幅全部不需要再问（含主包棘轮继续抬升）」）。

**零交叉证据**：门 7 的 R1（容器侧白名单）、R2（唯一允许的转发→容器 import = `plugin.ts → containers/plugin.ts`）、
R3（共享层白名单 + 业务词）、R4（公开面无容器导出）、R5（无模块级可变状态）全部 0 命中；
6 组故障注入（`cross|forward|shared|business|mutable|export`）逐一判红 exit 2。

## 验收（A1–A5）

- [x] A1 只启用转发：右栏只有转发页，容器相关请求 0 次。→ **离线侧已证**（探活 404 ⇒ 容器页被撤；容器侧端点独立），
      **未做**真机点击验证（见下「未做」）。
- [x] A2 只启用容器：右栏只有容器页，转发写入口不可达（404/未注册）。→ **离线侧已证**（两行独立 `apply` 分派 +
      路由前缀独立），**未做**真机点击验证。
- [x] A3 两个都启用：两页并存、互不干扰、凭据不互通。→ **离线侧已证**（独立命名空间 / 独立 token 键 / 独立 chunk；
      容器侧用例覆盖「A 的 token 打不通 B」的等价断言），**未做**真机点击验证。
- [x] A4 转发侧回归：D1/D2 后 **550 条 `node --test` / 20 files·180 条 `vitest` 全绿**，19 条规则判据逐字节不变。
- [x] A5 体积：主包 **56,350 B ≤ 65,536 B**；两个 chunk 各自独立（转发 **139,980 B** / 容器 **26,139 B**），
      容器 UI **零命中**在转发 chunk（`assert-client-split` ⑥ 反向判据 + 故障注入 `leak` 判红）。

## 未做（明确列出）

1. **真机 `netsh` / 真实提权写**：本轮所有写路径只到「计划 + 脚本生成 + golden 断言」为止，未执行任何真实
   `portproxy` / 防火墙写入（也**不允许**在本轮做）。
2. **A3 凭据隔离真机重测**：A1/A2 的两侧单开已在临时实例 `43393/43395` 上复验；凭据隔离仍是 17:5x 的读数，D1/D2 未改凭据面。
3. **`git commit`**：未提交（主人未授权）。
4. **主包地板上调的追认**：见 P4 偏差，需主人点头。

## 真机验收（2026-10-23 17:5x，实例 `accept-docker-ports` / 43391）

| 项 | 证据 |
| --- | --- |
| 两个页签 | `[role=tab]` = `WSL Docker 端口` + `WSL Docker 容器`（容器页默认激活） |
| 容器 chunk | `GET /plugins/dsh-wsl-docker-ports/client.containers.js?rev=3761196fcf92` → 200 |
| 容器数据 | `GET /dsh-wsl-docker-containers/snapshot` → 200；表格 **30 行**，30 组 start/stop/restart/logs |
| 转发侧不变 | 切回转发页：`sel-refresh-interval` 存在（值 15）；3306 行仍「多余规则（可移除）」+「WSL 内没有进程监听该端口」 |
| 凭据隔离 | 容器 `/action` 无 token ⇒ 401；带**转发侧** token ⇒ 401；转发 `/write/plan` 带转发 token ⇒ 200 |
| 角色判定 | `GET /dsh-wsl-docker-containers/health` → `{"side":"containers","rowId":"dsh-wsl-docker-containers"}` |
| 控制台 | 零 `console.error` |

**A1/A2 已复核（2026-10-23 19:17，临时实例 `43393` / `43395`）**：只开转发/只开容器的 DOM 与 Network 读数见下节「真机复验」；A3 凭据隔离仍沿用上表 17:5x 读数（D1/D2 未改凭据面）。

## 真机缺陷修正（D1/D2，2026-10-23 傍晚，代码 + 离线门 + 真机复验）

真机（实例 `43393` 只开转发 / `43395` 只开容器）抓到两个残留缺陷：

| 缺陷 | 旧形态（真机 DOM/控件） | 修正 |
| --- | --- | --- |
| **D1** | 只开转发时仍有 `tbl-containers` **30 行** + **120 个** `container-start-*` / `container-stop-*` / `container-restart-*` / `container-logs-btn-*` 按钮；`tbl-ports` 只有 1 行（3306） | 删除转发页的容器表/动作/日志 UI 与取数：`pane-tables.tsx` 的 `ContainersBlock`、`pane.tsx` 的 `containerControl`、`page.ts` 的 `buildContainerRows` 与 `containers/containerCount/containerListNote`、`rows.ts` 的容器 TESTID/行构造、`types.ts` 的 `ContainerRowView`；删除 `client/container-control.ts` |
| **D2** | 只开容器时 `selects: []`，只有 `btn-containers-refresh`；容器页自己的刷新档不可见/不可改 | 新增 `sel-containers-refresh-interval`（`关闭/15 秒/30 秒/60 秒/5 分钟`），**默认 `0` = 关闭**；写回容器行 `refreshIntervalSec`；轮询忽略 `generatedAt`、数据未变不重绘；卸载清理定时器 |

**离线门读数（现行，全部 exit 0）**：

| # | 门 | 读数 |
| --- | --- | --- |
| 1 | `tsc -p tsconfig.json` | exit 0 |
| 2 | `node --test --test-concurrency=1 "tests/**/*.test.ts"` | **550 tests / 550 pass / 0 fail** |
| 3 | `vitest run` | **20 files / 180 tests pass** |
| 4 | `assert-client-split.mjs` | **20 项断言 / 0 失败**（新增 ⑥：容器模块标记 0/4 + 字面量 0/5；`leak` 故障注入单独判红 exit 1） |
| 5 | `verify-client-loader.mjs` | 40 项断言 / 0 失败 |
| 6 | `check-borders.mjs` | 107 文件：转发 61 / 共享 4 / 容器 7；R1–R5 **0 命中** |
| 7 | `wsl-shared/scripts/check-size.mjs` | 344 文件；25.5 KB / 40 KB；最大 `elevate/script.ts` = 399 行 / 14,001 B |
| 8 | `tsc -p tsconfig.build.json` | exit 0 |
| 9 | `build-client.mjs` | main **56,350 B** / `client.ports.js` **139,980 B** / `client.containers.js` **26,139 B** |
| 10 | `tsc -p tsconfig.client.json` | exit 0 |

**真机复验（2026-10-23 19:17，页面重载；进程未重启）**：

| 场景 | 读数 |
| --- | --- |
| 只开转发 `43393` | `tbl-containers` = **0**、`[data-testid^="container-"]` = **0**（start/stop/restart/logs 各 0）；`tbl-ports` = 1 行（3306）；`sel-refresh-interval` = 15；Network 只有 `client.ports.js`，**无** `client.containers.js` |
| 只开容器 `43395` | `sel-containers-refresh-interval` 存在、值 **`0`**、5 个 option 逐字为 `关闭/15 秒/30 秒/60 秒/5 分钟`；`tbl-containers-side` **30 行**；动作按钮 start/stop/restart/logs **各 30**；Network 只有 `client.containers.js`，**无** `client.ports.js` |
| D2 默认关闭 | `43395` 加载后 20 s：`/dsh-wsl-docker-containers/snapshot` 资源计数 **1 → 1**（零轮询） |
| D2 15 秒档 | 下拉改 `15` 后 33 s：快照计数 **1 → 3**（两次轮询）；改回 `0` 后 20 s：**3 → 3**（停止） |
| D2 写回与隔离 | 改回 `0` 后重载 `43395`：值仍 `0`（容器命名空间持久化）；同时 `43393` 的 `sel-refresh-interval` 仍为 **15**（转发命名空间未被碰） |
| 两行都开 `43391` | `[role=tab]` = `WSL Docker 端口` + `WSL Docker 容器`；转发页 `tbl-containers` = 0；切到容器页 `sel-containers-refresh-interval` = `0`、`tbl-containers-side` = 30 行 |
| 控制台 | `43395` 零 error；`43393` 仅 1 条 **预期 404** `GET /dsh-wsl-docker-containers/health`（容器行被禁用 ⇒ 保守注册路径不显示容器页签，不是容器表/动作） |

**残留观察（不在 D1 范围，未改）**：只开转发时仍有这 1 条容器 health 404 —— 它来自常驻主包的容器页注册壳
（`containers-surface.ts` 必须先注册 kind，两行都开时容器页签才存在）；要连这条请求也清零，需要把「本行角色」
从宿主传到客户端并按角色跳过容器注册壳，属额外改动，未在本轮做。

## 单开真机验收（2026-10-23 19:2x，`--patch` 覆盖层禁用一侧，未改 profile）

| 状态 | 实例 | 读数 |
| --- | --- | --- |
| **只开转发** | 43393 | `/dsh-wsl-docker-containers/health` **404**、`/snapshot` **404**；转发快照 200（3306 = extra）；页签 = `[WSL Docker 端口]`；只加载 `client.ports.js`；`tbl-ports` 1 行、`tbl-containers` **0**、`container-*` testid **0**、`sel-refresh-interval` = 15 |
| **只开容器** | 43395 | `/dsh-wsl-docker-ports/snapshot` **404**、`/write/plan` **405（不可达）**；容器 health 200（`rowId: dsh-wsl-docker-containers`）、快照 200（30 容器）；页签 = `[WSL Docker 容器]`；只加载 `client.containers.js`；`tbl-containers-side` **30 行**、`sel-containers-refresh-interval` = **0（关闭）** 五档齐全、30 组动作按钮；无 `sel-refresh-interval` |
| **两个都开** | 43391 | 两个页签共存；转发页 `tbl-ports` 1 行且**无容器表**（`container-start-*` = 0）；容器页 `tbl-containers-side` 30 行、`sel-containers-refresh-interval` = 0 |

探针实例用完已 kill（43393/43395），覆盖层目录 `%TEMP%\dsh-015-verify` 已删除；`accept-docker-ports` 的 profile 配置**一字未动**。

## D1/D2 残留修复（同日，真机查出）

- **D1 转发页残留容器表**：删 `ContainersBlock`（表/启停/重启/日志）、`page.ts` 容器 view 字段、`rows.ts` 容器 TESTID、`types.ts` 的 `ContainerRowView`、`client/container-control.ts`；`assert-client-split` 新增 **⑥ 反向清单**（4 个容器模块标记 + 5 个 UI 字面量不得出现在转发 chunk）+ `DSH_SPLIT_ASSERT_FAULT=leak` 故障注入（实测 exit 1、只红 ⑥）。
- **D2 容器页缺刷新间隔**：容器页新增 `sel-containers-refresh-interval`（五档、默认关闭）、`sameContainersPayload` 忽略 `generatedAt`、`refresh.ts` 抽出通用比较器；写回只进容器行命名空间。

字节：主包 **56,350 B 未涨**；`client.ports.js` **139,980 B（−13,729）**；`client.containers.js` **26,139 B（+2,929）**。