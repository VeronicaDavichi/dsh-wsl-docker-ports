/**
 * Phase 4（002 T4.1–T4.3）客户端半的**假宿主**：捕获式 `ctx` + 假 xterm 三件套。
 *
 * 零真机、零 DOM（`jsdom` 由具体用例按需声明）：`sidebarRightTabs` / `sidebarRight` / `slots` / `effect`
 * 全部是记账替身，`@xterm/xterm` / `@xterm/addon-fit` / `ResizeObserver` 全部注入假类
 * ⇒ 「注册了几次」「fit 了几次」「卸载后剩几个监听/定时器」都是可二值断言的数字。
 */

import type {
  ClientContextLike,
  SeatRegistrationLike,
  SidebarRightTabDefinitionLike,
  SlotRegistryLike,
} from '../../src/client/tab.ts';
import type {
  ResizeObserverLike,
  XtermBodyDeps,
  XtermFitAddonLike,
  XtermTerminalLike,
  XtermTerminalOptionsLike,
} from '../../src/client/xterm-body.tsx';

export interface ClientCtxCalls {
  /** 每次 `ctx.inject(...)` 请求的服务名 */
  readonly services: string[][];
  readonly tabDefinitions: SidebarRightTabDefinitionLike[];
  readonly seats: SeatRegistrationLike[];
  readonly seatComponents: unknown[];
  readonly slotInjects: string[];
  readonly effectLabels: string[];
  /** 计数器（可写：替身内部要累加） */
  tabDisposals: number;
  slotInjectDisposals: number;
  seatDisposals: number;
}

/** `ClientContextLike` 的成员都是 readonly ⇒ 装配期用一个可写镜像类型（`exactOptionalPropertyTypes` 友好） */
interface MutableClientContext {
  slots?: SlotRegistryLike;
  sidebarRightTabs?: ClientContextLike['sidebarRightTabs'];
  sidebarRight?: ClientContextLike['sidebarRight'];
  effect?: ClientContextLike['effect'];
  inject?: ClientContextLike['inject'];
  get?: ClientContextLike['get'];
}

export interface ClientCtxOptions {
  readonly slots?: boolean;
  readonly sidebarRightTabs?: boolean;
  readonly sidebarRight?: boolean;
  /**
   * `true`（缺省）= 宿主有 `inject` 且**当场**跑回调（服务已在）；
   * `'deferred'` = 宿主有 `inject` 但回调**留到 `fireInject()`**（真机缺陷 C 的时序：服务后到）；
   * `false` = 宿主没有 `inject`（老版本 / 测试替身）⇒ 走直接注册降级路径。
   */
  readonly inject?: boolean | 'deferred';
  /** 缺省 true；false = 宿主没有 `effect` ⇒ 注册动作就地执行（无自动清理） */
  readonly effect?: boolean;
  /**
   * 缺省 false；true = 三个宿主服务**只**能从 `scope.get('<名字>')` 读到（注入作用域上没有同名属性）
   * —— 官方调用点里两种写法都出现过，只认一种会让「服务其实在、页面却不出现」。
   */
  readonly servicesViaGet?: boolean;
  /** 第 N 个（1 起算）seat 的 `register` 抛错（验回滚） */
  readonly failSeatAt?: number;
  /** 页类型重复注册 ⇒ 宿主抛错（`sidebarRightTabs.register` 的真实行为） */
  readonly duplicateTabId?: boolean;
  /** `slots.inject` / `slots.register` 是否返回清理器（真实宿主两个都可能返回） */
  readonly injectReturnsDisposer?: boolean;
  readonly registerReturnsDisposer?: boolean;
}

export interface ClientCtxHarness {
  readonly ctx: ClientContextLike;
  /** `ctx.inject` 回调收到的 scope（宿主服务齐全的那个子 ctx） */
  readonly scope: ClientContextLike;
  readonly calls: ClientCtxCalls;
  /** 已登记但**尚未**跑过的注入回调数（真机时序：服务后到 ⇒ 这个数 > 0） */
  injectPending(): number;
  /** 触发已登记的注入回调（=「宿主服务到位」那一下） */
  fireInject(): void;
  /** 模拟宿主卸载：按 cordis 的逆序跑已收编的 effect */
  unload(): void;
}

