/**
 * 配置页的**写入管道**（002 T6.1 / T6.2 / T6.3；contract §D12/§D13）
 *
 * ## 唯一管道
 *
 * 客户端**没有** `ctx.settings` / `ctx.configEditor`；写配置只走宿主服务 `ctx.get('remote.settings')`
 * 的 `describe()` + `update(ns, patch, expectedRevision)`（零新路由、零鉴权面）。本文件**没有**任何 YAML
 * 字符串拼接 —— patch 是结构化对象、落盘由宿主负责（REQ-10.2：本包 SHALL NOT 自行读写/拼接/重写 YAML）。
 *
 * ## 三个可断言的理由（都是二值判据，别当风格）
 *
 * 1. **不重挂载**：绝不碰 `ctx.configEditor.edit()`（那是**完整配置**路径，官方原文
 *    `ordinary fields retain Loader's normal lifecycle` ⇒ 会重挂载、杀光正在跑的终端）。
 * 2. **零提权/零路由**：本模块不 import `./TerminalPane` / 不 fetch / 不碰 `node:*`。
 * 3. **失败是结果不是抛**：`update` 的失败、只读、revision 冲突全部变成**判别联合**（REQ-10.3/10.4）。
 *
 * ## 形状未验证 ⇒ 处处多重候选读取
 *
 * `describe()` 除 `{ namespaces: [{ ns, value }] }` 之外的形状**没有实物证据** ⇒ revision / 可写性 /
 * 路径 / 唯一寻址标记全部**按候选名逐个试**，一处都没有就**明说「宿主未提供」**，绝不伪造。
 * 真机载荷 = `{writable:true, hasDocument:true, namespaces:[…21 条…]}`：21/21 条**不带**可写性字段、
 * **无路径**，而写入**确实被拒** ⇒ 显式信号在真机上**取不到**。
 *
 * ## 🔴 只读态的两条路都住在 `./config-readonly.ts`（2026-10-12 自动触发轮拆出）
 *
 * 本文件只负责「读状态 → 写回 → 结果映射」；**只读判定与呈现**（零写入推断、拒绝原文判据、
 * 路径如实降级）整体搬去 `./config-readonly.ts`，本文件用 `readOnlyFromPayload(entry, outer)`
 * 一处调用取回结论；载荷读取原语（`asRecord` / `firstString` / `firstBoolean` / `describeError`）
 * 也住在那里，本文件 import 回去用 ⇒ **只有一份定义**，不复制第二份。
 * 拆分的直接理由：本文件拆前 **399/400 行**（SHALL ≤ 400）且它自己写着「下次改动必须先拆」。
 * ⚠️ **不是**靠删证据换行数 —— 真机载荷出处 / 反例清单 / 宿主行号**原文搬走**，此处只留指针。
 */

import { parseRowStructure } from '../config/row-rules.ts';
import type { RawProfileRow } from '../config/row-rules.ts';
import {
  REASON_CANDIDATES,
  asRecord,
  describeError,
  firstBoolean,
  firstString,
  isReadOnlyRefusal,
  readOnlyFromPayload,
  readOnlyNoticeFrom,
} from './config-readonly.ts';
import type { ReadOnlyNotice } from './config-readonly.ts';

// 只读相关的公开面仍在**原路径**可导入（既有消费方与用例零改动）；定义已搬到 config-readonly.ts。
export { READONLY_PATH_UNKNOWN, describeError, isReadOnlyRefusal, readOnlyNoticeFrom } from './config-readonly.ts';
export type { ReadOnlyNotice } from './config-readonly.ts';

/** 命名空间 = patch **条目 id** = 包名（宿主按 `row.options.id === ns` 寻址，REQ-10.5） */
export const SETTINGS_NAMESPACE = 'dsh-terminal-profiles';

/** 配置页槽位名（contract §C10/§D12） */
export const CONFIG_SLOT_NAME = 'plugins.row.config';

/** keyed 槽的 key = `<包名>#<行 id>`（行 id 默认与包名逐字相同，见 `cordis.patch.yml`） */
export const CONFIG_ROW_KEY = `${SETTINGS_NAMESPACE}#${SETTINGS_NAMESPACE}`;

/** 本包 schema 的唯一字段（`Config = { profiles: Profile[] }`，见 `../config/schema.ts`） */
export const CONFIG_PATCH_FIELD = 'profiles';

/**
 * **volatile 字段表**（本包 schema 的静态事实：整个 `profiles` 数组标了 `.volatile()`）。
 * 不在表里的字段一律按 **ordinary** 处理 —— 那会让行重挂载、杀掉正在跑的终端，
 * 所以「不确定」必须往**保守**那边倒（弹确认），不能倒向「静默重挂载」。
 */
