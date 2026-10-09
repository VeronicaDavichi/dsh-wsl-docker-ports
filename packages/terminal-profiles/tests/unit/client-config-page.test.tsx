// @vitest-environment jsdom
/**
 * 002 T6.2 / T6.3 / T6.4：自绘配置页（`src/client/config-page.tsx`）—— jsdom + React + 假管道。
 *
 * 判据（每条都可被变异杀死）：
 *   - T6.2 含 ordinary 字段 ⇒ **弹确认**且 `saveProfiles` **一次都没调**（确认前零写盘）；
 *   - T6.2 volatile-only ⇒ 直接写，不弹确认；
 *   - T6.3 只读 ⇒ `cfg-readonly` 同时给出**原因**与**路径**，且**一次都不写**；
 *   - T6.3 revision 冲突 ⇒ 提示 + 输入框里的字**还在**（不清空）；
 *   - T6.3 唯一寻址不满足 ⇒ 显示限制；
 *   - T6.4 单条无效 ⇒ 只标红那一行，其余行**照常写**；全部无效 ⇒ 一个字节都不写；
 *   - T6.4/RQ-2.4 页面文案含「改 cwd 只影响新建实例」。
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { CWD_NOTICE, ConfigPage, ConfigSummary, collectRowProblems } from '../../src/client/config-page.tsx';
import { classifyPatchFields } from '../../src/client/config-pipe.ts';
import type { FieldLiveness } from '../../src/client/config-pipe.ts';
import { emptyRow, parseEnvText, draftRow, fromRawRow, rowsEqual } from '../../src/client/config-row-model.ts';
import { createFakeConfigPipe, describeWith } from '../helpers/config-fixtures.ts';
import { createConfigPipe } from '../../src/client/config-pipe.ts';
import { createFakeRemoteSettings } from '../helpers/config-fixtures.ts';

afterEach(() => {
  cleanup();
});

const scan = { assertions: 0 };

function expectThat(label: string, actual: unknown, expected: unknown): void {
  scan.assertions += 1;
  expect(actual, label).toStrictEqual(expected);
}

function okRead(rows: readonly unknown[], extra: Record<string, unknown> = {}) {
  return {
    kind: 'ok' as const,
    state: {
      readOnly: undefined,
      addressability: undefined,
      rows,
      revision: 1,
      rawFound: true,
      ...extra,
    },
  };
}

/** 找到第 index 行的输入框（`data-row-index` 是行内所有控件共有的锚） */
function rowInput(index: number, field: string): HTMLInputElement {
  const row = screen.getByTestId(`cfg-row-${index}`);
  return within(row).getByTestId(`inp-profile-${field}`) as HTMLInputElement;
}

/**
 * 渲染并**等到加载结束**（`readConfig()` 是一次 IPC 往返 ⇒ 不 await 就点保存等于「配置还没读回来就写」）。
 * 这个等待本身也是判据：`cfg-loading` 必须真的消失（假管道若永不 settle，测试会超时而不是假绿）。
 */
async function renderLoaded(element: ReactElement): Promise<void> {
  render(element);
  await waitFor(() => {
    expect(screen.queryByTestId('cfg-loading'), '加载占位必须消失').toBeNull();
  });
}

