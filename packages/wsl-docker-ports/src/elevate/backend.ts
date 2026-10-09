/**
 * 提权后端探测与策略解析（005 T2.4 / T2.5 / REQ-3.4 / REQ-4.1 / A-3）
 *
 * ## 🔴 本机真实陷阱：绝不按命令名 `sudo` 探测
 *
 * 本机（Win11 23H2）`%SystemRoot%\System32\sudo.exe` **不存在**，而 `Get-Command sudo -All`
 * 唯一命中的是 **gsudo 安装器造的 shim**（`D:\Program Files\gsudo\Current\sudo.exe`，
 * ProductName=gsudo）。⇒ 任何「按命令名 `sudo` 探测」的实现都会**必然误判**「Windows 自带 sudo 可用」
 * 而走进 `winsudo` 分支（实际执行的还是 gsudo，语义完全不同：退出码/输出回传都不是那回事）。
 *
 * 因此本文件只有两条探测路径：
 * - `gsudo` → `where.exe gsudo` + **basename 必须恰好是 `gsudo.exe`**（`gsudo.exe` 之外的命中一律不算）
 * - `winsudo` → **只在显式配置 `elevationBackend: winsudo` 时**用**固定绝对路径**（`%SystemRoot%\System32\sudo.exe`）
 *   判定，**从不**去 `where.exe sudo`
 *
 * ## 凭据缓存活跃 ⇒ 回落 native（REQ-3.4）
 *
 * 缓存活跃 = 免 UAC 提权，会抹掉本 Spec 依赖的系统闸门（REQ-4.1 的说明写死了这条因果）。
 * 检测到就回落 `Start-Process -Verb RunAs`，**不调 `gsudo -k`**（那是杀用户的缓存会话）。
 * 同理：`gsudo status` **读不出来**时也回落 native —— 未知状态下「一定弹 UAC」是唯一能保证
 * 人类闸门还在的方向（保守，且方向上与 REQ-3.4 一致）。
 *
 * ## 不安装 / 不改 PATH / 不动配置
 *
 * 探测只读地跑 `where.exe gsudo` 与 `gsudo status`；绝不 `winget/scoop install`、
 * 绝不改 PATH、绝不 `gsudo config CacheMode …`（改的是用户全局配置）。
 *
 * ## 🔴 真机陷阱（2026-10-09 实测）：可用性行有**两种**写法，结构化出口才是首选
 *
 * gsudo v2.6.1 的人工可读行是 `  Available for this process: False` —— **不是** `Available : False`；
 * 旧正则 `/Available\s*:\s*(True|False)/` 因此**永不匹配** ⇒ `readable === false` ⇒ 生产链**静默**
 * 退化为 native（真机快照拿到 `backend:"native"` + 「没有可识别的 Available 行」，而 gsudo 明明装着）。
 *
 * 现在按两路判定：① **结构化优先** —— `gsudo status --json`（实测含 `"CacheAvailable":false`）；
 * ② 人工可读文本 —— `Available for this process:` 与 `Available:` **两种写法都认**（大小写/空格容忍）。
 * 两路都读不出来才回落 native，且 `note` 里**必须**留下两路各自的结果（不许静默）。
 */

import { access } from 'node:fs/promises';

import type { ExecResult, Executor, WslSharedError } from 'dsh-wsl-shared';

import type { BackendChoice, ElevationBackend, ElevationPolicy, RequestSource } from './types.ts';

/** 后端探测的超时（都是毫秒级本地命令；`where` 5s、`status` 10s 只是兜底） */
export const WHERE_TIMEOUT_MS = 5_000;
export const GSUDO_STATUS_TIMEOUT_MS = 10_000;

/** gsudo 的「提权失败」退出码（REQ-3.4：官方口径，判为**提权失败**而不是普通失败） */
export const GSUDO_ELEVATION_FAILED_EXIT = 999;

