# 实现任务：dsh-wsl-docker-ports

> 任务引用 [requirements.md](./requirements.md) 的 REQ-N；设计依据见 [design.md](./design.md)。
> 完成定义（每个任务）：代码 + **验证命令跑绿** + 无残留临时文件/规则。
> 口径：`pnpm -C packages/wsl-docker-ports {typecheck,test,build}`。**P0 = Phase 0–6**，P1 = Phase 7。

---

## Phase 0：前置（阻塞项）

- [x] T0.1 捕获真机 fixture 并入库（脱敏）— ✅ **2026-10-08 完成**
  - 内容：`netsh interface portproxy show v4tov4` 原文（含既有 **19 条**）、`docker ps --format '{{json .}}'` 原文、`%USERPROFILE%\.wslconfig` 原文
  - ✅ **A-2 定案（推翻原假设）**：本机 `netsh` 输出是**纯 ASCII**（表头英文 `Listen on ipv4:`、高位字节 **0%**）、行尾 **CRLF** ⇒ **不存在** OEM/GBK 中文表头问题；解析器仍集中在 `decodeNetshOutput()` 一处，将来遇到 OEM 机器只改它
  - ✅ **A-1 解析形态定案**：结构 = 表头 → **纯分隔线**（`----- -----  ----- -----`）→ 4 列数据行；**无规则时没有分隔线** ⇒ 判据是「找不到分隔线 = 空表」（返回 `[]`），而形状脏的**数据行必须抛 `NetshParseError`**（静默丢行会让 005 的红线「他人规则条数不变」失真）
  - 🔴 **新事实（本次实测，已写进 design 与解析器注释）**：发行版冷启动后**第一次 `docker ps` 会被硬超时砍掉**（第 1 次跑满 `timeout 20`、**0 输出**；5 s 后第 2 次 **637 ms** 成功拿到 6 容器）⇒ 调用方必须**超时 + 重试**，且**不得**把空输出当成「没有容器」
  - 🔴 **`Ports` 列三种真实形态**（解析器已覆盖）：IPv4+IPv6 双份 / **区间** `5002-5003` / 空串（未发布）
  - 验证：`node --test "packages/wsl-docker-ports/tests/**/*.test.ts"` → **11/11 通过**（19 条规则一条不少且字段齐全、`netsh` 纯 ASCII 断言、空表 → `[]`、脏行抛错；6 容器字段齐全、IPv6 双份、区间、多段、未发布端口、5 条异常路径）；**泄漏扫描 0 命中**、未脱敏原文从未入库；溯源见 `packages/wsl-docker-ports/tests/contract/fixtures/README.md`

- [x] T0.2 [REQ-2.5][REQ-6.1] 真机确认两件事（**2026-10-08 完成，主人授权重启 WSL**）
  - 内容：① docker server **29.5.3** 是否支持 `docker ps --format json`（不支持则回落 `{{json .}}`）；② 记录一次重建前后对照，作为 T2.3 漂移判定的真机样本
  - ✅ **① 定案**：`--format json` **会挂住**（两次被 `timeout` 杀掉：rc=124，8s 与 15s 各一次，且守护进程已热）→ **必须** `--format '{{json .}}'`（返回完整 JSON 行，含 `Ports`/`State`/`HealthStatus`/`Labels`），且 docker 调用**一律加硬超时** ⇒ 解析器**只需单路径**（不必做双路径）。
  - ✅ **② 定案（两种重建都测了）**：单发行版 `wsl --terminate Ubuntu2204` → eth0 **不变**、`btime`/`boot_id` **不变**、**`/proc/1` 启动时间变**（17:08:10 → 20:44:54）、冷启动 **11.1s**；整台 `wsl --shutdown` → `btime`/`boot_id` **变**、`vmmemWSL` 重建（1s 内消失）、eth0 **仍不变**、冷启动 **12.5s**。⇒ **19 条规则零漂移、无需修复、无需 UAC**；端到端抽验 `127.0.0.1:{6379,5432,8080,5002}` **全通**。**结论**：漂移在本机**不可复现** → REQ-6 保留为**安全网**（判决逻辑本就随五态一起做），**不做**心跳/守护/持久化。
  - 验证：两条实测结论写入 design.md §13 与 requirements 的 A-1/A-3 状态；`--format` 结论决定解析器是否需要双路径 → **已回写（A-3 改为「实测反证」）**；完整数据见 `stack-decision.md` 变更记录第 23 条

