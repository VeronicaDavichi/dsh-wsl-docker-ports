/**
 * T6.8 宿主侧**快照装配**（`node --test`，零真机、零真实进程）
 *
 * 判据（每条都打印扫到的数）：
 * ① **构造器零命令**：`createSnapshotBuilder()` 不跑任何外部命令（探针全在 `build()` 里）；
 * ② **与 `diff` 输入一致**（T6.8 判据 ①）：路由返回的 `snapshot.diff` 与「用同一批事实直接喂
 *    `diff()`」逐字相等 —— 装配层不得丢事实、不得改事实；
 * ③ **读失败走 T5.4 既有失败分支**（T6.8 判据 ②）：eth0 取不到 ⇒ `diff.ok:false`、
 *    页面端口判决 **0 行**、外部规则条数**不变**；
 * ④ 规则读失败 ⇒ `rules-unavailable`（**不许**用空集合冒充「没有规则」）；
 * ⑤ docker 失败 ⇒ 快照内失败态；判决改由**监听表**独立给出（有监听 ⇒ ok + listener-active，
 *    没人听 ⇒ extra + no-listener；**不**因为 docker 读不到就把所有规则打成多余）。
 *
 * fixture 全是真的：19 条 portproxy（`netsh-portproxy-v4tov4.raw`）+ `docker ps` 真样本。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { listDistros } from 'dsh-wsl-shared';

import { buildPortsPageView } from '../../src/client/page.ts';
import { diff } from '../../src/diff/engine.ts';
import { parseManagedPorts } from '../../src/diff/managed-ports-parse.ts';
import { probeDockerPs } from '../../src/read/docker-probe.ts';
import { probeListeners } from '../../src/read/listeners-probe.ts';
import { probePortproxyRules } from '../../src/read/netsh-probe.ts';
import { createSnapshotBuilder, natGateOf } from '../../src/snapshot.ts';
import type { SnapshotDeps } from '../../src/snapshot.ts';
import { failure } from '../helpers/fake-executor.ts';
import { ETH0 } from './client-fixtures.ts';
import { FIXTURE_PORTS, WSL_CONFIG, WSL_CONFIG_TEXT, readFixture, routingExecutor } from '../helpers/snapshot-fixtures.ts';

/** nat 门 / localhostForwarding / 时间戳的注入（**不碰真 `.wslconfig`**，不依赖真实时间） */
function depsOf(fake: ReturnType<typeof routingExecutor>, extra: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    executor: fake.executor,
    // nat 门与 localhostForwarding 都**不碰真 `.wslconfig`**（注入 + 假文件读）
    readNetworkingMode: () => Promise.resolve({ ok: true, path: WSL_CONFIG, mode: 'default', resolved: 'nat' }),
    localhostForwarding: { filePath: WSL_CONFIG, readFile: () => Promise.resolve(WSL_CONFIG_TEXT) },
    now: () => Date.UTC(2026, 9, 9, 3, 0, 0),
    ...extra,
  };
}

/**
 * **独立**从 docker fixture 原文里数出「已发布到宿主的 TCP 宿主端口」与「非 TCP 映射数」。
 * 刻意不调用生产解析器（`read/docker.ts`）：判据①要的是「路由给的判决与原始事实对得上」，
 * 用被测代码自己算期望值就成了恒真断言。
 */
function scanDockerFixture(raw: string): { published: number[]; nonTcp: number } {
  const published = new Set<number>();
  let nonTcp = 0;
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    const ports = (JSON.parse(text) as { Ports?: string }).Ports ?? '';
    for (const item of ports.split(',')) {
      // 容器侧也可能是区间（`5002-5003->5002-5003/tcp`）⇒ 容器侧同样要允许 `-end`
      const mapping = /(?:[\d.]+|\[[^\]]*\]):(?<start>\d+)(?:-(?<end>\d+))?->(?<container>\d+)(?:-\d+)?\/(?<protocol>\w+)/u.exec(item);
      if (mapping === null) continue;
      if (mapping.groups?.['protocol'] !== 'tcp') {
        nonTcp += 1;
        continue;
      }
      const start = Number(mapping.groups['start']);
      const end = mapping.groups['end'] === undefined ? start : Number(mapping.groups['end']);
      for (let port = start; port <= end; port += 1) published.add(port);
    }
  }
  return { published: [...published].sort((a, b) => a - b), nonTcp };
}

