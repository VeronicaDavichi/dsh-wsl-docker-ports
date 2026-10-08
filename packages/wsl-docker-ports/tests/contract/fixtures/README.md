# 真机 fixture（003 T0.1）

**来源**：本机（Windows 11 23H2 · WSL 2.7.3.0 · `Ubuntu2204` · docker server **29.5.3**），
采集时间 **2026-10-08 21:2x（+08:00）**。

| 文件 | 来源命令 | 编码 / 形态（实测） |
| --- | --- | --- |
| `netsh-portproxy-v4tov4.raw` | `netsh.exe interface portproxy show v4tov4` | **纯 ASCII**（高位字节 **0%**；表头英文 `Listen on ipv4:`）、**CRLF**、**19 条**规则 |
| `docker-ps.redacted.jsonl` | `wsl -d Ubuntu2204 -- timeout 20 docker ps --format '{{json .}}'` | UTF-8、**JSON Lines**（每容器一行）、**6** 个容器 |

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