- [ ] T0.3（已迁出）提权最小验证
  - 内容与验收**已迁至 [005 的 T0.1](../005-elevation-write-path/tasks.md)**（2026-10-08 拆分；**同一条真机验证，不重复做**）。**编号 3 保留为空位**，以免 T0.4 / T0.5 错位。

- [x] T0.4 [REQ-12.3] 复核 C-3 → ✅ **2026-10-08 已定案（真机枚举 + 源码）**：`~/.dsh/cordis.patch.yml` **不存在**，层序（profile 根注释原文）为 bundle 层 → `cordis.patch.yml` → `--patch` 覆盖层，**无 home 层** → 原前提推翻、**本项关闭**（无需真机）。REQ-12.3 保留为「若日后出现更高层」的**防御性**只读态，且须**自绘**（`settings.writable` 恒 true，宿主不会报错）

- [ ] T0.5 [REQ-14.1][REQ-14.3] 安装接入验证（D-1）
  - 内容：`link:<绝对路径>` 写入 profile `dependencies` + `dsh.profile.bundles`，`pnpm install` 后重载
  - 验证（真机，二值）：① 行出现在 profile 行列表且无 compatibility `disabled` ② 卸载后行消失、路由/页注销、临时文件清空、**规则数不变**（REQ-14.3）

---

## Phase 1：数据层（只读解析）

- [ ] T1.1 [REQ-2.1][REQ-2.2][REQ-2.3][REQ-2.5] `parseDockerPs`
  - 内容：经 001 的 `run` 执行 `wsl.exe -d <distro> -- docker ps --format '{{json .}}'`（**不是** `--format json`，实测会挂住）；解析 `0.0.0.0:8080->80/tcp` 与 `[::]:8080->80/tcp`；UDP 标记保留（供 REQ-9.2）
  - 验证：`node --test` 用真机 fixture 断言容器数、端口映射四元组；`vitest` 覆盖未安装 / daemon 停 / 权限不足三种可区分错误；断言**未**把失败显示成空列表

- [ ] T1.2 [REQ-3.2][REQ-3.5] `parsePortproxy`
  - 内容：解析 `netsh … show v4tov4` 的 v4 表；跳过表头（**不依赖表头字面量**，`netsh` 输出会本地化）
  - 验证：`node --test` 真机 fixture 断言解析 **19 条**且 `connectAddress` 全部为首个 eth0 值；`vitest` 覆盖空表、乱码/截断 → 报错 + 保留脱敏原文（REQ-3.5）

- [ ] T1.3 [005-REQ-2.5] 读取 `localhostForwarding`（本包自读，单消费者）
  - 验证：`vitest` —— 缺省 `true`；显式 `false` 时 loopback 走「需显式规则」分支；断言**未**改文件

---

## Phase 2：diff-engine（纯函数，五态）

- [ ] T2.1 [REQ-3.1][REQ-3.3][REQ-3.4] 期望集与五态分类
  - 内容：期望集 = mappings ∩ `managedPorts`；分类只依据三条事实（REQ-3.4）
  - 验证：`vitest` 表格驱动 —— ok / missing / drift / conflict / extra 各至少两例；断言每个端口**恰好一个**状态