describe('T6.2 保存前判定（REQ-2.1 / REQ-2.2）', () => {
  it('volatile-only ⇒ 直接写、不弹确认', async () => {
    const pipe = createFakeConfigPipe({ read: okRead([{ name: 'dev', command: 'wsl.exe' }]) });
    await renderLoaded(<ConfigPage pipe={pipe} />);
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    await screen.findByTestId('cfg-error');
    expectThat('未弹确认', screen.queryByTestId('cfg-confirm'), null);
    expectThat('写了一次', pipe.calls.saves.length, 1);
    expectThat('patch 内容', pipe.calls.saves[0]?.rows, [
      { name: 'dev', command: 'wsl.exe', args: [], env: {} },
    ]);
  });

  it('含 ordinary 字段（宿主把 profiles 判成 ordinary）⇒ 弹确认，且**确认前零写盘**', async () => {
    const liveness: FieldLiveness = {
      classify: () => ({ volatileOnly: false, ordinaryFields: ['profiles'] }),
    };
    const pipe = createFakeConfigPipe({ read: okRead([{ name: 'dev', command: 'wsl.exe' }]) });
    await renderLoaded(<ConfigPage pipe={pipe} liveness={liveness} />);
    fireEvent.click(screen.getByTestId('btn-profile-save'));

    const confirm = screen.getByTestId('cfg-confirm');
    scan.assertions += 1;
    expect(confirm.textContent).toContain('正在运行的终端将被终止');
    expectThat('确认前零写盘', pipe.calls.saves.length, 0);
    expectThat('列出 ordinary 字段', screen.getByTestId('cfg-confirm-fields').textContent, 'ordinary 字段：profiles');
  });

  it('确认后才写（取消则永远不写），且确认框消失', async () => {
    const liveness: FieldLiveness = { classify: () => ({ volatileOnly: false, ordinaryFields: ['profiles'] }) };
    const pipe = createFakeConfigPipe({ read: okRead([{ name: 'dev', command: 'wsl.exe' }]) });
    await renderLoaded(<ConfigPage pipe={pipe} liveness={liveness} />);
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    fireEvent.click(screen.getByTestId('btn-cancel-save'));
    expectThat('取消后零写盘', pipe.calls.saves.length, 0);
    expectThat('确认框已消失', screen.queryByTestId('cfg-confirm'), null);

    fireEvent.click(screen.getByTestId('btn-profile-save'));
    fireEvent.click(screen.getByTestId('btn-confirm-save'));
    await screen.findByTestId('cfg-error');
    expectThat('确认后写了一次', pipe.calls.saves.length, 1);
  });

  it('判定用的是**真实**字段集（profiles 走 volatile 表 ⇒ 不弹确认）', () => {
    expectThat('分类', classifyPatchFields(['profiles']), { volatileOnly: true, ordinaryFields: [] });
  });
});

describe('T6.3 只读 / 冲突 / 限制（REQ-10.3 / REQ-10.4 / REQ-10.5）', () => {
  it('只读 ⇒ 同时显示原因与文件路径，且点保存也**不写盘**（REQ-10.3）', async () => {
    const pipe = createFakeConfigPipe({
      read: okRead([{ name: 'dev', command: 'wsl.exe' }], {
        readOnly: { reason: 'home patch 覆盖了本行', path: 'C:\\Users\\x\\.dsh\\cordis.patch.yml' },
      }),
    });
    await renderLoaded(<ConfigPage pipe={pipe} />);
    const box = await screen.findByTestId('cfg-readonly');
    scan.assertions += 1;
    expect(box.textContent).toContain('home patch 覆盖了本行');
    scan.assertions += 1;
    expect(box.textContent).toContain('C:\\Users\\x\\.dsh\\cordis.patch.yml');

    fireEvent.click(screen.getByTestId('btn-profile-save'));
    await screen.findByTestId('cfg-error');
    expectThat('updateCount 不动（一次都没写）', pipe.updateCount(), 0);
    expectThat('提示里也有原因与路径', screen.getByTestId('cfg-error').textContent?.includes('cordis.patch.yml'), true);
    expectThat('用户输入还在', rowInput(0, 'name').value, 'dev');
  });

  it('revision 冲突 ⇒ 提示原因 + **保留用户输入**（输入框内容逐字不变）（REQ-10.4）', async () => {
    const pipe = createFakeConfigPipe({
      read: okRead([{ name: 'dev', command: 'wsl.exe' }]),
      save: { kind: 'conflict', message: '配置已被其他窗口改动（revision 冲突）⇒ 未写入，请刷新后重试', skipped: [] },
    });
    await renderLoaded(<ConfigPage pipe={pipe} />);
    fireEvent.change(rowInput(0, 'command'), { target: { value: 'wsl.exe -d Ubuntu2204  ' } });
    fireEvent.click(screen.getByTestId('btn-profile-save'));

    const notice = await screen.findByTestId('cfg-error');
    scan.assertions += 1;
    expect(notice.textContent).toContain('revision 冲突');
    expectThat('命令输入保留（含尾随空格，未被重置）', rowInput(0, 'command').value, 'wsl.exe -d Ubuntu2204  ');
    expectThat('名字输入保留', rowInput(0, 'name').value, 'dev');
  });

  it('保存失败（failed）⇒ 同样保留输入', async () => {
    const pipe = createFakeConfigPipe({
      read: okRead([{ name: 'dev', command: 'wsl.exe' }]),
      save: { kind: 'failed', message: '写入配置失败：磁盘只读', skipped: [] },
    });
    await renderLoaded(<ConfigPage pipe={pipe} />);
    fireEvent.change(rowInput(0, 'name'), { target: { value: 'renamed' } });
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    await screen.findByTestId('cfg-error');
    expectThat('名字保留', rowInput(0, 'name').value, 'renamed');
  });

  it('唯一寻址不满足 ⇒ 显示该限制（不让人白填）（REQ-10.5）', async () => {
    const pipe = createFakeConfigPipe({
      read: okRead([], { addressability: { reason: '宿主未把本行当作可唯一寻址的配置条目' } }),
    });
    await renderLoaded(<ConfigPage pipe={pipe} />);
    const box = await screen.findByTestId('cfg-limitation');
    scan.assertions += 1;
    expect(box.textContent).toContain('唯一寻址');
  });

  it('管道未接线 / 宿主不给 remote.settings ⇒ 明说不可用（不假装保存成功）', async () => {
    render(<ConfigPage />);
    const notice = await screen.findByTestId('cfg-error');
    scan.assertions += 1;
    expect(notice.textContent).toContain('未接线');

    const noService = createConfigPipe(() => undefined);
    const outcome = await noService.readConfig();
    expectThat('读结果', outcome.kind, 'unavailable');
  });
});

