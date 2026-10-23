// @vitest-environment jsdom
/**
 * 013 渲染面：`extra` 的三种结局 + 未知态
 *
 * 验收面（真实 DOM 渲染，不靠读源码）：
 * - 未知（`listeners-unknown`，含旧服务端的 `no-docker-mapping`）⇒ 标签「未知（无法确认服务是否在跑）」+
 *   文案「无法确认服务是否在跑（WSL 停止或探测失败）」，且**「移除」按钮仍可点**（主人裁定）；
 * - `no-listener` ⇒ 「WSL 内没有进程监听该端口」；
 * - `loopback-only` ⇒ 「该端口只在 WSL 回环上监听，转发规则连不到它」；
 * - **旧文案必须消失**：页面上任何位置都不许再出现「docker 已不再映射」；
 * - 监听表读失败 ⇒ 页头给一句人话（不是静默把全部规则说成多余）。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PortsPane } from '../../src/client/pane.tsx';
import { classification, snapshot } from '../unit/client-fixtures.ts';
import { harness } from './pane-harness.ts';

afterEach(() => {
  cleanup();
});

const UNKNOWN_LABEL = '未知（无法确认服务是否在跑）';
const UNKNOWN_TEXT = '无法确认服务是否在跑（WSL 停止或探测失败）';

async function mount(ports: readonly ReturnType<typeof classification>[]): Promise<HTMLElement> {
  const test = harness(snapshot({ ports }));
  const { container } = render(<PortsPane runtime={test.runtime} />);
  await screen.findByTestId('tbl-ports');
  return container;
}

function rowOf(container: HTMLElement, port: number): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-port="${String(port)}"]`);
  expect(row).not.toBeNull();
  if (row === null) throw new Error(`找不到端口 ${String(port)} 的行`);
  return row;
}

describe('013 未知态：读不到监听表 ≠ 没有监听', () => {
  it('`listeners-unknown`：标签/文案换成「未知」，但「移除」仍可点（不去禁用）', async () => {
    const container = await mount([classification('extra', 3306, { reason: 'listeners-unknown' })]);
    const row = rowOf(container, 3306);

    expect(row.getAttribute('data-state')).toBe('extra');
    expect(screen.getByTestId('state-3306').textContent).toBe(UNKNOWN_LABEL);
    expect(row.textContent).toContain(UNKNOWN_TEXT);
    expect(row.textContent).not.toContain('多余规则');

    const remove = screen.getByTestId('btn-remove-3306') as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    console.log(`  · listeners-unknown：标签=「${String(screen.getByTestId('state-3306').textContent)}」/ 移除 disabled=${String(remove.disabled)}`);
  });

  it('旧服务端的 `no-docker-mapping` 也按未知渲染，且**旧文案**「docker 已不再映射」彻底消失', async () => {
    const container = await mount([classification('extra', 3307, { reason: 'no-docker-mapping' })]);
    const row = rowOf(container, 3307);

    expect(screen.getByTestId('state-3307').textContent).toBe(UNKNOWN_LABEL);
    expect(row.textContent).toContain(UNKNOWN_TEXT);
    expect(container.textContent).not.toContain('docker 已不再映射');
    expect((screen.getByTestId('btn-remove-3307') as HTMLButtonElement).disabled).toBe(false);
  });

  it('监听表读失败 ⇒ 页头给一句可定位的人话（不是静默）', async () => {
    const test = harness(
      snapshot({
        ports: [classification('extra', 3308, { reason: 'listeners-unknown' })],
        listeners: { ok: false, reason: 'wsl-stopped', message: '发行版「Ubuntu2204」当前未运行', hint: '需要时点「启动并核验」', raw: null },
      }),
    );
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');
    expect(screen.getByText(/监听表读取失败/u)).toBeTruthy();
  });
});

describe('013 「没有监听」与「只在回环」的文案', () => {
  it('`no-listener`：标签保持「多余规则（可移除）」，文案说清「WSL 内没有进程监听」', async () => {
    const container = await mount([classification('extra', 3309, { reason: 'no-listener' })]);
    const row = rowOf(container, 3309);

    expect(screen.getByTestId('state-3309').textContent).toBe('多余规则（可移除）');
    expect(row.textContent).toContain('WSL 内没有进程监听该端口');
    expect((screen.getByTestId('btn-remove-3309') as HTMLButtonElement).disabled).toBe(false);
  });

  it('`loopback-only`：文案说清「只在回环监听，转发连不到」', async () => {
    const container = await mount([classification('extra', 3310, { reason: 'loopback-only' })]);
    const row = rowOf(container, 3310);

    expect(row.textContent).toContain('该端口只在 WSL 回环上监听，转发规则连不到它');
    expect((screen.getByTestId('btn-remove-3310') as HTMLButtonElement).disabled).toBe(false);
  });

  it('`listener-active`：规则在用（ok）时也给一句正向解释（不误报「多余」）', async () => {
    const container = await mount([classification('ok', 3311, { reason: 'listener-active' })]);
    const row = rowOf(container, 3311);

    expect(row.getAttribute('data-state')).toBe('ok');
    expect(row.textContent).toContain('WSL 内有进程监听该端口，规则可以连到它');
    expect(container.textContent).not.toContain('docker 已不再映射');
  });
});
