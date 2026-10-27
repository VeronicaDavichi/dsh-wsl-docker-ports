/**
 * 010 `T7.3`：把自绘配置页挂进宿主的**插件行配置槽**（`plugins.row.config`）。
 *
 * ## 两件事，顺序固定
 *
 * 1. `settings.configure({ auto: false }, ctx.fiber)` —— 关掉宿主自动生成的表单，
 *    否则同一份配置会出现两张表单（一张能写、一张也能写 ⇒ 修订冲突）。
 * 2. `slots.inject('plugins.row.config', () => slots.register({ name, key }, 组件))` ——
 *    注册键 `key` = 本包 patch **条目 id**（= 包名 `dsh-wsl-docker-ports`），`name` = 槽位名。
 *
 * 逐字依据：002 `src/client/config-slot.ts` 的 `configureAutoForm` + `registerConfigSlot`
 * （2026-10-08 源码实证的 `REQ-10.1` 用法）；本文件是**同一手法的窄实现**，只保留本包用得到的部分。
 *
 * ## 失败一律降级、不抛
 *
 * 配置页只是**可选的编辑入口**：关不掉自动表单 = 用户多看一张表；槽位注册失败 = 本页不出现。
 * 两种都不该让插件加载失败（与右栏页注册的取向不同 —— 那是主功能）。
 *
 * ## 为什么在主包里
 *
 * `plugins.row.config` 是**客户端** slot 服务，注册必须发生在客户端 `apply()` 期间；chunk 只在
 * 用户打开右栏页时才被取回来 ⇒ 在主包里注册一个**只负责取块的薄座位**（组件本体仍在 chunk 里）。
 */

/** 宿主配置槽的服务名（官方 `plugins.row.config` 一栏；0.2.0-rc.2 随包文档核对） */
export const CONFIG_SLOT_NAME = 'plugins.row.config';

/**
 * 注册键 = `<包名>#<行 id>`（017 订正；宿主文档逐字：「keyed by `<package name>#<row id>`」）。
 *
 * 015 当初只写行 id（`wsl-containers`）⇒ 宿主按「包名#行 id」查不到 ⇒ 这一行的
 * **配置**控件不会出现。同一条订正也适用于转发行（键 `dsh-wsl-docker-ports#wsl-ports`）。
 */
export const CONFIG_ROW_KEY = 'dsh-wsl-docker-containers#wsl-containers';

export const AUTO_FORM_EFFECT_LABEL = `${CONFIG_SLOT_NAME}: auto-form off`;

type ComponentLike = (props: never) => unknown;

interface SlotsLike {
  inject(name: string, callback: () => unknown): unknown;
  register(options: { readonly name: string; readonly key: string }, component: ComponentLike): unknown;
}

interface SettingsFormLike {
  configure(options: { readonly auto: boolean }, fiber?: unknown): unknown;
}

/** 宿主客户端 ctx 的窄面（只声明用到的；两种取服务写法都收） */
export interface ConfigSlotContext {
  readonly fiber?: unknown;
  get?(name: string): unknown;
  inject?(services: readonly string[], callback: (scope: ConfigSlotContext) => void): unknown;
  effect?(callback: () => (() => void) | void, label?: string): unknown;
  readonly slots?: unknown;
  readonly settings?: unknown;
}

