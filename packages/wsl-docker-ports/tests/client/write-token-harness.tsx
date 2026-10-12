// @vitest-environment jsdom
/**
 * 凭据块（`pane-settings.tsx` 的 `WRITE_TOKEN_TESTID` 区块）测试的**共用台架**
 * —— 2026-10-12 009 收口轮从 `write-token-pane.test.tsx` 拆出
 * （拆前该文件 `split('\n')` = **480**，超「单文件 ≤ 400 行 SHALL」）
 *
 * 🔴 **本文件不是测试文件**（不含 `describe` / `it`，文件名也不匹配 `*.test.ts(x)`）⇒
 * `vitest run` 不会收集它，**用例数一条不变**。
 *
 * 拆的切面 = **「怎么造一个假宿主」vs「断言什么」**：
 * 这里只放「确定性随机源 + 假存储 + 照宿主脱敏口径的假 `remote.settings` + 挂载/读状态」；
 * 断言分两处 —— 生成/一次性显示/布尔态/`console`/失败路径在 `write-token-pane.test.tsx`，
 * 清除（T3）在 `write-token-clear.test.tsx`。
 */

import { cleanup, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import type { ClientRuntime, RemoteSettingsLike, SettingsResponse } from '../../src/client/host.ts';
import { PortsPane } from '../../src/client/pane.tsx';
import { WRITE_TOKEN_TESTID } from '../../src/client/pane-settings.tsx';
import { createSettingsPipe, SETTINGS_NAMESPACE } from '../../src/client/settings-pipe.ts';
import { createWriteChannel, type WriteWiring } from '../../src/client/write-channel.ts';
import { bytesToHex, createWriteTokenStore, WRITE_TOKEN_BYTES, WRITE_TOKEN_STORAGE_KEY, type StorageLike } from '../../src/client/write-token.ts';
import { snapshot } from '../unit/client-fixtures.ts';
export const BYTES = Uint8Array.from({ length: WRITE_TOKEN_BYTES }, (_, index) => index);
/** 确定性随机源给出的那一串（32 字节 → 64 位小写 hex） */
export const EXPECTED_TOKEN = bytesToHex(BYTES);
/** 「看起来像凭据」的形状（32+ 连续 hex）—— 判据 ③/② 用它扫整棵 DOM */
export const TOKEN_SHAPE = /[0-9a-f]{32,}/u;
export const ONCE_HINT = '离开后将不再显示，请立即复制';

/** 确定性随机源（两个测试文件各自在 `beforeEach` 里调一次） */
export function stubRandom(): void {
  vi.stubGlobal('crypto', {
    getRandomValues: (box: Uint8Array): Uint8Array => {
      for (let index = 0; index < box.length; index += 1) box[index] = BYTES[index % BYTES.length] ?? 0;
      return box;
    },
  });
}

/** 清 DOM + 卸桩（两个测试文件各自在 `afterEach` 里调一次） */
export function resetDom(): void {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

export interface StorageRig extends StorageLike {
  readonly box: Map<string, string>;
}

export function storageRig(seed?: string): StorageRig {
  const box = new Map<string, string>();
  if (seed !== undefined) box.set(WRITE_TOKEN_STORAGE_KEY, seed);
  return {
    box,
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => {
      box.set(key, value);
    },
    removeItem: (key) => {
      box.delete(key);
    },
  };
}

export interface Recorded {
  updates: { readonly ns: string; readonly patch: Record<string, unknown> }[];
  /**
   * T3（2026-10-12 009 收口轮）新增：清除凭据走宿主 `mutate` 的 `unset`，**不再**走 `update` 写空串。
   * 与 `updates` **分开数** —— 两个口径不混（`updateCount()` 也只数 `update`）。
   */
  mutates: { readonly ns: string; readonly ops: readonly { op: string; path: readonly string[] }[]; readonly revision: unknown; readonly argCount: number }[];
  describes: number;
}

export interface Harness {
  readonly runtime: ClientRuntime;
  readonly recorded: Recorded;
  readonly storage: StorageRig;
  /** 假宿主的**当前**配置（T3：`mutate` 会真的改它 ⇒ 重挂载后的读是真读，不是内存推断） */
  readonly config: Record<string, unknown>;
}

/**
 * 注入式 runtime：唯一的外部输入是假 `remote.settings` + 假存储。
 * 通道的 `fetchImpl` **故意抛错** ⇒ 本文件里任何一次真请求都会立刻炸掉用例。
 *
 * 🔴 T3 起这个假宿主**照着宿主的脱敏口径**来：
 * ① `describe()` 的 `value` 里**没有** `writeToken`（宿主 `redactSecrets: true`），只给
 *    `secrets: [{path:['writeToken'], set}]`；② `mutate` 的 `unset` 把键**真的删掉**（同宿主 `applyPathOp`），
 * ③ `mutate` 的返回值 = **写入后重新 describe 的视图**（同 `dsh-api-settings-controller` 的 `namespaceView`）。
 */
export function harness(options: { readonly config?: Record<string, unknown>; readonly seed?: string; readonly updateFails?: string; readonly mutateFails?: string } = {}): Harness {
  const recorded: Recorded = { updates: [], mutates: [], describes: 0 };
  const config: Record<string, unknown> = { ...(options.config ?? {}) };
  /** 脱敏后的命名空间值（凭据字段一律不进 `value`） */
  const redacted = (): Record<string, unknown> => {
    const copy = { ...config };
    delete copy['writeToken'];
    return copy;
  };
  const secrets = (): { path: string[]; set: boolean }[] => [{ path: ['writeToken'], set: config['writeToken'] !== undefined }];
  const view = (ns: string): SettingsResponse => ({
    ok: true,
    value: { revision: 3, namespaces: [{ ns, value: redacted(), secrets: secrets() }] },
  });
  const remote: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => {
      recorded.describes += 1;
      return view(SETTINGS_NAMESPACE);
    },
    update: async (ns: string, patch: unknown): Promise<SettingsResponse> => {
      recorded.updates.push({ ns, patch: patch as Record<string, unknown> });
      if (options.updateFails !== undefined) return { ok: false, error: options.updateFails };
      Object.assign(config, patch);
      return view(ns);
    },
    // 用 rest 参数数**真实实参个数**（宿主 `prepareInvocation` 数的就是 `values.length`）
    mutate: async (...args: unknown[]): Promise<SettingsResponse> => {
      const [ns, ops, revision] = args as [string, readonly { op: string; path: readonly string[] }[], unknown];
      recorded.mutates.push({ ns, ops, revision, argCount: args.length });
      if (args.length !== 3) throw new Error(`client api: settings/mutate expected 3 argument(s), got ${String(args.length)}`);
      if (options.mutateFails !== undefined) return { ok: false, error: options.mutateFails };
      for (const op of ops) {
        if (op.op === 'unset' && op.path.length === 1) delete config[op.path[0] ?? ''];
      }
      return view(ns);
    },
  };
  const storage = storageRig(options.seed);
  const tokenStore = createWriteTokenStore(storage);
  const channel = createWriteChannel({
    token: () => tokenStore.read(),
    fetchImpl: async () => {
      throw new Error('本文件不该发任何写通道请求（fetchImpl 故意抛错）');
    },
  });
  const wiring: WriteWiring = { channel, tokenStore, declaration: async () => ({ ok: true, ports: [] }) };
  return {
    recorded,
    config,
    storage,
    runtime: {
      source: { load: async () => snapshot({}) },
      settings: createSettingsPipe(() => remote),
      elevation: undefined,
      exec: undefined,
      write: wiring,
    },
  };
}

/** 渲染整页并等凭据块出现（凭据块的挂载本身**零 IPC**：T5.1 的门保持不变） */
export async function mountPane(runtime: ClientRuntime): Promise<HTMLElement> {
  const { container } = render(<PortsPane runtime={runtime} />);
  await screen.findByTestId(WRITE_TOKEN_TESTID.block);
  return container;
}

export function stateText(): string {
  return screen.getByTestId(WRITE_TOKEN_TESTID.state).textContent ?? '';
}
