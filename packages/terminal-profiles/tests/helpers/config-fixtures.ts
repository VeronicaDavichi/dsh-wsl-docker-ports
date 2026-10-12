/**
 * Phase 6（002 T6.1–T6.4）的**假宿主**：`remote.settings` 写回管道、`settings` 表单服务、配置页假管道。
 *
 * 零真机、零 DOM：`describe()` / `update()` 的**实参逐个记下来**，所以「写回命名空间对不对」
 * 「revision 有没有带」「只读时有没有真的不写」都是可二值断言的数字，而不是「看起来没问题」。
 */

import type {
  ConfigPipe,
  ConfigReadOutcome,
  RemoteSettingsLike,
  SaveOutcome,
  SettingsResponse,
} from '../../src/client/config-pipe.ts';
import type { ClientContextLike, SlotRegistryLike } from '../../src/client/tab.ts';

/* ────────────────────────── remote.settings ────────────────────────── */

export interface SettingsUpdateCall {
  readonly ns: string;
  readonly patch: unknown;
  readonly expectedRevision: unknown;
  /**
   * `update` 的**真实实参个数**（009 收口轮 T4 补）。
   *
   * 🔴 必须用 rest 参数数「实参个数」而不是看键在不在：宿主 `prepareInvocation` 校验的是
   * `values.length`（真机原话 `client api: settings/update expected 3 argument(s), got 2`），
   * 而「传了 undefined」与「只传两参」在 JS 里靠 `expectedRevision === undefined` **区分不出来**。
   */
  readonly argCount: number;
}

export interface FakeRemoteSettings extends RemoteSettingsLike {
  readonly calls: { describes: number; updates: SettingsUpdateCall[] };
  /** describe 的返回（函数形态可逐次变化）；缺省 = 空 namespaces */
  describeResult: SettingsResponse | (() => Promise<SettingsResponse>);
  /** update 的返回（函数形态可逐次变化）；缺省 = ok */
  updateResult: SettingsResponse | ((ns: string, patch: unknown, revision: unknown) => Promise<SettingsResponse>);
  describeThrows: unknown;
  updateThrows: unknown;
}

export function createFakeRemoteSettings(options: {
  readonly describe?: SettingsResponse | (() => Promise<SettingsResponse>) | undefined;
  readonly update?: SettingsResponse | ((ns: string, patch: unknown, revision: unknown) => Promise<SettingsResponse>) | undefined;
  readonly describeThrows?: unknown;
  readonly updateThrows?: unknown;
  /**
   * 「宿主按**实参个数**校验」的假件（009 收口轮 T4 用）：给了 N ⇒ 实参个数 !== N 时当场抛
   * `client api: settings/update expected N argument(s), got M`（与真机那句逐字同形）。
   * 🔴 校验必须住在 `update` **本体**里（不是 `updateResult` 里）—— 后者被本假件用固定 3 参调用，
   * 在那里数 `arguments.length` **永远**是 3，等于测不到调用方的写法。
   */
  readonly strictArgCount?: number | undefined;
} = {}): FakeRemoteSettings {
  const service: FakeRemoteSettings = {
    calls: { describes: 0, updates: [] },
    describeResult: options.describe ?? { ok: true, value: { namespaces: [] } },
    updateResult: options.update ?? { ok: true, value: {} },
    describeThrows: options.describeThrows,
    updateThrows: options.updateThrows,
    async describe() {
      service.calls.describes += 1;
      if (service.describeThrows !== undefined) throw service.describeThrows;
      const result = service.describeResult;
      return typeof result === 'function' ? await result() : result;
    },
    async update(...args: unknown[]) {
      const ns = String(args[0]);
      const patch = args[1];
      const expectedRevision = args[2];
      service.calls.updates.push({ ns, patch, expectedRevision, argCount: args.length });
      if (options.strictArgCount !== undefined && args.length !== options.strictArgCount) {
        throw new Error(`client api: settings/update expected ${String(options.strictArgCount)} argument(s), got ${String(args.length)}`);
      }
      if (service.updateThrows !== undefined) throw service.updateThrows;
      const result = service.updateResult;
      return typeof result === 'function' ? await result(ns, patch, expectedRevision) : result;
    },
  };
  return service;
}

/** 造一个「本包命名空间存在 + 可写」的 describe 返回（测试里只改关心的那一段） */
export function describeWith(
  namespace: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): SettingsResponse {
  return { ok: true, value: { namespaces: [{ ns: 'dsh-terminal-profiles', ...namespace }], ...extra } };
}

/* ────────────────────────── settings 表单服务 ────────────────────────── */

export interface FakeSettingsForm {
  readonly names: string[];
  readonly calls: Array<{ readonly options: unknown; readonly fiber: unknown; readonly argCount: number }>;
  configure(options: unknown, fiber?: unknown): unknown;
}

