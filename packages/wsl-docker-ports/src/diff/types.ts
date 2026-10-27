/**
 * diff-engine 的类型契约（003 design §2/§3、REQ-3、REQ-6、REQ-9、REQ-15）
 *
 * 这些类型是 003 只读侧对 005（写路径）与 Phase 5（UI）的**唯一接口**，
 * 所以每条字段都写清「它是哪个 REQ 要求的」。
 */

import type { DockerContainer, DockerPortProtocol } from 'dsh-wsl-docker-core';
import type { ListenerTable } from 'dsh-wsl-docker-core';
import type { PortproxyRule } from 'dsh-wsl-docker-core';
import type { ManagedPorts } from './managed-ports.ts';

/** 端口作用域（005 REQ-2.1：逐端口，**默认 loopback**） */
export type Scope = 'loopback' | 'lan';

/** 期望转发项的协议：**只有 TCP**（design §13-1：portproxy 不支持 UDP，REQ-9.3 不代偿） */
export type ExpectedProtocol = 'tcp';

/**
 * 五态（REQ-3.3）。`extra` 的含义是「声明集合里有、规则还在，但 **WSL 内没有可用的监听**
 * ⇒ 这条规则多半是多余（可移除）」。013 起判据从「docker 是否映射」换成
 * 「WSL 内有没有服务在监听该端口」（REQ-1.2）；期望集**本身**只会落在前四态。
 *
 * ⚠️ `extra` 是「可移除」的**结论**，不是「docker 没映射」的同义词：docker 没映射但
 * `python -m http.server` 在监听 ⇒ 落在 `ok`（原因 `listener-active`），**不再**判多余。
 */
export type PortState = 'ok' | 'missing' | 'drift' | 'conflict' | 'extra';

/** 运行时清单（顺序 = UI 表格的推荐顺序）；供 `counts` 初始化与 UI 遍历，避免各处手抄字面量 */
export const PORT_STATES = ['ok', 'missing', 'drift', 'conflict', 'extra'] as const satisfies readonly PortState[];

/**
 * 需要**额外解释**的原因（不是失败；大多不改变 state，`extra` 的两种原因例外）：
 *
 * - `wsl-localhost-forwarding`：loopback 且 `localhostForwarding=true` ⇒ **无需规则**（005 REQ-2.2）
 * - `listener-active`（013 新增）：docker 已不映射，但 **WSL 内有进程监听**该端口
 *   （`0.0.0.0` / `*` / `[::]` / eth0 地址）⇒ 规则**真在工作**，落在 `ok`，**不**判多余
 * - `loopback-only`（013 新增）：只有 `127.0.0.1` / `[::1]` 在听 ⇒ portproxy 连不到 ⇒ `extra`
 * - `no-listener`（013 新增）：该 `connectPort` 完全没人监听 ⇒ `extra`
 * - `listeners-unknown`（013 新增）：监听表读不到（WSL 停止 / `ss` 不可用 / 超时 / 形态不可识别）
 *   ⇒ **未知**：UI 明示「无法确认服务是否在跑」，但「移除」按钮仍可点（主人裁定）
 * - `no-docker-mapping`：**已弃用（013）**，不再作为 `extra` 的依据。类型保留只为兼容
 *   「旧服务端快照 / 旧调用方」——客户端把它按 `listeners-unknown`（未知）处理，绝不再渲染
 *   「docker 已不再映射」这句文案。
 */
export type ClassifyReason =
  | 'wsl-localhost-forwarding'
  | 'listener-active'
  | 'loopback-only'
  | 'no-listener'
  | 'listeners-unknown'
  /** @deprecated 013 起弃用：不再参与判决；仅为旧快照兼容保留 */
  | 'no-docker-mapping';

/** 漂移的「旧 → 新」（REQ-6.2：UI 必须显示两个地址，不能只说「漂移了」） */
export interface DriftDetail {
  readonly from: string;
  readonly to: string;
}

