/**
 * `dsh-terminal-profiles` 公开面 —— **002 Phase 1：纯配置模型**。
 *
 * 本包是**插件包**（最终有 `cordis.patch.yml`、配置页、PTY、右栏 UI），但 Phase 1 只落地
 * 「配置模型与容错解析」这一层：**纯函数、零宿主 API、零进程、零真机**。
 * 刻意不碰 `ctx.subprocess` / `ctx.webServer` / `ctx.settings` —— 那三条宿主面正在被 Phase 0
 * 的 T0.2 / T0.3 只读核对（T0.5 还要真机改 profile + 重启），故本 Phase **不依赖** Phase 0 的任何结论。
 *
 * ⚠️ **调用约定（宿主事实 A-1，写错就把配置静默当空）**：cordis 里 `profiles` 是 `.volatile()` 的，
 * 解析结果是**带 `.get()` 的深冻结对象**、下标取值是 `undefined` ⇒ 必须传
 * `parseProfiles(config.profiles.get())`。直接传 `config.profiles` 会得到一条明确的「必须是数组」
 * 根诊断（并附 `.get()` 提示）——**不会**静默变成空配置。
 *
 * 分层：`./config/profiles.ts`（模型 + 容错）· `./config/cwd-linux.ts`（消费 001 的路径翻译）·
 * `./config/state.ts`（引导态判定）· `./config/schema.ts`（schemastery 声明 + volatile 接线）。
 *
 * **Phase 2 已落地**（T2.1–T2.5）：`./limits.ts` · `./session/**` · `./screen/**`，
 * 全部**零真机**（单测用 fake `ctx.subprocess`，fake handle 记录 `resize` 实参以钉住行列顺序）。
 */

export { ROOT_INDEX, isStartable, isWslProfile, parseProfiles } from './config/profiles.ts';
export type {
  ProfileDiagnostic,
  ProfileDiagnosticKind,
  ProfilesParseResult,
  TerminalProfile,
} from './config/profiles.ts';

export { deriveCwdLinux } from './config/cwd-linux.ts';
export type { CwdLinuxDerivation } from './config/cwd-linux.ts';

export { deriveConfigState } from './config/state.ts';
export type { ConfigGuide, ConfigReady, ConfigState } from './config/state.ts';

export { PROFILE_FIELD_KEYS, createProfilesSchema } from './config/schema.ts';
export type { ProfileFieldKey, SchemaFactory, SchemaLike } from './config/schema.ts';

/**
 * Phase 2：Host PTY 与屏幕模型（T2.1–T2.5）。
 *
 * 三条分层：`./limits.ts`（全部数值上限，**命名常量**）· `./session/**`（实例表 + 宿主契约 + spec
 * 构造）· `./screen/**`（`@xterm/headless` 屏幕模型 + 有界增量缓冲）。
 * ⚠️ 宿主 handle **不**从本包漏出：对外的尺寸入口是 `resize(id, rows, cols)`（行在前、自带夹紧），
 * 换序只发生在 `session/manager.ts` 那一行（design §11 的唯一静默陷阱）。
 */
export {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  DEFAULT_TERMINAL_TYPE,
  TERM_BUFFER_MAX_BLOCKS,
  TERM_BUFFER_MAX_BYTES,
  TERM_MAX_COLS,
  TERM_MAX_ROWS,
  TERM_MIN_COLS,
  TERM_MIN_ROWS,
  TERM_SCREEN_SCROLLBACK_LINES,
  TERM_SNAPSHOT_SCROLLBACK_LINES,
  TERM_SNAPSHOT_SCROLLBACK_MAX,
  clampInt,
  clampSize,
} from './limits.ts';
export type { TerminalSize } from './limits.ts';

export { createSessionManager } from './session/manager.ts';
export type {
  KillOutcome,
  ReadOptions,
  SessionManager,
  SessionManagerOptions,
  StartOptions,
  TerminalRead,
} from './session/manager.ts';

export { buildSpawnSpec, resolveCwd } from './session/spawn-spec.ts';
export type { CwdSource, ResolvedCwd, SpawnSpecOptions } from './session/spawn-spec.ts';

export type {
  PtyOutputSource,
  SessionFailure,
  SessionFailureCode,
  SessionResult,
  SubprocessSurface,
  TerminalInstanceSummary,
  TerminalPtyHandle,
  TerminalSpawnSpec,
} from './session/types.ts';

export { createScreenModel } from './screen/screen-model.ts';
export type {
  ScreenIncremental,
  ScreenIncrementalHit,
  ScreenIncrementalLost,
  ScreenModel,
  ScreenModelOptions,
  ScreenSize,
  ScreenSnapshot,
} from './screen/screen-model.ts';

export { createTermBuffer } from './screen/buffer.ts';
export type { TermBuffer, TermBufferHit, TermBufferLost, TermBufferRead, TermChunk } from './screen/buffer.ts';
