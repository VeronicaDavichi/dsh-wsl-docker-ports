/**
 * 002 T6.1：配置页接线（`src/client/config-slot.ts`）—— 槽位注册 + 关自动表单。
 *
 * 判据要点（每条都能被一个变异杀死）：
 *   - 注册 key **逐字**是 `<包名>#<行 id>`，槽位名逐字 `plugins.row.config`；
 *   - 宿主**没有**这个槽位 ⇒ 不注册、不抛、原因非空（「不拖垮启动」）；
 *   - `configure({ auto: false }, ctx.fiber)` 的**实参个数与内容**都被钉住（REQ-10.1 逐字）；
 *   - `configure` 抛错 / 缺服务 ⇒ 页面**照常注册**（关不掉自动表单不该弄丢配置页）。
 */

import { describe, expect, it } from 'vitest';

import { registerConfigSlot, buildConfigComponent, configureAutoForm } from '../../src/client/config-slot.ts';
import { CONFIG_ROW_KEY, CONFIG_SLOT_NAME } from '../../src/client/config-pipe.ts';
import type { ClientContextLike } from '../../src/client/tab.ts';
import { createConfigCtx } from '../helpers/config-fixtures.ts';

const scan = { assertions: 0 };

function expectThat(label: string, actual: unknown, expected: unknown): void {
  scan.assertions += 1;
  expect(actual, label).toStrictEqual(expected);
}

const PAGE = { kind: 'page' };
const SUMMARY = { kind: 'summary' };

describe('T6.1 视图分派（ownerProps.view）', () => {
  it('view=summary ⇒ 摘要；其余（含 undefined / 未知值）⇒ 整页', () => {
    const pick = buildConfigComponent({ page: PAGE, summary: SUMMARY });
    expectThat('summary', pick({ view: 'summary' }), SUMMARY);
    expectThat('undefined', pick(undefined), PAGE);
    expectThat('为空对象', pick({}), PAGE);
    expectThat('未知 view', pick({ view: 'full' }), PAGE);
  });
});

describe('T6.1 槽位注册（REQ-10.1 / contract §C10）', () => {
  it('注册实参逐字：槽位名 plugins.row.config + key <包名>#<行 id>', () => {
    const host = createConfigCtx();
    const result = registerConfigSlot(host.ctx, { page: PAGE, summary: SUMMARY });
    expectThat('registered', result.registered, true);
    expectThat('slotInjects', host.calls.slotInjects, [CONFIG_SLOT_NAME]);
    expectThat('seats', host.calls.seats.map((seat) => ({ name: seat.name, key: seat.key })), [
      { name: 'plugins.row.config', key: CONFIG_ROW_KEY },
    ]);
    expectThat('key 逐字', CONFIG_ROW_KEY, 'dsh-terminal-profiles#dsh-terminal-profiles');
    expectThat('注册的动作挂在 ctx.effect 上', host.calls.effectLabels, ['plugins.row.config: page']);
    expectThat('注册数', result.registrations(), 1);
    result.dispose();
    expectThat('dispose 后注册数', result.registrations(), 0);
    expectThat('dispose 真的撤销了宿主注册', host.calls.seatDisposals > 0, true);
  });

  it('宿主没有 slots ⇒ 不注册、不抛、原因非空（「不拖垮启动」）', () => {
    const host = createConfigCtx({ slots: false });
    let error: unknown;
    let result: ReturnType<typeof registerConfigSlot> | undefined;
    try {
      result = registerConfigSlot(host.ctx, { page: PAGE, summary: SUMMARY });
    } catch (thrown) {
      error = thrown;
    }
    expectThat('不抛', error, undefined);
    expectThat('registered', result?.registered, false);
    expectThat('注册数 0', result?.registrations(), 0);
    expectThat('原因非空', (result?.reason ?? '').includes('slots'), true);
  });

  it('宿主 slots.register 抛错 ⇒ 降级并带上原因（不把异常扔进宿主启动流程）', () => {
    const host = createConfigCtx({ registerThrows: new Error('duplicate plugins.row.config') });
    const result = registerConfigSlot(host.ctx, { page: PAGE, summary: SUMMARY });
    expectThat('registered', result.registered, false);
    expectThat('原因含宿主原文', (result.reason ?? '').includes('duplicate plugins.row.config'), true);
    expectThat('注册数 0', result.registrations(), 0);
  });

  it('注册动作由 ctx.effect 收编（卸载后自动撤销；宿主不自动回收 disposer）', () => {
    const host = createConfigCtx();
    registerConfigSlot(host.ctx, { page: PAGE, summary: SUMMARY });
    host.unload();
    expectThat('卸载触发了宿主侧撤销', host.calls.seatDisposals >= 1, true);
  });

  it('没有 ctx.effect 的宿主 ⇒ 就地注册（不因为缺清理能力而放弃整个页面）', () => {
    const host = createConfigCtx({ effect: false });
    const result = registerConfigSlot(host.ctx, { page: PAGE, summary: SUMMARY });
    expectThat('registered', result.registered, true);
    expectThat('仍然注册了槽位', host.calls.seats.length, 1);
  });
});

