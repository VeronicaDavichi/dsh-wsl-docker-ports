/**
 * T3.5 [REQ-16.1 / REQ-16.2 / REQ-16.4] `managedPorts` 区间声明：解析、拒绝、不展开
 *
 * 「验证：」要求的落点在本文件：
 * - 区间正例（单端口 / 闭区间 / 混写 / 两端相等）
 * - 倒置一例被拒并给出**所在项**；非法项逐类各一例（空串 / 只有一端 / 越界 / 垃圾 / 小数）
 * - 区间 ∩ 映射**不枚举全体**：声明 `1-65535` 时求交量上界 = **映射宽度**
 * - presets：恰好 13 项、无 1433、端口唯一、纯声明数据（静态自证）
 *
 * 每个用例都走**真解析器**造 `ManagedPorts`（而不是手搓 `{ start, end }` 字面量）：
 * 手搓只能证明「引擎对手搓输入的反应」，走解析器才能把「配置里写的那串字 → 引擎」这条链一起证掉。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildExpectedForwards } from '../../src/diff/expected.ts';
import { intersectManagedRange, isManagedPort, type ManagedPorts } from '../../src/diff/managed-ports.ts';
import {
  parseManagedPorts,
  type ManagedPortsDecl,
  type ManagedPortsParseIssue,
  type ManagedPortsParseReason,
} from '../../src/diff/managed-ports-parse.ts';
import { PORT_PRESETS, portOf } from '../../src/diff/port-presets.ts';
import { container } from '../helpers/factories.ts';
import { filesMatching, scanFor, srcSources } from '../helpers/src-scan.ts';

/** 解析成功并取回区间（用断言函数收窄类型，避免各用例重复写 `assert.ok(parsed.ok)`） */
function expectOk(decls: readonly ManagedPortsDecl[]): ManagedPorts {
  const parsed = parseManagedPorts(decls);
  assert.ok(parsed.ok, `期望解析成功，实际：${JSON.stringify(parsed)}`);
  return parsed.ports;
}

/** 断言「恰好一项、位于 index、原因是 reason」，返回该项以便继续断言原文与消息 */
function expectIssue(
  decls: readonly ManagedPortsDecl[],
  index: number,
  reason: ManagedPortsParseReason,
): ManagedPortsParseIssue {
  const parsed = parseManagedPorts(decls);
  assert.ok(!parsed.ok, `期望解析失败，实际：${JSON.stringify(parsed)}`);
  assert.equal(parsed.issues.length, 1, '这些用例都只放一处非法项');
  const first = parsed.issues[0];
  assert.ok(first !== undefined);
  assert.equal(first.index, index);
  assert.equal(first.reason, reason);
  return first;
}

test('T3.5 [REQ-16.1] 区间正例：单端口与闭区间可混写，两端相等按单端口', () => {
  const ports = expectOk(['3306', 8080, '1000-3000', '80-80']);
  assert.deepEqual(ports, [
    { start: 3306, end: 3306 },
    { start: 8080, end: 8080 },
    { start: 1000, end: 3000 },
    { start: 80, end: 80 },
  ]);

  // 成员判定按**闭区间**（两端含）；区间外邻位必须不含 —— 边界差一位是这类代码最典型的错
  assert.equal(isManagedPort(ports, 1000), true);
  assert.equal(isManagedPort(ports, 3000), true);
  assert.equal(isManagedPort(ports, 999), false);
  assert.equal(isManagedPort(ports, 3001), false);
});

test('T3.5 [REQ-16.1] 空白被 trim：` 3306 `、` 1000 - 3000 ` 都合法（声明是人手写的）', () => {
  assert.deepEqual(expectOk([' 3306 ', ' 1000 - 3000 ']), [
    { start: 3306, end: 3306 },
    { start: 1000, end: 3000 },
  ]);
});

