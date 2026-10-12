/**
 * 配置页的**只读态判定与呈现**（007 REQ-10.3 / REQ-10.5 的只读半边）
 *
 * ## 两条可达路径 → 同一个 `readonly` 状态
 *
 * ① **零写入推断（2026-10-12 自动触发轮新增）**：`describe()` 载荷里
 *    `value ≠ merge(base, user)`，且差异**无法由 schema 默认值解释** ⇒ 本行被**上层**
 *    （home patch / `--patch` 覆盖层）覆盖 ⇒ **打开即只读**，不必先点一次保存被拒。
 * ② **写入被拒（`6191b57` 保留的兜底）**：`update` 被拒、且拒绝原文属于只读那一类 ⇒ 粘性只读。
 *
 * 两条路都归到同一个 `readOnly` 状态；②不许删（①有假阴性，见下）。
 *
 * ## 🔴 假阳性代价极高 ⇒ 判定必须**保守**：任何不确定 ⇒ 返回 `undefined`（= 可写）
 *
 * 假阳性 = 把**可写**表单锁成**永久**只读（用户点不动、也没别的入口）✗；假阴性 = 少锁一次，
 * 用户点保存被拒后**仍**由路径 ② 兜住 ✓。所以规则的每一档都朝「可写」倒，且每一条排除理由
 * 都在用例表里被单独喂过（`tests/unit/client-config-readonly.test.tsx`）。
 *
 * ## 载荷语义（宿主源码实证 `dsh-settings/lib/index.js`；本模块的判据**照抄宿主自己的不变量**）
 *
 * `describe()` 逐命名空间给出 `{ value, base, user }`（`:436-439`）：
 *
 * | 字段 | 宿主算法 | 语义 | 带 schema 默认值？ |
 * | --- | --- | --- | --- |
 * | `value` | `projectForm(form, plainConfig(entry.fiber.config))` | 插件**正在跑**的完整配置 = 全部层合并后的结果，**含**高于 settings 文档的层（`--patch` / home patch） | ✅（`entry.fiber.config` 是解析结果） |
 * | `base` | `projectForm(form, plainConfig(inheritedConfig(runtime, interpolate(inherited))))` | settings 文档**之下**的层 | ✅（`resolveConfig` 会补默认值） |
 * | `user` | `projectForm(form, override)` | settings **文档本身** = `update()` 写的那个层 | ❌（**不过** schema 解析） |
 *
 * 宿主自己的写路径就是 `mergeLayers(current, input)`（`:472`）与 `mergeLayers(base, input)`（`:481`）
 * ⇒ 「`value` 应当等于 `mergeLayers(base, user)`」是**宿主自己的不变量**，不是本包发明的口径。
 *
 * **真机反证（同一次采样、同一实例，仅差一层 `--patch`）**：
 * - **有**覆盖层（探针产物 `B2-remote-settings-describe-with-overlay.raw.json`，34521 B /
 *   sha256 `BE00EE3D…`）：`dsh-terminal-profiles` 的 `value={profiles:[overlay-row]}`、
 *   `base=user={profiles:[]}` ⇒ 不变量**被破坏**，且 21 条命名空间里**只有这 1 条**被破坏；
 * - **无**覆盖层（`B1-remote-settings-describe.raw.json`，35198 B / sha256 `BD802FDA…`）：
 *   **21/21 条全部满足**该不变量 ⇒ 该信号在这一组真机载荷上**零假阳性**。
 *
 * ⚠️ 样本只有这一次采样（21 条命名空间 × 2 种覆盖层状态）⇒ 见 `specs/007-terminal-config-page/tasks.md`
 * 的「未验项」：哪些载荷形态**没有样本**是如实登记的，不靠外推。
 *
 * ## 会**破坏**该不变量、但**并不只读**的情形（反例清单）与排除手段
 *
 * | # | 情形 | 为什么破坏不变量 | 本模块的排除 |
 * | --- | --- | --- | --- |
 * | 1 | **schema 默认值填充** | `base` 过 `resolveConfig` 补默认值、`user` 不过；而 `inheritedConfig` 在 `resolveConfig` **抛错**时回落成**原始** `inherited`（`:314-320` 的 catch）⇒ 默认值只在 `value` 里冒出来 | 差异路径上 `value` 的叶子**结构等价**于 `schema.refs` 里该路径的 `meta.default` ⇒ 判良性、丢弃 |
 * | 2 | **未求值 `!!js` 表达式** | `user` 是**原始** override（`:439` 不做 interpolate）⇒ 拿到 `{__jsExpr}`，而 `value` 拿到求值结果 | 三份载荷任一处出现 `{__jsExpr: string}`（宿主 `isExpression` `:132-135` 同形）⇒ 整体退出判定（可写） |
 * | 3 | **secret 脱敏** | `redactSecrets` 在 `value`/`base`/`user` 上分别施加（`:447-449`），运行期注入的凭据只在 `value` 里 ⇒ 结构不可比 | `entry.secrets` 非空 **或** schema 任一节点 `meta.role === 'secret'` ⇒ 整体退出判定（可写） |
 * | 4 | **键序** | `mergeLayers` 把 `user` 独有的键**追加到尾部**，而 `projectForm` 按 `schema.dict` 序产出 | 比对走**结构等价**（不看键序），不用 `JSON.stringify` |
 * | 5 | **值「变少」** | `value` 缺一个 `base`/`user` 有的键 —— 该形态**无样本**，任何解释都可能是错的 | 存在「缺失型」差异 ⇒ 整体退出判定（可写），只对「`value` 多出/改了值」这一形态下结论 |
 * | 6 | **写入后的 live 传播竞态** | 另一窗口刚写完、fiber 还没拿到新值时，`value`（旧）与 `user`（新）短暂不一致 | **未排除**（无时间戳可读）⇒ 记为残留风险：只读态只在**页面打开那一次**读取时判定，成功后刷新只更新 revision，不重新锁；重开页面即可恢复 |
 *
 * ## 本模块还持有「载荷读取原语」的**唯一一份**定义（`asRecord` / `firstString` / `firstBoolean` /
 * `describeError`）—— 管道（`config-pipe.ts`）import 回去用，**不复制第二份**（AGENTS.md：
 * 不许各自解释口径；两份实现迟早漂移，而漂移的症状是「一门悄悄失去判据」）。
 */

