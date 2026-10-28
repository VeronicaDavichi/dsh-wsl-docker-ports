// @vitest-environment jsdom
/**
 * 017 六订·二十八（主人 2026-10-28）：
 * 「这里的特殊字体没有正常加粗反而显示了 markdown 语法」
 *
 * 口径：**页面上渲染出来的文字里不许出现 markdown 记号**。
 * - `**粗体**` 必须是真 `<strong>`；反引号包起来的必须是真 `<code>`；
 * - 判据是「渲染后的 textContent 里 0 处 `**`、0 处反引号」——不读源码、不靠人眼。
 * 覆盖：本会话持有凭据… / 写操作会改动本机… / 再点一次 = 轮换… / 一次性凭据提示 / 确认清除提示。
 * host 侧交回来的 `tokenNote` 只能出纯文本 ⇒ 那边记号已改中文「」，也在同一条判据下。
 */
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { WRITE_TOKEN_TESTID } from '../../src/client/pane-settings.js';
import { harness, mountPane, resetDom, stubRandom } from './write-token-harness.tsx';

beforeEach(() => {
  stubRandom();
  resetDom();
});

function assertNoMarkdown(container: HTMLElement): void {
  const text = container.textContent ?? '';
  const star = text.indexOf('**');
  expect(
    star,
    `残留 ** 记号：…${text.slice(Math.max(0, star - 40), star + 40)}…`,
  ).toBe(-1);
  expect(text.includes('`'), '残留反引号记号').toBe(false);
}

describe('017 六订·二十八：界面上不许出现 markdown 记号', () => {
  it('① 首帧（未生成）：整块里 0 处 ** 与反引号；「只报布尔」是真 <strong>、netsh portproxy / plan 是真 <code>', async () => {
    const test = harness();
    const container = await mountPane(test.runtime);
    await screen.findByTestId(WRITE_TOKEN_TESTID.block);
    assertNoMarkdown(container);

    const strongs = [...container.querySelectorAll('strong')].map((el) => el.textContent ?? '');
    expect(strongs).toContain('只报布尔');
    const codes = [...container.querySelectorAll('code')].map((el) => el.textContent ?? '');
    expect(codes).toContain('netsh portproxy');
    expect(codes).toContain('plan');
    expect(codes).toContain('writeToken');
    console.log(`  · 扫了 1 个首帧：** 0 处、反引号 0 处；strong ${String(strongs.length)} 个 / code ${String(codes.length)} 个`);
  });

  it('② 生成之后（一次性提示 + 轮换说明）：仍然 0 处记号；「轮换」「即时生效」是真的粗体', async () => {
    const test = harness();
    const container = await mountPane(test.runtime);
    await screen.findByTestId(WRITE_TOKEN_TESTID.block);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.generate));
    await screen.findByTestId(WRITE_TOKEN_TESTID.once);
    assertNoMarkdown(container);

    const strongs = [...container.querySelectorAll('strong')].map((el) => el.textContent ?? '');
    expect(strongs).toContain('轮换');
    expect(strongs).toContain('即时生效');
    expect(strongs).toContain('离开后将不再显示，请立即复制');
    console.log(`  · 扫了 1 个生成态：** 0 处、反引号 0 处；strong ${String(strongs.length)} 个`);
  });
});
