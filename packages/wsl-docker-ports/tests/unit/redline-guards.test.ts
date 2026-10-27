/**
 * 005 T3.1 红线静态守卫（**全 `src/` 范围**）+ T3.6 来源约束自证（离线）
 *
 * ## 为什么需要这个文件（T1.4 的守卫不够）
 *
 * T1.4 交付时只在 `src/write` + `src/elevate` 两个目录里钉了守卫（合理：那是 D 的交付范围），
 * 但「不许出现全表清空」这条红线要管**整个包** —— 包括 003 的 `read/` 与 `diff/`。
 * 本文件按 REQ-1.4 的判据把范围扩到 `src/` 全树。
 *
 * ## 两个必须小心的口径问题（D 交付时报告过第 1 条）
 *
 * 1. **朴素 grep 会误报**：`src/read/netsh-probe.ts` 有一条**合法的只读** `netsh show v4tov4`
 *    （探针，不需要提权、不改任何东西），`src/elevate/runner.ts` 与它自己的用户提示文案里也提到
 *    `netsh interface portproxy show v4tov4`。把它们当成违规 = 假红。
 *    ⇒ 判据必须区分「可执行的写动作」与「只读探针 / 提示文案」，见下面各条守卫的注释。
 * 2. **剥注释必须同源**：走 `tests/helpers/src-scan.ts`（内部 import 001 的 `strip-comments.mjs`，
 *    SSoT），**不再各写一份正则** —— AGENTS.md 写明「各写一份 = 迟早漂移，而漂移的症状是
 *    **一道门悄悄失去判据**」。
 *
 * 姊妹文件：003 的 T6.6（四条 `SHALL NOT`）在 `p0-redlines.test.ts` —— 故意分开：不同 Spec、
 * 不同范围（那条只管 P0 只读路径），混在一起会让「范围」这个最容易出错的东西失去可见性。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filesMatching, scanFor, srcSources } from '../helpers/src-scan.ts';
import { NETSH_ARGV } from '../../src/read/netsh-probe.ts';

const SOURCES = srcSources();

test('T3.1 红线①：全 src/ 不存在「全表清空 / 导出 / 改设置」形态（连注释也不许出现）', () => {
  // 判据本身用拼接构造：这样将来有人 grep 源码时不会把守卫自己当成一处违规。
  const forbidden = ['reset', 'dump', 'set'].map((verb) => `portproxy${' '}${verb}`);
  assert.deepEqual(
    scanFor(SOURCES, forbidden, (source) => source.raw),
    [],
    'REQ-1.4：删规则只能按精确四元组，禁止任何按端口/全表的清空形态',
  );
});

test('T3.1 红线②：每一处可执行的 portproxy 写动作都带 listenport（逐行，报真实行号）', () => {
  for (const source of SOURCES) {
    source.code.split(/\r?\n/).forEach((line, index) => {
      if (!/portproxy\s+(add|delete)\b/.test(line)) return;
      assert.match(
        line,
        /listenport/,
        `${source.path}:${String(index + 1)} 的写动作没有 listenport：${line.trim()}`,
      );
    });
  }
});

test('T3.1 红线③：可执行 netsh 调用的动词集合恰好是 {add, delete}（不出现 show/dump/reset/set）', () => {
  const executable = /&\s*netsh(?:\.exe)?\s+interface\s+portproxy\s+(\w+)/g;
  const verbs = new Set<string>();
  for (const source of SOURCES) {
    for (const match of source.code.matchAll(executable)) verbs.add((match[1] ?? '').toLowerCase());
  }
  assert.deepEqual([...verbs].sort(), ['add', 'delete'], '提权脚本里只允许这两个写动作');
});

test('T3.1 红线④：写动作只允许出现在 2 个白名单文件（新增调用点 ⇒ 逼一次人工复核）', () => {
  assert.deepEqual(
    filesMatching(SOURCES, /portproxy\s+(add|delete)\b/, (source) => source.code),
    ['src/elevate/script.ts', 'src/write/plan.ts'],
    '写动作的落点是一份**白名单**：新增即红，请先确认它同样带 listenport 且无 reset 形态',
  );
});

test('T3.1 红线⑤：只读 show 只能是 `portproxy show v4tov4` 形态，且落点同样收在白名单里', () => {
  const occurrences: string[] = [];
  for (const source of SOURCES) {
    for (const match of source.code.matchAll(/portproxy\s+show(?:\s+(\S+))?/g)) {
      occurrences.push(`${source.path} → ${match[0].trim()}`);
      assert.match(
        match[0],
        /portproxy\s+show\s+v4tov4/,
        `${source.path} 的 show 形态必须精确到 v4tov4（不许 show all 之类扩大读取面）`,
      );
    }
  }
  // ⚠️ 两处的 `show` 都在**给用户看的提示文案**里（"请在命令行手工执行 netsh interface portproxy
  // show v4tov4 看是否也挂住" / "请手工核对 …"），**不是被执行的东西**；真正的只读探针走 argv 数组，
  // 由红线⑥做**行为断言**（比 grep 文本强）。D 交付时报告的「朴素 grep 会误报」正是这一条。
  assert.deepEqual(
    [...new Set(occurrences.map((item) => item.split(' → ')[0]))].sort(),
    ['src/elevate/runner.ts', 'src/read/netsh-probe.ts'],
    `只读 show 的落点是白名单（且形态必须精确到 v4tov4）：${occurrences.join(' | ')}`,
  );
});

test('T3.1 红线⑥：只读探针的 argv 就是 `show v4tov4`（行为断言，不依赖 grep 文本）', () => {
  assert.deepEqual([...NETSH_ARGV], ['interface', 'portproxy', 'show', 'v4tov4']);
  for (const verb of ['add', 'delete', 'reset', 'dump', 'set']) {
    assert.equal(
      (NETSH_ARGV as readonly string[]).includes(verb),
      false,
      `只读探针的 argv 里不允许出现写动作/清空动作：${verb}`,
    );
  }
});

test('T3.6 来源约束自证：本包不注册任何 Agent 工具（REQ-4.2，离线可判）', () => {
  // REQ-4.2 要求提权能力**不经 Agent 工具面**暴露。本包与宿主工具/审批面**零耦合**：
  // 需要确认时走注入的 `ElevationDeps.confirm`（由调用方接 UI），不是宿主 approval API。
  assert.deepEqual(
    scanFor(SOURCES, ['defineTool', 'tools.register', 'ctx.tools'], (source) => source.code),
    [],
    'REQ-4.2：提权路径不得注册 Agent 工具，也不得直接调宿主工具面',
  );
});

test('守卫自身的元断言：src/ 全树确实被读到了（防止「扫了 0 个文件 ⇒ 全绿」的假绿）', () => {
  assert.ok(SOURCES.length >= 15, `期望读到 >= 15 个源文件，实际 ${String(SOURCES.length)}`);
  for (const expected of ['src/index.ts', 'src/read/netsh-probe.ts', 'src/write/plan.ts', 'src/elevate/script.ts']) {
    assert.ok(
      SOURCES.some((source) => source.path === expected),
      `守卫必须覆盖 ${expected}（没扫到 = 断言可能空转）`,
    );
  }
});
