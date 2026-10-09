/**
 * 配置页接线（002 T6.1；REQ-10.1 / contract §C10 + §D12）
 *
 * ## 两件事，各自可单独断言
 *
 * 1. **自绘页面注册**：`ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name, key }, Comp))`
 *    —— `register` 是 **(`options`, `Component`) 两个位置参数**（写成 `(name, id, …)` 根本不编译），
 *    keyed 槽必须有 `key = '<包名>#<行 id>'`；`ownerProps.view === 'summary'` 时给一行摘要、否则给整页。
 *    宿主**没有**这个槽位 ⇒ **不注册、不抛、不拖垮启动**（降级原因要能读出来）。
 * 2. **关掉宿主自动表单**：`ctx.inject(['settings'], child => child.effect(() => child.settings
 *    .configure({ auto: false }, ctx.fiber)))`（REQ-10.1 的**逐字**用法，2026-10-08 源码实证）。
 *    ⚠️ 客户端 `ctx.inject` 是**惰性**的：回调可能在 `apply` 返回之后才跑 ⇒ 返回结果是
 *    **登记时刻的快照**，`deferred` 是正常态而不是失败（见 `ConfigureResult`）。
 *
 * ## 为什么 `settings` 不进入口 `inject`
 *
 * 入口 `inject` 里声明了却缺失的服务会让**整个客户端插件 load 失败**（contract §B7）⇒ `settings`
 * 一律走 `ctx.inject([...])` 惰性等待（缺了就只少一个「关自动表单」的动作，页面照常注册）。
 */

import { CONFIG_ROW_KEY, CONFIG_SLOT_NAME } from './config-pipe.ts';
import { softGet } from './tab.ts';
import type { ClientContextLike, SlotRegistryLike } from './tab.ts';

/** 自动表单关闭动作的 effect label（宿主诊断可读） */
export const CONFIG_AUTO_EFFECT_LABEL = `${CONFIG_SLOT_NAME}: auto-form off`;

/** 页面注册动作的 effect label */
export const CONFIG_PAGE_EFFECT_LABEL = `${CONFIG_SLOT_NAME}: page`;

/** 宿主 `settings` 服务名（REQ-10.1 逐字：`ctx.inject(['settings'], …)`） */
export const SETTINGS_SERVICE = 'settings';

/** 宿主 settings 表单服务的窄接口（只声明本包用到的一个方法） */
export interface SettingsFormServiceLike {
  configure(options: { readonly auto: boolean }, fiber?: unknown): unknown;
}

/** 配置页槽位收到的宿主 props（只有 `view` 是本包认的；其余键忽略） */
export interface ConfigSlotOwnerProps {
  readonly view?: string | undefined;
}

/** 两个视图组件（由入口注入 ⇒ 本文件保持无 React 依赖，纯函数可测） */
export interface ConfigSlotComponents {
  readonly page: unknown;
  readonly summary: unknown;
}