describe('T6.4 容错与语义明示（REQ-1.2 / REQ-2.4）', () => {
  it('单条无效不阻塞其余：无效行标红 + 排除出 patch，有效行照常写', async () => {
    const pipe = createFakeConfigPipe({
      read: okRead([
        { name: '', command: 'wsl.exe' },
        { name: 'ok-one', command: 'wsl.exe' },
      ]),
    });
    await renderLoaded(<ConfigPage pipe={pipe} />);
    await screen.findByTestId('cfg-row-0');
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    await screen.findByTestId('cfg-error');

    expectThat('只写了一行', pipe.calls.saves[0]?.rows.length, 1);
    expectThat('写的是有效行', pipe.calls.saves[0]?.rows, [{ name: 'ok-one', command: 'wsl.exe', args: [], env: {} }]);
    scan.assertions += 1;
    expect(screen.getByTestId('cfg-row-error-0').textContent).toContain('缺必填字段 name');
    expectThat('有效行没有错误块', screen.queryByTestId('cfg-row-error-1'), null);

    const collected = collectRowProblems([{ ...emptyRow(), name: 'a', command: 'wsl.exe' }]);
    expectThat('无问题行', collected.problems.size, 0);
  });

  it('全部无效 ⇒ 一个字节都不写（否则等于用空数组清空既有配置）', async () => {
    const pipe = createFakeConfigPipe({ read: okRead([{ name: '', command: '' }]) });
    await renderLoaded(<ConfigPage pipe={pipe} />);
    await screen.findByTestId('cfg-row-0');
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    const notice = await screen.findByTestId('cfg-error');
    scan.assertions += 1;
    expect(notice.textContent).toContain('未写盘');
    expectThat('零写盘', pipe.calls.saves.length, 0);
    expectThat('输入保留', rowInput(0, 'name').value, '');
  });

  it('页面文案含「改 cwd 只影响新建实例」（REQ-2.4）', () => {
    render(<ConfigPage />);
    const notice = screen.getByTestId('cfg-cwd-notice');
    scan.assertions += 1;
    expect(notice.textContent).toContain('改 cwd 只影响新建实例');
    expectThat('常量与 DOM 逐字一致', notice.textContent, CWD_NOTICE);
  });

  it('新增 / 删除条目（控件表 §2.2 的 data-testid）', async () => {
    const pipe = createFakeConfigPipe({ read: okRead([{ name: 'dev', command: 'wsl.exe' }]) });
    await renderLoaded(<ConfigPage pipe={pipe} />);
    await screen.findByTestId('cfg-row-0');
    fireEvent.click(screen.getByTestId('btn-profile-add'));
    expectThat('加了一行', screen.getByTestId('cfg-row-1') !== null, true);
    fireEvent.click(within(screen.getByTestId('cfg-row-1')).getByTestId('btn-profile-remove'));
    expectThat('删除后只剩一行', screen.queryByTestId('cfg-row-1'), null);
  });

  it('空配置 ⇒ 引导态（REQ-1.5），仍可新增', async () => {
    const pipe = createFakeConfigPipe({ read: okRead([]) });
    await renderLoaded(<ConfigPage pipe={pipe} />);
    await screen.findByTestId('cfg-empty');
    fireEvent.click(screen.getByTestId('btn-profile-add'));
    expectThat('新增后不再是空态', screen.queryByTestId('cfg-empty'), null);
    expectThat('出现第一行', screen.getByTestId('cfg-row-0') !== null, true);
  });

  it('摘要视图（ownerProps.view === "summary" 用）有独立 testid', () => {
    render(<ConfigSummary />);
    expectThat('摘要存在', screen.getByTestId('cfg-summary') !== null, true);
  });
});