/** 只读原因 + 文件路径（REQ-10.3：两个都要显示，不许只写「保存失败」） */
export interface ReadOnlyNotice {
  readonly reason: string;
  readonly path: string;
}

/**
 * 「宿主未提供配置文件路径」的**唯一**字面量（真机降级，绝不伪造路径）。宿主**有**路径
 * （`dsh-settings/lib/index.js:399-408` 的 `documentPath`），但唯一的远端出口
 * `settings/openSettingsDocument` 只回 `{opened:true}`（`dsh-api-settings-controller/lib/index.js:441-459`，
 * 且副作用是打开系统编辑器），`configEditor` 也不在远端命名空间里 ⇒ **客户端取不到**。
 * 两个可选口径：① 改 REQ-10.3 措辞 ② 只回显可得字段（原因 + `details.ns`）—— 本实现取 ②，
 * **不擅自改 requirements**。⚠️ 本轮自动触发**不改变**它：推断出来的只读同样如实降级。
 */
export const READONLY_PATH_UNKNOWN = '（宿主未提供配置文件路径）';

/**
 * 「写入被拒」里属于**只读**（本行被上层 patch 覆盖）的那一类，判据用**宿主自己的词汇**：
 * `dsh-config-editor/lib/index.js:122` 逐字原文 `… is overridden by a home patch or command-line overlay`
 * （真机实测同句）。⚠️ **故意不匹配裸的「只读 / read-only」**（`磁盘只读` 是存储故障，误判会锁死表单）。
 */
export const READ_ONLY_REFUSAL_PATTERN =
  /overridden by a home patch|command-line overlay|read[-\s]?only provider|provider is read[-\s]?only/i;

