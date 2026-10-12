/**
 * `scripts/verify-client-loader.mjs` 的类型声明（只为让 vitest 用例能**类型安全**地复用同一套判据）。
 *
 * 为什么是手写声明而不是 `allowJs`：`allowJs: true` 会把整个 `scripts/` 拖进 `tsc -p tsconfig.json` 的
 * 类型检查面（那里的 .mjs 用 JS 写法 + 动态对象，会引入一堆与实现无关的报错）。这里只声明**被复用的**
 * 那一个函数与它的常量，边界最小。
 */

export interface ClientLoaderCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ClientLoaderMeasurements {
  readonly mainBytes: number;
  readonly chunkBytes: number;
  /** §P2 **软提示**（非判据）：`chunk / 主 bundle` 比值与余量；不参与 `ok` / `failures` */
  readonly sizeHint?: ClientLoaderSizeHint;
  readonly mainRequires?: readonly string[];
  readonly mainAsyncRequests?: readonly string[];
  readonly chunkRequires?: readonly string[];
  readonly declaredExternal?: readonly string[];
  readonly asyncCallsDuringMaterialization?: number;
  readonly documentAccessesDuringMaterialization?: number;
  readonly documentAccessesAfterApply?: number;
  readonly effectsDuringApply?: number;
  readonly seatsRegistered?: number;
  readonly warnings?: readonly string[];
}

export interface ClientLoaderSizeHint {
  readonly chunkIsLarger: boolean;
  readonly mainToChunkRatio: number;
  readonly headroomBytes: number;
  readonly limitBytes: number;
  readonly note: string;
}

export interface ClientLoaderReport {
  readonly ok: boolean;
  readonly checks: readonly ClientLoaderCheck[];
  readonly failures: readonly ClientLoaderCheck[];
  readonly measurements: ClientLoaderMeasurements;
  readonly reason?: string | null;
  readonly checkCount: number;
}

export declare const PLUGIN_ID: string;
export declare const MAIN_BUNDLE_FILE: string;
export declare const CHUNK_FILE: string;
export declare const CHUNK_FILE_PATTERN: RegExp;
export declare const CHUNK_REQUEST: string;
export declare const STYLE_PLUGIN_ID: string;
export declare const OFFICIAL_TAB_KINDS: readonly string[];
export declare const BASELINE_MODULES: readonly string[];

/** §P2 **明确上限**（2026-10-12 口径变更）= 64 KiB；超限即须拆分（推导与重定条件见实现里的 rationale） */
export declare const MAIN_BUNDLE_LIMIT_BYTES: number;
export declare const MAIN_BUNDLE_LIMIT_RATIONALE: string;
/** §P2 三条不变量的判据名（用例按名断言 ⇒ 标签漂移会被当场抓住） */
export declare const XTERM_PURITY_CHECK_NAME: string;
export declare const INLINED_REACT_CHECK_NAME: string;
export declare const MAIN_SIZE_CHECK_NAME: string;
/** xterm 指纹命中清单（空 = 干净）；**返回清单**便于报出命中了哪几个 */
export declare function xtermFingerprintHits(source: string): readonly string[];
/**
 * §P2 三条不变量的**唯一实现**（直接判据 ×2 + 明确上限 ×1），门与变异哨兵用例共用。
 * 入参是读数 ⇒ 可用**人造读数**（如 `MAIN_BUNDLE_LIMIT_BYTES + 1`）证明它不恒真。
 */
export declare function mainBundleInvariantChecks(
  mainSource: string,
  mainBytes: number,
  chunkBytes?: number,
): readonly ClientLoaderCheck[];

export declare function verifyClientLoader(options?: { libDir?: string }): ClientLoaderReport;
