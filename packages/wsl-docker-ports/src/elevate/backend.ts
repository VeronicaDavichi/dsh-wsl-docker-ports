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
 */

import { access } from 'node:fs/promises';

import type { Executor } from 'dsh-wsl-shared';

import type { BackendChoice, ElevationBackend, ElevationPolicy, RequestSource } from './types.ts';

/** 后端探测的超时（都是毫秒级本地命令；`where` 5s、`status` 10s 只是兜底） */
export const WHERE_TIMEOUT_MS = 5_000;
export const GSUDO_STATUS_TIMEOUT_MS = 10_000;

/** gsudo 的「提权失败」退出码（REQ-3.4：官方口径，判为**提权失败**而不是普通失败） */
export const GSUDO_ELEVATION_FAILED_EXIT = 999;

/** `gsudo status` 的解析结果 */
export interface GsudoStatus {
  /** 输出里是否有可识别的 `Available:` 行（读不出来 = `false`） */
  readonly readable: boolean;
  readonly cacheAvailable: boolean;
  readonly mode: string | null;
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

/** `gsudo status` → 凭据缓存是否活跃（REQ-3.4 要求的那个字段） */
export function parseGsudoStatus(stdout: string): GsudoStatus {
  const available = /Available\s*:\s*(True|False)/i.exec(stdout);
  const mode = /Mode\s*:\s*(\S+)/i.exec(stdout);
  if (available === null) {
    return { readable: false, cacheAvailable: false, mode: mode?.[1] ?? null };
  }
  return {
    readable: true,
    cacheAvailable: (available[1] ?? '').toLowerCase() === 'true',
    mode: mode?.[1] ?? null,
  };
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

/** 探测链（只读：`where.exe gsudo` + `gsudo status`；零提权、零写入） */
export async function detectBackend(deps: BackendProbeDeps): Promise<BackendChoice> {
  const configured = deps.configured ?? 'auto';
  const systemRoot = deps.systemRoot ?? process.env['SystemRoot'] ?? 'C:\\Windows';
  const exists = deps.fileExists ?? defaultFileExists;
  const notes: string[] = [];

  if (configured === 'winsudo') {
    const candidate = windowsSudoPath(systemRoot);
    if (await exists(candidate)) {
      return {
        backend: 'winsudo',
        gsudoPath: null,
        cacheActive: false,
        note: `显式配置 elevationBackend=winsudo，且系统自带 sudo 存在于固定路径 ${candidate}`,
      };
    }
    notes.push(`显式配置了 winsudo，但 ${candidate} 不存在（24H2+ 且需在系统设置里显式开启）`);
  }

  const where = await deps.executor('where.exe', ['gsudo'], { encoding: 'utf8', timeoutMs: WHERE_TIMEOUT_MS });
  if (!where.ok) {
    notes.push(`where.exe gsudo 失败（${where.code}）：未安装 gsudo`);
    return {
      backend: 'native',
      gsudoPath: null,
      cacheActive: false,
      note: `${notes.join('；')}；回落 Start-Process -Verb RunAs（永久回落，不依赖任何外部工具）`,
    };
  }

  const gsudoPath = parseWhereOutput(where.stdout, 'gsudo.exe');
  if (gsudoPath === null) {
    notes.push('where.exe gsudo 没有给出名为 gsudo.exe 的命中（刻意不认 sudo 这个命令名，见本机陷阱）');
    return {
      backend: 'native',
      gsudoPath: null,
      cacheActive: false,
      note: `${notes.join('；')}；回落 Start-Process -Verb RunAs`,
    };
  }

  const status = await deps.executor(gsudoPath, ['status'], {
    encoding: 'utf8',
    timeoutMs: GSUDO_STATUS_TIMEOUT_MS,
  });
  if (!status.ok) {
    notes.push(`gsudo status 失败（${status.code}）：无法确认凭据缓存是否活跃`);
    return {
      backend: 'native',
      gsudoPath,
      cacheActive: false,
      note: `${notes.join('；')}；按「缓存可能活跃」保守回落 native，以保住每次的 UAC 闸门（REQ-3.4 / REQ-4.1）`,
    };
  }

  const parsed = parseGsudoStatus(status.stdout);
  if (!parsed.readable) {
    notes.push('gsudo status 输出里没有可识别的 Available 行');
    return {
      backend: 'native',
      gsudoPath,
      cacheActive: false,
      note: `${notes.join('；')}；保守回落 native（同上）`,
    };
  }
  if (parsed.cacheAvailable) {
    return {
      backend: 'native',
      gsudoPath,
      cacheActive: true,
      note:
        `gsudo 凭据缓存活跃（Mode=${parsed.mode ?? '未知'}）⇒ 回落 Start-Process -Verb RunAs；` +
        '不调 gsudo -k（那是杀用户的缓存会话），也不改 gsudo 配置（REQ-3.4）',
    };
  }
  return {
    backend: 'gsudo',
    gsudoPath,
    cacheActive: false,
    note: `gsudo 已装且凭据缓存未激活（Mode=${parsed.mode ?? '未知'}）⇒ 用其 stdio 回传与退出码（提权失败 = ${String(GSUDO_ELEVATION_FAILED_EXIT)}）`,
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
