/**
 * 客户端半构建（002 T4.2 / REQ-5.1 / NFR-2）—— **两次独立 esbuild 构建**
 *
 * 为什么不用 esbuild 的 `splitting`：它**只支持 ESM**，而宿主 ModuleLoader 的契约是 **CJS 自注册工厂**
 * （`window.__ModuleLoader__.load({ id, factory })`）。所以拆包这件事由我们手工做：
 *
 *   ① 主 bundle  `src/client/index.ts`      → `lib/client.js`          （external: react / react-dom / @deepseek-ai/*）
 *   ② 懒加载块   `src/client/terminal-chunk.ts` → `lib/client.terminal.js` （**xterm 内联**，其余同上 external）
 *
 * 逐条对齐官方终端页的实物（`client-contract.md` §P2 逐字）：
 *   - 主 bundle 形如 `window.__ModuleLoader__.load({ id, factory: (require) => { … } })`（**无** `chunk` 字段）；
 *   - chunk  形如 `… .load({ id, chunk: "client.terminal.js", factory: … })`；
 *   - 主 bundle 里只有 `require.async("./client.terminal.js")`（兄弟文件名，§P3）；
 *   - **文件名**：主产物必须恰好 `client.js`（宿主 `chunkUrl()` 断言资源段 = `<rowId>/client.js`，不匹配直接 throw）；
 *     chunk 必须与它**同目录**且匹配 `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`（§P3）。
 *
 * ⚠️ **不做**的事：不改 `package.json`（清单由人维护）、不写 CSS 文件（xterm.css 以文本内联进 chunk）、
 * 不产出 sourcemap（本来就没开 `sourcemap` ⇒ 产物里不会出现指向不存在文件的 `sourceMappingURL`）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 与 `src/client/tab.ts` 的 `TERMINAL_TAB_ID` 逐字一致（宿主行 id == 包名） */
export const PLUGIN_ID = 'dsh-terminal-profiles';
/** 主产物文件名（**不可改**：宿主 `chunkUrl()` 断言 `<rowId>/client.js`） */
export const MAIN_BUNDLE_FILE = 'client.js';
/** 懒加载块文件名（**不可改**：宿主准入正则 `client.<name>.js`） */
export const CHUNK_FILE = 'client.terminal.js';

/**
 * external = 由**宿主 ModuleLoader 的 `require` 供给**的模块。
 * 🔴 未在此声明却真的 `require` 了 ⇒ 运行时没有供给方、**静默崩**（官方 verify 脚本的由来）。
 * 本包实际只 require `react` / `react/jsx-runtime`（都是官方基线模块），其余条目是**防御性**声明：
 * 一旦将来用到某个 `@deepseek-ai/*` 客户端模块，bundle 不会把它打进来（但那时**还要**在清单
 * `dsh.client.external` 里逐条声明，否则 composition 会以 missing supplier 拒绝 —— 见 §P4）。
 */
export const CLIENT_EXTERNAL = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/*',
  '@deepseek-ai/dsh-client-ui-primitives',
];

/** 自注册 CJS 工厂的 banner/footer（官方终端页同形；`module`/`exports` 由 banner 就地造出来） */
function wrapper(chunk) {
  const fields = [`\tid: "${PLUGIN_ID}",`];
  if (chunk !== undefined) fields.push(`\tchunk: "${chunk}",`);
  return {
    banner: {
      js: [
        'window.__ModuleLoader__.load({',
        ...fields,
        '\tfactory: (require) => {',
        '\t\tvar module = { exports: {} };',
        '\t\tvar exports = module.exports;',
      ].join('\n'),
    },
    footer: { js: 'return module.exports;\n\t}\n});' },
  };
}

/** 两次构建共用的选项（`format: 'cjs'` + `platform: 'browser'` + `target: 'es2020'`） */
function commonOptions(entry, outfile, wrapperFields) {
  return {
    entryPoints: [resolve(packageRoot, entry)],
    outfile: resolve(packageRoot, outfile),
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2020',
    jsx: 'automatic',
    external: CLIENT_EXTERNAL,
    logLevel: 'warning',
    /**
     * 🔴 `write: false` + 自己落盘：本机（Windows + 宿主沙箱）里 esbuild 的**子进程**没有目标目录的
     * 写权限（实测 `Failed to write to output file … Access is denied`），而 Node 自身写同一个路径正常。
     * 产物内容完全一样（`outfile` 只影响错误信息里的路径名），故改成「esbuild 只编译、Node 落盘」。
     */
    write: false,
    ...wrapperFields,
  };
}

/** 跑一次构建并把产物写到磁盘（见 `commonOptions` 的 `write: false` 说明） */
async function emit(options) {
  const result = await esbuild.build(options);
  const output = result.outputFiles?.[0];
  if (output === undefined) throw new Error(`esbuild 没有产出：${options.outfile}`);
  mkdirSync(dirname(options.outfile), { recursive: true });
  writeFileSync(options.outfile, output.contents);
  return { outfile: options.outfile, bytes: output.contents.length };
}

export async function buildClient() {
  mkdirSync(resolve(packageRoot, 'lib'), { recursive: true });

  // ① 主 bundle：**不含 xterm**（对 xterm 的引用只以 `require.async` 的字符串形式出现）
  const main = await emit(commonOptions('src/client/index.ts', `lib/${MAIN_BUNDLE_FILE}`, wrapper(undefined)));

  // ② 懒加载块：xterm 内联；`.css` 走 `text` loader ⇒ CSS 以字符串进 chunk（官方终端页同做法）
  const chunk = await emit({
    ...commonOptions('src/client/terminal-chunk.ts', `lib/${CHUNK_FILE}`, wrapper(CHUNK_FILE)),
    loader: { '.css': 'text' },
  });

  return { main: main.outfile, chunk: chunk.outfile, mainBytes: main.bytes, chunkBytes: chunk.bytes };
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const built = await buildClient();
  console.log(`✓ build-client: 主 bundle ${built.main}`);
  console.log(`✓ build-client: 懒加载 chunk ${built.chunk}`);
}