const DECLARATION = { managedPorts: [...FIXTURE_PORTS], scopes: {}, elevationPolicy: 'none' } as const;

test('T6.8 装配器构造期零外部命令（探针全在 build 里）', () => {
  const fake = routingExecutor();
  createSnapshotBuilder(depsOf(fake));
  assert.equal(fake.calls.length, 0, `构造期不得执行任何外部命令，实际 ${String(fake.calls.length)} 条`);
  console.log(`  · 构造扫了 ${String(fake.calls.length)} 条外部命令（要求 0）`);
});

test('T6.8 判据①：路由返回的快照与 diff 输入一致（19 条真规则 vs 19 个声明端口）', async () => {
  const fake = routingExecutor();
  const outcome = await createSnapshotBuilder(depsOf(fake)).build(DECLARATION, {});
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const { snapshot } = outcome;

  // ── 事实层：与 fixture 对得上
  assert.equal(snapshot.refreshedAt, Date.UTC(2026, 9, 9, 3, 0, 0), '时间戳必须来自注入的 now()');
  assert.equal(snapshot.nat.kind, 'nat');
  assert.equal(snapshot.distro?.name, 'Ubuntu2204');
  assert.equal(snapshot.distro?.state, 'Running');
  assert.equal(snapshot.distro?.source, 'wslDefault');
  assert.equal(snapshot.distroError, null);
  assert.equal(snapshot.docker.ok, true);
  if (!snapshot.docker.ok) throw new Error('docker fixture 应当读成功');
  assert.equal(snapshot.docker.containers.length, 6, '真 fixture 是 6 个容器');
  assert.equal(snapshot.localhostForwarding, true);
  assert.equal(snapshot.elevationPolicy, 'none');
  assert.equal(snapshot.elevationAvailable, false, '未注入提权探测 ⇒ 保守 false');
  assert.equal(snapshot.execAvailable, false, '未注入 002 服务 ⇒ false（只影响文案）');
  assert.equal(snapshot.iphlpsvcRunning, null, '未实现 iphlpsvc 探测 ⇒ 必须是 null，不许编 true/false');
  assert.equal(snapshot.managedPortsDecl.length, 19, '声明原样回显（UI 的表单要用它）');

  // ── 判决层：**期望值独立从 fixture 原文算出**（不用生产解析器，否则是恒真断言）
  const scanned = scanDockerFixture(readFixture('docker-ps.redacted.jsonl'));
  const declaredNumbers = [...FIXTURE_PORTS].map(Number);
  const rulePorts = new Set<number>(); // fixture 的 19 条规则监听端口（下面用真探针取出后核对）
  const expectedOk = declaredNumbers.filter((port) => scanned.published.includes(port)).sort((a, b) => a - b);
  const expectedExtra = declaredNumbers.filter((port) => !scanned.published.includes(port)).sort((a, b) => a - b);

  assert.equal(snapshot.diff.ok, true);
  if (!snapshot.diff.ok) return;
  const result = snapshot.diff.result;
  assert.equal(result.eth0Ip, ETH0, '判决依据的 eth0 必须与 fixture 一致');
  assert.equal(result.ports.length, 19, `每个端口恰好一条，实际 ${String(result.ports.length)}`);
  assert.deepEqual(
    result.ports.map((port) => port.port).sort((a, b) => a - b),
    [...declaredNumbers].sort((a, b) => a - b),
    '端口集合与声明集合逐字一致（引擎按端口号排序，故这里比集合）',
  );
  const counts = result.counts;
  const sum = counts.ok + counts.missing + counts.drift + counts.conflict + counts.extra;
  assert.equal(sum, 19, `五态之和必须等于端口数，实际 ${String(sum)}`);
  // 🔴 真实判决不是「全 ok」：原脚本硬编码的 19 个端口里，**docker 现在只发布 7 个**
  //    （fixture：6379 / 8194 / 8080 / 50051 / 5432 / 5002-5003）⇒ 余下 12 条规则 docker 已不再
  //    映射；013 起**再按监听表判**：fixture 的 `ss -ltn` 恰好只监听这 7 个 ⇒ 余下 12 条
  //    `extra` + `no-listener`（不是 ok、更不是 missing）。
  assert.equal(counts.ok, expectedOk.length, `docker 仍发布的声明端口 ⇒ ok（独立扫出 ${expectedOk.length} 个：${JSON.stringify(expectedOk)}）`);
  assert.equal(counts.extra, expectedExtra.length, `docker 已不发布的声明端口 ⇒ extra（独立扫出 ${expectedExtra.length} 个）`);
  // 013：fixture 的 `ss -ltn` 只监听 docker 已发布的那些端口 ⇒ 余下 12 条**确实没人监听**（不是「未知」）
  assert.equal(
    result.ports.filter((port) => port.state === 'extra').every((port) => port.reason === 'no-listener'),
    true,
    `fixture 里没有非 docker 的监听 ⇒ 每条 extra 都必须给 no-listener，实际 ${JSON.stringify(result.ports.filter((port) => port.state === 'extra').map((port) => port.reason))}`,
  );
  assert.equal(counts.missing, 0, '19 条规则都在 ⇒ 没有一个缺规则');
  assert.equal(counts.drift, 0, 'fixture 的 connectAddress 就是当前 eth0 ⇒ 无漂移');
  assert.equal(counts.conflict, 0, '声明集合内的规则不算 conflict');
  assert.equal(
    result.ports.filter((port) => port.state === 'ok').every((port) => port.drift === null),
    true,
  );
  assert.deepEqual(result.external, [], '19 个端口全在 managedPorts 里 ⇒ 没有外部规则');
  assert.equal(result.unsupported.length, scanned.nonTcp, `REQ-9.2：非 TCP 映射数必须与原文一致（独立扫出 ${String(scanned.nonTcp)} 个）`);

  // ── 🔴 判据①的强形态：**独立复算** —— 用同一批事实直接喂 diff()，与路由返回的判决逐字相等
  // （顺序：先把「本次 build 跑了哪些命令」钉死，再做复算 —— 复算自己也会调探针）
  const commands = fake.calls.map((call) => [call.file, ...call.argv].join(' '));
  assert.deepEqual(commands.slice(0, 5), [
    'wsl.exe -l -v',
    'netsh.exe interface portproxy show v4tov4',
    'wsl.exe -d Ubuntu2204 -- docker ps -a --format {{json .}}',
    'wsl.exe -d Ubuntu2204 -- ip -4 -o addr show dev eth0',
    // 013：监听表（一次 `ss -ltn` 拿全表）—— 与 eth0 同在发行版内读，只读、无 shell
    'wsl.exe -d Ubuntu2204 -- ss -ltn',
  ], `命令集的前 5 条必须逐字不变，实际 ${JSON.stringify(commands)}`);
  // 012（2026-10-22）：第 6 条 = 候选监听地址的**只读**枚举
  assert.equal(commands.length, 6, `命令集必须恰好 6 条只读命令（含 012 的网卡枚举 + 013 的监听表），实际 ${JSON.stringify(commands)}`);
  assert.match(
    commands[5] ?? '',
    /^powershell\.exe -NoProfile -NonInteractive -Command .*Get-NetIPAddress/u,
    '第 6 条必须是 powershell 的只读 Get-NetIPAddress 枚举',
  );
  assert.equal(commands.some((line) => /portproxy (add|delete|reset)|Start-Process|gsudo|Set-NetIPAddress|New-NetIPAddress/u.test(line)), false, '只读路径不得出现任何写/提权命令');

  const distros = await listDistros(fake.executor);
  assert.equal(distros.ok, true);
  const rules = await probePortproxyRules(fake.executor, {});
  const containers = await probeDockerPs(fake.executor, 'Ubuntu2204', distros.ok ? distros.distros : [], {});
  // 013：复算必须喂**同一张监听表** —— 缺了它，extra 会退化成 listeners-unknown，判决自然对不上
  const listeners = await probeListeners(fake.executor, 'Ubuntu2204', distros.ok ? distros.distros : [], {});
  assert.equal(rules.ok, true);
  assert.equal(containers.ok, true);
  assert.equal(listeners.ok, true, 'fixture 的 ss 输出必须能解析（否则复算的口径不成立）');
  const parsed = parseManagedPorts([...FIXTURE_PORTS]);
  assert.equal(parsed.ok, true);
  if (rules.ok && containers.ok && parsed.ok && distros.ok && listeners.ok) {
    for (const rule of rules.rules) rulePorts.add(rule.listenPort);
    assert.deepEqual([...rulePorts].sort((a, b) => a - b), [...declaredNumbers].sort((a, b) => a - b), 'fixture 的规则端口集合 = 声明集合（否则「全 extra」的推理不成立）');
    const recomputed = diff({ containers: containers.containers, managedPorts: parsed.ports, rules: rules.rules, eth0Ip: ETH0, localhostForwarding: true, scopes: {}, listeners });
    assert.deepEqual(snapshot.diff, recomputed, '装配层不得丢事实/改事实：快照里的判决必须与「同批事实直接喂引擎」完全一致');
  }

  console.log(`  · 扫了 ${String(commands.length)} 条只读命令 / 19 条规则 + ${String(scanned.published.length)} 个 docker 已发布端口 → counts=${JSON.stringify(counts)}；external=${String(result.external.length)} unsupported=${String(result.unsupported.length)}`);
});

