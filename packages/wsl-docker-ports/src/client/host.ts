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
import type { WriteWiring } from './write-channel.ts';
import type { StorageLike, WriteTokenStore } from './write-token.ts';

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
 * guide 页上的一枚入口胶囊（**官方形状**，离线实物 `0.1.7-rc.2`
 * `deepseek-ai-dsh-client-ui-sidebar-right-0.1.7-rc.2.tgz`
 * → `package/lib/types/client/tab-registry.d.ts:45-67` 的 `SidebarRightGuideEntry`）：
 * `id` / `order` / `title()` 必填；`description()` / `icon` / `commandId` 可选。
 *
 * 注册表在 `refresh()`（同包 `lib/client.js:8845-8849`）里给每条补上 `kind` / `providerId`
 * 并按 `order` 升序排；`GuideBody` 对每条渲染一张卡片，点它 = `openTab(kind, {replaceTab:true})`。
 * ⇒ **没有这一项，页就只存在于 `openTab` 之后，用户在右栏空态里点不到它。**
 */
export interface SidebarRightGuideEntryLike {
  /** 提供方内稳定 id（同一定义内重复 ⇒ 官方 `register` 直接抛错） */
  readonly id: string;
  /** 全部类型入口之间的升序位次 */
  readonly order: number;
  /** 胶囊标题（**thunk**：官方每次使用都重读，换语言无需重注册） */
  readonly title: () => string;
  /** 标题下一行说明（条目少时才显示；故实现必须能只靠 `title` 站住） */
  readonly description?: () => string;
}

/**
 * 右栏页类型定义。
 * 官方签名（contract §C9，0.1.7-rc.2 `SidebarRightTabDefinition`，实物
 * `package/lib/types/client/tab-registry.d.ts:74-120`）：
 * `id` / `kind` / `title(address)` 必填；`priority` **留空** = `'extension'` 档（第三方不抢官方 band）；
 * `guide` 是**空态入口**（官方 `files` 与 `terminal` 两家都注册了它）。
 */
export interface SidebarRightTabDefinitionLike {
  readonly id: string;
  readonly kind: string;
  readonly title: (address: string) => string;
  readonly multiple?: boolean;
  readonly keepMounted?: boolean;
  readonly priority?: 'extension' | 'builtin' | 'fallback';
  readonly guide?: readonly SidebarRightGuideEntryLike[];
}

/** `ctx.sidebarRightTabs`：`register(definition): () => void`（幂等 disposer，contract §C9） */
export interface SidebarRightTabsServiceLike {
  register(definition: SidebarRightTabDefinitionLike): () => void;
}

/**
 * `ctx.sidebarRight`（**只声明本包真正用到的两个成员**；服务名 `sidebarRight`）。
 *
 * 🔴 `openTab` 的存在本身就是一条真机事实：**注册页类型 ≠ 出现页签**。
 * 0.2.0-rc.2 实物 `@deepseek-ai/dsh-client-ui-sidebar-right` 的 `SidebarRightController`：
 *
 * - `register(definition)`（`ctx.sidebarRightTabs`）只把类型放进注册表并刷 `guide()`，
 *   它**不创建任何 tab** —— tab 是布局记录（`dsh.sidebar-right.v1.session-*` 的 `layout.tabs`），
 *   只由 `openTab` / guide 胶囊 / `defaultSeed` 三条路产生；
 * - `openTab(kind, options)` → `require()` → 没有在屏会话时**抛** `sidebarRight: no session surface is mounted`
 *   （故本包调用点必须 try/catch，并在 `mounted` 变化后重试一次）；
 * - `mounted` 是 `sessions.onScreen` 的快照 store（`{getSnapshot, subscribe}`），就是 `require()` 读的那个。
 */
export interface SidebarRightServiceLike {
  openTab(kind: string, options?: { readonly revealIfOpened?: boolean }): void;
  readonly mounted?: {
    getSnapshot(): string | undefined;
    subscribe(listener: () => void): () => void;
  };
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
 * 一条**路径编辑**（宿主 `SettingsPathOp`）。逐字来源：`dsh-api-settings-controller/lib/typert.host.js`
 * 的 `settings/mutate` 参数 1 schema —— `z.union([z.object({op: z.literal('set'), path: z.array(z.string()),
 * value: <JsonValue>}), z.object({op: z.literal('unset'), path: z.array(z.string())})])`
 * （`lib/typert.remote-client.d.ts:19` 的 `mutate(ns, ops: SettingsPathOpView[], expectedRevision)`）。
 */
export type SettingsPathOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] };

