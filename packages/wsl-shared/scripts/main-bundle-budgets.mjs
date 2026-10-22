/**
 * **§P2 主 bundle 逐包上限表（机器可读 SSoT，2026-10-12 扩面）** — 棘轮 = 只许降不许升
 *
 * ## 口径来源与变更痕
 *
 * ① **2026-10-12 第一轮（§P2 尺寸口径变更）**：`terminal-profiles` 的比例代理判据
 *    （`mainBytes * 10 < chunkBytes`，标签误写「两个数量级」）换成「三条直接/数值判据」，
 *    上限 **64 KiB = 65,536 B**（主人裁定；留痕 `stack-decision-changelog.md` **#50**）。
 *    ⚠️ 那条上限是**只由 `terminal-profiles` 的构成与成长史推导**出来的 —— 当时**没有**
 *    第二个包参与 ⇒ 它从来不是「三包通行的推导值」。
 * ② **2026-10-12 第二轮（本轮 · 适用范围订正）**：主人裁定「**§P2 三条判据适用于三包
 *    （一宿主批不两套标准）**」⇒ `wsl-docker-ports` 的主 bundle 也受同一套判据管。实测该包
 *    `lib/client.js` = **144,149 B** ⇒ 相对 65,536 B **越线 78,613 B（2.20×）**，且该越线
 *    **早于 008 / 009**（初始 client 半 `8bfb6fb` 即 **83,709 B**）。
 *    ⇒ 该包**不是**「新写的功能超标」，而是**存量欠账**：按**现状**登记上限 **144,149 B**、
 *    `nature: 'debt'`，使「再涨一个字节」当场红。**欠账值 ≠ 认可值**（详见下节纪律）。
 * ③ **2026-10-13 第三轮（011 Phase 1 落地 · 棘轮下调）**：`wsl-docker-ports` 的客户端主 bundle
 *    **已切分**（渲染面 7 模块 + 写路径内核 21,202 B 移入懒加载 chunk `lib/client.ports.js`）⇒ 实测
 *    **38,640 B ≤ 65,536 B**（余 26,896 B）⇒ 按棘轮语义把上限**下调到实测值 38,640 B**（`nature: 'debt'`
 *    的语义随之变为**棘轮地板**：不是推导值，但**只许降**）、记录日 2026-10-13、留痕 **#54**。
 *    ⚠️ ② 里的 `144,149 / 78,613 / 2.20×` 与下节的 `70,246 / 4,710 / ≈49 KB` **全部是切分前的记录**
 *    （原文一字未删，作留痕保留、不再引用）。
 *
 * ④ **2026-10-14 第四轮（011 `T2.4` 常驻降级面落地 · 地板按实测重新登记）**：`REQ-BS-5` 要求
 *    「异步取块失败 ⇒ 可解释降级（原因分类 + 原文 + 可重试）」，而**降级面必须常驻主包** ——
 *    失败的那一半**正是 chunk**，降级 UI 放进 chunk 就是「一起失败」⇒ 新增常驻模块
 *    `src/client/chunk-degrade.ts`（+ `tests/client/chunk-degrade.test.tsx` 8 条回归）后实测
 *    **43,857 B**（+5,217 B：五类原因文案 + 状态码探测 + 重试；**未删任何功能、未动切分边界**）。
 *    ⇒ 按棘轮语义把**地板重新登记为实测值 43,857 B**、记录日 2026-10-14、留痕 **#55**。
 * ⑤ **第二轮（同日）· 真机缺陷修复**：indMainBundleUrl() 取第一条 client.js ⇒ 真机拿到**别的包**的
 *    主包批次（探测 URL 畸形、状态与真实 chunk 不符 ⇒ 会把「已下载但初始化失败」误判成 404）⇒ 修为
 *    「只认本包那条」+ 认 ?? 批次 + **优先用宿主原文里的真 URL** + 分类不让 404 抢答；主包 43,857 →
 *    **44,621 B**（+764 B），地板按实测重登、留痕 **#56**；🔴 硬判据 65,536 B 不动（余 **20,915 B**）。 *    🔴 **硬判据不变**：`①a mainBytes ≤ 65,536 B`（§P2 推导口径，余 **21,679 B**）—— 地板只是
 *    「不许再涨」的**快照**，**不是**功能上限。**主人 2026-10-14 表态**：「（体积）不想管大小了」
 *    ⇒ 合法新增不再逐次请示，但**每次抬地板仍必须走本节第 3 条的三处同步 + 留痕**。 *
 * ## 逐包登记值（**上限**，不是目标值）
 *
 * | 包 | 上限（字节） | 性质 | 记录日 | 留痕 |
 * | --- | --- | --- | --- | --- |
 * | `dsh-terminal-profiles` | 65,536（64 KiB） | `hard`（= §P2 推导值） | 2026-10-12 | #50 |
 * | `dsh-wsl-docker-ports` | 144,149 | `debt`（**存量欠账，非认可值**） | 2026-10-12 | #52 |
 * | `dsh-wsl-docker-ports`（**2026-10-13 起 · 现行**） | **38,640** | `debt`（**棘轮地板**：切分后实测值，仍只许降） | 2026-10-13 | #54 |
 * | `dsh-wsl-docker-ports`（**2026-10-14 起 · 现行**） | **44,621** | `debt`（**棘轮地板**：`T2.4` 常驻降级面 + 真机缺陷修正后实测值，仍只许降） | 2026-10-14 | #56 |
 *
 * ## 棘轮语义（怎么才算「改上限」合法）
 *
 * 1. 上限**只许降**：判定 = `mainBytes <= 上限`（实现见
 *    [`./lib/p2-main-bundle.mjs`](./lib/p2-main-bundle.mjs) 的 `mainBundleInvariantChecks`）。
 * 2. 上限**不许静默升**：本文件的数必须与契约文档
 *    [`client-contract-incremental.md`](../../../client-contract-incremental.md) §P2 的
 *    **机器可读表**（`<!-- main-bundle-budgets:SSoT -->` … `:end`）**逐字段相等**（`LOCK_FIELDS`
 *    四个字段，一个不落）⇒ 只改一边必然红。
 * 3. 每一行必须挂**留痕号**（`trace` → `stack-decision-changelog.md` 的 `#N`）⇒ 抬上限必须同时：
 *    改本文件 + 改契约文档的表 + **新增一条 changelog 记录**，且门会**自己数行**核对编号真存在。
 * 4. 抬上限**不是唯一出路**：触到上限时**先拆**（懒加载 chunk，§E 允许）**再谈**抬上限，
 *    **不得先塞后抬**。
 *
 * ## 🔴 `wsl-docker-ports` 的 144,149 B 是**欠账**，不是达标
 *
 * * **收敛方向（照 `terminal-profiles` 的 31/45 / 导出预算门先例）**：① **先拆懒加载 chunk**
 *   —— 只切**渲染面**不够（切后主包仍 ≈ 70,246 B，仍超 65,536 B 共 **4,710 B**）⇒ 须**连带**
 *   拆**写路径内核**，预期主包 ≈ 49 KB；② 该拆包动作**须单独立项**（不在本轮、也不在本 Spec 面内）。
 * * 🔴 **禁止为了过门而删功能** —— 上限的意义是「棘轮只许降」，删功能过门等于把可验收的东西藏起来。
 * * **前置阻塞**：0.2.0-rc.2 的 `require.async` 取块语义**未验**（契约 §Z5 残留）⇒ 拆 chunk 的
 *   运行时前提在真机确认前不敢定稿。
 * * ✅ **2026-10-13 落实（011 Phase 1，留痕 #54）**：① 收敛动作**已执行** —— 主包 **38,640 B**（≤ 65,536 B ✅，
 *   余 26,896 B）+ chunk `lib/client.ports.js` **110,498 B**（`require.async` 取块；产物断言门 17 项 / 0 失败 /
 *   exit 0，含 6 组变异哨兵）；② 「只切渲染面不够」被实测**推翻** —— 连带写内核后**超额达标**，且**未删任何功能**
 *   （12 个切出模块逐个核对「主包零命中 / chunk 全命中」）；③ 前置阻塞**已解除**：`require.async` 语义在
 *   0.2.0-rc.2 **真机验证通过**（011 `T0.1`：真取块 + 真渲染 + tab 真注册；⚠️ 本包自己的 chunk 运行期复验
 *   按 011 未验项 8 单独登记）。🔴 棘轮语义不变：**只许降**。
 */
