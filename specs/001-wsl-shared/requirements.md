# 功能需求：dsh-wsl-shared 共享底座

> 需求驱动（**requirements-first**）：先定 REQ 与 EARS 验收标准，[design.md](./design.md) 再从需求派生。
> 任务见 [tasks.md](./tasks.md)。本项目**不是** JSON API 工程，故无接口契约文件。

---

## 0. 项目文档摘要（docs/ 全量扫描）

本仓库**没有 `docs/` 目录**，全部子目录为空，故无可提炼的 docs/ 来源。

| 子目录 | 状态 | 本 Spec 使用方式 |
|--------|------|-----------------|
| `docs/architecture.md` | （空）| — |
| `docs/dev-guide.md` | （空）| — |
| `docs/api-contracts/` | （空）| — |
| `docs/db-schema/` | （空）| — |
| `docs/references/` | （空）| — |
| `docs/standards/` | （空）| — |

**替代真相来源（SSoT）**：

| 替代来源 | 内容要点 | 本 Spec 使用方式 |
|---|---|---|
| `stack-decision.md` · `layout.dirs` / `plugin.packageSplit` | 三包 workspace；`wsl-shared` 是**非插件包**，不出现在插件栏 | REQ-6.2 的负向边界 |
| `stack-decision.md` · `plugin.wslCwd` | `cwd` + `cwdLinux` 双字段；WSL 视角 `E:\x` 即 `/mnt/e/x`；发行版名必须自动发现（用户示例的 `Ubuntu` 在本机不存在，真值 `Ubuntu2204`）| REQ-1 / REQ-3 |
| `stack-decision.md` · `plugin.natPrerequisite` | **NAT 为硬前提**；mirrored 下 eth0 语义改变、规则指向失效地址 | REQ-4 的判定语义与「保守非 NAT」|
| `stack-decision.md` · 「真机事实」表 | WSL 2.7.3.0；eth0 `172.20.201.152`；`.wslconfig` 仅 `[wsl2] localhostForwarding=true`（= 缺省 NAT）；DSH 进程**非管理员** | REQ-2 / REQ-4 的真机断言基线 |
| `stack-decision.md` · 「原脚本 5 个坑」# 4 | `connectaddress=<eth0 IP>`，WSL 重启后 IP 变 → 规则静默失效 | REQ-2.3 为什么**绝不能**静默回落 |
| `stack-decision.md` · 约束 | Windows + WSL2 双环境；内网/离线可用（不依赖 npx、CDN）| NFR-1 / NFR-2 |

---

## 1. 概述

见 [README.md](./README.md)「概述」与「为什么单独成包」。一句话：**把「问 WSL 要事实」的五个能力收进一个非插件包，供 002 / 003 消费，自己什么都不注册。**

---

## 2. 功能需求

### REQ-1 发行版发现

- **REQ-1.1** GIVEN 机器已安装 WSL，WHEN 调用发行版发现，THEN 系统 SHALL 返回 `WslDistro[]`，每项含 `name` / `state` / `version` / `isDefault`，且 `isDefault === true` 的项 SHALL 至多一个。
- **REQ-1.2** GIVEN `wsl.exe -l -v` 的输出字节，WHEN 解码，THEN 系统 SHALL 按 **UTF-16LE** 解码（依据见 assumptions A-1），并 SHALL 容忍 BOM、CRLF、空行与行尾空白。
- **REQ-1.3** 解析 SHALL NOT 依赖英文表头字面量（`NAME` / `STATE` / `VERSION`）；SHALL 以「行首 `*` 标记默认项 + 末列版本号」的结构判定，表头行 SHALL 被跳过而非当作数据。
- **REQ-1.4** GIVEN 发行版名含空格（如 `Ubuntu 22.04`），THEN 系统 SHALL 解析出完整名称，SHALL NOT 截断为空格前片段。
- **REQ-1.5** GIVEN `wsl.exe` 不存在（未安装 WSL）或退出码非 0，THEN 系统 SHALL 返回 typed error（`CommandNotFound` / `NonZeroExit`），SHALL NOT 抛裸异常，SHALL NOT 返回空数组冒充成功。
- **REQ-1.6** GIVEN 输出中无任何发行版，THEN 系统 SHALL 返回空数组且 `ok: true`（「装好了但一个都没有」与「命令失败」是两种事实，不得混淆）。
- **REQ-1.7**（**2026-10-08 主人拍板**）GIVEN 调用方未显式指定发行版，WHEN 需要目标发行版，THEN 系统 SHALL 按**确定性优先级**解析并**同时返回来源**（`source ∈ { config, wslDefault, onlyOne, first }`）：① 显式配置值 → ② `isDefault === true` 的项（即 `wsl -l -v` 行首 `*` —— **WSL 自己的默认发行版**）→ ③ **唯一**存在的发行版（**一个就是默认，SHALL NOT 追问**）→ ④ 多个且无默认时取列表首项。系统 SHALL NOT 为「用哪个发行版」**阻塞提问**；SHALL NOT 自动执行 `wsl --set-default` 改写用户的 **WSL 全局默认**（那是用户的系统配置，不是本插件的）。

