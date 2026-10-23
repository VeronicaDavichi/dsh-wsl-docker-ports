/**
 * 配置写回薄封装（003 T5.3 / T5.7 / T5.8；contract §D13）
 *
 * ## 唯一管道
 *
 * 客户端**没有** `ctx.settings` / `ctx.configEditor`；写配置只能走
 * `ctx.get('remote.settings')` 的 `describe()` + `update(ns, patch, expectedRevision)`。
 * 命名空间 = 本包 patch **条目 id** = 包名（`cordis.patch.yml` 的 `id` 逐字）。
 *
 * 2026-10-12（009 收口轮 T3）追加第二条写路：`mutate(ns, ops, expectedRevision)`。它**不是**
 * 「又一个 update」—— 它按**路径**编辑（`{op:'set'|'unset', path}`），专门用来「不改写脱敏后的机密值
 * 就能改动其它字段 / 把机密字段删掉」（宿主原文：`Apply field edits without restating redacted secrets`）。
 * 「清除凭据」正是它唯一的用户（理由见 `UNSET_WRITE_TOKEN_OPS`）。实参个数同 `update`：**恒 3**。
 *
 * ## 为什么单独一层
 *
 * 三个理由，都不是「好看」：
 * 1. **可断言**：「区间/勾选写回只改配置、零提权调用」（T5.7）需要在**唯一一处**数
 *    `update` 的调用次数与参数；散在各组件里就没法二值判定。
 * 2. **不重挂载**：live 字段只经 `update`（005/003 的既定口径）；这里绝不碰
 *    `configEditor.edit()`（完整配置路径会重挂载 ⇒ 在途提权任务丢失）。
 * 3. **不手写 YAML**：本模块**没有**字符串拼 YAML 的代码 —— patch 是结构化对象。
 *
 * ## 结构性事实（测试静态断言）
 *
 * 本文件的源码里**不出现** `portproxy` / `invoke` / `Start-Process` / `gsudo`：
 * 它是「配置写回」与「提权写」之间的一道**语法级**隔离，不只是调用顺序上的约定。
 *
 * ## 失败是**结果**不是抛（2026-10-12 缺陷 4 的结构性修复）
 *
 * `write()` 的每一步（`describe` / `update`）都包在 try/catch 里，宿主抛出的任何错误都化成
 * `{ ok:false, message }` 返回给页面。修前的真机现象是：`update` 抛错（实参个数不对）而调用方
 * 没接 ⇒ 浏览器控制台只有 `Uncaught (in promise)`、页面**零提示**、也没改任何状态。
 */

import type { Scope } from '../diff/types.ts';
import type { ElevationPolicyValue } from '../wire.ts';
import type { RemoteSettingsLike, SettingsPathOp, SettingsResponse } from './host.ts';

/** 命名空间 = patch 条目 id（同时是包名，见 `cordis.patch.yml`） */
export const SETTINGS_NAMESPACE = 'dsh-wsl-docker-ports';

/**
 * 提权策略与作用域的字面量**不在这里另立一份**：
 * - `ElevationPolicyValue` 来自传输契约（`../wire.ts`，宿主与客户端共用同一组值）；
 * - `ScopeValue` 就是五态引擎的 `Scope`（`loopback | lan`）。
 * 两处各写一份是「改了一边忘了另一边」的经典入口。
 */
export type { ElevationPolicyValue } from '../wire.ts';
export type ScopeValue = Scope;

/** 结构化 patch（绝不拼字符串 YAML） */
export interface SettingsPatch {
  readonly managedPorts?: readonly string[];
  readonly distro?: string;
  readonly elevationPolicy?: ElevationPolicyValue;
  readonly scopes?: Readonly<Record<string, ScopeValue>>;
  /**
   * 012：逐端口监听地址（键 = 端口号字符串，值 = 选中的 IPv4 / 缺省 `0.0.0.0`）。
   * 用户在下拉里换一次就写一次 —— **不批量、不延迟**（刷新后靠它回填）。
   */
  readonly listenAddresses?: Readonly<Record<string, string>>;
  /**
   * 写通道凭据（008 T3.1 契约 1）。**默认仍为空**：本文件不会自动生成它，
   * 只有用户在配置页点「生成并保存写通道凭据」才会带上这个字段
   * （`write-token.ts` 的 `issueWriteToken()` 负责生成与一次性展示）。
   */
  readonly writeToken?: string;
  /**
   * 014：自动刷新频次（秒；`0` = 关闭）。右栏页顶部选择器选一次写一次，
   * 刷新页面后由 `readConfig()` 回填；服务端不消费它。
   */
  readonly refreshIntervalSec?: number;
}

