/**
 * 路径翻译（001 REQ-3.1–3.7 / 任务 T4.1–T4.4）
 *
 * ## 先测再写：`node:path` 的真实语义（2026-10-08 实测，四个坑）
 *
 * 1. `win32.normalize('E:')` → **`'E:.'`**（裸盘符被补一个 `.`）⇒ 盘符必须在 normalize **之前**摘出来，
 *    否则 `E:` 会翻成 `/mnt/e/.`。
 * 2. `win32.normalize` 会给**共享根**补尾分隔符：`\\server\share` → `\\server\share\`；三段以上的
 *    UNC（`\\wsl.localhost\D\home`）不补 ⇒ 形态判定必须容忍尾分隔符。
 * 3. `win32.normalize('\\\\wsl.localhost\\\\home')` → `'\\\\wsl.localhost\\home\\'`：重复分隔符会被
 *    折叠成**合法 UNC**（`home` 成了共享名）。
 * 4. `posix.normalize` **保留尾斜杠**（`/home/u/` → `/home/u/`），但会把 `/..` 夹到 `/`；`win32.join(UNC,'..')`
 *    也夹在共享根 ✅ ⇒ 尾斜杠自己收，越界交给 normalize 夹。
 *
 * ## 口径（design §3.3）
 *
 * - **纯字符串变换**：不 stat、不解析符号链接、**不读任何文件**（REQ-3.7），可离线单测。
 * - **不做引号包装、不做 shell 转义**（REQ-3.6）—— 结果只作 `argv` 元素传递；含空格与中文原样保留。
 * - **非法字符检查先于形态判定**（REQ-3.5）：含 `?` 的输入上「这是不是 UNC」根本无法可靠回答。
 * - 无盘符的 Linux 路径**绝不猜盘符**（REQ-3.4）：没给发行版名就 `NoWindowsEquivalent`。
 *
 * ## 已记录的局限（不是缺陷，详见 design §8）
 *
 * - 盘符相对形态（`E:x`）按 design §3.3 翻成 `/mnt/e/x`；`..` 因此是相对**盘根**解析的
 *   （真实的"该盘当前目录"必须读 FS ⇒ 本包不读）⇒ `E:..\x` 与 `E:x` 同结果；Windows 的每盘当前目录
 *   默认就是盘根，所以这是**常见情形**下的正确答案。
 * - 尾随空格/句点的路径段（`E:\x.`）照原样翻译：Windows 自己在多数 API 里会悄悄吃掉它们，
 *   本包**不发明**额外规则。
 * - 入参**首尾空白会被 trim**（表单场景常见），段内空格与中文原样保留（REQ-3.6）。
 * - 扩展长度前缀 `\\?\E:\x` 被拒（`?` 命中保留字符）：本包不猜"这是不是长路径前缀"。
 * - `/mnt/<盘>` 的存在性**不校验**（纯函数不读 FS）：automount 关掉或自定义挂载点时仍按 `/mnt/<盘>`
 *   翻译 —— 归属判断由调用方用 `wsl -l -v` / `.wslconfig` 的事实做。
 * - UNC 里的 `..` 由 `win32.normalize` **夹在共享根**（与 Win32 一致）⇒ `\\wsl.localhost\D\..\..\x`
 *   就是发行版 D 内的 `/x`，不会跨发行版。
 */

import path from 'node:path';

import { fail, type WslSharedError } from './errors.ts';

/** 成功态：翻译结果 */
export interface PathMapping {
  readonly ok: true;
  readonly path: string;
}

/** 翻译结果：成功或 typed error（不抛异常） */
export type PathMappingOutcome = PathMapping | WslSharedError;