/** 候选字段名（形状未验证 ⇒ 逐个试；「只读 / 路径 / 原因」三组住在只读模块里） */
export const PATH_CANDIDATES: readonly string[] = ['path', 'documentPath', 'file', 'settingsPath'];
export const REASON_CANDIDATES: readonly string[] = ['reason', 'message', 'detail', 'error', 'why'];
export const WRITABLE_CANDIDATES: readonly string[] = ['writable', 'writableByPlugin', 'canWrite'];
export const READONLY_CANDIDATES: readonly string[] = ['readOnly', 'readonly'];

/** 深递归的硬上限（防循环引用 / 病态载荷把页面挂住；超限 = 不确定，不猜） */
const MAX_DEPTH = 24;

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function firstString(source: Record<string, unknown>, candidates: readonly string[]): string | undefined {
  for (const key of candidates) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

export function firstBoolean(source: Record<string, unknown>, candidates: readonly string[]): boolean | undefined {
  for (const key of candidates) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

/** 把 `error` 变成一句人话（字符串直接用；对象取候选字段；都没有就 JSON 兜底 + 截断） */
export function describeError(error: unknown): string {
  if (typeof error === 'string' && error.trim() !== '') return error;
  const record = asRecord(error);
  if (record !== undefined) {
    const text = firstString(record, [...REASON_CANDIDATES, 'code', 'name']);
    if (text !== undefined) return text;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return error === undefined ? '未知原因（宿主未返回 error）' : String(error);
}

/** 这个拒绝是不是「只读」那一类（字符串 / 对象两种错误形态都认；认不出 = false，绝不猜） */
export function isReadOnlyRefusal(error: unknown): boolean {
  const text = typeof error === 'string' ? error : firstString(asRecord(error) ?? {}, [...REASON_CANDIDATES, 'code', 'name']);
  return text === undefined ? false : READ_ONLY_REFUSAL_PATTERN.test(text);
}

/** 把「只读拒绝」变成给页面显示的提示：**原因取宿主原文**，路径如实降级（不伪造） */
export function readOnlyNoticeFrom(error: unknown): ReadOnlyNotice {
  return { reason: describeError(error), path: READONLY_PATH_UNKNOWN };
}

/* ────────────────────────── 路径 ①（原有）：载荷自报的显式只读信号 ────────────────────────── */

/** 逐候选读「宿主自己说不可写」（真机载荷里 21/21 条都没有 ⇒ 这条在真机上**取不到**） */
function explicitReadOnly(
  entry: Record<string, unknown> | undefined,
  outer: Record<string, unknown> | undefined,
): ReadOnlyNotice | undefined {
  const sources = [entry, outer].filter((item): item is Record<string, unknown> => item !== undefined);
  for (const source of sources) {
    const writable = firstBoolean(source, WRITABLE_CANDIDATES);
    const flagged = firstBoolean(source, READONLY_CANDIDATES);
    if (writable === false || flagged === true) {
      return {
        reason: firstString(source, REASON_CANDIDATES) ?? '宿主拒绝写入（本行被上层 patch 覆盖或当前为只读）',
        path: firstString(source, PATH_CANDIDATES) ?? firstString(outer ?? {}, PATH_CANDIDATES) ?? READONLY_PATH_UNKNOWN,
      };
    }
  }
  return undefined;
}

/* ────────────────────────── 路径 ①（新增）：零写入推断 ────────────────────────── */

/** 一处差异（粒度为 `mergeLayers` / `projectForm` 的粒度：纯对象递归，数组整体比） */
interface Mismatch {
  readonly path: string;
  /** `value` 侧在这一路径上的叶子（`undefined` = `value` 里没有这个键） */
  readonly value: unknown;
  /** 「`base` + `user` 可推导值」侧在同一路径上的叶子 */
  readonly merged: unknown;
}

/** 宿主 `isExpression`（`dsh-settings/lib/index.js:132-135`）的同形判定：未求值的 `!!js` 表达式 */
function isExpression(value: unknown): boolean {
  const record = asRecord(value);
  if (record === undefined || Array.isArray(value)) return false;
  const keys = Object.keys(record);
  return keys.length === 1 && typeof record['__jsExpr'] === 'string';
}

/** 三份载荷里**任何一处**有未求值表达式 ⇒ 它们不可比（反例 2） */
function containsExpression(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (isExpression(value)) return true;
  if (Array.isArray(value)) return value.some((item) => containsExpression(item, depth + 1));
  const record = asRecord(value);
  if (record === undefined) return false;
  return Object.values(record).some((child) => containsExpression(child, depth + 1));
}

/**
 * **结构等价**（不看键序；`undefined` 值键与缺席键等价）。
 * 🔴 不能用 `JSON.stringify` 比：`mergeLayers` 把 `user` 独有的键追加到**尾部**，
 * 而 `projectForm` 按 `schema.dict` 序产出 ⇒ 键序不同会让**等价**的两份载荷被判成差异（反例 4）。
 */
function structurallyEqual(left: unknown, right: unknown, depth = 0): boolean {
  if (left === right) return true;
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => structurallyEqual(item, right[index], depth + 1));
  }
  const under = asRecord(left);
  const over = asRecord(right);
  if (under === undefined || over === undefined) return false;
  for (const key of new Set([...Object.keys(under), ...Object.keys(over)])) {
    if (!structurallyEqual(under[key], over[key], depth + 1)) return false;
  }
  return true;
}

/**
 * 宿主 `mergeLayers` 的等价实现（`dsh-settings/lib/index.js:281-291` 逐分支同形）：
 * **纯对象**递归合并；其余一切（数组、标量、`null`）**整体替换**。
 */
function mergeLayers(under: unknown, over: unknown): unknown {
  const left = asRecord(under);
  const right = asRecord(over);
  if (left === undefined || right === undefined || Array.isArray(under) || Array.isArray(over)) return over;
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    merged[key] = Object.hasOwn(left, key) ? mergeLayers(left[key], value) : value;
  }
  return merged;
}

