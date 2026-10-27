/**
 * T1.4 前后快照与任务日志（REQ-1.5 / NFR-1 / C-3）+ 红线静态守卫
 *
 * 验收条件：
 * - 日志含四项 `{ before, after, exitCode, stdout }`
 * - `before` / `after` 是**完整实际集**（不是 diff 摘要）—— 因为「他人规则条数不变」
 *   这条红线的比对对象（本机既有的 19 条）**只存在于完整集里**
 *
 * 末尾两条静态守卫是「可执行的红线」：`portproxy reset` 零命中、每一处 `portproxy add|delete`
 * 都带 `listenport`。T3.1 的正式断言归 Phase 3，这里先把它在**写路径自己的目录**里钉住 ——
 * 免得好心改动把禁令破掉而没人发现。
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// @ts-expect-error TS7016：001 的 `strip-comments.mjs` 是 dev 脚本、无类型声明；这里只借它的**口径**
import { stripComments as stripCommentsUntyped } from '../../../wsl-shared/scripts/strip-comments.mjs';
import { parsePortproxyTable, type PortproxyRule } from '../../src/read/netsh.ts';
import { compareOthers, createWriteLogEntry, hasFourFields } from '../../src/write/log.ts';
import { fixtureText } from '../helpers/fake-executor.ts';
import { rule, ruleToEth0 } from '../helpers/factories.ts';

/** 收窄类型：口径来自 001 的 SSoT 实现，形状在调用点自己声明（不为它新增 `.d.ts`） */
const stripComments = stripCommentsUntyped as (
  source: string,
  options?: { readonly keepLines?: boolean },
) => string;

const ACTUAL_SET: readonly PortproxyRule[] = parsePortproxyTable(fixtureText('netsh-portproxy-v4tov4.raw'));

test('T1.4 任务日志四项齐全，且 before/after 是完整实际集（本机 19 条为基准）', () => {
  assert.equal(ACTUAL_SET.length, 19, '真机 fixture 是 19 条既有规则（他人的规则就是比对对象）');

  const after: readonly PortproxyRule[] = [...ACTUAL_SET, rule('127.0.0.1', 6000, '172.20.201.152', 6000)];
  const log = createWriteLogEntry({
    action: 'add',
    port: 6000,
    before: ACTUAL_SET,
    after,
    exitCode: 0,
    stdout: '{"ok":true}',
  });

  assert.equal(hasFourFields(log), true);
  assert.equal(log.before.length, 19, 'before 必须是完整实际集（19 条一条不少）');
  assert.equal(log.after.length, 20);
  assert.equal(log.exitCode, 0);
  assert.equal(log.stdout, '{"ok":true}');
});

test('T1.4 拒收 diff 摘要：半份数据比报错危险（形状不对直接抛）', () => {
  assert.throws(
    () =>
      createWriteLogEntry({
        action: 'add',
        port: 6000,
        // 典型的 diff 摘要：只有「变了什么」，没有完整实际集
        before: [{ kind: 'added', port: 6000 } as unknown as PortproxyRule],
        after: ACTUAL_SET,
        exitCode: 0,
      }),
    /疑似 diff 摘要/,
  );

  assert.throws(
    () =>
      createWriteLogEntry({
        action: 'add',
        port: 6000,
        before: ACTUAL_SET,
        after: 'not-an-array' as unknown as PortproxyRule[],
      }),
    TypeError,
  );
});

test('T1.4 没跑起来时时 exitCode 是 null（与「跑了且退出码 0」必须能区分）', () => {
  const log = createWriteLogEntry({ action: 'remove', port: 5000, before: ACTUAL_SET, after: ACTUAL_SET });
  assert.equal(log.exitCode, null);
  assert.equal(log.stdout, '');
});

test('T1.4 C-3 判据：只动自己那一条 ⇒ 他人规则条数与内容都不变', () => {
  const after: readonly PortproxyRule[] = [...ACTUAL_SET, ruleToEth0(6000, '127.0.0.1')];
  const comparison = compareOthers(ACTUAL_SET, after, 6000);

  assert.equal(comparison.beforeOthers, 19);
  assert.equal(comparison.afterOthers, 19);
  assert.equal(comparison.othersUnchanged, true);
  assert.deepEqual(comparison.othersDiff, []);
});

test('T1.4 C-3 判据能否决：他人规则被改动（同条数）也会被判出来', () => {
  const tampered: readonly PortproxyRule[] = [
    ...ACTUAL_SET.filter((item) => item.listenPort !== 8080),
    rule('0.0.0.0', 8080, '172.20.201.199', 8080),
    ruleToEth0(6000, '127.0.0.1'),
  ];
  const comparison = compareOthers(ACTUAL_SET, tampered, 6000);

  assert.equal(comparison.beforeOthers, 19);
  assert.equal(comparison.afterOthers, 19);
  assert.equal(comparison.othersUnchanged, false, '条数相同但内容变了，必须判出来');
  assert.equal(comparison.othersDiff.length, 2);
});

test('T1.4 删除自己那条：他人规则 19 条依旧不变', () => {
  const before: readonly PortproxyRule[] = [...ACTUAL_SET, ruleToEth0(6000, '127.0.0.1')];
  const after: readonly PortproxyRule[] = ACTUAL_SET;
  const comparison = compareOthers(before, after, 6000);
  assert.equal(comparison.othersUnchanged, true);
});

/** 读两个新目录下的全部 .ts 源码（红线静态守卫只在**写路径自己的**目录里生效） */
function writePathSources(): { readonly file: string; readonly content: string }[] {
  const roots = ['../../src/write', '../../src/elevate'];
  const sources: { file: string; content: string }[] = [];
  for (const root of roots) {
    const dir = new URL(`${root}/`, import.meta.url);
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const file = new URL(`${root}/${entry.name}`, import.meta.url);
      sources.push({ file: file.pathname, content: readFileSync(file, 'utf8') });
    }
  }
  return sources;
}

test('T1.4 红线守卫①：写路径里不存在「全表清空」形态（拼接构造，避免守卫自己命中）', () => {
  const forbidden = `portproxy${' '}reset`;
  const hit = writePathSources().filter((source) => source.content.includes(forbidden));
  assert.deepEqual(hit.map((source) => source.file), [], `REQ-1.4：${forbidden} 必须零命中（注释里也不许出现）`);
});

test('T1.4 红线守卫②：每一处 portproxy add/delete 都带 listenport（逐行断言）', () => {
  for (const source of writePathSources()) {
    const lines = stripComments(source.content, { keepLines: true }).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/portproxy\s+(add|delete)\b/.test(line)) return;
      assert.match(
        line,
        /listenport/,
        `${source.file}:${String(index + 1)} 的 portproxy 写动作没有 listenport：${line.trim()}`,
      );
    });
  }
});

test('T1.4 红线守卫③：脚本里可执行的 netsh 调用只有 add/delete 两个写动作', () => {
  const executable = /&\s*netsh(?:\.exe)?\s+interface\s+portproxy\s+(\w+)/g;
  const verbs = new Set<string>();
  for (const source of writePathSources()) {
    for (const match of stripComments(source.content, { keepLines: true }).matchAll(executable)) {
      verbs.add((match[1] ?? '').toLowerCase());
    }
  }
  assert.deepEqual([...verbs].sort(), ['add', 'delete'], '不出现 show/dump/reset 等非写动作');
});
