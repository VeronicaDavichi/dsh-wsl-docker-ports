/**
 * 007/002 缺陷 B 回归门（2026-10-12 真机）：**页类型必须有用户可发现的空态入口（`guide`）**。
 *
 * ## 为什么必须单独一条门（而不是在 `client-tab.test.ts` 里加断言）
 *
 * 真机症状是「页存在、但用户点不到」：`openTab('managedTerminal')` 真能加出标签
 * （`<span data-testid="term-title">` + 真面板 `<div data-testid="term-pane">`），
 * 而右栏**开始页**只列「工作区文件 / 新建终端」—— 因为 `buildTabDefinition()` 没带 `guide`。
 * 旧用例**全绿**（它只断言 `{id, kind, multiple, keepMounted, title}` 这几个键），
 * 两者在真机上分叉 ⇒ 判据必须是「guide 入口存在且形状像官方」，不是「定义对象长得对」。
 *
 * ## 判据（每条都能被一处改动打红）
 *
 * - `guide` 存在、恰好 1 条，字段 = `{id, order, title, description}`，四个值都非空；
 * - 文案是 **thunk**（官方每次使用都重读）⇒ `title()` / `description()` 返回字符串；
 * - `order` **必须大于官方全部位次**（files=10 / terminal=20 / browser=30 ⇒ > 30）：
 *   第三方位次不该去挤官方的档（重复值虽合法但会退化）。
 *
 * ## 🔴 变异哨兵（本文件的重点）
 *
 * 逐字复刻**修复前**的 `buildTabDefinition()`（没有 `guide`），用**同一个**判据函数当场判一次
 * ⇒ 断言它**违反**判据（拿到具体的 violation 文案）。于是「这条门真能杀掉旧实现」跑一次就有数字，
 * 不需要靠相信。
 */

import { describe, expect, it } from 'vitest';

import {
  TERMINAL_GUIDE_ENTRY_DESCRIPTION,
  TERMINAL_GUIDE_ENTRY_ID,
  TERMINAL_GUIDE_ENTRY_ORDER,
  TERMINAL_GUIDE_ENTRY_TITLE,
  buildTabDefinition,
  registerTerminalTab,
} from '../../src/client/tab.ts';
import type { SidebarRightTabDefinitionLike } from '../../src/client/tab.ts';
import { createClientCtx } from '../helpers/client-fixtures.ts';

const scan = { assertions: 0 };

function expectThat(label: string, actual: unknown, expected: unknown): void {
  scan.assertions += 1;
  expect(actual, label).toStrictEqual(expected);
}

/** 官方 guide 位次全集（003 的注释逐字引过：files=10 / terminal=20 / browser=30） */
const OFFICIAL_GUIDE_ORDERS = [10, 20, 30] as const;

/**
 * **判据本体**（页面/宿主看到的那一面）。返回违反项文案；空数组 = 通过。
 * 抽成纯函数就是为了让变异哨兵能拿**同一份判据**去判旧实现。
 */
export function guideViolations(definition: SidebarRightTabDefinitionLike): readonly string[] {
  const violations: string[] = [];
  const guide = definition.guide;
  if (guide === undefined || guide.length === 0) {
    violations.push('页类型没有 guide ⇒ 右栏开始页里没有入口，用户点不到（缺陷 B 的真机症状）');
    return violations;
  }
  if (guide.length !== 1) violations.push(`guide 应有 1 条，实际 ${String(guide.length)} 条`);
  for (const [index, entry] of guide.entries()) {
    if (typeof entry.id !== 'string' || entry.id.trim() === '') violations.push(`guide[${String(index)}].id 为空`);
    if (typeof entry.title !== 'function') violations.push(`guide[${String(index)}].title 必须是 thunk`);
    else if (entry.title().trim() === '') violations.push(`guide[${String(index)}].title() 为空`);
    if (typeof entry.description !== 'function') violations.push(`guide[${String(index)}].description 必须是 thunk`);
    else if (entry.description().trim() === '') violations.push(`guide[${String(index)}].description() 为空`);
    if (typeof entry.order !== 'number') violations.push(`guide[${String(index)}].order 必须是数字`);
    else if (entry.order <= Math.max(...OFFICIAL_GUIDE_ORDERS)) {
      violations.push(
        `guide[${String(index)}].order=${String(entry.order)} 不大于官方最大位次 ${String(Math.max(...OFFICIAL_GUIDE_ORDERS))}`,
      );
    }
  }
  return violations;
}

