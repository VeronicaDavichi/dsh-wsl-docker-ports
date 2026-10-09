/**
 * `cwdLinux` 推导（002 REQ-1.4 / 任务 T1.2）
 *
 * 这里是 **001（`dsh-wsl-shared`）在本包的唯一消费点**：REQ-1.4 明写「经 **006** 的路径翻译推导」，
 * 所以本文件**只做接线**，绝不自己写一套路径翻译（`E:\x` ↔ `/mnt/e/x` 的形态判定、UNC、
 * 盘符相对、保留字符、控制字符可见化……全部是 001 的真实语义，重写一遍必然与它漂移）。
 *
 * 纯函数：不 stat、不解析符号链接、不读文件、不碰 WSL（001 REQ-3.7 + 本 Spec 的「不许真机」红线）。
 */

import { winToWsl } from 'dsh-wsl-shared';
import type { WslSharedError } from 'dsh-wsl-shared';

/**
 * 推导结果：成功给 Linux 侧路径；失败**原样带回 001 的 typed error**。
 * 不新造错误码 —— `needsFix` 要能一路追溯到 001 的 `ErrorCode`（UI 分类与 001 的
 * `ERROR_HINTS` 都按那套码走），否则同一件事会有两套讲法。
 */
export type CwdLinuxDerivation =
  | { readonly ok: true; readonly cwdLinux: string }
  | { readonly ok: false; readonly error: WslSharedError };

/**
 * `E:\proj` → `/mnt/e/proj`；`\\wsl.localhost\Ubuntu2204\home\u` → `/home/u`。
 *
 * ⚠️ 注意 001 的**错误语义**（不要在这里「补救」）：
 * - 无盘符的 Windows 根（`\Windows`）、相对路径、`\\server\share`、保留字符 ⇒ `UnmappablePath`；
 * - 它**不读文件系统** ⇒ 翻得出来不等于路径真实存在；「存在性」是 REQ-3.3 在启动期的事，
 *   不是配置解析期的事（Phase 1 不该起进程去 stat）。
 */
export function deriveCwdLinux(cwd: string): CwdLinuxDerivation {
  const mapped = winToWsl(cwd);
  return mapped.ok ? { ok: true, cwdLinux: mapped.path } : { ok: false, error: mapped };
}
