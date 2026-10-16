# 技术设计：提权写路径

> 从 [requirements.md](./requirements.md) 派生（requirements-first）。任务见 [tasks.md](./tasks.md)。
> **2026-10-08 从 [003-wsl-docker-ports](../003-wsl-docker-ports/design.md) 拆出**：原 §4（写操作算法）· §5（防火墙最小放行）· §6（提权辅助进程契约）· §9（安全）连同提权相关的测试策略行，在此重编为 §2–§7；003 侧改为迁出指针。

---

## 1. 在包内的位置

    packages/wsl-docker-ports/
      src/read/         ← 003：docker ps 解析、netsh 解析（只读）
      src/diff/         ← 003：五态纯函数（期望集 ∩ 实际集）
      src/write/        ← 本 Spec：写操作算法（所有权匹配 + 精确增删）
      src/elevate/      ← 本 Spec：临时 .ps1 生成 + Start-Process RunAs + out 回传解析
      src/ui/           ← 003：页面（容器表 / 端口表 / 外部规则清单 / 端口声明表单）
      src/index.ts      ← 003：注册与收口（本 Spec 只被它调用）

**依赖方向**：本 Spec → 003 的 `read` / `diff`（同包内直接调用）。反向的运行时耦合（003 的按钮调本 Spec 的写操作）是**同包内代码调用**，不构成 Spec 级 `depends_on` 边（否则互相依赖成环）。本 Spec **不**触碰 UI、不持有页面状态。

---

## 2. 写操作算法（所有权，REQ-1）

| 动作 | 前置检查 | 提权脚本动作 | 后置自证 |
|---|---|---|---|
| 添加（apply）| NAT ✅ / 端口 ∈ `managedPorts` / 状态 ∈ {missing} | `portproxy add v4tov4 listenport=p listenaddress=<scope?0.0.0.0:127.0.0.1> connectport=p connectaddress=<eth0Ip>`；lan 时再加防火墙放行 | 重取实际集：该端口规则存在且 `connectAddress == eth0Ip` |
| 删除（remove）| 规则匹配 `(p, connectAddress == 本插件期望值)`（REQ-1.2）| `portproxy delete v4tov4 listenport=p`（**精确四元组，不用 reset**）+ 删除本插件防火墙规则 | 重取实际集：该端口规则消失；**他人规则条数不变** |
| 修复（fix-drift）| 状态 == drift | 先 delete 再 add（新 `connectAddress`）| 重取实际集：`connectAddress == eth0Ip`；失败则报告「未改」并保留可重试状态 |

**红线实现**：代码中不存在 `portproxy reset` 字符串；写操作一律带 `listenport` 参数（T3.1 用 grep 断言）。

**前后快照（REQ-1.5）**：每次写操作日志记录 `{ before: ActualRule[], after: ActualRule[], exitCode, stdout }`，真机验收以「他人规则条数不变」为通过条件。

---

## 3. 防火墙最小放行（REQ-2.3 / 2.6）

    New-NetFirewallRule -DisplayName "dsh-wsl-docker-ports-<port>"
      -Direction Inbound -Action Allow -Protocol TCP -LocalPort <port>
      -Profile Any -Group "dsh-wsl-docker-ports"

- **只放行该端口**，不做 `-LocalPort Any` / 不做全量放行（原脚本坑 #2）。
- 名称可识别 + 归组，便于 REQ-5 的手工清理清单。
- 同名已存在 → **报错**，不覆盖（REQ-2.6）。
- 移除 `scope=lan` 时同步删除该端口规则与防火墙规则；**只删自己建的**。

---

