/**
 * T4.1 右栏页类型 + 两个 keyed seat（REQ-4.1/4.2/4.4/4.5）—— **纯函数 + 记账替身**，零 DOM。
 *
 * 判据（每条都能被一处改动打红）：
 *   ① `buildTabDefinition()` 的形状 = `{id, kind, multiple, keepMounted, title}`，**没有 `priority`**
 *      （留空落宿主默认 `extension` 档，不抢官方 `builtin`）；
 *   ② `kind = managedTerminal` 且**不与官方 9 个 kind 重名**（空集比较不算 ⇒ 同时断言官方名单长度与内容）；
 *   ③ `title(address)` 两个分支（空地址 / 带地址）；
 *   ④ 两个 seat 的 `name` + `key`（key = `definition.id`），且**注册顺序**是「页类型在前」；
 *   ⑤ 每个注册动作都进 `ctx.effect`（带 label）⇒ 宿主卸载后**计数归零**；
 *   ⑥ 降级（缺 `sidebarRightTabs` / `sidebarRight` / `slots`）⇒ 不注册 + 出原因 + 不抛（REQ-4.5）；
 *   ⑦ 页类型重复注册（宿主抛错）**不吞**；seat 注册抛错 ⇒ 已注册的**全部回滚**。
 */

import { describe, expect, it } from 'vitest';

import {
  MANAGED_TERMINAL_KIND,
  OFFICIAL_TAB_KINDS,
  TERMINAL_PANE_SLOT,
  TERMINAL_TAB_ID,
  TERMINAL_TAB_SERVICES,
  TERMINAL_TAB_TITLE,
  TERMINAL_TITLE_SLOT,
  buildSeatRegistrations,
  buildTabDefinition,
  registerTerminalTab,
} from '../../src/client/tab.ts';
import { createClientCtx } from '../helpers/client-fixtures.ts';

const COMPONENTS = { pane: 'PANE', title: 'TITLE' } as const;

describe('T4.1 页类型定义（纯函数）', () => {
  it('形状恰好 {id, kind, multiple, keepMounted, title} —— priority 必须缺省（extension 档）', () => {
    const definition = buildTabDefinition();
    expect(Object.keys(definition).sort()).toEqual(['id', 'keepMounted', 'kind', 'multiple', 'title']);
    expect('priority' in definition).toBe(false);
    expect(definition.id).toBe(TERMINAL_TAB_ID);
    expect(definition.kind).toBe(MANAGED_TERMINAL_KIND);
    expect(definition.multiple).toBe(true);
    expect(definition.keepMounted).toBe(true);
    expect(typeof definition.title).toBe('function');
  });

  it('kind 不与官方 9 个 kind 重名（先证官方名单非空含 terminal，避免空集比较）', () => {
    expect(OFFICIAL_TAB_KINDS).toHaveLength(9);
    expect([...OFFICIAL_TAB_KINDS]).toContain('terminal');
    expect([...OFFICIAL_TAB_KINDS]).not.toContain(MANAGED_TERMINAL_KIND);
    expect(MANAGED_TERMINAL_KIND).not.toBe('terminal');
  });

  it('title(address)：空地址给纯标题，带地址给「标题 · 地址」', () => {
    const { title } = buildTabDefinition();
    expect(title('')).toBe(TERMINAL_TAB_TITLE);
    expect(title('term-1')).toBe(`${TERMINAL_TAB_TITLE} · term-1`);
    expect(title('')).not.toBe(title('term-1'));
  });

  it('两个 keyed seat：name 正确且 key = 页类型 id', () => {
    const seats = buildSeatRegistrations();
    expect(seats).toHaveLength(2);
    expect(seats.map((seat) => seat.name)).toEqual([TERMINAL_PANE_SLOT, TERMINAL_TITLE_SLOT]);
    expect(seats.every((seat) => seat.key === TERMINAL_TAB_ID)).toBe(true);
  });

  it('需惰性注入的服务恰好两个', () => {
    expect([...TERMINAL_TAB_SERVICES]).toEqual(['sidebarRightTabs', 'sidebarRight']);
  });
});

