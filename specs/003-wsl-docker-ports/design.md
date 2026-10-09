# 技术设计：dsh-wsl-docker-ports

> 从 [requirements.md](./requirements.md) 派生（requirements-first）。任务见 [tasks.md](./tasks.md)。

---

## 1. 架构与依赖

    ┌─ 本包（插件行 + 右栏页 + 可选配置页）──────────────────────────────┐
    │  read-path   docker-probe   → 001.run(wsl.exe -d X -- docker ps)  │
    │              portproxy-probe → 001.run(netsh … show v4tov4)       │
    │              wslconfig-probe → 001.wslconfig + 本包读 localhost-  │
    │                                Forwarding（单消费者，不进 001）    │
    │  diff-engine 纯函数：期望集 ∩ managedPorts → 五态分类              │
    │  ownership   增/删/修 三条路径 + 前后快照自证                       │
    │  elevation   临时 .ps1 + Start-Process -Verb RunAs + 临时文件回传    │
    │  ui          容器表 / 端口表 / 作用域 / 提权策略 / NAT 门 / UDP 提示 │
    └─────────────┬───────────────────────────────────┬─────────────────┘
                  │ 依赖（单向）                       │ 可选注入（无包依赖边）
                  ▼                                   ▼
        packages/wsl-shared (001)          packages/terminal-profiles (002)
        distros · eth0 · pathmap ·         ctx.inject(['managedTerminal'])
        wslconfig · exec                    → 下一期 exec 用（REQ-10）

**属 003 的层**：`read-path`（docker / netsh / `.wslconfig` 解析）· `diff-engine`（五态纯函数）· `ui`（容器表 / 端口表 / 外部规则清单 / 端口声明 / NAT 门 / UDP 提示）。
**属 [005](../005-elevation-write-path/design.md) 的层**：上图里的 `ownership` 与 `elevation`（**2026-10-08 拆出**；同包，代码在 `src/write/` 与 `src/elevate/`）。**提权辅助留在本包**（只有本包消费，符合 001 的准入标准 REQ-6.1）；`netsh` 与 `docker` 的**解析**在 003，**写规则与提权**在 005。

---

## 2. 数据模型

| 类型 | 形状 | 来源 |
|---|---|---|
| `Container` | `{ id, name, image, state, status }` | `docker ps --format '{{json .}}'`（**不是** `--format json` —— 实测会挂住，T0.2）|
| `PortMapping` | `{ hostIp, hostPort, containerPort, protocol }` | 解析 `Ports` 字段（`0.0.0.0:8080->80/tcp`、`[::]:8080->80/tcp`）|
| `ExpectedForward` | `{ port, protocol, scope, containerName }` | `PortMapping` ∩ `managedPorts` |
| `ActualRule` | `{ listenAddress, listenPort, connectAddress, connectPort }` | `netsh … show v4tov4` |
| `PortStatus` | `'ok'｜'missing'｜'drift'｜'conflict'｜'extra'` | diff-engine |
| `ElevationPolicy` | `'none'｜'ask'｜'passby'`（默认 `none`）| 配置 |
| `Scope` | `'loopback'｜'lan'`（默认 `loopback`）| 配置（逐端口）|
| `TargetDistro` | `{ name: string; source: 'config'｜'wslDefault'｜'onlyOne'｜'first'; state: 'Running'｜'Stopped' }` | 由 **001 REQ-1.7** 解析（D-4）；**不持久化**，每次读取时解析；只读 `wsl -l -v`，**绝不** `wsl -d` 探状态 |
| `ElevationJob` | `{ id, action, port, script, outFile, state }` | 提权任务表（在途任务，供 REQ-12.4）|

---

