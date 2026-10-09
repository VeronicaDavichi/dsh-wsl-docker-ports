/**
 * 目标发行版解析（003 T5.8 / REQ-17）—— **宿主侧**装配件（T6.8 从 `src/client/` 迁到 `src/`）
 *
 * 📌 **迁移留痕**：本文件原先住在 `src/client/`。T6.8 的宿主快照装配要复用它（它是 T5.8
 * 「配置失效回落」的唯一实现），而宿主半**不能** import `src/client/**`：`tsconfig.build.json`
 * 的 `exclude` 拦不住被 import 的文件（实测它们照样进 program 并被 emit 成 `lib/client/*.js`），
 * 那会让宿主产物里混进客户端代码、破坏两半的边界。
 * 迁移本身**零逻辑改动**（只把 `DistroPanelData` 的来源从 `./host.ts` 换成 `./wire.ts`），
 * `tests/unit/client-distro.test.ts` 的断言一条未动，只改了 import 路径。
 *
 * ## 四态来源 + 失效回落
 *
 * 复用 **001 的 REQ-1.7**（`resolveDistro`）——不自己再判一遍，否则「为什么是它」会有两份口径。
 * 本文件只加**三件 003 侧的事**：
 * 1. 用**配置值**优先解析（`source: 'config'`）；
 * 2. 配置值已不存在 ⇒ 落回「无配置」解析并**明示失效**（`staleConfig` + 文案），不静默换一个；
 * 3. **零提问**（REQ-17.2）：模块签名里带一个 `ask` 只为让测试注入计数器断言「从未调用」。
 *
 * ## 只读 `wsl -l -v`
 *
 * `listDistros` 只跑 `wsl.exe -l -v`。**绝不**用 `wsl -d <name> -- true` 之类去探状态 ——
 * 那会冷启动发行版（真机 10–12 秒 + 拉起全部容器，001 REQ-2.4 明令禁止自动路径这么做）。
 * 测试里对全部执行调用做 argv 扫描断言「没有 `-d`」。
 */

import { listDistros, resolveDistro } from 'dsh-wsl-shared';
import type { DistroSource, Executor, WslDistro, WslSharedError } from 'dsh-wsl-shared';

import type { DistroPanelData } from './wire.ts';

export interface DistroPanelDeps {
  readonly executor: Executor;
  /** 配置里的目标发行版（缺省 / 空串都当「没配」） */
  readonly configured?: string | undefined;
  /**
   * **只为可断言性存在**：本模块从不调用它。
   * REQ-17.2「SHALL NOT 追问用户」在测试里的落地方式 = 注入一个计数 fake，断言调用数 0。
   */
  readonly ask?: (question: string) => Promise<string>;
}

export interface DistroPanelOutcome {
  readonly data: DistroPanelData | null;
  readonly error: string | null;
}

const SOURCE_TEXT: Readonly<Record<DistroSource, string>> = {
  config: '配置指定',
  wslDefault: 'WSL 默认发行版（`wsl -l -v` 的 `*`）',
  onlyOne: '本机唯一发行版',
  first: '本机首个发行版',
};

export function distroSourceText(source: DistroSource): string {
  return SOURCE_TEXT[source];
}

function toPanel(distros: readonly WslDistro[], resolution: { name: string; source: DistroSource }, stale: string | null): DistroPanelData {
  const matched = distros.find((distro) => distro.name === resolution.name);
  return {
    distros,
    name: resolution.name,
    state: matched?.state ?? null,
    source: resolution.source,
    staleConfig: stale !== null,
    message: stale,
  };
}

function errorOf(value: WslSharedError): string {
  return value.message;
}

/**
 * 解析目标发行版。**不抛异常**：任何失败都变成 `{ data: null, error }`，
 * UI 仍有只读展示（REQ-10.3 的同一条口径：缺服务/缺数据不崩）。
 */
export async function loadDistroPanel(deps: DistroPanelDeps): Promise<DistroPanelOutcome> {
  const listed = await listDistros(deps.executor);
  if (!listed.ok) return { data: null, error: errorOf(listed) };

  const distros = listed.distros;
  const configured = deps.configured?.trim();

  if (configured !== undefined && configured !== '') {
    const preferred = resolveDistro(distros, configured);
    if (preferred.ok) return { data: toPanel(distros, preferred, null), error: null };

    // 配置已失效：落回「无配置」解析，并把失效事实**明说**（不静默换一个）
    const fallback = resolveDistro(distros, undefined);
    if (!fallback.ok) {
      return {
        data: null,
        error: `${errorOf(preferred)}；且无可用回落：${errorOf(fallback)}`,
      };
    }
    return {
      data: toPanel(distros, fallback, `配置里的发行版「${configured}」已不存在（${errorOf(preferred)}）⇒ 已按 ${distroSourceText(fallback.source)} 回落为「${fallback.name}」，请确认后保存`),
      error: null,
    };
  }

  const fallback = resolveDistro(distros, undefined);
  if (!fallback.ok) return { data: null, error: errorOf(fallback) };
  return { data: toPanel(distros, fallback, null), error: null };
}
