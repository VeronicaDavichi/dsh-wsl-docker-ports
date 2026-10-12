/**
 * 两处**真机实测缺陷**的回归门（2026-10-12，005 写路径）
 *
 * ## 缺陷 1：native 后端的 argv 漏了 `-File`
 *
 * `buildNativeCommand()` 旧写法把脚本路径直接塞进 `-ArgumentList`（位置参数形态）：
 * `powershell.exe <script.ps1> <args…>`。真机实测（两次独立探针，见 005 tasks 的留痕）：
 * **位置参数形态把脚本退出码吞成 1**（脚本真跑过、out 文件有载荷：`exit 3` ⇒ 报 1、`exit 2` ⇒ 报 1），
 * 而 `-File` 形态**透传**脚本自己的退出码（未提权 ⇒ 3、经 RunAs ⇒ 2）。后果：native 后端下
 * 判别式塌成 `{0,1}`，`2`(partial) 与 `3`(precondition) 永远不可达 —— 「逐条展示 steps」与
 * 「前置不满足」两个分支成了死代码。
 *
 * ## 缺陷 2：非零退出时 `stdout` 从不赋值（且 gsudo 后端不读 out 文件）
 *
 * 真机：gsudo 回 `exitCode=1` **且 stdout 151 字节合法载荷**（`steps` 里 `portproxy-delete` 失败），
 * 产品却报 `status='cancelled'`、`stdoutLen=0`、文案「用户拒绝了 UAC…」。
 *
 * ## 变异哨兵（本文件的一半价值）
 *
 * 每个缺陷都配一个哨兵：**把旧写法 / 旧分支当场渲染并运行一遍，断言它得到错误结果**
 * （缺陷 1 ⇒ 1 而不是 3/2；缺陷 2 ⇒ cancelled）。哨兵自己是绿的，但它证明「门不是假绿」——
 * 门能区分新旧实现，而不是恒真。哨兵里的旧写法**逐字来自 HEAD**（`invoke.ts:71-77` /
 * `runner.ts:244-263`），不调用被修的代码，避免「实现改了哨兵跟着变」。
 *
 * ## 零真机
 *
 * 缺陷 1 用**假 powershell 语义模型**（把真机实测的两种形态差异写成纯函数）；
 * 缺陷 2 用 `tests/helpers/fake-elevation.ts` 的注入面。**一个真实进程都不起**。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WslSharedError } from 'dsh-wsl-shared';

import { buildInvocation, buildNativeCommand, looksLikeUacRejection } from '../../src/elevate/invoke.ts';
import { classifyExit, parseElevatedOut } from '../../src/elevate/outcome.ts';
import { runElevate } from '../../src/elevate/runner.ts';
import { scriptArgs } from '../../src/elevate/script.ts';
import type { ElevatedPayload, ScriptParams } from '../../src/elevate/types.ts';
import type { WritePlan } from '../../src/write/types.ts';
import {
  createElevateHarness,
  elevationRequest,
  GSUDO_CHOICE,
  NATIVE_CHOICE,
  STUB_OUT_PATH,
  STUB_SCRIPT_PATH,
} from '../helpers/fake-elevation.ts';

/** 与真机复现配方同形：`remove` 一个**不存在**的端口（45999 不在 19 条既有规则里） */
const PARAMS: ScriptParams = {
  action: 'remove',
  port: 45999,
  address: '172.20.201.152',
  scope: 'loopback',
  scriptPath: STUB_SCRIPT_PATH,
  outPath: STUB_OUT_PATH,
};

/** 真机那 151 字节载荷的等价物（字段与真机逐字同形：`remove` 单步失败） */
const REMOVE_FAIL_PAYLOAD: ElevatedPayload = {
  action: 'remove',
  afterRules: [],
  ok: false,
  beforeRules: [],
  steps: [{ ok: false, stderr: 'netsh exit 1', name: 'portproxy-delete' }],
  port: 45999,
};

/** 部分失败（退出码 2 的典型形态：转发删成功、另一条失败 ⇒ 必须逐条展示 steps） */
const PARTIAL_PAYLOAD: ElevatedPayload = {
  ok: false,
  action: 'remove',
  port: 45999,
  steps: [
    { name: 'portproxy-delete', ok: true, stderr: '' },
    { name: 'firewall-delete', ok: false, stderr: 'Access is denied' },
  ],
  beforeRules: [],
  afterRules: [],
};

