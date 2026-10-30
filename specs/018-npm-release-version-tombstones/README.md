---
status: complete
created: 2026-10-30
priority: high
created_at: 2026-10-30T00:54:46.027444Z
updated_at: 2026-10-30T00:54:55.066276200Z
completed_at: 2026-10-30T00:54:46.177451300Z
transitions:
- status: complete
  at: 2026-10-30T00:54:46.177451300Z
---
# 018 · npm 发布流程与版本号占位事故留痕（0.1.2）

## 背景

npm 公共包的三次发布（`0.1.0` 坏包 → 整包删除 → `0.1.2` 成功）暴露了两个**与代码无关**的硬失败模式，每个都造成过真实断供。本文是**事故留痕 + 发布流程 SSoT**，不是功能 Spec；判据全部来自真机命令输出。

## 事实时间线（2026-10-28 ~ 10-30，本地 UTC+8）

- 10-28 `0.1.0` 五个包发布成功（`npm publish` exit 0 ×5），**装到消费者机器起不来**：`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`。
- 10-28 根因：`dsh-wsl-shared` / `dsh-wsl-docker-core` 是**源码包**（`exports` → `./src/index.ts`）。workspace 里 `link:` 的 realpath 在 `node_modules` **之外** ⇒ Node 24 允许类型剥离；装进 `node_modules` 后 Node **明确禁止**。
- 10-28 修复：两包加 `tsconfig.build.json`（`outDir: lib`）+ `exports`/`main`/`types` 指向 `lib` + `files:["lib/**"]` + `prepare` 脚本 ⇒ 改发 `0.1.1` 并 `deprecate` 掉 `0.1.0`。
- 10-28 删除阶段：granular + bypass 2FA 的 token **不能 unpublish**（403）；登录 token 能删但要 OTP ⇒ 由主人手工在网页删除，**删掉的是整个包**（不是单个版本）。
- 10-29 后果一：整包删除触发 npm **「24 小时内不得重发同名」**（`403 cannot be republished until 24 hours have passed`）⇒ 五个包全部不可安装，`0.1.1` 的好构建一并消失。
- 10-29 三次定时重试（17:45 / 18:50 / 20:30）全部卡在 **凭据 401**（旧 token 已被吊销），与锁无关。
- 10-30 新 bypass token 到位后首次发布 `0.1.0` 被拒：
  `400 Bad Request - Cannot publish over previously published version "0.1.0"`
  ⇒ **被删的版本号本身永久不可复用**（不只锁名字 24 小时）。
- 10-30 改发 `0.1.2`：`shared` ✓ / `core` ✓ / `containers` ✓（首发）/ `ports` ✓（第 2 次）/ `bundle` ✓（第 2 次）。
  首发遇 `409 Failed to save packument`（新包刚创建就写下一个）⇒ 等 15–20 s 重试即过，**非包缺陷**。
- 10-30 三步验证全过：registry 5/5 `latest=0.1.2`、干净目录 `pnpm add` exit 0、壳包上下文四个 import 全成功（`shared` 8 导出 / `core` 48 / `ports` 与 `containers` 的 `Config` 与 `apply` 均为 function）。

## 发布硬规则（违反即禁止发布）

- **R1 冒烟绿才发**：`node scripts/release-smoke.mjs --tarballs <目录>` 必须 exit 0。脚本把「消费者视角」固化为判据：干净目录 `npm i` 全部 tarball → 逐个 `import` → `shared`/`core` 导出数 > 0 且 `ports`/`containers` 的 `Config` 与 `apply` 都是函数。负向自检 `--expect-fail` 必须红（实测喂 10-28 的坏 tarball → exit 1，报错原文即 `Stripping types is currently unsupported for files under node_modules`）。
- **R2 永不删包、永不删版本**：有问题一律**发新版本号**。两级代价都实测过：整包 unpublish → 24 h 名称锁（断供一天）；过了 24 h 也**救不回版本号**（`Cannot publish over previously published version`）⇒ `0.1.0`/`0.1.1` 双双作废。
- **R3 发布后三步验证**：registry 快照（`versions` / `latest` / bundle 的 `dependencies`）→ 干净目录 `pnpm add <bundle>@<ver>` exit 0 → 壳包上下文四个 `import` 全成功。缺一条视为未发成功。
- **R4 发布前一律先过 R1，再动手 `npm publish`**；顺序不得颠倒（10-28 的教训就是「本地验过」被当成了「装得上」）。
- **R5 registry 读缓存会滞后**：验证必须带 cache-busting 查询参数并重试（本次最快第 1 次即 5/5，最慢到第 4 次才追平）；pnpm 自己的元数据缓存可能仍解析旧 `latest` ⇒ 装机验证要显式带版本号。

## 当前状态（0.1.2）

- 五个包：`dsh-wsl-shared` / `dsh-wsl-docker-core` / `dsh-wsl-docker-containers` / `dsh-wsl-docker-ports` / `dsh-wsl-docker-ports-bundle`，`latest = 0.1.2`。
- 壳包 `dependencies` = `{"dsh-wsl-docker-ports":"0.1.2","dsh-wsl-docker-containers":"0.1.2"}`，`dsh.bundle.patch = ./cordis.patch.yml`（两个 `insert` 行：`wsl-ports` / `wsl-containers`）。
- 每个包上方另有一个 `0.0.0-stage` 占位版本（npm 分阶段发布自动生成，2 文件，**不是 latest**）⇒ **不要删它**（删了又占一个号）。
- 首次装机的正确写法：`dsh plugin --profile <name> add "dsh-wsl-docker-ports-bundle@0.1.2"`（GUI 里输 `dsh-wsl-docker-ports-bundle@0.1.2`）。

## 真机装机验收（2026-10-30，0.1.2）

- 装法：在**主人自己指定**的 `desktop` profile 里装 `dsh-wsl-docker-ports-bundle@0.1.2`（本次由主人手工完成，非我方代装 —— 探针红线仍原样有效）。
- 落盘事实：`dependencies` 里 `dsh-wsl-docker-ports-bundle = 0.1.2`；`dsh.profile.bundles` 末位含该包；
  `node_modules` 下五个包**全是 real dir、全 v0.1.2**（不再是 `link:`），插件入口 `lib/index.js` + `lib/client.js` 与壳包 `cordis.patch.yml` 均在。
- 加载结果（**主人目视确认**）：重启后侧栏出现两页 —— **WSL 端口转发** + **WSL Docker 容器**；插件卡片标题为 **WSL Docker Ports**，卡片内两行组件 = **WSL Port Forwarding** / **WSL Docker Containers**（即 016「一张卡两组件」的设计在 npm 安装形态下同样成立）。
- 观察点（非缺陷）：`profiles/desktop/cordis.patch.yml` 里只会出现 `- id: wsl-ports`（settings 落盘写进去的，带 `config.writeToken`）；`wsl-containers` 行**来自壳包自己的 patch**，不落到 profile patch —— 别把这个差异误判成「只装了一个插件」。
- 我方无法自证的边界：本地 GUI（`127.0.0.1:51955`）直连返回 **401**，需会话凭据 ⇒ 界面确认只能由主人完成；文件层判据由本 Agent 只读核查（见上）。

## 待办

- 凭据：发布用 bypass-2FA granular token，**用完即从 `~/.npmrc` 移除**；用过的 token 一律吊销（本次两枚已吊销/清理）。
- `dsh-terminal-profiles` 仍为 private（peer/dep 可用性未定）⇒ 继续 `link:` 交付，未纳入 npm 五包。

