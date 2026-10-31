---
status: complete
created: 2026-10-31
priority: high
tags:
- write-channel
- credential
- ux
- client
created_at: 2026-10-31T06:06:59.466941700Z
updated_at: 2026-10-31T09:23:31.669697800Z
completed_at: 2026-10-31T09:23:31.669697800Z
transitions:
- status: complete
  at: 2026-10-31T09:23:31.669697800Z
---
# 019 写凭据「一步到位」+ 客户端持久化

## 背景（2026-10-31 真机）

主人截图反馈两件事：

1. **配置页没有可用的一次性动作**：容器行配置页只有手填输入框，保存后**只写服务端**（`writeWriteToken`），客户端还要去右栏容器页**再粘一次**；
2. **「本会话」凭据没有意义**：`sessionStorage` 关掉即丢 ⇒ 每次重启都要重填，而凭据本来就明文躺在 profile 的 `cordis.patch.yml` 里，会话级并没有换来真实收益。

转发侧（`wsl-docker-ports`）本来就有「生成并保存写通道凭据」，一次动作 = 写 settings + 写客户端存储；容器侧缺这半边 ⇒ 两侧交互不对称。

## 决定（主人 2026-10-31 拍板，原话「可以」+「这个本会话的有什么意义么」）

- **D1**：容器行配置页补「生成并保存容器通道凭据」——生成 64 位 hex ⇒ 写 `wsl-containers` 命名空间的 `writeToken`（volatile，即时生效）⇒ **同一次动作**写客户端存储；
- **D2**：手填 + 「保存设置」也一步到位（settings + 客户端存储同时写）；
- **D3**：客户端凭据存储由 `sessionStorage` 改为 `localStorage`，**两侧统一**（转发侧同步改）；
- **D4**：右栏输入框保留，定位改为「手动覆盖 / 换机器临时填」，并显示**服务端是否已配置**（布尔，不回显值）；
- **D5**：修掉容器包 `WRITE_TOKEN_STORAGE_KEY` 的命名空间串台（常量值曾是 `dsh-wsl-docker-ports.writeToken`，实际运行键是 `wsl-containers.writeToken`）。

## 为什么不抢（本轮要回答的疑问）

两层都已隔离，代码事实：

| 层 | 转发侧 | 容器侧 | 结论 |
| --- | --- | --- | --- |
| 服务端 settings 命名空间 | `wsl-ports`（`settings-pipe.ts` 的 `SETTINGS_NAMESPACE`） | `wsl-containers`（`surface.ts` 的 `PAGE_ID`） | 各自字段独立 |
| 客户端存储键 | `dsh-wsl-docker-ports.writeToken` | `wsl-containers.writeToken` | 不撞键 |
| 生成动作写入目标 | 自己的命名空间 | 自己的命名空间 | 互不影响 |

⇒ **生成动作不会互相覆盖**。唯一隐患是容器包里那条复制粘贴来的常量字符串（D5），它当前是死代码，改键后把「两个真相」合成一个。

## 判据（二值可判）

- **AC1**：容器配置页点「生成并保存」⇒ 恰好 1 次 `settings.update('wsl-containers', { writeToken: <64 hex> })`，且客户端存储里同一串（键 `wsl-containers.writeToken`）；
- **AC2**：转发侧同名动作仍只写 `wsl-ports`，两键**同时存在**且值不同 ⇒ 互不覆盖；
- **AC3**：手填 + 「保存设置」同样写两处（settings + 客户端存储）；
- **AC4**：两侧客户端存储都是 `localStorage`（模拟重启：新建 store 实例仍能 `read()` 到值）；
- **AC5**：右栏状态行显示「服务端：已配置/未配置」布尔，源码里**没有**回显凭据本体；
- **AC6**：容器包 `WRITE_TOKEN_STORAGE_KEY` = `'wsl-containers.writeToken'`，`surface.ts` 复用该常量（不再手拼）；
- **AC7**：`check-exports` / `check-size` / `check-borders` / `verify-client-loader` / `assert-client-split` 全绿；`tsc` + 两套测试 exit 0。

## 变更留痕