### REQ-2 eth0 IPv4 探测

- **REQ-2.1** GIVEN 目标发行版处于 Running，WHEN 探测 eth0，THEN 系统 SHALL 返回点分四段 IPv4 字符串（形如 `172.20.201.152`）。
- **REQ-2.2** GIVEN eth0 上存在多个 IPv4，THEN 系统 SHALL 返回**首个**（primary），SHALL NOT 返回数组或拼接串。
- **REQ-2.3** GIVEN eth0 不存在、或 eth0 上无 IPv4，THEN 系统 SHALL 返回 typed error（`NoInterface`），SHALL NOT 回落 `127.0.0.1`、`0.0.0.0` 或空串 —— 静默回落会让 portproxy 规则指向错误地址（handover「坑 #4」）。
- **REQ-2.4** GIVEN 目标发行版处于 Stopped，WHEN 探测，THEN 系统 SHALL 返回 typed error（`DistroNotRunning`），SHALL NOT 静默冷启动该发行版。
  > **裁量记录（2026-10-08 主人拍板 → 已定案）**：执行 `wsl.exe -d X -- …` 本身就会启动 `X`（实测冷启动 **11–12.5s**，并**连带拉起 dockerd 与用户全部容器**）⇒ **自动路径一律不启动**，REQ-2.4 的保守报错**保留**。**唯一例外**：**用户显式动作**（点「启动并核验」/「用这个发行版」）时 SHALL 允许启动，且 SHALL 在动作前明示代价（约 **10–12 秒**、会拉起 WSL 内服务）。
- **REQ-2.5** GIVEN 发行版名不存在，THEN 系统 SHALL 返回 typed error（`DistroNotFound`），错误消息 SHALL 含可用发行版名列表。

### REQ-3 路径翻译 → ✅ 已迁至 [006-path-translation](../006-path-translation/README.md)

> REQ-3.1–REQ-3.7（7 条）于 **2026-10-09 原样迁入** 006，**编号不变**（`pathmap.ts` 与它的 87 条单测里有 20+ 处按编号追溯，改号=断链）。本包仍交付 `src/pathmap.ts`（**同包不拆包**）。此处留空位以免既有引用错位 —— 沿用 002 → 004 拆分时的先例。

### REQ-4 `.wslconfig` 读取与 networkingMode 判定

- **REQ-4.1** GIVEN `%USERPROFILE%\.wslconfig` 存在且含 `[wsl2] networkingMode=nat`，THEN 系统 SHALL 返回 `{ mode: 'nat', resolved: 'nat' }`。
- **REQ-4.2** GIVEN 文件不存在，THEN 系统 SHALL 返回 `{ mode: 'default', resolved: 'nat' }`（WSL 2 缺省即 NAT），SHALL NOT 报错。
- **REQ-4.3** GIVEN 文件存在但无 `networkingMode` 键，THEN 系统 SHALL 返回 `{ mode: 'default', resolved: 'nat' }`，JSON 原样处理且**不得**修改文件。
- **REQ-4.4** GIVEN 键值为 `mirrored`、或任何**无法识别**的值（含大小写/空白异常与未来新增值），THEN 系统 SHALL 分别返回 `mode: 'mirrored'` / `mode: 'other'`，且 `resolved` SHALL NOT 为 `'nat'`（**保守**：非 NAT 一律按「功能不可用」处理）。
- **REQ-4.5** 解析 SHALL 容忍：BOM、`#` 与 `;` 注释、行内注释、键值两侧空白、CRLF、节名大小写（`[wsl2]` / `[WSL2]`）；SHALL 忽略其他节（`[experimental]` / `[interop]` / `[network]` 等）。
- **REQ-4.6** GIVEN 文件存在但**不可读**（权限或 IO 错误），THEN 系统 SHALL 返回 typed error 并附**完整路径**，SHALL NOT 把它当成「缺省 NAT」静默通过 —— NAT 是硬前提，读不到必须让 003 能把原因显示给用户。
- **REQ-4.7** 返回 SHALL 含原始值字符串（`rawValue`）与文件路径，供 UI 显示「你写的是 X，我判定为 Y」。

