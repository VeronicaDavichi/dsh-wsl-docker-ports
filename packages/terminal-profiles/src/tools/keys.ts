/**
 * 按键名 → PTY 字节的映射（004 REQ-1.5 / REQ-4.2；design §3）
 *
 * ## 为什么是「纯函数 + 一张表」
 *
 * design §3 明写「新增键名只改表，不改工具逻辑」⇒ 本文件没有分支逻辑，只有一个 `Record` 和两个
 * 薄函数。`write` 工具只负责把结果交给 002 的 `session-manager.write(id, data)`（原样字节，
 * 不经 shell 切词），所以「按什么键」这件事的全部风险都收敛在这张表里。
 *
 * ## 两条口径（REQ-4.2）
 *
 * ① **未识别键名 → 明确失败，不猜、不丢弃**：`decodeKeyName` 返回 `undefined`，由工具层转成
 *    `unknown-key` 的可读结果（附已支持键名清单）。
 * ② **`C-x` 一律 = `\x00` + x**，不是查表硬编码的 26 个字面量 —— 手写 26 个转义序列是抄错一个
 *    就静默坏掉的地方，用一行算术代替。
 *
 * ## 载荷形式：插值而不是字面控制字符
 *
 * 表里存**函数**（`\u0003` 这种字面控制字符在源码里不可读、复制讨论时会丢），于是「ESC 打头的
 * CSI 序列」和「单字节控制码」用同一种写法表达，新增键名不用去想转义写对没有。
 */

/** 一个键名对应的载荷（`() => string` 而不是 `string`：见文件头「插值而不是字面控制字符」） */
type KeyPayload = () => string;

/** 单字节控制码（`code` 是 0–31；`C-a` → 1、`C-c` → 3 …） */
const ctrl = (code: number): KeyPayload => () => String.fromCharCode(code);

/** CSI 序列（ESC + `[` + …；方向键与编辑键都是这一族） */
const csi = (body: string): KeyPayload => () => `\u001b[${body}`;

/** SS3 序列（ESC + `O` + …；F1–F4 的经典形态，与 xterm 的 `xterm-256color` 一致） */
const ss3 = (body: string): KeyPayload => () => `\u001bO${body}`;

/**
 * 键名表（design §3 点名的：`Enter` / `Tab` / `C-c` / `Esc` / 方向键 / `C-d` / `Backspace`；
 * 其余为同一族的常规补齐 —— 补齐项是**加法**，不改变点名项的语义）。
 *
 * 命名口径：主键盘/编辑键用 **xterm 的 DOM 键名**（`Enter` / `Tab` / `Backspace` / `ArrowUp`），
 * 控制组合用 **readline 的 `C-x`** —— 两套记法各自都是消费方（UI / Agent）本来就在说的语言。
 */
const KEY_TABLE: Readonly<Record<string, KeyPayload>> = {
  Enter: ctrl(13), // \r（不是 \n：PTY 的 ICRNL 由行规程决定，这里给最原始的那个）
  Return: ctrl(13),
  Tab: ctrl(9),
  Backspace: ctrl(127), // DEL，与 xterm 的默认 Backspace 一致（REQ-4.2 点名）
  Delete: csi('3~'),
  Insert: csi('2~'),
  Escape: ctrl(27),
  Esc: ctrl(27),
  Space: () => ' ',

  ArrowUp: csi('A'),
  ArrowDown: csi('B'),
  ArrowRight: csi('C'),
  ArrowLeft: csi('D'),
  Home: csi('H'),
  End: csi('F'),
  PageUp: csi('5~'),
  PageDown: csi('6~'),

  F1: ss3('P'),
  F2: ss3('Q'),
  F3: ss3('R'),
  F4: ss3('S'),
  F5: csi('15~'),
  F6: csi('17~'),
  F7: csi('18~'),
  F8: csi('19~'),
  F9: csi('20~'),
  F10: csi('21~'),
  F11: csi('23~'),
  F12: csi('24~'),
};

/** `C-a`–`C-z` 的显式条目（`C-c` / `C-d` 是 design §3 点名的，其余同族） */
const CTRL_KEYS: readonly string[] = [
  'C-a', 'C-b', 'C-c', 'C-d', 'C-e', 'C-f', 'C-g', 'C-h', 'C-i', 'C-j', 'C-k', 'C-l', 'C-m',
  'C-n', 'C-o', 'C-p', 'C-q', 'C-r', 'C-s', 'C-t', 'C-u', 'C-v', 'C-w', 'C-x', 'C-y', 'C-z',
];

/** `C-c` / `Ctrl+c` / `^c` → 归一化成 `C-c`；不是控制组合则返回 `undefined` */
function normalizeCtrlName(name: string): string | undefined {
  const normalized = name.trim();
  const match = /^(?:C-|Ctrl\+|ctrl\+|\^)([A-Za-z])$/.exec(normalized);
  return match === null ? undefined : `C-${match[1]!.toLowerCase()}`;
}

