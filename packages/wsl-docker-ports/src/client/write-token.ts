/**
 * 008 T3.1 写通道凭据的**客户端持有面**（主人 2026-10-10 裁定的契约 1/2）
 *
 * ## 三条硬契约（照做，不自作主张）
 *
 * 1. **凭据来源 = 插件配置 `writeToken`，默认仍为空**：本模块**不**改默认值、**不**自动生成
 *    服务端凭据 —— 生成是一个**用户在配置页显式点击**的动作（`issueWriteToken()`），
 *    生成后经既有 live 写入路径 `remote.settings.update(ns, { writeToken })` 落进插件配置。
 *    服务端未配置 ⇒ 仍然一律 401（fail-safe 一字不改，见 `../transport/write-auth.ts`）。
 * 2. **客户端持有 = `localStorage`**（键带包名命名空间）：刷新不丢、**重启不丢**。
 *    ⚠️ **2026-10-31 主人拍板改了口径**（原口径是 `sessionStorage`「不落盘」；019 D3）：凭据本来就明文
 *    躺在 profile 的 `cordis.patch.yml` 里，会话级换不来真实收益，只换来「每次重启重填一遍」。
 *    容器侧（`dsh-wsl-docker-containers`）同步改成同一口径。
 * 3. **凭据绝不进日志/审计/错误文案**：本模块**没有任何 console 调用**；
 *    对外的文案（`CREDENTIAL_*_HINT`）只描述「去哪里配置」，不含凭据本体、期望值与长度。
 *    `read()` 的返回值只有一个去处 —— `Authorization: Bearer` 请求头（`write-channel.ts`）。
 *
 * ## 为什么生成用 32 字节随机 + 十六进制
 *
 * 与 T2.9「随机长串」的口径一致：256 bit 足够对抗猜测，且 `timingSafeEqual` 前的
 * `sha256` 两侧都定长 ⇒ 服务端的常量时间比较对长度不敏感。十六进制只含 `[0-9a-f]`：
 * 放进 `Authorization` 头、URL 查询串、YAML 双引号里都不需要转义。
 *
 * ## 清除 / 轮换（009 T2.1 的留白，本轮补齐）
 *
 * - **轮换** = 再点一次「生成并保存」（新值覆盖旧值）——不需要额外入口。
 * - **清除** = `clearWriteToken()`：先让服务端 `unset` 掉 `writeToken`（宿主 `mutate`，**不是写空串**），
 *   成功才清本会话。二次确认在 UI 层（纯函数层只保证「被调用时恰好发一次 unset、零凭据字节出门」）。
 * - 🔴 **绝不回显既有值**：本模块只有 `present()` 这个**布尔**；「服务端配置里有没有值」由
 *   `settings-pipe.ts` 的 `readConfig()` 化成 `writeTokenConfigured: boolean` 给出，
 *   值本体在那一层就被丢弃 ⇒ 既有凭据**没有**进入 UI 的数据通路。
 *
 * ## 可测性
 *
 * `randomBytes` 可注入（缺省 `crypto.getRandomValues`）⇒ 「生成了什么」在测试里是确定的；
 * `storage` 可注入（缺省真 `localStorage`/`sessionStorage`，都取不到就降级成内存实现）⇒ 无 DOM 也能断言
 * 「存了什么、清掉之后还剩什么」。
 */

/** 客户端存储的键（命名空间 = 包名，避免与容器侧的键撞） */
export const WRITE_TOKEN_STORAGE_KEY = 'dsh-wsl-docker-ports.writeToken';

/** 一次生成的随机字节数（256 bit） */
export const WRITE_TOKEN_BYTES = 32;

/**
 * 「本会话还没凭据」时的提示（**不含凭据本体**）。
 * 用在**本地拦下**（一个请求都不发）的路径上：没凭据就注定 401，没必要浪费一次往返。
 */
export const CREDENTIAL_MISSING_HINT =
  '本会话没有写通道凭据（本地拦下，零请求）：请到「WSL 端口转发」右栏页的「写通道凭据」块点「生成并保存写通道凭据」，' +
  '并确认服务端 config 里的 writeToken 就是这一串。';

