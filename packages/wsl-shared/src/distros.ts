/**
 * WSL 发行版发现（001 REQ-1 / 任务 T0.1 + T2.1–T2.4）
 *
 * **真机事实**（2026-10-08 本机捕获，原始字节见 `tests/contract/fixtures/wsl-list-verbose.raw`）：
 * - `wsl.exe -l -v` 输出是 **UTF-16LE**（NUL 字节占 50%），行尾 **LF**（无 CRLF）
 * - 表头在本机是**英文** `NAME STATE VERSION`；而同一个 `wsl.exe --version` 是**中文**表头
 *   ⇒ 同工具不同子命令的本地化行为**不一致**，解析器**不得**把任何表头文本当硬前提
 * - 默认发行版用**名字列前的 `*`** 标记；发行版名**可含空格**
 *
 * ## 判定结构（REQ-1.3：不看表头文字）
 *
 * 1. 最后一列匹配 `^[12]$` 且至少 3 列 → 数据行：`名字` = 中间全部（**原样捕获，含连续空格**），`状态` = 倒数第二列
 * 2. 恰好 2 列且最后一列是**已知状态词** → 数据行，`version: 'unknown'`（design §3.1 的「无 VERSION 列」）
 *    - 这条同时挡掉了 `wsl -l`（无 `-v`）的两列表头：`NAME STATE` 的 `STATE` 不是状态词
 * 3. 其余（空行 / 表头 / 横幅 / 噪声）→ 跳过
 *
 * 因此**中文表头**（`名称 状态 版本`）与英文表头都被第 3 条自然跳过，无需识别任何字面量。
 *
 * ## 空结果的口径（REQ-1.6，T2.2）
 *
 * 解析**不抛异常**：一个数据行都没有 → 返回 `[]`。「装好了但一个都没有」（命令成功、结果为空）
 * 与「命令失败」（`CommandNotFound` / `NonZeroExit`，由 `exec.ts` 给出）是**两种事实**，不得混淆。
 */

import { fail, type WslSharedError } from './errors.ts';
import type { Executor } from './exec.ts';

export type WslDistroState =
  | 'Running'
  | 'Stopped'
  | 'Installing'
  | 'Uninstalling'
  | 'Converting'
  | 'Unknown';

/** `'unknown'` = 该行没有 VERSION 列（design §2） */
export type WslVersion = 1 | 2 | 'unknown';

export interface WslDistro {
  readonly name: string;
  readonly state: WslDistroState;
  readonly version: WslVersion;
  /** 是否为 WSL 自身的默认发行版（`wsl -l -v` 里带 `*` 的那个） */
  readonly isDefault: boolean;
}

/**
 * 目标发行版的**来源**（REQ-1.7：解析结果必须能解释「为什么是它」）
 */
export type DistroSource = 'config' | 'wslDefault' | 'onlyOne' | 'first';

/**
 * 解析结果的成功态。
 *
 * ⚠️ **2026-10-08 Phase 4 自审补 `ok: true`**：`errors.ts` 声明的口径是「所有失败都是 `ok:false`
 * 的返回值，与**成功态**构成判别联合」，而本类型原先**没有** `ok` 字段 ⇒ `isWslFailure()`
 * （形参要求 `{ ok: boolean }`）**对这个联合用不了**，消费者只能写 `'code' in r`，与
 * `ExecResult` / `DistroExecOutcome` / `Eth0Outcome` / `PathMapping` 四种成功态不一致。
 * 003/005 代码尚未开工 ⇒ 现在补齐零迁移成本。
 */
export interface DistroResolution {
  readonly ok: true;
  readonly name: string;
  readonly source: DistroSource;
}

const UTF16LE_BOM_0 = 0xff;
const UTF16LE_BOM_1 = 0xfe;
const BOM_CHAR = 0xfeff;
const NUL = '\u0000';
/**
 * 三列数据行：末组是版本号。
 * `name` 用**非贪婪 + 行尾锚定**捕获 → 正则回溯会把 `Ubuntu  22.04` 整段留给名字，
 * **连续空格原样保留**（切词再拼会把它压成单空格，拿去 `-d <name>` 就找不到发行版）。
 */
const VERSIONED_ROW = /^(?<name>.+?)\s+(?<state>\S+)\s+(?<version>[12])$/;
/** 两列数据行：`name` 同样原样捕获；`state` 还需过**状态词白名单**（第 2 条判定） */
const TWO_COLUMN_ROW = /^(?<name>.+?)\s+(?<state>\S+)$/;
const DEFAULT_MARKER = /^\s*\*/;

