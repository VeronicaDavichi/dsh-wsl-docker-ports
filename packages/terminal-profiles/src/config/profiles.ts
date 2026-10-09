/**
 * 配置模型与逐条容错解析（002 REQ-1.1–1.3 / 任务 T1.1；`cwdLinux` 接线见 ./cwd-linux.ts）
 *
 * ## 为什么自己解析，而不是让 schemastery 校验整个数组
 *
 * REQ-1.2 要的是**逐条容错**：一条坏配置只跳过它自己，其余照常可用，且**不得**让整个 profile
 * 启动失败。而 schemastery 是按整个 `profiles` 数组校验的 —— 一条不合法就是**整数组**失败，与
 * 该 REQ 直接冲突。故职责切成两半：`./schema.ts` 只管**声明 + volatile 接线**（宿主用它判
 * live/ordinary），**判定**归本文件。不要在两处各解释一套字段口径。
 *
 * ## 读配置的调用约定（宿主事实 A-1，踩过就会静默变空配置）
 *
 * cordis 里 `profiles` 标了 `.volatile()`，解析结果是**带 `.get()` 的深冻结对象**，下标取值是
 * `undefined` ⇒ 必须 `parseProfiles(config.profiles.get())`。直接传 `config.profiles` 会得到一条
 * 明确的「必须是数组」根诊断（并附 `.get()` 提示），**不会**被当成空配置而静默显示引导态。
 *
 * 纯函数：不读文件、不起进程、不碰宿主 API（Phase 1 的门）。
 */

import type { WslSharedError } from 'dsh-wsl-shared';

import { deriveCwdLinux } from './cwd-linux.ts';

/** 诊断类别（字符串字面量联合：`erasableSyntaxOnly` 下不用 enum，且它要直接进 UI / 日志） */
export type ProfileDiagnosticKind =
  /** 缺必填字段，或必填字段是空白串（REQ-1.1） */
  | 'MissingField'
  /** 字段类型错（REQ-1.1） */
  | 'TypeMismatch'
  /** 与先出现的条目重名 ⇒ 拒绝后者（REQ-1.3） */
  | 'DuplicateName'
  /** `cwdLinux` 推导失败 ⇒ 该条「需修复」且不可启动（REQ-1.4） */
  | 'CwdUnmappable';

/** 逐条诊断：**人话在前**（REQ-1.2 要求「记录警告」，UI 直接展示 `message`） */
export interface ProfileDiagnostic {
  /** 输入数组下标（配置页据此定位到行）；`ROOT_INDEX` = 整个 `profiles` 值本身不合法 */
  readonly index: number;
  readonly kind: ProfileDiagnosticKind;
  readonly message: string;
  /** 命中的字段名（能定位到字段的诊断才带） */
  readonly field?: string;
  /** true = 该条已被**丢弃**（REQ-1.2）；false = 留在列表里但**不可启动**（REQ-1.4） */
  readonly skipped: boolean;
  /** 重名时指向**先出现者**的下标（REQ-1.3「提示冲突来源」，不是只说「重名了」） */
  readonly conflictWith?: number;
  /** `CwdUnmappable` 时带 001 的错误码（如 `UnmappablePath`），供 UI 分类与追溯 */
  readonly code?: WslSharedError['code'];
}

/** 解析后的单条 profile（字段已归一化：默认值补齐、字符串 trim） */
export interface TerminalProfile {
  readonly name: string;
  readonly command: string;
  /** 缺省 `[]`；元素**不** trim、不切词（argv 原样进 spawnTerminal，REQ-3.6） */
  readonly args: readonly string[];
  /** 缺省 `{}`；键与值都原样保留（环境变量大小写敏感） */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  /** WSL profile 的 Linux 侧 cwd（REQ-3.2）：由 `cwd` 推导，或用户显式填写 */
  readonly cwdLinux?: string;
  /** 非 `undefined` ⇒ 该条**需修复、不可启动**（REQ-1.4），值就是 001 的失败原因 */
  readonly needsFix?: WslSharedError;
}

/** 解析结果：**永远是部分成功**（对比 001 的 `ok` 判别联合 —— 那里有单点失败，这里没有） */
export interface ProfilesParseResult {
  /** 可用项 + 需修复项，**保持输入顺序**（配置页与下拉框的顺序都靠它，REQ-4.3 的「创建序」在此起步） */
  readonly profiles: readonly TerminalProfile[];
  readonly diagnostics: readonly ProfileDiagnostic[];
}