import { readFileSync } from 'node:fs';
import { changelogEntries, repoPath } from './export-budgets.mjs';

/**
 * **逐包上限（SSoT）**。`nature: 'debt'` = 存量欠账（按现状设的上限，**不是**认可值）；
 * `trace` = `stack-decision-changelog.md` 的 `#N` 留痕号。
 * ⚠️ `note` 是**自由文本、不参与双重锁**（`LOCK_FIELDS` 才是锁）；锁字段一个不少地逐字段比对。
 */
export const MAIN_BUNDLE_BUDGETS = {
  'dsh-terminal-profiles': {
    limitBytes: 65536,
    nature: 'hard',
    recorded: '2026-10-12',
    trace: '#50',
    note: '§P2 推导值（64 KiB）：实测主 53,756 B（余 11,780 B ≈ 最大单次交付增量 +6,148 B 的 1.92×）（原记 53,014 B / 12,522 B；2026-10-12 重建后实测订正）；重定条件见 client-contract-incremental.md §P2 追加变更记录',
  },
  'dsh-wsl-docker-ports': {
    limitBytes: 49500,
    nature: 'debt',
    recorded: '2026-10-22',
    trace: '#58',
    note: '**棘轮地板**（不是推导值）：012 `listenAddress` 贯通（选值 → 写配置 → 计划 → 提权脚本 → 防火墙）在常驻侧新增 `SettingsPatch.listenAddresses` + `writeListenAddress` + `serializeTarget` 的 `listenAddress` 键 ⇒ 实测 **49,500 B**（+317 B vs 49,183）。**2026-10-22 主人授权：012 listenAddress 贯通**（授权上限 +400 B；实际 +317 B，未超额、未预借额度）。本轮已刻意把「读回 `listenAddresses`」从主包移除（回填走快照 ⇒ 客户端只写一份，省下 ~360 B），否则原样会到 +679 B。未删功能、未动切分边界（chunk 143,674 → 145,459 B）。前值 49,183 = 010 `T7.3` 宿主配置页注册壳（#57）；44,621 = 011 `T2.4`（#56）；38,640 = Phase 1 切分后（#54）；144,149 = 切分前存量欠账（#52）',
  },
};

