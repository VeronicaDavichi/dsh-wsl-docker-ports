/**
 * 写路径断言助手（005 Phase 1 用例共用）
 *
 * 存在的理由：`assert.ok(outcome.ok)` **不能**给 TypeScript 收窄类型，于是每个用例都要
 * `if (!outcome.ok) throw ...` 抄一遍 —— 抄多了就有人少写一条断言。这里把「期望是规划 /
 * 期望是拦下」各收成一个函数，顺带把「动作产生数」这个跨用例的核心数字显式化
 * （T1.1 / T1.3 都要求断言「零动作」与「只有本端口」）。
 */

import assert from 'node:assert/strict';

import type { WriteBlock, WriteBlockReason, WritePlan, WritePlanOutcome } from '../../src/write/types.ts';

/** 期望是一个可执行规划（否则用例当场失败，并带上实际拦下原因） */
export function expectPlan(outcome: WritePlanOutcome): WritePlan {
  assert.equal(outcome.ok, true, `期望是可执行规划，实际被拦下：${outcome.ok ? '' : outcome.reason}`);
  return outcome as WritePlan;
}

/** 期望被拦下（可选校验 reason） */
export function expectBlock(outcome: WritePlanOutcome, reason?: WriteBlockReason): WriteBlock {
  assert.equal(outcome.ok, false, '期望被拦下，实际产出了可执行规划');
  const blocked = outcome as WriteBlock;
  if (reason !== undefined) assert.equal(blocked.reason, reason);
  return blocked;
}

/** 动作产生数（T1.1 的「动作产生数 = 0」就是它） */
export function actionCount(outcome: WritePlanOutcome): number {
  return outcome.steps.length;
}

/** 步骤种类序列（T1.3 的顺序断言用它逐字比对） */
export function stepKinds(outcome: WritePlanOutcome): string[] {
  return outcome.steps.map((step) => step.kind);
}

/** 规划里出现过的端口（断言「只有本端口」） */
export function portsTouched(outcome: WritePlanOutcome): number[] {
  return [...new Set(outcome.steps.map((step) => step.port))];
}

/** 某类步骤的命令原文（核对 listenport / LocalPort 等参数） */
export function commandsOf(outcome: WritePlanOutcome, kind: string): string[] {
  return outcome.steps.filter((step) => step.kind === kind).map((step) => step.commandText);
}
