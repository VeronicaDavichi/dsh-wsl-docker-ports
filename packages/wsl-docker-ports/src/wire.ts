/**
 * 前后端**传输契约**（003 T6.8）—— 宿主半拥有，客户端半只消费
 *
 * ## 为什么单独一个文件（而不是继续放在 `src/client/types.ts`）
 *
 * 装配快照的是**宿主半**，渲染它的是**客户端半**。若宿主半 `import type` 客户端文件，
 * `tsconfig.build.json` 的 `exclude: ["src/client/**"]` **拦不住** —— TypeScript 的 `exclude`
 * 只筛「根文件」，被 import 的照样进 program 并被 emit（实测：`lib/client/{host,settings-pipe,types}.js`
 * 会出现在宿主产物里）。故这份契约住在宿主侧，客户端**反向**引用它（client → wire 是允许的方向）。
 *
 * ## 一条口径只写一次
 *
 * 查询参数的**编码**（客户端拼 URL）与**解码**（宿主解 URL）都在本文件里，且互为逆：
 * `buildSnapshotQuery()` / `parseSnapshotQuery()`。这样「客户端拼错了」不可能变成
 * 「宿主静默用了默认值」—— 两侧共用同一组常量与同一套非法值规则。
 *
 * ## 非法值一律落到**最保守**的默认，不返回 400
 *
 * 查询参数是客户端自己拼的，为它回 400 只会让右栏页白屏。故：
 * `elevationPolicy` 认不出 ⇒ `none`（最保守）；`scope` 认不出 ⇒ `loopback`（REQ-2.1 默认）。
 * 唯一的例外是**读不到 netsh 规则**：那时不是「参数不对」，而是「事实读不到」，见 `snapshot.ts`。
 */

import type { WslDistro, WslDistroState } from 'dsh-wsl-shared';
import type { DiffFailure, DiffResult, Scope } from './diff/types.ts';
import type { DockerContainer } from './read/docker.ts';

/**
 * 具名 HTTP 路由的**独占前缀**（不蹭 002 的 `/dsh-managed-terminal/`）。
 *
 * 🔴 **不带尾斜杠** —— 这不是审美，是匹配判据：宿主 `dsh-host-webserver/lib/index.js:328`
 * 的分派是 `if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;`
 * ⇒ 前缀写成 `/dsh-wsl-docker-ports/` 时，实际要求的是 `startsWith('/dsh-wsl-docker-ports//')`，
 * 于是 `/dsh-wsl-docker-ports/snapshot` **永远不匹配**（真机实测：请求被宿主兜底 404 吃掉，
 * 无 `Content-Type`、无 body；只有 `pathname` 正好等于前缀或写成双斜杠才轮到我们）。
 */
export const PORTS_HTTP_PREFIX = '/dsh-wsl-docker-ports';

/** 快照端点在**前缀内**的那一段（拼接一律 `PORTS_HTTP_PREFIX + PORTS_SNAPSHOT_SEGMENT`；模块内部即可） */
const PORTS_SNAPSHOT_SEGMENT = '/snapshot';

/**
 * 快照端点（本前缀下**唯一**的路径；前缀内其它路径一律 404）。
 *
 * ⚠️ **对外 URL 与修复前逐字相同**（`/dsh-wsl-docker-ports/snapshot`）⇒ 客户端 fetch、
 * `client-contract.md` §P9 的契约、既有 404/405 语义都不用改。
 */
export const PORTS_SNAPSHOT_PATH = `${PORTS_HTTP_PREFIX}${PORTS_SNAPSHOT_SEGMENT}`;

/** 唯一接受的方法 */
export const PORTS_SNAPSHOT_METHOD = 'GET';

/** 查询参数名（**字面量**，集成方写进 contract §P9 时以此为准） */
export const QUERY_MANAGED_PORTS = 'managedPorts';
export const QUERY_SCOPE = 'scope';
export const QUERY_DISTRO = 'distro';
export const QUERY_ELEVATION_POLICY = 'elevationPolicy';
export const QUERY_ALLOW_COLD_START = 'allowColdStart';

/** `scope` 参数的写法：`<port>:<loopback|lan>` */
export const SCOPE_PAIR_SEPARATOR = ':';

/** 提权策略（与 005 REQ-3 的三个值逐字一致；默认 `none`） */
export const ELEVATION_POLICIES = ['none', 'ask', 'passby'] as const;
export type ElevationPolicyValue = (typeof ELEVATION_POLICIES)[number];
export const DEFAULT_ELEVATION_POLICY: ElevationPolicyValue = 'none';