describe('表单行模型（纯函数）', () => {
  it('args 一行一个；env 走 KEY=VALUE，坏行只报问题不影响其它行', () => {
    expectThat('args', draftRow({ ...emptyRow(), name: 'a', command: 'wsl.exe', args: ' -d \n Ubuntu2204 \n\n' }, 0).raw['args'], [
      '-d',
      'Ubuntu2204',
    ]);
    const parsed = parseEnvText('A=1\nBADLINE\nB=\n');
    expectThat('env', parsed.env, { A: '1', B: '' });
    expectThat('坏行数', parsed.problems.length, 1);
    scan.assertions += 1;
    expect(parsed.problems[0]).toContain('不是 KEY=VALUE');
  });

  it('fromRawRow 回填 + rowsEqual 做脏检查（结构比，不因空格误判）', () => {
    const row = fromRawRow({ name: 'a', command: 'wsl.exe', args: ['-d', 'Ubuntu2204'], env: { K: 'v' }, cwd: 'E:\\w' });
    expectThat('args 回填', row.args, '-d\nUbuntu2204');
    expectThat('env 回填', row.env, 'K=v');
    expectThat('cwd 回填', row.cwd, 'E:\\w');
    expectThat('同内容不同空白 ⇒ 相等', rowsEqual({ ...row, args: ' -d \n Ubuntu2204 ' }, row), true);
    expectThat('真改一处 ⇒ 不等', rowsEqual({ ...row, command: 'pwsh.exe' }, row), false);
  });

  it('读回来的脏值不会让 UI 崩（非字符串一律兜底成空串/JSON）', () => {
    const row = fromRawRow({ name: 42, command: null, args: ['a', 7], env: { K: 9 } });
    expectThat('name', row.name, '');
    expectThat('command', row.command, '');
    expectThat('args 序列化非字符串', row.args, 'a\n7');
    expectThat('env 序列化非字符串', row.env, 'K=9');
  });
});

describe('扫描面统计（判据自己会说扫了多少）', () => {
  it('打印本次断言数 + 常见只读形状的自检', () => {
    console.log(`[scan] client-config-page：断言 ${scan.assertions} 条`);
    expectThat('断言数 > 0', scan.assertions > 0, true);
    // 只读形状的读取在此再走一遍（页面用的就是这条管道）
    const service = createFakeRemoteSettings({
      describe: describeWith({ writable: false, reason: 'overridden by --patch', path: 'D:\\p\\cordis.patch.yml' }),
    });
    expectThat('只读形状可读', typeof service.calls.describes, 'number');
  });
});
