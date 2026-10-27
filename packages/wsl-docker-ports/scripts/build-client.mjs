/**
 * 客户端半构建（003 T5.1 的构建接线 / contract §A3 §A4 §P3 §P4）
 *
 * ## 产物形态：自注册 CJS 工厂
 *
 * `lib/client.js` 的第一层必须是
 * `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { … return module.exports } })`
 * —— 官方**文档化契约是 CJS**（另有 iife 反例，但那不是文档口径）。
 *
 * ## 三条不可让步的细节
 *
 * 1. **文件名必须恰好是 `client.js`**：宿主 `chunkUrl()` 会断言 URL 资源段 = `<rowId>/client.js`，
 *    不匹配**直接 throw**（contract §P3-1）。
 * 2. **`module` / `exports` 是 factory 内的局部变量**，绝不落到 `globalThis`：
 *    宿主在同一页面里加载多个插件，污染全局会让相邻插件的 exports 互相覆盖。
 * 3. **JSX 走自动运行时**（与 `tsconfig.json` 的 `jsx: "react-jsx"` **同一口径**：typecheck 与产物
 *    不能各说各话）。代价是 require 集合 = `react` + `react/jsx-runtime` —— 两者都在宿主基线内
 *    （React 即基线），因此 `dsh.client.external` 仍然**是空**（无任何非基线声明）。
 *
 * `require` 由**宿主注入**（factory 的形参），因此全部模块请求必须 external；未声明的请求会静默崩。
 *
 * ## 011 `T1.2` / `T1.3` 追加：渲染面 chunk（**第二个入口**）
 *
 * 用**同一份选项**再构建一次 `src/client/chunk-ports.ts` → `lib/client.ports.js`；与主包**唯一**的差别是
 * banner 里多一个 `chunk:` 字段 —— 宿主按**请求的 URL** 记账（`tasks.md` 的 Phase 0 运行时证据：脚本 200 但
 * 未注册 ⇒ `loaded without registering "…/client.terminal.js" via __ModuleLoader__.load`），所以注册必须
 * 自报**与请求同一个文件名**。产物名与主包里的 `PANE_CHUNK` 常量、chunk 入口文件名**三处同名**。
 * ⚠️ 仍然**零新依赖**（REQ-BS-7）：两趟构建共用一份选项对象，没有新的构建期包。
 */

import { build } from 'esbuild';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const outfile = path.join(pkgRoot, 'lib', 'client.js');
/** 渲染面 chunk 的文件名（= 主包 `PANE_CHUNK` 说明符的 basename = `chunk-ports.ts` 的产物名） */
const chunkName = 'client.ports.js';
const chunkOutfile = path.join(pkgRoot, 'lib', chunkName);
/** 容器页 chunk 的文件名（= 主包 `CONTAINERS_CHUNK` 说明符的 basename = `chunk-containers.ts` 的产物名） */
const containersChunkName = 'client.containers.js';
const containersChunkOutfile = path.join(pkgRoot, 'lib', containersChunkName);

/**
 * esbuild 的 `external` = 「不要打进 bundle」。
 * 它**不等于**清单里的 `dsh.client.external`（后者只列**非基线**请求，我们当前是空的）。
 * 这里宽松地列全，是为了「即使将来误加了一句 import，也不会把 React 打进产物」。
 */
export const BUILD_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'ui-primitives',
  '@deepseek-ai/cordis',
  '@deepseek-ai/*',
];

const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`;
const chunkBanner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, chunk: ${JSON.stringify(chunkName)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`;
const footer = `\nreturn module.exports;\n} });`;

/** 两趟构建共用的选项（`banner` / `footer` / 入口 / 产物各自不同） */
const sharedOptions = {
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  external: BUILD_EXTERNALS,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
  // 🔴 `absWorkingDir` 必须显式钉成**包目录**：esbuild 默认取 `process.cwd()`，而模块路径注释
  // （`// src/client/index.ts`）随它变 —— 从仓库根跑会多出 `packages/wsl-docker-ports/` 前缀
  // ⇒ 同源代码产出 **+754 B**（011 `T1.1` 实测：29 行注释 × 26 字符）。不钉住 = 体积门读数随 cwd 飘。
  absWorkingDir: pkgRoot,
  // ⚠️ `write: false` 不是风格选择：本机沙箱下 esbuild 的**服务进程**被拒绝对输出文件写入
  // （`Failed to write to output file … Access is denied`，对任意路径都复现），
  // 而调用方 Node 进程可写。于是让 esbuild 只做内存产物、由 Node 落盘。
  write: false,
};

/**
 * 构建一个入口并落盘，返回产物字节数。
 *
 * 主包与 chunk **走完全同一条路径**（同选项、同 external、同 banner 形状）⇒ 不存在「chunk 用另一套
 * 配置」的口径漂移；唯一的差别就是 `chunkBanner` 多了自报文件名。
 */
async function buildEntry(entryPoint, outfilePath, jsBanner) {
  const result = await build({
    entryPoints: [entryPoint],
    outfile: outfilePath,
    ...sharedOptions,
    banner: { js: jsBanner },
    footer: { js: footer },
  });

  const artifact = result.outputFiles?.[0];
  if (artifact === undefined) throw new Error('esbuild 未返回任何产物');
  mkdirSync(path.dirname(outfilePath), { recursive: true });
  writeFileSync(outfilePath, artifact.contents);

  const bytes = statSync(outfilePath).size;
  console.log(`[build-client] ${path.relative(pkgRoot, outfilePath).replaceAll('\\', '/')} = ${String(bytes)} B`);
  return bytes;
}

// ① 主包（tab 注册壳 + 取块调用点）② 渲染面 chunk（`pane.tsx` 整棵子树 + 写路径内核）
await buildEntry(path.join(pkgRoot, 'src', 'client', 'index.ts'), outfile, banner);
await buildEntry(path.join(pkgRoot, 'src', 'client', 'chunk-ports.ts'), chunkOutfile, chunkBanner);
await buildEntry(path.join(pkgRoot, 'src', 'client', 'chunk-containers.ts'), containersChunkOutfile, chunkBanner.replace('client.ports.js', containersChunkName));
