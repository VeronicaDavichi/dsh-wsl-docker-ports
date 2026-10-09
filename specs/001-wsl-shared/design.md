# 技术设计：dsh-wsl-shared 共享底座

> 从 [requirements.md](./requirements.md) 派生（requirements-first）。任务见 [tasks.md](./tasks.md)。

---

## 1. 定位与依赖方向

    packages/wsl-shared          ← 非插件包：无 cordis 行、无 slot、无工具、无路由、无 PTY
      ├─ src/exec.ts             spawn 封装（唯一有副作用的模块，可注入 fake）
      ├─ src/distros.ts          wsl -l -v 解码 + 表格解析
      ├─ src/net.ts              eth0 IPv4 探测
      ├─ src/pathmap.ts          双向路径翻译（纯字符串）
      ├─ src/wslconfig.ts        .wslconfig 读取 + networkingMode 判定
      ├─ src/errors.ts           typed error 联合类型
      └─ src/index.ts            公开面（**运行时** ≤ 12 导出，REQ-6.4；类型导出另计）

依赖方向**单向**：`002 → 001`、`003 → 001`；`001 → node:` 内置。A **不**依赖任何 DSH 宿主服务，因此可以在没有宿主、没有网络的 Node 进程里跑全量测试（REQ-6.3）。依据：`stack-decision.md` · `plugin.packageSplit`（三包，官方建议「需在其他行关闭时仍保留页面的子插件应独立成包」）。

---

## 2. 类型契约

| 类型 | 形状 | 说明 |
|---|---|---|
| `WslDistro` | `{ name: string; state: 'Running'｜'Stopped'｜'Installing'｜'Unknown'; version: 1｜2｜'unknown'; isDefault: boolean }` | `state` 无法识别 → `Unknown`（不抛错）|
| `NetworkingMode` | `{ ok: true; path: string; mode: 'nat'｜'mirrored'｜'default'｜'other'; resolved: 'nat'｜'non-nat'; rawValue?: string }` | `resolved` 只有两态，消费方只需判一个布尔（REQ-4.4）；成功态带 `ok: true` 以便 `isWslFailure()` 收窄联合；**缺键时 `rawValue` 字段不出现**（不伪造 `undefined`）|
| `ExecResult` | `{ ok: true; exitCode: 0; stdout: string; stderr: string }` | 成功态（`stderr` 非空也算成功，REQ-5.4）|
| `WslSharedError` | `{ ok: false; code: ErrorCode; message: string; argv?: string[]; exitCode?: number; stderr?: string; path?: string; distros?: string[] }` | 所有失败的唯一出口（REQ-5.6）|
| `ExecOptions` | `{ cwd?: string; env?: Record<string,string>; timeoutMs: number; encoding: 'utf16le'｜'utf8'｜string }` | `timeoutMs` **必填**，不设隐式默认（REQ-5.3）|
| `DistroResolution` | `{ ok: true; name: string; source: 'config'｜'wslDefault'｜'onlyOne'｜'first' }` | 成功态**必须带 `ok: true`**（**2026-10-08 Phase 4 自审补齐**）：否则 `isWslFailure()` 对这个联合用不了，消费者只能 `'code' in r`，与 `errors.ts` 声明的判别联合口径及另外四种成功态不一致 |

`ErrorCode`（判别联合的 `code`）：

| code | 触发 | 消费方建议动作 |
|---|---|---|
| `CommandNotFound` | `wsl.exe` 不存在 | 提示「未安装 WSL」并给修复步骤 |
| `NonZeroExit` | 退出码非 0 | 原样展示 `stderr` |
| `Timeout` | 超时被杀 | 提示重试 / 检查发行版是否卡住 |
| `DistroNotFound` | `-d <name>` 不存在 | 展示 `distros` 可用列表 |
| `DistroNotRunning` | 目标发行版 Stopped（REQ-2.4）| 询问用户是否启动，**不自动启动** |
| `NoDistro` | 本机一个发行版都没有（REQ-1.7 的空列表路径；**T1.1 新增**）| 提示「尚未安装任何发行版」并给安装指引 |
| `NoInterface` | eth0 无 IPv4（REQ-2.3）| 显示「无法确定 WSL 地址」+ 建议 `wsl --shutdown` 后重试 |
| `UnmappablePath` / `NoWindowsEquivalent` | 路径翻译失败（REQ-3.4/3.5）| 表单字段报错，不落库 |
| `ConfigUnreadable` | `.wslconfig` 读不到（REQ-4.6）| **不得**当作缺省 NAT；显示路径与原因 |
| `Unexpected` | 兜底 | 展示 message + 日志 |

