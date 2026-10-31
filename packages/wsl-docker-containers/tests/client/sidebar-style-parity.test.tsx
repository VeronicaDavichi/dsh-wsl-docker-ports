/**
 * 017 六订·十五：**两个侧边栏与配置内页同一套样式**的静态门（纯 node 扫描，不渲染）。
 *
 * 主人原话（2026-10-28）：「你先把两个侧边栏的css都和内页配置页统一好吗？剩下的我们挨个调整」。
 *
 * 判据（逐条二值，失败即红）：
 * 1. `PAGE_CSS`（侧边栏骨架）里 **0 处假 token** —— `--dsw-alias-border-primary` /
 *    `border-secondary` / `border-accent` / `bg-accent` / `state-danger` / `state-success` /
 *    `state-warning` 这些名字在宿主主题里**不存在**，用了就静默回落 `currentColor`/`transparent`
 *    （表现就是「表格线惨白、卡片没边框」）；
 * 2. 表格分隔线与配置内页同一口径：`0.5px solid var(--dsw-alias-border-l2`；
 * 3. 控件外壳**只**来自 chunk 的 `CONFIG_CSS`（`.wdp-cfg-btn` / `.wdp-cfg-input`），
 *    侧边栏源码里不再出现自造按钮类；
 * 4. `pane.tsx` 与配置页**都**注入同一份表（否则侧边栏的 `.wdp-cfg-*` 会没有定义）。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONFIG_CSS } from '../../src/client/containers/config-css.ts';
import { PAGE_CSS } from '../../src/client/styles.ts';

const CLIENT_DIR = fileURLToPath(new NodeURL('../../src/client/', import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CLIENT_DIR, rel), 'utf8');

const FAKE_TOKENS = [
  '--dsw-alias-border-primary',
  '--dsw-alias-border-secondary',
  '--dsw-alias-border-accent',
  '--dsw-alias-bg-accent',
  '--dsw-alias-state-danger',
  '--dsw-alias-state-success',
  '--dsw-alias-state-warning',
];

describe('017 六订·十五：侧边栏 CSS 与配置内页同一套', () => {
  it('① PAGE_CSS 零假 token（颜色只取宿主真名）', () => {
    for (const fake of FAKE_TOKENS) {
      expect(PAGE_CSS.includes(fake), `PAGE_CSS 里还有假 token：${fake}`).toBe(false);
    }
  });

  it('② 表格分隔线 = 0.5px border-l2（与配置内页同口径）', () => {
    expect(PAGE_CSS).toContain(
      '.wdp-table td { text-align: left; padding: 4px 6px; vertical-align: middle; border-bottom: 0.5px solid var(--dsw-alias-border-l2, transparent); }',
    );
    expect(PAGE_CSS).toContain('border-bottom: 0.5px solid var(--dsw-alias-border-l2, transparent); }');
  });

  it('③ 控件外壳只来自 CONFIG_CSS：侧边栏源码用 .wdp-cfg-btn，不自造按钮类；侧边栏已不再有输入框（019 D7）', () => {
    expect(CONFIG_CSS).toContain('.wdp-cfg-btn {');
    expect(CONFIG_CSS).toContain('.wdp-cfg-input {');
    const pane = read('containers/pane.tsx');
    expect(pane).toContain("className: 'wdp-cfg-btn'");
    // 019 D7（主人 2026-10-31 选 B）：页内凭据输入框 + 「保存」已删，唯一写入口在配置内页
    expect(pane).not.toContain("className: 'wdp-cfg-input'");
    expect(pane).not.toContain('inp-containers-token');
    // 旧的「裸按钮」占位类不许回来
    expect(pane).not.toContain('wdp-btn');
  });

  it('④ 侧边栏与配置页都注入同一份表（pane.tsx 的 installConfigStyles 不能掉）', () => {
    expect(read('containers/pane.tsx')).toContain('installConfigStyles');
    expect(read('containers/config-page.tsx')).toContain('installConfigStyles');
  });

  it('⑤ 页面总留白与转发侧一致：8px 12px 12px（首屏内容距顶 12px，与转发侧齐平）', () => {
    // 2026-10-28 主人：「docker容器页面的总margin和端口转发的保持一致」→「容器margintop还是小了」
    // 顶 8px 是页内留白；首行 34px 按钮在 42px 行高里再居中出 4px ⇒ 首屏内容距顶 12px（转发侧 .wdp-sec 的 12px 同值）
    expect(PAGE_CSS).toContain('.wdp-containers { display: flex; flex-direction: column; gap: 10px; padding: 8px 12px 12px;');
    // 转发侧那份在另一个包里，值写死在这里做「同值」对照（改一边就得两边一起改，否则这条红）
    expect(PAGE_CSS).toContain('padding: 8px 12px 12px;');
  });
});
