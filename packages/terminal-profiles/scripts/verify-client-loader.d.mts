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

export declare function verifyClientLoader(options?: { libDir?: string }): ClientLoaderReport;
