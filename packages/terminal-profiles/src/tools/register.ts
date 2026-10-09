/**
 * 6 个工具的注册（004 REQ-1.1；T1.1–T1.3）
 *
 * ## 这一层是**薄适配层**（design §6 的红线）
 *
 * 每个工具体只做四件事：**参数校验（由 `defineTool` 在进体前做）→ 权限判定 → 调 002 → 结果整形**。
 * 它不持有 PTY、不碰 handle、不建缓冲：所有机制都在 002（NFR-3）。因此本文件里不会出现
 * `spawnTerminal` / `resize(cols, rows)` / `seq` 这类词 —— 出现即违规。
 *
 * ## 🔴 `managed_terminal_resize` 的换序**不在**这里（宿主契约复核）
 *
 * 宿主 handle 是 `resize(cols, rows)`（列在前、不夹紧），而 002 对外的唯一入口是
 * `session-manager.resize(id, rows, cols)`（行在前、自带夹紧）。本层**只准**调后者，绝不能拿
 * handle 调 —— 弄反不会报错，只会静默把行列转置。所以工具体的那一行是
 * `manager.resize(id, args.rows, args.cols)`，**顺序与入参同名**（可读即正确）。
 *
 * ## 失败一律抛出（见 `./failure.ts` 的文件头）
 *
 * 唯一例外是审批取消（REQ-3.5）：它作为正常值返回 `{ ok:false, code:'cancelled', … }`。
 */

import type { TerminalProfile } from '../config/profiles.ts';
import type { SessionManager } from '../session/manager.ts';
import { fail, ToolFailureError, unknownKeyFailure } from './failure.ts';
import type { HostContextLike, ToolRunContext } from './host.ts';
import { decodeKeyName, decodeWritePayload, supportedKeyNames } from './keys.ts';
import { assertWriteAllowed, requestApproval, type WriteTool } from './policy.ts';
import { failFromSessionResult, readViaSession } from './read-model.ts';
import {
  KILL_OUTPUT,
  LIST_OUTPUT,
  NEW_OUTPUT,
  READ_OUTPUT,
  RESIZE_OUTPUT,
  WRITE_OUTPUT,
  withCancelled,
} from './schemas.ts';

/** 6 个工具名（design §5 逐个核对过的字面量；**恰好 6 个**，REQ-1.1） */
export const TERMINAL_TOOL_NAMES = [
  'managed_terminal_new',
  'managed_terminal_list',
  'managed_terminal_read',
  'managed_terminal_write',
  'managed_terminal_resize',
  'managed_terminal_kill',
] as const;

export type TerminalToolName = (typeof TERMINAL_TOOL_NAMES)[number];

/** 注册面（REQ-1.1）：`register` 返回 disposer（NFR-1 的卸载计数靠它） */
export interface ToolRegisterSurface {
  register(definition: unknown): () => void;
}

export interface CreateTerminalToolsOptions {
  /**
   * 宿主那一份 `defineTool`（**注入**而不是 import：见 `./host.ts` 的文件头）。
   * 单测传 `tests/helpers/tools-harness.ts` 的 fake（严格照 A-1 的 ①–③ 与 `validateArgs` 实现）。
   */
  readonly defineTool: (options: any) => unknown;
  /** 注册面（宿主是 `ctx.tools`；fake 记录名字与定义） */
  readonly tools: ToolRegisterSurface;
  /** 002 的实例表（**唯一**的机制入口） */
  readonly manager: SessionManager;
  /** profile 名录（`managed_terminal_new` 的枚举校验与 REQ-1.2 的「可用列表」都来自它） */
  readonly profiles: () => readonly TerminalProfile[];
  /** host context（沙箱/审批走它的非严格 `get`） */
  readonly ctx: HostContextLike;
}

/** 权限门的公共入口：先沙箱、再审批；两者都不通过则**不进入业务逻辑** */
async function gate(
  ctx: HostContextLike,
  exec: ToolRunContext,
  tool: WriteTool,
  reason: string,
): Promise<{ readonly cancelled: false } | { readonly cancelled: true; readonly value: unknown }> {
  assertWriteAllowed(ctx, exec.agent, tool);
  const approval = await requestApproval(ctx, {
    tool,
    reason,
    agent: exec.agent,
    callId: exec.callId,
    signal: exec.signal,
  });
  return approval.allowed ? { cancelled: false } : { cancelled: true, value: approval.value };
}

