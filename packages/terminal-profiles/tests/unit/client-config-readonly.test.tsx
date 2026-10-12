// @vitest-environment jsdom
/**
 * 007 缺陷 A 回归门（2026-10-12 真机）：**「本行被 home patch / `--patch` 覆盖」必须渲染成只读态
 * （不可编辑 + 显示原因），而不是一张可编辑表单 + 一句「写入配置失败」**。
 *
 * ## 为什么必须单独一条门
 *
 * 真机（`volatile-probe` + `--patch` 生效）实测：写入**确实被拒**（宿主原文
 * `Configuration for "dsh-terminal-profiles" is overridden by a home patch or command-line overlay`，
 * patch 文件 sha 未变），但 `settings/describe` 的载荷里
 * **外层 `writable` 恒为 `true`、21/21 个命名空间都不带 `writable`/`readOnly`/`addressable`、全载荷无路径**
 * ⇒ 旧实现把拒绝归进 `failed`，页面只显示「写入配置失败：…」，**表单仍然完全可编辑**。
 * 旧用例（`client-config-page.test.tsx` T6.3）**全绿** —— 因为它喂的是**注入的**只读形状
 * （`writable:false` + `path`），真机永远不会长那样 ⇒ 两者在真机上分叉。
 *
 * ## 真机载荷（本文件的夹具）
 *
 * 字段名与取值逐字取自探针产物
 * `C:\Users\EDY\dsh-probe-artifacts\20261012-150641-batch\B2-remote-settings-describe-with-overlay.raw.json`
 * （34521 B / sha256 `BE00EE3DFD3BBA3ABF7208CB663B9420825ABC0391BC34AAC39EDD15A0B133B3`）的 `result` 字段；
 * 唯一缩减项是 `schema.refs` 的**内部细节**（与缺陷判据无关，按同形状保留 uid/refs 两层）。
 * 无 overlay 的对照件 `B1-remote-settings-describe.raw.json`
 * （35198 B / sha256 `BD802FDAFF9455DF0C28FB3EFA704BD466B14150F932CF8D1E72F0D1AF82D3A2`）的差别**只有**
 * `user`/`value` 两个值（结构完全同形）⇒ 「无信号可读」不是解析漏读，是**载荷里根本没有**。
 *
 * ## 🔴 变异哨兵
 *
 * 逐字复刻**修复前**的管道行为（同一句宿主拒绝 ⇒ `{kind:'failed', message:'写入配置失败：…'}`，
 * 见 `src/client/config-pipe.ts` 修复前那一行 `return { kind: 'failed', … }`），在**同一个 React**下
 * 渲染同一张页面 ⇒ 断言它渲染出「可编辑表单」（`cfg-readonly` 不存在、`data-readonly="false"`、
 * 输入框 `disabled === false`）。于是「这条门真能杀掉旧行为」跑一次就有数字。
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigPage } from '../../src/client/config-page.tsx';
import {
  READONLY_PATH_UNKNOWN,
  isReadOnlyRefusal,
  readNamespaceState,
  createConfigPipe,
} from '../../src/client/config-pipe.ts';
import type { ConfigPipe, ConfigReadOutcome, SettingsResponse } from '../../src/client/config-pipe.ts';
import { createFakeConfigPipe, createFakeRemoteSettings } from '../helpers/config-fixtures.ts';

afterEach(() => {
  cleanup();
});

const scan = { assertions: 0 };

function expectThat(label: string, actual: unknown, expected: unknown): void {
  scan.assertions += 1;
  expect(actual, label).toStrictEqual(expected);
}

/** 真机拒绝原文（`dsh-config-editor/lib/index.js:122` 的模板串，真机实测同一句） */
const HOST_REFUSAL = 'Configuration for "dsh-terminal-profiles" is overridden by a home patch or command-line overlay';

/** 真机 `settings/describe` 载荷（见文件头出处；按 `result` 逐字段照抄） */
const REAL_OVERLAY_DESCRIBE: SettingsResponse = {
  ok: true,
  value: {
    writable: true,
    hasDocument: true,
    namespaces: [
      {
        ns: 'dsh-terminal-profiles',
        autoGenerate: true,
        schema: { uid: 15235, refs: { '15235': { type: 'object', meta: { default: {} }, dict: { profiles: 15234 } } } },
        value: { profiles: [{ name: 'overlay-row', command: 'pwsh' }] },
        base: { profiles: [] },
        user: { profiles: [] },
        applies: 'live',
        secrets: [],
        revision: 0,
      },
    ],
  },
};

