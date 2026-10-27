/**
 * T5.1–T5.7 的**纯函数**判据（`node --test`，无 DOM）
 *
 * 每一条都对着 Spec 的「验证」列：五态标签 / 刷新时间戳 / 非 NAT 全灰 + 指引内容 /
 * 逐端口作用域 / UDP 常驻提示 / 外部规则只读 / presets 恰好 13 / 漂移「旧 → 新」+ 先删后加 /
 * 取不到 eth0 时不降级。结构性断言一律**打印扫描项计数**。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PORT_STATES } from '../../src/diff/types.ts';
import type { PortState } from '../../src/diff/types.ts';
import { buildPortRows, buildPortsPageView, countSum, summarizeWriteReport, writeGate } from '../../src/client/page.ts';
import {
  buildExternalRulesView,
  buildForwardActions,
  buildNatGuide,
  buildPresetOptions,
  buildScopeControl,
  buildUnsupportedRows,
  managedPortsIssues,
  managedPortsText,
  mergeManagedPortsDecl,
  natReason,
  scopeTestId,
  stateLabel,
  stateTone,
  TESTID,
  UDP_TIP_TEXT,
  PORT_PRESETS,
} from '../../src/client/rows.ts';
// 011 T1.3（2026-10-13）：`buildDriftFixView` 已从 `rows.ts` 搬到 `drift-fix.ts`（只为让写内核随
// 渲染面 chunk 走）。**本文件只改这一行 import 路径，断言一字未动**。
import { buildDriftFixView } from '../../src/client/drift-fix.ts';
import { countFunctions, classification, container, externalRulesFromFixture, managedPorts, NAT_NON_NAT, NAT_OK, realDiff, rule, snapshot, unsupportedMapping, ETH0, OLD_ETH0 } from './client-fixtures.ts';

const GATE_OK = { allowed: true, reason: null } as const;

test('T5.1 五态：每一态都有专属标签与色调，且五态互不相同', () => {
  const labels = PORT_STATES.map((state) => stateLabel(state));
  const tones = PORT_STATES.map((state) => stateTone(state));
  assert.equal(labels.length, 5, '五态标签数必须是 5');
  assert.equal(new Set(labels).size, 5, `五态标签不得重复：${JSON.stringify(labels)}`);
  console.log(`  · 扫了 ${String(PORT_STATES.length)} 个状态，标签 ${JSON.stringify(labels)}，色调 ${JSON.stringify(tones)}`);
  for (const state of PORT_STATES) assert.ok(labels.includes(stateLabel(state)) && typeof stateTone(state) === 'string');
});

test('T5.1 五态：逐态可建行，且每行携带自己的状态与端口', () => {
  const rows = PORT_STATES.map((state, index) => buildPortRows(snapshot({ ports: [classification(state, 3000 + index)] }), GATE_OK)).flat();
  assert.equal(rows.length, 5, `每态必须恰好建出一行，实际 ${String(rows.length)}`);
  PORT_STATES.forEach((state, index) => {
    const row = rows.find((item) => item.port === 3000 + index);
    assert.equal(row?.state, state);
    assert.equal(row?.stateLabel, stateLabel(state));
  });
  console.log(`  · 扫了 ${String(rows.length)} 行，端口 ${JSON.stringify(rows.map((row) => row.port))}`);
});

test('T5.1 五态：conflict 恒无可用动作（REQ-1.3 只报告，不改动）', () => {
  const rows = PORT_STATES.map((state) => buildForwardActions(classification(state, 3306), GATE_OK));
  // 反向对照（防恒真）：别的状态**确实**有可点动作，所以 conflict 的 0 不是「整体都点不动」的假象
  const others = rows.filter((_, index) => PORT_STATES[index] !== 'conflict').flat();
  assert.ok(others.filter((action) => action.enabled).length > 0, '其他状态必须有可点动作，否则下面的断言恒真');
  const conflictActions = rows[PORT_STATES.indexOf('conflict')] ?? [];
  assert.ok(conflictActions.length > 0, 'conflict 也应有禁用的动作位（不是消失）');
  assert.equal(conflictActions.filter((action) => action.enabled).length, 0, 'conflict 不得有任何可点动作');
  assert.ok(conflictActions.every((action) => typeof action.disabledReason === 'string'));
  console.log(`  · 扫了 ${String(rows.length)} 态 / ${String(rows.flat().length)} 个动作控件：conflict 可点 ${String(conflictActions.filter((a) => a.enabled).length)} 个，其他态可点 ${String(others.filter((a) => a.enabled).length)} 个`);
});

test('T5.2 非 NAT：转发写控件全部不可授权（gate 关闸）', () => {
  const gates = [writeGate(snapshot({ nat: NAT_OK })), writeGate(snapshot({ nat: NAT_NON_NAT }))];
  assert.equal(gates[0]?.allowed, true, 'NAT 且策略 ask ⇒ 放行');
  assert.equal(gates[1]?.allowed, false, '非 NAT ⇒ 关闸');
  assert.match(String(gates[1]?.reason), /NAT/u, '关闸原因必须点名 NAT');
  console.log(`  · 扫了 ${String(gates.length)} 个 NAT 形态：${JSON.stringify(gates.map((gate) => gate.allowed))}`);
});

test('T5.2 非 NAT：页面里每一个转发写控件都不可点，且放行时同样一批控件真的可点（防恒真）', () => {
  const rowsOf = (nat: typeof NAT_OK): readonly { readonly enabled: boolean }[] =>
    buildPortRows(
      snapshot({ nat, ports: PORT_STATES.map((state, index) => classification(state, 4000 + index)) }),
      writeGate(snapshot({ nat })),
    ).flatMap((row) => [...row.actions, row.scopeControl]);

  const blocked = rowsOf(NAT_NON_NAT);
  const allowed = rowsOf(NAT_OK);
  assert.ok(blocked.length > 0, '非 NAT 下控件仍应存在（置灰而非消失）');
  assert.equal(blocked.filter((control) => control.enabled).length, 0, '非 NAT 下不得有任何可点写控件');
  assert.ok(allowed.filter((control) => control.enabled).length > 0, 'NAT 下必须有可点控件，否则上面的断言恒真');
  console.log(`  · 非 NAT 扫了 ${String(blocked.length)} 个控件（可点 ${String(blocked.filter((c) => c.enabled).length)}），NAT 扫了 ${String(allowed.length)} 个（可点 ${String(allowed.filter((c) => c.enabled).length)}）`);
});

test('T5.2 非 NAT 修复指引：含具体文件路径 + 可复制命令，且明写不改文件', () => {
  const guide = buildNatGuide(NAT_NON_NAT);
  assert.equal(guide.path, 'C:\\Users\\EDY\\.wslconfig');
  assert.ok(guide.commandText.includes(guide.path), '命令文本必须含真实路径');
  assert.ok(guide.commandText.includes('wsl --shutdown'), '命令文本必须含生效动作');
  assert.ok(guide.lines.length >= 3, `指引行数不足：${String(guide.lines.length)}`);
  assert.match(guide.note, /不会自动修改/u, '必须明写不自动改文件（REQ-1.4）');
  assert.match(natReason(NAT_NON_NAT), /mirrored/u);
  console.log(`  · 扫了 ${String(guide.lines.length)} 行指引，命令文本 ${String(guide.commandText.length)} 字符`);
});

test('T5.3 逐端口作用域：每端口一个控件、默认 loopback、无任何批量入口', () => {
  const controls = [3306, 5432, 6379].map((port) => buildScopeControl(port, 'loopback', GATE_OK));
  assert.equal(new Set(controls.map((control) => control.testId)).size, 3, '三个端口必须是三个不同控件');
  assert.deepEqual(controls.map((control) => control.testId), [scopeTestId(3306), scopeTestId(5432), scopeTestId(6379)]);
  assert.ok(controls.every((control) => control.value === 'loopback'), '缺省必须是 loopback');
  assert.ok(controls.every((control) => control.options.length === 2), '只有本机/局域网两项');
  assert.equal(controls.filter((control) => control.options.some((option) => /全选|批量|全部/u.test(option.label))).length, 0, '不得出现「全选局域网」类入口');
  console.log(`  · 扫了 ${String(controls.length)} 个作用域控件 / ${String(controls.flatMap((c) => c.options).length)} 个选项，批量入口 0 个`);
});

test('T5.3 逐端口作用域：每端口独立回写自己的 scope（互不串台）', () => {
  const snap = snapshot({ ports: [classification('ok', 3306, { rules: [rule(3306)] }), classification('ok', 5432, { rules: [rule(5432)] })], scopes: { '5432': 'lan' } });
  const rows = buildPortRows(snap, GATE_OK);
  assert.equal(rows.find((row) => row.port === 3306)?.scopeControl.value, 'loopback', '未声明的端口回落 loopback');
  assert.equal(rows.find((row) => row.port === 5432)?.scopeControl.value, 'lan', '声明过的端口用声明值');
  console.log(`  · 扫了 ${String(rows.length)} 行，作用域 ${JSON.stringify(rows.map((row) => [row.port, row.scopeControl.value]))}`);
});

test('T5.5 UDP：常驻提示存在、不可交互；UDP 行标记「不支持」并给出原因', () => {
  const rows = buildUnsupportedRows([unsupportedMapping('redis-cache', 6379), unsupportedMapping('dns', 53)]);
  assert.ok(UDP_TIP_TEXT.includes('UDP'), '常驻提示必须点名 UDP');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.stateLabel === '不支持'), 'UDP 行必须标「不支持」');
  assert.ok(rows.every((row) => /TCP/u.test(row.reason)), '原因必须解释 portproxy 只支持 TCP');
  console.log(`  · 扫了 ${String(rows.length)} 条不可转发映射，全部标「不支持」`);
});

test('T5.5 UDP：未发布到宿主的映射也要标出来（不许忽略）', () => {
  const rows = buildUnsupportedRows([{ containerName: 'x', protocol: 'udp', hostIp: null, hostPort: null, containerPort: 5353, containerPortEnd: null, reason: 'portproxy-tcp-only' }]);
  assert.equal(rows[0]?.host, '未发布到宿主');
  console.log(`  · 扫了 ${String(rows.length)} 条，host=${String(rows[0]?.host)}`);
});

test('T5.7 外部规则：19 条真规则全部进只读区，且区域里没有动作字段', () => {
  const external = externalRulesFromFixture();
  const view = buildExternalRulesView(external);
  assert.equal(external.length, 19, `真 fixture 应产出 19 条外部规则，实际 ${String(external.length)}`);
  assert.ok(view !== null);
  assert.equal(view.rows.length, 19);
  const forbidden = ['actions', 'enabled', 'onClick', 'testId', 'control'].filter((key) => key in view);
  assert.deepEqual(forbidden, [], `只读区不得携带动作字段，命中 ${JSON.stringify(forbidden)}`);
  assert.equal(countFunctions(view).length, 0, `只读区不得含函数：${JSON.stringify(countFunctions(view))}`);
  assert.equal(view.rows.filter((row) => 'actions' in row || 'enabled' in row).length, 0, '行上不得有动作字段');
  console.log(`  · 扫了 ${String(external.length)} 条外部规则 / ${String(view.rows.length)} 行；命中的动作字段 0 个`);
});

test('T5.7 外部规则：清单为空时整块不渲染（不出现空壳区域）', () => {
  assert.equal(buildExternalRulesView([]), null);
  console.log('  · 扫了 1 种输入（空清单），返回 null');
});

test('T5.7 外部规则不进五态、不计入计数', () => {
  // 真 fixture 的 19 个端口里取一个确实存在的（5432），声明它 ⇒ 它进五态、其余 18 条算外部
  const result = realDiff([5432]);
  const counts = countSum(result.counts);
  assert.equal(result.external.length, 18, `19 条里扣掉 5432 ⇒ 18 条外部，实际 ${String(result.external.length)}`);
  assert.equal(counts, result.ports.length, '五态计数之和必须等于端口行数（外部规则不计入）');
  assert.ok(result.ports.every((item) => item.port === 5432), '外部规则的端口不得出现在五态里');
  assert.equal(result.external.some((item) => item.rule.listenPort === 5432), false, '已声明的端口不得同时出现在外部区');
  console.log(`  · 扫了 ${String(result.external.length)} 条外部 + ${String(result.ports.length)} 条判决，计数之和 ${String(counts)}`);
});

test('T5.7 presets：恰好 13 项，且不含 1433（SQL Server 不在清单里）', () => {
  assert.equal(PORT_PRESETS.length, 13, `presets 必须恰好 13 项，实际 ${String(PORT_PRESETS.length)}`);
  const ports = PORT_PRESETS.map((preset) => preset.port);
  assert.equal(new Set(ports).size, 13, 'preset 端口不得重复');
  assert.equal(ports.includes(1433), false, '1433 不得出现在 presets 里');
  for (const expected of [3306, 1521, 8080, 5432, 6379, 5173, 5000]) assert.ok(ports.includes(expected), `缺少 preset ${String(expected)}`);
  console.log(`  · 扫了 ${String(PORT_PRESETS.length)} 项 presets：${JSON.stringify(ports)}`);
});

test('T5.7 presets：勾选态来自 managedPorts 声明本身（不是另存一份状态）', () => {
  const options = buildPresetOptions(PORT_PRESETS, managedPorts([3306, 5432]));
  const checked = options.filter((option) => option.checked);
  assert.deepEqual(checked.map((option) => option.port).sort((a, b) => a - b), [3306, 5432]);
  console.log(`  · 扫了 ${String(options.length)} 个勾选项，命中 ${String(checked.length)} 个`);
});

test('T5.7 区间 + 勾选：合并结果写进同一个数组，非法项原样保留给解析器报错', () => {
  const merged = mergeManagedPortsDecl('3306\n1000-3000\nabc\n3306', [8080, 3306]);
  assert.deepEqual(merged, ['3306', '1000-3000', 'abc', '8080'], `实际 ${JSON.stringify(merged)}`);
  const parsed = managedPortsIssues(merged);
  assert.equal(parsed.ok, false, '含非法项时解析必须失败');
  assert.equal(parsed.issues.length, 1, `非法项必须给原因，实际 ${JSON.stringify(parsed.issues)}`);
  assert.match(parsed.issues[0] ?? '', /abc/u, '原因里必须含所在项');
  console.log(`  · 扫了 ${String(merged.length)} 项声明，非法 ${String(parsed.issues.length)} 项`);
});

test('T5.7 区间显示：原文按**换行**回填（textarea 一行一项最好维护；逗号仍是合法输入）', () => {
  assert.equal(managedPortsText(['3306', '1000-3000']), '3306\n1000-3000');
  console.log(`  · 回填原文 = 「${managedPortsText(['3306', '1000-3000']).replaceAll('\n', '⏎')}」`);
});

test('T5.7 分隔符：半角逗号是主用法，换行 / 全角逗号 / 顿号都当分隔（不算数据）', () => {
  const expected = ['3306', '1000-3000', '5432'];
  for (const draft of ['3306,1000-3000,5432', '3306, 1000-3000, 5432', '3306\n1000-3000\n5432', '3306，1000-3000，5432', '3306、1000-3000、5432']) {
    const merged = mergeManagedPortsDecl(draft, []);
    assert.deepEqual(merged, expected, `「${draft}」⇒ ${JSON.stringify(merged)}`);
  }
  console.log('  · 扫了 5 种写法（半角逗号 / 逗号+空格 / 换行 / 全角逗号 / 顿号）⇒ 同一个数组');
});

test('T5.7 空格不当分隔：`1000 - 3000` 是**一项**（原样进解析器，由解析器按区间判，UI 不改写用户原文）', () => {
  const merged = mergeManagedPortsDecl('1000 - 3000', []);
  assert.deepEqual(merged, ['1000 - 3000'], `空格被当成分隔符了：${JSON.stringify(merged)}`);
  const parsed = managedPortsIssues(merged);
  assert.equal(parsed.ok, true, `解析器本来就容忍区间两侧的排版空格：${JSON.stringify(parsed.issues)}`);
  assert.deepEqual(parsed.ports, [{ start: 1000, end: 3000 }]);
  console.log('  · 空格写法 ⇒ 1 项 / 区间 1000-3000（未被拆成两项）');
});

test('T5.6 漂移：显示「旧 → 新」两个地址，不只说「漂移了」', () => {
  const rows = buildPortRows(
    snapshot({ ports: [classification('drift', 3306, { drift: { from: OLD_ETH0, to: ETH0 }, rules: [rule(3306, OLD_ETH0)] })], managedPortsDecl: ['3306'] }),
    GATE_OK,
  );
  const drift = rows[0]?.drift;
  assert.ok(drift !== null && drift !== undefined);
  assert.equal(drift.from, OLD_ETH0);
  assert.equal(drift.to, ETH0);
  assert.ok(drift.text.includes(OLD_ETH0) && drift.text.includes(ETH0), `文本必须含两个地址：${drift.text}`);
  console.log(`  · 扫了 ${String(rows.length)} 行，漂移文本「${drift.text}」`);
});

test('T5.6 漂移修复：序列是「先删后加」；裁定 (a) 后受理，非 IPv4 的历史值仍如实报闸门原因', () => {
  const fix = buildDriftFixView({ port: 3306, scope: 'loopback', eth0Ip: ETH0, managedPorts: managedPorts([3306]), rules: [rule(3306, OLD_ETH0)] });
  assert.deepEqual(fix.steps.map((step) => step.kind), ['portproxy-delete', 'portproxy-add'], `实际 ${JSON.stringify(fix.steps.map((step) => step.kind))}`);
  assert.deepEqual(fix.steps.map((step) => step.order), [1, 2]);
  assert.ok(fix.steps.every((step) => step.commandText.includes('netsh')), '命令原文必须来自 005 的步骤构造器');
  // 旧口径（原文留痕）：「漂移规则不被认作 own ⇒ 必须如实带出闸门原因（reason=rule-not-owned）」。
  // 2026-10-16 裁定 (a) 起：声明端口内 + 本插件 listen 形态 + connectAddress 是合法 IPv4 且 ≠ 当前 eth0
  // ⇒ 视为本插件历史写入 ⇒ **受理**（`blocked` 为 null，UI 的「修复」按钮与命令原文直接可用）。
  assert.equal(fix.blocked, null, '裁定 (a) 后漂移修复被受理 ⇒ 不带闸门原因');
  assert.equal(fix.from, OLD_ETH0);
  console.log(`  · 扫了 ${String(fix.steps.length)} 步序列：${JSON.stringify(fix.steps.map((step) => step.kind))}；闸门=${fix.blocked === null ? '放行' : '拦下'}`);

  // 负例控：同一条路径下，历史值不是合法 IPv4 ⇒ 仍必须如实带出闸门原因（放宽不许把「无法判定」也放过）
  const notIp = buildDriftFixView({ port: 3306, scope: 'loopback', eth0Ip: ETH0, managedPorts: managedPorts([3306]), rules: [rule(3306, 'old-wsl-host')] });
  assert.equal(notIp.blocked?.reason, 'rule-not-owned');
  assert.deepEqual(notIp.steps.map((step) => step.kind), ['portproxy-delete', 'portproxy-add'], '被拦下时仍展示「修复会做什么」，但按钮不带闸门结果');
});

test('T5.6 中途失败：如实报出未改动项（不静默留半截）', () => {
  const partial = summarizeWriteReport(['portproxy-delete', 'portproxy-add'], {
    status: 'partial',
    message: '部分步骤失败',
    steps: [
      { name: 'portproxy-delete', ok: true, stderr: '' },
      { name: 'portproxy-add', ok: false, stderr: '拒绝访问' },
    ],
  });
  assert.deepEqual(partial.unapplied, ['portproxy-add'], `实际 ${JSON.stringify(partial.unapplied)}`);
  const full = summarizeWriteReport(['portproxy-add'], { status: 'ok', message: '成功', steps: [{ name: 'portproxy-add', ok: true, stderr: '' }] });
  assert.deepEqual(full.unapplied, [], '全成时不得虚报未改项');
  console.log(`  · 扫了 2 个回执，未改项 ${JSON.stringify(partial.unapplied)} / ${JSON.stringify(full.unapplied)}`);
});

test('T5.4 取不到 eth0：一条判决都不给，外部清单与 UDP 提示照旧可见', () => {
  const external = externalRulesFromFixture();
  const view = buildPortsPageView(
    snapshot({
      diff: { ok: false, reason: 'eth0-unknown', message: '取不到 eth0', hint: '启动发行版后重试', external, unsupported: [unsupportedMapping('dns', 53)] },
    }),
  );
  assert.equal(view.ports.length, 0, '失败态不得产出任何端口判决（更不得全标 drift）');
  assert.equal(view.eth0.known, false);
  assert.equal(view.externalCount, 19, 'WSL 停着也要看得见别人的规则');
  assert.equal(view.unsupported.length, 1, 'UDP 提示与失败态无关');
  assert.equal(view.eth0.launchEnabled, true, '只有失败态才允许「启动并核验」');
  assert.equal(writeGate(snapshot({ diff: { ok: false, reason: 'eth0-unknown', message: 'x', hint: 'y', external: [], unsupported: [] } })).allowed, false);
  console.log(`  · 扫了失败态：端口 ${String(view.ports.length)} 行、外部 ${String(view.externalCount)} 条、不可转发 ${String(view.unsupported.length)} 条`);
});

test('NFR-2 结构证明：整棵视图模型里没有任何函数（无物可调 ⇒ 开页不可能写）', () => {
  const view = buildPortsPageView(
    snapshot({
      ports: PORT_STATES.map((state, index) => classification(state as PortState, 5000 + index, { drift: state === 'drift' ? { from: OLD_ETH0, to: ETH0 } : null, rules: state === 'drift' ? [rule(5002, OLD_ETH0)] : [] })),
      managedPortsDecl: ['3306', '1000-3000'],
    }),
  );
  const hits = countFunctions(view);
  assert.deepEqual(hits, [], `视图模型不得含函数：${JSON.stringify(hits)}`);
  let nodes = 0;
  const walk = (value: unknown): void => {
    nodes += 1;
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
  };
  walk(view);
  assert.ok(nodes > 100, `遍历节点数 ${String(nodes)} 太少，扫描本身可疑`);
  console.log(`  · 扫了 ${String(nodes)} 个节点 / ${String(view.ports.length)} 行端口，函数命中 0 个`);
});

test('T5.1 刷新时间戳：快照换了时间戳，页面文本跟着变', () => {
  const first = buildPortsPageView(snapshot({ refreshedAt: Date.UTC(2026, 9, 9, 6, 0, 0) }));
  const second = buildPortsPageView(snapshot({ refreshedAt: Date.UTC(2026, 9, 9, 7, 0, 0) }));
  assert.notEqual(first.refreshedAtText, second.refreshedAtText, `${first.refreshedAtText} vs ${second.refreshedAtText}`);
  assert.equal(first.refreshedAt, Date.UTC(2026, 9, 9, 6, 0, 0));
  console.log(`  · 扫了 2 个时间戳：「${first.refreshedAtText}」→「${second.refreshedAtText}」`);
});

test('D1 转发页视图：docker 失败时只剩诊断行，**不再携带容器表**（旧代码有 containers/containerCount）', () => {
  const view = buildPortsPageView(
    snapshot({ docker: { ok: false, reason: 'timeout', message: 'docker ps 超时', hint: '重试一次', raw: 'partial' } }),
  );
  assert.equal('containers' in view, false, '转发页视图不得再有容器行数组');
  assert.equal('containerCount' in view, false, '转发页视图不得再有容器计数');
  assert.equal('containerListNote' in view, false, '转发页视图不得再有容器列表回落说明');
  assert.equal(view.docker.ok, false);
  assert.ok(view.docker.ok === false && view.docker.reason === 'timeout');
  console.log('  · 扫了失败态：容器字段 0 个、docker 诊断仍在');
});

test('T5.4 端口行证据：scopeMismatch 是事实位，不改变状态（design §3 订正②）', () => {
  const rows = buildPortRows(snapshot({ ports: [classification('ok', 3306, { scopeMismatch: true, rules: [rule(3306, ETH0, '0.0.0.0')] })] }), GATE_OK);
  assert.equal(rows[0]?.state, 'ok', 'scopeMismatch 不得把状态改写成 conflict');
  assert.equal(rows[0]?.scopeMismatch, true);
  console.log(`  · 扫了 ${String(rows.length)} 行：state=${String(rows[0]?.state)} scopeMismatch=${String(rows[0]?.scopeMismatch)}`);
});

test('D1 TESTID：容器表锚点已离开转发侧，剩余 10 个基础控件', () => {
  const ids = Object.values(TESTID);
  assert.equal(ids.length, 10, `TESTID 应有 10 个基础控件，实际 ${String(ids.length)}`);
  const requiredIds: readonly string[] = ['btn-refresh', 'tbl-ports', 'tip-udp', 'btn-raw-output', 'sel-elevation', 'btn-nat-guide', 'btn-cs-exec'];
  for (const required of requiredIds) assert.ok(ids.includes(required as (typeof ids)[number]), `缺少 ${required}`);
  assert.equal(ids.includes('tbl-containers' as (typeof ids)[number]), false, '转发页不得再导出容器表 testid');
  assert.equal(TESTID.managedPortsInput, 'inp-managed-ports');
  assert.equal(scopeTestId(3306), 'sel-scope-3306');
  console.log(`  · 扫了 ${String(ids.length)} 个 TESTID：${JSON.stringify(ids)}`);
});

test('D1 容器端口映射：不再进入转发页视图（容器端口只在容器页自己的快照里）', () => {
  const rows = buildPortRows(snapshot({}), GATE_OK);
  assert.deepEqual(rows, []);
  const view = buildPortsPageView(
    snapshot({
      docker: {
        ok: true,
        emptyAfterRetry: false,
        argv: ['docker', 'ps'],
        containers: [
          container('web', [
            { hostIp: '0.0.0.0', hostPort: 8080, hostPortEnd: 8081, containerPort: 80, containerPortEnd: 81, protocol: 'tcp' },
            { hostIp: null, hostPort: null, hostPortEnd: null, containerPort: 443, containerPortEnd: null, protocol: 'tcp' },
          ]),
        ],
      },
    }),
  );
  assert.equal('containers' in view, false, '容器端口映射文本不得再进转发页视图');
  assert.equal(view.docker.ok, true);
  console.log('  · 扫了 1 个带 2 条映射的容器：转发页容器字段 0 个');
});