/** 前置不满足（脚本未取得管理员 ⇒ exit 3）的回传 */
const PRECONDITION_PAYLOAD: ElevatedPayload = {
  ok: false,
  action: 'remove',
  port: 45999,
  steps: [{ name: 'precondition', ok: false, stderr: '未获得管理员权限' }],
  beforeRules: [],
  afterRules: [],
};

/**
 * 真机复现用的规划：**手搓**而不是 `buildWritePlan()`。
 * 理由：真实规划层对「不存在的端口做 remove」会判 `rule-not-owned` 并**恒给空 steps**
 * （REQ-1.2 的安全形态）⇒ 走不到提权；而真机复现要的正是「脚本真跑一次、netsh delete 找不到条目」
 * 这条零副作用路径（真机驱动也是手搓同一形状）。
 */
function removePlan(): WritePlan {
  return {
    ok: true,
    action: 'remove',
    port: 45999,
    scope: 'loopback',
    eth0Ip: '172.20.201.152',
    steps: [
      {
        kind: 'portproxy-delete',
        port: 45999,
        params: { listenport: 45999, listenaddress: '127.0.0.1' },
        commandText: 'netsh.exe interface portproxy delete v4tov4 "listenport=45999" "listenaddress=127.0.0.1"',
      },
    ],
    notes: [],
    commandText: 'netsh.exe interface portproxy delete v4tov4 "listenport=45999" "listenaddress=127.0.0.1"',
  };
}

/**
 * **假 powershell 调用层**（不起任何进程）：真机语义模型，2026-10-12 两次独立探针实测。
 * 位置参数形态 ⇒ 退出码恒 `1`；`-File` 形态 ⇒ 透传脚本自己的退出码。
 */
function fakePowerShellExitCode(argv: readonly string[], scriptExitCode: number): number {
  return argv.includes('-File') ? scriptExitCode : 1;
}

/** 从 native 载荷里取出真正下发给子 `powershell.exe` 的 argv 元素（`-ArgumentList @(…)`） */
function startProcessArgv(command: string): readonly string[] {
  const match = /-ArgumentList @\((?<list>.*?)\) -Verb RunAs/.exec(command);
  assert.ok(match !== null, `native 载荷里没有 -ArgumentList @(...)：${command}`);
  const list = match.groups?.['list'] ?? '';
  return list.split(', ').map((token) => token.replace(/^'/, '').replace(/'$/, ''));
}

/** **旧写法**（缺陷 1 的现场，逐字来自 HEAD 的 `invoke.ts:71-77`）—— 只用于变异哨兵 */
function legacyNativeCommand(scriptPath: string, args: readonly string[]): string {
  const quoted = [scriptPath, ...args].map((token) => `'${token}'`).join(', ');
  return (
    `$p = Start-Process -FilePath 'powershell.exe' ` +
    `-ArgumentList @(${quoted}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode`
  );
}

/**
 * **旧分支**（缺陷 2 的现场，逐字来自 HEAD 的 `runner.ts:244-263` + `:286-289`）—— 只用于变异哨兵。
 * 用的解析器与判定函数**没被本轮改过**（`parseElevatedOut` / `looksLikeUacRejection`），
 * 所以哨兵杀的是「分支里的漏赋」，不是「顺手把判定函数也改了」。
 */
function legacyFailureStatus(
  backend: 'gsudo' | 'native',
  exitCode: number,
  stderr: string,
  outFileText: string | null,
): string {
  // 旧写法①：非零退出分支只赋 exitCode/stderr ⇒ stdout 恒空（执行器带回来的 stdout 也不看）
  const stdout = '';
  // 旧写法②：只有「非 gsudo」后端才去读 out 文件
  const outText = backend === 'gsudo' ? null : outFileText;
  const parsed = parseElevatedOut(outText ?? (stdout.trim().length > 0 ? stdout : null));
  if (parsed.ok) return 'parsed';
  if (looksLikeUacRejection(exitCode, stdout, stderr, false)) return 'cancelled';
  return parsed.reason === 'out-file-missing' ? 'out-file-missing' : 'out-file-unparsable';
}

/* ───────────────────────── 缺陷 1 ───────────────────────── */

