/**
 * 五态引擎（003 Phase 2 / REQ-3 / REQ-6 / REQ-9 / REQ-15）
 *
 * ## 判定只依据三条事实（REQ-3.4）
 *
 * ① `listenPort` 是否 ∈ `managedPorts`；② `connectAddress` 是否等于当前 eth0；
 * ③ 该端口上是否存在**与本插件声明不符**的既有规则。
 * **不用**时间戳、条目顺序、名称相似度 —— 那些都会让「为什么它是这个状态」无法自证。
 *
 * ## 013：`extra` 的第四类事实 = WSL 监听表
 *
 * 「规则还在、docker 已不映射」不再直接等于「多余」：主人用 `python -m http.server 3306`
 * 起服务时，那条规则是**真在工作**的。判据改为按每条规则的 `connectPort` 查监听表
 * （`ss -ltn` 一次读全表，见 `read/listeners-probe.ts`）：
 *
 * | 监听形态 | state | reason |
 * | --- | --- | --- |
 * | 通配（`0.0.0.0` / `*` / `[::]`）或 eth0 地址 | `ok` | `listener-active` |
 * | 只有回环（`127.0.0.1` / `[::1]`） | `extra` | `loopback-only` |
 * | 完全无监听 | `extra` | `no-listener` |
 * | 读不到（WSL 停止 / `ss` 不可用 / 超时 / 形态脏）或**调用方没提供** | `extra` | `listeners-unknown` |
 *
 * ⚠️ 未知态**不是**「没有监听」—— 它仍然落在 `extra`（所以「移除」照旧可点，主人裁定），
 * 但 UI 必须把标签与文案换成「未知」。`ok` / `missing` / `drift` / `conflict` 的既有语义
 * **一个字没动**：期望集那条路径完全不看监听表。
 *
 * ## 优先级与「两个分歧」（本次实现的两处口径判断，均在报告里留痕）
 *
 * 1. **优先级 `conflict` > `drift` > `ok`**（design §3）：同一端口上若有**任何**一条形状不符的规则，
 *    整端口报 `conflict`；若没有冲突但有规则指向旧地址，报 `drift`（**drift 优先于 ok** ——
 *    否则一条「一条好规则 + 一条陈旧规则」会被报成 ok，把陈旧的那条藏起来）。
 * 2. **`listenAddress` 与声明作用域不一致 ⇒ 不判 `conflict`，只置 `scopeMismatch`**：
 *    design §3 把「listenAddress 非本插件会写的值」也算 conflict，但 005 REQ-1.3 把 conflict
 *    定义为**按 `connectAddress` 判**（「既非当前 eth0、也非本插件写入值」），且 005 REQ-1.2
 *    明确允许删除 `connectAddress` 匹配的规则。若按 design 把「声明 loopback 而规则监听 0.0.0.0」
 *    判成 conflict，用户就**再也删不掉**那条规则（conflict = SHALL NOT 修改或删除）——
 *    本机 19 条既有规则全是 `0.0.0.0`，一声明端口就会被锁死。**以 requirements 为准**，
 *    故：`conflict` 只留给「连形态都不是我们会写的」（`connectPort` 不符 / `listenAddress` 不在
 *    本插件形态集合内，见 `diff/listen-allowed.ts`），作用域更宽/更窄作为**事实位**暴露给 UI。
 *
 * ## 取不到 eth0 ⇒ 一条判决都不给（REQ-6.4）
 *
 * 不降级成 `ok`、也不全标 `drift`（后者被 REQ-6.4 明令禁止）。`eth0Ip === null` 时返回失败态，
 * 但仍带上与 eth0 无关的两块只读信息（外部规则清单、不可转发的映射）。
 *
 * ## 纯函数
 *
 * 引擎不接执行器、不读文件、不写任何东西；返回的对象里**没有任何函数**（测试有断言）——
 * 「动作」全部属于 005，这里连一个可调用的钩子都不放，从结构上排除「引擎顺手做了写操作」。
 */

import type { ListenerEntry, ListenerTable } from '../read/listeners.ts';
import { isEth0Bind, isLoopbackBind, isWildcardBind } from '../read/listeners.ts';
import type { PortproxyRule } from '../read/netsh.ts';
import { buildExpectedForwards } from './expected.ts';
import { isManagedPort, type ManagedPorts } from './managed-ports.ts';
import {
  type ClassifyReason,
  type DiffInput,
  type DiffOutcome,
  type DiffResult,
  type DriftDetail,
  type ExpectedForward,
  type ExternalRule,
  type PortClassification,
  type PortState,
  type Scope,
} from './types.ts';

