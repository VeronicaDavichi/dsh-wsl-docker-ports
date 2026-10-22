/**
 * 提权运行的编排（005 T2.2 / T2.3 / T2.4 / T2.5，design §4 的时序图）
 *
 * ## 时序（1 → 10 与 design §4 一一对应）
 *
 * 1. 解析策略（**Agent + `passby` ⇒ 降级 `ask`**，REQ-4.1）；`none` ⇒ 到此为止，**零进程零文件**
 * 2. `ask`：先确认，**展示命令原文**（REQ-3.2）；被拒 ⇒ `declined`，零进程零文件
 * 3. 探测后端（`where.exe gsudo` + `gsudo status`；缓存活跃 ⇒ 回落 native，REQ-3.4）
 * 4. **执行前**取实际集快照（REQ-1.5）；快照失败 ⇒ 中止（无法自证就不动手）
 * 5. 生成 `%TEMP%\dsh-ppp-<rand>.ps1` + out 路径（REQ-3.6）
 * 6. 经 001 执行器下发（**argv 数组、无 shell 拼接**，design §5）
 * 7. 回传：**两条通道都读** —— gsudo 优先 stdout（stdio 回传）、native/winsudo 优先 out 文件，
 *    缺一条就用另一条兜底（真机缺陷 2：001 的失败对象不带 stdout，只认 stdout 就会把合法载荷丢掉）
 * 8. 解析 JSON + 退出码表 → 状态（含 `999` = 提权失败；拒绝 UAC ⇒ `cancelled`）
 * 9. **三条路径（成功 / 失败 / 超时）都删两个临时文件**（NFR-2；`finally` 保证）
 * 10. **执行后**再取一次快照 + 组装四项齐全的任务日志（NFR-1）
 *
 * ## 拒绝 UAC 时**不做任何回滚**
 *
 * design §4 末行：`Start-Process` 抛错（用户点「否」）时**什么都没执行** ⇒ 没有可回滚的东西。
 * 本文件的实现里根本没有「回滚」这个概念 —— `lan` 的半成品防护在**脚本内部**
 * （放行失败才回滚刚加的 portproxy），主机侧只如实报告 `steps`。
 *
 * ## 零真机 / 不抛
 *
 * 一切外部调用都走注入的 `executor` / `snapshot` / `writeFile` / `removeFile` / `probeBackend`；
 * 生产默认值用 001 的执行器与 `node:fs`/`os.tmpdir`。**总是**返回结果对象（不抛异常）——
 * 宿主插件拿它直接进 UI，失败原因必须可区分（design §6）。
 *
 * 「怎么调」的三条后端形态在 `invoke.ts`（含拒 UAC 的判定与 native 的 `Start-Process` 载荷）。
 */

import { randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import type { Executor } from 'dsh-wsl-shared';

import { compareOthers, createWriteLogEntry, type WriteLogEntry } from '../write/log.ts';
import { createPortproxySnapshotter, type PortproxySnapshotter } from '../write/snapshot.ts';

import { detectBackend, resolvePolicy } from './backend.ts';
import { buildInvocation, DEFAULT_ELEVATE_TIMEOUT_MS, looksLikeUacRejection, scriptAddressesOf, scriptCallFor } from './invoke.ts';
import { classifyExit, ELEVATE_EXIT, parseElevatedOut, payloadPortMismatch } from './outcome.ts';
import {
  assertScriptParams,
  buildElevateScript,
  defaultRandomSuffix,
  ElevateParamError,
  scriptArgs,
  tempOutPath,
  tempScriptPath,
} from './script.ts';
import type {
  BackendChoice,
  ConfirmRequest,
  ElevateRequest,
  ElevateResult,
  ElevationDeps,
  ElevationPolicy,
  ElevatedPayload,
  ScriptParams,
  StepReport,
} from './types.ts';

function emptyResult(
  status: ElevateResult['status'],
  commandText: string,
  message: string,
  hint: string,
): ElevateResult {
  return {
    status,
    exitCode: null,
    stdout: '',
    stderr: '',
    steps: [],
    argv: [],
    backend: null,
    commandText,
    message,
    hint,
    cleanup: { scriptRemoved: false, outRemoved: false },
    log: null,
  };
}

async function safeRemove(remove: (path: string) => Promise<void>, path: string): Promise<boolean> {
  try {
    await remove(path);
    return true;
  } catch {
    return false;
  }
}

/** 快照依赖（未注入时用 003 的 netsh 只读探针包一层） */
function snapshotterOf(deps: ElevationDeps): PortproxySnapshotter {
  return deps.snapshot ?? createPortproxySnapshotter(deps.executor);
}

async function probeOf(deps: ElevationDeps, systemRoot: string): Promise<BackendChoice> {
  if (deps.probeBackend !== undefined) return deps.probeBackend();
  return detectBackend({
    executor: deps.executor,
    ...(deps.configuredBackend === undefined ? {} : { configured: deps.configuredBackend }),
    systemRoot,
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 非零退出时的 stdout。
 *
 * 🔴 事实（2026-10-12 真机 + X1 实验）：001 的 `createExecutor` 在 `NonZeroExit` 分支用
 * `fail(code, message, { argv, exitCode, stderr })` 造失败对象 —— **不带 `stdout`**，
 * 那一份 stdout 在 `exec.ts` 里就被丢掉了（**不是**只丢在 runner）。所以这里对 `stdout` 的读取是
 * **防御性**的：执行器带了就取（注入的 fake / 将来 001 补上字段都受益），不带就为空字符串；
 * 真正的兜底是紧随其后的 **out 文件回落**（脚本 `Complete()` 把同一份 JSON 既写 out 文件、也写 stdout）。
 * 改 001 的失败模型不在本轮范围（005 只拥有 `elevate/**`）⇒ 见 tasks 的留痕。
 */
function failureStdout(outcome: unknown): string {
  const value = (outcome as { readonly stdout?: unknown }).stdout;
  return typeof value === 'string' ? value : '';
}

/**
 * 跑一次提权写（唯一的编排入口）。
 * **总是**返回结果对象（不抛）：宿主插件拿它直接进 UI；失败原因必须可区分（design §6）。
 */
export async function runElevate(request: ElevateRequest, deps: ElevationDeps): Promise<ElevateResult> {
  const plan = request.plan;
  const commandText = plan.commandText;
  const systemRoot = deps.systemRoot ?? process.env['SystemRoot'] ?? 'C:\\Windows';
  const policy: ElevationPolicy = resolvePolicy(request.policy, request.source);

  // ① `none`（默认策略）：SHALL NOT 执行任何需提权的操作（REQ-3.1）
  if (policy === 'none') {
    return emptyResult(
      'disabled',
      commandText,
      '提权策略为 none：不执行任何需要提权的操作（默认即最保守）',
      '在配置页把 elevationPolicy 改成 ask（每次确认）或 passby（自动发起，但仍受 UAC 闸门约束）后重试；控件此时应置灰并说明原因',
    );
  }

  // ② 没有动作 ⇒ 什么都不做（前置不满足时规划层给出的就是空步骤）
  if (plan.steps.length === 0) {
    return emptyResult('no-actions', commandText, '这次规划没有任何可执行步骤：不发起提权', '先解决规划层报出的前置问题');
  }

  // ③ `ask`（含 Agent 触发的 passby 降级）：先确认，且必须展示命令原文（REQ-3.2 / REQ-4.1）
  if (policy === 'ask') {
    const downgraded = request.policy === 'passby' && request.source === 'agent';
    const confirmRequest: ConfirmRequest = {
      action: plan.action,
      port: plan.port,
      commandText,
      steps: plan.steps,
      reason: downgraded ? 'agent-passby-downgraded' : 'policy-ask',
      message: downgraded
        ? 'Agent 触发的提权不会静默执行（REQ-4.1）：请确认下面将要执行的命令原文，确认后才会发起 UAC'
        : '将执行以下命令（需要提权）：确认后才发起 UAC',
    };
    const confirm = deps.confirm;
    const approved = confirm === undefined ? false : await confirm(confirmRequest);
    if (!approved) {
      return emptyResult(
        'declined',
        commandText,
        downgraded ? 'Agent 触发的提权确认被拒：未发起任何提权（零进程、零临时文件）' : '用户取消：未执行任何提权操作',
        '未做任何改动，也没有留下临时文件；需要时再发起一次',
      );
    }
  }

  // ④ 后端探测（只读；凭据缓存活跃 ⇒ 回落 native）
  const choice = await probeOf(deps, systemRoot);

  // ⑤ 执行前快照（REQ-1.5）：拿不到就不动手 —— 没有 before 就无法自证「只动了自己那一条」
  const snapshot = snapshotterOf(deps);
  const before = await snapshot();
  if (!before.ok) {
    return {
      ...emptyResult(
        'snapshot-failed',
        commandText,
        `执行前的实际集快照失败（${before.reason}）：${before.message}`,
        `${before.hint}；拿不到比对基准时不发起写操作（REQ-1.5 / C-3）`,
      ),
      backend: choice.backend,
    };
  }

  // ⑥ 临时文件与结构化参数（REQ-3.6 / REQ-3.7）
  const suffix = (deps.randomSuffix ?? defaultRandomSuffix)();
  const tempDir = deps.tempDir ?? tmpdir();
  const scriptPath = tempScriptPath(tempDir, suffix);
  const outPath = tempOutPath(tempDir, suffix);
  const call = scriptCallFor({ action: plan.action, scope: plan.scope });
  // 012：脚本的 listen 地址/删除地址/放行网段**从计划步骤里取**（步骤表是唯一的真相，
  // 不再由 `scope` 反推）：`add` 取 `portproxy-add`、`remove` 取 `portproxy-delete`、
  // `fix` 两者都有（删旧的、建新的）。都取不到 ⇒ 三个可选参数缺席 ⇒ argv 与 010 逐字相同。
  const scriptAddresses = scriptAddressesOf(plan.steps);
  const params: ScriptParams = {
    action: call.action,
    port: plan.port,
    address: plan.eth0Ip,
    scope: call.scope,
    scriptPath,
    outPath,
    ...scriptAddresses,
  };

  const write = deps.writeFile ?? ((path: string, content: string) => writeFile(path, content, 'utf8'));
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  const remove = deps.removeFile ?? ((path: string) => rm(path, { force: true }));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_ELEVATE_TIMEOUT_MS;

  // 参数校验在任何 IO 之前：不合法就连脚本都不生成（REQ-3.7）
  try {
    assertScriptParams(params);
  } catch (error) {
    const detail = error instanceof ElevateParamError ? `${error.field}=${error.value}` : messageOf(error);
    return {
      ...emptyResult(
        'failure',
        commandText,
        `提权参数校验未通过，拒绝生成脚本：${detail}`,
        '脚本只接受白名单动作 + 数字端口 + 已校验 IPv4（REQ-3.7）；修正调用方参数后重试',
      ),
      backend: choice.backend,
    };
  }

  const invocation = buildInvocation(choice, params, scriptArgs(params), systemRoot);
  let cleanup = { scriptRemoved: false, outRemoved: false };
  let exitCode: number | null = null;
  let stdout = '';
  let stderr = '';
  let payload: ElevatedPayload | null = null;
  let status: ElevateResult['status'] = 'failure';
  let message = '提权脚本没有执行（未知原因）';
  let hint = '展开原始输出核对';

  try {
    let written = false;
    try {
      await write(scriptPath, buildElevateScript());
      written = true;
    } catch (error) {
      message = `临时脚本写入失败：${messageOf(error)}`;
      hint = '检查临时目录权限/空间；未发起任何提权（零系统改动）';
    }

    if (written) {
      const outcome = await deps.executor(invocation.file, invocation.argv, {
        encoding: 'utf8',
        timeoutMs,
        env: { ...process.env } as Record<string, string>,
      });
      const failedCode = outcome.ok ? null : outcome.code;
      if (outcome.ok) {
        exitCode = outcome.exitCode;
        stdout = outcome.stdout;
        stderr = outcome.stderr;
      } else {
        exitCode = outcome.exitCode ?? null;
        stderr = outcome.stderr ?? '';
        // 🔴 真机缺陷 2（2026-10-12）：旧写法这里**只赋 exitCode/stderr**，`stdout` 恒空 ⇒
        // 「退出码非 0 但 stdout 有合法载荷」被 `looksLikeUacRejection` 判成「用户拒绝 UAC」。
        stdout = failureStdout(outcome);
      }

      // ⑦ 回传：**两条通道都读**，优先级按后端（gsudo 走 stdio；native/winsudo 走 out 文件），
      // 两个通道共用同一个解析器。旧写法只在「非 gsudo」时读 out 文件 ⇒ gsudo 一旦非零退出就成了
      // 「既没有 stdout（001 丢掉了）也没有 out（压根没读）」—— 真机缺陷 2 的另一半。
      let outText: string | null = null;
      try {
        outText = await read(outPath);
      } catch {
        outText = null;
      }
      const fromStdout = stdout.trim().length > 0 ? stdout : null;
      const parsed = parseElevatedOut(
        choice.backend === 'gsudo' ? (fromStdout ?? outText) : (outText ?? fromStdout),
      );
      // 回传原文：脚本只序列化一次，out 文件与 stdout **逐字同源** ⇒ 执行器丢掉了 stdout 时用
      // out 文件原文补上，免得日志/UI 出现「有载荷却 stdout 空」（NFR-1 的四项齐全里回传原文不是空串）
      if (stdout.trim().length === 0 && outText !== null && outText.trim().length > 0) stdout = outText;

      if (parsed.ok) {
        payload = parsed.payload;
        const mismatch = payloadPortMismatch(payload, plan.port);
        const classified = classifyExit(exitCode, payload);
        status = mismatch === null ? classified.status : 'failure';
        message = mismatch === null ? classified.message : `${classified.message}；${mismatch}`;
        hint = mismatch === null ? classified.hint : '回传可能来自另一次调用或陈旧的 out 文件：不采信';
      } else if (failedCode === 'Timeout') {
        // ⑧ 超时（REQ-3.5）：按失败处理；清理走 finally
        status = 'timeout';
        message = `提权进程在 ${String(timeoutMs)} ms 内没有返回：按失败处理（REQ-3.5）`;
        hint = 'UAC 弹窗等待由用户决定；临时文件已清理，规则要么没动、要么由脚本内部自行回滚';
      } else if (failedCode === 'CommandNotFound') {
        status = 'failure';
        message = `找不到提权可执行文件 ${invocation.file}：未执行任何提权`;
        hint = 'gsudo 可能被卸载/移动；把 elevationBackend 改为 native 可永久回落到 Start-Process -Verb RunAs';
      } else if (choice.backend === 'gsudo' && exitCode === ELEVATE_EXIT.elevationFailed) {
        const classified = classifyExit(exitCode, null);
        status = classified.status;
        message = classified.message;
        hint = classified.hint;
      } else if (looksLikeUacRejection(exitCode, stdout, stderr, false)) {
        status = 'cancelled';
        message = '已取消：用户拒绝了 UAC（脚本一次都没跑起来，退出码非 0 且没有任何回传）';
        hint = '什么都没执行 ⇒ 不做任何回滚（design §4 末行）；临时文件已清理';
      } else {
        status = parsed.reason === 'out-file-missing' ? 'out-file-missing' : 'out-file-unparsable';
        message = `${parsed.message}（退出码 ${String(exitCode)}）`;
        hint = '展开原始输出核对；半成品防护在脚本内部完成，主机侧不做任何回滚';
      }
    }
  } catch (error) {
    status = 'failure';
    message = `提权执行过程中出现意外错误：${messageOf(error)}`;
    hint = '未采信任何结果；临时文件已在 finally 里清理，请核对系统规则是否被改动';
  } finally {
    // ⑨ 三条路径（成功 / 失败 / 超时）都必须清理临时文件（NFR-2 / REQ-3.6）
    cleanup = {
      scriptRemoved: await safeRemove(remove, scriptPath),
      outRemoved: await safeRemove(remove, outPath),
    };
  }

  if (status === 'ok' && payload === null) {
    status = 'failure';
    message = '退出码为 0 但没有任何可解析的回传：按失败处理（没有证据的成功不采信）';
    hint = '核对 out 文件与 stdout';
  }

  // ⑩ 执行后快照 + 四项齐全的任务日志（REQ-1.5 / NFR-1）
  const after = await snapshot();
  let log: WriteLogEntry | null = null;
  if (after.ok) {
    log = createWriteLogEntry({
      action: plan.action,
      port: plan.port,
      before: before.rules,
      after: after.rules,
      exitCode,
      stdout: stdout.length > 0 ? stdout : payload === null ? '' : JSON.stringify(payload),
    });
    const others = compareOthers(before.rules, after.rules, plan.port);
    if (status === 'ok' && !others.othersUnchanged) {
      status = 'failure';
      message = `执行成功但他人规则发生了变化（前 ${String(others.beforeOthers)} 条 / 后 ${String(others.afterOthers)} 条）：违反 C-3 红线，按失败上报`;
      hint = `差异：${others.othersDiff.join('，')}；请立即核对 netsh interface portproxy show v4tov4`;
    }
  } else {
    status = 'snapshot-failed';
    message = `写操作已下发（退出码 ${String(exitCode)}），但执行后的实际集快照失败（${after.reason}）：无法自证「只动了自己那一条」（REQ-1.5）`;
    hint = `${after.hint}；请手工核对 netsh interface portproxy show v4tov4`;
  }

  const steps: readonly StepReport[] = payload?.steps ?? [];
  return {
    status,
    exitCode,
    stdout,
    stderr,
    steps,
    argv: [invocation.file, ...invocation.argv],
    backend: choice.backend,
    commandText,
    message,
    hint,
    cleanup,
    log,
  };
}

/** 供测试与日志：`randomBytes` 的显式暴露（生产默认值与注入点同源，避免两套随机实现） */
export const cryptoRandomSuffix = (): string => randomBytes(6).toString('hex');

/** 生产默认依赖（宿主插件组装时用；测试一律注入 fake） */
export function defaultElevationDeps(executor: Executor): ElevationDeps {
  return { executor, snapshot: createPortproxySnapshotter(executor) };
}
