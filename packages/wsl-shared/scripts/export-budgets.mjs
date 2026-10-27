/**
 * **逐包导出预算表（SSoT，2026-10-12 口径变更）** — 运行时 / 类型的**上限**，棘轮 = 只许降不许升
 *
 * ## 口径来源与变更痕
 *
 * 001 REQ-6.4 的原始口径是「**运行时导出 ≤ 12**，类型软阈值 25」——那是**只有 `wsl-shared` 一个包**
 * 时定的，且当时那唯一的门（`wsl-shared/scripts/check-exports.mjs`）只扫 `../src/index.ts`（**非递归**）。
 * 003 T6.7⑤ 收敛时又给 `wsl-docker-ports` 复制了一份本包副本门（23 断言，只扫它自己的 `src/index.ts`），
 * 并在其文件头明写：「**没有**把门扩到别的包（后者属 001 的口径变更，待主人拍板）」。
 * **2026-10-12 主人拍板**：把门扩到**三个包**，并且每个包**逐包记录上限**、**棘轮（只许降不许升）**。
 *
 * ## 三个包的登记值（上限，不是目标值）
 *
 * | 包 | runtime 上限 | types 上限 | 性质 |
 * | --- | --- | --- | --- |
 * | `dsh-wsl-shared` | 12 | 25 | 硬预算（= REQ-6.4 原文） |
 * | `dsh-terminal-profiles` | 31 | 45 | **存量欠账（不是认可值）** |
 * | `dsh-wsl-docker-ports` | 12 | 25 | 硬预算（沿用 003 收敛时的 12 / 25） |
 * | `dsh-wsl-docker-core` | 48 | 38 | **首次登记（按现状设上限）**：016 拆出的纯库 |
 * | `dsh-wsl-docker-containers` | 12 | 25 | 硬预算：016 拆出的容器插件包 |
 *
 * ## 棘轮语义（怎么才算「改上限」合法）
 *
 * 1. 上限**只许降**：`measured ≤ 上限`（本文件是机器可读的 SSoT；判定由三个门共用同一份）。
 * 2. 上限**不许静默升**：本文件的数必须与
 *    [`specs/001-wsl-shared/requirements.md`](../../../specs/001-wsl-shared/requirements.md) REQ-6.4 里
 *    的**机器可读表**（`<!-- export-budgets:SSoT -->` … `<!-- export-budgets:SSoT:end -->`）**逐字相等**
 *    ⇒ 只改一边必然红。
 * 3. 每一行必须挂一个**留痕号**（`trace`，指向 `stack-decision-changelog.md` 的编号条目）⇒ 抬上限
 *    必须同时：改本文件 + 改 REQ-6.4 的表 + **新增/指向一条 changelog 记录**，且门会核对该编号真存在。
 *
 * ## `terminal-profiles` 的 31 / 45 是**欠账**，不是达标
 *
 * 该包 barrel 实测 **运行时 31 / 类型 45**（从未纳入任何预算 ⇒ 首次登记只能**按现状设上限**，
 * 使「再涨一个」当场红）。**收敛方向与优先级**（照 003 T6.7⑤ 的先例）：
 * 1. 先做**可证明无消费者**的导出删减 —— 每个候选名字逐个核消费方，**grep 到 0 条**才可摘；
 * 2. 摘干净之后再谈**阈值或拆分**（后者要主人拍板 + 改本文件 + 改 REQ-6.4 + 留痕）；
 * 3. 🔴 **禁止**为了过门而删有消费者的导出 —— 那会红在 `check:client` / `tsc` / 单测上，
 *    等于把可验收的东西藏起来。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 未拍板前的兜底：任何未登记的包**一律不许放行**（预算缺失 = 红） */
export const UNREGISTERED = Symbol('unregistered-package');

/** 三个包（相对仓库根）——顺序即报告顺序 */
export const PACKAGES = [
  { name: 'dsh-wsl-shared', dir: 'packages/wsl-shared', specs: '001（+006 路径翻译同包）' },
  { name: 'dsh-terminal-profiles', dir: 'packages/terminal-profiles', specs: '002 / 004 / 007（同包不拆包）' },
  { name: 'dsh-wsl-docker-ports', dir: 'packages/wsl-docker-ports', specs: '003 / 005 / 008 / 009（同包不拆包）' },
];

/**
 * **逐包预算（上限）**。`nature: 'debt'` = 存量欠账（按现状设的上限，**不是**认可值）。
 * `trace` = changelog 留痕号（`stack-decision-changelog.md` 的 `#N`）。
 */
export const EXPORT_BUDGETS = {
  'dsh-wsl-shared': {
    runtime: 12,
    types: 25,
    nature: 'hard',
    recorded: '2026-10-08',
    trace: '#1–#50',
    note: 'REQ-6.4 原文口径（运行时 ≤ 12 SHALL；类型 25 软阈值，2026-10-08 二次拍板 20 → 25）',
  },
  'dsh-terminal-profiles': {
    runtime: 31,
    types: 45,
    nature: 'debt',
    recorded: '2026-10-12',
    trace: '#51',
    note: '存量欠账：首次登记，按现状设上限使「再涨一个」当场红；收敛方向见本文件头注（先删可证明无消费者的导出，再谈阈值/拆分）',
  },
  'dsh-wsl-docker-ports': {
    runtime: 12,
    types: 25,
    nature: 'hard',
    recorded: '2026-10-12',
    trace: '#51',
    note: '沿用 003 T6.7⑤ 收敛时引入的本包副本门预算（运行时 12 / 类型 25）；实测 6 / 9（016 拆分后更小）',
  },
  // 🔴 016：拆分出的两个真包，各自首次登记（按**实测现状**设上限，棘轮只许降）
  'dsh-wsl-docker-core': {
    runtime: 48,
    types: 38,
    nature: 'debt',
    recorded: '2026-10-27',
    trace: '#62',
    note: '016 拆出的纯库：把原本散在 wsl-docker-ports 的探针 / 配置 / 凭据 / 错误模型 / HTTP 收成一份公开面（48 / 38 是按现状设上限，不是认可值；方向是随消费方收敛而下降）',
  },
  'dsh-wsl-docker-containers': {
    runtime: 12,
    types: 25,
    nature: 'hard',
    recorded: '2026-10-27',
    trace: '#62',
    note: '016 拆出的容器插件包：运行时面与转发包同口径（name / inject / apply / Config / 服务名），实测 6 / 8',
  },
};