export interface SettingsWriteResult {
  readonly ok: boolean;
  readonly message: string;
  /** 实际发出的 patch（断言「只改这一项」用） */
  readonly patch: SettingsPatch;
  /** 是否带上了 `expectedRevision`（并发写保护） */
  readonly revisionPassed: boolean;
}

/**
 * 「清除凭据」的结果（009 收口轮 T3）。
 *
 * 🔴 `writeTokenConfigured` **不是内存推断**：它的来源是 `mutate` 的**返回值** —— 宿主
 * `dsh-api-settings-controller` 的 `write()` 在落盘后**重新** `describe({redactSecrets:true})`
 * 并返回 `namespaceView(descriptor)`（`lib/types/index.js:214-220`），即**写入后的新脱敏视图**。
 * 所以「刷新页面再读一次」与「看这个字段」是同源的两条路 ⇒ 页面显示与写通道实际状态结构性一致。
 * `null` = 没拿到视图（失败/缺服务）⇒ 调用方**不猜**，保持原状。
 */
export interface SettingsClearResult {
  readonly ok: boolean;
  readonly message: string;
  readonly writeTokenConfigured: boolean | null;
  readonly revisionPassed: boolean;
  /** 实际发出的 ops（断言「只发这一条 unset」用） */
  readonly ops: readonly SettingsPathOp[];
}

/**
 * 「清除凭据」发的**唯一** ops：把 `writeToken` 从 user 段 `unset` 掉。
 *
 * 为什么不是 `update({writeToken: ''})`：宿主 `walk()` 的 `set: value !== void 0` 对**空串**仍判
 * `true`（`dsh-settings/lib/index.js:24-29`）⇒ 清除后重载页面会显示「已配置」而写通道实际 401。
 * 冻结这份常量，让「只发这一条、且是 unset」是可断言的同一性（而不是每次现造一个新对象）。
 */
export const UNSET_WRITE_TOKEN_OPS: readonly SettingsPathOp[] = Object.freeze([
  Object.freeze({ op: 'unset' as const, path: Object.freeze(['writeToken']) }),
]);

/** 读回来的配置（全部可选：用户可能什么都没配） */
export interface SettingsConfigView {
  readonly managedPorts: readonly string[];
  readonly distro: string | undefined;
  readonly elevationPolicy: ElevationPolicyValue | undefined;
  readonly scopes: Readonly<Record<string, ScopeValue>>;
  /**
   * 服务端 config 里 `writeToken` **是否已配置**（009 REQ-1.3 的「绝不回显既有值」）。
   *
   * 🔴 这是一个**布尔**，不是字符串：值本体在下面 `readConfig()` 里被就地化成 `true/false` 后**丢弃**，
   * 结构上不存在「把既有凭据交给 UI」的路径 ⇒ 页面无法回显它（不是「记得别渲染」的自觉，而是没有入口）。
   * 空串（含纯空白）一律算「未配置」，与 `../transport/write-auth.ts` 的 `trim` 口径一致。
   *
   * 🔴 **权威来源是 `secrets[]` 而不是 `value`**：`writeToken` 在 `Config` 里标了 `.role('secret')`，
   * 宿主 `describe()` 一律 `redactSecrets: true` ⇒ 字段从 `value` 里被摘掉，只在
   * `secrets: [{ path: ['writeToken'], set }]` 留布尔（`dsh-api-settings-controller` 的
   * `namespaceView()` 逐字保留 `secrets`）⇒ 只能从那里读。（`value.writeToken` 作为兜底保留：
   * 未脱敏的调用方/测试替身仍然可用，且两条路径都只产出布尔。）
   */
  readonly writeTokenConfigured: boolean;
  /** 014：自动刷新频次（秒；`0` = 关闭）。缺省/非法值在 `readConfig()` 里化成 `0`。 */
  readonly refreshIntervalSec: number;
}

