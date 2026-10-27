// @vitest-environment jsdom
/**
 * 右栏页的**写入口收缩**判据（017 二订，主人 2026-10-27 原话：
 * 「端口声明（managedPorts） 放到插件页面的配置里，展示放在外面容器的侧边栏里」）。
 *
 * 这个文件的前身是 009/003 的「T5.7 端口声明写回」与「009 缺陷 4：保存声明失败必须可读」
 * 两组用例——那时**编辑入口在右栏页**。本轮编辑入口整体搬到 bundle 卡片页的配置页，
 * 于是这两组判据跟着**搬家并改写**（写到配置页的那一份在 `config-page.test.tsx` 的 C6–C8）：
 *
 * 1. 右栏页**展示**声明（原文 + 已声明的常用端口），读数与配置一致；
 * 2. 右栏页**没有**任何声明编辑控件（旧 testid 必须为 null）⇒ 开页与点遍全页都**零配置写**；
 * 3. 非法声明在右栏页只**报原因**（不提供改法），零写入；
 * 4. 只读块不携带 `data-write-control`（不是提权写控件）且不因提权档置灰；
 * 5. E/P4 样式注入判据**逐字保留**（与本次搬迁无关，但同一台架，不拆文件）。
 *
 * 台架（注入式 runtime + 计数器）在 `./pane-harness.ts`：与本目录其它文件共用，**不含 `it()`**。
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import * as entry from '../../src/client/index.ts';
import type { ClientContextLike } from '../../src/client/host.ts';
import { PortsPane } from '../../src/client/pane.tsx';
import { snapshot } from '../unit/client-fixtures.ts';
import { harness } from './pane-harness.ts';

afterEach(() => {
  cleanup();
});

describe('T5.7 端口声明：右栏页只展示，编辑入口已搬走', () => {
  it('声明原文与已声明的常用端口都展示出来（读数与配置一致）', async () => {
    const test = harness(snapshot({ managedPortsDecl: ['3306', '1000-3000'] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const declared = await screen.findByTestId('managed-ports-declared');
    expect(declared.textContent).toContain('3306');
    expect(declared.textContent).toContain('1000-3000');
    // presets 勾选态来自同一份声明（3306 = MySQL），展示成一句人话而不是勾选框
    expect(screen.getByTestId('managed-ports-presets').textContent).toContain('MySQL');
    expect(screen.getByTestId('managed-ports-readonly-note').textContent).toContain('配置页');
    console.log(`  · 只读展示扫到：${JSON.stringify(declared.textContent)}`);
  });

  it('🔴 旧的编辑控件全都不在了（单入口在配置页），且开页零配置写', async () => {
    const test = harness(snapshot({ managedPortsDecl: ['3306'] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    for (const gone of ['inp-managed-ports', 'btn-save-managed-ports', 'chk-preset-mysql']) {
      expect(screen.queryByTestId(gone)).toBeNull();
    }
    expect(test.recorded.updates).toHaveLength(0);
    expect(test.recorded.elevation).toHaveLength(0);
    console.log(`  · 单入口扫了 3 个旧 testid（全为 null）/ 配置写 ${String(test.recorded.updates.length)} 次`);
  });

  it('非法声明：右栏页只把原因摆出来（改法在配置页），且不产生任何写入', async () => {
    const test = harness(snapshot({ managedPortsDecl: ['abc'] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const summary = await screen.findByTestId('managed-ports-summary');
    expect(summary.textContent).toContain('abc');
    expect(test.recorded.updates).toHaveLength(0);
    console.log(`  · 非法声明扫了 ${String(test.recorded.updates.length)} 次写入（要求 0）`);
  });

  it('只读块不带 data-write-control，也不因提权档 none 置灰', async () => {
    const test = harness(snapshot({ managedPortsDecl: ['3306'], elevationPolicy: 'none' }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const summary = await screen.findByTestId('managed-ports-summary');
    expect(summary.querySelectorAll('[data-write-control]')).toHaveLength(0);
    expect(summary.querySelectorAll('[disabled]')).toHaveLength(0);
    console.log('  · 只读块扫了 0 个 data-write-control / 0 个 disabled');
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

describe('017 三订：写通道预演 / 目标发行版都已搬出右栏页', () => {
  it('右栏页没有写通道块、也没有发行版下拉（单入口在插件卡片页的配置区）', async () => {
    const test = harness(snapshot({ managedPortsDecl: ['3306'] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    expect(screen.queryByTestId('write-block')).toBeNull();
    expect(screen.queryByTestId('distro-panel')).toBeNull();
    expect(screen.queryByTestId('sel-distro')).toBeNull();
    // 正常态（无漂移、无解析错误）连告警块都不渲染 —— 版面干净
    expect(screen.queryByTestId('distro-alarm')).toBeNull();
    expect(test.recorded.updates).toHaveLength(0);
    console.log('  · 右栏页扫了 4 个已搬走的 testid（全为 null），配置写 0 次');
  });

  it('反向对照：真有漂移时告警块**必须**出现（安全网没跟着一起搬走）', async () => {
    const test = harness(
      snapshot({
        managedPortsDecl: ['3306'],
        // 漂移文案由 staleConfig + message 派生（uildDistroPanel），这里喂真快照字段
        distro: {
          distros: [{ name: 'Ubuntu2204', state: 'Running', isDefault: true, version: 2 }],
          name: 'Ubuntu2204',
          state: 'Running',
          source: 'wslDefault',
          staleConfig: true,
          message: '规则里的 eth0 是 172.20.201.152，现状是 172.20.203.7（漂移）',
          stateNote: null,
        },
      }),
    );
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    const alarm = await screen.findByTestId('distro-alarm');
    expect(alarm.textContent).toContain('172.20.203.7');
    expect(screen.getByTestId('distro-stale').textContent).toContain('漂移');
    console.log(`  · 漂移告警：${(screen.getByTestId('distro-stale').textContent ?? '').slice(0, 40)}…`);
  });
});