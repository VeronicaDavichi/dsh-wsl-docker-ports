/**
 * 提权脚本生成与参数校验（005 T2.1 / REQ-3.4 / REQ-3.6 / REQ-3.7）
 *
 * ## 脚本是**固定模板**，参数只走 argv
 *
 * 脚本正文里**不含任何用户数据**：动作、端口、地址、作用域都是脚本参数
 * （`-Action/-Port/-Address/-Scope/-Out`），由 `scriptArgs()` 以 argv 数组下发 ——
 * 不是把值拼进脚本文本。这是 REQ-3.7「只接受结构化参数、不接受任意命令文本」的最强形态：
 * 连「拼错」的机会都没有，因为**没有拼接这一步**。
 *
 * 三重校验（都在这条链上）：
 * 1. 主机侧 `assertScriptParams()`：动作 ∈ 白名单、端口是 1..65535 的整数、地址是已校验 IPv4、
 *    作用域 ∈ `{loopback,lan}`；任何字段含 `;` `&` 反引号 `|` `$` 括号引号等一律**抛错拒绝**（T2.1）。
 * 2. 脚本 `param()` 块的 `[ValidateSet]` / `[ValidateRange]`：即使主机侧被绕过，绑定期也会拒。
 * 3. 命令里**只有** `netsh` 的写动作（都带 `listenport=`）与 `New-NetFirewallRule` / 
 *    `Remove-NetFirewallRule` 的单端口形态 —— 没有任何「按端口/全表清空」的形态，
 *    也不调用 `netsh ... show`（`show` 没法带 `listenport`，主机侧快照已经有权威数据）。
 *    唯一的防火墙**读**是 `Get-NetFirewallRule -Group $group`（按本插件组名过滤，不带任何端口通配），
 *    只为把放行做成**幂等**（2026-10-16 收口遗留 ⑫：Windows 允许 `DisplayName` 重名，裸 `New-`
 *    会在反复修复时叠出多条同名放行 —— 真机实测 `ourName` 1 → 2）。
 *
 * ## 退出码（design §4）
 *
 * `0` 全成 / `2` 部分失败（有 steps 失败）/ `3` 前置不满足（未取得管理员）/ `1` 异常。
 * 半成品防护：`lan` 的放行步骤失败 → 回滚刚加的 portproxy（要么都成、要么都不成，REQ-3.5）。
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { expectedListenAddress } from '../diff/engine.ts';

import type { ScriptAction, ScriptParams } from './types.ts';

/**
 * 模板里唯一被插值的两个值 = **模块常量**（来自 003 的 `expectedListenAddress`，全仓唯一口径），
 * 不是调用方数据 ⇒ 注入面仍然为零。这样脚本里的地址与读侧引擎、写侧闸门**逐字同源**。
 */
const LAN_ADDRESS = expectedListenAddress('lan');
const LOOPBACK_ADDRESS = expectedListenAddress('loopback');

/** 白名单动作（**唯一**允许出现在脚本里的动词；design §4） */
export const SCRIPT_ACTIONS: readonly ScriptAction[] = ['add', 'remove', 'fix'];

/** 临时文件名前缀（REQ-3.6：用户临时目录 + 含随机段 + 可识别） */
export const TEMP_PREFIX = 'dsh-ppp';

