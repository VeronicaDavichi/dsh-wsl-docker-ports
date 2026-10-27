// @vitest-environment jsdom
/**
 * 017：**bundle 级配置页**的 DOM 判据（`plugins.bundle.config` 的页面本体）。
 *
 * 这一页承担三件事，每条都要能二值判定：
 * 1. **一个页面三个组**：目标发行版 / 刷新频次（两个值）/ 提权策略都在，且**没改就点不动保存**
 *    （`dirty` 门）；页头那三个旧控件不再出现在这里（它们已经从页头删除，见 refresh-interval 与
 *    containers-pane 两组用例）。
 * 2. **一次保存写两个命名空间**：`wsl-ports`（自己）与 `wsl-containers`（容器行）——
 *    只因为**目标发行版**是两边共用的（017 六订·九起刷新频次各写各的：容器那份在容器行级页）；
 *    断言的是**真实发出的 patch**，不是「看起来保存了」。
 * 3. **提权策略仍两段式**：改了档位首次点保存只亮确认条，未点确认 ⇒ `update` 调用 0 次。
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_PAGE_TESTID, ConfigPage, CONTAINERS_SETTINGS_NAMESPACE, DISTROS_PATH } from '../../src/client/config-page.tsx';
import type { SettingsConfigView, SettingsPipe, SettingsWriteResult } from '../../src/client/settings-pipe.ts';
import { createWriteChannel, type WriteWiring } from '../../src/client/write-channel.ts';
import { createWriteTokenStore, type StorageLike } from '../../src/client/write-token.ts';
import { WRITE_TESTID } from '../../src/client/write-confirm.tsx';

interface Write {
  readonly ns: string;
  readonly patch: Record<string, unknown>;
}

const BASE: SettingsConfigView = {
  managedPorts: ['3306'],
  distro: 'Ubuntu2204',
  elevationPolicy: 'none',
  scopes: { '3306': 'loopback' },
  writeTokenConfigured: false,
  refreshIntervalSec: 15,
};

const CONTAINERS_NS_VIEW = { distro: 'Ubuntu2204', refreshIntervalSec: 30 };

function ok(patch: Record<string, unknown>): SettingsWriteResult {
  return { ok: true, message: 'ok', patch: patch as never, revisionPassed: true };
}

function fakePipe(writes: Write[], overrides: { readonly failNs?: string; readonly managedPorts?: readonly string[] } = {}): SettingsPipe {
  const record = (ns: string, patch: Record<string, unknown>): SettingsWriteResult => {
    if (overrides.failNs === ns) return { ok: false, message: `${ns} 被拒绝`, patch: patch as never, revisionPassed: false };
    writes.push({ ns, patch });
    return ok(patch);
  };
  return {
    readConfig: async () => (overrides.managedPorts === undefined ? BASE : { ...BASE, managedPorts: [...overrides.managedPorts] }),
    readNamespace: async (ns: string) => (ns === CONTAINERS_SETTINGS_NAMESPACE ? { ...CONTAINERS_NS_VIEW } : null),
    writeDistro: async (name: string) => record('wsl-ports', { distro: name }),
    writeRefreshInterval: async (sec: number) => record('wsl-ports', { refreshIntervalSec: sec }),
    writeElevationPolicy: async (policy: string) => record('wsl-ports', { elevationPolicy: policy }),
    writeNamespace: async (ns: string, patch: Record<string, unknown>) => record(ns, patch),
    writeManagedPorts: async (decls: readonly string[]) => record('wsl-ports', { managedPorts: [...decls] }),
    writeScope: async () => ok({}),
    writeListenAddress: async () => ok({}),
    writeWriteToken: async () => ok({}),
    clearWriteToken: async () => ({ ok: true, message: 'ok', writeTokenConfigured: false, revisionPassed: true, ops: [] }),
    updateCount: () => writes.length,
  } as unknown as SettingsPipe;
}

/** 发行版清单请求的假 fetch：只认 `/distros`，别的一律判红（页面不该再发别的请求） */
let fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url !== DISTROS_PATH) throw new Error(`配置页不该请求 ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, resolved: 'Ubuntu2204', distros: [{ name: 'Ubuntu2204' }, { name: 'Debian' }] }),
    };
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
});

/** 内存 sessionStorage（绝不落盘），仅供配置页用例造一份真 `WriteTokenStore` */
function memoryStorage(): StorageLike {
  const box = new Map<string, string>();
  return {
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => {
      box.set(key, value);
    },
    removeItem: (key) => {
      box.delete(key);
    },
  };
}

/**
 * 一份**真** `WriteWiring`，但 `fetch` 一被调用就抛 —— 这样「配置页渲染期零请求」是实测，
 * 不是「没写请求代码」的推断。
 */
function fakeWrite(options: { readonly token?: string } = {}): { readonly write: WriteWiring; readonly requests: () => number } {
  let calls = 0;
  const tokenStore = createWriteTokenStore(memoryStorage());
  if (options.token !== undefined) tokenStore.save(options.token);
  const channel = createWriteChannel({
    token: () => tokenStore.read(),
    fetchImpl: async () => {
      calls += 1;
      throw new Error('配置页渲染期不该发写通道请求');
    },
  });
  const write: WriteWiring = {
    channel,
    tokenStore,
    declaration: async () => ({ ok: true, ports: [{ start: 3306, end: 3306 }] }),
  };
  return { write, requests: () => calls };
}
async function mount(writes: Write[], overrides: { readonly failNs?: string; readonly write?: WriteWiring; readonly managedPorts?: readonly string[] } = {}): Promise<void> {
  render(<ConfigPage settings={fakePipe(writes, overrides)} write={overrides.write} />);
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByTestId(CONFIG_PAGE_TESTID.root)).toBeTruthy();
  });
}

describe('017 bundle 级配置页', () => {
  it('C1 三组都在；初值全部读自配置；发行版下拉来自 /distros 清单', async () => {
    await mount([]);

    expect((screen.getByTestId(CONFIG_PAGE_TESTID.distro) as HTMLSelectElement).value).toBe('Ubuntu2204');
    expect((screen.getByTestId(CONFIG_PAGE_TESTID.refreshPorts) as HTMLSelectElement).value).toBe('15');
    expect((screen.getByTestId(CONFIG_PAGE_TESTID.policy) as HTMLSelectElement).value).toBe('none');

    await waitFor(() => {
      const options = Array.from((screen.getByTestId(CONFIG_PAGE_TESTID.distro) as HTMLSelectElement).options).map((option) => option.value);
      expect(options).toEqual(['', 'Ubuntu2204', 'Debian']);
    });
    expect(fetchCalls).toEqual([DISTROS_PATH]);
    // 017 六订·九：「容器页刷新频次」搬去容器行自己的配置页 ⇒ 本页**不该**有它
    expect(screen.queryByTestId('config-refresh-containers')).toBeNull();
    console.log(`  · C1 初值：distro=Ubuntu2204 / ports=15 / policy=none（容器刷新频次不在本页）；清单请求 ${String(fetchCalls.length)} 次`);
  });

  it('C2 没改 ⇒ 保存置灰、零写入（脏判定靠指纹，不靠「点过没有」）', async () => {
    const writes: Write[] = [];
    await mount(writes);
    const save = screen.getByTestId(CONFIG_PAGE_TESTID.save) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await act(async () => {
      await Promise.resolve();
    });
    expect(writes).toHaveLength(0);
    console.log('  · C2 未改动：保存按钮 disabled=true、写入 0 次');
  });

  it('C3 改发行版 + 本页刷新频次 ⇒ 一次保存写两个命名空间（容器侧只收共用的 distro）', async () => {
    const writes: Write[] = [];
    await mount(writes);

    fireEvent.change(screen.getByTestId(CONFIG_PAGE_TESTID.distro), { target: { value: 'Debian' } });
    fireEvent.change(screen.getByTestId(CONFIG_PAGE_TESTID.refreshPorts), { target: { value: '60' } });

    const save = screen.getByTestId(CONFIG_PAGE_TESTID.save) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(writes.length).toBeGreaterThanOrEqual(3);
    });

    expect(writes).toContainEqual({ ns: 'wsl-ports', patch: { distro: 'Debian' } });
    expect(writes).toContainEqual({ ns: 'wsl-ports', patch: { refreshIntervalSec: 60 } });
    // 容器侧只收共用的 distro（刷新频次已归容器的行级页，本页不再写它）
    expect(writes).toContainEqual({ ns: CONTAINERS_SETTINGS_NAMESPACE, patch: { distro: 'Debian' } });
    expect(writes.some((write) => write.ns === CONTAINERS_SETTINGS_NAMESPACE && 'refreshIntervalSec' in write.patch)).toBe(false);
    await waitFor(() => {
      expect(screen.getByTestId(CONFIG_PAGE_TESTID.note).textContent ?? '').toContain('设置已保存');
    });
    console.log(`  · C3 一次保存发出 ${String(writes.length)} 次写：${JSON.stringify(writes)}`);
  });

  it('C4 改提权策略 ⇒ 首次保存只亮确认条（零写入），点确认才落盘', async () => {
    const writes: Write[] = [];
    await mount(writes);

    fireEvent.change(screen.getByTestId(CONFIG_PAGE_TESTID.policy), { target: { value: 'ask' } });
    fireEvent.click(screen.getByTestId(CONFIG_PAGE_TESTID.save));
    await act(async () => {
      await Promise.resolve();
    });

    // 未确认 ⇒ 零写入（REQ-12.4 / U4）
    expect(writes).toHaveLength(0);
    expect(screen.getByTestId('config-confirm-panel')).toBeTruthy();

    fireEvent.click(screen.getByTestId(CONFIG_PAGE_TESTID.confirm));
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(writes).toContainEqual({ ns: 'wsl-ports', patch: { elevationPolicy: 'ask' } });
    });
    console.log(`  · C4 提权档：确认前 0 次写、确认后 ${String(writes.length)} 次写`);
  });

  it('C5 容器命名空间被拒 ⇒ 页面如实报失败，不谎报「已保存」', async () => {
    const writes: Write[] = [];
    await mount(writes, { failNs: CONTAINERS_SETTINGS_NAMESPACE });

    fireEvent.change(screen.getByTestId(CONFIG_PAGE_TESTID.distro), { target: { value: 'Debian' } });
    fireEvent.click(screen.getByTestId(CONFIG_PAGE_TESTID.save));
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId(CONFIG_PAGE_TESTID.note).textContent ?? '').toContain('保存失败');
    });
    console.log(`  · C5 容器命名空间被拒：提示「保存失败」`);
  });
  it('C6 端口声明：勾 preset + 填区间 ⇒ 与其它字段共用一次「保存设置」，写的是合并后的数组', async () => {
    const writes: Write[] = [];
    await mount(writes);
    const field = screen.getByTestId('config-managed-ports') as HTMLTextAreaElement;
    expect(field.value).toBe('3306');
    // 主人 2026-10-27 二次拍板：控件是 textarea（多了分行好改），半角逗号照样是主用法
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.placeholder).toContain(',');
    expect((screen.getByTestId('config-preset-mysql') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByTestId('config-preset-spring-boot'));
    // 半角逗号分隔（含空格）⇒ 与换行写法等价
    fireEvent.change(screen.getByTestId('config-managed-ports'), { target: { value: '3306, 1000-3000' } });
    fireEvent.click(screen.getByTestId(CONFIG_PAGE_TESTID.save));
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(writes).toContainEqual({ ns: 'wsl-ports', patch: { managedPorts: ['3306', '1000-3000', '8080'] } });
    });
    // 只写了声明这一条（其它字段没动 ⇒ 不产生多余写）
    expect(writes).toHaveLength(1);
    console.log(`  · C6 端口声明与保存共用：${JSON.stringify(writes)}`);
  });

  it('C7 非法声明 ⇒ 就地报原因、保存置灰、零写入（非法项不被悄悄丢掉）', async () => {
    const writes: Write[] = [];
    await mount(writes);
    fireEvent.change(screen.getByTestId('config-managed-ports'), { target: { value: 'abc' } });

    const issues = await screen.findByTestId('config-managed-ports-issues');
    expect(issues.textContent).toContain('abc');
    expect((screen.getByTestId(CONFIG_PAGE_TESTID.save) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(CONFIG_PAGE_TESTID.save));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writes).toHaveLength(0);
    console.log(`  · C7 非法声明：原因「${(issues.textContent ?? '').slice(0, 30)}…」/ 写入 ${String(writes.length)} 次`);
  });

  it('C8 端口声明写失败 ⇒ 页面如实报失败（不谎报已保存）', async () => {
    const writes: Write[] = [];
    await mount(writes, { failNs: 'wsl-ports' });
    fireEvent.change(screen.getByTestId('config-managed-ports'), { target: { value: '3306, 9999' } });
    fireEvent.click(screen.getByTestId(CONFIG_PAGE_TESTID.save));
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId(CONFIG_PAGE_TESTID.note).textContent ?? '').toContain('保存失败');
    });
    console.log(`  · C8 端口声明被拒：提示「保存失败」、成功写入 ${String(writes.length)} 次`);
  });

  it('C9 写通道预演在配置页：整块在、NAT 前提句在、渲染期零写通道请求（不置灰）', async () => {
    const probe = fakeWrite({ token: 'tk-c9' });
    await mount([], { write: probe.write });

    const section = await screen.findByTestId('config-write-channel');
    expect(section.textContent).toContain('写通道预演');
    expect(screen.getByTestId('config-write-premise').textContent).toContain('NAT');
    // 凭据块**仍在右栏页** ⇒ 配置页必须指路，不然用户在两页之间找不到 token
    expect(screen.getByTestId('config-write-token-pointer').textContent).toContain('右栏页');
    // 主人同日拍板：**不置灰**（配置页拿不到快照，不为一行提示多读一次 docker ps）
    const preview = screen.getByTestId(WRITE_TESTID.preview) as HTMLButtonElement;
    expect(preview.disabled).toBe(false);
    // 渲染期零请求（fetchImpl 一被调用就抛 ⇒ 这里没抛就是 0 次）
    expect(probe.requests()).toBe(0);
    console.log('  · C9 写通道预演：块在、前提句含 NAT、预演可用、渲染期请求 0 次');
  });

  it('C10 宿主没给写通道 ⇒ 预演置灰并写明原因（不静默）', async () => {
    await mount([]);
    const block = await screen.findByTestId(WRITE_TESTID.block);
    expect(block.getAttribute('data-wired')).toBe('0');
    const preview = screen.getByTestId(WRITE_TESTID.preview) as HTMLButtonElement;
    expect(preview.disabled).toBe(true);
    // 原因挂在按钮 title 上（既有的 008 口径：置灰必须有话说，不静默）
    expect(preview.title).toContain('remote.settings');
    console.log(`  · C10 未接线：data-wired=0、预演置灰、原因「${preview.title.slice(0, 34)}…」`);
  });
});

describe('017 端口声明输入形态（主人两次拍板：半角逗号照认，但控件回到 textarea）', () => {
  it('C11 逗号写法照样能保存（半角逗号是主用法）', async () => {
    const writes: Write[] = [];
    await mount(writes);
    fireEvent.change(screen.getByTestId('config-managed-ports'), { target: { value: '3306, 1000-3000, 5432' } });
    fireEvent.click(screen.getByTestId(CONFIG_PAGE_TESTID.save));
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(writes).toContainEqual({ ns: 'wsl-ports', patch: { managedPorts: ['3306', '1000-3000', '5432'] } });
    });
    console.log(`  · C11 逗号写法 ⇒ ${JSON.stringify(writes)}`);
  });

  it('C12 控件是 textarea、回填一行一项（多了好改；逗号/换行两种写法等价）', async () => {
    const writes: Write[] = [];
    await mount(writes, { managedPorts: ['3306', '5432', '1000-3000'] });
    const field = screen.getByTestId('config-managed-ports') as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.value).toBe('3306\n5432\n1000-3000');
    expect(field.placeholder).toContain(',');
    console.log(`  · C12 textarea 回填 = 「${field.value.replaceAll('\n', '⏎')}」`);
  });

  it('C13 换行 / 逗号 / 混着写 ⇒ 同一个声明数组（textarea 不再需要拦粘贴）', async () => {
    const cases: readonly (readonly [string, readonly string[]])[] = [
      ['3306\n1000-3000', ['3306', '1000-3000']],
      ['3306, 1000-3000', ['3306', '1000-3000']],
      ['3306,1000-3000\n5432', ['3306', '1000-3000', '5432']],
    ];
    for (const [draft, expected] of cases) {
      const writes: Write[] = [];
      await mount(writes);
      fireEvent.change(screen.getByTestId('config-managed-ports'), { target: { value: draft } });
      fireEvent.click(screen.getByTestId(CONFIG_PAGE_TESTID.save));
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(writes).toContainEqual({ ns: 'wsl-ports', patch: { managedPorts: expected } });
      });
      cleanup();
    }
    console.log(`  · C13 扫了 ${String(cases.length)} 种写法（换行 / 逗号 / 混写）⇒ 同一个数组`);
  });
});
