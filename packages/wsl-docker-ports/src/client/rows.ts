/**
 * 行级纯函数：五态标签 / NAT 门指引 / 容器与端口行 / 不可转发行 / 外部规则区 / presets（003 Phase 5）
 *
 * 全部**纯数据进出**：不接 DOM、不接执行器、不读配置。`pane.tsx` 只负责把这些对象画出来，
 * 于是「五态各自可渲染」「外部规则区无动作控件」这类断言可以在**无 DOM** 下逐条钉死。
 */

import { PORT_PRESETS, type PortPreset } from '../diff/port-presets.ts';
import { isManagedPort, type ManagedPorts } from '../diff/managed-ports.ts';
import { parseManagedPorts } from '../diff/managed-ports-parse.ts';
import type { PortClassification, PortState, Scope, UnsupportedMapping, ExternalRule } from '../diff/types.ts';
import type { DockerContainer } from '../read/docker.ts';
import type { PortproxyRule } from '../read/netsh.ts';
import { buildWritePlan, portproxyAddStep, portproxyDeleteStep, type WritePlanOutcome } from '../write/index.ts';
import type { SidebarRightTabDefinitionLike, SlotsServiceLike } from './host.ts';
import type {
  ContainerRowView,
  DriftFixView,
  DriftView,
  ExternalRulesView,
  ForwardActionView,
  NatGateView,
  NatGuideView,
  PortTone,
  ScopeControlView,
  UnsupportedRowView,
} from './types.ts';

/** 页类型 id / kind（kind 由集成方定：`wslDockerPorts` 不与官方 9 个 kind 重名 —— contract §P1） */
export const PAGE_ID = 'dsh-wsl-docker-ports';
export const PAGE_KIND = 'wslDockerPorts';
export const PAGE_TITLE = 'WSL Docker 端口';

/** 两个 keyed seat（contract §C10）：`key = definition.id` */
export const TAB_SLOT = 'sidebar.right.pane.tab';
export const TAB_TITLE_SLOT = 'sidebar.right.pane.tab.title';

/** `data-testid` 常量（requirements §2 的控件清单逐条对应，测试与实现共用一个字面量） */
export const TESTID = {
  refresh: 'btn-refresh',
  natGuide: 'btn-nat-guide',
  containers: 'tbl-containers',
  ports: 'tbl-ports',
  udpTip: 'tip-udp',
  exec: 'btn-cs-exec',
  elevation: 'sel-elevation',
  managedPortsInput: 'inp-managed-ports',
  managedPortsSave: 'btn-save-managed-ports',
  distro: 'sel-distro',
  rawOutput: 'btn-raw-output',
} as const;

export function scopeTestId(port: number): string {
  return `sel-scope-${String(port)}`;
}

const STATE_LABELS: Readonly<Record<PortState, string>> = {
  ok: '已就绪',
  missing: '缺少规则',
  drift: '地址漂移',
  conflict: '冲突（只报告，不可改）',
  extra: '多余规则（可移除）',
};

const STATE_TONES: Readonly<Record<PortState, PortTone>> = {
  ok: 'ok',
  missing: 'warn',
  drift: 'warn',
  conflict: 'danger',
  extra: 'muted',
};

export function stateLabel(state: PortState): string {
  return STATE_LABELS[state];
}

export function stateTone(state: PortState): PortTone {
  return STATE_TONES[state];
}

/** 构建页定义。`priority` **刻意不写**（= `extension` 档）；`multiple:false` + `keepMounted:true` 的理由见 README/report */
export function portsTabDefinition(): SidebarRightTabDefinitionLike {
  return { id: PAGE_ID, kind: PAGE_KIND, title: () => PAGE_TITLE, multiple: false, keepMounted: true };
}

/** 两个 seat 的注册参数（`slots.register({name, key}, Component)`） */
export const TAB_SEATS: readonly { readonly slot: string; readonly key: string }[] = [
  { slot: TAB_SLOT, key: PAGE_ID },
  { slot: TAB_TITLE_SLOT, key: PAGE_ID },
];

/** 注册两个 seat（返回 disposer 数组；调用方负责挂到 `ctx.effect`） */
export function registerTabSeats(slots: SlotsServiceLike, component: unknown, titleComponent: unknown): (() => void)[] {
  const disposers: (() => void)[] = [];
  disposers.push(slots.inject(TAB_SLOT, () => slots.register({ name: TAB_SLOT, key: PAGE_ID }, component)));
  disposers.push(slots.inject(TAB_TITLE_SLOT, () => slots.register({ name: TAB_TITLE_SLOT, key: PAGE_ID }, titleComponent)));
  return disposers;
}

