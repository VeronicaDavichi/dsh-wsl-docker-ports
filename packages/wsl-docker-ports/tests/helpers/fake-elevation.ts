/**
 * 提权路径的离线测试底座（005 Phase 2）
 *
 * ## 只补两样 fake，执行器**复用** 003 的
 *
 * 「谁被调了、调了几次、argv 是什么」全部由 `tests/helpers/fake-executor.ts` 的
 * `createFakeExecutor` 提供（**不另造一套假执行器** —— 那会让两套记录的语义慢慢分叉）。
 * 本文件只补它没有的两样：
 *
 * - **内存文件表**：`.ps1` 与 out 文件的写入 / 读取 / 删除（提权路径要验三条清理路径，
 *   必须能断言「删了哪些路径、有没有残留」）；
 * - **可编程快照**：`before` / `after` 两次 `netsh` 实际集（提权前后各一次，REQ-1.5）。
 *
 * 外加一个 `events` 序列，用来断言**顺序**（T2.5：Agent 触发必须「先确认、后才可能提权」）。
 */

import type { ErrorCode, ExecResult, WslSharedError } from 'dsh-wsl-shared';

import { singlePort } from '../../src/diff/managed-ports.ts';
import type {
  BackendChoice,
  ConfirmRequest,
  ElevateRequest,
  ElevationDeps,
  ElevationPolicy,
  RequestSource,
} from '../../src/elevate/types.ts';
import type { SnapshotOutcome } from '../../src/write/snapshot.ts';
import { buildWritePlan } from '../../src/write/plan.ts';
import type { WritePlan } from '../../src/write/types.ts';
import { createFakeExecutor, type RecordedCall } from './fake-executor.ts';
import { expectPlan } from './expect-plan.ts';
import { ETH0 } from './factories.ts';

/** 与 harness 默认值一致的临时产物路径（用例里直接拿去断言） */
export const STUB_SUFFIX = 'abcdef012345';
export const STUB_TEMP_DIR = 'C:\\Temp';
export const STUB_SCRIPT_PATH = `${STUB_TEMP_DIR}\\dsh-ppp-${STUB_SUFFIX}.ps1`;
export const STUB_OUT_PATH = `${STUB_TEMP_DIR}\\dsh-ppp-${STUB_SUFFIX}-out.json`;

/**
 * 造一个**真实规划**（走 002/003 那套闸门）：用例不手搓 plan 对象，免得测试与规划层漂移。
 * 默认 `lan` + `localhostForwarding=false` ⇒ 两步（portproxy-add + firewall-add），非空步骤。
 */
export function planForPort(port = 5000, scope: 'loopback' | 'lan' = 'lan'): WritePlan {
  return expectPlan(
    buildWritePlan({
      action: 'add',
      port,
      scope,
      managedPorts: [singlePort(port)],
      eth0Ip: ETH0,
      rules: [],
      localhostForwarding: false,
    }),
  );
}

/** 造一次提权请求 */
export function elevationRequest(
  policy: ElevationPolicy,
  source: RequestSource,
  plan: WritePlan = planForPort(),
): ElevateRequest {
  return { plan, policy, source };
}

export type Responder = (call: RecordedCall, index: number) => ExecResult | WslSharedError;

export interface FakeFs {
  readonly files: Map<string, string>;
  /** 写入时的内容留档（**删除后仍可查**）：清理路径会把 `files` 里的条目删掉 */
  readonly contents: Map<string, string>;
  readonly writes: string[];
  readonly removes: string[];
  readonly writeFile: (path: string, content: string) => Promise<void>;
  readonly readFile: (path: string) => Promise<string>;
  readonly removeFile: (path: string) => Promise<void>;
}