## 3. 端口状态机（diff-engine，纯函数）

    输入：mappings[]（docker 实际）、managedPorts[]（配置）、actualRules[]（netsh）、
          eth0Ip（001）、localhostForwarding、scopes{}

    ① 期望集 = mappings ∩ managedPorts           （REQ-3.1）
    ② 对每个期望端口 p：
         rules(p) = actualRules.filter(r => r.listenPort === p)
         若无规则                      → missing（**仅当该端口 `needsRule`**；loopback + `localhostForwarding=true` ⇒ **无需规则**，**不是** missing → 005 REQ-2.2）
         若有规则且 connectAddress==eth0Ip → ok
         若有规则且 connectAddress!=eth0Ip 且 connectPort 与期望一致 → drift   （REQ-6.1）
         若有规则且 connectAddress 既非当前 eth0、也非本插件写入值
                                       → conflict（**只报告**，不修改/不删除 → 005 REQ-1.3）
    ③ 对每个 managedPorts 内、已不在期望集的端口：
         若有规则 → extra（提示可移除，不自动）
    ④ managedPorts 之外的规则：**不参与五态计算**（REQ-4.1），但**出现在「外部规则」只读清单**（REQ-15：不进五态、无动作）

**判定优先级**：`conflict` > `drift` > `ok`，避免一条规则被同时算成两种状态（REQ-3.3）。

> ⚠️ **订正留痕（2026-10-09，集成期；由 003 Phase 2 实现 + 同族复核共同暴露）**：本节 ② 原文为「形态与本插件声明不符（`connectPort` 不符 / `listenAddress` 非本插件会写的值）→ conflict」。**定案三段**：
> ① **`conflict` 判据 = 「形态根本不是本插件会写的」**：`connectPort` ≠ 期望端口 **或** `listenAddress` ∉ {`127.0.0.1`, `0.0.0.0`}（本插件只写这两种，见 005 §2）⇒ 只报告、**绝不修改或删除**（005 REQ-1.3）。
> ② **`listenAddress` 落在上述两形态之内、但与「声明作用域」不一致**（典型：声明 loopback、规则却监听 `0.0.0.0`）⇒ **不再判 conflict，改判事实位** `scopeMismatch: boolean`（**不改变** `state`）。理由：conflict 的语义是「SHALL NOT 修改或删除」，而 005 REQ-1.2 明确授权改写 `connectAddress` 匹配的规则 —— 真判 conflict 会把**本机 19 条既有 `0.0.0.0` 规则**在用户一声明端口后**永久锁死**（连「它暴露给了局域网」都修不掉），安全上更糟。
> ③ `connectAddress` ≠ 当前 eth0 且形态相符 ⇒ `drift`（旧→新，REQ-6.1），**优先于 `ok`**（否则「一条好规则 + 一条陈旧规则」会被报成 ok，把陈旧的那条藏起来）。原引用的 `REQ-4.3` 已迁至 005 ⇒ 引用改为 **005 REQ-1.3**。
>
> 🔴 **遗留张力（待主人拍板；2026-10-09 登记，不阻塞读侧）**：005 REQ-1.3 把 conflict 的另一半定义为「`connectAddress` **既非当前 eth0、也非本插件写入值**」，而本设计**不建台账**（见 [types.ts](../../packages/wsl-docker-ports/src/diff/types.ts) 的说明）⇒「**本插件写入值**」**不可判定**（无法从规则本身分辨「谁写的」）。本实现改用「形态」代理该判据，后果：一条 `connectAddress` 指向**第三方**地址（如 `192.168.1.50`）的规则会被报 **`drift`（可修）**，而 005 REQ-1.2 的删除前置（`connectAddress` == 期望值）**不授权**动它 ⇒ UI 可能引导一个写路径必须拒绝的「修复」。两条出路（**集成方推荐 ①**）：① 005 侧把「声明式所有权」贯彻到底 —— 所有权由 `listenPort ∈ managedPorts` 界定（005 REQ-1.1 的本意），删/改不再额外要求 `connectAddress` 匹配；② 003 侧为「`connectAddress` 非 eth0 且归属不可判定」另设**只读态**（不进五态、无动作）。**拍板前行为**：003 维持 `drift`（读侧只报告、不产生任何写动作），动作授权仍全部归 005 ⇒ 两侧都不会因此产生越权写入。
>
> **同批订正**：`missing` 补 `needsRule` 前提（loopback + `localhostForwarding=true` ⇒ **无需规则**，**不是** missing，否则会把用户引去加一条不该加的规则）。**影响面**：003 的 T2.1 表格驱动用例、Phase 5 的端口表标签、005 的 scope 切换序列；三处均以本注为准。

