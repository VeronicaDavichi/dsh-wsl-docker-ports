/**
 * 右栏页类型与两个 keyed seat（002 T4.1 / REQ-4.1 / REQ-4.2 / REQ-4.4 / REQ-4.5）
 *
 * 📌 **契约来源 = 实物**（逐行证据见 `client-contract.md` §C9/C10 + §P1/P5，本文件只照抄、不重新设计）：
 *   - 注册面 = `ctx.inject(['sidebarRightTabs','sidebarRight'], scope => scope.sidebarRightTabs.register(def))`；
 *   - `register` 返回**幂等 disposer**，且**必须**由 `ctx.effect` 收编（宿主不自动回收 → 漏收编会残留注册、
 *     再次挂载时因重复 `id` 直接抛错）；
 *   - `priority` **留空** = 宿主默认的 `extension` 档（官方 `terminal` 页自己用 `builtin`，第三方不得抢）；
 *   - `id` 用**包名**（本包行 id == 包名 == `dsh-terminal-profiles`），两个 seat 的 `key` 就是 `definition.id`；
 *   - seat 的注册**必须**包在 `slots.inject(<槽位名>, () => slots.register({name,key}, Comp))` 里
 *     —— 官方首方调用点 `dsh-leanspec/src/client/tab-registration.ts:288-299` 就是这个形状；
 *   - **同 band 重复注册、或 `id` 重复 ⇒ 宿主抛错** ⇒ 本层**故意不吞**这个异常（吞掉等于把接线错误
 *     变成「页面静默不出现」，而 §C9 的原文就是 *"a wiring mistake"*）。
 *
 * ⚠️ **类型面是自带的窄接口**：宿主 `@deepseek-ai/*` 在本机是**悬空 junction**（读不到 d.ts，`app.asar` 禁读）
 * ⇒ 不 import 官方包，只按 §C9/C10 的签名原文声明够用的结构面（与 Phase 1/2 的 `PluginContextLike` 同一手法）。
 * 本文件**零 DOM、零 React**：`buildTabDefinition` / `buildSeatRegistrations` 是纯函数（可无 DOM 单测）。
 */

/** 页类型 kind。⚠️ **不得**与官方已占用的 kind 重名（尤其不得复用官方 `terminal`） */
export const MANAGED_TERMINAL_KIND = 'managedTerminal';

/** 页类型 `id` 与两个 seat 的 `key`（都取包名 —— patch 行 id == 包名 == 本值，无歧义） */
export const TERMINAL_TAB_ID = 'dsh-terminal-profiles';

/** 页体 seat 的槽位名（keyed） */
export const TERMINAL_PANE_SLOT = 'sidebar.right.pane.tab';

/** 标题 seat 的槽位名（keyed） */
export const TERMINAL_TITLE_SLOT = 'sidebar.right.pane.tab.title';

/** 页标题文案（`definition.title` 与标题 seat 共用同一常量，避免两处漂移） */
export const TERMINAL_TAB_TITLE = '受管终端';

/** 注册前必须同时到位的**两个**服务（缺任一 ⇒ 降级不注册，见 REQ-4.5） */
export const TERMINAL_TAB_SERVICES = ['sidebarRightTabs', 'sidebarRight'] as const;

/**
 * 官方 `0.1.7-rc.2` 已占用的 **9 个** kind（`client-contract.md` §P1 逐个带出处）。
 * 保留在此是为了让「不与官方重名」这条判据**可二值断言**（并附官方 `terminal` 与我们的差异）。
 */
export const OFFICIAL_TAB_KINDS = [
  'guide',
  'files',
  'browser',
  'text',
  'changes-review',
  'terminal',
  'scheduleTask',
  'plan',
  'subagentchat',
] as const;

/** `SidebarRightTabDefinition` 的窄接口（§C9 原文：`id`/`kind` 必填，`title` 是函数） */
export interface SidebarRightTabDefinitionLike {
  readonly id: string;
  readonly kind: string;
  readonly multiple: boolean;
  readonly keepMounted: boolean;
  readonly title: (address: string) => string;
}

/** 槽位注册的 options（keyed 槽：`name` + `key`） */
export interface SeatRegistrationLike {
  readonly name: string;
  readonly key: string;
}

