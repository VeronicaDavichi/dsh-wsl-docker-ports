#!/usr/bin/env node
/**
 * 015 `P1` / `A1` 的**零交叉门** —— `scripts/check-borders.mjs`
 *
 * ## 这道门在防什么
 *
 * 015 把「转发（ports）」与「容器（containers）」拆成**两条 cordis 行**，但它们仍在**同一个包里、
 * 同一个模块实例**里跑。拆分最容易失败的方式不是「没写新文件」，而是**悄悄又连回去**：
 * 容器侧 `import { buildSnapshot } from '../snapshot.ts'` 一行 → 两行又一次共享同一个失败面
 * （netsh 读失败连容器表一起挂），而**任何单测都不会红**。故：白名单写死在脚本里，**新增即红**。
 *
 * ## 五条判据（与 015 design §4 逐条对应）
 *
 * - **R1 容器侧黑名单**：`src/containers/**` 不许 import 转发侧的业务模块
 *   （`plugin/config/route/wire/snapshot/host-face`、`diff/`、`write/`、`elevate/`、`transport/`、
 *   `docker/`、`read/`、`client/`）。理由见 `design.md` §4.2 的逐条「为什么」。
 * - **R2 转发侧反向黑名单**：`src/containers/**` 之外的服务端文件不许 import `containers/`
 *   （方向必须单向；反向一旦存在，两行又变成一棵调用树）。
 * - **R3 共享层白名单**：`src/shared/**` 只许 import 自己人 + Node 内建 + `dsh-wsl-shared`，
 *   且**代码里**不许出现业务词汇（`portproxy` / `managedPorts` / `elevationPolicy` /
 *   `listenAddresses` / `netsh` / `docker` / 两个行 id）。共享层一旦认识业务，两个命名空间的口径
 *   就会在这里混成一份。
 * - **R4 公开面**：`src/index.ts` 不许再导出容器侧的东西（导出预算 12/25 是 001 的判据，
 *   这里只钉「容器插件 API 是包内 API」，两份判据不互相冒名）。
 * - **R5 无模块级可变状态**：`src/containers/**` 与 `src/shared/**` 顶层不许有 `let` / `var`
 *   （两条行共享**同一个模块实例** ⇒ 模块级 `let` 就是跨行的隐式共享状态；票据环、单例缓存
 *   一律必须 `ctx.effect` 作用域化）。
 *
 * ## 故障注入（`DSH_BORDERS_FAULT`）
 *
 * 与 `scripts/assert-client-split.mjs` 同风格：合成一个**已知违规**，证明「门真的会红」，
 * 而不是「扫了 0 个文件 ⇒ 全绿」。取值：
 *
 * ```
 * cross    在容器侧文件里合成一条 import '../snapshot.ts'
 * forward  在转发侧文件里合成一条 import './containers/plugin.ts'
 * shared   在共享层文件里合成一条 import '../wire.ts'
 * business 在共享层代码里合成一个业务词 'portproxy'
 * mutable  在容器侧文件顶层合成一句 let
 * export   在 src/index.ts 里合成一条容器侧再导出
 * ```
 *
 * 用法（Windows，包目录下；与既有门同一姿势）：
 *
 * ```
 * node scripts/check-borders.mjs
 * $env:DSH_BORDERS_FAULT='cross'; node scripts/check-borders.mjs   # 期望 exit 1
 * ```
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../wsl-shared/scripts/strip-comments.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');

const FAULT = process.env['DSH_BORDERS_FAULT'] ?? '';

/**
 * R1：容器侧**白名单**（比黑名单更强：新出现的跨层 import 默认是红的）。
 *
 * 允许：同目录 · `../shared/**`（HTTP/凭据/配置解包）· `../read/**`（003 的只读探针层，
 * 015 §4.1 明确允许复用 `docker ps` / `wsl -l -v` 这些真机口径）· `dsh-wsl-shared` · Node 内建。
 * 其余一律红 —— 包括 `../snapshot.ts`（一次 netsh 失败就会连带打空容器表）。
 */
const CONTAINERS_ALLOWED = [
  /^\.\/[^/]+\.tsx?$/u,
  /^\.\.\/shared\/[^/]+\.ts$/u,
  /^\.\.\/read\/[^/]+\.ts$/u,
  /^dsh-wsl-shared$/u,
  /^node:[a-z/_-]+$/u,
];

/**
 * R2：「转发侧 → 容器侧」的**唯一**白名单边。
 *
 * `src/plugin.ts` 的 `apply` 是两条行共用的入口，必须能调到容器侧的装配；除此之外任何
 * 转发侧文件 import `containers/**` 都是红的（那等于把容器能力重新挂回转发侧的闭包）。
 */