---

## 4 / 5 / 6（已迁出）：写操作算法 · 防火墙最小放行 · 提权辅助进程契约

三节**已整体迁至 [005-elevation-write-path 的 design.md](../005-elevation-write-path/design.md)** 的 **§2 / §3 / §4**（2026-10-08 拆分；内容逐条保留，含那张提权链路图与退出码表）。**节号 4 / 5 / 6 保留为空位**，以免既有引用错位。

003 侧只需知道一件事：**写操作由 005 提供**（`src/write/` 与 `src/elevate/` 属 005 的领地），本 Spec 的 UI 只负责触发与展示结果；「怎么写成规则、怎么提权、失败怎么收场」一律不在本 Spec 定义。

---

## 7. NAT 门与前置检查

| 检查 | 结果 | UI 行为 |
|---|---|---|
| `networkingMode` = nat / default | 通过 | 转发控件可用 |
| `mirrored` / `other` / 读取失败 | 拦截 | 全部写控件置灰 + 原因 + 修复指引（REQ-1.4）；**只读展示仍可用**（看一眼容器不违法）|
| docker 不可用 | 部分 | 容器表显示原因；端口表显示「无法取期望集」|
| `iphlpsvc` 未运行 | 部分 | 添加按钮置灰 + 提示启动服务（需提权）|
| 发行版 Stopped / WSL 未运行 | **P0 主路径** | 显式状态（非静默降级）：eth0 置「无法确定地址」、全部规则**不**标 drift（REQ-6.4）+ **「启动并核验」按钮**（**唯一**允许启动发行版的路径，明示约 10–12s）。实测依据：发行版**空闲自终止**是正常行为，刷新大概率撞上 |

---

## 8. 下一期注入点（REQ-10）

    ctx.inject(['managedTerminal'], scope => { /* 仅此处引用，字符串键，无 import */ })

- 服务缺失 → 控件保持置灰，回调永不触发，**不报错**（与 002 的 REQ-11.3 相扣）。
- 本期不实现 exec：控件存在、禁用、写明「下一期」（避免用户以为坏了）。

---

## 9. 安全（写路径部分已迁出）

**写路径的安全措施（误伤他人规则 / 局域网暴露 / 提权放大 / UAC 拒绝 / Agent 越权）已迁至 [005 的 design.md](../005-elevation-write-path/design.md) §5**（2026-10-08 拆分）。003 侧只剩三条：

| 面 | 措施 |
|---|---|
| 注入 | 所有命令经 001 的 `argv` 数组执行（无 shell 拼接）|
| 信息泄露 | 原始输出展示前脱敏；日志内容不落盘（REQ-11.3）|
| 配置写入 | live 字段只经 `settings` 三写操作（不重挂载）；`configEditor.edit()` 是完整配置路径（会重挂载），不用它；不手写 YAML（REQ-12.1）|

---

## 10. 错误处理

各失败路径的行为已在 [requirements.md](./requirements.md) 逐条写成 EARS（REQ-1.1 / 1.3 / 2.3 / 3.5 / 6.3 / 6.4 / 10.3 / 14.2），此处不重复；**写路径的失败语义（拒绝 UAC、半成品防护、退出码）在 [005 的 design.md](../005-elevation-write-path/design.md) §6**。统一口径：**失败必须给出可区分的原因，且不动任何不属于本插件的规则**。

---

## 11. 测试策略

