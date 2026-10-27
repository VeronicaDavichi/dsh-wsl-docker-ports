/**
 * T5.1 入口与降级（vitest，**node 环境**：刻意不开 jsdom）
 *
 * 为什么要单独一个「没有 document」的环境：`apply()` 在无 DOM 时也必须能跑完并给出
 * 判别联合（宿主半的降级口径 REQ-10.3）。样式在无 document 时是**跳过**而不是抛错 ——
 * 这一条只有在真没有 document 的环境里才证得动。
 *
 * 文件扩展名是 `.tsx` 而不是 `.ts`：本包 `test` 脚本里的 `node --test "tests/**\/*.test.ts"`
 * 会抢走 `.test.ts`（`node:test` 里 import vitest 直接失败）。扩展名就是隔离手段。
 *
 * 晚到时序 / 告警可见性的回归在隔壁 `entry-pending.test.tsx`（2026-10-09 第二次真机复验的判据，
 * 拆出去同时是为了守住「单文件 ≤ 400 行」）。
 */

import { describe, expect, it } from 'vitest';

import * as entry from '../../src/client/index.ts';
import type { ClientContextLike } from '../../src/client/host.ts';
import type { PortsSnapshot } from '../../src/client/types.ts';
import { PAGE_ID, PAGE_KIND, TAB_SLOT, TAB_TITLE_SLOT } from '../../src/client/rows.ts';
import { CONFIG_SLOT_NAME } from '../../src/client/config-slot.ts';
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

  it('行 id 与包名**分开**：行 id 是短名（settings 命名空间 / patch 条目 id），模块名才是包名', () => {
    expect(entry.name).toBe('dsh-wsl-docker-ports');
    expect(PAGE_ID).toBe('wsl-ports');
    expect(PAGE_ID).not.toBe(entry.name);
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
    // 🔴 015 P4 形状变更：右栏现在有**两个页**（转发 + 容器）⇒ 注册次数 1 → 2。
    // 016：转发包只注册**自己**那一页（容器页随拆包搬走 ⇒ 这里恒为一条）
  expect(fake.tabRegistrations.map((definition) => (definition as Record<string, unknown>)['id'])).toEqual([PAGE_ID]);
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

describe('② 真机复验缺陷：页类型缺 guide 入口 ⇒ 页存在但用户点不到', () => {
  /**
   * 官方形状（离线实物 `0.1.7-rc.2` `deepseek-ai-dsh-client-ui-sidebar-files-*.tgz`
   * → `package/lib/client.js:22-38`）：
   *
   *     guide: [{ id: "workspace", commandId: "workspace.files", order: 10,
   *               title: () => t("guide.title"), description: () => t("guide.description"),
   *               icon: ... }]
   *
   * 注册表 `refresh()`（`.../sidebar-right/lib/client.js:8845-8849`）会把每条补上 `kind` / `providerId`
   * 并按 `order` 升序排；`GuideBody` 对每条渲染一张卡片，点它走 `openTab(kind, { replaceTab: true })`。
   * ⇒ 没有 `guide` 数组这一项，本页就只能靠程序化 `openTab` 出现（真机复现）。
   */
  it('注册的页定义带 guide[]（官方字段 id/order/title()/description()），且文案是 thunk', () => {
    const fake = fakeCtx();
    entry.apply(fake.ctx, { source: source({ count: 0 }) });
    // 🔴 015 P4 形状变更：两个页定义（转发在前、容器在后），下面只校验**转发页**那条。
    expect(fake.tabRegistrations.map((item) => (item as Record<string, unknown>)['id'])).toEqual([PAGE_ID]);

    const definition = fake.tabRegistrations.find((item) => (item as Record<string, unknown>)['id'] === PAGE_ID) as Record<string, unknown>;
    const guide = definition['guide'] as readonly Record<string, unknown>[] | undefined;
    expect(Array.isArray(guide)).toBe(true);
    expect(guide).toHaveLength(1);
    const pick = guide?.[0] ?? {};
    // 契约字面量：入口 id 与位次是本包声明的稳定值
    // （官方 guide 位次全集 files=10 / terminal=20 / browser=30 ⇒ 本包取 40 排在其后）
    expect(pick['id']).toBe('ports');
    expect(pick['order']).toBe(40);
    // 官方要求 **thunk**（每次使用都重读，换语言无需重注册）⇒ 必须是函数，不能是冻结字符串
    expect(typeof pick['title']).toBe('function');
    expect(typeof pick['description']).toBe('function');
    expect((pick['title'] as () => string)()).toBe('端口转发');
    expect((pick['description'] as () => string)()).toContain('portproxy');
    // `icon` 官方可选（无 icon 时 guide 画占位立方体）⇒ 本包不为此新增运行时 import
    expect(pick['icon']).toBeUndefined();
    // 页类型：不认地址（`patterns` / `canOpen` 都不该出现）
    expect(definition['patterns']).toBeUndefined();
    console.log(`  · 页定义字段 ${JSON.stringify(Object.keys(definition).sort())}；guide 入口 ${JSON.stringify(Object.keys(pick).sort())}；order=${String(pick['order'])}`);
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

    // 010 T7.3：先 `inject(['settings'])`（配置页关自动表单），再登记右栏懒注入
    // 016：本包只有一个配置槽 ⇒ `inject(['settings'])` 只来一次（第二次随容器行搬走）
    expect(fake.injectNames).toEqual([['settings'], ['sidebarRightTabs', 'sidebarRight']]);
    // 🔴 015 P4 形状变更：两个页定义（转发在前）
    expect(fake.tabRegistrations.map((item) => (item as Record<string, unknown>)['id'])).toEqual([PAGE_ID]);
    const definition = fake.tabRegistrations[0] as Record<string, unknown>;
    expect(definition['id']).toBe(PAGE_ID);
    expect(definition['kind']).toBe(PAGE_KIND);
    expect(definition['priority']).toBeUndefined();
    expect(definition['multiple']).toBe(false);
    expect(definition['keepMounted']).toBe(true);
    expect((definition['title'] as (address: string) => string)('x')).toBeTypeOf('string');

    // 两个页内座位 + 010 T7.3 的配置槽（`plugins.row.config`）= 3 次注册
    // 🔴 015 P4 形状变更：2 页 × (2 seat) + 2 个配置槽 = 6 次注册
    // 016：本包只注册**自己**的配置槽 + 两个右栏 seat（容器侧的槽与 seat 随包搬走）
    expect(fake.slotRegistrations).toHaveLength(3);
    const paneSeats = fake.slotRegistrations.filter((registration) => registration.options['name'] !== CONFIG_SLOT_NAME);
    expect(paneSeats.map((registration) => registration.options['name'])).toEqual([TAB_SLOT, TAB_TITLE_SLOT]);
    expect(paneSeats.map((registration) => registration.options['key'])).toEqual([PAGE_ID, PAGE_ID]);
    // 017：配置槽换成**组合包级**（plugins.bundle.config）⇒ key = **包名**（不是行 id）
    expect(CONFIG_SLOT_NAME).toBe('plugins.bundle.config');
    expect(fake.slotRegistrations.filter((registration) => registration.options['name'] === CONFIG_SLOT_NAME).map((registration) => registration.options['key'])).toEqual(['dsh-wsl-docker-ports']);
    expect(fake.slotRegistrations.every((registration) => typeof registration.component === 'function')).toBe(true);
    // 016：样式 / 右栏注册 / 配置槽 —— 只剩本包一条 ⇒ 3 个 effect
    expect(fake.effects).toHaveLength(3);
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
    // 016：本包只有一个页定义
    expect(registrations).toHaveLength(1);
    console.log(`  · 扫了 ${String(registrations.length)} 个页定义（无 inject/effect 的 ctx）`);
  });
});
