---
status: in-progress
created: 2026-10-27
priority: medium
tags:
- dsh-plugin
- wsl
- docker
- ui
- config
created_at: 2026-10-27T03:09:57.611889800Z
updated_at: 2026-10-27T03:10:08.907372800Z
transitions:
- status: in-progress
  at: 2026-10-27T03:10:08.907372800Z
---
# 017 · 组合包级配置页（提权策略 / 刷新频次 / 目标发行版搬进插件内页）

> 起因（主人 2026-10-27 原话）：「我们把 提权策略，刷新频次，目标发行版 全部移到 插件内页的配置页」，
> 并给了参考插件 `@agents-anywhere/dsh-bridge-next` 的配置界面设计，「按照这个学」。
> 三个拍板（同日）：
> ① 页面挂在「插件进来但是没有点进子组件的地方」= bundle 卡片详情页，**描述与组件行之间**；
> ② 刷新频次要**两个值**，子配置写法抄 `luweiyabo/dsh-whale-pet`；
> ③ 页头上原来的控件**直接删掉**（不留双入口）。

## 背景事实（宿主源码 + 两个真实插件实证）

- `plugins.bundle.config`：**按 bundle 包名**注册，渲染位置就是「卡片描述之后、组件行之前」；
  表单带自己的保存控件（`view: 'page'`），离开即丢弃草稿。
- `plugins.row.config`：**按 `<包名>#<行 id>`** 注册。015/016 只写行 id（`wsl-ports` / `wsl-containers`）
  ⇒ 行上的「配置」控件查不到 ⇒ 自绘页**从未真正渲染**（本轮订正）。
- `settings.describe()` 返回**所有**命名空间；`settings.update({ns, patch})` 的 ns 由调用方给
  ⇒ 一个客户端既能读也能写别的命名空间（跨组件行写同一份配置，不需要第二条通道）。
- 参考实现：bridge-next 2.0.2 的 `SettingsPanel`（`section.panel` → `h3` → `label.field` →
  `div.save` + `role=status`「设置已保存」+ 未改动时 primary 置灰）；whale-pet 的
  `panel/field/singleSelect/numInput` 分工与「显式保存」形态。

## 需求

- REQ-1 卡片详情页在**描述与组件行之间**渲染配置页（`plugins.bundle.config`，key = bundle 包名）。
- REQ-2 三组控件都在这一页：目标发行版（下拉）、刷新频次（**两个**下拉：端口转发页 / 容器页）、提权策略（三档）。
- REQ-3 发行版下拉的候选来自**只读轻路由**，不跑 `docker ps`（唤醒后首次会 11–12s 且被硬超时砍掉）。
- REQ-4 **显式保存**：未改动时保存按钮置灰；`dirty` 用指纹判定（`JSON.stringify` 比较），不靠「点过没有」。
- REQ-5 提权策略是安全开关：改档后首次保存**只亮确认条**，未确认 ⇒ **零** `settings.update` 调用。
- REQ-6 一次保存写两个命名空间：`distro` 同时写 `wsl-ports` 与 `wsl-containers`（组件之间不许分叉）；
  刷新频次各写各的；**只写改动过的字段**。
- REQ-7 任一命名空间写失败 ⇒ 页面如实报失败，**不许**显示「设置已保存」。
- REQ-8 右栏页页头不再有频次下拉与「目标发行版：…」文字（单入口原则）。
- REQ-9 跨组件写不越界：`src/**` 不出现对方的路由前缀字面量（三包零交叉门 R4）。

## 交付形态

```
packages/wsl-docker-ports/src/client/config-slot.ts   → slots.register({ name: 'plugins.bundle.config', key: 'dsh-wsl-docker-ports' })
packages/wsl-docker-ports/src/client/config-page.tsx  → 三组控件 + 指纹脏判定 + 两段式提权确认 + 双命名空间写
packages/wsl-docker-ports/src/client/settings-pipe.ts → readNamespace / writeNamespace（同一个 remote.settings）
packages/wsl-docker-ports/src/route.ts                → GET /dsh-wsl-docker-ports/distros（只跑 wsl -l -v）
packages/wsl-docker-containers/src/client/config-slot.ts   → 行配置键订正为 `dsh-wsl-docker-containers#wsl-containers`
packages/wsl-docker-containers/src/client/containers/config-page.tsx → 收窄为「容器通道凭据」一页
```

## 验收标准（二值判定）

| # | 判据 | 证据 |
| --- | --- | --- |
| A-1 | 卡片页里配置页出现在描述与「包含的组件」之间 | 真机快照（heading「WSL Docker 工具箱 · 配置」在描述之后、`包含的组件` 之前）+ 截图 |
| A-2 | 三组控件与两个刷新值在场，初值读自配置 | `config-page.test.tsx` C1（distro=Ubuntu2204 / ports=15 / containers=30） |
| A-3 | 未改动 ⇒ 保存置灰、零写入 | C2 |
| A-4 | 一次保存写 `wsl-ports`（distro / refresh）+ `wsl-containers`（refresh + distro） | C3 三条 patch 逐字断言 |
| A-5 | 改提权档未确认 ⇒ 零 `update`；确认后才写 | C4 |
| A-6 | 写失败不谎报「已保存」 | C5 |
| A-7 | 页头无频次下拉 / 无发行版文字 | `refresh-interval.test.tsx` A1/A2（`sel-refresh-interval` 为 null）+ `containers-pane.test.tsx` D2-1/D2-5 + 真机快照 |
| A-8 | `/distros` 只读、零 docker、失败原样透出 | `distros-route.test.ts` D1–D5（快照装配 0 次） |
| A-9 | 零交叉门 R4 绿（228 文件），主包体积不越地板 | `check-borders` exit 0；ports 52,689 ≤ 56,350、containers 31,322 ≤ 31,324 |

## 真机证据（2026-10-27，profile `accept-docker-ports`，端口 43391）

- 卡片页快照：`heading "WSL Docker 工具箱 · 配置"` → 「目标发行版 / 刷新频次（端口转发页 15 秒、容器页 关闭）/ 提权策略 每次询问 / 端口作用域（只读）」→ `heading "包含的组件"`（共 2 个 · 2 运行中）。
- 保存前后：`保存设置` 由 disabled → enabled，状态文字「有未保存的改动」→「设置已保存」。
- 落盘（`cordis.patch.yml` 真字节）：
  `wsl-ports: { distro: Ubuntu2204, refreshIntervalSec: 60 }`、`wsl-containers: { refreshIntervalSec: 30, distro: Ubuntu2204 }`。
- 截图：`evidence-bundle-config-page.png`（本目录；929×917，卡片页三组控件 + 「设置已保存」）。

## 不做（本轮边界）

- 不做 whale-pet 那种 **600ms 防抖自动保存**（提权档是安全开关，显式保存 + 二次确认才符合 REQ-12.4）。
- 不改 `refreshIntervalSec` 的存储位置（仍是各命名空间一个值，符合「两个值」）。
- 不合并两个组件包（015/016 的拆包结论不动）。
