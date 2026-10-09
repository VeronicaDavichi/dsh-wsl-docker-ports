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
    async update(ns, patch, expectedRevision) {
      service.calls.updates.push({ ns, patch, expectedRevision });
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
