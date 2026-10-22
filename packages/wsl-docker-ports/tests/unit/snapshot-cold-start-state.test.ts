/**
 * 003 缺陷修复：**冷启动后的响应必须自洽**（`node --test`，零真机、零真实进程）
 *
 * ## 被钉住的缺陷
 *
 * `wsl -l -v` 是**一次性快照**：`snapshot.ts` 在装配开头读它，之后 `probeDockerPs` /
 * `createEth0Source().probe()` 才真正在发行版里跑命令。用户点「启动并核验」时
 * （`allowColdStart: true`）那次执行**会把发行版冷启动起来**（真机实测 12,637ms）——
 * 于是同一个响应里出现自相矛盾的两半：
 *
 * - `distro.state === 'Stopped'`（快照说没跑）；
 * - `diff.result.eth0Ip === '172.20.201.152'` + 6 个容器（实证证明**跑了**）。
 *
 * 根因不是「读错了」，而是**没有任何通道让后到的证据回头修正快照**
 * （`distro.ts` 的 `state: matched?.state ?? null` 是快照的唯一来源）。
 *
 * ## 判据（每条都可二值判定）
 *
 * | # | 判据 |
 * | --- | --- |
 * | ① | 同一响应里存在「发行版内读取成功」⇒ `distro.state` SHALL 是 `Running`（实证优先），且 `distros` 里**同名那一条** SHALL 一并更正（否则面板自己跟自己矛盾），**其余条目一字不动** |
 * | ② | 更正 SHALL 留痕：`stateNote` 非 null，且同时含**原读数**与**判据来源** |
 * | ③ | 没有实证时 SHALL NOT 编状态：`Stopped` 保持 `Stopped`、`stateNote` 为 `null` |
 * | ④ | 从不留假痕：快照本来就是 `Running` ⇒ `stateNote` 为 `null`（不制造「像被改过」的噪声） |
 * | ⑤ | 🔴 **反冷启动闸门一个字没动**：`allowColdStart` 缺省时 `wsl.exe -d …` 的执行次数 = **0**；两种场景的命令集合都只有既有只读命令（4 条 / 被闸门挡下后 2 条），且无一条写或提权命令 |
 *
 * ## 为什么这组用例不自己模拟闸门
 *
 * `probeDockerPs` / `probeEth0` 内部调的是**生产代码** `execInDistro`（001 REQ-2.4 的闸门就在那里）。
 * fake 只回答「命令**真被执行时**回什么字节」⇒「闸门有没有被绕过」由**真代码**决定，
 * 判据 ⑤ 因此不是恒真断言（缺省场景下 fake 连被调用都不会被调用）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSnapshotBuilder } from '../../src/snapshot.ts';
import type { SnapshotDeps } from '../../src/snapshot.ts';
import { ETH0 } from './client-fixtures.ts';
import { FIXTURE_PORTS, WSL_CONFIG, WSL_CONFIG_TEXT, routingExecutor } from '../helpers/snapshot-fixtures.ts';

/** nat 门 / localhostForwarding / 时间戳的注入（**不碰真 `.wslconfig`**，不依赖真实时间） */
function depsOf(fake: ReturnType<typeof routingExecutor>): SnapshotDeps {
  return {
    executor: fake.executor,
    readNetworkingMode: () => Promise.resolve({ ok: true, path: WSL_CONFIG, mode: 'default', resolved: 'nat' }),
    localhostForwarding: { filePath: WSL_CONFIG, readFile: () => Promise.resolve(WSL_CONFIG_TEXT) },
    now: () => Date.UTC(2026, 9, 9, 3, 0, 0),
  };
}

/** 本次装配**真的执行过**的命令（argv 逐字拼接；闸门挡下的那次不会出现在这里） */
function commandsOf(fake: ReturnType<typeof routingExecutor>): string[] {
  return fake.calls.map((call) => [call.file, ...call.argv].join(' '));
}

const DECLARATION = { managedPorts: [...FIXTURE_PORTS], scopes: {}, elevationPolicy: 'none' } as const;

/**
 * 012（2026-10-22）新增的**唯一**一条命令：候选监听地址枚举（只读 `Get-NetIPAddress`）。
 *
 * 逐字写在这里（不从 `src/read/local-addresses.ts` 取）—— 否则「命令集合没变」这条棘轮
 * 会跟着被测代码一起漂移。改动它必须先想清楚「为什么读侧要多跑一条命令」。
 */
