# 008 写入通道 —— 任务

> 每行一个任务；`[REQ-N]` 指向 [requirements.md](./requirements.md)。**「判据」必须是可二值判定的**（跑得出来、看得见）。分期见 design §9。

## Phase 0：契约核对（不写产品代码）

- [x] T0.1 [REQ-4.1] 核对 005 提权链的可用入口签名（`createElevationInvoker` / `detectBackend` / `probeElevationAvailability` 的实际导出与参数），写进 design 的接口小节。
  - 判据：把真实签名（文件:行 + 形参表）抄进 `design.md`；与代码不符即改文档，不改代码。
- [x] T0.2 [REQ-1.1] 核对宿主 `ctx.webServer` 的路由 API：前缀匹配顺序（exact → 最长 prefix → fallback）、`registerUpgrade` 的路径约束、disposer 归属（`ctx.effect`）。
  - 判据：三条结论各配一条源码位置或真机证据；「前缀不带尾斜杠」有实证。
- [x] T0.3 [REQ-2.4] 确认「所有权集合」的唯一来源（配置里的 `managedPorts` 解析结果）与读模型的现态入口。
  - 判据：写出「集合 → 计划过滤」的调用链（模块:函数）；集合外端口确实进 `port-not-managed`。

## Phase 1（P1）：**只读通道**（零写入，先拿 G1/G3/G4）

- [x] T1.1 [REQ-1.1–1.2] 新增 `src/transport/routes.ts`：常量 `WRITE_HTTP_PREFIX = '/dsh-wsl-docker-ports/write'`（**无尾斜杠**）、懒 `ctx.inject(['webServer'], …)`、幂等 `attach`、disposer 无条件进 `ctx.effect`。
  - 判据：重复 `attach` 只注册一次；disposer 调用两次不抛；**单测含反例**：常量改成带尾斜杠 ⇒ 至少 1 条红（REQ-1.1 的实证）。
- [x] T1.2 [REQ-1.3–1.4] 方法判据与错误码：`POST …/write/plan`、`GET …/write/audit`；其余路径 404、方法不符 405；`Content-Length` 按 UTF-8 字节、`Cache-Control: no-store`。
  - 判据：构造含中文与 emoji 的响应体，断言 `Content-Length` == `Buffer.byteLength(body)`；**先判路径后判方法**（错路径 + 错方法 ⇒ 404 而非 405）。