/**
 * 客户端随请求带来的**声明**（宿主侧没有 settings 存储 ⇒ 声明由客户端给）。
 *
 * 这不是「客户端说了算」：宿主仍然只把它当**声明**，事实一律现读（netsh / docker / eth0）。
 * 声明与事实的比对结果就是五态引擎的输出。
 */
export interface SnapshotDeclaration {
  /** 原始声明串（可含区间 `1000-3000`），由宿主用 `parseManagedPorts` 解析 */
  readonly managedPorts: readonly string[];
  /** 逐端口作用域；键是端口号的字符串形式 */
  readonly scopes: Readonly<Record<string, Scope>>;
  /** 目标发行版；缺省按 001 的四级优先级解析 */
  readonly distro?: string | undefined;
  readonly elevationPolicy: ElevationPolicyValue;
}

/** 解析后的查询（路径参数 + 声明） */
export interface SnapshotQuery {
  readonly declaration: SnapshotDeclaration;
  /** `allowColdStart=1` 才为 true（REQ-6.4：只允许用户显式动作冷启动） */
  readonly allowColdStart: boolean;
}

/**
 * 路由级错误码。**只有 4 个** —— 能塞进快照的失败一律不在这里：
 *
 * - `not-found` 404：前缀内但路径不对；
 * - `method-not-allowed` 405：非 GET；
 * - `rules-unavailable` 503：**读不到 netsh 规则**。这一条**必须**是路由级错误：
 *   拿不到规则却返回空集合 = 把「读失败」冒充「一条规则都没有」（REQ-1.3 明令禁止），
 *   那样每个受管端口都会假报 `missing`，比报错危险得多；
 * - `internal` 500：未预期异常（含非 `ProbeFailure` 的抛出）。
 *
 * docker 读失败 / eth0 取不到 / 发行版解析失败**都不在**这里：它们有快照内的位置
 * （`docker.ok:false` / `diff.ok:false` / `distroError`），页面照样能渲染出可读的降级态。
 */
export type PortsErrorCode = 'not-found' | 'method-not-allowed' | 'rules-unavailable' | 'internal';

export interface PortsErrorBody {
  readonly code: PortsErrorCode;
  readonly message: string;
}

/** HTTP 响应体（成功/失败同一判别式；客户端据此决定「喂页面」还是「抛错」） */
export type PortsSnapshotResponse =
  | { readonly ok: true; readonly snapshot: PortsSnapshot }
  | { readonly ok: false; readonly error: PortsErrorBody };

/* ───────────────────────── 传输层的最小面（两侧共用；client 侧注入 fake） ───────────────────────── */

/** `fetch` 的响应面（浏览器 `Response` 与测试 fake 都满足） */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** `fetch` 的最小签名（**只声明用得到的**：GET + 两个请求头 + `cache`） */
export type FetchLike = (
  url: string,
  init?: { readonly method?: string; readonly cache?: string; readonly headers?: Readonly<Record<string, string>> },
) => Promise<FetchResponseLike>;

/* ───────────────────────── 快照里的视图类型（宿主装配、客户端渲染） ───────────────────────── */

/** NAT 门的三态（REQ-1.1；`unreadable` 按「不可用」处理，绝不按缺省 NAT 放行） */
export type NatGateView =
  | { readonly kind: 'nat'; readonly mode: 'nat' | 'default'; readonly path: string }
  | { readonly kind: 'non-nat'; readonly mode: 'mirrored' | 'other'; readonly path: string; readonly rawValue: string | null }
  | { readonly kind: 'unreadable'; readonly path: string; readonly message: string };

/** 修复指引（REQ-1.4：含具体文件路径与可复制命令文本，且不自动改文件） */
export interface NatGuideView {
  readonly path: string;
  readonly lines: readonly string[];
  readonly commandText: string;
  readonly note: string;
}

/** docker 读侧结果（REQ-2.3：三类失败必须可区分，SHALL NOT 用空列表冒充没有容器） */
export type DockerView =
  | { readonly ok: true; readonly containers: readonly DockerContainer[]; readonly emptyAfterRetry: boolean; readonly argv: readonly string[] }
  | { readonly ok: false; readonly reason: string; readonly message: string; readonly hint: string; readonly raw: string | null };

/** 目标发行版（T5.8；由宿主从 `wsl -l -v` + 解析结果给出） */
export interface DistroPanelData {
  readonly distros: readonly WslDistro[];
  readonly name: string | null;
  readonly state: WslDistroState | null;
  readonly source: 'config' | 'wslDefault' | 'onlyOne' | 'first' | null;
  readonly staleConfig: boolean;
  readonly message: string | null;
}

