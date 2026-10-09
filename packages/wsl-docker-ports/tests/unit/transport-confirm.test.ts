/**
 * 008 T2.1 判据：确认票据的**单次性 / 绑定 planId / TTL**（零 IO、零进程、时间注入）
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfirmTickets } from '../../src/transport/confirm.ts';
import { WRITE_CONFIRM_TTL_MS } from '../../src/transport/constants.ts';

function fixed(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

test('T2.1 单次性：同一张票只能兑现一次（防「确认一次、执行两次」）', () => {
  const clock = fixed();
  const tickets = createConfirmTickets({ now: clock.now, newTicket: () => 'T1' });
  const issued = tickets.issue('plan-a');
  assert.equal(issued.planId, 'plan-a');
  assert.equal(issued.ticket, 'T1');
  assert.equal(issued.expiresAt, 1_000 + WRITE_CONFIRM_TTL_MS);
  assert.equal(tickets.consume('plan-a', 'T1'), 'ok');
  assert.equal(tickets.consume('plan-a', 'T1'), 'unknown', '兑现过 ⇒ 票已作废，再放同票必须是 unknown（不是 ok）');
  assert.equal(tickets.size(), 0);
});

test('T2.1 绑定 planId：票据只对生成它的那份计划有效', () => {
  const tickets = createConfirmTickets({ newTicket: () => 'T1' });
  tickets.issue('plan-a');
  assert.equal(tickets.consume('plan-b', 'T1'), 'unknown', '别的 planId 用这张票 ⇒ unknown（计划变了就失效）');
  assert.equal(tickets.consume('plan-a', 'T1'), 'ok', '原来的 planId 仍然可用');
});

test('T2.1 失配与不存在分开报（不合并成一句「无效」）', () => {
  const tickets = createConfirmTickets({ newTicket: () => 'T1' });
  tickets.issue('plan-a');
  assert.equal(tickets.consume('plan-a', 'T2'), 'mismatch', 'planId 对、票不对 ⇒ mismatch');
  assert.equal(tickets.consume('nope', 'T1'), 'unknown', 'planId 不存在 ⇒ unknown');
  assert.equal(tickets.consume('plan-a', 'T1'), 'ok', 'mismatch 不吃掉真票（否则一次手滑就得重新规划）');
});

test('T2.1 TTL：过期即作废，且过期票也不能二次兑现', () => {
  const clock = fixed();
  const tickets = createConfirmTickets({ now: clock.now, newTicket: () => 'T1' });
  tickets.issue('plan-a');
  clock.advance(WRITE_CONFIRM_TTL_MS);       // 边界：恰好到期 ⇒ 过期（<= 判据）
  assert.equal(tickets.consume('plan-a', 'T1'), 'expired');
  assert.equal(tickets.consume('plan-a', 'T1'), 'unknown', '过期票已作废，不能再用');
  const again = tickets.issue('plan-a');
  clock.advance(WRITE_CONFIRM_TTL_MS - 1);   // 边界内 ⇒ 仍有效
  assert.equal(tickets.consume('plan-a', again.ticket), 'ok');
});

test('T2.1 重复签发同一 planId ⇒ 只留最新一张（旧票作废）；过期项不累积', () => {
  const clock = fixed();
  let n = 0;
  const tickets = createConfirmTickets({ now: clock.now, newTicket: () => `T${String(++n)}` });
  tickets.issue('plan-a');
  const second = tickets.issue('plan-a');
  assert.equal(tickets.size(), 1, '同一 planId 只留一张');
  assert.equal(tickets.consume('plan-a', 'T1'), 'mismatch', '旧票已作废');
  assert.equal(tickets.consume('plan-a', second.ticket), 'ok');
  tickets.issue('plan-b');
  clock.advance(WRITE_CONFIRM_TTL_MS + 1);
  assert.equal(tickets.size(), 1, '签发时清扫过期项（不引入定时器）');
  tickets.issue('plan-c');
  assert.equal(tickets.size(), 1, '过期项已被清掉，不会无界增长');
});