| 层 | 载体 | 覆盖 |
|---|---|---|
| 纯函数单测 | `vitest` | `parseDockerPs`（两形态端口、UDP 标记）、`parsePortproxy`、diff-engine 五态与优先级、`managedPorts` 区间解析与求交 |
| 离线契约测试 | `node --test` + fixture | 真机 `docker ps --format '{{json .}}'` 原文、`netsh show v4tov4` 原文（含 19 条）、`.wslconfig` 原文；**断言对象是 fixture** |
| 真机 UI 验收 | **chrome-devtools MCP** | 见 tasks.md 清单；**本 Spec 的清单不触发提权**（UAC 行已迁 005），故无需人工点 UAC |
| 写路径相关 | **在 [005](../005-elevation-write-path/design.md)** | 所有权匹配、防火墙参数生成、scope 增删序列、提权脚本与退出码表、安全红线验收 |

---

## 12. 决策权衡

| 决策 | 取舍 | 被否方案与原因 |
|---|---|---|
| 期望集来自 docker 实际输出 | 依赖 docker 可用 | 硬编码端口（原脚本）→ 与真实映射脱节（坑 #3）|
| 本包自读 `localhostForwarding` | 与 001 职责略有重叠 | 为 001 加一个单消费者键 → 破坏 001 的准入标准；该键只用一次 |
| 外部规则只读展示（D-2）| 首启多一块区域 | 完全不显示 → 用户看到 19 条规则却不知它们哪来的；显示且只读 = 有信息、无风险 |
| 端口声明提到 P0（D-3）| P0 变大 | 留到 P1 → P0 无法声明端口、进不了五态，交付物只剩只读展示 |

> **写路径相关的决策（声明式所有权 / 默认 loopback / 提权默认 `none` / 提权走临时 `.ps1` / 卸载不自动清理 / 提权辅助留在本包）已迁至 [005 的 §8](../005-elevation-write-path/design.md)**（2026-10-08 拆分）。

---

## 13. 已知限制

1. **只支持 TCP**：portproxy 不支持 UDP，已在 UI 明示（REQ-9），不做代偿。
2. **只覆盖 v4tov4**：`v6tov6` 不在范围，IPv6 监听地址（`[::]`）只在解析层识别、不生成规则。
3. **镜像模式不可用**（REQ-1）：非 NAT 一律置灰，不提供镜像模式下的替代方案。
4. **A-3 定案（2026-10-08 实测，**含反证**）**：漂移触发条件理论上是 **WSL 实例重建**，但 **T0.2 两次重建实测（单发行版 `--terminate` / 整台 `--shutdown`）eth0 都未变**（同一地址三次采样一致）⇒ **本机不可复现**。⇒ **不做**常驻守护 / 启动钩子 / 心跳：检测 = 插件激活 + 页面刷新各一次 + **写入前强制现读**（写错的代价是亲手造一条新的坏规则）；修复仍走「一键 + UAC」。实测成本（用于门控）：`wsl -d` 热 **~200ms**、**冷启动 11–12s**，且**每次调用都阻止发行版空闲回收**（`vmmemWSL` 实测占 2,180 MB）⇒ 自动探测必须门控；`docker ps --format json` **会挂住** ⇒ 必须 `--format '{{json .}}'` **且加硬超时**。⚠️ 本机不可复现 **≠** 其他机器/版本不会（DHCP 语义非契约），故 REQ-6 保留、不删。
5. **在途提权任务与配置编辑**：编辑配置可能重挂载本行，在途任务丢失；本期以「保存前确认」缓解（REQ-12.4），不做任务持久化。
6. **不做 compose / 镜像管理**（下一期），本 Spec 只落 exec 注入点。

> **提权相关的已知限制（UAC 弹窗无法自动化、Agent 在 `passby` 下降级与否待择一）在 [005 的 §8](../005-elevation-write-path/design.md)**（2026-10-08 拆分）。
