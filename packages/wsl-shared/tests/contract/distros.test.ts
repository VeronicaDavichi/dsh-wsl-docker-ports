/**
 * 真机 fixture 冒烟（001 T0.1 验收）
 *
 * 验收原句：「`node --test` 有一条『fixture 能被解码且至少 1 个发行版含 `Ubuntu2204`』
 * 的冒烟断言跑绿；fixture 内无凭据」。
 *
 * 这里把「能解码」拆成三条可二值判定的断言，并额外补两条**反例**（喂错编码 / 喂脏输入），
 * 避免「解析器在真实输入上碰巧对」这种假绿灯。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { decodeWslOutput, parseDistroList, WslParseError } from '../../src/distros.ts';

const raw = new Uint8Array(
  readFileSync(new URL('./fixtures/wsl-list-verbose.raw', import.meta.url)),
);

test('T0.1 真机 fixture：`wsl -l -v` 原始字节按 UTF-16LE 解码后不残留 NUL', () => {
  const text = decodeWslOutput(raw);
  assert.equal(text.includes('\u0000'), false, '解码结果不应残留 NUL');
  assert.match(text, /Ubuntu2204/, '解码结果应含发行版名');
  assert.notEqual(text.charCodeAt(0), 0xfeff, 'BOM 必须被剥掉（否则第一列解析会带上 U+FEFF）');
});

test('T0.1 真机 fixture：至少解析出 1 个发行版，且含 Ubuntu2204（字段齐全）', () => {
  const distros = parseDistroList(raw);
  assert.equal(distros.length, 1, '本机 fixture 只有 1 个发行版');

  const first = distros[0];
  if (first === undefined) {
    throw new Error('fixture 应至少解析出 1 个发行版');
  }
  assert.equal(first.name, 'Ubuntu2204');
  assert.equal(first.state, 'Stopped');
  assert.equal(first.version, 2);
  assert.equal(first.isDefault, true, 'fixture 里带 `*` 的那一行是 WSL 默认发行版');
});

test('T0.1 反例：UTF-8 文本不应被误判为 UTF-16LE（编码指纹判据）', () => {
  const utf8 = new TextEncoder().encode('  NAME          STATE           VERSION\n* Ubuntu2204    Running         2\n');
  const distros = parseDistroList(utf8);
  assert.equal(distros[0]?.name, 'Ubuntu2204');
  assert.equal(distros[0]?.state, 'Running');
  assert.equal(distros[0]?.isDefault, true);
});

test('T0.1 反例：发行版名含空格时从右往左取列（名字不被切碎）', () => {
  const text = '  NAME              STATE           VERSION\n* Ubuntu 22.04 LTS  Stopped         2\n';
  const distros = parseDistroList(text);
  assert.equal(distros[0]?.name, 'Ubuntu 22.04 LTS');
  assert.equal(distros[0]?.state, 'Stopped');
});

test('T0.1 反例：一个发行版都解析不出来时必须抛类型化错误（不许当成「没有发行版」）', () => {
  assert.throws(() => parseDistroList('完全不是 wsl 输出的东西\n'), WslParseError);
});
