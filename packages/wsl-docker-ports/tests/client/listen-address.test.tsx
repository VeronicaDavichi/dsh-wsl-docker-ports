// @vitest-environment jsdom
/**
 * 012 REQ-1.1 / REQ-2.1 的 **DOM 断言**：监听地址下拉
 *
 * 验收 A1（逐字）：`lan` 作用域的端口行里有一个 `data-testid="sel-listen-address"` 的 `<select>`，
 * 选项含默认项 `0.0.0.0（所有网卡）` 与候选 `192.168.31.129`，且**不含** `172.20.201.152` /
 * `172.20.192.1` / `127.0.0.1`（WSL/Hyper-V/loopback 都被决策 1 排除）。
 *
 * 本文件证「渲染 + 本地选择 + **选值即写配置**」（012 A 计划：选一次写一次，服务端现读它算计划）。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PortsPane } from '../../src/client/pane.tsx';
import { LISTEN_ADDRESS_ANY, LISTEN_ADDRESS_ANY_LABEL } from '../../src/client/page.ts';
import { classification, LOCAL_ADDRESSES_FIXTURE, NAT_OK, rule, snapshot } from '../unit/client-fixtures.ts';
import { harness } from './pane-harness.ts';

const LAN_IP = '192.168.31.129';

afterEach(() => {
  cleanup();
});

function lanSnapshot(options: Parameters<typeof snapshot>[0] = {}): ReturnType<typeof snapshot> {
  return snapshot({ ports: [classification('ok', 3306, { rules: [rule(3306)] })], scopes: { '3306': 'lan' }, ...options });
}

describe('REQ-1.1 监听地址下拉（lan 才有）', () => {
  it('验收 A1：lan 行有一个 sel-listen-address，选项 = 默认项 + 候选物理网卡 IP', async () => {
    const test = harness(lanSnapshot());
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const select = screen.getByTestId('sel-listen-address') as HTMLSelectElement;
    const labels = [...select.options].map((option) => option.textContent ?? '');
    const values = [...select.options].map((option) => option.value);

    expect(values[0]).toBe(LISTEN_ADDRESS_ANY);
    expect(labels[0]).toBe(LISTEN_ADDRESS_ANY_LABEL);
    expect(labels[0]).toBe('0.0.0.0（所有网卡）');
    expect(values).toContain(LAN_IP);
    expect(labels.some((label) => label.includes(LAN_IP) && label.includes('以太网 4') && label.includes('/24'))).toBe(true);

    for (const excluded of ['172.20.201.152', '172.20.192.1', '127.0.0.1']) {
      expect(values).not.toContain(excluded);
    }
    expect(select.value).toBe(LISTEN_ADDRESS_ANY);
    expect(select.disabled).toBe(false);
    console.log(`  · 扫了 ${String(select.options.length)} 个监听地址选项：${JSON.stringify(labels)}`);
  });

  it('选中一个 IP ⇒ 视图形参跟着变，并**即时写回配置**（`listenAddresses[端口]`，一次、不重试）', async () => {
    const test = harness(lanSnapshot());
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const select = screen.getByTestId('sel-listen-address') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: LAN_IP } });
    // 012 A 计划：选值 → 立刻落配置（服务端现读它算 listenaddress / RemoteAddress）。
    // 写回是 async（先 describe 取 revision 再 update）⇒ 等一拍再断言，且**恰好一次**。
    await waitFor(() => expect(test.recorded.updates).toHaveLength(1));

    expect((screen.getByTestId('sel-listen-address') as HTMLSelectElement).value).toBe(LAN_IP);
    expect(test.recorded.updates[0]?.ns).toBe('dsh-wsl-docker-ports');
    expect(test.recorded.updates[0]?.patch).toEqual({ listenAddresses: { '3306': LAN_IP } });
    // 只写配置：不触发任何提权/写通道调用（选监听地址不是写动作）
    expect(test.recorded.elevation).toHaveLength(0);
    console.log(`  · 选择 ${LAN_IP} 后：配置写 ${String(test.recorded.updates.length)} 次，patch=${JSON.stringify(test.recorded.updates[0]?.patch)}`);
  });

  it('loopback 行**没有**这个控件（loopback 恒 127.0.0.1，没有「用哪块网卡」的自由度）', async () => {
    const test = harness(snapshot({ ports: [classification('ok', 5432, { rules: [rule(5432)] })], scopes: { '5432': 'loopback' } }));
    const { container } = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    expect(container.querySelector('[data-testid="sel-listen-address"]')).toBeNull();
    expect(container.querySelector('[data-testid="sel-scope-5432"]')).not.toBeNull();
    console.log('  · loopback 行只有作用域控件，没有监听地址控件');
  });

  it('作用域从 loopback 改到 lan ⇒ 该控件当场出现（草稿驱动，无需刷新）', async () => {
    const test = harness(snapshot({ ports: [classification('ok', 5432, { rules: [rule(5432)] })], scopes: {} }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    expect(screen.queryByTestId('sel-listen-address')).toBeNull();
    fireEvent.change(screen.getByTestId('sel-scope-5432'), { target: { value: 'lan' } });
    expect(screen.getByTestId('sel-listen-address')).not.toBeNull();
    expect((screen.getByTestId('sel-listen-address') as HTMLSelectElement).value).toBe(LISTEN_ADDRESS_ANY);
    console.log('  · 切到 lan 后监听地址控件即时出现，缺省值仍是 0.0.0.0');
  });
});

describe('REQ-2.1 读失败降级：只剩默认项 + 原因文案', () => {
  it('枚举失败 ⇒ 1 个选项 + 显示原因（「读不到」不许伪装成「没有网卡」）', async () => {
    const test = harness(
      lanSnapshot({ localAddresses: [], localAddressesError: '枚举物理网卡 IPv4 失败（powershell-missing）：stub:CommandNotFound' }),
    );
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const select = screen.getByTestId('sel-listen-address') as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(select.options[0]?.value).toBe(LISTEN_ADDRESS_ANY);

    const note = screen.getByTestId('listen-address-note').textContent ?? '';
    expect(note).toContain('读不到物理网卡 IPv4 清单');
    expect(note).toContain('powershell-missing');
    console.log(`  · 降级态选项 ${String(select.options.length)} 个；原因文案 = ${note.slice(0, 60)}…`);
  });

  it('枚举成功但一个候选都没有 ⇒ 1 个选项 + 另一种原因文案（两句不许混用）', async () => {
    const test = harness(lanSnapshot({ localAddresses: [], localAddressesError: null }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    expect((screen.getByTestId('sel-listen-address') as HTMLSelectElement).options).toHaveLength(1);
    const note = screen.getByTestId('listen-address-note').textContent ?? '';
    expect(note).toContain('没有检测到候选的物理网卡 IPv4');
    expect(note).not.toContain('读不到');
    console.log(`  · 无候选态原因文案 = ${note.slice(0, 60)}…`);
  });
});

describe('NAT 门：非 NAT 时监听地址控件整块置灰（与作用域控件同门）', () => {
  it('非 NAT ⇒ select.disabled 为 true（布局照常，不给可点控件）', async () => {
    const test = harness(snapshot({ nat: { kind: 'non-nat', mode: 'mirrored', path: 'C:\\Users\\EDY\\.wslconfig', rawValue: 'mirrored' }, ports: [classification('ok', 3306, { rules: [rule(3306)] })], scopes: { '3306': 'lan' } }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const select = screen.getByTestId('sel-listen-address') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect((screen.getByTestId('sel-scope-3306') as HTMLSelectElement).disabled).toBe(true);
    console.log('  · 非 NAT 下监听地址与作用域控件一起置灰');
  });

  it('对照：NAT + ask 策略时可点（证明上一条不是恒灰）', async () => {
    const test = harness(lanSnapshot({ nat: NAT_OK }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');
    expect((screen.getByTestId('sel-listen-address') as HTMLSelectElement).disabled).toBe(false);
    expect(LOCAL_ADDRESSES_FIXTURE.length).toBe(1);
  });
});
