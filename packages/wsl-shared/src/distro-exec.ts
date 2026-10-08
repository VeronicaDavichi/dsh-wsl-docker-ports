/**
 * 带守卫的「发行版内执行」（001 设计 §3.2 的公共底座，T3.4，2026-10-08 主人拍板新增）
 *
 * ## 为什么要单独成件
 *
 * **REQ-2.4 的「非 Running 绝不唤醒」不能有两份实现。** 本包与消费方要跑的命令不止一条
 * （eth0 探测；003 读层的 `docker ps`、`hostname -I` …），每条都得先过同一道守卫 ——
 * 否则守卫逻辑分叉，迟早有人漏掉一次，代价是**静默冷启动**（实测 12,637ms + 拉起用户全部容器）。
 *
 * **准入依据（REQ-6.1：能力要有 ≥ 2 个消费方）**：① eth0 探测（本包）、② 003 的读层。
 *
 * 守卫顺序（与 `net.ts` 一致，实现只在这一处）：
 * **存在性（REQ-2.5）→ 状态（REQ-2.4）→ 执行**。
 */

import { fail, type WslSharedError } from './errors.ts';
import { guardDistroExists, type WslDistro } from './distros.ts';
import type { Executor } from './exec.ts';

/** 热路径默认超时：实测 `wsl -d` 热 **192–237ms** ⇒ 留足 40× 余量 */
export const DISTRO_EXEC_TIMEOUT_MS = 10_000;
/** 显式启动路径默认超时：冷启动实测 **12,637ms**（还会连带拉起 WSL 内服务） */
export const DISTRO_EXEC_COLD_START_TIMEOUT_MS = 30_000;

/** 发行版内执行选项 */
export interface DistroExecOptions {
  /** 覆盖超时；默认按是否允许冷启动取两个常量之一 */
  readonly timeoutMs?: number;
  /**
   * 输出编码，默认 `'utf8'`。
   * ⚠️ Linux 侧命令（`ip` / `docker` / `netsh` 之外的常规工具）是 **UTF-8**；
   * 而 `wsl.exe` **自带消息**（如 `wsl -l -v`）是 **UTF-16LE** —— 要用那个就显式传 `'utf16le'`，
   * **永远不要靠猜**（猜错的后果是静默解析失败）。
   */
  readonly encoding?: string;
  /**
   * ⚠️ **只允许在用户显式动作时传 true**（REQ-2.4 的唯一例外：「启动并核验」/「用这个发行版」）。
   * 传 true 意味着这次调用会**冷启动发行版**（实测 12,637ms，并连带拉起 WSL 内 dockerd 与用户的
   * 全部容器）⇒ 调用方 SHALL 在动作前明示代价。
   */
  readonly allowColdStart?: boolean;
}

/**
 * 成功结果：比 `ExecResult` 多两样**给 UI 用**的东西 ——
 * `distro`（列表里的**权威名字**，不是调用方的大小写写法）与 `argv`（含 `wsl.exe` 的完整命令行，
 * 可直接展示"将执行的命令原文"，005 的提权预览也按这个口径）。
 */
export interface DistroExecResult {
  readonly ok: true;
  readonly exitCode: 0;
  readonly stdout: string;
  readonly stderr: string;
  readonly distro: string;
  readonly argv: readonly string[];
}

/** 结果：成功带 stdout，失败带 typed error（不抛异常） */
export type DistroExecOutcome = DistroExecResult | WslSharedError;

/**
 * 在目标发行版内执行 `argv`（REQ-2.4/2.5 的守卫落点）。
 *
 * `argv` 是**发行版内**的命令（例如 `['ip','-4','-o','addr']`），函数自己前置
 * `['wsl.exe','-d',<权威名>,'--']`；无 shell、argv 数组下发（REQ-5.2）。
 */
export async function execInDistro(
  executor: Executor,
  distro: string,
  distros: readonly WslDistro[],
  argv: readonly string[],
  options: DistroExecOptions = {},
): Promise<DistroExecOutcome> {
  // 空 argv 会让 `wsl -d X --` 变成"打开一个交互式 shell"：既挂到超时，又顺手唤醒发行版 ⇒ 明确拒绝
  if (argv.length === 0) {
    return fail('Unexpected', '发行版内执行需要至少一个命令（空 argv 会让 wsl 打开交互式 shell）');
  }

  // ① REQ-2.5：名字不存在 → DistroNotFound，错误里必须带可用发行版名列表
  const missing = guardDistroExists(distro, distros);
  if (missing !== undefined) return missing;

  // 用列表里的**权威名字**拼 argv（大小写以 WSL 为准，不用调用方的写法）
  const wanted = distro.trim().toLowerCase();
  const row = distros.find((d) => d.name.toLowerCase() === wanted);
  if (row === undefined) {
    // 逻辑上已被 guardDistroExists 拦下；这里只做类型收窄，错误口径保持一致
    return fail('DistroNotFound', `发行版「${distro}」不存在`, {
      distros: distros.map((d) => d.name),
    });
  }

  const allowColdStart = options.allowColdStart === true;
  // ② REQ-2.4：非 Running 直接报错，**不执行**命令（执行即冷启动，实测 12.6s + 拉起用户容器）
  if (!allowColdStart && row.state !== 'Running') {
    return fail(
      'DistroNotRunning',
      `发行版「${row.name}」当前是 ${row.state}，未自动启动（冷启动约 10–12 秒，且会拉起 WSL 内服务）`,
    );
  }

  // ③ 执行：编码默认 utf8（Linux 侧输出），需要 utf16le 的调用方显式声明
  const full = ['-d', row.name, '--', ...argv];
  const outcome = await executor('wsl.exe', full, {
    encoding: options.encoding ?? 'utf8',
    timeoutMs:
      options.timeoutMs ??
      (allowColdStart ? DISTRO_EXEC_COLD_START_TIMEOUT_MS : DISTRO_EXEC_TIMEOUT_MS),
  });
  if (!outcome.ok) return outcome;

  return {
    ok: true,
    exitCode: 0,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    distro: row.name,
    argv: ['wsl.exe', ...full],
  };
}