export function createFakeSettingsForm(options: { readonly throws?: unknown } = {}): FakeSettingsForm {
  const calls: FakeSettingsForm['calls'] = [];
  return {
    names: ['configure'],
    calls,
    configure(given, fiber) {
      calls.push({ options: given, fiber, argCount: arguments.length });
      if (options.throws !== undefined) throw options.throws;
      return undefined;
    },
  };
}

/* ────────────────────────── 配置页用的假 ctx ────────────────────────── */

export interface ConfigCtxOptions {
  readonly slots?: boolean;
  readonly inject?: boolean;
  readonly effect?: boolean;
  readonly get?: boolean;
  readonly fiber?: boolean;
  readonly settings?: boolean;
  /** 惰性 `inject`：回调**不**同步跑（模拟「服务晚到」） */
  readonly lazyInject?: boolean;
  /** `slots.register` 抛错（验降级） */
  readonly registerThrows?: unknown;
}

export interface ConfigCtxHarness {
  readonly ctx: ClientContextLike;
  readonly calls: {
    readonly services: string[][];
    readonly seats: Array<{ name: string; key: string; component: unknown }>;
    readonly slotInjects: string[];
    readonly effectLabels: string[];
    seatDisposals: number;
  };
  readonly settingsForm: FakeSettingsForm;
  readonly remote: FakeRemoteSettings;
  unload(): void;
}

export function createConfigCtx(options: ConfigCtxOptions = {}): ConfigCtxHarness {
  const calls: ConfigCtxHarness['calls'] = {
    services: [],
    seats: [],
    slotInjects: [],
    effectLabels: [],
    seatDisposals: 0,
  };
  const collected: Array<() => void> = [];
  const settingsForm = createFakeSettingsForm();
  const remote = createFakeRemoteSettings();

  const slots: SlotRegistryLike = {
    inject(name, callback) {
      calls.slotInjects.push(name);
      const inner = callback();
      return () => {
        calls.seatDisposals += 1;
        if (typeof inner === 'function') inner();
      };
    },
    register(seat, component) {
      calls.seats.push({ name: seat.name, key: seat.key, component });
      if (options.registerThrows !== undefined) throw options.registerThrows;
      return () => {
        calls.seatDisposals += 1;
      };
    },
  };

  const effect = (callback: () => void | (() => void), label?: string): unknown => {
    calls.effectLabels.push(label ?? '(no label)');
    const dispose = callback();
    if (typeof dispose === 'function') collected.push(dispose);
    return dispose;
  };

  const get = (name: string): unknown => {
    if (name === 'settings') return settingsForm;
    if (name === 'remote.settings') return remote;
    return undefined;
  };

  const shared: {
    slots?: SlotRegistryLike;
    effect?: ClientContextLike['effect'];
    get?: ClientContextLike['get'];
    inject?: ClientContextLike['inject'];
    fiber?: unknown;
    settings?: unknown;
  } = {};
  if (options.slots !== false) shared.slots = slots;
  if (options.effect !== false) shared.effect = effect;
  if (options.get !== false) shared.get = get;
  if (options.settings !== false) shared.settings = settingsForm;
  if (options.fiber !== false) shared.fiber = { marker: 'fiber' };

  const scope: ClientContextLike = { ...shared };
  if (options.inject !== false) {
    shared.inject = (services, callback) => {
      calls.services.push([...services]);
      if (options.lazyInject === true) return undefined;
      return callback(scope);
    };
  }
  const ctx: ClientContextLike = { ...shared };

  return {
    ctx,
    calls,
    settingsForm,
    remote,
    unload: () => {
      for (const dispose of collected.splice(0, collected.length).reverse()) dispose();
    },
  };
}

/* ────────────────────────── 页面用的假管道 ────────────────────────── */

export interface FakeConfigPipe extends ConfigPipe {
  readonly calls: {
    reads: number;
    readonly saves: Array<{ readonly rows: readonly unknown[]; readonly revision: unknown }>;
  };
}

export function createFakeConfigPipe(options: {
  readonly read?: ConfigReadOutcome | (() => Promise<ConfigReadOutcome>) | undefined;
  readonly save?: SaveOutcome | ((rows: readonly unknown[], revision?: unknown) => Promise<SaveOutcome>) | undefined;
} = {}): FakeConfigPipe {
  const calls: FakeConfigPipe['calls'] = { reads: 0, saves: [] };
  const readResult: ConfigReadOutcome | (() => Promise<ConfigReadOutcome>) =
    options.read ?? {
      kind: 'ok',
      state: { readOnly: undefined, addressability: undefined, rows: [], revision: 1, rawFound: true },
    };
  return {
    calls,
    async readConfig() {
      calls.reads += 1;
      return typeof readResult === 'function' ? await readResult() : readResult;
    },
    async saveProfiles(rows, expectedRevision) {
      calls.saves.push({ rows, revision: expectedRevision });
      const result = options.save ?? { kind: 'ok', saved: rows.length, skipped: [], revisionPassed: expectedRevision !== undefined };
      return typeof result === 'function' ? await result(rows, expectedRevision) : result;
    },
    updateCount: () => calls.saves.length,
  };
}