/** 期望转发项 = docker 实际映射 ∩ `managedPorts`（REQ-3.1） */
export interface ExpectedForward {
  /** 宿主侧端口 = `listenPort` = 期望的 `connectPort`（005 §2 的规则形态） */
  readonly port: number;
  readonly protocol: ExpectedProtocol;
  readonly scope: Scope;
  /**
   * 该端口**是否需要 portproxy 规则**：
   * `lan` 恒 true（005 REQ-2.3）；`loopback` 则取决于 `localhostForwarding`（005 REQ-2.2/2.5）。
   * 这个字段让 `missing` 有确切含义 —— 不需要规则却报 `missing` 会把用户引去加一条不该加的规则。
   */
  readonly needsRule: boolean;
  /** 发布该端口的容器名（同一个宿主端口理论上只可能有一个容器，数组是防御性的） */
  readonly containerNames: readonly string[];
  /** 容器侧端口（映射区间时随宿主端口 1:1 偏移） */
  readonly containerPort: number;
  /** docker 侧的宿主地址形态（`0.0.0.0` / `[::]`），仅作展示证据 */
  readonly hostIps: readonly string[];
}

/** 单个端口的一条归类（REQ-3.3：**每个端口恰好一条**） */
export interface PortClassification {
  readonly port: number;
  readonly state: PortState;
  readonly reason: ClassifyReason | null;
  /**
   * 期望项（docker 也映射该端口）。**`null` 有两种情况**：
   * - `extra`（可移除：无监听 / 仅回环监听）；
   * - 013 的 `ok` + `listener-active`（docker 没映射，但 WSL 内有服务在监听 ⇒ 规则真在工作）。
   */
  readonly expected: ExpectedForward | null;
  /** 该端口上的**全部**既有规则（UI 展开原始证据用；判定只取其中相关的那条） */
  readonly rules: readonly PortproxyRule[];
  /** 仅 `drift` 非空 */
  readonly drift: DriftDetail | null;
  /** 仅 `conflict` 非空：与本插件声明不符、**不得改动**的那些规则（REQ-4.3 只报告） */
  readonly conflicts: readonly PortproxyRule[];
  /**
   * **事实位**（不是状态）：既有规则的 `listenAddress` 与当前声明的作用域不一致
   * （例如声明 loopback、规则却监听 `0.0.0.0`）。刻意**不**判 `conflict` —— 005 REQ-1.2
   * 明确允许删/改「`connectAddress` 匹配」的规则，判 conflict 会把用户锁死在这一态
   * （这正是 design §3 与 005 REQ-1.3 的口径分歧，见本次报告）。UI 据此提示即可。
   */
  readonly scopeMismatch: boolean;
}

/**
 * 外部规则（REQ-15.1，D-2）：既不在 `managedPorts`、也非本插件写入的既有规则。
 * 纯只读、**不进五态、不计入任何计数、无动作**。
 *
 * ⚠️ 判据只有「`listenPort ∉ managedPorts`」一条：本插件**不建台账**（stack-decision：
 * 「不建台账文件」），因此无法从规则本身分辨「谁写的」—— 原脚本写的 19 条 `connectAddress`
 * 就是 eth0，与插件写的规则长得一模一样。声明式所有权（005 REQ-1.1）的落地方式正是
 * 「集合内 = 我的（可管），集合外 = 别人的（只看）」。
 */
export interface ExternalRule {
  readonly rule: PortproxyRule;
  /** `listenAddress:listenPort → connectAddress:connectPort`（REQ-15.1 要求的展示形态） */
  readonly display: string;
  readonly reason: 'port-not-managed';
}

/**
 * 无法转发的映射（REQ-9.2：UDP 必须标出「不支持」，**不许**直接忽略）。
 * `sctp` 顺手同办：portproxy 同样不支持（design §13-1「只支持 TCP」），不必另立一套概念。
 */
export interface UnsupportedMapping {
  readonly containerName: string;
  readonly protocol: Exclude<DockerPortProtocol, 'tcp'>;
  /** 未发布到宿主时为 `null`（仍然标出来 —— REQ-9.2 的「不许忽略该映射」） */
  readonly hostIp: string | null;
  readonly hostPort: number | null;
  readonly containerPort: number;
  readonly containerPortEnd: number | null;
  readonly reason: 'portproxy-tcp-only';
}

