/**
 * xterm chunk 的**唯一取用点**（002 T4.2 / REQ-5.1 / NFR-2）
 *
 * 📌 **契约来源 = 官方终端页的产物**（`client-contract.md` §P2 逐字，非推测）：
 *   `const LoadedTerminalBody = (0, react.lazy)(async () => ({ default: (await require.async("./client.terminal.js")).TerminalBody }))`
 *   注释原文 *"Load xterm only after a terminal body is mounted."*
 *   ⇒ 主 bundle **只**在这里写 `require.async`，且**只在视图挂载时**执行。
 *
 * 🔴 四条必须照抄的细节：
 *   ① 实参就是**兄弟文件名** `"./client.terminal.js"`（绝对路径 / 带目录前缀都是错的，§P3）；
 *   ② 宿主 ModuleLoader 的 `load({ id, chunk: "client.terminal.js", factory })` 由 **chunk 自己**自注册，
 *      主 bundle 不参与 ⇒ 这里只是**取块**；
 *   ③ chunk **不进 `exports`**（宿主按 `<base>/<rowId>/<file>?rev=<rev>` 自己拼 URL，§P3）；
 *   ④ 主 bundle **不得**出现裸 `require("./client.terminal.js")` —— 那会退化成同步解析（宿主不保证同目录同步解析）。
 *      `scripts/verify-client-loader.mjs` 对①④逐字断言。
 *
 * ⚠️ `require` 是**宿主注入**的（工厂参数），不是 Node 的 `require`：所以这里用 `declare` 声明形状，
 * 编译期不引入任何运行时依赖（主 bundle 里因此只有 `require.async(...)` 这一处痕迹）。
 */

import type { ComponentType } from 'react';

import type { TerminalBodyProps } from './xterm-body.tsx';

/** chunk 文件名（宿主准入正则 `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`，§P3） */
export const CHUNK_FILE_NAME = 'client.terminal.js';

/** `require.async` 的实参：**兄弟文件名**（§P3；由 `CHUNK_FILE_NAME` 拼出，单一字面量来源） */
export const CHUNK_REQUEST = `./${CHUNK_FILE_NAME}`;

/** chunk 的导出面（窄接口：只声明我们真的用的东西） */
export interface XtermChunkModule {
  readonly TerminalBody: ComponentType<TerminalBodyProps>;
  /** chunk 内联的 xterm.css 注入器（返回移除器；由视图挂载时调用 ⇒ 不在模块顶层执行） */
  readonly installXtermStyles: (doc?: Document | undefined) => { dispose(): void };
}

export type XtermChunkLoader = () => Promise<XtermChunkModule>;

declare const require: { async(specifier: string): Promise<unknown> };

function isChunkModule(value: unknown): value is XtermChunkModule {
  const candidate = value as Partial<XtermChunkModule> | null | undefined;
  return typeof candidate?.TerminalBody === 'function' && typeof candidate.installXtermStyles === 'function';
}

/**
 * 取 xterm chunk（**唯一** `require.async` 调用点；薄到可以被整体替换 ⇒ 单测/自检脚本可断言「挂载前零调用」）。
 *
 * ⚠️ 实参是**常量**而不是裸字面量：`CHUNK_REQUEST` 由 `CHUNK_FILE_NAME` 拼出 ⇒ 文件名只有一处字面量来源。
 * 契约判据是「实参**解析后** = 兄弟文件名」（002 T4.2 的措辞），故验证器对实参做**一层常量折叠**
 * （字面量，或标识符 → 其初始化式 → 模板串）并打印走的是哪条路径，而不是死抠语法形态。
 */
export const loadXterm: XtermChunkLoader = async () => {
  const loaded: unknown = await require.async(CHUNK_REQUEST);
  if (!isChunkModule(loaded)) {
    throw new Error(`模块 ${CHUNK_REQUEST} 未导出 { TerminalBody, installXtermStyles }：宿主 ModuleLoader 取块失败。`);
  }
  return loaded;
};