const LOCAL_ADDRESSES_COMMAND =
  "powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference = 'Stop'; Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { \"$($_.InterfaceAlias)|$($_.IPAddress)|$($_.PrefixLength)\" }";

/** 修复前的既有命令集合（判据 ⑤ 的逐字基线：修复**不许**改动任何一条命令） */
const READ_ONLY_COMMANDS = [
  'wsl.exe -l -v',
  'netsh.exe interface portproxy show v4tov4',
  'wsl.exe -d Ubuntu2204 -- docker ps -a --format {{json .}}',
  'wsl.exe -d Ubuntu2204 -- ip -4 -o addr show dev eth0',
  LOCAL_ADDRESSES_COMMAND,
];

test('003 修：冷启动实证 ⇒ distro.state 必须记为 Running 且留痕（同响应不许自相矛盾）', async () => {
  const fake = routingExecutor({ wslState: 'Stopped' });
  const outcome = await createSnapshotBuilder(depsOf(fake)).build(DECLARATION, { allowColdStart: true });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const { snapshot } = outcome;
  const panel = snapshot.distro;

  // ── 前置：事实层必须是「发行版内读取真的成功了」，否则这条用例没有在测冷启动
  assert.equal(snapshot.docker.ok, true, '前置：docker ps 必须真读成功（冷启动之后）');
  assert.equal(snapshot.diff.ok, true, '前置：eth0 必须真读成功（冷启动之后）');
  if (!snapshot.diff.ok) return;
  assert.equal(snapshot.diff.result.eth0Ip, ETH0, '前置：eth0 实证与 fixture 一致');
  const inDistro = commandsOf(fake).filter((line) => line.startsWith('wsl.exe -d '));
  assert.equal(inDistro.length, 2, `前置：两条发行版内命令都真执行了，实际 ${JSON.stringify(inDistro)}`);
  assert.equal(snapshot.distroError, null);

  // ── 判据 ①：实证优先 —— 不许再把一次性快照的 `Stopped` 当结论（这就是被修的缺陷）
  assert.equal(panel?.state, 'Running', '发行版内读取成功 ⇒ 状态必须是 Running（证据优先于快照），不许仍是 Stopped');
  // ── 判据 ①b：同一个面板里不许自相矛盾（下拉列表那条也得改），且只改有证据的那一条
  assert.equal(panel?.distros.find((distro) => distro.name === 'Ubuntu2204')?.state, 'Running', '`distros` 里目标发行版的状态必须一并更正');
  assert.equal(panel?.distros.find((distro) => distro.name === 'Debian')?.state, 'Stopped', '没有证据的发行版不许被一起改');

  // ── 判据 ②：留痕（原读数 + 判据来源都要在）
  const note = panel?.stateNote ?? null;
  assert.notEqual(note, null, '更正必须留痕：`stateNote` 非 null');
  assert.match(String(note), /Stopped/u, '留痕必须保留**原读数**，否则读的人不知道快照说过什么');
  assert.match(String(note), /docker/u, '留痕必须点名判据来源（docker ps）');
  assert.match(String(note), /eth0/u, '留痕必须点名判据来源（eth0）');

  // ── 判据 ⑤：命令集合与修复前逐字相同（没引入任何新执行）
  assert.deepEqual(commandsOf(fake), READ_ONLY_COMMANDS, '修复不许改动任何一条命令');
  assert.equal(commandsOf(fake).some((line) => /portproxy (add|delete|reset)|Start-Process|gsudo/u.test(line)), false, '只读路径不得出现任何写/提权命令');

  // ── 传输契约：新字段必须可 JSON 往返（快照是纯数据）
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot, '带 `stateNote` 的快照必须仍可 JSON 往返');

  console.log(`  · 扫了 ${String(commandsOf(fake).length)} 条命令（其中发行版内 ${String(inDistro.length)} 条真执行）→ state=${String(panel?.state)}（快照原读数 Stopped）/ stateNote 非空 = ${String(note !== null)}`);
});