test('T3.5 [REQ-16.1] 边界端口 1 与 65535 合法；0 与 65536 越界', () => {
  assert.deepEqual(expectOk([1, 65535]), [
    { start: 1, end: 1 },
    { start: 65535, end: 65535 },
  ]);
  expectIssue([0], 0, 'out-of-range');
  expectIssue([65536], 0, 'out-of-range');
});

test('T3.5 [REQ-16.1] 倒置区间被拒，并给出**所在项**（下标 + 原文 + 可读原因）', () => {
  const first = expectIssue(['3306', '3000-1000'], 1, 'range-inverted');
  assert.equal(first.item, '3000-1000', 'REQ-16.1：必须指出是哪一项');
  assert.match(first.message, /第 2 项/);
  assert.match(first.message, /3000-1000/, '可读原因里要带上该项原文，用户不必自己数第几项');
  assert.match(first.message, /倒置/);
});

/** 非法项逐类各一例（任务点名：非整数 / 空串 / 只有一端 / 越界 / 垃圾 / 小数） */
const REJECTED: readonly (readonly [ManagedPortsDecl, ManagedPortsParseReason, string])[] = [
  ['abc', 'not-a-number', 'abc'],
  ['', 'empty', ''],
  ['1-', 'range-missing-end', '1-'],
  ['-5', 'range-missing-start', '-5'],
  [0, 'out-of-range', '0'],
  [65536, 'out-of-range', '65536'],
  ['1.5', 'not-an-integer', '1.5'],
  [1.5, 'not-an-integer', '1.5'],
  ['1-2-3', 'range-too-many-parts', '1-2-3'],
  ['0-10', 'out-of-range', '0-10'],
  ['60000-70000', 'out-of-range', '60000-70000'],
];

for (const [decl, reason, item] of REJECTED) {
  test(`T3.5 [REQ-16.1] 非法项被拒并给出项：${JSON.stringify(decl)} → ${reason}`, () => {
    const first = expectIssue([decl], 0, reason);
    assert.equal(first.item, item);
    assert.equal(first.message.length > 0, true);
  });
}

test("T3.5 [REQ-16.1] 数字与字符串走同一判据：-5 与 '-5' 同样被拒（缺起点的区间）", () => {
  // 归一成文本再解析 = 单一路径；两者结局都是**被拒**，不会出现「按类型两套判据」的分叉
  assert.equal(expectIssue([-5], 0, 'range-missing-start').reason, expectIssue(['-5'], 0, 'range-missing-start').reason);
});

test('T3.5 [REQ-16.1] 多处非法一次报完；失败结果里**没有** `ports`（不半套应用）', () => {
  const parsed = parseManagedPorts(['1000-3000', '3000-1000', 'abc']);
  assert.ok(!parsed.ok);
  assert.deepEqual(
    parsed.issues.map((item) => [item.index, item.reason]),
    [
      [1, 'range-inverted'],
      [2, 'not-a-number'],
    ],
  );
  assert.equal('ports' in parsed, false, '失败态连字段都没有 ⇒ 调用方无法误用「解析到一半」的集合');
});

test('T3.5 [REQ-16.2] `1-65535` 解析成 **1 个区间**，不展开成 65535 个成员', () => {
  const ports = expectOk(['1-65535']);
  assert.equal(ports.length, 1, '表示层是区间；展开会让配置一次就造出 6.5 万个元素');
  assert.deepEqual(ports, [{ start: 1, end: 65535 }]);
});

