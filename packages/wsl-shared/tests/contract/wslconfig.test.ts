/**
 * `.wslconfig` 真机 fixture 契约测试（001 T5.1 验收）
 *
 * 断言对象是**真机原始字节**（`fixtures/wslconfig.raw`，2026-10-08 从 `%USERPROFILE%\.wslconfig`
 * 原样捕获）：**32 字节、无 BOM、行尾 CRLF、无尾换行**，原文 `[wsl2]\r\nlocalhostForwarding=true`
 * ⇒ 没有 `networkingMode` ⇒ **NAT 缺省**（组件②的硬前提成立）。漂移时**重抓 fixture**，不改常量。
 *
 * ⚠️ 口径：本层只读 **fixture**，不读用户当下的真实 `.wslconfig`（那会让测试随用户改配置而红/绿）。
 * 「当前这台机器的真实文件读出来是什么」由 `scripts/probe.mjs` 的真机探针给结论（证据在 tasks.md）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createWslConfigReader, parseWslConfig, type ReadFileLike } from '../../src/wslconfig.ts';

const raw = new Uint8Array(readFileSync(new URL('./fixtures/wslconfig.raw', import.meta.url)));
const text = new TextDecoder('utf-8').decode(raw);
const TARGET = 'C:\\Users\\probe\\.wslconfig';

const readText =
  (content: string): ReadFileLike =>
  async () =>
    content;

test('T5.1 真机 fixture 字节指纹：无 BOM、无 NUL、单处 CRLF、无尾换行、体量合理', () => {
  assert.equal(raw.byteLength, 32, `体量异常：${raw.byteLength} 字节`);
  assert.notEqual(raw[0], 0xef, '不应有 UTF-8 BOM');
  assert.equal(raw.includes(0x00), false, '含 NUL 就说明这层其实是 UTF-16LE');
  assert.equal(raw.filter((byte) => byte === 0x0d).length, 1, '真机文件只有一处 CRLF');
  assert.equal(raw.filter((byte) => byte === 0x0a).length, 1, '一个 LF（属于那处 CRLF）');
  assert.notEqual(raw[raw.byteLength - 1], 0x0a, '真机文件**没有**尾换行 —— 解析器不得依赖它');
});

test('T5.1 真机 fixture：缺 networkingMode ⇒ default/nat，且 rawValue 键不出现（REQ-4.2/4.3）', async () => {
  assert.equal(parseWslConfig(text), undefined, '该文件里确实没有 networkingMode');
  const outcome = await createWslConfigReader({ readFile: readText(text) }).read(TARGET);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.mode, 'default');
  assert.equal(outcome.resolved, 'nat');
  assert.equal(outcome.path, TARGET);
  assert.equal('rawValue' in outcome, false, '缺键时不得伪造 rawValue');
});

test('T5.1 端到端：真机字节 → 读取器 → NAT 可用的结论（离线，零真实进程/零真实文件读）', async () => {
  const outcome = await createWslConfigReader({ readFile: readText(text) }).read(TARGET);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.resolved, 'nat', '硬前提：缺省即 NAT，组件②可用');
});

test('T5.1 负例：同一份真机字节若被改成 mirrored ⇒ 必须判 non-nat（保守，REQ-4.4）', async () => {
  const mirrored = `${text}\r\n[wsl2]\r\nnetworkingMode=mirrored`;
  const outcome = await createWslConfigReader({ readFile: readText(mirrored) }).read(TARGET);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.mode, 'mirrored');
  assert.equal(outcome.resolved, 'non-nat');
});

test('T5.1 负例：真机字节里多余的一行 `networkingMode = NAT`（大小写异常）⇒ other，绝不判 nat', async () => {
  const outcome = await createWslConfigReader({
    readFile: readText(`${text}\r\nnetworkingMode = NAT`),
  }).read(TARGET);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.mode, 'other');
  assert.notEqual(outcome.resolved, 'nat');
  assert.equal(outcome.rawValue, 'NAT', 'rawValue 保留原值供 UI 显示"你写的是 X"');
});