/** `ctx.slots` 的窄接口（§C10：`register` 是 **(`options`, `Component`) 两个位置参数**，返回 disposer） */
export interface SlotRegistryLike {
  inject(name: string, callback: () => unknown): (() => void) | void;
  register(options: SeatRegistrationLike, component: unknown): (() => void) | void;
}

/** `ctx.sidebarRightTabs` 的窄接口（§C9） */
export interface SidebarRightTabsLike {
  register(definition: SidebarRightTabDefinitionLike): (() => void) | void;
}

/** `ctx.sidebarRight` 的窄接口（`dsh-leanspec` 的真实调用点要的是 `openTab`） */
export interface SidebarRightLike {
  openTab(address: string): unknown;
}

/**
 * 客户端 `ctx` 的窄接口（**只声明本文件用到的东西**；`@deepseek-ai/cordis` 的 `Context` 结构上满足它，
 * 编译期证据见 `tests/unit/client-entry.test.ts` 的「类型级证据」用例）。
 */
export interface ClientContextLike {
  readonly slots?: SlotRegistryLike | undefined;
  readonly sidebarRightTabs?: SidebarRightTabsLike | undefined;
  readonly sidebarRight?: SidebarRightLike | undefined;
  readonly inject?: ((services: readonly string[], callback: (scope: ClientContextLike) => void) => unknown) | undefined;
  readonly effect?: ((callback: () => void | (() => void), label?: string) => unknown) | undefined;
  /**
   * 软取服务（**非严格**：缺服务返回 `undefined`，我们自己降级）。
   * 配置页写回用 `get('remote.settings')`（contract §D13），`configure({ auto: false })` 用
   * `inject(['settings'], child => child.get('settings'))`（REQ-10.1）—— 两者都走这里。
   */
  readonly get?: ((name: string) => unknown) | undefined;
  /** cordis fiber（`configure({ auto: false }, ctx.fiber)` 的第二参；缺省不传，见 config-slot） */
  readonly fiber?: unknown;
}

/** seat 注册用的两个组件（由入口注入 ⇒ 本文件保持无 React 依赖） */
export interface TerminalTabComponents {
  readonly pane: unknown;
  readonly title: unknown;
}

export interface TabRegistrationResult {
  /** 两个服务都在位并完成注册 ⇒ true；否则 false（`reason` 一定非空） */
  readonly registered: boolean;
  readonly reason?: string | undefined;
  /** 实际登记的 seat 数（成功时 = 2） */
  readonly seats: number;
  /** 当前仍生效的注册动作数（页类型 + seat；卸载后必须归零 —— REQ-4.4 的判据） */
  registrations(): number;
  /** 幂等撤销（宿主卸载时由 `ctx.effect` 自动调用；测试里手动调） */
  dispose(): void;
}

function degrade(reason: string): TabRegistrationResult {
  return { registered: false, reason, seats: 0, registrations: () => 0, dispose: () => undefined };
}

function isFunction(value: unknown): value is () => void {
  return typeof value === 'function';
}

function isSlots(value: unknown): value is SlotRegistryLike {
  const candidate = value as Partial<SlotRegistryLike> | null | undefined;
  return isFunction(candidate?.inject) && isFunction(candidate?.register);
}

function isSidebarRightTabs(value: unknown): value is SidebarRightTabsLike {
  return isFunction((value as Partial<SidebarRightTabsLike> | null | undefined)?.register);
}

function isSidebarRight(value: unknown): value is SidebarRightLike {
  return isFunction((value as Partial<SidebarRightLike> | null | undefined)?.openTab);
}

/** 纯函数：构造页类型定义（刻意不写 `priority` ⇒ 落宿主默认的 `extension` 档） */
export function buildTabDefinition(): SidebarRightTabDefinitionLike {
  return {
    id: TERMINAL_TAB_ID,
    kind: MANAGED_TERMINAL_KIND,
    /** REQ-4.3：每个 tab 只承载一个实例 ⇒ 必须允许多页共存 */
    multiple: true,
    /** 关 tab ≠ 杀实例：保留挂载态，重开时走快照恢复（REQ-12.3） */
    keepMounted: true,
    title: (address: string) => (address === '' ? TERMINAL_TAB_TITLE : `${TERMINAL_TAB_TITLE} · ${address}`),
  };
}