test('T6.8 判据②：eth0 取不到 ⇒ 走 T5.4 既有失败分支（端口 0 行、外部规则不变）', async () => {
  const builderOk = createSnapshotBuilder(depsOf(routingExecutor()));
  const builderFail = createSnapshotBuilder(depsOf(routingExecutor({ eth0: false })));
  const emptyDecl = { managedPorts: [], scopes: {}, elevationPolicy: 'none' } as const;

  const good = await builderOk.build(emptyDecl, {});
  const bad = await builderFail.build(emptyDecl, {});
  assert.equal(good.ok, true);
  assert.equal(bad.ok, true, '取不到 eth0 是**快照内的**失败态，不是路由级错误');
  if (!good.ok || !bad.ok || !good.snapshot.diff.ok || bad.snapshot.diff.ok) throw new Error('前置形状不对：eth0 成功态应为 result、失败态应为 DiffFailure');

  // ── 「外部规则照旧」：同一份声明下，失败态的 external / unsupported 与成功态**逐字相等**
  assert.equal(good.snapshot.diff.result.external.length, 19, '19 条规则都不在声明里 ⇒ 全是外部规则');
  assert.deepEqual(bad.snapshot.diff.external, good.snapshot.diff.result.external, 'REQ-15.1：外部规则与 eth0 无关，失败态照给且逐字不变');
  assert.deepEqual(bad.snapshot.diff.unsupported, good.snapshot.diff.result.unsupported, 'REQ-9.2：UDP 提示同样与 eth0 无关');
  assert.equal(bad.snapshot.diff.reason, 'eth0-unknown');
  assert.equal(bad.snapshot.diff.external[0]?.display.includes('→'), true, '展示形态 `listen → connect`');
  assert.equal(bad.snapshot.docker.ok, true, 'docker 仍可读 ⇒ 不因 eth0 失败而假装 docker 也失败');

  // ── 逐字段落到既有渲染层：T5.4 的口径就是「0 行端口 + 外部照旧」
  const declared = await builderFail.build(DECLARATION, {});
  assert.equal(declared.ok, true);
  if (!declared.ok) return;
  const page = buildPortsPageView(declared.snapshot);
  assert.equal(page.ports.length, 0, `失败态端口判决必须 0 行，实际 ${String(page.ports.length)}`);
  assert.deepEqual(page.counts, { ok: 0, missing: 0, drift: 0, conflict: 0, extra: 0 });
  assert.equal(page.eth0.known, false, 'eth0 未知 ⇒ 显示「未知」而不是 0.0.0.0');
  assert.ok((page.portsNote ?? '').length > 0, '必须给一句人话说明为什么没有判决');
  assert.equal(page.docker.ok, true, 'docker 区照旧渲染（失败与它无关）');
  if (page.docker.ok) assert.equal(page.docker.containers.length, 6, 'docker 失败与 eth0 无关 ⇒ 6 个容器照给');
  console.log(`  · 扫了 3 份快照：外部规则 ${String(good.snapshot.diff.result.external.length)} 条（失败态逐字相等）→ 声明 19 个端口时页面端口 ${String(page.ports.length)} 行 / counts 全 0 / eth0.known=${String(page.eth0.known)}`);
});

