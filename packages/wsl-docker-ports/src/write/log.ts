/**
 * 任务日志（005 T1.4 / REQ-1.5 / NFR-1 / C-3）
 *
 * ## 「完整实际集」是硬要求，不是风格
 *
 * `before` / `after` 必须是**完整**的 `netsh show v4tov4` 实际集（含**不属于本插件的**那些规则）。
 * 若只存「本次变化的那几条」，红线「他人规则条数不变」就**无法被比对** —— 因为比对对象
 * （别人的 19 条）根本不在日志里。`createWriteLogEntry` 因此会拒收「看起来像 diff 摘要」的输入：
 * 每条记录都必须是形态完整的规则（`listenAddress/listenPort/connectAddress/connectPort` 四件套）。
 *
 * ## 四项齐全（NFR-1）
 *
 * `{ before, after, exitCode, stdout }` —— 缺任何一项，这次写操作就不可追溯。
 * `exitCode` 用 `number | null`：`null` 专指「根本没跑起来」（拒绝 UAC / 超时 / 前置拦下），
 * 与「跑了但退出码是 0」必须能区分。
 */

import type { PortproxyRule } from 'dsh-wsl-docker-core';
import type { WriteAction } from './types.ts';

export interface WriteLogEntry {
  readonly action: WriteAction;
  readonly port: number;
  /** 执行**前**的完整实际集 */
  readonly before: readonly PortproxyRule[];
  /** 执行**后**的完整实际集 */
  readonly after: readonly PortproxyRule[];
  /** 提权脚本退出码；`null` = 没跑起来（拒绝 UAC / 超时 / 未执行） */
  readonly exitCode: number | null;
  /** 回传输出（native 后端 = out 文件原文；gsudo 后端 = stdio 原文） */
  readonly stdout: string;
}

export interface WriteLogParts {
  readonly action: WriteAction;
  readonly port: number;
  readonly before: readonly PortproxyRule[];
  readonly after: readonly PortproxyRule[];
  readonly exitCode?: number | null;
  readonly stdout?: string;
}

function isFullRule(value: unknown): value is PortproxyRule {
  if (typeof value !== 'object' || value === null) return false;
  const rule = value as Partial<PortproxyRule>;
  return (
    typeof rule.listenAddress === 'string' &&
    typeof rule.connectAddress === 'string' &&
    typeof rule.listenPort === 'number' &&
    typeof rule.connectPort === 'number'
  );
}

function assertFullSet(name: string, rules: readonly PortproxyRule[]): void {
  if (!Array.isArray(rules)) {
    throw new TypeError(`任务日志的 ${name} 必须是完整实际集（数组），收到 ${typeof rules}`);
  }
  for (const rule of rules) {
    if (!isFullRule(rule)) {
      throw new TypeError(
        `任务日志的 ${name} 里出现了非规则形状的条目 —— 疑似 diff 摘要；` +
          `REQ-1.5 要求完整实际集（自证「他人规则条数不变」的比对基准）`,
      );
    }
  }
}

/**
 * 组装一条任务日志（四项齐全）。**拒收 diff 摘要**：形状不对直接抛，不静默降级 ——
 * 悄悄存半份数据比报错危险得多（红线会失真而不自知）。
 */
export function createWriteLogEntry(parts: WriteLogParts): WriteLogEntry {
  assertFullSet('before', parts.before);
  assertFullSet('after', parts.after);
  return {
    action: parts.action,
    port: parts.port,
    before: [...parts.before],
    after: [...parts.after],
    exitCode: parts.exitCode ?? null,
    stdout: parts.stdout ?? '',
  };
}

/** 日志四项是否齐全（供 UI/验收断言；不参与判定） */
export function hasFourFields(entry: WriteLogEntry): boolean {
  return (
    Array.isArray(entry.before) &&
    Array.isArray(entry.after) &&
    (typeof entry.exitCode === 'number' || entry.exitCode === null) &&
    typeof entry.stdout === 'string'
  );
}

export interface OthersComparison {
  /** 执行前**不属于**本端口的规则条数（= 他人规则 + 本插件其它端口） */
  readonly beforeOthers: number;
  readonly afterOthers: number;
  /** 他人规则条数是否不变（C-3 红线）；内容变化另由 `othersDiff` 给出 */
  readonly othersUnchanged: boolean;
  /** 执行前后「非本端口」规则的文本指纹差异（空数组 = 逐条完全一致） */
  readonly othersDiff: readonly string[];
}

function fingerprint(rule: PortproxyRule): string {
  return `${rule.listenAddress}:${String(rule.listenPort)}->${rule.connectAddress}:${String(rule.connectPort)}`;
}

/**
 * 「他人规则条数不变」的机器判据（T3.2 真机验收的同一条判据，离线先证）：
 * 把本端口之外的规则取指纹做**集合差**，同时比条数。
 */
export function compareOthers(
  before: readonly PortproxyRule[],
  after: readonly PortproxyRule[],
  port: number,
): OthersComparison {
  const beforeOthers = before.filter((rule) => rule.listenPort !== port).map(fingerprint);
  const afterOthers = after.filter((rule) => rule.listenPort !== port).map(fingerprint);
  const beforeSet = new Set(beforeOthers);
  const afterSet = new Set(afterOthers);

  const diff: string[] = [];
  for (const item of beforeOthers) if (!afterSet.has(item)) diff.push(`-${item}`);
  for (const item of afterOthers) if (!beforeSet.has(item)) diff.push(`+${item}`);

  return {
    beforeOthers: beforeOthers.length,
    afterOthers: afterOthers.length,
    othersUnchanged: beforeOthers.length === afterOthers.length && diff.length === 0,
    othersDiff: diff,
  };
}
