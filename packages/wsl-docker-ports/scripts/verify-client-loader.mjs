/**
 * 客户端半产物核验（003 T5.1 的构建接线 / contract §A §B §P3 §P4）
 *
 * ## 为什么必须「真在 vm 里跑一遍」
 *
 * 「产物存在」「文件名对」这类静态检查**证明不了**：`window.__ModuleLoader__.load` 被调用了几次、
 * `id` 是什么、`factory` 拿到的 exports 里有没有 `default`、它**实际** require 了哪些模块。
 * 这些只能靠把产物丢进 `node:vm` + 假 `window` + 假 `require` 真执行一次。
 *
 * ## 每条断言都打印「扫描/检查了多少项」
 *
 * 结构性断言最容易退化成恒真（`for (const x of []) assert(x)`）。因此每个循环都报计数，
 * 计数为 0 时**判失败**（`expectScanned`）—— 恒真断言在计数上就露馅。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));

/**
 * **基线模块**（宿主已供应，无需声明）。依据 `client-contract.md` §P4：
 * React 全家 + Cordis + 官方静态 UI 库（`@deepseek-ai/dsh-client-*`）视为平台自带。
 * ⚠️ 这是本脚本**显式写下的假设**（本机读不到官方源码），不是从官方产物推导的结论。
 */
const BASELINE_EXACT = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'ui-primitives',
  '@deepseek-ai/cordis',
];
const BASELINE_PREFIXES = ['@deepseek-ai/dsh-client-'];

let checks = 0;
const failures = [];