describe('T4.1 注册（记账替身）', () => {
  it('成功路径：1 个页类型 + 2 个 seat，页类型先注册，两个 seat 各包一次 slots.inject', () => {
    const harness = createClientCtx();
    const result = registerTerminalTab(harness.ctx, COMPONENTS);
    expect(result.registered).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.seats).toBe(2);
    expect(harness.calls.tabDefinitions).toHaveLength(1);
    expect(harness.calls.seats.map((seat) => seat.name)).toEqual([TERMINAL_PANE_SLOT, TERMINAL_TITLE_SLOT]);
    expect(harness.calls.seats.map((seat) => seat.key)).toEqual([TERMINAL_TAB_ID, TERMINAL_TAB_ID]);
    expect(harness.calls.slotInjects).toEqual([TERMINAL_PANE_SLOT, TERMINAL_TITLE_SLOT]);
    expect(harness.calls.seatComponents).toEqual([COMPONENTS.pane, COMPONENTS.title]);
    expect(result.registrations()).toBe(3);
  });

  it('每个注册动作都进 ctx.effect（3 次）且都带本包 label', () => {
    const harness = createClientCtx();
    registerTerminalTab(harness.ctx, COMPONENTS);
    expect(harness.calls.effectLabels).toHaveLength(3);
    expect(harness.calls.effectLabels.every((label) => label.startsWith(TERMINAL_TAB_ID))).toBe(true);
    expect(harness.calls.effectLabels[0]).toContain('sidebar tab type');
  });

  it('宿主卸载（unload）后：注册计数归零、页类型撤销 1 次、seat 清理 ≥2 次', () => {
    const harness = createClientCtx();
    const result = registerTerminalTab(harness.ctx, COMPONENTS);
    harness.unload();
    expect(result.registrations()).toBe(0);
    expect(harness.calls.tabDisposals).toBe(1);
    expect(harness.calls.seatDisposals).toBeGreaterThanOrEqual(2);
  });

  it('dispose 幂等：手动调两次也只撤销一轮', () => {
    const harness = createClientCtx();
    const result = registerTerminalTab(harness.ctx, COMPONENTS);
    result.dispose();
    result.dispose();
    expect(harness.calls.tabDisposals).toBe(1);
    expect(result.registrations()).toBe(0);
  });

  it('inject 与 register 两层返回的清理器都被收（卸载时各跑一次）', () => {
    const harness = createClientCtx({ injectReturnsDisposer: true, registerReturnsDisposer: true });
    registerTerminalTab(harness.ctx, COMPONENTS);
    harness.unload();
    expect(harness.calls.slotInjectDisposals).toBe(2);
  });

  it('两层都不返回清理器时也不崩（卸载只是没有可撤的东西）', () => {
    const harness = createClientCtx({ injectReturnsDisposer: false, registerReturnsDisposer: false });
    const result = registerTerminalTab(harness.ctx, COMPONENTS);
    expect(result.registered).toBe(true);
    expect(() => {
      harness.unload();
    }).not.toThrow();
  });

  it('宿主没有 effect ⇒ 就地注册（不因缺清理能力而拒绝注册）', () => {
    const harness = createClientCtx({ effect: false });
    const result = registerTerminalTab(harness.ctx, COMPONENTS);
    expect(result.registered).toBe(true);
    expect(harness.calls.effectLabels).toHaveLength(0);
    expect(harness.calls.tabDefinitions).toHaveLength(1);
    expect(harness.calls.seats).toHaveLength(2);
  });

  it('页类型重复注册：宿主的重复 id 异常**必须**抛出来（不吞）', () => {
    const harness = createClientCtx({ duplicateTabId: true });
    expect(() => registerTerminalTab(harness.ctx, COMPONENTS)).toThrow(/duplicate tab id/u);
    expect(harness.calls.seats).toHaveLength(0);
  });

  it('第二个 seat 注册失败 ⇒ 抛错且第一个 seat + 页类型的清理都跑（不留半注册）', () => {
    const harness = createClientCtx({ failSeatAt: 2 });
    expect(() => registerTerminalTab(harness.ctx, COMPONENTS)).toThrow(/已回滚/u);
    expect(harness.calls.seats).toHaveLength(2);
    expect(harness.calls.tabDisposals).toBe(1);
    expect(harness.calls.seatDisposals).toBeGreaterThanOrEqual(1);
  });
});

describe('T4.1 降级（REQ-4.5）：缺服务只降级，不抛', () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly options: Parameters<typeof createClientCtx>[0] }> = [
    { name: '缺 sidebarRightTabs', options: { sidebarRightTabs: false } },
    { name: '缺 sidebarRight', options: { sidebarRight: false } },
    { name: '缺 slots', options: { slots: false } },
  ];

  for (const item of cases) {
    it(`${item.name} ⇒ registered=false、reason 非空、零注册动作、不抛`, () => {
      const harness = createClientCtx(item.options);
      const result = registerTerminalTab(harness.ctx, COMPONENTS);
      expect(result.registered).toBe(false);
      expect(typeof result.reason).toBe('string');
      expect((result.reason ?? '').length).toBeGreaterThan(10);
      expect(result.seats).toBe(0);
      expect(result.registrations()).toBe(0);
      expect(harness.calls.tabDefinitions).toHaveLength(0);
      expect(harness.calls.seats).toHaveLength(0);
      expect(harness.calls.effectLabels).toHaveLength(0);
    });
  }
});
