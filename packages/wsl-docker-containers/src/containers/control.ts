/**
 * 容器侧的动作与日志**执行面**（015 `P2`）—— 纯 argv + 001 的 `execInDistro`，不碰文件。
 *
 * ## 与 `../docker/control.ts` 的关系（**故意是两份**，并有用例钉住等价）
 *
 * 010 的 `docker/control.ts` 属于**转发侧遗留通道**（挂在 `/dsh-wsl-docker-ports/container` 下，
 * 用转发侧凭据）；015 的容器侧是独立一侧，`scripts/check-borders.mjs` 的 R1 白名单把
 * `../docker/**` 划在容器侧之外 ⇒ 不能 import 它。于是这里的 argv 构造与失败归类是**第二份实现**。
 *
 * 复制是**已知代价**，用两条办法把漂移风险压住：
 * 1. 两侧的 argv 构造都只有一行、且都用同一组字面量（`docker <verb> <id>` / `docker logs --tail N <id>`）；
 * 2. `tests/unit/containers-control.test.ts` 对**同一组 001 错误码**断言两侧归类出的 `reason` 一致
 *    —— 谁改了归类而没改另一边，那条用例立刻红。
 *
 * ## 三条硬口径（与 010 相同，逐条保留原文）
 *
 * 1. **argv 数组、无 shell**：容器 id 走白名单校验（`./wire.ts`），不做字符串拼接。
 * 2. **写动作不重试**：`start|stop|restart` 的语义不幂等，失败就如实回报，重试由用户重新点；
 *    日志是只读 ⇒ 同样不重试（少一次进程，少一分唤醒代价）。
 * 3. **日志只进内存**：本模块没有 `node:fs` 的 import ⇒ 调用方拿到字符串，落不落盘由更上层决定。
 *
 * ## 容器侧**不需要**提权
 *
 * `docker` 在 WSL 里跑，只要用户在 `docker` 组就有权限；Windows 侧的 UAC/gsudo 与容器动作无关。
 * 故本文件**没有**任何提权依赖（015 的「容器侧零提权」判据由 R1 白名单 + 本文件零 import 保证）。
 */

import { execInDistro } from 'dsh-wsl-shared';
import type { Executor, WslDistro } from 'dsh-wsl-shared';

import { clampLogTail, type ContainersAction } from './wire.ts';

/** 容器动作的硬超时：`stop` 要等容器优雅退出（默认 10s），留一倍余量 */
export const CONTAINERS_WRITE_TIMEOUT_MS = 30_000;
/** 日志的硬超时：`--tail 200` 是**有界**读取，不该慢；超过就是异常 */
export const CONTAINERS_LOGS_TIMEOUT_MS = 15_000;

/** 失败原因（与 010 的 `ContainerFailureReason` 同一组名字，便于两侧等价用例逐项对照） */
export type ContainersFailureReason =
  | 'wsl-missing'
  | 'distro-missing'
  | 'distro-not-running'
  | 'timeout'
  | 'non-zero-exit'
  | 'permission-denied'
  | 'daemon-down'
  | 'unexpected';

export interface ContainersFailure {
  readonly ok: false;
  readonly reason: ContainersFailureReason;
  readonly message: string;
  readonly exitCode?: number;
}

/** 执行所需的最小依赖 */
export interface ContainersExecDeps {
  readonly executor: Executor;
  readonly distros: readonly WslDistro[];
  /** 目标发行版的**权威名**（由调用方现解析，本模块不猜） */
  readonly distro: string;
}

export function containersActionArgv(containerId: string, action: ContainersAction): readonly string[] {
  return ['docker', action, containerId];
}

export function containersLogsArgv(containerId: string, tail: number): readonly string[] {
  return ['docker', 'logs', '--tail', String(tail), containerId];
}

const PERMISSION_DENIED = /permission denied|access is denied/i;
const DAEMON_DOWN = /cannot connect to the docker daemon|is the docker daemon running|docker daemon is not running/i;

/** 把 001 的错误码 + docker 的 stderr 归成一个可区分原因（与 010 的 `classify` 同构） */
export function classifyContainersFailure(
  error: { code: string; message: string; stderr?: string | undefined; exitCode?: number | undefined },
  verb: string,
): ContainersFailure {
  switch (error.code) {
    case 'CommandNotFound':
      return { ok: false, reason: 'wsl-missing', message: `找不到 wsl.exe：WSL 可能未安装（${error.message}）` };
    case 'DistroNotFound':
      return { ok: false, reason: 'distro-missing', message: `目标发行版不存在（${error.message}）` };
    case 'DistroNotRunning':
      return { ok: false, reason: 'distro-not-running', message: `目标发行版当前未运行，${verb}没有执行（不在后台替你冷启动）` };
    case 'Timeout':
      return { ok: false, reason: 'timeout', message: `${verb}在超时内没有返回（${error.message}）` };
    case 'NonZeroExit':
      return {
        ok: false,
        reason: 'non-zero-exit',
        message: `${verb}失败（退出码 ${String(error.exitCode ?? '?')}）：${(error.stderr ?? '').trim() || error.message}`,
        ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
      };
    default:
      break;
  }
  const stderr = error.stderr ?? '';
  if (PERMISSION_DENIED.test(stderr)) {
    return { ok: false, reason: 'permission-denied', message: '没有权限访问 docker 守护进程（/var/run/docker.sock 需要 docker 组权限）' };
  }
  if (DAEMON_DOWN.test(stderr)) {
    return { ok: false, reason: 'daemon-down', message: 'docker 已安装但守护进程没在运行' };
  }
  return { ok: false, reason: 'unexpected', message: `${verb}失败：${error.message}` };
}

/** 用户点了「启动 / 停止 / 重启」⇒ 调这里；**恰好一次** docker 调用，不重试 */
export async function runContainersAction(
  deps: ContainersExecDeps,
  containerId: string,
  action: ContainersAction,
): Promise<{ readonly ok: true; readonly argv: readonly string[] } | ContainersFailure> {
  const outcome = await execInDistro(deps.executor, deps.distro, deps.distros, containersActionArgv(containerId, action), {
    timeoutMs: CONTAINERS_WRITE_TIMEOUT_MS,
  });
  if (!outcome.ok) return classifyContainersFailure(outcome, `docker ${action}`);
  return { ok: true, argv: [...outcome.argv] };
}

/** 用户点了「日志」⇒ `docker logs --tail <N>`（`N` 夹紧到 1..200），**只返回字符串** */
export async function readContainersLogs(
  deps: ContainersExecDeps,
  containerId: string,
  tail: unknown,
): Promise<{ readonly ok: true; readonly tail: number; readonly text: string } | ContainersFailure> {
  const effective = clampLogTail(tail);
  const outcome = await execInDistro(deps.executor, deps.distro, deps.distros, containersLogsArgv(containerId, effective), {
    timeoutMs: CONTAINERS_LOGS_TIMEOUT_MS,
  });
  if (!outcome.ok) return classifyContainersFailure(outcome, 'docker logs');
  return { ok: true, tail: effective, text: outcome.stdout };
}
