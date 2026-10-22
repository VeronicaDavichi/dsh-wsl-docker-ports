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
 */

import type { LocalAddressEntry } from '../read/local-addresses.ts';
import type { WritePlanInput } from '../write/types.ts';

/** 解析所需的两个现读来源（与 `PlanFacts` 的同名成员同形；缺省 = 该来源不存在） */
export interface ListenSources {
  readonly listenAddresses?: ((port: number) => string | undefined) | undefined;
  readonly localAddresses?: (() => Promise<readonly LocalAddressEntry[]>) | undefined;
}

/** 解析结果 = `WritePlanInput` 上那三个相关字段（可选键，缺席即不改形态） */
export type ListenInput = Pick<WritePlanInput, 'listenAddress' | 'allowedListenAddresses' | 'listenAddressPrefixLength'>;

export interface ListenResolver {
  /** 该端口的三个地址字段（`{}` = 不选具体 IP ⇒ 010 形态） */
  resolve(port: number, override: string | undefined): Promise<ListenInput>;
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

  return {
    async resolve(port, override) {
      const listen = normalize(override ?? sources.listenAddresses?.(port));
      if (listen === undefined) return {};
      const list = await candidates();
      const candidate = list.find((entry) => entry.address === listen);
      return {
        listenAddress: listen,
        allowedListenAddresses: list.map((entry) => entry.address),
        ...(candidate === undefined ? {} : { listenAddressPrefixLength: candidate.prefixLength }),
      };
    },
  };
}
