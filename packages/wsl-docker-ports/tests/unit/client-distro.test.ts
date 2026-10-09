/**
 * T5.8 / REQ-17：目标发行版的**四态来源 + 失效回落**（`node --test`，无 DOM）
 *
 * 001 只保证「四级优先级的判定」；本波要证的是 003 侧的三件事：
 * ① 四种 source 各自能被显示出来；② 配置值失效时**明示失效**并按 WSL 默认回落（不静默换）；
 * ③ 解析过程**只读**（不发 `-d`）且**从不追问**（REQ-17.2）—— 后者用一个 `ask` 计数器断言 0 次。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { distroSourceText, loadDistroPanel } from '../../src/distro.ts';
import type { DistroSource } from 'dsh-wsl-shared';
import { createFakeExecutor, failure, ok } from '../helpers/fake-executor.ts';

const HEADER = '  NAME            STATE           VERSION\n';
function table(...rows: readonly string[]): string {
  return `${HEADER}${rows.join('\n')}\n`;
}

test('T5.8 四种来源：config / wslDefault / onlyOne / first 各自可显示', async () => {
  const twoWithDefault = table('* Ubuntu2204    Running         2', '  Debian        Stopped         2');
  const twoNoDefault = table('  Ubuntu2204    Running         2', '  Debian        Stopped         2');
  const oneOnly = table('  Ubuntu2204    Running         2');

  const cases: readonly { readonly name: string; readonly text: string; readonly configured: string | undefined; readonly expected: DistroSource; readonly expectedName: string }[] = [
    { name: 'config', text: twoWithDefault, configured: 'Debian', expected: 'config', expectedName: 'Debian' },
    { name: 'wslDefault', text: twoWithDefault, configured: undefined, expected: 'wslDefault', expectedName: 'Ubuntu2204' },
    { name: 'onlyOne', text: oneOnly, configured: undefined, expected: 'onlyOne', expectedName: 'Ubuntu2204' },
    { name: 'first', text: twoNoDefault, configured: undefined, expected: 'first', expectedName: 'Ubuntu2204' },
  ];

  for (const item of cases) {
    const { executor } = createFakeExecutor(() => ok(item.text));
    const outcome = await loadDistroPanel({ executor, configured: item.configured });
    assert.equal(outcome.error, null, `${item.name}: 不应报错`);
    assert.equal(outcome.data?.source, item.expected, `${item.name}: source 应为 ${item.expected}`);
    assert.equal(outcome.data?.name, item.expectedName, `${item.name}: name 应为 ${item.expectedName}`);
    assert.equal(outcome.data?.staleConfig, false, `${item.name}: 不应被标为失效`);
    console.log(`  · ${item.name}：name=${String(outcome.data?.name)} 来源文案「${distroSourceText(item.expected)}」`);
  }
  console.log(`  · 扫了 ${String(cases.length)} 种来源`);
});

test('T5.8 失效回落：配置的发行版已不存在 ⇒ 明示失效 + 按 WSL 默认回落（不静默换一个）', async () => {
  const { executor } = createFakeExecutor(() => ok(table('* Ubuntu2204    Running         2', '  Debian        Stopped         2')));
  const outcome = await loadDistroPanel({ executor, configured: 'Ubuntu' });
  assert.equal(outcome.error, null);
  assert.equal(outcome.data?.staleConfig, true, '必须标出「配置已失效」');
  assert.equal(outcome.data?.name, 'Ubuntu2204', '应回落到 WSL 默认发行版');
  assert.equal(outcome.data?.source, 'wslDefault');
  assert.match(String(outcome.data?.message), /Ubuntu/u, '失效文案必须点名配置里那个名字');
  console.log(`  · 失效文案：${String(outcome.data?.message).slice(0, 60)}…`);
});

test('T5.8 降级：一个发行版都没有 ⇒ 只读展示降级为错误文案，不抛异常', async () => {
  const { executor } = createFakeExecutor(() => ok(HEADER));
  const outcome = await loadDistroPanel({ executor });
  assert.equal(outcome.data, null);
  assert.match(String(outcome.error), /没有任何 WSL 发行版/u);
  console.log(`  · 错误文案：${String(outcome.error)}`);
});

test('T5.8 降级：`wsl -l -v` 失败 ⇒ 返回错误文案而非抛出', async () => {
  const { executor } = createFakeExecutor(() => failure('NonZeroExit', { exitCode: 1, stderr: 'wsl.exe 启动失败' }));
  const outcome = await loadDistroPanel({ executor });
  assert.equal(outcome.data, null);
  assert.match(String(outcome.error), /NonZeroExit/u);
  console.log(`  · 错误文案：${String(outcome.error)}`);
});

test('T5.8 REQ-17.2 + 成本红线：解析全程不追问、也不带 `-d`（不冷启动发行版）', async () => {
  const { executor, calls } = createFakeExecutor(() => ok(table('* Ubuntu2204    Running         2')));
  const asked: string[] = [];
  await loadDistroPanel({ executor, configured: 'Nope', ask: async (question) => { asked.push(question); return 'x'; } });
  assert.equal(asked.length, 0, `SHALL NOT 追问用户，实际问了 ${String(asked.length)} 次`);
  assert.ok(calls.length > 0, '应当至少跑过一次 wsl -l -v');
  const withD = calls.filter((call) => call.argv.includes('-d'));
  assert.deepEqual(withD, [], `不得使用 -d（会冷启动发行版），命中 ${JSON.stringify(withD.map((call) => call.argv))}`);
  const argvText = calls.map((call) => [call.file, ...call.argv].join(' '));
  assert.deepEqual(argvText, ['wsl.exe -l -v'], `命令必须是只读的 wsl -l -v，实际 ${JSON.stringify(argvText)}`);
  console.log(`  · 扫了 ${String(calls.length)} 次执行 / ${String(asked.length)} 次提问，带 -d 的 ${String(withD.length)} 次`);
});

test('T5.8 选项列表：列出全部发行版并标出默认与选中项（供 UI 下拉）', async () => {
  const { executor } = createFakeExecutor(() => ok(table('* Ubuntu2204    Running         2', '  Debian        Stopped         2', '  Alpine        Running         2')));
  const outcome = await loadDistroPanel({ executor, configured: 'Debian' });
  const options = outcome.data?.distros ?? [];
  assert.equal(options.length, 3);
  const defaults = options.filter((distro) => distro.isDefault);
  assert.deepEqual(defaults.map((distro) => distro.name), ['Ubuntu2204'], '默认标记只能有一个');
  assert.equal(options.find((distro) => distro.name === 'Debian')?.state, 'Stopped');
  console.log(`  · 扫了 ${String(options.length)} 个发行版 / ${String(defaults.length)} 个默认标记`);
});
