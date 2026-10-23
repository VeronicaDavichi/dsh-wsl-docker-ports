/**
 * WSL **监听表**探针（013 REQ-1.1/1.5）—— `ss -ltn` 一次拿全表
 *
 * ## 为什么是 `ss -ltn`，又为什么只跑一条命令
 *
 * 「端口上到底有没有服务在跑」是**内核事实**（监听套接字表），与 docker 是否映射无关：
 * 主人用 `python -m http.server 3306` 起服务时，规则是**真在工作**的，旧判据
 * （`no-docker-mapping`）却会把它归成「多余」。`ss` 正是读这张表的工具。
 *
 * REQ-1.5 明确：**一次 `ss -ltn` 拿全表**，不许逐端口开进程（19 条规则 = 19 次 `wsl -d`，
 * 每次热路径 ~200ms，冷路径还会把发行版拖住）。故本探针的产物是**整张表**，
 * 由 `diff/engine.ts` 在纯函数里按 `connectPort` 查。
 *
 * ## 为什么用 argv 数组、不带 `bash -lc`
 *
 * 001 的 `execInDistro`（REQ-5.2）按 **argv 数组**直接下发、经 `wsl.exe -d <distro> --` 执行，
 * **无 shell** ⇒ 不存在引号/转义问题，也不会把用户的 shell 配置（profile）拉进这条读路径。
 * `/usr/sbin` 在 Ubuntu 的默认 PATH 里，普通用户也能读全机的监听表（无需 root）。
 *
 * ## 失败**绝不**当作「没有监听」（REQ-1.3）
 *
 * 失败返回 `ProbeFailure`，`reason` 可区分：WSL 没装 / 发行版不存在 / 发行版没在跑（**不冷启动**）/
 * `ss` 不可用 / 超时 / 非零退出 / 输出形态不可识别。上游据此把受管端口显示成「未知」，
 * **不是**「多余」——「读不到」与「确实没人监听」在 UI 上必须是两种画面。
 *
 * ⚠️ 空输出也按 `parse-error` 处理：`ss -ltn` 即使一个监听都没有也会打表头，**0 字节只能是
 * 读被截断**（与 `docker-probe.ts` 的「空输出必须复核」同一取向：宁可报读失败，不许冒充空表）。
 */

import { execInDistro } from 'dsh-wsl-shared';
import type { Executor, WslDistro, WslSharedError } from 'dsh-wsl-shared';

import type { ListenerEntry } from './listeners.ts';
import { parseSsListeners } from './listeners.ts';
import { probeFailure, type ProbeFailure } from './probe.ts';
import { redactOutput } from './redact.ts';

/**
 * ⚠️ **纯解析面住在 `./listeners.ts`**（013 拆分）：判决引擎经 `write/index.ts` 的运行时再导出
 * 已经在客户端 chunk 图里，若它直接 import 本文件，就会把 `execInDistro`（`node:child_process`）
 * 拖进浏览器 bundle。这里只再导出，方便宿主侧调用方一处取齐。
 */
export { isEth0Bind, isLoopbackBind, isWildcardBind, parseSsListeners } from './listeners.ts';
export type { ListenerEntry, ListenerTable } from './listeners.ts';

/** 发行版内执行的 argv（`wsl.exe -d <distro> --` 由 001 的 `execInDistro` 前置） */
export const LISTENERS_ARGV = ['ss', '-ltn'] as const;

/**
 * 热路径硬超时（REQ-1.5）。`ss` 本身是毫秒级；10s 与 docker 探针取同一个数量级。
 *
 * ⚠️ 冷启动（`allowColdStart: true`，只出现在「启动并核验」）**不传**这个值，
 * 让 001 的 `execInDistro` 用它的 30s 冷启动默认值 —— 否则刚唤醒时的第一次执行
 * 会被 10s 砍掉，用户会看到一个假的「未知」。
 */
export const LISTENERS_TIMEOUT_MS = 10_000;

export type ListenersProbeReason =
  | 'wsl-missing'
  | 'distro-missing'
  | 'wsl-stopped'
  | 'ss-missing'
  | 'timeout'
  | 'non-zero-exit'
  | 'parse-error'
  | 'unexpected';

export interface ListenersSuccess {
  readonly ok: true;
  readonly entries: readonly ListenerEntry[];
  /** 实际执行的完整命令行（含 `wsl.exe`），供 UI 展示「将执行什么」 */
  readonly argv: readonly string[];
}

export type ListenersOutcome = ListenersSuccess | ProbeFailure<ListenersProbeReason>;

export interface ListenersProbeOptions {
  /** 覆盖超时（默认 `LISTENERS_TIMEOUT_MS`） */
  readonly timeoutMs?: number;
  /**
   * ⚠️ **只允许在用户显式动作时传 true**（001 REQ-2.4 / 003 REQ-6.4）。
   * 传 true = 这次调用可能**冷启动发行版**（实测 12,637ms，并拉起 WSL 内全部服务）。
   */
  readonly allowColdStart?: boolean;
}