/** 已知状态词（大小写不敏感）。**只用于第 2 条判定**，不用于识别表头 */
const KNOWN_STATES: ReadonlyMap<string, WslDistroState> = new Map<string, WslDistroState>([
  ['running', 'Running'],
  ['stopped', 'Stopped'],
  ['installing', 'Installing'],
  ['uninstalling', 'Uninstalling'],
  ['converting', 'Converting'],
]);

/** 判断字节流是否疑似 UTF-16LE：有 BOM，或 NUL 占比 > 25% */
function looksLikeUtf16Le(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && bytes[0] === UTF16LE_BOM_0 && bytes[1] === UTF16LE_BOM_1) return true;
  if (bytes.length === 0) return false;
  let nul = 0;
  for (const b of bytes) if (b === 0) nul += 1;
  return nul / bytes.length > 0.25;
}

function stripBomAndNuls(text: string): string {
  const body = text.charCodeAt(0) === BOM_CHAR ? text.slice(1) : text;
  return body.split(NUL).join('');
}

/**
 * 把 `wsl.exe` 的原始输出解码成文本。
 * 调用方**显式**决定编码是本包的既定口径；这里是「wsl.exe 专用」的窄口径：
 * 实测 UTF-16LE（A-1 已定案），但为了在别的机器/locale 上不炸，用字节指纹兜底。
 */
export function decodeWslOutput(input: Uint8Array | string): string {
  if (typeof input === 'string') return stripBomAndNuls(input);
  const encoding = looksLikeUtf16Le(input) ? 'utf-16le' : 'utf-8';
  return stripBomAndNuls(new TextDecoder(encoding).decode(input));
}

function normalizeState(token: string): WslDistroState {
  return KNOWN_STATES.get(token.trim().toLowerCase()) ?? 'Unknown';
}

/**
 * 解析一行；不是数据行（表头 / 空行 / 噪声）返回 `undefined`。
 * 判定见文件头「判定结构」。
 */
function parseDistroLine(line: string): WslDistro | undefined {
  const isDefault = DEFAULT_MARKER.test(line);
  // 只剥 WSL 真正会打的默认标记 `*`；不再顺带剥 `+`，否则会吃掉以 `+` 开头的发行版名首字符
  const body = line.replace(/^\s*\*\s*/, '').trim();
  if (body.length === 0) return undefined;

  // ① 末列是版本号 → 名字**原样捕获**（REQ-1.4：名字可含空格，且必须与 `-d` 用的名字逐字节一致）
  const versioned = VERSIONED_ROW.exec(body);
  const versionedGroups = versioned?.groups;
  if (versionedGroups !== undefined) {
    const { name, state, version } = versionedGroups;
    if (name !== undefined && state !== undefined && version !== undefined) {
      return { name, state: normalizeState(state), version: version === '1' ? 1 : 2, isDefault };
    }
  }

  // ② 恰好两列且末列是已知状态词 → 无 VERSION 列的数据行（design §3.1）
  const twoColumn = TWO_COLUMN_ROW.exec(body)?.groups;
  const twoColumnState = twoColumn?.state;
  const twoColumnName = twoColumn?.name;
  if (twoColumnState !== undefined && twoColumnName !== undefined) {
    const known = KNOWN_STATES.get(twoColumnState.toLowerCase());
    if (known !== undefined) {
      return { name: twoColumnName, state: known, version: 'unknown', isDefault };
    }
  }

  return undefined;
}

/**
 * 解析 `wsl -l -v` 输出为发行版数组。
 *
 * - 不抛异常；无数据行 → `[]`（REQ-1.6）
 * - `isDefault === true` **至多一个**（REQ-1.1）：即使输入里出现多个 `*`，也只认第一个
 * - 默认项**置顶**，其余保持 WSL 原顺序（design §3.1）
 */
export function parseDistroTable(input: Uint8Array | string): WslDistro[] {
  const parsed: WslDistro[] = [];
  let defaultTaken = false;

  for (const line of decodeWslOutput(input).split(/\r?\n/)) {
    const distro = parseDistroLine(line);
    if (distro === undefined) continue;
    if (distro.isDefault) {
      if (defaultTaken) {
        parsed.push({ ...distro, isDefault: false });
        continue;
      }
      defaultTaken = true;
    }
    parsed.push(distro);
  }

  return [...parsed.filter((d) => d.isDefault), ...parsed.filter((d) => !d.isDefault)];
}

