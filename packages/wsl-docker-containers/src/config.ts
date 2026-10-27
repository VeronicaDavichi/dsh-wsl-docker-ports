/**
 * 容器包的**静态 `Config` 声明**（Schemastery）—— 字段 3 个，命名空间 = `dsh-wsl-docker-containers`。
 *
 * ## 016 拆分后的分工（工厂与全部踩坑留痕见 `dsh-wsl-docker-core` 的 `schema.ts`）
 *
 * | 谁 | 管什么 |
 * | --- | --- |
 * | `dsh-wsl-docker-core/schema.ts` | 怎么**造**：多锚点运行时解析宿主 schemastery、`volatile`/`role` 门、诊断袋 |
 * | 本文件 | **本包的字段有哪些**、顺序、`Config` 与 `CONFIG_DIAGNOSTICS` 的导出 |
 *
 * ## 为什么只有 3 个字段（owner 决策 ① 的落地）
 *
 * 容器侧只消费自己真正读的字段；`managedPorts` / `scopes` / `listenAddresses` / `elevationPolicy`
 * **一个都不声明** —— 声明了就等于让容器行拥有转发侧的决策面（读了就是替转发侧做主）。
 *
 * | 字段 | 写方 | 读方 | schema |
 * | --- | --- | --- | --- |
 * | `distro` | 客户端配置页 | **宿主**（`containers/credential.ts` 现读 → 目标发行版解析） | `string.volatile()` |
 * | `writeToken` | 客户端配置页（「生成并保存容器通道凭据」） | **宿主**（容器侧 401 门） | `string.role('secret').volatile()` |
 * | `refreshIntervalSec` | 客户端右栏页（自动刷新频次，选择即写） | 客户端 | `number.volatile()`，缺省 `0` = 关闭 |
 *
 * 🔴 **凭据是容器侧自己的**：命名空间不同 ⇒ 转发侧 `dsh-wsl-docker-ports` 的 `writeToken`
 * 打容器通道是 401（016 的隔离判据之一）。
 *
 * ## 两道门（缺一不可）
 *
 * ① 导出 `Config`：`dsh-settings` 的 `schema(entry)` = `entry.fiber?.runtime?.Config`；
 * ② **只有它不够**：`describe()` 还要 `volatileForm(schema) !== undefined` ⇒ 三个字段全标 volatile。
 */

import {
  buildConfigSchema,
  createConfigDiagnostics,
  hostModuleAnchors,
  resolveSchemaFactory,
} from 'dsh-wsl-docker-core';
import type { SchemaFactory, SchemaLike } from 'dsh-wsl-docker-core';

/** `Config` 声明的字段名（顺序 = 配置文档里的呈现顺序；测试按它做白名单断言） */
export const CONTAINERS_CONFIG_FIELDS = ['distro', 'writeToken', 'refreshIntervalSec'] as const;

export type ContainersConfigField = (typeof CONTAINERS_CONFIG_FIELDS)[number];

/**
 * 造 `Config`：字段与 `CONTAINERS_CONFIG_FIELDS` **同源**（少一个/多一个都会被测试抓到）。
 *
 * 三个字段全部 `.volatile()`，`writeToken` 另加 `.role('secret')`（少了它凭据明文进
 * `describe().value`，宿主自带的设置页会显示出来）。
 */
export function createContainersSchema(z: SchemaFactory): SchemaLike {
  return z.object({
    distro: z.string().volatile(),
    writeToken: z.string().role('secret').volatile(),
    // 自动刷新频次（秒，`0` = 关闭）。数值字段（不是字符串）：五档 0/15/30/60/300。
    refreshIntervalSec: z.number().volatile(),
  });
}

const ANCHORS = hostModuleAnchors();

const RESOLUTION = resolveSchemaFactory(ANCHORS);

const BUILT = buildConfigSchema(RESOLUTION, createContainersSchema);

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
