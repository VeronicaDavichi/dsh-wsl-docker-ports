# 真机 fixture（001 T0.1）

**来源**：本机（Windows 11 23H2 · WSL **2.7.3.0** · 发行版 **`Ubuntu2204`**），
采集时间 **2026-10-08 21:2x（+08:00）**。
**采集方式**：`Start-Process -RedirectStandardOutput`（**字节级**重定向，不经 PowerShell 文本管道 → 保真，
不会把 UTF-16LE 重新编码成 UTF-8）。

| 文件 | 来源命令 | 编码指纹（实测） |
| --- | --- | --- |
| `wsl-list-verbose.raw` | `wsl.exe -l -v` | **UTF-16LE**（前 12 字节 `20 00 20 00 4E 00 41 00 4D 00 45 00` = `"  NAME"`；NUL 占比 50%），行尾 **LF（无 CRLF）** |
| `wsl-version.raw` | `wsl.exe --version` | **UTF-16LE**，表头是**中文**「WSL 版本」 |
| `wsl-eth0-ip.raw` | `wsl.exe -d Ubuntu2204 -- ip -4 -o addr show dev eth0` | UTF-8；`172.20.201.152/20`（与 19 条 portproxy 的 connectaddress 一致 = 尚未漂移） |
| `wslconfig.raw` | `%USERPROFILE%\.wslconfig` | UTF-8（**无 BOM**、无 NUL）；**32 字节**、行尾 **CRLF**、**无尾换行**；只有 `[wsl2]` + `localhostForwarding=true` ⇒ **NAT 缺省**（组件②的硬前提成立） |

## T0.1 要定案的三条假设 → 结论

| # | 假设 | 结论（实测） |
| --- | --- | --- |
| A-1 | `wsl -l -v` 是 UTF-16LE 吗？ | ✅ **是 UTF-16LE**（不是 UTF-8，也不是「随 locale 变」）；解码后须剥 BOM 与 NUL |
| A-2 | 表头会不会本地化？ | ⚠️ **同一工具不同子命令不一致**：`wsl -l -v` 表头是**英文** `NAME STATE VERSION`，而 `wsl --version` 是**中文**「WSL 版本」 ⇒ 解析器**不得**以任何表头字面量为硬前提。本实现靠「**最后一列必须是 1 或 2**」判数据行，表头自然被跳过 |
| A-3 | `netsh` 输出编码？ | ✅ **本机是纯 ASCII**（英文表头、高位字节 0%）→ 见 003 的 fixture（`netsh-portproxy-v4tov4.raw`），**不存在** OEM/GBK 中文表头问题 |

## 脱敏

本目录**无凭据**：不含 token / 密码 / 用户名；`wslconfig.raw` 原文仅一行键值（`localhostForwarding=true`），
`wsl-list-verbose.raw` 只含发行版名与状态。

## 冷启动成本（顺带实测，服务「自动探测必须门控」这条结论）

`wsl -d Ubuntu2204 -- ip -4 -o addr show dev eth0`（发行版处于 Stopped 空闲态）**12,827 ms** —— 与既有实测
（11.1 s / 12.5 s）一致，量级稳定在 **11–13 s**。
