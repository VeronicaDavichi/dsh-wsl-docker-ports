/**
 * 容器侧**自己的快照**（015 `P3`）—— `GET /dsh-wsl-docker-containers/snapshot`
 *
 * ## 为什么必须自己造一份（而不是复用转发侧的 `/snapshot`）
 *
 * 015 `R2` / owner 决策 ②：容器行默认开启，而**转发侧可能没开、或正在红**
 * （`netsh` 读取挂住、非 NAT、提权不可用…）。若容器列表挂在转发侧快照上，那些失败会连带把
 * 容器表打空 —— 用户想看的「我的容器在跑吗」反而最脆弱。故本文件**只**跑两件事：
 *
 * 1. `wsl -l -v`（001 的 `listDistros`，只读、不冷启动）；
 * 2. `docker ps -a`（003 的 `probeDockerPs`，只读、有硬超时 + 空输出复核）。
 *
 * **零 `netsh`、零 `portproxy`、零提权、零文件写入**：这正是 015 §4.3 要的分侧闭包。
 *
 * ## 数据源复用，接缝不复制
 *
 * `../read/docker-probe.ts` 与 `../read/docker.ts` 是 **003 的只读层**（015 §4.1 白名单里明确允许），
 * 复用它们等于复用「`--format '{{json .}}'` 不挂住」「空输出要复核」这些**真机踩出来的口径**。
 * 不复用的是转发侧的**装配**（`snapshot.ts` / `route.ts` / `wire.ts` / `transport/**`）。
 *
 * ## 发行版解析：为什么这里另写一遍二十行
 *
 * 转发侧的 `../distro.ts` 也能解析，但它把 `DistroPanelData`（转发侧的视图模型）当返回值 ——
 * 一旦容器侧 import 它，容器列表就又一次挂在「转发侧的模型」上。这里直接用 001 的
 * `resolveDistro`（四级优先级的**唯一**实现），只把结果映射成本侧自己的三个字段，
 * 并**逐字**保留「配置失效要明说、不静默换一个」那条口径。
 */

import { listDistros, resolveDistro } from 'dsh-wsl-shared';
import type { Executor, WslDistro } from 'dsh-wsl-shared';

import { probeDockerPs } from '../read/docker-probe.ts';
import type { DockerContainer, DockerPortMapping } from '../read/docker.ts';
import type { ContainersDistro, ContainersRow, ContainersSnapshot } from './wire.ts';

export interface ContainersSnapshotDeps {
  readonly executor: Executor;
  /** 容器侧自己的 `distro`（活体读取：每次构建现读，吃到 live 写入） */
  readonly configuredDistro?: (() => string | undefined) | undefined;
  readonly docker?: { readonly attempts?: number; readonly timeoutMs?: number } | undefined;
  /** 固定时间戳（测试）；默认 `Date.now` */
  readonly now?: (() => number) | undefined;
}

export type ContainersSnapshotOutcome =
  | { readonly ok: true; readonly snapshot: ContainersSnapshot }
  | { readonly ok: false; readonly code: 'docker-failed'; readonly message: string };

export interface ContainersSnapshotBuilder {
  build(): Promise<ContainersSnapshotOutcome>;
}

/** 端口映射 → 一行文本（`0.0.0.0:8080->80/tcp`；未发布端口 ⇒ `8080/tcp`） */
export function formatPortMapping(mapping: DockerPortMapping): string {
  const containerPort =
    mapping.containerPortEnd === null
      ? String(mapping.containerPort)
      : `${String(mapping.containerPort)}-${String(mapping.containerPortEnd)}`;
  if (mapping.hostPort === null) return `${containerPort}/${mapping.protocol}`;
  const hostPort = mapping.hostPortEnd === null ? String(mapping.hostPort) : `${String(mapping.hostPort)}-${String(mapping.hostPortEnd)}`;
  return `${mapping.hostIp ?? '0.0.0.0'}:${hostPort}->${containerPort}/${mapping.protocol}`;
}

/** `DockerContainer` → 本侧视图行（`names` 在 003 的解析里是**已去前导斜杠**的名字） */
export function toContainersRow(container: DockerContainer): ContainersRow {
  return {
    id: container.id,
    name: container.names,
    image: container.image,
    state: container.state,
    status: container.status,
    ports: container.ports.map(formatPortMapping),
  };
}

/** 001 的四态来源（与 `distro.ts` 的文案同源；这里只映射，不改语义） */
const SOURCE_TEXT: Readonly<Record<string, string>> = {
  config: '配置指定',
  wslDefault: 'WSL 默认发行版（`wsl -l -v` 的 `*`）',
  onlyOne: '本机唯一发行版',
  first: '本机首个发行版',
};

