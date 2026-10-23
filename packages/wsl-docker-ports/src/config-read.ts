/**
 * 宿主侧配置读取：**volatile 活体包装的统一解包**（009 缺陷 1 的**第二层**）
 *
 * ## 为什么必须有这一层（真机缺陷 1 的修复带来的一层新风险）
 *
 * 缺陷 1 的修法是给 `Config` 的字段标 `.volatile()`（见 `./config.ts` 文件头的宿主源码判据：
 * `dsh-settings` 的 `describe()` 先过 `volatileForm()` 门，零 volatile ⇒ 整个命名空间**不出现**；
 * `write()` 还会对非 volatile 路径直接抛 `Config field "…" is not volatile`）。
 *
 * ⚠️ 代价是 002 B-1 早已定案的机制：**标了 volatile 的字段，解析结果是带 `.get()` 的深冻结活体包装**，
 * 直接把属性当值读会拿到包装对象本身，不是值。若照旧读法（`config.elevationPolicy` / `config.writeToken`
 * / `config.distro`）就会得到「一个对象」：
 *
 * - 提权档判不出 `ask` ⇒ 事实面落 `unknown` ⇒ 执行层按 SSoT 落到 `none`（**永远写不动**）；
 * - 凭据不是字符串 ⇒ 写通道恒 401（**永久 401**）。
 *
 * 这正是本包旧注释里写的「正确性倒退」，只不过它是**修缺陷 1 必须付的代价**，正确处置是
 * **读侧统一解包**，而不是为了好读把字段退回平凡（那样命名空间根本不出现、`update` 直接抛）。
 *
 * ## 两条硬口径
 *
 * 1. **两类形态都要收**（同一个读法）：活体包装（`.get()` 有值）与直接值（普通对象/字符串）。
 *    理由：字段是否 volatile 由 `Config` 决定，但宿主**其它调用方**（单测、集成方、
 *    `applyWslDockerPorts(ctx, config)` 的手工传参）传的可能是平凡对象；两套读法必然会分叉。
 * 2. **每次取值都重新解包**（`createHostConfigReaders` 返回的是**函数**，不是拍下来的值）：
 *    volatile 写入是**原地**更新活体包装（`updateVolatile` 把新快照写进同一个 ref）⇒
 *    现读才能拿到新值。若在 `apply` 时拍一次，用户在配置页轮换凭据后宿主仍拿旧值 ⇒ 又回到永久 401。
 *
 * ## 判据（离线，两个形态行为逐项相同）
 *
 * `tests/unit/config-read.test.ts`：同一份「活体包装」与「平凡对象」两种输入，`distro` /
 * `elevationPolicy` / `writeToken` / `managedPorts` 的读值、提权档判决、写通道 401 判决、
 * 所有权声明（`declaration` 含 `43312`）必须逐项一致。
 */

/** volatile 引用（cordis/cosmokit 的活体包装）最小结构面：只有 `.get()` 能取到值 */
export interface VolatileRefLike {
  readonly get?: unknown;
}

/**
 * 配置值的来源形态（**三态都收**，读法统一）：直接值 / volatile 活体包装（`.get()`）/
 * **零参取值函数**（`plugin.ts` 透传给消费点的就是这种，现读才拿得到 live 值）。
 * 故意是 `unknown`：宿主交给 `apply` 的 config 由 schemastery 解析、形态随 volatile 声明而变，
 * 类型系统在这里挡不住真问题，真正的判定只能在 `readConfigValue` 一处。
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
 * 空白串 ⇒ `undefined`（与 `transport/write-auth.ts` 的 `trim` 口径一致：空白 = 未配置，不是「凭据是空格」）。
 */
export function readConfigToken(source: ConfigValueSource): string | undefined {
  const raw = readConfigValue(source);
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text === '' ? undefined : text;
}

/** 014：自动刷新频次的固定五档（秒）；不在其中一律按「关闭」处理 */
const REFRESH_INTERVALS_SEC = [0, 15, 30, 60, 300] as const;

/**
 * 解包成刷新频次（秒）：**数值与纯数字字符串都收**（手工传参 / 旧文档里可能是字符串），
 * 不在五档内（含负数、`NaN`、空串、`20` 这类未登记值）一律 ⇒ `0`（关闭，fail-safe）。
 */
function unwrapConfigRefreshInterval(value: unknown): number {
  const plain = unwrapConfigValue(value);
  const text = typeof plain === 'string' ? plain.trim() : plain;
  const seconds = typeof text === 'number' ? text : typeof text === 'string' && text !== '' ? Number(text) : Number.NaN;
  return REFRESH_INTERVALS_SEC.some((allowed) => allowed === seconds) ? seconds : 0;
}

/** 本包宿主面用到的**七个**配置字段的**活体读取面**（每次调用现读，不吃缓存） */
export interface PortsConfigReaders {
  /** `distro`：留空/非串 ⇒ `undefined`（001 的四级优先级解析接管） */
  distro(): string | undefined;
  /** `elevationPolicy`：**原始字符串原样返回**（认不认得出来由语义层判，见 `transport/real-facts.ts`） */
  elevationPolicy(): string | undefined;
  /** `writeToken`：**已 trim**；`undefined` = 未配置（fail-safe：写通道 401） */
  writeToken(): string | undefined;
  /** `managedPorts`：非数组/非串成员一律剔除 ⇒ `[]`（声明恒空是**安全**降级） */
  managedPorts(): readonly string[];
  /**
   * 012 `listenAddresses`：逐端口监听地址（键 = 端口号字符串）。畸形 ⇒ `{}`。
   * **现读**：客户端选值后立刻写配置，下一次判决/计划就能看到。
   */
  listenAddresses(): Readonly<Record<string, string>>;
  /**
   * 014 `refreshIntervalSec`：自动刷新频次（秒）。缺省/非法 ⇒ `0`（关闭）。
   * 服务端不消费它（没有隐藏轮询），本读者只为「同一命名空间的现读口径」完整。
   */
  refreshIntervalSec(): number;
}

/**
 * 造活体读取面。`config` 可以是活体包装**或**平凡对象**或**零参取值函数（返回上述两类之一），
 * 也可以是 `undefined`。返回的七个方法**每次重新解包**（取值函数也每次都调）⇒ volatile 原地写入
 * （不重挂载）能被下一次读到。
 */
export function createHostConfigReaders(config?: ConfigValueSource): PortsConfigReaders {
  /** 每次现读根：取值函数先调，再解包（与管理面的 `readConfigValue` 同序） */
  const root = (): unknown => unwrapConfigValue(typeof config === 'function' ? (config as () => unknown)() : config);
  const field = (name: string): unknown => {
    const source = root();
    if (source === null || typeof source !== 'object') return undefined;
    return unwrapConfigValue((source as Record<string, unknown>)[name]);
  };
  return {
    distro: () => unwrapConfigString(field('distro')),
    elevationPolicy: () => unwrapConfigString(field('elevationPolicy')),
    writeToken: () => readConfigToken(field('writeToken')),
    managedPorts: () => unwrapConfigStringArray(field('managedPorts')),
    listenAddresses: () => unwrapConfigStringRecord(field('listenAddresses')),
    refreshIntervalSec: () => unwrapConfigRefreshInterval(field('refreshIntervalSec')),
  };
}