/** 危险字符：出现在任何参数里都直接拒（T2.1 的 `;` / `&` / 反引号就在其中） */
const FORBIDDEN = /[;&`|<>$(){}'"\r\n\t\s]/;

/** IPv4 字面量（只保证安全进 argv，不做网段合法性判断） */
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** 随机段（≥8 位 hex 才认；`randomSuffix()` 的默认值是 12 位） */
const SUFFIX = /^[0-9a-f]{8,}$/i;

export class ElevateParamError extends Error {
  readonly field: string;
  readonly value: string;

  constructor(field: string, value: string, message: string) {
    super(message);
    this.name = 'ElevateParamError';
    this.field = field;
    this.value = value;
  }
}

/** 单字段安全检查：非空、无危险字符、无首尾空白 */
function assertSafeToken(field: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ElevateParamError(field, String(value), `${field} 不能为空`);
  }
  if (FORBIDDEN.test(value)) {
    throw new ElevateParamError(
      field,
      value,
      `${field} 含被拒字符（分号 / & / 反引号 / 引号 / 空白 / 括号等在黑名单里）：拒绝生成脚本，绝不拼接`,
    );
  }
}

export function isScriptAction(value: string): value is ScriptAction {
  return (SCRIPT_ACTIONS as readonly string[]).includes(value);
}

/** 端口：1..65535 的整数（`Number.isInteger` 排除 `'5000 & calc'` 这类） */
export function assertPort(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ElevateParamError('port', String(value), `port 必须是 1..65535 的整数（收到 ${String(value)}）`);
  }
}

/** 地址：shape 合法的 IPv4 + 通过字符黑名单（T2.1：`1.2.3.4; shutdown` 必须被拒） */
export function assertAddress(value: string): void {
  assertSafeToken('address', value);
  if (!IPV4.test(value) || value.split('.').some((part) => Number(part) > 255)) {
    throw new ElevateParamError('address', value, `address 必须是 IPv4 字面量（收到 ${value}）`);
  }
}

export function assertScope(value: string): void {
  if (value !== 'loopback' && value !== 'lan') {
    throw new ElevateParamError('scope', value, `scope 只能是 loopback 或 lan（收到 ${value}）`);
  }
}

export function assertAction(value: string): void {
  if (!isScriptAction(value)) {
    throw new ElevateParamError(
      'action',
      value,
      `action 只能是白名单动作 ${SCRIPT_ACTIONS.join(' / ')}（收到 ${value}）—— 脚本不接受任意命令文本`,
    );
  }
}

/** 随机段（REQ-3.6）：默认 12 位 hex；测试注入定值 */
export function defaultRandomSuffix(): string {
  return randomBytes(6).toString('hex');
}

export function tempScriptPath(tempDir: string, suffix: string): string {
  if (!SUFFIX.test(suffix)) {
    throw new ElevateParamError('suffix', suffix, '临时文件名的随机段至少 8 位十六进制（REQ-3.6）');
  }
  return join(tempDir, `${TEMP_PREFIX}-${suffix}.ps1`);
}

export function tempOutPath(tempDir: string, suffix: string): string {
  if (!SUFFIX.test(suffix)) {
    throw new ElevateParamError('suffix', suffix, '临时文件名的随机段至少 8 位十六进制（REQ-3.6）');
  }
  return join(tempDir, `${TEMP_PREFIX}-${suffix}-out.json`);
}

/** 临时产物命名校验（两个路径都必须是本插件在临时目录里的产物） */
export function assertTempPaths(scriptPath: string, outPath: string): void {
  assertSafeToken('scriptPath', scriptPath);
  assertSafeToken('outPath', outPath);
  const scriptName = scriptPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const outName = outPath.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!new RegExp(`^${TEMP_PREFIX}-[0-9a-f]{8,}\\.ps1$`, 'i').test(scriptName)) {
    throw new ElevateParamError('scriptPath', scriptPath, `脚本文件名必须是 ${TEMP_PREFIX}-<rand>.ps1`);
  }
  if (!new RegExp(`^${TEMP_PREFIX}-[0-9a-f]{8,}-out\\.json$`, 'i').test(outName)) {
    throw new ElevateParamError('outPath', outPath, `输出文件名必须是 ${TEMP_PREFIX}-<rand>-out.json`);
  }
}

/** 全部字段的校验入口（任一不合法直接抛 —— 调用方**不得** catch 后降级执行） */
export function assertScriptParams(params: ScriptParams): void {
  assertAction(params.action);
  assertPort(params.port);
  assertAddress(params.address);
  assertScope(params.scope);
  assertTempPaths(params.scriptPath, params.outPath);
}

/** 脚本参数 → argv（`-File` 之后的参数；`script.ts` 是这些值的唯一来源） */
export function scriptArgs(params: ScriptParams): string[] {
  return [
    '-Out',
    params.outPath,
    '-Action',
    params.action,
    '-Port',
    String(params.port),
    '-Address',
    params.address,
    '-Scope',
    params.scope,
  ];
}

/**
 * 固定脚本正文。**不接受入参**：正文里没有可变部分 ⇒ 没有注入面。
 * 注释里写明「主机侧快照为准」，避免日后有人以为空数组是漏填。
 */
export function buildElevateScript(): string {
  return `# dsh-wsl-docker-ports 提权辅助脚本（005 REQ-3）
# 固定模板：动作只允许 add|remove|fix，端口为数字，地址为已校验 IPv4，作用域为 loopback|lan。
# 不接受任意命令文本；所有 netsh 写动作都显式带 listenport=。
# 退出码：0 全成 / 2 部分失败 / 3 前置不满足 / 1 异常。
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'remove', 'fix')][string]$Action,
  [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
  [Parameter(Mandatory = $true)][string]$Address,
  [Parameter(Mandatory = $true)][ValidateSet('loopback', 'lan')][string]$Scope,
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'
$steps = New-Object System.Collections.ArrayList
$displayName = "dsh-wsl-docker-ports-$Port"
$group = 'dsh-wsl-docker-ports'
$listen = if ($Scope -eq 'lan') { '${LAN_ADDRESS}' } else { '${LOOPBACK_ADDRESS}' }

function Add-Step([string]$Name, [bool]$Ok, [string]$Err) {
  [void]$steps.Add(@{ name = $Name; ok = $Ok; stderr = $Err })
}

function Complete([bool]$Ok, [int]$Code) {
  # beforeRules / afterRules 是契约保留字段：**权威快照在主机侧**（REQ-1.5 前后各取一次），
  # 这里不重复调用 netsh show（那条命令带不了 listenport，且主机侧已有完整实际集）。
  $payload = @{
    ok          = $Ok
    action      = $Action
    port        = $Port
    steps       = @($steps)
    beforeRules = @()
    afterRules  = @()
  }
  $json = ($payload | ConvertTo-Json -Depth 6 -Compress)
  Set-Content -LiteralPath $Out -Value $json -Encoding UTF8
  # 两个回传通道都给：gsudo 走 stdio（REQ-3.4 ①），native 走 out 文件（完整性级别不同，无法管道回读）
  Write-Output $json
  exit $Code
}

# 前置：UAC 已通过才会走到这里；拿不到管理员权限 ⇒ 退出码 3（design §4）
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Add-Step 'precondition' $false '未获得管理员权限'
  Complete $false 3
}

