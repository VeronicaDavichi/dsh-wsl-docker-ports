/**
 * eth0 真机 fixture 契约测试（001 T3.1 验收）
 *
 * 断言对象是**真机原始字节**（`fixtures/ip-eth0.raw`，2026-10-08 从
 * `wsl.exe -d Ubuntu2204 -- ip -4 -o addr show dev eth0` 原样捕获），不是我复述的常量。
 *
 * 本层要钉死的事：**这条路径的编码是 UTF-8**（NUL 占比 0%）—— 与 `wsl -l -v` 的 UTF-16LE
 * **不同**。同一个 `wsl.exe`：自带消息 UTF-16LE、透传 Linux 子进程字节 UTF-8。猜错即假阴性
 * （把 `inet 172.…` 解成乱码 ⇒ 误报「eth0 没有 IPv4」），故两条路都留反例。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createExecutor, type SpawnLike } from '../../src/exec.ts';
import type { WslDistro } from '../../src/distros.ts';
import { parseEth0Address, probeEth0 } from '../../src/net.ts';

const raw = new Uint8Array(readFileSync(new URL('./fixtures/ip-eth0.raw', import.meta.url)));
/** 与 fixture 同期实测；断言以 fixture 为准（漂移时应重抓 fixture 而不是改常量） */
const EXPECTED = '172.20.201.152';

test('T3.1 真机 fixture：UTF-8 指纹（NUL 占比 0%，无 CRLF）且体量合理', () => {
  const nuls = raw.filter((b) => b === 0).length;
  assert.equal(nuls, 0, 'ip 输出里不应有 NUL —— 有 NUL 就说明这层其实是 UTF-16LE');
  assert.equal(raw.includes(0x0d), false, 'fixture 应为 LF 行尾');
  assert.ok(raw.byteLength > 40 && raw.byteLength < 512, `体量异常：${raw.byteLength} 字节`);
});

test('T3.1 真机 fixture：解析出点分四段 IPv4，等于 fixture 里 inet 的地址', () => {
  const ip = parseEth0Address(raw);
  assert.equal(ip, EXPECTED);
  assert.match(ip ?? '', /^\d{1,3}(\.\d{1,3}){3}$/);
});

test('T3.1 负例：同一批真机字节若按 UTF-16LE 解 → 解析失败（编码猜错 ⇒ 假"没有地址"）', () => {
  const wrong = new TextDecoder('utf-16le').decode(raw);
  assert.equal(parseEth0Address(wrong), undefined);
});

test('T3.1 端到端：真机字节经 createExecutor + probeEth0 管线（fake spawn，离线）', async () => {
  const calls: string[][] = [];
  const spawn = ((file: string, argv: readonly string[]) => {
    calls.push([file, ...argv]);
    return {
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
    } as unknown as ReturnType<SpawnLike>;
  }) as SpawnLike;

  const running: WslDistro[] = [
    { name: 'Ubuntu2204', state: 'Running', version: 2, isDefault: true },
  ];
  const outcome = await probeEth0(createExecutor(spawn), 'Ubuntu2204', running);

  assert.deepEqual(calls[0], [
    'wsl.exe',
    '-d',
    'Ubuntu2204',
    '--',
    'ip',
    '-4',
    '-o',
    'addr',
    'show',
    'dev',
    'eth0',
  ]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.ip, EXPECTED);
});
