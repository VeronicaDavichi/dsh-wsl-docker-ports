/**
 * **016 三包零交叉门** —— `packages/wsl-docker-core/scripts/check-borders.mjs`（SSoT）
 *
 * ## 这道门在防什么
 *
 * 016 把「纯库 core / 转发插件 ports / 容器插件 containers」拆成三个**真包**。拆包最容易失败的方式
 * 不是「没建目录」，而是**悄悄又连回去**：容器侧 `import { buildSnapshot } from '../../wsl-docker-ports/src/snapshot.ts'`
 * 一行，两行插件就又共享同一个失败面（netsh 读失败连容器表一起挂），而**任何单测都不会红**。
 *
 * 所以判据是**白名单**，写死在脚本里，**新增即红**（红了你先去看白名单要不要改 Spec，而不是先改脚本）。
 *
 * ## 六条判据
 *
 * | # | 判据 | 为什么 |
 * | --- | --- | --- |
 * | R1 | 每个包 `src/**` + `tests/**` 的 import 只许命中白名单（自身相对路径 / 白名单外部包） | 建边 = 毁掉「一行挂不连累另一行」 |
 * | R2 | **core 不许** import 两个插件包（方向只能是 插件 → core） | 纯库反向依赖插件 = 循环 + 库被插件语义污染 |
 * | R3 | **ports 与 containers 互相零 import**（双向，含 tests） | 这是拆包的全部意义 |
 * | R4 | 插件包 `src/**` 里不许出现**对方**的行 id / 前缀字面量（注释与测试除外） | 硬编码对方前缀 = 隐性耦合 |
 * | R5 | 每包**恰好一个角色**：不存在 `src/role.ts` 式的「一个包判两个角色」 | 016 的删除项之一 |
 * | R6 | 计数不许为 0（`assertScanned`） | 结构性断言最容易退化成恒真 |
 *
 * 用法：`node packages/wsl-docker-core/scripts/check-borders.mjs [--quiet]`（从仓库根或任一包内跑都行）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const QUIET = process.argv.includes('--quiet');

/** 三个包（016 的最终形态） */
const PACKAGES = {
  core: { dir: 'packages/wsl-docker-core', name: 'dsh-wsl-docker-core', role: 'lib' },
  ports: { dir: 'packages/wsl-docker-ports', name: 'dsh-wsl-docker-ports', role: 'plugin' },
  containers: { dir: 'packages/wsl-docker-containers', name: 'dsh-wsl-docker-containers', role: 'plugin' },
};

/**
 * 外部包白名单（按包分别写；**不许**用「反正不是相对路径」这种松口径）。
 *
 * 键 = 包逻辑名，值 = 允许出现的 bare specifier 前缀。
 */
const CLIENT_EXTERNALS = [
  // React 是 peerDependency（§P2：**不打进 bundle**，由宿主提供），client 半当然会 import 它
  'react',
  'react-dom',
  // 宿主 UI 原语（运行时由宿主注入，构建时是 external）
  'ui-primitives',
  // 宿主官方包：`@deepseek-ai/` 开头一律按宿主提供处理
  '@deepseek-ai/',
];

const EXTERNALS = {
  core: ['dsh-wsl-shared', 'node:'],
  ports: ['dsh-wsl-shared', 'dsh-wsl-docker-core', ...CLIENT_EXTERNALS, 'node:'],
  containers: ['dsh-wsl-shared', 'dsh-wsl-docker-core', ...CLIENT_EXTERNALS, 'node:'],
};

/** 测试里额外允许多跑的东西（`node --test` / vitest / react 渲染） */
const TEST_EXTERNALS = ['vitest', '@testing-library/', 'react', 'react-dom', 'ui-primitives', '@deepseek-ai/', 'node:'];

/**
 * 各包「对方的**路由前缀字面量**」：出现在自己 `src/` 的**代码**里就是隐性耦合
 * （包名 specifier 归 R1/R3 管；这里只管「前缀」——它是宿主分派与命名空间的真实身份）。
 *
 * ⚠️ 只查**带引号**的前缀字面量，且只在**剥掉注释之后**查：用户文案里提一句
 * 「转发侧 `dsh-wsl-docker-ports` 的凭据对容器通道无效」是**必要的信息**，不是耦合
 * （016 之前的 015 守卫也因为这一点专门写了「朴素 grep 会误报」）。
 */
const IDENTITY = {
  ports: { foreign: ["'/dsh-wsl-docker-containers", '"/dsh-wsl-docker-containers'] },
  containers: { foreign: ["'/dsh-wsl-docker-ports", '"/dsh-wsl-docker-ports'] },
  core: { foreign: [] },
};

let failures = 0;
let scanned = 0;

function fail(id, message) {
  failures += 1;
  console.error(`  ✗ ${id} ${message}`);
}

function ok(id, message) {
  if (!QUIET) console.log(`  ok  ${id} — ${message}`);
}

/** 收集一个目录下的全部 `.ts` / `.tsx`（不跟软链，不扫 `lib/` 与 `node_modules/`） */
function collect(dir) {
  const out = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx|mjs)$/u.test(entry)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * 去掉注释后返回 import / export-from 的 specifier 列表。
 *
 * 不用 AST：016 的判据是「有没有这条边」，字面量正则足够且**与仓里其它守卫同口径**
 * （`wsl-shared/scripts/strip-comments.mjs` 是 SSoT，这里直接复用，不另写一份）。
 */
