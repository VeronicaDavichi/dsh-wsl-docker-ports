/**
 * 容器包的配置写回薄管道（016；从转发包的同名文件按**容器侧字段集**收窄）
 *
 * ## 唯一管道（与转发侧同一套宿主协议，口径不另立）
 *
 * 客户端没有 `ctx.settings` / `ctx.configEditor`；写配置只能走 `ctx.get('remote.settings')` 的
 * `describe()` + `update(ns, patch, expectedRevision)` + `mutate(ns, ops, revision)`。
 * 命名空间 = **容器侧** patch 条目 id = `dsh-wsl-docker-containers`（不是包名以外的任何东西）。
 *
 * ## 与转发侧管道**共用协议、不共用命名空间**
 *
 * | 口径 | 转发侧 | 容器侧（本文件） |
 * | --- | --- | --- |
 * | 命名空间 | `dsh-wsl-docker-ports` | `dsh-wsl-docker-containers` |
 * | 字段 | 7 个 | `distro` / `writeToken` / `refreshIntervalSec`（+ 只读的 `?`） |
 * | 凭据 | 自己的 `writeToken` | **自己的** `writeToken`（互不通用 ⇒ 一个 token 打另一侧是 401） |
 *
 * 🔴 **实参个数恒 3**：宿主 `prepareInvocation` 按 `values.length` 校验，少一个直接抛
 * （2026-10-12 真机原话 `expected 3 argument(s), got 2`）；`expectedRevision` 取不到也要显式占位 `undefined`。
 *
 * 🔴 **清除凭据走 `mutate` 的 `unset`，不写空串**：宿主 `walk()` 的 `set: value !== void 0` 对空串仍判
 * `true` ⇒ 写空串会让页面显示「已配置」而写通道实际 401。
 *
 * ## 失败是**结果**不是抛
 *
 * 每一步都包在 try/catch 里，宿主抛出的任何错误都化成 `{ ok:false, message }` 返回给页面。
 */

import type { RemoteSettingsLike, SettingsPathOp, SettingsResponse } from './host.ts';

/** 命名空间 = 容器侧 patch 条目 id（**与包名逐字一致**） */
export const SETTINGS_NAMESPACE = 'wsl-containers';

