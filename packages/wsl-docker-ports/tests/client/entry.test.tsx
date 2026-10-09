/**
 * T5.1 入口与降级（vitest，**node 环境**：刻意不开 jsdom）
 *
 * 为什么要单独一个「没有 document」的环境：`apply()` 在无 DOM 时也必须能跑完并给出
 * 判别联合（宿主半的降级口径 REQ-10.3）。样式在无 document 时是**跳过**而不是抛错 ——
 * 这一条只有在真没有 document 的环境里才证得动。
 *
 * 文件扩展名是 `.tsx` 而不是 `.ts`：本包 `test` 脚本里的 `node --test "tests/**\/*.test.ts"`
 * 会抢走 `.test.ts`（`node:test` 里 import vitest 直接失败）。扩展名就是隔离手段。
 */

import { describe, expect, it, vi } from 'vitest';

import * as entry from '../../src/client/index.ts';
import type { ClientContextLike } from '../../src/client/host.ts';
import type { PortsSnapshot } from '../../src/client/types.ts';
import { PAGE_ID, PAGE_KIND, TAB_SLOT, TAB_TITLE_SLOT } from '../../src/client/rows.ts';
import { snapshot } from '../unit/client-fixtures.ts';

interface FakeCtx {
  readonly ctx: ClientContextLike;
  readonly effects: (() => void)[];
  readonly injectNames: string[][];
  readonly tabRegistrations: unknown[];
  readonly slotRegistrations: { readonly options: Record<string, unknown>; readonly component: unknown }[];
}

function fakeCtx(services: Record<string, unknown> = {}): FakeCtx {
  const effects: (() => void)[] = [];
  const injectNames: string[][] = [];
  const tabRegistrations: unknown[] = [];
  const slotRegistrations: { options: Record<string, unknown>; component: unknown }[] = [];
  const merged: Record<string, unknown> = {
    slots: {
      register: (options: Record<string, unknown>, component: unknown) => {
        slotRegistrations.push({ options, component });
        return () => undefined;
      },
      inject: (_name: string, callback: () => (() => void) | void) => {
        callback();
        return () => undefined;
      },
    },
    sidebarRightTabs: {
      register: (definition: unknown) => {
        tabRegistrations.push(definition);
        return () => undefined;
      },
    },
    sidebarRight: { open: () => undefined },
    ...services,
  };
  const ctx: ClientContextLike = {
    get: (name: string) => merged[name],
    inject: (names: readonly string[], callback: (scope: ClientContextLike) => void) => {
      injectNames.push([...names]);
      callback(ctx);
      return () => undefined;
    },
    effect: (callback: () => (() => void) | void) => {
      const disposer = callback();
      if (typeof disposer === 'function') effects.push(disposer);
      return () => undefined;
    },
  };
  return { ctx, effects, injectNames, tabRegistrations, slotRegistrations };
}

function source(loads: { count: number }): { load: () => Promise<PortsSnapshot> } {
  return {
    load: async () => {
      loads.count += 1;
      return snapshot({});
    },
  };
}

describe('T5.1 客户端入口形状', () => {
  it('没有 default 导出，导出面恰好是 apply / inject / name', () => {
    const keys = Object.keys(entry).sort();
    expect(keys).toEqual(['apply', 'inject', 'name']);
    expect('default' in entry).toBe(false);
    console.log(`  · 扫了 ${String(keys.length)} 个导出：${JSON.stringify(keys)}；default 命中 0 个`);
  });

  it("模块级 inject 恰好是 ['slots']（Cordis 服务名，与清单里的包名数组同名不同物）", () => {
    expect(entry.inject).toEqual(['slots']);
    expect(entry.inject.length).toBe(1);
    console.log(`  · inject = ${JSON.stringify(entry.inject)}`);
  });

  it('行 id 与包名一致（同时是配置命名空间与 patch 条目 id）', () => {
    expect(entry.name).toBe('dsh-wsl-docker-ports');
    expect(PAGE_ID).toBe(entry.name);
    console.log(`  · name = ${entry.name} / pageId = ${PAGE_ID}`);
  });
});

