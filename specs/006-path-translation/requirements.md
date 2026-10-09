# 需求：路径翻译（`dsh-wsl-shared` / `src/pathmap.ts`）

> 本 Spec 为**需求驱动**（requirements-first）。导航见 [README.md](./README.md)。
> **迁入说明（2026-10-09）**：REQ-3.1–REQ-3.7 **原样迁入自** [001-wsl-shared](../001-wsl-shared/requirements.md)，**编号不变** —— `pathmap.ts` 与它的 87 条单测里已有 20+ 处按编号追溯，改编号等于让追溯链断掉；001 侧该段留**空位**指向本 Spec。

---

## 1. 需求（EARS）

### REQ-3 路径翻译

- **REQ-3.1** GIVEN `E:\x\y` 形态的 Windows 路径，WHEN 转 WSL，THEN 系统 SHALL 返回 `/mnt/e/x/y`；盘符 SHALL 归一为小写，分隔符 SHALL 归一为 `/`。
- **REQ-3.2** GIVEN `/mnt/e/x/y`，WHEN 转 Windows，THEN 系统 SHALL 返回 `E:\x\y`。
- **REQ-3.3** GIVEN UNC 形态 `\\wsl.localhost\<发行版>\home\u` **或** 旧式 `\\wsl$\<发行版>\home\u`，WHEN 转 WSL，THEN 系统 SHALL 返回 `/home/u`。
- **REQ-3.4** GIVEN 非 `/mnt/<盘>` 的 Linux 路径（如 `/home/u`），WHEN 未提供发行版名，THEN 系统 SHALL 返回 typed error（`NoWindowsEquivalent`），SHALL NOT 猜测盘符；WHEN 提供了发行版名，THEN 系统 SHALL 返回 `\\wsl.localhost\<发行版>\home\u`。
- **REQ-3.5** GIVEN 输入为空串、相对路径、含 `<>:"|?*` 等非法字符或不可识别的 UNC（如 `\\server\share`），THEN 系统 SHALL 返回 typed error（`UnmappablePath`），SHALL NOT 抛裸异常。
- **REQ-3.6** 翻译 SHALL NOT 做引号包装或 shell 转义（结果经 `argv` 数组传递）；含空格与中文的路径 SHALL 原样保留。
- **REQ-3.7** 翻译 SHALL NOT 触碰文件系统（不 `stat`、不解析符号链接、不展开 `..` 以外的语义）；纯字符串变换，保证可离线单测。

**接口**：类型契约见 [design.md](./design.md) §2；本 Spec **不新增错误码** —— 复用 001 `errors.ts` 的 `UnmappablePath` / `NoWindowsEquivalent`（它们的「消费方建议动作」写在 001 的 `design.md`）。

---

## 2. 非功能需求

> 包级 NFR 的 SSoT 仍在 [001](../001-wsl-shared/requirements.md)（零运行时依赖 / `strict` / 离线可测 / 无副作用 / 行数阈值），此处只列**与本 Spec 直接相关**者，**不重复全文**，NFR 编号也沿用 001 以免两处打架。

- **NFR-1** 零运行时依赖：只许 `node:path`（+ 本包 `./errors.ts`）；**不许** `node:fs` / `node:child_process`。
- **NFR-4** 纯函数、无副作用（REQ-3.7）：同输入同输出、不改动入参；**静态断言**在剥注释后的源码里查「零 `node:fs` / 零 `node:child_process` / 零 `spawn`」。
- **NFR-5** 单文件 ≤ 400 行、单 Spec 文档 ≤ 200 行（`leanspec` 校验门：warn 200 / max 400）。

---

## 3. 约束与假设

| # | 内容 | 影响 |
|---|------|------|
| C-1 | 消费者 = **002**（`cwd` → `cwdLinux` 推导，其 REQ-1.4）与 **004**（工具参数里的 Linux 路径）；两者同在 `packages/terminal-profiles/` | 本 Spec 是 002/004 的前置能力，但**不建包依赖边**（同 workspace 内 `link:` 引用）|
| C-2 | 反向（Linux → Windows）的输入可能是**无盘符**路径 | 必须由调用方显式提供发行版名，否则报错（REQ-3.4，**不猜**）|
| A-1（**假设，未实测**）| `\\wsl$\<发行版>` 旧前缀在 WSL 2.7.3 上仍指向同一个共享 | REQ-3.3 **接受**两种前缀（字符串层翻译）；但本机**没有实测过这个共享能否挂载** —— 若某个版本删了旧前缀，我们仍会「翻译成功」而目标不可达。如实登记，不粉饰 |
| A-2（**✅ 已确认**）| `/mnt/<盘>` 的反解析可以在**字符串层**完成（不读 FS） | REQ-3.1/3.2 成立的前提；代价：automount 关闭或自定义挂载点会误判 ⇒ 已列范围外，由调用方用真实事实兜底（design §4 第 7 条）|
| A-3（**✅ 已确认**）| `node:path` 的四条咬人语义（`win32.normalize('E:')` → `'E:.'` 等）| 2026-10-08 动手前实测 ⇒ 决定了「盘符先摘再 normalize」的实现（design §3）|
