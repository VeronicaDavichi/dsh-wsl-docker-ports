/**
 * 008 T3.1 服务端 DTO → 客户端视图（**只做形状收敛**）
 *
 * ## 为什么单独一个文件
 *
 * ① `write-channel.ts` 一度到 409 行（单文件 ≤400 是 SHALL）——「HTTP 传输」与「响应解读」
 * 本来也是两件事；② 解读层**必须**能被单独测：「命令原文逐字搬运」正是这一层的判据。
 *
 * ## 三条不许动的规矩
 *
 * 1. **不改写**：`commandText` 原样搬运（不 trim、不换行重组、不拼接）—— 它是「命令原文」的
 *    唯一来源，任何加工都等于客户端参与了命令文本的生成（违反契约 8）。
 * 2. **不补默认**：字段缺了就是空/`null`（如 `elevation.policy` 缺失 → `''` ⇒ 提权档门会拦住），
 *    绝不假设「大概能写」。
 * 3. **不解析参数**：`steps[].params` 刻意丢掉 —— 客户端要展示的是原文，不是可执行结构。
 */

/** 计划里的一条步骤（只取展示需要的：命令原文 + 种类 + 端口） */
export interface ClientPlanStep {
  readonly kind: string;
  readonly port: number;
  readonly commandText: string;
}

/** 被拦下的原因（原样透出服务端的可读说明，不改写） */
export interface ClientPlanBlock {
  readonly reason: string;
  readonly message: string;
  readonly hint: string;
}

export interface ClientPlanPort {
  readonly port: number;
  readonly ready: boolean;
  readonly commandText: string;
  readonly notes: readonly string[];
  readonly steps: readonly ClientPlanStep[];
  readonly blocked: ClientPlanBlock | null;
}

/** 一次计划（服务端 `PlanResponse` 的客户端视图） */
export interface ClientPlan {
  /** 只有全部端口可执行才非 `null`；`null` ⇒ 没有可用票据 */
  readonly planId: string | null;
  readonly ready: boolean;
  readonly action: string;
  readonly scope: 'loopback' | 'lan';
  readonly ports: readonly ClientPlanPort[];
  readonly notes: readonly string[];
  readonly elevation: { readonly policy: string; readonly backend: string; readonly available: boolean };
  /** 一次性确认票据（绑定本 `planId`；`null` = 服务端没签发 ⇒ 确认按钮必须置灰） */
  readonly ticket: string | null;
  readonly expiresAt: number | null;
  readonly blockedReason: string | null;
}

/** 执行回执（服务端 `ApplyReport` 的客户端视图） */
export interface ClientApplyReport {
  readonly status: string;
  readonly message: string;
  readonly hint: string;
  readonly executed: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { readonly name: string; readonly reason: string }[];
  readonly rolledBack: readonly { readonly port: number; readonly ok: boolean; readonly message: string }[];
  readonly backend: string;
  readonly elevationPolicy: string;
  readonly durationMs: number;
  readonly commandText: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readStringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function parsePlanPayload(payload: unknown): ClientPlan {
  const body = asRecord(payload) ?? {};
  const elevation = asRecord(body['elevation']) ?? {};
  const confirm = asRecord(body['confirm']);
  const ports: ClientPlanPort[] = [];
  for (const raw of Array.isArray(body['ports']) ? body['ports'] : []) {
    const port = asRecord(raw);
    if (port === undefined) continue;
    const blocked = asRecord(port['blocked']);
    const steps: ClientPlanStep[] = [];
    for (const rawStep of Array.isArray(port['steps']) ? port['steps'] : []) {
      const step = asRecord(rawStep);
      if (step === undefined) continue;
      steps.push({
        kind: readString(step['kind']),
        port: typeof step['port'] === 'number' ? step['port'] : 0,
        // 🔴 原样搬运：这是「命令原文」的唯一来源，本函数不做任何拼接/裁剪/转义
        commandText: readString(step['commandText']),
      });
    }
    ports.push({
      port: typeof port['port'] === 'number' ? port['port'] : 0,
      ready: port['ready'] === true,
      commandText: readString(port['commandText']),
      notes: readStringList(port['notes']),
      steps,
      blocked:
        blocked === undefined
          ? null
          : {
              reason: readString(blocked['reason']),
              message: readString(blocked['message']),
              hint: readString(blocked['hint']),
            },
    });
  }
  return {
    planId: typeof body['planId'] === 'string' ? body['planId'] : null,
    ready: body['ready'] === true,
    action: readString(body['action']),
    scope: body['scope'] === 'lan' ? 'lan' : 'loopback',
    ports,
    notes: readStringList(body['notes']),
    elevation: {
      policy: readString(elevation['policy']),
      backend: readString(elevation['backend']),
      available: elevation['available'] === true,
    },
    ticket: confirm === undefined ? null : typeof confirm['ticket'] === 'string' ? confirm['ticket'] : null,
    expiresAt: confirm === undefined ? null : typeof confirm['expiresAt'] === 'number' ? confirm['expiresAt'] : null,
    blockedReason: typeof body['blockedReason'] === 'string' ? body['blockedReason'] : null,
  };
}

/** 执行回执 → 客户端视图（`failed[]` 的 `reason` 允许为 `null`，归一成空串） */
export function parseApplyPayload(payload: unknown): ClientApplyReport {
  const body = asRecord(payload) ?? {};
  const failed: { name: string; reason: string }[] = [];
  for (const raw of Array.isArray(body['failed']) ? body['failed'] : []) {
    const item = asRecord(raw);
    if (item === undefined) continue;
    failed.push({ name: readString(item['name']), reason: readString(item['reason'] ?? item['stderr']) });
  }
  const rolledBack: { port: number; ok: boolean; message: string }[] = [];
  for (const raw of Array.isArray(body['rolledBack']) ? body['rolledBack'] : []) {
    const item = asRecord(raw);
    if (item === undefined) continue;
    rolledBack.push({
      port: typeof item['port'] === 'number' ? item['port'] : 0,
      ok: item['ok'] === true,
      message: readString(item['message']),
    });
  }
  return {
    status: readString(body['status']),
    message: readString(body['message']),
    hint: readString(body['hint']),
    executed: readStringList(body['executed']),
    skipped: readStringList(body['skipped']),
    failed,
    rolledBack,
    backend: readString(body['backend']),
    elevationPolicy: readString(body['elevationPolicy']),
    durationMs: typeof body['durationMs'] === 'number' ? body['durationMs'] : 0,
    commandText: readString(body['commandText']),
  };
}
