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
 */

import { build } from 'esbuild';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const outfile = path.join(pkgRoot, 'lib', 'client.js');

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
const footer = `\nreturn module.exports;\n} });`;

const result = await build({
  entryPoints: [path.join(pkgRoot, 'src', 'client', 'index.ts')],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  external: BUILD_EXTERNALS,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
  banner: { js: banner },
  footer: { js: footer },
  // ⚠️ `write: false` 不是风格选择：本机沙箱下 esbuild 的**服务进程**被拒绝对输出文件写入
  // （`Failed to write to output file … Access is denied`，对任意路径都复现），
  // 而调用方 Node 进程可写。于是让 esbuild 只做内存产物、由 Node 落盘。
  write: false,
});

const artifact = result.outputFiles?.[0];
if (artifact === undefined) throw new Error('esbuild 未返回任何产物');
mkdirSync(path.dirname(outfile), { recursive: true });
writeFileSync(outfile, artifact.contents);

const bytes = statSync(outfile).size;
console.log(`[build-client] ${path.relative(pkgRoot, outfile).replaceAll('\\', '/')} = ${String(bytes)} B`);
