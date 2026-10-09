/**
 * `docker ps` 只读探针（003 T1.1 / REQ-2.1–2.5）
 *
 * ## 本文件只做「执行 + 归类失败」，解析在 `read/docker.ts`
 *
 * 分工：`docker.ts` 是**纯解析**（已在 T0.1 落地、11 条契约测试在跑），本文件负责把它接到
 * 001 的执行器上，并把「读失败」说清楚。**不重复实现任何解析逻辑**。
 *
 * ## 三条真机事实决定的实现（T0.1/T0.2 实测，见 `tests/contract/fixtures/README.md`）
 *
 * 1. 🔴 **`--format json` 会挂住**（rc=124，8s 与 15s 各一次，守护进程已热）⇒ 只走
 *    `--format '{{json .}}'`，且**不做**探测式回落（REQ-2.5：探测只会让用户白等一个完整超时）。
 * 2. 🔴 **唤醒后第一次调用会被硬超时砍掉**（跑满 `timeout 20`、**0 输出**；5s 后第二次 637ms 成功）
 *    ⇒ 超时**要重试**；「空输出」也要复核一次才敢当结论（见 `emptyAfterRetry`）。
 * 3. ⚠️ **绝不冷启动发行版**（001 REQ-2.4 / 003 REQ-2.4）：`execInDistro` 会在发行版非 Running 时
 *    直接返回 `DistroNotRunning` 而**不执行命令**；只有用户显式点「启动并核验」才允许传
 *    `allowColdStart: true`（那是 001 REQ-2.4 的唯一例外，代价 10–12 秒且会拉起用户全部容器）。
 *
 * ## 为什么「空输出」不直接判成「没有容器」
 *
 * 真机上「没有运行中的容器」与「这次读被砍掉了」**都是 0 字节输出** —— 单看一次无法分辨。
 * 故：空输出**复核一次**；两次都空才报「确实没有容器」（`emptyAfterRetry: true`）。
 * 若调用方把 `attempts` 设成 1，则 `emptyAfterRetry: false`，UI 就知道这个「空」**没被复核过**。
 * （REQ-1.3「SHALL NOT 用空列表冒充没有容器」的反面同样成立：真没有容器时也不许报成读失败。）
 */

import { execInDistro } from 'dsh-wsl-shared';
import type { Executor, WslDistro, WslSharedError } from 'dsh-wsl-shared';

import { parseDockerPsJsonl, type DockerContainer } from './docker.ts';
import { probeFailure, type ProbeFailure } from './probe.ts';
import { redactOutput } from './redact.ts';

/**
 * 发行版内执行的 argv（**发行版内**的命令；`wsl.exe -d <distro> --` 由 001 的 `execInDistro` 前置）。
 * `{{json .}}` 是单引号里的模板 —— 这里走 argv 数组、无 shell，故不需要引号。
 */
export const DOCKER_PS_ARGV = ['docker', 'ps', '--format', '{{json .}}'] as const;

/**
 * 硬超时（REQ-2.5：每次 docker 调用 SHALL 有硬超时）。
 * 取 10s：本机热路径实测 **637ms**，留 15× 余量；冷启动后的第一次必然超时（那正是要重试的信号）。
 */
export const DOCKER_PS_TIMEOUT_MS = 10_000;

/**
 * 默认尝试次数 = 2（**不是**「重试到成功」）：T0.1 实测唤醒后第一次必被超时砍掉、第二次成功，
 * 所以 2 次覆盖主路径；再多只是让用户在真出问题时多等一个超时。
 */
export const DOCKER_PS_ATTEMPTS = 2;

/**
 * 可区分的失败原因（REQ-2.3：未安装 / daemon 未运行 / 权限不足**必须分别**给出原因与引导）。
 * 其余几项来自「发行版与 WSL 自身的状态」，逐条也都要能区分（REQ-1.3 / REQ-6.4）。
 */
export type DockerProbeReason =
  | 'wsl-missing'
  | 'distro-missing'
  | 'distro-not-running'
  | 'docker-missing'
  | 'daemon-down'
  | 'permission-denied'
  | 'timeout'
  | 'non-zero-exit'
  | 'parse-error'
  | 'unexpected';