/* ────────────────── 007 只读态的真机载荷夹具（2026-10-12 自动触发轮；从用例文件搬来共用） ────────────────── */

/** 真机拒绝原文（`dsh-config-editor/lib/index.js:122` 的模板串，真机实测同一句） */
export const HOST_REFUSAL =
  'Configuration for "dsh-terminal-profiles" is overridden by a home patch or command-line overlay';

/** 宿主被拒时的线上错误形态（`settings/rejected`；`dsh-api-settings-controller/lib/index.js:500-508` 保留 message） */
export const REFUSAL_RESPONSE: SettingsResponse = {
  ok: false,
  error: { code: 'settings/rejected', message: HOST_REFUSAL, details: { ns: 'dsh-terminal-profiles' } },
};

/**
 * 本包 schema 的三段 refs —— **逐字**取自真机载荷（uid 每次启动不同，这里用 B2 的取值）。
 * ⚠️ 三段都要给：少了 `…8`（`meta.default: []`）这条，判据里「差异能否由 schema 默认值解释」
 * 就失去输入 ⇒ 用例会在**错误的理由**上通过。
 */
export const OVERLAY_REFS = {
  '5017': { type: 'any', meta: {} },
  '5018': { type: 'array', meta: { default: [] }, inner: 5017 },
  '5019': { type: 'object', meta: { default: {} }, dict: { profiles: 5018 } },
};

/**
 * 真机载荷 **B2**（`--patch` 覆盖层生效）里 `dsh-terminal-profiles` 那一条，逐字照抄。
 * 出处：`B2-remote-settings-describe-with-overlay.raw.json`（34521 B / sha256 `BE00EE3D…`）的 `result`。
 */
export const REAL_OVERLAY_DESCRIBE: SettingsResponse = {
  ok: true,
  value: {
    writable: true,
    hasDocument: true,
    namespaces: [
      {
        ns: 'dsh-terminal-profiles',
        autoGenerate: true,
        schema: { uid: 5019, refs: OVERLAY_REFS },
        value: { profiles: [{ name: 'overlay-row', command: 'pwsh' }] },
        base: { profiles: [] },
        user: { profiles: [] },
        applies: 'live',
        secrets: [],
        revision: 0,
      },
    ],
  },
};

/**
 * 真机载荷 **B1**（**无**覆盖层；`user` 为空、`value == base == {profiles: []}`），逐字照抄。
 * 出处：`B1-remote-settings-describe.raw.json`（35198 B / sha256 `BD802FDA…`）的 `result`。
 * 两份载荷的差别**只有** `user`/`value` 两个值（结构完全同形）⇒ 是判据的**正样本**（不许锁）。
 */
export const REAL_WRITABLE_DESCRIBE: SettingsResponse = {
  ok: true,
  value: {
    writable: true,
    hasDocument: true,
    namespaces: [
      {
        ns: 'dsh-terminal-profiles',
        autoGenerate: true,
        schema: {
          uid: 15235,
          refs: {
            '15233': { type: 'any', meta: {} },
            '15234': { type: 'array', meta: { default: [] }, inner: 15233 },
            '15235': { type: 'object', meta: { default: {} }, dict: { profiles: 15234 } },
          },
        },
        value: { profiles: [] },
        base: { profiles: [] },
        user: {},
        applies: 'live',
        secrets: [],
        revision: 0,
      },
    ],
  },
};

/** 取一份载荷里本命名空间那条（构造变体用；变体都**只改一个字段**，出处写在用例名里） */
export function nsEntry(response: SettingsResponse): Record<string, unknown> {
  const value = response.value as { namespaces: Record<string, unknown>[] };
  const entry = value.namespaces.find((row) => row['ns'] === 'dsh-terminal-profiles');
  if (entry === undefined) throw new Error('夹具里必须有本包命名空间');
  return entry;
}

/** 用一份改过的条目造载荷（其余逐字沿用真机夹具 ⇒ 变体的出处 = 它派生自哪份真机载荷） */
export function withEntry(
  patch: Record<string, unknown>,
  base: SettingsResponse = REAL_WRITABLE_DESCRIBE,
): SettingsResponse {
  return { ok: true, value: { ...(base.value as object), namespaces: [{ ...nsEntry(base), ...patch }] } };
}
