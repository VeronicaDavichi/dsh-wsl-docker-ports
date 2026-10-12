/**
 * 客户端产物装载的**假宿主内核**（002 T4.1/T4.2 自检的脚手架，不含任何判据）
 *
 * 断言清单与判据出处写在 `scripts/verify-client-loader.mjs`（薄壳）；这里只放「怎么把产物跑起来」：
 *   - 在 `node:vm` 里造**假 `window.__ModuleLoader__`**（捕获 `load` 调用）+ **假 `require`**（记录实参、
 *     给 external 发替身、`require.async` 只记录不成功）；
 *   - `document` 用**getter** 暴露 ⇒ 计数「谁在材质化阶段碰了 DOM」（官方 README：CSS injection 必须
 *     发生在 factory 闭包内）；
 *   - 捕获式 `ctx`（真跑 `apply`）：`slots.inject` / `slots.register` / `sidebarRightTabs.register` /
 *     `ctx.effect` 全部记账，`unload()` 按 cordis 的逆序跑清理。
 *
 * 拆成单独模块的理由：单文件 ≤ 400 行是 **SHALL**（原始行数），而完整判据集 + 脚手架会超。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/** 包根（`scripts/lib/` 往上两级） */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 插件包名（== 宿主 patch 行 id == ModuleLoader 的 `id`） */
export const PLUGIN_ID = 'dsh-terminal-profiles';
/** 主产物文件名 —— **不可改**：宿主 `chunkUrl()` 断言资源段 = `<rowId>/client.js`，不匹配直接 throw（§P3） */
export const MAIN_BUNDLE_FILE = 'client.js';
/** 懒加载块文件名 */
export const CHUNK_FILE = 'client.terminal.js';
/** 宿主对 chunk 文件名的准入正则（§P3 逐字） */
export const CHUNK_FILE_PATTERN = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
/** `require.async` 的实参（**兄弟文件名**，§P3） */
export const CHUNK_REQUEST = `./${CHUNK_FILE}`;
/** 自有样式的 tagId（与 `src/client/styles.ts` 逐字一致） */
export const STYLE_PLUGIN_ID = `${PLUGIN_ID}/styles`;
/** 官方 `0.1.7-rc.2` 已占用的 kind（§P1）；本包的 kind 不得与其重名 */
export const OFFICIAL_TAB_KINDS = [
  'guide',
  'files',
  'browser',
  'text',
  'changes-review',
  'terminal',
  'scheduleTask',
  'plan',
  'subagentchat',
];
/** 官方基线模块（`dsh-client-modules` 的 PLATFORM_MODULES 里与本包相关的子集，§P4）⇒ 无需在清单里声明 */
export const BASELINE_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
];

/**
 * 「react 被**打进包**了」的判据串 + 断言收集器 `makeChecks`（**本体已移出本文件**）。
 *
 * 🔴 **2026-10-12 扩面留痕**：§P2 的三条判据**扩到三包**（主人裁定「一宿主批不两套标准」）⇒
 * 判据本体与它依赖的这两个符号必须**只有一份**（本仓规矩：不许各自解释口径；先例
 * `export-surface.mjs` 三包共用）。新家 =
 * [`../../wsl-shared/scripts/lib/p2-main-bundle.mjs`](../../wsl-shared/scripts/lib/p2-main-bundle.mjs)。
 * 这里**再导出**，本包既有的 `import { INLINED_REACT_MARKER, makeChecks } from './lib/loader-harness.mjs'`
 * **一字不用改**（语义与实现逐字节相同，只是换了个文件住）。
 */
export { INLINED_REACT_MARKER, makeChecks } from '../../../wsl-shared/scripts/lib/p2-main-bundle.mjs';

/** 抓「产物 require 了没人供给的模块」⇒ 返回越界清单（相对路径是小块引用，不算 external） */
export function outOfSurface(specifiers, allowed) {
  return [...new Set(specifiers)].filter((specifier) => !allowed.has(specifier) && !specifier.startsWith('./'));
}

/** 抓「清单声明了 external 但产物根本没 require」⇒ 幽灵声明（声明与实现漂移） */
export function ghostDeclarations(declared, specifiers) {
  const observed = new Set(specifiers);
  return declared.filter((specifier) => !observed.has(specifier));
}