/**
 * 引擎只需要「成功表 / 失败」两态 ⇒ 最小输入类型（**定义在 `./listeners.ts`**，此处只再导出）。
 */

/** 001 的错误码 → **可区分**的领域原因（REQ-1.3：失败不许糊成一句「读不到」） */
function classifyFailure(error: WslSharedError, distro: string): { reason: ListenersProbeReason; message: string; hint: string } {
  switch (error.code) {
    case 'CommandNotFound':
      return {
        reason: 'wsl-missing',
        message: `找不到 wsl.exe：WSL 可能未安装（${error.message}）`,
        hint: '安装 WSL：在管理员 PowerShell 里执行 wsl --install，然后重启',
      };
    case 'DistroNotFound':
      return {
        reason: 'distro-missing',
        message: `发行版「${distro}」不存在（${error.message}）`,
        hint: '用 wsl -l -v 查看本机已安装的发行版，并在配置里改正 distro',
      };
    case 'DistroNotRunning':
      return {
        reason: 'wsl-stopped',
        message: `发行版「${distro}」当前未运行（${error.message}）`,
        hint: '读监听表**不会**冷启动发行版；需要时点「启动并核验」（约 10–12 秒，会拉起 WSL 内全部服务）',
      };
    case 'Timeout':
      return {
        reason: 'timeout',
        message: `ss -ltn 在超时内没有返回（${error.message}）`,
        hint: '点刷新重试；唤醒后第一次执行偶尔会被拖慢（docker 探针实测过同一现象）',
      };
    default:
      break;
  }

  const stderr = error.stderr ?? '';
  if (error.exitCode === 127 || /command not found|execvpe|no such file|not recognized/i.test(stderr)) {
    return {
      reason: 'ss-missing',
      message: `发行版里没有可用的 sysstat（ss）—— 监听表读不到（${error.message}）`,
      hint: `在「${distro}」里安装 iproute2：sudo apt-get update && sudo apt-get install -y iproute2`,
    };
  }
  if (error.code === 'NonZeroExit') {
    return {
      reason: 'non-zero-exit',
      message: `ss -ltn 以非零退出码结束（${error.message}）`,
      hint: '展开原始输出看 stderr；本插件不会把这次失败当成「没有服务」',
    };
  }
  return {
    reason: 'unexpected',
    message: `读取 WSL 监听表时出现未预期的失败（${error.message}）`,
    hint: '展开原始输出与日志排查',
  };
}

/**
 * 读一次 WSL 监听表。
 *
 * 成功 = 整张表（**空数组**只在「真的一个 LISTEN 都没有」时出现）；
 * 失败 = 可区分的原因，**绝不**返回空数组冒充成功（REQ-1.3）。
 */
export async function probeListeners(
  executor: Executor,
  distro: string,
  distros: readonly WslDistro[],
  options: ListenersProbeOptions = {},
): Promise<ListenersOutcome> {
  // 显式拼可选字段（`exactOptionalPropertyTypes` 下「值为 undefined」与「字段不存在」是两回事）
  const coldStart = options.allowColdStart === true;
  const timeoutMs = options.timeoutMs ?? (coldStart ? undefined : LISTENERS_TIMEOUT_MS);
  const call: { timeoutMs?: number; allowColdStart?: boolean } = {};
  if (timeoutMs !== undefined) call.timeoutMs = timeoutMs;
  if (options.allowColdStart !== undefined) call.allowColdStart = options.allowColdStart;

  const outcome = await execInDistro(executor, distro, distros, LISTENERS_ARGV, call);
  if (!outcome.ok) {
    const classified = classifyFailure(outcome, distro);
    return probeFailure({
      reason: classified.reason,
      message: classified.message,
      hint: classified.hint,
      cause: outcome,
      argv: outcome.argv ?? null,
    });
  }

  if (outcome.stdout.trim().length === 0) {
    return probeFailure({
      reason: 'parse-error',
      message: 'ss -ltn 的输出为空：即使没有任何监听，ss 也会打表头 ⇒ 这次读取被截断了',
      hint: '点刷新重试；持续为空请手工执行 wsl -d <distro> -- ss -ltn 核对',
      raw: '',
      argv: outcome.argv,
    });
  }

  try {
    return { ok: true, entries: parseSsListeners(outcome.stdout), argv: outcome.argv };
  } catch (error) {
    return probeFailure({
      reason: 'parse-error',
      message: `ss -ltn 的输出形态不可识别：${error instanceof Error ? error.message : String(error)}`,
      hint: '展开原始输出核对（本插件不猜结果：静默丢一行会把「有服务」误判成「没有」）',
      raw: redactOutput(outcome.stdout),
      argv: outcome.argv,
    });
  }
}
