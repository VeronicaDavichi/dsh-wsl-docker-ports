/**
 * 五态引擎（003 Phase 2 / REQ-3 / REQ-6 / REQ-9 / REQ-15）
 *
 * ## 判定只依据三条事实（REQ-3.4）
 *
 * ① `listenPort` 是否 ∈ `managedPorts`；② `connectAddress` 是否等于当前 eth0；
 * ③ 该端口上是否存在**与本插件声明不符**的既有规则。
 * **不用**时间戳、条目顺序、名称相似度 —— 那些都会让「为什么它是这个状态」无法自证。
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
 *    `{127.0.0.1, 0.0.0.0}` 之内），作用域更宽/更窄作为**事实位**暴露给 UI。
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
 * 本插件会写的两种 `listenAddress`（005 §2 的算法表）：
 * `lan` → `0.0.0.0`，`loopback` → `127.0.0.1`。
 * 落在这个集合之外 ⇒ 这条规则不是我们这种形态的 ⇒ `conflict`（只报告、绝不动）。
 */
const OUR_LISTEN_ADDRESSES: readonly string[] = ['127.0.0.1', '0.0.0.0'];

/** 某作用域下本插件会写的监听地址 */
export function expectedListenAddress(scope: Scope): string {
  return scope === 'lan' ? '0.0.0.0' : '127.0.0.1';
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
): PortClassification {
  const listen = expected === null ? null : expectedListenAddress(expected.scope);
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
): PortClassification {
  // ① 没有任何规则：只有在**确实需要**规则时才是 `missing`
  if (rules.length === 0) {
    return forward.needsRule
      ? withVerdict(forward.port, forward, rules, { state: 'missing' })
      : withVerdict(forward.port, forward, rules, {
          state: 'ok',
          reason: 'wsl-localhost-forwarding',
        });
  }

  // ② 形状不符（目标端口不是我们声明的那个 / 监听地址不是我们会写的那两种）⇒ conflict，只报告
  const conflicts = rules.filter(
    (rule) => rule.connectPort !== forward.port || !OUR_LISTEN_ADDRESSES.includes(rule.listenAddress),
  );
  if (conflicts.length > 0) {
    return withVerdict(forward.port, forward, rules, { state: 'conflict', conflicts });
  }

  // ③ 形状对、地址不对 ⇒ drift（旧 → 新）；**优先于 ok**，否则陈旧规则会被藏起来
  const stale = rules.find((rule) => rule.connectAddress !== eth0Ip);
  if (stale !== undefined) {
    return withVerdict(forward.port, forward, rules, {
      state: 'drift',
      drift: { from: stale.connectAddress, to: eth0Ip },
    });
  }

  return withVerdict(forward.port, forward, rules, { state: 'ok' });
}

/** 五态计数（显式字面量而不是遍历 `PORT_STATES`：漏一个键会被编译器当场抓住） */
function countStates(ports: readonly PortClassification[]): Record<PortState, number> {
  const counts: Record<PortState, number> = { ok: 0, missing: 0, drift: 0, conflict: 0, extra: 0 };
  for (const classification of ports) counts[classification.state] += 1;
  return counts;
}

/**
 * 每端口恰好一条（REQ-3.3）。
 *
 * 归类范围 = 期望集 ∪ 「声明集合内、有规则、但 docker 已不再映射」的端口。
 * `extra` 的候选**按规则迭代**（绝不枚举 `managedPorts` 的成员）：声明 `1000-3000`
 * 而只有 2000 有规则时，只会产出 2000 这一条。
 */
export function classifyPorts(
  forwards: readonly ExpectedForward[],
  rules: readonly PortproxyRule[],
  eth0Ip: string,
  managedPorts: ManagedPorts,
): PortClassification[] {
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
    classifications.push(classifyExpected(forward, rulesByPort.get(forward.port) ?? [], eth0Ip));
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
      withVerdict(port, null, portRules, { state: 'extra', reason: 'no-docker-mapping' }),
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

  const ports = classifyPorts(forwards, input.rules, input.eth0Ip, input.managedPorts);
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
