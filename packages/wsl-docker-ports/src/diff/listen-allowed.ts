/**
 * 「本插件形态」的监听地址 —— **唯一一份集合 + 唯一一个组装点**（012 验收期缺陷修复，2026-10-23）
 *
 * ## 为什么必须有这个文件（真机缺陷 F1）
 *
 * 真机既有一条**本插件自己写出来的**规则：
 * `listenAddress=192.168.31.129  listenPort=3306  connectAddress=172.20.201.152  connectPort=3306`
 *
 * 页面快照判它 `ok`（读侧 `isOurListenAddress(LAN_IP, 候选清单)` ⇒ 本来就算「我方形态」），
 * 而写通道 `/write/plan` 判它 `state-conflict`（写侧 `write/ownership.ts` 当时**只认**
 * `OUR_LISTEN_ADDRESSES` 两个默认字面量）⇒ 用户对自己刚让插件写的规则点「移除 / 修复漂移」
 * 会被挡住，自相矛盾。
 *
 * 根因是**口径分叉**（AGENTS.md：「不许各自解释口径」）：012 只放宽了读侧，写侧的形态判据
 * 仍然只认两个字面量。修法不是再给写侧抄一份集合，而是把**集合与组装**都收成一处：
 *
 * ```
 * 本插件形态 = {127.0.0.1, 0.0.0.0}                        ← OUR_LISTEN_ADDRESSES，恒认
 *            ∪ 该端口在配置 listenAddresses 里登记过的值     ← 用户显式选过的地址
 *            ∪ 候选清单里存在的合法 IP                     ← 本机物理网卡现读（可降级缺席）
 * ```
 *
 * 读侧（`diff/engine.ts` 的 `conflict` / `scopeMismatch`）与写侧（`write/ownership.ts` 的所有权
 * 闸门）**都只调** `allowedListenAddressesFor()` / `isOurListenAddress()`，两侧共用同一份来源。
 *
 * ## 为什么单独一个文件
 *
 * 1. `engine.ts` 已 368 行，而「单文件 ≤ 400 行」是 SHALL（NFR-5 / `check-size.mjs` 判 exit 1）；
 * 2. 依赖方向保持**单向**：本文件不 import `engine.ts`（否则 engine ↔ 本文件成环），
 *    `engine.ts` 原样**转出** `OUR_LISTEN_ADDRESSES` / `isOurListenAddress` ⇒ 既有 import 路径
 *    （`tests/unit/listen-address-select.test.ts`、`write/index.ts`）一字不改。
 *
 * ## 失败方向
 *
 * 两个来源都**可缺席**：缺一个就少认一类地址，**绝不**放宽成「任何 IPv4」——
 * 候选清单读不到（`undefined` / `[]`）时就只剩「两个默认值 + 配置值」，
 * 即修复前的行为（`0.0.0.0` / `127.0.0.1` 逐字节不变）。
 */

/**
 * 本插件会写的两种 `listenAddress`（005 §2 的算法表）：
 * `lan` → `0.0.0.0`（或用户显式选的网卡 IP），`loopback` → `127.0.0.1`。
 *
 * ⚠️ 2026-10-09 集成期订正：原先它是**模块私有**的，导致 005 的写路径安全闸门
 * （`src/write/ownership.ts`）只能**复制一份同名常量** —— 而「形态不符」的判据必须在
 * 读侧（引擎）与写侧（005）**逐字一致**，两份会各自漂移（正是「不许各自解释口径」所忌）。
 * 故在此**开出口**，005 侧改为 import，不再另写一份。
 * 2026-10-23 起本文件是这两个字面量的**唯一所在**（`engine.ts` 转出，见文件头）。
 */
export const OUR_LISTEN_ADDRESSES: readonly string[] = ['127.0.0.1', '0.0.0.0'];

/**
 * 形态判据的两项事实（`write/types.ts` 的 `listenForms` 用的就是本类型）。
 *
 * 刻意与写侧的选择门（`WritePlanInput.allowedListenAddresses`，fail-closed、清单缺席即全拦）
 * **分开**：那个回答「能不能写这个地址」，这里回答「既有规则算不算我写的」。
 */
export interface AllowedListenFacts {
  /** 该端口在配置 `listenAddresses` 里登记过的值（`undefined` = 没选过） */
  readonly configured?: string | undefined;
  /** 候选监听地址清单（本机 Windows 物理网卡 IPv4；`undefined` = 没读到 ⇒ 不参与） */
  readonly candidates?: readonly string[] | undefined;
}

/** 去空白、去空串、去重（保持输入顺序：先配置值、后候选清单，便于错误文案可读） */
function cleanListenAddresses(values: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '' || out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

/**
 * 拼出 `isOurListenAddress(value, …)` 的第二个入参 —— **全仓唯一组装点**。
 *
 * **纯函数、不抛**：两个来源都缺席 ⇒ `[]` ⇒ 判据退化成「只认 127.0.0.1 / 0.0.0.0」。
 */
export function allowedListenAddressesFor(facts: AllowedListenFacts = {}): readonly string[] {
  return cleanListenAddresses([facts.configured, ...(facts.candidates ?? [])]);
}

/**
 * 这个 `listenAddress` 是不是本插件（可能）写的？—— **形态判据的本体，全仓只此一处**。
 *
 * - `{127.0.0.1, 0.0.0.0}` **永远**算（两个默认形态）；
 * - 其余只算 `allowed` 里的地址。`allowed` 的来源**不由本函数决定**，而由上面的
 *   `allowedListenAddressesFor()` 决定（配置登记值 ∪ 候选清单）。
 *
 * 注意**没**放宽到「任何 IPv4」：两个来源都取不到的地址仍然 `conflict`。
 *
 * 🔴 **2026-10-23 订正（真机缺陷 F1）**：012 当时只让**读侧**用候选清单，写侧
 * （`write/ownership.ts`）仍只认两个默认字面量 —— 于是「本插件自己写出来的
 * `listenAddress=192.168.31.129`」在快照里是 `ok`、在计划里却是 `state-conflict`，
 * `fix` / `remove` 全被挡住（自相矛盾）。现在读写两侧共用同一份 allowed（同源装配）。
 */
export function isOurListenAddress(value: string, allowed: readonly string[] = []): boolean {
  return OUR_LISTEN_ADDRESSES.includes(value) || allowed.includes(value);
}

/** 「这个地址算不算本插件形态」—— 带事实的便捷形态（读侧/写侧都可用，语义仍只由上一个函数定） */
export function isOurListenAddressFor(value: string, facts: AllowedListenFacts = {}): boolean {
  return isOurListenAddress(value, allowedListenAddressesFor(facts));
}

/**
 * 给人看的集合文案（冲突消息用）：`127.0.0.1 / 0.0.0.0 / 192.168.31.129 …`。
 * 缺省值直接取 `OUR_LISTEN_ADDRESSES`（**不**在这里重写那两个字面量）。
 */
export function describeAllowedListenAddresses(allowed: readonly string[] = []): string {
  return cleanListenAddresses([...OUR_LISTEN_ADDRESSES, ...allowed]).join(' / ');
}
