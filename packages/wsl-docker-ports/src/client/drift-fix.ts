/**
 * 漂移修复序列的**视图装配**（011 `T1.3`，2026-10-13 从 `rows.ts` 整段搬出）
 *
 * ## 为什么单独一个文件（搬家的理由，不是重构）
 *
 * `buildDriftFixView` 是 `rows.ts` 里**唯一**触碰写路径内核（`../write/index.ts` 的
 * `buildWritePlan` / `portproxyAddStep` / `portproxyDeleteStep`）的函数；而 `rows.ts` 是
 * **tab 注册面**、按 REQ-BS-3 必须常驻主包 ⇒ 只要它还 import 写内核，`write/plan.ts`
 * （13,321 B）+ `ownership` + `scope-note` + `firewall` 就被**同步拽回主包**（REQ-BS-2 不达）。
 * 搬进**渲染面 chunk 能到达**的模块后，写内核随 chunk 走。
 *
 * ⚠️ **搬家 ≠ 改行为**：函数体与注释一字未改；调用方只有 `page.ts`（渲染面）与
 * `tests/unit/client-rows.test.ts`（只改 import 路径，断言未动）。
 *
 * ## 原始口径留痕（照搬自 `rows.ts`）
 *
 * 漂移修复序列（T5.6 / design §2 的 `fix` 行：**先 delete 再 add**）。
 *
 * ⚠️ **口径留痕**：命令原文一律来自 005 自己的步骤构造器（`portproxyDeleteStep` /
 * `portproxyAddStep`），本模块不渲染任何命令文本。`blocked` 是 005 的**所有权闸门**结果
 * （`plan.ts` 的 `fix` 分支当前恒被 REQ-1.2 的删除前置拦下：漂移规则的 `connectAddress`
 * 是旧 eth0，不建台账无法证明是本插件写的 ⇒ 序列**展示**、按钮**禁用**）。
 * 这样 UI 既回答了「修复会做什么」，也不会引导一个写路径必须拒绝的动作。
 */

import type { ManagedPorts } from '../diff/managed-ports.ts';
import type { Scope } from '../diff/types.ts';
import type { PortproxyRule } from '../read/netsh.ts';
import { buildWritePlan, portproxyAddStep, portproxyDeleteStep, type WritePlanOutcome } from '../write/index.ts';
import type { DriftFixView } from './types.ts';

export interface DriftFixInput {
  readonly port: number;
  readonly scope: Scope;
  readonly eth0Ip: string;
  readonly managedPorts: ManagedPorts;
  readonly rules: readonly PortproxyRule[];
}

export function buildDriftFixView(input: DriftFixInput): DriftFixView {
  const stale = input.rules.find((rule) => rule.connectAddress !== input.eth0Ip) ?? input.rules[0];
  const intended =
    stale === undefined
      ? []
      : [portproxyDeleteStep(stale), portproxyAddStep(input.port, input.scope, input.eth0Ip)];
  const outcome: WritePlanOutcome = buildWritePlan({
    action: 'fix',
    port: input.port,
    scope: input.scope,
    managedPorts: input.managedPorts,
    eth0Ip: input.eth0Ip,
    rules: input.rules,
    portState: 'drift',
  });
  const steps = (outcome.ok ? outcome.steps : intended).map((step, index) => ({
    order: index + 1,
    kind: step.kind,
    commandText: step.commandText,
  }));
  return {
    port: input.port,
    from: stale?.connectAddress ?? '?',
    to: input.eth0Ip,
    steps,
    blocked: outcome.ok ? null : { reason: outcome.reason, message: outcome.message, hint: outcome.hint },
  };
}