let stripComments;
try {
  // ⚠️ Windows 绝对路径必须过 `pathToFileURL`：`import('E:\\…')` 会把 `E:` 当成 URL scheme 抛错
  ({ stripComments } = await import(pathToFileURL(resolve(REPO, 'packages/wsl-shared/scripts/strip-comments.mjs')).href));
} catch (error) {
  // 工具本身坏了必须**当场判红**，不能用 identity 兜底（那会让注释里的字面量全被算成命中，
  // 或者反过来让守卫悄悄失去判据 —— 两种情况都比崩溃更糟）。
  console.error(`✗ 无法加载 strip-comments.mjs（SSoT）：${String(error)}`);
  process.exit(1);
}

const SPECIFIER = /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*\(?\s*['"]([^'"]+)['"]/gu;

function specifiersOf(file) {
  const text = stripComments(readFileSync(file, 'utf8'));
  const found = [];
  for (const match of text.matchAll(SPECIFIER)) {
    const spec = match[1] ?? match[2];
    if (spec !== undefined) found.push(spec);
  }
  return found;
}

const isTest = (rel) => /(^|[/\\])tests[/\\]/u.test(rel);

/** 解析一个 specifier 指向哪个包的目录（跨包边才需要判） */
function packageOf(spec) {
  for (const [key, info] of Object.entries(PACKAGES)) {
    if (spec === info.name || spec.startsWith(`${info.name}/`)) return key;
  }
  return undefined;
}

// ───────────────────────── R1 / R2 / R3 ─────────────────────────

for (const [key, info] of Object.entries(PACKAGES)) {
  const root = resolve(REPO, info.dir);
  const files = collect(join(root, 'src')).concat(collect(join(root, 'tests')));
  if (files.length === 0) {
    fail('R6', `${info.dir} 一个源文件都没扫到（结构性断言恒真 ⇒ 判红）`);
    continue;
  }
  scanned += files.length;

  const allowed = [...EXTERNALS[key]];
  for (const file of files) {
    const rel = relative(REPO, file);
    const isTestFile = isTest(rel);
    for (const spec of specifiersOf(file)) {
      // ① 同包相对路径：只许 `./` / `../`，且不许爬出包根
      //    （唯一例外：**测试**可以引 `packages/wsl-shared/scripts/*.mjs` 这份工具 SSoT
      //      —— 剥注释/预算表这类东西必须只有一份真相，测试借用它不是「建包边」）
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(root + sep) && target !== root) {
          const tooling = /[/\\]packages[/\\]wsl-shared[/\\]scripts[/\\][^/\\]+\.mjs$/u.test(target);
          if (!(isTestFile && tooling)) {
            fail('R1', `${rel} 用相对路径爬出了包根：${spec}`);
          }
        }
        // ② 相对路径指向**别的包**（`../../wsl-docker-ports/src/…`）⇒ 等同建边
        for (const [otherKey, other] of Object.entries(PACKAGES)) {
          if (otherKey === key) continue;
          if (target.startsWith(resolve(REPO, other.dir) + sep)) {
            fail('R3', `${rel} 用相对路径引了别的包（${otherKey}）：${spec} —— 只许 import '${other.name}'`);
          }
        }
        continue;
      }

      // ③ bare specifier：必须在白名单里
      const permitted = allowed.some((prefix) => spec === prefix || spec.startsWith(prefix));
      const testPermitted = isTestFile && TEST_EXTERNALS.some((prefix) => spec === prefix || spec.startsWith(prefix));
      if (!permitted && !testPermitted) {
        fail('R1', `${rel} 引了白名单外的包：${spec}（白名单：${allowed.join(' / ')}${isTestFile ? ` + 测试：${TEST_EXTERNALS.join(' / ')}` : ''}）`);
      }

      // ④ core 反向依赖插件包 ⇒ 判红（R2 是 R1 的强化版，单独报）
      if (key === 'core' && (spec === PACKAGES.ports.name || spec === PACKAGES.containers.name)) {
        fail('R2', `${rel}：core 反向 import 了插件包 ${spec}`);
      }
    }
  }
}

ok('R1/R2/R3', `${Object.keys(PACKAGES).length} 个包的 import 白名单零越界（扫了 ${String(scanned)} 个文件）`);

// ───────────────────────── R4 身份字面量 ─────────────────────────

for (const [key, info] of Object.entries(PACKAGES)) {
  const identity = IDENTITY[key];
  if (identity.foreign.length === 0) continue;
  const files = collect(join(resolve(REPO, info.dir), 'src'));
  let hits = 0;
  for (const file of files) {
    const rel = relative(REPO, file);
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const needle of identity.foreign) {
      if (!text.includes(needle)) continue;
      hits += 1;
      fail('R4', `${rel} 的 src 里出现对方**路由前缀**字面量：${needle}`);
    }
  }
  ok('R4', `${info.dir} 的 src 里对方身份字面量 ${String(hits)} 处（应为 0）`);
}

// ───────────────────────── R5 每包恰好一个角色 ─────────────────────────

for (const info of Object.values(PACKAGES)) {
  const roleFile = join(resolve(REPO, info.dir), 'src/role.ts');
  try {
    statSync(roleFile);
    fail('R5', `${info.dir}/src/role.ts 存在 —— 016 已删除「一包判两个角色」，每个包只有一个角色`);
  } catch {
    // 不存在 = 期望
  }
}
ok('R5', '三个包都不再有 src/role.ts（每包一个角色）');

// ───────────────────────── 汇总 ─────────────────────────

if (failures > 0) {
  console.error(`\n✗ 零交叉门：${String(failures)} 项失败（扫了 ${String(scanned)} 个文件）`);
  process.exit(1);
}
console.log(`✓ 零交叉门：扫了 ${String(scanned)} 个文件（core ${String(Object.keys(PACKAGES).length)} 包白名单 / R1–R6 全绿）`);