/** `managed_terminal_new` 的 profile 查找（REQ-1.2：不存在时**附可用列表**，不是只说「没找到」） */
function findProfile(profiles: readonly TerminalProfile[], name: string): TerminalProfile {
  const hit = profiles.find((profile) => profile.name === name);
  if (hit !== undefined) return hit;
  const names = profiles.map((profile) => profile.name);
  return fail(
    'profile-not-found',
    `profile「${name}」不存在`,
    names.length === 0 ? '当前配置里没有任何 profile。' : `可用 profile：${names.join('、')}`,
  );
}

export function createTerminalTools(options: CreateTerminalToolsOptions): {
  readonly names: readonly TerminalToolName[];
  readonly dispose: () => void;
} {
  const { defineTool, tools, manager, profiles, ctx } = options;
  const disposers: Array<() => void> = [];

  /** 注册一个工具并收集 disposer（NFR-1：卸载后工具数归零） */
  const register = (definition: unknown): void => {
    disposers.push(tools.register(definition));
  };

  register(
    defineTool({
      name: 'managed_terminal_new',
      description:
        'Start a new managed terminal instance from a configured profile. Returns the instance id, '
        + 'which every other terminal tool takes. Each call opens a NEW instance (ids are never reused). '
        + 'Requires write access: under the read-only sandbox the call is refused. '
        + 'If the profile name is unknown the result lists the available profiles.',
      parameters: {
        profile: {
          type: 'string',
          required: true,
          description: 'Profile name from the plugin configuration (see managed_terminal_list / the config page).',
        },
      },
      output: {
        schema: withCancelled(NEW_OUTPUT),
        render: (_args: unknown, value: any) =>
          value.ok === false
            ? [{ type: 'text', text: value.message + (value.hint === undefined ? '' : ` — 提示：${value.hint}`) }]
            : [{ type: 'text', text: `Started ${value.id} (profile ${value.profile}, ${value.rows}x${value.cols}).` }],
      },
      async execute(args: { profile: string }, exec: ToolRunContext) {
        const profile = findProfile(profiles(), args.profile);
        const denied = await gate(ctx, exec, 'managed_terminal_new', `start terminal profile "${args.profile}"`);
        if (denied.cancelled) return denied.value;
        const started = await manager.start(profile);
        if (!started.ok) return failFromSessionResult('managed_terminal_new', started);
        const summary = started.value;
        return {
          id: summary.id,
          profile: summary.profileName,
          rows: summary.rows,
          cols: summary.cols,
          ...(summary.pid === undefined ? {} : { pid: summary.pid }),
        };
      },
    }),
  );

  register(
    defineTool({
      name: 'managed_terminal_list',
      description:
        'List managed terminal instances: id, profile, pid, size, alive state, next seq and the dropped-chunk '
        + 'counter of the bounded output buffer. Read-only: available under every sandbox mode.',
      parameters: {},
      output: {
        schema: LIST_OUTPUT,
        render: (_args: unknown, value: any) => [{
          type: 'text',
          text: value.count === 0
            ? 'No terminal instances.'
            : value.instances
              .map((item: any) =>
                `${item.id}: ${item.profile} pid=${item.pid ?? '?'} ${item.rows}x${item.cols} `
                + `${item.alive ? 'alive' : 'exited'} seq=${item.seq} dropped=${item.dropped}`)
              .join('\n'),
        }],
      },
      async execute() {
        const instances = manager.list().map((item) => ({
          id: item.id,
          profile: item.profileName,
          rows: item.rows,
          cols: item.cols,
          // 002 的口径是 `exited`；工具面对外说 `alive`（REQ-1.3 的「存活状态」），只做一次取反
          alive: !item.exited,
          seq: item.seq,
          dropped: item.dropped,
          ...(item.pid === undefined ? {} : { pid: item.pid }),
        }));
        return { instances, count: instances.length };
      },
    }),
  );

  register(
    defineTool({
      name: 'managed_terminal_read',
      description:
        'Read one terminal instance screen. mode "snapshot" (default) returns the current rendered screen as '
        + 'replayable escape sequences plus rows/cols/seq/dropped. mode "incremental" returns the output chunks '
        + 'after sinceSeq; if that seq already fell out of the bounded buffer the result has lost=true and carries '
        + 'a fresh snapshot instead (never an empty array pretending there was no output). Read-only: always available.',
      parameters: {
        id: {
          type: 'string',
          required: true,
          description: 'Instance id returned by managed_terminal_new / managed_terminal_list (e.g. "term-1").',
        },
        mode: {
          type: 'string',
          enum: ['snapshot', 'incremental'],
          description: 'Read mode. Defaults to snapshot.',
        },
        sinceSeq: {
          type: 'integer',
          description:
            'Only for mode=incremental: return chunks after this seq. Omit for everything still buffered. '
            + 'Out-of-range values (0/negative, or older than the buffer) are reported through 002\'s own '
            + 'lost+snapshot semantics instead of a schema rejection — the value schema DSL has no '
            + '`minimum` key (2026-10-09, read from dsh-tools/lib/types/schema.js).',
        },
      },
      output: {
        schema: READ_OUTPUT,
        render: (_args: unknown, value: any) => {
          if (value.mode === 'snapshot') {
            return [{ type: 'text', text: `${value.snapshot.rows}x${value.snapshot.cols} seq=${value.snapshot.seq} dropped=${value.snapshot.dropped}\n${value.snapshot.text}` }];
          }
          if (value.lost === true) {
            return [{
              type: 'text',
              text: `[incremental lost] sinceSeq=${value.requestedSeq} is older than the buffer (oldest=${value.oldestSeq}, dropped=${value.dropped}); snapshot follows.\n${value.snapshot.text}`,
            }];
          }
          return [{
            type: 'text',
            text: value.chunks.length === 0
              ? `No new output (next seq=${value.seq}, dropped=${value.dropped}).`
              : value.chunks.map((chunk: any) => `[${chunk.seq}] ${chunk.data}`).join(''),
          }];
        },
      },
      async execute(args: { id: string; mode?: 'snapshot' | 'incremental'; sinceSeq?: number }, exec: ToolRunContext) {
        void exec;
        // 🔴 运行期补位（2026-10-09 集成方）：值 schema DSL **没有** `minimum` 键（写它就是作者错），原先
        // 由 schema 拦下的「负数 sinceSeq」改在这里判 —— 判据与原 schema **完全一致**（`< 0` ⇒ 拒），
        // 且照抄 schema 的措辞 `invalid arguments`，模型看到的仍是同一种错。0 与正数**不**在这里判：
        // 它们照 002 `read-model` 自己的 lost/快照口径走（不另立第二套语义）。
        if (args.sinceSeq !== undefined && args.sinceSeq < 0) {
          fail(
            'invalid-args',
            `invalid arguments: sinceSeq 必须 ≥ 0（收到 ${args.sinceSeq}）`,
            '值 schema DSL 无 minimum 键 ⇒ 该范围判据在运行期；0/正数照 002 的 lost+快照口径。',
          );
        }
        // `mode` 缺省 = snapshot（design §2）；`sinceSeq` 只在 incremental 下有义，snapshot 下**忽略**（不静默改成增量）
        return readViaSession(manager, args.id, {
          mode: args.mode ?? 'snapshot',
          sinceSeq: args.sinceSeq,
        });
      },
    }),
  );

  register(
    defineTool({
      name: 'managed_terminal_write',
      description:
        'Send input to one terminal instance. data is either a key name (Enter, Tab, Esc, Backspace, ArrowUp, '
        + 'C-c, F5, …) or literal text sent byte-for-byte to the PTY (no shell word splitting). An unrecognised '
        + 'key name is refused instead of being guessed. Requires write access.',
      parameters: {
        id: { type: 'string', required: true, description: 'Instance id.' },
        data: {
          type: 'string',
          required: true,
          description:
            'Key name or literal text. Known key names are listed in the unknown-key error. An EMPTY string is '
            + 'refused at runtime (unknown-key failure), not by the schema — the value schema DSL has no '
            + '`minLength` key (2026-10-09, read from dsh-tools/lib/types/schema.js).',
        },
      },
      output: {
        schema: withCancelled(WRITE_OUTPUT),
        render: (_args: unknown, value: any) =>
          value.ok === false
            ? [{ type: 'text', text: value.message + (value.hint === undefined ? '' : ` — 提示：${value.hint}`) }]
            : [{ type: 'text', text: `Sent ${value.written} char(s) as ${value.key}.` }],
      },
      async execute(args: { id: string; data: string }, exec: ToolRunContext) {
        // 🔴 键名解析**先于**权限门：未识别的键名是参数级错误（REQ-4.2），不该花掉一次审批
        const bytes = decodeWritePayload(args.data);
        if (bytes === '') return unknownKeyFailure(args.data, supportedKeyNames());
        const denied = await gate(ctx, exec, 'managed_terminal_write', `write ${bytes.length} char(s) to ${args.id}`);
        if (denied.cancelled) return denied.value;
        const written = await manager.write(args.id, bytes);
        if (!written.ok) return failFromSessionResult('managed_terminal_write', written);
        // `key` 是**回执**：键名命中键名表时给归一化后的键名（`Enter` / `C-c`），字面发送时给 `text`。
        // 它的用途是让「刚才那个 `\r` 到底是回车还是别的」在结果里可判 —— 所以存的是键名本身，
        // 不是写进去的字节（字节长度为 1 的键有 20 多个，回显字节等于没回执）。
        return { written: written.value.written, key: decodeKeyName(args.data) ?? 'text' };
      },
    }),
  );

  register(
    defineTool({
      name: 'managed_terminal_resize',
      description:
        'Resize one terminal instance. Out-of-range values are clamped and the result reports the ACTUAL '
        + 'effective rows/cols (requestedRows/requestedCols echo the input). Requires write access.',
      parameters: {
        id: { type: 'string', required: true, description: 'Instance id.' },
        rows: { type: 'integer', required: true, description: 'Requested rows (clamped to the plugin limits).' },
        cols: { type: 'integer', required: true, description: 'Requested columns (clamped to the plugin limits).' },
      },
      output: {
        schema: withCancelled(RESIZE_OUTPUT),
        render: (_args: unknown, value: any) =>
          value.ok === false
            ? [{ type: 'text', text: value.message + (value.hint === undefined ? '' : ` — 提示：${value.hint}`) }]
            : [{
                type: 'text',
                text: `Resized to ${value.rows}x${value.cols}`
                  + (value.rows === value.requestedRows && value.cols === value.requestedCols
                    ? '.'
                    : ` (requested ${value.requestedRows}x${value.requestedCols}).`),
              }],
      },
      async execute(args: { id: string; rows: number; cols: number }, exec: ToolRunContext) {
        const denied = await gate(ctx, exec, 'managed_terminal_resize', `resize ${args.id} to ${args.rows}x${args.cols}`);
        if (denied.cancelled) return denied.value;
        // 🔴 顺序与入参同名：002 的入口就是 `(id, rows, cols)`（行在前、自带夹紧）。
        // 宿主 handle 的 `resize(cols, rows)` **不在本层出现** —— 换序只在 002 的 manager 里发生一次。
        const resized = await manager.resize(args.id, args.rows, args.cols);
        if (!resized.ok) return failFromSessionResult('managed_terminal_resize', resized);
        return {
          rows: resized.value.rows,
          cols: resized.value.cols,
          requestedRows: args.rows,
          requestedCols: args.cols,
        };
      },
    }),
  );

  register(
    defineTool({
      name: 'managed_terminal_kill',
      description:
        'Terminate one terminal instance (best-effort process-group termination) and release its screen model. '
        + 'An unknown id is an explicit error, never a silent success. Requires write access.',
      parameters: {
        id: { type: 'string', required: true, description: 'Instance id.' },
      },
      output: {
        schema: withCancelled(KILL_OUTPUT),
        render: (_args: unknown, value: any) =>
          value.ok === false
            ? [{ type: 'text', text: value.message + (value.hint === undefined ? '' : ` — 提示：${value.hint}`) }]
            : [{ type: 'text', text: `Killed ${value.id ?? ''}`.trim() + (value.warning === undefined ? '.' : ` (${value.warning})`) }],
      },
      async execute(args: { id: string }, exec: ToolRunContext) {
        const denied = await gate(ctx, exec, 'managed_terminal_kill', `kill ${args.id}`);
        if (denied.cancelled) return denied.value;
        const killed = await manager.kill(args.id);
        if (!killed.ok) return failFromSessionResult('managed_terminal_kill', killed);
        return {
          killed: true,
          id: args.id,
          ...(killed.value.warning === undefined ? {} : { warning: killed.value.warning }),
        };
      },
    }),
  );

  return {
    names: TERMINAL_TOOL_NAMES,
    dispose: () => {
      for (const dispose of disposers) dispose();
      disposers.length = 0;
    },
  };
}

/** 供调用方判断「这是不是一个工具失败」用（宿主会把 throw 归一化成 `isError:true` 结果） */
export { ToolFailureError };