- 2026-10-31 建立（主人当日拍板 D1–D5；起因 = 真机截图里「本会话已保存」与服务端 401 并存）。
- 2026-10-31 **AC8 追加 + D6**（真机验收时主人原话：「本包配置页的入口理应点击进入，但是没有可以点击的地方」）：
  容器行的配置页**根本进不去** —— 注册键 `plugins.row.config` 的前半还停在改壳前的
  `dsh-wsl-docker-ports#wsl-containers`，而 017 之后卡片所属包已是 `dsh-wsl-docker-ports-bundle`
  ⇒ 宿主 `rowConfigKey(pkg.name, row.rowId)` 恒不命中 ⇒ 无「配置」按钮。**服务端本身是好的**
  （真机实测 `/dsh-wsl-docker-ports/snapshot` 200、`/dsh-wsl-docker-containers/snapshot` 200、
  两侧 `/health` 200）⇒ 这是纯客户端注册键缺陷，与 0.1.4 的按钮实现无关。修法 = 键改为
  `dsh-wsl-docker-ports-bundle#wsl-containers`（提交 `56819a1`）。
- **AC8**：容器行与转发行的 `plugins.row.config` 注册键都等于 `卡片所属包名#行 id`
  （`dsh-wsl-docker-ports-bundle#wsl-containers` / `…#wsl-ports`）⇒ GUI 里两行都有可点的「配置」入口。
- **D6**：`link:` / `file:` 往 Electron 托管的 `desktop` profile 里塞包**不可行**（宿主自己拒绝
  `dsh plugin --profile desktop`：「managed exclusively by the Electron application」；且 `file:` 装法
  会让客户端主 bundle 的组合 URL rev 对不上 ⇒ 整包 404 ⇒ 配置槽不注册 ⇒ 就是你看到的「没有可点的地方」）。
  ⇒ 交付路径只有一条：**发 npm → 从 GUI 装**；本地验证则先把仓库包 `link:` 进 profile 的
  `dependencies`（bundle + 两条行插件，缺行插件则 patch 行解析不到）。
- 2026-10-31 **D7 + AC9**（主人看到右栏那个 `[输入框][保存]` 后问「如果配置了配置内页的 key 这个还有用吗？」，
  我给出 A/B 两案，主人**选定 B** 原话：「B：删掉右栏输入框 + 保存按钮，只留配置内页」）：
  右栏那个 `保存` 只调 `runtime.saveToken`（`pane.tsx:290` 旧实现）⇒ **只写本机 localStorage、不写服务端**，
  而 placeholder 与配置内页一字不差 ⇒ 容易误解成「保存了就生效」，实际写完服务端仍 401。
  ⇒ 删掉右栏 `.wdp-token-row`（input + 保存）与页内 `tokenDraft`；页头保留两个**只读**布尔
  （本机已记住 / 服务端已配置·未配置）。**代价（主人已确认接受）**：失去「不轮换服务端、只让本机采纳既有值」
  与「一键清空本机凭据」两条路径 —— 要换值就去配置内页重填（会轮换）或点「生成并保存」。
- **AC9**：容器页 DOM 里 `input` 数为 0、无 `.wdp-token-row`、无 `inp-containers-token` / `btn-containers-token-save`
  ⇒ 凭据写入口唯一（配置内页）；页头仍显示「容器通道凭据：本机已记住/未保存」+「服务端：…」两个布尔。

## 完成（2026-10-31）

- 主人真机验收通过：「其他已经确认可用了」⇒ 配置入口可点、页内「生成并保存」产出一次性凭据并标「已配置」、
  右栏只剩两个只读布尔、重启后两者仍在。状态置 `complete`。
- 交付版本 **0.1.6**（npm latest，五个包）：`dsh-wsl-shared` / `dsh-wsl-docker-core` /
  `dsh-wsl-docker-containers` / `dsh-wsl-docker-ports` / `dsh-wsl-docker-ports-bundle`。
- ⛔ **0.1.5 作废**：那一版用 `npm publish` 直发包目录，`workspace:*` 未被改写 ⇒ registry 上装不上；
  npm 侧已 `deprecate`，git tag `v0.1.5` 只留本地不推。教训：**发布必须走 `pnpm pack`（改写依赖）+
  `npm publish <tgz>`**，且发布后要用 `registry 版本端点 + 干净目录从 registry 安装` 双向复验。
- 提交留痕：`56819a1`（注册键）→ `c2e7b80`（门路径）→ `e2d8662`（删右栏输入框）→ `7fdd80f`（0.1.5）
  → `20bd0c8`（0.1.6），作者身份统一改写为 `Veronica Davichi` 后 `7a4e769`。
