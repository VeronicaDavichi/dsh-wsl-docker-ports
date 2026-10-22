/**
 * 宿主侧**快照装配**（003 T6.8）：把已实现已测的只读部件拼成 `PortsSnapshot`
 *
 * ## 只做「拼装」，不新增任何一种读法
 *
 * 每一步都是一对一委派给既有部件（依赖方向 = 001 → 003 read → 003 diff）：
 *
 * | 快照字段 | 来源（已实现已测） |
 * | --- | --- |
 * | `nat` | 001 `readNetworkingMode()`（`.wslconfig` 自读） |
 * | `distro` / `distroError` | 001 `listDistros()` + `resolveDistro()`（`state` 另经**状态调和**，见下） |
 * | `docker` | `read/docker-probe.ts` `probeDockerPs()`（超时 + 重试 + 三类失败） |
 * | 规则 | `read/netsh-probe.ts` `probePortproxyRules()` |
 * | eth0 | `read/eth0-source.ts` `createEth0Source().probe()` |
 * | `localhostForwarding` | `read/localhost-forwarding.ts` |
 * | `diff` | `diff/engine.ts` `diff()`（纯函数） |
 * | 脱敏 | `read/redact.ts` `redactOutput()`（**所有**贴进 UI 的原文都过它） |
 *
 * ## `distro.state`：装配末尾要做一次**状态调和**（2026-10-13 缺陷修复）
 *
 * `wsl -l -v` 是装配**开头**的一次性快照，而 `docker ps` / `eth0` 在**之后**才真跑命令；
 * 用户点「启动并核验」（`allowColdStart: true`）时那次执行会把发行版冷启动起来（真机 12,637ms）
 * ⇒ 同一个响应里 `distro.state === 'Stopped'` 与「已取到 eth0 + 6 个容器」直接打架。
 * 故在**全部探针之后**调 `reconcileDistroState()`：有发行版内读取成功 ⇒ 以实证为准记为
 * `Running` 并留痕（`stateNote`，含原读数与判据来源）。
 *
 * 🔴 **调用点固定在探针之后是判据、不是风格**：探针的准入（`execInDistro` 的 001 REQ-2.4 闸门）
 * 读的就是 `distros` 这个快照 —— 提前调和会让 `Stopped` 变成 `Running` ⇒ 闸门放行 ⇒
 * **未经用户同意就冷启动发行版**。故调和结果**只进快照**，绝不回喂任何执行路径。
 *
 * ## 三类失败各有各的位置（这是本文件最重要的设计决定）
 *
 * 1. **读不到 netsh 规则** ⇒ **路由级错误** `rules-unavailable`（`ok:false`）。
 *    拿不到规则却回空集合等于「用空列表冒充没有容器」（REQ-1.3 的同一口径）：
 *    每个受管端口都会假报 `missing`，用户会去加一堆不该加的规则。宁可报错。
 * 2. **读不到 docker** ⇒ 快照内 `docker.ok:false`（原有形状），页面照渲染 + 给引导。
 * 3. **取不到 eth0 / 发行版解析失败** ⇒ 快照内 `diff.ok:false` / `distroError`（T5.4 分支）。
 *
 * ## 装载期零外部命令
 *
 * 本模块**只导出工厂**：所有探针都在 `build()` 内被调用，工厂本身一条命令都不跑
 * （T6.7 已钉过的那条判据，在 T6.8 的 `route.test.ts` 里对整条路由再钉一次）。
 */

