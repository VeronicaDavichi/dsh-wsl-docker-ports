/**
 * 008 T1.6 审计尾部（REQ-5）
 *
 * ## 两条铁律
 *
 * 1. **不建台账文件**（冻结决策）：只在内存里留最近 `AUDIT_RING_SIZE` 条，并往宿主日志打**单行**。
 *    磁盘上的真相就是 cordis 的日志本身 —— 我们不再维护第二份可能与现实不一致的状态。
 *    ⇒ 溢出会丢最老的记录，所以记录里有 `seq` 与 `dropped()`，让「尾部」的语义可解释、不假装是全量。
 * 2. **白名单拷贝 + 单行化**：只把已知字段写进记录，且 `formatLine()` 把任何内嵌换行压成空格。
 *    ⇒ 客户端塞进来的载荷（凭据、命令文本、任意嵌套对象）既**进不了**审计，也无法靠 `\n`
 *    **伪造日志行**（日志注入）。
 *
 * ## 记录里刻意不放什么
 *
 * **不放凭据**（没有 token / password / 环境变量字段）；**不放原始请求体**（那里面可能有客户端塞的任何东西）；
 * 命令原文只留 `kind + port`，渲染文本属展示层（`plan.ts` 的 DTO）而不属审计。
 */

import type { Scope } from '../diff/types.ts';
import type { WriteAction, WriteStepKind } from '../write/types.ts';

/** 内存环容量（REQ-5：最近 N 条；溢出丢最老，由 `seq` / `dropped()` 说明） */
export const AUDIT_RING_SIZE = 100;

/** 结果四态（`no-op` = 本来就无需动作；`rejected` = 前置/确认门拦下；`failed` = 执行失败） */
export type AuditResult = 'applied' | 'rejected' | 'failed' | 'no-op';

/** 触发方（REQ-4.5：Agent 触发一律降级为 `ask`，审计里必须分得清） */
export type AuditOrigin = 'user' | 'agent';

/** 审计记录：**只有这些字段**（白名单，见文件头第 2 条） */
export interface AuditRecord {
  readonly seq: number;
  readonly at: string;
  readonly origin: AuditOrigin;
  readonly planId: string | null;
  readonly action: WriteAction;
  readonly scope: Scope;
  readonly ports: readonly number[];
  readonly steps: readonly { readonly kind: WriteStepKind; readonly port: number }[];
  readonly elevationPolicy: string;
  readonly backend: string;
  readonly result: AuditResult;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly rolledBack: boolean;
  readonly note: string | null;
}

/** `record()` 的入参：`seq` / `at` 由日志自己填 */
export type AuditInput = Omit<AuditRecord, 'seq' | 'at'> & { readonly at?: string | undefined };

export interface AuditLog {
  /** 追加一条（白名单拷贝 + 填充 seq/at + 打一行日志）；返回**真正存下来的**那条 */
  record(input: AuditInput): AuditRecord;
  /** 最近 `limit` 条，**按时间升序**（最老的在前）；`limit` 省略 = 全部 */
  tail(limit?: number): readonly AuditRecord[];
  size(): number;
  /** 因环溢出被丢掉的条数（0 = 环里就是全量） */
  dropped(): number;
  /** 单行日志文本（换行一律压成空格 —— 防日志注入） */
  formatLine(record: AuditRecord): string;
}

export interface AuditLogOptions {
  readonly size?: number | undefined;
  /** 日志出口（缺省 `console.log`；测试注入以断言「一条记录一行」） */
  readonly sink?: ((line: string) => void) | undefined;
  /** 时钟（测试注入以断言 `at` 语义） */
  readonly now?: (() => Date) | undefined;
}

const MAX_NOTE_CHARS = 200;

/** 压成单行并截断：任何内嵌换行/回车都变空格 ⇒ 伪造不出一行假的日志 */
function oneLine(text: string): string {
  const collapsed = text.replace(/[\r\n\u2028\u2029]+/gu, ' ').trim();
  return collapsed.length > MAX_NOTE_CHARS ? `${collapsed.slice(0, MAX_NOTE_CHARS)}…` : collapsed;
}

function sortedPorts(ports: readonly number[]): readonly number[] {
  return [...new Set(ports)].sort((left, right) => left - right);
}

export function createAuditLog(options: AuditLogOptions = {}): AuditLog {
  const size = Math.max(1, Math.trunc(options.size ?? AUDIT_RING_SIZE));
  const sink = options.sink ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());

  const ring: AuditRecord[] = [];
  let seq = 0;
  let dropped = 0;

  const formatLine = (entry: AuditRecord): string => {
    const parts = [
      '[dsh-wsl-docker-ports] audit',
      `seq=${String(entry.seq)}`,
      `at=${entry.at}`,
      `origin=${entry.origin}`,
      `result=${entry.result}`,
      `action=${entry.action}`,
      `scope=${entry.scope}`,
      `ports=${entry.ports.join(',') === '' ? '-' : entry.ports.join(',')}`,
      `steps=${entry.steps.length === 0 ? '-' : entry.steps.map((step) => `${step.kind}@${String(step.port)}`).join('+')}`,
      `policy=${entry.elevationPolicy}`,
      `backend=${entry.backend}`,
      `exit=${entry.exitCode === null ? '-' : String(entry.exitCode)}`,
      `ms=${String(entry.durationMs)}`,
      `rolledBack=${String(entry.rolledBack)}`,
      `planId=${entry.planId === null ? '-' : entry.planId.slice(0, 12)}`,
    ];
    const line = parts.join(' ');
    return entry.note === null || entry.note === '' ? line : `${line} note=${entry.note}`;
  };

  return {
    record(input: AuditInput): AuditRecord {
      seq += 1;
      // 🔴 白名单拷贝：`input` 上多出来的任何字段都不进记录
      const entry: AuditRecord = {
        seq,
        at: input.at ?? now().toISOString(),
        origin: input.origin === 'agent' ? 'agent' : 'user',
        planId: typeof input.planId === 'string' && input.planId !== '' ? input.planId : null,
        action: input.action,
        scope: input.scope,
        ports: sortedPorts(Array.isArray(input.ports) ? input.ports : []),
        steps: (Array.isArray(input.steps) ? input.steps : []).map((step) => ({ kind: step.kind, port: step.port })),
        elevationPolicy: String(input.elevationPolicy ?? 'unknown'),
        backend: String(input.backend ?? 'unknown'),
        result: input.result,
        exitCode: typeof input.exitCode === 'number' && Number.isFinite(input.exitCode) ? Math.trunc(input.exitCode) : null,
        durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.trunc(input.durationMs)) : 0,
        rolledBack: input.rolledBack === true,
        note: typeof input.note === 'string' && input.note !== '' ? oneLine(input.note) : null,
      };
      ring.push(entry);
      while (ring.length > size) {
        ring.shift();
        dropped += 1;
      }
      sink(formatLine(entry));
      return entry;
    },

    tail(limit?: number): readonly AuditRecord[] {
      const count = limit === undefined ? ring.length : Math.max(0, Math.min(ring.length, Math.trunc(limit)));
      return count === 0 ? [] : ring.slice(ring.length - count);
    },

    size: () => ring.length,
    dropped: () => dropped,
    formatLine,
  };
}