/** 纯函数：两个 keyed seat 的注册参数（`key` = `definition.id`） */
export function buildSeatRegistrations(): readonly SeatRegistrationLike[] {
  return [
    { name: TERMINAL_PANE_SLOT, key: TERMINAL_TAB_ID },
    { name: TERMINAL_TITLE_SLOT, key: TERMINAL_TAB_ID },
  ];
}

/**
 * 注册页类型 + 两个 seat（REQ-4.1/4.4/4.5）。
 *
 * 顺序即回滚边界：**先**页类型、**再** seat（官方注释：*the host resolves both keyed seats by the
 * definition's id, so the definition goes first*）；seat 注册抛错 ⇒ 撤销已完成的注册并把原因抛出去。
 * ⚠️ 页类型自身的 `register` 抛错（重复 `id`）**故意不捕获**：那是接线错误，必须响。
 */
export function registerTerminalTab(
  scope: ClientContextLike,
  components: TerminalTabComponents,
): TabRegistrationResult {
  if (!isSidebarRightTabs(scope.sidebarRightTabs)) {
    return degrade('宿主未提供 sidebarRightTabs.register：右栏页类型不注册（REQ-4.5），客户端其余部分照常工作。');
  }
  if (!isSidebarRight(scope.sidebarRight)) {
    return degrade('宿主未提供 sidebarRight.openTab：右栏容器能力缺失，页类型不注册（REQ-4.5）。');
  }
  if (!isSlots(scope.slots)) {
    return degrade('宿主未提供 slots.{inject,register}：页体/标题 seat 无法挂载，页类型不注册（REQ-4.5）。');
  }

  const tabs = scope.sidebarRightTabs;
  const slots = scope.slots;
  const disposers: Array<() => void> = [];
  let live = 0;

  /** 与 `ws/routes.ts` 同一手法：注册动作交给 `ctx.effect`（带 label，便于宿主诊断），宿主卸载时自动撤销 */
  const track = (label: string, register: () => (() => void) | void): void => {
    const install = (): (() => void) => {
      const hostDispose = register();
      live += 1;
      let done = false;
      const disposeOnce = (): void => {
        if (done) return;
        done = true;
        live -= 1;
        if (isFunction(hostDispose)) hostDispose();
      };
      disposers.push(disposeOnce);
      return disposeOnce;
    };
    if (typeof scope.effect === 'function') scope.effect(install, `${TERMINAL_TAB_ID}: ${label}`);
    else install();
  };

  /**
   * 一个 seat 的注册：`slots.inject(<槽位名>, () => slots.register({name,key}, Comp))`。
   * 🔴 两层返回值都可能**是**清理器（`inject` 自身 / 内层 `register`）⇒ **两个都收**：
   * 只收一个的写法在另一种宿主上会漏掉一半清理（漏清理的症状 = 卸载后残留注册、再挂载撞重复 `id`）。
   * 内层注册成功、外层 `inject` 却抛错时，**先把已拿到的清理器跑掉再抛**（不留半注册）。
   */
  const registerSeat = (seat: SeatRegistrationLike, component: unknown): (() => void) => {
    const collected: Array<() => void> = [];
    const runAll = (): void => {
      for (const dispose of collected.splice(0, collected.length).reverse()) dispose();
    };
    try {
      const inner = slots.inject(seat.name, () => {
        const disposer = slots.register(seat, component);
        if (isFunction(disposer)) collected.push(disposer);
        return disposer;
      });
      if (isFunction(inner)) collected.push(inner);
    } catch (error) {
      runAll();
      throw error;
    }
    return runAll;
  };

  try {
    // ① 页类型（priority 留空 = extension 档）
    track('sidebar tab type', () => tabs.register(buildTabDefinition()));
    // ② 两个 keyed seat（key = definition.id）
    for (const seat of buildSeatRegistrations()) {
      const component = seat.name === TERMINAL_PANE_SLOT ? components.pane : components.title;
      track(seat.name, () => registerSeat(seat, component));
    }
  } catch (error) {
    // 半注册是最难查的一种「页面空着」⇒ 抛错前把已收编的全部撤掉
    for (const dispose of disposers.splice(0, disposers.length).reverse()) dispose();
    live = 0;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`页类型/seat 注册失败（已回滚）：${message}`);
  }

  return {
    registered: true,
    seats: 2,
    registrations: () => live,
    dispose: () => {
      for (const dispose of disposers.splice(0, disposers.length)) dispose();
    },
  };
}
