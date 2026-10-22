/**
 * 包级**静态 `Config` 声明**（Schemastery）—— 009 缺陷 1 的修复（2026-10-12 真机）
 *
 * ## 为什么现在必须有（旧口径已作废，留痕不删）
 *
 * 旧口径（原 `plugin.ts` 的 2026-10-09 块）：本包 P0 的四个配置项走客户端 `remote.settings` 写回、
 * 宿主进程不持有活体副本 ⇒ 推断「没有 volatile 需求 ⇒ 不需要 `Config`」，并把结论挂到
 * 「真机 T0.5 确认 settings 命名空间是否需要宿主侧 schema」这一步上。
 *
 * 🔴 **2026-10-12 真机给出答案：需要。** `POST /api/settings/describe` 返回的 19 个命名空间里
 * **有** `dsh-terminal-profiles`、**没有** `dsh-wsl-docker-ports`。⇒ 客户端的 `readConfig()`
 * 一路读默认值（`managedPorts` 恒空）⇒ 所有权声明 `declaration` 恒为 `[]` ⇒ 服务端把所有端口
 * 判成 `port-not-managed` ⇒ 计划永不 `ready`、零步骤（V6 的「逐条 `commandText` 比对」因此
 * 不可能做、V7 因此被卡住）。
 *
 * ## 两道门（缺一不可）——`896fa42` 的「只导出 `Config`」**已被真机证伪**，留痕不删
 *
 * ① **导出 `Config`** 是必要条件：`dsh-settings` 的 `schema(entry)` = `entry.fiber?.runtime?.Config`
 *    ⇒ 不导出就取不到 schema（`896fa42` 只修了这一半，真机 `describe` 仍无本命名空间 ⇒ 被证伪）。
 * ② 🔴 **但不充分**：`describe()` 紧接着要 `volatileForm(schema) !== undefined`，**零 volatile 的
 *    `Config` 会让整个命名空间消失**（`dsh-settings/lib/index.js` 的 `describe()` 里
 *    `const form = volatileForm(schema); if (form === void 0) return [];`；`volatileForm` 递归找
 *    `meta.volatile`，**`type === 'object'` 本身不算**）。⇒ 009 Task A 把真机那 19 个命名空间
 *    **逐个**回盘核对：19/19 都有 ≥1 个 volatile 字段，而本包（`Config` 在、0 volatile）正是
 *    天然反例（判据见 `tests/unit/config-gate.test.ts`）。
 * ③ `write()` 还有同向的第二道判据：patch 落到非 volatile 路径直接抛
 *    `Config field "…" is not volatile`（`validatePaths`）⇒ **凡客户端要经 `remote.settings.update`
 *    写的字段都必须标 volatile**（本包五个字段都是客户端写的，故五个全标）。
 *
 * ## 标了 volatile 之后：**读侧必须统一解包**（第二层陷阱）
 *
 * B-1 早已定案：volatile 字段解析出来是**带 `.get()` 的深冻结活体包装**，直接属性读会拿到包装对象
 * 本身 ⇒ 提权档落 `none`（永远写不动）、凭据恒 401。⇒ 正确处置是 `./config-read.ts` 的**统一解包**
 * （活体与平凡两类形态同一套读法、**每次现读**：volatile 写入是原地更新，现读才拿得到新值），
 * 而**不是**把字段退回平凡 —— 退了命名空间根本不出现、`update` 直接抛。
 *
 * 2026-10-09 集成方裁定「**不许用『先加个依赖试试』解决**」继续有效并被遵守（见下「零新增依赖」）。
 *
 * ## 标 volatile 的字段集：**五个全标**（依据是宿主源码，不是口味）
 *
 * 1. 少了就**没有命名空间**（`volatileForm` 门，见上 ②）；
 * 2. 少了**写不进去**：`write()` 的 `validatePaths` 对非 volatile 路径直接抛
 *    `Config field "…" is not volatile` —— 而客户端 `settings-pipe.ts` 的六个写方法
 *    （`managedPorts` / `scopes` / `listenAddresses` / `distro` / `elevationPolicy` / `writeToken`）正是这六个字段；
 * 3. 少了**读不回来**：`describe()` 的 `value`/`base`/`user` 都是
 *    `projectForm(form, plainConfig(entry.fiber.config))`，而 `form` = **volatile 子树**
 *    ⇒ 非 volatile 字段在返回值里**根本不存在**，客户端 `readConfig()` 会把它读成「未配置」
 *    （`writeTokenConfigured` 恒 false ⇒ 「服务端已配置」永远显示不出来）。
 * 4. 标了之后**不再重挂载**（`equal()` 首行 `if (schema?.meta?.volatile) return true` ⇒
 *    volatile-only 走 `_commitVolatile()`），对 008 的票据/审计环是**净收益**；
 *    代价是「值不能拍一次」，由 `./config-read.ts` 的现读口径兜住（五个字段全部经它读）。
 *
 * ## 字段（以代码为准；客户端与宿主两侧共用一个命名空间）
 *
 * | 字段 | 写方 | 读方 | schema |
 * | --- | --- | --- | --- |
 * | `managedPorts` | 客户端配置页（`settings-pipe.ts`） | 客户端（声明 → `/write/plan` 的 `declaration`） | `array(string).volatile()`，缺省 `[]` |
 * | `scopes` | 客户端（逐端口） | 客户端 | `dict(string).volatile()`，缺省 `{}` |
 * | `listenAddresses` | 客户端（逐端口选监听地址时**即时**写入） | **宿主**（`config-read.ts` 现读 → 快照判决 + 写计划） | `dict(string).volatile()`，缺省 `{}`（012） |
 * | `distro` | 客户端 | **宿主**（`PortsPluginConfigLike.distro`，经 `config-read.ts` 现读） | `string.volatile()` |
 * | `elevationPolicy` | 客户端 | **宿主**（`apply` 的策略解析，经 `config-read.ts` 现读） | `string.volatile()` |
 * | `writeToken` | 客户端（生成凭据时） | **宿主**（`transport/write-auth.ts` 的 401 门） | `string.role('secret').volatile()` |
 *
 * ⚠️ `elevationPolicy` **刻意**只声明 `string`、不写枚举：003 的既定口径是「缺省/认不出 ⇒ `unknown`
 * ⇒ 落 `none`」（fail-safe 在语义层），真机观察到的 `policy:'unknown'` 就是这条路径。把枚举写进
 * schema 会让**旧文档里的未知值在加载期报错**，比语义层降级更坏。
 *
 * ⚠️ `writeToken` 的 `role('secret')` 是**宿主源码判据**（不再是未验项）：`dsh-api-settings-controller`
 * 的 `describe()` 一律 `settings.describe({ redactSecrets: true })`，其 JSDoc 逐字写着
 * 「Every remote read uses `redactSecrets: true`, so a `role('secret')` field cannot ride a response」；
 * `dsh-settings` 的 `redactSecrets()`（结构化脱敏）把该字段从 `value` 里摘掉、只在
 * `secrets: [{ path, set }]` 里留 `{ path: ['writeToken'], set: boolean }`；客户端拿它算
 * 「服务端是否已配置」的布尔（**绝不回显值**，009 REQ-1.3）。生产同族实证：
 * `dsh-web-search-deepseek` 的 `apiKey: z.string().role("secret").volatile()` 且该命名空间在真机
 * `describe` 里正常出现 ⇒ 「secret + volatile 同字段」是被生产验证过的组合。
 * 🔴 **不标 `role('secret')` 的后果是真实的泄露**：volatile 字段会进 `describe().value` ⇒
 * 凭据明文经 `namespaceView()` 发给浏览器（含宿主自带设置页）。
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
import { isAbsolute, join, dirname } from 'node:path';

/** profile 目录枚举上限（有界：只取排序后的前 N 个，防止畸形 HOME 把候选炸开） */
export const PROFILE_ANCHOR_MAX = 24;