---

## 3. 四张解析表的设计

### 3.1 发行版表（`distros.ts`）

分两步，**解码与解析分离**，便于 fixture 单测：

    bytes ──decode(buf, 'utf16le')──► text ──parseDistroTable(text)──► WslDistro[]

- `decode`：`Buffer.toString('utf16le')`，剥 BOM（`\uFEFF`）、统一换行、按行 trim。
- `parseDistroTable`：**不看表头文字**（REQ-1.3）。逐行判断 —— 行首 `*` → 默认项（去掉后继续）；末列匹配 `^[12]$` → VERSION；中间全部 trim 后拼回 → NAME（**因此含空格的名字天然正确**，REQ-1.4）；无 VERSION 列的行 → `version: 'unknown'`。
- 跳过：空行、纯表头行（含 `NAME` 或含「名称」等表头特征且无 `*` 且末列非数字）。
- 排序：默认项置顶，其余按原顺序稳定保留。

### 3.2 eth0 探测（`net.ts`）

命令（argv 数组，无 shell）：

    ['wsl.exe', '-d', distro, '--', 'ip', '-4', '-o', 'addr', 'show', 'dev', 'eth0']

**编码（2026-10-08 真机实测，直接决定成败）**：这条路径的输出是 **UTF-8**（NUL 占比 **0.0%**、LF 行尾），
而 `wsl -l -v` 是 **UTF-16LE** —— 同一个 `wsl.exe`：**自带消息** UTF-16LE、**透传 Linux 子进程字节** UTF-8。
因此本模块**写死 `utf8`**（不是猜、不是指纹）⇒ 猜错的后果是 `inet 172.…` 解成乱码、误报「eth0 没有 IPv4」
（假阴性），所以双向反例都进了契约层（`tests/contract/net.test.ts`）。

解析：取 `inet <ip>/<prefix>` 的**首个**匹配 → 返回 IP（REQ-2.2）。四段十进制校验（拒前导零、拒 >255）；
跳过 `0.0.0.0` 与 `127.0.0.0/8`（结构上不可能作 connectaddress；同时兜住"传进来的不是 `dev eth0` 输出"的误用）
—— 其余**原样返回**（`169.254.x.x` 照返：那是发行版 DHCP 失败，不该由解析器掩盖）。
`ip` 命令不存在时退出码非 0 → `NonZeroExit` 原样透传（`hostname -I` 作为文档化备选，但**不**自动降级：降级会让「NAT 下 eth0 语义」这一前提悄悄失效）。

**守卫顺序即防线**：① `guardDistroExists`（REQ-2.5，错误带可用列表）→ ② 状态守卫（REQ-2.4）→ ③ 执行 → ④ 解析。
第 ② 步是「绝不用自动路径叫醒发行版」的落点（`wsl -d X -- …` 本身就会启动 X，实测冷启动 **12,637ms** 并连带拉起用户的全部容器）。

**超时**：热路径实测 **192 / 218 / 237ms** ⇒ 默认 `DISTRO_EXEC_TIMEOUT_MS = 10_000`（40× 余量）；
**显式启动**路径用 `DISTRO_EXEC_COLD_START_TIMEOUT_MS = 30_000`（覆盖 12,637ms 冷启动 + WSL 内服务起来的时间）。
`timeoutMs` 可被调用方覆盖（常量与守卫实现都在 `distro-exec.ts`）。

**分层（T3.4，2026-10-08 主人拍板）**：**「存在性 + 状态守卫 + 执行 + 编码声明」抽在 `distro-exec.ts` 的
`execInDistro` 里，只有一份实现**；`net.ts` 只管 eth0 的解析与语义。理由：003 读层也要在发行版里跑命令
（`docker ps` …），守卫若分叉，迟早有人漏掉一次 ⇒ 静默冷启动（12,637ms + 拉起用户的全部容器）。
准入依据是 REQ-6.1（能力需 ≥2 个消费方）：eth0 探测 + 003 读层。