export function createClientCtx(options: ClientCtxOptions = {}): ClientCtxHarness {
  const calls: ClientCtxCalls = {
    services: [],
    tabDefinitions: [],
    seats: [],
    seatComponents: [],
    slotInjects: [],
    effectLabels: [],
    tabDisposals: 0,
    slotInjectDisposals: 0,
    seatDisposals: 0,
  };
  const collected: Array<() => void> = [];

  const slots: SlotRegistryLike = {
    inject(name, callback) {
      calls.slotInjects.push(name);
      const inner = callback();
      const disposer = (): void => {
        calls.slotInjectDisposals += 1;
        if (typeof inner === 'function') inner();
      };
      return options.injectReturnsDisposer === false ? undefined : disposer;
    },
    register(seat, component) {
      calls.seats.push({ name: seat.name, key: seat.key });
      calls.seatComponents.push(component);
      if (options.failSeatAt !== undefined && calls.seats.length === options.failSeatAt) {
        throw new Error(`slot register refused #${calls.seats.length}`);
      }
      const disposer = (): void => {
        calls.seatDisposals += 1;
      };
      return options.registerReturnsDisposer === false ? undefined : disposer;
    },
  };

  const effect = (callback: () => void | (() => void), label?: string): unknown => {
    calls.effectLabels.push(label ?? '(no label)');
    const dispose = callback();
    if (typeof dispose === 'function') collected.push(dispose);
    return dispose;
  };

  const sidebarRightTabs = {
    register(definition: SidebarRightTabDefinitionLike): () => void {
      if (options.duplicateTabId === true || calls.tabDefinitions.length > 0) {
        throw new Error(`duplicate tab id: ${definition.id}`);
      }
      calls.tabDefinitions.push(definition);
      return () => {
        calls.tabDisposals += 1;
      };
    },
  };

  // 逐个按开关装配服务（`exactOptionalPropertyTypes` 下不能先造出来再 delete）
  const shared: MutableClientContext = {};
  const serviceByName: Record<string, unknown> = {};
  if (options.slots !== false) serviceByName['slots'] = slots;
  if (options.sidebarRightTabs !== false) serviceByName['sidebarRightTabs'] = sidebarRightTabs;
  if (options.sidebarRight !== false) serviceByName['sidebarRight'] = { openTab: () => undefined };
  if (options.servicesViaGet === true) {
    // 只经 `ctx.get('<名字>')` 可读（注入作用域上**没有**同名属性）—— 官方另一种调用点的形状
    shared.get = (name: string) => serviceByName[name];
  } else {
    if (options.slots !== false) shared.slots = slots;
    if (options.sidebarRightTabs !== false) shared.sidebarRightTabs = sidebarRightTabs;
    if (options.sidebarRight !== false) {
      shared.sidebarRight = serviceByName['sidebarRight'] as ClientContextLike['sidebarRight'];
    }
  }
  if (options.effect !== false) shared.effect = effect;
  const scope: ClientContextLike = { ...shared };
  /** 已登记、尚未触发的注入回调（真机时序：服务后到 ⇒ 这里会攒着） */
  const pendingInject: Array<() => void> = [];
  if (options.inject !== false) {
    shared.inject = (services, callback) => {
      calls.services.push([...services]);
      const fire = (): void => callback(scope);
      if (options.inject === 'deferred') {
        pendingInject.push(fire);
        return undefined;
      }
      return fire();
    };
  }
  const ctx: ClientContextLike = { ...shared };

  return {
    ctx,
    scope,
    calls,
    injectPending: () => pendingInject.length,
    fireInject: () => {
      for (const fire of pendingInject.splice(0, pendingInject.length)) fire();
    },
    unload: () => runAll(collected),
  };
}

