/**
 * 真机 fixture 契约测试（001 T0.1 + T2.1/T2.2 验收）
 *
 * 断言对象是**真机原始字节**（`fixtures/wsl-list-verbose.raw`），不是我复述的常量。
 *
 * ⚠️ **口径变更（T2.2 落地时）**：T0.1 期间曾把「一个发行版都解析不出来」判为抛错；
 * REQ-1.6 定案为「**命令成功但无发行版 → `[]` 且成功**」（「装好了但一个都没有」与
 * 「命令失败」是两种事实，后者由 `exec.ts` 的 `CommandNotFound`/`NonZeroExit` 给出）。
 * 因此解析层不再抛异常 —— 本文件第 5 条用例就是这条口径的正身。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createExecutor, type SpawnLike } from '../../src/exec.ts';
import { decodeWslOutput, listDistros, parseDistroTable } from '../../src/distros.ts';

const raw = new Uint8Array(
  readFileSync(new URL('./fixtures/wsl-list-verbose.raw', import.meta.url)),
);

test('T0.1/T2.1 真机 fixture：UTF-16LE 解码不残留 NUL、剥 BOM、含发行版名', () => {
  const text = decodeWslOutput(raw);
  assert.equal(text.includes('\u0000'), false, '解码结果不应残留 NUL');
  assert.match(text, /Ubuntu2204/, '解码结果应含发行版名');
  assert.notEqual(text.charCodeAt(0), 0xfeff, 'BOM 必须被剥掉（否则第一列会带上 U+FEFF）');
});

test('T2.1 负例：同一批字节按 UTF-8 硬解会得到乱码（编码指纹不是可选项）', () => {
  const wrong = new TextDecoder('utf-8').decode(raw);
  assert.equal(wrong.includes('Ubuntu2204'), false, '按 UTF-8 解不应还能读出名字');
  assert.equal(wrong.includes('\u0000'), true, '应看到残留 NUL —— 这就是指纹的依据');
});

test('T0.1/T2.2 真机 fixture：解析出 Ubuntu2204 / Stopped / 2 / isDefault', () => {
  const distros = parseDistroTable(raw);
  assert.equal(distros.length, 1, '本机 fixture 只有 1 个发行版');

  const first = distros[0];
  if (first === undefined) throw new Error('fixture 应至少解析出 1 个发行版');
  assert.equal(first.name, 'Ubuntu2204');
  assert.equal(first.state, 'Stopped');
  assert.equal(first.version, 2);
  assert.equal(first.isDefault, true, 'fixture 里带 `*` 的那一行是 WSL 默认发行版');
});

test('T2.2 端到端：真机字节经 createExecutor + listDistros 管线（fake spawn，离线）', async () => {
  const spawn = ((_file: string, _argv: readonly string[]) =>
    ({
      pid: 1,
      stdout: {
        on: (_event: string, listener: (chunk: Uint8Array) => void) => {
          listener(raw);
        },
      },
      stderr: { on: () => undefined },
      on: (event: string, listener: (code: number | null) => void) => {
        if (event === 'close') listener(0);
      },
      kill: () => true,
    }) as unknown as ReturnType<SpawnLike>) as SpawnLike;

  const outcome = await listDistros(createExecutor(spawn));
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.distros[0]?.name, 'Ubuntu2204');
});

test('REQ-1.6（口径正身）：命令成功但没有发行版 → `[]`，不抛异常', () => {
  const banner = '适用于 Linux 的 Windows 子系统没有已安装的分发版。\n';
  assert.deepEqual(parseDistroTable(banner), []);
  assert.deepEqual(parseDistroTable(''), []);
  assert.deepEqual(parseDistroTable('  NAME   STATE   VERSION\n'), []);
});

test('REQ-1.4 反例：名字含空格时从右往左取列（不被切碎）', () => {
  const text = '  NAME              STATE           VERSION\n* Ubuntu 22.04 LTS  Stopped         2\n';
  const distros = parseDistroTable(text);
  assert.equal(distros[0]?.name, 'Ubuntu 22.04 LTS');
  assert.equal(distros[0]?.state, 'Stopped');
});

test('REQ-1.5 反例：UTF-8 文本不应被误判为 UTF-16LE（指纹判据的另一半）', () => {
  const utf8 = new TextEncoder().encode(
    '  NAME          STATE           VERSION\n* Ubuntu2204    Running         2\n',
  );
  const distros = parseDistroTable(utf8);
  assert.equal(distros[0]?.name, 'Ubuntu2204');
  assert.equal(distros[0]?.state, 'Running');
  assert.equal(distros[0]?.isDefault, true);
});