export interface SettingsPipe {
  readConfig(): Promise<SettingsConfigView>;
  writeManagedPorts(decls: readonly string[]): Promise<SettingsWriteResult>;
  writeDistro(name: string): Promise<SettingsWriteResult>;
  writeElevationPolicy(policy: ElevationPolicyValue): Promise<SettingsWriteResult>;
  writeScope(port: number, scope: ScopeValue): Promise<SettingsWriteResult>;
  /**
   * 012：逐端口监听地址写回（选一次写一次）。空串/缺省由调用方归一化成 `0.0.0.0`。
   */
  writeListenAddress(port: number, address: string): Promise<SettingsWriteResult>;
  /**
   * 写通道凭据写回（008 T3.1）：**只写配置，不经提权、不发请求**。
   * 调用方（配置页）负责生成与「只显示一次」，本层不读回、不缓存、不打印凭据。
   */
  writeWriteToken(token: string): Promise<SettingsWriteResult>;
  /**
   * 清除写通道凭据（009 收口轮 T3）：走宿主 `settings.mutate(ns, [{op:'unset',path:['writeToken']}], rev)`
   * —— **不写空串**（理由逐字见 `UNSET_WRITE_TOKEN_OPS`）。返回的 `writeTokenConfigured` 取自
   * `mutate` 的**返回值**（= 写入后的新脱敏视图），调用方据此更新布尔，不靠内存推断。
   */
  clearWriteToken(): Promise<SettingsClearResult>;
  /**
   * 014：自动刷新频次写回（`0` 或 `15/30/60/300` 秒）。只写配置，
   * **不启动定时器**（轮询在 chunk 侧，主包不新增任何 `setInterval`）。
   */
  writeRefreshInterval(sec: number): Promise<SettingsWriteResult>;
  /** `update` 的真实调用次数（测试断言；「零提权调用」由提权侧计数器给出）。**清除走 `mutate`，不计入** —— 两个口径不混 */
  updateCount(): number;
}

/** 把任何抛出物化成一行可读原因（缺陷 4：页面要显示原因，不是显示「出错了」） */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** 从 `describe()` 里取本命名空间的**整条记录**（形如 `{ namespaces: [{ ns, value, secrets }] }`） */
export function namespaceEntry(described: SettingsResponse, namespace: string = SETTINGS_NAMESPACE): Record<string, unknown> | undefined {
  const value = asRecord(described.value);
  const namespaces = value?.['namespaces'];
  if (!Array.isArray(namespaces)) return undefined;
  for (const entry of namespaces) {
    const record = asRecord(entry);
    if (record?.['ns'] === namespace) return record;
  }
  return undefined;
}

/** 从 `describe()` 里取本命名空间的当前值（形如 `{ namespaces: [{ ns, value }] }`） */
export function namespaceValue(described: SettingsResponse, namespace: string = SETTINGS_NAMESPACE): unknown {
  return namespaceEntry(described, namespace)?.['value'];
}

/**
 * 凭据「已配置」的**权威读法**：宿主 `describe()` 一律 `redactSecrets: true`，把
 * `role('secret')` 字段（本包的 `writeToken`）从 `value` 里摘掉，只在
 * `secrets: [{ path: ['writeToken'], set: boolean }]` 里留布尔 —— 所以生产环境只能从这里读。
 * 🔴 只回布尔：**没有任何路径**把凭据本体带出本函数（REQ-1.3）。
 */
function readSecretSet(entry: Record<string, unknown> | undefined): boolean {
  const secrets = entry?.['secrets'];
  if (!Array.isArray(secrets)) return false;
  return secrets.some((item) => {
    const record = asRecord(item);
    const path = record?.['path'];
    if (!Array.isArray(path)) return false;
    return path[path.length - 1] === 'writeToken' && record?.['set'] === true;
  });
}

