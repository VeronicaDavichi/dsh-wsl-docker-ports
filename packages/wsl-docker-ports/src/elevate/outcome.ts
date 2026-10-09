/**
 * 退出码表与回传解析（005 T2.2 / REQ-3.4 / REQ-3.5 / design §4）
 *
 * ## 退出码是**判别式**，不是「非零即失败」
 *
 * | code | 含义 | 主机侧结论 |
 * |---|---|---|
 * | `0` | 全成 | `ok` |
 * | `2` | 部分失败（有 steps 失败）| `partial`：**逐条展示 steps**，不静默 |
 * | `3` | 前置不满足（未取得管理员 / NAT / 服务）| `precondition` |
 * | `1` | 异常 | `failure` |
 * | `999` | **gsudo 提权失败**（REQ-3.4 官方口径）| `elevation-failed` |
 *
 * 「用户拒绝 UAC」不会走到这里 —— 那时脚本**一次都没跑起来**（`Start-Process` 抛错 /
 * gsudo 返回 999），主机侧判 `cancelled` 或 `elevation-failed`，且**不做任何回滚**
 * （因为什么都没执行，design §4 末行）。
 *
 * ## 两条回传通道，同一个解析器
 *
 * 脚本把同一份 JSON **既写 out 文件、也写 stdout**（`script.ts` 的 `Complete`）：
 * gsudo 走 stdio（REQ-3.4 ①），native 走临时文件（完整性级别不同，管道回读不可行）。
 * 解析器因此要容忍 gsudo 可能夹带的其它输出 —— 从**最后一行往前**找第一个能解析成
 * 「带 `port` 与 `steps` 的对象」的 JSON。
 */

import type { ElevateStatus, ElevatedPayload, StepReport } from './types.ts';

export const ELEVATE_EXIT = {
  ok: 0,
  exception: 1,
  partial: 2,
  precondition: 3,
  /** gsudo 的提权失败（REQ-3.4） */
  elevationFailed: 999,
} as const;

export interface OutParseSuccess {
  readonly ok: true;
  readonly payload: ElevatedPayload;
}

export interface OutParseFailure {
  readonly ok: false;
  readonly reason: 'out-file-missing' | 'out-file-unparsable';
  readonly message: string;
  readonly raw: string;
}

function asSteps(value: unknown): StepReport[] {
  if (!Array.isArray(value)) return [];
  const steps: StepReport[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    steps.push({
      name: typeof record['name'] === 'string' ? record['name'] : '(未命名步骤)',
      ok: record['ok'] === true,
      stderr: typeof record['stderr'] === 'string' ? record['stderr'] : '',
    });
  }
  return steps;
}

function asPayload(value: unknown): ElevatedPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record['steps']) || typeof record['port'] !== 'number') return null;
  return {
    ok: record['ok'] === true,
    action: typeof record['action'] === 'string' ? record['action'] : '',
    port: record['port'],
    steps: asSteps(record['steps']),
    beforeRules: Array.isArray(record['beforeRules']) ? record['beforeRules'] : [],
    afterRules: Array.isArray(record['afterRules']) ? record['afterRules'] : [],
  };
}

/**
 * 解析回传（out 文件原文 / gsudo 的 stdout）。`null` 表示**文件读不到**（native 后端下
 * 最常见的失败：脚本没跑完 / 被 UAC 拒了），与「读到了但不是 JSON」是两种事实。
 */
export function parseElevatedOut(text: string | null): OutParseSuccess | OutParseFailure {
  if (text === null) {
    return {
      ok: false,
      reason: 'out-file-missing',
      message: '没有拿到提权脚本的回传（out 文件读不到，且 stdout 没有 JSON）',
      raw: '',
    };
  }

  const candidates: string[] = [text.trim()];
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? '').trim().replace(/^\uFEFF/, '');
    if (line.startsWith('{')) candidates.push(line);
  }

  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const payload = asPayload(parsed);
    if (payload !== null) return { ok: true, payload };
  }

  return {
    ok: false,
    reason: 'out-file-unparsable',
    message: '回传内容不是可识别的结果 JSON（缺 steps / port 字段）',
    raw: text,
  };
}

export interface ExitClassification {
  readonly status: ElevateStatus;
  readonly message: string;
  readonly hint: string;
}

/**
 * 退出码 → 主机侧状态（design §4 的表 + REQ-3.4 的 999）。
 * `exitCode === null` 表示**根本没跑起来**（拒绝 UAC / 超时由调用方另判），一律按 `failure` 报，
 * 但文案说清是「没有退出码」而不是「退出码是 1」。
 */
export function classifyExit(
  exitCode: number | null,
  payload: ElevatedPayload | null,
): ExitClassification {
  const failedSteps = (payload?.steps ?? []).filter((step) => !step.ok);

  switch (exitCode) {
    case ELEVATE_EXIT.ok:
      if (payload !== null && !payload.ok) {
        return {
          status: 'failure',
          message: '退出码为 0，但回传 JSON 标记 ok=false：以回传为准按失败处理（不自欺）',
          hint: '展开 steps 看脚本内部到底哪一步失败',
        };
      }
      return { status: 'ok', message: '提权脚本执行成功（退出码 0）', hint: '' };
    case ELEVATE_EXIT.partial:
      return {
        status: 'partial',
        message: `部分失败（退出码 2）：${String(failedSteps.length)} 个步骤失败`,
        hint:
          failedSteps.length > 0
            ? `失败步骤：${failedSteps.map((step) => `${step.name}${step.stderr.length > 0 ? `（${step.stderr}）` : ''}`).join('；')}`
            : '展开 steps 逐条核对',
      };
    case ELEVATE_EXIT.precondition:
      return {
        status: 'precondition',
        message: '前置不满足（退出码 3）：未取得管理员权限 / NAT 前提不成立',
        hint: '确认 UAC 已通过；NAT 网络模式的要求见组件②的硬前提',
      };
    case ELEVATE_EXIT.exception:
      return {
        status: 'failure',
        message: '脚本异常（退出码 1）',
        hint: '展开原始输出看首行异常信息',
      };
    case ELEVATE_EXIT.elevationFailed:
      return {
        status: 'elevation-failed',
        message: '提权失败（gsudo 退出码 999）：用户拒绝 UAC 或凭据不可用',
        hint: '本插件不做任何回滚（什么都没执行）；可重试或改用 elevationBackend: native',
      };
    case null:
      return {
        status: 'failure',
        message: '没有拿到退出码：脚本没有跑起来',
        hint: '常见原因是 UAC 被拒（见 cancelled 分支）或临时文件写不进去',
      };
    default:
      return {
        status: 'failure',
        message: `未知退出码 ${String(exitCode)}：按失败处理（没有「非 0 的成功」）`,
        hint: '展开原始输出；若要新增退出码语义，先改 design §4 的表',
      };
  }
}

/** 回传里的 `steps` 是否可展示（`ok:false` 时 UI 必须能逐条列出来，T2.2） */
export function displayableSteps(payload: ElevatedPayload | null): readonly StepReport[] {
  return payload?.steps ?? [];
}

/** 回传声明的端口与请求端口不一致 → 返回说明（防御性：回传可能来自别的调用/陈旧文件） */
export function payloadPortMismatch(payload: ElevatedPayload | null, expectedPort: number): string | null {
  if (payload === null) return null;
  if (payload.port === expectedPort) return null;
  return `回传 JSON 声明的端口是 ${String(payload.port)}，与请求的 ${String(expectedPort)} 不一致`;
}
