/**
 * 宿主模块的**取用缝**（002 T7.1；唯一需要「真机装载复核」的地方，见 §11 的残余真机项）
 *
 * ## 为什么是「运行时解析」而不是静态 `import`
 *
 * 同族插件的生产代码是**静态 import**（本机实证）：
 * - `E:\NodeProjects\dsh-office-tools\src\index.ts:23` → `import z from '@deepseek-ai/schemastery'`
 *   （下一行 `export const Config = z.object({ … })`）；
 * - `E:\NodeProjects\dsh-office-tools\src\tools\excel.ts:13` → `import { defineTool } from '@deepseek-ai/dsh-tools'`。
 *
 * 本包**默认走运行时解析**（`createRequire` + 缓存 + 失败即 `undefined`），而不是静态 import：
 * 同族范式是把这两个包写进 **devDependencies（本机解析）+ peerDependencies（宿主契约）**，
 * 而包依赖的落地由集成方负责 —— 在它落地之前的任何时刻，静态 import 都会让
 * `import '../src/plugin.ts'` 当场 `ERR_MODULE_NOT_FOUND`（**插件连配置面都起不来**）。
 * 运行时解析对两种状态都成立：依赖在 ⇒ 拿到真实现；依赖不在 ⇒ 优雅降级（`Config === undefined`、
 * 工具面不注册），并且卸载/加载路径完全不崩。
 *
 * ⇒ **替代点就在这一处**：把 `resolveSchemaFactory` / `resolveDefineTool` 的两行换成静态 import
 * （`import z from '@deepseek-ai/schemastery'` / `import { defineTool } from '@deepseek-ai/dsh-tools'`）
 * 即可，`plugin.ts` 与全部测试都不用动。
 *
 * ## 一个刻意的「不兜底」
 *
 * schema 取不到时**不**造一个假 schema：`isSchemastery()` 判的是 `schema['~standard'].vendor`
 * （见 `../config/schema.ts` 文件头），假 schema 会让 `.volatile()` **静默失效** ⇒ 每次保存都
 * 重挂载、把正在跑的终端全杀掉。宁可 `Config === undefined`（宿主按「无配置」处理、且失败可见）。
 */

import { createRequire } from 'node:module';

import type { SchemaFactory } from '../config/schema.ts';
import type { CreateTerminalToolsOptions } from '../tools/index.ts';

/**
 * `defineTool` 的签名**从工具面的入口选项派生**（不另写一份）：
 * 这样宿主那一份实现必须满足 `createTerminalTools` 真正会用的形状。
 */
type DefineTool = CreateTerminalToolsOptions['defineTool'];

/** schemastery 的宿主包名（与同族插件逐字一致） */
export const HOST_SCHEMA_MODULE = '@deepseek-ai/schemastery';

/** `defineTool` 的宿主包名（与同族插件逐字一致） */
export const HOST_TOOLS_MODULE = '@deepseek-ai/dsh-tools';

/** 取宿主模块的端口（**注入**：单测给 fake，生产给默认实现） */
export interface HostModulePort {
  /** 解析一个模块说明符；拿不到返回 `undefined`（**不抛** —— 缺依赖不是加载期错误） */
  load(specifier: string): unknown | undefined;
}

/**
 * 默认实现：`createRequire` + try/catch + 一次性缓存。
 *
 * ⚠️ 缓存 `undefined` 也要记住（否则每次调用都做一次必败的解析）。
 */
export function createHostModulePort(fromUrl: string = import.meta.url): HostModulePort {
  const require = createRequire(fromUrl);
  const cache = new Map<string, unknown>();
  const seen = new Set<string>();
  return {
    load(specifier) {
      if (seen.has(specifier)) return cache.get(specifier);
      seen.add(specifier);
      let loaded: unknown;
      try {
        loaded = require(specifier);
      } catch {
        loaded = undefined;
      }
      if (loaded !== undefined) cache.set(specifier, loaded);
      return loaded;
    },
  };
}

/** 缺省端口（`plugin.ts` 的静态 `Config` 与 `apply` 都用它） */
export function defaultHostModulePort(): HostModulePort {
  return createHostModulePort();
}
/**
 * 从模块命名空间里取一个成员。
 *
 * 为什么要看 `default`：同族插件写的是 `import z from '@deepseek-ai/schemastery'`（**默认导出**），
 * 而 CJS/ESM 互操作下 `require()` 拿到的可能是 `{ default: … }` 或就是那个对象本身。
 */
export function memberOf(module: unknown, name: string): unknown {
  if (module === null || (typeof module !== 'object' && typeof module !== 'function')) return undefined;
  const direct = (module as Record<string, unknown>)[name];
  if (direct !== undefined) return direct;
  const fallback = (module as { default?: unknown }).default;
  if (fallback === undefined || fallback === module) return undefined;
  if (fallback === null || (typeof fallback !== 'object' && typeof fallback !== 'function')) {
    return undefined;
  }
  return (fallback as Record<string, unknown>)[name];
}

/** 结构面判定：够不够当一个 schemastery 工厂（只认本包用到的方法，见 `../config/schema.ts`） */
export function isSchemaFactory(value: unknown): value is SchemaFactory {
  // 🔴 真机实测（2026-10-09）：schemastery 的导出命名空间是一个**可调用对象**（`typeof === 'function'`
  // 且挂着 `any`/`array`/`object`/… 成员，没有 `default`、没有 `Schema`）⇒ 只认 `object` 会把真实现
  // 判掉、静默退化成 `Config === undefined`。所以这一支必须同时接受 function。
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const candidate = value as Partial<SchemaFactory>;
  return (
    typeof candidate.any === 'function' &&
    typeof candidate.array === 'function' &&
    typeof candidate.object === 'function'
  );
}

/** 取宿主那一份 schemastery 工厂（`Config` 的唯一来源）；取不到返回 `undefined`（见文件头「不兜底」） */
export function resolveSchemaFactory(modules: HostModulePort): SchemaFactory | undefined {
  const loaded = modules.load(HOST_SCHEMA_MODULE);
  const candidate = memberOf(loaded, 'Schema') ?? (loaded as { default?: unknown } | undefined)?.default ?? loaded;
  return isSchemaFactory(candidate) ? candidate : undefined;
}

/** 取宿主那一份 `defineTool`（工具面的唯一编译入口，见 `../tools/host.ts` 的头注 ①） */
export function resolveDefineTool(modules: HostModulePort): DefineTool | undefined {
  const candidate = memberOf(modules.load(HOST_TOOLS_MODULE), 'defineTool');
  return typeof candidate === 'function' ? (candidate as DefineTool) : undefined;
}
