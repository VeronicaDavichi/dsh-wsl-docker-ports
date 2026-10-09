/**
 * 🔴 真 `defineTool` 端到端注册（2026-10-09 集成方新增）
 *
 * **为什么必须单有这一条**：004 的工具单测跑的是**注入的** fake `defineTool`
 * （`tests/helpers/tools-define.ts` —— 零宿主依赖的设计使然）。集成时把**真**
 * `@deepseek-ai/dsh-tools` 接上，6 个工具**全部**被拒：`… is not supported by the value schema DSL`，
 * 根因是输出 schema 照 JSON Schema 习惯写了顶层 `required: [...]`，而宿主只认**属性节点上的
 * `required: true`**（真源码：`dsh-tools/lib/types/schema.js` L126-192 的 `assertAuthorKeys` 白名单）
 * ⇒ **fake 绿 ≠ 真模块绿**，本文件就是那道缺的闸。
 *
 * 三条断言的分工：
 * ① **真模块接受全部 6 个工具**（注册不抛、名字齐全）—— 直接钉死这次的真缺陷；
 * ② **编译产物是宿主认的 JSON Schema**（属性节点的 `required: true` 真被编译成顶层 `required`）
 *    —— 证明我们给的是「DSL 输入 → 宿主契约输出」而不是恰好没报错；
 * ③ **负向对照**：故意把 `required: [...]` 写回顶层 ⇒ 真模块**必须**抛
 *    —— 反假绿：如果哪天 DSL 校验被绕过/放宽，这条会红，而不是让 ① 变成恒真。
 *
 * 依赖定位：`@deepseek-ai/dsh-tools` 是 **devDependency**（`src/` 仍是零宿主依赖）⇒ 本文件是
 * 「契约核对」，不是运行时依赖；工具面的执行路径证据仍在 `tools-io` / `tools-lifecycle` 等文件。
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { describe, expect, it } from 'vitest';

import { TERMINAL_TOOL_NAMES, createTerminalTools } from '../../src/tools/register.ts';
import type { CreateTerminalToolsOptions } from '../../src/tools/register.ts';
import type { SessionManager } from '../../src/session/manager.ts';
import { createFakeContext } from '../helpers/tools-define.ts';

/** 用**真** `defineTool` 走一遍 `createTerminalTools` 的注册过程，回传宿主侧收到的定义 */
function registerWithRealDefineTool(): {
  readonly names: readonly string[];
  readonly definitions: readonly Record<string, any>[];
} {
  const definitions: Array<Record<string, any>> = [];
  const options = {
    // 真模块的 TS 签名与本仓 `host.ts` 的**最小结构面**不同（我们只声明用到的字段）⇒ 显式窄化，
    // 运行时就是那个真函数（这正是本测试要验的）。
    defineTool: defineTool as unknown as CreateTerminalToolsOptions['defineTool'],
    tools: {
      register: (definition: unknown) => {
        definitions.push(definition as Record<string, any>);
        return () => undefined;
      },
    },
    // 本文件**只验注册**、不执行任何工具 ⇒ manager 用占位对象（执行路径的证据在 tools-*.test.ts）
    manager: {} as unknown as SessionManager,
    profiles: () => [],
    ctx: createFakeContext(),
  } satisfies CreateTerminalToolsOptions;

  const handle = createTerminalTools(options);
  return { names: handle.names, definitions };
}

/** 故意写坏（顶层 `required: [...]`）的输出 schema —— 负向对照用 */
const BROKEN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { a: { type: 'string' } },
  required: ['a'],
};

describe('工具面 · 真 defineTool 注册（DSL 契约核对）', () => {
  it('① 真模块接受全部 6 个工具：注册不抛且名字齐全（这次的真缺陷就死在这条）', () => {
    const { names, definitions } = registerWithRealDefineTool();
    expect(names).toEqual([...TERMINAL_TOOL_NAMES]);
    // 反假绿：断言「扫到了 6 个定义」，否则「0 个也全绿」
    expect(definitions.length).toBe(TERMINAL_TOOL_NAMES.length);
    expect(definitions.length).toBeGreaterThanOrEqual(6);
  });

  it('② 编译产物是宿主认的形状：属性节点的 required 被编译成顶层 required，且 output.render 在', () => {
    const { definitions } = registerWithRealDefineTool();
    const byName = new Map(definitions.map((definition) => [definition.name as string, definition]));

    // `new` 的唯一参数 profile 是必填 ⇒ 编译后出现在**顶层** required（DSL 的功劳，不是我们手写的）
    const created = byName.get('new');
    expect(created?.parameters.type).toBe('object');
    expect(created?.parameters.required).toEqual(['profile']);
    expect(Object.keys(created?.parameters.properties ?? {})).toEqual(['profile']);
    expect(typeof created?.output.render).toBe('function');
    // `new` 的输出是 `oneOf`(成功 | 审批取消) 联合 ⇒ 无顶层 `type`，逐个分支看：
    // 第一条分支的 `required` 恰恰是我们写在**属性节点**上的 `required: true` 被编译出来的
    const branches = created?.output.schema.oneOf as readonly Record<string, any>[] | undefined;
    expect(Array.isArray(branches)).toBe(true);
    expect(branches?.length).toBe(2);
    expect(branches?.[0]?.type).toBe('object');
    expect(branches?.[0]?.required).toEqual(['id', 'profile', 'rows', 'cols']);
    expect(branches?.[1]?.required).toEqual(['ok', 'code', 'message']);
    expect(branches?.[0]?.additionalProperties).toBe(false);

    // `list` / `read` / `write` / `resize` / `kill` 也都编译出了 parameters 与 output.schema
    for (const name of TERMINAL_TOOL_NAMES) {
      const definition = byName.get(name);
      expect(definition, `工具 ${name} 未注册`).toBeDefined();
      expect(definition?.parameters.type).toBe('object');
      expect(definition?.output.schema).toBeDefined();
      expect(typeof definition?.output.render).toBe('function');
      expect(typeof definition?.execute).toBe('function');
    }
  });

  it('③ 负向对照：顶层 required 数组必须被真模块拒收（否则本文件会静默变成恒真）', () => {
    expect(() =>
      defineTool({
        name: 'broken-fixture',
        description: 'negative control',
        parameters: {},
        output: { schema: BROKEN_OUTPUT_SCHEMA as any, render: () => [] },
      } as any),
    ).toThrow(/value schema DSL/);
  });
});
