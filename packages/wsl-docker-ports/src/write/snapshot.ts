/**
 * 实际集快照（005 T1.4 / REQ-1.5 / NFR-1）
 *
 * 每次写操作**前后各取一次** `netsh show v4tov4`，两份快照都进任务日志。目的不是「记录变化」，
 * 而是**自证只动了自己那一条**（REQ-1.5 / C-3：本机既有 19 条是用户真实数据）。
 *
 * 这里直接复用 003 的只读探针（`read/netsh-probe.ts`）—— **一条解析逻辑都不复制**，
 * 因为「静默丢行」会让红线失去比对基准（那份文件已把这条理由写死）。本文件只做一件事：
 * 把探针的失败态收成写路径能消费的短形态（写路径不需要 `cause` 的每个字段，
 * 但**必须**保留 reason 与 message —— 快照失败绝不能被当成「没有规则」）。
 */

import type { Executor } from 'dsh-wsl-shared';

import { probePortproxyRules } from '../read/netsh-probe.ts';
import type { PortproxyRule } from '../read/netsh.ts';

export interface SnapshotSuccess {
  readonly ok: true;
  /** **完整实际集**（不是 diff 摘要、不是过滤后的子集） */
  readonly rules: readonly PortproxyRule[];
  readonly argv: readonly string[];
}

export interface SnapshotFailure {
  readonly ok: false;
  readonly reason: string;
  readonly message: string;
  readonly hint: string;
}

export type SnapshotOutcome = SnapshotSuccess | SnapshotFailure;

/** 取一次快照的依赖面（测试注入 fake 快照；生产 = netsh 只读探针） */
export type PortproxySnapshotter = () => Promise<SnapshotOutcome>;

export interface SnapshotterOptions {
  /** 覆盖探针超时 */
  readonly timeoutMs?: number;
}

/**
 * 生产实现：经 001 的执行器跑 `netsh interface portproxy show v4tov4`（**只读，不需要提权**）。
 * 返回的 `rules` 是**解析后的完整集合**；失败时 `ok: false` 且带 reason/message（不返回空数组冒充成功）。
 */
export function createPortproxySnapshotter(
  executor: Executor,
  options: SnapshotterOptions = {},
): PortproxySnapshotter {
  return async (): Promise<SnapshotOutcome> => {
    const outcome = await probePortproxyRules(executor, options);
    if (outcome.ok) return { ok: true, rules: outcome.rules, argv: outcome.argv };
    return { ok: false, reason: outcome.reason, message: outcome.message, hint: outcome.hint };
  };
}

/** 便于测试与日志：把快照结果压成一行（不参与判定） */
export function describeSnapshot(outcome: SnapshotOutcome): string {
  return outcome.ok
    ? `共 ${String(outcome.rules.length)} 条 portproxy 规则`
    : `快照失败（${outcome.reason}）：${outcome.message}`;
}