/**
 * `ctx.get('remote.settings')`（contract §D13）。
 * **配置写回的唯一管道**：客户端没有 `ctx.settings` / `ctx.configEditor`。
 */
export interface RemoteSettingsLike {
  describe(): Promise<SettingsResponse>;
  update(ns: string, patch: unknown, expectedRevision?: unknown): Promise<SettingsResponse>;
  /**
   * 路径编辑（009 收口轮 T3 起本包用到）。宿主原文逐字：**`Apply field edits without restating
   * redacted secrets; unsetting an array index removes its element.`**
   * （`dsh-settings/lib/index.js:483`；实现 L488-500）
   *
   * 🔴 **「清除凭据」只许走这里**，不许写空串：宿主 `walk()` 判 `secrets[].set` 的依据是
   * `set: value !== void 0`（`dsh-settings/lib/index.js:24-29`）——**空串照样 `!== undefined`** ⇒
   * 写空串后 `describe()` 仍报 `set:true`，页面显示「已配置」而写通道实际 401（**用户可见状态不一致**）。
   * `unset` 把字段从 user 段真的删掉 ⇒ `set:false`（若该值来自更外层配置，宿主会按 `base` 还原它 ——
   * 那种情况下「仍已配置」是**真话**，客户端照实显示）。
   *
   * 实参**恒 3 个**：与 `update` 同一条宿主校验（`prepareInvocation` 数 `values.length`，
   * 真机原话 `client api: settings/mutate expected 3 argument(s), got 2` 的那条规则）。
   */
  mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: unknown): Promise<SettingsResponse>;
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
  /**
   * 008 写通道整包（T3.1）：宿主路由的 `plan`/`apply` 客户端 + 凭据仓库 + 所有权声明读取器。
   * `undefined` ⇒ 页面上的写控件置灰并写明原因（**不是**报错：只读面与配置面照常可用）。
   */
  readonly write?: WriteWiring | undefined;
}

/**
 * 定时器面（**可注入**，缺省用全局 `setTimeout` / `clearTimeout`）。
 * 存在的理由只有一个：pending 宽限窗口要能被**确定性**测试（假时钟推进到边界，不 sleep）。
 */
export interface ClientTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
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
  /**
   * pending 告警的**宽限窗口**（ms），缺省 `2000`。
   *
   * 语义（照真机事实定）：右栏两个服务**晚到数百 ms 是常态**（实测 `@1051ms` 还是 `undefined`、
   * `@1317ms` 到齐）⇒ 窗口内到位**一条 warn 都不打**；超过窗口仍在等才 warn（那时才真值得看）。
   * 传负数（如 `-1`）= **不排定该告警**（真缺服务仍有 `sidebar-right-unavailable` 那条即时 warn 兜底）。
   */
  readonly pendingWarnMs?: number;
  /** 注入定时器（测试用假时钟）；默认全局 `setTimeout` / `clearTimeout` */
  readonly timers?: ClientTimers;
  readonly elevation?: ElevationInvoker;
  readonly exec?: ExecServiceLike;
  /**
   * 008 T3.1：显式注入的写通道整包（测试/集成方）；给了就用它，
   * 否则由 `index.ts` 用 `settings` + `tokenStorage` 现造一个。
   */
  readonly write?: WriteWiring;
  /**
   * 008 T3.1：凭据存储（缺省 = 真 `localStorage`：**重启后仍可用**，019 D3；取不到降级
   * `sessionStorage` → **内存**实现）。测试注入假件即可在无 DOM 下断言「存了什么」。
   */
  readonly tokenStorage?: StorageLike;
  /** 便于断言「仓库里到底有什么」；不传时由 `index.ts` 按 `tokenStorage` 造 */
  readonly tokenStore?: WriteTokenStore;
}
