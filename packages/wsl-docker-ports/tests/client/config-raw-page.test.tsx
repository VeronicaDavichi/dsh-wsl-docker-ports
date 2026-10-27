// @vitest-environment jsdom
/**
 * 017 六订·二：**行级配置页**（`plugins.row.config`，键 = 插件 id `wsl-ports`）的 DOM 判据。
 *
 * 主人 2026-10-27 三次拍板后定死的位置（原话）：
 *   「原始输出请放到配置页的转发的子组件下面的地方」
 *   「在子组件的下面，而不是在子组件的外面」
 *   「位置在：点击 wsl port forwarding 子组件名字，之后打开的新页面里面」
 * ⇒ 那一页 = 这个 `RawOutputPage`。它只放**只读**原始输出，且**点开才读**：
 *   配置页加载期零读（`docker ps` 冷启 2–5 s），展开/收起不重复读。
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RawOutputPage } from '../../src/client/config-write.tsx';

afterEach(() => {
  cleanup();
});

const SAMPLE = 'CONTAINER ID   IMAGE\nabc123   nginx:latest';

describe('017 行级配置页（点「WSL Port Forwarding」名字进去的那一页）', () => {
  it('R1 页面在、分组框在、卡片在；进页面**零读**', async () => {
    let reads = 0;
    render(<RawOutputPage loadRawOutput={async () => {
      reads += 1;
      return SAMPLE;
    }} />);
    expect(screen.getByTestId('config-raw-page')).toBeTruthy();
    expect(screen.getByTestId('config-raw-output-card').className).toBe('wdp-cfg-card');
    expect(screen.getByTestId('config-raw-output').textContent).toBe('查看原始输出');
    // 进页面不读：这条 2–5 秒的冷启只落在真点开的人身上
    expect(reads).toBe(0);
    expect(screen.queryByTestId('config-raw-output-body')).toBeNull();
    console.log(`  · R1 行级页在、卡片在；进页读 ${String(reads)} 次`);
  });

  it('R2 点开才读**一次**并显示原文；收起再展开不重复读', async () => {
    let reads = 0;
    render(<RawOutputPage loadRawOutput={async () => {
      reads += 1;
      return SAMPLE;
    }} />);
    const button = screen.getByTestId('config-raw-output');
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByTestId('config-raw-output-body').textContent ?? '').toContain('nginx:latest');
    });
    expect(reads).toBe(1);
    expect(button.textContent).toBe('收起原始输出');

    fireEvent.click(button); // 收起
    fireEvent.click(button); // 再展开
    await act(async () => {
      await Promise.resolve();
    });
    expect(reads).toBe(1);
    console.log(`  · R2 点开读 ${String(reads)} 次（展开/收起/再展开都不加读）`);
  });

  it('R3 未接线（load 缺省）⇒ 按钮置灰并写明原因，不谎报成功', async () => {
    render(<RawOutputPage />);
    const button = screen.getByTestId('config-raw-output') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('未接线');
    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('config-raw-output-body')).toBeNull();
    console.log(`  · R3 未接线：disabled=${String(button.disabled)}、原因「${button.title}」`);
  });

  it('R4 读失败 ⇒ 就地报错原因，不装成「空输出」', async () => {
    render(<RawOutputPage loadRawOutput={async () => {
      throw new Error('docker 不可用');
    }} />);
    fireEvent.click(screen.getByTestId('config-raw-output'));
    await waitFor(() => {
      expect(screen.getByTestId('config-raw-output-body').textContent).toBe('');
    });
    expect(screen.getByText(/读取失败：docker 不可用/u)).toBeTruthy();
    console.log('  · R4 读失败：页面写明「读取失败：docker 不可用」');
  });
});
