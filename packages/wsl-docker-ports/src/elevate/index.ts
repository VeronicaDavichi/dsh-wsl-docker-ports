/**
 * `src/elevate/` 的包内入口（005 Phase 2）
 *
 * ⚠️ 与 `src/write/index.ts` 同一取向：**不改** 003 的 `src/index.ts`。
 * 集成期收口（Phase 3）再决定对外暴露什么（还牵着 001 REQ-6.4 的导出预算）。
 */

export {
  defaultFileExists,
  detectBackend,
  GSUDO_ELEVATION_FAILED_EXIT,
  GSUDO_STATUS_TIMEOUT_MS,
  isSystemSudoPath,
  parseGsudoStatus,
  parseWhereOutput,
  resolvePolicy,
  WHERE_TIMEOUT_MS,
  windowsSudoPath,
  type BackendProbeDeps,
  type GsudoStatus,
} from './backend.ts';

export {
  assertAddress,
  assertAction,
  assertPort,
  assertScope,
  assertScriptParams,
  assertTempPaths,
  buildElevateScript,
  defaultRandomSuffix,
  ElevateParamError,
  isScriptAction,
  prepareElevation,
  SCRIPT_ACTIONS,
  scriptArgs,
  TEMP_PREFIX,
  tempOutPath,
  tempScriptPath,
} from './script.ts';

export {
  classifyExit,
  displayableSteps,
  ELEVATE_EXIT,
  parseElevatedOut,
  payloadPortMismatch,
  type ExitClassification,
  type OutParseFailure,
  type OutParseSuccess,
} from './outcome.ts';

export {
  buildInvocation,
  buildNativeCommand,
  DEFAULT_ELEVATE_TIMEOUT_MS,
  looksLikeUacRejection,
  scriptCallFor,
  type ElevateInvocation,
} from './invoke.ts';

export {
  cryptoRandomSuffix,
  defaultElevationDeps,
  runElevate,
} from './runner.ts';

export type {
  BackendChoice,
  ConfirmRequest,
  ElevatedPayload,
  ElevateRequest,
  ElevateResult,
  ElevateStatus,
  ElevationBackend,
  ElevationDeps,
  ElevationPolicy,
  RequestSource,
  ScriptAction,
  ScriptParams,
  StepReport,
} from './types.ts';
