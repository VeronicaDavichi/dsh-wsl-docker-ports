// @vitest-environment jsdom
/**
 * T5.1–T5.7 的 **DOM 渲染与接线**断言（vitest + jsdom + @testing-library/react）
 *
 * 这个文件同时承担两件「只有真渲染才证得动」的事：
 * ① **开页零写操作**（NFR-2）：挂载后配置写入 0 次、提权调用 0 次 —— 由独立计数器给出，不看退出码；
 * ② **JSX 真能编译**：本文件含真实 JSX，能跑起来就说明 vitest 的 JSX 转换（vitest 5 走 oxc，
 *    按 `tsconfig.json` 的 `jsx: "react-jsx"`）确实生效 —— 这是「配置写了但被忽略」的唯一检测手段。
 *
 * 另：`@vitest-environment jsdom` 必须在文件首行注释里（vitest 的 per-file 指令）。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import * as entry from '../../src/client/index.ts';
import type { ClientContextLike, ClientRuntime, ForwardWriteRequest, RemoteSettingsLike, SettingsResponse } from '../../src/client/host.ts';
import { PortsPane } from '../../src/client/pane.tsx';
import { createSettingsPipe } from '../../src/client/settings-pipe.ts';
import { PORT_STATES } from '../../src/diff/types.ts';
import { externalRulesFromFixture, classification, NAT_NON_NAT, NAT_OK, rule, snapshot, unsupportedMapping, ETH0, OLD_ETH0 } from '../unit/client-fixtures.ts';

afterEach(() => {
  cleanup();
});

interface Recorded {
  loads: number[];
  describes: number;
  updates: { readonly ns: string; readonly patch: Record<string, unknown> }[];
  elevation: ForwardWriteRequest[];
  /** 宿主 `update` 被**尝试**的次数（含抛错那一次）——「不重试」靠它证 */
  updateAttempts: number;
}

interface Harness {
  readonly runtime: ClientRuntime;
  readonly recorded: Recorded;
  readonly push: (next: ReturnType<typeof snapshot>) => void;
}

interface HarnessOptions {
  /** 让宿主 `update` 抛错（模拟真机 `client api: settings/update expected 3 argument(s), got 2` 那类拒绝） */
  readonly updateError?: string;
  /** 管道**自身**抛（模拟调用方没接住的异常）—— 验面板那层兜底 */
  readonly explodingSettings?: boolean;
  /** 宿主压根没提供 `remote.settings` */
  readonly noSettings?: boolean;
}

/**
 * 注入式 runtime：所有外部输入都是 fake（零真机、零提权、零文件）。
 *
 * **配置写与提权写都挂上计数器**（不是「提权那一侧压根没接」）——
 * 否则「零提权调用」只是「没有提权入口」的假象，而不是「有入口却没被走」。
 */
function harness(initial: ReturnType<typeof snapshot>, options: HarnessOptions = {}): Harness {
  const recorded: Recorded = { loads: [], describes: 0, updates: [], elevation: [], updateAttempts: 0 };
  let current = initial;
  const remote: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => {
      recorded.describes += 1;
      return { ok: true, value: { revision: 3, namespaces: [{ ns: 'dsh-wsl-docker-ports', value: {} }] } };
    },
    update: async (ns: string, patch: unknown): Promise<SettingsResponse> => {
      recorded.updateAttempts += 1;
      if (options.updateError !== undefined) throw new Error(options.updateError);
      recorded.updates.push({ ns, patch: patch as Record<string, unknown> });
      return { ok: true, value: {} };
    },
  };
  const pipe = createSettingsPipe(() => remote);
  const settings: ClientRuntime['settings'] =
    options.noSettings === true
      ? undefined
      : options.explodingSettings === true
        ? {
            ...pipe,
            writeManagedPorts: async () => {
              throw new Error('管道自身炸了（模拟未接住的异常）');
            },
          }
        : pipe;
  const runtime: ClientRuntime = {
    source: {
      load: async () => {
        recorded.loads.push(recorded.loads.length + 1);
        return current;
      },
    },
    settings,
    elevation: {
      run: async (request: ForwardWriteRequest) => {
        recorded.elevation.push(request);
        return { status: 'ok', message: '已应用', steps: [{ name: 'portproxy-add', ok: true, stderr: '' }] };
      },
    },
    exec: undefined,
  };
  return {
    runtime,
    recorded,
    push: (next) => {
      current = next;
    },
  };
}

