/**
 * 只收 `tests/client` 下的组件与入口半（渲染 / 接线断言）。
 *
 * - 该目录一律写成 **`.tsx`**：`test` 脚本里的 `node --test` 只吃 `.test.ts`
 *   —— 扩展名本身就是两套 runner 的隔离手段（`node:test` 里 import vitest 会直接失败）。
 * - `include` 刻意只列这一个目录：本包另有 `node:test` 用例（`tests/unit`），不该被 vitest 再跑一遍。
 * - **不设 `esbuild.jsx`**：vitest 5 的转换走 oxc，它直接读 `tsconfig.json` 的 `jsx: "react-jsx"`
 *   —— 与 typecheck 同源是**更好**的口径（只有一份真相）。
 *
 * ⚠️ 注释里禁止出现 `星号星号斜杠` 形状的 glob 原文：它会**提前闭合**本块注释（017 踩过，
 *    `PARSE_ERROR: Unexpected token`）。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 目录级 glob：`tests/client` 下的 `.test.tsx` / `.test.ts` 都收（等价旧写法，且不会闭合上方注释）
    include: ['tests/client/*.test.{ts,tsx}', 'tests/client/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});