### REQ-5 结构化命令执行封装

- **REQ-5.1** GIVEN 一个 `argv` 数组与选项，WHEN 执行，THEN 系统 SHALL 返回 `{ ok: true, exitCode, stdout, stderr }`，或 typed error；SHALL NOT 抛裸异常。
- **REQ-5.2** 执行 SHALL 以 `argv` 数组传参，SHALL NOT 拼接 shell 字符串（注入面最小）。
- **REQ-5.3** GIVEN 超时（默认由调用方显式给出，本包不设隐式默认），THEN 系统 SHALL 终止进程（含子进程树）并返回 `Timeout` 错误，SHALL NOT 让调用方永久挂起。
- **REQ-5.4** GIVEN `exitCode === 0` 但 `stderr` 非空，THEN 系统 SHALL 判为成功（`wsl.exe` 会输出提示性 stderr）；`stderr` SHALL 原样保留供诊断。
- **REQ-5.5** 输出编码 SHALL 由调用方显式指定（`wsl.exe` → UTF-16LE；`netsh` → 由 003 指定），本包 SHALL NOT 猜测编码。
- **REQ-5.6** 错误对象 SHALL 可判别（`code` 判别的联合类型），并含 `message`、`argv`（脱敏后）与可选 `exitCode` / `stderr`，供上层直接渲染。

### REQ-6 边界与准入标准

- **REQ-6.1** 只有 **≥2 个消费者**需要的能力 SHALL 进本包；单消费者能力（`netsh portproxy` 解析、UAC 提权辅助、`docker ps` 解析）SHALL 留在 003。
  > **明示例外**：`eth0 IPv4` 探测只有 003 一个消费者，按 handover 的 Spec A 范围**保留在本包**（与发行版发现共用同一条进发行版执行命令的链路）。这条例外**不**满足「≥2 消费者」，如实登记，不粉饰。
- **REQ-6.2** 本包 SHALL NOT 注册 slot、SHALL NOT 注册模型工具、SHALL NOT 注册 HTTP 路由；SHALL NOT 提供 PTY；SHALL NOT 带 `cordis.patch.yml`、行或配置页。
- **REQ-6.3** 公开面 SHALL 为**纯函数 + 可注入执行器**（默认 `spawn`，测试可替换为 fake），以保证无宿主、无网络也能跑全量测试。
- **REQ-6.4**（**2026-10-08 主人拍板订正**）公开面**运行时**导出 SHALL ≤ 12 个符号（可调用面），防止本包退化成杂物袋；**类型导出**（`export type` / `interface`）编译后被完全擦除、不进 bundle，**不计入**本条，但 SHALL 由自检脚本**单独统计并打印**（总量另有软阈值 **25**，超限需说明）。超限须先改本 Spec。
  - **软阈值变更留痕（2026-10-08 同日二次拍板：20 → 25）**：Phase 4 后实测**运行时 7/12 ✅、类型 15（合计 22 > 20）**；阈值 20 是「只有 3 个模块」时定的，包已长到 7 个模块，而 15 个类型**逐个都有消费方**（002/003/005 的配置与 UI）⇒ 提高软指标并留痕，**不砍类型、不拆包**。运行时 SHALL（≤ 12）与判定逻辑不变，只换阈值；`check-exports.mjs` 头部、`AGENTS.md` 硬规则表、`tasks.md`（校验门行/口径节/T6.1）、`README.md` 已同步。
  - **订正留痕**：本条原写「≤ 12 个符号（**含类型**）」。Phase 1+2 实测运行时 **3** + 类型 **10** = 合计 13，若含类型则 Phase 3–5 完成后**必然做不到**（eth0 / 路径翻译 / `.wslconfig` 还要各加类型），故按「本条约束的是**可调用面**」订正。依据：类型在运行时不存在、不能被 `import` 当值用，也无法让产物变肿。

---

## 3. 非功能需求

- **NFR-1** 零运行时依赖：只用 `node:` 内置（`child_process` / `fs` / `path`）；安装后**离线可用**（handover 硬约束）。
- **NFR-2** TypeScript `strict`；产物 SHALL 能被消费方的 esbuild 打进 **CJS** bundle（不引入 ESM-only 运行时依赖）。
- **NFR-3** 每个解析函数 SHALL 有 fixture 驱动的离线测试（`node:test`），fixture 从真机捕获并入库（脱敏）。
- **NFR-4** 除执行器外，所有函数 SHALL 无副作用：不写文件、不改环境、不启动进程。
- **NFR-5** 单文件 SHALL ≤ 400 行、单 Spec 文档 ≤ 200 行（`leanspec` 校验门：warn 200 / max 400）。

