/**
 * 包级**静态 `Config` 声明**（Schemastery）—— 009 缺陷 1 的修复（2026-10-12 真机）
 *
 * ## 为什么现在必须有（旧口径已作废，留痕不删）
 *
 * 旧口径（原 `plugin.ts` 的 2026-10-09 块）：本包 P0 的四个配置项走客户端 `remote.settings` 写回、
 * 宿主进程不持有活体副本 ⇒ 推断「没有 volatile 需求 ⇒ 不需要 `Config`」，并把结论挂到
 * 「真机 T0.5 确认 settings 命名空间是否需要宿主侧 schema」这一步上。
 *
 * 🔴 **2026-10-12 真机给出答案：需要。** `POST /api/settings/describe` 返回的 20 个命名空间里
 * **有** `dsh-terminal-profiles`、**没有** `dsh-wsl-docker-ports`。⇒ 客户端的 `readConfig()`
 * 一路读默认值（`managedPorts` 恒空）⇒ 所有权声明 `declaration` 恒为 `[]` ⇒ 服务端把所有端口
 * 判成 `port-not-managed` ⇒ 计划永不 `ready`、零步骤（V6 的「逐条 `commandText` 比对」因此
 * 不可能做、V7 因此被卡住）。⇒ **命名空间的存在性由「模块是否导出 `Config`」决定，与 volatile 无关**；
 * 「不需要 volatile」推不出「不需要 `Config`」——这是本包的原始推理错误。
 *
 * 2026-10-09 集成方裁定「**不许用『先加个依赖试试』解决**」继续有效并被遵守（见下「零新增依赖」）。
 *
 * ## 为什么不标 `.volatile()`
 *
 * 002 的 B-1 结论：`.volatile()` 字段解析出来是**带 `.get()` 的深冻结活体对象**，直接把属性当值读
 * 会得到 `undefined`。而本包的宿主面是**直接属性读**（`plugin.ts` 的 `config?.elevationPolicy` /
 * `config?.writeToken` / `config?.distro`）⇒ 标 volatile 会让提权档读成 `undefined` ⇒ 落 fail-safe
 * `none`（永远写不动），凭据也永远 401 —— **正确性倒退**。003 REQ-12.4 也只要求「保存前先确认
 * （编辑可能触发重挂载）」，未要求 volatile。
 *
 * ## 字段（以代码为准；客户端与宿主两侧共用一个命名空间）
 *
 * | 字段 | 写方 | 读方 | schema |
 * | --- | --- | --- | --- |
 * | `managedPorts` | 客户端配置页（`settings-pipe.ts`） | 客户端（声明 → `/write/plan` 的 `declaration`） | `array(string)`，缺省 `[]` |
 * | `scopes` | 客户端（逐端口） | 客户端 | `dict(string)`，缺省 `{}` |
 * | `distro` | 客户端 | **宿主**（`PortsPluginConfigLike.distro`） | `string` |
 * | `elevationPolicy` | 客户端 | **宿主**（`apply` 的策略解析） | `string` |
 * | `writeToken` | 客户端（生成凭据时） | **宿主**（`transport/write-auth.ts` 的 401 门） | `string` |
 *
 * ⚠️ `elevationPolicy` **刻意**只声明 `string`、不写枚举：003 的既定口径是「缺省/认不出 ⇒ `unknown`
 * ⇒ 落 `none`」（fail-safe 在语义层），真机观察到的 `policy:'unknown'` 就是这条路径。把枚举写进
 * schema 会让**旧文档里的未知值在加载期报错**，比语义层降级更坏。
 *
 * ⚠️ `writeToken` 的**宿主侧回显**是未验项：真机 `describe` 的每个命名空间带
 * `secrets: [{ path, set }]`，schemastery 也有 `.role('secret')`（本机 probe 实测存在），但
 * 「宿主是否按 `role` 生成 `secrets[]`」离线判不了 ⇒ 本轮**不加 role**（不加 = 不改语义；
 * 本包自己的页面只读布尔、不回显值）。真机复验时一并看 `secrets[]` 是否含 `writeToken`。
 *
 * ## 零新增依赖：**多锚点**运行时解析（不是静态 import）
 *
 * 同族范式的静态 `import z from '@deepseek-ai/schemastery'` 要求该包在依赖里（002 就是这么写的：
 * devDependencies 本机解析 + peerDependencies 宿主契约）。本包**不许改 `package.json`** ⇒ 走 002
 * `service-export/host-modules.ts` 的运行时解析同族，但**锚点必须多于一个**，理由是本机实测的差异：
 *
 * - `createRequire(packages/terminal-profiles/lib/index.js)` → ✅ 解析到（该包自己的 `node_modules`
 *   里有 `@deepseek-ai/schemastery` 真符号链接）；
 * - `createRequire(packages/wsl-docker-ports/lib/index.js)` → ❌ `MODULE_NOT_FOUND`（本包没有该
 *   依赖，`node_modules` 里只有 `dsh-wsl-shared`/`react`/…）。⇒ **只照抄 007 的单锚点等于没修**。
 *
 * 本机继续只读实测（2026-10-12），真正能解析到的是 **profile 层**：
 * `~/.dsh/profiles/desktop/package.json` 把 `@deepseek-ai/schemastery: ^3.18.4` 列为**直接依赖**
 * （`pnpm-workspace.yaml` 是 `nodeLinker: hoisted` ⇒ 真目录，`realpath` = 自身，不是悬空链接），
 * `createRequire('~/.dsh/profiles/desktop/index.js')` → ✅ 成功；而
 * `~/.dsh/profiles/index.js` / `~/.dsh/index.js`（那两层的 `@deepseek-ai/*` 是指向**已删临时运行时**
 * 的悬空 junction）→ ❌ `MODULE_NOT_FOUND`。插件装在**哪一个** profile 里，加载期不知道
 * （宿主按 realpath 解析 ⇒ `import.meta.url` 只剩工作区路径）⇒ 只能**有界列举** `~/.dsh/profiles`
 * 的一级子目录当候选锚点（一次 `readdir` 拿目录名，**不读任何文件内容**，失败即当没有）。
 *
 * 锚点按「宿主可能长在哪里」排序，逐个 `createRequire` 试，**首个成功即用**；全部失败 ⇒
 * `Config === undefined`（与旧行为一致、失败可见），**绝不造假 schema**（002 已记：假 schema 会让
 * `.volatile()` 静默失效；本包还多一条 —— 宿主会拿它校验/序列化配置文档）。
 * 每个锚点的成败都留在 `CONFIG_DIAGNOSTICS` 里，**不静默**。
 */