/** 已支持键名清单（**排序后**：`unknown-key` 的可读提示要稳定、可 diff） */
export function supportedKeyNames(): readonly string[] {
  return [...Object.keys(KEY_TABLE), ...CTRL_KEYS].sort();
}

/**
 * 键名 → 载荷字节；未识别返回 `undefined`（**不猜、不兜底**，REQ-4.2）。
 *
 * 大小写口径：`Enter` / `enter` 都认（Agent 不是编译器，键名大小写不该是失败原因）；
 * 但 **`C-` 前缀的大小写要按控制组合处理**（`C-C` 与 `C-c` 同一个键）。
 */
export function decodeKeyName(name: string): string | undefined {
  const raw = name.trim();
  const ctrlName = normalizeCtrlName(raw);
  if (ctrlName !== undefined) {
    const letter = ctrlName.charCodeAt(2) - 97; // 'a' → 0
    return ctrl(letter + 1)();
  }
  const direct = KEY_TABLE[raw];
  if (direct !== undefined) return direct();
  // 大小写宽松：只在**唯一**命中时接受（`esc` / `ENTER`），避免把 `PageUp` 与 `pageup` 之外的东西猜进来
  const lower = raw.toLowerCase();
  const hits = Object.keys(KEY_TABLE).filter((key) => key.toLowerCase() === lower);
  return hits.length === 1 ? KEY_TABLE[hits[0]!]!() : undefined;
}

/**
 * `write` 的载荷口径（REQ-1.5 + REQ-4.2）与它的**唯一**判别式。
 *
 * 需求把两种调用挤进同一个 `data` 参数：① 「按键」——design §3 点名的键名；② 「发文本」——
 * design §6 要求「字节原样，不经 shell 切词」。判别式只能从形状来，本实现定成三条（**按序**）：
 *
 * 1. **键名表命中** → 按键发（`Enter` → `\r`、`C-c` → `\x03`、`ArrowUp` → CSI …）；
 * 2. 长度恰为 **1** 的字符 → 按字面发。键名表里**没有**任何单字符条目（最短的 `Esc`/`Tab` 也是
 *    三字符）⇒ 单字符永远不会与键名抢；`"a"` 想发字母 a 这种最常见的输入必须能用；
 * 3. 其余（多字符、非键名）→ 只有**看着像键名**时才拒绝（见 `looksLikeKeyName`），否则按字面发。
 *
 * ## 为什么第 3 条要「看着像」而不是「一律拒绝」
 *
 * REQ-4.2 的判据是「**未识别的按键名** ⇒ 错误，不猜、不丢弃」。语义上「按键」是**指名某个键**，
 * 而 `ls -la` 是个命令：它带着空白，不可能是键名。若把「表外的一切」都判成 `unknown-key`，
 * 模块最常见的用法（发一条命令）会当场红 —— 那是把 REQ-1.5 做坏来满足 REQ-4.2。
 * ⇒ 判据收窄为「**单 token、无空白、看起来就是个键名**（`C-x` / 首字母大写的驼峰 / `^x`）」。
 * 代价（**已知取舍，见交付报告的「关键取舍」**）：单 token、首字母大写、又恰好不是键名的文本
 * （例如想发 `Hello`）会被判成 `unknown-key`；绕法是带上分隔（`Hello ` 或 `"Hello"`）。
 */
export function looksLikeKeyName(data: string): boolean {
  if (data.length === 0 || /\s/.test(data)) return false;
  return /^(\^|C-|Ctrl\+)/i.test(data) || /^[A-Z]/.test(data);
}

/**
 * `data` → 真正写进 PTY 的字节（`''` 表示**未识别的按键名**，REQ-4.2）。
 *
 * 返回空串作为失败信号是安全的：**调用方（`register.ts` 的 `write`）在进体前就把空串判掉**
 * （`bytes === ''` ⇒ `unknown-key`，REQ-4.2 的「不猜、不丢弃」）—— 这条不变式让本函数不必引入
 * 第二个返回值。
 *
 * 🔴 2026-10-09 订正：原注释的理由是「schema 层有 `minLength: 1`」，而集成时读真源码发现值 schema
 * DSL **没有** `minLength` 键（`dsh-tools/lib/types/schema.js` 的作者键白名单）⇒ 该键已删、不变式
 * 改由**运行期**第一道判断承担；判据（空串绝不写出去）没变，证据见
 * `tests/unit/tools-real-define.test.ts` 与 `tools-lifecycle.test.ts` 的空串用例。
 */
export function decodeWritePayload(data: string): string {
  const byName = decodeKeyName(data);
  if (byName !== undefined) return byName;
  if (data.length === 1) return data; // 第 2 条：单字符按字面发（键名表里没有单字符条目）
  return looksLikeKeyName(data) ? '' : data;
}
