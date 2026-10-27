/**
 * 013：`extra` 的判据 = **WSL 内有没有服务在监听**（不是 docker 有没有映射）
 *
 * 验收面（specs/013-listener-based-extra/README.md）：
 * - A1 通配/eth0 监听 ⇒ 规则**在用**（`ok` + `listener-active`），不再是「多余」；
 * - A2 仅回环监听 ⇒ `extra` + `loopback-only`（portproxy 连不到）；
 * - A3 无监听 ⇒ `extra` + `no-listener`；
 * - A4 读不到（失败 / 未提供）⇒ `extra` + `listeners-unknown`（**未知**，不是「没监听」）；
 * - A5 既有 `ok` / `missing` / `drift` / `conflict` 语义一字不动（期望集路径不看监听表）。
 *
 * 这些断言只走**纯函数** `diff()`：监听表是入参，不需要任何进程。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diff } from '../../src/diff/engine.ts';
import { singlePort } from '../../src/diff/managed-ports.ts';
import type { DiffResult, PortClassification } from '../../src/diff/types.ts';
import type { ListenerEntry, ListenerTable } from '../../src/read/listeners-probe.ts';
import { container, ETH0, rule } from '../helpers/factories.ts';

function tableOf(...entries: readonly (readonly [number, string])[]): ListenerTable {
  return { ok: true, entries: entries.map(([port, bind]): ListenerEntry => ({ port, bind })) };
}

const FAILED: ListenerTable = { ok: false, reason: 'wsl-stopped' };

interface Case {
  readonly port: number;
  /** 规则的目标端口（缺省 = 监听端口） */
  readonly connectPort?: number;
  /** 监听表；`undefined` = 调用方没提供 */
  readonly listeners?: ListenerTable;
  /** docker 是否仍发布该端口（缺省 false ⇒ 走「docker 不映射」那条路） */
  readonly dockerPublishes?: boolean;
}

