/**
 * 页面视图模型与渲染输入（003 Phase 5 / T5.1–T5.8）
 *
 * ## 为什么视图模型是**纯数据**
 *
 * `buildPortsPageView()` 的返回值里**不含任何函数**（与五态引擎同一取向，测试有断言）：
 * 渲染层只做「把事实画出来」，动作授权全在宿主半（005）。这样
 * 「外部规则区没有任何动作控件」（REQ-15.1）与「开页零写操作」（NFR-2）
 * 都不是靠自觉，而是**结构上就没有可调用的东西**。
 */

import type { ExternalRule, PortState, Scope, UnsupportedMapping } from '../diff/types.ts';
import type { DistroPanelData, DockerView, NatGateView, NatGuideView, PortsSnapshot } from '../wire.ts';

/**
 * 🔴 T6.8 起，**传输契约**（快照形状 + NAT 门 + docker 视图 + 发行版数据）住在**宿主侧**
 * `../wire.ts`，因为装配快照的是宿主半。这里**转出**它们，客户端内部的既有 import
 * （`from './types.ts'`）一行都不用改 —— 契约仍只有一份定义。
 */
export type { DistroPanelData, DockerView, NatGateView, NatGuideView, PortsSnapshot };

/** 中文标签的顺序权威（与五态引擎的 `PORT_STATES` 同源，不另抄一份字面量） */
export type PortTone = 'ok' | 'warn' | 'danger' | 'muted';

export interface ContainerRowView {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly state: string;
  readonly status: string;
  readonly ports: string;
}