## 4. 提权辅助进程契约（REQ-3）

    Host (non-admin)                         elevated child
    ┌──────────────────────┐                ┌──────────────────────────────┐
    │ 1. 生成 %TEMP%\dsh-  │  Start-Process │ 6. 读参数（结构化，非命令文本）│
    │    ppp-<rand>.ps1    │ ──── RunAs ───►│ 7. 执行 portproxy/防火墙动作   │
    │ 2. 生成 out 文件路径 │                │ 8. 结果 JSON 写 out 文件        │
    │ 3. （ask）先确认     │                │ 9. 退出码：0 成功 / 2 部分失败  │
    │ 4. 等待退出码/超时   │◄── 退出码 ─────│    / 3 前置不满足 / 1 异常      │
    │ 5. 读 out 文件       │                └──────────────────────────────┘
    │ 10. 删除 .ps1 与 out │
    └──────────────────────┘

| 项 | 约定 |
|---|---|
| 参数 | `-Action add｜remove｜fix  -Port <p> -Address <ip> -Scope loopback｜lan`（**结构化**，REQ-3.7）|
| 输出文件 | JSON：`{ ok, action, port, steps: [{ name, ok, stderr }], beforeRules, afterRules }` |
| 退出码 | `0` 全成 / `2` 部分失败（有 steps 失败）/ `3` 前置不满足（NAT、服务、权限）/ `1` 异常 |
| 超时 | 默认 90s（UAC 弹窗等待由用户决定，超时后按失败处理，REQ-3.5）|
| 清理 | 成功 / 失败 / 超时三条路径都删 `.ps1` 与 out（NFR-2）|
| 半成品防护 | 脚本内部「防火墙失败 → 回滚已加的 portproxy」；Host 侧以 `steps` 判定并报告，不静默 |
| 拒绝 UAC | `Start-Process` 抛错（用户点「否」）→ 退出码视为失败，**不做任何回滚动作**（因为什么都没执行）|
| 🔴 真机留痕（2026-10-12）：**gsudo 退出码能力边界** | `gsudo` v2.6.1 经 `pwsh -Command` 包装时，**子进程退出码 `2/3/7/42/999` 一律塌成 `1`**（`0→0`、`1→1`；只有 gsudo **自身**调用失败才是 `999`）⇒ **gsudo 后端下 `2`(partial) 与 `3`(precondition) 不可区分**，本表第 3 行只有 **native** 后端真能落地。对 gsudo 的补救是「如实展示 `steps` + 按 `1` 报 `failure`」，**不改 gsudo**（不装工具 / 不改 PATH / 不动其配置）|
| 🔴 真机留痕（2026-10-12）：脚本**没有 no-op 成功动作** | 白名单只有 `add｜remove｜fix`（`script.ts`）⇒ 「临时脚本 `exit 0`」与「零规则写入」在产品自身链路里**不可兼得**（T0.1 的只读核对因此用**只读动作**满足，是原文准许口径）。新增动作要同步改白名单 + 脚本模板 + 三处用例，**本轮不新增**|

---

## 5. 安全对照表（REQ-1 / 2 / 3 / 4）

| 面 | 措施 |
|---|---|
| 误伤他人规则 | 声明式所有权 + 精确四元组删除 + **无 reset** + 前后快照自证（REQ-1）|
| 局域网暴露 | 默认 loopback；lan 逐端口显式 + 单端口放行（REQ-2）|
| 提权放大 | 脚本只接受结构化参数，不接受命令文本（REQ-3.7）|
| UAC 拒绝 | 优雅失败 + 零残留（REQ-3.5 / 3.6）|
| Agent 越权 | Agent 触发不得走 `passby`；docker 写操作对 Agent 拒绝（REQ-4.1 / 003 的 REQ-11.4）|
| 注入 | 所有命令经 001 的 `argv` 数组执行（无 shell 拼接）|
| 信息泄露 | 原始输出展示前脱敏；日志内容不落盘（003 的 REQ-11.3）|
| 配置写入 | live 字段经 settings 三写操作（不重挂载）；`configEditor.edit()` 是完整配置路径（会重挂载），不用它；不手写 YAML（003 的 REQ-12.1）|

---

## 6. 错误处理

