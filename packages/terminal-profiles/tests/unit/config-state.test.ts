/**
 * T1.3 空配置 / 全无效配置的引导态（REQ-1.5）
 *
 * Phase 1 是纯模型层 ⇒ 「渲染断言」= 对**判定与文案**的断言（React 渲染在 T4.x）。
 * 判据只有两条：① 没有可启动项时**必须**是引导态 ② 任何输入都**不抛错、不返回空白态**。
 */

import { describe, expect, it } from 'vitest';

import { parseProfiles } from '../../src/config/profiles.ts';
import { deriveConfigState } from '../../src/config/state.ts';

describe('T1.3 deriveConfigState —— 引导态判定（REQ-1.5）', () => {
  it('REQ-1.5 正常：有可启动项 ⇒ 就绪态，startable / needsFix 计数正确且诊断透传', () => {
    const result = parseProfiles([
      { name: 'good', command: 'pwsh.exe' },
      { name: 'broken', command: 'wsl.exe', cwd: 'relative\\path' },
    ]);
    const state = deriveConfigState(result);

    expect(state).toMatchObject({ showGuide: false, startable: 1, needsFix: 1 });
    expect(state.diagnostics).toBe(result.diagnostics);
    if (!state.showGuide) expect(state.profiles).toBe(result.profiles);
  });

  it('REQ-1.5 边界：profiles 为空数组 ⇒ 引导态 empty + 有可执行的引导文案', () => {
    const state = deriveConfigState(parseProfiles([]));
    expect(state).toMatchObject({
      showGuide: true,
      reason: 'empty',
      message: expect.stringContaining('配置页'),
    });
    expect(state.diagnostics).toStrictEqual([]);
  });

  it('REQ-1.5 边界：profiles 整键缺失（undefined）⇒ 与空数组同态', () => {
    expect(deriveConfigState(parseProfiles(undefined))).toMatchObject({
      showGuide: true,
      reason: 'empty',
    });
  });

  it('REQ-1.5 边界：条目全部无效（全被跳过）⇒ 引导态 all-invalid，文案说清「全部无效」', () => {
    const state = deriveConfigState(parseProfiles([{ name: 'a' }, { name: 'b', command: 7 }]));
    expect(state).toMatchObject({
      showGuide: true,
      reason: 'all-invalid',
      message: expect.stringContaining('2 条 profile 全部无效'),
    });
    expect(state.diagnostics).toHaveLength(2);
  });

  it('REQ-1.5 边界：条目都在但**没有一条可启动**（cwdLinux 全推导失败）⇒ 引导态 all-needs-fix', () => {
    const state = deriveConfigState(
      parseProfiles([{ name: 'w', command: 'wsl.exe', cwd: 'relative\\path' }]),
    );
    expect(state).toMatchObject({
      showGuide: true,
      reason: 'all-needs-fix',
      message: expect.stringContaining('需修复'),
    });
  });

  it('REQ-1.5 异常：profiles 不是数组 ⇒ 引导态 + 根诊断（不报错、不空白）', () => {
    const state = deriveConfigState(parseProfiles({ get: () => [] }));
    expect(state).toMatchObject({ showGuide: true, reason: 'all-invalid' });
    expect(state.diagnostics[0]?.index).toBe(-1);
  });

  it('REQ-1.5 异常：各种脏输入都不抛异常（引导态永远给得出文案）', () => {
    for (const bad of [undefined, null, {}, [], 'x', 42, [{}, null, { name: 'a' }]]) {
      expect(() => deriveConfigState(parseProfiles(bad))).not.toThrow();
      const state = deriveConfigState(parseProfiles(bad));
      if (state.showGuide) expect(state.message.length).toBeGreaterThan(0);
    }
  });
});
