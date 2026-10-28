# dsh-wsl-docker-ports-bundle — WSL Docker Ports（组合包壳）

> 017 六订·三十（2026-10-28 主人拍板）拆出来的**壳包**：这里**没有任何代码**，
> 只有「卡片大标题」与「两个组件行」的声明。

## 为什么要这个包

宿主的两处标题读的是**两份不同来源**（`@deepseek-ai/dsh-app-boot` 的 `readPluginMeta`
＋ 插件管理页的 `packageText` / `rowText`，逐行读过源码）：

| 界面位置 | 取值 |
| --- | --- |
| 卡片大标题 | **组合包**的 `locale/*.json` 的 `meta.title` |
| 「包含的组件」行标题 | 该行 `name` 指向的**那个包**的 `locale/*.json` 的 `meta.title` |

拆包之前 `dsh-wsl-docker-ports` 既是组合包又是它自己的第一行 ⇒ 两处读同一份文件，
必然同名。主人要「卡片叫 `WSL Docker Ports`、组件行叫 `WSL Port Forwarding`」⇒ 只能拆：
卡片搬到本壳包，组件行留在真包。

## 内容

- `package.json`：`dsh.bundle.patch` 指向本包的 `cordis.patch.yml`；依赖两个真实包（`workspace:*`）。
- `cordis.patch.yml`：插 `wsl-ports`（→ `dsh-wsl-docker-ports`）与 `wsl-containers`（→ `dsh-wsl-docker-containers`）。
  **行 id 不变**（`wsl-ports` 同时是 settings 命名空间）。
- `locale/{zh,en}.json`：`meta.title` = `WSL Docker Ports`（卡片标题）。

## 连带改动（不在本包内）

- `dsh-wsl-docker-ports` 摘掉 `dsh.bundle` 并交出 `cordis.patch.yml`（它现在只是「一行」）；
  它的 locale 标题回到 `WSL Port Forwarding`。
- 组合包名变了 ⇒ 客户端两个配置槽的键跟着改成新组合包名：
  `plugins.bundle.config` = `dsh-wsl-docker-ports-bundle`、
  `plugins.row.config` = `dsh-wsl-docker-ports-bundle#wsl-ports`
  （宿主用 `entryKey: pkg.name` / `${bundle}#${rowId}` 匹配，键不对卡片上的配置区就空着）。
- profile 的 `dsh.profile.bundles` 改指本壳包；两个真实包仍以 `link:` 装进 profile（`link:` 不装依赖）。
