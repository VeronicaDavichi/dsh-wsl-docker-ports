/**
 * 008 T3.1 客户端**写通道**（`/write/plan` + `/write/apply` 的唯一客户端路径）
 *
 * ## 信任边界（🔴 本文件存在的第一理由）
 *
 * 客户端**只回传** `planId` + `ticket`（外加 `confirmed: true` / `origin: 'user'`）与**声明式目标**；
 * **绝不**回传、拼接、构造任何命令文本 —— 服务端用 `target` **重新推导**计划，再比对 `planId`
 * （见 `../transport/apply.ts` 的文件头）。因此本文件里没有任何地方把 `commandText` 写进请求体：
 * 「命令原文只来自服务端」是靠**数据流方向**保证的，不是靠自觉。
 *
 * ## 为什么 `declaration` 必须在 `target` 里（且 plan/apply 必须逐字相同）
 *
 * 服务端的现读事实面里**没有**所有权集合：`createPlanFacts` 的 `managedPorts` 就是
 * `declaration ?? []`（方案 (a)，design §12）。⇒ 请求不带声明 ⇒ 一切都 `port-not-managed`。
 * 更关键的是 `apply` 会**重算**计划并比对 `planId` ⇒ 两次请求的 `target`（含 `declaration`）
 * 必须**逐字相同**，否则必然 `409 plan-mismatch`。所以：`declaration` 由页面在**预演时读一次**，
 * 存进待确认的目标里，确认时**原样复用**（`write-panel.tsx` 的 `pending`）；本模块不去猜、不补默认值。
 *
 * ## 凭据怎么带
 *
 * `Authorization: Bearer <t>`（首选；不进 URL ⇒ 不会被日志/历史/Referer 带走任何东西）。
 * 契约里允许的 `?token=` 我们**不主动用**：URL 会进访问日志与浏览器历史，而那正是
 * 「凭据绝不进日志」要避免的形态。服务端两种都收（`../transport/write-auth.ts`），这里只是选更安全的那种。
 *
 * ## 「零请求」是可断言的
 *
 * `requestCount()` 只统计**真的发出去了**的请求；没凭据时在本地就拦下（注定 401，没必要往返）。
 * 「未点确认 ⇒ 零请求」由此可被逐条钉死（`tests/client/write-*.test.tsx`）。
 */

import { parseManagedPorts } from '../diff/managed-ports-parse.ts';
import type { ManagedPorts } from '../diff/managed-ports.ts';
import { WRITE_APPLY_PATH, WRITE_PLAN_PATH } from '../transport/constants.ts';
import type { FetchLike } from '../wire.ts';
import type { SettingsPipe } from './settings-pipe.ts';
import { parseApplyPayload, parsePlanPayload } from './write-dto.ts';
import type { ClientApplyReport, ClientPlan } from './write-dto.ts';
import {
  CREDENTIAL_MISSING_HINT,
  CREDENTIAL_REJECTED_HINT,
  type WriteTokenStore,
} from './write-token.ts';

/** 读一条错误码/文案（服务端 `error` 对象里只有这两个字段是可读的） */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 只认对象（服务端的 `error` 是对象；`null`/数组/字符串一律当没有） */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** 客户端可发起的写动作（服务端另有 `fix` / `switch-scope`；本页只做增删两类） */
export type WriteActionInput = 'add' | 'remove';

/** 作用域（与 `../diff/types.ts` 的 `Scope` 同值域，这里只用两个字面量） */
export type WriteScopeInput = 'loopback' | 'lan';

/**
 * 声明式写入目标 = 请求体**唯一**允许携带的东西。
 * `declaration` 是所有权集合（服务端自己不持有它，见文件头）。
 */
export interface WriteTargetInput {
  readonly action: WriteActionInput;
  readonly ports: readonly number[];
  readonly scope: WriteScopeInput;
  readonly declaration: ManagedPorts;
}

/**
 * 计划里的一条步骤（**只取展示需要的**：命令原文 + 种类 + 端口）
 * —— 形状定义在 `write-dto.ts`（那里也负责「逐字搬运」），这里只再导出给页面用。
 */
export type { ClientApplyReport, ClientPlan, ClientPlanBlock, ClientPlanPort, ClientPlanStep } from './write-dto.ts';

