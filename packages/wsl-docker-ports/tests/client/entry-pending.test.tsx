/**
 * `sidebar-right-pending` 的可见性回归（vitest，**node 环境**：刻意不开 jsdom）
 *
 * ## 这份文件存在的理由（2026-10-09 第二次真机复验）
 *
 * 真机探针事实：插件 `apply` 在 `@1051ms` 时两个宿主服务还是 `undefined`，宿主服务在
 * **`@1317ms`** 到齐、内层 `ctx.inject` **确实 fire**（`tabs=object / sidebar=object`）
 * ⇒ **晚到 ~240 ms 是常态**。而当时的实现在 `apply` 当下就 `console.warn`「尚未注册」
 * ⇒ 每次启动一条假告警 ⇒ **训练人忽略真告警**（真缺陷 C 差点因此查无可修）。
 *
 * 判据（本文件逐条钉死）：
 * 1. 正常启动（服务在数百 ms 内到位）**零 warn**；
 * 2. 只有 pending 超过宽限窗口（缺省 2000ms，可注入）才 warn，且点名缺了谁；
 * 3. 曾 warn 过、之后注册成功 ⇒ 补一条 `console.info` 说明**已解除**（对照）；
 * 4. 真缺服务仍有即时可见手段（`sidebar-right-unavailable` 那条 warn 在 `entry.test.tsx` 里断言）；
 * 5. 插件被拆掉 ⇒ 排定中的告警一并撤销（不留无主 warn）。
 *
 * 时间面**全部注入**（`apply(ctx, { timers })`）：假时钟推进到边界，不 sleep、不等真 2s。
 * 期望的毫秒数写成**契约字面量** `2000`，不从实现里 import 常量（否则断言顺着实现走）。
 *
 * 扩展名 `.tsx` 而非 `.ts`：`test` 脚本里的 `node --test "tests/**\/*.test.ts"` 会抢走 `.test.ts`，
 * 而 `node:test` 里 import vitest 会直接失败 —— 扩展名就是隔离手段。
 */

import { describe, expect, it, vi } from 'vitest';

import * as entry from '../../src/client/index.ts';
import type { ClientContextLike, ClientTimers } from '../../src/client/host.ts';
import type { PortsSnapshot } from '../../src/client/types.ts';
import { CONTAINERS_PAGE_ID, PAGE_ID, TAB_SLOT, TAB_TITLE_SLOT } from '../../src/client/rows.ts';
import { snapshot } from '../unit/client-fixtures.ts';

function source(): { load: () => Promise<PortsSnapshot> } {
  return { load: async () => snapshot({}) };
}

/** `slots` 替身：`register` 记账、`inject` 立即回调（与宿主半的既有测试同形） */
function slotsStub(slotRegistrations: { readonly options: Record<string, unknown>; readonly component: unknown }[]): Record<string, unknown> {
  return {
    register: (options: Record<string, unknown>, component: unknown) => {
      slotRegistrations.push({ options, component });
      return () => undefined;
    },
    inject: (_name: string, callback: () => (() => void) | void) => {
      callback();
      return () => undefined;
    },
  };
}

/** 手动假时钟（`ClientTimers` 是**可注入**的，正是为了让宽限窗口能被确定性测到） */
interface ManualClock {
  readonly timers: ClientTimers;
  /** 依次请求的 `ms`（顺序） */
  readonly requested: number[];
  /** 仍排定中的定时器数 */
  pendingCount: () => number;
  /** 被撤掉的句柄（顺序） */
  readonly cleared: unknown[];
  fireAll: () => void;
}

function manualClock(): ManualClock {
  let handle = 0;
  const live = new Map<number, () => void>();
  const requested: number[] = [];
  const cleared: unknown[] = [];
  return {
    timers: {
      setTimeout: (callback: () => void, ms: number) => {
        handle += 1;
        requested.push(ms);
        live.set(handle, callback);
        return handle;
      },
      clearTimeout: (h: unknown) => {
        cleared.push(h);
        live.delete(h as number);
      },
    },
    requested,
    cleared,
    pendingCount: () => live.size,
    fireAll: () => {
      for (const [key, callback] of [...live]) {
        live.delete(key);
        callback();
      }
    },
  };
}