/** 宿主被拒时的线上错误形态（`settings/rejected`；`dsh-api-settings-controller/lib/index.js:500-508` 保留 message） */
const REFUSAL_RESPONSE: SettingsResponse = {
  ok: false,
  error: { code: 'settings/rejected', message: HOST_REFUSAL, details: { ns: 'dsh-terminal-profiles' } },
};

function readOutcome(): ConfigReadOutcome {
  return { kind: 'ok', state: readNamespaceState(REAL_OVERLAY_DESCRIBE) };
}

/** 每个用例一套独立的假宿主 + 真管道（计数器不跨用例串味） */
function makePipe() {
  const remote = createFakeRemoteSettings({ describe: REAL_OVERLAY_DESCRIBE, update: REFUSAL_RESPONSE });
  return { remote, pipe: createConfigPipe(() => remote) };
}

async function renderLoaded(pipe: ConfigPipe): Promise<void> {
  render(<ConfigPage pipe={pipe} />);
  await waitFor(() => {
    expect(screen.queryByTestId('cfg-loading'), '加载占位必须消失').toBeNull();
  });
}

function input(index: number, field: string): HTMLInputElement {
  return within(screen.getByTestId(`cfg-row-${index}`)).getByTestId(`inp-profile-${field}`) as HTMLInputElement;
}

describe('缺陷 A 判据一：真机载荷本身**不提供**只读信号（所以只能认拒绝）', () => {
  it('readNamespaceState(真机载荷) ⇒ readOnly 缺席，但行读得出来（不是解析失败）', () => {
    const state = readNamespaceState(REAL_OVERLAY_DESCRIBE);
    expectThat('readOnly 缺席（载荷里没有可写性字段）', state.readOnly, undefined);
    expectThat('命名空间确实解析到了', state.rawFound, true);
    expectThat('读到的行 = 生效值（含 overlay 内容）', state.rows, [{ name: 'overlay-row', command: 'pwsh' }]);
    expectThat('外层 writable 恒真这一点也在夹具里', (REAL_OVERLAY_DESCRIBE.value as { writable: boolean }).writable, true);
  });

  it('isReadOnlyRefusal：认宿主原文；**故意不认**裸的「磁盘只读」（存储故障不是本行被覆盖）', () => {
    expectThat('宿主原文 ⇒ 只读类', isReadOnlyRefusal(REFUSAL_RESPONSE.error), true);
    expectThat('字符串形态也认', isReadOnlyRefusal(HOST_REFUSAL), true);
    expectThat('磁盘只读 ⇒ **不**归只读（保持既有判据：未知错误不许说成冲突/只读）', isReadOnlyRefusal('磁盘只读'), false);
    expectThat('无关错误 ⇒ false', isReadOnlyRefusal({ message: 'bridge gone' }), false);
  });

  it('管道：同一句拒绝 ⇒ readonly（原因 = 宿主原文；路径**如实降级**，不伪造）', async () => {
    const { remote, pipe } = makePipe();
    const outcome = await pipe.saveProfiles([{ name: 'dev', command: 'wsl.exe' }]);
    expectThat('kind', outcome.kind, 'readonly');
    expectThat(
      '原因是宿主原文',
      outcome.kind === 'readonly' ? outcome.notice.reason.includes('overridden by a home patch') : false,
      true,
    );
    expectThat('路径如实写「宿主未提供」', outcome.kind === 'readonly' ? outcome.notice.path : '', READONLY_PATH_UNKNOWN);
    expectThat('真的发过一次 update（拒绝就是信号）', remote.calls.updates.length, 1);
    expectThat('命名空间', remote.calls.updates[0]?.ns, 'dsh-terminal-profiles');
  });
});

