/**
 * `plugin.ts` 相关单测的**共用脚手架**（002 T7.1/T7.2）。
 *
 * 为什么提到 helpers：`plugin-entry.test.ts` 与 `service-surface.test.ts` 都要「手动推进的调度器」，
 * 且插件装载面需要一整套 fake ctx（含**页类型计数**）。共用脚手架放这里，单测文件才留得住余量
 * （单文件 ≤ 400 行是 SHALL，按**原始行数**算）。
 *
 * 零真机：这里没有任何真实 PTY / 浏览器 / 宿主进程，只有结构面 fake。
 */

import type { HostModulePort } from '../../src/service-export/host-modules.ts';
import { HOST_SCHEMA_MODULE, HOST_TOOLS_MODULE } from '../../src/service-export/host-modules.ts';
import type { SchedulePort } from '../../src/service-export/service.ts';
import type { PluginContextLike, ProfilesConfigLike } from '../../src/plugin.ts';
import { compileTool } from './tools-define.ts';

/** 升级请求必须带 `Sec-WebSocket-Key`（RFC 6455 的官方向量；缺它通道按 400 拒绝） */
export const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';

/** 同源白名单里那一条（宿主 GUI 的 loopback origin；集成方按真实值注入，本任务不猜端口） */
export const ORIGIN = 'http://127.0.0.1:19387';

/** profile 名录：一条普通 Windows 命令 + 一条 WSL 命令（`cwdOverride` 的两个槽位各一） */
export const RAW_PROFILES = [
  { name: 'pwsh', command: 'pwsh.exe', args: ['-NoLogo'], env: {}, cwd: 'E:\\proj' },
  { name: 'wsl', command: 'wsl.exe', args: ['-d', 'Ubuntu2204'], env: {}, cwdLinux: '/home/u' },
];

/** 宿主配置的形状：volatile 值必须走 `.get()`（`src/index.ts` 的调用约定） */
export const CONFIG: ProfilesConfigLike = { profiles: { get: () => RAW_PROFILES } };

export interface FakePluginCtx {
  readonly ctx: PluginContextLike;
  readonly provideCalls: Array<{ name: string; value: unknown }>;
  readonly footerRegistrations: () => number;
  effectCount(): number;
  unload(): void;
}

/** 宿主服务的**可选**面（缺谁就走谁自己的降级路径） */
export type FakeServices = Partial<Record<'webServer' | 'subprocess' | 'tools' | 'sandboxPolicy', unknown>>;

/**
 * 最小可用的插件 ctx fake。
 *
 * 🔴 `sidebarRightTabs` 是**计数版**：本任务不许实现 Phase 4 的右栏页类型 ⇒ 只要有人注册，
 * `footerRegistrations()` 就非 0、断言当场红（比「不写断言」强）。
 * `unload()` 按 cordis 的**逆序**跑 effect 清理（最后注册的最先清理）。
 */
export function createFakePluginCtx(services: FakeServices): FakePluginCtx {
  const disposers: Array<() => void> = [];
  const provideCalls: Array<{ name: string; value: unknown }> = [];
  let effects = 0;
  let pageTypes = 0;
  return {
    ctx: {
      provide(serviceName: string, value: unknown) {
        provideCalls.push({ name: serviceName, value });
        return value;
      },
      effect(callback) {
        effects += 1;
        const dispose = callback();
        if (typeof dispose === 'function') disposers.push(dispose);
        return dispose;
      },
      get(serviceName) {
        if (serviceName === 'sidebarRightTabs') {
          return {
            register() {
              pageTypes += 1;
              return () => undefined;
            },
          };
        }
        return (services as Record<string, unknown>)[serviceName];
      },
    },
    provideCalls,
    footerRegistrations: () => pageTypes,
    effectCount: () => effects,
    unload() {
      for (const dispose of disposers.splice(0, disposers.length).reverse()) dispose();
    },
  };
}

export interface HostSpy {
  readonly port: HostModulePort;
  readonly schemaCalls: string[];
  readonly defineToolCalls: number;
}

/**
 * 注入的宿主模块端口（schemastery + dsh-tools 的假实现）。
 *
 * `schemaShape: 'callable'` 复刻**真机形状**：schemastery 的导出命名空间是**挂着成员的
 * 可调用对象**（`typeof z === 'function'`、无 `default`、无 `Schema`）—— 这一支是回归钉。
 */
export function createHostSpy(
  options: { readonly schema?: boolean; readonly tools?: boolean; readonly schemaShape?: 'default' | 'callable' } = {},
): HostSpy {
  const schemaCalls: string[] = [];
  const state = { defineToolCalls: 0 };
  const node = (kind: string): { kind: string; volatile: () => unknown } => ({
    kind,
    volatile() {
      schemaCalls.push(`volatile:${kind}`);
      return node(kind);
    },
  });
  const factory = {
    any: () => node('any'),
    array: () => {
      schemaCalls.push('array');
      return node('array');
    },
    object: (shape: Record<string, unknown>) => {
      schemaCalls.push(`object:${Object.keys(shape).join(',')}`);
      return node('object');
    },
  };
  const wantSchema = options.schema ?? true;
  const wantTools = options.tools ?? true;
  const callable = options.schemaShape === 'callable';
  return {
    schemaCalls,
    get defineToolCalls() {
      return state.defineToolCalls;
    },
    port: {
      load(specifier) {
        if (specifier === HOST_SCHEMA_MODULE) {
          if (!wantSchema) return undefined;
          return callable ? Object.assign(() => undefined, factory) : { default: factory };
        }
        if (specifier === HOST_TOOLS_MODULE) {
          return wantTools
            ? {
                defineTool: (definition: unknown) => {
                  state.defineToolCalls += 1;
                  return compileTool(definition);
                },
              }
            : undefined;
        }
        return undefined;
      },
    },
  };
}

/** 手动推进的调度器（订阅惰性起表，tick 由测试调用 ⇒ 无真定时器、无时序抖动） */
export function manualSchedule() {
  const ticks: Array<() => void | Promise<void>> = [];
  let stops = 0;
  const schedule: SchedulePort = {
    every(_ms, tick) {
      ticks.push(tick);
      return () => {
        stops += 1;
      };
    },
  };
  return { schedule, ticks, stops: () => stops };
}