/** 逐路径收集差异（同粒度：能递归进纯对象就递归，否则整节点算一处） */
function collectMismatches(value: unknown, merged: unknown, path: string, out: Mismatch[], depth = 0): void {
  if (structurallyEqual(value, merged)) return;
  if (depth > MAX_DEPTH) {
    out.push({ path, value, merged });
    return;
  }
  const left = asRecord(value);
  const right = asRecord(merged);
  if (left === undefined || right === undefined || Array.isArray(value) || Array.isArray(merged)) {
    out.push({ path, value, merged });
    return;
  }
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    collectMismatches(left[key], right[key], path === '' ? key : `${path}.${key}`, out, depth + 1);
  }
}

/** `entry.schema` = `{ uid, refs: { uid: node } }`（宿主 `toJSON()` 的形状，逐字见真机载荷） */
interface SchemaIndex {
  /** 根节点（`schema.uid` 指向 `refs` 里的那一条） */
  readonly root: Record<string, unknown> | undefined;
  readonly refs: Record<string, unknown>;
}

function schemaRef(refs: Record<string, unknown>, uid: unknown): Record<string, unknown> | undefined {
  return uid === undefined || uid === null ? undefined : asRecord(refs[String(uid)]);
}

function schemaIndex(entry: Record<string, unknown>): SchemaIndex | undefined {
  const schema = asRecord(entry['schema']);
  const refs = asRecord(schema?.['refs']);
  if (schema === undefined || refs === undefined || Object.keys(refs).length === 0) return undefined;
  return { root: schemaRef(refs, schema['uid']), refs };
}

/** 沿路径取 schema 在该处的 `meta.default`（走 `dict` 的 uid 链；拿不到 ⇒ `undefined`） */
function schemaDefaultAt(index: SchemaIndex, path: string): unknown {
  let node = index.root;
  for (const key of path.split('.')) {
    if (node === undefined || node['type'] !== 'object') return undefined;
    node = schemaRef(index.refs, asRecord(node['dict'])?.[key]);
  }
  return asRecord(node?.['meta'])?.['default'];
}

/** schema 里是否存在 `meta.role === 'secret'` 的节点（反例 3：脱敏让三份载荷不可比） */
function schemaHasSecret(refs: Record<string, unknown>): boolean {
  return Object.values(refs).some((node) => asRecord(asRecord(node)?.['meta'])?.['role'] === 'secret');
}