**REQ-2.4 的唯一例外**：`allowColdStart: true`（**只允许用户显式动作**传）跳过状态守卫，按冷启动超时执行；
调用方 SHALL 在动作前明示代价（约 10–12 秒、会拉起 WSL 内服务）。自动路径**不得**传这个开关。

### 3.3 路径翻译（`pathmap.ts`）

| 输入形态 | 输出 | 备注 |
|---|---|---|
| `E:\x\y`、`e:/x/y`、`E:x` | `/mnt/e/x/y` | 归一盘符小写、`\`→`/`、折叠重复分隔符 |
| `/mnt/e/x/y` | `E:\x\y` | 用 `path.win32.normalize` 产出反斜杠 |
| `\\wsl.localhost\Ubuntu2204\home\u` | `/home/u` | 发行版名原样带入 |
| `\\wsl$\Ubuntu2204\home\u` | `/home/u` | 旧形式，同样接受 |
| `/home/u`（无发行版名）| ❌ `NoWindowsEquivalent` | **不猜盘符** |
| `/home/u`（有发行版名）| `\\wsl.localhost\Ubuntu2204\home\u` | 需 `DistroNotRunning` 之外的**显式**发行版名参数 |
| `\\server\share`、`relative\x`、空串、含 `<>:"｜?*` | ❌ `UnmappablePath` | 非法字符检查**先于**形态判定 |

纯字符串变换，**不碰文件系统**（REQ-3.7）；不做引号包装（REQ-3.6，结果走 `argv`）。

**入参检查先于形态判定**（REQ-3.5）：空串 / 相对路径 / 保留字符 `<>"|?*` / 非盘符位置的 `:` / 控制字符一律 `UnmappablePath`；
Linux → Windows 方向**额外**拒**反斜杠**（Linux 合法，到 Windows 却会变成分隔符 ⇒ 静默错译）、**非法发行版名**（含分隔符、`.`、`..`、
**以 `.`/空格结尾** —— Windows 共享名不允许）与**发行版段为 `.`/`..` 的 UNC**（不是可识别的 UNC）。错误 `message` 回显输入前 SHALL
**可见化控制字符**（ESC/LF 原样进 UI/日志会坏排版、甚至注入 ANSI 转义）并**限长**（≤120 字符 + 总长）—— 三处均来自 Phase 4 自审的实测缺陷。

