/**
 * eth0 地址源（003 T2.3 / REQ-6.1 / REQ-6.4）
 *
 * ## 存在的理由：把「什么时候可以吃缓存」变成类型上的两件事
 *
 * REQ-6 的校准结论（T0.2 实测：本机两次重建 eth0 **都未变**）是「漂移是安全网、不做心跳/守护」，
 * 但**写入前必须强制现读** —— 拿旧地址去写 portproxy 规则，等于**亲手造一条新的坏规则**
 * （原脚本坑 #4 的同类：不报错，只是连不上）。所以：
 *
 * - `cachedIp()` —— 只读缓存快照，**给展示用**（激活 / 刷新时探一次，页面渲染不再执行命令）
 * - `probe()` —— **强制现读**（每次都真执行 `ip -4 -o addr`，**绝不**因缓存命中而短路），
 *   并更新缓存；写路径（005）只准用它，UI 刷新与「启动并核验」也用它
 *
 * 换言之：「吃缓存」这个决定不再由调用方口头约定，而是**方法的语义**——
 * 想省一次调用就只能拿 `cachedIp()`，而那个返回值在类型上就不带「最新」的承诺。
 *
 * ## 取不到就清空缓存（REQ-6.4）
 *
 * `probe()` 失败时把缓存置 `null`，而不是留旧值：REQ-6.4 要求「取不到 eth0」显示**显式状态**
 * （不是静默降级），把上一个地址继续摆在界面上等于用一个可能已经失效的地址糊弄用户。
 * 于是 UI 的判据只有一条：`cachedIp() === null` ⇒ 显示「无法确定地址 / WSL 未运行」。
 *
 * ## 冷启动门控（001 REQ-2.4）
 *
 * `allowColdStart` 默认 false，透传给 001 的 `probeEth0`（守卫与执行都在那边，只有一份实现）。
 * 只有用户显式点「启动并核验」才允许按次覆盖 —— 代价是 10–12 秒并拉起 WSL 内全部服务。
 */

import { probeEth0 } from 'dsh-wsl-shared';
import type { Eth0Outcome, Executor, WslDistro } from 'dsh-wsl-shared';

export interface Eth0Source {
  /** 上次探测到的地址；`null` = 没探过 / 上次探测失败（**不得**当作「地址是空」） */
  readonly cachedIp: () => string | null;
  /** 强制现读（不吃缓存）。写路径的唯一入口。 */
  readonly probe: (override?: Eth0ProbeOverride) => Promise<Eth0Outcome>;
}

/** 按次覆盖（只给显式动作：`allowColdStart` 只允许「启动并核验」传 true） */
export interface Eth0ProbeOverride {
  readonly allowColdStart?: boolean;
  readonly timeoutMs?: number;
}

export interface Eth0SourceOptions {
  readonly allowColdStart?: boolean;
  readonly timeoutMs?: number;
}

export function createEth0Source(
  executor: Executor,
  distro: string,
  distros: readonly WslDistro[],
  options: Eth0SourceOptions = {},
): Eth0Source {
  let cached: string | null = null;

  return {
    cachedIp: () => cached,

    probe: async (override) => {
      // 显式拼可选字段（不写 `{...base, ...override}`）：`exactOptionalPropertyTypes` 下
      // 「可选字段的值可能是 undefined」与「字段不存在」是两回事，展开会把前者带进去。
      const call: { timeoutMs?: number; allowColdStart?: boolean } = {};
      const timeoutMs = override?.timeoutMs ?? options.timeoutMs;
      if (timeoutMs !== undefined) call.timeoutMs = timeoutMs;
      const allowColdStart = override?.allowColdStart ?? options.allowColdStart;
      if (allowColdStart !== undefined) call.allowColdStart = allowColdStart;

      const outcome = await probeEth0(executor, distro, distros, call);
      // 成功 → 记住；失败 → **清空**（见文件头：不留一个可能失效的地址在界面上）
      cached = outcome.ok ? outcome.ip : null;
      return outcome;
    },
  };
}
