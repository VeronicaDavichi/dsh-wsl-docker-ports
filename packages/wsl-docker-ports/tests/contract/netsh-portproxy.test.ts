/**
 * 真机 fixture 冒烟（003 T0.1 验收）
 *
 * 验收原句：「`node --test` 冒烟断言『fixture 能解析出 ≥1 条规则且字段齐全』跑绿；fixture 内无凭据」。
 * 同时把 T0.1 要定案的两件事钉死：① `netsh` 输出**本机是纯 ASCII**（无需 OEM 猜测）
 * ② 空表（无分隔线）必须是 `[]` 而不是解析失败。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { NetshParseError, decodeNetshOutput, parsePortproxyTable } from '../../src/read/netsh.ts';

const raw = new Uint8Array(
  readFileSync(new URL('./fixtures/netsh-portproxy-v4tov4.raw', import.meta.url)),
);

test('T0.1 真机 fixture：19 条规则全部解析出来（一条不少）', () => {
  const rules = parsePortproxyTable(raw);
  assert.equal(rules.length, 19, '本机现有 19 条 portproxy 规则（用户真实数据，是写路径的比对基准）');
});

test('T0.1 真机 fixture：字段齐全且与本机事实一致', () => {
  const rules = parsePortproxyTable(raw);
  for (const rule of rules) {
    assert.equal(rule.listenAddress, '0.0.0.0');
    assert.equal(rule.connectAddress, '172.20.201.152', '全部指向当前 WSL eth0（尚未漂移）');
    assert.ok(rule.listenPort >= 1 && rule.listenPort <= 65535);
    assert.ok(rule.connectPort >= 1 && rule.connectPort <= 65535);
    assert.equal(rule.listenPort, rule.connectPort, '本机规则是端口对端口');
  }
  const ports = rules.map((rule) => rule.listenPort);
  for (const expected of [80, 443, 3000, 5432, 6379, 8080, 5000, 5003, 18080, 30808, 38080, 50051]) {
    assert.ok(ports.includes(expected), `应含端口 ${expected}`);
  }
});

test('T0.1 编码定案：本机 netsh 输出是纯 ASCII（高位字节占比 0）', () => {
  let high = 0;
  for (const byte of raw) if (byte >= 0x80) high += 1;
  assert.equal(high, 0, 'fixture 内无高位字节 ⇒ 不存在 OEM/GBK 中文表头（A-2 定案）');

  const text = decodeNetshOutput(raw);
  assert.match(text, /Listen on ipv4:/, '表头是英文');
  assert.ok(text.includes('\r\n'), '行尾是 CRLF');
});

test('T0.1 边界：无规则时（只有表头、没有分隔线）返回空数组', () => {
  const empty = '\r\nListen on ipv4:             Connect to ipv4:\r\n\r\nAddress         Port        Address         Port\r\n';
  assert.deepEqual(parsePortproxyTable(empty), []);
});

test('T0.1 异常：形状脏时必须抛错，不许静默丢行（否则「他人规则条数不变」会失真）', () => {
  const dirty = 'Address         Port        Address         Port\r\n--------------- ----------  --------------- ----------\r\n0.0.0.0 8080 172.20.201.152\r\n';
  assert.throws(() => parsePortproxyTable(dirty), NetshParseError);

  const badPort = 'Address         Port        Address         Port\r\n--------------- ----------  --------------- ----------\r\n0.0.0.0 99999 172.20.201.152 8080\r\n';
  assert.throws(() => parsePortproxyTable(badPort), NetshParseError);
});