/** 「整个 `profiles` 值不合法」在诊断里的下标（负数不可能与真实元素下标撞车） */
export const ROOT_INDEX = -1;

/** 可启动判定（REQ-1.4）：需修复的条目**不可启动**，但它仍留在列表里供用户修 */
export function isStartable(profile: TerminalProfile): boolean {
  return profile.needsFix === undefined;
}

/**
 * WSL profile 判定（REQ-3.2 的「`command` 为 `wsl.exe`」）。
 *
 * 判**末段路径 + 忽略大小写 + `.exe` 可省**：配置里写 `wsl`、`WSL.EXE`、
 * `C:\Windows\System32\wsl.exe` 都是同一件事，用户不该因为写法不同被区别对待。
 * **不**把 `bash.exe` / `ubuntu.exe` 之类算进来 —— REQ 只写了 `wsl.exe`，别自作主张。
 */
export function isWslProfile(command: string): boolean {
  const last = command.split(/[\\/]/).pop() ?? '';
  return /^wsl(\.exe)?$/i.test(last);
}

/** 解析时的成功/失败载体（失败一律「跳过该条 + 一条诊断」，与 REQ-1.2 的形状一致） */
type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: ProfileDiagnostic };

/** 消息里回显用户输入前的限长（脏输入不该把消息撑爆） */
const ECHO_MAX = 60;

/**
 * 用户输入「可见化 + 限长」再进消息：控制字符（ESC / LF / BEL …）原样进 UI 或日志会破排版，
 * 甚至**注入 ANSI 转义**（001 Phase 4 自审踩过：`E:\x\u001b[31mred` 的 ESC 被原样带出）。
 */
function brief(raw: string): string {
  const visible = raw.replace(
    /[\u0000-\u001f\u007f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return visible.length <= ECHO_MAX ? visible : `${visible.slice(0, ECHO_MAX)}…（共 ${raw.length} 字符）`;
}

/** 给人看的类型描述（错误消息用）：只说 `typeof` 会把「数组」和「对象」混成一句 object */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '数组';
  switch (typeof value) {
    case 'string':
      return `字符串「${brief(value)}」`;
    case 'object':
      return '对象';
    case 'function':
      return '函数';
    default:
      return `${typeof value} ${String(value)}`;
  }
}

/** 普通对象（**排除数组与 null**：`env` 传 `[]` 是类型错，不是「空环境变量」） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 该条被丢弃时的唯一出口（构造诊断，别处不许手搓 `skipped`） */
function discarded(
  index: number,
  kind: ProfileDiagnosticKind,
  message: string,
  field?: string,
): Parsed<never> {
  return {
    ok: false,
    diagnostic: {
      index,
      kind,
      message,
      skipped: true,
      ...(field === undefined ? {} : { field }),
    },
  };
}

/** 必填非空字符串（REQ-1.1）：缺失/空白 = `MissingField`，非字符串 = `TypeMismatch` */
function requiredString(raw: Record<string, unknown>, field: string, index: number): Parsed<string> {
  const value = raw[field];
  const where = `第 ${index + 1} 条 profile`;
  if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return discarded(index, 'MissingField', `${where}缺必填字段 ${field}（缺失或为空白）`, field);
  }
  if (typeof value !== 'string') {
    return discarded(index, 'TypeMismatch', `${where}的 ${field} 必须是字符串，收到 ${typeName(value)}`, field);
  }
  return { ok: true, value: value.trim() };
}

/** 可选字符串（`cwd` / `cwdLinux`）：空白等同未填（与 001 对路径入参 trim 的口径一致） */
function optionalString(
  raw: Record<string, unknown>,
  field: string,
  index: number,
): Parsed<string | undefined> {
  const value = raw[field];
  const where = `第 ${index + 1} 条 profile`;
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string') {
    return discarded(index, 'TypeMismatch', `${where}的 ${field} 必须是字符串，收到 ${typeName(value)}`, field);
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed === '' ? undefined : trimmed };
}

