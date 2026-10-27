---
status: complete
created: 2026-10-27
created_at: 2026-10-27T02:17:10.246655100Z
updated_at: 2026-10-27T02:17:10.372061900Z
completed_at: 2026-10-27T02:17:10.372061900Z
transitions:
- status: complete
  at: 2026-10-27T02:17:10.372061900Z
---
# 016 · 一张卡两个组件（一个 bundle + 一个组件包）

> 起因：插件列表里两个组件同名。015 的「同包两行」无法分开名字 —— 宿主按**模块名**取包级 locale 作组件标题。
> 016 第一版拆成三个真包（两张卡），被主人否决；本 Spec 记录最终形态与证据。

## 背景事实（源码 + 真实插件实证）

- 宿主：`pluginText/rowText` 的 title = `metaOf(row.name)`（**按模块名**查该包 `locale/*.json` 的 `meta.title`），否则回落模块名。
- 卡片 = profile `dsh.profile.bundles` 里的一个 bundle；组件 = 该 bundle `cordis.patch.yml` 的 `- insert:` 行。
- 实证：`dsh-plugin-agentflow@0.3.1`（desktop profile）的 patch 第二行 `name: '@deepseek-ai/dsh-agent-preset'` ⇒ 组件标题「Agent 预设定义」来自**另一个包**。

## 需求

- REQ-1 插件列表只出现**一张** `dsh-wsl-docker-ports` 卡。
- REQ-2 卡内**两个组件**，标题分别为「WSL 端口转发」「Docker 容器」。
- REQ-3 两个组件可**独立启停**（行 id 各自唯一），host 路由 / 凭据 / 前缀互不串门。
- REQ-4 容器组件**不出卡**：其包不得声明 `dsh.bundle`。
- REQ-5 容器组件仍可自带 host 与 client 产物（实测客户端 chunk 会被取回）。
- REQ-6 一个包的依赖白名单 = 共享包 + core + 兄弟组件包。

## 交付形态

```
dsh-wsl-docker-ports  (bundle ⇒ 出卡)
└── cordis.patch.yml
    ├── - insert: { id: dsh-wsl-docker-ports,        name: dsh-wsl-docker-ports }
    └── - insert: { id: dsh-wsl-docker-containers,   name: dsh-wsl-docker-containers }

dsh-wsl-docker-containers  (无 dsh.bundle ⇒ 只作组件)
dsh-wsl-docker-core        (纯库 ⇒ 无 dsh 段)
```

## 验收（真机 2026-10-27）

- A1 插件列表 `已安装 1` = 「WSL 端口转发」✅
- A2 详情「包含的组件 共 2 个 · 2 运行中」：`WSL 端口转发` / `Docker 容器` ✅
- A3 容器页签自动出现，表 30 行，刷新档默认「关闭」，凭据「未保存」✅
- A4 转发页自「开始」页卡片进入，`sel-refresh-interval`=15，无容器表/容器动作 ✅
- A5 `dsh plugin add` 输出「declares no dsh.bundle — installed as a plain dependency, not a profile layer」✅
- A6 门禁：core `70/70`、containers `26/26` + vitest 17、ports `437/437` + vitest 159、`check-borders` 226 文件 R1–R6、`check-exports` 22/22/25、`verify-client-loader` 13/40、`assert-client-split` 14/20、`check-size` 最大 399 行 ✅

## 非目标

- 不改宿主的取名逻辑（组件标题仍按模块名）。
- 不再拆成两张卡。

## 补记（2026-10-27，主人两处细节）

1. **显示名改英文**：`locale/{zh,en}.json` 的 `meta.title` = `WSL Port Forwarding` / `Docker Containers`（中文太抽象）。
2. **组件行重复文字**：宿主 `RowsSection` 对每题行**同时**渲染 `rowId` 与 `moduleName`，两者相同时就出现两行一样的 `dsh-wsl-docker-ports`。修法 = 行 id 用短名：`wsl-ports` / `wsl-containers`（行 id 同时是 settings 命名空间 ⇒ 同步 `settings-pipe.ts` / `config-slot.ts` / `tab-def.ts` / `credential.ts` + profile 的 `- id:` 已迁移，备份 `cordis.patch.yml.bak-016b`）。

真机复核：卡片「已安装 1 · WSL Port Forwarding」，组件两条分别显示 `wsl-ports` + `dsh-wsl-docker-ports`、`wsl-containers` + `dsh-wsl-docker-containers`（不再重复）；容器页 30 行 / 刷新「关闭」；转发页刷新 **15**（新命名空间下 profile 配置真生效）⇒ 行 id 迁移没丢配置。