/**
 * 失败分类（**决定 UI 的下一步动作**，故必须分得开）：
 * - `credential`（401）：凭据缺失/错误 ⇒ 指路、**不重试**；
 * - `replan`（409 / 403）：票据过期或计划不符 ⇒ **重新 plan + 重新要求确认**，绝不静默重发 apply；
 * - `unavailable`（503）：现读事实失败 ⇒ 环境问题，重试也不会更好；
 * - `protocol`：404 / 405 / 500 / 网络异常 ⇒ 如实报，不猜。
 */
export type WriteFailureKind = 'credential' | 'replan' | 'unavailable' | 'protocol';

export interface WriteFailure {
  readonly kind: WriteFailureKind;
  readonly code: string;
  readonly message: string;
  readonly hint: string;
}

export type WriteOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: WriteFailure };

/** 按状态码/错误码定 `kind`（顺序刻意：先凭据，再票据/计划，再不可用，最后兜底） */
export function classifyWriteFailure(input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}): WriteFailure {
  const message = input.message === '' ? `写通道返回了不可识别的失败（HTTP ${String(input.status)}）` : input.message;
  if (input.code === 'unauthorized' || input.status === 401) {
    return { kind: 'credential', code: 'unauthorized', message, hint: CREDENTIAL_REJECTED_HINT };
  }
  if (input.code === 'plan-mismatch' || input.code === 'confirm-required') {
    return {
      kind: 'replan',
      code: input.code,
      message,
      hint: '计划或票据已失效：需要**重新预演并重新确认**（本客户端不会静默重发同一份确认）。',
    };
  }
  if (input.code === 'rules-unavailable' || input.status === 503) {
    return {
      kind: 'unavailable',
      code: input.code === '' ? 'rules-unavailable' : input.code,
      message,
      hint: '现读事实（netsh 规则 / eth0 / 防火墙规则名）读不到：这是环境问题，重发同一请求不会变好；请先修读侧。',
    };
  }
  return {
    kind: 'protocol',
    code: input.code === '' ? `http-${String(input.status)}` : input.code,
    message,
    hint: '通道级失败（路径/方法/内部错误或网络异常）：请核对插件版本与宿主路由是否一致。',
  };
}

/** 失败 → 一段可直接显示的中文（**只拼服务端的原文与固定提示，不含任何凭据**） */
export function failureText(failure: WriteFailure): string {
  return `${failure.message}${failure.hint === '' ? '' : ` ${failure.hint}`}`;
}

/** 拼请求 URL（基址 + 通道路径）；导出以便测试断言**字面量** */
export function buildWriteUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

/**
 * 目标的**唯一**序列化处：四个白名单键，一个不多。
 * 🔴 这里就是「客户端不构造命令」的结构性保证：函数**只认识**这四个字段，
 * 计划里那些 `commandText` 根本没有进来的入口。
 */
export function serializeTarget(target: WriteTargetInput): Record<string, unknown> {
  return {
    action: target.action,
    ports: [...target.ports],
    scope: target.scope,
    declaration: target.declaration.map((range) => ({ start: range.start, end: range.end })),
  };
}

/** `apply` 请求体 = 五个白名单键（服务端 `routes.ts` 只取这五个） */
export function serializeApplyBody(input: {
  readonly target: WriteTargetInput;
  readonly planId: string;
  readonly ticket: string;
}): Record<string, unknown> {
  return {
    target: serializeTarget(input.target),
    planId: input.planId,
    confirmed: true,
    origin: 'user',
    ticket: input.ticket,
  };
}

export interface WriteChannel {
  plan(target: WriteTargetInput): Promise<WriteOutcome<ClientPlan>>;
  apply(input: { readonly target: WriteTargetInput; readonly planId: string; readonly ticket: string }): Promise<WriteOutcome<ClientApplyReport>>;
  /** 真的发出去的请求数（本地拦下的不计）—— 「零请求」判据靠它 */
  requestCount(): number;
}

/** 读所有权声明（来自配置）的结果；失败 ⇒ 可读原因，**不发请求** */
export type WriteDeclarationOutcome =
  | { readonly ok: true; readonly ports: ManagedPorts }
  | { readonly ok: false; readonly message: string };

/**
 * 声明读取器：配置文件里的 `managedPorts`（字符串数组）→ 服务端要的区间数组。
 * 🔴 复用宿主的 `parseManagedPorts`（**同一个解析器**）⇒ 「客户端声明的集合」与
 * 「服务端快照的集合」不可能因两套解析而分叉。
 */