/** Windows 侧非法字符（`:` 单独处理：只允许出现在盘符后那一个位置） */
const RESERVED = /[<>"|?*]/;
/** 控制字符（含 NUL）—— 任何合法路径都不该有，进 argv 前就该拦下 */
const CONTROL = /[\u0000-\u001f\u007f]/;
/** `\\wsl.localhost\<发行版>[\<余下>]` 或旧式 `\\wsl$\<发行版>[\<余下>]`（前缀大小写不敏感，名字可含空格） */
const WSL_UNC = /^\\\\wsl(?:\.localhost|\$)\\(?<distro>[^\\]+)(?:\\(?<rest>.*))?$/i;
/** 盘符形态（normalize 之后）：`E:` / `E:\…` / `E:x`（盘符相对） */
const DRIVE = /^([A-Za-z]):(.*)$/s;
/** `/mnt/<单个小写字母>`（真机挂载点形态）；大写不算 —— `/mnt/E` 是发行版内的真实目录 */
const MNT_DRIVE = /^\/mnt\/([a-z])(?:\/|$)/;

/**
 * 回显到 `message` 里的输入必须先「可见化」（Phase 4 自审缺陷②）：控制字符（ESC / LF / BEL …）
 * 原样进 UI 或日志会破坏排版，**甚至注入 ANSI 转义**（实测 `E:\x\u001b[31mred` 的 ESC 被原样带出）。
 * 同时**限长**：4 KB 的脏输入不该把错误消息撑成 4 KB（超长截断并报总长）。
 */
const ECHO_MAX = 120;

function echo(raw: string): string {
  const visible = raw.replace(
    /[\u0000-\u001f\u007f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return visible.length <= ECHO_MAX ? visible : `${visible.slice(0, ECHO_MAX)}…（共 ${raw.length} 字符）`;
}

const unmappable = (raw: string, why: string): WslSharedError =>
  fail('UnmappablePath', `无法翻译路径「${echo(raw)}」：${why}`);

/** 去掉尾部分隔符（根保留） */
const stripTail = (linux: string): string => (linux.length > 1 ? linux.replace(/\/+$/, '') : linux);

/**
 * 入参检查（REQ-3.5/3.6）。返回 `undefined` = 通过。
 * `kind='linux'` 多拦一条**反斜杠**：Linux 允许它出现在文件名里，但落到 Windows 会变成分隔符
 * ⇒ 会指向**另一个路径**（静默错译），宁可按不可翻译拒掉。
 */
function validateInput(raw: string, kind: 'win' | 'linux'): WslSharedError | undefined {
  if (raw === '') return unmappable(raw, '空路径');
  if (CONTROL.test(raw)) return unmappable(raw, '含控制字符');
  if (RESERVED.test(raw)) return unmappable(raw, '含 Windows 非法字符（< > " | ? * 之一）');
  // 冒号只允许是盘符后的那一个（Windows 侧）；Linux 侧一律不许 —— 写不进 Windows
  const body = kind === 'win' ? raw.replace(/^[A-Za-z]:/, '') : raw;
  if (body.includes(':')) return unmappable(raw, '含冒号（只允许出现在盘符后）');
  if (kind === 'linux' && raw.includes('\\')) {
    return unmappable(raw, '含反斜杠（Linux 侧合法，但到 Windows 会变成分隔符 ⇒ 会指向别的路径）');
  }
  return undefined;
}

/**
 * 发行版名要拼进 UNC 路径 ⇒ 不许含分隔符/保留字符，不许是 `.`/`..`，
 * 也不许**以 `.` 或空格结尾**（Phase 4 自审缺陷③：`D.` 拼出的 `\\wsl.localhost\D.\…`
 * 是 Windows **不可能存在**的共享名 —— Win32 会吃掉尾随点/空格）。
 */
function validateDistroName(name: string): WslSharedError | undefined {
  const why =
    CONTROL.test(name) || RESERVED.test(name) || /[:\\/]/.test(name)
      ? '含分隔符或非法字符'
      : name === '.' || name === '..'
        ? '不能是 . 或 ..'
        : /[. ]$/.test(name)
          ? '以 . 或空格结尾（Windows 共享名不允许）'
          : undefined;
  if (why === undefined) return undefined;
  return fail('UnmappablePath', `发行版名「${echo(name)}」不能用于拼 UNC 路径：${why}`);
}

/**
 * Windows 路径 → WSL 路径（REQ-3.1/3.2/3.3）。
 *
 * 接受：`E:\x\y`、`e:/x/y`、`E:x`、`E:\`、`\\wsl.localhost\<发行版>\home\u`、`\\wsl$\<发行版>\home\u`。
 * 拒绝（`UnmappablePath`）：空串、`\\server\share`、`\Windows`（无盘符的根）、相对路径、保留字符。
 */
export function winToWsl(input: string): PathMappingOutcome {
  if (typeof input !== 'string') {
    return fail('UnmappablePath', `路径必须是字符串，收到 ${typeof input}`);
  }
  const raw = input.trim();
  const invalid = validateInput(raw, 'win');
  if (invalid !== undefined) return invalid;

  // Windows 把 `/` 也当分隔符 ⇒ 先统一，再交给 win32.normalize 折叠重复/解析 `.` 与 `..`
  const win = path.win32.normalize(raw.replace(/\//g, '\\'));

  const unc = WSL_UNC.exec(win);
  if (unc !== null) {
    // 实测（2026-10-08）：`win32.normalize` 把 UNC 里越根的 `..` **夹在共享根** —— `\\wsl.localhost\D\..\..\x`
    // → `\\wsl.localhost\D\x`（与 Win32 的 UNC 语义一致：Windows 不允许用 `..` 爬出共享根）。
    // ⚠️ Phase 4 自审订正：早先注释写"走到这里 `rest` 里**不可能**再有 `..`"是**过头话** ——
    // `\\wsl.localhost\..\x` 会被 normalize **原样保留**，`..` 落在**发行版段**上（distro=`..`、rest=`x`）。
    // 段名是 `.`/`..` 的输入**不是可识别的 UNC**（REQ-3.5）⇒ 拒绝，不能当正常名字吞掉（自审缺陷①）；
    // 对 `rest` 再查一遍是**廉价防御**（防 normalize 行为变化），实测目前到不了。
    const rest = (unc.groups?.rest ?? '').replace(/\\/g, '/');
    if ([unc.groups?.distro ?? '', ...rest.split('/')].some((s) => s === '.' || s === '..')) {
      return unmappable(raw, 'UNC 的发行版段或余下路径里有 `.`/`..` ⇒ 不是可识别的 UNC');
    }
    return { ok: true, path: stripTail(path.posix.normalize(`/${rest}`)) };
  }

  const drive = DRIVE.exec(win);
  if (drive === null) {
    return unmappable(
      raw,
      '既不是盘符路径，也不是 \\\\wsl.localhost\\<发行版> / \\\\wsl$ 形态的 UNC（相对路径与未知 UNC 都不猜）',
    );
  }
  const letter = (drive[1] ?? '').toLowerCase();
  // 收掉 normalize 给裸盘符补的 `.`（`E:` → `E:.`）；盘符相对路径没有 FS 语义 ⇒ 落到盘根
  const body = (drive[2] ?? '')
    .replace(/^\\+/, '')
    .replace(/\\/g, '/')
    .replace(/^\.$/, '');
  const tail = stripTail(path.posix.normalize(`/${body}`));
  return { ok: true, path: tail === '/' ? `/mnt/${letter}` : `/mnt/${letter}${tail}` };
}

/**
 * WSL 路径 → Windows 路径（REQ-3.2/3.3/3.4）。
 *
 * - `/mnt/<盘>/…` → `<盘>:\…`（盘符大写，Windows 习惯）。
 * - 其他绝对路径：**必须**给 `distro` ⇒ `\\wsl.localhost\<发行版>\…`；不给就 `NoWindowsEquivalent`
 *   （**绝不猜盘符**，REQ-3.4）。
 * 拒绝（`UnmappablePath`）：空串、相对路径、保留字符、含反斜杠、非法发行版名。
 */
export function wslToWin(input: string, distro?: string): PathMappingOutcome {
  if (typeof input !== 'string') {
    return fail('UnmappablePath', `路径必须是字符串，收到 ${typeof input}`);
  }
  const raw = input.trim();
  const invalid = validateInput(raw, 'linux');
  if (invalid !== undefined) return invalid;
  if (!raw.startsWith('/')) return unmappable(raw, '不是绝对 Linux 路径（相对路径没有 Windows 等价形态）');

  const linux = stripTail(path.posix.normalize(raw));

  const mnt = MNT_DRIVE.exec(linux);
  if (mnt !== null) {
    const letter = (mnt[1] ?? '').toUpperCase();
    const rest = linux.slice(mnt[0].length).replace(/^\/+/, '');
    const segs = rest === '' ? [] : rest.split('/');
    return { ok: true, path: path.win32.join(`${letter}:\\`, ...segs) };
  }

  const name = typeof distro === 'string' ? distro.trim() : '';
  if (name === '') {
    return fail(
      'NoWindowsEquivalent',
      `Linux 路径「${raw}」不在 /mnt/<盘> 下，且未提供发行版名 ⇒ 没有 Windows 等价路径（本包不猜盘符）`,
    );
  }
  const badName = validateDistroName(name);
  if (badName !== undefined) return badName;

  const segs = linux === '/' ? [] : linux.slice(1).split('/');
  return { ok: true, path: path.win32.join(`\\\\wsl.localhost\\${name}\\`, ...segs) };
}
