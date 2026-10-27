/**
 * 012：计划阶段的**监听地址解析**（从 `transport/plan.ts` 拆出，只为 NFR-5 的 ≤400 行）
 *
 * ## 一处解析、两种来源
 *
 * 地址有两个来源，优先级 = **请求覆盖 > 配置持久化 > 缺省**：
 * - 请求：`target.listenAddress`（`/write/plan|apply` 的 body 可选字段）；
 * - 配置：`facts.listenAddresses(port)`（= 宿主 `config-read.ts` 现读的 `listenAddresses[端口]`）。
 *
 * `''` / `'0.0.0.0'` 一律归一化成 `undefined` —— 那就是 012 之前的「所有网卡」形态，
 * 于是**缺省路径逐字同 010**（连候选网卡的探测次数都不增加）。
 *
 * ## fail-closed 的两个输入
 *
 * 选了具体 IP 时必须同时给出：
 * 1. `allowedListenAddresses`（候选清单 —— 证明「这个 IP 属于本机物理网卡」）；
 * 2. `listenAddressPrefixLength`（候选条目自己的掩码长度 —— 算放行网段用；缺席则计划层按 /32）。
 *
 * 候选清单**懒加载**：一次规划至多枚举一次，且只有真的选了具体 IP 才枚举。读失败由调用方
 * （`computePlan`）盘成 503 —— **不能**把「读不到网卡」降级成「没有网卡」，否则所有具体地址都会
 * 被静默拒绝。
 *
 * ## 2026-10-23（真机缺陷 F1）：另外两个只读出口
 *
 * 形态判据（「这条既有规则是不是本插件写的」）还要两个事实，但它们**不是**选择门的 fail-closed 输入：
 *
 * - `configured(port)`：配置里该端口登记过的地址（同步现读，没有 IO）；
 * - `candidates()`：候选清单的**地址数组**，**懒**读、**读失败降级为 `[]`**（不抛）。
 *
 * 为什么降级、为什么与 `resolve()` 区别对待：`resolve()` 决定「能不能写这个地址」（选了一个
 * 无法证明属于本机的地址 ⇒ 一个字节都不能写 ⇒ 必须 503/拦下）；而形态判据回答「既有规则算不算
 * 我写的」—— 把「读不到网卡」当成「没有网卡」，最坏结果只是少认一类地址（退回两个默认值 + 配置值，
 * 与修复前一致），**不该**让用户的 `remove` / `fix` 因为一次枚举失败而 503。
 */

import type { LocalAddressEntry } from 'dsh-wsl-docker-core';
import type { AllowedListenFacts } from '../diff/listen-allowed.ts';
import type { WritePlanInput } from '../write/types.ts';

/** 解析所需的两个现读来源（与 `PlanFacts` 的同名成员同形；缺省 = 该来源不存在） */
export interface ListenSources {
  readonly listenAddresses?: ((port: number) => string | undefined) | undefined;
  readonly localAddresses?: (() => Promise<readonly LocalAddressEntry[]>) | undefined;
}

/** 解析结果 = `WritePlanInput` 上那三个相关字段（可选键，缺席即不改形态） */
export type ListenInput = Pick<WritePlanInput, 'listenAddress' | 'allowedListenAddresses' | 'listenAddressPrefixLength'>;

export interface ListenResolver {
  /**
   * 该端口的三个地址字段（`{}` = 不选具体 IP ⇒ 010 形态）。
   *
   * @param tolerateUnreadable 候选清单读不到时**不抛**（只返回 `listenAddress`）：仅当「重写该端口
   *   既有规则自己的监听地址」（`listenAddressInPlace`）时为 `true` —— 那一刻不需要清单背书，
   *   网段会退化成 `/32`（更窄）。缺省 `false` ⇒ 保持 012 的 fail-closed（读不到 = 503）。
   */
  resolve(port: number, override: string | undefined, tolerateUnreadable?: boolean): Promise<ListenInput>;
  /** 该端口在配置里登记过的监听地址（`''` / `'0.0.0.0'` ⇒ `undefined`）；**同步现读** */
  configured(port: number): string | undefined;
  /**
   * 候选清单的地址数组（**懒**：第一次调用才枚举；**读失败降级为 `[]`、不抛**）。
   * 只供形态判据用；选择门仍走 `resolve()` 的 fail-closed 路径。
   */
  candidates(): Promise<readonly string[]>;
}

/** `''` / `'0.0.0.0'` / 纯空白 ⇒ 没有具体地址 */
function normalize(value: string | undefined): string | undefined {
  const text = (value ?? '').trim();
  return text === '' || text === '0.0.0.0' ? undefined : text;
}

export function createListenResolver(sources: ListenSources): ListenResolver {
  let cache: readonly LocalAddressEntry[] | undefined;
  const candidates = async (): Promise<readonly LocalAddressEntry[]> => {
    cache ??= (await sources.localAddresses?.()) ?? [];
    return cache;
  };
  // 形态判据专用的降级缓存：**成功与失败都记住**（一次规划里不反复戳 PowerShell），
  // 但它与 `cache` 分开 ⇒ 不会把「读失败」污染给 fail-closed 的 `resolve()`。
  let degraded: readonly string[] | undefined;
  const candidateAddresses = async (): Promise<readonly string[]> => {
    if (degraded !== undefined) return degraded;
    try {
      degraded = (await candidates()).map((entry) => entry.address);
    } catch {
      degraded = [];
    }
    return degraded;
  };

  return {
    async resolve(port, override, tolerateUnreadable = false) {
      const listen = normalize(override ?? sources.listenAddresses?.(port));
      if (listen === undefined) return {};
      let list: readonly LocalAddressEntry[];
      try {
        list = await candidates();
      } catch (error) {
        // 012 的 fail-closed：读不到候选 ⇒ 抛（`computePlan` 盘成 503，绝不把「读不到」当「没有网卡」）
        if (!tolerateUnreadable) throw error;
        // 缺陷 F1 的窄例外：重写既有规则自己的地址 ⇒ 不带清单、不带掩码（`cidrFor` 退化为 /32）
        return { listenAddress: listen };
      }
      const candidate = list.find((entry) => entry.address === listen);
      return {
        listenAddress: listen,
        allowedListenAddresses: list.map((entry) => entry.address),
        ...(candidate === undefined ? {} : { listenAddressPrefixLength: candidate.prefixLength }),
      };
    },
    configured: (port) => normalize(sources.listenAddresses?.(port)),
    candidates: candidateAddresses,
  };
}

/** 形态判据的两项事实（`{}` = 两个来源都没拿到 ⇒ 只认默认两个字面量） */
export function listenFactsOf(
  configured: string | undefined,
  candidates: readonly string[] | undefined,
): AllowedListenFacts {
  return {
    ...(configured === undefined ? {} : { configured }),
    ...(candidates === undefined ? {} : { candidates }),
  };
}