/** 修复指引（REQ-1.4）：**路径 + 可复制命令**，并写明不会自动改文件 */
export function buildNatGuide(nat: NatGateView): NatGuideView {
  const path = nat.path.length > 0 ? nat.path : '%USERPROFILE%\\.wslconfig';
  const commandText = `notepad "${path}"\r\nwsl --shutdown`;
  return {
    path,
    lines: [
      `打开 ${path}，在 [wsl2] 节里把 networkingMode 设为 nat（或删掉该键 —— 缺省即 NAT）`,
      `保存后执行 wsl --shutdown 让新配置生效（会关闭全部发行版，WSL 内服务会随之停止）`,
      `portproxy 的 connectaddress 必须是 WSL 的 eth0；mirrored 模式下 eth0 语义改变，规则会指向失效地址`,
    ],
    commandText,
    note: '本插件不会自动修改该文件（REQ-1.4）：改网络模式会重启 WSL，必须由你决定时机。',
  };
}

export function natReason(nat: NatGateView): string {
  if (nat.kind === 'nat') return nat.mode === 'nat' ? 'networkingMode=nat' : '未配置 networkingMode（缺省 NAT）';
  if (nat.kind === 'non-nat') return `networkingMode=${nat.rawValue ?? nat.mode}（非 NAT）`;
  return nat.message;
}

/** 容器表行（REQ-2.1/2.2：只读，展示 id/name/image/state/status） */
export function buildContainerRows(containers: readonly DockerContainer[]): ContainerRowView[] {
  return containers.map((container) => ({
    id: container.id,
    name: container.names,
    image: container.image,
    state: container.state,
    status: container.status,
    ports: container.ports
      .map((mapping) => {
        const host = mapping.hostPort === null ? '' : `${mapping.hostIp ?? ''}:${String(mapping.hostPort)}->`;
        const range = mapping.hostPortEnd === null ? '' : `-${String(mapping.hostPortEnd)}`;
        const cRange = mapping.containerPortEnd === null ? '' : `-${String(mapping.containerPortEnd)}`;
        return `${host}${String(mapping.containerPort)}${cRange}/${mapping.protocol}${range}`;
      })
      .join(', '),
  }));
}

/** 逐端口作用域控件：**每端口一个**，值是配置里的 scope（缺省 loopback）；无任何「全选/批量」入口 */
export function buildScopeControl(
  port: number,
  scope: Scope,
  gate: { readonly allowed: boolean; readonly reason: string | null },
): ScopeControlView {
  return {
    testId: scopeTestId(port),
    port,
    value: scope,
    options: [
      { value: 'loopback', label: '仅本机（loopback，默认）' },
      { value: 'lan', label: '局域网（显式 opt-in，会写防火墙规则）' },
    ],
    enabled: gate.allowed,
    disabledReason: gate.allowed ? null : gate.reason,
  };
}

/** 该状态允许哪些转发动作（`conflict` 恒无动作 —— REQ-1.3 只报告不改动） */
export function buildForwardActions(
  classification: PortClassification,
  gate: { readonly allowed: boolean; readonly reason: string | null },
): ForwardActionView[] {
  const allow = (kind: ForwardActionView['kind'], applies: boolean, label: string, testId: string, blockReason: string | null): ForwardActionView => {
    const reason = !gate.allowed ? gate.reason : applies ? null : blockReason;
    return { kind, testId, label, enabled: reason === null, disabledReason: reason };
  };
  return [
    allow('apply', classification.state === 'missing', '应用转发', `btn-apply-${String(classification.port)}`, '该端口当前不需要新增规则'),
    allow('remove', classification.state === 'ok' || classification.state === 'extra', '移除转发', `btn-remove-${String(classification.port)}`, '只有已就绪/多余的规则才允许移除'),
    allow('fix-drift', classification.state === 'drift', '修复漂移', `btn-fix-drift-${String(classification.port)}`, '只有漂移状态才需要修复'),
  ];
}

export function buildDriftView(classification: PortClassification): DriftView | null {
  if (classification.drift === null) return null;
  const { from, to } = classification.drift;
  return { from, to, text: `旧地址 ${from} → 新地址 ${to}` };
}

export interface DriftFixInput {
  readonly port: number;
  readonly scope: Scope;
  readonly eth0Ip: string;
  readonly managedPorts: ManagedPorts;
  readonly rules: readonly PortproxyRule[];
}

/**
 * 漂移修复序列（T5.6 / design §2 的 `fix` 行：**先 delete 再 add**）。
 *
 * ⚠️ **口径留痕**：命令原文一律来自 005 自己的步骤构造器（`portproxyDeleteStep` /
 * `portproxyAddStep`），本文件不渲染任何命令文本。`blocked` 是 005 的**所有权闸门**结果
 * （`plan.ts` 的 `fix` 分支当前恒被 REQ-1.2 的删除前置拦下：漂移规则的 `connectAddress`
 * 是旧 eth0，不建台账无法证明是本插件写的 ⇒ 序列**展示**、按钮**禁用**）。
 * 这样 UI 既回答了「修复会做什么」，也不会引导一个写路径必须拒绝的动作。
 */
