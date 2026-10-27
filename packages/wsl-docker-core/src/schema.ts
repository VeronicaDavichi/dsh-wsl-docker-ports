/**
 * **共享 schema 底座**（016 从 `wsl-docker-ports/src/config.ts` 抽出，逻辑逐行照搬）
 *
 * ## 为什么在 core
 *
 * 两个插件包各自的 `Config` 字段不同（转发侧 7 个、容器侧 4 个），但**怎么把 schema 造出来**
 * 完全一样，而且这一套里全是踩过的坑（多锚点运行时解析、`role('secret')`、volatile 门、诊断不静默）。
 * 各写一份 = 两个包各自漂移一次的机会；故**工厂与锚点只留这里一份**，包里只声明「我有哪些字段」。
 *
 * ## 两道门（缺一不可，真机两次订正，留痕不删）
 *
 * ① **导出 `Config`** 是必要条件：`dsh-settings` 的 `schema(entry)` = `entry.fiber?.runtime?.Config`
 *    ⇒ 不导出就取不到 schema。
 * ② 🔴 **但不充分**：`describe()` 紧接着要 `volatileForm(schema) !== undefined`，**零 volatile 的
 *    `Config` 会让整个命名空间消失** ⇒ 每包至少一个 volatile 字段（两侧都是全标）。
 * ③ `write()` 对非 volatile 路径直接抛 `Config field "…" is not volatile`
 *    ⇒ 凡客户端要经 `remote.settings.update` 写的字段都必须标 volatile。
 *
 * ## 零新增依赖：**多锚点**运行时解析（不是静态 import）
 *
 * 静态 `import z from '@deepseek-ai/schemastery'` 要求该包在依赖里；本仓不许为此加依赖
 * （`dsh-wsl-shared` 已经证明宿主依赖解析在不同安装形态下会落在不同层）⇒ 走
 * `createRequire(anchor)` 多锚点试，首个成功即用；全部失败 ⇒ `Config === undefined`
 * （与旧行为一致、失败可见），**绝不造假 schema**。
 *
 * ## `import.meta.url` 锚点（016 留痕）
 *
 * 锚点 ① 是「本模块自身」。抽到 core 后它指向 **core 的模块 URL**（拆包前是转发包的）——
 * 这一条在本机实测本来就是 `MODULE_NOT_FOUND`，只是「同族一致」的第一候选；解析结果由
 * ④-a / ⑥ 等真命中族决定，故拆包不改变任何一台已实测机器上的解析结果。
 */

import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

/** profile 目录枚举上限（有界：只取排序后的前 N 个，防止畸形 HOME 把候选炸开） */
export const PROFILE_ANCHOR_MAX = 24;

/** schemastery 的宿主包名（与同族插件、与 002 的 `HOST_SCHEMA_MODULE` 逐字一致） */
export const HOST_SCHEMA_MODULE = '@deepseek-ai/schemastery';

/** 最小 schema 面（`SchemaLike` 与 002 同形：只要求 `volatile()` / `role()` 存在） */
export interface SchemaLike {
  volatile(): SchemaLike;
  /** `.role('secret')`：宿主据此把字段从 `describe().value` 摘掉、只留 `secrets[{path,set}]` */
  role(role: string): SchemaLike;
}

/**
 * 造 `Config` 用的工厂成员。
 *
 * ⚠️ 与 002 的 gate 有一个刻意的差异：002 只认 `any`/`array`/`object`，本仓**还要用 `string`**
 * 与 `number`（数值字段），故 gate 多两个成员 —— 否则「gate 通过但构建时 `z.number` 不存在」
 * 会抛在模块装载期，把插件连 `apply` 一起打死（比 `Config === undefined` 坏得多）。
 */
export interface SchemaFactory {
  any(): SchemaLike;
  array(item: SchemaLike): SchemaLike;
  object(shape: Record<string, SchemaLike>): SchemaLike;
  string(): SchemaLike;
  number(): SchemaLike;
  /** dict 字段用；缺失时降级为 `any()`，不因此拒绝整个工厂 */
  dict?(item: SchemaLike): SchemaLike;
}

/** 一个锚点的尝试结果（诊断用：`detail` 里放 `MODULE_NOT_FOUND` 之类的原话） */
export interface HostModuleAttempt {
  readonly anchor: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface SchemaResolution {
  readonly factory: SchemaFactory | undefined;
  readonly resolvedFrom: string | null;
  readonly attempts: readonly HostModuleAttempt[];
}

/** 有界列举 profile 目录：只读一次目录名（**不读任何文件内容**），任何失败都当「没有」 */
function listProfileDirs(root: string): readonly string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
      .map((entry) => join(root, entry.name))
      .sort()
      .slice(0, PROFILE_ANCHOR_MAX);
  } catch {
    return [];
  }
}

/**
 * 宿主模块锚点（按本机实测的可行性排序）。
 *
 * 逐个都只是 `createRequire` 的解析基准；除 ⑤ 那一次**有界目录列举**外不读任何文件、
 * 不碰网络、不改任何状态；不是绝对路径的候选一律丢弃（`createRequire` 对相对路径会按 cwd 解析 = 猜）。
 */