test('T3.5 [REQ-16.2] 区间 ∩ 映射：求交量上界 = **映射宽度**，与声明宽度无关', () => {
  const huge = expectOk(['1-65535']); // 声明宽度 65535
  const narrow = expectOk(['2000-2999']); // 声明宽度 1000

  const expand = (ports: ManagedPorts): readonly number[] => {
    const expanded: number[] = [];
    for (const hit of intersectManagedRange(ports, 2000, 2999)) {
      // 映射宽度 = 1000（2000..2999），枚举量的上界就应该是它
      for (let port = hit.start; port <= hit.end; port += 1) expanded.push(port);
    }
    return expanded;
  };

  const fromHuge = expand(huge);
  const fromNarrow = expand(narrow);
  assert.equal(fromHuge.length, 1000, '`1-65535` ∩ 映射 ⇒ 1000 条（不是 65535 条）');
  assert.equal(fromNarrow.length, 1000);
  assert.deepEqual(fromHuge, fromNarrow, '声明写得再宽，落到映射上的结果必须完全一致');

  // 引擎侧同证：期望集条数 = 映射宽度（`buildExpectedForwards` 是「先求交、再展开」）
  const built = buildExpectedForwards(
    [container('svc-a-1', '0.0.0.0:2000-2999->2000-2999/tcp')],
    huge,
    { '2000': 'lan' },
    true,
  );
  assert.equal(built.forwards.length, 1000);
});

test('T3.5 [REQ-16.4] presets 恰好 13 项、无 SQL Server 1433、每项端口唯一、label 为中文', () => {
  assert.equal(PORT_PRESETS.length, 13, 'REQ-16.4 钉死首批 13 项');
  const ports = PORT_PRESETS.map((preset) => preset.port);
  assert.equal(new Set(ports).size, PORT_PRESETS.length, '端口两两不同（否则勾选会互相覆盖）');
  assert.equal(ports.includes(1433), false, 'REQ-16.4：不含 SQL Server 1433');
  assert.deepEqual(
    [...ports].sort((left, right) => left - right),
    [1521, 3306, 5000, 5173, 5432, 5672, 6379, 8080, 8848, 9000, 9092, 9200, 27017],
  );
  for (const preset of PORT_PRESETS) {
    assert.equal(preset.name.length > 0, true);
    assert.match(preset.label, /[\u4e00-\u9fa5]/, `${preset.name} 的 label 应是中文`);
    assert.equal(Number.isInteger(preset.port), true);
  }
});

test('T3.5 [REQ-16.4] `portOf` 是纯查表：命中/未命中都不抛错', () => {
  assert.equal(portOf('mysql'), 3306);
  assert.equal(portOf('minio'), 9000);
  assert.equal(portOf('flask'), 5000);
  assert.equal(portOf('sqlserver'), undefined, '没收录就是没收录（1433 不在首批）');
  assert.equal(portOf('MySQL'), undefined, 'name 是机器 id，不做大小写折叠（免得「查得到的键」变成一处口径）');
});

test('T3.5 [REQ-16.4] presets 是纯声明数据：源码零 import、零 fetch/spawn/process（离线静态自证）', () => {
  const sources = srcSources();
  const presets = sources.filter((source) => source.path === 'src/diff/port-presets.ts');
  assert.equal(presets.length, 1, '必须真的扫到该文件（否则本断言会空转成假绿）');

  // 判据看**去注释后的可执行文本**：不许有任何依赖注入点 / 副作用入口 / 网络与进程能力
  assert.deepEqual(
    scanFor(presets, ['import ', 'require(', 'fetch(', 'process.', 'child_process', 'spawn(', 'exec('], (source) => source.code),
    [],
    'REQ-16.4：presets 勾选不得触发写操作/提权/联网 —— 结构上就不给它这些能力',
  );
  // 同一判据的行为面：本包没有任何模块在 import 阶段碰 write/ 或 elevate/
  assert.deepEqual(
    filesMatching(presets, /(\.\.\/)+(write|elevate)\//, (source) => source.code),
    [],
  );
});

test('T3.5 [REQ-16.4] presets 与区间声明同一语义：13 个端口都能被解析器接受并判为「已声明」', () => {
  const ports = expectOk(PORT_PRESETS.map((preset) => preset.port));
  assert.equal(ports.length, 13);
  for (const preset of PORT_PRESETS) assert.equal(isManagedPort(ports, preset.port), true);
  assert.equal(isManagedPort(ports, 1433), false);
});
