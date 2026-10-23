/**
 * **共享配置读取面**（015 `P1`）—— 「volatile 活体包装的统一解包」，字段无关的那一半。
 *
 * ## 边界（015 §4.1）
 *
 * 这里只做**形态归一**：活体包装 `.get()` / 平凡值 / 零参取值函数 → 值；字符串 / 字符串数组 /
 * 字符串映射 / 令牌 / 刷新频次。**不认识任何字段名**，也不认识两个命名空间
 * （`dsh-wsl-docker-ports` 与 `dsh-wsl-docker-containers`）—— 字段名清单留在
 * `src/config-read.ts`（转发侧）与 `src/containers/credential.ts`（容器侧）。
 *
 * 理由不是洁癖：015 的 R3 白名单把 `src/shared/**` 钉成「业务无关底座」，而「哪些字段属于转发」
 * 正是**业务**。字段名搬进来 = 两个命名空间的口径会在这里混成一份。
 *
 * ## 两条硬口径（原样保留）
 *
 * 1. **两类形态都要收**（同一个读法）：活体包装（`.get()` 有值）与直接值。
 * 2. **每次取值都重新解包**（返回的是**函数**，不是拍下来的值）：volatile 写入是原地更新。
 *
 * 判据用例仍在 `tests/unit/config-read.test.ts`（`src/config-read.ts` 再导出本文件）。
 */

/** volatile 引用（cordis/cosmokit 的活体包装）最小结构面：只有 `.get()` 能取到值 */
export interface VolatileRefLike {
  readonly get?: unknown;
}

/**
 * 配置值的来源形态（**三态都收**）：直接值 / volatile 活体包装（`.get()`）/ **零参取值函数**。
 * 故意是 `unknown`：宿主交给 `apply` 的 config 由 schemastery 解析、形态随 volatile 声明而变。
 */
export type ConfigValueSource = unknown;

/** 解包一次：活体包装 ⇒ `.get()` 的值；直接值 ⇒ 原样。**取不到（抛）一律当 `undefined`**，不炸装载期 */
export function unwrapConfigValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const get = (value as VolatileRefLike).get;
  if (typeof get !== 'function') return value;
  try {
    return (get as () => unknown).call(value);
  } catch {
    return undefined;
  }
}

/** 归一化来源：取值函数 ⇒ 调一次；活体包装 ⇒ `.get()`；其余原样（顺序不能反：函数优先） */
export function readConfigValue(source: ConfigValueSource): unknown {
  return unwrapConfigValue(typeof source === 'function' ? (source as () => unknown)() : source);
}

/** 解包成字符串：**非字符串一律 `undefined`**（不 `String()` 强转 —— 42 不是凭据，也不是发行版名） */
export function unwrapConfigString(value: unknown): string | undefined {
  const plain = unwrapConfigValue(value);
  return typeof plain === 'string' ? plain : undefined;
}

/** 解包成字符串数组：非数组 ⇒ `[]`；数组里**只留字符串**（与客户端 `readConfig` 的读法同口径） */
export function unwrapConfigStringArray(value: unknown): readonly string[] {
  const plain = unwrapConfigValue(value);
  return Array.isArray(plain) ? plain.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * 解包成「字符串 → 字符串」映射（012 的 `listenAddresses`）：非对象 ⇒ `{}`；
 * 键是端口号、值是 IPv4 字面量，**只留两侧都是字符串的项**。
 *
 * 与 `unwrapConfigStringArray` 同口径：宿主来的畸形值降级成空映射（安全方向 = 不选具体地址
 * ⇒ 仍是 `0.0.0.0`），绝不把非字符串强转成地址。
 */
export function unwrapConfigStringRecord(value: unknown): Readonly<Record<string, string>> {
  const plain = unwrapConfigValue(value);
  if (plain === null || typeof plain !== 'object' || Array.isArray(plain)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(plain as Record<string, unknown>)) {
    const text = unwrapConfigValue(item);
    if (typeof text === 'string') out[key] = text;
  }
  return out;
}

/**
 * 归一化「凭据来源」：`string` / 活体包装 / **零参取值函数**（`() => …`）三种都收。
 * 空白串 ⇒ `undefined`（与 `shared/credential.ts` 的 `trim` 口径一致：空白 = 未配置）。
 */
export function readConfigToken(source: ConfigValueSource): string | undefined {
  const raw = readConfigValue(source);
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text === '' ? undefined : text;
}

/** 014：自动刷新频次的固定五档（秒）；不在其中一律按「关闭」处理 */
export const REFRESH_INTERVALS_SEC = [0, 15, 30, 60, 300] as const;

/**
 * 解包成刷新频次（秒）：**数值与纯数字字符串都收**，不在五档内（含负数、`NaN`、空串、`20`）
 * 一律 ⇒ `0`（关闭，fail-safe）。
 */
export function unwrapConfigRefreshInterval(value: unknown): number {
  const plain = unwrapConfigValue(value);
  const text = typeof plain === 'string' ? plain.trim() : plain;
  const seconds = typeof text === 'number' ? text : typeof text === 'string' && text !== '' ? Number(text) : Number.NaN;
  return REFRESH_INTERVALS_SEC.some((allowed) => allowed === seconds) ? seconds : 0;
}

/**
 * **字段无关**的现读器：`(name) => unknown`。每次调用重新解包根、再解包字段。
 *
 * 这是两侧共用的唯一读法；字段名清单与「解包成什么类型」由各自的配置面决定
 * （转发侧 `createHostConfigReaders`、容器侧 `createContainersConfigReaders`）。
 */
export function createConfigFieldReader(source: ConfigValueSource): (name: string) => unknown {
  return (name: string): unknown => {
    const root = unwrapConfigValue(typeof source === 'function' ? (source as () => unknown)() : source);
    if (root === null || typeof root !== 'object') return undefined;
    return unwrapConfigValue((root as Record<string, unknown>)[name]);
  };
}

/** 便捷：从任意来源现读**一个字符串字段**（`role` / `distro` 这类；非串 ⇒ `undefined`） */
export function readConfigStringField(source: ConfigValueSource, name: string): string | undefined {
  return unwrapConfigString(createConfigFieldReader(source)(name));
}
