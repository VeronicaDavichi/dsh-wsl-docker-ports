
/**
 * `dsh-wsl-docker-containers` 的**客户端半入口**（016 从转发包入口收窄而成）
 *
 * ## 与转发侧入口的差异（拆包直接带来的，不是顺手改的）
 *
 * | 口径 | 转发侧 | 容器侧（本文件） |
 * | --- | --- | --- |
 * | 取数面 | 自建路由 + 声明来自 settings | **无独立取数面**：chunk 里的 `containers/source.ts` 直接打本包前缀 |
 * | 写通道 / 提权 / 执行器 | 有 | **一个都没有**（容器动作只用本包令牌，零提权） |
 * | 降级原因 | 4 条（含 `ports-source-missing`） | 3 条（`slots-missing` / `sidebar-right-pending` / `sidebar-right-unavailable`） |
 * | 配置槽 | 主包里的 chunk 座位 | 同形（键 = 本包行 id，写的是**本包**命名空间） |
 *
 * ## 不变量（与转发侧逐条相同的纪律）
 *
 * - **不抛**：任何缺失都从返回值里说清（降级必须可见，静默 = 「页面莫名其妙不出现」）；
 * - 右栏两个服务**晚到数百 ms 是常态** ⇒ 一律走惰性 `ctx.inject`，不早退；
 * - 超时才 warn（`pendingWarnMs` 缺省 2000；负值 = 关掉这条告警）；
 * - 拆卸时把告警定时器一起撤掉（否则卸载后还会冒一条无主 warn）。
 *
 * 座位（`ChunkBoot`）与取块说明符在 [`surface.ts`](./surface.ts)：入口只负责**什么时候**注册，
 * 注册面负责**注册什么**（一条文件一个职责，两边都在 400 行内）。
 */

import { CLIENT_SERVICES, SIDEBAR_SERVICE, SIDEBAR_TAB_SERVICE } from './host.ts';
import type {
  ClientApplyOptions,
  ClientApplyResult,
  ClientContextLike,
  ClientTimers,
  SidebarRightServiceLike,
  SidebarRightTabsServiceLike,
  SlotsServiceLike,
} from './host.ts';
import { installStylesWith } from './styles.ts';
import { createSurface } from './surface.ts';
import { PAGE_ID, PAGE_KIND, TAB_SLOT, TAB_TITLE_SLOT } from './tab-def.ts';

/** 模块级 Cordis 服务注入（**只放稳定服务**） */
export const inject: readonly string[] = CLIENT_SERVICES;

/** 行 id == 包名（与 `cordis.patch.yml` 的 `- id:` 一致；同时是配置命名空间） */
export const name = 'dsh-wsl-docker-containers';

export type ClientDegradeReason = 'slots-missing' | 'sidebar-right-unavailable' | 'sidebar-right-pending';

/** 读一个服务（`ctx.get(name)` 与作用域上的直接属性**都认**，两种写法官方都出现过） */
function softGet<T>(ctx: ClientContextLike, serviceName: string): T | undefined {
  const viaGet = typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined;
  if (viaGet !== undefined && viaGet !== null) return viaGet as T;
  const viaProperty = (ctx as unknown as Record<string, unknown>)[serviceName];
  return viaProperty === undefined || viaProperty === null ? undefined : (viaProperty as T);
}

/** 客户端日志前缀：**降级必须可见** */
const CLIENT_LOG_TAG = '[dsh-wsl-docker-containers]';

/**
 * pending 告警的缺省宽限窗口（ms）。
 * 🔴 真机实测（与转发侧同一次）：右栏两个服务晚到 ~240 ms 是常态 ⇒ 窗口内到位 = **零 warn**。
 */
const DEFAULT_PENDING_WARN_MS = 2000;

/**
 * 客户端半入口。**不抛异常**：任何缺失都从返回值里说清。
 */
