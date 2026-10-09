/**
 * 结构断言（003 Phase 2 的「引擎是纯函数」这条性质要能被机器验证，而不是靠读代码相信）
 */

/**
 * 结果对象里**不许出现任何函数**。
 *
 * 这是「引擎不产生动作」的可执行形式：本包把一切写操作（增 / 删 / 修 + 提权）都留给 005，
 * 引擎只输出事实。若哪天有人往返回值里塞一个 `apply()` 回调，这条断言会当场炸 ——
 * 比「代码评审时记得看一眼」可靠。
 */
export function assertNoFunctions(value: unknown, path = '$'): void {
  if (typeof value === 'function') {
    throw new Error(`引擎输出里出现了函数（${path}）——动作属于 005，引擎只能是纯事实`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoFunctions(item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) assertNoFunctions(nested, `${path}.${key}`);
  }
}