describe('T5.1 开页只读（NFR-2）', () => {
  it('挂载后：快照读 1 次、配置写入 0 次、提权调用 0 次', async () => {
    const test = harness(snapshot({ ports: [classification('ok', 3306, { rules: [rule(3306)] })] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    expect(test.recorded.loads).toHaveLength(1);
    expect(test.recorded.updates).toHaveLength(0);
    expect(test.recorded.describes).toBe(0);
    expect(test.recorded.elevation).toHaveLength(0);
    console.log(`  · 开页扫了 ${String(test.recorded.loads.length)} 次读 / ${String(test.recorded.updates.length)} 次配置写 / ${String(test.recorded.elevation.length)} 次提权`);
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
  it('非 NAT 下没有任何可点的转发写控件，且提权策略控件仍可用（否则 none 会死锁）', async () => {
    const test = harness(snapshot({ nat: NAT_NON_NAT, ports: [classification('missing', 3306)] }));
    const { container } = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const controls = container.querySelectorAll('[data-write-control]');
    const clickable = container.querySelectorAll('[data-write-control]:not([disabled])');
    expect(controls.length).toBeGreaterThan(0);
    expect(clickable).toHaveLength(0);
    expect((screen.getByTestId('sel-elevation') as HTMLSelectElement).disabled).toBe(false);

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

describe('T5.7 端口声明写回', () => {
  it('勾选 preset + 填区间 ⇒ 一次配置写入、零提权调用', async () => {
    const test = harness(snapshot({ managedPortsDecl: ['3306'] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    expect((screen.getByTestId('chk-preset-mysql') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('chk-preset-spring-boot'));
    fireEvent.change(screen.getByTestId('inp-managed-ports'), { target: { value: '3306\n1000-3000' } });
    fireEvent.click(screen.getByTestId('btn-save-managed-ports'));

    await waitFor(() => {
      expect(test.recorded.updates).toHaveLength(1);
    });
    expect(test.recorded.updates[0]?.patch).toEqual({ managedPorts: ['3306', '1000-3000', '8080'] });
    expect(test.recorded.elevation).toHaveLength(0);
    console.log(`  · 写回扫了 ${String(test.recorded.updates.length)} 次配置写 / ${String(test.recorded.elevation.length)} 次提权：${JSON.stringify(test.recorded.updates[0]?.patch)}`);
  });

  it('非法声明在表单里就地报出原因，且不产生任何写入', async () => {
    const test = harness(snapshot({ managedPortsDecl: ['abc'] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const form = screen.getByTestId('inp-managed-ports').closest('section');
    expect(form?.textContent).toContain('abc');
    expect(test.recorded.updates).toHaveLength(0);
    console.log(`  · 非法声明扫了 ${String(test.recorded.updates.length)} 次写入（要求 0）`);
  });
});

/**
 * 009 缺陷 4（2026-10-12 真机）：点「保存声明」失败时**完全静默** ——
 * 控制台只有 `Uncaught (in promise)`、没有 `update` 请求、没改文件、页面零提示。
 * 判据：任何失败路径都必须出现**可读原因**（含宿主原话）+ **只尝试一次**（不重试）+ 零提权。
 */
describe('009 缺陷 4：「保存声明」失败必须给出可读原因（不静默、不重试）', () => {
  const SAVE = 'btn-save-managed-ports';

  it('宿主 update 抛错（真机那句 arity 错）⇒ 出现可读原因、尝试 1 次、零提权', async () => {
    const test = harness(snapshot({ ports: [classification('missing', 3306)] }), {
      updateError: 'client api: settings/update expected 3 argument(s), got 2',
    });
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');
    expect(document.querySelectorAll('[data-testid="action-error"]')).toHaveLength(0);

    fireEvent.click(screen.getByTestId(SAVE));
    const error = await screen.findByTestId('action-error');
    expect(error.textContent).toContain('expected 3 argument(s), got 2');
    expect(error.textContent).toContain('不重试');
    await waitFor(() => {
      expect(test.recorded.updateAttempts).toBe(1);
    });
    expect(test.recorded.updates).toHaveLength(0);
    expect(test.recorded.elevation).toHaveLength(0);
    console.log(`  · 扫了 1 次失败保存：提示「${(error.textContent ?? '').slice(0, 40)}…」/ 尝试 ${String(test.recorded.updateAttempts)} 次 / 提权 ${String(test.recorded.elevation.length)} 次`);
  });

  it('反向对照：同一路径写入成功 ⇒ 不出现任何 action-error（证明上面的提示只由失败触发）', async () => {
    const test = harness(snapshot({ ports: [classification('missing', 3306)] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    fireEvent.click(screen.getByTestId(SAVE));
    await waitFor(() => {
      expect(test.recorded.updates).toHaveLength(1);
    });
    expect(document.querySelectorAll('[data-testid="action-error"]')).toHaveLength(0);
    console.log(`  · 扫了 1 次成功保存：写入 ${String(test.recorded.updates.length)} 次、action-error 0 条`);
  });

  it('管道自身抛（调用方没接住的异常）⇒ 面板兜底也给可读提示', async () => {
    const test = harness(snapshot({ ports: [classification('missing', 3306)] }), { explodingSettings: true });
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    fireEvent.click(screen.getByTestId(SAVE));
    const error = await screen.findByTestId('action-error');
    expect(error.textContent).toContain('管道自身炸了');
    expect(error.textContent).toContain('不重试');
    console.log(`  · 扫了 1 次管道抛错：兜底提示「${(error.textContent ?? '').slice(0, 36)}…」`);
  });

  it('宿主未提供 remote.settings ⇒ 点保存也给可读提示（不再静默什么都不做）', async () => {
    const test = harness(snapshot({ ports: [classification('missing', 3306)] }), { noSettings: true });
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    fireEvent.click(screen.getByTestId(SAVE));
    const error = await screen.findByTestId('action-error');
    expect(error.textContent).toContain('remote.settings');
    console.log(`  · 扫了 1 次未接线保存：「${(error.textContent ?? '').slice(0, 36)}…」`);
  });
});

describe('E/P4 样式注入（必须发生在 factory 闭包内）', () => {
  it('模块加载时不注入任何 <style>；apply() 才注入，且 disposer 能移除', () => {
    const selector = 'style[data-plugin="dsh-wsl-docker-ports/styles"]';
    expect(document.querySelectorAll(selector)).toHaveLength(0);

    const disposers: (() => void)[] = [];
    const ctx: ClientContextLike = {
      get: (name: string) =>
        name === 'slots'
          ? { register: () => () => undefined, inject: (_n: string, callback: () => void) => { callback(); return () => undefined; } }
          : name === 'sidebarRightTabs'
            ? { register: () => () => undefined }
            : {},
      effect: (callback: () => (() => void) | void) => {
        const disposer = callback();
        if (typeof disposer === 'function') disposers.push(disposer);
        return () => undefined;
      },
    };
    const result = entry.apply(ctx, { source: { load: async () => snapshot({}) } });
    expect(result.registered).toBe(true);

    const styles = document.querySelectorAll(selector);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain('.wdp-page');
    expect(styles[0]?.textContent).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u);

    for (const dispose of disposers) dispose();
    expect(document.querySelectorAll(selector)).toHaveLength(0);
    console.log(`  · 注入扫了 ${String(styles.length)} 个 <style>（CSS ${String(styles[0]?.textContent.length ?? 0)} 字符，hex 命中 0 处），disposer 移除后 ${String(document.querySelectorAll(selector).length)} 个`);
  });
});
