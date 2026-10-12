/**
 * 008 T3.1 客户端判据的**假件**（离线：零真机、零提权、零文件、零 `fetch`）
 *
 * 只做两件事：把服务端的响应形状**照 DTO 抄一遍**（`../transport/plan.ts` 的 `PlanResponse` /
 * `../transport/apply.ts` 的 `ApplyReport`），以及记录客户端**真的发了什么**（URL / 方法 / 头 / body 原文）。
 * 「body 只含白名单字段」「命令原文没进请求体」这两条判据就靠后者。
 */

import type { FetchLike, FetchResponseLike } from '../../src/wire.ts';

/** 测试用凭据（与真机无关；只在假件里出现） */
export const TEST_TOKEN = 'tok-0123456789abcdef0123456789abcdef';

/** 服务端会渲染出来的两类命令原文（**只当字符串**：本测试从不执行任何命令） */
export const CMD_PORT_PROXY =
  'netsh interface portproxy add v4tov4 listenport=3306 listenaddress=127.0.0.1 connectport=3306 connectaddress=172.20.201.152';
export const CMD_FIREWALL =
  'New-NetFirewallRule -DisplayName "dsh-wsl-docker-ports 3306" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3306';
/** 带**首尾空格与换行**的一条：用来钉死「客户端不改写命令原文」 */
export const CMD_QUIRKY = '  netsh interface portproxy add v4tov4 listenport=5432 listenaddress=0.0.0.0 connectport=5432 connectaddress=172.20.201.152 \n';

export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  /** body 原文（没 body 时为空串） */
  readonly rawBody: string;
  readonly body: Record<string, unknown>;
}

export interface FetchRig {
  readonly calls: RecordedCall[];
  readonly fetchImpl: FetchLike;
  /** 脚本用尽之后又来的请求数（>0 一律判失败：说明客户端多发了请求） */
  unexpected(): number;
  /** 打向 `/write/plan` 的调用 */
  planCalls(): readonly RecordedCall[];
  /** 打向 `/write/apply` 的调用 */
  applyCalls(): readonly RecordedCall[];
}

export function jsonResponse(status: number, payload: unknown): FetchResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

/** 错误响应体（与宿主路由的出口形状一致：`{ ok: false, error: { code, message } }`） */
export function errorBody(code: string, message: string): Record<string, unknown> {
  return { ok: false, error: { code, message } };
}

/**
 * 按脚本依次回响应；**多出来的请求一律记数并回 500**（不抛，好让断言聚焦在「多了几次」上）。
 */
export function createFetchRig(script: readonly { readonly status: number; readonly payload: unknown }[]): FetchRig {
  const calls: RecordedCall[] = [];
  let extra = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    const rawBody = init?.body ?? '';
    let body: Record<string, unknown> = {};
    if (rawBody !== '') {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, rawBody, body });
    const step = script[calls.length - 1];
    if (step === undefined) {
      extra += 1;
      return jsonResponse(500, errorBody('internal', '测试脚本没有更多响应'));
    }
    return jsonResponse(step.status, step.payload);
  };
  return {
    calls,
    fetchImpl,
    unexpected: () => extra,
    planCalls: () => calls.filter((call) => call.url.includes('/write/plan')),
    applyCalls: () => calls.filter((call) => call.url.includes('/write/apply')),
  };
}

export interface PlanPortScript {
  readonly port: number;
  readonly ready?: boolean;
  readonly steps?: readonly { readonly kind: string; readonly commandText: string }[];
  readonly notes?: readonly string[];
  readonly blocked?: Record<string, unknown> | null;
}

/** 服务端 `PlanResponse` 的**照抄**（字段名与 DTO 逐字一致，方便对账） */
export function planPayload(overrides: {
  readonly planId?: string | null;
  readonly ready?: boolean;
  readonly action?: string;
  readonly scope?: 'loopback' | 'lan';
  readonly policy?: string;
  readonly backend?: string;
  readonly available?: boolean;
  readonly ticket?: string | null;
  readonly ports?: readonly PlanPortScript[];
  readonly notes?: readonly string[];
  readonly blockedReason?: string | null;
} = {}): Record<string, unknown> {
  const scope = overrides.scope ?? 'loopback';
  const ports =
    overrides.ports ??
    ([{ port: 3306, steps: [{ kind: 'portproxy-add', commandText: CMD_PORT_PROXY }], notes: [] }] as const);
  const dtos = ports.map((port) => ({
    port: port.port,
    ready: port.ready ?? true,
    steps: (port.steps ?? []).map((step) => ({ kind: step.kind, port: port.port, params: {}, commandText: step.commandText })),
    commandText: (port.steps ?? []).map((step) => step.commandText).join('\n'),
    notes: port.notes ?? [],
    ...(port.blocked === undefined || port.blocked === null ? {} : { blocked: port.blocked }),
  }));
  const ticket = overrides.ticket === undefined ? 'tkt-1' : overrides.ticket;
  const planId = overrides.planId === undefined ? 'plan-abcdef0123456789' : overrides.planId;
  return {
    ok: true,
    planId,
    ready: overrides.ready ?? true,
    action: overrides.action ?? 'add',
    scope,
    fromScope: null,
    ports: dtos,
    commandText: dtos.map((item) => item.commandText).join('\n'),
    notes: overrides.notes ?? ['计划只覆盖所有权集合内的端口'],
    elevation: { policy: overrides.policy ?? 'ask', backend: overrides.backend ?? 'gsudo', available: overrides.available ?? true },
    confirm: ticket === null || planId === null ? null : { ticket, expiresAt: 1_800_000_000_000 },
    blockedReason: overrides.blockedReason ?? null,
  };
}

/** 服务端 `ApplyReport` 的照抄 */
export function applyPayload(overrides: {
  readonly status?: string;
  readonly message?: string;
  readonly executed?: readonly string[];
  readonly skipped?: readonly string[];
  readonly failed?: readonly { readonly name: string; readonly reason: string }[];
  readonly rolledBack?: readonly { readonly port: number; readonly ok: boolean; readonly message: string }[];
} = {}): Record<string, unknown> {
  return {
    ok: true,
    planId: 'plan-abcdef0123456789',
    status: overrides.status ?? 'ok',
    action: 'add',
    scope: 'loopback',
    port: 3306,
    elevationPolicy: 'ask',
    backend: 'gsudo',
    exitCode: 0,
    durationMs: 321,
    executed: overrides.executed ?? ['portproxy-add'],
    skipped: overrides.skipped ?? [],
    failed: overrides.failed ?? [],
    rolledBack: overrides.rolledBack ?? [],
    commandText: CMD_PORT_PROXY,
    message: overrides.message ?? '已应用',
    hint: '',
  };
}