/** 引擎输入（全部是**已解析**的事实：引擎是纯函数，不碰进程、不碰文件） */
export interface DiffInput {
  readonly containers: readonly DockerContainer[];
  readonly managedPorts: ManagedPorts;
  readonly rules: readonly PortproxyRule[];
  /** `null` = 取不到 eth0（REQ-6.4）⇒ 引擎**不给任何五态判决** */
  readonly eth0Ip: string | null;
  /** `localhostForwarding`（T1.3）；决定 loopback 是否需要显式规则 */
  readonly localhostForwarding: boolean;
  /** 逐端口作用域；键是端口号的字符串形式（配置里的写法），缺省 = `loopback` */
  readonly scopes?: Readonly<Record<string, Scope>>;
  /**
   * 013：WSL 监听表（`ss -ltn` 一次读全表）。
   *
   * - `ok:true` ⇒ 按每条规则的 `connectPort` 查：通配/eth0 ⇒ 在用；仅回环 ⇒ `extra` + `loopback-only`；
   *   无监听 ⇒ `extra` + `no-listener`；
   * - `ok:false` 或**缺省** ⇒ `extra` + `listeners-unknown`（**未知**，**不是**「没有监听」）。
   *   缺省是给旧调用方 / 单元测试留的诚实值：没探过就不许假装知道。
   */
  readonly listeners?: ListenerTable;
  /**
   * 012 决策 1：候选清单（Windows 物理网卡 IPv4）—— **形态判据的一个来源**，不是完整集合。
   *
   * 2026-10-23（缺陷 F1）起，读侧按端口把它与 `listenAddresses[端口]` 取并集后交给
   * `isOurListenAddress`（唯一组装点 = `diff/listen-allowed.ts:allowedListenAddressesFor`）——
   * **写侧（`write/guards.ts`）调的是同一个函数**，两侧不再各有一套口径。
   * 仍不放宽到「任何 IPv4」：两个来源都取不到的地址照旧 `conflict`。
   */
  readonly allowedListenAddresses?: readonly string[];
  /**
   * 012 逐端口监听地址选择（键 = 端口号字符串，值 = 具体 IP）。
   *
   * 只影响 `lan`：`expectedListenAddress('lan', 选中值)` 用它替掉默认 `0.0.0.0`，
   * 于是「用户选了 `192.168.31.129` 的规则」不会因为「不是 0.0.0.0」被判 `scopeMismatch`。
   * 2026-10-23 起它还参与**形态判据**（该端口登记过的值算「本插件形态」）—— 见上一条。
   */
  readonly listenAddresses?: Readonly<Record<string, string>>;
}

export interface DiffResult {
  /** 每端口恰好一条（REQ-3.3：不重复计数） */
  readonly ports: readonly PortClassification[];
  /** 期望集（REQ-3.1） */
  readonly expected: readonly ExpectedForward[];
  /** 外部规则只读集合（REQ-15.1） */
  readonly external: readonly ExternalRule[];
  /** 不可转发的映射（REQ-9.2） */
  readonly unsupported: readonly UnsupportedMapping[];
  readonly counts: Readonly<Record<PortState, number>>;
  /** 本次判决依据的 eth0（成功态必非 null） */
  readonly eth0Ip: string;
}

/**
 * 失败态（REQ-6.4）：取不到 eth0 时**一条判决都不给** —— 不是「降级成 ok」，
 * 也不是「全标 drift」（REQ-6.4 明令禁止后者）。不猜，就是最安全的那条路。
 *
 * 失败态里仍然带上 `external` / `unsupported`：它们与 eth0 无关，WSL 停着的时候
 * 用户照样该看得见「哪些规则是别人的」「哪些映射根本转不了」。
 */
export interface DiffFailure {
  readonly ok: false;
  readonly reason: 'eth0-unknown';
  readonly message: string;
  readonly hint: string;
  readonly external: readonly ExternalRule[];
  readonly unsupported: readonly UnsupportedMapping[];
}

export type DiffOutcome = { readonly ok: true; readonly result: DiffResult } | DiffFailure;
