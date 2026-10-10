/**
 * 防火墙规则名只读探针（008 T2.6 / 005 REQ-2.6）
 *
 * ## 为什么必须有这一件（008 补的既有缺口）
 *
 * 005 的 `write/plan.ts` 早就有 `existingFirewallNames` 这一门（同名冲突 ⇒ `firewall-rule-exists`
 * 拦下），可**没有任何读取件**喂它 ⇒ 生产上这一门从来没启用过。后果是**真实缺陷**：
 * 重复 `apply` 同一个端口时，`Add-NetFirewallRule` 会再建一条**同名**规则（Windows 允许
 * `DisplayName` 重名），而回滚只删「本轮刚建的那一条」⇒ **用户机器上留下残余规则**，
 * 且第二条规则与第一条的 `-LocalPort` 相同时语义还看不出来（用户以为只有一条）。
 *
 * ## 只读、零提权、零写入（红线）
 *
 * 只有 `Get-NetFirewallRule`（+ `Where-Object` / `Select-Object` 两个管道内建）。**没有**
 * `New-` / `Set-` / `Remove-` / `Enable-` / `Disable-NetFirewallRule`，**没有** `netsh`，
 * 也**不碰**用户的既有规则 —— 已经同名的规则只能由用户在 UI 知情后自己处理。
 * 读防火墙配置**不需要管理员**（普通用户可读）⇒ 本探针与提权链完全无关。
 *
 * ## 🔴 读失败**必须抛**，绝不当「没有规则」
 *
 * 「读不到」与「确实没有」是两件事。把前者当后者 ⇒ 存在性闸门失效 ⇒ 又去叠一条同名规则
 * （正是本件要修的那个缺陷）。故：解析/进程层面的失败一律
 * `ok:false`（`ProbeFailure`），接线层（`wire-plugin.ts`）把它**抛成异常** ⇒
 * `plan.ts` / `apply.ts` 回 `rules-unavailable`（503 / 拒绝执行），**零提权、零写入**。
 * 只有「进程成功且输出为空」才是事实 `[]`。
 *
 * ## 形态不可识别 ⇒ 也判失败（不猜）
 *
 * `-like 'dsh-wsl-docker-ports-*'` 已经把结果限定成我们自己的命名空间，所以**任何**不以
 * `dsh-wsl-docker-ports-` 开头的非空行都说明 stdout 里有别的东西（PowerShell 报错文案、
 * 进度流、别的语言环境的本地化噪声）⇒ `parse-error`，不把垃圾过滤掉假装读成功了。
 */

import type { Executor } from 'dsh-wsl-shared';

import { FIREWALL_NAME_PREFIX } from '../write/firewall.ts';
import { probeFailure } from './probe.ts';
import type { ProbeFailure } from './probe.ts';
import { redactOutput } from './redact.ts';

/** 本插件的命名空间前缀（与 005 `write/firewall.ts` 同源：`firewallRuleName(port)` = `${前缀}-${port}`） */
const PREFIX_LOWER = `${FIREWALL_NAME_PREFIX.toLowerCase()}-`;

/** 只读过滤式（`Get-NetFirewallRule` 的 `DisplayName` 通配） */
export const FIREWALL_NAME_FILTER = `${FIREWALL_NAME_PREFIX}-*`;

/** PowerShell 探针的超时（只读枚举，通常 tens of ms；15s 只是兜底） */
export const FIREWALL_PROBE_TIMEOUT_MS = 15_000;

/**
 * 只读命令文本（**唯一构造点**：脚本与测试都从这里取，避免两处各写一份口径）。
 *
 * 为什么不带 `-ErrorAction Stop`：`Get-NetFirewallRule` 读不到时（服务被停等）会写错误流并
 * 非 0 退出 ⇒ 已被 `non-zero-exit` 分支覆盖；此处保持最朴素的只读形态，便于人核对。
 */
export function firewallProbeScript(filter: string = FIREWALL_NAME_FILTER): string {
  return `Get-NetFirewallRule | Where-Object DisplayName -like '${filter}' | Select-Object -ExpandProperty DisplayName`;
}

/** `powershell.exe` 的参数（`-Command` 后即上面的只读脚本） */
export const FIREWALL_PS_ARGV: readonly string[] = ['-NoProfile', '-NonInteractive', '-Command', firewallProbeScript()];