- [ ] T2.2 [005-REQ-1.1][REQ-15.1] `managedPorts` 之外零参与（只读清单侧）
  - 验证：`vitest` —— fixture 里注入一条集合外端口的规则，断言它**不出现在**任何状态里、也不计为 conflict

- [ ] T2.3 [REQ-6.1][REQ-6.2][REQ-6.4] 漂移判定与「取不到 eth0」
  - 内容：**校准（T0.2 实测）**：本机两次重建 eth0 都未变 ⇒ 漂移是**安全网**而非主路径，**不要**为它加定时器/守护/持久化；判定在**激活 / 刷新 / 写入前**执行，其中**写入前必须强制现读**（不吃缓存 —— 否则等于拿旧地址亲手造一条新的坏规则）
  - 验证：`vitest` —— `connectAddress` ≠ eth0 → drift 且返回「旧→新」；`eth0Ip` 为 null → 全部**不**标 drift、返回「无法确定地址」；**新增**：写入路径调用时**绕过缓存**重读 eth0（fake 执行器断言读次数 +1）

- [ ] T2.4 [REQ-9.2] UDP 标记
  - 验证：`vitest` —— 容器 UDP 映射在结果中标「不支持」，且**未**生成期望转发项

- [ ] T2.5 [REQ-15.1][REQ-14.2] 外部规则只读集合（D-2）
  - 内容：把「∉ `managedPorts` 且非本插件写入」的规则归入独立集合（不属于五态）
  - 验证：`vitest` —— 本机 19 条 fixture **全部**落外部清单且**未**进五态、动作产生数 = 0；空集合时不渲染区域；与 T5.7 的渲染断言配对

---

## Phase 3：期望集声明侧（所有权声明）

> **原 T3.1–T3.4（所有权匹配算法 / 防火墙参数生成 / scope 切换序列 / 前后快照与任务日志）已迁至 [005-elevation-write-path](../005-elevation-write-path/tasks.md)** 的 Phase 1（2026-10-08 拆分；内容逐条保留）。本 Spec 只保留**声明侧**：区间与期望集。

- [ ] T3.5 [REQ-16.1][REQ-16.2][REQ-16.3] 区间声明与接管转移（D-2）
  - 内容：`managedPorts` 解析单端口 + 闭区间混写；期望集 = 映射 ∩（区间展开）
  - 验证：`vitest` —— 区间正例/倒置/非法各一例被拒并给出项；区间∩映射求交（**不**枚举全体）；重叠端口从外部清单**移入**五态且**不**双现

---

## Phase 4（已迁出）：提权辅助进程

T4.1–T4.5 **已整体迁至 [005-elevation-write-path](../005-elevation-write-path/tasks.md)** 的 Phase 2（脚本生成与参数结构 / RunAs 调用与回传解析 / 拒绝 UAC 分支 / 策略与临时文件清理 / 来源约束）。**Phase 编号 4 保留为空位**，以免 T5.x / T6.x / T7.x 等既有引用错位。

---

## Phase 5：UI（只读展示与门禁）

- [ ] T5.1 [REQ-2.1][REQ-2.2][REQ-3.2] 容器表 + 端口表（五态）
  - 验证：`vitest` 渲染断言 —— 五态标签各自可渲染；刷新后时间戳更新；打开页面**零**写操作（NFR-2）

- [ ] T5.2 [REQ-1.1][REQ-1.2][REQ-1.3][REQ-1.4] NAT 门与前置检查
  - 内容：非 NAT / 读取失败 → 写控件置灰 + 原因 + 修复指引（含 `.wslconfig` 路径与命令文本，可复制）；只读展示保留
  - 验证：`vitest` —— 非 NAT 时**无**任何写控件可点、指引文本含路径与命令；断言**未**写 `.wslconfig`

- [ ] T5.3 [005-REQ-2.1][005-REQ-2.4] 作用域切换控件（写动作由 005 执行）
  - 验证：`vitest` —— 每端口独立 scope 控件；默认 loopback；切 lan 需显式操作（无「全选局域网」入口）

