/**
 * 容器包的客户端产物核验 —— `scripts/verify-client-loader.mjs`
 *
 * ## 为什么必须「真在 vm 里跑一遍」
 *
 * 「产物存在」「文件名对」这类静态检查**证明不了**：`window.__ModuleLoader__.load` 被调用了几次、
 * `id` 是什么、`factory` 拿到的 exports 里有没有 `apply`、它**实际** require 了哪些模块。
 * 这些只能把产物丢进 `node:vm` + 假 `window` + 假 `require` 真执行一次。
 *
 * ## 判据（每条打印扫描项计数；为 0 即失败 —— 结构性断言不许恒真）
 *
 * | # | 判据 |
 * | --- | --- |
 * | ① | 主包自注册**恰好 1 次**，`id` = `dsh-wsl-docker-containers` |
 * | ② | factory 返回的 exports 里**有** `apply`（宿主调它）、且**没有** `default` 之外的多余注册 |
 * | ③ | factory 执行期间 require 的模块**全部**在宿主基线内（`react*` / `ui-primitives` / `@deepseek-ai/*`） |
 * | ④ | 主包**没有** require 自己的 chunk（chunk 只能经 `require.async` 取） |
 * | ⑤ | chunk 自注册**恰好 1 次**，且带 `chunk: "client.containers.js"`（宿主按 URL 记账） |
 * | ⑥ | 两个产物都**不写 `globalThis`**（同页多插件不许互相覆盖） |
 * | ⑦ | **变异哨兵**：改成别的 id / 抽掉 `chunk:` ⇒ ① / ⑤ 会判红 |
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const mainSource = readFileSync(path.join(pkgRoot, 'lib', 'client.js'), 'utf8');
const chunkSource = readFileSync(path.join(pkgRoot, 'lib', 'client.containers.js'), 'utf8');

/** 宿主基线（`dsh.client.external` 为空 ⇒ 只许这些） */
const BASELINE = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'ui-primitives'];
const isBaseline = (spec) => BASELINE.includes(spec) || spec.startsWith('@deepseek-ai/');

let failures = 0;
let checks = 0;

function judge(id, ok, message, detail) {
  checks += 1;
  if (ok) {
    console.log(`  ok   ${id} ${message}${detail === undefined ? '' : ` — ${detail}`}`);
    return;
  }
  failures += 1;
  console.error(`  ✗    ${id} ${message}${detail === undefined ? '' : ` — ${detail}`}`);
}

/**
 * 在 vm 里执行一个产物，返回 `{ loads, required, asyncRequired, globalThisTouched }`。
 *
 * 假宿主：`window.__ModuleLoader__.load` 记录每次注册；`require` 记录每个被请求的说明符并返回
 * 一个空对象（产物在**注册期**不真的渲染，所以空对象足够暴露「require 了谁」）。
 */
function runInVm(source, label) {
  const loads = [];
  const required = [];
  const asyncRequired = [];
  let touched = false;

  const sandbox = {};
  const requireStub = (spec) => {
    required.push(spec);
    return {};
  };
  requireStub.async = (spec) => {
    asyncRequired.push(spec);
    return Promise.reject(new Error('vm: chunk 取块在断言里不真跑'));
  };

  sandbox.window = {
    __ModuleLoader__: {
      load: (spec) => {
        loads.push(spec);
        if (typeof spec.factory === 'function') spec.factory(requireStub);
      },
    },
  };
  sandbox.globalThis = new Proxy(sandbox, {
    set: (target, key, value) => {
      touched = true;
      target[key] = value;
      return true;
    },
  });
  sandbox.console = console;

  try {
    vm.runInNewContext(source, sandbox, { filename: label, timeout: 10_000 });
  } catch (error) {
    failures += 1;
    console.error(`  ✗    vm 执行 ${label} 抛错：${String(error)}`);
  }
  return { loads, required, asyncRequired, touched };
}

