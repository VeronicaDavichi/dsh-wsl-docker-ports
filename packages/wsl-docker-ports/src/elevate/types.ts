/**
 * 提权辅助进程的类型契约（005 REQ-3 / REQ-4，design §4）
 *
 * ## 契约的四个不可协商点
 *
 * 1. **只吃结构化参数**（REQ-3.7）：脚本动作只有 `add|remove|fix` 三个白名单值，
 *    端口是数字、地址是已校验的 IPv4、作用域是 `loopback|lan` —— 没有任何字段承载「命令文本」。
 * 2. **退出码是判别式**（design §4）：`0` 全成 / `2` 部分失败 / `3` 前置不满足 / `1` 异常，
 *    外加 `gsudo` 的 `999` = 提权失败（REQ-3.4）。**没有「0 以外的成功」**。
 * 3. **三条清理路径**（REQ-3.5/3.6 / NFR-2）：成功、失败、超时都要删 `.ps1` 与 out 文件；
 *    结果里带 `cleanup` 两个布尔位，让「有没有留下半成品」可断言而不是靠相信。
 * 4. **零进程副作用可注入**（REQ-3.4 的反面）：一切外部调用都经 001 的 `Executor`，
 *    测试注入 fake ⇒ 一个真实进程都不起（不点 UAC、不冷启动 WSL）。
 */

import type { Executor } from 'dsh-wsl-shared';

import type { WriteLogEntry } from '../write/log.ts';
import type { PortproxySnapshotter } from '../write/snapshot.ts';
import type { WriteAction, WriteStep } from '../write/types.ts';

/** 提权策略（REQ-3.1/3.2/3.3，**默认 `none`**） */
export type ElevationPolicy = 'none' | 'ask' | 'passby';

/** 调用来源（REQ-4.1：Agent 触发在 `passby` 下**降级为 `ask`**） */
export type RequestSource = 'user' | 'agent';

/** 提权后端（REQ-3.4 / A-3） */
export type ElevationBackend = 'gsudo' | 'native' | 'winsudo';

/** 提权脚本的**白名单**动作（design §4 的参数列；不含任何其它动词） */
export type ScriptAction = 'add' | 'remove' | 'fix';

/** 脚本参数（结构化；`script.ts` 会逐字段校验，任一不合法直接拒） */
export interface ScriptParams {
  readonly action: ScriptAction;
  readonly port: number;
  readonly address: string;
  readonly scope: 'loopback' | 'lan';
  readonly scriptPath: string;
  readonly outPath: string;
}

/** 后端探测结果（探测**不产生任何提权**：只跑 `where.exe gsudo` 与 `gsudo status`） */
export interface BackendChoice {
  readonly backend: ElevationBackend;
  /** `gsudo` 的可执行文件路径（`where.exe gsudo` 的第一条命中）；未装为 `null` */
  readonly gsudoPath: string | null;
  /** `gsudo status` 显示凭据缓存活跃（⇒ REQ-3.4 回落 native） */
  readonly cacheActive: boolean;
  /** 给人看的说明（进日志/UI，解释为什么选了这个后端） */
  readonly note: string;
}

/** 脚本内的单步结果（design §4 的 out JSON 的 `steps`） */
export interface StepReport {
  readonly name: string;
  readonly ok: boolean;
  readonly stderr: string;
}

/** out 文件 / gsudo stdout 里的 JSON（design §4 的输出文件契约） */
export interface ElevatedPayload {
  readonly ok: boolean;
  readonly action: string;
  readonly port: number;
  readonly steps: readonly StepReport[];
  readonly beforeRules: readonly unknown[];
  readonly afterRules: readonly unknown[];
}

/** 主机侧最终状态（退出码表的落地形态 + 主机自己判出来的几种） */
export type ElevateStatus =
  | 'ok'
  | 'partial'
  | 'precondition'
  | 'failure'
  | 'elevation-failed'
  | 'cancelled'
  | 'timeout'
  | 'declined'
  | 'disabled'
  | 'no-actions'
  | 'snapshot-failed'
  | 'out-file-missing'
  | 'out-file-unparsable';

/** 结果（**总是**返回，不抛：宿主插件拿它直接进 UI） */
export interface ElevateResult {
  readonly status: ElevateStatus;
  /** 退出码；`null` = 没跑起来（`none` / 拒绝 / 超时 / 快照失败 / 零步骤） */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** 提权脚本内的步骤（`ok:false` 时 UI 逐条展示，design §4） */
  readonly steps: readonly StepReport[];
  /** 实际下发的完整 argv（含可执行文件名），供 UI 展示「执行了什么」 */
  readonly argv: readonly string[];
  readonly backend: ElevationBackend | null;
  /** 将执行的命令原文（REQ-3.2：`ask` 必须先展示它） */
  readonly commandText: string;
  readonly message: string;
  readonly hint: string;
  /** 临时文件清理结果（REQ-3.6 / NFR-2：三条路径都必须是 true） */
  readonly cleanup: { readonly scriptRemoved: boolean; readonly outRemoved: boolean };
  /** 任务日志（NFR-1 四项齐全）；没执行时为 `null` */
  readonly log: WriteLogEntry | null;
}

/** `ask` 的确认请求（REQ-3.2 / REQ-4.1：**必须**含命令原文） */
export interface ConfirmRequest {
  readonly action: WriteAction;
  readonly port: number;
  readonly commandText: string;
  readonly steps: readonly WriteStep[];
  /** 为什么需要确认（`ask` 策略 / Agent 触发被降级） */
  readonly reason: 'policy-ask' | 'agent-passby-downgraded';
  /** 人类可读的说明（含原因与不可绕过 UAC 的提示） */
  readonly message: string;
}

/** 一次提权写的请求 */
export interface ElevateRequest {
  readonly plan: {
    readonly ok: true;
    readonly action: WriteAction;
    readonly port: number;
    readonly scope: 'loopback' | 'lan';
    readonly eth0Ip: string;
    readonly steps: readonly WriteStep[];
    readonly commandText: string;
  };
  readonly policy: ElevationPolicy;
  readonly source: RequestSource;
}

/** 依赖面（全部可注入 ⇒ 离线测试零真实进程、零真实文件） */
export interface ElevationDeps {
  readonly executor: Executor;
  /** 前后快照（默认 = 003 的 netsh 只读探针包一层；见 `write/snapshot.ts`） */
  readonly snapshot?: PortproxySnapshotter;
  /** 后端探测（默认 = `detectBackend`，只跑 where.exe gsudo + gsudo status） */
  readonly probeBackend?: () => Promise<BackendChoice>;
  /** `ask` 确认；不注入时按**拒绝**处理（保守：没有确认通道就不提权） */
  readonly confirm?: (request: ConfirmRequest) => Promise<boolean>;
  readonly writeFile?: (path: string, content: string) => Promise<void>;
  readonly readFile?: (path: string) => Promise<string>;
  readonly removeFile?: (path: string) => Promise<void>;
  /** 临时目录（默认 `os.tmpdir()`） */
  readonly tempDir?: string;
  /** 随机段（默认 `crypto.randomBytes(6).toString('hex')`；测试注入定值） */
  readonly randomSuffix?: () => string;
  /** 超时（默认 90s，design §4；UAC 弹窗等待由用户决定） */
  readonly timeoutMs?: number;
  /** 显式配置的后端（`auto` = 探测链 `gsudo → native`） */
  readonly configuredBackend?: ElevationBackend | 'auto';
  /** Windows 目录（判定「系统自带 sudo」的路径依据；默认取 `SystemRoot`） */
  readonly systemRoot?: string;
}
