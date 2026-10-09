# 技术设计：路径翻译（`pathmap.ts`）

> 从 [requirements.md](./requirements.md) 派生（requirements-first）。任务与证据见 [tasks.md](./tasks.md)。
> **迁入说明（2026-10-09）**：§3 原为 [001 design.md](../001-wsl-shared/design.md) 的 §3.3，**原样迁入**（实测事实一字未改）；§4 承接 001 原 §8 的第 13/14 条及相关取舍。

---

## 1. 定位与边界

    packages/wsl-shared/src/pathmap.ts    ← 纯字符串变换：不 stat、不读文件、不起进程
      ├─ 依赖 node:path                     （win32 / posix 两套语义都用）
      └─ 依赖 ./errors.ts                   （fail / UnmappablePath / NoWindowsEquivalent —— 属 001）

依赖方向**单向**：本 Spec → 001（错误模型）。**零宿主依赖**：没有 DSH、没有网络也能跑全量测试；002 在没有宿主的环境下也要用它推导 `cwdLinux`（其 REQ-1.4）。

---

## 2. 类型契约

| 类型 | 形状 | 说明 |
|---|---|---|
| `PathMapping` | `{ ok: true; path: string }` | 成功态**必须带 `ok: true`**（与其余成功态同口径，`isWslFailure()` 才能收窄联合）|
| `PathMappingOutcome` | `PathMapping ｜ WslSharedError` | 失败态是 001 的判别联合，`code` ∈ `UnmappablePath` / `NoWindowsEquivalent` |

公开面（由 001 的 `index.ts` 导出，导出预算仍记在 001）：`winToWsl(input: string)` 与 `wslToWin(input: string, distro?: string)` —— 两个**纯函数**，无选项对象、无隐式默认。

---

## 3. 映射表与判定规则（原 001 design §3.3）

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

---

## 4. 边界与限制

1. **入参首尾空白会被 trim**（表单场景常见）；**段内**空格与中文**原样保留**（REQ-3.6）。
2. **`\\?\E:\x` 这类扩展长度前缀被拒**（`?` 命中保留字符）—— 本包不猜「这是不是长路径前缀」。
3. **尾随空格/句点的路径段**（`E:\x.`）照原样翻译；Windows 自己会在多数 API 里吃掉它们。
4. **不检查 MAX_PATH，也不自动加 `\\?\`**（实测 401 字符输入照译、输出 796 字符；是否可用取决于目标进程的长路径支持）。
5. **盘符相对形态按盘根解析**：`E:x` / `E:..\x` → `/mnt/e/x`（REQ-3.1 的字面要求）。严格说「E 盘的当前目录」必须读 FS 才知道，但 Windows 每盘当前目录**默认即根** ⇒ 常见情形正确；读不出真实值时也不猜。
6. **不支持非 `/mnt/<盘>` 的自动反查**：Linux → Windows 需要发行版名（REQ-3.4），这是**刻意**的（不猜）。
7. **`/mnt/<盘>` 的存在性不校验**：automount 关闭或自定义挂载点时归属判断会错，由调用方（002/003）用真实事实兜底 —— 本 Spec 只做字符串变换。
8. **UNC 里的 `..` 夹在共享根不是缺陷**（见 §3 实测第 ④ 条）：我曾在自审里把它判成「静默错译」并加了拒绝分支，**实测推翻**后撤回误修、改 3 条回归用例钉住语义。

---

## 5. 测试策略

| 层 | 载体 | 覆盖 |
|---|---|---|
| 纯函数单测 | `vitest`（`tests/unit/pathmap.test.ts`，**87 条**）| 三个方向全分支 + 非法输入 + 边界（大小写、尾分隔符、`..` 夹取、尾随 `.`/空格）|
| 静态断言 | 同文件 | 剥注释后源码**零** `node:fs` / `node:child_process` / `spawn`；**依赖面枚举**只许 `node:path` + `./errors.ts` |
| 属性化 | 同文件（固定种子 ⇒ 可复算）| 1500+1500 次往返 + 2000×3 随机垃圾串：返回值形态始终合法、绝不抛异常 |
| 离线契约（`node --test`）| ❌ **不适用** | 纯函数，**没有真机字节可捕获**（无 fixture）—— 「少一层证据」如实登记，不是遗漏 |
| chrome-devtools MCP 真机 | ❌ **不适用** | 本 Spec 无 UI |

**为什么 `vitest` 够用**：本 Spec 的输入空间是**字符串**而不是「别人产出的字节」（编码/本地化/超时那些坑全在 001 的 `exec.ts` 与解析层），因此**合成输入 + 静态纯度断言 + 属性化**就是完备的证据组合；真机层只保留一次「拿本机真实路径做目视对照」（见 tasks.md 的完成记录）。
