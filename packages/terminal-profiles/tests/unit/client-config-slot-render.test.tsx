// @vitest-environment jsdom
/**
 * 007 T6.1 回归门（2026-10-12 真机缺陷）：**经槽位注册拿到的组件，用 React 真渲染后必须有内容**。
 *
 * ## 为什么必须有这个文件（而不是在 `client-config-slot.test.ts` 里加断言）
 *
 * 真机症状是「配置页空白」，而旧的离线用例**全绿** —— 因为它断言的是
 * 「分派函数返回了哪个对象」，而不是「宿主把它渲染成了什么」。两者在真机上分叉：
 *
 *   `plugins.row.config` 是 keyed slot ⇒ 宿主 `SlotErrorBoundary → RootEntry → entry.component(props)`
 *   ⇒ 若 `entry.component(props)` 返回的是**组件函数**（旧实现），React 收到一个 function 子节点，
 *   **不报错、直接当空**（生产构建 0 warning）⇒ 面板空。2026-10-12 探针实例的 fiber 树实测：
 *   分派层已挂载、其下**没有**页面节点，`[data-slot="plugins.row.config"]` 的 innerHTML 恒为 ""。
 *
 * 所以这里 1:1 复刻宿主的渲染口径（`createElement(entry.component, ownerProps)` 作为子节点渲染），
 * 并且**自带一条变异哨兵**：把旧实现（返回组件本身）当场渲染一次，断言它渲染出空面板 ——
 * 这样「这条门真的能杀掉旧实现」不需要靠相信，跑一次就有数字。
 */

import { createElement } from 'react';
import type { ComponentType, ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { registerConfigSlot } from '../../src/client/config-slot.ts';
import { createConfigCtx } from '../helpers/config-fixtures.ts';

afterEach(() => {
  cleanup();
});

const scan = { assertions: 0 };

function expectThat(label: string, actual: unknown, expected: unknown): void {
  scan.assertions += 1;
  expect(actual, label).toStrictEqual(expected);
}

/** 宿主槽位给组件的 props 形状（只列本包认的键） */
interface SlotProps {
  readonly view?: string | undefined;
}

function PageProbe(): ReactElement {
  return <div data-testid="cfg-page-probe">整页</div>;
}

function SummaryProbe(): ReactElement {
  return <span data-testid="cfg-summary-probe">摘要</span>;
}

/** 宿主的渲染口径：`entry.component(ownerProps)` 当成一个普通组件挂到树上 */
function renderThroughSlot(component: unknown, props: SlotProps) {
  const Comp = component as ComponentType<SlotProps>;
  return render(createElement('div', null, createElement(Comp, props)));
}

describe('T6.1 注册路径真渲染（007 空面板回归门）', () => {
  it('`ctx.slots.register` 收到的组件在 React 下真渲染出**整页**内容（view=page）', () => {
    const host = createConfigCtx();
    const result = registerConfigSlot(host.ctx, { page: PageProbe, summary: SummaryProbe });
    expectThat('registered', result.registered, true);
    expectThat('注册数', result.registrations(), 1);
    expectThat('注册到 plugins.row.config', host.calls.seats.map((seat) => seat.name), ['plugins.row.config']);

    const seat = host.calls.seats[0];
    const view = renderThroughSlot(seat?.component, { view: 'page' });

    // 判据一：DOM 里真的出现了页面节点（旧实现这里 `getByTestId` 会抛「找不到」）
    expectThat('页面节点存在', screen.getByTestId('cfg-page-probe') !== null, true);
    // 判据二：整页文本非空（真机判据同形：`[data-slot=…].innerText.length`
    expectThat('渲染出的文本', view.container.textContent, '整页');
    // 判据三：绝不能渲染成摘要那一支
    expectThat('不是摘要', view.container.querySelector('[data-testid="cfg-summary-probe"]'), null);
  });

  it('view=summary ⇒ 只渲染摘要（同一注册物的另一支）', () => {
    const host = createConfigCtx();
    registerConfigSlot(host.ctx, { page: PageProbe, summary: SummaryProbe });
    const view = renderThroughSlot(host.calls.seats[0]?.component, { view: 'summary' });
    expectThat('摘要节点存在', screen.getByTestId('cfg-summary-probe') !== null, true);
    expectThat('渲染出的文本', view.container.textContent, '摘要');
    expectThat('不是整页', view.container.querySelector('[data-testid="cfg-page-probe"]'), null);
  });

  it('🔴 变异哨兵：旧实现（分派函数返回**组件本身**）在同一个 React 下渲染出空面板', () => {
    // 逐字复刻 2026-10-12 之前的写法
    const buggy = (_ownerProps?: SlotProps): unknown => PageProbe;
    const view = renderThroughSlot(buggy, { view: 'page' });
    expectThat('空面板：文本长度 0', view.container.textContent?.length, 0);
    // 而修好的分派函数在同样调用下**不会**为空（同一条渲染路径，两个结果）
    const host = createConfigCtx();
    registerConfigSlot(host.ctx, { page: PageProbe, summary: SummaryProbe });
    const fixed = renderThroughSlot(host.calls.seats[0]?.component, { view: 'page' });
    expectThat('修好后的文本长度 > 0', (fixed.container.textContent?.length ?? 0) > 0, true);
  });
});

describe('扫描面统计（判据自己会说扫了多少）', () => {
  it('打印本次断言数', () => {
    console.log(`[scan] client-config-slot-render：断言 ${scan.assertions} 条`);
    expectThat('断言数 > 0', scan.assertions > 0, true);
  });
});
