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
 * 本文件只加**四件 003 侧的事**：
 * 1. 用**配置值**优先解析（`source: 'config'`）；
 * 2. 配置值已不存在 ⇒ 落回「无配置」解析并**明示失效**（`staleConfig` + 文案），不静默换一个；
 * 3. **零提问**（REQ-17.2）：模块签名里带一个 `ask` 只为让测试注入计数器断言「从未调用」；
 * 4. **状态调和**（`reconcileDistroState`，2026-10-13 缺陷修复）：让**后到的实证**能回头修正
 *    「`wsl -l -v` 一次性快照」这个唯一来源（详见该函数的注释）。
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
    // 原读数时刻的形态：**没有**被任何后到的实证修正过（那一步在 `reconcileDistroState`）
    stateNote: null,
  };
}

/**
 * 本次装配里「**真的在目标发行版内执行成功**」的只读读取（人话名，用于留痕文案）。
 * 只由**成功**产生（失败不算证据 —— 理由见 `reconcileDistroState`）。
 */
export interface DistroReadEvidence {
  readonly succeededReads: readonly string[];
}

/**
 * **状态调和**（2026-10-13 缺陷修复）：用后到的实证修正「一次性快照」。
 *
 * ## 被修的缺陷（真机可见）
 *
 * `state` 原先**只有**一个来源：装配开头那次 `wsl -l -v` 的快照（`toPanel` 的
 * `matched?.state`）。而用户点「启动并核验」时（`allowColdStart: true`）随后的
 * `docker ps` / `eth0` 读取**会把发行版冷启动起来**（真机实测 12,637ms）⇒ 同一个响应里
 * `distro.state === 'Stopped'` 与 `eth0Ip = 172.20.201.152` + 6 个容器**同时成立**，
 * 页面一边说「状态：Stopped」一边列出容器与地址 ⇒ 用户无从判断该信哪半。
 *
 * ## 判据：实证优先，且必须留痕
 *
 * 一条命令**真的在发行版里跑成功过**，就是「它在跑」的**直接证据**（比快照更新）；
 * 快照是**间接且更旧**的观测 ⇒ 有实证时以实证为准，并把**原读数**与**判据来源**一起留痕
 * （`stateNote`），绝不静默改数据（「静默换一个值」是 `staleConfig` 那条已经定过性的错法）。
 *
 * - `succeededReads` 为空 ⇒ **原样返回**：没有实证就不编状态、也不留痕（否则叫编痕）；
 * - `state === 'Running'` ⇒ 原样返回：本来就没矛盾，留痕只会变成掩盖真修正的噪声；
 * - 否则：`state` 记 `Running`，`distros` 里**同名那一条**一并更正（否则同一个面板自己跟自己
 *   矛盾：「状态：Running」+ 下拉里写着「Ubuntu2204（Stopped）」），**其余条目一字不动**。
 *
 * ## 🔴 为什么只认「成功」，以及为什么不认失败
 *
 * - 失败**不能**当证据：`DistroNotRunning` / `DistroNotFound` / `CommandNotFound` 都发生在
 *   **执行之前**（001 的闸门），它们恰恰说明「这次没跑起来」；`unexpected` 之类更是形态未定。
 *   把「没跑成」当「跑过」会让 `state` 从「旧的错」变成「新的错」。
 * - ⚠️ 已登记但**本轮不做**的相邻情形：`daemon-down` / 非零退出 / 超时**也**说明命令被 spawn 过
 *   ⇒ 严格说它们同样是「在跑」的证据。不纳入的理由是：① 判据会从「拿到过发行版内结果」退化成
 *   「推断发生过 spawn」，需要读 `cause.code` 并与 001 的错误码逐个耦合；② 「Stopped + docker
 *   守护进程未运行」**不构成**明显自相矛盾（停着的发行版足以解释后者），而本缺陷的判据是
 *   **同一响应内两半直接打架**。若主人要求扩到那一层，须单独开工并补判据（不夹带）。
 *
 * ## 🔴 调用位置本身就是判据：必须在**全部**探针之后
 *
 * 探针的准入（`execInDistro` 的 REQ-2.4 闸门）读的就是 `distros` 这个快照。若在探针**之前**
 * 调用本函数，`Stopped` 会被改成 `Running` ⇒ 闸门放行 ⇒ **未经用户同意就冷启动发行版**
 * （10–12 秒 + 拉起全部容器）。故本函数的输出**只进快照**，绝不回喂给任何执行路径；
 * `tests/unit/snapshot-cold-start-state.test.ts` 对「缺省路径 `wsl.exe -d` 执行次数 = 0」直接钉死。
 */
export function reconcileDistroState(panel: DistroPanelData | null, evidence: DistroReadEvidence): DistroPanelData | null {
  if (panel === null) return null;
  if (panel.state === 'Running') return panel;
  if (evidence.succeededReads.length === 0) return panel;

  const raw = panel.state ?? '未列出';
  const who = panel.name ?? '目标发行版';
  return {
    ...panel,
    state: 'Running',
    distros: panel.distros.map((distro): WslDistro => (distro.name === panel.name ? { ...distro, state: 'Running' } : distro)),
    stateNote: `「wsl -l -v」的一次性快照记的是 状态=${raw}，但本次已在「${who}」内成功执行只读命令（${evidence.succeededReads.join('、')}）⇒ 以实证为准记为 Running；下次刷新会重新读 wsl -l -v`,
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
