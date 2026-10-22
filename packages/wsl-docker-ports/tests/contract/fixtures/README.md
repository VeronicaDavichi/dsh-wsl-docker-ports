# 真机 fixture（003 T0.1）

**来源**：本机（Windows 11 23H2 · WSL 2.7.3.0 · `Ubuntu2204` · docker server **29.5.3**），
采集时间 **2026-10-08 21:2x（+08:00）**。

| 文件 | 来源命令 | 编码 / 形态（实测） |
| --- | --- | --- |
| `netsh-portproxy-v4tov4.raw` | `netsh.exe interface portproxy show v4tov4` | **纯 ASCII**（高位字节 **0%**；表头英文 `Listen on ipv4:`）、**CRLF**、**19 条**规则 |
| `docker-ps.redacted.jsonl` | `wsl -d Ubuntu2204 -- timeout 20 docker ps --format '{{json .}}'` | UTF-8、**JSON Lines**（每容器一行）、**6** 个容器 |
| `get-netipaddress.raw` | `powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference = 'Stop'; Get-NetIPAddress -AddressFamily IPv4 \| ForEach-Object { \"$($_.InterfaceAlias)\|$($_.IPAddress)\|$($_.PrefixLength)\" }"` | UTF-8、**CRLF**、**8 行**（`别名\|地址\|掩码长度`）、采集于 **2026-10-22** |

## `get-netipaddress.raw`（012 决策 1 的事实基础）

**原始 8 行**（未过滤）：

    vEthernet (WSL (Hyper-V firewall))|172.20.192.1|20
    以太网 4|192.168.31.129|24
    本地连接* 2|169.254.211.167|16
    aTrustVNIC|2.0.0.1|24
    本地连接* 1|169.254.83.246|16
    蓝牙网络连接|169.254.130.120|16
    WLAN|169.254.48.96|16
    Loopback Pseudo-Interface 1|127.0.0.1|8

过滤后**只剩** `192.168.31.129`（以太网 4，/24）—— 另外 7 行分别被网段（`172.16/12`、`169.254/16`、`127/8`）
与网卡别名（`vEthernet` / `aTrust` / `Loopback` / `蓝牙`）排除。这张表就是 012 验收 A1 的**逐条依据**：
`172.20.201.152`（WSL eth0）、`172.20.192.1`（WSL vEthernet）、`127.0.0.1` 都**不许**出现在下拉里。

⚠️ 这是**只读**采集（`Get-NetIPAddress`），不含任何可识别用户身份的信息（内网地址与网卡别名除外，
而它们本来就是 001/003 文档里的既有真机事实）。

## 采集时实测到的三条硬事实（已写进 `src/read/docker.ts` 的注释与 003 的 design）

1. 🔴 **`docker ps --format json`（不带大括号）会挂住**：两次被 `timeout` 杀掉（rc=124）⇒ 只能用
   `--format '{{json .}}'`（每容器一行 JSON）⇒ 解析器**只需单路径**，不做双路径兜底。
2. 🔴 **发行版冷启动后，第一次 `docker ps` 会被超时砍掉**：本次冷启动 **12,827 ms**（`wsl -d … -- ip …`）；
   紧接着第 1 次 `docker ps` 跑满 `timeout 20` 且 **0 输出**，**5 s 后**第 2 次 **637 ms** 成功。
   ⇒ 调用方必须**硬超时 + 重试**，且**不能**把空输出当成「没有容器」（否则 UI 会谎报 0 个容器）。
3. `Ports` 列三种真实形态：IPv4+IPv6 **双份**（`0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp`）、
   **端口区间**（`0.0.0.0:5002-5003->5002-5003/tcp`）、**空串**（未发布任何端口）。

## 这 19 条规则是用户真实数据

它们**不是**测试造的：是原脚本已经跑过一次的产物。**005 的红线断言「他人规则条数不变」就以这 19 条为基准**
（本组件只允许改动 `managedPorts` 声明集内的部分），因此解析器遇到形状脏的数据**必须抛错而不是静默丢行**。

## 脱敏策略（`docker-ps.redacted.jsonl`）

| 字段 | 处理 |
| --- | --- |
| `Ports` | **原样保留** —— 这是解析器唯一要吃的字段，且端口号不敏感 |
| `ID` | 换成 `dead…` 开头的假 12 位十六进制 |
| `Names` / `Image` / `Labels` / `Networks` / `Mounts` / `Command` | 分别替换为 `svc-a-1` / `registry.example/svc-a:1.0.0` / `com.docker.compose.project=proj-a,…` / `proj-a_default` / `/mnt/e/<redacted>/docker:/app` / `<redacted>` |
| `CreatedAt` / `RunningFor` / `Size` / `State` / `Status` / `HealthStatus` / `Platform` / `LocalVolumes` | 保留（不含敏感信息，且保留真实形态有助解析健壮性） |

**泄漏扫描**（入库后执行，必须 0 命中）：

    Select-String -Path docker-ps.redacted.jsonl -Pattern 'dify|PycharmProjects|EDY|n8n|ollama|weaviate|milvus|langgenius|/mnt/e/[a-z]'

结果 **0 命中** ✅。未脱敏原始文件**从未入库**（只存在于 `%TEMP%\docker-ps.raw.jsonl`）。