test('缺陷 1 门：native 后端的 argv 必须带 -File，退出码才透传（3 ⇒ precondition / 2 ⇒ partial）', () => {
  const invocation = buildInvocation(NATIVE_CHOICE, PARAMS, scriptArgs(PARAMS), 'C:\\Windows');
  const payload = invocation.argv[3] ?? '';

  // ① 载荷形态：`-ArgumentList @('-File', '<script>', …)` —— `-File` 必须紧贴脚本路径
  assert.ok(
    payload.includes(`'-File', '${STUB_SCRIPT_PATH}'`),
    `-File 必须紧跟脚本路径（旧写法缺它 ⇒ 退出码被吞）：${payload}`,
  );
  assert.equal(invocation.file, 'powershell.exe');
  assert.deepEqual(invocation.argv.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);

  // ② 顺序与参数完整性：`-File` → 脚本 → 脚本自己的参数（与 gsudo/winsudo 的 psArgs 同序）
  const argv = startProcessArgv(payload);
  assert.deepEqual(argv, ['-File', STUB_SCRIPT_PATH, ...scriptArgs(PARAMS)]);

  // ③ 退出码透传：脚本真跑完的 3 / 2 / 0 必须原样上来
  assert.equal(fakePowerShellExitCode(argv, 3), 3);
  assert.equal(fakePowerShellExitCode(argv, 2), 2);
  assert.equal(fakePowerShellExitCode(argv, 0), 0);

  // ④ 判别式不再塌成 {0,1}：「前置不满足」与「逐条展示 steps（部分失败）」两个分支可达
  assert.equal(classifyExit(fakePowerShellExitCode(argv, 3), PRECONDITION_PAYLOAD).status, 'precondition');
  assert.equal(
    classifyExit(fakePowerShellExitCode(argv, 2), PARTIAL_PAYLOAD).status,
    'partial',
  );

  // ⑤ 注入面不新增：token 仍然是产品自产、单引号包裹，且数量不缩水
  assert.equal(argv.length, 2 + scriptArgs(PARAMS).length);
  for (const token of argv.slice(1)) assert.doesNotMatch(token, /['";&`|$(){}<>\s]/);
});

test('缺陷 1 变异哨兵：旧 argv（位置参数形态）当场得到 1 —— 3/2 全被吞掉，门能杀旧实现', () => {
  const legacyArgv = startProcessArgv(legacyNativeCommand(STUB_SCRIPT_PATH, scriptArgs(PARAMS)));
  assert.equal(legacyArgv.includes('-File'), false, '旧写法的现场就是没有 -File（哨兵的前提）');

  // 真机实测：脚本真跑过（out 文件有载荷）且 exit 3 / exit 2，位置参数形态一律报 1
  assert.equal(fakePowerShellExitCode(legacyArgv, 3), 1);
  assert.equal(fakePowerShellExitCode(legacyArgv, 2), 1);

  // ⇒ 判别式只有 {0,1}：3 与 2 都被 outcome.ts 判成 failure，两个分支不可达
  const partial = PARTIAL_PAYLOAD;
  assert.equal(classifyExit(fakePowerShellExitCode(legacyArgv, 3), PRECONDITION_PAYLOAD).status, 'failure');
  assert.equal(classifyExit(fakePowerShellExitCode(legacyArgv, 2), partial).status, 'failure');
  assert.notEqual(classifyExit(1, partial).status, 'partial');

  // 对照：只差一个 `-File`，语义就从「异常 1」变回「前置不满足 3」
  const fixedArgv = startProcessArgv(buildNativeCommand(STUB_SCRIPT_PATH, scriptArgs(PARAMS)));
  assert.notDeepEqual(fixedArgv, legacyArgv);
  assert.equal(fakePowerShellExitCode(fixedArgv, 3), 3);
});

/* ───────────────────────── 缺陷 2 ───────────────────────── */

test('缺陷 2 门 A：gsudo 非零退出 + out 文件有合法载荷 ⇒ 不得 cancelled，steps/stdout/日志自证都要有', async () => {
  const harness = createElevateHarness({
    confirm: true,
    probe: GSUDO_CHOICE,
    // 真机形态：脚本写了自己的 out 文件，但 001 的 `WslSharedError` **不带 stdout**
    // （2026-10-12 实测 keys = [ok, code, message, argv, exitCode, stderr]）
    respondWith: { payload: REMOVE_FAIL_PAYLOAD, exitCode: 1, writeOutFile: true },
  });

  const result = await runElevate(elevationRequest('ask', 'user', removePlan()), harness.deps);

  assert.notEqual(result.status, 'cancelled', '有合法载荷就不是「用户拒绝 UAC」');
  assert.equal(result.status, 'failure', '退出码 1 = 脚本异常（design §4 的表）');
  assert.equal(result.exitCode, 1);
  assert.equal(result.steps.length, 1, 'steps 必须逐条可见（T2.2）');
  assert.equal(result.steps[0]?.name, 'portproxy-delete');
  assert.ok(result.stdout.length > 0, `stdout 必须是回传原文，不能空（长度 ${String(result.stdout.length)}）`);
  assert.match(result.stdout, /"port":45999/);
  // 执行后快照自证：前后两次快照 + 四项齐全的日志（NFR-1；旧写法这里 stdout 恒空 ⇒ 自证缺一项）
  assert.equal(harness.snapshotCount(), 2, '执行后快照不得被跳过');
  assert.ok(result.log !== null);
  assert.equal(result.log.exitCode, 1);
  assert.ok(result.log.stdout.length > 0, '日志四项齐全：回传原文不能是空串');
  assert.deepEqual(result.cleanup, { scriptRemoved: true, outRemoved: true });
});

test('缺陷 2 门 B：执行器带回 stdout（非零退出）⇒ stdout 被赋上，同样不得 cancelled', async () => {
  const stdoutText = `${JSON.stringify(REMOVE_FAIL_PAYLOAD)}\r\n`;
  const harness = createElevateHarness({
    confirm: true,
    probe: GSUDO_CHOICE,
    // 有的执行器（注入的 fake / 真机驱动的等价物）在失败对象里带回 stdout
    respond: () =>
      ({
        ok: false,
        code: 'NonZeroExit',
        message: 'stub:exit-1',
        exitCode: 1,
        stdout: stdoutText,
        stderr: '',
      }) as unknown as WslSharedError,
  });

  const result = await runElevate(elevationRequest('ask', 'user', removePlan()), harness.deps);

  assert.notEqual(result.status, 'cancelled');
  assert.equal(result.status, 'failure');
  assert.equal(result.stdout, stdoutText, '非零退出分支也必须把 stdout 赋上（旧写法这里是空串）');
  assert.equal(result.steps.length, 1);
  assert.equal(result.log?.stdout, stdoutText);
});

test('缺陷 2 变异哨兵：旧分支（不赋 stdout + gsudo 不读 out）当场判 cancelled —— 门能杀旧实现', () => {
  const outFileText = JSON.stringify(REMOVE_FAIL_PAYLOAD);

  // 旧分支的输入就是真机的输入：退出码 1、stdout 被丢弃、out 文件里有 151 字节合法载荷
  assert.equal(legacyFailureStatus('gsudo', 1, '', outFileText), 'cancelled');
  // 连「脚本一次都没跑起来」的判据也是它 —— 判据只看 (stdout, stderr, exitCode)，不看 out 文件
  assert.equal(looksLikeUacRejection(1, '', '', false), true);
  // 对照：只要允许读 out 文件，同一份输入就变成「有载荷」（修好的链路走的就是这一条）
  assert.equal(parseElevatedOut(outFileText).ok, true);
  // native 后端在旧写法下同样丢 stdout（只是它恰好会读 out 文件 ⇒ 症状轻）
  assert.equal(legacyFailureStatus('native', 1, '', outFileText), 'parsed');
  assert.equal(classifyExit(1, REMOVE_FAIL_PAYLOAD).status, 'failure');
});

/* ───────────────────────── 邻接检查（同一函数的其它分支）───────────────────────── */

test('邻接检查：非零退出且连 out 文件都没有 ⇒ 仍然按「真·拒绝 UAC」报 cancelled（不过度矫正）', async () => {
  const harness = createElevateHarness({
    confirm: true,
    probe: GSUDO_CHOICE,
    respondWith: { exitCode: 1, writeOutFile: false, stderr: 'The operation was canceled by the user.' },
  });

  const result = await runElevate(elevationRequest('ask', 'user'), harness.deps);

  assert.equal(result.status, 'cancelled', '真·拒绝 UAC 的指纹：无任何回传 + 取消文案 + 非零退出');
  assert.deepEqual(result.steps, []);
  assert.equal(result.stdout, '');
  assert.equal(harness.snapshotCount(), 2, '即便被拒也要取执行后快照（不臆断「什么都没发生」）');
});