import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** profile 目录枚举上限（有界：只取排序后的前 N 个，防止畸形 HOME 把候选炸开） */
export const PROFILE_ANCHOR_MAX = 24;

/** schemastery 的宿主包名（与同族插件、与 002 的 `HOST_SCHEMA_MODULE` 逐字一致） */
export const HOST_SCHEMA_MODULE = '@deepseek-ai/schemastery';

/** `Config` 声明的字段名（顺序 = 配置文档里的呈现顺序；测试按它做白名单断言） */
export const PORTS_CONFIG_FIELDS = ['managedPorts', 'scopes', 'distro', 'elevationPolicy', 'writeToken'] as const;

export type PortsConfigField = (typeof PORTS_CONFIG_FIELDS)[number];

/** 本包用到的最小 schema 面（`SchemaLike` 与 002 同形：只要求 `volatile()` 存在） */
export interface SchemaLike {
  volatile(): SchemaLike;
}

/**
 * 本包实际用到的工厂成员。
 *
 * ⚠️ 与 002 的 gate 有一个刻意的差异：002 只认 `any`/`array`/`object`，本包**还要用 `string`**
 * （四个字段里三个是字符串），故 gate 多一个成员 —— 否则「gate 通过但构建时 `z.string` 不存在」
 * 会抛在模块装载期，把插件连 `apply` 一起打死（比 `Config === undefined` 坏得多）。
 */
export interface SchemaFactory {
  any(): SchemaLike;
  array(item: SchemaLike): SchemaLike;
  object(shape: Record<string, SchemaLike>): SchemaLike;
  string(): SchemaLike;
  /** `scopes` 用；缺失时降级为 `any()`（见 `createPortsSchema`），不因此拒绝整个工厂 */
  dict?(item: SchemaLike): SchemaLike;
}