export function apply(ctx: ClientContextLike, options: ClientApplyOptions = {}): ClientApplyResult {
  // ① 样式：必须在 factory 闭包内（材质化时）执行（contract §P4-4）
  installStylesWith(ctx);

  // ② 稳定服务：`slots` 已在模块级 inject 里声明，理论上必在；仍然软取以便降级可断言
  const slots = softGet<SlotsServiceLike>(ctx, 'slots');
  if (slots === undefined) {
    return { registered: false, reason: 'slots-missing', message: '宿主未提供 slots 服务：客户端插件不注册任何页面（未抛异常）', missing: ['slots'] };
  }

  // ③ 本包的注册面（runtime 要早造：配置页与右栏页共用同一个对象）
  const surface = createSurface(ctx, options, softGet, CLIENT_LOG_TAG);
  surface.registerConfig(ctx);

  const disposers: (() => void)[] = [];
  const collect = (disposer: unknown): void => {
    if (typeof disposer === 'function') disposers.push(disposer as () => void);
  };

  let registeredPage = false;
  /** 注入回调**真的跑过**（= 两个服务到过位）—— 与「还没到」是两回事，别混 */
  let injectFired = false;
  let lastMissing: string[] = [];

  const timers: ClientTimers = options.timers ?? {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    },
  };
  const grace = options.pendingWarnMs ?? DEFAULT_PENDING_WARN_MS;
  let pendingWarnTimer: unknown = null;
  let warnedPending = false;

  const cancelPendingWarn = (): void => {
    if (pendingWarnTimer === null) return;
    timers.clearTimeout(pendingWarnTimer);
    pendingWarnTimer = null;
  };

  const schedulePendingWarn = (): void => {
    if (!Number.isFinite(grace) || grace < 0) return;
    pendingWarnTimer = timers.setTimeout(() => {
      pendingWarnTimer = null;
      if (injectFired || registeredPage) return;
      warnedPending = true;
      console.warn(
        `${CLIENT_LOG_TAG} 右栏页等待超时（已等 ${String(grace)}ms）：已登记 ctx.inject(['${SIDEBAR_TAB_SERVICE}', '${SIDEBAR_SERVICE}']) 但宿主仍未提供这两个服务 ⇒ 页不会出现，看这一行（正常启动时服务在数百 ms 内到位，不会走到这里）`,
      );
    }, grace);
  };

  const register = (scope: ClientContextLike): void => {
    injectFired = true;
    cancelPendingWarn();
    const tabs = softGet<SidebarRightTabsServiceLike>(scope, SIDEBAR_TAB_SERVICE);
    const sidebar = softGet<SidebarRightServiceLike>(scope, SIDEBAR_SERVICE);
    const missing: string[] = [];
    if (tabs === undefined) missing.push(SIDEBAR_TAB_SERVICE);
    if (sidebar === undefined) missing.push(SIDEBAR_SERVICE);
    if (tabs === undefined || missing.length > 0) {
      lastMissing = missing;
      console.warn(`${CLIENT_LOG_TAG} 右栏页未注册：宿主未提供 ${missing.join(' / ')}（本包不抛异常）`);
      return;
    }
    const scopedSlots = softGet<SlotsServiceLike>(scope, 'slots') ?? slots;
    for (const disposer of surface.registerTab(tabs, scopedSlots, sidebar)) collect(disposer);
    registeredPage = true;
    if (warnedPending) {
      console.info(`${CLIENT_LOG_TAG} 右栏页已注册：${SIDEBAR_TAB_SERVICE} / ${SIDEBAR_SERVICE} 已到位，此前那条「等待超时」告警已解除`);
    }
  };

  // ④ 注册：**一律登记惰性注入**，不再同步 `softGet` 一次就早退（真机时序：本包模块级 inject 只有
  //    `['slots']` ⇒ fiber 早早启动，而右栏服务由官方包在 `apply` 中段才 provide）。
  if (typeof ctx.inject === 'function') collect(ctx.inject([SIDEBAR_TAB_SERVICE, SIDEBAR_SERVICE], register));
  else register(ctx);

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        cancelPendingWarn();
        for (const dispose of disposers.splice(0).reverse()) dispose();
      },
      'dsh-wsl-docker-containers: right-pane tab',
    );
  }

  if (registeredPage) {
    return { registered: true, pageId: PAGE_ID, kind: PAGE_KIND, seats: [TAB_SLOT, TAB_TITLE_SLOT], styles: 'dsh-wsl-docker-containers/styles' };
  }

  if (injectFired) {
    return {
      registered: false,
      reason: 'sidebar-right-unavailable',
      message: `宿主未声明右栏页服务：${lastMissing.join(' / ')} —— 本包不注册页面，也不报错`,
      missing: lastMissing,
    };
  }

  schedulePendingWarn();
  return {
    registered: false,
    reason: 'sidebar-right-pending',
    deferred: true,
    message: `已登记惰性注入等 ${SIDEBAR_TAB_SERVICE} / ${SIDEBAR_SERVICE} 到位：服务一到即注册页与两个 seat，此刻尚未注册（不是失败）`,
    missing: [],
  };
}

