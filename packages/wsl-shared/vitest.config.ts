import { defineConfig } from 'vitest/config';

/**
 * 单元测试只收 `tests/unit/**`。
 * `tests/contract/**` 是 `node --test` 驱动的真机 fixture 契约测试（零依赖、离线可跑），
 * 两者**故意不混**：契约层的断言对象是「真机原始字节」，属于另一种证据。
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
