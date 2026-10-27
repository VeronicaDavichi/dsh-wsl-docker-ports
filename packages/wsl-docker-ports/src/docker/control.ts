/**
 * 容器动作与日志的**执行面**（010 `T7.1` / `T7.2`）—— 纯 argv + 001 的 `execInDistro`，不碰文件。
 *
 * ## 三条硬口径
 *
 * 1. **argv 数组、无 shell**（001 `REQ-5.2` 同源）：容器 id 走白名单校验（`./wire.ts`），
 *    不做字符串拼接，也就不存在「id 里带空格/分号」的注入面。
 * 2. **写动作不重试**（010 design §2）：`start|stop|restart` 的语义不幂等，失败就如实回报，
 *    重试由用户重新点。日志是只读 ⇒ 同样不重试（少一次进程，少一分唤醒代价）。
 * 3. **日志只进内存**（`REQ-11.3` / `REQ-P1-3`）：本模块**没有** `node:fs` 的 import
 *    （`tests/unit/docker-logs.test.ts` 逐字断言），调用方拿到的是字符串，落不落盘由更上层决定
 *    —— 而更上层（`./route.ts` → HTTP 响应）也只是写进响应体。
 *
 * ## 与只读面（003）的关系
 *
 * 只用 001 的 `execInDistro` + 003 的失败态命名（`read/probe.ts` 的 `ProbeFailure` 形状）；
 * **不 import** `read/**` 之外的东西，也不改 003 的任何一行。
 */

import { execInDistro } from 'dsh-wsl-shared';
import type { Executor, WslDistro } from 'dsh-wsl-shared';

import { clampLogTail, type ContainerAction } from './wire.ts';

/** 容器动作的硬超时：`stop` 要等容器优雅退出（默认 10s），留一倍余量 */
export const CONTAINER_WRITE_TIMEOUT_MS = 30_000;
/** 日志的硬超时：`--tail 200` 是**有界**读取，不该慢；超过就是异常 */
export const CONTAINER_LOGS_TIMEOUT_MS = 15_000;

/**
 * 失败原因（可区分 + 可读 + 不冒充成功）：
 * 与 003 `DockerProbeReason` 的命名保持一致，但**独立的类型**（容器动作用的判据不该从只读面继承）。
 */
export type ContainerFailureReason =
  | 'wsl-missing'
  | 'distro-missing'
  | 'distro-not-running'
  | 'timeout'
  | 'non-zero-exit'
  | 'permission-denied'
  | 'daemon-down'
  | 'unexpected';

export interface ContainerFailure {
  readonly ok: false;
  readonly reason: ContainerFailureReason;
  readonly message: string;
  /** 只有 `non-zero-exit` 才有（docker 的退出码） */
  readonly exitCode?: number;
}

/** 执行所需的最小依赖（测试注入 fake `Executor` / 固定发行版列表） */
export interface ContainerExecDeps {
  readonly executor: Executor;
  readonly distros: readonly WslDistro[];
  /** 目标发行版的**权威名**（由调用方经 `resolveTarget` 现解析，本模块不猜） */
  readonly distro: string;
}

/** 发行版内的 argv（`wsl.exe -d <distro> --` 由 001 的 `execInDistro` 前置） */
export function containerActionArgv(containerId: string, action: ContainerAction): readonly string[] {
  return ['docker', action, containerId];
}

export function containerLogsArgv(containerId: string, tail: number): readonly string[] {
  return ['docker', 'logs', '--tail', String(tail), containerId];
}

const PERMISSION_DENIED = /permission denied|access is denied/i;
const DAEMON_DOWN = /cannot connect to the docker daemon|is the docker daemon running|docker daemon is not running/i;

/** 把 001 的错误码 + docker 的 stderr 归成一个可区分原因（形状抄 003 `classifyFailure`，语义按容器动作用） */
function classify(error: { code: string; message: string; stderr?: string | undefined; exitCode?: number | undefined }, verb: string): ContainerFailure {
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

/** 用户在页面上点了「启动 / 停止 / 重启」⇒ 调这里；**恰好一次** docker 调用，不重试 */
export async function runContainerAction(
  deps: ContainerExecDeps,
  containerId: string,
  action: ContainerAction,
): Promise<{ readonly ok: true; readonly argv: readonly string[] } | ContainerFailure> {
  const outcome = await execInDistro(deps.executor, deps.distro, deps.distros, containerActionArgv(containerId, action), {
    timeoutMs: CONTAINER_WRITE_TIMEOUT_MS,
  });
  if (!outcome.ok) return classify(outcome, `docker ${action}`);
  return { ok: true, argv: [...outcome.argv] };
}

/** 用户点了「日志」⇒ `docker logs --tail <N>`（`N` 夹紧到 1..200），**只返回字符串** */
export async function readContainerLogs(
  deps: ContainerExecDeps,
  containerId: string,
  tail: unknown,
): Promise<{ readonly ok: true; readonly tail: number; readonly text: string } | ContainerFailure> {
  const effective = clampLogTail(tail);
  const outcome = await execInDistro(deps.executor, deps.distro, deps.distros, containerLogsArgv(containerId, effective), {
    timeoutMs: CONTAINER_LOGS_TIMEOUT_MS,
  });
  if (!outcome.ok) return classify(outcome, 'docker logs');
  return { ok: true, tail: effective, text: outcome.stdout };
}
