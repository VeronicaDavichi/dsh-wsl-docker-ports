/**
 * 行级纯函数：五态标签 / NAT 门指引 / 端口行 / 不可转发行 / 外部规则区 / presets（003 Phase 5）
 *
 * 全部**纯数据进出**：不接 DOM、不接执行器、不读配置。`pane.tsx` 只负责把这些对象画出来，
 * 于是「五态各自可渲染」「外部规则区无动作控件」这类断言可以在**无 DOM** 下逐条钉死。
 *
 * 🔴 D1（2026-10-23 真机）：容器表的行构造（`buildContainerRows`）已随 UI 一起移出转发侧；
 * 容器行只活在容器页自己的快照/渲染里。
 */

import { PORT_PRESETS, type PortPreset } from '../diff/port-presets.ts';
import { isManagedPort, type ManagedPorts } from '../diff/managed-ports.ts';
import { parseManagedPorts } from '../diff/managed-ports-parse.ts';
import type { PortClassification, PortState, Scope, UnsupportedMapping, ExternalRule } from '../diff/types.ts';
import type {
  DriftView,
  ExternalRulesView,
  ForwardActionView,
  NatGateView,
  NatGuideView,
  PortTone,
  ScopeControlView,
  UnsupportedRowView,
} from './types.ts';

/**
 * 页定义 / seat 注册参数已拆到 [`tab-def.ts`](./tab-def.ts)（主包常驻面只装那一小块）。
 * 这里**原样转发**（**只转发侧**：016 起容器页定义属于容器包自己的 bundle）。
 */
export {
  PAGE_ID,
  PAGE_KIND,
  PAGE_TITLE,
  TAB_SLOT,
  TAB_TITLE_SLOT,
  GUIDE_ENTRY_ID,
  GUIDE_ENTRY_ORDER,
  GUIDE_ENTRY_TITLE,
  GUIDE_ENTRY_DESCRIPTION,
  TAB_SEATS,
  paneTabDefinition,
  portsTabDefinition,
  registerTabSeats,
} from './tab-def.ts';

/**
 * **guide 空态入口**（真机复验缺陷：页存在但用户在右栏空态里点不到）。
 *
 * 官方形状逐字取自离线实物 `0.1.7-rc.2`
 * `deepseek-ai-dsh-client-ui-sidebar-files-0.1.7-rc.2.tgz` → `package/lib/client.js:22-38`：
 *
 *     function filesDefinition(t) {
 *       return { id: FILES_ID, kind: FILES_KIND, priority: "builtin", title: () => t("type.label"),
 *         guide: [{ id: "workspace", commandId: "workspace.files", order: 10,
 *                   title: () => t("guide.title"), description: () => t("guide.description"),
 *                   icon: _deepseek_ai_dsh_client_ui_primitives.GuideArtworkFiles }] };
 *     }
 *
 * 同形第二/第三例（同一批 `0.1.7-rc.2` 产物，逐字核对）：
 * - `deepseek-ai-dsh-client-ui-sidebar-terminal-*.tgz` → `lib/client.js:444-451`：
 *   `{ id: "new", order: 20, title, description, icon }`（该家直接内联在 `apply` 里注册）。
 * - `deepseek-ai-dsh-client-ui-sidebar-browser-*.tgz` → `lib/client.js`（`browserDefinition`）：
 *   `{ id: "new", commandId: "browser.new", order: 30, title, description, icon }`。
 *
 * 官方 guide 位次**全集**（0.1.7-rc.2，逐包扫过）：`files`=10 / `terminal`=20 / `browser`=30；
 * `plan` / `schedule` / `subagent` / `documentpreview` / `sidebar-right` 自**不带** guide 入口。
 * 故本包 `order` 取 **40** —— 排在官方全部入口之后（`refresh()` 是按 `order` 升序排，重复值虽合法
 * 但会退化成「谁先注册谁在前」，第三方位次不该去挤官方的档）。
 * `icon` **不写** —— 官方类型只要求 `id`/`order`/`title`，无 `icon` 时 guide 画自己的立方体占位符
 * （`package/lib/types/client/tab-registry.d.ts:65-66` 原文：
 * "Optional glyph, drawn before the title; without one the guide draws its cube placeholder."），
 * 于是也不必为此新增一个 `@deepseek-ai/dsh-client-ui-primitives` 运行时 import。
 */
