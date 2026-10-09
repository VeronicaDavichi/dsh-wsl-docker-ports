/**
 * 作用域差异说明（005 T1.5 / REQ-2.2 / REQ-2.5）
 *
 * ## 为什么要单独一个「文案模块」
 *
 * REQ-2.2 与 REQ-2.5 是**同一件事的两个方向**，但用户看到的结论完全相反：
 *
 * | `localhostForwarding` | `loopback` 是否需要显式规则 |
 * |---|---|
 * | `true`（NAT 缺省）| **不需要**：WSL 自带 localhost 转发，加了规则是多余状态 |
 * | `false` | **需要**：与 `true` 时相反，必须显式加，否则连不上 |
 *
 * 同一个「loopback + 没有规则」的画面因此有两种完全不同的含义。REQ-2.5 明令**不静默** ——
 * 所以结论连同**依据**一起给（`message` + `detail`），UI 直接展示即可，
 * 不允许出现「用户看着空白表格猜为什么」。
 *
 * ## `needsNode` 与 003 的关系
 *
 * 003 的 `expected.ts` 在期望项上带 `needsRule` 字段（同一判据）。这里的函数是**写路径**侧的
 * 同一判据的一个具名出口：`plan.ts` 用它决定「要不要为 loopback 生成规则」。
 * 两处判据**同源同义**（`scope === 'lan' || !localhostForwarding`），本文件用测试钉住这一点。
 */

import type { Scope } from '../diff/types.ts';

/** 该作用域下是否**必须**有 portproxy 规则（REQ-2.2 / REQ-2.3 / REQ-2.5） */
export function needsExplicitRule(scope: Scope, localhostForwarding: boolean): boolean {
  return scope === 'lan' || !localhostForwarding;
}

export interface ScopeExplanation {
  /** 是否必须有规则（= `needsExplicitRule` 的结果，避免调用方自己再算一次） */
  readonly required: boolean;
  /** 一句话结论（UI 主文案） */
  readonly message: string;
  /** 依据（UI 副文案 / tooltip）：**必须**能解释「为什么」 */
  readonly detail: string;
  /** 是否需要**醒目**提示（REQ-2.5 的「差异必须说明」：`false` 时与 NAT 缺省相反） */
  readonly warn: boolean;
}

/**
 * `loopback` / `lan` 的结论 + 依据（REQ-2.5 的「不静默」落地处）。
 * `localhostForwarding` 传 `null` 表示**读不出来** —— 那时按「需要规则」偏保守，
 * 并在文案里说清是未知（003 的 `read/localhost-forwarding.ts` 已把不可识别值降级为 `false`）。
 */
export function explainScope(scope: Scope, localhostForwarding: boolean | null): ScopeExplanation {
  if (scope === 'lan') {
    return {
      required: true,
      message: '局域网作用域：需要 0.0.0.0 的 portproxy 规则 + 仅放行该端口的入站 TCP 规则',
      detail:
        '逐端口显式 opt-in（REQ-2.4）：本端口监听 0.0.0.0，其余端口不受影响；防火墙只放行本端口，绝不全量放行（REQ-2.3）',
      warn: false,
    };
  }

  if (localhostForwarding === true) {
    return {
      required: false,
      message: '无需 portproxy 规则（WSL 自带的 localhost 转发已开启，NAT 缺省）',
      detail:
        'localhostForwarding=true：Windows 侧访问 localhost:<port> 由 WSL 自己转发到容器，再加一条规则只会多出一份看不见的系统状态（REQ-2.2）',
      warn: false,
    };
  }

  if (localhostForwarding === false) {
    return {
      required: true,
      message: 'localhostForwarding=false：**loopback 也需要**显式 portproxy 规则（与 NAT 缺省时相反）',
      detail:
        '.wslconfig 的 [wsl2] localhostForwarding 被显式关掉 ⇒ WSL 不再自动转发 localhost，' +
        'loopback 作用域同样要写一条 127.0.0.1 的规则；这与默认情形（无需规则）是相反结论，故必须醒目标出（REQ-2.5）',
      warn: true,
    };
  }

  return {
    required: true,
    message: 'localhostForwarding 读不出来：按「需要显式规则」处理（保守，不静默）',
    detail:
      '键值不可识别/配置读不了 ⇒ 宁可多一条可见、可移除的规则，也不要让「连不上且不报错」发生（003 T1.3 的降级方向）',
    warn: true,
  };
}