function runAll(disposers: Array<() => void>): void {
  for (const dispose of disposers.splice(0, disposers.length).reverse()) dispose();
}

/* ────────────────────────── 假 xterm ────────────────────────── */

export interface FakeTerminal extends XtermTerminalLike {
  readonly options: XtermTerminalOptionsLike;
  readonly openedContainers: HTMLElement[];
  readonly addons: unknown[];
  readonly handlers: Array<(data: string) => void>;
  disposed: number;
  rows: number;
  cols: number;
  emit(data: string): void;
}

export interface FakeFitAddon extends XtermFitAddonLike {
  fitted: number;
  /** `fit()` 后生效的尺寸（模拟真 xterm 依据容器算出新行列数） */
  nextSize: { rows: number; cols: number };
}

export interface FakeResizeObserver extends ResizeObserverLike {
  readonly targets: Element[];
  disconnected: number;
}

export interface FakeXtermEnvironment {
  readonly deps: XtermBodyDeps;
  readonly terminals: FakeTerminal[];
  readonly fitAddons: FakeFitAddon[];
  readonly observers: FakeResizeObserver[];
  observeCalls(): number;
  /** 让随后的 `fit()` 生效成给定尺寸（模拟容器变化） */
  setNextSize(rows: number, cols: number): void;
  /** 触发容器 resize（observers 的 callback） */
  triggerResize(): void;
}

export function createFakeXtermEnvironment(options: { readonly withResizeObserver?: boolean } = {}): FakeXtermEnvironment {
  const terminals: FakeTerminal[] = [];
  const fitAddons: FakeFitAddon[] = [];
  const observers: FakeResizeObserver[] = [];
  const observerCallbacks: Array<() => void> = [];
  let observeCalls = 0;

  const deps: XtermBodyDeps = {
    createTerminal: (terminalOptions: XtermTerminalOptionsLike) => {
      const terminal: FakeTerminal = {
        rows: 24,
        cols: 80,
        options: terminalOptions,
        openedContainers: [],
        addons: [],
        handlers: [],
        disposed: 0,
        open(container) {
          terminal.openedContainers.push(container);
        },
        loadAddon(addon) {
          terminal.addons.push(addon);
        },
        onData(handler) {
          terminal.handlers.push(handler);
          return {
            dispose: () => {
              const index = terminal.handlers.indexOf(handler);
              if (index >= 0) terminal.handlers.splice(index, 1);
            },
          };
        },
        dispose() {
          terminal.disposed += 1;
        },
        emit(data) {
          for (const handler of [...terminal.handlers]) handler(data);
        },
      };
      terminals.push(terminal);
      return terminal;
    },
    createFitAddon: () => {
      const addon: FakeFitAddon = {
        fitted: 0,
        nextSize: { rows: 24, cols: 80 },
        fit() {
          addon.fitted += 1;
          const target = terminals[terminals.length - 1];
          if (target !== undefined) {
            target.rows = addon.nextSize.rows;
            target.cols = addon.nextSize.cols;
          }
        },
      };
      fitAddons.push(addon);
      return addon;
    },
  };

  const withObserver: XtermBodyDeps =
    options.withResizeObserver === false
      ? deps
      : {
          ...deps,
          createResizeObserver: (callback) => {
            observerCallbacks.push(callback);
            const observer: FakeResizeObserver = {
              targets: [],
              disconnected: 0,
              observe(target) {
                observeCalls += 1;
                observer.targets.push(target);
              },
              disconnect() {
                observer.disconnected += 1;
              },
            };
            observers.push(observer);
            return observer;
          },
        };

  return {
    deps: withObserver,
    terminals,
    fitAddons,
    observers,
    observeCalls: () => observeCalls,
    setNextSize(rows, cols) {
      for (const addon of fitAddons) addon.nextSize = { rows, cols };
    },
    triggerResize() {
      for (const callback of [...observerCallbacks]) callback();
    },
  };
}
