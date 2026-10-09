/**
 * profile → `spawnTerminal` spec 的**唯一**构造点（002 REQ-3.1 / REQ-3.2 / REQ-3.3 / 任务 T2.1–T2.2）
 *
 * 这一层的职责：把「用户配置」翻译成「宿主能接受且**无歧义**的启动请求」，并在翻译不出来时
 * 给出**带路径**的拒绝。三条硬约束（design §11）都在这里兑现：
 *
 * ① `cwd` **必须显式**：`cwd: undefined` 会静默落到宿主进程 cwd（node-pty 不校验）⇒ 本函数返回的
 *    spec 里 `cwd` 是 `string`（非可选），拿不到就**拒绝**（REQ-3.3：SHALL NOT 回落到工作区/`$HOME`）。
 * ② WSL profile（`command` 是 `wsl.exe`）的 cwd 取 **`cwdLinux`**（REQ-3.2）—— 宿主与 Linux 的路径
 *    语义不同，不得混用；只填了 `cwd` 时经 **001** 的 `winToWsl` 推导，推导失败即拒绝。
 * ③ **不传 `shellActivity`**：Windows 上它是反效果（activity 无效却跳过 done 后的自动 terminate）。
 *    这里靠「`TerminalSpawnSpec` 根本没这个字段」保证，而不是靠一句注释。
 *
 * 纯函数：不 stat、不起进程、不碰宿主 API（「零真机」红线）。
 */

import { deriveCwdLinux } from '../config/cwd-linux.ts';
import { isWslProfile } from '../config/profiles.ts';
import type { TerminalProfile } from '../config/profiles.ts';
import { DEFAULT_TERMINAL_TYPE, clampSize } from '../limits.ts';
import type { TerminalSize } from '../limits.ts';
import { fail } from './errors.ts';
import type { SessionResult, TerminalSpawnSpec } from './types.ts';

/** cwd 的来源（**可追溯**：UI 要能告诉用户「这条用的是 cwdLinux 还是推导值」） */
export type CwdSource =
  /** 用户显式填了 `cwdLinux`（或 Phase 1 已推导好并写回配置） */
  | 'cwdLinux'
  /** 非 WSL profile，直接用 Windows 侧 `cwd` */
  | 'cwd'
  /** WSL profile 只填了 `cwd`，由 001 的 `winToWsl` 现推 */
  | 'derived';

export interface ResolvedCwd {
  readonly cwd: string;
  readonly source: CwdSource;
}

/**
 * `start` 可覆盖的启动参数（尺寸与 TERM 值；都不给就用 `../limits.ts` 的默认）。
 *
 * ⚠️ 三个字段都显式带 `| undefined`：`exactOptionalPropertyTypes` 下 `{ rows: number | undefined }`
 * 不能赋给 `{ rows?: number }`，而调用方（UI fit 结果 / 工具参数）本来就常常传「有值或没有」，
 * 在这里多写一层条件展开只会让调用点更难读。
 */
export interface SpawnSpecOptions {
  readonly rows?: number | undefined;
  readonly cols?: number | undefined;
  readonly terminalType?: string | undefined;
}

/**
 * 解析 PTY 的 cwd（REQ-3.2 / REQ-3.3）。
 *
 * 判定顺序刻意写成「先看 profile 是否可启动」，再分 WSL / 非 WSL 两支 —— 因为 `needsFix` 的条目
 * 已经带着 001 的错误码（REQ-1.4），在这里**必须**先把那个原因抛给用户，而不是先抱怨 cwd 缺失：
 * 后者的消息会让用户去改一个本来就是对的字段。
 */
export function resolveCwd(profile: TerminalProfile): SessionResult<ResolvedCwd> {
  // 等价于 `!isStartable(profile)`（REQ-1.4），但顺手把 `needsFix` 收窄到非空 ——
  // 消息要直接引用 001 的原因与错误码，没必要先判一次布尔再断言一次非空。
  const reason = profile.needsFix;
  if (reason !== undefined) {
    return fail('not-startable', `profile「${profile.name}」需修复后才能启动：${reason.message}`, {
      hint: '在配置页修正该 profile 后重试（REQ-1.4：推导失败的条目不可启动）。',
      upstreamCode: reason.code,
    });
  }

  if (isWslProfile(profile.command)) {
    if (profile.cwdLinux !== undefined) return { ok: true, value: { cwd: profile.cwdLinux, source: 'cwdLinux' } };
    if (profile.cwd !== undefined) {
      const mapped = deriveCwdLinux(profile.cwd);
      if (mapped.ok) return { ok: true, value: { cwd: mapped.cwdLinux, source: 'derived' } };
      return fail(
        'cwd-unmappable',
        `profile「${profile.name}」是 WSL profile（command「${profile.command}」），但 cwd「${profile.cwd}」` +
          `推不出 Linux 路径 —— ${mapped.error.message}`,
        {
          hint: '请显式填 cwdLinux（例如 /mnt/e/proj 或 /home/you/proj）；REQ-1.4 不允许猜路径。',
          cwd: profile.cwd,
          upstreamCode: mapped.error.code,
        },
      );
    }
    return fail(
      'cwd-missing',
      `profile「${profile.name}」是 WSL profile，但既没有 cwdLinux 也没有可翻译的 cwd ⇒ 无法显式指定 PTY 的工作目录`,
      { hint: 'WSL 侧请填 cwdLinux（Linux 路径）；只填 cwd（Windows 路径）时需能翻译成 /mnt/<盘>/…。' },
    );
  }

  if (profile.cwd !== undefined) return { ok: true, value: { cwd: profile.cwd, source: 'cwd' } };
  return fail(
    'cwd-missing',
    `profile「${profile.name}」没有配置 cwd ⇒ 拒绝启动（PTY 不传 cwd 会落到宿主进程的目录，REQ-3.3 不允许）`,
    { hint: '在配置页给该 profile 填 cwd（Windows 路径）；WSL profile 请填 cwd 或 cwdLinux。' },
  );
}

/**
 * 构造 `spawnTerminal` 的 spec（T2.1 的字段逐项断言点）。
 *
 * `argv = [command, ...args]` **原样**进宿主，不经 shell 切词（design §6 的注入面）；
 * `env` 复制一份（宿主会在其上合并 scrub 后的父环境，本包不替它决定）。
 */
export function buildSpawnSpec(
  profile: TerminalProfile,
  options: SpawnSpecOptions = {},
): SessionResult<TerminalSpawnSpec> {
  const resolved = resolveCwd(profile);
  if (!resolved.ok) return resolved;

  const size: TerminalSize = clampSize(options.rows, options.cols);
  // 非空元组：`argv[0]` 一定存在（宿主自己会在空 argv 上抛错，本包不让那种输入走到那一步）
  const argv: [string, ...string[]] = [profile.command, ...profile.args];
  return {
    ok: true,
    value: {
      argv,
      cwd: resolved.value.cwd,
      env: { ...profile.env },
      rows: size.rows,
      cols: size.cols,
      terminalType: options.terminalType ?? DEFAULT_TERMINAL_TYPE,
    },
  };
}
