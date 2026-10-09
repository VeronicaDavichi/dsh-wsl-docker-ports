/**
 * 空配置 / 全无效配置的**引导态**（002 REQ-1.5 / 任务 T1.3）
 *
 * Phase 1 是**纯模型层**：这里只产出「该显示引导还是该显示终端」的判定与**文案**，
 * 真正的 React 渲染属于 Phase 4（T4.x 的终端页）。所以 T1.3 的「渲染断言」在本 Phase 落地为
 * **对判定与文案的断言**（与 design §8 的「纯函数/状态机单测」同一层）—— 不是把 UI 提前搬过来。
 *
 * REQ-1.5 的两种输入（空 / 全部无效）都必须落到引导态，且 **SHALL NOT 报错或空白**：
 * 本模块不抛异常、不返回「什么都不显示」的中间态 —— 每个分支都带 `message` 供 UI 直接用。
 */

import type { ProfileDiagnostic, ProfilesParseResult, TerminalProfile } from './profiles.ts';
import { isStartable } from './profiles.ts';

/** 引导态：一条可启动的 profile 都没有 ⇒ 显示配置引导（不是错误页，也不是空白页） */
export interface ConfigGuide {
  readonly showGuide: true;
  /**
   * - `empty`：真的没配（REQ-1.5 的「profiles 为空」）；
   * - `all-invalid`：有条目但全被丢弃（REQ-1.5 的「全部无效」）；
   * - `all-needs-fix`：条目都在，但**没有一条可启动**（如 `cwdLinux` 全部推导失败）。
   */
  readonly reason: 'empty' | 'all-invalid' | 'all-needs-fix';
  readonly message: string;
  readonly diagnostics: readonly ProfileDiagnostic[];
}

/** 就绪态：至少有一条可启动的 profile（需修复的那些仍留在 `profiles` 里等用户修） */
export interface ConfigReady {
  readonly showGuide: false;
  readonly profiles: readonly TerminalProfile[];
  readonly startable: number;
  readonly needsFix: number;
  readonly diagnostics: readonly ProfileDiagnostic[];
}

export type ConfigState = ConfigGuide | ConfigReady;

/**
 * 由解析结果推出页面的两种状态（REQ-1.5）。
 *
 * ⚠️ 假设（REQ 未写死，实现选择）：「全部需修复」也归引导态。REQ 只写了「为空或全部无效」，
 * 而需修复的条目**不可启动**（REQ-1.4）⇒ 一个可启动的都没有。此时给一个「能选但选了就失败」
 * 的下拉框比直接说「这些都得修」更糟，故并到引导态，另给 `reason: 'all-needs-fix'` 让文案能说清
 * 「不是没配，是配置有问题」。
 */
export function deriveConfigState(result: ProfilesParseResult): ConfigState {
  const startableProfiles = result.profiles.filter(isStartable);
  if (startableProfiles.length > 0) {
    return {
      showGuide: false,
      profiles: result.profiles,
      startable: startableProfiles.length,
      needsFix: result.profiles.length - startableProfiles.length,
      diagnostics: result.diagnostics,
    };
  }

  const invalid = result.diagnostics.filter((d) => d.skipped).length;
  if (invalid > 0) {
    return {
      showGuide: true,
      reason: 'all-invalid',
      message: `配置里的 ${invalid} 条 profile 全部无效（已跳过，见诊断）。请在配置页修复后重试。`,
      diagnostics: result.diagnostics,
    };
  }
  if (result.profiles.length === 0) {
    return {
      showGuide: true,
      reason: 'empty',
      message: '还没有配置任何终端 profile。请在配置页添加一条，至少填 name 与 command。',
      diagnostics: result.diagnostics,
    };
  }
  return {
    showGuide: true,
    reason: 'all-needs-fix',
    message: `现有 ${result.profiles.length} 条 profile 都需修复（见诊断），修好之前无法启动终端。`,
    diagnostics: result.diagnostics,
  };
}