/** `args`：缺省 `[]`；只查类型，**元素逐个查**（错到哪一个要在消息里说清楚） */
function optionalArgs(raw: Record<string, unknown>, index: number): Parsed<string[]> {
  const value = raw['args'];
  const where = `第 ${index + 1} 条 profile`;
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return discarded(index, 'TypeMismatch', `${where}的 args 必须是字符串数组，收到 ${typeName(value)}`, 'args');
  }
  const args: string[] = [];
  const items: unknown[] = value;
  for (const [position, item] of items.entries()) {
    if (typeof item !== 'string') {
      const bad = `${where}的 args[${position}] 必须是字符串，收到 ${typeName(item)}`;
      return discarded(index, 'TypeMismatch', bad, 'args');
    }
    args.push(item);
  }
  return { ok: true, value: args };
}

/** `env`：缺省 `{}`；必须是「字符串 → 字符串」的普通对象（数字/布尔不猜转换） */
function optionalEnv(raw: Record<string, unknown>, index: number): Parsed<Record<string, string>> {
  const value = raw['env'];
  const where = `第 ${index + 1} 条 profile`;
  if (value === undefined) return { ok: true, value: {} };
  if (!isPlainObject(value)) {
    const bad = `${where}的 env 必须是「字符串 → 字符串」对象，收到 ${typeName(value)}`;
    return discarded(index, 'TypeMismatch', bad, 'env');
  }
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      return discarded(index, 'TypeMismatch', `${where}的 env.${key} 必须是字符串，收到 ${typeName(item)}`, 'env');
    }
    env[key] = item;
  }
  return { ok: true, value: env };
}

/**
 * 单条解析：**只做结构**（字段、类型、默认值）。
 * 重名与 `cwdLinux` 推导放 `parseProfiles` —— 那是「跨条目」与「要不要推导」的判定，
 * 一个会被丢弃的重名条目不该再产出第二条诊断（诊断列表要能一对一映射到用户要修的地方）。
 */
function parseEntry(raw: unknown, index: number): Parsed<TerminalProfile> {
  if (!isPlainObject(raw)) {
    return discarded(
      index,
      'TypeMismatch',
      `第 ${index + 1} 条 profile 必须是对象，收到 ${typeName(raw)}`,
    );
  }
  const name = requiredString(raw, 'name', index);
  if (!name.ok) return name;
  const command = requiredString(raw, 'command', index);
  if (!command.ok) return command;
  const args = optionalArgs(raw, index);
  if (!args.ok) return args;
  const env = optionalEnv(raw, index);
  if (!env.ok) return env;
  const cwd = optionalString(raw, 'cwd', index);
  if (!cwd.ok) return cwd;
  const cwdLinux = optionalString(raw, 'cwdLinux', index);
  if (!cwdLinux.ok) return cwdLinux;

  return {
    ok: true,
    value: {
      name: name.value,
      command: command.value,
      args: args.value,
      env: env.value,
      ...(cwd.value === undefined ? {} : { cwd: cwd.value }),
      ...(cwdLinux.value === undefined ? {} : { cwdLinux: cwdLinux.value }),
    },
  };
}

/** 推导后的条目 + 可能需要追加的诊断（`undefined` = 一切正常） */
interface CwdLinuxOutcome {
  readonly profile: TerminalProfile;
  readonly diagnostic?: ProfileDiagnostic;
}

/**
 * REQ-1.4 的接线点：**只在「WSL profile + 只填了 `cwd` + 没填 `cwdLinux`」时**推导。
 *
 * - 显式给了 `cwdLinux` ⇒ **不推导、不覆盖用户输入**（用户可能故意指向 `/home/...`，
 *   那个路径在 `cwd` 里根本没有 Windows 等价形态）；
 * - 非 WSL profile（`pwsh.exe` 等）⇒ 不推导。理由：`cwdLinux` 对它们**没有消费方**，
 *   而对一个合法但不可翻译的 Windows `cwd`（如 `\\server\share`）标「需修复」会**误伤**
 *   完全能跑的 profile —— REQ-1.4 的前提是「WSL profile」；
 * - WSL profile 两个都没填 ⇒ 也不推导（没有输入可推），留给启动期 REQ-3.3 报错。
 */
