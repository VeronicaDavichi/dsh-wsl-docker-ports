/**
 * 纯库包：**没有**客户端半（不注册页面、没有 chunk）⇒ `tests/client/**` 结构性为空。
 *
 * `passWithNoTests` 是**刻意**开的：vitest 在 0 个用例时默认 exit 1，那会把「本包确实没有组件测试」
 * 这件事实变成一条假红。判据仍是「退出码 0」。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/client/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
  },
});