/** 读 bundle 里的 `require("…")`；`kind: 'async'` 读的是 `require.async("…")`（取 chunk，不是 external） */
export function readRequires(source, kind = 'bare') {
  const pattern = kind === 'async'
    ? /\brequire\.async\(\s*["']([^"']+)["']/gu
    : /(?<!\.)\brequire\(\s*["']([^"']+)["']/gu;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

/**
 * 解析 `require.async(<实参>)` 的**实参值**（一层常量折叠）。
 *
 * 为什么需要折叠：契约判据（002 T4.2 / `client-contract.md` §P3）是「实参**解析后** = 兄弟文件名
 * `./client.terminal.js`」这一**语义**，而不是「语法上必须是裸字符串」。源码里实参是常量
 * （`CHUNK_REQUEST` 由 `CHUNK_FILE_NAME` 拼出 ⇒ 文件名只有一处字面量来源），esbuild 会把它原样保留成
 * `require.async(CHUNK_REQUEST)` ⇒ 死抠字面量的检查会**假红**。
 *
 * 折叠规则：字符串字面量 → 其值；`${IDENT}` 模板串 → 递归折叠各插值；标识符 → 它的初始化式。
 * 折不出来就返回 `null`（检查方按「解析不出」判定，绝不默认通过）。
 */
export function resolveAsyncRequests(source) {
  const declarations = new Map();
  for (const match of source.matchAll(/(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;\n]+)/gu)) {
    if (!declarations.has(match[1])) declarations.set(match[1], match[2].trim());
  }
  const fold = (expression, depth) => {
    if (depth > 6) return null;
    const text = expression.trim();
    const literal = /^(["'])(.*)\1$/u.exec(text);
    if (literal !== null) return literal[2];
    const template = /^`([^`]*)`$/u.exec(text);
    if (template !== null) {
      let failed = false;
      const value = template[1].replace(/\$\{([^}]+)\}/gu, (_whole, inner) => {
        const resolved = fold(declarations.get(inner.trim()) ?? inner, depth + 1);
        if (resolved === null) failed = true;
        return resolved ?? '';
      });
      return failed ? null : value;
    }
    if (declarations.has(text)) return fold(declarations.get(text), depth + 1);
    return null;
  };
  return [...source.matchAll(/\brequire\.async\(\s*([^)]*?)\s*\)/gu)].map((match) => ({
    raw: match[1].trim(),
    value: fold(match[1], 0),
  }));
}

/** `lib/` 下**本包自注册**的产物文件名（判「主产物到底叫什么」，防改名） */
export function selfRegisteringBundles(libDir) {
  let names;
  try {
    names = readdirSync(libDir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    if (!name.endsWith('.js')) continue;
    const source = readFileSync(join(libDir, name), 'utf8');
    if (source.includes('__ModuleLoader__.load(') && source.includes(`"${PLUGIN_ID}"`)) found.push(name);
  }
  return found.sort();
}

/** external 模块的替身：任何属性都返回空函数（主 bundle 在校验阶段只做 `__toESM` 之类的包装） */
function moduleStub() {
  const target = function stub() {
    return null;
  };
  target.__esModule = true;
  return new Proxy(target, {
    get(source, key) {
      if (key === '__esModule') return true;
      if (key === 'default') return source;
      if (key in source) return source[key];
      return () => null;
    },
  });
}

/** 极小的 document 替身：只实现本包与内联 xterm 真正用到的动作，`data-plugin` 查重是**真逻辑** */
export function createFakeDocument() {
  const nodes = [];
  return {
    nodes,
    head: {
      append(node) {
        nodes.push(node);
      },
    },
    /** xterm 在**模块顶层**做特性探测时会读这个（`document.queryCommandSupported("copy")`）—— 见自检脚本头注 */
    queryCommandSupported: () => false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    querySelector(selector) {
      const match = /^style\[data-plugin="(.+)"\]$/.exec(selector);
      if (match === null) return null;
      return nodes.find((node) => node.dataset.plugin === match[1]) ?? null;
    },
    createElement(tagName) {
      const node = {
        tagName,
        dataset: {},
        textContent: '',
        style: {},
        remove() {
          const index = nodes.indexOf(node);
          if (index >= 0) nodes.splice(index, 1);
        },
      };
      return node;
    },
  };
}

/** 浏览器面替身（内联 xterm 的模块顶层探测会读 `navigator`/`window`；缺了会直接抛） */
function createBrowserGlobals(record) {
  const navigatorStub = {
    userAgent: 'dsh-terminal-profiles/verify-client-loader',
    platform: 'Win32',
    language: 'en-US',
    maxTouchPoints: 0,
  };
  const windowStub = {
    navigator: navigatorStub,
    devicePixelRatio: 1,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
    __ModuleLoader__: {
      load(options) {
        record.loads.push(options);
      },
    },
  };
  windowStub.window = windowStub;
  windowStub.self = windowStub;
  return { navigatorStub, windowStub };
}

/**
 * 在 vm 里执行产物并捕获：`load` 调用、require 实参、`document` 访问次数。
 * `document` 传 `undefined`（缺省）= 模拟「材质化时没有文档」（主 bundle 的零 DOM 判据用这个口径）。
 */
export function materialize({ source, filename, document: initialDocument }) {
  const record = {
    loads: [],
    bare: [],
    async: [],
    warnings: [],
    documentAccesses: 0,
    document: initialDocument,
  };
  const { navigatorStub, windowStub } = createBrowserGlobals(record);
  const sandbox = {
    console: {
      warn: (...args) => record.warnings.push(args.map(String).join(' ')),
      error: () => undefined,
      log: () => undefined,
    },
    setTimeout,
    clearTimeout,
    /** 内联 xterm 在**模块顶层**就会用到的宿主面（实测逐个补出来的；缺一个就当场抛，不会静默） */
    queueMicrotask,
    performance,
    TextEncoder,
    TextDecoder,
    requestAnimationFrame: (callback) => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: (handle) => clearTimeout(handle),
    navigator: navigatorStub,
    window: windowStub,
    self: windowStub,
  };
  Object.defineProperty(sandbox, 'document', {
    configurable: true,
    get() {
      record.documentAccesses += 1;
      return record.document;
    },
  });
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename });

  const createRequire = () => {
    const stub = moduleStub();
    const require = (specifier) => {
      record.bare.push(specifier);
      return stub;
    };
    require.async = (specifier) => {
      record.async.push(specifier);
      return new Promise(() => undefined); // 只记录：零调用断言不需要它成功，也不需要它失败
    };
    return require;
  };

  return { record, createRequire, sandbox };
}

/** 捕获式 ctx：真跑 `apply`，把每一次注册/收编都记账。可用 options 模拟**缺能力**的宿主（REQ-4.5 用例） */
export function createCaptureCtx(options = {}) {
  const withTabs = options.sidebarRightTabs ?? true;
  const withSidebar = options.sidebarRight ?? true;
  const captured = {
    services: [],
    /** 每一次 `inject(services, …)` 的实参（外层 ctx 与内层 scope 都记 ⇒ 能看到 `['settings']`） */
    serviceCalls: [],
    effects: [],
    disposers: [],
    tab: undefined,
    seats: [],
    slotInjects: [],
    tabDisposals: 0,
    seatDisposals: 0,
    /** `settings.configure(...)` 的真实实参（REQ-10.1「关自动表单」的实物证据） */
    settingsCalls: [],
    /** `remote.settings.update(...)` 的真实实参（T6.1 写入管道的实物证据） */
    settingsUpdates: [],
    describes: 0,
  };
  const slots = {
    inject(name, callback) {
      captured.slotInjects.push(name);
      const inner = callback();
      return () => {
        captured.seatDisposals += 1;
        if (typeof inner === 'function') inner();
      };
    },
    register(options, component) {
      captured.seats.push({ name: options.name, key: options.key, component });
      return () => {
        captured.seatDisposals += 1;
      };
    },
  };
  const effect = (callback, label) => {
    captured.effects.push(label ?? '(no label)');
    const dispose = callback();
    if (typeof dispose === 'function') captured.disposers.push(dispose);
    return dispose;
  };
  const sidebarRightTabs = {
    register(definition) {
      if (captured.tab !== undefined) throw new Error(`duplicate tab id: ${definition.id}`);
      captured.tab = definition;
      return () => {
        captured.tabDisposals += 1;
      };
    },
  };
  /**
   * 宿主 `settings`（表单服务）与 `remote.settings`（写回管道）的**最小替身**：
   * 只记实参、不做真事 —— 让「`configure({auto:false}, fiber)` 真的被调了」与
   * 「页面写回走 `update(ns, patch, revision)`」这两条在**产物级**也能断言。
   */
  const settings = {
    configure(options, fiber) {
      captured.settingsCalls.push({ options, fiber });
      return undefined;
    },
  };
  const remoteSettings = {
    async describe() {
      captured.describes += 1;
      return { ok: true, value: { namespaces: [{ ns: 'dsh-terminal-profiles', value: { profiles: [] }, revision: 1 }] } };
    },
    async update(ns, patch, expectedRevision) {
      captured.settingsUpdates.push({ ns, patch, expectedRevision });
      return { ok: true, value: {} };
    },
  };
  const scope = {
    slots,
    effect,
    fiber: { marker: 'fiber' },
    inject(services, callback) {
      captured.serviceCalls.push([...services]);
      return callback(scope);
    },
    get(name) {
      if (name === 'settings') return settings;
      if (name === 'remote.settings') return remoteSettings;
      return undefined;
    },
  };
  if (withTabs) scope.sidebarRightTabs = sidebarRightTabs;
  if (withSidebar) scope.sidebarRight = { openTab: () => undefined };
  const ctx = {
    slots,
    inject(services, callback) {
      captured.services = [...services];
      captured.serviceCalls.push([...services]);
      return callback(scope);
    },
    effect,
  };
  return {
    ctx,
    captured,
    scope,
    unload() {
      for (const dispose of captured.disposers.splice(0, captured.disposers.length).reverse()) dispose();
    },
  };
}