/** 结构化 patch（绝不拼字符串 YAML） */
export interface SettingsPatch {
  readonly distro?: string;
  /** 写通道凭据（容器侧自己的；默认仍为空，只有点「生成并保存」才会带上） */
  readonly writeToken?: string;
  /** 自动刷新频次（秒；`0` = 关闭）。选择器在右栏页顶部；服务端不消费它。 */
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

export interface SettingsClearResult {
  readonly ok: boolean;
  readonly message: string;
  /** 清除后服务端报的「是否仍配置」；`null` = 没读到（不清、不猜） */
  readonly writeTokenConfigured: boolean | null;
  readonly revisionPassed: boolean;
  readonly ops: readonly SettingsPathOp[];
}

/**
 * 「清除凭据」发的**唯一** ops：把 `writeToken` 从 user 段 `unset` 掉（理由见文件头）。
 * 冻结这份常量，让「只发这一条、且是 unset」是可断言的同一性。
 */
export const UNSET_WRITE_TOKEN_OPS: readonly SettingsPathOp[] = Object.freeze([
  Object.freeze({ op: 'unset' as const, path: Object.freeze(['writeToken']) }),
]);

/** 读回来的配置（全部可选：用户可能什么都没配） */
export interface SettingsConfigView {
  readonly distro: string | undefined;
  /**
   * 服务端 config 里 `writeToken` **是否已配置**（绝不回显既有值）。
   * 权威来源是 `secrets[]`（`role('secret')` 字段被宿主从 `value` 摘掉 ⇒ 只剩布尔）。
   */
  readonly writeTokenConfigured: boolean;
  /** 自动刷新频次（秒；`0` = 关闭）。缺省/非法值在这里化成 `0`。 */
  readonly refreshIntervalSec: number;
}

export interface SettingsPipe {
  readConfig(): Promise<SettingsConfigView>;
  writeDistro(name: string): Promise<SettingsWriteResult>;
  /**
   * 写通道凭据写回：**只写配置，不经提权、不发请求**。
   * 调用方（配置页）负责生成与「只显示一次」，本层不读回、不缓存、不打印凭据。
   */
  writeWriteToken(token: string): Promise<SettingsWriteResult>;
  /** 清除写通道凭据：走 `mutate([{op:'unset',path:['writeToken']}])`，**不写空串** */
  clearWriteToken(): Promise<SettingsClearResult>;
  /** 自动刷新频次写回（`0` 或 `15/30/60/300` 秒）。只写配置，**不启动定时器**。 */
  writeRefreshInterval(sec: number): Promise<SettingsWriteResult>;
  /** `update` 的真实调用次数（测试断言）。**清除走 `mutate`，不计入** —— 两个口径不混 */
  updateCount(): number;
}

/** 把任何抛出物化成一行可读原因（页面要显示原因，不是显示「出错了」） */
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

/** 从 `describe()` 里取本命名空间的当前值 */
export function namespaceValue(described: SettingsResponse, namespace: string = SETTINGS_NAMESPACE): unknown {
  return namespaceEntry(described, namespace)?.['value'];
}

/**
 * 凭据「已配置」的**权威读法**：`redactSecrets: true` 把 `role('secret')` 字段从 `value` 摘掉，
 * 只在 `secrets: [{ path: ['writeToken'], set }]` 留布尔 —— 生产环境只能从这里读。
 * 🔴 只回布尔：**没有任何路径**把凭据本体带出本函数。
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
 * 取并发写保护用的 revision（三级防御性查找，口径与转发侧一致）。
 * 🔴 **取不到时仍然要把第三个实参传成 `undefined`**（不是「不带」）：宿主数的是 `values.length`。
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

/**
 * 造写回管道。`getSettings` 是**惰性软取**（`ctx.get('remote.settings')` 可能晚于本插件就绪，
 * 故每次写入时再取一次，不缓存 `undefined`）。
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
      const result = await service.update(namespace, patch, revision);
      if (result.ok) return { ok: true, message: '配置已写入（live 路径，不重挂载）', patch, revisionPassed: revision !== undefined };
      return { ok: false, message: `配置写入失败：${String(result.error ?? '未知原因')}`, patch, revisionPassed: revision !== undefined };
    } catch (error) {
      return { ok: false, message: `配置写入抛出异常：${errorText(error)}（未改动任何状态，且不重试）`, patch, revisionPassed: revision !== undefined };
    }
  }

  return {
    async readConfig(): Promise<SettingsConfigView> {
      const service = getSettings();
      if (service === undefined) return { distro: undefined, writeTokenConfigured: false, refreshIntervalSec: 0 };
      const entry = namespaceEntry(await service.describe(), namespace);
      const value = asRecord(entry?.['value']);
      const distro = value?.['distro'];
      // 🔴 既有凭据**只**被化成布尔（两条读法都降级到布尔，且都不带值出函数）
      const writeToken = value?.['writeToken'];
      return {
        distro: typeof distro === 'string' ? distro : undefined,
        writeTokenConfigured: readSecretSet(entry) || (typeof writeToken === 'string' && writeToken.trim() !== ''),
        refreshIntervalSec: Number(value?.['refreshIntervalSec']) || 0,
      };
    },
    writeDistro: (name) => write({ distro: name }),
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
      try {
        const result = await service.mutate(namespace, ops, revision);
        if (result.ok !== true) {
          return failed(`清除失败：${String(result.error ?? '宿主未给出原因')}（未改动任何状态，且不重试）`, revision !== undefined);
        }
        const configured = readSecretSet(namespaceEntry(result, namespace));
        return {
          ok: true,
          message: configured
            ? '本会话凭据已清掉；但服务端写入后的视图仍报 writeToken **已配置**（该值来自更外层配置，unset 只能作用于 user 段）⇒ 写通道继续按它鉴权。'
            : '已清除：服务端 writeToken 已 unset（回到 fail-safe：动作/日志一律 401），本会话凭据同时清掉（本地拦下、零请求）。',
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
