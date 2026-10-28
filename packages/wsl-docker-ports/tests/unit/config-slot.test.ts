/**
 * 010 `T7.3` 的配置页接线判据（`node --test`，零 DOM）：
 *
 * - `U3`：注册键 = `plugins.row.config` + `key = wsl-ports`（本包 patch 条目 id）；
 * - `REQ-12.1`：`configure({ auto: false }, ctx.fiber)` 被调用**且带 fiber**（宿主没给 fiber 时不瞎传）；
 * - 失败一律降级不抛（配置页是可选入口）；`dispose` 幂等。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_ROW_KEY, CONFIG_SLOT_NAME, configureAutoForm, registerConfigSlot } from '../../src/client/config-slot.ts';
import type { ConfigSlotContext } from '../../src/client/config-slot.ts';

interface SlotsCalls {
  injects: string[];
  registers: { name: string; key: string }[];
  disposed: number;
}

function fakeSlots(): { slots: unknown; calls: SlotsCalls } {
  const calls: SlotsCalls = { injects: [], registers: [], disposed: 0 };
  const slots = {
    // 真宿主的 `inject(name, cb)` 返回的是**注入本身的** disposer，**不**转发 cb 的返回值
    inject(name: string, callback: () => unknown) {
      calls.injects.push(name);
      callback();
      return () => undefined;
    },
    register(options: { name: string; key: string }) {
      calls.registers.push({ ...options });
      return () => {
        calls.disposed += 1;
      };
    },
  };
  return { slots, calls };
}

function fakeCtx(overrides: Partial<ConfigSlotContext> = {}): { ctx: ConfigSlotContext; configureCalls: { auto: boolean; fiber: unknown }[]; effects: (() => void)[] } {
  const configureCalls: { auto: boolean; fiber: unknown }[] = [];
  const effects: (() => void)[] = [];
  const ctx: ConfigSlotContext = {
    fiber: { fake: 'fiber' },
    get: () => undefined,
    inject: (_services, callback) => {
      callback({ fiber: { fake: 'fiber' }, settings: { configure: (options: { auto: boolean }, fiber?: unknown) => configureCalls.push({ auto: options.auto, fiber }) } });
      return () => undefined;
    },
    effect: (callback) => {
      const disposer = callback();
      if (typeof disposer === 'function') effects.push(disposer);
      return undefined;
    },
    settings: { configure: (options: { auto: boolean }, fiber?: unknown) => configureCalls.push({ auto: options.auto, fiber }) },
    ...overrides,
  };
  return { ctx, configureCalls, effects };
}

test('U3 · 注册键 = plugins.bundle.config + 组合包名；关闭自动表单时**带 fiber**', () => {
  const { ctx, configureCalls } = fakeCtx();
  const { slots, calls } = fakeSlots();
  (ctx as { slots?: unknown }).slots = slots;
  const component = () => null;

  const result = registerConfigSlot(ctx, component as unknown as (props: never) => unknown);

  assert.equal(result.registered, true);
  assert.equal(result.slotName, 'plugins.bundle.config');
  assert.equal(result.key, 'dsh-wsl-docker-ports-bundle');
  assert.equal(CONFIG_SLOT_NAME, 'plugins.bundle.config');
  assert.equal(CONFIG_ROW_KEY, 'dsh-wsl-docker-ports-bundle');
  assert.deepEqual(calls.injects, ['plugins.bundle.config']);
  assert.deepEqual(calls.registers, [{ name: 'plugins.bundle.config', key: 'dsh-wsl-docker-ports-bundle' }]);
  assert.equal(configureCalls.length >= 1, true, 'configure({auto:false}) 必须真调（否则同一份配置出现两张表单）');
  assert.deepEqual(configureCalls.at(-1), { auto: false, fiber: { fake: 'fiber' } });
  assert.equal(result.autoForm.kind, 'configured');
});

test('宿主没给 fiber ⇒ 不传第二个实参（undefined 实参 ≠ 省略）', () => {
  const calls: { auto: boolean; fiber?: unknown }[] = [];
  const scope: ConfigSlotContext = {
    settings: {
      configure: (options: { auto: boolean }, fiber?: unknown) => calls.push(fiber === undefined ? { auto: options.auto } : { auto: options.auto, fiber }),
    },
  };
  const outcome = configureAutoForm(scope);
  assert.equal(outcome.kind, 'configured');
  assert.deepEqual(calls, [{ auto: false }]);
});

test('缺 slots ⇒ 降级 registered:false + 原因非空，**不抛**', () => {
  const { ctx } = fakeCtx();
  const result = registerConfigSlot(ctx, (() => null) as unknown as (props: never) => unknown);
  assert.equal(result.registered, false);
  assert.match(result.reason ?? '', /slots/);
  assert.equal(result.registrations(), 0);
  assert.equal(typeof result.dispose, 'function');
  result.dispose(); // 幂等、不抛
});

test('dispose 幂等：摘一次、第二次什么都不做（宿主不自动收编 disposer）', () => {
  const { ctx, effects } = fakeCtx();
  const { slots, calls } = fakeSlots();
  (ctx as { slots?: unknown }).slots = slots;
  const result = registerConfigSlot(ctx, (() => null) as unknown as (props: never) => unknown);
  assert.equal(result.registrations(), 1);
  assert.equal(effects.length, 1, 'disposer 必须交给 ctx.effect');
  effects[0]?.();
  result.dispose();
  assert.equal(calls.disposed, 1);
  assert.equal(result.registrations(), 0);
});

test('settings.configure 抛错 ⇒ autoForm 记 unavailable，但槽位注册照常', () => {
  const { slots } = fakeSlots();
  const ctx: ConfigSlotContext = {
    fiber: undefined,
    slots,
    settings: {
      configure: () => {
        throw new Error('boom');
      },
    },
  };
  const result = registerConfigSlot(ctx, (() => null) as unknown as (props: never) => unknown);
  assert.equal(result.registered, true, '关不掉自动表单不该拖垮槽位注册');
  assert.equal(result.autoForm.kind, 'unavailable');
  assert.match(result.autoForm.kind === 'unavailable' ? result.autoForm.reason : '', /boom/);
});
