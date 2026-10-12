/**
 * 类型化错误模型（001 REQ-5.6 / 任务 T1.1）
 *
 * 口径：本包**不向调用方抛异常**。所有失败都是一个带 `ok: false` 的**返回值**
 * （`WslSharedError`），与成功态（`ExecResult` 的 `ok: true`）构成判别联合。
 * 理由：消费方是宿主插件，错误要能直接进 UI（展示 code / message / 可用发行版列表），
 * 而不是让调用方 try/catch 之后猜类型；同时「命令失败」与「没有发行版」必须是两种事实
 * （REQ-1.6），所以它们分别是 error 与 `[]`。
 */

/** 全部错误码（判别联合的判别式） */
export type ErrorCode =
  | 'CommandNotFound'
  | 'NonZeroExit'
  | 'Timeout'
  | 'DistroNotFound'
  | 'DistroNotRunning'
  | 'NoDistro'
  | 'NoInterface'
  | 'UnmappablePath'
  | 'NoWindowsEquivalent'
  | 'ConfigUnreadable'
  | 'Unexpected';

/** 运行时错误码清单（自检用；`ErrorCode` 的 `Record` 覆盖保证不漏项） */
export const ERROR_CODES = [
  'CommandNotFound',
  'NonZeroExit',
  'Timeout',
  'DistroNotFound',
  'DistroNotRunning',
  'NoDistro',
  'NoInterface',
  'UnmappablePath',
  'NoWindowsEquivalent',
  'ConfigUnreadable',
  'Unexpected',
] as const satisfies readonly ErrorCode[];

/** 每个 code 的推荐消费方动作（设计 §2 的表；UI 文案的依据） */
export const ERROR_HINTS: Readonly<Record<ErrorCode, string>> = {
  CommandNotFound: '提示「未安装 WSL」并给修复步骤',
  NonZeroExit: '原样展示 stderr',
  Timeout: '提示重试 / 检查发行版是否卡住',
  DistroNotFound: '展示 distros 可用列表',
  DistroNotRunning: '询问用户是否启动，不自动启动',
  NoDistro: '提示「尚未安装任何发行版」并给安装指引',
  NoInterface: '显示「无法确定 WSL 地址」+ 建议 wsl --shutdown 后重试',
  UnmappablePath: '表单字段报错，不落库',
  NoWindowsEquivalent: '表单字段报错，不落库',
  ConfigUnreadable: '不得当作缺省 NAT；显示路径与原因',
  Unexpected: '展示 message + 日志',
};

/**
 * 所有失败的唯一出口。
 * `message` 是**给人看的**（可直接进 UI 文案）；结构化信息放可选字段。
 */
export interface WslSharedError {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly message: string;
  /** 被杀/失败的命令（argv 数组，进错误对象前已确保不含凭据） */
  readonly argv?: readonly string[];
  readonly exitCode?: number;
  readonly stderr?: string;
  /**
   * 非零退出（`NonZeroExit`）时的**原始 stdout**（按调用方声明编码解码后的原文）。
   *
   * 🔴 2026-10-12 跨 Spec 欠账修复：此前失败路径**只有 `stderr`**，「退出码非 0 但 stdout 带合法载荷」
   * 的形态（005 的提权脚本把同一份 JSON 既写 out 文件、也写 stdout）在执行器层就被丢掉 ⇒ 005 只能
   * 靠 out 文件兜底。字段**可选**且只在有值时出现 ⇒ 对既有消费方向后兼容（成功态 `ExecResult` 一字未改）。
   */
  readonly stdout?: string;
  /** 与文件相关的失败（`.wslconfig` 等）带上完整路径 */
  readonly path?: string;
  /** `DistroNotFound` 时列出可用发行版名 */
  readonly distros?: readonly string[];
}

/** `fail()` 的可选附加字段 */
export interface FailureExtra {
  readonly argv?: readonly string[];
  readonly exitCode?: number;
  readonly stderr?: string;
  /** 见 `WslSharedError.stdout`（非零退出的原始回传） */
  readonly stdout?: string;
  readonly path?: string;
  readonly distros?: readonly string[];
}

/**
 * 唯一的错误工厂（T1.1）。**任何** code 都走这里，避免各处手搓对象导致字段漂移。
 * 未提供的可选字段**不会**出现在结果里（不伪造 `undefined`）——
 * 下游据此区分「没有这个信息」与「值就是空」。
 */
export function fail(code: ErrorCode, message: string, extra: FailureExtra = {}): WslSharedError {
  return {
    ok: false,
    code,
    message,
    ...(extra.argv === undefined ? {} : { argv: extra.argv }),
    ...(extra.exitCode === undefined ? {} : { exitCode: extra.exitCode }),
    ...(extra.stderr === undefined ? {} : { stderr: extra.stderr }),
    ...(extra.stdout === undefined ? {} : { stdout: extra.stdout }),
    ...(extra.path === undefined ? {} : { path: extra.path }),
    ...(extra.distros === undefined ? {} : { distros: extra.distros }),
  };
}

/** 判别守卫：把 `{ ok: boolean }` 收窄成 `WslSharedError` */
export function isWslFailure(value: { readonly ok: boolean }): value is WslSharedError {
  return !value.ok;
}