export const VOLATILE_FIELDS: readonly string[] = [CONFIG_PATCH_FIELD];

/** 一次写入涉及的字段存活判定（T6.2 的核心二值判据） */
export interface LivenessVerdict {
  /** true ⇒ 不弹确认、直接走 settings 路径（终端存活） */
  readonly volatileOnly: boolean;
  /** 非空 ⇒ 弹确认（REQ-2.2），确认前**不写盘** */
  readonly ordinaryFields: readonly string[];
}

/**
 * 判定「这次保存是否 volatile-only」。
 * 空字段集（没有变更）也算 volatile-only —— 它根本不会重挂载；**是否跳过写入由调用方决定**。
 */
export function classifyPatchFields(
  fields: readonly string[],
  volatileFields: readonly string[] = VOLATILE_FIELDS,
): LivenessVerdict {
  const ordinaryFields = [...new Set(fields)].filter((field) => !volatileFields.includes(field)).sort();
  return { volatileOnly: ordinaryFields.length === 0, ordinaryFields };
}

/** 字段存活判定口（宿主若要覆盖本包的静态事实，就从这里注入；默认 = 上面的静态表） */
export interface FieldLiveness {
  classify(fields: readonly string[]): LivenessVerdict;
}

/** 默认存活口：本包 schema 的静态事实（`profiles` 整数组 volatile） */
export const DEFAULT_LIVENESS: FieldLiveness = {
  classify: (fields) => classifyPatchFields(fields),
};

/** `remote.settings` 的返回（contract §D13 逐字：`{ ok, value, error }`） */
export interface SettingsResponse {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}

/** `ctx.get('remote.settings')`（contract §D13）：**配置写回的唯一管道** */
export interface RemoteSettingsLike {
  describe(): Promise<SettingsResponse>;
  update(ns: string, patch: unknown, expectedRevision?: unknown): Promise<SettingsResponse>;
}

/** 宿主对「本行是否满足唯一寻址」的说法（REQ-10.5；`undefined` = 宿主没说 ⇒ 不展示限制） */
export interface AddressabilityNotice {
  readonly reason: string;
}

/** 从 `describe()` 抽出的本命名空间状态 */
export interface NamespaceState {
  /**
   * 只读态（REQ-10.3）。两条来源都汇到这里（判定实现见 `./config-readonly.ts`）：
   * ① 读配置时**零写入推断**出「被上层 patch 覆盖」，或宿主显式说了不可写；
   * ② 写入被拒且拒绝原文属于只读那一类（页面侧粘性）。
   */
  readonly readOnly: ReadOnlyNotice | undefined;
  /** 唯一寻址不满足 ⇒ 展示限制（REQ-10.5） */
  readonly addressability: AddressabilityNotice | undefined;
  /** 当前配置里的原始行（`profiles` 不是数组时 = 空数组，交给页面按「空配置」渲染） */
  readonly rows: readonly unknown[];
  /** 并发写保护用的 revision（宿主没给 ⇒ `undefined` ⇒ 不带第三参） */
  readonly revision: unknown;
  /** 读回来的原始值是不是一个对象（诊断用） */
  readonly rawFound: boolean;
}

/** 读配置的结果（失败是结果，不是异常） */
export type ConfigReadOutcome =
  | { readonly kind: 'ok'; readonly state: NamespaceState }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/** 单行的问题（页面据此在对应行上标红；**不**清空用户输入） */
export interface RowProblem {
  readonly index: number;
  readonly message: string;
}

/** 保存的结果（REQ-10.3 / REQ-10.4 的所有分支） */
export type SaveOutcome =
  | {
      readonly kind: 'ok';
      readonly saved: number;
      /** 被排除在 patch 之外的无效行（其余行**照常写入**，REQ-1.2 的容错口径） */
      readonly skipped: readonly RowProblem[];
      readonly revisionPassed: boolean;
    }
  /**
   * 只读 ⇒ **未写入**。两条来源：① 读配置时零写入推断出被上层覆盖（或宿主显式说不可写）；
   * ② 写入**被拒**且拒绝原文属于「本行被上层 patch 覆盖」（缺陷 A 的真机路径）。
   * 页面收到后**粘性**进入只读态（不被后续读取解除）。
   */
  | { readonly kind: 'readonly'; readonly notice: ReadOnlyNotice; readonly skipped: readonly RowProblem[] }
  /** 校验失败（**全部**行都有问题 ⇒ 一个字节都不写，免得更坏地清空既有配置） */
  | { readonly kind: 'invalid'; readonly message: string; readonly skipped: readonly RowProblem[] }
  | { readonly kind: 'conflict'; readonly message: string; readonly skipped: readonly RowProblem[] }
  | { readonly kind: 'failed'; readonly message: string; readonly skipped: readonly RowProblem[] }
  | { readonly kind: 'unavailable'; readonly message: string };