/**
 * 取并发写保护用的 revision。
 * 官方 `update(ns, patch, expectedRevision)` 的 revision 来源未在 contract 里逐字给出形状，
 * 故**防御性**地按 `value.revision` → `namespaces[].revision` → `namespaces[].value.revision`
 * 三级找（2026-10-12 真机 `describe` 的权威形状是 `namespaces[].revision: number` ⇒ 命中第二级）。
 *
 * 🔴 **取不到时仍然要把第三个实参传成 `undefined`**（不是「不带」）：宿主 `prepareInvocation`
 * 数的是 `values.length`，少一个实参直接抛 `client api: … expected 3 argument(s), got 2`
 * （2026-10-12 真机原话，缺陷 2）；而 `expectedRevision` 的 codec 是 `union([_undefined(), number()])`
 * 且 `acceptsUndefined: true` ⇒ 显式 `undefined` 合法，投影时被丢弃 = 语义仍是「无条件写」。
 */
export function revisionOf(described: SettingsResponse, namespace: string = SETTINGS_NAMESPACE): unknown {
  const value = asRecord(described.value);
  if (value === undefined) return undefined;
  if (value['revision'] !== undefined) return value['revision'];
  const namespaces = value['namespaces'];
  if (!Array.isArray(namespaces)) return undefined;
  for (const entry of namespaces) {
    const record = asRecord(entry);
    if (record?.['ns'] !== namespace) continue;
    if (record['revision'] !== undefined) return record['revision'];
    const inner = asRecord(record['value']);
    if (inner?.['revision'] !== undefined) return inner['revision'];
  }
  return undefined;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function readScopes(value: unknown): Record<string, ScopeValue> {
  const record = asRecord(value);
  const scopes: Record<string, ScopeValue> = {};
  if (record === undefined) return scopes;
  for (const [key, raw] of Object.entries(record)) {
    if (raw === 'loopback' || raw === 'lan') scopes[key] = raw;
  }
  return scopes;
}

/**
 * 012：**刻意不从 `describe()` 读回 `listenAddresses`** —— 回填下拉的那份值走快照
 * （`snapshot.listenAddresses`，服务端现读配置）⇒ 客户端只有「写」这一条路，
 * 不存在两份可能分叉的镜像（也让主包零额外字节）。
 */

/**
 * 造写回管道。`getSettings` 是**惰性软取**（contract §D13：`ctx.get('remote.settings')`
 * 可能晚于本插件就绪，故每次写入时再取一次，不缓存 `undefined`）。
 */
export function createSettingsPipe(getSettings: () => RemoteSettingsLike | undefined, namespace: string = SETTINGS_NAMESPACE): SettingsPipe {
  let updateCount = 0;

  async function write(patch: SettingsPatch): Promise<SettingsWriteResult> {
    const service = getSettings();
    if (service === undefined) {
      return { ok: false, message: '宿主未提供 remote.settings：配置写回不可用（只读展示不受影响）', patch, revisionPassed: false };
    }
    let described: SettingsResponse;
    try {
      described = await service.describe();
    } catch (error) {
      return { ok: false, message: `读取配置失败：${errorText(error)}`, patch, revisionPassed: false };
    }
    const revision = revisionOf(described, namespace);
    updateCount += 1;
    try {
      // 🔴 实参个数**恰好 3**（缺陷 2）：`revision === undefined` 时也必须显式占位，
      // 宿主按 `values.length` 校验（少一个直接抛，连请求都发不出去）。
      const result = await service.update(namespace, patch, revision);
      if (result.ok) return { ok: true, message: '配置已写入（live 路径，不重挂载）', patch, revisionPassed: revision !== undefined };
      return { ok: false, message: `配置写入失败：${String(result.error ?? '未知原因')}`, patch, revisionPassed: revision !== undefined };
    } catch (error) {
      // 失败是**结果**不是抛（缺陷 4）：页面拿到可读原因；本次不重试、不改任何状态。
      return { ok: false, message: `配置写入抛出异常：${errorText(error)}（未改动任何状态，且不重试）`, patch, revisionPassed: revision !== undefined };
    }
  }

  return {
    async readConfig(): Promise<SettingsConfigView> {
      const service = getSettings();
      if (service === undefined) return { managedPorts: [], distro: undefined, elevationPolicy: undefined, scopes: {}, writeTokenConfigured: false, refreshIntervalSec: 0 };
      const entry = namespaceEntry(await service.describe(), namespace);
      const value = asRecord(entry?.['value']);
      const distro = value?.['distro'];
      const policy = value?.['elevationPolicy'];
      // 🔴 既有凭据**只**被化成布尔，`raw` 不参与返回值构造（REQ-1.3：绝不回显既有值）。
      // 两条读法都是**降级到布尔**，且都不带值出函数：
      // ① 权威路径 = `secrets[{path:['writeToken'], set}]`（宿主 `redactSecrets: true` ⇒ `value` 里没有它）；
      // ② 兜底路径 = `value.writeToken` 是字符串（未脱敏的调用方/测试替身）。
      const writeToken = value?.['writeToken'];
      return {
        managedPorts: readStringArray(value?.['managedPorts']),
        distro: typeof distro === 'string' ? distro : undefined,
        elevationPolicy: policy === 'none' || policy === 'ask' || policy === 'passby' ? policy : undefined,
        scopes: readScopes(value?.['scopes']),
        writeTokenConfigured: readSecretSet(entry) || (typeof writeToken === 'string' && writeToken.trim() !== ''),
        refreshIntervalSec: Number(value?.['refreshIntervalSec']) || 0,
      };
    },
    writeManagedPorts: (decls) => write({ managedPorts: [...decls] }),
    writeDistro: (name) => write({ distro: name }),
    writeElevationPolicy: (policy) => write({ elevationPolicy: policy }),
    writeScope: (port, scope) => write({ scopes: { [String(port)]: scope } }),
    writeListenAddress: (port, address) => write({ listenAddresses: { [String(port)]: address } }),
    writeWriteToken: (token) => write({ writeToken: token.trim() }),
    writeRefreshInterval: (sec) => write({ refreshIntervalSec: sec }),
    async clearWriteToken(): Promise<SettingsClearResult> {
      const ops = UNSET_WRITE_TOKEN_OPS;
      const failed = (message: string, revisionPassed: boolean): SettingsClearResult => ({
        ok: false,
        message,
        writeTokenConfigured: null,
        revisionPassed,
        ops,
      });
      const service = getSettings();
      if (service === undefined) {
        return failed('宿主未提供 remote.settings：服务端凭据**没有**清（本会话不动，避免两边不一致）', false);
      }
      let described: SettingsResponse;
      try {
        described = await service.describe();
      } catch (error) {
        return failed(`清除前读配置失败：${errorText(error)}`, false);
      }
      const revision = revisionOf(described, namespace);
      // 🔴 实参**恰好 3 个**（宿主 `prepareInvocation` 数 `values.length`）⇒ revision 取不到也要显式占位。
      try {
        const result = await service.mutate(namespace, ops, revision);
        if (result.ok !== true) {
          return failed(`清除失败：${String(result.error ?? '宿主未给出原因')}（未改动任何状态，且不重试）`, revision !== undefined);
        }
        // 布尔取自**服务端写入后的新视图**（`namespaceView(descriptor)`），与「刷新后再 describe 一次」同源。
        const configured = readSecretSet(namespaceEntry(result, namespace));
        return {
          ok: true,
          message: configured
            ? '本会话凭据已清掉；但服务端写入后的视图仍报 writeToken **已配置**（该值来自更外层配置，unset 只能作用于 user 段）⇒ 写通道继续按它鉴权。'
            : '已清除：服务端 writeToken 已 unset（回到 fail-safe：plan / apply / audit 一律 401），本会话凭据同时清掉（本地拦下、零请求）。',
          writeTokenConfigured: configured,
          revisionPassed: revision !== undefined,
          ops,
        };
      } catch (error) {
        return failed(`清除时抛出异常：${errorText(error)}（未改动任何状态，且不重试）`, revision !== undefined);
      }
    },
    updateCount: () => updateCount,
  };
}
