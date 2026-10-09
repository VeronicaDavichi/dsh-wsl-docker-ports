/**
 * `localhostForwarding` 自读（003 T1.3 / **005 REQ-2.5**）
 *
 * ## 为什么本包自己读，而不是让 001 加一个键
 *
 * 005 REQ-2.5 定案原文：「该键由本包自行读取（单消费者，不进 001）」。001 的公开面有导出预算
 * （REQ-6.4），为一个只有本包用一次的键扩面不划算。**代价**：001 的 `parseWslConfig`（只认
 * `networkingMode`）没有导出，故这里的 INI 子集解析是**第二份实现** —— 只复制骨架（节跟踪 +
 * 注释剥离 + 最后一个键胜出），并且**只在 `[wsl2]` 节里找一个键**。
 * 建议（本次不越界改 001）：001 将来导出「按节取键」的通用纯函数，本文件的解析即可删除。
 *
 * ## 为什么路径解析**不**复制 001 的那 10 行守卫
 *
 * `.wslconfig` 的路径解析有一个实测过的陷阱（`USERPROFILE=''` 时 `??` 不回落、`os.homedir()`
 * 自己会抛 `ERR_SYSTEM_ERROR`、`path.join('', …)` 是**相对路径**会读到工作目录下的同名文件）。
 * 那份守卫的 SSoT 是 001（它已为 `networkingMode` 实现并测试过）⇒ 这里**只借它返回的 `path`**，
 * 守卫逻辑一份也不复制（复制品迟早与 001 分叉，而分叉的后果是静默读错文件）。
 *
 * ## 判定与「不可识别值」的方向（保守）
 *
 * - 文件不存在 / 没有该键 → `true`（WSL 的缺省，REQ-2.2 的「NAT 缺省」就是它）
 * - `true` / `false`（大小写不敏感） → 照实
 * - **其它任何值** → 按 **`false`**（= loopback 也需要显式规则）+ `source: 'fallback'` + `warning`
 *
 * 为什么不可识别值往 `false` 偏：两个方向的错法不对称 ——
 * 说成 `true` 会告诉用户「无需规则」，若其实需要，症状是**连不上且不报错**（原脚本坑 #4 的同类）；
 * 说成 `false` 最多让用户多点一次「应用转发」（一条多余但可见、可移除的规则）。
 * 且这是 `warning` 明示出来的**降级**，不是静默。
 *
 * ## 只读（NFR-2）
 *
 * 本模块**只读**：不写 `.wslconfig`、不改环境、不启动进程（REQ-1.4：修复指引只是文本）。
 * 测试里有静态断言（剥注释后的源码不得出现任何写文件调用）。
 */

import { readFile } from 'node:fs/promises';

import { readNetworkingMode } from 'dsh-wsl-shared';

import { probeFailure, type ProbeFailure } from './probe.ts';

/** 判定来源：`default` = 文件/键不存在；`explicit` = 写清楚了；`fallback` = 值不可识别（保守降级） */
export type LocalhostForwardingSource = 'default' | 'explicit' | 'fallback';

export interface LocalhostForwarding {
  readonly ok: true;
  /** 实际读取的路径（读不到时也在失败态里带上，供 UI 显示「看的是哪个文件」） */
  readonly path: string;
  /** 是否启用（`true` = WSL 自带 localhost 转发 ⇒ loopback 无需 portproxy 规则，005 REQ-2.2） */
  readonly enabled: boolean;
  readonly source: LocalhostForwardingSource;
  /** 配置里的原始值（去两侧空白、**不改大小写**）；文件/键不存在时是 `null` */
  readonly rawValue: string | null;
  /** 降级/异常时必须让用户看见的东西（REQ-2.5「不静默」）；正常时是 `null` */
  readonly warning: string | null;
}

export type LocalhostForwardingOutcome = LocalhostForwarding | ProbeFailure<'config-unreadable'>;

/** 读文件的最小依赖面（测试注入 fake；生产走 `node:fs/promises`） */
export type ReadFileLike = (filePath: string) => Promise<string>;

export interface LocalhostForwardingDeps {
  /** 显式指定路径（给了就不再做默认路径解析） */
  readonly filePath?: string;
  readonly readFile?: ReadFileLike;
  /** 默认路径解析（默认实现走 001 的 `readNetworkingMode()` 取它解析出的 path）—— 仅供测试替换 */
  readonly resolveDefaultPath?: () => Promise<string | undefined>;
}