function toDistro(distros: readonly WslDistro[], resolution: { name: string; source: string }, stale: string | null): ContainersDistro {
  const matched = distros.find((distro) => distro.name === resolution.name);
  return {
    name: resolution.name,
    state: matched?.state ?? null,
    source: resolution.source,
    staleConfig: stale !== null,
    message: stale,
  };
}

/**
 * 解析目标发行版。**不抛**：失败 ⇒ `{ distro: null, distroError }`（页面仍有可读原因）。
 * 与转发侧同一口径：配置值失效时**明说**并回落到四级优先级，绝不静默换一个。
 */
export function resolveContainersDistro(
  distros: readonly WslDistro[],
  configured: string | undefined,
): { readonly distro: ContainersDistro | null; readonly distroError: string | null } {
  const wanted = configured?.trim();
  if (wanted !== undefined && wanted !== '') {
    const preferred = resolveDistro(distros, wanted);
    if (preferred.ok) return { distro: toDistro(distros, preferred, null), distroError: null };
    const fallback = resolveDistro(distros, undefined);
    if (!fallback.ok) return { distro: null, distroError: `${preferred.message}；且无可用回落：${fallback.message}` };
    const stale =
      `配置里的发行版「${wanted}」已不存在（${preferred.message}）⇒ 已按 ${SOURCE_TEXT[fallback.source] ?? fallback.source} ` +
      `回落为「${fallback.name}」，请到容器行配置页确认后保存`;
    return { distro: toDistro(distros, fallback, stale), distroError: null };
  }
  const fallback = resolveDistro(distros, undefined);
  if (!fallback.ok) return { distro: null, distroError: fallback.message };
  return { distro: toDistro(distros, fallback, null), distroError: null };
}

/**
 * 造快照装配器。`deps` 全部可注入 ⇒ 测试零进程、零 WSL。
 *
 * ⚠️ **不缓存**：每次 `build()` 都真读一次（快照是用户点刷新/自动刷新时的**当下事实**）。
 * 缓存会制造「页面显示 30 秒前的容器表而用户以为是最新」这类假象，比慢一次更糟。
 */
export function createContainersSnapshotBuilder(deps: ContainersSnapshotDeps): ContainersSnapshotBuilder {
  const now = deps.now ?? ((): number => Date.now());
  return {
    async build(): Promise<ContainersSnapshotOutcome> {
      const listed = await listDistros(deps.executor);
      if (!listed.ok) {
        return { ok: false, code: 'docker-failed', message: `读取发行版列表失败：${listed.message}` };
      }
      const { distro, distroError } = resolveContainersDistro(listed.distros, deps.configuredDistro?.());
      const generatedAt = new Date(now()).toISOString();

      if (distro === null) {
        return {
          ok: true,
          snapshot: {
            generatedAt,
            distro: null,
            distroError,
            containers: [],
            error: null,
            notes: ['目标发行版解析失败 ⇒ 本次没有读取容器列表（不拿空列表冒充「没有容器」）'],
          },
        };
      }

      // `allContainers: true`：主人的真机反馈是「stopped 的容器也要列出来」（010 已有同口径）
      const probe = await probeDockerPs(deps.executor, distro.name, listed.distros, {
        allContainers: true,
        ...(deps.docker?.attempts === undefined ? {} : { attempts: deps.docker.attempts }),
        ...(deps.docker?.timeoutMs === undefined ? {} : { timeoutMs: deps.docker.timeoutMs }),
      });

      if (!probe.ok) {
        return {
          ok: true,
          snapshot: {
            generatedAt,
            distro,
            distroError,
            containers: [],
            error: { reason: probe.reason, message: probe.message, hint: probe.hint },
            notes: ['容器列表读取失败：这不是「没有容器」，原因见上方'],
          },
        };
      }

      return {
        ok: true,
        snapshot: {
          generatedAt,
          distro,
          distroError,
          containers: probe.containers.map(toContainersRow),
          error: null,
          notes: [
            ...(probe.containerListNote === null || probe.containerListNote === undefined ? [] : [probe.containerListNote]),
            ...(probe.containers.length === 0 && probe.emptyAfterRetry ? ['确实没有容器（空输出已复核一次）'] : []),
            ...(probe.containers.length === 0 && !probe.emptyAfterRetry ? ['读到空输出但未复核 ⇒ 请点刷新再试一次'] : []),
          ],
        },
      };
    },
  };
}
