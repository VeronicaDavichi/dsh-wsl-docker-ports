// @vitest-environment jsdom
/**
 * 写回 / 失败态 / 样式注入的 **DOM 断言**（vitest + jsdom + @testing-library/react）
 * —— 2026-10-12 009 收口轮 T5 从 `pane.test.tsx` 拆出（拆前 `split('\n')` = **455**，超 SHALL 400）
 *
 * 拆法是**按职责**、不是按行数：本文件只保留「会让用户系统状态改变 / 会写配置 / 会注入样式」的三块
 * （T5.7 写回、009 缺陷 4 的失败可读性、E/P4 样式注入）；只读展示面留在 `pane.test.tsx`。
 * 🔴 用例**一条没删**：拆前 19 → 拆后 12 + 7 = 19，逐条名字不变（拆分脚本对拍过名字集合）。
 *
 * 台架（注入式 runtime + 计数器）在 `./pane-harness.ts`：两个文件共用，**不含 `it()`**。
 * 另：`@vitest-environment jsdom` 必须在文件首行注释里（vitest 的 per-file 指令）。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import * as entry from '../../src/client/index.ts';
import type { ClientContextLike } from '../../src/client/host.ts';
import { PortsPane } from '../../src/client/pane.tsx';
import { classification, snapshot } from '../unit/client-fixtures.ts';
import { harness } from './pane-harness.ts';

afterEach(() => {
  cleanup();
});

describe('T5.7 端口声明写回', () => {
  it('勾选 preset + 填区间 ⇒ 一次配置写入、零提权调用', async () => {
    const test = harness(snapshot({ managedPortsDecl: ['3306'] }));
    render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId('tbl-ports');

    // 🔴 不能只等 `tbl-ports`：`tbl-ports` 与 presets 勾选态**不在同一次提交里落 DOM**
    // —— preset 勾选态由 `PortsPane` 的 `useEffect` 从 `view` 灌进 state（`pane.tsx` 的
    // `setCheckedPresets(...)`），而 `tbl-ports` 在**前一次**提交就已进 DOM ⇒
    // 「findBy 返回后立刻同步读 checked」存在窗口（本轮实测真的读到过 checked=false）。
    // 这里等的是**同一条断言**（期望值 / 被测属性一字未改），只是等它成立，不是放宽判据。
    await waitFor(() => {
      expect((screen.getByTestId('chk-preset-mysql') as HTMLInputElement).checked).toBe(true);
    });
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