describe('T5.1 降级：缺什么就报什么，且一律不抛异常', () => {
  it('缺 slots ⇒ registered:false / slots-missing', () => {
    const bare: ClientContextLike = {};
    const result = entry.apply(bare, { source: source({ count: 0 }) });
    expect(result.registered).toBe(false);
    if (!result.registered) {
      expect(result.reason).toBe('slots-missing');
      expect(result.missing).toEqual(['slots']);
    }
    console.log(`  · ${JSON.stringify(result)}`);
  });

  it('T6.8 默认取数面 = 自建路由来源 ⇒ 注册（不再是「没接线就不注册」）', () => {
    const fake = fakeCtx();
    const result = entry.apply(fake.ctx);
    expect(result.registered).toBe(true);
    if (result.registered) expect(result.pageId).toBe(PAGE_ID);
    expect(fake.tabRegistrations).toHaveLength(1);
    console.log(`  · 无注入 source 时注册尝试 ${String(fake.tabRegistrations.length)} 次 ⇒ 默认来源就是自建路由`);
  });

  it('T6.8 显式关掉路由来源（routeBaseUrl:null）⇒ registered:false / ports-source-missing，不抛', () => {
    const fake = fakeCtx();
    const result = entry.apply(fake.ctx, { routeBaseUrl: null });
    expect(result.registered).toBe(false);
    if (!result.registered) {
      expect(result.reason).toBe('ports-source-missing');
      expect(result.missing).toEqual(['PortsSource']);
      expect(result.message).toContain('routeBaseUrl');
    }
    expect(fake.tabRegistrations).toHaveLength(0);
    console.log(`  · 注册尝试 ${String(fake.tabRegistrations.length)} 次；${JSON.stringify(result)}`);
  });

  it('T6.8 显式注入 source 优先于自建路由（集成方接管时行为完全可控）', () => {
    const fake = fakeCtx();
    const loads = { count: 0 };
    const result = entry.apply(fake.ctx, { source: source(loads), fetchImpl: () => Promise.reject(new Error('不该被调用')) });
    expect(result.registered).toBe(true);
    expect(loads.count).toBe(0);
    console.log(`  · 注入 source 时扫了 ${String(loads.count)} 次 fetch 记账（开页零请求由 pane 侧断言）`);
  });

  it('缺 sidebarRightTabs / sidebarRight ⇒ 不注册 + 逐个点名缺了谁', () => {
    const loads = { count: 0 };
    for (const missing of ['sidebarRightTabs', 'sidebarRight']) {
      const fake = fakeCtx({ [missing]: undefined });
      const result = entry.apply(fake.ctx, { source: source(loads) });
      expect(result.registered).toBe(false);
      if (!result.registered) {
        expect(result.reason).toBe('sidebar-right-unavailable');
        expect(result.missing).toContain(missing);
        expect(result.message).toContain(missing);
      }
      expect(fake.tabRegistrations).toHaveLength(0);
      expect(loads.count).toBe(0);
      console.log(`  · 缺 ${missing} ⇒ missing=${JSON.stringify(result.registered ? [] : result.missing)}`);
    }
  });
});

