/**
 * `netsh interface portproxy show v4tov4` 只读探针（003 T1.2 / REQ-3.2 / REQ-3.5）
 *
 * 解析在 `read/netsh.ts`（T0.1 已落地，19 条真机规则一条不少）；本文件只负责
 * 「经 001 执行器取字节 → 解码 → 交给解析器 → 把失败说清楚」。
 *
 * ## 为什么这条命令**不需要提权**
 *
 * `show` 是只读查询：本机 DSH 进程非管理员也能跑（写规则才要 UAC，那在 005）。
 * 故这里是「零提权」路径 —— NFR-2（打开页面零副作用）靠它成立。
 *
 * ## 编码：本机实测**纯 ASCII**（A-2 定案）
 *
 * 高位字节占比 0%、表头英文 `Listen on ipv4:`、行尾 CRLF ⇒ 用 `utf8` 声明即可。
 * 但**解码仍集中在 `decodeNetshOutput()` 一处**：将来遇到 OEM 代码页的机器只改那一个函数
 * （001 的 `exec` 要求调用方**显式**声明编码，不许猜；这里声明的是「本机已实测的那个」）。
 *
 * ## 失败语义（REQ-3.5）
 *
 * 「解析失败」与「命令失败」是两种事实，各自有 reason；解析失败时**必须**把**脱敏后**的
 * 原始输出交出来（否则用户只会看到「解析失败」四个字，无从下手）。
 * 本组件绝不猜结果 —— 这份数据是 005 的写路径「他人规则条数不变」的比对基准，
 * 静默丢一行就等于让那条红线失去意义。
 */

import type { Executor } from 'dsh-wsl-shared';

import { parsePortproxyTable, type PortproxyRule } from './netsh.ts';
import { probeFailure, type ProbeFailure } from './probe.ts';
import { redactOutput } from './redact.ts';

/** Windows 侧执行的 argv（`netsh.exe` 由执行器作为 `file` 传入，无 shell、argv 数组下发） */
export const NETSH_ARGV = ['interface', 'portproxy', 'show', 'v4tov4'] as const;

/**
 * 硬超时。本机实测这条命令是**毫秒级**的（纯本地系统调用，无 WSL 参与、不冷启动任何东西）；
 * 5s 只是防「netsh 挂住」的兜底 —— 019 条规则量级下它不可能慢。
 */
export const NETSH_TIMEOUT_MS = 5_000;

export type NetshProbeReason = 'netsh-missing' | 'timeout' | 'non-zero-exit' | 'parse-error' | 'unexpected';

export interface PortproxySuccess {
  readonly ok: true;
  readonly rules: readonly PortproxyRule[];
  /** 实际执行的完整命令行（含 `netsh.exe`），供 UI 展示「将执行什么」 */
  readonly argv: readonly string[];
}

export type PortproxyOutcome = PortproxySuccess | ProbeFailure<NetshProbeReason>;

export interface NetshProbeOptions {
  /** 覆盖超时（默认 `NETSH_TIMEOUT_MS`） */
  readonly timeoutMs?: number;
}

/**
 * 读一次实际集（成功 = 规则数组，**空数组 = 本机确实没有任何 portproxy 规则**）。
 *
 * 注意「空数组」与「失败」的区别：解析器在**找不到分隔线**时返回 `[]`（无规则的表就是这样），
 * 而命令失败或形状脏一律是 `ok: false` —— 这两件事在 UI 上必须是两种画面（REQ-1.3 的同源口径）。
 */
export async function probePortproxyRules(
  executor: Executor,
  options: NetshProbeOptions = {},
): Promise<PortproxyOutcome> {
  // `netsh.exe` 走的是**裸执行器**（不经过 WSL），故完整命令行要自己拼：
  // 001 的 `ExecResult` 不带 `argv`（那是 `DistroExecResult` 才有的字段），
  // 而 UI 要展示「将执行什么」⇒ 在这里拼出来，不靠下游猜。
  const argv = ['netsh.exe', ...NETSH_ARGV];
  const outcome = await executor('netsh.exe', NETSH_ARGV, {
    encoding: 'utf8',
    timeoutMs: options.timeoutMs ?? NETSH_TIMEOUT_MS,
  });

  if (!outcome.ok) {
    switch (outcome.code) {
      case 'CommandNotFound':
        return probeFailure({
          reason: 'netsh-missing',
          message: `找不到 netsh.exe（${outcome.message}）`,
          hint: 'netsh 是 Windows 自带组件；若真的缺失，说明系统组件被裁剪过',
          cause: outcome,
          argv: outcome.argv ?? null,
        });
      case 'Timeout':
        return probeFailure({
          reason: 'timeout',
          message: `netsh 在超时内没有返回（${outcome.message}）`,
          hint: '重试一次；持续超时请在命令行手工执行 netsh interface portproxy show v4tov4 看是否也挂住',
          cause: outcome,
          argv: outcome.argv ?? null,
        });
      default:
        return probeFailure({
          reason: outcome.code === 'NonZeroExit' ? 'non-zero-exit' : 'unexpected',
          message: `读取 portproxy 规则失败（${outcome.message}）`,
          hint: '展开原始输出看 stderr',
          cause: outcome,
          argv: outcome.argv ?? null,
        });
    }
  }

  try {
    const rules = parsePortproxyTable(outcome.stdout);
    return { ok: true, rules, argv };
  } catch (error) {
    return probeFailure({
      reason: 'parse-error',
      message: `portproxy 输出形态不可识别：${error instanceof Error ? error.message : String(error)}`,
      hint: '展开原始输出核对（本插件不猜结果：静默丢行会让「他人规则条数不变」这条红线失真）',
      raw: redactOutput(outcome.stdout),
      argv,
    });
  }
}
