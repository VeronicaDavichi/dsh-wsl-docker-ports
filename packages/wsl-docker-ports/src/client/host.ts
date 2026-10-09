/**
 * 客户端半的**宿主面**（窄接口，自带口径）—— 003 Phase 5 / T5.1–T5.8
 *
 * ## 为什么自带窄接口而不是 import 官方包
 *
 * 官方 `@deepseek-ai/*` 在本机是**悬空 junction**（源码读不到）、`app.asar` 禁读
 * ⇒ 像本包 Phase 1–4 一样自带接口。每一条都在注释里注明对应的官方签名与
 * `client-contract.md` 的出处，好让「读不到源码」不变成「口径无人对账」。
 *
 * ## 只声明用得到的成员
 *
 * 窄接口的好处是**不会假装知道更多**：这里没有 `ctx.pages`、没有 `ctx.settings`、
 * 没有 `ctx.configEditor` —— 客户端 ctx 里本来就没有它们（contract §D12）。
 */

import type { Scope } from '../diff/types.ts';
import type { FetchLike, PortsSnapshot } from '../wire.ts';
import type { SettingsPipe } from './settings-pipe.ts';

/**
 * 目标发行版面板的数据（T5.8）。T6.8 起家搬到宿主侧的 `../wire.ts`（它是传输契约的一部分），
 * 这里**转出**以保持客户端既有的 `from './host.ts'` import 不变。
 */
export type { DistroPanelData } from '../wire.ts';

/** 客户端入口模块的模块级 `inject`（**Cordis 服务名**，不是包名 —— contract §B5 / §P5） */
export const CLIENT_SERVICES: readonly string[] = ['slots'];

/** 右栏页服务名（软取；缺失 ⇒ 不注册 + 给原因，绝不抛） */
export const SIDEBAR_TAB_SERVICE = 'sidebarRightTabs';
export const SIDEBAR_SERVICE = 'sidebarRight';

/**
 * 槽注册 options。
 * 官方签名（contract §P4 / §C10）：`ctx.slots.register(options, Component)` —— **两个位置参数**，
 * `name` 在 options 内（写成 `(name, id, Component)` 编译不过）。
 */
export interface SlotRegisterOptions {
  /** 槽位置名，如 `sidebar.right.pane.tab`（keyed 槽必须给 `key`） */
  readonly name: string;
  readonly key?: string;
  readonly id?: string;
  readonly order?: number;
  readonly label?: string;
}

/** `ctx.slots`（contract §C10）：`inject(NAME, cb)` 与 `register(options, Component)` 都返回 disposer */
export interface SlotsServiceLike {
  register(options: SlotRegisterOptions, Component: unknown): () => void;
  inject(name: string, callback: () => (() => void) | void): () => void;
}

/**
 * 右栏页类型定义。
 * 官方签名（contract §C9，0.1.7-rc.2 `SidebarRightTabDefinition`）：
 * `id` / `kind` / `title(address)` 必填；`priority` **留空** = `'extension'` 档（第三方不抢官方 band）。
 */
export interface SidebarRightTabDefinitionLike {
  readonly id: string;
  readonly kind: string;
  readonly title: (address: string) => string;
  readonly multiple?: boolean;
  readonly keepMounted?: boolean;
  readonly priority?: 'extension' | 'builtin' | 'fallback';
}

/** `ctx.sidebarRightTabs`：`register(definition): () => void`（幂等 disposer，contract §C9） */
export interface SidebarRightTabsServiceLike {
  register(definition: SidebarRightTabDefinitionLike): () => void;
}

/**
 * 客户端 ctx 的最小面（contract §B6：`get` / `inject` / `effect` 都在）。
 * 三个成员都写成可选：**测试与降级路径都要能在没有它们的 ctx 上跑**，
 * 而生产上 `slots` 由模块级 `inject` 保证存在。
 */
