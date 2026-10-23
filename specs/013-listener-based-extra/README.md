---
status: complete
created: 2026-10-23
created_at: 2026-10-23T02:52:10.174138300Z
updated_at: 2026-10-23T03:27:15.041015100Z
completed_at: 2026-10-23T03:27:15.041015100Z
transitions:
- status: in-progress
  at: 2026-10-23T02:55:52.008995500Z
- status: complete
  at: 2026-10-23T03:27:15.041015100Z
---
# 013 · “多余规则”改按「WSL 内有没有服务在监听」判定

## 背景（2026-10-23 主人真机提问）

右栏页「多余规则（可移除）」的现有判据是 **`no-docker-mapping`**：端口在 `managedPorts` 里、`netsh` 规则在、但 `docker ps` 不再映射它。
主人原话：「这个可以改成检测服务在不在么」。真实反例：主人用 `python -m http.server 3306` 起服务（非 docker），规则**正在工作**，却会被这条判据归为“多余”。

## 需求（EARS）

- REQ-1.1 系统 SHALL 以 **WSL 内的监听表**（`ss -ltn`）判定「该端口是否真有服务在跑」，不再以 docker 映射为唯一依据。
- REQ-1.2 判据：规则 `connectPort` 在 WSL 内监听于 `0.0.0.0` / `*` / eth0 ⇒ `在用`；**只监听在 `127.0.0.1`** ⇒ `extra`，原因 `loopback-only`（portproxy 连不到它）；**完全无监听** ⇒ `extra`，原因 `no-listener`。
- REQ-1.3 监听表探测失败（WSL 停止、`ss` 不可用、超时）⇒ 状态 `未知`，文案明示「无法确认服务是否在跑」；**主人裁定：未知态仍允许「移除」**（不能因为探测不到就把用户卡死）。
- REQ-1.4 文案 SHALL 不再出现「docker 已不再映射该端口」；改为 `WSL 内没有进程监听该端口` / `该端口只在 WSL 回环上监听，转发规则连不到它` 两句（不保留 docker 附注）。
- REQ-1.5 探测 SHALL 并入现有快照（单次 `ss -ltn` 拿全表），沿用现有 WSL 探针的硬超时与失败可区分语义；SHALL NOT 逐端口开进程。

## 验收

- [x] A1 `python -m http.server 3306` 在跑时，3306 这条规则**不被**判为多余。
  （`tests/unit/listener-extra.test.ts`：`0.0.0.0:3306` ⇒ `ok` + `listener-active`）
- [x] A2 无监听的端口（造一个空闲端口 + 规则）判 `extra`，文案为「WSL 内没有进程监听该端口」。
- [x] A3 只在 `127.0.0.1` 监听时判 `extra`，文案为「只在回环上监听…」。
- [x] A4 监听表读不到时显示 `未知`，且「移除」按钮**仍可点**。
  （可达性边界见下方「实现记录」：WSL 停止时 eth0 同时失败 ⇒ 走既有 0 行分支）
- [x] A5 既有 488 个 `node --test` / 148 个 vitest 用例全绿；主包体积不增长（新 UI 留在懒加载 chunk）。
  （实测 511/511、154/154；主包 49,500 B = 棘轮上限，新增 23+6 条用例）

## 实现记录（2026-10-23）

- 新增 `src/read/listeners.ts`（**纯解析面**：`parseSsListeners` + 通配/回环/eth0 分类，零进程依赖）
  与 `src/read/listeners-probe.ts`（单条 `wsl -d <distro> -- ss -ltn`；热路径 10s、冷启动走 001 的 30s；
  失败 reason 可区分：`wsl-missing` / `distro-missing` / `wsl-stopped` / `ss-missing` / `timeout` /
  `non-zero-exit` / `parse-error` / `unexpected`）。拆分原因：判决引擎经 `write/index.ts` 的运行时再导出
  已在客户端 chunk 图里，若它直接 import 探针文件会把 `execInDistro`（`node:child_process`）拖进浏览器
  bundle（esbuild 实测报 `Could not resolve`）。
- **不新增第 6 个 `PortState`**（会波及 `PORT_STATES` / 计数契约 / 主包常驻的 `rows.ts`）：
  「在用」= `ok` + `listener-active`（`expected: null`）；「未知」= `extra` + `listeners-unknown`
  （于是「移除」天然可点，`rows.ts` 一字未改）。标签/文案覆盖只在 chunk 侧的 `page.ts`。
- `no-docker-mapping` 保留为 **@deprecated** 类型成员：旧服务端快照仍能解析，客户端按「未知」渲染，
  页面不再出现「docker 已不再映射」。
- 「未知」的两条来源：① `diff` 入参缺 `listeners`（旧调用方/单测）；② 探针失败。**绝不**退化成
  「没有监听」；空输出也按 `parse-error`（`ss -ltn` 即使无监听也会打表头）。
- 假设：绑在「eth0 之外的具体 IP」按保守口径并入「在用」（宁可少报多余，不误删可能可用的规则）；
  `scope` / `localhostForwarding` 不参与监听表判决；外部规则仍只读、不分类。
- 已知边界（A4 的可达性）：WSL 停止时 eth0 探测同时失败 ⇒ 走既有 `eth0-unknown` 分支（端口 0 行），
  因此「未知 + 可移除」实际出现在 **eth0 成功、`ss` 失败**（`ss` 缺失 / 超时 / 形态脏）时；
  这是既有失败分支的语义，本轮未改。
- 验证：`node --test` 511/511、`vitest` 17 files / 154 tests、`tsc` 三道门 exit 0、
  主包 49,500 B（SSoT 棘轮余 0 B，零增长）、chunk 146,798 B；新文案只出现在 `lib/client.ports.js`
  （`lib/client.js` 零命中）。


## 不做（本轮明确排除）

- 不做“修复 loopback-only”的自动改绑（那是写路径的新动作，需另立 Spec）。
- 不再维护 docker / 非 docker 的白名单。
