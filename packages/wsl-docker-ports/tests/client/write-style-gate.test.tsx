/**
 * 009 T1.3 ⑨ / 017 三订：**静态样式门**（从 `write-result.test.tsx` 迁出，纯 node 扫描、不渲染）。
 *
 * 迁出理由（2026-10-27）：⑨ 是「组件源码里零 hex + 用到的类名都在真样式表里」的**静态**判据，
 * 和结果区那条 `write-result.test.tsx`（已经 409 行、撞 NFR-5 的 400 行 SHALL）没有共享状态。
 * 拆出来既让结果区用例回到纯行为面，也给 017 新增的「一个组件两种版式」留出行数余量。
 *
 * 判据（逐条二值）：
 * 1. `write-result.tsx` / `write-panel.tsx` 源码里 **0 处硬编码 hex**（NFR-7：颜色只从宿主 token 取）；
 * 2. 源码里出现的每个 `wdp-*` 类名，都能在 **PAGE_CSS ∪ CONFIG_CSS** 里查到
 *    —— 017 起 `write-panel.tsx` 一个组件两种版式：`card`（右栏页，样式在 `styles.ts`）
 *    与 `field`（配置页，样式在 `config-css.ts`）；
 * 3. 两张表**各自至少被命中 1 个类名**（否则并集会放过「整个表写错/漏引」这种错）；
 * 4. 两张表都**真引用** `var(--dsw-*)`（非空扫描 —— 防止有人把规则搬成空串还显示「全绿」）。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONFIG_CSS } from '../../src/client/config-css.ts';
import { PAGE_CSS } from '../../src/client/styles.ts';

const CLIENT_DIR = fileURLToPath(new NodeURL('../../src/client/', import.meta.url));

describe('009 T1.3 ⑨：零硬编码 hex / 类名都来自真样式表（017 起为两张表）', () => {
  it('⑨ 组件零 hex；用到的类名都在 PAGE_CSS ∪ CONFIG_CSS；两张表都真引用 var(--dsw-*)', () => {
    const files = ['write-result.tsx', 'write-panel.tsx'];
    const hexHits: string[] = [];
    const tokens = new Set<string>();
    let bytes = 0;
    for (const file of files) {
      const text = readFileSync(path.join(CLIENT_DIR, file), 'utf8');
      bytes += Buffer.byteLength(text);
      for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b/gu)) hexHits.push(`${file}:${match[0]}`);
      for (const match of text.matchAll(/wdp-[a-z0-9-]+/gu)) tokens.add(match[0]);
    }
    expect(hexHits).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
    expect(bytes).toBeGreaterThan(0);
    expect(tokens.size).toBeGreaterThan(0);

    const hitsIn = (sheet: string): string[] => [...tokens].filter((token) => sheet.includes(`.${token}`));
    for (const token of tokens) {
      expect(PAGE_CSS.includes(`.${token}`) || CONFIG_CSS.includes(`.${token}`), `类名 .${token} 既不在 PAGE_CSS 也不在 CONFIG_CSS`).toBe(true);
    }
    // 两张表都必须真正被这些类名用到 —— 否则「并集」会把「整张表写错/没引」也判绿
    for (const [sheet, name] of [[PAGE_CSS, 'PAGE_CSS'], [CONFIG_CSS, 'CONFIG_CSS']] as const) {
      expect(hitsIn(sheet).length, `${name} 里一个类名都没命中`).toBeGreaterThan(0);
      expect([...sheet.matchAll(/var\(--dsw-/gu)].length, `${name} 没有引用任何宿主 token`).toBeGreaterThan(0);
    }
    console.log(
      `  · 扫了 ${String(files.length)} 文件 / ${String(bytes)} 字节：hex 0 处；${String(tokens.size)} 个类名（PAGE_CSS 命中 ${String(hitsIn(PAGE_CSS).length)} / CONFIG_CSS 命中 ${String(hitsIn(CONFIG_CSS).length)}）`,
    );
  });
});

/**
 * ⑩ 右栏页「调成配置页样式」的**结构判据**（2026-10-27 主人：「把侧边栏的 css 也调整成配置页这种样式吧」）
 *
 * 判据逐条二值：
 * 1. 控件样式**唯一定义**在 PAGE_CSS（`.wdp-input` / `.wdp-save` / `.wdp-textbtn`）——
 *    此前这三族只写在 CONFIG_CSS 里，而右栏页也用它们 ⇒ 右栏页的输入框/按钮一直是浏览器默认样式
 *    （这才是「丑」的一半）。现在配置页**复用**主表的规则，不许再各写一份（两处定义必然漂移）。
 * 2. 右栏页的段落一律 `.wdp-sec`，`wdp-card` 只留给「内嵌面板」（写通道 / 回执 / 确认框）——
 *    段落 = 宿主 field（细分隔线），面板 = 宿主 layer-2 盒，两者层次不能混。
 * 3. 分隔线一律 `0.5px`：PAGE_CSS 里出现 `1px solid` 只允许 `.wdp-save` 那一条
 *    （它的边是 `transparent`，只用来占位撑高，不画线）。
 */
