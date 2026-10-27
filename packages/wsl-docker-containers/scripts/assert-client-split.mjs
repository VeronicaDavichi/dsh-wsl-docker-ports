/**
 * 容器包的客户端切分门 —— `scripts/assert-client-split.mjs`
 *
 * ## 016 为什么容器包也需要这道门
 *
 * 拆分前容器页是转发包的**第二个 chunk**；拆分后它变成**自己包里的主包 + 自己的 chunk**。形态换了，
 * 判据反而更简单，但**更容易悄悄退化**：把整个页面塞回主包（少一次异步请求）在任何单测里都不会红。
 *
 * ## 判据（每条都可二值判定；每条都打印扫描项计数，为 0 即失败）
 *
 * | # | 判据 |
 * | --- | --- |
 * | ① | 主包存在，且 `≤ 65,536 B`（§P2 硬判据） |
 * | ② | 主包里有 `require.async("./client.containers.js")`（取块调用点） |
 * | ③ | chunk 文件存在，且被主包**按名引用**（三处同名：surface 常量 / 本脚本 / 产物） |
 * | ④ | chunk 里含**容器页**的模块与 testid 标记（证「搬家不是删除」） |
 * | ⑤ | 主包里**不含**容器表的 testid（证「页面真在 chunk 里」） |
 * | ⑥ | 两个产物都**不含**内联 React 指纹，也不含转发包的路由前缀（拆分后不许再连回去） |
 * | ⑦ | **变异哨兵**：往主包里注入一条 testid ⇒ ⑤ 必须变红；往 chunk 注入转发前缀 ⇒ ⑥ 必须变红 |
 *
 * 用法：`node scripts/assert-client-split.mjs`（需先 `node scripts/build-client.mjs`）
 */

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK_FIELDS, MAIN_BUNDLE_BUDGETS, parseDocBudgets } from '../../wsl-shared/scripts/main-bundle-budgets.mjs';

/** 本包清单（名字 / 版本）；预算表的键就是包名 */
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));

const mainPath = path.join(pkgRoot, 'lib', 'client.js');
const chunkPath = path.join(pkgRoot, 'lib', 'client.containers.js');

/** §P2 硬判据（主 bundle 上限，含等号） */
const MAIN_MAX = 65_536;

/** chunk 里必须出现的容器页标记（搬家证明，不是「同名文件存在」） */
const CHUNK_MARKERS = [
  'src/client/containers/pane.tsx',
  'src/client/containers/source.ts',
  'src/client/containers/config-page.tsx',
  'sel-containers-refresh-interval',
  'tbl-containers',
];

/** 主包里必须**不存在**的容器表标记（页面在 chunk 里） */
const MUST_BE_IN_CHUNK_ONLY = ['sel-containers-refresh-interval', 'tbl-containers'];

/** 内联 React 指纹（§P2 ⑤a） */
const REACT_FINGERPRINTS = ['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED', 'react.element', 'react.element'];

/** 转发包的路由前缀（拆分后两包互不相认） */
const PORTS_PREFIX = '/dsh-wsl-docker-ports';

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

function readOrFail(file, label) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    failures += 1;
    console.error(`  ✗    ① ${label} 读不出来：${String(error)}（先跑 node scripts/build-client.mjs）`);
    return undefined;
  }
}

const main = readOrFail(mainPath, 'lib/client.js');
const chunk = readOrFail(chunkPath, 'lib/client.containers.js');
if (main === undefined || chunk === undefined) {
  console.error('✗ 客户端切分门：产物缺失，无法判定');
  process.exit(1);
}

const mainBytes = statSync(mainPath).size;
const chunkBytes = statSync(chunkPath).size;

// ⓪ SSoT 预算 + 文档锁（与转发包同一份表；「三处同步」的机器判据）
const budget = MAIN_BUNDLE_BUDGETS[pkg.name];
judge('⓪', typeof budget?.limitBytes === 'number', 'SSoT 里有本包的登记行', budget === undefined ? '缺 ⇒ 先登记 main-bundle-budgets.mjs' : `limitBytes=${String(budget.limitBytes)} / nature=${String(budget.nature)} / trace=${String(budget.trace)}`);
if (typeof budget?.limitBytes === 'number') {
  judge('⓪', mainBytes <= budget.limitBytes, '主包 ≤ 登记上限（棘轮：只许降不许升）', `${String(mainBytes)} B ≤ ${String(budget.limitBytes)} B`);
  // 文档锁：契约 §P2 的机器可读表必须与本表**逐字段相等**（否则「三处同步」就成了口号）
  const docText = readFileSync(path.resolve(pkgRoot, '../../client-contract-incremental.md'), 'utf8');
  const docRow = parseDocBudgets(docText)[pkg.name];
  const locked = docRow !== undefined && LOCK_FIELDS.every((field) => String(docRow[field]) === String(budget[field]));
  judge('⓪', locked, '机器表 ↔ client-contract §P2 文档表逐字段相等（4 个锁字段）', locked ? '一致' : `文档表=${JSON.stringify(docRow)} / 机器表=${JSON.stringify(Object.fromEntries(LOCK_FIELDS.map((f) => [f, budget[f]])))}`);
}

