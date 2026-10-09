/**
 * 008 T2.1：单次确认票据（**纯内存、零副作用、零进程**）
 *
 * 契约（design §6）：
 * - **绑定 `planId`**：票据只对「生成它的那份计划」有效 ⇒ 计划变了（内容变 ⇒ planId 变）票据自动失配；
 * - **单次**：`consume` 成功即**立刻作废** ⇒ 同一张票不能重放（防「确认一次、执行两次」）；
 * - **TTL 120s**：过期即作废（`WRITE_CONFIRM_TTL_MS`）；
 * - **不猜**：票据不存在 / 失配 / 过期三种失败**分开报**，调用方才能给准确文案（不合并成一句「无效」）。
 *
 * 这里刻意**不**碰任何 IO：谁生成票据（`/write/plan` 的响应）与谁消费（`/write/apply`）由接线层决定。
 */

import { randomUUID } from 'node:crypto';

import { WRITE_CONFIRM_TTL_MS } from './constants.ts';

/** 一次「确认」的凭据：给 UI/Agent 回传，`apply` 时带回 */
export interface ConfirmTicket {
  readonly planId: string;
  readonly ticket: string;
  /** 绝对过期时刻（ms 时间戳） */
  readonly expiresAt: number;
}

/** `consume` 的结果——**三种失败分开**，不合并 */
export type ConfirmVerdict = 'ok' | 'unknown' | 'mismatch' | 'expired';

export interface ConfirmTickets {
  /** 签发（同一 `planId` 重复签发 ⇒ 旧票作废，只留最新一张） */
  issue(planId: string): ConfirmTicket;
  consume(planId: string, ticket: string): ConfirmVerdict;
  /** 当前在手票据数（诊断/测试用） */
  size(): number;
}

export interface ConfirmTicketOptions {
  readonly ttlMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly newTicket?: (() => string) | undefined;
}

export function createConfirmTickets(options: ConfirmTicketOptions = {}): ConfirmTickets {
  const ttlMs = options.ttlMs ?? WRITE_CONFIRM_TTL_MS;
  const now = options.now ?? ((): number => Date.now());
  const newTicket = options.newTicket ?? randomUUID;
  const open = new Map<string, ConfirmTicket>();

  return {
    issue(planId: string): ConfirmTicket {
      // 顺手清过期项：环不需要无界增长，也不引入定时器（零后台活动）
      const at = now();
      for (const [key, value] of open) {
        if (value.expiresAt <= at) open.delete(key);
      }
      const ticket: ConfirmTicket = { planId, ticket: newTicket(), expiresAt: at + ttlMs };
      open.set(planId, ticket);
      return ticket;
    },
    consume(planId: string, ticket: string): ConfirmVerdict {
      const found = open.get(planId);
      if (found === undefined) return 'unknown';
      if (found.ticket !== ticket) return 'mismatch';
      open.delete(planId); // 单次：无论接下来过不过期，票都不再可用
      return found.expiresAt <= now() ? 'expired' : 'ok';
    },
    size(): number {
      return open.size;
    },
  };
}