/** 双重锁的**锁字段**（导出它，避免「嘴上说逐字段、实际少比几个」） */
export const LOCK_FIELDS = ['limitBytes', 'nature', 'recorded', 'trace'];

/** 棘轮规则（打印与判定共用同一份字面量，避免两处各自解释） */
export const RATCHET_RULE = {
  direction: 'down-only',
  text: '上限只许降不许升；改上限必须同时改本文件 + 契约文档 §P2 的机器可读表 + 追加 changelog 留痕（trace 指向的编号必须真存在）',
};

/** 契约文档里的机器可读表（文档侧 SSoT；与 `MAIN_BUNDLE_BUDGETS` 逐字段相等才放行） */
export const SSOT_DOC = {
  rel: 'client-contract-incremental.md',
  begin: '<!-- main-bundle-budgets:SSoT -->',
  end: '<!-- main-bundle-budgets:SSoT:end -->',
};

/** 解析契约文档的机器可读表 ⇒ `{ pkg: { limitBytes, nature, recorded, trace } }`（锚点缺失 ⇒ 空对象） */
export function parseDocBudgets(text) {
  const from = text.indexOf(SSOT_DOC.begin);
  const to = text.indexOf(SSOT_DOC.end);
  if (from < 0 || to < 0 || to < from) return {};
  const block = text.slice(from + SSOT_DOC.begin.length, to);
  const table = {};
  for (const line of block.split('\n')) {
    const match = /^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*(hard|debt)\s*\|\s*([0-9-]+)\s*\|\s*(#[^\s|]+)\s*\|$/.exec(line.trim());
    if (match === null) continue;
    table[match[1]] = { limitBytes: Number(match[2]), nature: match[3], recorded: match[4], trace: match[5] };
  }
  return table;
}

/** 读契约文档的机器可读表（文档侧） */
export function readDocBudgets() {
  return parseDocBudgets(readFileSync(repoPath(SSOT_DOC.rel), 'utf8'));
}

/**
 * 表 ↔ 文档表 的**逐字段**比对（`LOCK_FIELDS` 一个不落）：任何不一致都红；
 * 方向为 `up` 的一律红（棘轮）。
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
      reasons.push(`${pkg}：只在契约文档里登记，机器表缺失`);
      continue;
    }
    if (right === undefined) {
      reasons.push(`${pkg}：只在机器表里登记，契约文档缺失（改上限必须两边同时改）`);
    }
    for (const field of LOCK_FIELDS) {
      const documented = right?.[field];
      const actual = left[field];
      const direction =
        documented === undefined
          ? 'missing'
          : typeof actual === 'number' && typeof documented === 'number'
            ? actual > documented
              ? 'up'
              : actual < documented
                ? 'down'
                : 'same'
            : actual === documented
              ? 'same'
              : 'diff';
      rows.push({ pkg, field, table: actual, doc: documented, direction });
      if (direction === 'up') reasons.push(`${pkg}.${field}：机器表 ${String(actual)} > 文档 ${String(documented)} ⇒ 只改一边（棘轮：不许静默升）`);
      else if (direction === 'missing') reasons.push(`${pkg}.${field}：文档侧未登记`);
      else if (direction === 'diff') reasons.push(`${pkg}.${field}：两边不一致（表 ${String(actual)} / 文档 ${String(documented)}）`);
    }
  }
  return { ok: reasons.length === 0, rows, up: rows.filter((row) => row.direction === 'up'), down: rows.filter((row) => row.direction === 'down'), reasons };
}

/**
 * 留痕号可追性：`#N` 必须在 changelog 里真存在（`ids` 由门**自己数行**得出）。
 * 返回 `{ ok, reasons, targets }`。
 */
export function checkTraces(table, ids) {
  const reasons = [];
  const targets = [];
  for (const [pkg, budget] of Object.entries(table)) {
    const trace = String(budget.trace);
    const nums = trace.match(/\d+/g)?.map(Number) ?? [];
    if (nums.length === 0) {
      reasons.push(`${pkg}：留痕号为空`);
      continue;
    }
    targets.push({ pkg, trace, id: nums[nums.length - 1] });
    if (!ids.has(nums[nums.length - 1])) reasons.push(`${pkg}：留痕号 ${trace} 在 changelog 里查无此条（抬上限必须留痕）`);
  }
  return { ok: reasons.length === 0, reasons, targets };
}

export { changelogEntries, repoPath };
