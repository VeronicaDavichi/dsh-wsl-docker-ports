/**
 * 宿主侧配置读取：**转发侧的七个字段面**（活体包装的统一解包已搬到 `./shared/config-read.ts`）
 *
 * ## 015 P1 的搬迁留痕（原文结论一字未删，只把实现移到共享层）
 *
 * 解包规则（活体 `.get()` / 平凡值 / 零参取值函数三态同读、**每次现读**）与七个字段的**类型归一**
 * 现在是两份东西：
 *
 * - **形态归一**（字段无关）→ `./shared/config-read.ts`（两侧共用一份实现，015 R3 白名单）；
 * - **字段清单**（`distro` / `elevationPolicy` / `writeToken` / `managedPorts` / `listenAddresses` /
 *   `refreshIntervalSec`）→ 本文件（转发侧自己的业务）。
 *
 * 容器侧的同名七个字段在**另一个命名空间**（`dsh-wsl-docker-containers`），它的读者在
 * `./containers/credential.ts`（只读它真正消费的三个：`distro` / `writeToken` / `refreshIntervalSec`）。
 *
 * ## 为什么必须有这一层（009 缺陷 1 的第二层，原文保留）
 *
 * 缺陷 1 的修法是给 `Config` 的字段标 `.volatile()`（见 `./config.ts` 文件头）。代价是 002 B-1 早已
 * 定案的机制：**标了 volatile 的字段，解析结果是带 `.get()` 的深冻结活体包装**，直接把属性当值读
 * 会拿到包装对象本身 ⇒ 提权档判不出 `ask`（永远写不动）、凭据不是字符串（永久 401）。
 * ⇒ 正确处置是**读侧统一解包**，而不是把字段退回平凡（退了命名空间根本不出现、`update` 直接抛）。
 *
 * ## 判据（离线，两个形态行为逐项相同）
 *
 * `tests/unit/config-read.test.ts`：同一份「活体包装」与「平凡对象」两种输入，`distro` /
 * `elevationPolicy` / `writeToken` / `managedPorts` 的读值、提权档判决、写通道 401 判决、
 * 所有权声明（`declaration` 含 `43312`）必须逐项一致。
 */

import {
  createConfigFieldReader,
  readConfigToken,
  unwrapConfigString,
  unwrapConfigStringArray,
  unwrapConfigStringRecord,
  unwrapConfigRefreshInterval,
  type ConfigValueSource,
} from './shared/config-read.ts';

/**
 * 三个纯归一化工具在本文件**原样再导出**：既有调用点与测试的 `from './config-read.ts'`
 * 一行不用改（015 P1 的「只改 import 薄壳」要求）。
 */
export {
  unwrapConfigValue,
  readConfigValue,
  unwrapConfigString,
  unwrapConfigStringArray,
  unwrapConfigStringRecord,
  readConfigToken,
  unwrapConfigRefreshInterval,
  createConfigFieldReader,
} from './shared/config-read.ts';
export type { ConfigValueSource, VolatileRefLike } from './shared/config-read.ts';

/** 本包宿主面用到的**七个**配置字段的**活体读取面**（每次调用现读，不吃缓存） */
export interface PortsConfigReaders {
  /** `distro`：留空/非串 ⇒ `undefined`（001 的四级优先级解析接管） */
  distro(): string | undefined;
  /** `elevationPolicy`：**原始字符串原样返回**（认不认得出来由语义层判，见 `transport/real-facts.ts`） */
  elevationPolicy(): string | undefined;
  /** `writeToken`：**已 trim**；`undefined` = 未配置（fail-safe：写通道 401） */
  writeToken(): string | undefined;
  /** `managedPorts`：非数组/非串成员一律剔除 ⇒ `[]`（声明恒空是**安全**降级） */
  managedPorts(): readonly string[];
  /**
   * 012 `listenAddresses`：逐端口监听地址（键 = 端口号字符串）。畸形 ⇒ `{}`。
   * **现读**：客户端选值后立刻写配置，下一次判决/计划就能看到。
   */
  listenAddresses(): Readonly<Record<string, string>>;
  /**
   * 014 `refreshIntervalSec`：自动刷新频次（秒）。缺省/非法 ⇒ `0`（关闭）。
   * 服务端不消费它（没有隐藏轮询），本读者只为「同一命名空间的现读口径」完整。
   */
  refreshIntervalSec(): number;
}

/**
 * 造活体读取面。`config` 可以是活体包装**或**平凡对象**或**零参取值函数（返回上述两类之一），
 * 也可以是 `undefined`。返回的方法**每次重新解包**（取值函数也每次都调）⇒ volatile 原地写入
 * （不重挂载）能被下一次读到。
 */
export function createHostConfigReaders(config?: ConfigValueSource): PortsConfigReaders {
  const field = createConfigFieldReader(config);
  return {
    distro: () => unwrapConfigString(field('distro')),
    elevationPolicy: () => unwrapConfigString(field('elevationPolicy')),
    writeToken: () => readConfigToken(field('writeToken')),
    managedPorts: () => unwrapConfigStringArray(field('managedPorts')),
    listenAddresses: () => unwrapConfigStringRecord(field('listenAddresses')),
    refreshIntervalSec: () => unwrapConfigRefreshInterval(field('refreshIntervalSec')),
  };
}