/** `[section]` 整行（剥注释与 trim 之后仍须**恰好**是这个形态） */
const SECTION_LINE = /^\[([^\]]*)\]$/;
/** 行内注释：`#` 或 `;` 之后全丢（`.wslconfig` 的键值里不会出现这两个字符） */
const INLINE_COMMENT = /[#;].*/;
/** 目标键（大小写不敏感） */
const KEY = 'localhostforwarding';

/**
 * 纯函数：取出 `[wsl2]` 节里 `localhostForwarding` 的**原始值**（未识别成败/未知 ⇒ 返回原串）。
 * 容忍 BOM、CRLF / LF / 单个 CR、整行与行内注释、键值两侧空白、节名大小写；重复键最后一个胜出（INI 惯例）。
 */
export function parseLocalhostForwardingValue(text: string): string | undefined {
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
    if (line.slice(0, separator).trim().toLowerCase() !== KEY) continue;
    rawValue = line.slice(separator + 1).trim();
  }
  return rawValue;
}

/**
 * 默认路径解析：**借 001 的**（它已把 `USERPROFILE=''` 那个陷阱修掉并测过）。
 * `readNetworkingMode()` 在成功与失败**两条路径上都带 `path`**（001 REQ-4.7），
 * 只有「USERPROFILE 为空且取主目录也失败」时才没有路径 —— 那种情况这里如实报错，不猜。
 */
async function defaultConfigPath(): Promise<string | undefined> {
  const mode = await readNetworkingMode();
  return mode.path;
}

/** 把原始值判成 enabled / source / warning */
function judge(rawValue: string | undefined): Pick<LocalhostForwarding, 'enabled' | 'source' | 'rawValue' | 'warning'> {
  if (rawValue === undefined) {
    return { enabled: true, source: 'default', rawValue: null, warning: null };
  }
  const lowered = rawValue.toLowerCase();
  if (lowered === 'true') return { enabled: true, source: 'explicit', rawValue, warning: null };
  if (lowered === 'false') return { enabled: false, source: 'explicit', rawValue, warning: null };
  return {
    enabled: false,
    source: 'fallback',
    rawValue,
    warning:
      `localhostForwarding 的值「${rawValue}」无法识别 —— 已按「loopback 也需要显式规则」处理。` +
      '该键只接受 true / false；请修正 .wslconfig（本插件不会替你改文件）。',
  };
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/**
 * 读 `localhostForwarding`（成功必有 `path`；读不到 ⇒ 可区分原因 + 路径，**不静默按缺省处理**）。
 */
export async function readLocalhostForwarding(
  deps: LocalhostForwardingDeps = {},
): Promise<LocalhostForwardingOutcome> {
  const readFileImpl: ReadFileLike = deps.readFile ?? ((filePath) => readFile(filePath, 'utf8'));
  const resolveDefaultPath = deps.resolveDefaultPath ?? defaultConfigPath;

  let target: string;
  if (deps.filePath !== undefined) {
    target = deps.filePath;
  } else {
    const resolved = await resolveDefaultPath();
    if (resolved === undefined || resolved.trim() === '') {
      return probeFailure({
        reason: 'config-unreadable',
        message: '无法确定 .wslconfig 的位置：USERPROFILE 为空或缺失，且取用户主目录也失败',
        hint: '设置 USERPROFILE 环境变量，或确认当前用户的主目录可访问后重试',
      });
    }
    target = resolved;
  }

  try {
    const rawValue = parseLocalhostForwardingValue(await readFileImpl(target));
    return { ok: true, path: target, ...judge(rawValue) };
  } catch (error) {
    if (errorCodeOf(error) === 'ENOENT') {
      // 文件不存在 = WSL 2 的缺省（`localhostForwarding` 默认 true，REQ-2.2 的「NAT 缺省」）
      return { ok: true, path: target, enabled: true, source: 'default', rawValue: null, warning: null };
    }
    return probeFailure({
      reason: 'config-unreadable',
      message: `读不到 WSL 配置 ${target}（${error instanceof Error ? error.message : String(error)}）`,
      hint: '检查该路径是否可读（本插件只读，不会修改 .wslconfig）',
    });
  }
}
