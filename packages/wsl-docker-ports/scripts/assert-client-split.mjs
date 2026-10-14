/**
 * 011 `T1.4`：客户端切分的**产物断言 + 变异哨兵**（本包的常驻判据门）
 *
 * ## 判据（`REQ-BS-8`；对应 design §7 的 ①–⑤）
 *
 * ① 主包字节 ≤ **65,536**（§P2 硬判据）+ ≤ **登记上限**（棘轮；SSoT 里下调到实测值后自动收紧）
 * ② 主包 `require.async(` 命中 **≥ 1** ③ chunk **存在** + **被主包引用** + **含 12 个切出模块的标记**（证「搬家不是删除」）
 * ④ 常驻 4 模块标记**在主包** ⑤ 已切出 12 模块标记**不在主包**
 *
 * ## 标记字符串口径（design §7 留作「实现阶段定」，本脚本定稿）
 *
 * 标记 = **esbuild 的模块路径注释**，形如 `// src/client/pane.tsx`（构建期由 esbuild 为每个**被纳入**的模块
 * 逐行产出，`legalComments: 'none'` 不影响它）。匹配用**整行锚定**（`^// <相对路径>$`，`m` 标志）⇒
 * 不会把 `// src/client/page.ts` 误命中到 `// src/client/page-tables.ts`。
 * ⚠️ 该口径的两个已知前提，都由本脚本**当场**兜住：① 路径相对 `absWorkingDir` ⇒ 构建脚本已把 `absWorkingDir`
 * **钉死为包目录**（`T1.1` 实测：cwd 漂移会差 754 B / 29 行注释）；② 开 `minify` 会让注释消失 ⇒ 那时 ④ 会**判红**
 * （响亮失败），⑤ 的「零命中」也不会变成恒真 —— 因为有 ③ 的「chunk 里必须命中 12 条」与哨兵 ⑤ 兜底。
 *
 * ## 变异哨兵：**就地合成**，不碰仓库
 *
 * 每组哨兵把**同一批判据函数**喂给一份人造读数（改字节数 / 抹掉 `require.async` / 说 chunk 不存在 /
 * 抹掉常驻标记 / 注入切出标记）⇒ 必须**恰好**让预期的那条判据变红；期望值按**同一套边界**现算
 * （不写死，否则棘轮一改就脱钩）。design §7 原写的哨兵是「临时把模块同步 import 回主包、跑完还原」——
 * 本脚本改为**内存合成**：证明力相同（同一个判定函数、非恒真），但**不需要**「跑完必须还原」这条人工纪律，
 * 也不会在门里留下 `git` 脏状态。
 *
 * ## 自证「红得动」：`DSH_SPLIT_ASSERT_FAULT`
 *
 * `DSH_SPLIT_ASSERT_FAULT=<size|ratchet|async|chunk|resident|cut>` 把故障注入**真实读数**（不是只打印一段
 * 说明）⇒ §2 的判据**真判红** ⇒ 脚本 `exit 1`。这满足 `T1.4` 的验证要求「故意构造超标产物 ⇒ exit ≠ 0」，
 * 且**不用**改仓库里任何文件（注入只活在进程内）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAIN_BUNDLE_BUDGETS } from '../../wsl-shared/scripts/main-bundle-budgets.mjs';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));

/** §P2 的**硬**推导上限（`REQ-BS-1` / `REQ-BS-8` 的字面判据；与登记上限分开报，避免「拿棘轮地板替硬判据」） */
const P2_HARD_LIMIT = 65536;
/** 常驻面：切分后**必须**仍在主包（`REQ-BS-3` / design §3.1） */
const RESIDENT_MARKERS = [
  'src/client/rows.ts',
  'src/client/write-channel.ts',
  'src/client/write-token.ts',
  'src/client/settings-pipe.ts',
];
/** 切出面：**必须**已在 chunk、且**不得**留在主包（`REQ-BS-2`；7 渲染面 + `drift-fix` + 4 写内核） */
const CUT_MARKERS = [
  'src/client/pane.tsx',
  'src/client/pane-settings.tsx',
  'src/client/pane-tables.tsx',
  'src/client/page.ts',
  'src/client/write-panel.tsx',
  'src/client/write-confirm.tsx',
  'src/client/write-result.tsx',
  'src/client/drift-fix.ts',
  'src/write/plan.ts',
  'src/write/ownership.ts',
  'src/write/scope-note.ts',
  'src/write/firewall.ts',
];

