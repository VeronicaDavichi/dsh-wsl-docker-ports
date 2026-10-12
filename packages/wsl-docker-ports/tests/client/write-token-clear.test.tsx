// @vitest-environment jsdom
/**
 * 009 T2.1 判据⑤ + **T3 根治**：配置页「清除凭据」—— 清除 = 宿主 `mutate` 的 `unset`（**不是**写空串）
 * —— 2026-10-12 009 收口轮从 `write-token-pane.test.tsx` 拆出（拆前该文件 `split('\n')` = **480**，超 SHALL 400）
 *
 * 判据：
 * ⑤ 二次确认前 `update`/`mutate` 均 **0** 次 ⇒ 确认后**恰好 1 次 `mutate`**（ops 逐字 = `[{op:'unset',path:['writeToken']}]`、**实参 3 个**）、`update` **0** 次、本会话已清；
 * ⑤b 取消 ⇒ 零写入，凭据原样留着（不是「删一半」）；
 * ⑤c 🔴 **反例钉死**：把「清除」写成写空串，在**同一份宿主判据**下 `set` 仍为 `true` ⇒ 页面会显示「已配置」（= 修前症状）；
 * ⑤d 🔴 **刷新一致性**：清除后**重新挂载**再检查 ⇒ 「未配置」，且**没清过的对照 runtime 仍报「已配置」** ⇒ 布尔来自服务端视图、不是内存推断；
 * ⑦b 清除时服务端拒绝 ⇒ 不静默、本会话**不**清（避免两边不一致）。
 *
 * 台架（确定性随机源 / 假存储 / 照宿主脱敏口径的假 `remote.settings` / 挂载）在 `./write-token-harness.ts`。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PortsPane } from '../../src/client/pane.tsx';
import { WRITE_TOKEN_TESTID } from '../../src/client/pane-settings.tsx';
import { SETTINGS_NAMESPACE } from '../../src/client/settings-pipe.ts';
import { WRITE_TOKEN_STORAGE_KEY } from '../../src/client/write-token.ts';
import { cleanup } from '@testing-library/react';
import { harness, mountPane, resetDom, stubRandom } from './write-token-harness.tsx';

beforeEach(() => {
  stubRandom();
});

afterEach(() => {
  resetDom();
});
describe('009 T2.1 判据⑤ + T3 根治：清除 = 宿主 `mutate` 的 unset（**不是**写空串）', () => {
  it('⑤ 点「清除凭据」⇒ 确认前零写入；确认后恰好一次 unset（实参 3 个）+ 清本会话', async () => {
    const seeded = 'c'.repeat(64);
    const test = harness({ seed: seeded, config: { writeToken: 'a'.repeat(64) } });
    await mountPane(test.runtime);

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clear));
    // 二次确认**真的**生效：确认之前一个字节都没写出去（update / mutate 都是 0）
    expect(test.recorded.updates).toHaveLength(0);
    expect(test.recorded.mutates).toHaveLength(0);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.clearConfirm)).toBeDefined();
    expect(test.storage.box.get(WRITE_TOKEN_STORAGE_KEY)).toBe(seeded);

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clearConfirm));
    await waitFor(() => {
      expect(test.recorded.mutates).toHaveLength(1);
    });
    // 🔴 判据的核心：清除**不再**写值 —— 一个 `update` 都没有，发的是一条按路径的 unset
    expect(test.recorded.updates).toHaveLength(0);
    expect(test.recorded.mutates[0]?.ops).toEqual([{ op: 'unset', path: ['writeToken'] }]);
    expect(test.recorded.mutates[0]?.ns).toBe(SETTINGS_NAMESPACE);
    expect(test.recorded.mutates[0]?.argCount).toBe(3);
    // 服务端那格**真的**被删掉（不是写成空串 —— 空串在宿主判据里仍算「已配置」）
    expect('writeToken' in test.config).toBe(false);
    expect(test.storage.box.has(WRITE_TOKEN_STORAGE_KEY)).toBe(false);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-session-credential')).toBe('0');
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-config-configured')).toBe('0');
    console.log('  · 扫了 1 次清除：确认前 0 次写 / 确认后 1 次 mutate（ops 恰 [{op:"unset",path:["writeToken"]}]、实参 3 个）/ update 0 次 / 本会话已清');
  });

  it('⑤c T3 反例钉死：把「清除」写成空串 update，在**同一份宿主口径**下 `set` 仍为 true ⇒ 页面会显示「已配置」', async () => {
    // 这条不是测产品代码，是把**修前的错误做法**跑一遍留下证据：宿主判据是 `set: value !== void 0`
    // ⇒ 空串照样算「已配置」。修前正是这样：清除后重载页面显示「已配置」而写通道 401。
    const test = harness({ seed: 'f'.repeat(64), config: { writeToken: 'a'.repeat(64) } });
    await mountPane(test.runtime);
    await test.runtime.settings?.writeWriteToken('');
    // 空串仍是一个「存在的键」
    expect('writeToken' in test.config).toBe(true);
    const described = await test.runtime.settings?.readConfig();
    // 宿主判据 `value !== void 0` 对空串给 true ⇒ 两态不一致（这就是 T3 的根因）
    expect(described?.writeTokenConfigured).toBe(true);
    console.log('  · 反例扫了 1 次：写空串后宿主仍报 `set:true`（修前症状 = 显示「已配置」而实际 401）');
  });

  it('⑤b 点「取消」⇒ 零写入，凭据原样留着（不是「删一半」）', async () => {
    const seeded = 'd'.repeat(64);
    const test = harness({ seed: seeded });
    await mountPane(test.runtime);

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clear));
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clearCancel));
    expect(test.recorded.updates).toHaveLength(0);
    expect(test.recorded.mutates).toHaveLength(0);
    expect(test.storage.box.get(WRITE_TOKEN_STORAGE_KEY)).toBe(seeded);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-session-credential')).toBe('1');
    expect(screen.queryByTestId(WRITE_TOKEN_TESTID.clearConfirm)).toBeNull();
    console.log('  · 扫了 1 次取消：写入 0 次、凭据 1 次仍在、确认按钮已收起');
  });

  it('⑤d 清除后**重新挂载**（= 刷新）再点检查 ⇒ 仍是「未配置」（布尔来自服务端，不是内存推断）', async () => {
    const test = harness({ seed: 'g'.repeat(64), config: { writeToken: 'a'.repeat(64) } });
    const first = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId(WRITE_TOKEN_TESTID.block);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.check));
    await waitFor(() => {
      expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-config-configured')).toBe('1');
    });

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clear));
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clearConfirm));
    await waitFor(() => {
      expect(test.recorded.mutates).toHaveLength(1);
    });
    first.unmount();
    cleanup();

    // 反向对照：同一份假宿主在**没清过**的实例上仍报「已配置」⇒ 下面的 0 不是恒真
    const fresh = harness({ config: { writeToken: 'a'.repeat(64) } });
    render(<PortsPane runtime={fresh.runtime} />);
    await screen.findByTestId(WRITE_TOKEN_TESTID.block);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.check));
    await waitFor(() => {
      expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-config-configured')).toBe('1');
    });
    cleanup();

    // 真判据：清过的那个 runtime 重新挂载 + 重新读一次 ⇒ 服务端报未配置
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId(WRITE_TOKEN_TESTID.block);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-config-configured')).toBe('unknown');
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.check));
    await waitFor(() => {
      expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-config-configured')).toBe('0');
    });
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-session-credential')).toBe('0');
    console.log('  · 扫了 2 个 runtime：清过的重挂载后 check ⇒ 未配置（0）；没清过的 ⇒ 已配置（1）—— 布尔随服务端视图走');
  });
});

describe('009 T2.1 判据⑦b：清除时服务端拒绝（不静默、不半清）', () => {
  it('⑦b 清除时服务端拒绝 ⇒ 不静默、本会话**不**清（避免两边不一致）', async () => {
    const seeded = 'e'.repeat(64);
    const test = harness({ seed: seeded, mutateFails: '写入被拒绝' });
    await mountPane(test.runtime);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clear));
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clearConfirm));

    await waitFor(() => {
      expect(screen.getByTestId(WRITE_TOKEN_TESTID.note).textContent).toContain('写入被拒绝');
    });
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.note).textContent).toContain('保留');
    expect(test.storage.box.get(WRITE_TOKEN_STORAGE_KEY)).toBe(seeded);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-session-credential')).toBe('1');
    console.log('  · 扫了 1 条清除失败路径：提示带原因 + 本会话凭据保留（1 个）');
  });
});
