/**
 * `.wslconfig` 读取与 `networkingMode` 判定（001 REQ-4 / 任务 T5.1–T5.3）
 *
 * ## 真机事实（2026-10-08 实测；原始字节见 `tests/contract/fixtures/wslconfig.raw`）
 * - `%USERPROFILE%\.wslconfig` = **32 字节**、**无 BOM**、行尾 **CRLF**、**无尾换行**，
 *   原文 `[wsl2]\r\nlocalhostForwarding=true` ⇒ 没有 `networkingMode` ⇒ **NAT 缺省**（硬前提成立）。
 * - `process.env.USERPROFILE` 与 `os.homedir()` 本机同值（`C:\Users\EDY`）。
 * - `fs.readFile` 的失败 errno 实测：目录 → **`EISDIR`**、缺文件 / 不存在的盘符 → **`ENOENT`**、
 *   路径含 NUL → `ERR_INVALID_ARG_VALUE`（**本机见不到 `EACCES`**）⇒ 判定**只按「是不是 ENOENT」
 *   分叉**，其余一律 `ConfigUnreadable` —— 枚举 errno 必然漏项。
 *
 * ## 🔴 本模块最险的一处：`USERPROFILE=''`（实测后修掉）
 * `''` 是「**存在但为空**」的环境变量：`??` 不会回落到 `os.homedir()`，而
 * `path.join('', '.wslconfig')` = **`.wslconfig`（相对路径！）** ⇒ 会去读**当前工作目录**下的
 * 同名文件 —— 把别处的配置当成用户的配置，是**静默错答**。更糟：`USERPROFILE=''` 时
 * `os.homedir()` **自己会抛** `ERR_SYSTEM_ERROR`（`uv_os_homedir returned ENOENT`）。
 * ⇒ 三件事一起做：① 回落用 `?.trim() ||`（**不是** `??`）；② `os.homedir()` 包在 try 里；
 * ③ 组装出的默认路径**必须是绝对路径**，否则宁可报错（相对路径永远不该被读）。
 *
 * ## 为什么「读不到」绝不等于「缺省 NAT」（REQ-4.6）
 * NAT 是组件②的**硬前提**：用户把 `networkingMode` 改成 `mirrored`、却因权限/IO 读不到，若静默
 * 按缺省 NAT 通过，UI 会显示「可用」，而 portproxy 规则指向失效地址 —— 与 handover 原脚本坑 #4
 * 同类（**不报错，只是连不上**）。⇒ 读不到 = typed error，让 003 把路径与原因显示出来。
 *
 * ## 保守判定（REQ-4.4）
 * 只认**精确小写** `nat` / `mirrored`；`NAT`、带空白的拼写、`bridged`、未来新增值一律 `other`
 * ⇒ `resolved: 'non-nat'`。宁可误报「不可用」（用户看一眼配置即可），**不可**误报「可用」（静默失效）。
 *
 * ## 只读（NFR-4 / REQ-4.3）
 * 本模块**只读**：绝不写 `.wslconfig`、不改环境、不启动进程。修复指引是 003 展示的**文本**，
 * 不代用户改配置。测试里有静态断言（剥注释后源码不得出现任何写文件调用）。
 */
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fail, type WslSharedError } from './errors.ts';

/** 判定出的模式（`default` = 文件不存在或没有该键） */
export type NetworkingModeKind = 'nat' | 'mirrored' | 'default' | 'other';
/** 消费方实际要判的那一态：NAT 是硬前提，非 NAT 一律「功能不可用」 */
export type NetworkingModeResolution = 'nat' | 'non-nat';

/** 成功态（带 `ok: true`，与 `ExecResult` 等其余成功态同一口径，`isWslFailure()` 可收窄） */
export interface NetworkingMode {
  readonly ok: true;
  /** 实际读取的完整路径（REQ-4.7；`ENOENT` 与错误路径上也带） */
  readonly path: string;
  readonly mode: NetworkingModeKind;
  readonly resolved: NetworkingModeResolution;
  /**
   * 配置里的**原始值**（去两侧空白，**不改大小写**），供 UI 显示「你写的是 X，我判定为 Y」。
   * 文件不存在或没有该键时**这个字段不出现**（不伪造 `undefined`，沿用 `fail()` 的口径）。
   */
  readonly rawValue?: string;
}

export type NetworkingModeOutcome = NetworkingMode | WslSharedError;

/** 读文件的最小依赖面（测试注入 fake；生产走 `node:fs/promises`） */
export type ReadFileLike = (filePath: string) => Promise<string>;

/** 可注入依赖（全部可选 ⇒ 生产调用零配置） */
export interface WslConfigDeps {
  readonly readFile?: ReadFileLike;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homedir?: () => string;
}

export interface WslConfigReader {
  /** `filePath` 省略 ⇒ `%USERPROFILE%\.wslconfig`（调用方给了就用它，不再拼接） */
  read(filePath?: string): Promise<NetworkingModeOutcome>;
}

