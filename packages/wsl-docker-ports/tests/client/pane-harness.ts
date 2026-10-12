/**
 * `pane.test.tsx` / `pane-write.test.tsx` 的**公共台架**（2026-10-12 009 收口轮 T5 拆出）
 *
 * ## 为什么单独一个文件
 *
 * `tests/client/pane.test.tsx` 撞上「单文件 ≤ 400 行 SHALL」（拆前 `split('\n')` = **455**）。
 * 拆法按**职责**切，不按行数硬剁：只读展示面留在 `pane.test.tsx`，写回/失败态/样式注入
 * 搬去 `pane-write.test.tsx`；**两个文件都要用**的注入式 runtime 台架落在这里。
 *
 * 🔴 本文件**不含任何 `it()`** ⇒ 它不是测试文件（`vitest` 只收 `*.test.ts(x)`）⇒
 * **用例数不因拆文件而变**（拆前 19 → 拆后 12 + 7 = 19）。
 *
 * ## 台架的口径（照搬拆前的注释，一个字都没松）
 *
 * **配置写与提权写都挂上计数器**（不是「提权那一侧压根没接」）——
 * 否则「零提权调用」只是「没有提权入口」的假象，而不是「有入口却没被走」。
 *
 * 009 收口轮 T3 起多一个计数器：`mutates`（清除凭据走宿主 `mutate` 的 `unset`，与 `update` **分开数** ——
 * 两个口径不混，`updateCount()` 只数 `update`）。
 */

import type { ClientRuntime, ForwardWriteRequest, RemoteSettingsLike, SettingsPathOp, SettingsResponse } from '../../src/client/host.ts';
import { createSettingsPipe, SETTINGS_NAMESPACE } from '../../src/client/settings-pipe.ts';
import { snapshot } from '../unit/client-fixtures.ts';

export interface Recorded {
  loads: number[];
  describes: number;
  updates: { readonly ns: string; readonly patch: Record<string, unknown>; readonly argCount?: number }[];
  /** `mutate` 的真实调用（T3：只有「清除凭据」会走它） */
  mutates: { readonly ns: string; readonly ops: readonly SettingsPathOp[]; readonly revision: unknown; readonly argCount: number }[];
  elevation: ForwardWriteRequest[];
  /** 宿主 `update` 被**尝试**的次数（含抛错那一次）——「不重试」靠它证 */
  updateAttempts: number;
}

export interface HarnessOptions {
  /** 让宿主 `update` 抛错（模拟真机 `client api: settings/update expected 3 argument(s), got 2` 那类拒绝） */
  readonly updateError?: string;
  /** 管道**自身**抛（模拟调用方没接住的异常）—— 验面板那层兜底 */
  readonly explodingSettings?: boolean;
  /** 宿主压根没提供 `remote.settings` */
  readonly noSettings?: boolean;
  /**
   * 让宿主 `mutate` 抛错（T3 的清除失败路径）。
   * 🔴 校验**实参个数**（真机规则：`client api: settings/mutate expected 3 argument(s), got N`）。
   */
  readonly mutateError?: string;
  /** 服务端**初始**是否已配置 `writeToken`（T3：清除后 `mutate` 回执里的新视图据此变 false 且**持久**在台架里） */
  readonly configured?: boolean;
}

export interface Harness {
  readonly runtime: ClientRuntime;
  readonly recorded: Recorded;
  readonly push: (next: ReturnType<typeof snapshot>) => void;
}

/**
 * 注入式 runtime：所有外部输入都是 fake（零真机、零提权、零文件）。
 *
 * T3 起这个假宿主**有状态**：`mutate({op:'unset'})` 会把 `writeToken` 从它自己的配置里真的删掉，
 * `describe` 反射当前状态 ⇒ 「清除后重新读一次仍是未配置」是真读，不是内存推断。
 */
export function harness(initial: ReturnType<typeof snapshot>, options: HarnessOptions = {}): Harness {
  const recorded: Recorded = { loads: [], describes: 0, updates: [], mutates: [], elevation: [], updateAttempts: 0 };
  let current = initial;
  const config: Record<string, unknown> = options.configured === true ? { writeToken: 'tk-harness-secret' } : {};
  const secretsOf = (): { path: string[]; set: boolean }[] => [{ path: ['writeToken'], set: config['writeToken'] !== undefined }];
  const remote: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => {
      recorded.describes += 1;
      return { ok: true, value: { revision: 3, namespaces: [{ ns: SETTINGS_NAMESPACE, value: {}, secrets: secretsOf() }] } };
    },
    update: async (ns: string, patch: unknown): Promise<SettingsResponse> => {
      recorded.updateAttempts += 1;
      if (options.updateError !== undefined) throw new Error(options.updateError);
      recorded.updates.push({ ns, patch: patch as Record<string, unknown> });
      if (patch !== null && typeof patch === 'object' && 'writeToken' in patch) config['writeToken'] = (patch as { writeToken?: unknown }).writeToken;
      return { ok: true, value: { namespaces: [{ ns: SETTINGS_NAMESPACE, value: {}, secrets: secretsOf() }] } };
    },
    // 用 rest 参数数**真实实参个数**（宿主 `prepareInvocation` 数的就是 `values.length`）；
    // ⚠️ 不能用 `arguments.length`：箭头函数没有自己的 `arguments`（会读到外层 harness 的）。
    mutate: async (...args: unknown[]): Promise<SettingsResponse> => {
      const [ns, ops, revision] = args as [string, readonly SettingsPathOp[], unknown];
      recorded.mutates.push({ ns, ops, revision, argCount: args.length });
      if (options.mutateError !== undefined) throw new Error(options.mutateError);
      for (const op of ops) {
        // 🔴 与宿主 `applyPathOp` 同一语义：`unset` 把键**删掉**（不是写空串/undefined 值）
        if (op.op === 'unset' && op.path.length === 1 && op.path[0] === 'writeToken') delete config['writeToken'];
      }
      return { ok: true, value: { namespaces: [{ ns: SETTINGS_NAMESPACE, value: { distro: 'Ubuntu2204' }, secrets: secretsOf() }] } };
    },
  };
  const pipe = createSettingsPipe(() => remote);
  const settings: ClientRuntime['settings'] =
    options.noSettings === true
      ? undefined
      : options.explodingSettings === true
        ? {
            ...pipe,
            writeManagedPorts: async () => {
              throw new Error('管道自身炸了（模拟未接住的异常）');
            },
          }
        : pipe;
  const runtime: ClientRuntime = {
    source: {
      load: async () => {
        recorded.loads.push(recorded.loads.length + 1);
        return current;
      },
    },
    settings,
    elevation: {
      run: async (request: ForwardWriteRequest) => {
        recorded.elevation.push(request);
        return { status: 'ok', message: '已应用', steps: [{ name: 'portproxy-add', ok: true, stderr: '' }] };
      },
    },
    exec: undefined,
  };
  return {
    runtime,
    recorded,
    push: (next) => {
      current = next;
    },
  };
}
