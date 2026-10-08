/**
 * `dsh-wsl-shared` 公开面（**预算：运行时导出 ≤ 12**，由 `scripts/check-exports.mjs` 自检）。
 *
 * 本包是**非插件包**：无 `cordis.patch.yml`、无配置页、无 PTY、不注册任何宿主能力。
 * 消费者：`dsh-terminal-profiles`（002/004）与 `dsh-wsl-docker-ports`（003/005）。
 *
 * 预算口径（T0.2 的澄清，见 `check-exports.mjs` 头部）：**类型导出不计入运行时预算**
 * —— 类型在运行时被完全擦除，既不能 import 也不进 bundle，REQ-6.4 的意图是
 * 「公开面不得退化成杂物袋」，约束的对象是**可调用的运行时面**。脚本两个数都打印，
 * 总量另有软阈值，仍能看到膨胀。
 *
 * 已完成：Phase 0（T0.1/T0.2）发行版表解析 · Phase 1（T1.1–T1.5）错误模型与执行器 ·
 * Phase 2（T2.1–T2.4）发行版发现与目标解析 · Phase 3（T3.1–T3.3）eth0 探测。
 * 未完成：路径翻译 / NAT 判定（T4.x–T5.x）。
 */

export { createExecutor } from './exec.ts';
export type { ExecOptions, ExecResult, Executor } from './exec.ts';

export { listDistros, resolveDistro } from './distros.ts';
export type {
  DistroResolution,
  DistroSource,
  WslDistro,
  WslDistroState,
  WslVersion,
} from './distros.ts';

export { probeEth0 } from './net.ts';
export type { Eth0Outcome } from './net.ts';

export type { ErrorCode, WslSharedError } from './errors.ts';
