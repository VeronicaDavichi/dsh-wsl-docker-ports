/**
 * 002 缺陷「**同步 pending 告警**」的回归门 + 变异哨兵（2026-10-12）。
 *
 * ## 复现（旧源码：本文件判据 ① **必红**）
 *
 * 触发条件 = `createClientCtx({ inject: 'deferred' })` —— 即真机时序：`apply` 那一刻两个服务都还不在，
 * `ctx.inject` 只登记回调，等宿主服务到位才跑（2026-10-09 探针实测 **~240 ms** 后到位并注册成功）。
 * 旧源码在 `apply` **末尾同步**判 `injectFired` 并打 warn ⇒ 原文输出（本文件判据 ④ 的逐字复刻，
 * 同一条 `console.warn` 通道）：
 *
 *   `[dsh-terminal-profiles] 右栏页尚未注册：已登记 ctx.inject([sidebarRightTabs, sidebarRight]) 等待宿主服务（不是失败）`
 *
 * ## 判定：**不是误报，是打在正常路径上的噪声**
 *
 * 文案与事实一致（那一刻确实「尚未注册」「已登记」「不是失败」）⇒ **不能**叫误报；但宿主服务**随后必到**
 * ⇒ 每次正常启动都响一条 warn，等于训练人忽略真告警；当天它还被误当成「`register()` **从未运行**」的
 * **证据**（那是**误读**：真机服务 ~240 ms 后就到位、页也注册成功了）。⇒ 判定 **多余**，按
 * `specs/007-terminal-config-page/tasks.md` 的待办指针收窄为「宽限期后才响」。
 *
 * ## 修法（**不动注入语义**）
 *
 * `src/client/index.ts`：同步 warn → `setTimeout(PENDING_WARN_GRACE_MS = 2000)`**排定**一条超时才响的
 * 告警；`register` 一跑就 `cancelPendingWarn()`（服务到位 ⇒ 告警作废）；宿主卸载经同一条路撤除
 * （不留**无主** warn）。同族写法：`packages/wsl-docker-ports/src/client/index.ts` 的 `schedulePendingWarn()`。
 *
 * ## 判据（4 条，全部可二值判定）
 *
 * ① 正常路径（服务随后到位）：宽限期内到位 ⇒ **零 warn**，且页/seat/配置页照旧注册（注入语义一字未改）；
 * ② 回调始终不跑：宽限期前 **0 warn**、到点后**恰好 1 条** warn（可见性没丢，且与 `report()` 的
 *    「确证缺失」文案可区分）；再走远也不复响（定时器不复排）；
 * ③ 卸载先于宽限期：那条无主告警被撤除（拆插件后不再冒）；
 * ④ **变异哨兵**：把旧形态那一行逐字挂在**同一场景**上 ⇒ 判据 ① 的 `not.toHaveBeenCalled()` 当场为假
 *    （证明本门确实能杀掉旧实现，不是假绿）；另有源码级变异实测（报告里附原文输出）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as entry from '../../src/client/index.ts';
import { TERMINAL_PANE_SLOT, TERMINAL_TITLE_SLOT } from '../../src/client/tab.ts';
import { createClientCtx } from '../helpers/client-fixtures.ts';

/** 契约字面量：宽限期（`src` 不导出它 —— 客户端入口的导出面恰好 `{ apply, inject, name }`） */
const GRACE_MS = 2000;
const TAG = '[dsh-terminal-profiles]';
/** 真机上宿主服务到位的实测延时（2026-10-09 探针：~240 ms） */
const REAL_HOST_ARRIVAL_MS = 240;

