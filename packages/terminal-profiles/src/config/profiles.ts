/**
 * 配置模型与逐条容错解析（002 REQ-1.1–1.3 / 任务 T1.1；`cwdLinux` 接线见 ./cwd-linux.ts）
 *
 * ## 为什么自己解析，而不是让 schemastery 校验整个数组
 *
 * REQ-1.2 要的是**逐条容错**：一条坏配置只跳过它自己，其余照常可用，且**不得**让整个 profile
 * 启动失败。而 schemastery 是按整个 `profiles` 数组校验的 —— 一条不合法就是**整数组**失败，与
 * 该 REQ 直接冲突。故职责切成两半：`./schema.ts` 只管**声明 + volatile 接线**（宿主用它判
 * live/ordinary），**判定**归本文件。不要在两处各解释一套字段口径。
 *
 * ## 读配置的调用约定（宿主事实 A-1，踩过就会静默变空配置）
 *
 * cordis 里 `profiles` 标了 `.volatile()`，解析结果是**带 `.get()` 的深冻结对象**，下标取值是
 * `undefined` ⇒ 必须 `parseProfiles(config.profiles.get())`。直接传 `config.profiles` 会得到一条
 * 明确的「必须是数组」根诊断（并附 `.get()` 提示），**不会**被当成空配置而静默显示引导态。
 *
 * ## 分层（T6.1 起）
 *
 * **字段/类型/默认值**这些**结构规则**在 `./row-rules.ts` —— 宿主与配置页 import 同一份，
 * 免得两处各有一套字段口径。本文件只剩**跨条目**的判定（重名）与**要不要推导 `cwdLinux`**，
 * 那两件事都需要 006 的路径翻译（浏览器包里不能出现，见 row-rules 的文件头）。
 *
 * 纯函数：不读文件、不起进程、不碰宿主 API（Phase 1 的门）。
 */

import type { WslSharedError } from 'dsh-wsl-shared';

import { deriveCwdLinux } from './cwd-linux.ts';
import { brief, checkProfilesRoot, parseRowStructure } from './row-rules.ts';
import type { ProfileDiagnostic, RawProfileRow } from './row-rules.ts';

export { ROOT_INDEX, checkProfilesRoot, parseRowStructure } from './row-rules.ts';
export type { Parsed, ProfileDiagnostic, ProfileDiagnosticKind, RawProfileRow } from './row-rules.ts';

/** 解析后的单条 profile（= 结构部分 + 「需修复」标记） */
export interface TerminalProfile extends RawProfileRow {
  /** 非 `undefined` ⇒ 该条**需修复、不可启动**（REQ-1.4），值就是 001 的失败原因 */
  readonly needsFix?: WslSharedError;
}

/** 解析结果：**永远是部分成功**（对比 001 的 `ok` 判别联合 —— 那里有单点失败，这里没有） */
export interface ProfilesParseResult {
  /** 可用项 + 需修复项，**保持输入顺序**（配置页与下拉框的顺序都靠它，REQ-4.3 的「创建序」在此起步） */
  readonly profiles: readonly TerminalProfile[];
  readonly diagnostics: readonly ProfileDiagnostic[];
}

/** 可启动判定（REQ-1.4）：需修复的条目**不可启动**，但它仍留在列表里供用户修 */
export function isStartable(profile: TerminalProfile): boolean {
  return profile.needsFix === undefined;
}

/**
 * WSL profile 判定（REQ-3.2 的「`command` 为 `wsl.exe`」）。
 *
 * 判**末段路径 + 忽略大小写 + `.exe` 可省**：配置里写 `wsl`、`WSL.EXE`、
 * `C:\Windows\System32\wsl.exe` 都是同一件事，用户不该因为写法不同被区别对待。
 * **不**把 `bash.exe` / `ubuntu.exe` 之类算进来 —— REQ 只写了 `wsl.exe`，别自作主张。
 */
export function isWslProfile(command: string): boolean {
  const last = command.split(/[\\/]/).pop() ?? '';
  return /^wsl(\.exe)?$/i.test(last);
}

/** 推导后的条目 + 可能需要追加的诊断（`undefined` = 一切正常） */
interface CwdLinuxOutcome {
  readonly profile: TerminalProfile;
  readonly diagnostic?: ProfileDiagnostic;
}

/**
 * REQ-1.4 的接线点：**只在「WSL profile + 只填了 `cwd` + 没填 `cwdLinux`」时**推导。
 *
 * - 显式给了 `cwdLinux` ⇒ **不推导、不覆盖用户输入**（用户可能故意指向 `/home/...`，
 *   那个路径在 `cwd` 里根本没有 Windows 等价形态）；
 * - 非 WSL profile（`pwsh.exe` 等）⇒ 不推导。理由：`cwdLinux` 对它们**没有消费方**，
 *   而对一个合法但不可翻译的 Windows `cwd`（如 `\\server\share`）标「需修复」会**误伤**
 *   完全能跑的 profile —— REQ-1.4 的前提是「WSL profile」；
 * - WSL profile 两个都没填 ⇒ 也不推导（没有输入可推），留给启动期 REQ-3.3 报错。
 */