/** 推断的结论（`indeterminate` 只用于诊断与用例，管道只消费 `overlay`） */
export type ReadOnlyInference =
  | { readonly kind: 'overlay'; readonly reason: string; readonly fields: readonly string[] }
  | { readonly kind: 'consistent' }
  | { readonly kind: 'indeterminate'; readonly why: string };

/**
 * 零写入推断：**只在能排除全部已知良性解释时**才说「被上层覆盖」。
 * 分步与每一步的「为什么朝可写倒」见文件头反例表；返回 `consistent` / `indeterminate` 都等于**可写**。
 */
export function inferReadOnly(entry: Record<string, unknown> | undefined): ReadOnlyInference {
  if (entry === undefined) return { kind: 'indeterminate', why: '载荷里没有这个命名空间' };
  if (!Object.hasOwn(entry, 'base') || !Object.hasOwn(entry, 'user')) {
    return { kind: 'indeterminate', why: '载荷缺 base / user（没有可比的两层）' };
  }
  const value = entry['value'];
  const merged = mergeLayers(entry['base'], entry['user']);
  const mismatches: Mismatch[] = [];
  collectMismatches(value, merged, '', mismatches);
  if (mismatches.length === 0) return { kind: 'consistent' };

  // 反例 5：`value` 少了 base/user 有的键 —— 该形态**无样本**，任何解释都可能是错的 ⇒ 不锁
  const shrunk = mismatches.filter((item) => item.value === undefined);
  if (shrunk.length > 0) {
    return { kind: 'indeterminate', why: `有效值缺失了 base+user 有的键（无样本形态）：${shrunk.map((item) => item.path).join('、')}` };
  }
  // 反例 2：未求值表达式（user 侧是原文、value 侧是求值结果）
  if (containsExpression(value) || containsExpression(entry['base']) || containsExpression(entry['user'])) {
    return { kind: 'indeterminate', why: '载荷里含未求值的 !!js 表达式（两侧不可比）' };
  }
  // 反例 3：secret 脱敏
  const index = schemaIndex(entry);
  if (Array.isArray(entry['secrets']) && entry['secrets'].length > 0) {
    return { kind: 'indeterminate', why: '本行含 secret 字段（脱敏后不可比）' };
  }
  if (index === undefined) {
    return { kind: 'indeterminate', why: '载荷里没有可解析的 schema（无法排除「schema 默认值」这一解释）' };
  }
  if (schemaHasSecret(index.refs)) return { kind: 'indeterminate', why: 'schema 含 secret 字段（脱敏后不可比）' };

  // 反例 1：`value` 的叶子 == schema 默认值 ⇒ 是「默认值填充」，不是覆盖
  const overlay = mismatches.filter((item) => !structurallyEqual(item.value, schemaDefaultAt(index, item.path)));
  if (overlay.length === 0) return { kind: 'consistent' };
  const fields = overlay.map((item) => item.path).sort();
  return {
    kind: 'overlay',
    fields,
    reason:
      '（零写入推断）本行的有效值 ≠ base + user 可推导值，且差异无法由 schema 默认值解释' +
      ` ⇒ 本行被上层 patch（home patch 或 --patch 覆盖层）覆盖：${fields.join('、')}` +
      '（尚未经写入被拒确认）',
  };
}

/**
 * 载荷 → 只读提示（**唯一入口**，两条路在这里汇合）。
 * 先认宿主自报的显式信号（原有行为，一个字节未改），再走零写入推断；都拿不到 ⇒ `undefined`（可写）。
 */
export function readOnlyFromPayload(
  entry: Record<string, unknown> | undefined,
  outer: Record<string, unknown> | undefined,
): ReadOnlyNotice | undefined {
  const explicit = explicitReadOnly(entry, outer);
  if (explicit !== undefined) return explicit;
  const inferred = inferReadOnly(entry);
  return inferred.kind === 'overlay' ? { reason: inferred.reason, path: READONLY_PATH_UNKNOWN } : undefined;
}
