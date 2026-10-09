// @vitest-environment jsdom
/**
 * T4.2 样式注入与移除（REQ-5.2 / REQ-5.5 / NFR-4）—— jsdom 真文档。
 *
 * 判据：
 *   ① `installStyleTag` 造出**带 `data-plugin` 标记**的 `<style>`，dispose 移除且**幂等**；
 *   ② 同 tagId 二次注入 ⇒ **先清后插**，文档里始终只有 1 个（不会随挂载次数堆积）；
 *   ③ `installTerminalStyles` 的 dispose **同时**收掉 chunk 后来注入的 `xterm.css` 节点（卸载不残留）；
 *   ④ 显式传 `undefined` 走默认参数（jsdom 里全局 `document` 存在 ⇒ 真注入）；**真·无 document 的降级**
 *      放在 node 环境的 `client-entry.test.ts`（本文件头声明了 jsdom，在这里断言「没有 document」自相矛盾）；
 *   ⑤ CSS 常量：选择器**全部** `.dtp-` 前缀、**零硬编码 hex**、`var(--dsw-*)` **只在两个已实证 token 里**
 *      （正向断言也写：两个 token 必须真的出现 ⇒ 免得删光 CSS 后检查变空转）。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  STYLE_PLUGIN_ID,
  TERMINAL_PANE_CSS,
  XTERM_CSS_TAG_ID,
  installStyleTag,
  installTerminalStyles,
  removeStyleTag,
  resolveDocument,
} from '../../src/client/styles.ts';

const VERIFIED_TOKENS = ['--dsw-alias-bg-layer-1', '--dsw-alias-label-primary'];

beforeEach(() => {
  for (const node of document.querySelectorAll('style[data-plugin]')) node.remove();
});

describe('T4.2 样式注入（jsdom）', () => {
  it('resolveDocument() 在 jsdom 里返回真 document', () => {
    expect(resolveDocument()).toBe(document);
  });

  it('installStyleTag：带 data-plugin 标记 + 挂在 head + dispose 移除 + 幂等', () => {
    const installation = installStyleTag(document, 'unit-tag', 'a{color:red}');
    const node = document.querySelector('style[data-plugin="unit-tag"]');
    expect(node).not.toBeNull();
    expect(node?.parentElement).toBe(document.head);
    expect(node?.textContent).toBe('a{color:red}');
    expect(installation.installed).toBe(true);
    installation.dispose();
    installation.dispose();
    expect(document.querySelector('style[data-plugin="unit-tag"]')).toBeNull();
  });

  it('同 tagId 二次注入先清后插：始终只有 1 个节点', () => {
    installStyleTag(document, 'unit-tag', 'first{}');
    installStyleTag(document, 'unit-tag', 'second{}');
    const nodes = document.querySelectorAll('style[data-plugin="unit-tag"]');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.textContent).toBe('second{}');
  });

  it('removeStyleTag：在则删并返回 true，不在则返回 false（不抛）', () => {
    installStyleTag(document, 'unit-tag', 'x{}');
    expect(removeStyleTag(document, 'unit-tag')).toBe(true);
    expect(removeStyleTag(document, 'unit-tag')).toBe(false);
  });

  it('installTerminalStyles：注入自有 tagId 的节点', () => {
    const installation = installTerminalStyles(document);
    expect(installation.installed).toBe(true);
    expect(installation.tagId).toBe(STYLE_PLUGIN_ID);
    const node = document.querySelector(`style[data-plugin="${STYLE_PLUGIN_ID}"]`);
    expect(node?.textContent).toBe(TERMINAL_PANE_CSS);
    installation.dispose();
    expect(document.querySelector(`style[data-plugin="${STYLE_PLUGIN_ID}"]`)).toBeNull();
  });

  it('installTerminalStyles 的 dispose 连 chunk 后注入的 xterm.css 一起收（卸载不残留）', () => {
    const installation = installTerminalStyles(document);
    // 模拟 chunk 在视图挂载时注入 xterm.css（本包自有样式之后再注入）
    installStyleTag(document, XTERM_CSS_TAG_ID, '.xterm{}');
    expect(document.querySelectorAll('style[data-plugin]')).toHaveLength(2);
    installation.dispose();
    expect(document.querySelectorAll('style[data-plugin]')).toHaveLength(0);
  });

  it('显式传 undefined 会走默认参数取当前 document（jsdom 里就是真 document）—— 降级另见 node 用例', () => {
    const installation = installTerminalStyles(undefined);
    expect(installation.installed).toBe(true);
    expect(document.querySelector(`style[data-plugin="${STYLE_PLUGIN_ID}"]`)).not.toBeNull();
    installation.dispose();
  });
});

describe('T4.2 CSS 契约（零 hex / dtp- 前缀 / 只用已实证 token）', () => {
  it('所有选择器都在 .dtp- 命名空间下（不与官方样式串味）', () => {
    const selectors = TERMINAL_PANE_CSS.split('\n').map((rule) => rule.slice(0, rule.indexOf('{')));
    expect(selectors.length).toBeGreaterThanOrEqual(4);
    for (const selector of selectors) {
      for (const part of selector.split(',')) {
        expect(part.trim().startsWith('.dtp-')).toBe(true);
      }
    }
  });

  it('零硬编码 hex（NFR-4：颜色一律走宿主 token）', () => {
    expect(/#[0-9a-fA-F]{3,8}\b/u.test(TERMINAL_PANE_CSS)).toBe(false);
    expect(TERMINAL_PANE_CSS.includes('rgb(')).toBe(false);
    expect(TERMINAL_PANE_CSS.includes('hsl(')).toBe(false);
  });

  it('var(--dsw-*) 只出现在两个已实证 token 里，且两个都真的用到（非空转）', () => {
    const used = [...TERMINAL_PANE_CSS.matchAll(/var\((--dsw-[a-z0-9-]+)\)/gu)].map((match) => match[1]);
    expect(used.length).toBeGreaterThanOrEqual(2);
    expect([...new Set(used)].sort()).toEqual([...VERIFIED_TOKENS].sort());
  });

  it('tagId 与自有样式不同值（两份样式互不覆盖）', () => {
    expect(XTERM_CSS_TAG_ID).not.toBe(STYLE_PLUGIN_ID);
    expect(XTERM_CSS_TAG_ID.startsWith('dsh-terminal-profiles/')).toBe(true);
  });
});