/** 一个「服务后到」的 ctx：`inject` 只登记不回调（真机时序），服务由用例自己塞进 `services` */
function lateCtx(): {
  readonly ctx: ClientContextLike;
  readonly services: Record<string, unknown>;
  readonly pending: { readonly names: readonly string[]; readonly callback: (scope: ClientContextLike) => void }[];
  readonly effects: (() => void)[];
  readonly tabRegistrations: unknown[];
  readonly slotRegistrations: { readonly options: Record<string, unknown>; readonly component: unknown }[];
} {
  const slotRegistrations: { readonly options: Record<string, unknown>; readonly component: unknown }[] = [];
  const services: Record<string, unknown> = { slots: slotsStub(slotRegistrations) };
  const pending: { readonly names: readonly string[]; readonly callback: (scope: ClientContextLike) => void }[] = [];
  const effects: (() => void)[] = [];
  const tabRegistrations: unknown[] = [];
  const ctx: ClientContextLike = {
    get: (name: string) => services[name],
    inject: (names: readonly string[], callback: (scope: ClientContextLike) => void) => {
      pending.push({ names, callback });
      return () => undefined;
    },
    effect: (callback: () => (() => void) | void) => {
      const disposer = callback();
      if (typeof disposer === 'function') effects.push(disposer);
      return () => undefined;
    },
  };
  return { ctx, services, pending, effects, tabRegistrations, slotRegistrations };
}

/** 服务到位（真机 `@1317ms` 那一刻） */
function arrive(services: Record<string, unknown>, tabRegistrations: unknown[]): void {
  services['sidebarRightTabs'] = {
    register: (definition: unknown) => {
      tabRegistrations.push(definition);
      return () => undefined;
    },
  };
  services['sidebarRight'] = { open: () => undefined };
}