/** 写控件（转发类）—— 全部带 `data-write-control`，非 NAT 时**一个都不可点**（T5.2） */
export interface ForwardActionView {
  readonly kind: 'apply' | 'remove' | 'fix-drift';
  readonly testId: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

/** 逐端口作用域控件（T5.3：**每端口一个**，默认 loopback，无「全选局域网」入口） */
export interface ScopeControlView {
  readonly testId: string;
  readonly port: number;
  readonly value: Scope;
  readonly options: readonly { readonly value: Scope; readonly label: string }[];
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

export interface DriftView {
  /** 旧地址（规则里的 `connectAddress`） */
  readonly from: string;
  /** 新地址（当前 eth0） */
  readonly to: string;
  /** 给人看的一行：`旧 → 新`（REQ-6.2） */
  readonly text: string;
}

/** 漂移修复序列（T5.6）：**先删后加**；被写路径拦下时如实带出原因 */
export interface DriftFixView {
  readonly port: number;
  readonly from: string;
  readonly to: string;
  readonly steps: readonly { readonly order: number; readonly kind: string; readonly commandText: string }[];
  readonly blocked: { readonly reason: string; readonly message: string; readonly hint: string } | null;
}

export interface PortRowView {
  readonly port: number;
  readonly state: PortState;
  readonly stateLabel: string;
  readonly tone: PortTone;
  readonly reasonText: string | null;
  /** 事实位：监听地址与声明作用域不一致（design §3 订正②；**不**改 state） */
  readonly scopeMismatch: boolean;
  readonly scopeControl: ScopeControlView;
  /** 012 REQ-1.1：监听地址下拉（仅「局域网」作用域渲染；`loopback` 恒 127.0.0.1） */
  readonly listenAddress: ListenAddressControlView;
  readonly actions: readonly ForwardActionView[];
  readonly drift: DriftView | null;
  readonly fix: DriftFixView | null;
  readonly needsRule: boolean;
  readonly containerNames: readonly string[];
}

/**
 * 监听地址下拉（012 REQ-1.1/2.1）。
 *
 * - `options` = 默认项 `0.0.0.0（所有网卡）` + 候选物理网卡 IPv4（标签带别名与 `/PrefixLength`）；
 * - 枚举失败 ⇒ `options` 只剩默认项，`note` 带上**原因文案**（读不到 ≠ 没有网卡）；
 * - `enabled` 只受写闸门管（作用域不是 lan 时由渲染侧整块不显示，见 `pane-tables.tsx`）。
 */
export interface ListenAddressControlView {
  /** 恒为 `sel-listen-address`（012 验收 A1 的选取器） */
  readonly testId: string;
  readonly port: number;
  /** 当前值（缺省 `0.0.0.0`；用户选择是客户端本地草稿，暂不回写服务端配置） */
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  /** 读不到网卡清单 / 一个候选都没有时的原因文案（正常时 `null`） */
  readonly note: string | null;
}

/** 不可转发的映射（REQ-9.2：标「不支持」，**不许**直接忽略，也不代偿） */
export interface UnsupportedRowView {
  readonly containerName: string;
  readonly protocol: string;
  readonly host: string;
  readonly containerPort: string;
  readonly stateLabel: string;
  readonly reason: string;
}

/** 外部规则只读区域（REQ-15.1）：**没有** `actions` 字段，空清单时整体为 `null`（不渲染） */
export interface ExternalRulesView {
  readonly title: string;
  readonly note: string;
  readonly rows: readonly { readonly display: string; readonly reason: string }[];
}

/** 「进容器 exec」注入点（REQ-10.1/10.3/10.4）：**恒禁用**，只解释为什么 */
export interface ExecControlView {
  readonly testId: string;
  readonly label: string;
  readonly enabled: false;
  readonly reason: string;
  readonly serviceAvailable: boolean;
}

/** 端口声明最小表单（REQ-16.4/16.5）：区间输入 + presets 勾选，写 `managedPorts` */
export interface ManagedPortsFormView {
  readonly inputTestId: string;
  readonly rangeText: string;
  readonly issues: readonly string[];
  readonly presets: readonly { readonly name: string; readonly label: string; readonly port: number; readonly checked: boolean; readonly testId: string }[];
  readonly saveTestId: string;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

export interface DistroPanelView {
  readonly stateNote: string | null;
  readonly testId: string;
  readonly name: string | null;
  readonly sourceLabel: string;
  readonly state: string | null;
  readonly options: readonly { readonly name: string; readonly state: string; readonly isDefault: boolean; readonly selected: boolean }[];
  readonly staleMessage: string | null;
  readonly error: string | null;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

export interface NatGatePanelView {
  readonly testId: string;
  /** 门是否放行（`true` ⇒ 转发写控件可用） */
  readonly open: boolean;
  readonly reason: string;
  readonly guide: NatGuideView | null;
}

/** 最近一次写操作的可读摘要（014 从 `pane.tsx` 移来：`use-auto-refresh` 也要用它重建视图） */
export interface LastWriteView {
  readonly status: string;
  readonly message: string;
  readonly unapplied: readonly string[];
}

/** 整页视图模型（`pane.tsx` 逐字段渲染；测试直接断言这个对象） */
export interface PortsPageView {
  readonly refreshedAt: number;
  readonly refreshedAtText: string;
  readonly nat: NatGatePanelView;
  readonly docker: DockerView;
  readonly containers: readonly ContainerRowView[];
  readonly containerCount: number;
  /** 列表是否**只含运行中**（docker ps -a 失败时的回落说明）；
ull = 全部容器都列了 */
  readonly containerListNote: string | null;
  readonly ports: readonly PortRowView[];
  readonly counts: Readonly<Record<PortState, number>>;
  readonly portsNote: string | null;
  readonly eth0: { readonly known: boolean; readonly ip: string | null; readonly text: string; readonly launchTestId: string; readonly launchEnabled: boolean; readonly launchNote: string };
  readonly udpTip: { readonly testId: string; readonly text: string };
  readonly unsupported: readonly UnsupportedRowView[];
  readonly external: ExternalRulesView | null;
  readonly externalCount: number;
  readonly managedPorts: ManagedPortsFormView;
  readonly distro: DistroPanelView;
  readonly exec: ExecControlView;
  readonly elevation: { readonly testId: string; readonly value: 'none' | 'ask' | 'passby'; readonly options: readonly { readonly value: string; readonly label: string }[]; readonly enabled: boolean; readonly note: string; readonly notice: string };
  readonly lastWrite: LastWriteView | null;
}

/** 外部规则只读行的构造输入（`ExternalRule` 来自引擎） */
export type ExternalRuleRow = ExternalRule;
/** 不可转发映射的构造输入 */
export type UnsupportedMappingRow = UnsupportedMapping;