- [ ] T5.4 [REQ-9.1][REQ-9.2] UDP 明示
  - 验证：`vitest` —— 常驻提示存在；UDP 映射行标「不支持」

- [ ] T5.5 [REQ-10.1][REQ-10.3] exec 注入点（下一期）
  - 验证：`vitest` —— 控件禁用 + 「下一期」原因；002 服务缺失时**无**报错、回调未触发；断言本包**未** import 002（静态 grep）

- [ ] T5.6 [REQ-6.2][REQ-6.3] 漂移高亮与修复入口
  - 验证：`vitest` —— drift 行显示「旧 → 新」；修复动作生成「先删后加」序列；失败时报告哪些未改

- [ ] T5.7 [REQ-15.1][REQ-16.4][REQ-16.5] 外部规则清单 + 端口声明最小表单（P0，D-2/D-3）
  - 内容：外部规则独立区域（只读、无动作、空则不渲染）+ **区间输入框**（写 `managedPorts`）+ 常见服务端口勾选
  - 验证：`vitest` 渲染 —— 本机 19 条落只读区且**无**任何动作控件；默认候选**恰好 13 项**（含 3306/1521/8080/5432/6379/5173/5000，**不含** 1433）；区间/勾选写回后**仅**改配置、**未**产生提权调用（调用数 0）

- [ ] T5.8 [REQ-17.1][REQ-17.2][REQ-17.3][REQ-17.4] 目标发行版控件（P0，D-4）
  - 内容：显示当前目标发行版 + **来源**（配置 / WSL 默认 / 唯一发行版 / 首个）+ 切换下拉（列出全部及各自 `state`）；**只读 `wsl -l -v`**，绝不用 `wsl -d` 探状态；配置已失效时回落解析并明示
  - 验证：`vitest` + fake 执行器 —— ① 仅 1 个发行版 → **直接认定**且**零提问**（断言无询问调用）；② 配置为空且存在 `*` 项 → 取 `*`、`source='wslDefault'`；③ 配置值存在 → `source='config'` 且**优先于** `*`；④ 配置值已不存在 → `DistroNotFound` + 回落 + 失效提示；⑤ 断言全程**未**执行任何 `wsl -d`（spawn 调用里不含该 argv）

---

## Phase 6：门禁与收口（P0 完成门）

> **原 T6.1（红线断言：无 `portproxy reset`）、T6.2（真机自证：他人规则条数不变）、T6.3（卸载语义与清理清单）已迁至 [005-elevation-write-path](../005-elevation-write-path/tasks.md)** 的 Phase 3（T3.1–T3.3）。本 Spec 只保留质量门与文档回写。

- [ ] T6.4 [NFR-4..NFR-7] 质量门
  - 验证：`pnpm -C packages/wsl-docker-ports typecheck` + `test` + `build` 三绿并记录用例数；单文件 ≤ 400 行；UI 零硬编码 hex

- [ ] T6.5 文档回写
  - 内容：T0.1（编码）、T0.2（`--format`、漂移复现）→ 回写 README/design；**并记 D-2（外部规则只读清单）与 D-3（端口声明提到 P0）的最终口径**；提权相关真机结论（005 的 T0.1 / T3.2）由 **005** 回写
  - 验证：`grep -n "A-1\|A-2\|A-3\|superseded\|reset" specs/003-wsl-docker-ports/*.md` 可见结论；`leanspec` 行数无新增超线

