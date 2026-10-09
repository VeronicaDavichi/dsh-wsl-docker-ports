/**
 * 单条 profile 的**结构规则**（002 REQ-1.1 / REQ-1.2；T6.1 起**宿主半与配置页共用同一份**）
 *
 * ## 为什么把这层单独拆出来（而不是留在 `profiles.ts`）
 *
 * 配置页（客户端半）要在**写盘前**告诉用户「第 N 条哪里错了」，而它**不能** import
 * `./profiles.ts`：那里的 `applyCwdLinux` 依赖 006 的路径翻译，最终会扯进 `dsh-wsl-shared`
 * 的 `node:child_process`（浏览器包里会当场构建失败）。于是把**纯结构规则**（字段 / 类型 /
 * 默认值）挪到本文件 —— 宿主与配置页 import **同一个函数**，不会出现两套字段口径。
 *
 * `profiles.ts` 保留的是**跨条目**与**要不要推导**的判定（重名、`cwdLinux` 推导），
 * 那两件事本来就只有宿主做得了（需要 006）。
 *
 * ## 纯函数
 *
 * 不读文件、不起进程、不碰宿主 API、不 import 任何运行时依赖（只有一处 **type-only** 的
 * `dsh-wsl-shared` 引用，编译后完全擦除）⇒ 可同时进宿主产物与浏览器主 bundle。
 */

import type { WslSharedError } from 'dsh-wsl-shared';

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

/** 「整个 `profiles` 值不合法」在诊断里的下标（负数不可能与真实元素下标撞车） */
export const ROOT_INDEX = -1;

/**
 * 单条的结构（字段已归一化：默认值补齐、字符串 trim）—— `TerminalProfile` 的**结构部分**。
 * 配置页的表单行也是它：**同一形状进、同一形状出**，写回的 patch 与宿主解析的输入逐字一致。
 */
export interface RawProfileRow {
  readonly name: string;
  readonly command: string;
  /** 缺省 `[]`；元素**不** trim、不切词（argv 原样进 spawnTerminal，REQ-3.6） */
  readonly args: readonly string[];
  /** 缺省 `{}`；键与值都原样保留（环境变量大小写敏感） */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  /** WSL profile 的 Linux 侧 cwd（REQ-3.2）：由 `cwd` 推导，或用户显式填写 */
  readonly cwdLinux?: string;
}

/** 解析时的成功/失败载体（失败一律「跳过该条 + 一条诊断」，与 REQ-1.2 的形状一致） */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: ProfileDiagnostic };

/** 消息里回显用户输入前的限长（脏输入不该把消息撑爆） */
const ECHO_MAX = 60;

/**
 * 用户输入「可见化 + 限长」再进消息：控制字符（ESC / LF / BEL …）原样进 UI 或日志会破排版，
 * 甚至**注入 ANSI 转义**（001 Phase 4 自审踩过：`E:\x\u001b[31mred` 的 ESC 被原样带出）。
 */
export function brief(raw: string): string {
  const visible = raw.replace(
    /[\u0000-\u001f\u007f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return visible.length <= ECHO_MAX ? visible : `${visible.slice(0, ECHO_MAX)}…（共 ${raw.length} 字符）`;
}

/** 给人看的类型描述（错误消息用）：只说 `typeof` 会把「数组」和「对象」混成一句 object */
export function typeName(value: unknown): string {
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
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 该条被丢弃时的唯一出口（构造诊断，别处不许手搓 `skipped`） */
export function discarded(
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
 * 重名与 `cwdLinux` 推导放 `./profiles.ts` —— 那是「跨条目」与「要不要推导」的判定，
 * 一个会被丢弃的重名条目不该再产出第二条诊断（诊断列表要能一对一映射到用户要修的地方）。
 */
export function parseRowStructure(raw: unknown, index: number): Parsed<RawProfileRow> {
  if (!isPlainObject(raw)) {
    return discarded(index, 'TypeMismatch', `第 ${index + 1} 条 profile 必须是对象，收到 ${typeName(raw)}`);
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

/**
 * 整个 `profiles` 值的**根判定**：非数组（含忘了 `.get()` 的 volatile 解析结果）⇒ 一条根诊断。
 * 抽出来是为了让配置页在写盘前也能用**同一句话**解释「你给的不是数组」。
 */
export function checkProfilesRoot(raw: unknown): ProfileDiagnostic | undefined {
  if (raw === undefined || Array.isArray(raw)) return undefined;
  const hint =
    isPlainObject(raw) && typeof raw['get'] === 'function'
      ? '（提示：「profiles」在宿主里是 volatile 解析结果，必须先 .get() 再传进来）'
      : '';
  return {
    index: ROOT_INDEX,
    kind: 'TypeMismatch',
    message: `配置项 profiles 必须是数组，收到 ${typeName(raw)}${hint}`,
    field: 'profiles',
    skipped: true,
  };
}