各失败路径的行为已在 [requirements.md](./requirements.md) 逐条写成 EARS（REQ-1.3 / 3.5 / 4.1）。统一口径：**失败必须给出可区分的原因，且不动任何不属于本插件的规则、不留半成品、不留临时文件**。

退出码与 UI 文案的映射（`0`/`2`/`3`/`1`）由本 Spec 提供，UI 展示由 003 负责。

---

## 7. 测试策略

| 层 | 载体 | 覆盖 |
|---|---|---|
| 纯函数单测 | `vitest` | 所有权匹配、防火墙参数生成、scope 切换的增删序列（apply/remove/fix 的前后快照）|
| 提权路径（可测部分）| `vitest` + fake | 脚本参数生成、输出 JSON 解析、退出码表、三条清理路径、拒绝 UAC 的失败分支（fake `Start-Process` 抛错）|
| 离线契约测试 | `node --test` + fixture | `netsh show v4tov4` 原文（含 19 条）作为**前后快照**的比对基准 |
| 真机 UI 验收 | **chrome-devtools MCP** + **人工点 UAC** | 见 tasks.md 清单；**UAC 弹窗无法自动化，必须人工点击**，如实登记 |
| 安全红线验收 | 真机 + 规则快照 | 每次写操作后 `netsh show v4tov4` 总条数与「他人条目」不变（NFR-1 / C-3）|

---

## 8. 决策权衡与已知限制

| 决策 | 取舍 | 被否方案与原因 |
|---|---|---|
| 独立成 Spec（与 003 同包）| 多一份文档 + 一处运行时耦合需说明 | 与 UI/五态混在一起 → 003 已贴 200 行线，且最高风险面被淹没在只读逻辑里 |
| 声明式所有权（配置集合）| 用户要显式声明端口 | 台账文件记录历史规则 → 多一份状态、会与真实规则漂移（迁自 003 §12）|
| 默认 loopback | 局域网要逐端口开 | 默认 `0.0.0.0` → 复刻原脚本坑 #2 的攻击面（迁自 003 §12）|
| 提权默认 `none` | 开箱即用性差 | 默认 `passby` → 用户没同意就自动提权（迁自 003 §12）|
| 提权辅助留在本包（不进 001）| 与「共享」直觉相反 | 只有本包消费 → 进 001 违反其 REQ-6.1 准入标准（迁自 003 §12）|
| 临时 `.ps1`（+ native 后端的 out 文件）| 落盘（需清理）| 管道回读在完整性级别不同的进程间**不可行** ⇒ 有 `gsudo` 时改用其 **stdio 回传**（REQ-3.4）|
| 提权后端链 `gsudo → native`（A-3 ✅）| 需要探测 + 两条回传路径 | 「**要求**装 gsudo」→ 外网安装 + 硬前提从 1 条变 2 条，违背零依赖/离线口径；「只用 Windows `sudo`」→ 24H2+、默认关闭、**默认 `forceNewWindow` 拿不到输出** |
| Agent 触发降级为 `ask`（A-1 ✅）| Agent 少一点「全自动」 | 「直接拒绝」→ Agent 连发起都不行，可用性损失更大 |
| 结构化参数 | 不能执行任意命令 | 命令文本 = 注入面；且 Agent 面将来会调它（REQ-3.7 / 4）|
| 卸载不自动清理（**A-2 ✅ 2026-10-08 已确认**）| 用户需手工清（提供清单）| 自动清理会误伤既有 19 条 |

