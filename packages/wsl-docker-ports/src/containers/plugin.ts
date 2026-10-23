/**
 * 容器侧插件装配（015 `P2`）—— `- id: dsh-wsl-docker-containers` 这一行的 `apply` 实体。
 *
 * ## 这一侧**不做什么**（与转发侧的分工，逐条写死）
 *
 * - 不读 `netsh`、不算 `portproxy`、不做所有权/作用域判决；
 * - 不碰提权（Windows UAC / gsudo 与容器动作无关）；
 * - 不读转发侧的配置命名空间，也不写任何文件（审计/计划/票据全在转发侧的 `transport/**`）。
 *
 * 它只做三件事：**列容器**（自己的快照路由）、**启停重启**、**看日志**。
 *
 * ## 零模块级可变状态（015 R5）
 *
 * 两条 cordis 行共享**同一个模块实例** ⇒ 模块级 `let` / 单例缓存 / 票据环都会变成跨行的隐式共享。
 * 本文件的可变状态全部在 `applyWslDockerContainers` 的闭包里，卸载钩子一律 `ctx.effect` 收编。
 *
 * ## 降级口径（与转发侧同构）
 *
 * **全程不抛**：缺 `provide` / 缺 `webServer` / 缺 `effect` 都变成 `gaps` 里的一条；
 * 容器动作在缺凭据时是 401（fail-safe），不是「随便能点」。
 */

import { createExecutor, listDistros, resolveDistro } from 'dsh-wsl-shared';
import type { Executor, WslDistro, WslSharedError } from 'dsh-wsl-shared';

import { probeDockerPs } from '../read/docker-probe.ts';
import type { DockerPsOutcome } from '../read/docker-probe.ts';
import { CONTAINERS_ROW_ID, createContainersConfigReaders, CONTAINERS_SERVICE } from './credential.ts';
import { registerContainersRoute } from './route.ts';
import type { ContainersRouteRegistration } from './route.ts';
import { createContainersSnapshotBuilder } from './snapshot.ts';
import type { ContainersSnapshotBuilder } from './snapshot.ts';

/** 一条降级原因（`what` 与转发侧同一组词：`provide` / `webServer` / `effect`） */
export interface ContainersGap {
  readonly what: string;
  readonly reason: string;
}

/** 容器侧用的宿主上下文面（只列真用到的成员；全部可选 ⇒ 降级路径不抛） */
export interface ContainersContextLike {
  readonly get?: (serviceName: string) => unknown;
  readonly provide?: (serviceName: string, value: unknown) => unknown;
  readonly inject?: ((names: readonly string[], callback: (scope: ContainersContextLike) => void) => unknown) | undefined;
  readonly effect?: (callback: (() => void) | void, label?: string) => unknown;
}

/** 注入点（测试与集成方） */
export interface ContainersHostDeps {
  readonly executor?: Executor | undefined;
  readonly docker?: { readonly attempts?: number; readonly timeoutMs?: number } | undefined;
  readonly now?: (() => number) | undefined;
  readonly snapshotBuilder?: ContainersSnapshotBuilder | undefined;
}

/** 目标发行版（结构面；与转发侧的 `TargetDistro` 分开定义，两边不互相假装知道对方） */
export type ContainersTargetDistro =
  | { readonly ok: true; readonly resolved: { readonly name: string; readonly source: string }; readonly distros: readonly WslDistro[] }
  | WslSharedError;

/** 宿主侧服务面（`ctx.provide('wslDockerContainers', …)`） */
export interface ContainersHostService {
  readonly serviceName: string;
  resolveTarget(): Promise<ContainersTargetDistro>;
  readContainers(): Promise<DockerPsOutcome | WslSharedError>;
}

/** `applyWslDockerContainers` 的返回值（集成方/测试用） */
export interface WslDockerContainersPluginHandle {
  readonly service: ContainersHostService;
  readonly snapshotBuilder: ContainersSnapshotBuilder;
  readonly route: ContainersRouteRegistration;
  readonly gaps: readonly ContainersGap[];
  readonly provided: boolean;
  effectCount(): number;
  dispose(): void;
}

/** 容器侧的 cfg 面（与转发侧同一个 `Config` schema，另**一个**命名空间 ⇒ 值独立） */
export type ContainersPluginConfigLike = unknown;

/**
 * 容器侧的 `apply` 实体（`src/plugin.ts` 按角色分派后调它；**不从包出口导出**）。
 *
 * `config` 是宿主按**本行 id** 解析出的配置对象（活体包装）⇒ `distro` / `writeToken` 每次现读。
 */