const FORWARD_TO_CONTAINERS_ALLOWED = [['plugin.ts', './containers/plugin.ts']];

/** R3：共享层认识的**业务词**（代码里出现即红；注释已被剥掉） */
const SHARED_BUSINESS_WORDS = [
  'portproxy',
  'managedPorts',
  'elevationPolicy',
  'listenAddresses',
  'netsh',
  'docker',
  'dsh-wsl-docker-ports',
  'dsh-wsl-docker-containers',
];

/** R3：共享层允许的 import 源 */
const SHARED_ALLOWED = [/^\.\/[^/]+\.ts$/u, /^node:[a-z/_-]+$/u, /^dsh-wsl-shared$/u];

function isCodeFile(name) {
  return name.endsWith('.ts') || name.endsWith('.tsx');
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && isCodeFile(entry.name)) out.push(full);
  }
  return out;
}

function relOf(file) {
  return path.relative(SRC, file).split(path.sep).join('/');
}

/** 只认**静态 import / export from / 动态 import(字面量)**；注释先剥、字符串模板不解析（本仓不使用） */
function importSpecifiers(code) {
  const specs = [];
  for (const match of code.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/gu)) {
    specs.push({ spec: match[3], typeOnly: match[2] === 'type ' });
  }
  for (const match of code.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/gu)) {
    specs.push({ spec: match[1], typeOnly: false });
  }
  for (const match of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
    specs.push({ spec: match[1], typeOnly: false });
  }
  return specs.filter((item) => typeof item.spec === 'string');
}