test('T6.8 规则读不到 ⇒ rules-unavailable（绝不用空集合冒充「没有规则」）', async () => {
  const fake = routingExecutor({ netsh: false });
  const outcome = await createSnapshotBuilder(depsOf(fake)).build(DECLARATION, {});
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, 'rules-unavailable');
  assert.match(outcome.message, /portproxy/u, '把「读的是什么」写清，否则读的人不知道缺了哪段事实');
  assert.match(outcome.message, /stderr/u, '把 hint 带上（探针给的下一步引导）');
  // 声明里 19 个端口、规则读不到 ⇒ 若伪装成空集合，这 19 个会全部假报 missing；故必须是路由级错误
  assert.equal(outcome.message.includes('missing'), false);
  console.log(`  · 扫了 1 次失败探测 → code=${outcome.code}，message=${JSON.stringify(outcome.message)}`);
});

test('T6.8 未预期异常 ⇒ internal，且错误文案过一遍脱敏（REQ-3.5）', async () => {
  const fake = routingExecutor();
  const outcome = await createSnapshotBuilder(depsOf(fake, { now: () => { throw new Error('boom password=hunter2 token=abc'); } })).build(DECLARATION, {});
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, 'internal');
  assert.equal(outcome.message.includes('hunter2'), false, '`password=` 的值必须被掩掉');
  assert.equal(outcome.message.includes('token=abc'), false, '`token=` 的值必须被掩掉');
  assert.ok(outcome.message.includes('<已脱敏>'), '脱敏要看得见（否则「没命中」与「没脱敏」分不清）');
  assert.match(outcome.message, /boom/u, '原始原因要留着，否则无从定位');
  console.log(`  · 扫了 1 次抛出 → code=${outcome.code}，脱敏命中 ${String(outcome.message.includes('<已脱敏>'))}`);
});