/** 兼容旧名（Phase 0 的 `parseDistroList`）；语义已按 REQ-1.6 收敛为「无数据行 → `[]`」 */
export const parseDistroList = parseDistroTable;

export interface ListDistrosOptions {
  /** 状态查询也要超时：首次 `wsl -l -v` 实测可达 8.6s（A-4） */
  readonly timeoutMs?: number;
}

/** 默认超时：给冷启动/首次调用留足余量，同时保证不会永久挂起 */
export const LIST_DISTROS_TIMEOUT_MS = 20_000;

export type ListDistrosOutcome =
  | { readonly ok: true; readonly distros: readonly WslDistro[] }
  | WslSharedError;

/**
 * 发行版发现（REQ-1.1/1.2/1.5/1.6）。
 * 命令固定 `wsl.exe -l -v`，编码固定 `utf16le`（A-1 已定案），**不启动**任何发行版
 * （`wsl -l -v` 实测无唤醒副作用，A-4）。
 */
export async function listDistros(
  executor: Executor,
  options: ListDistrosOptions = {},
): Promise<ListDistrosOutcome> {
  const outcome = await executor('wsl.exe', ['-l', '-v'], {
    encoding: 'utf16le',
    timeoutMs: options.timeoutMs ?? LIST_DISTROS_TIMEOUT_MS,
  });
  if (!outcome.ok) return outcome;
  return { ok: true, distros: parseDistroTable(outcome.stdout) };
}

/**
 * 目标发行版解析（REQ-1.7 / D-4）。**纯函数**：不读配置、不执行命令、**不提问**、不持久化。
 *
 * 四级优先级：① 显式配置 → ② `isDefault`（WSL 自己的 `*`）→ ③ 唯一 → ④ 首个。
 * 配置了但**没装** → `DistroNotFound`（不静默换一个，否则用户配的发行版被悄悄替换）。
 * 一个都没有 → `NoDistro`（SHALL NOT 返回空名）。
 * 本函数**不会**执行 `wsl --set-default`（改写用户的 WSL 全局默认不在本插件职责内）。
 */
export function resolveDistro(
  distros: readonly WslDistro[],
  configured?: string | undefined,
): DistroResolution | WslSharedError {
  // 空集**先判**（2026-10-08 复审补强）：一个发行版都没有时任何配置都不可能命中，
  // 根因是「没装发行版」，报 `DistroNotFound` 会把用户的排查方向引到配置上。
  // 这不违反「① 配置优先」—— 空集下配置本就无从命中。
  if (distros.length === 0) return fail('NoDistro', '本机没有任何 WSL 发行版', { distros: [] });

  // 配置被写坏（非字符串，例如 YAML 里写成数字）时按「未配置」回落：
  // 公开面**不抛异常**是硬契约，不能在这里丢一个 `trim is not a function`
  const wanted = typeof configured === 'string' ? configured.trim() : '';
  if (wanted.length > 0) {
    const hit = distros.find((d) => d.name.toLowerCase() === wanted.toLowerCase());
    if (hit !== undefined) return { ok: true, name: hit.name, source: 'config' };
    return fail('DistroNotFound', `配置的发行版「${wanted}」不在已安装列表中`, {
      distros: distros.map((d) => d.name),
    });
  }

  const flagged = distros.find((d) => d.isDefault);
  if (flagged !== undefined) return { ok: true, name: flagged.name, source: 'wslDefault' };

  const first = distros[0];
  // 类型收窄用；逻辑上已被上面的空集判定拦下（`noUncheckedIndexedAccess` 不认 length 检查）
  if (first === undefined) return fail('NoDistro', '本机没有任何 WSL 发行版', { distros: [] });
  if (distros.length === 1) return { ok: true, name: first.name, source: 'onlyOne' };
  return { ok: true, name: first.name, source: 'first' };
}

/**
 * 目标发行版存在性守卫（REQ-2.5）。返回 `undefined` 表示存在。
 * 供 eth0 探测与写路径在拼 `-d <name>` 之前调用 —— 错误里必须带**可用发行版名列表**。
 */
export function guardDistroExists(
  name: string,
  distros: readonly WslDistro[],
): WslSharedError | undefined {
  const wanted = name.trim().toLowerCase();
  const hit = distros.some((d) => d.name.toLowerCase() === wanted);
  if (hit) return undefined;
  return fail('DistroNotFound', `发行版「${name}」不存在`, { distros: distros.map((d) => d.name) });
}