function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail === undefined ? '' : ` — ${detail}`}`);
}

/** 计数为 0 的结构性断言 = 恒真，直接判失败 */
function expectScanned(name, count, ok, detail) {
  check(name, count > 0 && ok, `${detail}（扫描项 ${String(count)}，为 0 即恒真）`);
}

function isBaseline(request) {
  return BASELINE_EXACT.includes(request) || BASELINE_PREFIXES.some((prefix) => request.startsWith(prefix));
}

console.log('=== 1. 清单（package.json 的 dsh.client） ===');
const manifest = pkg.dsh?.client;
check('dsh.client 存在', manifest !== undefined && typeof manifest === 'object');
check('dsh.client.platform 是字符串', typeof manifest?.platform === 'string', `platform=${JSON.stringify(manifest?.platform)}`);

const injectNames = manifest?.inject;
check('dsh.client.inject 是字符串数组（包名数组，信息性依赖）', Array.isArray(injectNames) && injectNames.every((item) => typeof item === 'string'), `inject=${JSON.stringify(injectNames)}`);
expectScanned(
  'dsh.client.inject 里没有 Cordis 服务名 slots（同名不同物，写错会让宿主按包名解析失败）',
  Array.isArray(injectNames) ? injectNames.length : 0,
  Array.isArray(injectNames) && !injectNames.includes('slots'),
  `inject 项数 ${String(Array.isArray(injectNames) ? injectNames.length : 0)}`,
);
check('dsh.client.immediately 未被写入', manifest?.immediately === undefined);

const declaredExternal = manifest?.external;
check('dsh.client.external 缺省或字符串数组', declaredExternal === undefined || (Array.isArray(declaredExternal) && declaredExternal.every((item) => typeof item === 'string')), `external=${JSON.stringify(declaredExternal)}`);
const externals = Array.isArray(declaredExternal) ? declaredExternal : [];

console.log('\n=== 2. exports["./client"] 指向的产物 ===');
const clientExport = pkg.exports?.['./client'];
const clientTarget = typeof clientExport === 'string' ? clientExport : clientExport?.default;
check('exports["./client"] 是字符串，或含字符串 default 的对象', typeof clientTarget === 'string', `target=${JSON.stringify(clientTarget)}`);
check('主产物文件名恰好是 client.js（宿主 chunkUrl() 会断言 <rowId>/client.js，不匹配直接 throw）', typeof clientTarget === 'string' && path.posix.basename(clientTarget) === 'client.js', `basename=${JSON.stringify(typeof clientTarget === 'string' ? path.posix.basename(clientTarget) : null)}`);

const artifactPath = path.join(pkgRoot, String(clientTarget ?? ''));
check('产物文件真实存在（缺失 = 激活期响亮失败，而不是页面静默空白）', existsSync(artifactPath), path.relative(pkgRoot, artifactPath));

let source = '';
if (existsSync(artifactPath)) {
  source = readFileSync(artifactPath, 'utf8');
  check('产物非空', source.length > 0, `${String(statSync(artifactPath).size)} B`);
}

console.log('\n=== 3. 在 node:vm 里真执行一次 ===');
const loads = [];
const requires = [];
const placeholder = function placeholder() {};
function makeStub() {
  return new Proxy(placeholder, {
    get: (_target, key) => (key === '__esModule' ? true : placeholder),
    apply: () => placeholder,
  });
}

const sandbox = {
  window: { __ModuleLoader__: { load: (entry) => loads.push(entry) } },
  console,
  process: { env: {} },
  setTimeout,
  clearTimeout,
  queueMicrotask,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

const fakeRequire = (request) => {
  requires.push(request);
  if (isBaseline(request) || externals.includes(request)) return makeStub();
  throw new Error(`未声明的模块请求：${request}`);
};

let threw = null;
try {
  vm.runInContext(source, sandbox, { filename: 'client.js' });
} catch (error) {
  threw = error;
}
check('产物在无 DOM 环境下可加载（顶层不得触碰 document / react-dom）', threw === null, threw === null ? undefined : String(threw?.message));

check('window.__ModuleLoader__.load 恰好被调用 1 次', loads.length === 1, `实际 ${String(loads.length)} 次`);
const entry = loads[0];
check('注册 id === 包名', entry?.id === pkg.name, `id=${JSON.stringify(entry?.id)} 包名=${pkg.name}`);
check('注册项带 factory 函数', typeof entry?.factory === 'function');

let exports_ = null;
let factoryError = null;
try {
  exports_ = entry.factory(fakeRequire);
} catch (error) {
  factoryError = error;
}
check('factory 执行不抛异常', factoryError === null, factoryError === null ? undefined : String(factoryError?.message));
check('exports.apply 是函数', typeof exports_?.apply === 'function', `typeof=${typeof exports_?.apply}`);

const injectValue = exports_?.inject;
check(
  "exports.inject === ['slots']（模块级 Cordis 服务注入，只放稳定服务）",
  Array.isArray(injectValue) && injectValue.length === 1 && injectValue[0] === 'slots',
  `inject=${JSON.stringify(injectValue)}`,
);
check('exports 没有 default（客户端入口无默认导出，与宿主半相反）', !Object.prototype.hasOwnProperty.call(exports_ ?? {}, 'default'), `键=${JSON.stringify(Object.keys(exports_ ?? {}))}`);

console.log('\n=== 4. 模块请求集合（运行时真捕获） ===');
const uniqueRequires = [...new Set(requires)];
const nonBaseline = uniqueRequires.filter((request) => !isBaseline(request));
const undeclared = nonBaseline.filter((request) => !externals.includes(request));
const ghost = externals.filter((request) => !nonBaseline.includes(request));

expectScanned(
  '① 实际 require 的模块 ⊆ 基线 ∪ 已声明 external',
  uniqueRequires.length,
  undeclared.length === 0,
  `未声明请求 ${String(undeclared.length)} 项 ${JSON.stringify(undeclared)}；实际请求 ${JSON.stringify(uniqueRequires)}`,
);
// ② 的判据两端都要有对象才有内容 ⇒ 计数取「实际请求 ∪ 声明」两侧之和，
// 于是「声明 0 项、实际也 0 项非基线」不是一个空真命题，而是「两侧集合正好等价」的一个特例。
expectScanned(
  '② 声明 external ≡ 实际非基线请求（既无未声明请求，也无幽灵声明）',
  uniqueRequires.length + externals.length,
  undeclared.length === 0 && ghost.length === 0,
  `非基线请求 ${String(nonBaseline.length)} 项、声明 ${String(externals.length)} 项、幽灵 ${String(ghost.length)} 项`,
);
console.log(`  · 基线白名单 ${String(BASELINE_EXACT.length)} 个精确名 + ${String(BASELINE_PREFIXES.length)} 个前缀；声明 external ${String(externals.length)} 项；实际唯一请求 ${String(uniqueRequires.length)} 项；require 调用 ${String(requires.length)} 次`);

console.log('\n=== 5. 静态扫描（结构事实） ===');
const clientDir = path.join(pkgRoot, 'src', 'client');
const clientFiles = existsSync(clientDir)
  ? readdirSync(clientDir)
      .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
      .map((name) => path.join(clientDir, name))
  : [];
expectScanned('src/client/** 文件数 > 0', clientFiles.length, true, `文件 ${String(clientFiles.length)} 个`);

const hexHits = [];
let scannedBytes = 0;
for (const file of clientFiles) {
  const text = readFileSync(file, 'utf8');
  scannedBytes += Buffer.byteLength(text);
  for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) hexHits.push(`${path.basename(file)}:${match[0]}`);
}
expectScanned(
  '③ 客户端半零硬编码 hex 颜色（NFR-7：颜色只走宿主 --dsw-alias-* token）',
  clientFiles.length,
  hexHits.length === 0,
  `扫 ${String(scannedBytes)} 字节，命中 ${String(hexHits.length)} 处 ${JSON.stringify(hexHits)}`,
);

const profileHits = [];
let scannedBundleBytes = 0;
for (const file of [...clientFiles, artifactPath].filter((item) => existsSync(item))) {
  const text = readFileSync(file, 'utf8');
  scannedBundleBytes += Buffer.byteLength(text);
  if (text.includes('dsh-terminal-profiles')) profileHits.push(path.basename(file));
}
expectScanned(
  '④ 本包（源码 + 产物）不引用 dsh-terminal-profiles（跨包服务经 ctx.inject 软取，不建包依赖边）',
  clientFiles.length + 1,
  profileHits.length === 0,
  `扫 ${String(scannedBundleBytes)} 字节，命中 ${String(profileHits.length)} 个文件 ${JSON.stringify(profileHits)}`,
);

const cssHex = /#[0-9a-fA-F]{3,8}\b/g;
const bundleCssHits = [...source.matchAll(cssHex)].length;
check('⑤ 产物内零硬编码 hex 颜色（含内联 CSS 字符串）', bundleCssHits === 0, `命中 ${String(bundleCssHits)} 处`);

console.log(`\n=== 结果：${String(checks)} 项断言，失败 ${String(failures.length)} 项 ===`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;