/** `gsudo status` 的解析结果 */
export interface GsudoStatus {
  /** 输出里是否有**可识别**的可用性字段（读不出来 = `false`） */
  readonly readable: boolean;
  readonly cacheAvailable: boolean;
  readonly mode: string | null;
  /** 判据来自哪一路（诊断用）：`json` = `--json` 结构化、`text` = 人工可读文本、`none` = 两路都读不出来 */
  readonly source: 'json' | 'text' | 'none';
}

/** 在（可能嵌套的）JSON 里找一个键名**大小写不敏感**的字段 */
function searchJson(value: unknown, key: string, kind: 'boolean' | 'string', depth: number): string | boolean | null {
  if (typeof value !== 'object' || value === null || depth > 3) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const hit = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
  if (hit !== undefined && typeof hit[1] === kind) return hit[1] as string | boolean;
  for (const [, inner] of entries) {
    const nested = searchJson(inner, key, kind, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

/**
 * 按 `keys` 的**优先级**取第一个类型匹配的字段。
 *
 * 🔴 顺序即优先级：`CacheAvailable` 最具体，兜底的 `Available` 放最后 —— 免得将来多出一个叫
 * `Available` 的字段时把更具体的那条盖掉（旧正则正是栽在「撞名字/写法变了」这一类上）。
 */
function findJsonField(value: unknown, keys: readonly string[], kind: 'boolean' | 'string'): string | boolean | null {
  for (const key of keys) {
    const hit = searchJson(value, key, kind, 0);
    if (hit !== null) return hit;
  }
  return null;
}

/** 结构化那一路认的键名（真机 `gsudo status --json` 实测含 `"CacheAvailable":false`） */
const JSON_AVAILABLE_KEYS = ['CacheAvailable', 'AvailableForThisProcess', 'Available'] as const;
const JSON_MODE_KEYS = ['CacheMode', 'Mode'] as const;
/** 🔴 人工可读那一路：**具体写法优先**（v2.6.1 真机是 `Available for this process:`，不是裸 `Available:`） */
const TEXT_AVAILABLE_SPECIFIC = /Available\s+for\s+this\s+process\s*:\s*(True|False)/iu;
const TEXT_AVAILABLE_GENERIC = /\bAvailable\b\s*:\s*(True|False)/iu;
const TEXT_MODE = /(?:Cache)?Mode\s*:\s*(\S+)/iu;

/** 结构化那一路：不是 JSON / 没有可用性字段 ⇒ `null`（交给文本那一路，不在这里下结论） */
function parseGsudoStatusJson(stdout: string): GsudoStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  const available = findJsonField(parsed, JSON_AVAILABLE_KEYS, 'boolean');
  if (typeof available !== 'boolean') return null;
  const mode = findJsonField(parsed, JSON_MODE_KEYS, 'string');
  return { readable: true, cacheAvailable: available, mode: typeof mode === 'string' ? mode : null, source: 'json' };
}

/**
 * 人工可读那一路：`Available for this process: False`（真机）与 `Available : False`（旧版）都要认。
 * ⚠️ 裸 `Available\s*:` **匹配不到** `Available for this process:`（中间是 ` for…`，不是冒号）⇒ 两条正则互不遮蔽。
 */
function parseGsudoStatusText(stdout: string): GsudoStatus {
  const mode = TEXT_MODE.exec(stdout);
  const hit = TEXT_AVAILABLE_SPECIFIC.exec(stdout) ?? TEXT_AVAILABLE_GENERIC.exec(stdout);
  if (hit === null) return { readable: false, cacheAvailable: false, mode: mode?.[1] ?? null, source: 'none' };
  return {
    readable: true,
    cacheAvailable: (hit[1] ?? '').toLowerCase() === 'true',
    mode: mode?.[1] ?? null,
    source: 'text',
  };
}

/**
 * `gsudo status` 输出 → 凭据缓存是否活跃（REQ-3.4 要求的那个字段）。
 *
 * **两路**：结构化（`--json` 的 `CacheAvailable`）优先；不成立再退回人工可读文本。
 * 🔴 两路都读不出来 ⇒ `readable: false` —— 调用方**必须**保守回落 native **并留下 note**（不许静默：这正是本机缺陷 1）。
 */
export function parseGsudoStatus(stdout: string): GsudoStatus {
  return parseGsudoStatusJson(stdout) ?? parseGsudoStatusText(stdout);
}

/**
 * `where.exe` 输出里找出**恰好叫 `exeName`** 的那条路径（大小写不敏感，取第一条）。
 * 刻意按 **basename 精确匹配**：`where.exe gsudo` 若只返回 `…\sudo.exe`，这里必须返回 `null`
 * （见文件头的陷阱说明）。
 */
export function parseWhereOutput(stdout: string, exeName: string): string | null {
  const wanted = exeName.toLowerCase();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const base = (line.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase();
    if (base === wanted) return line;
  }
  return null;
}

/** Windows 自带 `sudo.exe` 的固定绝对路径（**只按路径判**，不按命令名） */
export function windowsSudoPath(systemRoot: string): string {
  const root = systemRoot.replace(/[\\/]+$/, '');
  return `${root}\\System32\\sudo.exe`;
}

/**
 * 该路径是否是**系统自带**的 sudo（而不是 gsudo 造的 shim）。
 * 这是「按路径 + 产品名判定」里可离线判定的那一半：路径必须落在 `<SystemRoot>\System32\` 下。
 */
export function isSystemSudoPath(candidate: string, systemRoot: string): boolean {
  const normalize = (value: string): string => value.replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase();
  return normalize(candidate) === normalize(windowsSudoPath(systemRoot));
}

/** 默认的「文件存在」判定（测试注入 fake，避免真碰文件系统） */
export async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface BackendProbeDeps {
  readonly executor: Executor;
  /** 显式配置的后端；`auto` = `gsudo → native` 链 */
  readonly configured?: ElevationBackend | 'auto';
  /** `%SystemRoot%`；默认取环境变量，再退到 `C:\Windows`（只用于拼系统 sudo 的路径） */
  readonly systemRoot?: string;
  readonly fileExists?: (path: string) => Promise<boolean>;
}

/** 探测命令的统一出口：**带超时**、**绝不抛穿**（001 的执行器只回错误，但注入面可能抛） */
async function safeExec(
  executor: Executor,
  file: string,
  argv: readonly string[],
  timeoutMs: number,
): Promise<ExecResult | WslSharedError> {
  try {
    return await executor(file, argv, { encoding: 'utf8', timeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'Unexpected', message: `探测命令抛出异常：${message}`, argv: [file, ...argv] };
  }
}

/** 「探测失败」的可读原因：成功但不含判据 ⇒ 用调用方给的「读不出来」文案；失败 ⇒ **真实原因**（code + message，别吞掉） */
function failureReason(outcome: ExecResult | WslSharedError, unreadable: string): string {
  return outcome.ok ? unreadable : `${outcome.code}：${outcome.message}`;
}

/** 回落 native 的统一形态（`note` 里**必须**留下原因链：不静默） */
function nativeFallback(gsudoPath: string | null, notes: readonly string[], tail: string): BackendChoice {
  const head = notes.length === 0 ? '' : `${notes.join('；')}；`;
  return { backend: 'native', gsudoPath, cacheActive: false, note: `${head}${tail}` };
}

/** 有了可用性字段 ⇒ 按 REQ-3.4 判决（缓存活跃回落 native；否则用 gsudo），并把**判据来源**写进 note */
function chooseFromStatus(gsudoPath: string, parsed: GsudoStatus, how: string): BackendChoice {
  const mode = parsed.mode ?? '未知';
  if (parsed.cacheAvailable) {
    return {
      backend: 'native',
      gsudoPath,
      cacheActive: true,
      note:
        `gsudo 凭据缓存活跃（Mode=${mode}；判据=${how}）⇒ 回落 Start-Process -Verb RunAs；` +
        '不调 gsudo -k（那是杀用户的缓存会话），也不改 gsudo 配置（REQ-3.4）',
    };
  }
  return {
    backend: 'gsudo',
    gsudoPath,
    cacheActive: false,
    note: `gsudo 已装且凭据缓存未激活（Mode=${mode}；判据=${how}）⇒ 用其 stdio 回传与退出码（提权失败 = ${String(GSUDO_ELEVATION_FAILED_EXIT)}）`,
  };
}

/** 探测链（只读：`where.exe gsudo` + `gsudo status --json` / `gsudo status`；零提权、零写入） */
export async function detectBackend(deps: BackendProbeDeps): Promise<BackendChoice> {
  const configured = deps.configured ?? 'auto';
  const systemRoot = deps.systemRoot ?? process.env['SystemRoot'] ?? 'C:\\Windows';
  const exists = deps.fileExists ?? defaultFileExists;
  const notes: string[] = [];

  if (configured === 'winsudo') {
    const candidate = windowsSudoPath(systemRoot);
    let present = false;
    try {
      present = await exists(candidate);
    } catch (error) {
      notes.push(`检查 ${candidate} 是否存在时抛出异常（${error instanceof Error ? error.message : String(error)}）`);
    }
    if (present) {
      return {
        backend: 'winsudo',
        gsudoPath: null,
        cacheActive: false,
        note: `显式配置 elevationBackend=winsudo，且系统自带 sudo 存在于固定路径 ${candidate}`,
      };
    }
    notes.push(`显式配置了 winsudo，但 ${candidate} 不存在（24H2+ 且需在系统设置里显式开启）`);
  }

  const where = await safeExec(deps.executor, 'where.exe', ['gsudo'], WHERE_TIMEOUT_MS);
  if (!where.ok) {
    // ⚠️ 只有 `CommandNotFound` 才等于「未安装」；其它失败（含探测命令抛异常）必须原样留原因
    const why = where.code === 'CommandNotFound' ? '未安装 gsudo' : where.message;
    notes.push(`where.exe gsudo 失败（${where.code}）：${why}`);
    return nativeFallback(null, notes, '回落 Start-Process -Verb RunAs（永久回落，不依赖任何外部工具）');
  }

  const gsudoPath = parseWhereOutput(where.stdout, 'gsudo.exe');
  if (gsudoPath === null) {
    notes.push('where.exe gsudo 没有给出名为 gsudo.exe 的命中（刻意不认 sudo 这个命令名，见本机陷阱）');
    return nativeFallback(null, notes, '回落 Start-Process -Verb RunAs');
  }

  // ── 凭据缓存状态：**结构化优先**（`--json`），读不出来再退回人工可读文本 ──────────────
  // （两路都失败时 note 里两路的结果都要留：这就是缺陷 1「静默退化」的反面）
  const structured = await safeExec(deps.executor, gsudoPath, ['status', '--json'], GSUDO_STATUS_TIMEOUT_MS);
  const fromJson = structured.ok ? parseGsudoStatus(structured.stdout) : null;
  if (fromJson !== null && fromJson.readable) return chooseFromStatus(gsudoPath, fromJson, 'gsudo status --json');

  const text = await safeExec(deps.executor, gsudoPath, ['status'], GSUDO_STATUS_TIMEOUT_MS);
  const fromText = text.ok ? parseGsudoStatus(text.stdout) : null;
  if (fromText !== null && fromText.readable) return chooseFromStatus(gsudoPath, fromText, 'gsudo status');

  notes.push(
    `gsudo status --json ${failureReason(structured, '输出里没有可识别的可用性字段')}；` +
      `gsudo status ${failureReason(text, '输出里没有可识别的 Available 行')}`,
  );
  return nativeFallback(gsudoPath, notes, '保守回落 native：读不出凭据缓存状态 ⇒ 按「可能活跃」处理（REQ-3.4）');
}

/** 提权**可用性**（缺陷 2 / 005 tasks 的「待办①」）：后端判定 + 一条**可诊断**的原因 */
export interface ElevationAvailability {
  readonly available: boolean;
  /** 判定出的后端；探测失败 / 平台无通道时为 `null` */
  readonly backend: ElevationBackend | null;
  /** **永远非空**：可解说依据，不可解说原因（UI、日志与 `gaps` 都读它） */
  readonly reason: string;
}

export interface AvailabilityProbeDeps extends BackendProbeDeps {
  /** 平台（测试注入）；非 `win32` ⇒ gsudo 与 `Start-Process -Verb RunAs` 都不存在 ⇒ 无提权通道 */
  readonly platform?: string;
  /** 覆盖后端探测本身（测试注入；缺省 = 真跑 `detectBackend(deps)`） */
  readonly probeBackend?: () => Promise<BackendChoice>;
}

/**
 * 提权可用性（**与后端判定同源**）。
 *
 * 🔴 语义（别自作主张改）：`available: true` = 「探测确认存在一个**可执行**的提权后端」。
 * REQ-3.4 的后端链**总是**终结在一个可用后端上（`native` = `Start-Process -Verb RunAs`，永久回落、
 * 不依赖任何外部工具）⇒ 回落 native（gsudo 未装 / 缓存活跃 / 状态读不出来）**不是**「不可用」，
 * 那正是 REQ-3.4 设计的可用路径。于是 false 只有两种，且都是保守方向：
 * ① 平台不是 win32（既没有 gsudo 也没有 `Start-Process -Verb RunAs`）；
 * ② 探测抛出异常（未知状态 ⇒ 判不可用，**不会**因此把写控件放开）。
 */
export async function probeElevationAvailability(deps: AvailabilityProbeDeps): Promise<ElevationAvailability> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') {
    return {
      available: false,
      backend: null,
      reason: `当前平台是 ${platform}（不是 win32）⇒ gsudo 与 Start-Process -Verb RunAs 都不存在：无提权通道`,
    };
  }
  try {
    const choice = await (deps.probeBackend ?? ((): Promise<BackendChoice> => detectBackend(deps)))();
    return { available: true, backend: choice.backend, reason: `提权后端探测成功：backend=${choice.backend}；${choice.note}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, backend: null, reason: `提权后端探测抛出异常（${message}）⇒ 无法确认提权通道，保守判为不可用` };
  }
}

/** 可用性探测的缓存壳 */
export interface ElevationAvailabilityProbe {
  /** 跑一次（**进程内只真跑一次**；并发调用共享同一次 ⇒ 单飞） */
  probe(): Promise<ElevationAvailability>;
  /** 同步读缓存；还没跑过 = `null` */
  peek(): ElevationAvailability | null;
}

/**
 * 造一个「**单飞 + 一次缓存**」的可用性探测（缺陷 2 的「不许每份快照都同步打真进程」）。
 *
 * 依据：① `build()` 每次刷新都会问一次可用性，而真探测要起 1–3 个进程（`where.exe gsudo` +
 * `gsudo status --json`，读不出来再加 `gsudo status`）⇒ 每份快照都打进程 = 刷新一次卡一次；
 * ② 真正的后端判定在**每次提权时**由 `runElevate` → `probeOf` 重做一遍 ⇒ 缓存的陈旧值
 * 不可能造成一次错误的写；③ 会话内「有没有提权通道」几乎不翻转（native 永久可回落），
 * 加 TTL 只会白白多起进程。并发请求共享同一次探测（单飞），失败结果**同样缓存**（保守值不抖）。
 */
export function createElevationAvailabilityProbe(deps: AvailabilityProbeDeps): ElevationAvailabilityProbe {
  let cached: ElevationAvailability | null = null;
  let inflight: Promise<ElevationAvailability> | null = null;
  return {
    peek: (): ElevationAvailability | null => cached,
    probe: async (): Promise<ElevationAvailability> => {
      if (inflight === null) {
        inflight = probeElevationAvailability(deps).then((result) => {
          cached = result;
          return result;
        });
      }
      return inflight;
    },
  };
}

/**
 * 策略解析（REQ-3.1/3.2/3.3 + REQ-4.1）：
 * **Agent 触发的 `passby` 降级为 `ask`**（A-1 定案 = 方案 A）——
 * 保住「Agent 帮你发起、你只需点一次确认」的可用性，同时保证每次都有一次人类显式点击。
 * `none` 与 `ask` 不受来源影响。
 */
export function resolvePolicy(policy: ElevationPolicy, source: RequestSource): ElevationPolicy {
  if (source === 'agent' && policy === 'passby') return 'ask';
  return policy;
}