/**
 * 一次刷新的**全部**渲染输入 —— 即路由返回的 `snapshot` 字段的**逐字**形状。
 *
 * 纯数据（无函数、无类实例），可直接 `JSON.stringify` / `JSON.parse` 往返。
 */
export interface PortsSnapshot {
  /** 刷新时间戳（epoch ms）；UI 显示「上次刷新」 */
  readonly refreshedAt: number;
  readonly nat: NatGateView;
  readonly docker: DockerView;
  readonly localhostForwarding: boolean | null;
  /** 五态引擎输出（失败态也要能渲染：外部清单与 UDP 提示照给） */
  readonly diff: { readonly ok: true; readonly result: DiffResult } | DiffFailure;
  readonly scopes: Readonly<Record<string, Scope>>;
  readonly managedPortsDecl: readonly string[];
  readonly distro: DistroPanelData | null;
  readonly distroError: string | null;
  readonly elevationPolicy: ElevationPolicyValue;
  readonly elevationAvailable: boolean;
  /** 002 的 `managedTerminal` 服务是否已加载（**只影响文案**，控件恒禁用 —— REQ-10.3） */
  readonly execAvailable: boolean;
  readonly iphlpsvcRunning: boolean | null;
}

/* ───────────────────────── 编码 / 解码（互为逆，两侧共用） ───────────────────────── */

/** 把 `port:scope` 解析成一对；非法一律丢（宿主侧落回 `loopback` 默认） */
function parseScopePair(raw: string): readonly [string, Scope] | undefined {
  const index = raw.indexOf(SCOPE_PAIR_SEPARATOR);
  if (index <= 0) return undefined;
  const port = raw.slice(0, index).trim();
  const scope = raw.slice(index + 1).trim();
  if (!/^[0-9]{1,5}$/u.test(port)) return undefined;
  if (scope !== 'loopback' && scope !== 'lan') return undefined;
  return [port, scope] as const;
}

function asPolicy(raw: string | null): ElevationPolicyValue {
  for (const policy of ELEVATION_POLICIES) if (raw === policy) return policy;
  return DEFAULT_ELEVATION_POLICY;
}

/**
 * 解码（宿主侧）。畸形 URL **不抛**：退到「空声明 + 默认值」，让请求仍然能拿到事实。
 * 判据（`tests/unit/route.test.ts`）：`parse(build(x)) === x` 对声明逐字段成立。
 */
export function parseSnapshotQuery(url: string | undefined): SnapshotQuery {
  let params: URLSearchParams;
  try {
    params = new URL(url ?? '/', 'http://dsh.invalid').searchParams;
  } catch {
    params = new URLSearchParams();
  }

  const scopes: Record<string, Scope> = {};
  for (const raw of params.getAll(QUERY_SCOPE)) {
    const pair = parseScopePair(raw);
    if (pair !== undefined) scopes[pair[0]] = pair[1];
  }

  const distro = params.get(QUERY_DISTRO);
  const declaration: SnapshotDeclaration = {
    managedPorts: params.getAll(QUERY_MANAGED_PORTS),
    scopes,
    elevationPolicy: asPolicy(params.get(QUERY_ELEVATION_POLICY)),
    ...(distro === null || distro.trim().length === 0 ? {} : { distro: distro.trim() }),
  };

  return { declaration, allowColdStart: params.get(QUERY_ALLOW_COLD_START) === '1' };
}

/**
 * 编码（客户端侧）：**与 `parseSnapshotQuery` 共用常量**，是它的逆。
 * 只输出非默认值（`elevationPolicy=none` 等默认项不写，URL 短且可读）。
 */
export function buildSnapshotQuery(declaration: SnapshotDeclaration, allowColdStart = false): string {
  const params = new URLSearchParams();
  for (const port of declaration.managedPorts) params.append(QUERY_MANAGED_PORTS, port);
  for (const [port, scope] of Object.entries(declaration.scopes)) params.append(QUERY_SCOPE, `${port}${SCOPE_PAIR_SEPARATOR}${scope}`);
  if (declaration.distro !== undefined && declaration.distro.length > 0) params.set(QUERY_DISTRO, declaration.distro);
  if (declaration.elevationPolicy !== DEFAULT_ELEVATION_POLICY) params.set(QUERY_ELEVATION_POLICY, declaration.elevationPolicy);
  if (allowColdStart) params.set(QUERY_ALLOW_COLD_START, '1');
  return params.toString();
}
