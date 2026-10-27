/**
 * 原始输出脱敏（003 design §9「信息泄露」行 + REQ-3.5）
 *
 * 为什么必须有这一层：REQ-3.5 要求「报错并展示**脱敏后**的原始输出」。
 * 原始输出是**外部进程的字节**，可能带凭据（`docker ps` 的 `Labels` 里可能有
 * `PASSWORD=` / 带 token 的镜像仓库地址、`Command` 里可能有 `-p<密码>`），
 * 也可能带用户名（`C:\Users\<name>\…` 路径）。把它原样贴进 UI = 把用户自己的秘密
 * 送上屏幕（还会进截图与日志）。故**展示路径只走这里**，绝不直接贴原文。
 *
 * ## 三条规则与取舍
 *
 * 1. **掩掉「键=值」形态的秘密**：`password / passwd / pwd / token / secret / api_key / authorization / credential`
 *    后面跟 `:` 或 `=` 的内容全丢。宁可多掩（把普通值也掩掉只是少看一行），不可少掩。
 * 2. **掩掉 Windows 用户目录名**：`C:\Users\<name>` → `C:\Users\<user>`。用户名是个人信息，
 *    且与本插件的诊断无关；**不**动 Linux 侧路径（`/mnt/e/...` 对本机用户不构成泄露，
 *    而它恰恰是判断「挂载对不对」的关键证据 —— 全掩掉反而让这份输出失去意义）。
 * 3. **截断**：原文可能很长（19 条规则 × 若干行、docker 6 容器 × 每行 500 字符），
 *    UI 面板装不下、日志也装不下。截断处**必须写明原文长度**（否则看的人会以为输出就这么点）。
 *
 * 正则刻意**每次调用现造**（不用模块级 `带 /g 的常量`）：带 `g` 的正则对象有 `lastIndex` 状态，
 * 跨调用复用是这套代码里被抓过一次的同类坑（见 001 `net.ts` 的注释）。
 */

const MAX_CHARS = 4000;

/** 会被当值掩掉的键名（大小写不敏感、`_` 与 `-` 等价） */
const SECRET_KEYS = 'password|passwd|pwd|token|secret|api[-_]?key|authorization|credential';

export function redactOutput(text: string, maxChars: number = MAX_CHARS): string {
  const masked = text
    // 先清控制字符（保留 \n 与 \t）：ANSI 颜色码、退格等会让 UI 面板串行
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(new RegExp(`\\b(${SECRET_KEYS})\\b(\\s*[:=]\\s*)\\S+`, 'gi'), '$1$2<已脱敏>')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, 'C:\\Users\\<user>');

  if (masked.length <= maxChars) return masked;
  return `${masked.slice(0, maxChars)}\n…（已截断，原文共 ${String(masked.length)} 字符）`;
}