// ── 主包 ─────────────────────────────────────────────────────────────
const main = runInVm(mainSource, 'client.js');
judge('①', main.loads.length === 1, `${pkg.name}/client.js 自注册恰好 1 次`, `${String(main.loads.length)} 次（扫描项 ${String(main.loads.length)}）`);
judge('①', main.loads[0]?.id === pkg.name, `id = ${pkg.name}`, String(main.loads[0]?.id));

const mainExports = main.loads[0]?.factory === undefined ? {} : collectExports(mainSource);
judge('②', typeof mainExports.apply === 'function', 'factory 返回的 exports 里有 apply（宿主调它）', typeof mainExports.apply);
// ②b exports 面**恰好**是宿主认识的三个键（多一个 = 有东西漏进了注册期，少一个 = 宿主调不到）
const expectedKeys = ['apply', 'inject', 'name'];
const actualKeys = Object.keys(mainExports).sort();
judge(
  '②',
  expectedKeys.every((key) => actualKeys.includes(key)) && actualKeys.length === expectedKeys.length,
  'exports 面恰好 = apply / inject / name（与转发包同形）',
  `实际 ${actualKeys.join(', ')}`,
);

function collectExports(source) {
  // 在 vm 里再跑一次，这次把 factory 的返回值留下来（上面的 load 只要 id）。
  const registry = {};
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (spec) => {
          if (typeof spec.factory === 'function') registry.exports = spec.factory((s) => ({}));
        },
      },
    },
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: 'collect', timeout: 10_000 });
  return registry.exports ?? {};
}

const foreignRequires = main.required.filter((spec) => !isBaseline(spec) && spec !== './client.containers.js');
judge('③', main.required.length > 0, '主包在注册期 require 了宿主模块', `${String(new Set(main.required).size)} 个去重（扫描项 ${String(main.required.length)}）`);
judge('③', foreignRequires.length === 0, '全部 require 都在宿主基线内', foreignRequires.length === 0 ? '0 个越界' : foreignRequires.join(', '));

const syncChunkRequire = main.required.filter((spec) => spec.includes('client.containers.js'));
judge('④', syncChunkRequire.length === 0, '主包没有**同步** require 自己的 chunk（只能 require.async）', `${String(syncChunkRequire.length)} 处`);

// ── chunk ───────────────────────────────────────────────────────────
const chunk = runInVm(chunkSource, 'client.containers.js');
judge('⑤', chunk.loads.length === 1, 'chunk 自注册恰好 1 次', `${String(chunk.loads.length)} 次（扫描项 ${String(chunk.loads.length)}）`);
judge('⑤', chunk.loads[0]?.chunk === 'client.containers.js', 'chunk 自报 chunk 文件名 = 被请求的文件名', String(chunk.loads[0]?.chunk));

// ── 全局污染 ─────────────────────────────────────────────────────────
judge('⑥', main.touched === false, '主包不写 globalThis', main.touched ? '写了' : '没写');
judge('⑥', chunk.touched === false, 'chunk 不写 globalThis', chunk.touched ? '写了' : '没写');

// ── 变异哨兵 ─────────────────────────────────────────────────────────
const mutantId = runInVm(mainSource.replace(`id: ${JSON.stringify(pkg.name)}`, 'id: "some-other-plugin"'), 'mutant-id');
judge('⑦', mutantId.loads[0]?.id !== pkg.name, '改掉 id ⇒ ① 会判红（哨兵）', mutantId.loads[0]?.id === pkg.name ? '没红 ⇒ 门的错' : `红 ✓（实际 id = ${String(mutantId.loads[0]?.id)}）`);

const mutantChunk = runInVm(chunkSource.replace('chunk: "client.containers.js", ', ''), 'mutant-chunk');
judge('⑦', mutantChunk.loads[0]?.chunk === undefined, '抽掉 chunk 自报 ⇒ ⑤ 会判红（哨兵）', mutantChunk.loads[0]?.chunk === undefined ? '红 ✓' : '没红 ⇒ 门的错');

if (checks === 0) {
  console.error('✗ 一条判据都没跑（结构性断言恒真）');
  process.exit(1);
}
console.log(`\n=== 结果：${String(checks)} 项断言，失败 ${String(failures)} 项 ===`);
process.exit(failures === 0 ? 0 : 1);