function Add-Portproxy {
  # 同一端口在另一 listen address 下的残留（只可能是本插件写的两个地址之一）：
  # 先清掉，保证「一个端口恰好一条规则」；不存在时 netsh 返回非 0，这里不算错。
  $other = if ($listen -eq '${LAN_ADDRESS}') { '${LOOPBACK_ADDRESS}' } else { '${LAN_ADDRESS}' }
  & netsh.exe interface portproxy delete v4tov4 "listenport=$Port" "listenaddress=$other" | Out-Null
  if ($LASTEXITCODE -eq 0) { Add-Step 'portproxy-clean-other-scope' $true '' }
  try {
    & netsh.exe interface portproxy add v4tov4 "listenport=$Port" "listenaddress=$listen" "connectport=$Port" "connectaddress=$Address" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "netsh exit $LASTEXITCODE" }
    Add-Step 'portproxy-add' $true ''
    return $true
  } catch {
    Add-Step 'portproxy-add' $false $_.Exception.Message
    return $false
  }
}

function Remove-Portproxy {
  try {
    & netsh.exe interface portproxy delete v4tov4 "listenport=$Port" "listenaddress=$listen" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "netsh exit $LASTEXITCODE" }
    Add-Step 'portproxy-delete' $true ''
    return $true
  } catch {
    Add-Step 'portproxy-delete' $false $_.Exception.Message
    return $false
  }
}

function Add-Firewall {
  try {
    # 幂等（2026-10-16 收口遗留 ⑫）：$displayName 是固定的 "dsh-wsl-docker-ports-$Port"，而 Windows
    # 允许 DisplayName 重名 ⇒ 裸 New- 会在**反复修复**（fix@lan 每次都会走到这里）时叠出多条同名放行
    # （真机实测 ourName 1 → 2）。这里先只清**本组**（$group）的同名规则、再建 ⇒ 终态恒为一条；
    # 非本组的同名规则**一条都不动**（不越所有权边界）。只有真清掉了才记 firewall-clean（不注水）。
    $sameName = @(Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $displayName })
    if ($sameName.Count -gt 0) {
      $sameName | Remove-NetFirewallRule -ErrorAction SilentlyContinue
      Add-Step 'firewall-clean' $true ''
    }
    New-NetFirewallRule -DisplayName $displayName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any -Group $group | Out-Null
    Add-Step 'firewall-add' $true ''
    return $true
  } catch {
    Add-Step 'firewall-add' $false $_.Exception.Message
    return $false
  }
}

function Remove-Firewall {
  try {
    Remove-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue | Out-Null
    Add-Step 'firewall-delete' $true ''
    return $true
  } catch {
    Add-Step 'firewall-delete' $false $_.Exception.Message
    return $false
  }
}

switch ($Action) {
  'add' {
    if (-not (Add-Portproxy)) { Complete $false 1 }
    if ($Scope -eq 'lan') {
      if (-not (Add-Firewall)) {
        # 半成品防护：放行失败 ⇒ 回滚刚加的 portproxy（要么都成、要么都不成，REQ-3.5）
        [void](Remove-Portproxy)
        Add-Step 'portproxy-rollback' $true '防火墙放行失败，已回滚 portproxy'
        Complete $false 2
      }
    }
  }
  'remove' {
    if (-not (Remove-Portproxy)) { Complete $false 2 }
    if ($Scope -eq 'lan') { [void](Remove-Firewall) }
  }
  'fix' {
    if (-not (Remove-Portproxy)) { Complete $false 1 }
    if (-not (Add-Portproxy)) { Complete $false 2 }
    if ($Scope -eq 'lan' -and -not (Add-Firewall)) { Complete $false 2 }
  }
  default {
    Add-Step 'dispatch' $false "未知动作（白名单之外）：$Action"
    Complete $false 1
  }
}

$failed = @($steps | Where-Object { -not $_.ok })
if ($failed.Count -gt 0) { Complete $false 2 }
Complete $true 0
`;
}

/** 校验 + 生成（调用方唯一需要的两步；顺序固定，先校验后生成） */
export function prepareElevation(params: ScriptParams): { readonly script: string; readonly args: readonly string[] } {
  assertScriptParams(params);
  return { script: buildElevateScript(), args: scriptArgs(params) };
}
