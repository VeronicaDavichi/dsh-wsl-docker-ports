/**
 * 017 六订·十五：**侧边栏按钮 = 配置内页按钮**的静态门（纯 node 扫描，不渲染）。
 *
 * 主人原话（2026-10-28）：「你先把两个侧边栏的css都和内页配置页统一好吗？剩下的我们挨个调整」。
 *
 * 为什么要有这条门：侧边栏右栏页（`PortsPane`）的按钮用 `.wdp-btn`，配置内页用 `.wdp-cfg-btn`。
 * 两张表各自独立演进时，一次「只改一边」就会让两处按钮高低/圆角不一致（本轮之前是 28px/6px vs
 * 34px/12px —— 肉眼就是「侧边栏按钮小一号」）。这条门把**四项关键声明**钉成同值。
 *
 * 判据（逐条二值）：
 * 1. 高度同值：`.wdp-btn` 34px == `.wdp-cfg-btn` 34px；
 * 2. 左右内边距同值：`0 14px`；
 * 3. 圆角同 token：`--dsw-radius-md`；
 * 4. 底色同 token：`--dsw-alias-bg-layer-3`。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONFIG_CSS } from '../../src/client/config-css.ts';
import { PAGE_CSS } from '../../src/client/styles.ts';

const CLIENT_DIR = fileURLToPath(new NodeURL('../../src/client/', import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CLIENT_DIR, rel), 'utf8');

/** 取某条规则的大括号体（表里每条规则都写成一行） */
function ruleBody(css: string, selector: string): string {
  // 行首定位：避免 `.wdp-table .wdp-btn {` 这种带前缀的规则被先命中
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `样式表里找不到 ${selector}`).toBeGreaterThanOrEqual(0);
  const start = css.indexOf('{', at);
  const end = css.indexOf('}', start);
  return css.slice(start + 1, end);
}

describe('017 六订·十五：右栏页按钮与配置内页按钮同值', () => {
  const side = ruleBody(PAGE_CSS, '.wdp-btn');
  const inner = ruleBody(CONFIG_CSS, '.wdp-cfg-btn');

  it('① 高度同为 34px', () => {
    expect(side).toContain('height: 34px;');
    expect(inner).toContain('height: 34px;');
  });

  it('② 左右内边距同为 0 14px', () => {
    expect(side).toContain('padding: 0 14px;');
    expect(inner).toContain('padding: 0 14px;');
  });

  it('③ 圆角同 token：--dsw-radius-md', () => {
    expect(side).toContain('border-radius: var(--dsw-radius-md');
    expect(inner).toContain('border-radius: var(--dsw-radius-md');
  });

  it('④ 底色同 token：--dsw-alias-bg-layer-3', () => {
    expect(side).toContain('background: var(--dsw-alias-bg-layer-3');
    expect(inner).toContain('background: var(--dsw-alias-bg-layer-3');
  });

  it('⑤ 输入框：侧栏与内页共用同一个 .wdp-input（34px / radius-md）', () => {
    const input = ruleBody(PAGE_CSS, '.wdp-input');
    expect(input).toContain('height: 34px;');
    expect(input).toContain('border-radius: var(--dsw-radius-md');
    // 侧栏（右栏页的写通道卡片 → write-panel 的 card 版式）与内页（config-fields）都只认这一个类
    expect(read('write-panel.tsx')).toContain("'wdp-input'");
    expect(read('config-fields.tsx')).toContain('className="wdp-input"');
  });
});

describe('017 六订·十七：括号说明单独一行（按钮加高，不拆括号）', () => {
  const stacked = ruleBody(CONFIG_CSS, '.wdp-btn-stacked');
  const settings = read('pane-settings.tsx');
  const pane = read('pane.tsx');

  it('① 两行按钮：纵向排列 + 高度自适应（min-height 仍是 34px）', () => {
    expect(stacked).toContain('flex-direction: column;');
    expect(stacked).toContain('height: auto;');
    expect(stacked).toContain('min-height: 34px;');
  });

  it('② 括号部分整体不断行（nowrap）', () => {
    expect(ruleBody(CONFIG_CSS, '.wdp-btn-stacked > .wdp-btn-sub')).toContain('white-space: nowrap;');
  });

  it('③ 两枚按钮的括号都拆成独立 span，且不再写成一整串', () => {
    expect(settings).toContain('<span className="wdp-btn-sub">（只报布尔）</span>');
    expect(settings).toContain('<span className="wdp-btn-sub">（二次确认）</span>');
    expect(settings).not.toContain('检查服务端配置状态（只报布尔）');
    expect(settings).not.toContain('清除凭据（二次确认）');
  });

  it('④ 右栏也装 chunk 表（否则两行规则不生效）', () => {
    expect(pane).toContain("from './config-css.ts'");
    expect(pane).toContain('installConfigStyles()');
  });
});

