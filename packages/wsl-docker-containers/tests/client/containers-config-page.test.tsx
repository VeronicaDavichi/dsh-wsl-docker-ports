// @vitest-environment jsdom
/**
 * 017 六订·九 + 六订·十三：**容器页刷新频次住在容器行自己的配置页里**，且这页有**自己的保存键**。
 *
 * 主人 2026-10-27：「容器页刷新频次 把这个移到容器的内页里面」；
 * 主人 2026-10-28：「这个页面缺少保存键」。
 *
 * 每条都要能二值判定：
 * 1. 进页面就读出**当前值**（这里 30 秒 ⇒ 下拉停在 `30`）；
 * 2. 改了下拉 **先不写**（只是「有未保存的改动」），点「保存设置」才写一次 —— 写的是 `refreshIntervalSec`；
 * 3. 凭据同样进这一条保存（填了就脏，保存才写），一页一个保存键；
 * 4. 没有 settings 管道时**不装成能用**：写明原因，控件不出现（不谎报）。
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CONFIG_CID, ContainersConfigPage } from '../../src/client/containers/config-page.tsx';
import type { ContainersRuntime } from '../../src/client/containers/runtime.ts';
import type { SettingsPipe, SettingsWriteResult } from '../../src/client/settings-pipe.ts';

interface SettingsWrite {
  readonly kind: 'refresh' | 'token';
  readonly value: number | string;
}

function runtimeWith(pipe: SettingsPipe | undefined, saved?: string[]): ContainersRuntime {
  return {
    baseUrl: '',
    token: () => undefined,
    saveToken: (value: string) => {
      saved?.push(value);
    },
    settings: () => pipe,
  };
}

function ok(): SettingsWriteResult {
  return { ok: true, message: 'ok', revisionPassed: true } as unknown as SettingsWriteResult;
}

function recordingPipe(initial: number, writes: SettingsWrite[]): SettingsPipe {
  return {
    readConfig: async () => ({ distro: 'Ubuntu2204', writeTokenConfigured: false, refreshIntervalSec: initial }),
    writeRefreshInterval: async (sec: number) => {
      writes.push({ kind: 'refresh', value: sec });
      return ok();
    },
    writeWriteToken: async (token: string) => {
      writes.push({ kind: 'token', value: token });
      return ok();
    },
  } as unknown as SettingsPipe;
}

afterEach(() => {
  cleanup();
});

describe('容器行配置页：刷新频次 + 凭据，共用一条「保存设置」', () => {
  it('R1 初值读自配置；改了下拉先不写，点保存才写一次', async () => {
    const writes: SettingsWrite[] = [];
    render(<ContainersConfigPage runtime={runtimeWith(recordingPipe(30, writes))} /> as never);

    await waitFor(() => {
      expect((screen.getByTestId(CONFIG_CID.refresh) as HTMLSelectElement).value).toBe('30');
    });
    expect(screen.getByTestId(CONFIG_CID.refreshState).textContent).toContain('每 30 秒');
    // 主人 2026-10-28：「把『WSL Docker 容器（本行配置）』『只显示容器行独占的字段……』这些字去掉
    // 剩下的东西保持 css 和其他的一致」⇒ 只剩字段 + 页脚，且用与转发侧同一套类名
    expect(screen.queryByText(/本行配置/u)).toBeNull();
    expect(screen.queryByText(/只显示容器行独占/u)).toBeNull();
    expect(screen.getByText('容器页刷新频次').className).toBe('wdp-cfg-label');
    expect((screen.getByTestId(CONFIG_CID.refresh) as HTMLSelectElement).className).toBe('wdp-cfg-input');
    // 保存键：没改 ⇒ 置灰、状态「设置已保存」
    const saveBtn = screen.getByTestId(CONFIG_CID.save) as HTMLButtonElement;
    expect(saveBtn.textContent).toBe('保存设置');
    expect(saveBtn.disabled).toBe(true);
    expect(screen.getByTestId(CONFIG_CID.status).textContent).toBe('设置已保存');

    fireEvent.change(screen.getByTestId(CONFIG_CID.refresh), { target: { value: '60' } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(writes).toHaveLength(0); // 只是草稿
    expect(screen.getByTestId(CONFIG_CID.status).textContent).toBe('有未保存的改动');
    expect((screen.getByTestId(CONFIG_CID.save) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId(CONFIG_CID.save));
    await waitFor(() => {
      expect(writes).toEqual([{ kind: 'refresh', value: 60 }]);
    });
    await waitFor(() => {
      expect(screen.getByTestId(CONFIG_CID.status).textContent).toBe('设置已保存');
    });
    console.log(`  · R1 初值 30 秒 → 改成 60 秒：改完 0 写、点保存后 ${String(writes.length)} 写`);
  });

  it('R2 关闭档（0）⇒ 明说「不自动刷新（只手动）」，不留一个空下拉', async () => {
    const writes: SettingsWrite[] = [];
    render(<ContainersConfigPage runtime={runtimeWith(recordingPipe(0, writes))} /> as never);
    await waitFor(() => {
      expect((screen.getByTestId(CONFIG_CID.refresh) as HTMLSelectElement).value).toBe('0');
    });
    expect(screen.getByTestId(CONFIG_CID.refreshState).textContent).toContain('不自动刷新');
    console.log('  · R2 关闭档：值 0、文案含「不自动刷新」');
  });

  it('R3 凭据也走这一条保存：填了就脏，保存才写，写完清空并标「已配置」', async () => {
    const writes: SettingsWrite[] = [];
    const saved: string[] = [];
    render(<ContainersConfigPage runtime={runtimeWith(recordingPipe(15, writes), saved)} /> as never);
    await waitFor(() => {
      expect((screen.getByTestId(CONFIG_CID.refresh) as HTMLSelectElement).value).toBe('15');
    });
    fireEvent.change(screen.getByTestId(CONFIG_CID.token), { target: { value: 'abc123' } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(writes).toHaveLength(0);
    expect(screen.getByTestId(CONFIG_CID.status).textContent).toBe('有未保存的改动');

    fireEvent.click(screen.getByTestId(CONFIG_CID.save));
    await waitFor(() => {
      expect(writes).toEqual([{ kind: 'token', value: 'abc123' }]);
    });
    await waitFor(() => {
      expect((screen.getByTestId(CONFIG_CID.token) as HTMLInputElement).value).toBe('');
    });
    expect(screen.getByTestId(CONFIG_CID.tokenState).textContent).toContain('已配置');
    // 019 AC3：手填保存也**一步到位**（服务端写完顺手写客户端存储）⇒ 不用再去右栏粘一次
    expect(saved).toEqual(['abc123']);
    console.log(`  · R3 凭据：保存前 0 写、保存后 ${String(writes.length)} 写（refresh 没动就不写）；客户端存储同步 1 次`);
  });

  it('R5「生成并保存」一步到位：恰好 1 次服务端写 + 客户端存储收同一串 + 明文只显示这一次', async () => {
    const writes: SettingsWrite[] = [];
    const saved: string[] = [];
    render(<ContainersConfigPage runtime={runtimeWith(recordingPipe(0, writes), saved)} /> as never);
    await waitFor(() => {
      expect(screen.getByTestId(CONFIG_CID.generate)).toBeTruthy();
    });
    expect(screen.queryByTestId(CONFIG_CID.issued)).toBeNull(); // 没点之前没有明文

    fireEvent.click(screen.getByTestId(CONFIG_CID.generate));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });

    const written = writes[0];
    expect(written?.kind).toBe('token');
    const token = String(written?.value);
    expect(token).toMatch(/^[0-9a-f]{64}$/u); // 32 字节 = 64 位 hex
    expect(saved).toEqual([token]); // 019 AC1：客户端存储 = 同一串
    expect(screen.getByTestId(CONFIG_CID.issued).textContent).toContain(token);
    expect(screen.getByTestId(CONFIG_CID.tokenState).textContent).toContain('已配置');
    // 明文不进无障碍树（与转发侧同口径）
    expect(screen.getByTestId(CONFIG_CID.issued).getAttribute('aria-hidden')).toBe('true');
    console.log(`  · R5 生成：服务端写 1 次、客户端存 1 次、明文 64hex 显示一次（aria-hidden）`);
  });

  it('R6「生成并保存」写服务端失败 ⇒ **不**写客户端存储（否则会显示已保存却仍 401）', async () => {
    const saved: string[] = [];
    const failing = {
      readConfig: async () => ({ distro: 'Ubuntu2204', writeTokenConfigured: false, refreshIntervalSec: 0 }),
      writeRefreshInterval: async () => ok(),
      writeWriteToken: async () => ({ ok: false, message: 'revision conflict', revisionPassed: false }) as unknown as SettingsWriteResult,
    } as unknown as SettingsPipe;
    render(<ContainersConfigPage runtime={runtimeWith(failing, saved)} /> as never);
    await waitFor(() => {
      expect(screen.getByTestId(CONFIG_CID.generate)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId(CONFIG_CID.generate));
    await waitFor(() => {
      expect(screen.getByTestId(CONFIG_CID.message).textContent ?? '').toContain('保存失败');
    });
    expect(saved).toEqual([]);
    console.log('  · R6 服务端写失败：客户端 0 写、页面明说“保存失败”');
  });

  it('R4 没有 settings 管道 ⇒ 写明原因、控件不出现（不装成能用）', async () => {
    render(<ContainersConfigPage runtime={runtimeWith(undefined)} /> as never);
    await waitFor(() => {
      expect(screen.getByTestId(CONFIG_CID.unavailable)).toBeTruthy();
    });
    expect(screen.queryByTestId(CONFIG_CID.refresh)).toBeNull();
    expect(screen.queryByTestId(CONFIG_CID.save)).toBeNull();
    console.log('  · R4 无管道：提示「设置服务不可用」且没有刷新控件与保存键');
  });
});