/**
 * 「本插件形态」的监听地址：**集合与判据的本体在 `diff/listen-allowed.ts`**（2026-10-23）。
 *
 * 012 那版把 `OUR_LISTEN_ADDRESSES` 与 `isOurListenAddress` 放在本文件，写侧（`write/ownership.ts`）
 * 只 import 集合常量、自己解释判据 ⇒ 真机缺陷 F1（同一条 `192.168.31.129` 规则在快照里 `ok`、
 * 在计划里 `state-conflict`）。现在两者收进 `listen-allowed.ts`，读写两侧都只调它的
 * `allowedListenAddressesFor()` / `isOurListenAddress()`；本文件**原样转出**这两个出口，
 * 既有 import 路径（`tests/unit/listen-address-select.test.ts` / `write/index.ts`）一字不改。
 */
import { allowedListenAddressesFor, isOurListenAddress } from './listen-allowed.ts';

export { isOurListenAddress, OUR_LISTEN_ADDRESSES } from './listen-allowed.ts';

/**
 * 某作用域下本插件会写的监听地址。
 *
 * 012（2026-10-22）：`lan` 不再恒为 `0.0.0.0` —— 用户可在候选清单里显式选一块物理网卡
 * （`listenAddress`）；**缺省行为逐字不变**（`0.0.0.0`，010 及之前的所有断言照旧）。
 * `loopback` 恒 `127.0.0.1`（loopback 没有「用哪块网卡」的自由度）。
 */
export function expectedListenAddress(scope: Scope, listenAddress?: string): string {
  if (scope !== 'lan') return '127.0.0.1';
  return listenAddress !== undefined && listenAddress.trim() !== '' ? listenAddress : '0.0.0.0';
}

/**
 * 外部规则只读集合（REQ-15.1）—— 判据只有「`listenPort ∉ managedPorts`」一条（见 `types.ts` 的说明）。
 * 导出成独立函数是给 Phase 5 / 005 复用的：WSL 停着（eth0 取不到）时也要能渲染这块清单。
 */
export function collectExternalRules(
  rules: readonly PortproxyRule[],
  managedPorts: ManagedPorts,
): ExternalRule[] {
  const external: ExternalRule[] = [];
  for (const rule of rules) {
    if (isManagedPort(managedPorts, rule.listenPort)) continue;
    external.push({
      rule,
      display: `${rule.listenAddress}:${String(rule.listenPort)} → ${rule.connectAddress}:${String(rule.connectPort)}`,
      reason: 'port-not-managed',
    });
  }
  return external;
}

/** 一次归类的可变部分（其余字段由 `withVerdict` 统一填，避免手抄漂移） */
interface Verdict {
  readonly state: PortState;
  readonly reason?: ClassifyReason;
  readonly drift?: DriftDetail;
  readonly conflicts?: readonly PortproxyRule[];
}

function withVerdict(
  port: number,
  expected: ExpectedForward | null,
  rules: readonly PortproxyRule[],
  verdict: Verdict,
  listenAddress?: string,
): PortClassification {
  const listen = expected === null ? null : expectedListenAddress(expected.scope, listenAddress);
  return {
    port,
    state: verdict.state,
    reason: verdict.reason ?? null,
    expected,
    rules,
    drift: verdict.drift ?? null,
    conflicts: verdict.conflicts ?? [],
    scopeMismatch: listen !== null && rules.some((rule) => rule.listenAddress !== listen),
  };
}