**实测的 `node:path` 语义（2026-10-08，先测再写 —— 四条都会咬人）**：① `win32.normalize('E:')` → **`'E:.'`**（裸盘符被补 `.`）
⇒ 盘符必须在 normalize **之前**摘出；② normalize 给**共享根**补尾分隔符（`\\server\share` → `\\server\share\`），三段以上 UNC 不补；
③ `posix.normalize` **保留尾斜杠**（`/home/u/` 不变）但把 `/..` 夹到 `/`；④ UNC 里的 `..` 被**夹在共享根**
（`\\wsl.localhost\D\..\..\x` → `\\wsl.localhost\D\x`，与 Win32 的 UNC 语义一致）。逐条理由与踩坑记录见 `src/pathmap.ts` 头注释。

### 3.4 `.wslconfig`（`wslconfig.ts`）

- **真机字节**（fixture `wslconfig.raw`）：**32 字节、无 BOM、行尾 CRLF、无尾换行**，原文 `[wsl2]` + `localhostForwarding=true` ⇒ 没有该键 = **NAT 缺省**（硬前提成立）。
- 路径：`path.join(process.env.USERPROFILE?.trim() || os.homedir(), '.wslconfig')` —— 🔴 **不能用 `??`**：`USERPROFILE=''` 时 `??` 不回落到主目录，而 `path.join('', '.wslconfig')` 是**相对路径** ⇒ 会去读**当前工作目录**下的同名文件（静默错答）；且实测 `USERPROFILE=''` 时 `os.homedir()` **自己会抛** `ERR_SYSTEM_ERROR` ⇒ 再补一道「默认路径必须是绝对路径」的校验，两道都拦成 `ConfigUnreadable`。
- 读取：`fs.readFile` 失败**只按「是不是 `ENOENT`」分叉**（实测 errno：目录 `EISDIR`、缺文件/缺盘符 `ENOENT`、路径含 NUL `ERR_INVALID_ARG_VALUE`，**本机见不到 `EACCES`** ⇒ 不枚举 errno）：`ENOENT` → `{ mode:'default', resolved:'nat' }`（REQ-4.2）；其余 → `ConfigUnreadable` 带完整路径（REQ-4.6，**不是**缺省 NAT）。errno 文案**只出现一次**（Node 的 `message` 自带前缀，实测踩过 `EISDIR: EISDIR: …`）。
- 手写 INI 子集解析（只为读一个键，不引依赖）：剥 BOM、按 `\r\n`/`\n`/`\r` 切行、`#`/`;` 起注释（含行内）、`[section]` 记当前节、`key = value` 去两侧空白；只认 `wsl2` 节的 `networkingMode`（节名/键名大小写不敏感，**值**大小写敏感）；重复键**最后一个**胜出。
- 判定：`nat` → nat；`mirrored` → mirrored；缺失 → default；其余（含 `bridged`、`NAT`、拼写错误、未来新值、空值）→ **other**，`resolved` 非 nat（REQ-4.4 保守）。`rawValue` 保留原值（去空白、**不归一化大小写**）供 UI 显示「你写的是 X，我判定为 Y」；缺键时该字段**不出现**。
- **只读**：本包 SHALL NOT 写 `.wslconfig`（修复指引由 003 展示文本）；测试里有静态断言（剥注释源码零写文件调用）。

---

## 4. 执行器（`exec.ts`）

- `spawn(file, argv, { cwd, env, windowsHide: true })`，`stdio: 'pipe'`；**无 shell**（REQ-5.2）。`env` 是**整份替换**（`spawn` 语义），不是追加：调用方要合并必须自己展开 `process.env`（否则连 `PATH` 一起丢，症状是莫名其妙的 `CommandNotFound`）。
- 收集 `stdout`/`stderr` 为 `Buffer`，结束后按 `options.encoding` 解码（REQ-5.5）；**先拼 Buffer 再一次性解码** —— 逐 chunk 解码会把多字节字符从边界切开成乱码。
- `timeoutMs` **入口校验** `0 < t ≤ 2147483647`，越界在**启动前**判 `Unexpected`：`setTimeout` 对超上限延时只警告并**按 1ms** 处理（`Infinity` / `NaN` / 0 / 负数同理）⇒ 否则会给出「命令在 …ms 内未结束」这种**误导性假超时**。
- 超时：`setTimeout(timeoutMs)` → 先 `child.kill()`，再兜底 `taskkill /PID <pid> /T /F`（Windows 无 POSIX 进程组信号，`wsl.exe` 会派生 `wslhost`/发行版进程）；**定时器必须先建立再挂事件处理器**。✅ **回收能力已实测**（T1.4 A/B 结案，见 §8-12）：只杀 `wsl.exe` 也能让发行版侧进程消失 ⇒ `taskkill /T` 是**保险**，降级方案**不启用**。
- 事件：`error` → `CommandNotFound`（`ENOENT`）或 `Unexpected`；**设了 `cwd` 时 ENOENT 文案必须同时点出「命令或工作目录」**（Windows 上两者同名，只说命令会把人引向错误的排查方向）。`close` → 组装结果；`code === null`（被外部终止）用单独文案，`exitCode` 记 `-1`。
- 可注入：`createExecutor(spawnImpl, treeKillImpl)` 供测试传 fake（REQ-6.3）；**注入实现的 rejection 必须显式吞掉**（`void … .catch()`），否则 unhandled rejection 在 Node 默认直接崩宿主。

---

## 5. 安全

