// @vitest-environment jsdom
/**
 * T5.1–T5.7 的 **DOM 渲染与接线**断言（vitest + jsdom + @testing-library/react）
 * —— **只读展示面**（写回 / 失败态 / 样式注入在 `pane-write.test.tsx`，2026-10-12 009 收口轮 T5 拆）
 *
 * 这个文件同时承担两件「只有真渲染才证得动」的事：
 * ① **开页零写操作**（NFR-2）：挂载后配置写入 0 次、提权调用 0 次 —— 由独立计数器给出，不看退出码；
 * ② **JSX 真能编译**：本文件含真实 JSX，能跑起来就说明 vitest 的 JSX 转换（vitest 5 走 oxc，
 *    按 `tsconfig.json` 的 `jsx: "react-jsx"`）确实生效 —— 这是「配置写了但被忽略」的唯一检测手段。
 *
 * 另：`@vitest-environment jsdom` 必须在文件首行注释里（vitest 的 per-file 指令）。
 * 台架（注入式 runtime + 计数器）在 `./pane-harness.ts`：两个文件共用，**不含 `it()`**。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PortsPane } from '../../src/client/pane.tsx';
import { PORT_STATES } from '../../src/diff/types.ts';
import { externalRulesFromFixture, classification, container, NAT_NON_NAT, NAT_OK, rule, snapshot, unsupportedMapping, ETH0, OLD_ETH0 } from '../unit/client-fixtures.ts';
import { harness } from './pane-harness.ts';

afterEach(() => {
  cleanup();
});

describe('T5.1 开页只读（NFR-2）', () => {
  it('挂载后：快照读 1 次、配置写入 0 次、提权调用 0 次', async () => {
    const test = harness(snapshot({ ports: [classification('ok', 3306, { rules: [rule(3306)] })] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    expect(test.recorded.loads).toHaveLength(1);
    expect(test.recorded.updates).toHaveLength(0);
    // 014：选择器要回填「上次选的档」，故挂载期多一次**只读** describe（`readConfig`）。
    // 判据本体（开页零配置**写**、零提权）一字未松：updates / elevation 仍然各 0。
    expect(test.recorded.describes).toBe(1);
    expect(test.recorded.elevation).toHaveLength(0);
    console.log(`  · 开页扫了 ${String(test.recorded.loads.length)} 次读 / ${String(test.recorded.describes)} 次配置读 / ${String(test.recorded.updates.length)} 次配置写 / ${String(test.recorded.elevation.length)} 次提权`);
  });

  it('五态各自渲染出一行，标签与状态位一一对应', async () => {
    const ports = PORT_STATES.map((state, index) => classification(state, 6000 + index));
    const test = harness(snapshot({ ports }));
    const { container } = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const rows = container.querySelectorAll('[data-port]');
    expect(rows).toHaveLength(5);
    for (const [index, state] of PORT_STATES.entries()) {
      const row = container.querySelector(`[data-port="${String(6000 + index)}"]`);
      expect(row?.getAttribute('data-state')).toBe(state);
      expect(row?.querySelector(`[data-testid="state-${String(6000 + index)}"]`)?.textContent ?? '').not.toBe('');
    }
    const tags = [...container.querySelectorAll('.wdp-tag')].map((node) => node.textContent);
    expect(new Set(tags).size).toBe(5);
    console.log(`  · 渲染了 ${String(rows.length)} 行 / ${String(tags.length)} 个状态标签：${JSON.stringify(tags)}`);
  });

  it('刷新后「上次刷新」时间戳真的变了（不是静态文案）', async () => {
    const test = harness(snapshot({ refreshedAt: Date.UTC(2026, 9, 9, 1, 0, 0) }));
    const { container } = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');
    const before = container.querySelector('[data-testid="last-refreshed"]')?.textContent ?? '';

    test.push(snapshot({ refreshedAt: Date.UTC(2026, 9, 9, 2, 30, 0) }));
    fireEvent.click(screen.getByTestId('btn-refresh'));
    await waitFor(() => {
      expect(container.querySelector('[data-testid="last-refreshed"]')?.textContent ?? '').not.toBe(before);
    });
    const after = container.querySelector('[data-testid="last-refreshed"]')?.textContent ?? '';
    expect(test.recorded.updates).toHaveLength(0);
    console.log(`  · 刷新扫了 2 个时间戳：「${before}」→「${after}」；配置写 ${String(test.recorded.updates.length)} 次`);
  });
});

describe('T5.2 非 NAT：写控件全灰 + 修复指引', () => {
  it('非 NAT 下没有任何可点的转发写控件；提权档仍可改（配置页在真机上没有座位 ⇒ 写入口留在右栏页）', async () => {
    const test = harness(snapshot({ nat: NAT_NON_NAT, ports: [classification('missing', 3306)] }));
    const { container } = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const controls = container.querySelectorAll('[data-write-control]');
    const clickable = container.querySelectorAll('[data-write-control]:not([disabled])');
    expect(controls.length).toBeGreaterThan(0);
    expect(clickable).toHaveLength(0);
    // 🔴 2026-10-22 真机反馈订正：`plugins.row.config` 在本机 profile 的「内置插件」里**没有座位**
    //（那是 `@deepseek-ai/dsh-plugin-manager` 自己的列表）⇒ 若把提权档做成只读，用户就**无处可改**。
    // 因此写入口**回到右栏页**，配置页只作为将来的备选面（存在也不会抢入口）。
    expect((screen.getByTestId('sel-elevation') as HTMLSelectElement).disabled).toBe(false);
    expect(screen.queryByTestId('elevation-readonly-pointer')).toBeNull();

    // 反向对照：NAT 下同一批控件真的有可点的，否则上面的 0 是「整体点不动」的假象
    const ok = harness(snapshot({ nat: NAT_OK, ports: [classification('missing', 3306)] }));
    cleanup();
    const second = render(<PortsPane runtime={ok.runtime} />);
    await screen.findByTestId('tbl-ports');
    const clickableOk = second.container.querySelectorAll('[data-write-control]:not([disabled])');
    expect(clickableOk.length).toBeGreaterThan(0);
    console.log(`  · 非 NAT 扫了 ${String(controls.length)} 个写控件（可点 ${String(clickable.length)} 个）；NAT 扫了 ${String(second.container.querySelectorAll('[data-write-control]').length)} 个（可点 ${String(clickableOk.length)} 个）；sel-elevation 可用`);
  });

  it('修复指引给出具体文件路径 + 可复制命令文本', async () => {
    const test = harness(snapshot({ nat: NAT_NON_NAT }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    fireEvent.click(screen.getByTestId('btn-nat-guide'));
    const body = await screen.findByTestId('nat-guide-body');
    expect(body.textContent).toContain('C:\\Users\\EDY\\.wslconfig');
    expect(screen.getByTestId('nat-guide-command').textContent).toContain('wsl --shutdown');
    expect(body.textContent).toContain('不会自动修改');
    console.log(`  · 指引扫了 ${String(body.querySelectorAll('li').length)} 条步骤 + 1 段命令文本`);
  });
});

describe('T5.3 逐端口作用域', () => {
  it('反向对照：转发写路径确实可触发（提权入口真接了，不是「压根没有」）', async () => {
    const test = harness(snapshot({ nat: NAT_OK, elevationPolicy: 'ask', elevationAvailable: true, ports: [classification('missing', 3306)] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const apply = screen.getByTestId('btn-apply-3306') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    await waitFor(() => {
      expect(test.recorded.elevation).toHaveLength(1);
    });
    expect(test.recorded.elevation[0]).toEqual({ action: 'apply', port: 3306, scope: 'loopback' });
    expect(test.recorded.updates).toHaveLength(0);
    console.log(`  · 反向对照扫了 ${String(test.recorded.elevation.length)} 次提权调用 / ${String(test.recorded.updates.length)} 次配置写`);
  });

  it('切换一个端口的作用域 ⇒ 只写该端口、只改配置（提权 0 次）', async () => {
    const test = harness(
      snapshot({ ports: [classification('ok', 3306, { rules: [rule(3306)] }), classification('ok', 5432, { rules: [rule(5432)] })] }),
    );
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    fireEvent.change(screen.getByTestId('sel-scope-3306'), { target: { value: 'lan' } });
    await waitFor(() => {
      expect(test.recorded.updates).toHaveLength(1);
    });
    expect(test.recorded.updates[0]?.patch).toEqual({ scopes: { '3306': 'lan' } });
    expect((screen.getByTestId('sel-scope-5432') as HTMLSelectElement).value).toBe('loopback');
    expect(test.recorded.elevation).toHaveLength(0);
    console.log(`  · 扫了 2 个作用域控件，patch=${JSON.stringify(test.recorded.updates[0]?.patch)}；提权 ${String(test.recorded.elevation.length)} 次`);
  });
});

describe('T5.5 / T5.7 只读区', () => {
  it('UDP 常驻提示可见，UDP 行标「不支持」', async () => {
    const test = harness(
      snapshot({
        ports: [classification('ok', 8080, { rules: [rule(8080)] })],
        diff: {
          ok: true,
          result: {
            ports: [classification('ok', 8080, { rules: [rule(8080)] })],
            expected: [],
            external: [],
            unsupported: [unsupportedMapping('redis-cache', 6379)],
            counts: { ok: 1, missing: 0, drift: 0, conflict: 0, extra: 0 },
            eth0Ip: ETH0,
          },
        },
      }),
    );
    const { container } = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    expect(screen.getByTestId('tip-udp').textContent).toContain('UDP');
    const rows = container.querySelectorAll('[data-testid="tbl-unsupported"] tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('不支持');
    console.log(`  · 扫了 ${String(rows.length)} 条不可转发行 + 1 条常驻提示`);
  });

  it('19 条外部规则进只读区，区域内**没有任何**可交互控件', async () => {
    const external = externalRulesFromFixture();
    const test = harness(
      snapshot({
        diff: {
          ok: true,
          result: { ports: [], expected: [], external, unsupported: [], counts: { ok: 0, missing: 0, drift: 0, conflict: 0, extra: 0 }, eth0Ip: ETH0 },
        },
      }),
    );
    const { container } = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('external-rules');

    const region = container.querySelector('[data-testid="external-rules"]');
    const rows = region?.querySelectorAll('li') ?? [];
    const interactive = region?.querySelectorAll('button, select, input, textarea, a[href]') ?? [];
    expect(rows).toHaveLength(19);
    expect(interactive).toHaveLength(0);
    expect(region?.textContent).toContain('外部规则');
    console.log(`  · 只读区扫了 ${String(rows.length)} 行 / ${String(interactive.length)} 个可交互控件（要求 0）`);
  });

  it('exec 注入点恒禁用：002 缺失不报错，服务可用也只解释不放开', async () => {
    for (const available of [false, true]) {
      const test = harness(snapshot({ execAvailable: available }));
      const { container } = render(<PortsPane runtime={test.runtime} />);
      await screen.findByTestId('tbl-ports');
      const button = screen.getByTestId('btn-cs-exec') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(container.querySelectorAll('[data-testid="action-error"]')).toHaveLength(0);
      cleanup();
    }
    console.log('  · 扫了 2 种服务可用性（false/true），两种都禁用且 0 条错误');
  });
});

describe('T5.4 失败态与漂移', () => {
  it('取不到 eth0：不渲染端口判决，外部规则与 UDP 提示照旧可见，并给出「启动并核验」', async () => {
    const external = externalRulesFromFixture();
    const test = harness(
      snapshot({
        diff: { ok: false, reason: 'eth0-unknown', message: '取不到 eth0', hint: '启动发行版后重试', external, unsupported: [unsupportedMapping('dns', 53)] },
      }),
    );
    const { container } = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    expect(container.querySelectorAll('[data-port]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="btn-launch-distro"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="external-rules"]')).not.toBeNull();
    expect(screen.getByTestId('tip-udp')).toBeDefined();
    console.log(`  · 失败态扫了 ${String(container.querySelectorAll('[data-port]').length)} 行端口 / 19 条外部规则 / 1 条 UDP 提示`);
  });

  it('漂移行显示「旧 → 新」两个地址，并列出「先删后加」的修复序列', async () => {
    const test = harness(
      snapshot({ managedPortsDecl: ['3306'], ports: [classification('drift', 3306, { drift: { from: OLD_ETH0, to: ETH0 }, rules: [rule(3306, OLD_ETH0)] })] }),
    );
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const drift = screen.getByTestId('drift-3306').textContent ?? '';
    expect(drift).toContain(OLD_ETH0);
    expect(drift).toContain(ETH0);
    const fix = screen.getByTestId('fix-3306').textContent ?? '';
    expect(fix).toContain('1.portproxy-delete');
    expect(fix).toContain('2.portproxy-add');
    console.log(`  · 漂移行：${drift}；修复序列：${fix.slice(0, 60)}…`);
  });
});

describe('D1（2026-10-23 真机）：转发页**不再**渲染容器表与容器动作', () => {
  it('快照里明明有 2 个容器：DOM 里 tbl-containers / container-* 动作计数必须为 0，tbl-ports 仍在', async () => {
    const test = harness(
      snapshot({
        docker: {
          ok: true,
          emptyAfterRetry: false,
          argv: ['docker', 'ps', '-a', '--format', '{{json .}}'],
          containers: [container('db-running'), container('db-stopped', [], 'exited')],
        },
      }),
    );
    const { container: root } = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    // 正：端口表仍在（转发页的本职）
    expect(screen.getByTestId('tbl-ports')).toBeTruthy();
    // 反：容器表与四类动作按钮全不在（旧代码会渲染出 2 行 + 8 个按钮）
    expect(screen.queryByTestId('tbl-containers')).toBeNull();
    expect(root.querySelectorAll('[data-testid^="container-start-"]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-testid^="container-stop-"]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-testid^="container-restart-"]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-testid^="container-logs-"]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-testid^="btn-containers-"]')).toHaveLength(0);
    console.log('  · 转发页：tbl-ports=1、tbl-containers=0、container-* 动作=0（快照含 2 个容器）');
  });
});


