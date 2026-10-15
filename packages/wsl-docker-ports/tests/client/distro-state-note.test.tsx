import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DistroBlock } from '../../src/client/pane-tables.tsx';

// 003 追账：stateNote 渲染判据 —— ① null ⇒ 不渲染附加行；② 非 null ⇒ 原文完整
type View = Parameters<typeof DistroBlock>[0]['distro'];
const base = {
  name: 'Ubuntu2204', sourceLabel: '自动解析', state: 'Running', error: null, staleMessage: null,
  options: [],
} as unknown as View;

describe('DistroBlock 的 stateNote（003 追账）', () => {
  it('① stateNote === null ⇒ 不渲染附加行（不留噪声）', () => {
    const html = renderToStaticMarkup(createElement(DistroBlock, { distro: { ...base, stateNote: null }, onChange: () => {} }));
    expect(html).not.toContain('distro-state-note');
  });

  it('② stateNote 非 null ⇒ 渲染且原文完整', () => {
    const note = '「wsl -l -v」的一次性快照记的是 状态=Stopped，但本次已在「docker ps」内成功执行只读命令（docker ps）⇒ 以实证为准记为 Running';
    const html = renderToStaticMarkup(createElement(DistroBlock, { distro: { ...base, stateNote: note }, onChange: () => {} }));
    expect(html).toContain('distro-state-note');
    expect(html).toContain(note);
    expect(html).toContain('状态=Stopped');
  });
});