test('003 修：反冷启动闸门未变 —— 缺省时一条 `wsl.exe -d` 都不执行，状态保持 Stopped 且不留痕', async () => {
  const fake = routingExecutor({ wslState: 'Stopped' });
  const outcome = await createSnapshotBuilder(depsOf(fake)).build(DECLARATION, {});
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const { snapshot } = outcome;
  const commands = commandsOf(fake);

  // ── 判据 ⑤：闸门在**执行之前**返回 ⇒ 发行版内命令一条都没被 spawn（这条就是「不引入冷启动」）
  // 012：第三条是 Windows 侧的只读网卡枚举（与 WSL 状态无关，故闸门挡下时它照样跑）
  assert.deepEqual(
    commands,
    ['wsl.exe -l -v', 'netsh.exe interface portproxy show v4tov4', LOCAL_ADDRESSES_COMMAND],
    `闸门必须在执行前返回，实际 ${JSON.stringify(commands)}`,
  );
  assert.equal(commands.filter((line) => line.includes(' -d ')).length, 0, '缺省路径 SHALL NOT 冷启动发行版（001 REQ-2.4）');

  // ── 被挡下的事实要如实传到两个视图里（不许因为「状态调和」就把失败吞掉）
  assert.equal(snapshot.docker.ok, false, '闸门挡下 ⇒ docker 视图必须是失败态');
  if (!snapshot.docker.ok) assert.equal(snapshot.docker.reason, 'distro-not-running', '失败原因必须可区分');
  assert.equal(snapshot.diff.ok, false, 'eth0 同样被挡下 ⇒ 无判决（T5.4 既有失败分支）');

  // ── 判据 ③：没有实证 ⇒ 不许编状态、更不许留痕（留痕只能由**成功过**的读取产生）
  assert.equal(snapshot.distro?.state, 'Stopped', '没有实证就必须如实显示 Stopped');
  assert.equal(snapshot.distro?.distros.find((distro) => distro.name === 'Ubuntu2204')?.state, 'Stopped', '`distros` 也不许被改');
  assert.equal(snapshot.distro?.stateNote ?? null, null, '没有实证就不许留痕（否则叫编痕）');

  console.log(`  · 扫了 ${String(commands.length)} 条命令 / 带 -d 的 0 条 → state=${String(snapshot.distro?.state)}（如实）/ stateNote=null / docker.reason=${snapshot.docker.ok ? '—' : snapshot.docker.reason}`);
});

test('003 修：快照本来就是 Running ⇒ 不留假痕、不改任何字目', async () => {
  const fake = routingExecutor();
  const outcome = await createSnapshotBuilder(depsOf(fake)).build(DECLARATION, {});
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const { snapshot } = outcome;
  const panel = snapshot.distro;

  assert.equal(snapshot.docker.ok, true, '前置：docker 正常读出');
  assert.equal(panel?.state, 'Running');
  assert.deepEqual(panel?.distros.map((distro) => distro.state), ['Running', 'Stopped'], '`distros` 逐条保持 `wsl -l -v` 原读数');
  assert.equal(panel?.stateNote ?? null, null, '没有冲突就不许留痕（否则噪声会掩盖真的修正）');
  assert.deepEqual(commandsOf(fake), READ_ONLY_COMMANDS, '稳态路径的命令集合与修复前逐字相同');

  console.log(`  · 扫了 ${String(commandsOf(fake).length)} 条命令 → state=${String(panel?.state)} / stateNote=null / distros=${JSON.stringify(panel?.distros.map((distro) => distro.state))}`);
});

test('003 修：只有一侧读取成功也是实证（docker 成功 / eth0 失败 ⇒ 仍判 Running，且留痕只列成功的那侧）', async () => {
  const fake = routingExecutor({ wslState: 'Stopped', eth0: false });
  const outcome = await createSnapshotBuilder(depsOf(fake)).build(DECLARATION, { allowColdStart: true });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const { snapshot } = outcome;
  const panel = snapshot.distro;

  assert.equal(snapshot.docker.ok, true, '前置：docker 侧成功');
  assert.equal(snapshot.diff.ok, false, '前置：eth0 侧失败（T5.4 分支照旧，判决一条不给）');

  assert.equal(panel?.state, 'Running', '任一侧发行版内读取成功即证明发行版在跑');
  const note = panel?.stateNote ?? null;
  assert.notEqual(note, null, '一侧成功也要留痕');
  assert.match(String(note), /docker/u, '留痕要点名成功过的那一侧');
  assert.equal(String(note).includes('eth0'), false, '留痕 SHALL NOT 把失败的那一侧也写成判据（证据要精确）');
  assert.ok(commandsOf(fake).length >= 3, '前置：至少跑过 wsl -l -v + netsh + docker 三条');

  console.log(`  · 扫了 ${String(commandsOf(fake).length)} 条命令 → docker.ok=${String(snapshot.docker.ok)} / diff.ok=${String(snapshot.diff.ok)} → state=${String(panel?.state)} / stateNote 含 eth0 = ${String(String(note).includes('eth0'))}`);
});