| 面 | 措施 |
|---|---|
| 命令注入 | 只用 `argv` 数组，**任何**用户输入都不进入命令字符串（REQ-5.2）|
| 路径注入 | 翻译结果只作为参数传递；非法字符前置拒绝（REQ-3.5）|
| 编码混淆 | 编码由调用方声明；解析前先解码，避免「乱码当数据」（REQ-5.5）|
| 越权 | 本包**不提权**、不写系统配置、不写 `.wslconfig`；提权辅助留在 003 |
| 信息泄露 | `argv` 进错误对象前做脱敏（不期望有凭据，但保持习惯）；fixture 入库前脱敏 |

---

## 6. 测试策略

| 层 | 载体 | 覆盖 |
|---|---|---|
| 纯函数单测 | `vitest` | `parseDistroTable` / `parseWslConfig` / `pathmap` 全分支（含非法输入）；错误码判别 |
| 离线契约测试 | `node --test` + `tests/contract/fixtures/*.raw`（**真机原始字节**，不是转写文本） | 真机捕获的输出原文（`wsl -l -v` 原始字节、`ip -a`、`.wslconfig`）逐条断言；**断言对象是 fixture，不是我复述的常量** |
| 执行器测试 | `vitest` + fake spawn | 超时杀进程、`stderr` 非空 + 退出码 0、`ENOENT`、编码解码 |
| 真机探测 / UI 验收 | `scripts/probe.mjs` + chrome-devtools MCP | 探针在真机打印 5 项事实，**不**进 CI，作为 002/003 真机验收的输入；**本包无 UI** ⇒ UI 验收归 002/003 |

---

## 7. 决策权衡

| 决策 | 取舍 | 被否方案与原因 |
|---|---|---|
| 单独成包（非插件）| 多一个包，换来两个组件共享一套事实查询 | 各自复制薄逻辑 → 两份编码/超时语义，必然漂移；放 003 → 002 反向依赖 003，破坏 L3 |
| 直调 `wsl.exe`，不套 `pwsh -c` | 少一层、注入面小、错误码干净 | `pwsh -c "wsl ..."` 增加引号转义面与一层退出码转换 |
| `ip -4 -o addr show dev eth0` | 结构稳定、可判 primary | `hostname -I` 返回全部地址且顺序无保证；`ifconfig` 在 Ubuntu2204 默认未装 |
| eth0 失败即报错 | 避免规则指向错误地址（坑 #4）| 回落 `127.0.0.1` 会让 portproxy「看起来加成功、实际不通」 |
| 缺省 NAT 视为 `resolved: nat` | 本机实测缺省即 NAT，且 NAT 是硬前提 | 把缺省判为「未知」会让新用户一开箱就置灰 |
| 读不到 `.wslconfig` 报错 | 与「文件不存在」区分开 | 静默当缺省 NAT → 用户改了 mirrored 但配置读不到时，功能假可用 |
| 手写 INI 子集 | 零依赖（NFR-1）| `ini` 类库为读一个键引入运行时依赖，违背离线/零依赖取向 |

---

## 8. 已知限制