/** `configure({ auto: false })` 的结果 */
export type ConfigureResult =
  | { readonly kind: 'configured' }
  /** `inject(['settings'])` 已登记但服务还没到位 ⇒ 回调晚点会跑（**不是失败**） */
  | { readonly kind: 'deferred'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface ConfigSlotResult {
  readonly registered: boolean;
  readonly reason?: string | undefined;
  readonly slotName: string;
  readonly key: string;
  readonly autoForm: ConfigureResult;
  /** 当前仍生效的注册数（1 = 已注册；卸载后必须归零 —— REQ-12.2 的口径） */
  registrations(): number;
  dispose(): void;
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

function isSlots(value: unknown): value is SlotRegistryLike {
  const candidate = value as Partial<SlotRegistryLike> | null | undefined;
  return isFunction(candidate?.inject) && isFunction(candidate?.register);
}

function isSettingsForm(value: unknown): value is SettingsFormServiceLike {
  return isFunction((value as Partial<SettingsFormServiceLike> | null | undefined)?.configure);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 纯函数：`ownerProps.view === 'summary'` ⇒ 摘要组件，否则整页（contract §D12 的分派口径）。
 * 未识别的 `view`（含 `undefined`）一律给**整页** —— 摘要信息不足时宁可多给，别给一个空白面板。
 */
export function buildConfigComponent(
  components: ConfigSlotComponents,
): (ownerProps?: ConfigSlotOwnerProps) => unknown {
  return (ownerProps) => (ownerProps?.view === 'summary' ? components.summary : components.page);
}

/** 从 scope 上取 `settings` 表单服务（属性优先，其次 `get('settings')`） */
function settingsOf(scope: ClientContextLike): SettingsFormServiceLike | undefined {
  const candidate = (scope as ClientContextLike & { readonly settings?: unknown }).settings;
  if (isSettingsForm(candidate)) return candidate;
  const viaGet = scope.get?.(SETTINGS_SERVICE);
  return isSettingsForm(viaGet) ? viaGet : undefined;
}

/**
 * 关闭宿主自动表单（REQ-10.1 逐字用法）。
 *
 * - `ctx.inject` 可用 ⇒ 走惰性注入（服务晚到也能等到），返回 `configured`（同步命中）或 `deferred`；
 * - 没有 `inject` ⇒ 直接在当前 ctx 上试一次（测试替身/老宿主），失败就是 `unavailable` + 原因；
 * - `configure` **抛错不往外扔**：关不掉自动表单只是「用户会同时看到两张表单」，不该让插件加载失败。
 */
export function configureAutoForm(ctx: ClientContextLike): ConfigureResult {
  const attempt = (scope: ClientContextLike): ConfigureResult => {
    const service = settingsOf(scope);
    if (service === undefined) {
      return { kind: 'unavailable', reason: `宿主未提供 ${SETTINGS_SERVICE}.configure：自动表单未关闭（自绘页面照常注册）` };
    }
    try {
      // REQ-10.1 的第二个实参是 `ctx.fiber`；宿主没给 fiber 时**不瞎传**（一个 `undefined` 实参并不等价于省略）
      if (ctx.fiber === undefined) service.configure({ auto: false });
      else service.configure({ auto: false }, ctx.fiber);
      return { kind: 'configured' };
    } catch (error) {
      return { kind: 'unavailable', reason: `settings.configure 调用失败：${errorMessage(error)}` };
    }
  };

  if (typeof ctx.inject !== 'function') return attempt(ctx);

  let result: ConfigureResult | undefined;
  try {
    ctx.inject([SETTINGS_SERVICE], (scope) => {
      result = attempt(scope);
    });
  } catch (error) {
    return { kind: 'unavailable', reason: `inject(['${SETTINGS_SERVICE}']) 登记失败：${errorMessage(error)}` };
  }
  return (
    result ?? {
      kind: 'deferred',
      reason: `已登记 inject(['${SETTINGS_SERVICE}'])，服务到位后自动关闭自动表单（惰性注入的常态）`,
    }
  );
}

function degrade(reason: string, autoForm: ConfigureResult): ConfigSlotResult {
  return {
    registered: false,
    reason,
    slotName: CONFIG_SLOT_NAME,
    key: CONFIG_ROW_KEY,
    autoForm,
    registrations: () => 0,
    dispose: () => undefined,
  };
}

/**
 * 注册配置页（T6.1）。失败**不抛**（与页类型注册的口径不同：页类型是右栏主功能，
 * 配置页只是可选的编辑入口）—— 但降级原因一定非空，入口会 `console.warn` 出来。
 */
export function registerConfigSlot(ctx: ClientContextLike, components: ConfigSlotComponents): ConfigSlotResult {
  const autoForm = configureAutoForm(ctx);

  // 与 `tab.ts` 同一口径的**两读**：属性 或 `ctx.get('slots')`（官方两种调用点都出现过）
  const slots = softGet(ctx, 'slots');
  if (!isSlots(slots)) {
    return degrade(
      `宿主未提供 slots.{inject,register}：${CONFIG_SLOT_NAME} 不注册（自绘配置页不可用，其余照常）`,
      autoForm,
    );
  }
  const component = buildConfigComponent(components);
  const options = { name: CONFIG_SLOT_NAME, key: CONFIG_ROW_KEY };
  let live = 0;
  let disposeInner: (() => void) | undefined;

  /** 与 `tab.ts` 同一手法：注册动作交给 `ctx.effect`，宿主卸载时自动撤销（宿主不自动回收 disposer） */
  const install = (): (() => void) => {
    const collected: Array<() => void> = [];
    const runAll = (): void => {
      for (const dispose of collected.splice(0, collected.length).reverse()) dispose();
    };
    try {
      const inner = slots.inject(CONFIG_SLOT_NAME, () => {
        const disposer = slots.register(options, component);
        if (isFunction(disposer)) collected.push(disposer as () => void);
        return disposer;
      });
      if (isFunction(inner)) collected.push(inner as () => void);
    } catch (error) {
      runAll();
      throw error;
    }
    live = 1;
    let done = false;
    // 🔴 这里**不能**把 `disposeInner` 也塞进 `collected`：它自己会调 `runAll()`，塞进去就是自递归
    disposeInner = (): void => {
      if (done) return;
      done = true;
      live = 0;
      runAll();
    };
    return disposeInner;
  };

  try {
    if (typeof ctx.effect === 'function') ctx.effect(install, CONFIG_PAGE_EFFECT_LABEL);
    else install();
  } catch (error) {
    return degrade(`${CONFIG_SLOT_NAME} 注册失败（已回滚）：${errorMessage(error)}`, autoForm);
  }

  return {
    registered: true,
    slotName: CONFIG_SLOT_NAME,
    key: CONFIG_ROW_KEY,
    autoForm,
    registrations: () => live,
    dispose: () => {
      disposeInner?.();
    },
  };
}
