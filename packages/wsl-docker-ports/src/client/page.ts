/**
 * 页面装配（003 T5.1–T5.8）：`PortsSnapshot` → `PortsPageView`（**纯函数**）
 *
 * ## 这一层是三件事的唯一落点
 *
 * 1. **门禁**：`writeGate()` 把「NAT 硬前提」（REQ-1.1）与「提权策略 `none`」（005 REQ-3 默认）
 *    合成一个可二值判定的结果 ⇒ 非 NAT 时 `[data-write-control]` **一个都不可点**（T5.2）。
 * 2. **五态渲染**：每端口一条 `PortRowView`（标签 + 动作 + 漂移 + 作用域控件），
 *    `conflict` 恒无动作（REQ-1.3 只报告）。
 * 3. **只读区**：外部规则（REQ-15.1，无动作字段）与不可转发映射（REQ-9.2）**不混排**。
 *
 * ## 为什么返回的对象里没有函数
 *
 * 与五态引擎同一取向：渲染层只画事实。「开页零写操作」（NFR-2）因此不是纪律问题，
 * 而是**结构上无物可调**。测试对整棵结果对象做 `assertNoFunctions`。
 */

import { PORT_STATES, type PortState, type Scope } from '../diff/types.ts';
import { buildContainerRows, buildExternalRulesView, buildForwardActions, buildNatGuide, buildPresetOptions, buildScopeControl, buildDriftView, buildUnsupportedRows, managedPortsIssues, managedPortsText, natReason, stateLabel, stateTone, TESTID, UDP_TIP_TEXT, PORT_PRESETS, ELEVATION_CONSENT_NOTICE } from './rows.ts';
import { buildDriftFixView } from './drift-fix.ts';
import type { ManagedPortsFormView } from './types.ts';
import type { DistroPanelData, ForwardWriteReport } from './host.ts';
import type {
  DistroPanelView,
  ExecControlView,
  NatGatePanelView,
  PortRowView,
  PortsPageView,
  PortsSnapshot,
  UnsupportedRowView,
} from './types.ts';

/** 写门（转发类动作的准入）；`reason` 恒为「给人看的一句 + 依据」 */
export interface WriteGate {
  readonly allowed: boolean;
  readonly reason: string | null;
}

/**
 * 转发写控件的门禁（REQ-1.1 + 005 REQ-3 默认 `none`）。
 *
 * ⚠️ **口径**：门的对象是**转发写控件**（apply / remove / fix-drift / 逐端口 scope）。
 * `managedPorts` 声明与 presets 勾选**只写配置**，故不因策略 `none` 置灰；
 * `sel-elevation` 更必须保持可用 —— 否则 `none` 会变成**死锁**（永远回不到 ask/passby）。
 * NAT 不成立时，连 `managedPorts` 声明也无从生效（期望集恒空）⇒ 一并置灰。
 */
export function writeGate(snapshot: PortsSnapshot): WriteGate {
  if (snapshot.nat.kind !== 'nat') {
    return { allowed: false, reason: `NAT 硬前提不成立（${natReason(snapshot.nat)}）：转发写控件全部置灰（REQ-1.1）` };
  }
  if (snapshot.diff.ok === false) {
    return { allowed: false, reason: '取不到 eth0：期望地址不可判定，写规则会造出一条指向失效地址的规则（REQ-6.4）' };
  }
  if (snapshot.elevationPolicy === 'none') {
    return { allowed: false, reason: '提权策略为 none（默认）：不发起任何提权写操作；可先改下面的提权策略' };
  }
  if (!snapshot.elevationAvailable) {
    return { allowed: false, reason: '写路径（提权辅助进程）不可用：本行只做只读展示' };
  }
  return { allowed: true, reason: null };
}

/** NAT 门面板（REQ-1.1/1.4：非 NAT 也要保留只读展示，只是把写控件锁死） */
export function buildNatPanel(snapshot: PortsSnapshot): NatGatePanelView {
  const gate = writeGate(snapshot);
  return {
    testId: 'nat-gate',
    open: snapshot.nat.kind === 'nat',
    reason: gate.allowed ? natReason(snapshot.nat) : (gate.reason ?? natReason(snapshot.nat)),
    guide: snapshot.nat.kind === 'nat' ? null : buildNatGuide(snapshot.nat),
  };
}

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const DISTRO_SOURCE_LABELS: Readonly<Record<DistroPanelData['source'] & string, string>> = {
  config: '配置',
  wslDefault: 'WSL 默认',
  onlyOne: '唯一发行版',
  first: '首个',
};

