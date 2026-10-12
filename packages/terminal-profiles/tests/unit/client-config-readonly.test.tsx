// @vitest-environment jsdom
/**
 * 007 只读态回归门：**两条可达路径 + 假阳性防护 + 变异哨兵**
 *
 * ## 路径 ②（`6191b57`，保留）：写入被拒 ⇒ 锁定
 *
 * 真机（`volatile-probe` + `--patch` 生效）实测：写入**确实被拒**（宿主原文
 * `Configuration for "dsh-terminal-profiles" is overridden by a home patch or command-line overlay`，
 * patch 文件 sha 未变），但 `settings/describe` 的载荷里
 * **外层 `writable` 恒为 `true`、21/21 个命名空间都不带 `writable`/`readOnly`/`addressable`、全载荷无路径**。
 *
 * ## 路径 ①（2026-10-12 自动触发轮，本文件新增）：零写入推断 ⇒ **打开即只读**
 *
 * 载荷自己带着覆盖层的痕迹：`value ≠ merge(base, user)`（宿主 `dsh-settings/lib/index.js:436-439`
 * 的三份载荷语义 + `:281-291` 的 `mergeLayers`）。真机同一次采样里：
 * **有**覆盖层（B2）21 条命名空间中**恰好 1 条**（本包）被破坏；**无**覆盖层（B1）**21/21 条**全部满足。
 * ⚠️ 判据**保守**：任何不确定 ⇒ 判**可写**（假阳性 = 把可写表单锁成永久只读，代价极高）。
 * 逐条反例（schema 默认值 / `!!js` / secret 脱敏 / 键序 / 「值变少」）都有用例，见
 * `src/client/config-readonly.ts` 的反例表。
 *
 * ## 真机载荷（本文件的夹具）
 *
 * 字段名与取值逐字取自探针产物 `C:\Users\EDY\dsh-probe-artifacts\20261012-150641-batch\`：
 *
 * | 夹具 | 出处 | 字节 / sha256 |
 * | --- | --- | --- |
 * | `REAL_OVERLAY_DESCRIBE` | `B2-remote-settings-describe-with-overlay.raw.json` 的 `result` 里 `dsh-terminal-profiles` 那一条（**schema 三段 refs 全给** —— 删掉 `profiles` 那条 default 会让「schema 默认值」这条排除逻辑失去输入） | 34521 B / `BE00EE3D…` |
 * | `REAL_WRITABLE_DESCRIBE` | `B1-remote-settings-describe.raw.json` 的同一条（无覆盖层对照件，`user` 为空、`value == base`） | 35198 B / `BD802FDA…` |
 * | `DEFAULT_FILLED_DESCRIBE` | **构造样本**（由 B1 派生：`base` 退化成 `{}`，复刻 `inheritedConfig` 在 `resolveConfig` 抛错时回落原始值 `:314-320` ⇒ 默认值只在 `value` 里） | — |
 *
 * 两份真机载荷的差别**只有** `user`/`value` 两个值（结构完全同形）。
 *
 * ## 🔴 变异哨兵
 *
 * 逐字复刻**修复前**的读路径（`readNamespaceState` 只认宿主自报的显式信号：`writable:false` /
 * `readOnly:true`，没有任何推断）＋**修复前**的写路径（同一句宿主拒绝 ⇒ `{kind:'failed'}`），
 * 在**同一个 React**下渲染同一张页面 ⇒ 断言它渲染出「可编辑表单」（`cfg-readonly` 不存在、
 * `data-readonly="false"`、输入框 `disabled === false`）。于是「这条门真能杀掉旧行为」跑一次就有数字。
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
import type { ConfigPipe, NamespaceState, ReadOnlyNotice, SettingsResponse } from '../../src/client/config-pipe.ts';
import { inferReadOnly } from '../../src/client/config-readonly.ts';
import {
  HOST_REFUSAL,
  OVERLAY_REFS,
  REAL_OVERLAY_DESCRIBE,
  REAL_WRITABLE_DESCRIBE,
  REFUSAL_RESPONSE,
  createFakeConfigPipe,
  createFakeRemoteSettings,
  describeWith,
  nsEntry,
  withEntry,
} from '../helpers/config-fixtures.ts';

afterEach(() => {
  cleanup();
});

const scan = { assertions: 0 };

function expectThat(label: string, actual: unknown, expected: unknown): void {
  scan.assertions += 1;
  expect(actual, label).toStrictEqual(expected);
}

/** 每个用例一套独立的假宿主 + 真管道（计数器不跨用例串味） */
function makePipe(response: SettingsResponse = REAL_OVERLAY_DESCRIBE) {
  const remote = createFakeRemoteSettings({ describe: response, update: REFUSAL_RESPONSE });
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

describe('判据零：自动触发的判定规则（零写入推断）', () => {
  it('真机 B2（覆盖层）⇒ 覆盖层；真机 B1（无覆盖层）⇒ 一致（**不锁**）', () => {
    const overlay = inferReadOnly(nsEntry(REAL_OVERLAY_DESCRIBE));
    const writable = inferReadOnly(nsEntry(REAL_WRITABLE_DESCRIBE));
    console.log(
      `[infer] B2=${overlay.kind}${overlay.kind === 'overlay' ? ` fields=${overlay.fields.join(',')}` : ''}` +
        ` / B1=${writable.kind}`,
    );
    expectThat('B2 判覆盖层', overlay.kind, 'overlay');
    expectThat('B2 只怪到 profiles 这一条上', overlay.kind === 'overlay' ? [...overlay.fields] : [], ['profiles']);
    expectThat('B1 判一致（21/21 命名空间同一形态 ⇒ 零假阳性）', writable.kind, 'consistent');
  });

  it('readNamespaceState 把推断接进只读态（原因自证、路径**如实降级**不伪造）', () => {
    const state = readNamespaceState(REAL_OVERLAY_DESCRIBE);
    console.log(`[infer] reason=${JSON.stringify(state.readOnly?.reason)}`);
    expectThat('只读原因在', state.readOnly?.reason.includes('零写入推断'), true);
    expectThat('原因里点名是哪个字段', state.readOnly?.reason.includes('profiles'), true);
    expectThat('原因里不冒充宿主原文', state.readOnly?.reason.includes('overridden by a home patch'), false);
    expectThat('路径仍是「宿主未提供」', state.readOnly?.path, READONLY_PATH_UNKNOWN);
    expectThat('行照旧读得出来（只读 ≠ 解析失败）', state.rows, [{ name: 'overlay-row', command: 'pwsh' }]);
  });
});

describe('判据零·假阳性防护：这些情形 value 也可以 ≠ merge(base,user)，但**不许**锁', () => {
  it('反例 1：schema 默认值填充（base 退化成 {}，默认值只在 value 里）⇒ 判一致', () => {
    const response = withEntry({ base: {}, user: {}, value: { profiles: [] } });
    const verdict = inferReadOnly(nsEntry(response));
    console.log(`[infer] schema 默认值填充 ⇒ ${verdict.kind}${verdict.kind === 'indeterminate' ? `(${verdict.why})` : ''}`);
    expectThat('判一致（差异由 meta.default=[] 解释）', verdict.kind, 'consistent');
    expectThat('readOnly 缺席', readNamespaceState(response).readOnly, undefined);
  });

  it('反例 5：值「变少」（value 缺 base 有的键）⇒ 无样本形态，判不确定、**不锁**', () => {
    const response = withEntry({ base: { profiles: [] }, user: {}, value: {} });
    const verdict = inferReadOnly(nsEntry(response));
    console.log(`[infer] 值变少 ⇒ ${verdict.kind}`);
    expectThat('判不确定', verdict.kind, 'indeterminate');
    expectThat('readOnly 缺席', readNamespaceState(response).readOnly, undefined);
  });

  it('缺 base / user（注入形状）⇒ 没有可比的两层 ⇒ 不确定、不锁', () => {
    const response: SettingsResponse = {
      ok: true,
      value: { namespaces: [{ ns: 'dsh-terminal-profiles', value: { profiles: [{ name: 'a', command: 'wsl.exe' }] } }] },
    };
    expectThat('不确定', inferReadOnly(nsEntry(response)).kind, 'indeterminate');
    expectThat('readOnly 缺席（既有注入形状的用例全部不受影响）', readNamespaceState(response).readOnly, undefined);
  });

  it('反例 2：user 里是未求值的 !!js 表达式（value 是求值结果）⇒ 不确定、不锁', () => {
    const response = withEntry({ user: { profiles: { __jsExpr: '[{name:"x"}]' } }, value: { profiles: [{ name: 'evaluated' }] } });
    const verdict = inferReadOnly(nsEntry(response));
    console.log(`[infer] !!js 表达式 ⇒ ${verdict.kind}`);
    expectThat('不确定', verdict.kind, 'indeterminate');
    expectThat('readOnly 缺席', readNamespaceState(response).readOnly, undefined);
  });

  it('反例 3：secret 脱敏（secrets 非空 / schema 含 role=secret）⇒ 不确定、不锁', () => {
    const bySecrets = withEntry({ secrets: [{ name: 'apiKey' }], user: { profiles: [{ name: 'x' }] } });
    const bySchema = withEntry({
      schema: { uid: 5019, refs: { ...OVERLAY_REFS, '5017': { type: 'string', meta: { role: 'secret' } } } },
      user: { profiles: [{ name: 'x' }] },
    });
    expectThat('secrets 非空 ⇒ 不确定', inferReadOnly(nsEntry(bySecrets)).kind, 'indeterminate');
    expectThat('schema 含 secret ⇒ 不确定', inferReadOnly(nsEntry(bySchema)).kind, 'indeterminate');
    expectThat('readOnly 缺席', readNamespaceState(bySecrets).readOnly, undefined);
    expectThat('readOnly 缺席（schema 侧）', readNamespaceState(bySchema).readOnly, undefined);
  });

  it('反例 4：键序不影响判定（projectForm 按 schema 序、mergeLayers 把 user 独有键追加到尾部）', () => {
    // 两个字段的 schema ⇒ 才可能出现「value 按 schema 序、merge 按 base-then-user 序」的键序差
    const response = withEntry({
      schema: {
        uid: '4',
        refs: {
          '1': { type: 'any', meta: {} },
          '2': { type: 'array', meta: { default: [] }, inner: '1' },
          '3': { type: 'string', meta: { default: 'info' } },
          '4': { type: 'object', meta: { default: {} }, dict: { profiles: '2', logLevel: '3' } },
        },
      },
      value: { profiles: [{ name: 'a', command: 'b' }], logLevel: 'debug' },
      base: { logLevel: 'debug' },
      user: { profiles: [{ name: 'a', command: 'b' }] },
    });
    const entry = nsEntry(response);
    const merged = { ...(entry['base'] as object), ...(entry['user'] as object) };
    scan.assertions += 1;
    expect(Object.keys(entry['value'] as object)).not.toStrictEqual(Object.keys(merged));
    scan.assertions += 1;
    expect(JSON.stringify(entry['value'])).not.toStrictEqual(JSON.stringify(merged));
    console.log('[infer] 键序不同但结构等价 ⇒ consistent（JSON.stringify 比对会在这里假阳性）');
    expectThat('结构等价 ⇒ 一致', inferReadOnly(entry).kind, 'consistent');
    expectThat('readOnly 缺席', readNamespaceState(response).readOnly, undefined);
  });
});

describe('判据一（路径 ② 保留）：拒绝原文仍能锁定，且这是假阴性时的兜底', () => {
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

  it('假阴性兜底：覆盖层把值设成 schema 默认值 ⇒ 推断不出（判一致），但保存被拒 ⇒ 仍然锁上', async () => {
    // `value == base == {profiles: []}`、`user` 有行 ⇒ 与真机 B2 的差别正好落在「默认值」这一档上
    const response = withEntry({ base: { profiles: [] }, user: { profiles: [{ name: 'x', command: 'y' }] }, value: { profiles: [] } });
    const verdict = inferReadOnly(nsEntry(response));
    console.log(`[infer] 覆盖层取默认值 ⇒ ${verdict.kind}（假阴性，靠路径 ② 兜）`);
    expectThat('推断不出（如实）', verdict.kind, 'consistent');
    expectThat('读态不是只读', readNamespaceState(response).readOnly, undefined);

    const { remote, pipe } = makePipe(response);
    await renderLoaded(pipe);
    expectThat('打开时没锁（假阴性）', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'false');
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    await screen.findByTestId('cfg-readonly');
    expectThat('被拒之后锁上（兜底生效）', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'true');
    expectThat('这一支确实发过一次 update', remote.calls.updates.length, 1);
  });
});

describe('判据二：覆盖层载荷 ⇒ **打开即只读**，且整个过程零写入', () => {
  it('打开（不点任何按钮）⇒ 只读横幅 + 编辑面全锁 + update 调用数 = 0', async () => {
    const { remote, pipe } = makePipe();
    await renderLoaded(pipe);

    const banner = await screen.findByTestId('cfg-readonly');
    expectThat('没有点过保存', remote.calls.updates.length, 0);
    scan.assertions += 1;
    expect(banner.textContent).toContain('零写入推断');
    scan.assertions += 1;
    expect(banner.textContent).toContain('宿主未提供');
    expectThat('页面进入只读态', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'true');
    expectThat('输入框不可编辑', input(0, 'name').disabled, true);
    expectThat(
      '每个字段都锁',
      (['name', 'command', 'args', 'cwd', 'cwdLinux', 'env'] as const).every((field) => input(0, field).disabled),
      true,
    );
    expectThat('行内删除按钮锁', (screen.getByTestId('btn-profile-remove') as HTMLButtonElement).disabled, true);
    expectThat('「新增 profile」锁', (screen.getByTestId('btn-profile-add') as HTMLButtonElement).disabled, true);
    expectThat('行也带只读标记', screen.getByTestId('cfg-row-0').getAttribute('data-readonly'), 'true');
    expectThat('用户输入还在', input(0, 'name').value, 'overlay-row');
    expectThat('只读判定与「行读得出来」两件事都成立', screen.getByTestId('cfg-row-0') !== null, true);
  });

  it('只读态下「保存」**故意**仍可点：点了只解释原因，依然零写入', async () => {
    const { remote, pipe } = makePipe();
    await renderLoaded(pipe);
    await screen.findByTestId('cfg-readonly');
    fireEvent.click(screen.getByTestId('btn-profile-save'));
    await screen.findByTestId('cfg-error');
    expectThat('第二次点保存**不再**发写入', remote.calls.updates.length, 0);
    expectThat('提示里也有原因', screen.getByTestId('cfg-error').textContent?.includes('零写入推断'), true);
  });

  it('真机 B1（无覆盖层）⇒ 打开**不锁**；宿主不给 base/user 的注入形状 ⇒ 也不锁（假阳性回归门）', async () => {
    const { remote, pipe } = makePipe(REAL_WRITABLE_DESCRIBE);
    await renderLoaded(pipe);
    expectThat('不是只读态', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'false');
    expectThat('没有只读横幅', screen.queryByTestId('cfg-readonly'), null);
    // B1 真机上 `profiles: []`（bundle 层没有 config ⇒ 走 schema 默认值）⇒ 空配置的引导态照旧
    expectThat('空配置引导态照旧（只读 ≠ 空配置）', screen.queryByTestId('cfg-empty') !== null, true);
    expectThat('零写入（还没点保存）', remote.calls.updates.length, 0);

    cleanup();
    // 注入形状（宿主不给 base/user：既有的「形状未验证 ⇒ 逐个候选名试」那一路）⇒ 没有可比的两层 ⇒ 不许锁
    const injected = makePipe(describeWith({ value: { profiles: [{ name: 'dev', command: 'wsl.exe' }] }, revision: 3 }));
    await renderLoaded(injected.pipe);
    expectThat('注入形状：不锁', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'false');
    expectThat('注入形状：输入框可编辑', input(0, 'name').disabled, false);
    expectThat('注入形状：值来自 value', input(0, 'name').value, 'dev');
    expectThat('注入形状：零写入', injected.remote.calls.updates.length, 0);
  });
});

describe('🔴 变异哨兵：旧实现（只认宿主自报信号 + 只靠被拒）当场判错', () => {
  /**
   * 逐字复刻**修复前**的读路径：`readNamespaceState` 只扫宿主自报的显式信号
   * （`writable:false` / `readOnly:true`，候选名同旧实现），**没有任何推断**。
   * 它是一个**真在扫**的函数 —— 在真机载荷上返回 `undefined` 是因为载荷里
   * `writable === true` 且没有 `readOnly` 旗标，**不是**因为写成了恒等式。
   */
  function legacyReadOnly(entry: Record<string, unknown>): ReadOnlyNotice | undefined {
    const readBool = (candidates: readonly string[]): boolean | undefined => {
      for (const key of candidates) if (typeof entry[key] === 'boolean') return entry[key] as boolean;
      return undefined;
    };
    const writable = readBool(['writable', 'writableByPlugin', 'canWrite']);
    const flagged = readBool(['readOnly', 'readonly']);
    if (writable === false || flagged === true) {
      return { reason: '宿主拒绝写入（本行被上层 patch 覆盖或当前为只读）', path: READONLY_PATH_UNKNOWN };
    }
    return undefined;
  }

  function legacyState(): NamespaceState {
    const state = readNamespaceState(REAL_OVERLAY_DESCRIBE);
    return { ...state, readOnly: legacyReadOnly(nsEntry(REAL_OVERLAY_DESCRIBE)) };
  }

  /** 逐字复刻修复前的管道行为：同一句宿主拒绝 ⇒ failed（而不是 readonly） */
  function legacyPipe(): ConfigPipe {
    return createFakeConfigPipe({
      read: { kind: 'ok', state: legacyState() },
      save: { kind: 'failed', message: `写入配置失败：${HOST_REFUSAL}`, skipped: [] },
    });
  }

  it('旧行为在同一个 React 下渲染出**可编辑表单**（本门必须判它错），新行为打开即锁', async () => {
    const legacy = legacyPipe();
    await renderLoaded(legacy);
    // 哨兵非空转的前提：真机载荷里外层 `writable` **恒为 true**、条目上没有 readOnly 旗标
    expectThat(
      '载荷外层 writable 恒真（这正是旧读路径取不到信号的原因）',
      (REAL_OVERLAY_DESCRIBE.value as { writable: boolean }).writable,
      true,
    );
    expectThat('条目上没有 readOnly 旗标', nsEntry(REAL_OVERLAY_DESCRIBE)['readOnly'], undefined);
    expectThat('旧读路径在真机载荷上返回 undefined', legacyReadOnly(nsEntry(REAL_OVERLAY_DESCRIBE)), undefined);
    console.log(
      `[sentinel] 旧实现（只认宿主自报 + 只靠被拒）打开时：cfg-readonly=${
        screen.queryByTestId('cfg-readonly') === null ? '缺失' : '在'
      } data-readonly=${String(screen.getByTestId('cfg-page').getAttribute('data-readonly'))}` +
        ` input.disabled=${String(input(0, 'name').disabled)}`,
    );
    expectThat('旧行为：没有只读横幅', screen.queryByTestId('cfg-readonly'), null);
    expectThat('旧行为：页面自报「可编辑」', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'false');
    expectThat('旧行为：输入框可编辑（缺陷症状）', input(0, 'name').disabled, false);

    fireEvent.click(screen.getByTestId('btn-profile-save'));
    const notice = await screen.findByTestId('cfg-error');
    console.log(`[sentinel] 旧实现点保存后：话术=${JSON.stringify(notice.textContent?.slice(0, 60))}`);
    expectThat('旧行为：仍不是只读态', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'false');
    expectThat('旧行为：话术是「写入配置失败」', notice.textContent?.startsWith('写入配置失败：'), true);
    expectThat('旧行为：话术里没有路径', notice.textContent?.includes('宿主未提供'), false);

    // 同一条判据在修好的实现上**必须**相反（两个结果来自同一条渲染路径，不靠相信）
    cleanup();
    const fixed = makePipe();
    await renderLoaded(fixed.pipe);
    console.log(
      `[sentinel] 新实现（零写入推断）打开时：cfg-readonly=${
        screen.queryByTestId('cfg-readonly') === null ? '缺失' : '在'
      } data-readonly=${String(screen.getByTestId('cfg-page').getAttribute('data-readonly'))}` +
        ` input.disabled=${String(input(0, 'name').disabled)} updates=${fixed.remote.calls.updates.length}`,
    );
    expectThat('修好后：只读横幅在', screen.queryByTestId('cfg-readonly') !== null, true);
    expectThat('修好后：data-readonly', screen.getByTestId('cfg-page').getAttribute('data-readonly'), 'true');
    expectThat('修好后：输入框不可编辑', input(0, 'name').disabled, true);
    expectThat('修好后：**一次 update 都没发**就锁上了', fixed.remote.calls.updates.length, 0);
  });
});

describe('扫描面统计（判据自己会说扫了多少）', () => {
  it('打印本次断言数', () => {
    console.log(`[scan] client-config-readonly：断言 ${scan.assertions} 条`);
    expectThat('断言数 > 0', scan.assertions > 0, true);
  });
});