export function applyWslDockerContainers(
  ctx: ContainersContextLike,
  config?: ContainersPluginConfigLike,
  deps: ContainersHostDeps = {},
): WslDockerContainersPluginHandle {
  const executor = deps.executor ?? createExecutor();
  const readers = createContainersConfigReaders(config);

  const resolveTarget = async (): Promise<ContainersTargetDistro> => {
    const listed = await listDistros(executor);
    if (!listed.ok) return listed;
    const resolved = resolveDistro(listed.distros, readers.distro());
    if (!resolved.ok) return resolved;
    return { ok: true, resolved, distros: listed.distros };
  };

  const service: ContainersHostService = {
    serviceName: CONTAINERS_SERVICE,
    resolveTarget,
    readContainers: async (): Promise<DockerPsOutcome | WslSharedError> => {
      const target = await resolveTarget();
      if (!target.ok) return target;
      return probeDockerPs(executor, target.resolved.name, target.distros, {
        allContainers: true,
        ...(deps.docker?.attempts === undefined ? {} : { attempts: deps.docker.attempts }),
        ...(deps.docker?.timeoutMs === undefined ? {} : { timeoutMs: deps.docker.timeoutMs }),
      });
    },
  };

  const builder: ContainersSnapshotBuilder =
    deps.snapshotBuilder ??
    createContainersSnapshotBuilder({
      executor,
      configuredDistro: readers.distro,
      ...(deps.docker === undefined ? {} : { docker: deps.docker }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
    });

  const route = registerContainersRoute(toRouteContext(ctx), {
    ...(config === undefined ? {} : { config }),
    executor,
    snapshotBuilder: builder,
    resolveTarget: async () => {
      const target = await resolveTarget();
      if (!target.ok) return { ok: false, message: target.message };
      return { ok: true, name: target.resolved.name, distros: target.distros };
    },
  });

  const provided = provideService(ctx, CONTAINERS_SERVICE, service);

  /** webServer 缺口：**每次读都按 route 的当前状态算**（惰性注入可能在本函数返回后才到） */
  const webServerGap = (): ContainersGap | null => {
    if (route.registered) return null;
    const why = route.reason ?? '宿主未提供 webServer';
    return {
      what: 'webServer',
      reason: `${why} ⇒ 容器侧端点 ${route.paths.snapshot} 尚未注册；注册到位后本条自动消失。`,
    };
  };

  const tailGaps: ContainersGap[] = [];
  let effectCount = 0;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    route.dispose();
  };

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      effectCount += 1;
      return dispose;
    }, 'dsh-wsl-docker-containers: dispose');
  } else {
    tailGaps.push({
      what: 'effect',
      reason: '宿主 ctx 上没有 effect() ⇒ 卸载钩子未登记（路由的 disposer 只能在手动 dispose() 时生效）。',
    });
  }

  const provideGap: ContainersGap | null = provided
    ? null
    : {
        what: 'provide',
        reason: `宿主 ctx 上没有 provide() ⇒ 服务 ${CONTAINERS_SERVICE} 未导出（容器侧页面仍可用 HTTP 路由取数）。`,
      };

  return {
    service,
    snapshotBuilder: builder,
    route,
    get gaps(): readonly ContainersGap[] {
      const out: ContainersGap[] = [];
      if (provideGap !== null) out.push(provideGap);
      const web = webServerGap();
      if (web !== null) out.push(web);
      out.push(...tailGaps);
      return out;
    },
    provided,
    effectCount: () => effectCount,
    dispose,
  };
}

/** 行 id（= 配置命名空间；供 `src/plugin.ts` 分派与测试断言） */
export const CONTAINERS_PLUGIN_ROW_ID = CONTAINERS_ROW_ID;

/* ────────────────────────── 内部的窄适配 ────────────────────────── */

/** 把宿主 ctx 收窄成路由面（结构兼容即可，不做运行时断言） */
function toRouteContext(ctx: ContainersContextLike) {
  return ctx as unknown as Parameters<typeof registerContainersRoute>[0];
}

/** 服务导出的**唯一**调用点（照 002 的窄缝口径；没有 `provide` 记成 gap 而不是崩） */
function provideService(ctx: ContainersContextLike, serviceName: string, value: unknown): boolean {
  if (typeof ctx.provide !== 'function') return false;
  ctx.provide(serviceName, value);
  return true;
}
