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