/** 写回管道（页面只见这三个方法 ⇒ 「配置写」在类型层就是一条独木桥） */
export interface ConfigPipe {
  readConfig(): Promise<ConfigReadOutcome>;
  /** `rows` = 用户在表单里的当前值（**原始**，未归一化） */
  saveProfiles(rows: readonly unknown[], expectedRevision?: unknown): Promise<SaveOutcome>;
  /** `update` 的真实调用次数（判据：「只读时不写盘」= 0 次） */
  updateCount(): number;
}

export const REVISION_CANDIDATES: readonly string[] = ['revision', 'etag', 'version'];
export const ADDRESSABLE_CANDIDATES: readonly string[] = ['addressable', 'uniqueAddress', 'addressed'];

/**
 * revision 冲突判定（REQ-10.4）。
 * 只认**明确**的冲突信号：字符串/消息里出现 revision·conflict·stale，或对象带冲突码。
 * 认不出来就归 `failed` —— 把未知错误说成「版本冲突」会误导用户去刷新页面。
 */
export function isRevisionConflict(error: unknown): boolean {
  if (typeof error === 'string') return /revision|conflict|stale|冲突/i.test(error);
  const record = asRecord(error);
  if (record === undefined) return false;
  if (record['conflict'] === true) return true;
  if (record['revisionConflict'] === true) return true;
  const code = String(record['code'] ?? record['name'] ?? '');
  if (/revision|conflict|stale/i.test(code)) return true;
  return /revision|conflict|stale|冲突/i.test(describeError(error));
}

/** `describe()` → 本命名空间的条目（`{ ns, value }` 形状见 contract §D13） */
function namespaceEntry(described: SettingsResponse): Record<string, unknown> | undefined {
  const value = asRecord(described.value);
  const namespaces = value?.['namespaces'];
  if (!Array.isArray(namespaces)) return undefined;
  for (const entry of namespaces) {
    const record = asRecord(entry);
    if (record?.['ns'] === SETTINGS_NAMESPACE) return record;
  }
  return undefined;
}

/**
 * 抽出本命名空间的状态。**六处候选**（候选表与「只读」那三组在 `config-readonly.ts`，
 * 「revision / 唯一寻址」两组在这里）：每处都在测试里单独喂过一遍。一处都没有 ⇒ 明说「宿主未提供」。
 */
export function readNamespaceState(described: SettingsResponse): NamespaceState {
  const outer = asRecord(described.value);
  const entry = namespaceEntry(described);

  // 只读：① 宿主显式说不可写 ② **零写入推断**「有效值 ≠ base + user 可推导值」（见 config-readonly.ts）。
  // 两条共用一个入口，任何不确定都返回 undefined（= 可写）⇒ 假阳性（把可写锁成只读）被挡在门外。
  const readOnly = readOnlyFromPayload(entry, outer);

  let addressability: AddressabilityNotice | undefined;
  const sources = [entry, outer].filter((item): item is Record<string, unknown> => item !== undefined);
  for (const source of sources) {
    if (firstBoolean(source, ADDRESSABLE_CANDIDATES) === false) {
      addressability = {
        reason:
          firstString(source, REASON_CANDIDATES) ??
          `宿主未把本行当作可唯一寻址的配置条目（settings 按条目 id 寻址，本包 id = ${SETTINGS_NAMESPACE}）`,
      };
      break;
    }
  }

  let revision: unknown;
  for (const source of sources) {
    for (const key of REVISION_CANDIDATES) {
      if (source[key] !== undefined) {
        revision = source[key];
        break;
      }
    }
    if (revision !== undefined) break;
  }

  const payload = asRecord(entry?.['value']);
  const rows = Array.isArray(payload?.[CONFIG_PATCH_FIELD])
    ? (payload[CONFIG_PATCH_FIELD] as unknown[])
    : Array.isArray(entry?.['value'])
      ? (entry['value'] as unknown[])
      : [];

  return { readOnly, addressability, rows, revision, rawFound: entry !== undefined };
}