/** `[section]` 整行（剥注释与 trim 之后仍须**恰好**是这个形态 —— 尾部带杂物的行不算节） */
const SECTION_LINE = /^\[([^\]]*)\]$/;
/** 行内注释：`#` 或 `;` 之后全丢（`.wslconfig` 的键值里不会出现这两个字符） */
const INLINE_COMMENT = /[#;].*/;

/**
 * 手写 INI 子集：只取 `[wsl2]` 节的 `networkingMode` 原值（纯函数，不碰文件系统）。
 *
 * 容忍（REQ-4.5）：BOM、CRLF、`#`/`;` 整行与行内注释、键值两侧空白、节名大小写。
 * 行尾按 `\r\n` / `\n` / **单个 `\r`** 三种都切（最后一种是老 Mac 写法；实测本机工具链不会产出，
 * 但成本为零 —— 不切的话整份文件会被当成**一行**，节判定直接失效 ⇒ 静默判成 default/nat）。
 * 只认 `[wsl2]` 节（其余节一律忽略，含旧写法 `[experimental]` —— 见 design §8-16 的风险记录）；
 * 重复键**最后一个胜出**（INI 惯例）；不引任何解析器依赖（NFR-1：零运行时依赖）。
 */
export function parseWslConfig(text: string): string | undefined {
  let section: string | undefined;
  let rawValue: string | undefined;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(INLINE_COMMENT, '').trim();
    if (line === '') continue;
    const asSection = SECTION_LINE.exec(line);
    if (asSection !== null) {
      section = (asSection[1] ?? '').trim().toLowerCase();
      continue;
    }
    if (section !== 'wsl2') continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== 'networkingmode') continue;
    rawValue = line.slice(separator + 1).trim();
  }
  return rawValue;
}

/** 判定表（REQ-4.1 ~ REQ-4.4 全表；`default` 与 `nat` 是**唯一**两种 `resolved: 'nat'`） */
function judge(rawValue: string | undefined): {
  mode: NetworkingModeKind;
  resolved: NetworkingModeResolution;
} {
  if (rawValue === undefined) return { mode: 'default', resolved: 'nat' };
  if (rawValue === 'nat') return { mode: 'nat', resolved: 'nat' };
  if (rawValue === 'mirrored') return { mode: 'mirrored', resolved: 'non-nat' };
  return { mode: 'other', resolved: 'non-nat' };
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/**
 * 失败的**可读**描述：`EISDIR: illegal operation on a directory, read`。
 * ⚠️ Node 的 `error.message` **本身常常已带 errno 前缀**（真机实测：
 * `EISDIR: illegal operation on a directory, read`）⇒ 先判重，否则文案会变成
 * 「EISDIR: EISDIR: …」（这段文案会被 003 原样显示给用户，重复的 errno 很像 bug）。
 */
function describe(error: unknown): string {
  const code = errorCodeOf(error);
  const message = error instanceof Error ? error.message : String(error);
  if (code === undefined) return message;
  return message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
}

/**
 * 造一个读取器。注入面刻意只有「读文件 / 环境变量 / 主目录」三样，
 * 好让「空 `USERPROFILE`」「`EISDIR`」这类**本机造不出来**的场景在单测里可复算。
 */
export function createWslConfigReader(deps: WslConfigDeps = {}): WslConfigReader {
  const readFileImpl: ReadFileLike = deps.readFile ?? ((filePath) => readFile(filePath, 'utf8'));
  const env = deps.env ?? process.env;
  const homedir = deps.homedir ?? os.homedir;

  return {
    async read(filePath?: string): Promise<NetworkingModeOutcome> {
      let target: string;
      if (filePath !== undefined) {
        target = filePath;
      } else {
        try {
          const fromEnv = env['USERPROFILE']?.trim();
          target = path.join(fromEnv === undefined || fromEnv === '' ? homedir() : fromEnv, '.wslconfig');
        } catch (error) {
          return fail(
            'ConfigUnreadable',
            `无法确定 .wslconfig 的位置：USERPROFILE 为空或缺失，且取用户主目录也失败（${describe(error)}）`,
          );
        }
        if (!path.isAbsolute(target)) {
          return fail(
            'ConfigUnreadable',
            `默认配置路径不是绝对路径（${target}）—— 拒绝按相对路径读，否则可能读到工作目录下的同名文件`,
            { path: target },
          );
        }
      }

      try {
        const rawValue = parseWslConfig(await readFileImpl(target));
        const { mode, resolved } = judge(rawValue);
        return {
          ok: true,
          path: target,
          mode,
          resolved,
          ...(rawValue === undefined ? {} : { rawValue }),
        };
      } catch (error) {
        if (errorCodeOf(error) === 'ENOENT') {
          // REQ-4.2：文件不存在 = WSL 2 的缺省 = NAT（这不是错误，也别加"警告"）
          return { ok: true, path: target, mode: 'default', resolved: 'nat' };
        }
        return fail(
          'ConfigUnreadable',
          `读不到 WSL 配置 ${target}（${describe(error)}）—— NAT 是端口转发的硬前提，故不按缺省 NAT 通过`,
          { path: target },
        );
      }
    },
  };
}

/** 便捷入口：生产代码要的就是「按默认路径读一次」 */
export function readNetworkingMode(filePath?: string): Promise<NetworkingModeOutcome> {
  return createWslConfigReader().read(filePath);
}