function applyCwdLinux(profile: TerminalProfile, index: number): CwdLinuxOutcome {
  if (!isWslProfile(profile.command) || profile.cwdLinux !== undefined || profile.cwd === undefined) {
    return { profile };
  }
  const derived = deriveCwdLinux(profile.cwd);
  if (derived.ok) return { profile: { ...profile, cwdLinux: derived.cwdLinux } };
  return {
    profile: { ...profile, needsFix: derived.error },
    diagnostic: {
      index,
      kind: 'CwdUnmappable',
      message: `第 ${index + 1} 条 profile 的 cwd 无法推导 cwdLinux ⇒ 该条不可启动：${derived.error.message}`,
      field: 'cwd',
      skipped: false,
      code: derived.error.code,
    },
  };
}

/**
 * 解析 `profiles` 配置值（REQ-1.1–1.4）。
 *
 * 容错口径（缺字段 / 类型错 / 重名 / 空数组分别怎么办）：
 * | 输入 | 结果 |
 * |---|---|
 * | `undefined`（整键缺失） | 等同空配置：`profiles: []`、**零诊断**（REQ-1.5 的引导态） |
 * | 非数组（`null` / 对象 / 字符串…） | 一条**根诊断**（`index = ROOT_INDEX`），`profiles: []`，不抛错 |
 * | 空数组 | `profiles: []`、零诊断 |
 * | 单条缺必填 / 类型错 / 非对象 | **丢弃该条** + 一条 `skipped: true` 的诊断，其余条目不受影响（REQ-1.2） |
 * | 单条重名 | **丢弃后者** + `DuplicateName`（带 `conflictWith` 指向先出现者），先出现者原样保留（REQ-1.3） |
 * | WSL 且 `cwdLinux` 推导失败 | **保留**该条（用户要在配置页看见它才能修）+ `CwdUnmappable`，并标 `needsFix` ⇒ 不可启动（REQ-1.4） |
 * | 未知字段 | 忽略（不拒绝整条、也不带进结果）；schemastery 同样会剔除未知键 |
 *
 * ⚠️ 假设（REQ 未写死，实现选择）：`name` 重名按 **trim 后逐字精确比较**（不忽略大小写）——
 * 重名判定要给用户一个确定的答案，大小写折叠会让「Dev / dev 到底算不算撞」变成实现细节；
 * 若将来要折叠，须同时改配置页文案。
 */
export function parseProfiles(raw: unknown): ProfilesParseResult {
  const profiles: TerminalProfile[] = [];
  const diagnostics: ProfileDiagnostic[] = [];
  /** name → 先出现者的下标（REQ-1.3 的「冲突来源」就是它） */
  const firstSeen = new Map<string, number>();

  if (raw === undefined) return { profiles, diagnostics };
  if (!Array.isArray(raw)) {
    // 忘了 `.get()` 是最可能的原因（A-1：volatile 解析结果是**带 .get() 的对象**）⇒ 提示写在消息里
    const hint =
      isPlainObject(raw) && typeof raw['get'] === 'function'
        ? '（提示：「profiles」在宿主里是 volatile 解析结果，必须先 .get() 再传进来）'
        : '';
    return {
      profiles,
      diagnostics: [
        {
          index: ROOT_INDEX,
          kind: 'TypeMismatch',
          message: `配置项 profiles 必须是数组，收到 ${typeName(raw)}${hint}`,
          field: 'profiles',
          skipped: true,
        },
      ],
    };
  }

  const items: unknown[] = raw;
  for (const [index, item] of items.entries()) {
    const parsed = parseEntry(item, index);
    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }
    const conflict = firstSeen.get(parsed.value.name);
    if (conflict !== undefined) {
      diagnostics.push({
        index,
        kind: 'DuplicateName',
        message: `第 ${index + 1} 条 profile 的 name「${brief(parsed.value.name)}」与第 ${conflict + 1} 条重名 ⇒ 已拒绝后者（不覆盖先出现者）`,
        field: 'name',
        skipped: true,
        conflictWith: conflict,
      });
      continue;
    }
    const outcome = applyCwdLinux(parsed.value, index);
    if (outcome.diagnostic !== undefined) diagnostics.push(outcome.diagnostic);
    firstSeen.set(parsed.value.name, index);
    profiles.push(outcome.profile);
  }

  return { profiles, diagnostics };
}
