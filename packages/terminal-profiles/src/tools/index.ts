/**
 * `src/tools/**` 的对外面（004 T1.1 的单一入口）
 *
 * 为什么要有 barrel：`package.json` 的 `exports` **不由本 Spec 拥有**（002 的 `src/index.ts` 是
 * 它的大门，且本 Spec 明确不许改它）⇒ 工具族的装配点在**调用方**（profile 装载 / 002 的插件入口），
 * 它只需要 `createTerminalTools` 与工具名清单。把内部件（keys / policy / schemas）也重导出会让
 * 「薄适配层」的边界变模糊：那些是**实现细节**，测试直接按路径 import 即可。
 *
 * ⚠️ 这里**不**引入任何运行时副作用：本文件只有重导出，没有注册动作。注册必须由调用方显式执行
 * （并在卸载时调用返回的 `dispose`，NFR-1）。
 */

export { createTerminalTools, TERMINAL_TOOL_NAMES } from './register.ts';
export type { CreateTerminalToolsOptions, TerminalToolName, ToolRegisterSurface } from './register.ts';
export type { HostContextLike, ToolRunContext, ToolsServiceLike } from './host.ts';
export { ToolFailureError } from './failure.ts';
export type { ToolFailureCode, ToolFailureValue } from './failure.ts';