export interface DockerPsSuccess {
  readonly ok: true;
  readonly containers: readonly DockerContainer[];
  /** 实际执行的完整命令行（含 `wsl.exe`），供 UI 展示「将执行什么」 */
  readonly argv: readonly string[];
  /** 实际尝试次数（1 = 第一次就成功；2 = 触发过一次重试） */
  readonly attemptCount: number;
  /**
   * `true` = 复核后**仍是** 0 字节输出 ⇒「确实没有运行中的容器」。
   * `false` 且 `containers` 为空 ⇒ 只读到一次空输出、**没有复核**（UI 应提示可重试，不要声称没有容器）。
   */
  readonly emptyAfterRetry: boolean;
}

export type DockerPsOutcome = DockerPsSuccess | ProbeFailure<DockerProbeReason>;

export interface DockerPsOptions {
  /** 覆盖单次超时（默认 `DOCKER_PS_TIMEOUT_MS`） */
  readonly timeoutMs?: number;
  /** 覆盖总尝试次数（默认 `DOCKER_PS_ATTEMPTS`；< 1 会被夹到 1） */
  readonly attempts?: number;
  /**
   * ⚠️ **只允许在用户显式动作时传 true**（REQ-6.4 的「启动并核验」）。
   * 传 true = 这次调用可能**冷启动发行版**（实测 12,637ms，并连带拉起 WSL 内 dockerd 与全部容器）
   * ⇒ 调用方 SHALL 在动作前明示代价。自动刷新路径**永远**不传。
   */
  readonly allowColdStart?: boolean;
}

/** 权限不足（早于 daemon-down 判：docker 那句「permission denied while trying to connect to the Docker daemon socket」两者都像） */
const PERMISSION_DENIED = /permission denied|access is denied/i;
/** daemon 未运行 */
const DAEMON_DOWN = /cannot connect to the docker daemon|is the docker daemon running|docker daemon is not running/i;
/** docker 未安装（bash: `docker: command not found`；sh: `docker: not found`） */
const DOCKER_NOT_FOUND = /command not found|:\s*not found|is not recognized/i;

interface FailureClass {
  readonly reason: DockerProbeReason;
  readonly message: string;
  readonly hint: string;
  /** 只对**瞬时**失败重试（超时）；「没装 docker」重试一百次也一样 */
  readonly retryable: boolean;
}

/** 把 001 的错误码 + docker 自己的 stderr 归成一个**可区分**的原因（REQ-2.3 / REQ-1.3 / REQ-6.4） */
function classifyFailure(error: WslSharedError, distro: string): FailureClass {
  switch (error.code) {
    case 'CommandNotFound':
      return {
        reason: 'wsl-missing',
        message: `找不到 wsl.exe：WSL 可能未安装（${error.message}）`,
        hint: '安装 WSL：在管理员 PowerShell 里执行 wsl --install，然后重启',
        retryable: false,
      };
    case 'DistroNotFound':
      return {
        reason: 'distro-missing',
        message: `发行版「${distro}」不存在（${error.message}）`,
        hint:
          error.distros === undefined || error.distros.length === 0
            ? '用 wsl -l -v 查看本机已安装的发行版，并在配置里改正 distro'
            : `本机已安装：${error.distros.join(' / ')} —— 在配置里改正 distro`,
        retryable: false,
      };
    case 'DistroNotRunning':
      return {
        reason: 'distro-not-running',
        message: `发行版「${distro}」当前未运行 —— 没有自动启动（自动启动会把用户的容器一并拉起）`,
        hint: '点「启动并核验」（唯一允许启动发行版的路径）：约 10–12 秒，会拉起 WSL 内的 dockerd 与全部容器',
        retryable: false,
      };
    case 'Timeout':
      return {
        reason: 'timeout',
        message: `docker ps 在超时内没有返回（${error.message}）`,
        hint: '点刷新重试：实测唤醒后第一次调用会被硬超时砍掉，第二次通常 637ms 就返回',
        retryable: true,
      };
    default:
      break;
  }

  const stderr = error.stderr ?? '';
  if (PERMISSION_DENIED.test(stderr)) {
    return {
      reason: 'permission-denied',
      message: '没有权限访问 docker 守护进程（/var/run/docker.sock 需要 docker 组权限）',
      hint: '在 WSL 里执行 sudo usermod -aG docker $USER，然后 wsl --shutdown 重进发行版',
      retryable: false,
    };
  }
  if (DAEMON_DOWN.test(stderr)) {
    return {
      reason: 'daemon-down',
      message: 'docker 已安装但守护进程没有在运行',
      hint: '在 WSL 里启动它：sudo service docker start（或 sudo systemctl start docker），随后点刷新',
      retryable: false,
    };
  }
  if (DOCKER_NOT_FOUND.test(stderr) || error.exitCode === 127) {
    return {
      reason: 'docker-missing',
      message: 'WSL 发行版里没有 docker（本机实测引擎装在 WSL 内，不是 Docker Desktop）',
      hint: `在「${distro}」里安装：sudo apt-get update && sudo apt-get install -y docker.io`,
      retryable: false,
    };
  }
  if (error.code === 'NonZeroExit') {
    return {
      reason: 'non-zero-exit',
      message: `docker ps 以非零退出码结束（${error.message}）`,
      hint: '展开原始输出看 stderr；常见原因是守护进程未就绪或镜像/存储异常',
      retryable: false,
    };
  }
  return {
    reason: 'unexpected',
    message: `读取 docker 容器列表时出现未预期的失败（${error.message}）`,
    hint: '展开原始输出与日志排查',
    retryable: false,
  };
}