const FAULT_KEYS = ['size', 'ratchet', 'async', 'chunk', 'resident', 'cut'];
const FAULT = process.env.DSH_SPLIT_ASSERT_FAULT ?? '';

let checks = 0;
const failures = [];
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures.push(`${name}${detail === undefined ? '' : ` — ${detail}`}`);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail === undefined ? '' : ` — ${detail}`}`);
}
/** 计数为 0 的结构性断言 = 恒真 ⇒ 判失败（与 `verify-client-loader.mjs` 同一纪律） */
function expectScanned(name, count, ok, detail) {
  check(name, count > 0 && ok, `${detail}（扫描项 ${String(count)}，为 0 即恒真）`);
}

/** 整行锚定的标记正则（转义正则元字符） */
function markerRe(rel) {
  return new RegExp(`^// ${rel.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm');
}
const hasMarker = (text, rel) => markerRe(rel).test(text);
const stripMarker = (text, rel) => text.replace(markerRe(rel), `/* 哨兵：${rel} 已被抹掉 */`);

// ---------- 真实读数 ----------
const mainPath = path.join(pkgRoot, 'lib', 'client.js');
if (!existsSync(mainPath)) {
  console.log(`FAIL 主包产物缺失：${path.relative(pkgRoot, mainPath)}（先跑 node scripts/build-client.mjs）`);
  process.exit(1);
}
const mainText = readFileSync(mainPath, 'utf8');
const chunkSpecHits = [...readFileSync(path.join(pkgRoot, 'src', 'client', 'index.ts'), 'utf8').matchAll(/PANE_CHUNK\s*=\s*'([^']+)'/g)];
const chunkSpec = chunkSpecHits.length === 1 ? chunkSpecHits[0][1] : '';
const chunkRel = chunkSpec.replace(/^\.\//, '');
const chunkPath = path.join(pkgRoot, 'lib', chunkRel);
const chunkExists = chunkRel !== '' && existsSync(chunkPath);
const chunkText = chunkExists ? readFileSync(chunkPath, 'utf8') : '';

const budget = MAIN_BUNDLE_BUDGETS[pkg.name];
const registeredLimit = typeof budget?.limitBytes === 'number' ? budget.limitBytes : undefined;

const reading = {
  mainText,
  mainBytes: statSync(mainPath).size,
  chunkExists,
  chunkText,
  chunkSpec,
  chunkRel,
  chunkBytes: chunkExists ? statSync(chunkPath).size : undefined,
};

// ---------- 故障注入（对**真实读数**生效 ⇒ 判据真红、exit 真 1） ----------
let faultApplied = '';
if (FAULT !== '') {
  if (!FAULT_KEYS.includes(FAULT)) {
    check('故障注入键合法', false, `未知 ${JSON.stringify(FAULT)}（合法值：${FAULT_KEYS.join('|')}）`);
  } else {
    if (FAULT === 'size') reading.mainBytes = P2_HARD_LIMIT + 1;
    if (FAULT === 'ratchet') reading.mainBytes = (registeredLimit ?? P2_HARD_LIMIT) + 1;
    if (FAULT === 'async') reading.mainText = reading.mainText.replaceAll('require.async(', 'require.asyncStripped(');
    if (FAULT === 'chunk') {
      reading.chunkExists = false;
      reading.chunkText = '';
    }
    if (FAULT === 'resident') reading.mainText = stripMarker(reading.mainText, RESIDENT_MARKERS[0]);
    if (FAULT === 'cut') reading.mainText = `${reading.mainText}\n// ${CUT_MARKERS[0]}\n`;
    faultApplied = FAULT;
    console.log(`⚠️ 故障注入已生效：\`${FAULT}\`（注入对象 = **真实读数**，仓库文件零改动）\n`);
  }
}

// ---------- 判据函数（真实读数与哨兵读数**共用同一批函数**） ----------
const sizeChecks = (r, limit) => ({ ok: r.mainBytes <= limit, detail: `主 ${String(r.mainBytes)} B / 上限 ${String(limit)} B（余 ${String(limit - r.mainBytes)} B）` });
const asyncCheck = (r) => {
  const hits = [...r.mainText.matchAll(/require\.async\(/g)].length;
  return { ok: hits >= 1, detail: `require.async( 命中 ${String(hits)}` };
};
const chunkCheck = (r) => {
  const carried = CUT_MARKERS.filter((rel) => hasMarker(r.chunkText, rel));
  const referenced = r.chunkSpec !== '' && r.mainText.includes(r.chunkSpec);
  return {
    ok: r.chunkExists && referenced && carried.length === CUT_MARKERS.length,
    detail: `chunk ${String(r.chunkRel)}${r.chunkExists ? ` = ${String(r.chunkBytes)} B` : '（不存在）'}；主包引用「${String(r.chunkSpec)}」=${String(referenced)}；chunk 内含切出标记 ${String(carried.length)}/${String(CUT_MARKERS.length)}`,
  };
};
const residentCheck = (r) => {
  const present = RESIDENT_MARKERS.filter((rel) => hasMarker(r.mainText, rel));
  return { ok: present.length === RESIDENT_MARKERS.length, detail: `命中 ${String(present.length)}/${String(RESIDENT_MARKERS.length)}：${present.join('、') || '（无）'}` };
};
const cutCheck = (r) => {
  const leaked = CUT_MARKERS.filter((rel) => hasMarker(r.mainText, rel));
  return { ok: leaked.length === 0, detail: `仍留在主包 ${String(leaked.length)}/${String(CUT_MARKERS.length)}：${leaked.join('、') || '（无）'}` };
};
/** 一份读数上当前该红的判据集合（真实读数与哨兵读数走**同一个**函数 ⇒ 期望值不会与判据脱钩） */
function redIds(r) {
  const red = [];
  if (!sizeChecks(r, P2_HARD_LIMIT).ok) red.push('①a');
  if (registeredLimit !== undefined && !sizeChecks(r, registeredLimit).ok) red.push('①b');
  if (!asyncCheck(r).ok) red.push('②');
  if (!chunkCheck(r).ok) red.push('③');
  if (!residentCheck(r).ok) red.push('④');
  if (!cutCheck(r).ok) red.push('⑤');
  return red;
}

console.log('=== 1. 清单与口径自检 ===');
expectScanned('常驻标记清单非空（空清单 ⇒ ④ 恒真）', RESIDENT_MARKERS.length, RESIDENT_MARKERS.length === 4, `常驻 ${String(RESIDENT_MARKERS.length)} 项`);
expectScanned('切出标记清单非空（空清单 ⇒ ⑤ 恒真）', CUT_MARKERS.length, CUT_MARKERS.length === 12, `切出 ${String(CUT_MARKERS.length)} 项`);
expectScanned('chunk 说明符可从源码解析出**恰好** 1 处（`src/client/index.ts` 的 `PANE_CHUNK`）', chunkSpecHits.length, chunkSpecHits.length === 1, `命中 ${String(chunkSpecHits.length)} 处，值 ${JSON.stringify(chunkSpec)}`);
check('SSoT 里已登记本包上限（未登记 = 不放行）', registeredLimit !== undefined, `${pkg.name} = 上限 ${String(registeredLimit)} B / nature=${String(budget?.nature)} / 留痕 ${String(budget?.trace)}`);

console.log('\n=== 2. 判据（真实产物） ===');
check('①a 主包 ≤ §P2 硬上限 65,536 B', sizeChecks(reading, P2_HARD_LIMIT).ok, sizeChecks(reading, P2_HARD_LIMIT).detail);
if (registeredLimit !== undefined) {
  const ratchet = sizeChecks(reading, registeredLimit);
  check('①b 主包 ≤ SSoT 登记上限（棘轮地板）', ratchet.ok, ratchet.detail);
}
check('② 主包 `require.async(` 命中 ≥ 1', asyncCheck(reading).ok, asyncCheck(reading).detail);
check('③ chunk 存在 + 被引用 + 含全部切出标记', chunkCheck(reading).ok, chunkCheck(reading).detail);
check('④ 常驻 4 模块标记仍在主包', residentCheck(reading).ok, residentCheck(reading).detail);
check('⑤ 已切出 12 模块标记不在主包', cutCheck(reading).ok, cutCheck(reading).detail);

if (faultApplied === '') {
  console.log('\n=== 3. 变异哨兵（喂**同一批**判定函数；没红就是门的错） ===');
  const realRed = redIds(reading);
  console.log(`  ⚑ ⓪ 基线对照：真实产物下判据红 ${String(realRed.length)} 条 ${JSON.stringify(realRed)}（下面哨兵的红才是「新引入的红」）`);
  expectScanned('⚑ ⓪ 真实产物判绿（证明判据不是恒红）', 6, realRed.length === 0, `红 ${String(realRed.length)} 条 ${JSON.stringify(realRed)}`);

  const mutants = [
    { key: 'size', read: { ...reading, mainBytes: P2_HARD_LIMIT + 1 }, how: `人造超限读数 ${String(P2_HARD_LIMIT + 1)}（§P2 硬上限 + 1）` },
    { key: 'ratchet', read: { ...reading, mainBytes: (registeredLimit ?? P2_HARD_LIMIT) + 1 }, how: `人造读数 ${String((registeredLimit ?? P2_HARD_LIMIT) + 1)}（SSoT 登记上限 + 1）` },
    { key: 'async', read: { ...reading, mainText: reading.mainText.replaceAll('require.async(', 'require.asyncStripped(') }, how: '抹掉 `require.async(`', want: ['②'] },
    { key: 'chunk', read: { ...reading, chunkExists: false, chunkText: '' }, how: '说 chunk 不存在', want: ['③'] },
    { key: 'resident', read: { ...reading, mainText: stripMarker(reading.mainText, RESIDENT_MARKERS[0]) }, how: `抹掉常驻标记 ${RESIDENT_MARKERS[0]}`, want: ['④'] },
    { key: 'cut', read: { ...reading, mainText: `${reading.mainText}\n// ${CUT_MARKERS[0]}\n` }, how: `注入切出标记 ${CUT_MARKERS[0]}`, want: ['⑤'] },
  ];
  for (const mutant of mutants) {
    const red = redIds(mutant.read);
    const want = mutant.want ?? redIds({ ...reading, mainBytes: mutant.read.mainBytes });
    const exact = red.length === want.length && want.every((id) => red.includes(id));
    console.log(`  ⚑ ${mutant.key}：${mutant.how} ⇒ ${exact ? '判红 ✓' : '未红 ✗'}（红 ${JSON.stringify(red)}，期望 ${JSON.stringify(want)}）`);
    expectScanned(`⚑ ${mutant.key} 哨兵 ⇒ **恰好**目标判据变红（${want.join('+')}）`, want.length, exact, `红 ${JSON.stringify(red)}`);
  }
} else {
  console.log(`\n=== 3. 变异哨兵 ===\n  · 已跳过：故障注入 \`${faultApplied}\` 生效中（哨兵段的前提是真实读数判绿）`);
  console.log(`  · 故障注入的红：${JSON.stringify(redIds(reading))}（这就是「故意构造超标产物 ⇒ exit ≠ 0」的红）`);
}

console.log(`\n=== 结果：${String(checks)} 项断言，失败 ${String(failures.length)} 项 ===`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;