function run(item: Case): { readonly result: DiffResult; readonly one: PortClassification } {
  const connectPort = item.connectPort ?? item.port;
  const outcome = diff({
    containers: item.dockerPublishes === true ? [container('svc-a-1', `0.0.0.0:${String(item.port)}->${String(item.port)}/tcp`)] : [],
    managedPorts: [singlePort(item.port)],
    rules: [rule('0.0.0.0', item.port, ETH0, connectPort)],
    eth0Ip: ETH0,
    localhostForwarding: true,
    ...(item.listeners === undefined ? {} : { listeners: item.listeners }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error('前置：eth0 已给 ⇒ 判决必须成立');
  const one = outcome.result.ports.find((classification) => classification.port === item.port);
  assert.notEqual(one, undefined, `端口 ${String(item.port)} 必须恰好有一条归类`);
  if (one === undefined) throw new Error('unreachable');
  return { result: outcome.result, one };
}

test('013 A1：docker 不映射、但通配监听 ⇒ 规则在用（ok + listener-active，不再是多余）', () => {
  const { one, result } = run({ port: 3306, listeners: tableOf([3306, '0.0.0.0']) });

  assert.equal(one.state, 'ok', 'python -m http.server 3306 在跑 ⇒ 规则真在工作，不许判 extra');
  assert.equal(one.reason, 'listener-active');
  assert.equal(one.expected, null, 'docker 没映射 ⇒ 没有期望项；ok 的依据是监听表');
  assert.equal(result.counts.ok, 1);
  assert.equal(result.counts.extra, 0);
});

test('013 A1：`*` / `[::]` / eth0 具体地址都算「连得到」⇒ in-use', () => {
  for (const bind of ['*', '[::]', '::', ETH0, `[${ETH0}]`]) {
    const { one } = run({ port: 8080, listeners: tableOf([8080, bind]) });
    assert.equal(one.state, 'ok', `bind=${bind} 必须判在用`);
    assert.equal(one.reason, 'listener-active', `bind=${bind}`);
  }
});

test('013 A2：只有回环在听 ⇒ extra + loopback-only（portproxy 从 Windows 侧连不到）', () => {
  for (const bind of ['127.0.0.1', '[::1]', '::1']) {
    const { one, result } = run({ port: 5432, listeners: tableOf([5432, bind]) });
    assert.equal(one.state, 'extra', `bind=${bind}：回环监听 ⇒ 规则连不到`);
    assert.equal(one.reason, 'loopback-only', `bind=${bind}`);
    assert.equal(result.counts.extra, 1);
  }
});

test('013 A3：完全没人监听 ⇒ extra + no-listener', () => {
  const { one } = run({ port: 9999, listeners: tableOf([22, '0.0.0.0']) });
  assert.equal(one.state, 'extra');
  assert.equal(one.reason, 'no-listener');
});

test('013 A4：监听表读失败 ⇒ 未知（extra + listeners-unknown），不是「没人监听」', () => {
  const { one, result } = run({ port: 7000, listeners: FAILED });
  assert.equal(one.state, 'extra', '未知仍落在 extra ⇒ 「移除」按钮照旧可点（主人裁定）');
  assert.equal(one.reason, 'listeners-unknown', '读不到 ≠ 没监听：原因必须可区分');
  assert.equal(result.counts.extra, 1);
});

test('013 A4：调用方**没提供**监听表 ⇒ 同样未知（不许假装扫过）', () => {
  const { one } = run({ port: 7001 });
  assert.equal(one.state, 'extra');
  assert.equal(one.reason, 'listeners-unknown');
});

test('013：查的是规则的 connectPort（不是 listenPort）—— 规则连 7002，7001 有人听也不算', () => {
  const missed = run({ port: 7001, connectPort: 7002, listeners: tableOf([7001, '0.0.0.0']) });
  assert.equal(missed.one.reason, 'no-listener', '监听的是 listenPort，不是规则连的目标端口');

  const hit = run({ port: 7001, connectPort: 7002, listeners: tableOf([7002, '0.0.0.0']) });
  assert.equal(hit.one.state, 'ok');
  assert.equal(hit.one.reason, 'listener-active');
});

test('013：绑在「其它具体地址」按 conservative in-use（宁可少报多余，不误删可用规则）', () => {
  const { one } = run({ port: 7003, listeners: tableOf([7003, '10.9.9.9']) });
  assert.equal(one.state, 'ok', '具体地址不是回环 ⇒ 保守按在用（假设：ETH0 之外的地址也可能可达）');
  assert.equal(one.reason, 'listener-active');
});

test('013 A5：期望集路径不看监听表 —— docker 仍映射时，回环监听也照旧是 ok（语义未变）', () => {
  const { one } = run({ port: 6379, listeners: tableOf([6379, '127.0.0.1']), dockerPublishes: true });
  assert.equal(one.state, 'ok', 'docker 仍发布 ⇒ 既有 ok 语义不许被监听表改写');
  assert.equal(one.reason, null);
  assert.notEqual(one.expected, null);
});

test('013 A5：期望集路径不看监听表 —— docker 不映射 + 监听表失败，也不会把 missing/drift/conflict 弄脏', () => {
  // 对照：期望端口（docker 发布）规则缺失 ⇒ missing，与监听表无关
  const outcome = diff({
    containers: [container('svc-a-1', '0.0.0.0:6379->6379/tcp')],
    managedPorts: [singlePort(6379)],
    rules: [],
    eth0Ip: ETH0,
    // localhostForwarding=false ⇒ loopback 作用域**需要**显式规则 ⇒ 没有规则就是 missing
    localhostForwarding: false,
    listeners: FAILED,
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const one = outcome.result.ports[0];
  assert.equal(one?.state, 'missing', '监听表失败不得把「缺规则」变成 extra/未知');
  assert.equal(one?.reason, null);
});
