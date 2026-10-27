// @vitest-environment jsdom
/**
 * 017 六订·五 / 六订·七：**两个配置页的分工**判据（从 `config-page.test.tsx` 拆出来 ——
 * 单文件 ≤ 400 行 SHALL，拆的边界是「一页的字段语法」vs「两页各放什么」）。
 *
 * - 外页（`plugins.bundle.config`，`BundleConfigPage`）：只放两个组件**共用**的「目标发行版」
 *   （主人 2026-10-27：「目标发行版依然放在外面啊，两个组件都要用的」）；
 * - 内页（`plugins.row.config`，`RowConfigPage`）：只放本插件的各项 + 按需读的原始输出。
 *
 * 两条都要能二值判定：外页有 distro 且**没有**内页各项；内页有六件事 + 原始输出且**没有** distro。
 */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_PAGE_TESTID, CONTAINERS_SETTINGS_NAMESPACE, DISTROS_PATH } from '../../src/client/config-page.tsx';
import { BundleConfigPage } from '../../src/client/config-bundle-page.tsx';
import { RowConfigPage } from '../../src/client/config-row-page.tsx';
import type { SettingsConfigView, SettingsPipe, SettingsWriteResult } from '../../src/client/settings-pipe.ts';

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

// 发行版清单的假 fetch：只认 `/distros`（两页都不许发别的请求）
beforeEach(() => {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url !== DISTROS_PATH) throw new Error(`配置页不该请求 ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, resolved: 'Ubuntu2204', distros: [{ name: 'Ubuntu2204' }] }),
    };
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
});

describe('017 六订·五：行级配置页（点「WSL Port Forwarding」那一行进去的页面）', () => {
  it('C15 六件事与原始输出都在**同一页**里（主人 2026-10-27：「都放进去」）', async () => {
    const writes: Write[] = [];
    let reads = 0;
    render(
      <RowConfigPage
        settings={fakePipe(writes, {})}
        loadRawOutput={async () => {
          reads += 1;
          return 'CONTAINER ID   IMAGE';
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('config-row-page')).toBeTruthy();
    });
    // ① 整张配置页在（写通道预演 / 端口声明 / 刷新频次 / 提权策略 / 端口作用域 / 保存）
    for (const id of ['config-page', 'config-write-channel', 'config-write-preview', 'config-managed-ports', 'config-policy', 'config-scope', 'config-refresh-ports', CONFIG_PAGE_TESTID.save]) {
      expect(screen.getByTestId(id), `缺 ${String(id)}`).toBeTruthy();
    }
    // ② 原始输出也在同一页、且在配置页**之后**
    const page = screen.getByTestId('config-row-page');
    const configPage = screen.getByTestId('config-page');
    const raw = screen.getByTestId('config-raw-page');
    expect(page.contains(raw)).toBe(true);
    expect(configPage.compareDocumentPosition(raw) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // ③ 主人 2026-10-27：「目标发行版依然放在外面啊，两个组件都要用的」⇒ 内页没有它
    expect(screen.queryByTestId('config-distro')).toBeNull();

    // ③ 进页面零读（原始输出仍按需）
    expect(reads).toBe(0);
    console.log('  · C15 行级页：配置页 6 项 + 原始输出同页；进页读 ' + String(reads) + ' 次');
    cleanup();
  });
});

describe('017 六订·七：组合包卡片页只放共用的目标发行版', () => {
  it('C16 外页有目标发行版、没有只属于 wsl-ports 的各项（两个组件都要用的才在外面）', async () => {
    const writes: Write[] = [];
    render(<BundleConfigPage settings={fakePipe(writes, {})} />);
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('config-bundle-page')).toBeTruthy();
    });
    expect(screen.getByTestId('config-distro')).toBeTruthy();
    for (const id of ['config-write-channel', 'config-write-preview', 'config-managed-ports', 'config-policy', 'config-scope', 'config-refresh-ports', 'config-raw-page']) {
      expect(screen.queryByTestId(id), `外页不该有 ${String(id)}`).toBeNull();
    }
    console.log('  · C16 外页 = 目标发行版 1 项，内页各项 0 项');
    cleanup();
  });
});