test('T6.8 docker 读失败 ⇒ 监听表仍独立判决：有监听判 ok、没人监听判 extra（不冒充）', async () => {
  const fake = routingExecutor({ docker: false });
  const outcome = await createSnapshotBuilder(depsOf(fake)).build(DECLARATION, {});
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const { snapshot } = outcome;
  assert.equal(snapshot.docker.ok, false);
  if (!snapshot.docker.ok) {
    assert.equal(snapshot.docker.reason, 'daemon-down');
    assert.ok(snapshot.docker.hint.length > 0, 'REQ-2.3：三类 docker 失败各给引导');
  }
  assert.equal(snapshot.diff.ok, true, 'docker 失败不影响 eth0 ⇒ 判决照给');
  if (snapshot.diff.ok) {
    // 013：判据换成监听表后，docker 读不到**不再**等于「全部 extra」——
    // 有进程在听的 7 条规则是**真在工作**的（`ok` + `listener-active`），
    // 只有没人听的才 extra。期望值独立从 docker 原文算出，不借被测代码。
    const published = scanDockerFixture(readFixture('docker-ps.redacted.jsonl')).published;
    const declared = FIXTURE_PORTS.map(Number);
    const listening = declared.filter((port) => published.includes(port));
    const counts = snapshot.diff.result.counts;
    assert.equal(counts.ok, listening.length, `有监听的声明端口 ⇒ ok（独立扫出 ${JSON.stringify(listening)}），实际 ${JSON.stringify(counts)}`);
    assert.equal(counts.extra, declared.length - listening.length, `没人监听的声明端口 ⇒ extra（不冒充 ok），实际 ${JSON.stringify(counts)}`);
    assert.equal(counts.ok + counts.extra, declared.length, '每端口恰好一条（不重不漏）');
    assert.equal(
      snapshot.diff.result.ports.filter((port) => port.state === 'extra').every((port) => port.reason === 'no-listener'),
      true,
      '没人监听的 extra 必须给 no-listener（不是 listeners-unknown）',
    );
    assert.equal(
      snapshot.diff.result.ports.filter((port) => port.state === 'ok').every((port) => port.reason === 'listener-active'),
      true,
      'docker 失败时判 ok 的唯一依据就是 listener-active（不许拿 docker 当借口）',
    );
  }
  const page = buildPortsPageView(snapshot);
  assert.equal(page.containerCount, 0);
  assert.equal(page.ports.length, 19, 'docker 失败不影响端口行数（判决仍可给）');
  console.log(`  · 扫了 docker 失败分支：reason=${snapshot.docker.ok ? '—' : snapshot.docker.reason}，counts=${JSON.stringify(snapshot.diff.ok ? snapshot.diff.result.counts : {})}`);
});

