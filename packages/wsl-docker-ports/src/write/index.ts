/**
 * `src/write/` 的包内入口（005 Phase 1）
 *
 * ⚠️ 刻意**不**改 `src/index.ts`（那是 003 的注册与收口文件，本 Spec 只被它调用）。
 * 集成方要对外暴露写路径时，在那边加一行 `export * from './write/index.ts'` 即可 ——
 * 那是 Phase 3 的收口决定（还牵着导出预算，见 001 REQ-6.4）。
 */

export {
  classifyRuleOwnership,
  isDeletableRule,
  listenAddressForScope,
  matchOwnership,
  type OwnershipDetail,
  type OwnershipInput,
  type OwnershipKind,
  type OwnershipMatch,
  type OwnershipReason,
  type RuleOwnership,
} from './ownership.ts';

/** 「本插件会写的形态」的唯一来源是 003 的引擎（2026-10-09 集成期订正：不再复制一份） */
export { OUR_LISTEN_ADDRESSES } from '../diff/engine.ts';

export {
  buildFirewallAddStep,
  buildFirewallDeleteStep,
  FIREWALL_GROUP,
  FIREWALL_NAME_PREFIX,
  firewallAllowArgs,
  firewallAllowCommandText,
  firewallNameExists,
  firewallRuleName,
  isPortNumber,
  looksLikeWildcardAllow,
  type FirewallArgs,
} from './firewall.ts';

export { explainScope, needsExplicitRule, type ScopeExplanation } from './scope-note.ts';

export {
  buildWritePlan,
  isDeclaredPort,
  isIpv4,
  isWritableState,
  plannedPorts,
  portproxyAddStep,
  portproxyDeleteStep,
  resolveScope,
  scopeFromRules,
} from './plan.ts';

export {
  compareOthers,
  createWriteLogEntry,
  hasFourFields,
  type OthersComparison,
  type WriteLogEntry,
  type WriteLogParts,
} from './log.ts';

export {
  createPortproxySnapshotter,
  describeSnapshot,
  type PortproxySnapshotter,
  type SnapshotFailure,
  type SnapshotOutcome,
  type SnapshotSuccess,
  type SnapshotterOptions,
} from './snapshot.ts';

export type {
  WriteAction,
  WriteBlock,
  WriteBlockReason,
  WritePlan,
  WritePlanInput,
  WritePlanOutcome,
  WriteStep,
  WriteStepKind,
} from './types.ts';
