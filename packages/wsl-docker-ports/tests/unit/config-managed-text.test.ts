/**
 * 017 六订·十八：勾选 preset 后**原文当场按半角逗号重排**（纯函数，零渲染）。
 *
 * 主人 2026-10-28：「通过打勾维护上来的都用逗号维护」。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { togglePreset, type Draft } from '../../src/client/config-model.ts';

const draft = (text: string): Draft => ({ managedPortsText: text, presets: [], distro: '', policy: 'none', portsRefresh: 0 });

test('T5.9 勾上一个 preset：并进原文、用逗号分隔（不是一行一项）', () => {
  const next = togglePreset(draft('8080'), 'mysql', true);
  assert.equal(next.presets.includes('mysql'), true);
  assert.equal(next.managedPortsText, '8080, 3306');
  assert.equal(next.managedPortsText.includes('\n'), false);
  console.log(`  · 勾选后原文 = 「${next.managedPortsText}」`);
});

test('T5.9 取消勾选：该项从原文里摘掉（不许「取消了却还在」）', () => {
  const ticked = togglePreset(draft('8080'), 'mysql', true);
  const back = togglePreset(ticked, 'mysql', false);
  assert.equal(back.managedPortsText, '8080');
  assert.deepEqual(back.presets, []);
  console.log(`  · 取消后原文 = 「${back.managedPortsText}」`);
});

test('T5.9 用户自己敲的换行文本：勾选一次就归并成逗号（不丢项、不改顺序）', () => {
  const next = togglePreset(draft('8080\n1521\n1000-3000'), 'mysql', true);
  assert.equal(next.managedPortsText, '8080, 1521, 1000-3000, 3306');
  console.log(`  · 归并结果 = 「${next.managedPortsText}」`);
});

test('T5.9 重复勾选不写第二遍（按端口号去重）', () => {
  const once = togglePreset(draft('3306'), 'mysql', true);
  assert.equal(once.managedPortsText, '3306');
  const twice = togglePreset(togglePreset(once, 'redis', true), 'redis', false);
  assert.equal(twice.managedPortsText, '3306');
});