/** 「服务端说凭据不对」时的提示（**不做重试循环**，只指路） */
export const CREDENTIAL_REJECTED_HINT =
  '写通道凭据缺失或错误（服务端 401，零执行零写入）：请到「wsl 端口转发」右栏页的「写通道凭据」块重新「生成并保存写通道凭据」，' +
  '并确认服务端已读到该值（writeToken 是 volatile 字段、宿主每次请求现读 ⇒ 改完即时生效，' +
  '不需要重载插件行）。本客户端不重试，也不会把凭据写进日志。';

/** `localStorage` / `sessionStorage` / 假件的公共面（只要这两个方法就够） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 凭据仓库（页面只通过它接触凭据；**没有**「打印出来」的方法） */
export interface WriteTokenStore {
  /** 取当前凭据（`undefined` = 没有）；唯一合法去处是请求头 */
  read(): string | undefined;
  save(token: string): void;
  clear(): void;
  /** 是否已有凭据（**布尔事实**，可以进文案/审计；凭据本体不行） */
  present(): boolean;
}

/**
 * 真存储：优先 `localStorage`（**重启后仍可用**，019 D3），取不到再退 `sessionStorage`；
 * 都没有（无 DOM / 隐私模式）⇒ `undefined` ⇒ 调用方降级内存实现。
 * ⚠️ 这里**不做**探写探测（省主包字节）：真不可写时由 `createWriteTokenStore` 的 try/catch 兜住。
 */