describe('缺陷 A 判据二：页面把它渲染成**不可编辑 + 显示原因**', () => {
  it('点保存被拒 ⇒ 只读横幅出现（原因 + 路径如实）、编辑控件全锁、后续保存零写入', async () => {
    const { remote, pipe } = makePipe();
    await renderLoaded(pipe);
    expectThat('初始不是只读态', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'false');

    fireEvent.click(screen.getByTestId('btn-profile-save'));
    const banner = await screen.findByTestId('cfg-readonly');
    scan.assertions += 1;
    expect(banner.textContent).toContain('overridden by a home patch');
    scan.assertions += 1;
    expect(banner.textContent).toContain('宿主未提供');

    expectThat('页面进入只读态', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'true');
    expectThat('输入框不可编辑', input(0, 'name').disabled, true);
    expectThat('每个字段都锁', (['name', 'command', 'args', 'cwd', 'cwdLinux', 'env'] as const).every((field) => input(0, field).disabled), true);
    expectThat('行内删除按钮锁', (screen.getByTestId('btn-profile-remove') as HTMLButtonElement).disabled, true);
    expectThat('「新增 profile」锁', (screen.getByTestId('btn-profile-add') as HTMLButtonElement).disabled, true);
    expectThat('行也带只读标记', screen.getByTestId('cfg-row-0').getAttribute('data-readonly'), 'true');
    expectThat('用户输入还在', input(0, 'name').value, 'overlay-row');

    // 只读态下「保存」**故意**仍可点：它就是 REQ-10.3「不写盘」的证据面（早退 ⇒ 不再发 update）
    const before = remote.calls.updates.length;
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    await screen.findByTestId('cfg-error');
    expectThat('第二次点保存**不再**发写入', remote.calls.updates.length, before);
    expectThat('提示里也有原因', screen.getByTestId('cfg-error').textContent?.includes('overridden by a home patch'), true);
  });
});

describe('缺陷 A 🔴 变异哨兵', () => {
  /** 逐字复刻修复前的管道行为：同一句宿主拒绝 ⇒ failed（而不是 readonly） */
  function legacyPipe() {
    return createFakeConfigPipe({
      read: readOutcome(),
      save: { kind: 'failed', message: `写入配置失败：${HOST_REFUSAL}`, skipped: [] },
    });
  }

  it('旧行为（拒绝 ⇒ failed）在同一个 React 下渲染出**可编辑表单**（本门必须判它错）', async () => {
    const legacy = legacyPipe();
    await renderLoaded(legacy);
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    const notice = await screen.findByTestId('cfg-error');

    // 原始观测（报告里要贴的那一行）：哨兵「真的开火」要有终端原文，而不是只有断言绿
    console.log(
      `[sentinel] 旧行为（拒绝⇒failed）：cfg-readonly=${screen.queryByTestId('cfg-readonly') === null ? '缺失' : '在'}` +
        ` data-readonly=${String(screen.getByTestId('cfg-page').getAttribute('data-readonly'))}` +
        ` input.disabled=${String(input(0, 'name').disabled)}` +
        ` 话术=${JSON.stringify(notice.textContent?.slice(0, 60))}`,
    );
    // ① 只读横幅**不存在**
    expectThat('旧行为：没有只读横幅', screen.queryByTestId('cfg-readonly'), null);
    // ② 页面自报「可编辑」
    expectThat('旧行为：data-readonly', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'false');
    // ③ 输入框**可编辑**（缺陷的症状）
    expectThat('旧行为：输入框可编辑', input(0, 'name').disabled, false);
    // ④ 只有一句没有路径的失败话术
    expectThat('旧行为：话术是「写入配置失败」', notice.textContent?.startsWith('写入配置失败：'), true);
    expectThat('旧行为：话术里没有路径', notice.textContent?.includes('宿主未提供'), false);

    // 同一条判据在修好的实现上**必须**相反（两个结果来自同一条渲染路径，不靠相信）
    cleanup();
    const fixed = makePipe();
    render(<ConfigPage pipe={fixed.pipe} />);
    await waitFor(() => {
      expect(screen.queryByTestId('cfg-loading')).toBeNull();
    });
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    await screen.findByTestId('cfg-readonly');
    expectThat('修好后：只读横幅在', screen.queryByTestId('cfg-readonly') !== null, true);
    expectThat('修好后：data-readonly', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'true');
    expectThat('修好后：输入框不可编辑', input(0, 'name').disabled, true);
  });
});

describe('扫描面统计（判据自己会说扫了多少）', () => {
  it('打印本次断言数', () => {
    console.log(`[scan] client-config-readonly：断言 ${scan.assertions} 条`);
    expectThat('断言数 > 0', scan.assertions > 0, true);
  });
});
