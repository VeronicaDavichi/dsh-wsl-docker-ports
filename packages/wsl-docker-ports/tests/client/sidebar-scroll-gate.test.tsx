/**
 * 017 六订·十六：**整个侧边栏只有一个滚动条**的静态门（纯 node 扫描，不渲染）。
 *
 * 主人原话（2026-10-28）：「你看到右侧的这下滚动条了吗？我希望长度能够自动满足，不要每块都加一个
 * 滚动条，不够的自动挤占下方空间，整个侧边栏应该只有一个总的滚动条」。
 *
 * 真机根因（2026-10-28 实测 acceptance 实例 43391，侧栏 417px）：
 * - `.wdp-page` 是 `display:flex; flex-direction:column`，宿主给页面根**内联**写了
 *   `height:auto; min-height:0; overflow-y:visible` ⇒ 页面根不滚，滚的是宿主的 tab body；
 * - 于是每个 `.wdp-sec` 作为 flex item **被压缩**（实测 49/95、129/307、44/75、269/728…），
 *   而 `.wdp-sec` 上那句 `overflow-x: auto` 按 CSS 规范会把**另一轴**也算成 `auto`
 *   ⇒ 每个块自己长出一条竖向滚动条（主人截图里的「每块一个滚动条」）。
 *
 * 判据（逐条二值，失败即红）：
 * 1. `.wdp-sec` **不许**自己滚（无 `overflow-x` / `overflow-y`）；
 * 2. `.wdp-page > *` 必须 `flex: none`（子块不许被压缩 ⇒ 内容撑开、由外层统一滚）；
 * 3. `.wdp-pre` 不许自滚，长串改用 `overflow-wrap: anywhere` 断行；
 * 4. `.wdp-table` 不许写死 `min-width: 460px`（侧栏 412px，写死就横向溢出）。
 */

import { describe, expect, it } from 'vitest';

import { PAGE_CSS } from '../../src/client/styles.ts';

function ruleLine(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `样式表里找不到 ${selector}`).toBeGreaterThanOrEqual(0);
  const start = css.indexOf('{', at);
  const end = css.indexOf('}', start);
  return css.slice(start + 1, end);
}

describe('017 六订·十六：侧边栏只有一个总滚动条', () => {
  const sec = ruleLine(PAGE_CSS, '.wdp-sec');
  const pre = ruleLine(PAGE_CSS, '.wdp-pre');
  const table = ruleLine(PAGE_CSS, '.wdp-table');

  it('① .wdp-sec 不许自己滚（overflow-x / overflow-y 都不许出现）', () => {
    expect(sec).not.toContain('overflow-x');
    expect(sec).not.toContain('overflow-y');
  });

  it('② .wdp-page 的直接子块必须 flex: none（不许被压缩）', () => {
    expect(PAGE_CSS).toContain('.wdp-page > * { flex: none; }');
  });

  it('③ .wdp-pre 不自滚，长串靠 overflow-wrap 断行', () => {
    expect(pre).not.toContain('overflow-x');
    expect(pre).toContain('overflow-wrap: anywhere;');
  });

  it('④ 表格没有写死 460px 宽（侧栏 412px 会横向溢出）', () => {
    expect(table).not.toContain('min-width');
  });
});