export function hostModuleAnchors(): readonly string[] {
  const anchors: string[] = [];
  const add = (candidate: unknown): void => {
    if (typeof candidate !== 'string') return;
    const value = candidate.trim();
    if (value === '') return;
    if (!isAbsolute(value) && !value.startsWith('file:')) return;
    if (!anchors.includes(value)) anchors.push(value);
  };
  // ① 本模块自身（002 同款锚点；本机实测 MODULE_NOT_FOUND，留作第一候选只为「同族一致」）
  add(import.meta.url);
  // ② 宿主进程入口 / node 可执行文件（Electron 打包应用与托管运行时都在这一族里）
  add(process.argv[1]);
  add(process.execPath);
  // ③ Electron 宿主：`resources/app.asar/node_modules/**` 是宿主自带的依赖树
  const resources = (process as { resourcesPath?: unknown }).resourcesPath;
  if (typeof resources === 'string') add(join(resources, 'app.asar', 'index.js'));
  // ④ profile 层（本机实测**唯一真能解析到**的一族）
  let home = '';
  try {
    home = homedir();
  } catch {
    // 🔴 本仓已记的坑：`USERPROFILE=''` 时 `os.homedir()` **自己会抛** `ERR_SYSTEM_ERROR`
    home = '';
  }
  if (home.trim() !== '') {
    const profilesRoot = join(home, '.dsh', 'profiles');
    // ④-a 活跃 profile（真目录 + `@deepseek-ai/schemastery` 是它的**直接依赖**、`hoisted` ⇒ 真目录）
    for (const profile of listProfileDirs(profilesRoot)) add(join(profile, 'index.js'));
    // ④-b profile 层公共依赖场（本机是**悬空 junction**，留着以防别的安装形态真能用）
    add(join(profilesRoot, 'index.js'));
    add(join(home, '.dsh', 'index.js'));
  }
  // ⑤ 最后兜底：宿主的工作目录（宿主若以 profile 目录为 cwd，这一条也能命中 ④-a）
  add(join(process.cwd(), 'index.js'));
  // ⑥ 宿主 CLI 包**自带的嵌套依赖树**（2026-10-15 新增；本机 = 全局 npm 安装形态）
  //    `createRequire` 只把该路径当**起点**、不校验它存在 ⇒ 未装宿主/别的安装形态时自然失败并被跳过。
  add(join(dirname(process.execPath), 'node_modules/@deepseek-ai/dsh/index.js'));
  return anchors;
}

/** 从模块命名空间里取一个成员（`default` 互操作；与 002 的 `memberOf` 同口径） */
export function memberOf(module: unknown, name: string): unknown {
  if (module === null || (typeof module !== 'object' && typeof module !== 'function')) return undefined;
  const direct = (module as Record<string, unknown>)[name];
  if (direct !== undefined) return direct;
  const fallback = (module as { default?: unknown }).default;
  if (fallback === undefined || fallback === module) return undefined;
  if (fallback === null || (typeof fallback !== 'object' && typeof fallback !== 'function')) return undefined;
  return (fallback as Record<string, unknown>)[name];
}

/** 结构面判定：够不够当本仓要用的 schemastery 工厂（接受**可调用对象**，真实现就是那种） */
export function isSchemaFactory(value: unknown): value is SchemaFactory {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const candidate = value as Partial<SchemaFactory>;
  return (
    typeof candidate.any === 'function' &&
    typeof candidate.array === 'function' &&
    typeof candidate.object === 'function' &&
    typeof candidate.string === 'function' &&
    typeof candidate.number === 'function'
  );
}

/** 逐个锚点解析宿主工厂：首个成功即返回，失败留下原话（**不抛**） */
export function resolveSchemaFactory(
  anchors: readonly string[],
  specifier: string = HOST_SCHEMA_MODULE,
): SchemaResolution {
  const attempts: HostModuleAttempt[] = [];
  for (const anchor of anchors) {
    let loaded: unknown;
    try {
      loaded = createRequire(anchor)(specifier);
    } catch (error) {
      attempts.push({
        anchor,
        ok: false,
        detail: error instanceof Error ? ((error as { code?: string }).code ?? error.message) : String(error),
      });
      continue;
    }
    const candidate = memberOf(loaded, 'Schema') ?? (loaded as { default?: unknown }).default ?? loaded;
    if (!isSchemaFactory(candidate)) {
      attempts.push({ anchor, ok: false, detail: '解析到了模块但不是 schemastery 工厂（缺少 any/array/object/string/number）' });
      continue;
    }
    attempts.push({ anchor, ok: true, detail: 'schemastery 工厂' });
    return { factory: candidate, resolvedFrom: anchor, attempts };
  }
  return { factory: undefined, resolvedFrom: null, attempts };
}

/**
 * 按解析结果造一个 `Config`。
 *
 * - 解析失败 ⇒ `{ config: undefined, buildError: null }`（宿主按「无配置声明」处理，不会更坏）；
 * - 工厂在但构建抛 ⇒ `config: undefined` + **`buildError` 原话**（不静默）。
 */
export function buildConfigSchema(
  resolution: SchemaResolution,
  factoryOf: (z: SchemaFactory) => SchemaLike,
): { readonly config: SchemaLike | undefined; readonly buildError: string | null } {
  if (resolution.factory === undefined) return { config: undefined, buildError: null };
  try {
    return { config: factoryOf(resolution.factory), buildError: null };
  } catch (error) {
    return { config: undefined, buildError: error instanceof Error ? error.message : String(error) };
  }
}

/** 诊断袋（**不静默**）：锚点清单、解析结果、构建期错误 —— 测试与真机复验都靠它回答「为什么是 undefined」 */
export interface ConfigDiagnostics {
  readonly anchors: readonly string[];
  readonly resolution: SchemaResolution;
  readonly buildError: string | null;
}

/** 造诊断袋（与 `buildConfigSchema` 用同一份 anchors/resolution/built） */
export function createConfigDiagnostics(
  anchors: readonly string[],
  resolution: SchemaResolution,
  built: { readonly buildError: string | null },
): ConfigDiagnostics {
  return { anchors, resolution, buildError: built.buildError };
}