export function defaultTokenStorage(): StorageLike | undefined {
  try {
    const scope = globalThis as { localStorage?: StorageLike | null; sessionStorage?: StorageLike | null };
    return scope.localStorage ?? scope.sessionStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** 无存储可用的降级实现（**内存**：刷新即丢，仍然不落盘 —— 宁可丢凭据也不静默落盘） */
export function createMemoryStorage(): StorageLike {
  const box = new Map<string, string>();
  return {
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => {
      box.set(key, value);
    },
    removeItem: (key) => {
      box.delete(key);
    },
  };
}

/** 字节 → 小写十六进制（不引 Buffer：客户端产物里不能出现 node 内建） */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** 生成 32 字节随机凭据（`randomBytes` 可注入 ⇒ 测试里是确定值） */
export function generateWriteToken(randomBytes?: (size: number) => Uint8Array): string {
  const source =
    randomBytes ??
    ((size: number): Uint8Array => {
      const box = new Uint8Array(size);
      globalThis.crypto.getRandomValues(box);
      return box;
    });
  return bytesToHex(source(WRITE_TOKEN_BYTES));
}

/** 造凭据仓库：空白串一律视为「没有」（与 `../transport/write-auth.ts` 的 trim 口径一致） */
export function createWriteTokenStore(storage: StorageLike | undefined): WriteTokenStore {
  const target = storage ?? createMemoryStorage();
  const read = (): string | undefined => {
    let raw: string | null;
    try {
      raw = target.getItem(WRITE_TOKEN_STORAGE_KEY);
    } catch {
      return undefined;
    }
    if (raw === null) return undefined;
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : trimmed;
  };
  return {
    read,
    present: () => read() !== undefined,
    save: (token) => {
      const trimmed = token.trim();
      if (trimmed === '') return;
      try {
        target.setItem(WRITE_TOKEN_STORAGE_KEY, trimmed);
      } catch {
        // 存储不可写（配额/策略）：不抛。表现是「本会话仍无凭据」⇒ 后续请求走本地拦截并指路
      }
    },
    clear: () => {
      try {
        target.removeItem(WRITE_TOKEN_STORAGE_KEY);
      } catch {
        // 同上：清不掉不是致命错误（凭据本来只活在本机）
      }
    },
  };
}

/** 一次「生成并保存」的结果：`token` 是给用户**一次性复制**用的，不来自仓库读回 */
export interface IssueWriteTokenResult {
  readonly ok: boolean;
  readonly token: string;
  readonly message: string;
}

/**
 * 生成 → 写服务端配置 → 存本会话。
 *
 * 🔴 顺序与失败语义（刻意如此）：
 * 1. 先生成（纯本地）；
 * 2. 再写服务端配置（`save`）—— **只有服务端写入成功才存本会话**。写不进去时本会话**不留**
 *    一个「服务端不认」的凭据（否则用户会看到「已保存」却仍然 401，那是最难查的一类故障）；
 * 3. 无论成败都把 `token` 交回给页面**显示这一次**（写失败时用户还能手工填进配置）。
 */
export async function issueWriteToken(input: {
  readonly store: WriteTokenStore;
  readonly save: (token: string) => Promise<{ readonly ok: boolean; readonly message: string }>;
  readonly randomBytes?: ((size: number) => Uint8Array) | undefined;
}): Promise<IssueWriteTokenResult> {
  const token = generateWriteToken(input.randomBytes);
  let saved: { readonly ok: boolean; readonly message: string };
  try {
    saved = await input.save(token);
  } catch (error) {
    saved = { ok: false, message: `写入插件配置时抛出异常：${error instanceof Error ? error.message : String(error)}` };
  }
  if (!saved.ok) {
    return {
      ok: false,
      token,
      message: `${saved.message}（凭据**未**存入本机：请把这串手工填进服务端 config 的 writeToken，再重新生成一次）`,
    };
  }
  input.store.save(token);
  return {
    ok: true,
    token,
    message:
      '已写入插件配置，并保存在本机（localStorage：刷新/重启都不丢、不进日志/审计）。' +
      '这串只显示这一次 —— 离开后将不再显示，请立即复制（页面不提供「再显示一次」的入口）。',
  };
}

/** 一次「清除凭据」的结果：`cleared` = 本会话那一格**真的**被清掉了（不是「试过」） */
export interface ClearWriteTokenResult {
  readonly ok: boolean;
  readonly cleared: boolean;
  readonly message: string;
  /**
   * 清除**之后**服务端视图报的布尔（`null` = 没拿到视图 ⇒ 页面不猜，保持原状）。
   * 🔴 它来自 `mutate` 的**返回值**（宿主写入后重新 describe 的脱敏视图），不是内存推断 ⇒
   * 页面显示与「刷新后再读一次」同源。
   */
  readonly configConfigured: boolean | null;
}

/**
 * 清除 → 回 fail-safe（009 REQ-1.1 的「回到未配置态」）。
 *
 * 🔴 **清除 = `mutate({op:'unset', path:['writeToken']})`，不是「写空串」**（009 收口轮 T3 根治）：
 * 宿主 `walk()` 判 `secrets[].set` 的依据是 `set: value !== void 0`（`dsh-settings/lib/index.js:24-29`），
 * **空串照样 `!== undefined`** ⇒ 修前写空串后 `describe()` 仍报 `set:true`：重载页面显示「已配置」，
 * 而写通道实际 401 —— **用户可见状态不一致**。`unset` 把字段从 user 段删掉 ⇒ `set:false`。
 *
 * 🔴 顺序与失败语义（与颁发刻意对称）：
 * 1. 先清**服务端**（`unset` ops 走宿主 `mutate`；实参 3 个）；
 * 2. **只有**服务端清除成功才清本会话 —— 反过来（先清本地）会造出「服务端仍认旧串、本会话却没有」
 *    的两边不一致，那正是 008 记下的「最难查的一类故障」；
 * 3. 无论成败都返回可读文案（失败**不静默**），异常也归成失败结果（不穿过 UI）；
 * 4. `configConfigured` 只转达服务端**写入后视图**的布尔（`null` = 没拿到）——本函数**不猜**。
 *
 * ⚠️ 本函数**不自带二次确认**：确认是 UI 的职责（`WriteTokenBlock` 的两段式按钮）——
 * 纯函数层的判据因此是「被调用时恰好发一次 unset、且一个字节的凭据值都不发」。
 */
export async function clearWriteToken(input: {
  readonly store: WriteTokenStore;
  readonly unset: () => Promise<{ readonly ok: boolean; readonly message: string; readonly configConfigured: boolean | null }>;
}): Promise<ClearWriteTokenResult> {
  let cleared: { readonly ok: boolean; readonly message: string; readonly configConfigured: boolean | null };
  try {
    cleared = await input.unset();
  } catch (error) {
    cleared = {
      ok: false,
      message: `清除插件配置时抛出异常：${error instanceof Error ? error.message : String(error)}`,
      configConfigured: null,
    };
  }
  if (!cleared.ok) {
    return {
      ok: false,
      cleared: false,
      configConfigured: cleared.configConfigured,
      message: `${cleared.message}（本会话凭据**保留**：服务端仍认旧串，只清本地会让两边不一致。写入口是否 401 取决于服务端配置）`,
    };
  }
  input.store.clear();
  return { ok: true, cleared: true, configConfigured: cleared.configConfigured, message: cleared.message };
}
