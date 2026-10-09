/**
 * 008 T1.7 把写通道接进宿主插件（**独立文件**，专为绕开「单文件 ≤ 400 行」SHALL）
 *
 * ## 为什么单独一个文件
 *
 * `plugin.ts` 实测 **388 行**，直接内联写通道接线会涨到 **418 行 ⇒ 违反「单文件 ≤ 400 行」SHALL**
 * （`tests/unit/client-structure.test.ts` 当场判红 ✓）。该门是 **SHALL，绝不放宽** ✗ ⇒ 接线搬来此处，
 * `plugin.ts` 只留 import + 一次调用 + 句柄里两行。判据留痕见 `specs/008-write-transport/tasks.md`。
 *
 * ## 装载期零外部命令（T1.4 的判据）
 *
 * 本函数只做三件事：造审计环、造计划通道、注册路由。**一条命令都不跑**：`writeFacts` 里全是闭包，
 * 请求到了才现读；缺省事实面更是**保守降级**（零 IO、`eth0Ip` 为 `null` ⇒ 计划恒被拦成 `eth0-unknown`，
 * 绝不因为「没接好」而误动作）。
 *
 * ## 所有权集合的来源（design §12 的方案 (a)）
 *
 * 走请求**显式** `declaration`；**缺省 = 空集** ⇒ 一切都 `port-not-managed`。
 * 失败方向永远是最保守的「什么都不做」。
 */

import type { RoutePluginContextLike } from '../route.ts';
import { createAuditLog } from './audit.ts';
import type { AuditLog } from './audit.ts';
import { createPlanChannel } from './plan.ts';
import type { PlanFacts } from './plan.ts';
import { registerWriteRoute } from './routes.ts';
import type { WriteRouteRegistration } from './routes.ts';

export interface WriteChannelHandle {
  readonly writeRoute: WriteRouteRegistration;
  readonly audit: AuditLog;
  /** 实际生效的现读事实面（集成方/测试可读：确认自己注入的那份真被用上） */
  readonly facts: PlanFacts;
}

/** 缺省事实面 = **保守降级**：零 IO、eth0 未知 ⇒ 计划恒被拦下（绝不误动作） */
export function degradedPlanFacts(): PlanFacts {
  return {
    managedPorts: (declaration) => declaration ?? [],
    eth0Ip: () => Promise.resolve(null),
    rules: () => Promise.resolve([]),
    elevation: () => ({ policy: 'unknown', backend: 'unknown', available: false }),
  };
}

/**
 * 注册写通道（装载期零外部命令）。
 *
 * @param ctx 宿主插件上下文（与只读路由共用；`inject` / `effect` 语义一致）
 * @param facts 现读事实面；缺省 = `degradedPlanFacts()`（安全降级，不是失败）
 */
export function attachWriteChannel(ctx: RoutePluginContextLike, facts?: PlanFacts | undefined): WriteChannelHandle {
  const effective = facts ?? degradedPlanFacts();
  const audit = createAuditLog();
  const writeRoute = registerWriteRoute(ctx, {
    plan: createPlanChannel(effective),
    // 审计尾部只读：最近 50 条 + 环状态（`size` / `dropped` 让「尾部」语义可解释）
    audit: () => ({
      ok: true,
      status: 200,
      payload: { ok: true, records: audit.tail(50), size: audit.size(), dropped: audit.dropped() },
    }),
  });
  return { writeRoute, audit, facts: effective };
}
