# 任务：路径翻译（`pathmap.ts`）

> **迁入说明（2026-10-09）**：T4.1–T4.4 与「Phase 4 完成记录」**原样迁入自** [001 tasks.md](../001-wsl-shared/tasks.md)，**编号不变**（T4.x / REQ-3.x）；001 侧留空位指向本 Spec。
> **状态：全部已完成**（2026-10-08 交付，2026-10-09 建本 Spec 承接）。产物：`src/pathmap.ts` **206 行 / 4.5 KB 代码**（原始 11,010 字节）+ `tests/unit/pathmap.test.ts` **292 行 / 87 条**。

## Phase 4：路径翻译

- [x] T4.1 [REQ-3.1][REQ-3.2] 盘符双向翻译
  - ✅ 单测 **20 条**：`E:\x\y`、`e:/x/y`、`E:x`、`E:`（⚠️ `win32.normalize('E:')`→`'E:.'` ⇒ 盘符先摘）、末尾反斜杠、重复分隔符折叠、`..` 消解与盘根夹取、空格与中文；反向 `E:\x\y`、`E:\`、`/mnt/e/../f`→`F:\`；往返一致

- [x] T4.2 [REQ-3.3] UNC 双向（`\\wsl.localhost\` 与 `\\wsl$\`）
  - ✅ 单测 **20 条**：两种前缀、前缀大小写不敏感、正斜杠形态、尾分隔符、发行版名含空格、发行版根 → `/`；反向带发行版名 → `\\wsl.localhost\<distro>\home\u`（`/mnt` 优先走盘符，发行版名不参与）；`..` **夹在共享根**（3 条钉死）；**发行版段为 `.`/`..` → 拒**（自审缺陷①，3 条）

- [x] T4.3 [REQ-3.4] 无盘符 Linux 路径的策略
  - ✅ 单测 **17 条**：无发行版名 → `NoWindowsEquivalent`（`/home/u`、`/`、`/mnt`、`/opt/data`）；**断言未猜盘符**（错误无 `path` 字段、消息不含 `X:\`）；空/空白发行版名等同未提供；非法发行版名（`a|b`/`../x`/`a\b`/`a/b`/`..`/`.`/**尾随 `.` 或空格**）→ `UnmappablePath`；`/mnt/C` 大写不算挂载点

- [x] T4.4 [REQ-3.5][REQ-3.6][REQ-3.7] 非法输入与纯函数性
  - ✅ 单测 **27 条**：空串/相对路径/`\\server\share`/`\\wsl.localhost`/无盘符根/保留字符/控制字符/非盘符位置的 `:` 全 `UnmappablePath`；Linux 侧**额外拒反斜杠**（到 Windows 会变分隔符 ⇒ 静默错译）；**非字符串入参也不抛**；16 条脏输入不抛异常且返回值形态合法；**message 不回显控制字符且限长**（自审缺陷②）；输出**不含引号**、空格与中文原样；**静态断言**：剥注释后源码零 `node:fs`/`node:child_process`/`spawn`，且**依赖面枚举**只许 `node:path` + `./errors.ts`
  - ✅ 属性化 **3 条**（固定种子 ⇒ 可复算）：1500+1500 次往返 + 2000×3 随机垃圾串

### ✅ Phase 4 完成记录（2026-10-08，原样迁入）

- 🔬 **先测再写（本阶段最有价值的事）**：动手前实测 `node:path`，抓到 4 条会咬人的语义 —— `win32.normalize('E:')` → **`'E:.'`**（裸盘符被补 `.`）、normalize 给**共享根**补尾分隔符、`posix.normalize` **保留尾斜杠**但把 `/..` 夹到 `/`、UNC 里的 `..` **夹在共享根**。全部写进 design §3 + 模块头注释。
- 🐛 **自审（第二轮，主人点名）抓到 3 个真缺陷**：① **UNC 的发行版段是 `.`/`..` 时被当正常名字吞掉**（`\\wsl.localhost\..\x` → `/x`；实测 distro=`..` 原样保留）⇒ 按「不是可识别的 UNC」拒；② **错误 message 原样回显控制字符** ⇒ `E:\x\u001b[31mred` 的 ESC 会进 UI/日志（**ANSI 注入面**）⇒ 回显前可见化 + 限长（≤120 字符 + 总长）；③ **发行版名以 `.`/空格结尾**拼出 `\\wsl.localhost\D.\…` ⇒ Windows **不可能存在**的共享名 ⇒ 拒。
- ✅ **自审的「疑似缺陷」必须过实测**：第一轮我曾判定「UNC 里 `..` 越根 = 静默错译」并加了拒绝分支 → **实测推翻**（`win32.normalize` 夹在共享根正是 Win32 语义）⇒ 撤回误修、改 3 条回归用例钉语义；同轮订正了我「`rest` 里不可能再有 `..`」的**过头注释**（`\\wsl.localhost\..\x` 会被原样保留）。
- 🔁 **属性化不变量固化成常驻用例**（固定种子 ⇒ 可复算）：这是本仓库第一次把「随机输入不抛异常」变成常驻证据，后来成为 001 Phase 5 沿用之法。

### 🔎 真机形态目视（2026-10-09，纯函数 ⇒ 唯一的真机层）

探针（`%TEMP%`，**不入库**）拿**本机真实路径**与**真机发行版名**跑了一遍，逐条与预期对照：

| 输入 | 实测输出 | 判定 |
|---|---|---|
| `E:\NodeProjects\dsh-wsl-toolkit` | `/mnt/e/NodeProjects/dsh-wsl-toolkit` | ✅ |
| `C:\Users\EDY\.wslconfig` | `/mnt/c/Users/EDY/.wslconfig` | ✅ |
| `\\wsl.localhost\Ubuntu2204\home` | `/home` | ✅ |
| `\\wsl$\Ubuntu2204\home` | `/home` | ✅（旧前缀 A-1 仍是**假设**，此处只证明「字符串层接受」）|
| `/mnt/e/NodeProjects/dsh-wsl-toolkit` | `E:\NodeProjects\dsh-wsl-toolkit` | ✅ |
| `/home/edy/projects`（无发行版名）| ❌ `NoWindowsEquivalent` | ✅ **不猜盘符** |
| `/home/edy/projects` + 真机名 `Ubuntu2204` | `\\wsl.localhost\Ubuntu2204\home\edy\projects`；再转回 = `/home/u`→`/home` 往返一致 | ✅ |
| `/home/edy/projects` + `a..` | ❌ `UnmappablePath`（以 `.` 结尾的共享名不允许）| ✅ |
| `E:x` | `/mnt/e/x` | ✅ |
| `\\server\share` | ❌ `UnmappablePath` | ✅ |

### 门禁（2026-10-09 复算）

| 门 | 结果 |
|---|---|
| `pnpm -C packages/wsl-shared test` | **220/220** 全绿（其中 pathmap **87 条**）✅ |
| `typecheck` | **exit 0** ✅ |
| 静态纯度断言 | 零 `node:fs` / 零 `node:child_process` / 零 `spawn` ✅ |
| `check:exports`（记在 001）| 运行时 **8/12**（含本 Spec 的 `winToWsl` / `wslToWin`）✅ |
| `check:size` | `pathmap.ts` **206 行**（NFR-5 上限 400 ✅）；包内去注释 **25,859 / 40,960 字节** ✅ |
| 单 Spec 文档 ≤ 200 行 | requirements / design / tasks 均远低于阈值 ✅ |

### 真机验收

| 层 | 是否适用 | 说明 |
|---|---|---|
| vitest 单元 | ✅ | 87 条（全分支 + 非法输入 + 边界 + 属性化 3 条）|
| `node:test` 离线契约 | ❌ **不适用** | 纯函数，**没有真机字节可捕获**（本 Spec 无 fixture）—— 如实登记，不假装有 |
| chrome-devtools MCP 真机 | ❌ **不适用** | 本 Spec 无 UI |
| 人工目视 | ✅ | 上表 10 条真机形态对照（探针在 `%TEMP%`，不入库）|

---

## 无阻塞项

本 Spec **没有** B-x/A-x 阻塞项：代码与 87 条单测已全绿，唯一未验证项是 `\\wsl$` 旧前缀的可达性（requirements A-1，**假设**，且不影响字符串层翻译的验收）。