/** 按 REQ-3.4 的三条事实判一个**期望端口** */
function classifyExpected(
  forward: ExpectedForward,
  rules: readonly PortproxyRule[],
  eth0Ip: string,
  listenAddress: string | undefined,
  allowedListenAddresses: readonly string[],
): PortClassification {
  // ① 没有任何规则：只有在**确实需要**规则时才是 `missing`
  if (rules.length === 0) {
    return forward.needsRule
      ? withVerdict(forward.port, forward, rules, { state: 'missing' }, listenAddress)
      : withVerdict(
          forward.port,
          forward,
          rules,
          {
            state: 'ok',
            reason: 'wsl-localhost-forwarding',
          },
          listenAddress,
        );
  }

  // ② 形状不符（目标端口不是我们声明的那个 / 监听地址不在「本插件形态」集合里）⇒ conflict，只报告
  //    `allowed` 已由调用方按**该端口**组装（配置登记值 ∪ 候选清单），见 `diff/listen-allowed.ts`
  const conflicts = rules.filter(
    (rule) => rule.connectPort !== forward.port || !isOurListenAddress(rule.listenAddress, allowedListenAddresses),
  );
  if (conflicts.length > 0) {
    return withVerdict(forward.port, forward, rules, { state: 'conflict', conflicts }, listenAddress);
  }

  // ③ 形状对、地址不对 ⇒ drift（旧 → 新）；**优先于 ok**，否则陈旧规则会被藏起来
  const stale = rules.find((rule) => rule.connectAddress !== eth0Ip);
  if (stale !== undefined) {
    return withVerdict(
      forward.port,
      forward,
      rules,
      {
        state: 'drift',
        drift: { from: stale.connectAddress, to: eth0Ip },
      },
      listenAddress,
    );
  }

  return withVerdict(forward.port, forward, rules, { state: 'ok' }, listenAddress);
}

/** 五态计数（显式字面量而不是遍历 `PORT_STATES`：漏一个键会被编译器当场抓住） */
function countStates(ports: readonly PortClassification[]): Record<PortState, number> {
  const counts: Record<PortState, number> = { ok: 0, missing: 0, drift: 0, conflict: 0, extra: 0 };
  for (const classification of ports) counts[classification.state] += 1;
  return counts;
}

/** 012 的逐端口监听地址选项（两个可选面；缺省 = 010 及之前的逐字行为） */
export interface ClassifyOptions {
  /**
   * 候选清单（本机 Windows 物理网卡 IPv4）—— **形态判据的一个来源**，不是一个完整集合。
   * 与 `listenAddresses` 的逐端口登记值取并集后交给 `isOurListenAddress`
   * （组装点唯一：`diff/listen-allowed.ts:allowedListenAddressesFor`）。
   */
  readonly allowedListenAddresses?: readonly string[];
  /** 逐端口选中的监听地址（键 = 端口号字符串） */
  readonly listenAddresses?: Readonly<Record<string, string>>;
  /** 013：WSL 监听表；缺省 / `ok:false` ⇒ `extra` + `listeners-unknown`（**未知**，不是「没监听」） */
  readonly listeners?: ListenerTable;
}

/** 一个 `connectPort` 的监听见解（三态；「其它具体地址」按保守口径并入 `in-use`） */
type ListenerVerdict = 'in-use' | 'loopback-only' | 'no-listener';

/**
 * 查一个端口在监听表里的形态。
 *
 * - 有**通配**或 **eth0** 绑定 ⇒ `in-use`（Windows 侧经 portproxy 连得到）；
 * - 绑定**全是回环** ⇒ `loopback-only`（portproxy 连不到）；
 * - 完全没有该端口 ⇒ `no-listener`；
 * - **其它具体地址**（例如绑在 WSL 内某块非 eth0 的网卡）⇒ 保守并入 `in-use`：
 *   本插件的方向是「不误删可能可用的规则」，宁可少报多余也不把在跑的服务说成「没监听」。
 */
function listenerVerdictOf(entries: readonly ListenerEntry[], port: number, eth0Ip: string): ListenerVerdict {
  const onPort = entries.filter((entry) => entry.port === port);
  if (onPort.length === 0) return 'no-listener';
  if (onPort.some((entry) => isWildcardBind(entry.bind) || isEth0Bind(entry.bind, eth0Ip))) return 'in-use';
  if (onPort.every((entry) => isLoopbackBind(entry.bind))) return 'loopback-only';
  return 'in-use';
}

/**
 * 013：docker 不再映射、但规则还在的端口 ⇒ 用**监听表**决定它是不是「多余」。
 *
 * 逐条规则查 `connectPort`（规则连的是容器/服务侧的端口，不一定是 `listenPort`）。
 * 一个 `listenPort` 上有多条规则时取**最能说明「规则可用」**的那个结论：
 * 任一条 `in-use` ⇒ `ok`；否则任一条 `loopback-only` ⇒ `extra/loopback-only`；否则 `no-listener`。
 */
