/**
 * 容器包客户端半的**宿主面**（窄接口，自带口径）—— 016 从转发包的同名文件收窄而来。
 *
 * ## 为什么自带窄接口而不是 import 官方包
 *
 * 官方 `@deepseek-ai/*` 在本机是悬空 junction（源码读不到）、`app.asar` 禁读 ⇒ 与同族插件一样
 * 自带接口，每条在注释里注明对应签名与 `client-contract.md` 的出处。
 *
 * ## 与转发包那份的差异（016 拆包的直接后果）
 *
 * 转发侧那份还要描述「快照源 / 写通道 / 提权 / 终端执行」；容器侧**一个都不需要**
 * （它只有自己的 `settings` + 自己的快照路由 + 三个动作）。
 * 少写一个字段就少一条「以为共享但其实各管各的」的隐患。
 */

import type { SettingsPipe } from './settings-pipe.ts';
import type { StorageLike, WriteTokenStore } from './write-token.ts';

/** 客户端入口模块的模块级 `inject`（**Cordis 服务名**，不是包名 —— contract §B5 / §P5） */
export const CLIENT_SERVICES: readonly string[] = ['slots'];

/** 右栏页服务名（软取；缺失 ⇒ 不注册 + 给原因，绝不抛） */
export const SIDEBAR_TAB_SERVICE = 'sidebarRightTabs';
export const SIDEBAR_SERVICE = 'sidebarRight';

/** 浏览器 `fetch` 的最小面（客户端**唯一**的网络出口形态；测试注入假件） */
export type FetchLike = (input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** 槽注册 options（官方 `ctx.slots.register(options, Component)`，**两个位置参数**） */
export interface SlotRegisterOptions {
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

/** guide 页上的一枚入口胶囊（官方形状；见转发包同名文件的长注释） */
export interface SidebarRightGuideEntryLike {
  readonly id: string;
  readonly order: number;
  readonly title: () => string;
  readonly description?: () => string;
}

/** 右栏页类型定义（`priority` 留空 = `extension` 档，第三方不抢官方 band） */
export interface SidebarRightTabDefinitionLike {
  readonly id: string;
  readonly kind: string;
  readonly title: (address: string) => string;
  readonly multiple?: boolean;
  readonly keepMounted?: boolean;
  readonly priority?: 'extension' | 'builtin' | 'fallback';
  readonly guide?: readonly SidebarRightGuideEntryLike[];
}

/** `ctx.sidebarRightTabs`：`register(definition): () => void`（幂等 disposer） */
export interface SidebarRightTabsServiceLike {
  register(definition: SidebarRightTabDefinitionLike): () => void;
}

/**
 * `ctx.sidebarRight`（**只声明本包真正用到的成员**：`openTab`）。
 *
 * 🔴 真机事实（与转发侧同源）：**注册页类型 ≠ 出现页签** ⇒ 首屏要 `openTab(kind)` 一次。
 */
export interface SidebarRightServiceLike {
  openTab?(kind: string, options?: { readonly replaceTab?: boolean }): unknown;
  /**
   * 在屏会话快照 store。
   *
   * 🔴 **本包绝不许 subscribe 它**：真机两次复现的 renderer 崩溃 = 「openTab 抛错 → 订阅 → 回调 →
   * 再抛错」自激风暴。类型里留着它，正是为了让回归用例能把「一个订阅都不许有」写成**结构化断言**
   * （假 ctx 提供真实形状的 store，用例数订阅次数必须恒为 0）。
   */
  mounted?: {
    getSnapshot(): string | undefined;
    subscribe(callback: (sessionId: string | undefined) => void): () => void;
  };
}

/** `remote.settings` 的窄面（contract §D13：只经 `describe` / `update` / `mutate`） */
export interface RemoteSettingsLike {
  describe(): Promise<SettingsResponse>;
  update(namespace: string, patch: unknown, expectedRevision: unknown): Promise<SettingsResponse>;
  mutate(namespace: string, ops: readonly SettingsPathOp[], expectedRevision: unknown): Promise<SettingsResponse>;
}

export interface SettingsResponse {
  readonly ok?: boolean;
  readonly error?: unknown;
  readonly value?: unknown;
}

/** 单条路径编辑（`mutate` 的 op；「清除凭据」的唯一形态是 `unset`） */
export interface SettingsPathOp {
  readonly op: 'set' | 'unset';
  readonly path: readonly string[];
  readonly value?: unknown;
}

/** 定时器（包一层：`timers.setTimeout(...)` 会让 `this` 变成对象 ⇒ `Illegal invocation`，真机踩过） */
export interface ClientTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** 可注入的客户端运行面（测试与集成方） */
export interface ClientApplyOptions {
  /** 快照/动作的基址（缺省 `''` = 同源）；末尾斜杠会被去掉 */
  readonly routeBaseUrl?: string | undefined;
  /** 注入 `fetch`（测试/集成方） */
  readonly fetchImpl?: FetchLike | undefined;
  /** 注入假时钟 */
  readonly timers?: ClientTimers | undefined;
  /** 右栏服务晚到的宽限窗口（ms），缺省 2000；负数 = 不排定该告警 */
  readonly pendingWarnMs?: number | undefined;
  /** 凭据存储（缺省 = 真 `localStorage`：**重启后仍可用**，019 D3；取不到降级 `sessionStorage` → 内存） */
  readonly tokenStorage?: StorageLike | undefined;
  /** 便于断言「仓库里到底有什么」；不传时由 `index.ts` 按 `tokenStorage` 造 */
  readonly tokenStore?: WriteTokenStore | undefined;
}

/** `ctx` 的窄面（**全部可选** ⇒ 降级路径不抛，与宿主半同口径） */
export interface ClientContextLike {
  readonly get?: (name: string) => unknown;
  readonly effect?: (callback: () => (() => void) | void, label?: string) => unknown;
  readonly inject?: ((names: readonly string[], callback: (scope: ClientContextLike) => void) => unknown) | undefined;
  readonly slots?: SlotsServiceLike | undefined;
  readonly sidebarRightTabs?: SidebarRightTabsServiceLike | undefined;
  readonly sidebarRight?: SidebarRightServiceLike | undefined;
  readonly remote?: { readonly settings?: RemoteSettingsLike | undefined } | undefined;
}

/** 客户端 apply 的结果（判别联合：每条降级路径都可逐条断言） */
export type ClientApplyResult =
  | {
      readonly registered: true;
      readonly pageId: string;
      readonly kind: string;
      readonly seats: readonly string[];
      readonly styles: string;
    }
  | {
      readonly registered: false;
      readonly reason: 'slots-missing' | 'sidebar-right-pending' | 'sidebar-right-unavailable';
      readonly message: string;
      readonly missing: readonly string[];
      readonly deferred?: boolean;
    };

/** `settings` 管道的工厂签名（测试替身按它注入） */
export type SettingsPipeFactory = (getSettings: () => RemoteSettingsLike | undefined) => SettingsPipe;