/** 把相对 import 解析成「相对 `src/` 的路径」（不解析 `dsh-wsl-shared` 之类外部包） */
function resolveRelative(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  return joined.replace(/^\.\//u, '');
}

const violations = [];
/** 类型导入桥（编译期擦除、不进运行期闭包）：不算违规，但**列出来**供人工复核 */
const typeBridges = [];
/** 被 R2 白名单放行的「转发侧 → 容器侧」边（目前**恰好 1 条**） */
const allowedEdges = [];

function report(rule, file, message) {
  violations.push({ rule, file, message });
}

async function main() {
  const files = await walk(SRC);
  if (files.length < 20) {
    console.error(`✗ 只扫到 ${String(files.length)} 个源文件（期望 >= 20）⇒ 判据可能空转，直接失败。`);
    process.exit(1);
  }

  const sources = [];
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    sources.push({ file, rel: relOf(file), code: stripComments(raw) });
  }

  // ── 故障注入：只合成一条，证明判据真的会红 ─────────────────────────────────
  const inject = (rel, code) => {
    const target = sources.find((source) => source.rel === rel);
    if (target === undefined) {
      console.error(`✗ 故障注入目标不存在：${rel} ⇒ 注入无效（判据可能空转），直接失败。`);
      process.exit(1);
    }
    target.code += code;
  };

  if (FAULT === 'cross') inject('containers/wire.ts', "\nimport { x } from '../snapshot.ts';\n");
  if (FAULT === 'forward') inject('snapshot.ts', "\nimport { x } from './containers/plugin.ts';\n");
  if (FAULT === 'shared') inject('shared/http.ts', "\nimport { x } from '../wire.ts';\n");
  if (FAULT === 'business') inject('shared/http.ts', '\nexport const LEAK = "portproxy";\n');
  if (FAULT === 'mutable') inject('containers/wire.ts', '\nlet leak = 0;\n');
  if (FAULT === 'export') inject('index.ts', "\nexport * from './containers/plugin.ts';\n");
  if (FAULT !== '' && !['cross', 'forward', 'shared', 'business', 'mutable', 'export'].includes(FAULT)) {
    console.error(`✗ 未知的 DSH_BORDERS_FAULT=${FAULT}`);
    process.exit(1);
  }

  for (const source of sources) {
    const specs = importSpecifiers(source.code);
    const resolved = specs.map((item) => ({ ...item, target: resolveRelative(source.rel, item.spec) }));

    // R1：容器侧只许白名单（同目录 / ../shared / ../read / dsh-wsl-shared / node:）
    if (source.rel.startsWith('containers/')) {
      for (const { spec, target, typeOnly } of resolved) {
        // 类型导入编译期擦除、不进运行期闭包 ⇒ 不算越界，但**跨白名单的**要列出来供人工复核
        if (typeOnly) {
          if (!CONTAINERS_ALLOWED.some((pattern) => pattern.test(spec))) typeBridges.push(`${source.rel} → ${spec}`);
          continue;
        }
        if (!CONTAINERS_ALLOWED.some((pattern) => pattern.test(spec))) {
          report(
            'R1',
            source.rel,
            `容器侧 import 越出白名单（'${spec}'${target === null ? '' : ` → '${target}'`}）；允许：同目录 / ../shared / ../read / dsh-wsl-shared / node:`,
          );
        }
      }
    }

    // R2：转发侧不许 import 容器侧（唯一白名单边：plugin.ts → ./containers/plugin.ts）
    const isForwarding = !source.rel.startsWith('containers/') && !source.rel.startsWith('shared/') && !source.rel.startsWith('client/');
    if (isForwarding) {
      for (const { spec, target, typeOnly } of resolved) {
        if (typeOnly || target === null || !target.startsWith('containers/')) continue;
        if (FORWARD_TO_CONTAINERS_ALLOWED.some(([from, edge]) => from === source.rel && edge === spec)) {
          allowedEdges.push(`${source.rel} → ${spec}`);
          continue;
        }
        report('R2', source.rel, `转发侧不许 import 容器侧（'${spec}' → '${target}'）；方向必须单向`);
      }
    }

    // R3：共享层只许自己人 + Node 内建 + dsh-wsl-shared，且不许认识业务词
    if (source.rel.startsWith('shared/')) {
      for (const { spec } of resolved) {
        if (!SHARED_ALLOWED.some((pattern) => pattern.test(spec))) {
          report('R3', source.rel, `共享层只许 import 自己人 / node: 内建 / dsh-wsl-shared，实际 '${spec}'`);
        }
      }
      for (const word of SHARED_BUSINESS_WORDS) {
        if (source.code.includes(word)) {
          report('R3', source.rel, `共享层代码里出现业务词 '${word}'（共享层必须字段/行无关）`);
        }
      }
    }

    // R4：公开面不许再导出容器侧
    if (source.rel === 'index.ts') {
      for (const { spec, target } of resolved) {
        if (target !== null && target.startsWith('containers/')) {
          report('R4', source.rel, `包公开面不许导出容器侧（'${spec}'）；容器插件 API 是包内 API`);
        }
      }
    }

    // R5：容器侧 / 共享层不许模块级可变状态（两行共享同一个模块实例）
    if (source.rel.startsWith('containers/') || source.rel.startsWith('shared/')) {
      const lines = source.code.split(/\r?\n/u);
      lines.forEach((line, index) => {
        if (/^(?:export\s+)?(?:let|var)\s/u.test(line)) {
          report('R5', source.rel, `顶层出现模块级可变状态（第 ${String(index + 1)} 行）：${line.trim()}`);
        }
      });
    }
  }

  if (violations.length > 0) {
    const label = FAULT === '' ? '' : `（含故障注入 ${FAULT}）`;
    console.error(`✗ 零交叉门红了：${String(violations.length)} 条违规${label}`);
    for (const item of violations) console.error(`  · [${item.rule}] ${item.file}：${item.message}`);
    // 故障注入的「红」是**预期结果**（证明判据真的会红）⇒ 用 exit 2 与「真违规 exit 1」区分开，
    // 这样 CI 上「门有效」与「代码越界」不会混成同一个信号。
    process.exit(FAULT === '' ? 1 : 2);
  }

  if (FAULT !== '') {
    console.error(`✗ 故障注入 ${FAULT} 没有被判据抓到 ⇒ 门是空转的（应当红），直接失败。`);
    process.exit(1);
  }

  const counts = {
    containers: sources.filter((source) => source.rel.startsWith('containers/')).length,
    shared: sources.filter((source) => source.rel.startsWith('shared/')).length,
    forwarding: sources.filter(
      (source) => !source.rel.startsWith('containers/') && !source.rel.startsWith('shared/') && !source.rel.startsWith('client/'),
    ).length,
  };

  console.log(`✓ 零交叉门：扫了 ${String(sources.length)} 个源文件（转发 ${String(counts.forwarding)} / 共享 ${String(counts.shared)} / 容器 ${String(counts.containers)}）`);
  console.log('  R1 容器侧白名单 0 命中 · R2 转发侧反向 0 命中 · R3 共享层白名单 0 命中');
  console.log('  R4 公开面 0 条容器导出 · R5 模块级可变状态 0 处');
  if (allowedEdges.length > 0) console.log(`  白名单边（R2 逐条登记）：${allowedEdges.join(' | ')}`);
  if (typeBridges.length > 0) console.log(`  类型导入桥（编译期擦除，不进运行期闭包）：${typeBridges.join(' | ')}`);
}

await main();