function buildDistroPanel(
  data: DistroPanelData | null,
  error: string | null,
  enabled: boolean,
  disabledReason: string | null,
): DistroPanelView {
  if (data === null) {
    return {
      testId: TESTID.distro,
      name: null,
      sourceLabel: '未解析',
      state: null,
      stateNote: null,
      options: [],
      staleMessage: null,
      error: error ?? '尚未解析目标发行版',
      enabled: false,
      disabledReason,
    };
  }
  return {
    testId: TESTID.distro,
    name: data.name,
    sourceLabel: data.source === null ? '未解析' : DISTRO_SOURCE_LABELS[data.source],
    state: data.state,
    stateNote: data.stateNote,
    options: data.distros.map((distro) => ({
      name: distro.name,
      state: distro.state,
      isDefault: distro.isDefault,
      selected: distro.name === data.name,
    })),
    staleMessage: data.staleConfig ? (data.message ?? '配置的发行版已不存在，已按 WSL 默认回落') : null,
    error: null,
    enabled,
    disabledReason,
  };
}

function buildExecControl(snapshot: PortsSnapshot): ExecControlView {
  const available = snapshot.diff.ok === false ? false : snapshot.execAvailable;
  return {
    testId: TESTID.exec,
    label: '进容器 exec',
    enabled: false,
    reason: available
      ? '本期（P0）不实现 exec：控件保留为注入点，下一期接入 managedTerminal 服务后启用'
      : '下一期功能；且 002 的 managedTerminal 服务当前未加载 —— 控件保持置灰，不报错、不触发回调',
    serviceAvailable: available,
  };
}

function buildManagedPortsForm(snapshot: PortsSnapshot, gate: WriteGate): ManagedPortsFormView {
  const parsed = managedPortsIssues(snapshot.managedPortsDecl);
  return {
    inputTestId: TESTID.managedPortsInput,
    rangeText: managedPortsText(snapshot.managedPortsDecl),
    issues: parsed.issues,
    presets: buildPresetOptions(PORT_PRESETS, parsed.ports),
    saveTestId: TESTID.managedPortsSave,
    enabled: snapshot.nat.kind === 'nat',
    disabledReason: snapshot.nat.kind === 'nat' ? null : gate.reason,
  };
}

function scopeFor(snapshot: PortsSnapshot, port: number): Scope {
  return snapshot.scopes[String(port)] ?? 'loopback';
}

/** 端口行（五态 + 动作 + 漂移 + 逐端口作用域） */
export function buildPortRows(snapshot: PortsSnapshot, gate: WriteGate): PortRowView[] {
  if (snapshot.diff.ok === false) return [];
  const { result } = snapshot.diff;
  return result.ports.map((classification) => {
    const scope = scopeFor(snapshot, classification.port);
    const portGate = gate;
    return {
      port: classification.port,
      state: classification.state,
      stateLabel: stateLabel(classification.state),
      tone: stateTone(classification.state),
      reasonText: classification.reason === 'wsl-localhost-forwarding' ? 'WSL 自带 localhost 转发 ⇒ 该端口无需显式规则' : classification.reason === 'no-docker-mapping' ? 'docker 已不再映射该端口，规则仍在' : null,
      scopeMismatch: classification.scopeMismatch,
      scopeControl: buildScopeControl(classification.port, scope, portGate),
      actions: buildForwardActions(classification, portGate),
      drift: buildDriftView(classification),
      fix:
        classification.state === 'drift' && result.eth0Ip.length > 0
          ? buildDriftFixView({
              port: classification.port,
              scope,
              eth0Ip: result.eth0Ip,
              managedPorts: managedPortsOf(snapshot),
              rules: classification.rules,
            })
          : null,
      needsRule: classification.expected?.needsRule ?? false,
      containerNames: classification.expected?.containerNames ?? [],
    };
  });
}