/* guide 位次与文案常量已在 `./tab-def.ts` 里定义并由上方 re-export 转发 */

/** `data-testid` 常量（requirements §2 的控件清单逐条对应，测试与实现共用一个字面量） */
export const TESTID = {
  refresh: 'btn-refresh',
  natGuide: 'btn-nat-guide',
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

/* 页定义 / 两个 seat 的注册参数 / `registerTabSeats` 都在 `./tab-def.ts`，由上方 re-export 转发 */

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

/*
 * 🔴 **2026-10-13 搬家留痕（011 `T1.3`；原文一字未删、只是挪了文件）**：
 * `DriftFixInput` + `buildDriftFixView` **整段**搬到 [`drift-fix.ts`](./drift-fix.ts)。
 * 理由：`buildDriftFixView` 是本文件里**唯一**触碰 `../write/index.ts` 的函数，而本文件是
 * **tab 注册面**（REQ-BS-3 要求常驻主包）⇒ 它的那一行 import 会把 `write/plan.ts` 13,321 B
 * 连同 `ownership` / `scope-note` / `firewall` 同步拽回主包，与 REQ-BS-2 冲突。
 * 搬出后本文件**不再 import 写路径内核**（判据：产物里本文件仍在主包、`write/plan.ts` 不在）。
 * 调用方 = `page.ts`（渲染面，已改正 import 路径）+ `tests/unit/client-rows.test.ts`（断言未动）。
 * 原处**不留转发再导出** —— 那样等于没搬（再导出仍构成同步边）。
 */


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
 * 提权告知（005 T2b.3 / 判据 C）。**UI 只渲染这一份字面量**，用户手册
 * （`packages/wsl-docker-ports/README.md` 的「提权与 UAC 自查」节）写同一套取值含义与同一条自查命令
 * ⇒ **改一处必须同步另一处**；`tests/client/elevation-consent-notice.test.tsx` 逐字断言本常量出现在渲染结果里。
 *
 * 🔴 事实来源（2026-10-15 真机只读实测，非推断）：本机 `ConsentPromptBehaviorAdmin = 0x0`
 * 而 `EnableLUA = 0x1` ⇒ UAC **没有**被整体关闭，但提权**不弹确认**（静默提权；`Get-Process consent` = 0，
 * 代理曾零人工交互完成真写 + 真删）⇒ 「UAC = 人类闸门」在本机不成立，本页的「变更预览 + 确认」
 * 才是唯一闸门。取值含义取自 Windows 官方定义（0–5），命令用 `reg query`（只读）。
 */
export const ELEVATION_CONSENT_NOTICE =
  '⚠️ 本机提权可能不会请你确认：若系统 UAC 策略为「不提示直接提权」（ConsentPromptBehaviorAdmin = 0），提权链会静默执行 —— 此时本页的「变更预览 + 确认」就是你唯一的人类闸门。自查：reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v ConsentPromptBehaviorAdmin（0 = 不提示直接提权，2 = 安全桌面确认，5 = 默认；EnableLUA = 0 表示 UAC 整体关闭）。完整取值表与逐步自查见用户手册「提权与 UAC 自查」节。';

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

/**
 * 区间输入框里的原文（用一个字符串展示；UI 只负责展示与回写原文）。
 *
 * 🔴 **2026-10-27 主人拍板**：「端口或区间（每行一项…）这个不行，不能每行，要支持半角逗号分隔」
 * ⇒ 回写一律用 **半角逗号 + 一个空格**（`3306, 5432, 1000-3000`），读入侧仍兼容换行（旧配置/旧习惯）。
 */
export function managedPortsText(decls: readonly string[]): string {
  return decls.join(', ');
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
  // 分隔符：半角逗号（主用法，主人 2026-10-27 指定）+ 换行（旧习惯/粘贴多行）+
  // 全角逗号 / 顿号（中文输入法顺手打出来的，当分隔符不算数据）。
  // ⚠️ **不把空格当分隔**：空格在 `1000 - 3000` 里是排版，静默拆开会改写用户原意，
  // 那类原文该原样进解析器、由解析器报「不是数字」并带出所在项。
  for (const line of draft.split(/[\n,，、]+/u)) push(line);
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
