// @vitest-environment jsdom
/**
 * 017 六订·九：**容器页刷新频次住在容器行自己的配置页里**。
 *
 * 主人 2026-10-27 原话：「容器页刷新频次 把这个移到容器的内页里面」——
 * 之前它在转发行的配置页上（因为两个组件共用一份 settings 管道），但那个字段只影响容器页，
 * 等于让另一个组件替你改自己的刷新节奏。
 *
 * 三条都要能二值判定：
 * 1. 进页面就读出**当前值**（这里 30 秒 ⇒ 下拉停在 `30`）；
 * 2. 改一次就写一次（不需要再点「保存」这种二次确认），写的是 `refreshIntervalSec`；
 * 3. 没有 settings 管道时**不装成能用**：写明原因，控件不出现（不谎报）。
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CONFIG_CID, ContainersConfigPage } from '../../src/client/containers/config-page.tsx';
import type { ContainersRuntime } from '../../src/client/containers/runtime.ts';
import type { SettingsPipe } from '../../src/client/settings-pipe.ts';

interface SettingsWrite {
  readonly sec: number;
}

function runtimeWith(pipe: SettingsPipe | undefined): ContainersRuntime {
  return {
    baseUrl: '',
    token: () => undefined,
    saveToken: () => undefined,
    settings: () => pipe,
  };
}

function recordingPipe(initial: number, writes: SettingsWrite[]): SettingsPipe {
  return {
    readConfig: async () => ({ distro: 'Ubuntu2204', writeTokenConfigured: false, refreshIntervalSec: initial }),
    writeRefreshInterval: async (sec: number) => {
      writes.push({ sec });
      return { ok: true, message: 'ok', patch: { refreshIntervalSec: sec }, revisionPassed: false };
    },
  } as unknown as SettingsPipe;
}

afterEach(() => {
  cleanup();
});

describe('容器行配置页：刷新频次就在这一页', () => {
  it('R1 初值读自配置：30 秒 ⇒ 下拉停在 30；改一次写一次', async () => {
    const writes: SettingsWrite[] = [];
    render(<ContainersConfigPage runtime={runtimeWith(recordingPipe(30, writes))} /> as never);

    await waitFor(() => {
      expect((screen.getByTestId(CONFIG_CID.refresh) as HTMLSelectElement).value).toBe('30');
    });
    expect(screen.getByTestId(CONFIG_CID.refreshState).textContent).toContain('每 30 秒');

    fireEvent.change(screen.getByTestId(CONFIG_CID.refresh), { target: { value: '60' } });
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(writes).toEqual([{ sec: 60 }]);
    });
    console.log(`  · R1 初值 30 秒、改成 60 秒 ⇒ 写 ${String(writes.length)} 次（${JSON.stringify(writes)}）`);
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

  it('R3 没有 settings 管道 ⇒ 写明原因、控件不出现（不装成能用）', async () => {
    render(<ContainersConfigPage runtime={runtimeWith(undefined)} /> as never);
    await waitFor(() => {
      expect(screen.getByTestId(CONFIG_CID.unavailable)).toBeTruthy();
    });
    expect(screen.queryByTestId(CONFIG_CID.refresh)).toBeNull();
    console.log('  · R3 无管道：提示「设置服务不可用」且没有刷新控件');
  });
});
