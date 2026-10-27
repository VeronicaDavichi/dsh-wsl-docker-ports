/**
 * 转发包的**静态 `Config` 声明**（Schemastery）—— 字段 7 个，命名空间 = 本包的行 id。
 *
 * ## 016 拆分后的分工（口径与坑的完整留痕见 `dsh-wsl-docker-core` 的 `schema.ts`）
 *
 * | 谁 | 管什么 |
 * | --- | --- |
 * | `dsh-wsl-docker-core/schema.ts` | 怎么**造**：多锚点运行时解析宿主 schemastery、`volatile`/`role` 门、诊断袋 |
 * | 本文件 | **本包的字段有哪些**、顺序、`Config` 与 `CONFIG_DIAGNOSTICS` 的导出 |
 *
 * ## 两道门（缺一不可；2026-10-12 真机两次订正，留痕不删）
 *
 * ① 导出 `Config`：`dsh-settings` 的 `schema(entry)` = `entry.fiber?.runtime?.Config`；
 * ② **只有它不够**：`describe()` 还要 `volatileForm(schema) !== undefined`，**零 volatile 的命名空间
 *    一样消失**（`volatileForm` 递归找 `meta.volatile`，`type === 'object'` 本身不算）。
 * ③ `write()` 对非 volatile 路径直接抛 `Config field "…" is not volatile`
 *    ⇒ 客户端经 `remote.settings.update` 写的字段**必须**标 volatile。
 *
 * 拆包前后**七个字段一字未改**、`createPortsSchema` 的构造顺序一字未改 ⇒ 宿主看到的 schema 逐字段相同。
 *
 * ## 字段（转发侧 7 个；容器侧 4 个，见 `dsh-wsl-docker-containers/src/config.ts`）
 *
 * | 字段 | 写方 | 读方 | schema |
 * | --- | --- | --- | --- |
 * | `managedPorts` | 客户端配置页（`client/settings-pipe.ts`） | 客户端（声明 → `/write/plan` 的 `declaration`） | `array(string).volatile()`，缺省 `[]` |
 * | `scopes` | 客户端（逐端口） | 客户端 | `dict(string).volatile()`，缺省 `{}` |
 * | `listenAddresses` | 客户端（逐端口选监听地址时**即时**写入） | **宿主**（`config-read.ts` 现读 → 快照判决 + 写计划） | `dict(string).volatile()`，缺省 `{}` |
 * | `distro` | 客户端 | **宿主**（`PortsPluginConfigLike.distro`，经 `config-read.ts` 现读） | `string.volatile()` |
 * | `elevationPolicy` | 客户端 | **宿主**（`apply` 的策略解析，经 `config-read.ts` 现读） | `string.volatile()` |
 * | `writeToken` | 客户端（生成凭据时） | **宿主**（`transport/write-auth.ts` 的 401 门） | `string.role('secret').volatile()` |
 * | `refreshIntervalSec` | 客户端右栏页（自动刷新频次，选择即写） | 客户端 | `number.volatile()`，缺省 `0` = 关闭 |
 *
 * ⚠️ `elevationPolicy` **刻意**只声明 `string`、不写枚举：003 的既定口径是「缺省/认不出 ⇒ `unknown`
 * ⇒ 落 `none`」（fail-safe 在语义层）。把枚举写进 schema 会让旧文档里的未知值变成**校验错误**。
 */

import {
  buildConfigSchema,
  createConfigDiagnostics,
  hostModuleAnchors,
  resolveSchemaFactory,
} from 'dsh-wsl-docker-core';
import type { SchemaFactory, SchemaLike } from 'dsh-wsl-docker-core';

/** `Config` 声明的字段名（顺序 = 配置文档里的呈现顺序；测试按它做白名单断言） */
export const PORTS_CONFIG_FIELDS = [
  'managedPorts',
  'scopes',
  'listenAddresses',
  'distro',
  'elevationPolicy',
  'writeToken',
  // 014：自动刷新频次（秒，`0` = 关闭）。选择器在右栏页顶部；服务端不消费它。
  'refreshIntervalSec',
] as const;

export type PortsConfigField = (typeof PORTS_CONFIG_FIELDS)[number];

/**
 * 造 `Config`：字段与 `PORTS_CONFIG_FIELDS` **同源**（少一个/多一个都会被测试抓到）。
 *
 * 🔴 **七个字段全部 `.volatile()`**，`writeToken` 另加 `.role('secret')` —— 依据逐条见文件头：
 * 少了 volatile 则命名空间不出现（`volatileForm` 门）、`update` 抛 `is not volatile`、
 * `describe().value` 里读不到；少了 `role('secret')` 则凭据明文进 `value`。
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
    // 014：自动刷新频次（秒，`0` = 关闭）。数值字段（不是字符串）：五档 0/15/30/60/300。
    refreshIntervalSec: z.number().volatile(),
  });
}

const ANCHORS = hostModuleAnchors();

const RESOLUTION = resolveSchemaFactory(ANCHORS);

const BUILT = buildConfigSchema(RESOLUTION, createPortsSchema);

/**
 * 诊断（**不静默**）：锚点清单、每个锚点的成败与原因、以及构建期错误。
 * 测试与真机复验都靠它回答「`Config` 到底是不是 `undefined`、为什么」。
 */
export const CONFIG_DIAGNOSTICS = createConfigDiagnostics(ANCHORS, RESOLUTION, BUILT);

/**
 * 宿主读的那一份 `Config`。
 *
 * - 解析成功 ⇒ 真 schemastery 工厂造出的真 schema（字段见文件头表格）；
 * - 解析失败 ⇒ `undefined`：宿主按「无配置声明」处理（**不会更坏**），且 `CONFIG_DIAGNOSTICS` 有原话。
 */
export const Config: SchemaLike | undefined = BUILT.config;
