---
status: in-progress
created: 2026-10-31
priority: high
tags:
- write-channel
- credential
- ux
- client
created_at: 2026-10-31T06:06:59.466941700Z
updated_at: 2026-10-31T06:06:59.466941700Z
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