export function createDeclarationReader(settings: SettingsPipe | undefined): () => Promise<WriteDeclarationOutcome> {
  return async (): Promise<WriteDeclarationOutcome> => {
    if (settings === undefined) {
      return { ok: false, message: '配置写回管道未接线（remote.settings 缺失）：读不到所有权声明 ⇒ 一切端口都会是 port-not-managed，故不发请求。' };
    }
    const config = await settings.readConfig();
    const parsed = parseManagedPorts(config.managedPorts);
    if (!parsed.ok) {
      return { ok: false, message: `所有权声明（managedPorts）里有 ${String(parsed.issues.length)} 处非法项，已就地报出 ⇒ 零请求：${parsed.issues.map((issue) => issue.message).join('；')}` };
    }
    return { ok: true, ports: parsed.ports };
  };
}

export interface WriteChannelOptions {
  /** 同源基址（默认 `''`）；GUI 与路由同源 ⇒ 相对路径即可 */
  readonly baseUrl?: string | undefined;
  /** 凭据读法（**每次请求现读**：刚生成的凭据不必等 React 重渲染） */
  readonly token: () => string | undefined;
  /** 注入 fetch（测试用）；默认全局 `fetch` */
  readonly fetchImpl?: FetchLike | undefined;
}

/**
 * 造写通道。**构造期不发请求**；`plan` / `apply` 各发一次。
 *
 * 没凭据 ⇒ **本地拦下**（`credential` 失败，`requestCount` 不动）：
 * 服务端此刻必然是 401，发出去只是浪费一次往返 + 让 401 出现在访问日志里。
 */
export function createWriteChannel(options: WriteChannelOptions): WriteChannel {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined);
  let requests = 0;

  async function post(path: string, body: unknown): Promise<WriteOutcome<unknown>> {
    const token = options.token();
    if (token === undefined || token.trim() === '') {
      return { ok: false, failure: { kind: 'credential', code: 'unauthorized', message: CREDENTIAL_MISSING_HINT, hint: '' } };
    }
    if (fetchImpl === undefined) {
      return {
        ok: false,
        failure: { kind: 'protocol', code: 'no-fetch', message: '运行环境没有 fetch：写通道不可用（只读展示不受影响）。', hint: '' },
      };
    }
    requests += 1;
    let status = 0;
    let payload: unknown = null;
    try {
      const response = await fetchImpl(buildWriteUrl(baseUrl, path), {
        method: 'POST',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      status = response.status;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: 'protocol',
          code: 'network',
          message: `请求写通道失败：${error instanceof Error ? error.message : String(error)}`,
          hint: '',
        },
      };
    }
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : undefined;
    if (status === 200 && record?.['ok'] === true) return { ok: true, value: payload };
    const error = record === undefined ? undefined : asRecord(record['error']);
    return {
      ok: false,
      failure: classifyWriteFailure({
        status,
        code: readString(error?.['code']),
        message: readString(error?.['message']),
      }),
    };
  }

  return {
    async plan(target: WriteTargetInput): Promise<WriteOutcome<ClientPlan>> {
      const outcome = await post(WRITE_PLAN_PATH, serializeTarget(target));
      if (!outcome.ok) return outcome;
      return { ok: true, value: parsePlanPayload(outcome.value) };
    },
    async apply(input): Promise<WriteOutcome<ClientApplyReport>> {
      const outcome = await post(WRITE_APPLY_PATH, serializeApplyBody(input));
      if (!outcome.ok) return outcome;
      return { ok: true, value: parseApplyPayload(outcome.value) };
    },
    requestCount: () => requests,
  };
}

/** 页面（`pane.tsx`）拿到的一整包：通道 + 凭据仓库 + 声明读取器 */
export interface WriteWiring {
  readonly channel: WriteChannel;
  readonly tokenStore: WriteTokenStore;
  readonly declaration: () => Promise<WriteDeclarationOutcome>;
}

export function createWriteWiring(options: {
  readonly settings: SettingsPipe | undefined;
  readonly tokenStore: WriteTokenStore;
  readonly baseUrl?: string | undefined;
  readonly fetchImpl?: FetchLike | undefined;
}): WriteWiring {
  return {
    channel: createWriteChannel({
      token: () => options.tokenStore.read(),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    }),
    tokenStore: options.tokenStore,
    declaration: createDeclarationReader(options.settings),
  };
}