1. ~~**UTF-16LE 与表头本地化仍是假设**（A-1 / A-2）~~ → ✅ **T0.1 实测定案**：`wsl -l -v` = UTF-16LE + LF + **英文**表头，而 `wsl --version` 表头是**中文** ⇒ 解析器**不依赖任何表头字面量**；`wsl -d X -- ip …` 的输出是 **UTF-8**（同一 exe 两种编码）。
2. ~~**`taskkill /T` 的回收能力未验证**（T1.4）~~ → ✅ **已结案（A/B 实测）**：结论与局限见第 12 条；降级方案**不启用**。
3. **WSL 缺省网络模式是版本相关的经验值**（A-6）；`resolved` 是判定而非探测，真正的「通不通」由 003 的转发自检兜底。
4. **不支持非 `/mnt/<盘>` 的自动反查**：Linux 路径 → Windows 路径需要发行版名（REQ-3.4），这是刻意的（不猜）。
5. **不做 IPv6**：portproxy 的 v4tov4 是本项目目标；`netsh` 解析（003）也只覆盖 v4tov4。
6. **两列 + 本地化状态词的行会被跳过**（`parseDistroTable` 的判定②只认英文状态词白名单）：宁可漏、不可编。目标形态是 `wsl -l -v`（三列带版本），无 `-v` 的两列输出只作容错。
7. **超时定时器必须在挂事件处理器之前建立**：否则子进程若在注册阶段**同步** close，`finish()` 里 timer 尚未赋值 ⇒ 定时器永不清除、事件循环被拖到超时才退出（实测症状：契约层 20,958ms → 修复后 129ms）。回归用例在 `tests/unit/exec.test.ts`。
8. **`env` 是整份替换**（`spawn` 语义）：合并环境变量是调用方的责任（`{ ...process.env, FOO: '1' }`），本包不做隐式合并 —— 隐含合并会让「传了什么环境」变得不可推理。
9. **stdout/stderr 无大小上限**：`spawn` 不像 `execFile` 有 `maxBuffer`，输出全进内存。本包自己的命令（`wsl -l -v` / `netsh … show v4tov4`）输出都有界，故**不加** `maxBytes` 选项（不为假想需求膨胀公开面）；将来若用于「docker 日志」这类无界输出，**必须先加限流**。
10. **PID 复用窗口**：`child.kill()` 与兜底 `taskkill /PID` 之间理论上 PID 可被系统回收给别的进程（毫秒级窗口，Windows 的常见风险）；不额外加防护，记录在案。
11. **状态守卫的 TOCTOU 窗口（REQ-2.4）**：守卫读的是 `listDistros` 的**快照**，而"读状态"与"执行 `wsl -d`"不可能原子（`wsl.exe` 没这个能力）。若发行版在两者之间被 WSL 空闲回收，`wsl -d` 会**静默冷启动**它（12.6s + 拉起容器），与 REQ-2.4 的字面要求相违。影响有界（窗口毫秒级、且只发生在"读时 Running"的情况下），缓解 = 调用方紧接状态读取后立刻探测（003 的流程如此）。**不做**心跳/守护线程。
12. **`taskkill /T` 不是回收发行版侧进程的必要条件**（2026-10-08 A/B 实测）：A 臂只 `child.kill()`（注入空 treeKill）、B 臂走默认实现（kill + `taskkill /PID /T /F`），两臂超时后发行版内 `sleep` **都被回收**（control 先确认它在跑）⇒ 只杀 `wsl.exe` 也能让会话内进程消失。`taskkill /T` 因此是**保险**（对更深的 Windows 侧进程树有意义），不是救命稻草；T1.4 的降级方案**不需要启用**。局限：只测了单层直接子进程（`sleep`），未测深进程树。
13. **路径翻译的 whitespace/前缀/长度取舍**：入参**首尾空白会被 trim**（表单场景常见；段内空格与中文原样保留，REQ-3.6）；`\\?\E:\x` 这类**扩展长度前缀被拒**（`?` 命中保留字符）—— 本包不猜"这是不是长路径前缀"。尾随空格/句点的路径**段**（`E:\x.`）照原样翻译，Windows 自己会在多数 API 里吃掉它们。**不检查 MAX_PATH，也不自动加 `\\?\` 长路径前缀**（实测 401 字符输入照译，输出 796 字符；是否可用取决于目标进程的长路径支持）。
14. **盘符相对形态按盘根解析**：`E:x` / `E:..\x` → `/mnt/e/x`（REQ-3.1 的字面要求）；严格说"E 盘的当前目录"必须读 FS 才知道，但 Windows 每盘当前目录**默认即根** ⇒ 常见情形正确，读不出真实值时也不猜。
15. **`/mnt/<盘>` 的存在性不校验**（纯函数不读 FS）：automount 关闭或自定义挂载点时，归属判断由调用方用 `wsl -l -v` / `.wslconfig` 的事实承担 —— 本包只做字符串变换。
16. **`networkingMode` 写在旧节 `[experimental]`（WSL 2.0 之前的位置）时本包看不到**：REQ-4.5 明确要求「忽略其他节」⇒ 判为 `default/nat`；而 WSL 2.7.3 是否仍读旧节，本机**无法在不改用户配置、不重启 WSL 的前提下验证** ⇒ 记为已知风险（若真读，我们会**误报"可用"**）。缓解：003 不据此自动写规则，且 `mode==='default'` 时仍走「写入前强制现读 + 转发自检」兜底。