describe('缺陷 C（2026-10-09 真机）：右栏服务**晚到**时也必须在服务到位后注册页', () => {
  /**
   * 旧写法在这一步同步 `softGet` 一次就 `return` ⇒ 紧随其后的 `ctx.inject` 永远执行不到
   * ⇒ 页不出现、零请求、零告警。本用例在旧代码上**红**（`pending` 长度为 0）。
   */
  it('apply 时服务未到 ⇒ 登记惰性注入 + pending（不是「缺失」），且**此刻零 warn**（晚到是常态）', () => {
    const f = lateCtx();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = entry.apply(f.ctx, { source: source() });

      // ① 必须登记了惰性注入 —— 旧代码在同步判空那一步就 return，这里 `pending` 是空的 ⇒ 红
      //    010 T7.3 起多一条 `inject(['settings'])`（配置页关自动表单用）⇒ 按**名字**找，不按序号
      const sidebarPending = f.pending.find((item) => item.names.includes('sidebarRightTabs'));
      expect(sidebarPending?.names).toEqual(['sidebarRightTabs', 'sidebarRight']);
      expect(f.pending.some((item) => item.names.length === 1 && item.names[0] === 'settings')).toBe(true);
      expect(f.tabRegistrations).toHaveLength(0);
      // ② 此刻没注册就如实说「还没注册」（不是「缺失」）
      expect(result.registered).toBe(false);
      if (!result.registered) {
        expect(result.reason).toBe('sidebar-right-pending');
        expect(result.deferred).toBe(true);
        expect(result.missing).toEqual([]);
      }
      // ③ 🔴 正常路径**零 warn**（旧代码：apply 当下就打一条）—— 期望值 0 是判据字面量
      expect(warn.mock.calls.length).toBe(0);
      console.log(`  · apply 当下：注入登记 ${String(f.pending.length)} 次 / warn ${String(warn.mock.calls.length)} 条（判据 = 0）`);
    } finally {
      warn.mockRestore();
    }
  });

  it('① 服务在宽限窗口内到位 ⇒ 零 warn + 撤掉排定的告警，页与两个 seat 自动注册', () => {
    const f = lateCtx();
    const clock = manualClock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      entry.apply(f.ctx, { source: source(), timers: clock.timers });

      // 排定了一个定时器，且毫秒数是**契约字面量 2000**（不从实现里读常量）
      expect(clock.requested).toEqual([2000]);
      expect(clock.pendingCount()).toBe(1);

      // `+240ms`（真机：@1051ms apply ⇒ @1317ms 到齐，远在窗口内）：服务到位 ⇒ 注入回调 fire
      arrive(f.services, f.tabRegistrations);
      f.pending.find((item) => item.names.includes('sidebarRightTabs'))?.callback(f.ctx);

      // 🔴 015 P4 形状变更：两个页（转发 + 容器）
      expect(f.tabRegistrations.map((item) => (item as Record<string, unknown>)['id'])).toEqual([PAGE_ID, CONTAINERS_PAGE_ID]);
      expect(f.slotRegistrations.map((registration) => registration.options['name']).filter((name) => name !== 'plugins.row.config')).toEqual([TAB_SLOT, TAB_TITLE_SLOT, TAB_SLOT, TAB_TITLE_SLOT]);
      expect((f.tabRegistrations[0] as Record<string, unknown>)['kind']).toBe('wslDockerPorts');
      // 告警被撤销（否则窗口到点还会冒一条已经过时的 warn）
      expect(clock.pendingCount()).toBe(0);
      expect(clock.cleared).toHaveLength(1);
      // 窗口内到位 = 零 warn；且**没 warn 过就不该有恢复 info**（没有需要对照的东西）
      expect(warn.mock.calls.length).toBe(0);
      expect(info.mock.calls.length).toBe(0);
      console.log(
        `  · 晚到时序：定时器 ${JSON.stringify(clock.requested)}ms / 撤销 ${String(clock.cleared.length)} 次 / 页定义 ${String(f.tabRegistrations.length)} 个 / seat ${String(f.slotRegistrations.length)} 个 / warn ${String(warn.mock.calls.length)} 条 / info ${String(info.mock.calls.length)} 条`,
      );
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it('① 服务**始终不到** ⇒ 只有超过宽限窗口（2000ms）才打一条可见 warn，且点名缺了谁', () => {
    const f = lateCtx();
    const clock = manualClock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      entry.apply(f.ctx, { source: source(), timers: clock.timers });
      expect(warn.mock.calls.length).toBe(0);

      // 窗口到点（假时钟推进）：仍未 fire ⇒ 这时才 warn，且必须点名两个服务、带上已等毫秒数
      clock.fireAll();
      expect(warn.mock.calls.length).toBe(1);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain('sidebarRightTabs');
      expect(line).toContain('sidebarRight');
      expect(line).toContain('2000ms');
      console.log(`  · 始终不到：窗口内 warn 0 条 ⇒ 超时后 ${String(warn.mock.calls.length)} 条；原文 = ${line}`);
    } finally {
      warn.mockRestore();
    }
  });

  it('① 曾 warn 过、之后服务到位 ⇒ 补一条 info 说明「告警已解除」（对照）', () => {
    const f = lateCtx();
    const clock = manualClock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      entry.apply(f.ctx, { source: source(), timers: clock.timers });
      clock.fireAll();
      expect(warn.mock.calls.length).toBe(1);

      arrive(f.services, f.tabRegistrations);
      f.pending.find((item) => item.names.includes('sidebarRightTabs'))?.callback(f.ctx);

      // 🔴 015 P4 形状变更：两个页（转发 + 容器）
      expect(f.tabRegistrations.map((item) => (item as Record<string, unknown>)['id'])).toEqual([PAGE_ID, CONTAINERS_PAGE_ID]);
      expect(info.mock.calls.length).toBe(1);
      expect(String(info.mock.calls[0]?.[0])).toContain('已解除');
      console.log(`  · 对照：warn ${String(warn.mock.calls.length)} 条后有注册成功 ⇒ info ${String(info.mock.calls.length)} 条；原文 = ${String(info.mock.calls[0]?.[0])}`);
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it('① 插件被拆掉（effect disposer）⇒ 排定中的超时告警一并撤销', () => {
    const f = lateCtx();
    const clock = manualClock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      entry.apply(f.ctx, { source: source(), timers: clock.timers });
      expect(clock.pendingCount()).toBe(1);
      // apply 会挂多个 effect（样式一个 + 右栏页一个）；全部拆掉才算真卸载
      expect(f.effects.length).toBeGreaterThanOrEqual(1);

      for (const dispose of f.effects.splice(0).reverse()) dispose();
      expect(clock.pendingCount()).toBe(0);
      clock.fireAll();
      expect(warn.mock.calls.length).toBe(0);
      console.log(`  · 卸载后：排定中 ${String(clock.pendingCount())} 个 / warn ${String(warn.mock.calls.length)} 条（判据 = 0）`);
    } finally {
      warn.mockRestore();
    }
  });
});