/** 逐字复刻**修复前**的 `buildTabDefinition()`（`src/client/tab.ts` 的 T4.1 版本：只有 5 个键） */
function legacyBuildTabDefinition(): SidebarRightTabDefinitionLike {
  return {
    id: 'dsh-terminal-profiles',
    kind: 'managedTerminal',
    multiple: true,
    keepMounted: true,
    title: (address: string) => (address === '' ? '受管终端' : `受管终端 · ${address}`),
  };
}

describe('缺陷 B：页类型必须有用户可发现的空态入口（guide）', () => {
  it('判据：guide 存在 + 形状像官方 + order 不挤官方档位', () => {
    const definition = buildTabDefinition();
    expectThat('判据违反项', guideViolations(definition), []);

    const entry = definition.guide?.[0];
    expectThat('入口 id', entry?.id, TERMINAL_GUIDE_ENTRY_ID);
    expectThat('入口 order', entry?.order, TERMINAL_GUIDE_ENTRY_ORDER);
    expectThat('入口 order > 官方最大位次', (entry?.order ?? 0) > Math.max(...OFFICIAL_GUIDE_ORDERS), true);
    expectThat('入口标题（thunk 真调用）', entry?.title(), TERMINAL_GUIDE_ENTRY_TITLE);
    expectThat('入口描述（thunk 真调用）', entry?.description?.(), TERMINAL_GUIDE_ENTRY_DESCRIPTION);
    expectThat('标题非空', (entry?.title() ?? '').length > 0, true);
    expectThat('描述非空', (entry?.description?.() ?? '').length > 0, true);
  });

  it('入口是**注册给宿主的那一份**（不是只在定义函数里好看）', () => {
    const harness = createClientCtx();
    const result = registerTerminalTab(harness.ctx, { pane: 'PANE', title: 'TITLE' });
    expectThat('注册成功', result.registered, true);
    const registered = harness.calls.tabDefinitions[0];
    expectThat('宿主收到的定义也带 guide', guideViolations(registered as SidebarRightTabDefinitionLike), []);
    expectThat('宿主收到的入口 id', registered?.guide?.[0]?.id, TERMINAL_GUIDE_ENTRY_ID);
  });

  it('🔴 变异哨兵：修复前的定义（没有 guide）**当场违反同一条判据**', () => {
    const violations = guideViolations(legacyBuildTabDefinition());
    // 原始输出（报告里要贴的那一行）：让哨兵「真的开火」这件事有终端原文，而不是只有断言绿
    console.log(
      `[sentinel] 旧实现（无 guide）⇒ 违反 ${String(violations.length)} 条：${violations.join(' | ')}；` +
        `修好后 ⇒ 违反 ${String(guideViolations(buildTabDefinition()).length)} 条`,
    );
    expectThat('旧实现被判违反（条数）', violations.length, 1);
    expectThat('违反原因里写着「点不到」', violations[0]?.includes('点不到'), true);
    // 同一条判据在修好的实现上**必须**为空 —— 两个结果来自同一个函数，不靠相信
    expectThat('修好后零违反', guideViolations(buildTabDefinition()), []);
  });
});

describe('扫描面统计（判据自己会说扫了多少）', () => {
  it('打印本次断言数', () => {
    console.log(`[scan] client-tab-guide：断言 ${scan.assertions} 条`);
    expectThat('断言数 > 0', scan.assertions > 0, true);
  });
});