/** schemastery 的宿主包名（与同族插件、与 002 的 `HOST_SCHEMA_MODULE` 逐字一致） */
export const HOST_SCHEMA_MODULE = '@deepseek-ai/schemastery';

/** `Config` 声明的字段名（顺序 = 配置文档里的呈现顺序；测试按它做白名单断言） */
export const PORTS_CONFIG_FIELDS = ['managedPorts', 'scopes', 'listenAddresses', 'distro', 'elevationPolicy', 'writeToken'] as const;

export type PortsConfigField = (typeof PORTS_CONFIG_FIELDS)[number];

/** 本包用到的最小 schema 面（`SchemaLike` 与 002 同形：只要求 `volatile()` / `role()` 存在） */
export interface SchemaLike {
  volatile(): SchemaLike;
  /** `.role('secret')`：宿主据此把字段从 `describe().value` 摘掉、只留 `secrets[{path,set}]` */
  role(role: string): SchemaLike;
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

/**
 * 造 `Config`：字段与 `PORTS_CONFIG_FIELDS` **同源**（少一个/多一个都会被测试抓到）。
 *
 * 🔴 **六个字段全部 `.volatile()`**，`writeToken` 另加 `.role('secret')` —— 依据逐条见文件头
 * 「标 volatile 的字段集」：少了 volatile 则命名空间不出现（`volatileForm` 门）、`update` 抛
 * `is not volatile`、`describe().value` 里读不到；少了 `role('secret')` 则凭据明文进 `value`。
 * 顺序与生产同族一致（`z.string().role("secret").volatile()`，见 `dsh-web-search-deepseek`）。
 */
export function createPortsSchema(z: SchemaFactory): SchemaLike {
  const dict = typeof z.dict === 'function' ? z.dict.bind(z) : undefined;
  return z.object({
    managedPorts: z.array(z.string()).volatile(),
    scopes: (dict === undefined ? z.any() : dict(z.string())).volatile(),
    // 012：逐端口的监听地址（键 = 端口号的字符串形式，值 = IPv4 字面量）。
    // 与 `scopes` 同形（dict + volatile）：客户端选择**即时写入**，服务端**现读**后传给判决与计划。
    listenAddresses: (dict === undefined ? z.any() : dict(z.string())).volatile(),
    distro: z.string().volatile(),
    elevationPolicy: z.string().volatile(),
    writeToken: z.string().role('secret').volatile(),
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
  // ⑥ 宿主 CLI 包**自带的嵌套依赖树**（2026-10-15 新增；本机 = 全局 npm 安装形态）
  //    本机实测：`D:\nodejs\node_modules\@deepseek-ai\` 下只有 `dsh` 与 `dsh-acp-app`，**没有平铺的**
  //    `schemastery`；宿主把自己的依赖**嵌套在包里** ——
  //    `D:\nodejs\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\schemastery\lib\index.cjs`（3.18.4，真工厂）
  //    ⇒ ①–⑤ 九个锚点在这一形态下**全部** `MODULE_NOT_FOUND`（`node_modules` 沿树向上的每一层都没有它），
  //    于是 `Config === undefined`：`check:exports` 的「Config 在场」与 `config-gate` / `config`
  //    的宿主判据会**判红**（2026-10-15 实测 5 条红 + 1 条导出门红，全部同一根因）。
  //    写法与 `tests/helpers/host-gate.ts` 的 `HOST_SETTINGS_RELATIVE`（同一台机器、同一个宿主形态，
  //    已用它切出宿主真函数）**同源**：在「可执行文件所在目录」下拼出宿主包的嵌套落点当解析基准。
  //    `createRequire` 只把该路径当**起点**、不校验它存在 ⇒ 未装宿主/别的安装形态时这一族自然解析失败
  //    并被跳过（不产生额外诊断噪声）；且它**追加在末尾** ⇒ 既有环境的命中顺序与语义一字不动。
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