export function createFakeFs(initial: Record<string, string> = {}): FakeFs {
  const files = new Map<string, string>(Object.entries(initial));
  const contents = new Map<string, string>(Object.entries(initial));
  const writes: string[] = [];
  const removes: string[] = [];
  return {
    files,
    contents,
    writes,
    removes,
    writeFile: async (path, content) => {
      files.set(path, content);
      contents.set(path, content);
      writes.push(path);
    },
    readFile: async (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    removeFile: async (path) => {
      files.delete(path);
      removes.push(path);
    },
  };
}

/** 从 argv 里取 `-Out` 的值（native 的 `-Command` 载荷里也含 `-Out', '<path>'`） */
export function findOutPath(call: RecordedCall): string | null {
  const direct = call.argv.indexOf('-Out');
  const next = direct >= 0 ? call.argv[direct + 1] : undefined;
  if (next !== undefined) return next;
  const joined = call.argv.join(' ');
  const match = /-Out['"]?,\s*['"]([^'"]+)['"]/.exec(joined);
  return match?.[1] ?? null;
}

export interface RespondOptions {
  /** 提权脚本写的 out JSON（`null` = 不写文件，模拟「脚本没跑起来」） */
  readonly payload?: unknown;
  /** 非 0 ⇒ 以 001 的 `NonZeroExit` 形态返回（`ExecResult` 的 exitCode 只能是 0） */
  readonly exitCode?: number;
  readonly code?: ErrorCode;
  readonly stdout?: string;
  readonly stderr?: string;
  /** 是否把 payload 写进 out 文件（默认写；`false` 模拟 native 下 UAC 被拒） */
  readonly writeOutFile?: boolean;
}

/**
 * 造一个「提权子进程」应答：把 payload 写进 out 文件（若给），并按 `exitCode` 决定返回成功还是失败。
 * 非 0 退出码必须走 `WslSharedError` —— 001 的 `ExecResult.exitCode` 字面量就是 `0`。
 */
export function respondWith(fs: FakeFs, options: RespondOptions = {}): Responder {
  return (call) => {
    const outPath = findOutPath(call);
    const text = options.payload === undefined ? '' : JSON.stringify(options.payload);
    if (options.payload !== undefined && options.writeOutFile !== false && outPath !== null) {
      fs.files.set(outPath, text);
    }
    const stderr = options.stderr ?? '';
    const exitCode = options.exitCode ?? 0;
    if (exitCode !== 0) {
      return {
        ok: false,
        code: options.code ?? 'NonZeroExit',
        message: `stub:exit-${String(exitCode)}`,
        exitCode,
        stderr,
      };
    }
    return { ok: true, exitCode: 0, stdout: options.stdout ?? text, stderr };
  };
}

/** 造一个提权脚本的成功回传（steps 全 ok） */
export function okPayload(
  port: number,
  action = 'add',
  steps: readonly { name: string; ok: boolean; stderr?: string }[] = [{ name: 'portproxy-add', ok: true }],
): unknown {
  return {
    ok: true,
    action,
    port,
    steps: steps.map((step) => ({ name: step.name, ok: step.ok, stderr: step.stderr ?? '' })),
    beforeRules: [],
    afterRules: [],
  };
}

/** 造一个部分失败的回传（退出码 2 的典型形态） */
export function partialPayload(port: number, failedStep: string, reason: string): unknown {
  return {
    ok: false,
    action: 'add',
    port,
    steps: [
      { name: 'portproxy-add', ok: true, stderr: '' },
      { name: failedStep, ok: false, stderr: reason },
    ],
    beforeRules: [],
    afterRules: [],
  };
}

export const NATIVE_CHOICE: BackendChoice = {
  backend: 'native',
  gsudoPath: null,
  cacheActive: false,
  note: 'stub:native',
};

export const GSUDO_CHOICE: BackendChoice = {
  backend: 'gsudo',
  gsudoPath: 'D:\\Program Files\\gsudo\\Current\\gsudo.exe',
  cacheActive: false,
  note: 'stub:gsudo',
};

export interface HarnessOptions {
  readonly respond?: Responder;
  /** 与 `respond` 二选一：用**本 harness 自己的**内存文件表构造应答（推荐，native 靠 out 文件回传） */
  readonly respondWith?: RespondOptions;
  readonly before?: SnapshotOutcome;
  readonly after?: SnapshotOutcome;
  /** `false` = 用户在应用内点了「取消」；不传 = 注入一个总是同意的确认通道 */
  readonly confirm?: boolean;
  readonly confirmAbsent?: boolean;
  readonly probe?: BackendChoice;
  readonly tempDir?: string;
  readonly suffix?: string;
  readonly systemRoot?: string;
  readonly configuredBackend?: 'auto' | 'native' | 'gsudo' | 'winsudo';
  readonly timeoutMs?: number;
}

export interface ElevateHarness {
  readonly fake: ReturnType<typeof createFakeExecutor>;
  readonly fs: FakeFs;
  /** 事件顺序（`confirm` / `snapshot` / `exec`）—— T2.5 的「先确认」就靠它 */
  readonly events: string[];
  readonly confirmCalls: ConfirmRequest[];
  readonly deps: ElevationDeps;
  snapshotCount: () => number;
}

const OK_SNAPSHOT: SnapshotOutcome = { ok: true, rules: [], argv: ['netsh.exe'] };

/** 组装一套可注入的提权依赖（默认：native 后端、成功回传、确认通道总是同意） */
export function createElevateHarness(options: HarnessOptions = {}): ElevateHarness {
  const fs = createFakeFs();
  const events: string[] = [];
  const confirmCalls: ConfirmRequest[] = [];
  const respond =
    options.respond ?? respondWith(fs, options.respondWith ?? { payload: okPayload(5000) });
  const fake = createFakeExecutor((call, index) => {
    events.push('exec');
    return respond(call, index);
  });

  let snapshots = 0;
  const deps: ElevationDeps = {
    executor: fake.executor,
    snapshot: async () => {
      events.push('snapshot');
      snapshots += 1;
      return snapshots === 1 ? (options.before ?? OK_SNAPSHOT) : (options.after ?? options.before ?? OK_SNAPSHOT);
    },
    probeBackend: async () => options.probe ?? NATIVE_CHOICE,
    ...(options.confirmAbsent === true
      ? {}
      : {
          confirm: async (request: ConfirmRequest) => {
            events.push('confirm');
            confirmCalls.push(request);
            return options.confirm ?? true;
          },
        }),
    writeFile: fs.writeFile,
    readFile: fs.readFile,
    removeFile: fs.removeFile,
    tempDir: options.tempDir ?? 'C:\\Temp',
    randomSuffix: () => options.suffix ?? 'abcdef012345',
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    systemRoot: options.systemRoot ?? 'C:\\Windows',
    ...(options.configuredBackend === undefined ? {} : { configuredBackend: options.configuredBackend }),
  };

  return { fake, fs, events, confirmCalls, deps, snapshotCount: () => snapshots };
}