describe('缺陷 C（2026-10-09 真机）：右栏服务**晚到**时也必须在服务到位后注册页', () => {
  /**
   * 真机时序：本包模块级 `inject` 只有 `['slots']` ⇒ 本插件 fiber 早早启动；而 `sidebarRightTabs` /
   * `sidebarRight` 由官方 `dsh-client-ui-sidebar-right` 提供（那家自己 inject 了 7 个服务、在 apply
   * **中段**才 provide）⇒ 我们 apply 的时刻它们还没到。
   *
   * 旧写法在这一步同步 `softGet` 一次就 `return` ⇒ 紧随其后的 `ctx.inject` 永远执行不到
   * ⇒ 页不出现、零请求、零告警。本用例在旧代码上**红**（`pending` 长度为 0）。
   */
  it('apply 时服务未到 ⇒ 登记惰性注入 + pending（不是「缺失」），服务到位 ⇒ 页与两个 seat 自动注册', () => {
    const tabRegistrations: unknown[] = [];
    const slotRegistrations: { readonly options: Record<string, unknown>; readonly component: unknown }[] = [];
    const services: Record<string, unknown> = {
      slots: {
        register: (options: Record<string, unknown>, component: unknown) => {
          slotRegistrations.push({ options, component });
          return () => undefined;
        },
        inject: (_name: string, callback: () => (() => void) | void) => {
          callback();
          return () => undefined;
        },
      },
    };
    const pending: { readonly names: readonly string[]; readonly callback: (scope: ClientContextLike) => void }[] = [];
    const ctx: ClientContextLike = {
      get: (name: string) => services[name],
      inject: (names: readonly string[], callback: (scope: ClientContextLike) => void) => {
        pending.push({ names, callback });
        return () => undefined;
      },
      effect: (callback: () => (() => void) | void) => {
        callback();
        return () => undefined;
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = entry.apply(ctx, { source: source({ count: 0 }) });

    // ① 必须登记了惰性注入 —— 旧代码在同步判空那一步就 return，这里 `pending` 是空的 ⇒ 红
    expect(pending).toHaveLength(1);
    expect(pending[0]?.names).toEqual(['sidebarRightTabs', 'sidebarRight']);
    expect(tabRegistrations).toHaveLength(0);
    // ② 此刻没注册就如实说「还没注册」（不是「缺失」）
    expect(result.registered).toBe(false);
    if (!result.registered) {
      expect(result.reason).toBe('sidebar-right-pending');
      expect(result.deferred).toBe(true);
      expect(result.missing).toEqual([]);
    }
    // ③ 可见性：真机那次是 0 warning，缺陷因此查无可查
    expect(warn.mock.calls.length).toBeGreaterThan(0);

    // ④ `+755ms`：两个服务到位 ⇒ 注入回调跑 ⇒ 页定义 + 两个 keyed seat 都注册
    services['sidebarRightTabs'] = {
      register: (definition: unknown) => {
        tabRegistrations.push(definition);
        return () => undefined;
      },
    };
    services['sidebarRight'] = { open: () => undefined };
    pending[0]?.callback(ctx);

    expect(tabRegistrations).toHaveLength(1);
    expect(slotRegistrations.map((registration) => registration.options['name'])).toEqual([TAB_SLOT, TAB_TITLE_SLOT]);
    expect((tabRegistrations[0] as Record<string, unknown>)['id']).toBe(PAGE_ID);
    warn.mockRestore();
    console.log(`  · 晚到时序扫了 ${String(pending.length)} 次注入登记 / ${String(tabRegistrations.length)} 个页定义 / ${String(slotRegistrations.length)} 个 seat；apply 时返回 ${JSON.stringify(result.registered ? 'registered' : result.reason)}`);
  });
});

describe('T5.1 注册形状（contract §C9/§C10）', () => {
  it('成功路径：注册页定义 + 两个 keyed seat，disposer 挂到 ctx.effect', () => {
    const fake = fakeCtx();
    const loads = { count: 0 };
    const result = entry.apply(fake.ctx, { source: source(loads) });

    expect(result.registered).toBe(true);
    if (result.registered) {
      expect(result.pageId).toBe(PAGE_ID);
      expect(result.kind).toBe(PAGE_KIND);
      expect(result.seats).toEqual([TAB_SLOT, TAB_TITLE_SLOT]);
      expect(result.styles).toBe('dsh-wsl-docker-ports/styles');
    }

    expect(fake.injectNames).toEqual([['sidebarRightTabs', 'sidebarRight']]);
    expect(fake.tabRegistrations).toHaveLength(1);
    const definition = fake.tabRegistrations[0] as Record<string, unknown>;
    expect(definition['id']).toBe(PAGE_ID);
    expect(definition['kind']).toBe(PAGE_KIND);
    expect(definition['priority']).toBeUndefined();
    expect(definition['multiple']).toBe(false);
    expect(definition['keepMounted']).toBe(true);
    expect((definition['title'] as (address: string) => string)('x')).toBeTypeOf('string');

    expect(fake.slotRegistrations).toHaveLength(2);
    const seats = fake.slotRegistrations.map((registration) => registration.options['name']);
    expect(seats).toEqual([TAB_SLOT, TAB_TITLE_SLOT]);
    expect(fake.slotRegistrations.every((registration) => registration.options['key'] === PAGE_ID)).toBe(true);
    expect(fake.slotRegistrations.every((registration) => typeof registration.component === 'function')).toBe(true);
    expect(fake.effects).toHaveLength(2);
    console.log(`  · 扫了 ${String(fake.tabRegistrations.length)} 个页定义 / ${String(fake.slotRegistrations.length)} 个 seat / ${String(fake.effects.length)} 个 effect；priority=${JSON.stringify(definition['priority'])}`);
  });

  it('降级版 ctx（没有 inject / effect）也能注册，只是没人自动收编 disposer', () => {
    const registrations: unknown[] = [];
    const bare: ClientContextLike = {
      get: (name: string) =>
        name === 'slots'
          ? { register: () => () => undefined, inject: (_n: string, callback: () => void) => { callback(); return () => undefined; } }
          : name === 'sidebarRightTabs'
            ? { register: (definition: unknown) => { registrations.push(definition); return () => undefined; } }
            : {},
    };
    const result = entry.apply(bare, { source: source({ count: 0 }) });
    expect(result.registered).toBe(true);
    expect(registrations).toHaveLength(1);
    console.log(`  · 扫了 ${String(registrations.length)} 个页定义（无 inject/effect 的 ctx）`);
  });
});