function managedPortsOf(snapshot: PortsSnapshot) {
  const parsed = managedPortsIssues(snapshot.managedPortsDecl);
  return parsed.ports ?? [];
}

/** 写回执的「未改项」（T5.6 / REQ-6.3：中途失败必须报出哪些没改，不许静默留半截） */
export function summarizeWriteReport(
  plannedKinds: readonly string[],
  report: ForwardWriteReport,
): { readonly status: string; readonly message: string; readonly unapplied: readonly string[] } {
  const succeeded = new Set(report.steps.filter((step) => step.ok).map((step) => step.name));
  return {
    status: report.status,
    message: report.message,
    unapplied: plannedKinds.filter((kind) => !succeeded.has(kind)),
  };
}

export interface BuildPageOptions {
  readonly lastWrite?: { readonly status: string; readonly message: string; readonly unapplied: readonly string[] } | null;
}

/** 唯一的装配入口（纯函数：同一输入永远同一输出，且输出不含函数） */
export function buildPortsPageView(snapshot: PortsSnapshot, options: BuildPageOptions = {}): PortsPageView {
  const gate = writeGate(snapshot);
  const unsupported: readonly UnsupportedRowView[] =
    snapshot.diff.ok === true ? buildUnsupportedRows(snapshot.diff.result.unsupported) : buildUnsupportedRows(snapshot.diff.unsupported);
  const externalRows = snapshot.diff.ok === true ? snapshot.diff.result.external : snapshot.diff.external;
  const counts: Record<PortState, number> =
    snapshot.diff.ok === true
      ? { ...snapshot.diff.result.counts }
      : { ok: 0, missing: 0, drift: 0, conflict: 0, extra: 0 };
  const containers = snapshot.docker.ok ? buildContainerRows(snapshot.docker.containers) : [];

  return {
    refreshedAt: snapshot.refreshedAt,
    refreshedAtText: formatTimestamp(snapshot.refreshedAt),
    nat: buildNatPanel(snapshot),
    docker: snapshot.docker,
    containers,
    containerCount: containers.length,
    ports: buildPortRows(snapshot, gate),
    counts,
    portsNote: snapshot.diff.ok === false ? '取不到 eth0：本条判决都不给（不降级、不把全部规则误标为漂移）' : null,
    eth0: {
      known: snapshot.diff.ok === true,
      ip: snapshot.diff.ok === true ? snapshot.diff.result.eth0Ip : null,
      text: snapshot.diff.ok === true ? snapshot.diff.result.eth0Ip : '无法确定地址（WSL 未运行 / 无 eth0）',
      launchTestId: 'btn-launch-distro',
      launchEnabled: snapshot.diff.ok === false,
      launchNote: '启动并核验：会冷启动发行版，约 10–12 秒，并拉起 WSL 内的 dockerd 与全部容器（唯一允许启动发行版的路径）',
    },
    udpTip: { testId: TESTID.udpTip, text: UDP_TIP_TEXT },
    unsupported,
    external: buildExternalRulesView(externalRows),
    externalCount: externalRows.length,
    managedPorts: buildManagedPortsForm(snapshot, gate),
    distro: buildDistroPanel(snapshot.distro, snapshot.distroError, true, null),
    exec: buildExecControl(snapshot),
    elevation: {
      testId: TESTID.elevation,
      value: snapshot.elevationPolicy,
      options: [
        { value: 'none', label: 'none（默认：不做任何提权写操作）' },
        { value: 'ask', label: 'ask（每次写操作都弹 UAC）' },
        { value: 'passby', label: 'passby（缓存活跃时不再弹；Agent 触发一律降级）' },
      ],
      enabled: true,
      note: '提权策略只改配置（remote.settings），不触发任何提权调用',
      notice: ELEVATION_CONSENT_NOTICE,
    },
    lastWrite: options.lastWrite ?? null,
  };
}

/** 计数之和（测试用：五态「每端口恰好一条」的页面侧复算） */
export function countSum(counts: Readonly<Record<PortState, number>>): number {
  return PORT_STATES.reduce((total, state) => total + counts[state], 0);
}