import { readNetworkingMode } from 'dsh-wsl-shared';
import type { Executor, NetworkingMode, NetworkingModeOutcome, WslSharedError } from 'dsh-wsl-shared';
import { diff } from './diff/engine.ts';
import { parseManagedPorts } from './diff/managed-ports-parse.ts';
import type { ManagedPorts } from './diff/managed-ports.ts';
import type { Scope } from './diff/types.ts';
import { loadDistroPanel, reconcileDistroState } from './distro.ts';
import { probeDockerPs } from './read/docker-probe.ts';
import type { DockerPsOptions, DockerPsOutcome } from './read/docker-probe.ts';
import { createEth0Source } from './read/eth0-source.ts';
import type { Eth0SourceOptions, Eth0Source } from './read/eth0-source.ts';
import { probeLocalAddresses } from './read/local-addresses.ts';
import type { LocalAddressesOptions } from './read/local-addresses.ts';
import { readLocalhostForwarding } from './read/localhost-forwarding.ts';
import type { LocalhostForwardingDeps } from './read/localhost-forwarding.ts';
import { probePortproxyRules } from './read/netsh-probe.ts';
import type { NetshProbeOptions } from './read/netsh-probe.ts';
import { redactOutput } from './read/redact.ts';
import type { PortsErrorCode, DistroPanelData, DockerView, NatGateView, PortsSnapshot, SnapshotDeclaration } from './wire.ts';

/** 装配依赖面（**全部可注入** ⇒ 离线测试零真机、零真实进程） */
export interface SnapshotDeps {
  readonly executor: Executor;
  /** `.wslconfig` 的 localhostForwarding 读取面（测试注入 fake 路径/读文件） */
  readonly localhostForwarding?: LocalhostForwardingDeps | undefined;
  readonly netsh?: NetshProbeOptions | undefined;
  readonly docker?: DockerPsOptions | undefined;
  readonly eth0?: Eth0SourceOptions | undefined;
  /** 012：候选监听地址探针（`timeoutMs` 可覆盖；**不注入探针本身**，改用假执行器走真解析） */
  readonly localAddresses?: LocalAddressesOptions | undefined;
  /** 覆盖 nat 判定（默认 001 的 `readNetworkingMode()`）；测试用来构造 mirrored / unreadable 形状 */
  readonly readNetworkingMode?: (() => Promise<NetworkingModeOutcome>) | undefined;
  /** 提权是否可用（**只影响写控件门禁**；默认 `false` = 保守）。由 `plugin.ts` 注入 005 的探测 */
  readonly elevationAvailable?: (() => Promise<boolean>) | undefined;
  /** 002 的 `managedTerminal` 是否已加载（只影响文案，REQ-10.3） */
  readonly execAvailable?: (() => boolean) | undefined;
  /** `Date.now()` 注入（测试要固定时间戳） */
  readonly now?: (() => number) | undefined;
}

/** 装配结果：要么一份快照，要么一个**路由级**错误（只有 `rules-unavailable` / `internal`） */
export type SnapshotOutcome =
  | { readonly ok: true; readonly snapshot: PortsSnapshot }
  | { readonly ok: false; readonly code: Extract<PortsErrorCode, 'rules-unavailable' | 'internal'>; readonly message: string };

export interface SnapshotBuilder {
  /** 现读事实 + 用传入的声明判决 ⇒ 一份完整快照。**零写操作、零提权**。 */
  build(declaration: SnapshotDeclaration, options?: { readonly allowColdStart?: boolean }): Promise<SnapshotOutcome>;
}

/** `.wslconfig` 的 `networkingMode` 判定 → 快照里的 NAT 门（逐字覆盖四态，不多不少） */
export function natGateOf(outcome: NetworkingModeOutcome): NatGateView {
  if (!outcome.ok) {
    return {
      kind: 'unreadable',
      // 路径读不出来时留空串：`rows.ts` 的 `buildNatGuide` 会补 `%USERPROFILE%\.wslconfig` 兜底
      path: '',
      message: `读不到 .wslconfig，无法判定 networkingMode（${
        (outcome as WslSharedError).code
      }）：非 NAT 会让转发规则指向失效地址，故一律按「不可用」处理`,
    };
  }
  const readable: NetworkingMode = outcome;
  if (readable.mode === 'nat' || readable.mode === 'default') {
    return { kind: 'nat', mode: readable.mode, path: readable.path };
  }
  return {
    kind: 'non-nat',
    mode: readable.mode === 'mirrored' ? 'mirrored' : 'other',
    path: readable.path,
    rawValue: readable.rawValue ?? null,
  };
}

