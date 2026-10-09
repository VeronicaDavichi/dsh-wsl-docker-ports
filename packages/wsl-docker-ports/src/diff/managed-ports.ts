/**
 * `managedPorts` 声明集合的**表示**与成员判定（003 REQ-3.1 / REQ-16.1 / REQ-16.2）
 *
 * ## 为什么表示成「区间数组」而不是端口数组
 *
 * REQ-16.1 允许声明写成闭区间（`"1000-3000"`）。若把区间**展开成端口数组**，声明
 * `1-65535` 就会瞬间造出 6.5 万个元素 —— 而期望集其实只需要「docker 实际映射∩声明」。
 * ⇒ 一律用区间（`start..end`，单端口是 `start === end`）表示，成员判定与求交都是 O(区间数)。
 *
 * ## 与 T3.5 的分工
 *
 * **字符串 → 区间的解析 + 非法/倒置区间的拒绝**属 Phase 3（T3.5，`REQ-16.1`）；
 * 本文件只提供引擎需要的**表示、成员判定、求交**三件事，让 Phase 2 的引擎现在就能跑，
 * 且 T3.5 落地时不必改动引擎的输入形状（只加一个解析函数）。
 */

/** 闭区间（含两端）；单端口写成 `start === end` */
export interface ManagedPortRange {
  readonly start: number;
  readonly end: number;
}

/** 声明集合。允许重叠（如 `1000-2000` 与 `1500-3000` 同时声明）—— 求交时会合并，调用方不必先去重。 */
export type ManagedPorts = readonly ManagedPortRange[];

/** 便捷构造：单端口 */
export function singlePort(port: number): ManagedPortRange {
  return { start: port, end: port };
}

/**
 * 端口是否属于声明集合（REQ-3.1 的所有权判据）。
 * 倒置区间（`start > end`）恒返回 `false` —— 非法区间该在 T3.5 的解析层被拒，
 * 到这里还不合法就只能当「谁都不含」，绝不猜用户的意思。
 */
export function isManagedPort(ports: ManagedPorts, port: number): boolean {
  return ports.some((range) => port >= range.start && port <= range.end);
}

/**
 * 区间 ∩ 声明集合（REQ-16.2：**先求交**，绝不枚举声明集合自身的成员）。
 *
 * 返回的区间按起点排序并合并相邻/重叠段 ⇒ 调用方直接遍历展开即可，不会重复。
 * 枚举量的上界因此是「**映射**的区间宽度」，与声明集合有多大无关。
 */
export function intersectManagedRange(
  ports: ManagedPorts,
  start: number,
  end: number,
): ManagedPortRange[] {
  const hits: ManagedPortRange[] = [];
  for (const range of ports) {
    const low = Math.max(range.start, start);
    const high = Math.min(range.end, end);
    if (low <= high) hits.push({ start: low, end: high });
  }

  hits.sort((left, right) => left.start - right.start);
  const merged: ManagedPortRange[] = [];
  for (const range of hits) {
    const last = merged[merged.length - 1];
    // `range.start <= last.end + 1`：相邻段也合并（`1000-2000` ∪ `2001-3000` 就是一个连续段）
    if (last !== undefined && range.start <= last.end + 1) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
      continue;
    }
    merged.push(range);
  }
  return merged;
}
