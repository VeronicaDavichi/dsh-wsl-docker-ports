import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DistroAlarmBlock } from '../../src/client/pane-tables.tsx';

// 003 追账：stateNote 渲染判据 —— ① null ⇒ 不渲染附加行；② 非 null ⇒ 原文完整
// 017 三订：承载它的组件从 `DistroBlock`（整块已搬去配置页）收窄成 `DistroAlarmBlock`
//（只留告警）⇒ 判据本身一字未改，只换了被测组件。
type View = Parameters<typeof DistroAlarmBlock>[0]['distro'];
const base = {
  name: 'Ubuntu2204', sourceLabel: '自动解析', state: 'Running', error: null, staleMessage: null,
  options: [],
} as unknown as View;

describe('DistroAlarmBlock 的 stateNote（003 追账）', () => {
  it('① stateNote === null ⇒ 不渲染附加行（不留噪声）', () => {
    const html = renderToStaticMarkup(createElement(DistroAlarmBlock, { distro: { ...base, stateNote: null } }));
    expect(html).not.toContain('distro-state-note');
  });

  it('② stateNote 非 null ⇒ 渲染且原文完整', () => {
    const note = '「wsl -l -v」的一次性快照记的是 状态=Stopped，但本次已在「docker ps」内成功执行只读命令（docker ps）⇒ 以实证为准记为 Running';
    const html = renderToStaticMarkup(createElement(DistroAlarmBlock, { distro: { ...base, stateNote: note } }));
    expect(html).toContain('distro-state-note');
    expect(html).toContain(note);
    expect(html).toContain('状态=Stopped');
  });

  it('③ 三样全空（无 note / 无漂移 / 无解析错误）⇒ 整块不渲染（侧栏不占版面）', () => {
    const html = renderToStaticMarkup(createElement(DistroAlarmBlock, { distro: { ...base, stateNote: null } }));
    expect(html).toBe('');
  });
});