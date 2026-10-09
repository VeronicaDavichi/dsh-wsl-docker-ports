import { defineConfig } from 'vitest/config';

/**
 * 单元测试只收 `tests/unit/**`（与 001 同口径）。
 * 本包**暂无** `tests/contract/**`：契约层的断言对象是「真机原始字节」（PTY spec 形状 / WS 握手）。
 * ⚠️ 2026-10-09 订正：原文写「真机 fixture 要到 Phase 2/3 才有对象可测」—— **已变假**：
 * Phase 1 与 Phase 2 都按硬约束**零真机**落地（Phase 2 全部用自写 fake `ctx.subprocess`），
 * 真机产物的对象要等 **Phase 3（WS 握手）+ T0.5 安装接入**，届时才议是否加契约层。
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
