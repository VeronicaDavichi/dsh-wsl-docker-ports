import { defineConfig } from 'vitest/config';

/**
 * 单元测试只收 `tests/unit/**`（与 001 同口径）。
 * 本包**暂无** `tests/contract/**`：契约层的断言对象是「真机原始字节」（PTY spec 形状 / WS 握手）。
 * ⚠️ 2026-10-09 订正：原文写「真机 fixture 要到 Phase 2/3 才有对象可测」—— **已变假**：
 * Phase 1 与 Phase 2 都按硬约束**零真机**落地（Phase 2 全部用自写 fake `ctx.subprocess`），
 * 真机产物的对象要等 **Phase 3（WS 握手）+ T0.5 安装接入**，届时才议是否加契约层。
 *
 * ⚠️ 2026-10-09 订正（**静默漏跑的坑**）：原 include 只有 `tests/unit/**\/*.test.ts` ⇒ Phase 4 新加的
 * `*.test.tsx` 组件用例**一个都不会被收集**，跑出来是「0 个用例、全绿」。现同时收 `.tsx`。
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
  },
});
