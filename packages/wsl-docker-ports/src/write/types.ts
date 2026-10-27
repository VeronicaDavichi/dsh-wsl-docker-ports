/**
 * 写路径的类型契约（005 REQ-1 / REQ-2，design §2/§3）
 *
 * ## 三个刻意的形状选择
 *
 * 1. **动作只有四个**（`add` / `remove` / `fix` / `switch-scope`）—— 没有「批量」「全部重建」
 *    这种入口，从结构上排除原脚本坑 #1（`reset` 清空全部规则）。作用域切换是**逐端口**动作
 *    （REQ-2.4），所以它带 `port`，不是「给所有端口切」。
 * 2. **步骤是结构化参数 + 渲染出的命令原文**（REQ-3.7 / REQ-3.2）：`params` 是唯一真相，
 *    `commandText` 只是给人看的渲染结果。提权脚本只吃 `params` 的白名单字段，
 *    不接受任何外部命令文本。
 * 3. **被拦下的规划恒带空 `steps`**（`WriteBlock.steps` 是空元组）：REQ-1.2/1.3 的
 *    「不满足前置就一个动作都不产生」在类型层就说死了 —— 调用方想在拦下时「顺手做点什么」
 *    是不可能的，因为那里根本没有可执行的步骤。
 */

import type { ManagedPorts } from '../diff/managed-ports.ts';
import type { AllowedListenFacts } from '../diff/listen-allowed.ts';
import type { PortState, Scope } from '../diff/types.ts';
import type { PortproxyRule } from 'dsh-wsl-docker-core';

/** 写动作（REQ-1.2 / REQ-2.4 / design §2） */
export type WriteAction = 'add' | 'remove' | 'fix' | 'switch-scope';

/** 单个步骤的种类（`portproxy-*` 走 netsh，`firewall-*` 走 NetFirewall cmdlet） */
export type WriteStepKind = 'portproxy-add' | 'portproxy-delete' | 'firewall-add' | 'firewall-delete';

/**
 * 一个写步骤。`params` 的键是**白名单字段**（`listenport` / `listenaddress` / `connectport` /
 * `connectaddress` / `displayName` / `localPort` …），提权脚本模板只认这些键。
 */
export interface WriteStep {
  readonly kind: WriteStepKind;
  /** 该步骤作用的端口（断言「只动本端口」用；永远等于规划入参的端口） */
  readonly port: number;
  readonly params: Readonly<Record<string, string | number>>;
  /** 给人看的命令原文（REQ-3.2「展示将执行的命令原文」）；由 `params` 渲染，不接受外部文本 */
  readonly commandText: string;
}

/** 一次可执行的规划（`ok: true`） */
export interface WritePlan {
  readonly ok: true;
  readonly action: WriteAction;
  readonly port: number;
  readonly scope: Scope;
  readonly eth0Ip: string;
  /**
   * 012（2026-10-22）：本次规划实际使用的监听地址（仅当用户显式选了具体 IP 时出现）。
   * 缺省不出现 ⇒ 010 及之前的所有断言与形状逐字不变。
   */
  readonly listenAddress?: string;
  /** 有序步骤：顺序即执行顺序（REQ-2.3 要求「portproxy add + 防火墙 add」这个次序） */
  readonly steps: readonly WriteStep[];
  /** 必须让用户看见的解释（REQ-2.5「不静默」；如 `localhostForwarding=false` 的差异说明） */
  readonly notes: readonly string[];
  /** 全部步骤的命令原文（`\n` 连接），供 `ask` 确认展示 */
  readonly commandText: string;
}

/** 拦下的原因（每个都对应一条 REQ；文案由 `plan.ts` 给） */
export type WriteBlockReason =
  | 'port-not-managed'
  | 'eth0-unknown'
  | 'state-conflict'
  | 'state-precondition'
  | 'rule-not-owned'
  | 'firewall-rule-exists'
  /** 012：选中的监听地址/掩码算不出网段 ⇒ 零动作（不允许退化成「放行所有来源」） */
  | 'listen-address-invalid';

/**
 * 被拦下的规划。**`steps` 恒为空** —— 这是 REQ-1.2 / REQ-1.3 的安全形态：
 * 前置不满足时系统不是「少做一步」，而是「一个动作都不产生」。
 */
export interface WriteBlock {
  readonly ok: false;
  readonly reason: WriteBlockReason;
  readonly port: number;
  readonly message: string;
  readonly hint: string;
  readonly steps: readonly [];
  /** REQ-1.3：只报告的冲突规则（UI 据此提示用户手工处理） */
  readonly conflictRules: readonly PortproxyRule[];
}

