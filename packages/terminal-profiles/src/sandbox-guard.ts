/**
 * 可选的沙箱门禁（**默认不接线** —— 口径写在下面，2026-10-09 集成方裁决）。
 *
 * 🔴 **为什么单开一个文件**：`../plugin.ts` 在 2026-10-09 的缺陷 A 修复后摸到 **426 行**，
 * 越过了本仓「单文件 ≤ 400 行」的 SHALL（原始行数口径）。这个函数是 plugin.ts 里**边界最干净**的
 * 一块（无内部状态、只依赖工具层的两个纯函数）⇒ 搬来这里；`plugin.ts` 保留一行再导出，
 * 调用方（`tests/unit/plugin-entry.test.ts` 与将来的集成方）的 import 路径**不变**。
 *
 * ## 🔴 口径：沙箱是 **Agent 写入**的门禁，**不是**用户/宿主能力的门禁
 *
 * 依据（都是本仓既有事实，不是偏好）：
 * ① design §11：`ctx.sandboxPolicy` 是**策略解析器**，**不是逐次门禁** —— 门禁在
 *    `tools/pre-execute` + `ctx.tools.guard()`；
 * ② 004 的真机验收项 #7：`read-only` 下 **Agent** 的 `managed_terminal_write` 被拒 + **页面键盘输入仍可用**
 *    ⇒ 沙箱约束的是 **Agent 动作**，不是用户/宿主侧能力；
 * ③ 本服务面的消费方 003 是**页面级**的（用户点按钮才 `open`）⇒ 在这一层再拦一次会让
 *    `read-only` 下「用户自己的按钮」失效，与 #7 直接矛盾；而 Agent 路径在 004 的工具层
 *    **已经**在调用前拦过，服务面再拦没有增量收益。
 *
 * ⇒ 缺省 `guard === undefined`（不过门）。这个函数**保留**是为了「零成本可切换」：想复用
 * 004 的同一份策略时，`PluginDeps.guard = (action) => sandboxGuard(policyCtx, action)` 即可
 * （`managed_terminal_read` / `managed_terminal_list` 永不过门，REQ-3.2）。缺策略服务时它是 fail-closed（`read-only` ⇒ 拒绝）。
 *
 * 审批**不在**这一层：审批是「Agent 触发」的语义（004 的 `gate()` 需要 agent 才能问）。
 */

import { ToolFailureError } from './tools/index.ts';
import type { HostContextLike } from './tools/index.ts';
import { assertWriteAllowed, type WriteTool } from './tools/policy.ts';
import type { GuardAction } from './service-export/service.ts';
import type { ServiceFailure } from './service-export/types.ts';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sandboxGuard(ctx: HostContextLike, action: GuardAction): ServiceFailure | undefined {
  // `GuardAction` 是 003 消费的服务面词汇（`open` 不是工具名）⇒ 在这里显式映射到 Agent 工具名
  const tool: WriteTool = action === 'open' ? 'managed_terminal_new' : `managed_terminal_${action}`;
  try {
    assertWriteAllowed(ctx, undefined, tool);
    return undefined;
  } catch (error) {
    if (error instanceof ToolFailureError) {
      return {
        ok: false,
        code: 'sandbox-denied',
        message: error.message,
        ...(error.hint === undefined ? {} : { hint: error.hint }),
      };
    }
    return {
      ok: false,
      code: 'sandbox-denied',
      message: `沙箱门禁抛出未预期错误，按最保守口径拒绝：${describeError(error)}`,
      hint: '这是防御性分支：确认 ctx.sandboxPolicy 的形状没有被改动。',
    };
  }
}