export interface ClientContextLike {
  readonly get?: (name: string) => unknown;
  readonly inject?: (names: readonly string[], callback: (scope: ClientContextLike) => void) => unknown;
  readonly effect?: (callback: () => (() => void) | void, label?: string) => unknown;
}

/** `remote.settings` 的返回（contract §D13 逐字：`{ ok, value, error }`） */
export interface SettingsResponse {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}

/**
 * `ctx.get('remote.settings')`（contract §D13）。
 * **配置写回的唯一管道**：客户端没有 `ctx.settings` / `ctx.configEditor`。
 */
export interface RemoteSettingsLike {
  describe(): Promise<SettingsResponse>;
  update(ns: string, patch: unknown, expectedRevision?: unknown): Promise<SettingsResponse>;
}

/** 转发写动作（004/005 侧实现；本 Spec 的 UI 只负责触发与展示结果） */
export type ForwardAction = 'apply' | 'remove' | 'fix-drift' | 'switch-scope';

export interface ForwardWriteRequest {
  readonly action: ForwardAction;
  /** **逐端口**（REQ-2.4：没有隐式批量入口） */
  readonly port: number;
  readonly scope: Scope;
}

/** 写路径回执（005 的 `ElevateStatus` 的子集 + 逐步结果，用于「失败时报未改项」） */
export interface ForwardWriteReport {
  readonly status: 'ok' | 'partial' | 'failure' | 'precondition' | 'elevation-failed' | 'cancelled';
  readonly message: string;
  readonly steps: readonly { readonly name: string; readonly ok: boolean; readonly stderr: string }[];
}

/**
 * 提权写入口（005）。
 *
 * 🔴 **本接口的存在本身就是一条断言**：配置写回（`managedPorts` / `distro` / `scope`）
 * **绝不**经过它 —— 测试给一个计数 fake，写回后断言调用数 = 0（T5.3 / T5.7 / T5.8）。
 */
export interface ElevationInvoker {
  run(request: ForwardWriteRequest): Promise<ForwardWriteReport>;
}

/**
 * 002 的 `managedTerminal` 服务（**只按字符串键软取**，REQ-10.2：不建包依赖边、不 import 002）。
 * 本期（P0）**只落注入点**：控件禁用 + 「下一期」原因；服务缺失也不报错（REQ-10.3）。
 */
export interface ExecServiceLike {
  readonly available: boolean;
  open(port: number): void;
}

/** 刷新时用到的只读快照来源。**不含任何写动作**（NFR-2：开页零副作用）。 */
export interface PortsSource {
  load(options?: { readonly allowColdStart?: boolean }): Promise<PortsSnapshot>;
}

/** 客户端半的运行期依赖（`apply(ctx, options)` 组装；测试全部注入 fake） */
export interface ClientRuntime {
  readonly source: PortsSource;
  /**
   * 配置写回管道（**不是**裸的 `remote.settings`）。
   * 组件只能看到 `writeManagedPorts` / `writeDistro` / `writeScope` / `writeElevationPolicy`
   * 这四个方法 ⇒ 「配置写」与「提权写」在**类型层**就是两条路（`elevation` 是另一个字段）。
   */
  readonly settings: SettingsPipe | undefined;
  readonly elevation: ElevationInvoker | undefined;
  readonly exec: ExecServiceLike | undefined;
}

/** `apply()` 的可选注入（宿主侧数据通道由集成方接线；缺失 ⇒ 不注册 + 给原因） */
export interface ClientApplyOptions {
  /** 显式注入的只读来源（测试/集成方）；给了就用它，**不再**走自建路由 */
  readonly source?: PortsSource;
  /**
   * 自建路由来源的同源基址（默认 `''` = 同源）。
   * 显式传 `null` = **不启用**路由来源（此时若无 `source` ⇒ `ports-source-missing` 降级）。
   */
  readonly routeBaseUrl?: string | null;
  /** 注入 fetch（测试用）；默认全局 `fetch` */
  readonly fetchImpl?: FetchLike;
  readonly elevation?: ElevationInvoker;
  readonly exec?: ExecServiceLike;
}