/** docker 探针结果 → 快照里的 docker 视图（成功/失败两态；失败**不带** argv，形状由 wire 钉死） */
function dockerViewOf(outcome: DockerPsOutcome): DockerView {
  if (outcome.ok) {
    return { ok: true, containers: outcome.containers, emptyAfterRetry: outcome.emptyAfterRetry, argv: outcome.argv, ...(outcome.containerListNote === undefined ? {} : { containerListNote: outcome.containerListNote }) };
  }
  return { ok: false, reason: outcome.reason, message: outcome.message, hint: outcome.hint, raw: outcome.raw };
}

const EMPTY_MANAGED: ManagedPorts = [];

export function createSnapshotBuilder(deps: SnapshotDeps): SnapshotBuilder {
  const now = deps.now ?? ((): number => Date.now());
  const readNat = deps.readNetworkingMode ?? ((): Promise<NetworkingModeOutcome> => readNetworkingMode());
  const elevationAvailable = deps.elevationAvailable ?? ((): Promise<boolean> => Promise.resolve(false));
  const execAvailable = deps.execAvailable ?? ((): boolean => false);

  return {
    async build(declaration: SnapshotDeclaration, options = {}): Promise<SnapshotOutcome> {
      try {
        // ① NAT 门（REQ-1.1）：读 `.wslconfig`，纯文件读，失败 ⇒ `unreadable`（按不可用处理）
        const nat = natGateOf(await readNat());

        // ② 发行版：**复用 T5.8 的唯一实现**（含「配置失效回落」语义）⇒ 不自己再判一遍
        const panel = await loadDistroPanel({ executor: deps.executor, ...(declaration.distro === undefined ? {} : { configured: declaration.distro }) });
        const distro: DistroPanelData | null = panel.data;
        const distroError = panel.error;
        const target = distro === null ? null : { name: distro.name as string, distros: distro.distros };

        // ③ 规则：**这是唯一会变成路由级失败的读**（理由见文件头 1.）
        const rulesOutcome = await probePortproxyRules(deps.executor, deps.netsh ?? {});
        if (!rulesOutcome.ok) {
          return {
            ok: false,
            code: 'rules-unavailable',
            message: redactOutput(`${rulesOutcome.message}${rulesOutcome.hint.length > 0 ? `（${rulesOutcome.hint}）` : ''}`),
          };
        }

        // ④ docker：失败照旧进快照（REQ-2.3 的三类失败各有引导文案）
        //
        // 2026-10-22：**先试 `docker ps -a`（含已停止）**，失败就退回只看运行中并留下原因。
        // 为什么必须回落：本机实测只要存在一个坏容器（`rw layer snapshot not found`），
        // `docker ps -a` 就整体退出码 1 ⇒ 如果不回落，主人会因为「一个坏容器」丢掉整张容器表
        // —— 那比「看不到 stopped」严重得多。
        const probeOptions = {
          ...(deps.docker ?? {}),
          ...(options.allowColdStart === undefined ? {} : { allowColdStart: options.allowColdStart }),
        };
        const allOutcome = target === null ? null : await probeDockerPs(deps.executor, target.name, target.distros, { ...probeOptions, allContainers: true });
        const probeTarget = target === null ? null : { name: target.name, distros: target.distros };
        const dockerOutcome: DockerPsOutcome | null =
          allOutcome === null || allOutcome.ok
            ? allOutcome
            : await (async (): Promise<DockerPsOutcome> => {
                if (probeTarget === null) return allOutcome;
                const runningOnly = await probeDockerPs(deps.executor, probeTarget.name, probeTarget.distros, { ...probeOptions, allContainers: false });
                // 两个都失败 ⇒ 报**原始**失败（`-a` 的原因更有信息量），不静默装作成功
                if (!runningOnly.ok) return allOutcome;
                return { ...runningOnly, containerListNote: `列表只含运行中的容器：docker ps -a 失败（${allOutcome.message}）` };
              })();

        // ⑤ eth0：取不到 ⇒ null ⇒ 引擎给 `diff.ok:false`（T5.4 分支，一条判决都不给）
        const eth0Source: Eth0Source | null =
          target === null ? null : createEth0Source(deps.executor, target.name, target.distros, deps.eth0 ?? {});
        const eth0Outcome = eth0Source === null ? null : await eth0Source.probe(options.allowColdStart === undefined ? {} : { allowColdStart: options.allowColdStart });
        const eth0Ip = eth0Outcome !== null && eth0Outcome.ok ? eth0Outcome.ip : null;

        // ⑤.b 状态调和（003 缺陷修复）：把「后到的实证」接回 ② 那次一次性快照。
        // 只认**成功**的发行版内读取（失败不能当证据：闸门挡下的那类失败恰恰说明「没跑起来」）。
        // 🔴 位置是判据的一部分：必须在**全部**探针之后，理由见文件头「`distro.state`」一节。
        const succeededReads: string[] = [];
        if (dockerOutcome !== null && dockerOutcome.ok) succeededReads.push('docker ps');
        if (eth0Outcome !== null && eth0Outcome.ok) succeededReads.push('eth0 地址');
        const distroView = reconcileDistroState(distro, { succeededReads });

        // ⑥ `.wslconfig` 的 localhostForwarding（读不到 ⇒ null = 「不知道」，不冒充 false）
        const forwarding = await readLocalhostForwarding(deps.localhostForwarding ?? {});
        const localhostForwarding = forwarding.ok ? forwarding.enabled : null;

        // ⑥.b 候选监听地址（012 REQ-1.1/2.1）：**读失败只降级这一栏**（列表空 + 原因），页面其余照旧。
        //     排在这里的理由与 netsh 不同：它不是判决输入，失败绝不升级成路由级错误。
        const localAddressesOutcome = await probeLocalAddresses(deps.executor, deps.localAddresses ?? {});
        const localAddresses = localAddressesOutcome.ok ? localAddressesOutcome.addresses : [];
        const localAddressesError = localAddressesOutcome.ok ? null : localAddressesOutcome.message;

        // ⑦ 声明解析（宿主只把它当声明；事实一律现读）+ 纯判决
        const parsed = parseManagedPorts(declaration.managedPorts);
        const managedPorts = parsed.ok ? parsed.ports : EMPTY_MANAGED;
        const scopes: Readonly<Record<string, Scope>> = declaration.scopes;
        const outcome = diff({
          containers: dockerOutcome !== null && dockerOutcome.ok ? dockerOutcome.containers : [],
          managedPorts,
          rules: rulesOutcome.rules,
          eth0Ip,
          localhostForwarding: localhostForwarding ?? false,
          scopes,
          // 012 决策 1/2：候选清单里的 IP **不是**冲突（否则用户刚选的具体 IP 会被判 conflict）；
          // 但也不会因此被当成「本插件默认形态」—— 判决仍按五态事实给，只是不再报形态冲突。
          allowedListenAddresses: localAddresses.map((entry) => entry.address),
        });

        return {
          ok: true,
          snapshot: {
            refreshedAt: now(),
            nat,
            docker:
              dockerOutcome !== null
                ? dockerViewOf(dockerOutcome)
                : {
                    ok: false,
                    reason: 'distro-unresolved',
                    message: distroError ?? '目标发行版未解析',
                    hint: '先修复发行版解析（见「目标发行版」一栏）：Docker 探测必须钉在一个确定的发行版上',
                    raw: null,
                  },
            localhostForwarding,
            diff: outcome,
            scopes,
            managedPortsDecl: declaration.managedPorts,
            distro: distroView,
            distroError,
            elevationPolicy: declaration.elevationPolicy,
            elevationAvailable: await elevationAvailable(),
            execAvailable: execAvailable(),
            // 🔴 诚实值：本轮**没有**实现 iphlpsvc 探测（Spec 未要求，且它不在任何判据里）⇒
            // 一律 `null`（= 未探测）。不写 `true`/`false` 是因为那两个值都会变成一条**没测过**的断言。
            iphlpsvcRunning: null,
            localAddresses,
            localAddressesError,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, code: 'internal', message: redactOutput(`装配快照时抛出未预期异常：${message}`) };
      }
    },
  };
}