/** 把失败类转成统一失败态（`cause` 保留 001 的原始错误：argv / exitCode / stderr 一个不丢） */
function toProbeFailure(error: WslSharedError, distro: string): ProbeFailure<DockerProbeReason> {
  const classified = classifyFailure(error, distro);
  return probeFailure({
    reason: classified.reason,
    message: classified.message,
    hint: classified.hint,
    cause: error,
    argv: error.argv ?? null,
  });
}

/**
 * 读一次容器列表（成功 = 容器数组；失败 = 可区分的原因，**绝不**返回空数组冒充成功）。
 */
export async function probeDockerPs(
  executor: Executor,
  distro: string,
  distros: readonly WslDistro[],
  options: DockerPsOptions = {},
): Promise<DockerPsOutcome> {
  const attempts = Math.max(1, Math.trunc(options.attempts ?? DOCKER_PS_ATTEMPTS));
  const timeoutMs = options.timeoutMs ?? DOCKER_PS_TIMEOUT_MS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const outcome = await execInDistro(executor, distro, distros, DOCKER_PS_ARGV, {
      timeoutMs,
      allowColdStart: options.allowColdStart === true,
    });

    if (!outcome.ok) {
      const classified = classifyFailure(outcome, distro);
      // 只重试**瞬时**失败；其它原因（没装 docker / 发行版没跑）重试等于让用户白等
      if (classified.retryable && attempt < attempts) continue;
      return toProbeFailure(outcome, distro);
    }

    if (outcome.stdout.trim().length === 0) {
      // 空输出**必须复核**（见文件头）：还有次数就再来一次，没有次数才如实报「未复核的空」
      if (attempt < attempts) continue;
      return {
        ok: true,
        containers: [],
        argv: outcome.argv,
        attemptCount: attempt,
        emptyAfterRetry: attempt >= 2,
      };
    }

    try {
      const containers = parseDockerPsJsonl(outcome.stdout);
      return { ok: true, containers, argv: outcome.argv, attemptCount: attempt, emptyAfterRetry: false };
    } catch (error) {
      // REQ-3.5 同口径：形态不可识别**不许猜**，把脱敏后的原文交出来给人看
      return probeFailure({
        reason: 'parse-error',
        message: `docker ps 的输出无法解析：${error instanceof Error ? error.message : String(error)}`,
        hint: '展开原始输出核对形态（本插件只认 `--format \'{{json .}}\'` 的 JSON Lines）',
        raw: redactOutput(outcome.stdout),
        argv: outcome.argv,
      });
    }
  }

  // 逻辑上不可达：循环里每次迭代都 return 或 continue（continue 只在 attempt < attempts 时）
  return probeFailure({
    reason: 'unexpected',
    message: '内部错误：重试循环没有产生任何结果',
    hint: '',
  });
}
