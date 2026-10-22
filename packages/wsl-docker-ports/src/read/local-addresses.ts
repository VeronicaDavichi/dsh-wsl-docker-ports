/**
 * 候选监听地址（Windows 物理网卡 IPv4）—— 012 REQ-1.1 / REQ-2.1
 *
 * ## 为什么需要这一层
 *
 * 在此之前「局域网作用域」的监听地址是**写死的 `0.0.0.0`**（`diff/engine.ts` 的
 * `expectedListenAddress`）：选 lan 就等于对该端口**所有** Windows 网卡开门。真机上用户只
 * 想要 `192.168.31.129` 那一块网卡，于是把「用哪一块」变成一次显式选择。
 *
 * ## 三条硬口径
 *
 * 1. **只读**：一次 `powershell.exe -NoProfile -NonInteractive -Command`，只调
 *    `Get-NetIPAddress`（读 cmdlet，无 `Set-*` / `New-*` / `netsh` 写）。
 * 2. **失败可区分**：`ProbeFailure` 的 reason 与 `read/firewall-probe.ts` 同族
 *    （`powershell-missing` / `timeout` / `non-zero-exit` / `parse-error` / `unexpected`）。
 *    🔴 **失败绝不当成空列表**（那会让页面显示「没有物理网卡」——与「读不到」是两回事）。
 * 3. **纯函数与进程分离**：`isCandidateAddress` / `filterLocalAddresses` 不碰进程，
 *    假执行器就能覆盖全部分支；`probeLocalAddresses` 才需要 `Executor`。
 *
 * ## 候选判据（012 决策 1，逐条可对照）
 *
 * 排除 `127.0.0.0/8`（loopback）、`169.254.0.0/16`（链路本地）、`172.16.0.0/12`
 * （WSL / Hyper-V 虚拟网段），以及别名命中下列词根的网卡（大小写不敏感）：
 * `vEthernet` / `aTrust` / `Tailscale` / `VMware` / `VirtualBox` / `Loopback` / `WSL` /
 * `Bluetooth` / `蓝牙`。本机（2026-10-22 实测）筛完只剩 `192.168.31.129`（别名「以太网 4」）。
 *
 * ## 为什么 `ifAlias` 参与判据而 `prefixLength` 不参与
 *
 * 排除项都是**地址段 + 虚拟网卡**两族；`PrefixLength` 只决定防火墙 `RemoteAddress` 的宽度
 * （见 `write/firewall.ts` 的 `cidrFor`），不决定「这块网卡算不算物理网卡」。
 */

import type { Executor } from 'dsh-wsl-shared';

import { probeFailure } from './probe.ts';
import type { ProbeFailure } from './probe.ts';
import { redactOutput } from './redact.ts';

/** 一条 Windows IPv4 绑定（快照里原样带上别名与掩码长度，供 UI 标出网段宽度） */
export interface LocalAddressEntry {
  readonly address: string;
  readonly ifAlias: string;
  readonly prefixLength: number;
}

/** 硬超时（与 `FIREWALL_PROBE_TIMEOUT_MS` 同量级：一次枚举远快于它） */
export const LOCAL_ADDRESSES_TIMEOUT_MS = 15_000;

/** 分隔符：`ifAlias|address|prefixLength`。别名里不会出现 `|`，解析仍从**右侧**切两刀以防万一 */
const FIELD_SEPARATOR = '|';

/**
 * PowerShell 单行脚本（**唯一构造点**：探针与测试都从这里取，避免两处各写一份）。
 *
 * `$ErrorActionPreference = 'Stop'`：cmdlet 不存在/无权限时让它**终止**（非零退出），
 * 否则会「stderr 有错、stdout 空、退出码 0」—— 那会被误读成「没有任何 IPv4」。
 */
export const LOCAL_ADDRESSES_SCRIPT =
  "$ErrorActionPreference = 'Stop'; " +
  'Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { ' +
  `"$($_.InterfaceAlias)${FIELD_SEPARATOR}$($_.IPAddress)${FIELD_SEPARATOR}$($_.PrefixLength)" }`;

/** argv（**唯一构造点**）：非交互、无 profile、只跑上面那行脚本（与 `FIREWALL_PS_ARGV` 同形 = 不含 exe） */
export const LOCAL_ADDRESSES_PS_ARGV: readonly string[] = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  LOCAL_ADDRESSES_SCRIPT,
];

/** 可执行文件（与 `FIREWALL_PS_ARGV` 的 `POWERSHELL` 同名同义） */
const POWERSHELL = 'powershell.exe';

/** 完整命令行（证据位：进 `argv` 字段的永远是这个，而不是只有参数） */
function argvOf(): readonly string[] {
  return [POWERSHELL, ...LOCAL_ADDRESSES_PS_ARGV];
}

/** 默认超时（可用选项覆盖，测试用来跑「超时」分支） */
export interface LocalAddressesOptions {
  readonly timeoutMs?: number | undefined;
}

/** 失败原因（与 `firewall-probe` 同族；新增 `parse-error` 的含义见下） */
export type LocalAddressesProbeReason =
  | 'powershell-missing'
  | 'timeout'
  | 'non-zero-exit'
  | 'parse-error'
  | 'unexpected';

export interface LocalAddressesProbeSuccess {
  readonly ok: true;
  /** 候选地址（已过滤 + 去重，保持枚举顺序） */
  readonly addresses: readonly LocalAddressEntry[];
  /** 本次真正执行的 argv（证据位；与 `LOCAL_ADDRESSES_PS_ARGV` 同一份引用语义） */
  readonly argv: readonly string[];
}

export type LocalAddressesOutcome = LocalAddressesProbeSuccess | ProbeFailure<LocalAddressesProbeReason>;

