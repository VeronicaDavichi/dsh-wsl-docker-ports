/**
 * 静态守卫的共享脚手架：读 `src/` 全树 + 剥注释（**复用 001 的 SSoT**）
 *
 * ## 为什么抽出来
 *
 * 005 T3.1/T3.6 与 003 T6.6 都要「扫整个 `src/` 的**可执行文本**」。若各写一份走目录 + 各写一份
 * 剥注释正则，就又造出两处口径分叉 —— 而分叉的症状是**一道门悄悄失去判据**（AGENTS.md 原话）。
 * 剥注释一律 import 001 的 `scripts/strip-comments.mjs`；这里只是把它收窄成带类型的形状。
 *
 * ## 为什么用 `keepLines: true`
 *
 * 块注释按内部换行数替换成等量 `\n` ⇒ 行号与原文一一对应，断言失败能指到**真实行号**。
 *
 * ## 已知局限（继承 SSoT，不粉饰）
 *
 * SSoT 的正则只是启发式、不是 AST；检查对象是本包自己的源文件、形状受控，故接受。
 * 若将来出现误判，先补用例再改正则（SSoT 文件头已写明这条纪律）。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

// @ts-expect-error TS7016：001 的 `strip-comments.mjs` 是 dev 脚本、无类型声明。这里只借它的**口径**，
// 不为它新增 `.d.ts`（那会动另一个包的公开面）；形状由下面这次收窄钉住。
import { stripComments as stripCommentsUntyped } from '../../../wsl-shared/scripts/strip-comments.mjs';

/** 剥注释（口径 = 001 的 SSoT 实现） */
export const stripComments = stripCommentsUntyped as (
  source: string,
  options?: { readonly keepLines?: boolean },
) => string;

export interface Source {
  /** 相对**包根**的 POSIX 路径（如 `src/read/netsh-probe.ts`），用于白名单断言与报错 */
  readonly path: string;
  /** 原文（含注释）—— 「注释里也不许出现」这类判据看它 */
  readonly raw: string;
  /** 去注释后（行号对齐）—— 「可执行文本」这类判据看它 */
  readonly code: string;
}

/** `packages/<pkg>/src/` 的绝对路径（从 `tests/helpers/` 或 `tests/unit/` 都是上两级） */
const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));

/** 读 `src/` 全树（递归；只收 `.ts`） */
export function srcSources(): Source[] {
  const sources: Source[] = [];
  for (const entry of readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    // ⚠️ 递归 Dirent 的 `name` 只有 basename，绝对路径要靠 `parentPath` 拼
    const absolute = join(entry.parentPath, entry.name);
    const raw = readFileSync(absolute, 'utf8');
    sources.push({
      path: `src/${relative(SRC_DIR, absolute).split(sep).join('/')}`,
      raw,
      code: stripComments(raw, { keepLines: true }),
    });
  }
  return sources;
}

/** 命中某模式的相对路径清单（去重、排序）—— 用来做「落点白名单」断言 */
export function filesMatching(sources: readonly Source[], pattern: RegExp, pick: (source: Source) => string): string[] {
  return [...new Set(sources.filter((source) => pattern.test(pick(source))).map((source) => source.path))].sort();
}

/** 逐个 needle 扫 `src/` 全树（返回可读命中清单，供 `assert.deepEqual(hits, [])`） */
export function scanFor(
  sources: readonly Source[],
  needles: readonly string[],
  pick: (source: Source) => string,
): string[] {
  const hits: string[] = [];
  for (const source of sources) {
    const text = pick(source);
    for (const needle of needles) if (text.includes(needle)) hits.push(`${source.path} 含 ${needle}`);
  }
  return hits;
}