export function buildDriftFixView(input: DriftFixInput): DriftFixView {
  const stale = input.rules.find((rule) => rule.connectAddress !== input.eth0Ip) ?? input.rules[0];
  const intended =
    stale === undefined
      ? []
      : [portproxyDeleteStep(stale), portproxyAddStep(input.port, input.scope, input.eth0Ip)];
  const outcome: WritePlanOutcome = buildWritePlan({
    action: 'fix',
    port: input.port,
    scope: input.scope,
    managedPorts: input.managedPorts,
    eth0Ip: input.eth0Ip,
    rules: input.rules,
    portState: 'drift',
  });
  const steps = (outcome.ok ? outcome.steps : intended).map((step, index) => ({
    order: index + 1,
    kind: step.kind,
    commandText: step.commandText,
  }));
  return {
    port: input.port,
    from: stale?.connectAddress ?? '?',
    to: input.eth0Ip,
    steps,
    blocked: outcome.ok ? null : { reason: outcome.reason, message: outcome.message, hint: outcome.hint },
  };
}

/** 不可转发映射行（REQ-9.2：标「不支持」；未发布到宿主的也标出来） */
export function buildUnsupportedRows(unsupported: readonly UnsupportedMapping[]): UnsupportedRowView[] {
  return unsupported.map((mapping) => ({
    containerName: mapping.containerName,
    protocol: mapping.protocol,
    host: mapping.hostPort === null ? '未发布到宿主' : `${mapping.hostIp ?? ''}:${String(mapping.hostPort)}`,
    containerPort:
      mapping.containerPortEnd === null
        ? String(mapping.containerPort)
        : `${String(mapping.containerPort)}-${String(mapping.containerPortEnd)}`,
    stateLabel: '不支持',
    reason: 'portproxy 只支持 TCP（UDP/SCTP 无法转发；本插件不做代偿 —— REQ-9.3）',
  }));
}

/** 常驻 UDP 提示（REQ-9.1；无交互） */
export const UDP_TIP_TEXT = 'portproxy 不支持 UDP：容器的 UDP 端口映射无法转发，本插件不会用其他机制代偿。';

/**
 * 外部规则只读区域（REQ-15.1）：**没有动作字段**，清单为空时返回 `null`（不渲染该区域）。
 */
export function buildExternalRulesView(external: readonly ExternalRule[]): ExternalRulesView | null {
  if (external.length === 0) return null;
  return {
    title: `外部规则（只读，${String(external.length)} 条）`,
    note: '这些规则不在本插件的 managedPorts 声明集合内，因此不进五态、不计入任何计数、没有任何动作。要接管某个端口，请在下方显式声明它。',
    rows: external.map((rule) => ({ display: rule.display, reason: 'listenPort 不在 managedPorts 内（声明式所有权）' })),
  };
}

/** presets 勾选态（REQ-16.4：勾选只改 managedPorts，不触发写操作/提权） */
export function buildPresetOptions(
  presets: readonly PortPreset[],
  managedPorts: ManagedPorts | null,
): { readonly name: string; readonly label: string; readonly port: number; readonly checked: boolean; readonly testId: string }[] {
  return presets.map((preset) => ({
    name: preset.name,
    label: preset.label,
    port: preset.port,
    checked: managedPorts !== null && isManagedPort(managedPorts, preset.port),
    testId: `chk-preset-${preset.name}`,
  }));
}

/** 区间输入框里的原文（多行 → 用一个字符串，逗号/换行都算分隔；UI 只负责展示与回写原文） */
export function managedPortsText(decls: readonly string[]): string {
  return decls.join('\n');
}

/**
 * 区间原文 + 勾选的 presets → `managedPorts` 声明数组（REQ-16.4：**结果直接写进同一个数组**，
 * 不另建存储）。去重按**端口数值**（`'3306'` 与 `3306` 是同一项），非数字项按原文去重
 * —— 非法项要原样留给解析器报错，**不许**在这里被静默丢掉（REQ-16.1 的「给原因含所在项」）。
 */
export function mergeManagedPortsDecl(draft: string, presetPorts: readonly number[]): string[] {
  const items: string[] = [];
  const seenNumbers = new Set<number>();
  const seenText = new Set<string>();
  const push = (raw: string): void => {
    const text = raw.trim();
    if (text === '') return;
    const asNumber = /^\d+$/.test(text) ? Number(text) : null;
    if (asNumber === null) {
      if (seenText.has(text)) return;
      seenText.add(text);
      items.push(text);
      return;
    }
    if (seenNumbers.has(asNumber)) return;
    seenNumbers.add(asNumber);
    items.push(String(asNumber));
  };
  for (const line of draft.split(/[\n,]/)) push(line);
  for (const port of presetPorts) push(String(port));
  return items;
}

/** 解析声明并给出**全部**非法项的可读原因（REQ-16.1：给出原因含所在项） */
export function managedPortsIssues(decls: readonly string[]): { readonly ok: boolean; readonly ports: ManagedPorts | null; readonly issues: readonly string[] } {
  const parsed = parseManagedPorts(decls);
  if (parsed.ok) return { ok: true, ports: parsed.ports, issues: [] };
  return { ok: false, ports: null, issues: parsed.issues.map((issue) => issue.message) };
}

export { PORT_PRESETS };