const POWERSHELL = 'powershell.exe';

/** 失败原因（与 003 的探针同一形态：可区分、可诊断，**不合并成一句「失败了」**） */
export type FirewallProbeReason = 'powershell-missing' | 'timeout' | 'non-zero-exit' | 'parse-error' | 'unexpected';

export interface FirewallProbeOptions {
  readonly timeoutMs?: number;
}

export interface FirewallProbeSuccess {
  readonly ok: true;
  /** 机器上真实存在的、本插件命名空间的规则名；**空数组 = 确实一条都没有**（不是「读不到」） */
  readonly names: readonly string[];
  readonly argv: readonly string[];
}

export type FirewallNamesOutcome = FirewallProbeSuccess | ProbeFailure<FirewallProbeReason>;

/**
 * 解析 `Select-Object -ExpandProperty DisplayName` 的输出：一行一个规则名。
 *
 * 空行（含 CRLF 产生的空行）忽略；非空前缀不符 ⇒ 抛（由调用方转成 `parse-error`）。
 */
export function parseFirewallNames(stdout: string): readonly string[] {
  const names: string[] = [];
  for (const raw of stdout.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.toLowerCase().startsWith(PREFIX_LOWER)) {
      throw new Error(`输出里出现了不属于本插件的行（既不是 ${FIREWALL_NAME_PREFIX}-* 也不是空行）：${line}`);
    }
    names.push(line);
  }
  return names;
}

/** 只读探测：现读机器上本插件命名空间的防火墙规则名（失败**不抛**，返回可区分的 `ok:false`） */
export async function probeFirewallRuleNames(
  executor: Executor,
  options: FirewallProbeOptions = {},
): Promise<FirewallNamesOutcome> {
  const timeoutMs = options.timeoutMs ?? FIREWALL_PROBE_TIMEOUT_MS;
  const outcome = await executor(POWERSHELL, FIREWALL_PS_ARGV, { encoding: 'utf8', timeoutMs });
  if (!outcome.ok) {
    // 001 的执行器把「非 0 退出」也报成错误（`code: 'NonZeroExit'`）⇒ 三种进程层原因都要按它自己的码分开报
    const reason: FirewallProbeReason =
      outcome.code === 'CommandNotFound'
        ? 'powershell-missing'
        : outcome.code === 'Timeout'
          ? 'timeout'
          : outcome.code === 'NonZeroExit'
            ? 'non-zero-exit'
            : 'unexpected';
    return probeFailure({
      reason,
      message: `读取防火墙规则名失败（${reason}）：${outcome.message}`,
      hint: '本探针只读（Get-NetFirewallRule）；读不到就无法确认同名规则是否已存在 ⇒ 写路径会拒绝执行，不会去叠第二条同名规则。',
      cause: outcome,
      raw: redactOutput(outcome.stderr ?? ''),
      argv: outcome.argv ?? null,
    });
  }
  const exitCode = outcome.exitCode ?? 0;
  if (exitCode !== 0) {
    return probeFailure({
      reason: 'non-zero-exit',
      message: `读取防火墙规则名失败：powershell 退出码 ${String(exitCode)}（本探针是只读的 —— 非 0 退出说明查询本身没成功）。`,
      hint: '检查 Windows 防火墙服务（mpssvc）是否在跑，以及当前用户是否有权读取防火墙配置；修好后重试。',
      raw: redactOutput(outcome.stderr === '' ? outcome.stdout : outcome.stderr),
      argv: [POWERSHELL, ...FIREWALL_PS_ARGV],
    });
  }
  try {
    const names = parseFirewallNames(outcome.stdout);
    return { ok: true, names, argv: [POWERSHELL, ...FIREWALL_PS_ARGV] };
  } catch (error) {
    return probeFailure({
      reason: 'parse-error',
      message: `读取防火墙规则名失败：输出形态不可识别（${error instanceof Error ? error.message : String(error)}）`,
      hint: '把「读不懂的输出」当「没有规则」会让存在性闸门失效 ⇒ 这里判失败，写路径据此拒绝执行。',
      raw: redactOutput(outcome.stdout),
      argv: [POWERSHELL, ...FIREWALL_PS_ARGV],
    });
  }
}