function applyCwdLinux(profile: TerminalProfile, index: number): CwdLinuxOutcome {
  if (!isWslProfile(profile.command) || profile.cwdLinux !== undefined || profile.cwd === undefined) {
    return { profile };
  }
  const derived = deriveCwdLinux(profile.cwd);
  if (derived.ok) return { profile: { ...profile, cwdLinux: derived.cwdLinux } };
  return {
    profile: { ...profile, needsFix: derived.error },
    diagnostic: {
      index,
      kind: 'CwdUnmappable',
      message: `第 ${index + 1} 条 profile 的 cwd 无法推导 cwdLinux ⇒ 该条不可启动：${derived.error.message}`,
      field: 'cwd',
      skipped: false,
      code: derived.error.code,
    },
  };
}

/**
 * 解析 `profiles` 配置值（REQ-1.1–1.4）。
 *
 * 容错口径（缺字段 / 类型错 / 重名 / 空数组分别怎么办）：
 * | 输入 | 结果 |
 * |---|---|
 * | `undefined`（整键缺失） | 等同空配置：`profiles: []`、**零诊断**（REQ-1.5 的引导态） |
 * | 非数组（`null` / 对象 / 字符串…） | 一条**根诊断**（`index = ROOT_INDEX`），`profiles: []`，不抛错 |
 * | 空数组 | `profiles: []`、零诊断 |
 * | 单条缺必填 / 类型错 / 非对象 | **丢弃该条** + 一条 `skipped: true` 的诊断，其余条目不受影响（REQ-1.2） |
 * | 单条重名 | **丢弃后者** + `DuplicateName`（带 `conflictWith` 指向先出现者），先出现者原样保留（REQ-1.3） |
 * | WSL 且 `cwdLinux` 推导失败 | **保留**该条（用户要在配置页看见它才能修）+ `CwdUnmappable`，并标 `needsFix` ⇒ 不可启动（REQ-1.4） |
 * | 未知字段 | 忽略（不拒绝整条、也不带进结果）；⚠️ **订正见下** |
 *
 * ⚠️ **2026-10-09 实测订正**（Phase 6 顺带核到，原文错）：原表此处写「schemastery 同样会剔除未知键」——
 * 实测 `s.object({ a: s.string() })({ a: 'x', b: 1 })` ⇒ `{ a: 'x', b: 1 }`，**未知键被保留**。
 * 本包结果里之所以没有未知键，是**本文件只挑那 6 个字段**，不是 schema 的功劳。
 * 同一组实测另得一条：`s.object({ profiles: s.array(s.any()).volatile() })({ profiles: 'nope' })`
 * **抛 `ValidationError`**（`$.profiles expected array but got nope`）⇒ 配置页写回**必须**始终给数组
 * （`./client/config-pipe.ts` 的 patch 恒为 `{ profiles: [...] }`，并有单测钉住）。
 *
 * ⚠️ 假设（REQ 未写死，实现选择）：`name` 重名按 **trim 后逐字精确比较**（不忽略大小写）——
 * 重名判定要给用户一个确定的答案，大小写折叠会让「Dev / dev 到底算不算撞」变成实现细节；
 * 若将来要折叠，须同时改配置页文案。
 */
export function parseProfiles(raw: unknown): ProfilesParseResult {
  const profiles: TerminalProfile[] = [];
  const diagnostics: ProfileDiagnostic[] = [];
  /** name → 先出现者的下标（REQ-1.3 的「冲突来源」就是它） */
  const firstSeen = new Map<string, number>();

  if (raw === undefined) return { profiles, diagnostics };
  if (!Array.isArray(raw)) {
    // 非 `undefined` 且非数组 ⇒ `checkProfilesRoot` 必给诊断（保留兜底是为了不写非空断言）
    const root = checkProfilesRoot(raw);
    return { profiles, diagnostics: root === undefined ? [] : [root] };
  }

  const items: unknown[] = raw;
  for (const [index, item] of items.entries()) {
    const parsed = parseRowStructure(item, index);
    if (!parsed.ok) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }
    const conflict = firstSeen.get(parsed.value.name);
    if (conflict !== undefined) {
      diagnostics.push({
        index,
        kind: 'DuplicateName',
        message: `第 ${index + 1} 条 profile 的 name「${brief(parsed.value.name)}」与第 ${conflict + 1} 条重名 ⇒ 已拒绝后者（不覆盖先出现者）`,
        field: 'name',
        skipped: true,
        conflictWith: conflict,
      });
      continue;
    }
    const outcome = applyCwdLinux(parsed.value, index);
    if (outcome.diagnostic !== undefined) diagnostics.push(outcome.diagnostic);
    firstSeen.set(parsed.value.name, index);
    profiles.push(outcome.profile);
  }

  return { profiles, diagnostics };
}