describe('T6.1 关掉宿主自动表单（REQ-10.1 逐字：configure({ auto: false }, ctx.fiber)）', () => {
  it('实参逐字：{ auto: false } + ctx.fiber（**两个**实参）', () => {
    const host = createConfigCtx();
    const result = configureAutoForm(host.ctx);
    expectThat('kind', result.kind, 'configured');
    expectThat('调用次数', host.settingsForm.calls.length, 1);
    expectThat('第一参', host.settingsForm.calls[0]?.options, { auto: false });
    expectThat('第二参 = ctx.fiber', host.settingsForm.calls[0]?.fiber, host.ctx.fiber);
    expectThat('实参个数', host.settingsForm.calls[0]?.argCount, 2);
  });

  it('宿主没有 fiber ⇒ 只传一个实参（`undefined` 实参并不等价于省略）', () => {
    const host = createConfigCtx({ fiber: false });
    configureAutoForm(host.ctx);
    expectThat('实参个数', host.settingsForm.calls[0]?.argCount, 1);
    expectThat('第一参', host.settingsForm.calls[0]?.options, { auto: false });
  });

  it('惰性 inject（服务晚到）⇒ deferred，而不是假装失败', () => {
    const host = createConfigCtx({ lazyInject: true });
    const result = configureAutoForm(host.ctx);
    expectThat('kind', result.kind, 'deferred');
    expectThat('没有同步调用', host.settingsForm.calls.length, 0);
  });

  it('缺 settings ⇒ unavailable + 原因（页面照常注册）', () => {
    const host = createConfigCtx({ settings: false, get: false });
    const result = configureAutoForm(host.ctx);
    expectThat('kind', result.kind, 'unavailable');
    expectThat('原因提到 settings', (result.kind === 'unavailable' ? result.reason : '').includes('settings'), true);

    const slot = registerConfigSlot(host.ctx, { page: PAGE, summary: SUMMARY });
    expectThat('配置页仍然注册', slot.registered, true);
  });

  it('configure 抛错 ⇒ unavailable（不往外扔），配置页照常注册', () => {
    const host = createConfigCtx();
    const throwing = {
      configure() {
        throw new Error('settings service disposed');
      },
    };
    // ⚠️ 直接铺 `{ ...host.ctx, settings: throwing }` **测不到**：惰性注入把回调交给 `scope`，
    // 而 scope 是替身自己造的另一个对象（它的 `settings` 是好的那份）。要真的喂坏服务，
    // 必须让 `inject` 回调**回到这个 ctx 自己**（`get` 是唯一取服务口）。
    const ctx: ClientContextLike = {
      slots: host.ctx.slots,
      effect: host.ctx.effect,
      get: (name) => (name === 'settings' ? throwing : undefined),
      inject: (_services, callback) => callback(ctx),
    };
    const result = configureAutoForm(ctx);
    expectThat('kind', result.kind, 'unavailable');
    expectThat(
      '原因含宿主原文',
      (result.kind === 'unavailable' ? result.reason : '').includes('settings service disposed'),
      true,
    );

    const slot = registerConfigSlot(ctx, { page: PAGE, summary: SUMMARY });
    expectThat('配置页仍然注册', slot.registered, true);
    expectThat('autoForm 结果一并带出', slot.autoForm.kind, 'unavailable');
  });
});

describe('扫描面统计（判据自己会说扫了多少）', () => {
  it('打印本次断言数', () => {
    console.log(`[scan] client-config-slot：断言 ${scan.assertions} 条`);
    expectThat('断言数 > 0', scan.assertions > 0, true);
  });
});