---

## 4. 约束与假设

| # | 内容 | 影响 |
|---|------|------|
| C-1 | 消费方 002 / 003 与包 A 同处 pnpm workspace；A **不是插件包**，不在插件栏出现 | 决定包形态与无行注册 |
| C-2 | 不引入数据库、不引入认证；配置型数据只走 cordis 配置 | A 无持久化需求 |
| A-1（**✅ 已确认**）| `wsl.exe -l -v` 输出为 **UTF-16LE**（解码器按 BOM 或 NUL 占比 > 25% 的**字节指纹**兜底）| **2026-10-08 T0.1 定案**（前 12 字节 `20 00 20 00 4E 00 41 00 4D 00 45 00`、NUL 占比 **50%**）；Phase 2 又补**双向负例**（UTF-8 硬解 → 乱码/NUL；UTF-8 文本不被误判）。⚠️ **2026-10-09 订正**：原记「行尾 **LF**（无 CRLF）」**是错的** —— fixture 尾部即 `32 00 0d 00 0a 00`，行尾 **CRLF**（CR 2 / LF 2）**且有尾换行**；`scripts/probe.mjs` 实时捕获 3/3 一致。**无功能缺陷**（REQ-1.2 明写 SHALL 容忍 CRLF，实现用 `split(/\r?\n/)`），已由 `tests/contract/distros.test.ts` 的「T0.1 真机 fixture 字节事实」用例钉死；错因是把同批 `ip-eth0.raw`（那个确实是 LF）的性质误写到本表上 |**2026-10-08 实测样本**（ASCII 内容夹交错 NUL ⇒ 与 UTF-16LE 一致）：`NAME STATE VERSION * Ubuntu2204 Stopped 2`；**中文系统上表头与状态值仍为英文** ⇒ 支持 REQ-1.3 的「不依赖表头」策略 |
| A-2（**✅ 已确认·比假设更细**）| 表头本地化行为 | **2026-10-08 定案**：本机 `wsl -l -v` 表头是**英文**，但**同一个 exe** 的 `wsl --version` 是**中文** ⇒ **同工具不同子命令本地化不一致**，故 REQ-1.3「不依赖任何表头字面量」**保留且必须保留**；Phase 2 用**中文表头** fixture 正向验证通过。**若真机证明表头恒为英文，该约束可放宽但不删** |
| A-3（**❌ 已推翻**）| `netsh` 输出为 OEM 代码页（zh-CN 下 GBK）| **2026-10-08 实测推翻**：本机 `netsh … show v4tov4` 是**纯 ASCII**（高位字节 0%）+ 行尾 **CRLF** ⇒ **不存在** GBK 中文表头问题（结论已在 003 的 T0.1 留痕）。本包仍只提供 `encoding` 参数、**不猜** |
| A-4（**2026-10-08 已确认**）| 对 Stopped 发行版执行命令会**冷启动**它 | **实测确认**：冷启动 **11–12.5s**，并**连带启动 dockerd 与用户全部容器**（实测 6 个容器被拉起、`/proc/1` 换新）⇒ REQ-2.4 的保守报错**必须保留**。同时实测**守卫有效** —— `wsl -l -v` **不会**唤醒发行版（连续两次仍为 `Stopped`）⇒「先查状态、非 Running 不执行 `wsl -d`」成立。⚠️ 首次 `wsl -l -v` 也可能耗时 **8.6s**，故状态查询同样要超时 + UI 反馈 |
| A-5（**已确认**）| 内网有 npm registry / 私有镜像可用 | 依赖可正常安装并打进 bundle，部署侧无需联网 |
| A-6（**✅ 已确认，2026-10-09 主人拍板**）| WSL 缺省网络模式为 NAT（本机 `.wslconfig` 未设 `networkingMode`）| **2026-10-09 主人定案：「default 就是 NAT」（原话）** ⇒ 不再作为假设挂账；同日真机探针佐证（`mode=default` ⇒ `resolved=nat`）。实现上的**保守面不变**：只有明确解析出 `nat` 才给 `nat`，`mirrored`/`bridged`/未来新值/读不到一律**不**给 `nat`（REQ-4.4 / REQ-4.6）；万一某版本改缺省，003 的「规则是否真的通」转发自检是最后兜底 |
