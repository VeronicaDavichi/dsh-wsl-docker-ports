/**
 * 提权调用的组装（005 T2.2 / T2.3，design §4 的第 6 步）
 *
 * 从 `runner.ts` 拆出来是为了守住「单文件 ≤ 400 行」这条 SHALL；职责也干净：
 * **只做「怎么调」**，不做「调完怎么办」（那是 runner 的编排）。
 *
 * ## 三条后端的调用形态
 *
 * | 后端 | file | 回传 |
 * |---|---|---|
 * | `gsudo` | `where.exe gsudo` 给出的**绝对路径** | stdio（REQ-3.4 ①）|
 * | `native` | `powershell.exe` + `Start-Process -Verb RunAs -Wait -PassThru` | 临时 out 文件（完整性级别不同，无法管道回读）|
 * | `winsudo` | `%SystemRoot%\System32\sudo.exe`（**只在显式配置时**）| 临时 out 文件，未验证（24H2+）|
 *
 * ## 注入面为零
 *
 * 被插值的值全部来自 `assertScriptParams` 校验过的字段（动作 ∈ 白名单、端口是数字、
 * 地址是 IPv4、路径是本插件生成的临时产物），模板本身是固定文本 ——
 * 没有「命令字符串拼接用户输入」这一步。
 */

import type { WriteAction } from '../write/types.ts';

import { windowsSudoPath } from './backend.ts';
import type { BackendChoice, ScriptAction, ScriptParams } from './types.ts';

/** 默认超时 90s（design §4：UAC 弹窗等待由用户决定，超时按失败处理，REQ-3.5） */
export const DEFAULT_ELEVATE_TIMEOUT_MS = 90_000;

/** 用户拒绝 UAC 时 `Start-Process` 抛错的常见原文（中英两版；不赌本地化） */
const UAC_CANCEL_PATTERNS: readonly RegExp[] = [
  /cancel(?:l)?ed by the user/i,
  /the operation was canceled/i,
  /用户取消/,
  /操作已被用户取消/,
  /此操作被用户取消/,
];

/**
 * 是不是「用户拒绝 UAC / 脚本根本没跑起来」。
 * 判据：**没有任何回传 JSON**（脚本一次都没走到 `Complete`）且（输出命中取消文案 或 退出码非 0）。
 * 有回传 JSON 就说明脚本跑到了终点 —— 那时归退出码表管，绝不误判成取消（T2.3）。
 */
export function looksLikeUacRejection(
  exitCode: number | null,
  stdout: string,
  stderr: string,
  hasPayload: boolean,
): boolean {
  if (hasPayload) return false;
  const text = `${stdout}\n${stderr}`;
  if (UAC_CANCEL_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return exitCode !== null && exitCode !== 0;
}

/** 规划动作 → 脚本白名单动作 + 脚本作用域（`switch-scope` 的两个方向各映射到一个白名单动作） */
export function scriptCallFor(plan: {
  readonly action: WriteAction;
  readonly scope: 'loopback' | 'lan';
}): { readonly action: ScriptAction; readonly scope: 'loopback' | 'lan' } {
  if (plan.action !== 'switch-scope') return { action: plan.action, scope: plan.scope };
  // 切到 lan：add（0.0.0.0 + 放行）；切回 loopback：remove **以 lan 作用域**执行 ——
  // 这样脚本删的是 0.0.0.0 那条，并连带删掉本插件建的防火墙规则（REQ-2.4）
  return plan.scope === 'lan' ? { action: 'add', scope: 'lan' } : { action: 'remove', scope: 'lan' };
}

/**
 * native 后端的 `-Command` 载荷：`Start-Process -Verb RunAs -Wait -PassThru` 后把子进程退出码
 * 透传给主机（用户点「否」时 `Start-Process` 抛错 ⇒ 退出码非 0 且没有回传 ⇒ `cancelled`）。
 */
export function buildNativeCommand(scriptPath: string, args: readonly string[]): string {
  const quoted = [scriptPath, ...args].map((token) => `'${token}'`).join(', ');
  return (
    `$p = Start-Process -FilePath 'powershell.exe' ` +
    `-ArgumentList @(${quoted}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode`
  );
}

export interface ElevateInvocation {
  readonly file: string;
  readonly argv: readonly string[];
}

/** 按后端组装 argv（gsudo 走 stdio；native 走 Start-Process + out 文件；winsudo 显式配置才用） */
export function buildInvocation(
  choice: BackendChoice,
  params: ScriptParams,
  args: readonly string[],
  systemRoot: string,
): ElevateInvocation {
  const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', params.scriptPath, ...args];
  switch (choice.backend) {
    case 'gsudo':
      return { file: choice.gsudoPath ?? 'gsudo.exe', argv: ['powershell.exe', ...psArgs] };
    case 'winsudo':
      return { file: windowsSudoPath(systemRoot), argv: ['powershell.exe', ...psArgs] };
    case 'native':
      return {
        file: 'powershell.exe',
        argv: ['-NoProfile', '-NonInteractive', '-Command', buildNativeCommand(params.scriptPath, args)],
      };
  }
}