function classifyUnmapped(
  rules: readonly PortproxyRule[],
  listeners: ListenerTable | undefined,
  eth0Ip: string,
): Verdict {
  if (listeners === undefined || !listeners.ok) {
    // 读不到 ≠ 没有监听（REQ-1.3）：未知仍可移除（主人裁定），但 UI 必须把标签/文案换成「未知」
    return { state: 'extra', reason: 'listeners-unknown' };
  }
  const verdicts = rules.map((rule) => listenerVerdictOf(listeners.entries, rule.connectPort, eth0Ip));
  if (verdicts.includes('in-use')) return { state: 'ok', reason: 'listener-active' };
  if (verdicts.includes('loopback-only')) return { state: 'extra', reason: 'loopback-only' };
  return { state: 'extra', reason: 'no-listener' };
}

/**
 * 每端口恰好一条（REQ-3.3）。
 *
 * 归类范围 = 期望集 ∪ 「声明集合内、有规则、但 docker 已不再映射」的端口 —— 后者自 013 起
 * 再按**监听表**分三态（在用 / 仅回环 / 无监听 / 未知，见 `classifyUnmapped`）。
 * `extra` 的候选**按规则迭代**（绝不枚举 `managedPorts` 的成员）：声明 `1000-3000`
 * 而只有 2000 有规则时，只会产出 2000 这一条。
 */
export function classifyPorts(
  forwards: readonly ExpectedForward[],
  rules: readonly PortproxyRule[],
  eth0Ip: string,
  managedPorts: ManagedPorts,
  options: ClassifyOptions = {},
): PortClassification[] {
  const allowed = options.allowedListenAddresses ?? [];
  const listenAddresses = options.listenAddresses ?? {};
  const rulesByPort = new Map<number, PortproxyRule[]>();
  for (const rule of rules) {
    const bucket = rulesByPort.get(rule.listenPort);
    if (bucket === undefined) rulesByPort.set(rule.listenPort, [rule]);
    else bucket.push(rule);
  }

  const classifications: PortClassification[] = [];
  const classified = new Set<number>();
  for (const forward of forwards) {
    classified.add(forward.port);
    // 2026-10-23（缺陷 F1）：allowed **按端口**组装，配置登记值也参与 —— 与写侧
    // （`write/guards.ts:matchOf`）调的是**同一个函数**（`allowedListenAddressesFor`）。
    const configured = listenAddresses[String(forward.port)];
    classifications.push(
      classifyExpected(
        forward,
        rulesByPort.get(forward.port) ?? [],
        eth0Ip,
        configured,
        allowedListenAddressesFor({ ...(configured === undefined ? {} : { configured }), candidates: allowed }),
      ),
    );
  }

  const extraByPort = new Map<number, PortproxyRule[]>();
  for (const rule of rules) {
    if (classified.has(rule.listenPort)) continue;
    if (!isManagedPort(managedPorts, rule.listenPort)) continue;
    const bucket = extraByPort.get(rule.listenPort);
    if (bucket === undefined) extraByPort.set(rule.listenPort, [rule]);
    else bucket.push(rule);
  }
  for (const [port, portRules] of extraByPort) {
    classifications.push(
      withVerdict(port, null, portRules, classifyUnmapped(portRules, options.listeners, eth0Ip)),
    );
  }

  return classifications;
}

/** 跑一次完整判定（纯函数：输入是已解析的事实，输出不含任何可调用物） */
export function diff(input: DiffInput): DiffOutcome {
  const external = collectExternalRules(input.rules, input.managedPorts);
  const { forwards, unsupported } = buildExpectedForwards(
    input.containers,
    input.managedPorts,
    input.scopes ?? {},
    input.localhostForwarding,
  );

  if (input.eth0Ip === null) {
    // REQ-6.4：显式状态，不猜（不降级 ok、不全标 drift）
    return {
      ok: false,
      reason: 'eth0-unknown',
      message: '无法确定 WSL 地址：取不到 eth0 的 IPv4（发行版可能未运行）',
      hint: '点「启动并核验」重试（会冷启动发行版：约 10–12 秒，并拉起 WSL 内的 dockerd 与全部容器）',
      external,
      unsupported,
    };
  }

  const ports = classifyPorts(forwards, input.rules, input.eth0Ip, input.managedPorts, {
    allowedListenAddresses: input.allowedListenAddresses ?? [],
    listenAddresses: input.listenAddresses ?? {},
    // 显式展开：`exactOptionalPropertyTypes` 下「值为 undefined」与「字段不存在」是两回事
    ...(input.listeners === undefined ? {} : { listeners: input.listeners }),
  });
  const result: DiffResult = {
    ports,
    expected: forwards,
    external,
    unsupported,
    counts: countStates(ports),
    eth0Ip: input.eth0Ip,
  };
  return { ok: true, result };
}
