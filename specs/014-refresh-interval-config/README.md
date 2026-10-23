---
status: in-progress
created: 2026-10-23
created_at: 2026-10-23T03:49:17.448601400Z
updated_at: 2026-10-23T03:49:39.242573Z
transitions:
- status: in-progress
  at: 2026-10-23T03:49:39.242573Z
---
# 014 · 自动刷新频次可配置

## 背景（2026-10-23 主人要求）

主人原话：「刷新频次调整成可以配置」。真机现状：右栏页**只有手动「刷新」按钮 + 上次刷新时间，没有任何自动轮询**（全仓无 `setInterval`）。本次 = 新增自动刷新 + 频次可配置。

## 需求（EARS）

- REQ-1.1 系统 SHALL 提供自动刷新频次选择，选项固定为 `关闭 / 15 秒 / 30 秒 / 60 秒 / 5 分钟`，**默认关闭**（保持既有行为）。
- REQ-1.2 频次 SHALL 持久化到 profile 插件配置（新增 volatile 字段 `refreshIntervalSec`，数值，`0` = 关闭），刷新页面/重启实例后保持。
- REQ-1.3 选择器 SHALL 位于右栏端口页顶部（与「刷新」按钮并排），改动**立即生效**并落盘。
- REQ-1.4 轮询 SHALL 只在「数据真变化」时重绘：每次拉回快照后与上一次比较（忽略 `refreshedAt` 时间戳），**无变化不 setState**（主人裁定：轮询 + 只在数据变化时重绘）。
- REQ-1.5 轮询失败 SHALL NOT 清空既有页面内容；沿用现有错误展示，并继续按频次重试。
- REQ-1.6 组件卸载 SHALL 清理定时器（无泄漏）。

## 验收

- [ ] A1 默认（`0`）时页面**不发送**任何周期性 `/snapshot` 请求（用假定时器断言零调用）。
- [ ] A2 选 `15` 秒后，15s 到点自动请求一次；配置落盘（profile patch 出现 `refreshIntervalSec: 15`），刷新页面后选择器仍显示 15 秒。
- [ ] A3 数据无变化时**不重绘**（对比 payload 除 `refreshedAt` 外全等 ⇒ setState 调用 0 次）。
- [ ] A4 卸载后定时器被清理（假定时器断言不再触发）。
- [ ] A5 轮询失败时页面不清空、不抛未捕获异常。
- [ ] 回归：`node --test` / `vitest` 全绿；主包预算经主人授权可 +≤200 B，棘轮按实测抬升并补 changelog 留痕。

## 不做

- 不做"可见性暂停"（主人选择的是「轮询 + 只在数据变化时重绘」，不做后台暂停）。
- 不做任意秒数输入（固定五档）。

## 实现痕迹（2026-10-23）

### 落地文件

- 宿主配置：`src/config.ts`（第七个 volatile 字段 `refreshIntervalSec: z.number().volatile()`）、`src/config-read.ts`（现读读者，五档之外 ⇒ `0`）。
- 常驻客户端（主包）：`src/client/settings-pipe.ts`（`SettingsConfigView.refreshIntervalSec` 默认 `0` + `SettingsPatch.refreshIntervalSec` + `writeRefreshInterval` 单键写）。
- chunk：`src/client/refresh.ts`（五档 + 归一化 + 忽略顶层 `refreshedAt` 的稳定快照比较）、`src/client/pane-header.tsx`（选择器）、`src/client/use-auto-refresh.ts`（挂载读频次、定时器、轮询去重、失败保留内容）、`src/client/pane.tsx`（装配，358 行）。`pane.tsx` 为守住单文件 ≤400 行 SHALL 按职责拆出前三个文件，未按行数硬切。
- 测试：`tests/unit/refresh-interval.test.ts`（5 条纯函数/读回/写回）、`tests/client/refresh-interval.test.tsx`（A1–A5，假定时器）。

### 验收状态

- [x] A1 默认关闭：假定时器前进 120s，轮询 0 次、配置写 0 次。
- [ ] A2 选择 15 秒：立即写 `{ refreshIntervalSec: 15 }` 一次；15s 到点轮询 1 次；重挂载后选择器回填 15。⚠️ 后半用测试替身证明「读回同一份配置」，**真实 profile patch 落盘/刷新页面未验**（见下「未做」），故总勾留空。
- [x] A3 数据未变：只改 `refreshedAt` 的轮询 ⇒ React `Profiler` 重绘 **0** 次；数据真变才重绘。
- [x] A4 卸载：卸载后 60s 轮询 0 次（定时器已清）。
- [x] A5 失败：显示既有「读取失败」文案、表格仍在、下一周期继续重试。
- [x] 回归：`node --test` 527/527、`vitest` 18 文件 159 用例、八道门全 exit 0。
- [ ] A2 的真实落盘与真实浏览器交互（需在允许触碰 profile 的环境里补验）。

### 门与读数

- 主包 `lib/client.js`：**49,500 → 49,666 B（+166 B）**，主人授权上限 **+200 B**，未超额；棘轮登记 `49666 / debt / 2026-10-23 / #59`（机器表 + 契约 §P2 + changelog 三处同步）。
- chunk `lib/client.ports.js`：148,301 → **153,709 B**（轮询/选择器/比较全在 chunk）。
- 八道门：`tsc` ×3 exit 0；`node --test` 527/527；`vitest` 18/159；`assert-client-split` 17/0；`check-size` exit 0（去注释 25.5 KB / 40 KB，最大 399 行）；`build-client` 49,666 / 153,709 B。
- 追加门：`verify-client-loader.mjs` 40/0（含 §P2 三判据 + 双重锁 + #59 可追）；`check-exports.mjs` 25/0。

### 未做（如实登记）

- 未在真实浏览器里点选下拉并观察 15 秒轮询；jsdom + 假定时器验的是同一份组件逻辑。
- 未写真实 profile patch、未刷新真实页面验证落盘（本任务明令不碰 `~/.dsh/profiles/*`）。
- **未执行任何 `netsh` / 防火墙 / 提权写入**；本特性全程只读 + 配置写，真机写路径未触碰。