- [ ] T6.6 [REQ-2.4][REQ-9.3][REQ-10.2][REQ-10.4] 红线断言（四条禁止性需求的可二值判定）
  - 内容：四条 `SHALL NOT` 各配一条可判定断言 —— ① **P0 只读**（REQ-2.4）：P0 路径不存在 docker 写子命令（`start`/`stop`/`restart`/`rm`/`run`/`exec`），只用 `ps`/`inspect` ② **不代偿 UDP**（REQ-9.3）：不引入 `v6tov6` / 第三方转发工具 ③ **不建包边**（REQ-10.2）：依赖里没有 `dsh-terminal-profiles`，只用字符串键 `managedTerminal` 可选注入 ④ **不实现 exec**（REQ-10.4）：无容器 exec 调用，控件只有禁用态
  - 验证：四条断言各对应一条 `vitest`/脚本用例且全绿；每条留一行证据（命令 + 输出）→ 回写 design

---

## Phase 7：P1（P0 真机验收通过后再启）

- [ ] T7.1 [REQ-11.1][REQ-11.4] 容器启停 / 重启（用户可，Agent 拒绝）
  - 验证：`vitest` —— 用户来源调用 docker 写命令 1 次；agent 来源被拒且**未**调用命令

- [ ] T7.2 [REQ-11.2][REQ-11.3] 容器日志（`--tail` 有界）
  - 验证：`vitest` —— 默认 `--tail 200`；断言**无**落盘调用（无 `writeFile`）

- [ ] T7.3 [REQ-12.1][REQ-12.2][REQ-12.4] 完整配置页（**P1 只补 scope / elevationPolicy**）
  - 内容：`plugins.row.config` + `configure({ auto: false })`；字段 `scope`/`elevationPolicy`（**`managedPorts` 在 P0 的 T5.7、`distro` 在 P0 的 T5.8，均不在此重复** —— D-4 后同一字段**只允许一个写入口**）；**写经 settings 三写操作（live 路径）；不用 `configEditor.edit()`**（完整配置路径会重挂载）；在途提权任务时保存先确认
  - 验证：`vitest` + fake ctx —— 注册键正确、`auto:false` 生效；在途任务时弹确认且**未**写盘；`grep` 断言本包**无** YAML 手写

---

## 真机验收清单（chrome-devtools MCP + **人工点 UAC**）

> 依据：handover 拍板「vitest 单元 + `node:test` 离线契约 + chrome-devtools MCP 真机验收」，**否决** Playwright E2E 与视觉对照。UAC 弹窗**无法自动化**，提权相关行必须人工点击 —— 如实登记。

| # | 场景 | 期望 | 手段 |
|---|------|------|------|
| 1 | 打开页面（NAT 机器）| 容器表 + 端口表渲染；**零**提权弹窗（NFR-2）| chrome-devtools 截图 |
| 2 | 端口表状态 + 外部清单 | 19 条既有规则中落在 `managedPorts` 内的被正确标 `ok`/`drift`；**其余全部落在「外部规则」只读清单**（不进五态、无动作，REQ-15）| 截图 + 与 `netsh` 原文比对 |
| 3 | 端口声明表单（区间 + presets）| 输入 `1000-3000`、勾选 presets 后**仅改配置**、**未**产生提权调用；与 docker 实际映射求交后进五态（交集非空时）| 截图 + 调用数断言 |
| 4 | UDP 映射存在时 | 表格标「不支持」，无对应转发项 | 截图 |
| 5 | 非 NAT（临时改 `.wslconfig`）| 全部写控件置灰 + 修复指引含路径与命令；只读展示仍在 | 截图（改完**改回**，并记录）|
| 6 | 进容器 exec 控件 | 禁用 + 「下一期」原因；002 未加载时无报错 | 截图 + 控制台无错 |
| 7 | 禁插件再启用 | 无重复页/无临时文件残留；规则零变化 | 日志 + `%TEMP%` + 快照 |

> **写路径与 UAC 的真机行（原第 3–8 行：加转发 loopback/lan、移除、漂移修复、拒绝 UAC、策略 `none`）已迁至 [005-elevation-write-path 的真机清单](../005-elevation-write-path/tasks.md)**（2026-10-08 拆分）—— 那里每行都需**人工点 UAC**。本清单只保留**不触发提权**的只读与门禁场景。
