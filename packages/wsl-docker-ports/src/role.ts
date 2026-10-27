/**
 * **角色判定**（015 `P2`）—— 同包同 `name`、两条行，`apply` 靠**行 id** 决定装哪一侧。
 *
 * ## 三条判据（优先级从高到低，逐条可离线断言）
 *
 * 1. **`config.role`**：显式写 `role: containers` / `role: ports`（可读性 + 测试用）。
 *    它**不是** `Config` 的字段（不进配置页、不进 volatile 面），只作覆盖开关。
 * 2. **行 id 后缀 `-containers`**：`ctx[Symbol.for('cordis.entry')]?.options?.id` 以
 *    `-containers` 结尾 ⇒ 容器侧。这是**生产路径上的唯一真判据**（patch 里的 `- id:` 就是它）。
 * 3. **缺省 `ports`**：判不出来就按转发侧装 —— 与 015 之前的行为**完全一致**（零差异是硬要求，
 *    不能让「没写 id 的老 profile」突然装不上转发侧）。
 *
 * ## 🔴 为什么不用 `entry.id`
 *
 * cordis 的 `entry.id` 是**带 `include:` 前缀的复合串**（`include:dsh-wsl-docker-ports` 之类），
 * 直接拿它判后缀会同时漏判/误判。可用的稳定形状只有 `entry.options.id`（= patch 里写的那一行）。
 * 故 `entryIdOf` 只认 `options.id`，其余一概当「判不出来」⇒ 走缺省 `ports`（安全方向）。
 *
 * ## 为什么单独一个文件
 *
 * `plugin.ts` 撞着 400 行 SHALL；且角色判定是**包级**概念（不属于转发侧也不属于容器侧），
 * 放 `src/role.ts` 后两侧都不必 import 对方。`src/containers/**` **不许** import 本文件
 * （容器侧不需要判角色，它自己就是容器侧）——由 `scripts/check-borders.mjs` 的 R1 钉住。
 */

import { readConfigStringField } from './shared/config-read.ts';

export type PluginRole = 'ports' | 'containers';

/** 转发侧行 id（= 包名 = 配置命名空间；015 之前唯一的那条行） */
export const PORTS_ROW_ID = 'dsh-wsl-docker-ports';

/** 容器侧行 id（配置命名空间；**与包名不同**，这正是本 Spec 要的） */
export const CONTAINERS_ROW_ID = 'dsh-wsl-docker-containers';

/** 行 id 的容器侧后缀（判据 2） */
export const CONTAINERS_ROW_SUFFIX = '-containers';

/** `config.role` 的字段名（只读、非 schema 字段；判据 1） */
export const ROLE_CONFIG_FIELD = 'role';

/** 判定来源（写进 handle / 日志用；**不是**给人看的文案） */
export type RoleSource = 'config' | 'row-id' | 'default';

export interface RoleDecision {
  readonly role: PluginRole;
  readonly source: RoleSource;
  /** 判出来的行 id（判不出 ⇒ 该侧的缺省 id）；供服务名/命名空间/提示文案使用 */
  readonly rowId: string;
}

/**
 * 从插件 ctx 上读**行 id**。
 *
 * 只认三种形状（依次）：`ctx[Symbol.for('cordis.entry')]?.options?.id`（真机形态）、
 * `ctx.entry?.options?.id`（等价属性写法）、`ctx.id`（极简测试替身）。都没有 ⇒ `undefined`。
 */
export function entryIdOf(ctx: unknown): string | undefined {
  if (typeof ctx !== 'object' || ctx === null) return undefined;
  const record = ctx as Record<PropertyKey, unknown>;
  const entry = record[Symbol.for('cordis.entry')] ?? record['entry'];
  if (typeof entry === 'object' && entry !== null) {
    const options = (entry as { options?: unknown }).options;
    if (typeof options === 'object' && options !== null) {
      const id = (options as { id?: unknown }).id;
      if (typeof id === 'string' && id.trim() !== '') return id.trim();
    }
  }
  const direct = record['id'];
  return typeof direct === 'string' && direct.trim() !== '' ? direct.trim() : undefined;
}

/** 归一化 `config.role`：只认两个字面量（大小写不敏感、允许空白），其余 ⇒ `undefined`（落判据 2/3） */
export function parseRoleValue(value: unknown): PluginRole | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ports') return 'ports';
  if (normalized === 'containers') return 'containers';
  return undefined;
}

/** 判角色（**纯函数**：不读 ctx 服务、不 IO；`entryId` 由调用方给或从 ctx 读） */
export function decideRole(input: { readonly configuredRole?: unknown; readonly entryId?: string | undefined }): RoleDecision {
  const explicit = parseRoleValue(input.configuredRole);
  if (explicit !== undefined) {
    return { role: explicit, source: 'config', rowId: explicit === 'containers' ? CONTAINERS_ROW_ID : PORTS_ROW_ID };
  }
  const entryId = input.entryId?.trim();
  if (entryId !== undefined && entryId.endsWith(CONTAINERS_ROW_SUFFIX)) {
    return { role: 'containers', source: 'row-id', rowId: entryId };
  }
  return { role: 'ports', source: entryId === undefined || entryId === '' ? 'default' : 'row-id', rowId: entryId === undefined || entryId === '' ? PORTS_ROW_ID : entryId };
}

/** 便利：从 `apply(ctx, config)` 的两个实参直接判（`config.role` 走活体读取面，现读） */
export function resolvePluginRole(ctx: unknown, config?: unknown): RoleDecision {
  return decideRole({ configuredRole: readConfigStringField(config, ROLE_CONFIG_FIELD), entryId: entryIdOf(ctx) });
}
