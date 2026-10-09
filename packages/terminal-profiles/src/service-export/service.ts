/**
 * 002 T7.1 —— `managedTerminal` 服务的**实现**（§5 的 7 个方法）
 *
 * ## 这一层是「门面」，不是第二份状态
 *
 * 7 个方法**全部**转发到 `../session/manager.ts`（会话表 + 屏幕模型）与它背后的
 * `../screen/**`：本文件**不新建**实例表、不新建屏幕模型、不缓存实例摘要。所以：
 * 004 的工具面、003 的服务面、WS 通道三条路看到的是**同一批实例**（REQ-3.4 的「不劫持、不复用」
 * 与 REQ-12.3 的「会话归 Host」都靠这一点成立）。
 *
 * ## 🔴 resize 的换序与夹紧都**不**在本文件
 *
 * 宿主的 handle 是 `resize(cols, rows)`（列在前、不夹紧），本包对外的唯一入口是
 * `manager.resize(id, rows, cols)`（行在前、自带夹紧）。本层只做**同名字段转发**：这里看不到
 * 宿主的 `cols, rows` 顺序，也**不再**调一次 `clampSize` —— 换序/夹紧两处都有，才是「静默转置」
 * 与「两处口径」的来源（design §11）。这条由 `tests/unit/service-surface.test.ts` 按
 * **宿主收到的实参位置**钉死（`rows ≠ cols`，转置看得出来）。
 *
 * ## 订阅（§5 唯一的推送方法）怎么驱动
 *
 * 会话层的输出**没有 per-instance 事件**（`../session/manager.ts` 只暴露 `read`；
 * WS 通道的推送由宿主调度器调 `pump()` 驱动）。所以「增量推送」的唯一不侵入实现是
 * **按节奏 tail `manager.read({ mode:'incremental', sinceSeq })`**，而节奏由**注入的调度器**
 * 提供（`SchedulePort`）：本层与 `../ws/connection.ts` 同一立场 —— 不自起不受管的定时器。
 * 缺省实现是 `setInterval(...)` + `unref()`，并且**最后一个订阅注销 / dispose 时必定清掉**
 * （REQ-12.2「卸载后不遗留定时器」的判据就是 `tickerCount() === 0`）。
 *
 * ## dispose：卸载清理的另一半（T7.2 打底）
 *
 * `dispose()` 幂等、返回同一个 promise，做三件事：清订阅（监听归零）→ 停定时器 → **终止全部实例**
 * （`kill` 调用数 = `list()` 长度）。插件入口把它收进 `ctx.effect`（宿主不会替我们收）。
 */

import { isWslProfile } from '../config/profiles.ts';
import type { TerminalProfile } from '../config/profiles.ts';
import type { SessionManager, TerminalRead } from '../session/manager.ts';
import type { SessionResult, SubprocessSurface } from '../session/types.ts';
import type {
  KillTerminalRequest,
  ManagedTerminalService,
  OpenTerminalRequest,
  ReadTerminalRequest,
  ResizeTerminalRequest,
  ServiceFailure,
  ServiceFailureCode,
  ServiceResult,
  TerminalSubscriber,
  WriteTerminalRequest,
} from './types.ts';

/** 订阅轮的默认节奏：80ms ≈ 12Hz，肉眼连续、又远低于 PTY 分片速率（不是产品承诺，可注入覆盖） */
export const DEFAULT_SERVICE_POLL_MS = 80;

/** 调度器端口（**注入**而不是直接 `setInterval`：单测要确定性推进，且宿主可能自带 effect 级定时器） */
export interface SchedulePort {
  /** 每 `ms` 调一次 `tick`（允许 async）；返回**取消**函数（幂等调用安全） */
  every(ms: number, tick: () => void | Promise<void>): () => void;
}

/** 缺省调度器：`setInterval` + `unref`（订阅本身不该让宿主进程无法退出） */
export function createDefaultSchedule(): SchedulePort {
  return {
    every(ms, tick) {
      const timer = setInterval(() => {
        // 回调是 async：这里不 await（定时器回调没有等待者），失败已在 `pumpOnce` 内部收成事件
        void tick();
      }, ms);
      (timer as { unref?: () => void }).unref?.();
      return () => clearInterval(timer);
    },
  };
}

/** 沙箱门禁端口（设计取舍见 `../plugin.ts`：与 004 的工具面**同一份**策略，缺服务 fail-closed） */
export type GuardAction = 'open' | 'write' | 'resize' | 'kill';

