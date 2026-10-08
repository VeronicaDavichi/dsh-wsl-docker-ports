/**
 * WSL 发行版表解析（001 REQ-1 / 任务 T0.1）
 *
 * **真机事实**（2026-10-08 本机捕获，原始字节见 `tests/contract/fixtures/wsl-list-verbose.raw`）：
 * - `wsl.exe -l -v` 输出是 **UTF-16LE**（NUL 字节占 50%），行尾 **LF**（无 CRLF）
 * - 表头在本机是**英文** `NAME STATE VERSION`；而同一个 `wsl.exe --version` 是**中文**表头
 *   ⇒ 同工具不同子命令的本地化行为**不一致**，解析器**不得**把任何表头文本当硬前提
 * - 默认发行版用**名字列前的 `*`** 标记
 * - 发行版名**可含空格** ⇒ 只能从右往左吃掉 `VERSION` / `STATE` 两列，剩下的整体才是名字
 *
 * 表头识别策略：**数据行的最后一列必须是版本号（1 或 2）**。表头（无论何种语言）都不满足，
 * 因此被自然跳过 —— 不依赖任何表头字面量。
 */

export type WslDistroState =
  | 'Running'
  | 'Stopped'
  | 'Installing'
  | 'Uninstalling'
  | 'Converting'
  | 'Unknown';

export type WslVersion = 1 | 2;

export interface WslDistro {
  readonly name: string;
  readonly state: WslDistroState;
  readonly version: WslVersion;
  /** 是否为 WSL 自身的默认发行版（`wsl -l -v` 里带 `*` 的那个） */
  readonly isDefault: boolean;
}

/** 解析失败的**类型化**错误（上层要把原因显示给用户，不做裸异常） */
export class WslParseError extends Error {
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WslParseError';
    this.detail = detail;
  }
}

const UTF16LE_BOM_0 = 0xff;
const UTF16LE_BOM_1 = 0xfe;
const BOM_CHAR = 0xfeff;
const NUL = '\u0000';

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
 * 实测 UTF-16LE，但为了在别的机器/locale 上不炸，用字节指纹兜底。
 */
export function decodeWslOutput(input: Uint8Array | string): string {
  if (typeof input === 'string') return stripBomAndNuls(input);
  const encoding = looksLikeUtf16Le(input) ? 'utf-16le' : 'utf-8';
  return stripBomAndNuls(new TextDecoder(encoding).decode(input));
}

function normalizeState(token: string): WslDistroState {
  switch (token.trim().toLowerCase()) {
    case 'running':
      return 'Running';
    case 'stopped':
      return 'Stopped';
    case 'installing':
      return 'Installing';
    case 'uninstalling':
      return 'Uninstalling';
    case 'converting':
      return 'Converting';
    default:
      return 'Unknown';
  }
}

/**
 * 解析一行数据；不是数据行（表头 / 空行 / 其它噪声）返回 `undefined`。
 * 判据：最后一列是 `1` 或 `2`，且至少还有状态与名字两列。
 */
function parseDistroLine(line: string): WslDistro | undefined {
  const isDefault = /^\s*\*/.test(line);
  const body = line.replace(/^\s*[*+]\s*/, '').trim();
  if (body.length === 0) return undefined;

  const tokens = body.split(/\s+/);
  if (tokens.length < 3) return undefined;

  const versionToken = tokens[tokens.length - 1];
  const stateToken = tokens[tokens.length - 2];
  if (versionToken !== '1' && versionToken !== '2') return undefined;
  if (stateToken === undefined) return undefined;

  const name = tokens.slice(0, tokens.length - 2).join(' ');
  if (name.length === 0) return undefined;

  return {
    name,
    state: normalizeState(stateToken),
    version: versionToken === '1' ? 1 : 2,
    isDefault,
  };
}

/**
 * 解析 `wsl -l -v` 输出为发行版数组（顺序与 WSL 输出一致）。
 * @throws {WslParseError} 一个发行版都解析不出来时（调用方需要报错，而不是当成「没有发行版」）
 */
export function parseDistroList(input: Uint8Array | string): WslDistro[] {
  const lines = decodeWslOutput(input).split(/\r?\n/);
  const distros: WslDistro[] = [];
  for (const line of lines) {
    const distro = parseDistroLine(line);
    if (distro !== undefined) distros.push(distro);
  }
  if (distros.length === 0) {
    throw new WslParseError('未能从 `wsl -l -v` 输出中解析出任何发行版', {
      lineCount: lines.length,
    });
  }
  return distros;
}