1. **已知限制**：`none` 策略下本 Spec 的全部能力**不可用**（这是设计意图，不是缺陷）—— 默认策略即最保守。
2. **已知限制**：UAC 弹窗**无法自动化** → 提权相关真机验收**必须人工点击**，验收记录里如实登记。
3. **✅ A-1 已定案（2026-10-08）：Agent 触发在 `passby` 下降级为 `ask`** —— Agent 可发起，但每次都要人类在应用内确认（展示命令原文），备选「直接拒绝」被否。
4. **未验证项（A-3）**：Windows 自带 `sudo` 后端在本机（**23H2**）**无法验证**（官方要求 **24H2+**、默认关闭、默认 `forceNewWindow` 模式拿不到输出）⇒ 仅显式配置 `elevationBackend: winsudo` 时启用，待 24H2 机器补验后再考虑并入 `auto`。
5. **已知限制**：`gsudo` 的**凭据缓存**若被用户开启，则 UAC 不再逐次弹出 ⇒ 检测到缓存活跃时本组件**回落 native**（不杀用户缓存会话）。此时「Agent 降级为 `ask`」的应用内确认成为**唯一**闸门。

---

## 9. 真机结清记录（T0.1 / T3.2；2026-10-12）

> 证据目录 `C:\Users\EDY\dsh-probe-artifacts\20261012-154451-final\`。本节是 **T3.5「文档回写」** 的实物：把 §2 的写算法（前后快照）与 §4 的提权契约落到真机读数上。

- **§2「写前写后各存一次 `netsh show v4tov4` 快照」真跑**：`showV4tov4CallCount = 2`（写前 + 写后各一次**现读**，不靠本地账），`log.before = 19` / `log.after = 19` ⇒ 快照机制不是纸面约定（`B-driver.json`）。
- **§2「他人规则条数不变」真跑**：同端口 `45999` 由 `loopback → lan` 加 / 删各一次 —— `add` 两步（`portproxy-add` + `firewall-add`）`exitCode 0 / 4054ms`；`remove` 两步（`portproxy-delete` + `firewall-delete`）`exitCode 0 / 8137ms`；终态 **19 条 + sha `b9d38664ebb234be8b74945362d86a6c3608d96e6764cbc903b11de955d1056d`**、防火墙 **816 / 我方 0 / DSH Desktop 2**、`TEMP dsh-ppp*` **0**（`A6`–`A10`）。
- **§4 提权契约（`gsudo → native`）真跑**：`gsudo` 路径 `exitCode 0` / out 文件与 stdout **双通道都解析成功** / `cleanup` 两文件删净（`D-E-result.json` 的 `d1`）；`native` 路径 `status=partial / exitCode 2 / steps=[portproxy-delete ok=false]`（`B-driver.json` 的 `defect1`）。
- **§4 的两条留痕结论在本轮被再次读到**：① `gsudo` 经 `pwsh -Command` 包装会把**子进程**退出码 **2/3/7/42/999 一律塌成 1**（`gsudoExitCollapse` 实测：`child_0→0`，其余全 `→1`）⇒ `partial` / `precondition` 在 gsudo 后端下**不可区分**，只有 gsudo **自身**失败才是 `999`；② 本机 `ConsentPromptBehaviorAdmin = 0` ⇒ **提权全程不弹 UAC**，§8-2「每次写操作必须人工点 UAC」在本机**不适用**（本轮真写入由驱动零交互完成，闸门只能收回产品内 —— 即 Phase 2b）。
- 🔴 **本轮未覆盖（不许含糊）**：`fix` 动作（**未跑** ✗）、活跃 `gsudo` 缓存的回落分支（**越界未跑** —— 需改用户 gsudo 配置 ✗）、`999` / `cancelled` 分支（本机**不可复现** ✗）。
  - ✅ **2026-10-16 订正（原文保留）**：`fix` 已真机覆盖两轮 —— **F**（`20261016-005-fix`）：旧口径下规划层对漂移规则**必然拦下**，而提权链**真能修**；**G**（`20261016-fix-b`）：主人裁定 (a) 后**规划层自产两步计划**并真修好（`driver exit 0`、终态 sha 与基线逐字节相同）⇒ 本条「`fix` 未跑」**作废**。⚠️ 但「用户**点得到**修复」仍缺一步（`fix` 无用户可达路径，见 [tasks.md](./tasks.md) 收口记录遗留 ⑭）⇒ 本行的其余两条（`gsudo` 回落 / `999`）**仍然有效**。
