import { defineConfig } from 'vitest/config';

/**
 * 单元测试只收 `tests/unit/**`（与 001 同口径）。
 * 本包**暂无** `tests/contract/**`：契约层的断言对象是「真机原始字节」（PTY spec 形状 / WS 握手），
 * 而 Phase 1 是零宿主、零进程的纯配置模型 —— 真机 fixture 要到 Phase 2/3 才有对象可测。
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
