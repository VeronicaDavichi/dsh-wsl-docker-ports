/**
 * T4.1 客户端入口（REQ-4.1 / REQ-4.4 / REQ-4.5）—— 零 DOM（Node），宿主全部是记账替身。
 *
 * 判据：
 *   ① 导出面**恰好** `{ apply, inject, name }`（宿主 ModuleLoader 只要 `apply`/`inject`；多导出即漂移）；
 *      `inject` = `['slots']`（只放稳定服务：声明了却缺失会让**整个**客户端插件 load 失败）；
 *   ② `apply` 把样式清理 + 页类型 + 2 个 seat 共 **4 次**动作交给 `ctx.effect`，且都带 label；
 *   ③ `apply` 用 `ctx.inject([sidebarRightTabs, sidebarRight], …)` 惰性等待（不是入口 inject）；
 *   ④ 宿主没有 `inject` ⇒ 退化成直接注册（不因缺能力而什么都不做）；
 *   ⑤ 缺服务 ⇒ **不注册** + `console.warn` 出原因（不是静默）+ 不抛（REQ-4.5）；
 *   ⑥ 类型级证据：真 cordis `Context` 上 `effect(cb, label)` / `inject(string[], cb)` 的**调用形态**与
 *      本包一致（编译期钉住）；而 `slots` 等宿主服务**不在** cordis 的 `Context` 上（由宿主包 declaration
 *      merge 提供，本机是悬空 junction 读不到）⇒ 用 `@ts-expect-error` 把这个「类型缺口」也钉住，
 *      不伪造一个假的一致性断言。
 */

import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';

import * as entry from '../../src/client/index.ts';
import { installTerminalStyles, resolveDocument } from '../../src/client/styles.ts';
import { TERMINAL_PANE_SLOT, TERMINAL_TITLE_SLOT } from '../../src/client/tab.ts';
import { createClientCtx } from '../helpers/client-fixtures.ts';

/* 类型级证据（本文件是测试文件，允许 import 宿主 d.ts；`src/**` 里不引 cordis 类型）。
   ⚠️ 放在**永不执行**的函数体里：`declare const` 会被擦除，写在模块顶层会在运行时 `ReferenceError`。 */
export function clientContextCallShape(hostCtx: Context): void {
  // ① 调用形态一致性：两参数 `effect(cb, label)`、`inject(string[], cb)` 都编译得过
  hostCtx.effect(() => () => undefined, 'dsh-terminal-profiles: probe');
  hostCtx.inject(['sidebarRightTabs', 'sidebarRight'], () => undefined);
  // ② 类型缺口证据：宿主服务不在 cordis 的 `Context` 上（若哪天它出现了，这行会因「无错误」而报错）
  // @ts-expect-error 宿主服务 slots 由宿主包 declaration merge 提供，本机读不到 d.ts
  hostCtx.slots;
}

describe('T4.1 入口导出面', () => {
  it('恰好 { apply, inject, name } —— 不导出 default、不导出实现细节', () => {
    expect(Object.keys(entry).sort()).toEqual(['apply', 'inject', 'name']);
    expect('default' in entry).toBe(false);
    expect(typeof entry.apply).toBe('function');
  });

  it('inject = ["slots"]（稳定服务；版本相关的两个服务走 ctx.inject）', () => {
    expect(entry.inject).toEqual(['slots']);
  });
});

describe('T4.1 apply（记账替身）', () => {
  // ⚠️ 2026-10-09 Phase 6（T6.1）起 `apply` 多注册一个**配置页**（`plugins.row.config`）⇒ 效果计数 4 → 5、
  // seat 计数 2 → 3。**不是放松断言**：下面每条都改成新的精确值，并单独拆出配置页那一条。
  it('5 次 ctx.effect（样式 + 页类型 + 2 seat + 配置页）且都带 label', () => {
    const harness = createClientCtx();
    entry.apply(harness.ctx);
    expect(harness.calls.effectLabels).toHaveLength(5);
    expect(
      harness.calls.effectLabels.every(
        (label) => label.startsWith('dsh-terminal-profiles') || label.startsWith('plugins.row.config'),
      ),
    ).toBe(true);
    expect(harness.calls.effectLabels[0]).toContain('styles');
    expect(harness.calls.effectLabels[4]).toBe('plugins.row.config: page');
  });

  it('惰性注入两个右栏服务，并注册 1 个页类型 + 2 个 seat + 1 个配置页槽位', () => {
    const harness = createClientCtx();
    entry.apply(harness.ctx);
    expect(harness.calls.services).toEqual([['sidebarRightTabs', 'sidebarRight']]);
    expect(harness.calls.tabDefinitions).toHaveLength(1);
    expect(
      harness.calls.seats.filter((seat) => seat.name !== 'plugins.row.config').map((seat) => seat.name),
    ).toEqual([TERMINAL_PANE_SLOT, TERMINAL_TITLE_SLOT]);
    expect(harness.calls.seats.filter((seat) => seat.name === 'plugins.row.config')).toHaveLength(1);
    expect(harness.calls.slotInjects).toEqual([TERMINAL_PANE_SLOT, TERMINAL_TITLE_SLOT, 'plugins.row.config']);
  });

  it('unload 后页类型与 seat 全部撤销（REQ-4.4）', () => {
    const harness = createClientCtx();
    entry.apply(harness.ctx);
    harness.unload();
    expect(harness.calls.tabDisposals).toBe(1);
    expect(harness.calls.seatDisposals).toBeGreaterThanOrEqual(4);
  });

  it('宿主没有 inject ⇒ 退化成直接注册（服务齐全时不静默什么都不做）', () => {
    const harness = createClientCtx({ inject: false });
    entry.apply(harness.ctx);
    expect(harness.calls.services).toHaveLength(0);
    expect(harness.calls.tabDefinitions).toHaveLength(1);
    expect(harness.calls.seats).toHaveLength(3);
  });

  it('缺 sidebarRight ⇒ 不注册 + console.warn 出原因 + 不抛（REQ-4.5）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const harness = createClientCtx({ sidebarRight: false });
      expect(() => {
        entry.apply(harness.ctx);
      }).not.toThrow();
      expect(harness.calls.tabDefinitions).toHaveLength(0);
      // 右栏功能整体降级（0 个 seat），但**配置页不受影响**（它只依赖 `slots`）—— 这是 Phase 6 起的新事实
      expect(harness.calls.seats.filter((seat) => seat.name !== 'plugins.row.config')).toHaveLength(0);
      expect(harness.calls.seats.filter((seat) => seat.name === 'plugins.row.config')).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]?.[0] ?? '');
      expect(line).toContain('dsh-terminal-profiles');
      expect(line).toContain('sidebarRight');
      expect(line).toContain('未注册');
    } finally {
      warn.mockRestore();
    }
  });

  it('Node 环境没有 document 也不影响注册（样式降级、右栏照常）', () => {
    const harness = createClientCtx();
    expect(typeof document).toBe('undefined');
    entry.apply(harness.ctx);
    expect(harness.calls.tabDefinitions).toHaveLength(1);
  });
});

describe('T4.2 无 document 的样式降级（本文件是 node 环境 ⇒ 这条才成立）', () => {
  it('resolveDocument() 返回 undefined；installTerminalStyles() ⇒ installed:false + 原因 + dispose 是 no-op', () => {
    expect(resolveDocument()).toBeUndefined();
    const installation = installTerminalStyles();
    expect(installation.installed).toBe(false);
    expect((installation.reason ?? '').includes('document')).toBe(true);
    expect(() => {
      installation.dispose();
    }).not.toThrow();
  });
});