/** 造写回管道。`getSettings` 是**惰性软取**（服务可能晚于本插件就绪，不缓存 `undefined`） */
export function createConfigPipe(getSettings: () => RemoteSettingsLike | undefined): ConfigPipe {
  let updateCount = 0;

  async function readConfig(): Promise<ConfigReadOutcome> {
    const service = getSettings();
    if (service === undefined) {
      return {
        kind: 'unavailable',
        message: '宿主未提供 remote.settings：配置页只能显示本地表单，保存不可用（零路由、零提权不受影响）',
      };
    }
    let described: SettingsResponse;
    try {
      described = await service.describe();
    } catch (error) {
      return { kind: 'failed', message: `读取配置失败：${describeError(error)}` };
    }
    if (described.ok !== true) return { kind: 'failed', message: `读取配置失败：${describeError(described.error)}` };
    return { kind: 'ok', state: readNamespaceState(described) };
  }

  /**
   * 写回 `profiles`（**唯一**写入点）。
   *
   * - 逐行结构校验（与宿主 `parseProfiles` **同一个** `parseRowStructure`）⇒ 无效行被排除，
   *   其余照常写入（REQ-1.2 的容错口径）；
   * - **全部**行都无效（且确实有行）⇒ `invalid`、**不写**（否则等于用空数组清空既有配置）；
   * - revision 冲突 ⇒ `conflict`（页面提示 + **保留输入**）。
   *
   * ⚠️ 「只读时不写盘」由**页面**负责（它才持有 `readConfig()` 的只读判定）；本函数只保证
   * 「没有调用就没有 `updateCount`」，所以页面那条断言是「0 次真实写入」。
   */
  async function saveProfiles(rows: readonly unknown[], expectedRevision?: unknown): Promise<SaveOutcome> {
    const service = getSettings();
    if (service === undefined) {
      return { kind: 'unavailable', message: '宿主未提供 remote.settings：无法写回配置（未写盘，输入已保留）' };
    }

    const skipped: RowProblem[] = [];
    const valid: RawProfileRow[] = [];
    for (const [index, row] of rows.entries()) {
      const parsed = parseRowStructure(row, index);
      if (parsed.ok) valid.push(parsed.value);
      else skipped.push({ index, message: parsed.diagnostic.message });
    }
    if (rows.length > 0 && valid.length === 0) {
      return {
        kind: 'invalid',
        message: `全部 ${rows.length} 条 profile 都有问题 ⇒ 未写盘（已在下面对应行标出，输入已保留）`,
        skipped,
      };
    }

    updateCount += 1;
    let result: SettingsResponse;
    try {
      // 🔴 实参**恒为 3 个**（009 收口轮 T4 订正；真机原话 `client api: settings/update expected 3 argument(s), got 2`）：
      // 宿主 `prepareInvocation` 数的是 `values.length` ⇒ 取不到 revision 时**也必须显式占位** `undefined`，
      // 少传一个连请求都发不出去。`expectedRevision` 的 codec 是 `union([_undefined(), number()])` 且
      // `acceptsUndefined: true` ⇒ 显式 `undefined` 合法，投影时被丢弃 ⇒ **语义仍是「无条件写」**（未变）。
      // 007 是本缺陷的**同款**（009 已在 `settings-pipe.ts` 修过同一处），此处只对齐写法、不改语义。
      result = await service.update(SETTINGS_NAMESPACE, { [CONFIG_PATCH_FIELD]: valid }, expectedRevision);
    } catch (error) {
      // 抛出来的拒绝同样要认（真机走的是 `{ok:false, error}` 那一支，但宿主也可能直接抛）
      if (isReadOnlyRefusal(error)) return { kind: 'readonly', notice: readOnlyNoticeFrom(error), skipped };
      return { kind: 'failed', message: `写入配置失败：${describeError(error)}`, skipped };
    }
    if (result.ok === true) {
      return { kind: 'ok', saved: valid.length, skipped, revisionPassed: expectedRevision !== undefined };
    }
    if (isRevisionConflict(result.error)) {
      return {
        kind: 'conflict',
        message: `配置已被其他窗口改动（revision 冲突）⇒ 未写入，请刷新后重试：${describeError(result.error)}`,
        skipped,
      };
    }
    /**
     * 🔴 **缺陷 A 的最小修复点**：旧实现把这句拒绝归成 `failed` ⇒ 页面只说「写入配置失败：…」、不进只读态、
     * 不锁表单（真机症状）；现在归成 `readonly`（页面据此**粘性**只读）。⚠️ 这一支确实调过一次 `update`
     * （拒绝就是信号本身），但**零字节落盘**（宿主拒绝 ⇒ patch sha 不变，真机已证）。
     * 2026-10-12 起这条**不再是唯一路径**（自动触发见 `config-readonly.ts`），但**保留**为兜底：
     * 推断有假阴性（例如覆盖层把值设成 schema 默认值 ⇒ 判良性），那一刻由这里接住。
     */
    if (isReadOnlyRefusal(result.error)) return { kind: 'readonly', notice: readOnlyNoticeFrom(result.error), skipped };
    return { kind: 'failed', message: `写入配置失败：${describeError(result.error)}`, skipped };
  }

  return { readConfig, saveProfiles, updateCount: () => updateCount };
}