/** 地址是否是可用的候选（纯函数；`prefixLength` 不参与判据，理由见文件头） */
export function isCandidateAddress(entry: { readonly address: string; readonly ifAlias: string }): boolean {
  if (!isIpv4Literal(entry.address)) return false;
  const octets = entry.address.split('.').map((part) => Number(part));
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  if (first === 127) return false; // 127.0.0.0/8：loopback
  if (first === 169 && second === 254) return false; // 169.254.0.0/16：链路本地
  if (first === 172 && second >= 16 && second <= 31) return false; // 172.16.0.0/12：WSL / Hyper-V
  return !VIRTUAL_ALIAS.test(entry.ifAlias);
}

/** 过滤 + 按地址去重（同一地址出现在两块网卡时只留第一条）；保持枚举顺序 */
export function filterLocalAddresses(entries: readonly LocalAddressEntry[]): LocalAddressEntry[] {
  const seen = new Set<string>();
  const out: LocalAddressEntry[] = [];
  for (const entry of entries) {
    if (!isCandidateAddress(entry)) continue;
    if (seen.has(entry.address)) continue;
    seen.add(entry.address);
    out.push(entry);
  }
  return out;
}

/**
 * 解析 `InterfaceAlias|IPAddress|PrefixLength` 多行输出。
 *
 * 严格：任何一行不是这个形状（含空行以外的脏行）⇒ 抛错 ⇒ 上层归类为 `parse-error`。
 * **空输出是合法的空列表**（枚举成功但没有 IPv4）。
 */
export function parseLocalAddresses(stdout: string): LocalAddressEntry[] {
  const entries: LocalAddressEntry[] = [];
  for (const raw of stdout.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === '') continue;
    const lastSeparator = line.lastIndexOf(FIELD_SEPARATOR);
    const aliasSeparator = lastSeparator === -1 ? -1 : line.lastIndexOf(FIELD_SEPARATOR, lastSeparator - 1);
    if (aliasSeparator === -1) throw new Error(`无法解析的网卡行：${redactOutput(line, 200)}`);
    const ifAlias = line.slice(0, aliasSeparator).trim();
    const address = line.slice(aliasSeparator + 1, lastSeparator).trim();
    const prefixText = line.slice(lastSeparator + 1).trim();
    const prefixLength = Number(prefixText);
    if (!isIpv4Literal(address) || !Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
      throw new Error(`无法解析的网卡行：${redactOutput(line, 200)}`);
    }
    entries.push({ address, ifAlias, prefixLength });
  }
  return entries;
}

/**
 * 读一次候选地址。**只读**：argv 见 `LOCAL_ADDRESSES_PS_ARGV`；失败返回 `ProbeFailure`
 * （绝不返回空列表冒充成功）。
 */
export async function probeLocalAddresses(
  executor: Executor,
  options: LocalAddressesOptions = {},
): Promise<LocalAddressesOutcome> {
  const timeoutMs = options.timeoutMs ?? LOCAL_ADDRESSES_TIMEOUT_MS;
  const outcome = await executor(POWERSHELL, LOCAL_ADDRESSES_PS_ARGV, { encoding: 'utf8', timeoutMs });
  if (!outcome.ok) {
    // 与 `firewall-probe.ts` 同口径：001 的执行器把非 0 退出也报成错误，三种进程层原因各按自己的码分开
    const reason: LocalAddressesProbeReason =
      outcome.code === 'CommandNotFound'
        ? 'powershell-missing'
        : outcome.code === 'Timeout'
          ? 'timeout'
          : outcome.code === 'NonZeroExit'
            ? 'non-zero-exit'
            : 'unexpected';
    return probeFailure({
      reason,
      message: `枚举物理网卡 IPv4 失败（${reason}）：${outcome.message}`,
      hint: '本探针只读（Get-NetIPAddress）；读不到就无法给出候选监听地址 ⇒ 页面只剩默认 0.0.0.0，写路径不受影响。',
      cause: outcome,
      raw: redactOutput(outcome.stderr ?? ''),
      argv: outcome.argv ?? argvOf(),
    });
  }
  const exitCode = outcome.exitCode ?? 0;
  if (exitCode !== 0) {
    return probeFailure({
      reason: 'non-zero-exit',
      message: `枚举物理网卡 IPv4 失败：powershell 退出码 ${String(exitCode)}（本探针是只读的 —— 非 0 退出说明枚举本身没成功）。`,
      hint: '检查 NetTCPIP 模块与网络服务是否正常；修好后重试。',
      raw: redactOutput(outcome.stderr === '' ? outcome.stdout : outcome.stderr),
      argv: argvOf(),
    });
  }
  try {
    const entries = parseLocalAddresses(outcome.stdout);
    return { ok: true, addresses: filterLocalAddresses(entries), argv: argvOf() };
  } catch (error) {
    return probeFailure({
      reason: 'parse-error',
      message: `读取物理网卡 IPv4 失败：输出形态不可识别（${error instanceof Error ? error.message : String(error)}）`,
      hint: '把「读不懂的输出」当「没有物理网卡」会让下拉框只剩默认项却不报警 ⇒ 这里判失败并显示原因。',
      raw: redactOutput(outcome.stdout),
      argv: argvOf(),
    });
  }
}

/** 网卡别名黑名单（大小写不敏感；`vEthernet (WSL …)` / `aTrustVNIC` / `蓝牙网络连接` 都在内） */
const VIRTUAL_ALIAS = /(?:vEthernet|aTrust|Tailscale|VMware|VirtualBox|Loopback|WSL|Bluetooth|蓝牙)/iu;

/** 严格点分四段 IPv4 字面量（`999.1.1.1` / `1.2.3` / 带前导零的宽写一律拒） */
function isIpv4Literal(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) >= 0 && Number(part) <= 255);
}