export interface ManagedTerminalServiceOptions {
  /** 002 的实例表（**唯一**的机制入口；本层不另建） */
  readonly manager: SessionManager;
  /** profile 名录（**每次调用现取**：volatile 配置改完只影响新建实例，REQ-2.2/REQ-2.4） */
  readonly profiles: () => readonly TerminalProfile[];
  /** 订阅节奏（缺省 `createDefaultSchedule()`；单测传手动推进的 fake） */
  readonly schedule?: SchedulePort | undefined;
  readonly pollMs?: number | undefined;
  /** 写路径门禁（返回失败即拒绝；`managed_terminal_read`/`managed_terminal_list` 不过门，REQ-3.2） */
  readonly guard?: ((action: GuardAction) => ServiceFailure | undefined) | undefined;
}

/** 内部订阅记录（`sinceSeq` 可变：每轮 tail 后推进，等价于「游标」） */
interface Subscription {
  readonly id: string;
  readonly listener: TerminalSubscriber;
  sinceSeq: number | undefined;
}

export interface ManagedTerminalHost {
  /** 交给 `ctx.provide('managedTerminal', …)` 的那个对象：**恰好 7 个方法** */
  readonly service: ManagedTerminalService;
  /** 当前订阅监听数（T7.2 的「监听归零」判据；含已注册但本轮还没推送的） */
  listenerCount(): number;
  /** 当前活着的定时器数（REQ-12.2 的「不遗留定时器」判据） */
  tickerCount(): number;
  /** 幂等卸载：清订阅 + 停定时器 + 终止全部实例 */
  dispose(): Promise<void>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 构造一个可读失败（可选字段按 `exactOptionalPropertyTypes` 的条件展开，不塞 `undefined`） */
function failure(
  code: ServiceFailureCode,
  message: string,
  extra: { readonly hint?: string | undefined; readonly cwd?: string | undefined } = {},
): ServiceFailure {
  return {
    ok: false,
    code,
    message,
    ...(extra.hint === undefined ? {} : { hint: extra.hint }),
    ...(extra.cwd === undefined ? {} : { cwd: extra.cwd }),
  };
}

/** 把「端口抛出未预期错误」收成 typed failure —— 本层对外**不抛**的唯一保证（见 types.ts 文件头） */
async function guarded<T>(run: () => Promise<SessionResult<T>>): Promise<ServiceResult<T>> {
  try {
    return await run();
  } catch (error) {
    return failure('internal', `服务面调用抛出未预期错误：${describe(error)}`, {
      hint: '这是本层未预料的路径（端口契约被破坏）；请连同上面的原文一起上报。',
    });
  }
}

/** 按名查找 profile（失败时**附可用列表** —— 只说「没找到」会让 003 的 UI 无从下手） */
function findProfile(
  profiles: readonly TerminalProfile[],
  name: string,
): { readonly profile: TerminalProfile } | { readonly failure: ServiceFailure } {
  const hit = profiles.find((profile) => profile.name === name);
  if (hit !== undefined) return { profile: hit };
  const names = profiles.map((profile) => profile.name);
  return {
    failure: failure('profile-not-found', `profile「${name}」不在当前配置里`, {
      hint: names.length === 0 ? '当前配置里没有任何 profile。' : `可用 profile：${names.join('、')}`,
    }),
  };
}

/**
 * `cwdOverride` 落在 profile **本来就用的那个 cwd 槽位**（WSL ⇒ `cwdLinux`，其余 ⇒ `cwd`）。
 *
 * ⚠️ **不**清 `needsFix`：REQ-1.4 的「推导失败的条目不可启动」是权威结论，override 不是后门
 * （`../session/spawn-spec.ts` 的 `resolveCwd` 也是先看 `needsFix` 再分槽位）。
 */
function withCwdOverride(profile: TerminalProfile, override: string): TerminalProfile {
  return isWslProfile(profile.command)
    ? { ...profile, cwdLinux: override }
    : { ...profile, cwd: override };
}

export function createManagedTerminalService(options: ManagedTerminalServiceOptions): ManagedTerminalHost {
  const { manager, profiles } = options;
  const schedule = options.schedule ?? createDefaultSchedule();
  const pollMs = options.pollMs ?? DEFAULT_SERVICE_POLL_MS;
  const guard = options.guard;

  const subscriptions = new Set<Subscription>();
  let stopTicker: (() => void) | undefined;
  let pumping = false;
  let disposing: Promise<void> | undefined;

  const stopTickerIfIdle = (): void => {
    if (subscriptions.size > 0) return;
    stopTicker?.();
    stopTicker = undefined;
  };

  /** 调用订阅回调：订阅者抛错**只影响它自己**（否则一个坏订阅会停掉整条 tail 链） */
  const deliver = (subscription: Subscription, update: ServiceResult<TerminalRead>): void => {
    try {
      subscription.listener(update);
    } catch {
      // 有意吞掉：回调是调用方的代码，本层只保证「不因它中断其它订阅者」
    }
  };

  const drop = (subscription: Subscription): void => {
    subscriptions.delete(subscription);
    stopTickerIfIdle();
  };

  /** 一轮 tail：把每个订阅的下一段增量推给它的回调；实例消失 ⇒ 推一次失败并自动注销 */
  const pumpOnce = async (): Promise<void> => {
    // 上一轮还没跑完就跳过本轮（慢读不该堆叠：单轮有界才谈得上背压）
    if (pumping) return;
    pumping = true;
    try {
      // 快照遍历：推送期间发生的 unsubscribe/dispose 不会打乱本次迭代
      for (const subscription of [...subscriptions]) {
        if (!subscriptions.has(subscription)) continue;
        const result = await manager.read(subscription.id, {
          mode: 'incremental',
          sinceSeq: subscription.sinceSeq,
        });
        if (!result.ok) {
          // 失败也要送出去（不静默），然后注销：实例没了就没有下一段增量可言
          drop(subscription);
          deliver(subscription, result);
          continue;
        }
        // `hit` 与 `lost` 两个分支都带 `seq`（lost 附快照，REQ-6.3）⇒ 统一推进游标。
        // 这里仍做一次判别：`TerminalRead` 的 snapshot 分支没有 `seq`，类型层必须收窄（不是运行时兜底）
        if (result.value.mode === 'incremental') subscription.sinceSeq = result.value.seq;
        deliver(subscription, result);
      }
    } finally {
      pumping = false;
    }
  };

  return {
    service: {
      async open(request: OpenTerminalRequest) {
        const found = findProfile(profiles(), request.profile);
        if ('failure' in found) return found.failure;
        const override = request.cwdOverride;
        if (override !== undefined && override.trim() === '') {
          return failure('cwd-missing', 'cwdOverride 是空串或全空白，不能作为 PTY 的工作目录', {
            hint: '要么不传 cwdOverride（用 profile 自己的 cwd），要么给一个真实存在的目录。',
          });
        }
        const denied = guard?.('open');
        if (denied !== undefined) return denied;
        const target = override === undefined ? found.profile : withCwdOverride(found.profile, override);
        const started = await guarded(() => manager.start(target));
        if (!started.ok) return started;
        return { ok: true, value: { id: started.value.id } };
      },

      list() {
        return manager.list();
      },

      async read(request: ReadTerminalRequest) {
        return guarded(() =>
          manager.read(request.id, {
            mode: request.mode,
            sinceSeq: request.sinceSeq,
            scrollbackLines: request.scrollbackLines,
          }),
        );
      },

      async write(request: WriteTerminalRequest) {
        const denied = guard?.('write');
        if (denied !== undefined) return denied;
        return guarded(() => manager.write(request.id, request.data));
      },

      async resize(request: ResizeTerminalRequest) {
        const denied = guard?.('resize');
        if (denied !== undefined) return denied;
        // 🔴 只转发：换序与夹紧都在 `manager.resize` 里（文件头「resize 的换序」）
        return guarded(() => manager.resize(request.id, request.rows, request.cols));
      },

      async kill(request: KillTerminalRequest) {
        const denied = guard?.('kill');
        if (denied !== undefined) return denied;
        return guarded(() => manager.kill(request.id));
      },

      subscribe(id: string, listener: TerminalSubscriber) {
        const known = manager.list().some((summary) => summary.id === id);
        if (!known) {
          // 未知 id：**不注册监听**（否则坏 id 会留下永远推不动的监听），立即送一次失败
          deliver({ id, listener, sinceSeq: undefined }, failure(
            'instance-not-found',
            `实例「${id}」不在实例表里（已 kill / 从未存在）`,
            { hint: '先用 list() 取当前实例，再决定要不要订阅。' },
          ));
          return () => undefined;
        }
        const subscription: Subscription = { id, listener, sinceSeq: undefined };
        subscriptions.add(subscription);
        if (stopTicker === undefined) stopTicker = schedule.every(pollMs, pumpOnce);
        return () => drop(subscription);
      },
    },

    listenerCount: () => subscriptions.size,
    tickerCount: () => (stopTicker === undefined ? 0 : 1),

    dispose(): Promise<void> {
      if (disposing !== undefined) return disposing;
      disposing = (async () => {
        subscriptions.clear();
        stopTicker?.();
        stopTicker = undefined;
        // 终止**全部**实例：不假装 PTY 能跨卸载存活（REQ-12.1）。逐个 kill ⇒ kill 调用数 = 实例数
        for (const summary of [...manager.list()]) await manager.kill(summary.id);
      })();
      return disposing;
    },
  };
}

/** 缺 PTY 服务时的兜底端口（见 `../plugin.ts`：非严格 `ctx.get` 的降级路径，不是打桩） */
export function createUnavailableSubprocess(reason: string): SubprocessSurface {
  return {
    spawnTerminal() {
      throw new Error(reason);
    },
  };
}