describe('017 六订·二十四：端口表改名「端口转发」并提到刷新按钮下面', () => {
  const pane = read('pane.tsx');
  const tables = read('pane-tables.tsx');

  it('① 标题去掉「（五态）」', () => {
    expect(tables).toContain('<h3>端口转发</h3>');
    expect(tables).not.toContain('端口转发（五态）');
  });

  it('② 端口表紧跟 PaneHeader（刷新那行），排在 NAT 硬前提之前', () => {
    const header = pane.indexOf('<PaneHeader');
    const ports = pane.indexOf('<PortsBlock');
    const nat = pane.indexOf('<NatGateBlock');
    expect(header).toBeGreaterThan(-1);
    expect(ports).toBeGreaterThan(header);
    expect(nat).toBeGreaterThan(ports);
    // 中间不许夹别的区块（错误提示除外）
    const between = pane.slice(header, ports);
    for (const forbidden of ['<ElevationBlock', '<ManagedPortsSummary', '<WriteTokenBlock', '<ExternalRulesBlock']) {
      expect(between.includes(forbidden), `刷新与端口表之间不该有 ${forbidden}`).toBe(false);
    }
  });

  it('③ udpTip 跟着端口表走（不隔着别的块）', () => {
    const ports = pane.indexOf('<PortsBlock');
    const tip = pane.indexOf('data-testid={TESTID.udpTip}');
    const nat = pane.indexOf('<NatGateBlock');
    expect(tip).toBeGreaterThan(ports);
    expect(tip).toBeLessThan(nat);
  });
});

describe('017 六订·二十五：去掉「证据」列 / 事实位文案收紧 / 表格内按钮与表格正文同字号', () => {
  const tables = read('pane-tables.tsx');

  it('① 端口表只剩 4 列（端口/状态/作用域/动作），「证据」表头不再出现', () => {
    const thead = tables.slice(tables.indexOf('<thead>'), tables.indexOf('</thead>'));
    expect(thead).toContain('<th>端口</th>');
    expect(thead).toContain('<th>状态</th>');
    expect(thead).toContain('<th>作用域</th>');
    expect(thead).toContain('<th>动作</th>');
    expect(thead).not.toContain('证据');
  });

  it('② 漂移 / 修复序列没丢（并入状态列，testid 不变）', () => {
    expect(tables).toContain('data-testid={`drift-${String(row.port)}`}');
    expect(tables).toContain('data-testid={`fix-${String(row.port)}`}');
  });

  it('③ 事实位文案 = 「监听地址与声明作用域不一致」（括号说明已删）', () => {
    expect(tables).toContain('监听地址与声明作用域不一致');
    expect(tables).not.toContain('不判冲突');
  });

  it('④ 表格内按钮 26px / 12px（= 表格正文 12px，也与容器页表格按钮同值）', () => {
    expect(PAGE_CSS).toContain('.wdp-table .wdp-btn { height: 26px; padding: 0 8px; font-size: 12px;');
    // 表格正文 12px 是这条判据的基准，改一边就红
    expect(PAGE_CSS).toContain('.wdp-table { width: 100%; border-collapse: collapse; font-size: 12px; }');
  });
});

describe('017 六订·二十七：作用域下拉宽度 +20%（116px → 139px）', () => {
  it('① max-width = 139px（= 116 × 1.2，取整）', () => {
    expect(PAGE_CSS).toContain('.wdp-table select.wdp-btn { max-width: 139px; }');
    // 旧值 116px 是基准：改回去这条会红（116 × 1.2 = 139.2 ⇒ 139）
    expect(PAGE_CSS).not.toContain('max-width: 116px');
  });
});

describe('017 六订·二十九：右栏页标题改名「wsl 端口转发」', () => {
  it('① 标题常量与全部指路文案都用新名字，旧名「WSL Docker 端口」在客户端源码里 0 处', () => {
    const tabDef = read('tab-def.ts');
    expect(tabDef).toContain("export const PAGE_TITLE = 'WSL 端口转发';");
    // 指路文案必须跟标题同步（否则用户按提示去找一个不存在的名字）
    expect(read('config-write.tsx')).toContain('「WSL 端口转发」右栏页');
    expect(read('write-token.ts')).toContain('「WSL 端口转发」右栏页');
    expect(read('write-token.ts')).not.toContain('「WSL Docker 端口」右栏页');
    expect(read('config-write.tsx')).not.toContain('「WSL Docker 端口」右栏页');
  });
});