export type WritePlanOutcome = WritePlan | WriteBlock;

/** 规划入参（纯数据：不接执行器、不碰文件 —— 与 003 的引擎同一取向） */
export interface WritePlanInput {
  readonly action: WriteAction;
  /** 目标端口：**必填且唯一**（REQ-2.4 逐端口显式操作；无隐式批量） */
  readonly port: number;
  /** 目标作用域；`switch-scope` 时是**目标**作用域，`fromScope` 是原作用域 */
  readonly scope: Scope;
  /** 声明集合（REQ-1.1 所有权判据）；集合外端口零参与 */
  readonly managedPorts: ManagedPorts;
  /**
   * 当前 eth0（= 本插件该端口的**期望** `connectAddress`）。
   * `null` = 取不到（003 REQ-6.4）⇒ 期望值不可判定 ⇒ **不产生任何动作**。
   */
  readonly eth0Ip: string | null;
  /** 该端口的全部既有规则（003 的五态输入） */
  readonly rules: readonly PortproxyRule[];
  /** 003 的五态判决（给了就额外过一道门；不给则只用规则事实判） */
  readonly portState?: PortState;
  /** `switch-scope` 的原作用域 */
  readonly fromScope?: Scope;
  /** `localhostForwarding`（REQ-2.2/2.5）：`loopback` 是否需要显式规则 */
  readonly localhostForwarding?: boolean;
  /** 已存在的防火墙规则名（REQ-2.6 同名冲突判定）；不给则该门不启用 */
  readonly existingFirewallNames?: readonly string[];
  /**
   * 012（2026-10-22）：用户为**本端口**显式选择的监听地址（仅 `lan` 有意义）。
   *
   * 不给 ⇒ 逐字同 010（`lan` = `0.0.0.0`）。给了 ⇒ `portproxy-add` 的 `listenaddress` 用它，
   * 且 `firewall-add` 追加 `-RemoteAddress <网段>`（网段由 `listenAddressPrefixLength` 算，
   * 缺省 `/32`）。算不出网段 ⇒ `listen-address-invalid` 拦下、零步骤。
   */
  readonly listenAddress?: string;
  /** 选中地址的掩码长度（来自候选清单的 `PrefixLength`；缺省 `32` = 只放行该地址本身） */
  readonly listenAddressPrefixLength?: number;
  /**
   * 012（2026-10-22）：**允许**的监听地址清单（= 服务端现读的候选物理网卡 IPv4）。
   *
   * 🔴 给了 `listenAddress` 就必须在这里面：不在 ⇒ `listen-address-invalid`、零步骤
   * （**绝不**静默回退 `0.0.0.0`）。清单**缺席 = 空集**（fail-closed）—— 这个字段不是可选装饰，
   * 漏传的后果是「什么都不做」，不是「随便写」。
   *
   * ⚠️ 2026-10-23（缺陷 F1）：本字段只服务**选择门**（能不能写这个地址）。判「既有规则算不算
   * 本插件形态」用的是下面的 `listenForms` —— 两者故意分开，别把这里的 fail-closed 语义
   * 混进所有权判据（那会把「配置里登记过的值」也当成需要候选清单背书的地址）。
   */
  readonly allowedListenAddresses?: readonly string[];
  /**
   * 2026-10-23（真机缺陷 F1）：**本插件形态**判据的两项事实 = 该端口配置里登记的监听地址 +
   * 候选清单。缺省 ⇒ 只认 `{127.0.0.1, 0.0.0.0}`（= 010 及之前的行为，一条断言不变）。
   *
   * 组装点唯一：`write/guards.ts:matchOf` 调 `diff/listen-allowed.ts:allowedListenAddressesFor`，
   * 读侧（`diff/engine.ts`）调的是**同一个函数** ⇒「快照说 ok、计划说 conflict」不可能再出现。
   */
  readonly listenForms?: AllowedListenFacts;
  /**
   * 2026-10-23（缺陷 F1）：`listenAddress` 是不是**该端口既有规则此刻正在监听**的那个地址。
   *
   * 只对 `fix` 有用：重写一条规则自己已有的监听地址**不新增暴露面** ⇒ 可以跳过候选清单那道门
   * （`guards.ts:listenAddressGate`）。否则该短条件不成立时行为一字不变（门照旧 fail-closed）。
   */
  readonly listenAddressInPlace?: boolean;
}
