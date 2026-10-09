import { defineConfig } from 'vitest/config';

/**
 * 只收 `tests/client/**`（组件与入口半的渲染/接线断言）。
 *
 * - `tests/client/**` 一律写成 **`.tsx`**：既有 `test` 脚本里的 `node --test "tests/**\/*.test.ts"`
 *   会抢走 `.test.ts`，而 `node:test` 里 import vitest 会直接失败 —— 扩展名本身就是隔离手段。
 * - `include` 刻意只列这一个目录：本包另有 ~275 条 `node:test` 用例（`tests/unit/**`、`tests/contract/**`），
 *   它们不该被 vitest 再跑一遍。
 * - **不设 `esbuild.jsx`**：vitest 5 的转换走 **oxc**（设了会打印
 *   「Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored」），
 *   oxc 直接读 `tsconfig.json` 的 `jsx: "react-jsx"` —— 与 typecheck 同源是**更好**的口径（只有一份真相）。
 *   `tests/client/*.test.tsx` 里含真实 JSX 的用例就是这条链路的活证据。
 * - 不引 `@vitejs/plugin-react`：本包不需要 HMR / Fast Refresh，加它等于为一个测试多装一层依赖。
 */
export default defineConfig({
  test: {
    include: ['tests/client/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