/** 棘轮规则（打印与判定共用同一份字面量，避免两处各自解释） */
export const RATCHET_RULE = {
  direction: 'down-only',
  text: '上限只许降不许升；改上限必须同时改本文件 + REQ-6.4 的机器可读表 + 追加 changelog 留痕（trace 指向的编号必须真存在）',
};

/** REQ-6.4 里的机器可读表（SSoT 文档侧；与 `EXPORT_BUDGETS` 逐字相等才放行） */
export const SSOT_DOC = {
  rel: 'specs/001-wsl-shared/requirements.md',
  begin: '<!-- export-budgets:SSoT -->',
  end: '<!-- export-budgets:SSoT:end -->',
};

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** 仓库根下的绝对路径 */
export function repoPath(rel) {
  return `${REPO_ROOT}${rel.split('/').join('\\')}`;
}

/** 解析 REQ-6.4 的机器可读表 ⇒ `{ pkgName: { runtime, types, trace } }`（锚点缺失 ⇒ 空对象） */
export function parseDocBudgets(text) {
  const from = text.indexOf(SSOT_DOC.begin);
  const to = text.indexOf(SSOT_DOC.end);
  if (from < 0 || to < 0 || to < from) return {};
  const block = text.slice(from + SSOT_DOC.begin.length, to);
  const table = {};
  for (const line of block.split('\n')) {
    const match = /^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(#[^\s|]+)\s*\|/.exec(line.trim());
    if (match === null) continue;
    table[match[1]] = { runtime: Number(match[2]), types: Number(match[3]), trace: match[4] };
  }
  return table;
}

/** 读 REQ-6.4 的机器可读表（文档侧） */
export function readDocBudgets() {
  return parseDocBudgets(readFileSync(repoPath(SSOT_DOC.rel), 'utf8'));
}

/**
 * 表 ↔ 文档表 的逐字段比对：任何不一致都红；方向为 `up` 的一律红（棘轮）。
 * 返回 `{ ok, rows, up, down, reasons }` —— `rows` 逐字段列出 `{ pkg, field, table, doc, direction }`。
 */
export function diffBudgets(table, docTable) {
  const rows = [];
  const reasons = [];
  const names = new Set([...Object.keys(table), ...Object.keys(docTable)]);
  for (const pkg of [...names].sort()) {
    const left = table[pkg];
    const right = docTable[pkg];
    if (left === undefined) {
      reasons.push(`${pkg}：只在 SSoT 文档里登记，机器表缺失`);
      continue;
    }
    if (right === undefined) {
      reasons.push(`${pkg}：只在机器表里登记，SSoT 文档缺失（改上限必须两边同时改）`);
    }
    for (const field of ['runtime', 'types']) {
      const documented = right?.[field];
      const direction = documented === undefined ? 'missing' : left[field] > documented ? 'up' : left[field] < documented ? 'down' : 'same';
      rows.push({ pkg, field, table: left[field], doc: documented, direction });
      if (direction === 'up') reasons.push(`${pkg}.${field}：机器表 ${left[field]} > 文档 ${documented} ⇒ 只改一边（棘轮：不许静默升）`);
      if (direction === 'missing') reasons.push(`${pkg}.${field}：文档侧未登记`);
    }
    if (right !== undefined && right.trace !== left.trace) {
      reasons.push(`${pkg}：留痕号不一致（表 ${left.trace} / 文档 ${String(right.trace)}）`);
    }
  }
  return { ok: reasons.length === 0, rows, up: rows.filter((r) => r.direction === 'up'), down: rows.filter((r) => r.direction === 'down'), reasons };
}

/** changelog 里的编号条目集合（`| 51 | …` 形态） */
export function changelogEntries(text) {
  const ids = new Set();
  for (const line of text.split('\n')) {
    const match = /^\|\s*(\d+)\s*\|/.exec(line.trim());
    if (match !== null) ids.add(Number(match[1]));
  }
  return ids;
}

/**
 * 留痕号可追性：`#N` 必须在 changelog 里真存在；`#a–#b` 取右端（范围写法）。
 * 返回 `{ ok, reasons }` —— 这是「抬上限必须留痕」的机械半边（另半边 = 表 ↔ 文档锁）。
 */
export function checkTraces(table, ids) {
  const reasons = [];
  for (const [pkg, budget] of Object.entries(table)) {
    const trace = String(budget.trace);
    const nums = trace.match(/\d+/g)?.map(Number) ?? [];
    if (nums.length === 0) {
      reasons.push(`${pkg}：留痕号为空`);
      continue;
    }
    const target = nums[nums.length - 1];
    if (!ids.has(target)) reasons.push(`${pkg}：留痕号 ${trace} 在 changelog 里查无此条（抬上限必须留痕）`);
  }
  return { ok: reasons.length === 0, reasons };
}