test('T6.8 NAT 门四态映射：nat / default / mirrored / unreadable（读不到**不**按缺省 NAT 放行）', () => {
  const cases = [
    { outcome: { ok: true as const, path: WSL_CONFIG, mode: 'nat' as const, resolved: 'nat' as const }, kind: 'nat' },
    { outcome: { ok: true as const, path: WSL_CONFIG, mode: 'default' as const, resolved: 'nat' as const }, kind: 'nat' },
    { outcome: { ok: true as const, path: WSL_CONFIG, mode: 'mirrored' as const, resolved: 'non-nat' as const, rawValue: 'mirrored' }, kind: 'non-nat' },
    { outcome: { ok: true as const, path: WSL_CONFIG, mode: 'other' as const, resolved: 'non-nat' as const, rawValue: 'bridge' }, kind: 'non-nat' },
    { outcome: failure('CommandNotFound', { stderr: 'ENOENT' }), kind: 'unreadable' },
  ];
  const observed = cases.map((item) => natGateOf(item.outcome).kind);
  assert.deepEqual(observed, cases.map((item) => item.kind));
  const unreadable = natGateOf(failure('CommandNotFound', { stderr: 'ENOENT' }));
  assert.equal(unreadable.kind === 'unreadable' ? unreadable.path : 'x', '', '读不到路径时留空串，由渲染层补 %USERPROFILE% 兜底');
  assert.match(unreadable.kind === 'unreadable' ? unreadable.message : '', /CommandNotFound/u);
  console.log(`  · 扫了 ${String(cases.length)} 个 networkingMode 形状 → ${JSON.stringify(observed)}`);
});

test('T6.8 快照可 JSON 往返（传输契约必须是纯数据）', async () => {
  const fake = routingExecutor();
  const outcome = await createSnapshotBuilder(depsOf(fake)).build(DECLARATION, {});
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const roundTrip = JSON.parse(JSON.stringify(outcome.snapshot)) as typeof outcome.snapshot;
  assert.deepEqual(roundTrip, outcome.snapshot, '快照里不得有函数/undefined/Date 等不可序列化的东西');
  const functions = JSON.stringify(outcome.snapshot, (_key, value: unknown) => (typeof value === 'function' ? '<fn>' : value));
  assert.equal(functions.includes('<fn>'), false);
  console.log(`  · 扫了 ${String(functions.length)} 字节 JSON（往返逐字相等）`);
});


test('012 判据③：候选监听地址进快照；读失败只降级这两个字段（REQ-2.1）', async () => {
  const good = await createSnapshotBuilder(depsOf(routingExecutor())).build(DECLARATION, {});
  const bad = await createSnapshotBuilder(depsOf(routingExecutor({ localAddresses: false }))).build(DECLARATION, {});
  assert.equal(good.ok, true);
  assert.equal(bad.ok, true, '枚举失败是**快照内**的降级态，不是路由级错误（REQ-2.1 不允许整页不可用）');
  if (!good.ok || !bad.ok) return;

  // ── 成功态：真 fixture 过滤后只剩物理网卡那一条
  assert.deepEqual(good.snapshot.localAddresses.map((entry) => entry.address), ['192.168.31.129']);
  assert.equal(good.snapshot.localAddressesError, null, '成功态不许带原因');
  assert.match(good.snapshot.localAddresses[0]?.ifAlias ?? '', /以太网 4/u);
  assert.equal(good.snapshot.localAddresses[0]?.prefixLength, 24);

  // ── 失败态：列表为空，但**必须**带原因（静默空列表 = 谎报「没有网卡」）
  assert.deepEqual(bad.snapshot.localAddresses, []);
  assert.match(bad.snapshot.localAddressesError ?? '', /powershell-missing/u);

  // ── 降级不连坐：docker / 规则 / 判决 / 端口行都照常
  assert.equal(bad.snapshot.diff.ok, true, '规则照读 ⇒ 判决不受影响');
  assert.equal(bad.snapshot.docker.ok, true);
  const page = buildPortsPageView(bad.snapshot);
  assert.equal(page.ports.length, 19, `失败态端口判决仍 19 行，实际 ${String(page.ports.length)}`);
  assert.ok(page.ports.every((row) => row.listenAddress.options[0]?.value === '0.0.0.0'), '每行的下拉仍以默认项打头');
  console.log(`  · 成功态候选 ${String(good.snapshot.localAddresses.length)} 个；失败态 error=${JSON.stringify(bad.snapshot.localAddressesError?.slice(0, 40))}、端口仍 ${String(page.ports.length)} 行`);
});