/** 装上 warn 记录器（返回值里同时给「原始行」读取与还原） */
function spyWarn(): { lines: () => string[]; restore: () => void } {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return {
    lines: () => warn.mock.calls.map((call) => String(call[0] ?? '')),
    restore: () => warn.mockRestore(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('002 同步 pending 告警 ⇒ 宽限期告警（正常启动零 warn）', () => {
  it('① 真机时序（服务 240ms 后到位）⇒ **零 warn**，且页/seat/配置页照旧注册', () => {
    const w = spyWarn();
    try {
      const harness = createClientCtx({ inject: 'deferred' }); // 真机时序：服务后到
      entry.apply(harness.ctx);

      expect(harness.injectPending()).toBe(1);
      expect(harness.calls.tabDefinitions).toHaveLength(0); // 此刻确实没注册（不谎报）
      expect(w.lines()).toEqual([]); // ← 旧形态（同步 warn）在这一行就已经响了

      vi.advanceTimersByTime(REAL_HOST_ARRIVAL_MS); // 「宿主服务到位」
      harness.fireInject();
      expect(harness.calls.tabDefinitions).toHaveLength(1);
      expect(harness.calls.seats).toHaveLength(3);
      expect(harness.calls.slotInjects).toEqual([TERMINAL_PANE_SLOT, TERMINAL_TITLE_SLOT, 'plugins.row.config']);

      vi.advanceTimersByTime(GRACE_MS * 5); // 宽限期过去**远**超过
      expect(w.lines()).toEqual([]); // 正常路径：排定项已被 register 撤掉 ⇒ 到点也不响
      harness.unload();
    } finally {
      w.restore();
    }
  });

  it('② 回调始终不跑 ⇒ 宽限期前 0 warn、到点后**恰好 1 条**（可见性没丢），再走远不复响', () => {
    const w = spyWarn();
    try {
      const harness = createClientCtx({ inject: 'deferred' });
      entry.apply(harness.ctx);

      vi.advanceTimersByTime(GRACE_MS - 1);
      expect(w.lines()).toEqual([]); // 宽限期内不许响

      vi.advanceTimersByTime(1);
      const lines = w.lines();
      expect(lines).toHaveLength(1);
      const line = lines[0] ?? '';
      expect(line).toContain(TAG);
      expect(line).toContain('等待超时'); // 与 report() 的「…未注册：<原因>」可区分
      expect(line).toContain('sidebarRightTabs');
      expect(line).toContain('不是失败');

      vi.advanceTimersByTime(GRACE_MS * 10);
      expect(w.lines()).toHaveLength(1); // 定时器不复排 ⇒ 不会刷屏
      harness.unload();
    } finally {
      w.restore();
    }
  });

  it('③ 卸载先于宽限期 ⇒ 那条无主告警被撤除（拆插件后不再冒）', () => {
    const w = spyWarn();
    try {
      const harness = createClientCtx({ inject: 'deferred' });
      entry.apply(harness.ctx);
      harness.unload(); // ctx.effect 的那一条（样式 + pending 告警一起撤）
      vi.advanceTimersByTime(GRACE_MS * 5);
      expect(w.lines()).toEqual([]);
    } finally {
      w.restore();
    }
  });
});

describe('🔴 变异哨兵：旧形态（apply 末尾同步判 injectFired）在判据 ① 下当场判错', () => {
  it('④ 同一场景 + 旧那一行 ⇒ 判据 ① 的 `not.toHaveBeenCalled()` 立刻为假', () => {
    const w = spyWarn();
    try {
      const harness = createClientCtx({ inject: 'deferred' });
      entry.apply(harness.ctx); // 新形态：只排定宽限期告警
      expect(w.lines()).toEqual([]); // 新形态过关

      // 旧形态那一行（逐字；旧源码在 `ctx.inject(...)` 之后就是 `if (!injectFired) console.warn(...)`）
      const injectFiredAtApplyEnd = false; // 旧源码那一刻的 `injectFired`（服务后到 ⇒ 必为 false）
      if (!injectFiredAtApplyEnd) {
        console.warn(
          `${TAG} 右栏页尚未注册：已登记 ctx.inject([sidebarRightTabs, sidebarRight]) 等待宿主服务（不是失败）`,
        );
      }
      const oldLines = w.lines();
      expect(oldLines).toHaveLength(1); // ⇒ 判据 ① 对旧形态**必红**
      expect(oldLines[0]).toContain('尚未注册');
      console.log(`[sentinel] 旧形态（同步 pending 告警）原文输出：${oldLines[0] ?? ''}`);
      harness.unload();
    } finally {
      w.restore();
    }
  });
});
