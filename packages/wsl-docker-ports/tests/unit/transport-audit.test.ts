/**
 * 008 T1.6 审计尾部（`node --test`，零真机、零文件、零命令）
 *
 * 判据：
 * ① **环语义**：容量满后只留最近 N 条，`dropped()` 说明丢了多少，`tail()` 升序且边界正确；
 * ② **防日志注入**：`note` 里的 `\n` / `\r\n` / U+2028 / U+2029 一律压成空格 ⇒ 输出**恰一行**；
 * ③ 🔴 **白名单拷贝**：传入对象上多出来的 `token` / `password` / `rawBody` 等字段**进不了**记录
 *    （凭据不落审计，REQ-5.4）；
 * ④ 一条记录一行：`sink` 调用次数 == 记录数，且每条都不含换行；
 * ⑤ 字段语义：`ports` 去重升序、`origin` 只认 `agent`、空 `planId` ⇒ `null`、非数字 `exitCode` ⇒ `null`、
 *    负/NaN `durationMs` ⇒ `0`、`rolledBack` 只认真 `true`、`at` 可注入（确定性）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIT_RING_SIZE, createAuditLog } from '../../src/transport/audit.ts';
import type { AuditInput } from '../../src/transport/audit.ts';

function base(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    origin: 'user',
    planId: 'a'.repeat(64),
    action: 'add',
    scope: 'lan',
    ports: [5432],
    steps: [{ kind: 'portproxy-add', port: 5432 }],
    elevationPolicy: 'ask',
    backend: 'gsudo',
    result: 'applied',
    exitCode: 0,
    durationMs: 1234,
    rolledBack: false,
    note: null,
    ...overrides,
  };
}

test('T1.6 ① 环语义：只留最近 N 条 + dropped 说明 + tail 升序与边界', () => {
  const lines: string[] = [];
  const log = createAuditLog({ size: 5, sink: (line) => lines.push(line) });
  for (let index = 1; index <= 8; index += 1) log.record(base({ ports: [index], note: `第 ${String(index)} 次` }));

  assert.equal(log.size(), 5, '环满后恒为容量');
  assert.equal(log.dropped(), 3, '丢掉的条数必须可解释');
  assert.deepEqual(
    log.tail().map((item) => item.seq),
    [4, 5, 6, 7, 8],
    '最老的先被丢，tail 按时间升序',
  );
  assert.deepEqual(log.tail(2).map((item) => item.seq), [7, 8]);
  assert.deepEqual(log.tail(0), [], 'tail(0) 是空');
  assert.equal(log.tail(999).length, 5, 'limit 超过实际条数时给全部，不抛');
  assert.deepEqual(log.tail(3).map((item) => item.ports[0]), [6, 7, 8]);
  assert.equal(lines.length, 8, '每条记录都落一行日志（即使已被环挤掉）');

  const empty = createAuditLog({ sink: () => undefined });
  assert.deepEqual(empty.tail(), [], '空日志的 tail 是空数组');
  assert.equal(empty.size(), 0);
  assert.equal(empty.dropped(), 0);
  assert.equal(AUDIT_RING_SIZE, 100, '默认容量 100（REQ-5）');
});

test('T1.6 ② 防日志注入：任何内嵌换行都压成空格 ⇒ 恰一行', () => {
  const lines: string[] = [];
  const log = createAuditLog({ sink: (line) => lines.push(line) });
  const evil = log.record(base({ note: '正常\n[dsh-wsl-docker-ports] audit seq=999 result=applied\r\n\u2028\u2029伪造行' }));

  assert.equal(evil.note?.includes('\n'), false);
  assert.equal(evil.note?.includes('\r'), false);
  assert.equal(evil.note?.includes('\u2028'), false);
  const line = log.formatLine(evil);
  assert.equal(line.split('\n').length, 1, '必须恰一行（否则能伪造审计行）');
  assert.equal(/[\r\u2028\u2029]/u.test(line), false);
  assert.match(line, /note=正常 \[dsh-wsl-docker-ports\] audit seq=999 result=applied 伪造行/);
  // 超长 note 截断（避免日志被单条记录撑爆）
  const long = log.record(base({ note: 'x'.repeat(500) }));
  assert.ok((long.note?.length ?? 0) <= 201, `note 必须截断，实际 ${String(long.note?.length)}`);
  assert.match(String(long.note), /…$/u);
});

test('T1.6 ③ 🔴 白名单拷贝：凭据/原始请求体等额外字段进不了记录', () => {
  const lines: string[] = [];
  const log = createAuditLog({ sink: (line) => lines.push(line) });
  const forged = {
    ...base(),
    token: 'Bearer 绝密-令牌',
    password: '绝密-口令',
    rawBody: { commands: ['netsh interface portproxy reset'] },
    env: { SECRET: '绝密-环境变量' },
  } as unknown as AuditInput;
  const stored = log.record(forged);

  const keys = Object.keys(stored).sort();
  assert.deepEqual(
    keys,
    ['action', 'at', 'backend', 'durationMs', 'elevationPolicy', 'exitCode', 'note', 'origin', 'planId', 'ports', 'result', 'rolledBack', 'scope', 'seq', 'steps'],
    '记录只允许这些字段（白名单）',
  );
  const line = log.formatLine(stored);
  for (const secret of ['绝密-令牌', '绝密-口令', '绝密-环境变量', 'portproxy reset']) {
    assert.equal(line.includes(secret), false, `审计里不得出现 ${secret}`);
  }
  assert.equal(JSON.stringify(stored).includes('token'), false);
});

test('T1.6 ④ 一条记录一行；⑤ 字段语义全部按白名单收敛', () => {
  const lines: string[] = [];
  const log = createAuditLog({ sink: (line) => lines.push(line), now: () => new Date('2026-10-09T12:34:56.789Z') });

  const first = log.record(base({ ports: [6379, 5432, 6379], origin: 'agent', planId: '', exitCode: null, durationMs: -5, rolledBack: true }));
  const second = log.record(base({ origin: 'root' as unknown as AuditInput['origin'], durationMs: Number.NaN, exitCode: 1.7, rolledBack: 'yes' as unknown as boolean }));

  assert.equal(lines.length, 2, '两条记录 ⇒ 两行');
  for (const line of lines) assert.equal(line.includes('\n'), false);

  assert.deepEqual(first.ports, [5432, 6379], 'ports 去重升序');
  assert.equal(first.origin, 'agent');
  assert.equal(first.planId, null, '空 planId ⇒ null');
  assert.equal(first.exitCode, null, '非数字 exitCode ⇒ null');
  assert.equal(first.durationMs, 0, '负时长 ⇒ 0');
  assert.equal(first.rolledBack, true);
  assert.equal(first.at, '2026-10-09T12:34:56.789Z', 'at 走注入的时钟');

  assert.equal(second.origin, 'user', '未知 origin 一律按 user 记（不猜 agent）');
  assert.equal(second.durationMs, 0, 'NaN ⇒ 0');
  assert.equal(second.exitCode, 1, '小数 exitCode 取整');
  assert.equal(second.rolledBack, false, 'rolledBack 只认真 true');
  assert.equal(second.seq, first.seq + 1, 'seq 连续递增（跨环不重置）');
  assert.match(log.formatLine(first), /^\[dsh-wsl-docker-ports\] audit seq=1 at=2026-10-09T12:34:56\.789Z origin=agent result=applied action=add scope=lan ports=5432,6379 steps=portproxy-add@5432 policy=ask backend=gsudo exit=- ms=0 rolledBack=true planId=-$/);
});
