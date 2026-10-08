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
      └─ src/index.ts            公开面（≤ 12 导出，REQ-6.4）

依赖方向**单向**：`002 → 001`、`003 → 001`；`001 → node:` 内置。A **不**依赖任何 DSH 宿主服务，因此可以在没有宿主、没有网络的 Node 进程里跑全量测试（REQ-6.3）。

依据：`stack-decision.md` · `plugin.packageSplit`（三包，官方建议「需在其他行关闭时仍保留页面的子插件应独立成包」）。

---

## 2. 类型契约

| 类型 | 形状 | 说明 |
|---|---|---|
| `WslDistro` | `{ name: string; state: 'Running'｜'Stopped'｜'Installing'｜'Unknown'; version: 1｜2｜'unknown'; isDefault: boolean }` | `state` 无法识别 → `Unknown`（不抛错）|
| `NetworkingMode` | `{ path: string; mode: 'nat'｜'mirrored'｜'default'｜'other'; rawValue?: string; resolved: 'nat'｜'non-nat' }` | `resolved` 只有两态，消费方只需判一个布尔（REQ-4.4）|
| `ExecResult` | `{ ok: true; exitCode: 0; stdout: string; stderr: string }` | 成功态（`stderr` 非空也算成功，REQ-5.4）|
| `WslSharedError` | `{ ok: false; code: ErrorCode; message: string; argv?: string[]; exitCode?: number; stderr?: string; path?: string; distros?: string[] }` | 所有失败的唯一出口（REQ-5.6）|
| `ExecOptions` | `{ cwd?: string; env?: Record<string,string>; timeoutMs: number; encoding: 'utf16le'｜'utf8'｜string }` | `timeoutMs` **必填**，不设隐式默认（REQ-5.3）|

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

解析：取 `inet <ip>/<prefix>` 的首个匹配 → 返回 IP（REQ-2.2）。`ip` 命令不存在时退出码非 0 → `NonZeroExit`（`hostname -I` 作为文档化备选，但**不**自动降级：降级会让「NAT 下 eth0 语义」这一前提悄悄失效）。

**冷启动守卫（REQ-2.4）**：调用前先用 `distros` 结果判断目标是否 Running；非 Running 直接返回 `DistroNotRunning`，**不执行** `wsl -d`。

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

### 3.4 `.wslconfig`（`wslconfig.ts`）

- 路径：`path.join(process.env.USERPROFILE ?? os.homedir(), '.wslconfig')`。
- 读取：`fs.readFile` → 失败 → `ConfigUnreadable`（**不是**缺省 NAT，REQ-4.6）；`ENOENT` → `{ mode:'default', resolved:'nat' }`（REQ-4.2）。
- 手写 INI 子集解析（只为读一个键，不引依赖）：剥 BOM、按行、`#`/`;` 起注释、`[section]` 记当前节、`key = value` 去两侧空白并剥离行内注释；只认 `wsl2` 节的 `networkingMode`（节名与键名均大小写不敏感）。
- 判定：`nat` → nat；`mirrored` → mirrored；缺失 → default；其余（含 `bridged`、拼写错误、未来值）→ **other**，`resolved` 一律非 nat（REQ-4.4）。
- **只读**：本包 SHALL NOT 写 `.wslconfig`（修复指引由 003 展示文本）。

---

## 4. 执行器（`exec.ts`）

- `spawn(file, argv, { cwd, env, windowsHide: true })`，`stdio: 'pipe'`；**无 shell**（REQ-5.2）。
- 收集 `stdout`/`stderr` 为 `Buffer`，结束后按 `options.encoding` 解码（REQ-5.5）。
- 超时：`setTimeout(timeoutMs)` → 先 `child.kill()`，再兜底 `taskkill /PID <pid> /T /F`（Windows 无 POSIX 进程组信号，`wsl.exe` 会派生 `wslhost`/发行版进程）。
  > **待验证（T2.3）**：`taskkill` 是否真能回收 `wsl.exe` 拉起的发行版侧进程；若不能，降级为「杀 `wsl.exe` + 在 UI 明示可能有残留」。
- 事件：`error` → `CommandNotFound`（`ENOENT`）或 `Unexpected`；`close` → 组装结果。
- 可注入：`createExecutor(spawnImpl)` 供测试传 fake（REQ-6.3）。

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
| 真机探测 | 手动脚本 `scripts/probe.mjs` | 在真机上打印 5 项事实；**不**进 CI，作为 002/003 真机验收的输入 |
| 真机 UI 验收 | chrome-devtools MCP | **本包 N/A（无 UI）** —— 由 002 / 003 的页面承担 |

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

1. **UTF-16LE 与表头本地化仍是假设**（A-1 / A-2），T0.1 fixture 到手前不写死；若假设错，改断言而非改结构。
2. **`taskkill /T` 的回收能力未验证**（**T1.4** —— 原文误写 T2.3）；不能保证发行版侧无残留进程。⏳ 需**唤醒发行版**才能验（约 10–12s 且会拉起用户的容器）⇒ 与 Phase 3 一起做，不在解析阶段制造副作用。
3. **WSL 缺省网络模式是版本相关的经验值**（A-6）；`resolved` 是判定而非探测，真正的「通不通」由 003 的转发自检兜底。
4. **不支持非 `/mnt/<盘>` 的自动反查**：Linux 路径 → Windows 路径需要发行版名（REQ-3.4），这是刻意的（不猜）。
5. **不做 IPv6**：portproxy 的 v4tov4 是本项目目标；`netsh` 解析（003）也只覆盖 v4tov4。
6. **两列 + 本地化状态词的行会被跳过**（`parseDistroTable` 的判定②只认英文状态词白名单）：宁可漏、不可编。目标形态是 `wsl -l -v`（三列带版本），无 `-v` 的两列输出只作容错。
7. **超时定时器必须在挂事件处理器之前建立**：否则子进程若在注册阶段**同步** close，`finish()` 里 timer 尚未赋值 ⇒ 定时器永不清除、事件循环被拖到超时才退出（实测症状：契约层 20,958ms → 修复后 129ms）。回归用例在 `tests/unit/exec.test.ts`。
