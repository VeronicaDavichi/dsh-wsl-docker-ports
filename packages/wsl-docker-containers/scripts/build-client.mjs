/**
 * 容器包的客户端半构建（016 从转发包的 `build-client.mjs` 收窄而来）
 *
 * ## 产物形态与转发包**逐字同源**（同一宿主契约）
 *
 * `lib/client.js` 的第一层必须是
 * `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { … return module.exports } })`
 * —— 官方**文档化契约是 CJS**。
 *
 * ## 三条不可让步的细节
 *
 * 1. **文件名必须恰好是 `client.js`**：宿主 `chunkUrl()` 断言 URL 资源段 = `<rowId>/client.js`。
 * 2. **`module` / `exports` 是 factory 内的局部变量**，绝不落到 `globalThis`（同页多插件不能互相覆盖）。
 * 3. **JSX 走自动运行时**（与 `tsconfig.json` 的 `jsx: "react-jsx"` 同口径）；`require` 由宿主注入 ⇒
 *    全部模块请求必须 external。
 *
 * ## 016 的差别只有两处
 *
 * ① 只有**两个**产物：主包 `lib/client.js` + 容器页 chunk `lib/client.containers.js`
 *   （转发包的 `client.ports.js` 不在这里，反之亦然 ⇒ 拆包后每个包**自己的 chunk 自己建**）；
 * ② chunk 入口是 `src/client/chunk-containers.ts`，其自报 `chunk:` 文件名必须与
 *   `src/client/surface.ts` 的 `CONTAINERS_CHUNK`、本脚本的 `chunkName` **三处同名**。
 *
 * 其余（同选项、`write: false` + Node 落盘、`absWorkingDir` 钉包目录）与转发包一致，
 * 原因见那边的长注释（沙箱写权限 / 体积读数不许随 cwd 飘）。
 */

import { build } from 'esbuild';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const outfile = path.join(pkgRoot, 'lib', 'client.js');
/** 容器页 chunk 的文件名（= `surface.ts` 的 `CONTAINERS_CHUNK` basename = `chunk-containers.ts` 产物名） */
const chunkName = 'client.containers.js';
const chunkOutfile = path.join(pkgRoot, 'lib', chunkName);

/** esbuild 的 `external` = 不打进 bundle（与转发包同一份清单） */
export const BUILD_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'ui-primitives',
  '@deepseek-ai/cordis',
  '@deepseek-ai/*',
  // 🔴 016：**跨包不能**打进产物 —— core 是宿主侧 node 包，client 半若把它的实现内联进来，
  // 就会得到第二份「模块级可变状态」（配置锚点 / 探针缓存），且两包各带一份 ⇒ 体积与语义双输。
  // 容器包的 client 半本来就不该 import core（它只发 HTTP），这条是防线。
  'dsh-wsl-docker-core',
  'dsh-wsl-shared',
];

const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`;
const chunkBanner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, chunk: ${JSON.stringify(chunkName)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`;
const footer = `\nreturn module.exports;\n} });`;

/** 两趟构建共用的选项（唯一差别是 `chunk:` 自报字段） */
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
  // 🔴 必须显式钉成**包目录**：esbuild 默认取 `process.cwd()`，模块路径注释会随之变化 ⇒
  // 同源代码从仓库根跑会多出 `packages/wsl-docker-containers/` 前缀（体积读数随 cwd 飘）。
  absWorkingDir: pkgRoot,
  // ⚠️ `write: false` 不是风格选择：本机沙箱下 esbuild 的服务进程被拒绝对输出文件写入，
  // 而调用方 Node 进程可写 ⇒ 让 esbuild 只做内存产物、由 Node 落盘。
  write: false,
};

/** 构建一个入口并落盘，返回产物字节数 */
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

// ① 主包（tab 注册壳 + 取块调用点）② 容器页 chunk（`containers/pane.tsx` 整棵子树）
await buildEntry(path.join(pkgRoot, 'src', 'client', 'index.ts'), outfile, banner);
await buildEntry(path.join(pkgRoot, 'src', 'client', 'chunk-containers.ts'), chunkOutfile, chunkBanner);