export type ConfigureOutcome =
  | { readonly kind: 'configured' }
  | { readonly kind: 'deferred'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface ConfigSlotResult {
  readonly registered: boolean;
  readonly reason?: string | undefined;
  readonly slotName: string;
  readonly key: string;
  readonly autoForm: ConfigureOutcome;
  registrations(): number;
  dispose(): void;
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

function isSlots(value: unknown): value is SlotsLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { inject?: unknown; register?: unknown };
  return isFunction(candidate.inject) && isFunction(candidate.register);
}

function isSettingsForm(value: unknown): value is SettingsFormLike {
  return typeof value === 'object' && value !== null && isFunction((value as { configure?: unknown }).configure);
}

function settingsOf(scope: ConfigSlotContext): SettingsFormLike | undefined {
  const direct = (scope as { readonly settings?: unknown }).settings;
  if (isSettingsForm(direct)) return direct;
  const viaGet = typeof scope.get === 'function' ? scope.get('settings') : undefined;
  return isSettingsForm(viaGet) ? viaGet : undefined;
}

function errorOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 关掉自动表单（`REQ-12.1` 的前半）：服务晚到时走惰性注入，返回 `deferred` 而不是失败 */
export function configureAutoForm(ctx: ConfigSlotContext): ConfigureOutcome {
  const attempt = (scope: ConfigSlotContext): ConfigureOutcome => {
    const service = settingsOf(scope);
    if (service === undefined) {
      return { kind: 'unavailable', reason: '宿主未提供 settings.configure：自动表单未关闭（自绘配置页照常注册）' };
    }
    try {
      // 第二个实参是 `ctx.fiber`；宿主没给 fiber 时**不瞎传**（一个 `undefined` 实参并不等价于省略）
      if (ctx.fiber === undefined) service.configure({ auto: false });
      else service.configure({ auto: false }, ctx.fiber);
      return { kind: 'configured' };
    } catch (error) {
      return { kind: 'unavailable', reason: `settings.configure 调用失败：${errorOf(error)}` };
    }
  };

  if (typeof ctx.inject !== 'function') return attempt(ctx);

  let outcome: ConfigureOutcome | undefined;
  try {
    ctx.inject(['settings'], (scope) => {
      outcome = attempt(scope);
    });
  } catch (error) {
    return { kind: 'unavailable', reason: `inject(['settings']) 登记失败：${errorOf(error)}` };
  }
  return outcome ?? { kind: 'deferred', reason: "已登记 inject(['settings'])，服务到位后自动关闭自动表单（惰性注入的常态）" };
}

function degrade(reason: string, autoForm: ConfigureOutcome): ConfigSlotResult {
  return { registered: false, reason, slotName: CONFIG_SLOT_NAME, key: CONFIG_ROW_KEY, autoForm, registrations: () => 0, dispose: () => undefined };
}

/**
 * 注册配置页（`REQ-12.1` 的后半）。**幂等**：重复调用不会产生第二个页（宿主按 `key` 去重之前我们自己也挡一层）。
 */
export function registerConfigSlot(ctx: ConfigSlotContext, component: ComponentLike, key: string = CONFIG_ROW_KEY): ConfigSlotResult {
  const autoForm = configureAutoForm(ctx);

  const candidate = (ctx as { readonly slots?: unknown }).slots;
  const slots = isSlots(candidate) ? candidate : typeof ctx.get === 'function' ? ctx.get('slots') : undefined;
  if (!isSlots(slots)) {
    return degrade(`宿主未提供 slots.{inject,register}：${CONFIG_SLOT_NAME} 不注册（自绘配置页不可用，其余照常）`, autoForm);
  }

  const options = { name: CONFIG_SLOT_NAME, key };
  let live = 0;
  let done = false;
  const collected: (() => void)[] = [];

  const runAll = (): void => {
    for (const dispose of collected.splice(0, collected.length).reverse()) dispose();
  };

  const install = (): (() => void) => {
    const inner = slots.inject(CONFIG_SLOT_NAME, () => {
      const disposer = slots.register(options, component);
      if (isFunction(disposer)) collected.push(disposer as () => void);
      return disposer;
    });
    if (isFunction(inner)) collected.push(inner as () => void);
    live = 1;
    return () => {
      if (done) return;
      done = true;
      live = 0;
      runAll();
    };
  };

  let dispose = (): void => undefined;
  try {
    dispose = install();
  } catch (error) {
    runAll();
    return degrade(`槽位注册抛出异常：${errorOf(error)}（自绘配置页不可用，其余照常）`, autoForm);
  }

  // 宿主不自动收编 `register()` 的 disposer ⇒ 交给 `ctx.effect`（与路由同一取向）
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose, 'dsh-wsl-docker-ports: config slot');

  return { registered: true, slotName: CONFIG_SLOT_NAME, key: CONFIG_ROW_KEY, autoForm, registrations: () => live, dispose };
}