/** 造 `Config`：字段与 `PORTS_CONFIG_FIELDS` **同源**（少一个/多一个都会被测试抓到） */
export function createPortsSchema(z: SchemaFactory): SchemaLike {
  const dict = typeof z.dict === 'function' ? z.dict.bind(z) : undefined;
  return z.object({
    managedPorts: z.array(z.string()),
    scopes: dict === undefined ? z.any() : dict(z.string()),
    distro: z.string(),
    elevationPolicy: z.string(),
    writeToken: z.string(),
  });
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
  // ① 本模块自身（002 同款锚点；本包实测 MODULE_NOT_FOUND，留作第一候选只为「同族一致」）
  add(import.meta.url);
  // ② 宿主进程入口 / node 可执行文件（Electron 打包应用与托管运行时都在这一族里）
  add(process.argv[1]);
  add(process.execPath);
  // ③ Electron 宿主：`resources/app.asar/node_modules/**` 是宿主自带的依赖树
  //    （本机实测：app.asar 里确有 `node_modules/@deepseek-ai/schemastery` 3.18.4）
  const resources = (process as { resourcesPath?: unknown }).resourcesPath;
  if (typeof resources === 'string') add(join(resources, 'app.asar', 'index.js'));
  // ④ profile 层（本机实测**唯一真能解析到**的一族，见文件头）
  let home = '';
  try {
    home = homedir();
  } catch {
    // 🔴 本仓已记的坑：`USERPROFILE=''` 时 `os.homedir()` **自己会抛** `ERR_SYSTEM_ERROR`
    // ⇒ 这里必须吞掉（少几个锚点，不是加载期错误）。
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

/** 结构面判定：够不够当本包要用的 schemastery 工厂（接受**可调用对象**，真实现就是那种） */
export function isSchemaFactory(value: unknown): value is SchemaFactory {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const candidate = value as Partial<SchemaFactory>;
  return (
    typeof candidate.any === 'function' &&
    typeof candidate.array === 'function' &&
    typeof candidate.object === 'function' &&
    typeof candidate.string === 'function'
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
      attempts.push({ anchor, ok: false, detail: error instanceof Error ? (error as { code?: string }).code ?? error.message : String(error) });
      continue;
    }
    const candidate = memberOf(loaded, 'Schema') ?? (loaded as { default?: unknown }).default ?? loaded;
    if (!isSchemaFactory(candidate)) {
      attempts.push({ anchor, ok: false, detail: '解析到了模块但不是 schemastery 工厂（缺少 any/array/object/string）' });
      continue;
    }
    attempts.push({ anchor, ok: true, detail: 'schemastery 工厂' });
    return { factory: candidate, resolvedFrom: anchor, attempts };
  }
  return { factory: undefined, resolvedFrom: null, attempts };
}

const ANCHORS = hostModuleAnchors();

const RESOLUTION = resolveSchemaFactory(ANCHORS);

function build(resolution: SchemaResolution): { readonly config: SchemaLike | undefined; readonly buildError: string | null } {
  if (resolution.factory === undefined) return { config: undefined, buildError: null };
  try {
    return { config: createPortsSchema(resolution.factory), buildError: null };
  } catch (error) {
    return { config: undefined, buildError: error instanceof Error ? error.message : String(error) };
  }
}

const BUILT = build(RESOLUTION);

/**
 * 诊断（**不静默**）：锚点清单、每个锚点的成败与原因、以及构建期错误。
 * 测试与真机复验都靠它回答「`Config` 到底是不是 `undefined`、为什么」。
 */
export const CONFIG_DIAGNOSTICS: {
  readonly anchors: readonly string[];
  readonly resolution: SchemaResolution;
  readonly buildError: string | null;
} = { anchors: ANCHORS, resolution: RESOLUTION, buildError: BUILT.buildError };

/**
 * 宿主读的那一份 `Config`。
 *
 * - 解析成功 ⇒ 真 schemastery 工厂造出的真 schema（字段见文件头表格）；
 * - 解析失败 ⇒ `undefined`：宿主按「无配置声明」处理（= 修复前的行为，**不会更坏**），
 *   且 `CONFIG_DIAGNOSTICS` 里有全部失败原话。
 */
export const Config: SchemaLike | undefined = BUILT.config;