- [x] T1.3 [REQ-2.1] `src/transport/plan.ts`：声明式目标 → 动作清单（逐条作用域/监听地址/端口/连接地址/是否伴随防火墙规则/**命令原文** + 条数与影响面）。
  - 判据：`scope:'lan'` 的计划里每条 `commandText` 含具体端口且**不含通配符**；条数 == 端口数（范围内逐端口 1 条）。
- [ ] T1.4 [REQ-2.2] 计划路径**零副作用**：不调提权、不写盘、不动 `netsh`。
  - 判据：注入的提权/执行器 spy **全 0**；`apply` 未被调用；真机复验计划前后 `netsh` 逐字节相同（并进 T1.7）。
- [x] T1.5 [REQ-2.3–2.4] 非法输入与集合外端口：返回空计划 + 可读原因，零动作。
  - 判据：`ports:[0]` / `ports:[70000]` / `scope:'wan'` / 集合外 `5173` ⇒ `steps: []` 且 `notes` 非空；**不是** 400。
- [ ] T1.6 [REQ-5] `src/transport/audit.ts`：内存环形（N=100）+ 单行人类可读日志；`GET …/write/audit` 返回尾部。
  - 判据：**不产生任何文件**（用临时目录快照断言零新增文件）；敏感词扫描零命中。
- [ ] T1.7 [REQ-6.1] 真机复验 P1：探针 profile（**白名单：不得用 `desktop` / `web`**）起实例，打 `plan` 与 `audit`。
  - 判据：① `plan` 前后 `netsh … show v4tov4` **逐字节相同**（G1）；② 未知路径/错方法真机返回**我们的 JSON**（不是宿主兜底 404）（G4）；③ 跑完逐字节还原 profile。

## Phase 2（P2）：**执行**（G2/G5/G6）

- [ ] T2.1 [REQ-3.1] `src/transport/confirm.ts`：`planId` = 规范化计划 SHA-256（端口升序/键序固定/剔除 notes）；一次性票据 + TTL 120 s + 绑定 `planId`。
  - 判据：同一目标两次 `plan` 得到**相同** `planId`；端口顺序不同但集合相同 ⇒ 仍相同；票据二次使用被拒绝。
- [ ] T2.2 [REQ-3.2–3.4] `apply` 校验：body 只允许 `{ target, planId, confirmed, origin }`；服务端**重新推导**计划并比对 `planId`；`confirmed !== true` ⇒ 拒绝。
  - 判据：① 未确认 ⇒ 提权 spy 全 0；② 篡改 `target` ⇒ `plan-mismatch`、零执行；③ 客户端塞 `commands:[…]` 字段 ⇒ **被忽略**（服务端仍按 `target` 推导）；④ `origin:'agent'` 时不能绕过确认。
- [ ] T2.3 [REQ-4.1] `src/transport/apply.ts`：经 005 后端链执行，回传逐步结果（成功/失败/跳过 + 原因 + 耗时）。
  - 判据：后端返回 gsudo/native 各造一次假执行，逐步结果条数 == 计划条数；耗时字段为数字且 ≥ 0。
- [ ] T2.4 [REQ-4.2] 幂等：执行前现读，已满足的规则标 `skipped`。
  - 判据：对同一目标连续 `apply` 两次 ⇒ 第二次 `executed` 为空、`skipped` 全中，且不报错。
- [ ] T2.5 [REQ-4.3] 失败与回滚：中途失败 ⇒ 按 005 REQ-3.5 回滚本轮，回传 `{executed, rolledBack, skipped, failed}`。
  - 判据：让第 2 条失败 ⇒ 第 1 条被回滚、返回体三个清单齐全、无「半成品」残留（假后端的状态快照断言）。
- [ ] T2.6 [REQ-5.1] 每次 `apply`（含拒绝/超时/失败/回滚）落一条审计。
  - 判据：成功与拒绝各留一条；字段齐全（at/origin/elevationPolicy/backend/ports/scope/action/result/exitCode/durationMs/rolledBack）；无凭据字段。
- [ ] T2.7 [REQ-6.2] 红线单测：无 `portproxy reset`、无通配符防火墙规则、集合外零动作。
  - 判据：对生成的命令**逐条断言**（正则白名单）：不含 `reset`；每条 `New-NetFirewallRule` 都带具体 `-LocalPort`。
- [ ] T2.8 [REQ-6.1] 真机复验 P2（**需主人在场**；本机 UAC 不弹窗 ⇒ 无需点 UAC，但会真改系统状态）：
  - 判据：① 写一轮 `add` 后「他人 19 条**逐字节不变**」（`ReadAllBytes` 全字节比对 + sha256）（G5）；② 再跑一次同目标 ⇒ 条数不增（幂等）；③ 用 `action:'remove'` 回滚到写前状态，`netsh` 与写前**逐字节相同**；④ 审计里能读出实际后端（`gsudo`/`native`）（G6）。

## Phase 3（P3）：界面接线

- [ ] T3.1 [REQ-3.1] 客户端：写动作前弹**确认对话框**，逐条展示命令原文与影响面；未确认不发 `apply`。
  - 判据：单测断言「未点确认 ⇒ 零网络请求」；对话框文本含每条命令原文（不是「即将执行」这种空话）。
- [ ] T3.2 [REQ-4.1] 结果逐步反馈：成功/失败/跳过/回滚分色展示，失败给出可读原因。
  - 判据：四种结果的渲染分支各有单测用例；失败态一定带原因文本。
- [ ] T3.3 主人环境自验清单（与 002 的 V1–V3 同格式：安装命令 + 判据 + 回归信号）。
  - 判据：清单写进本文件；当前状态标注「未通过（未验）」。

## Phase 4：收口

- [ ] **T4.1 [NFR-2]** 体积/行数/导出门：新增文件逐个报数（≤400 行原始、≤40KB 去注释去空行）。
  - 判据：脚本当场出数；超限则拆文件，**不抬阈值**。
- [ ] T4.2 文档同步：`README.md` 导航、`design.md` 接口小节、AGENTS.md / stack-decision 若需变更则留痕（不需要则写明「无需变更」）。
  - 判据：README 链接可达；本文件所有 REQ-N 都在 requirements 里存在。
- [ ] **T4.3 [NFR-1]** 依赖未增：`package.json` 依赖项数与写前一致；未引 E2E/HTTP 框架。
  - 判据：`git diff` 里 `package.json` 的 dependencies/devDependencies 无新增；`pnpm install --frozen-lockfile` exit 0。