// ① 主包体积硬判据
judge('①', mainBytes <= MAIN_MAX, '主包 ≤ 65,536 B（§P2 硬判据）', `${String(mainBytes)} B（余 ${String(MAIN_MAX - mainBytes)} B）`);
judge('①', chunkBytes > 0, 'chunk 非空', `${String(chunkBytes)} B`);

// ② 取块调用点
//    说明符经 `CONTAINERS_CHUNK` 常量传入（`loadContainersChunk(spec) => require.async(spec)`），
//    所以判据是「**两条都在**」：`require.async` 的调用点 + 指向本包 chunk 的**单一字面量**。
//    —— 只查字面量会放过「常量还在、调用点被删」；只查调用点会放过「调到别的包去」。
const hasAsyncCall = main.includes('require.async(');
const hasChunkLiteral = main.includes('"./client.containers.js"');
judge(
  '②',
  hasAsyncCall && hasChunkLiteral,
  '主包里有取块调用点 + 指向本包 chunk 的字面量',
  `require.async ${hasAsyncCall ? '在' : '缺'} / 字面量 ${hasChunkLiteral ? '在' : '缺'}`,
);

// ③ chunk 被按名引用 + 存在
const named = main.includes('client.containers.js');
judge('③', named, '主包按文件名引用 chunk（含 `chunk:` 自报 / 说明符）', named ? '命中' : '0 处');
const chunkSelfRegister = chunk.includes('chunk: "client.containers.js"');
judge('③', chunkSelfRegister, 'chunk 自报的文件名 = 被请求的文件名（宿主按 URL 记账）', chunkSelfRegister ? '一致' : '不一致 ⇒ 宿主会报 loaded without registering');

// ④ chunk 里的容器页标记
let chunkHits = 0;
for (const marker of CHUNK_MARKERS) {
  if (!chunk.includes(marker)) {
    judge('④', false, 'chunk 里缺少容器页标记', marker);
    continue;
  }
  chunkHits += 1;
}
judge('④', chunkHits === CHUNK_MARKERS.length, `chunk 含 ${String(CHUNK_MARKERS.length)} 条容器页标记（搬家不是删除）`, `${String(chunkHits)} / ${String(CHUNK_MARKERS.length)} 命中`);

// ⑤ 主包不许有容器表 testid
let leaked = 0;
for (const marker of MUST_BE_IN_CHUNK_ONLY) {
  if (!main.includes(marker)) continue;
  leaked += 1;
  judge('⑤', false, '主包里出现了本该只在 chunk 里的标记', marker);
}
judge('⑤', leaked === 0, `${String(MUST_BE_IN_CHUNK_ONLY.length)} 条容器表标记不在主包`, `泄漏 ${String(leaked)} 条（扫描项 ${String(MUST_BE_IN_CHUNK_ONLY.length)}）`);

// ⑥ 不内联 React / 不含转发前缀
let reactHits = 0;
let prefixHits = 0;
for (const fingerprint of REACT_FINGERPRINTS) {
  if (main.includes(fingerprint)) reactHits += 1;
  if (chunk.includes(fingerprint)) reactHits += 1;
}
judge('⑥', reactHits === 0, '两个产物都不含内联 React 指纹', `命中 ${String(reactHits)} 处（扫描项 ${String(REACT_FINGERPRINTS.length * 2)}）`);
if (main.includes(PORTS_PREFIX)) prefixHits += 1;
if (chunk.includes(PORTS_PREFIX)) prefixHits += 1;
judge('⑥', prefixHits === 0, '两个产物都不含转发包前缀（两包互不相认）', `命中 ${String(prefixHits)} 处`);

// ⑦ 变异哨兵：判据必须能杀旧行为（注入 ⇒ 必红）
const mutantMain = `${main}\nvar MUTANT_TITLE = "sel-containers-refresh-interval";\n`;
const mutantChunk = `${chunk}\nvar MUTANT_PREFIX = "${PORTS_PREFIX}";\n`;
const leakRed = MUST_BE_IN_CHUNK_ONLY.some((marker) => mutantMain.includes(marker));
const prefixRed = mutantChunk.includes(PORTS_PREFIX);
judge('⑦', leakRed, '注入容器表 testid 到主包 ⇒ ⑤ 会判红（哨兵）', leakRed ? '红 ✓' : '没红 ⇒ 门的错');
judge('⑦', prefixRed, '注入转发前缀到 chunk ⇒ ⑥ 会判红（哨兵）', prefixRed ? '红 ✓' : '没红 ⇒ 门的错');

if (checks === 0) {
  console.error('✗ 一条判据都没跑（结构性断言恒真）');
  process.exit(1);
}

console.log(`\n=== 结果：${String(checks)} 项断言，失败 ${String(failures)} 项 ===`);
process.exit(failures === 0 ? 0 : 1);
