import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ElevationBlock, ELEVATION_NOTICE_TESTID } from '../../src/client/pane-settings.tsx';
import { ELEVATION_CONSENT_NOTICE, TESTID } from '../../src/client/rows.ts';

// 005 T2b.3 判据 C：UI 必须明说「本机提权可能不会请你确认（取决于系统 UAC 策略）」，
// 并指引用户如何自查 `ConsentPromptBehaviorAdmin`。判据是**可二值判定**的：
// ① 告知真出现在渲染结果里且逐字等于 SSoT 常量；② 三个要件（警告语 / 注册表值名 / 可照抄命令）齐；
// ③ 取值含义与手册节名齐；④ 反控（内容来自视图字段，不是渲染层硬编码）；⑤ 既有策略说明没被顶掉。
type View = Parameters<typeof ElevationBlock>[0]['elevation'];

function render(notice: string): string {
  const elevation = {
    testId: TESTID.elevation,
    value: 'ask',
    options: [
      { value: 'none', label: 'none（默认）' },
      { value: 'ask', label: 'ask（每次写操作都弹 UAC）' },
    ],
    enabled: true,
    note: '提权策略只改配置（remote.settings），不触发任何提权调用',
    notice,
  } as unknown as View;
  return renderToStaticMarkup(createElement(ElevationBlock, { elevation, onChange: () => undefined }));
}

/**
 * `renderToStaticMarkup` 会把文本节点里的引号与尖括号转义 ⇒ 先解回原文再逐字比对。
 * （不做这一步，「逐字等于常量」只能比到第一个 `"` 为止 —— 那是假绿。）
 */
function decode(html: string): string {
  return html
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('提权告知（005 T2b.3 判据 C）', () => {
  it('① 告知有自己的 testid，且逐字等于 SSoT 常量（UI 不另写一份文案）', () => {
    const html = render(ELEVATION_CONSENT_NOTICE);
    expect(html).toContain(`data-testid="${ELEVATION_NOTICE_TESTID}"`);
    expect(decode(html)).toContain(ELEVATION_CONSENT_NOTICE);
    console.log(`  · testid=${ELEVATION_NOTICE_TESTID}；告知 ${String(ELEVATION_CONSENT_NOTICE.length)} 字逐字命中`);
  });

  it('② 三个要件齐：警告语 + 注册表值名 + 可照抄的自查命令', () => {
    const text = decode(render(ELEVATION_CONSENT_NOTICE));
    expect(text).toContain('可能不会请你确认');
    expect(text).toContain('ConsentPromptBehaviorAdmin');
    expect(text).toContain(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v ConsentPromptBehaviorAdmin',
    );
    console.log('  · 命中：可能不会请你确认 / ConsentPromptBehaviorAdmin / reg query …（整条可照抄）');
  });

  it('③ 取值含义与手册落点齐：0 / 2 / 5 + EnableLUA 陷阱 + 手册节名', () => {
    const text = decode(render(ELEVATION_CONSENT_NOTICE));
    const needs = ['0 = 不提示直接提权', '2 = 安全桌面确认', '5 = 默认', 'EnableLUA = 0', '提权与 UAC 自查'];
    for (const need of needs) expect(text).toContain(need);
    console.log(`  · 命中 ${String(needs.length)} 条：${needs.join(' / ')}`);
  });

  it('④ 反控：notice 传空串 ⇒ 段落仍在但警告语消失（内容来自视图字段，非渲染层硬编码）', () => {
    const html = render('');
    expect(html).toContain(`data-testid="${ELEVATION_NOTICE_TESTID}"`);
    expect(decode(html)).not.toContain('可能不会请你确认');
    console.log('  · 反控通过：notice 传空串 ⇒ 警告语不出现（证明它由视图字段驱动）');
  });

  it('⑤ 既有策略说明没被顶掉（策略语义 note 与提权告知 notice 并存）', () => {
    const text = decode(render(ELEVATION_CONSENT_NOTICE));
    expect(text).toContain('提权策略只改配置（remote.settings），不触发任何提权调用');
    expect(text).toContain(ELEVATION_CONSENT_NOTICE);
    console.log('  · 两条说明并存：note（策略语义）+ notice（提权告知）');
  });
});