describe('⑩ 右栏页语法与配置页同源（共享控件 / 段落 vs 面板 / 0.5px 分隔线）', () => {
  it('控件只在 PAGE_CSS 定义；右栏页用 .wdp-sec 不用 .wdp-card；分隔线全是 0.5px', () => {
    for (const selector of ['.wdp-input', '.wdp-save', '.wdp-textbtn']) {
      expect(PAGE_CSS.includes(`${selector} `) || PAGE_CSS.includes(`${selector},`), `${selector} 不在 PAGE_CSS`).toBe(true);
      // 只允许「限定作用域」的补充（如 `.wdp-cfg-card .wdp-textbtn` 左对齐），
      // 不许再写一份**裸选择器**的基础规则（两处基础规则必然漂移）
      // 主人 2026-10-27 第三次拍板：「我说让你放到组件下面去」⇒ 分组里的卡片必须**竖着排**
      // （原始输出在写通道预演正下方），不许 flex 横排挤成并排两张
      const cardsRule = /\.wdp-cfg-cards \{[^}]*\}/u.exec(CONFIG_CSS)?.[0] ?? '';
      expect(cardsRule, '.wdp-cfg-cards 规则不见了').not.toBe('');
      expect(cardsRule, '卡片必须竖排（原始输出要在写通道预演**下面**）').toContain('flex-direction: column');
      expect(cardsRule, '卡片区不许横向平分（会变成并排）').not.toContain('flex-wrap: wrap');      const bare = new RegExp(`(^|\\n)${selector.replaceAll('.', '\\.')}[,\\s]*\\{`, 'u');
      expect(bare.test(CONFIG_CSS), `${selector} 在 CONFIG_CSS 里又写了一份裸规则（会漂移）`).toBe(false);
    }

    const paneFiles = ['pane.tsx', 'pane-tables.tsx', 'pane-settings.tsx'];
    for (const file of paneFiles) {
      const text = readFileSync(path.join(CLIENT_DIR, file), 'utf8');
      expect(text.includes('className="wdp-card'), `${file} 的段落还在用 wdp-card（应为 wdp-sec）`).toBe(false);
    }
    // 面板那三处必须还在 —— 否则「段落改完了、面板也顺手改没了」不会被发现
    for (const file of ['write-panel.tsx', 'write-confirm.tsx']) {
      const text = readFileSync(path.join(CLIENT_DIR, file), 'utf8');
      expect(text.includes('wdp-card'), `${file} 的内嵌面板丢了 wdp-card`).toBe(true);
    }

    const onePx = [...PAGE_CSS.matchAll(/1px solid/gu)].length;
    expect(onePx, `PAGE_CSS 里出现 ${String(onePx)} 处 1px solid（分隔线应统一 0.5px）`).toBe(1);
    expect(PAGE_CSS.includes('.wdp-sec')).toBe(true);
    console.log(`  · PAGE_CSS 里 1px solid = ${String(onePx)} 处（仅 .wdp-save 的 transparent 占位边）；段落 = .wdp-sec，面板 = .wdp-card`);
  });
});
