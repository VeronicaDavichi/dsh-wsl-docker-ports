/**
 * fake `defineTool` + 参数/输出校验器（004 的「零真机」载体之一）
 *
 * ## 为什么必须**照 A-1 的机制**实现，而不是只记一下调用
 *
 * T1.3 的验收是「非法参数在业务逻辑前被拒 ⇒ 002 的调用计数 = 0」。这条断言的**主语是宿主**：
 * 真宿主的 `defineTool` 会把 `execute` 包一层，先 `validateJsonSchemaValue(parameters, args)`
 * 再进体（`ToolArgsError`）。若 fake 只是「记录调用后直接跑 execute」，那条断言就变成
 * 「我的 fake 不校验所以业务逻辑跑了」——什么也没证明。⇒ 本文件实现同一套语义：
 * **编译参数 DSL → 校验 → 违规就抛 `ToolArgsError`，绝不进体**。
 *
 * 同时它按 A-1 的 ③ 提供 `runTool`：把工具体的 **throw 归一化成 `isError:true` 的可读结果**
 * （`Error: <msg>`）且**不中断**（不重新抛）—— 这正是宿主 `toolErrorResult` 的行为，
 * 也是 T3.1「失败呈现为 `isError:true` 的可读结果且不中断会话」的判定点。
 */

import type { HostContextLike, ParamNode, ParamSpec, ValueNode } from '../../src/tools/host.ts';

/** 参数违规（与宿主的 `ToolArgsError` 同名同义：进体**之前**的唯一失败出口） */
export class ToolArgsError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`invalid arguments: ${violations.join('; ')}`);
    this.name = 'ToolArgsError';
    this.violations = violations;
  }
}

/** 一个已注册工具的**可调用**视图（测试用；宿主侧不需要它） */
export interface CompiledTool {
  readonly name: string;
  readonly description: string;
  /** 编译后的参数 DSL（**原始声明**，用来断言形状与文档口径） */
  readonly parameters: ParamSpec;
  readonly output: { readonly schema: ValueNode; readonly render: (args: any, value: any) => unknown };
  execute(args: unknown, exec: unknown): Promise<unknown>;
}

/** `defineTool` 编译出的注册表条目（与宿主的 `ToolDefinition` 结构等价的那几个字段） */
export function compileTool(options: any): CompiledTool {
  const parameters = options.parameters as ParamSpec;
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: options.output,
    async execute(args: unknown, exec: unknown) {
      const violations = validateParams(parameters, args);
      if (violations.length > 0) throw new ToolArgsError(violations);
      return options.execute(args, exec);
    },
  };
}

/* ────────────────────────── JSON Schema 子集校验（与宿主同语义） ────────────────────────── */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 参数节点 → 值节点的**形状适配**（保 `required`：它在真 DSL 里就是属性节点自己的注解，值校验层也要读它）。
 * 参数 DSL 与值 schema 在本包是两个类型（`ParamNode` / `ValueNode`），但校验关键字同源，
 * ⇒ 各自声明一次、共用同一个 `validateValue`。**不**用 `as` 断言：多一个字段就会被这里挡住。
 *
 * 🔴 2026-10-09 集成方：原先这里还搬 `minimum` / `minLength`。集成时读真源码发现值 schema DSL
 * **没有**这两个键（`dsh-tools/lib/types/schema.js` 的作者键白名单）⇒ 已删。**这个删除比它看起来重要**：
 * 假宿主比真宿主宽松，正是「6 个工具在 fake 下全绿、在真模块下全部被拒」那类假绿的温床。
 */
function asValueNode(node: ParamNode): ValueNode {
  return {
    type: node.type,
    ...(node.description === undefined ? {} : { description: node.description }),
    ...(node.enum === undefined ? {} : { enum: node.enum }),
    ...(node.required === undefined ? {} : { required: node.required }),
    ...(node.items === undefined ? {} : { items: asValueNode(node.items) }),
    ...(node.properties === undefined
      ? {}
      : { properties: mapValues(node.properties, asValueNode) }),
    ...(node.additionalProperties === undefined
      ? {}
      : { additionalProperties: node.additionalProperties }),
  };
}

function mapValues(
  input: Readonly<Record<string, ParamNode>>,
  map: (node: ParamNode) => ValueNode,
): Record<string, ValueNode> {
  return Object.fromEntries(Object.entries(input).map(([key, node]) => [key, map(node)]));
}

/** 参数 DSL 编译：属性节点 → 隐式开放对象根 + 顶层 `required`（A-1 的 ①） */
export function validateParams(spec: ParamSpec, args: unknown): string[] {
  const violations: string[] = [];
  if (!isPlainObject(args)) return ['$: expected object'];
  const declared = new Set(Object.keys(spec));
  for (const key of Object.keys(args)) {
    if (!declared.has(key)) violations.push(`${key}: undeclared property`);
  }
  for (const [key, node] of Object.entries(spec)) {
    const present = Object.prototype.hasOwnProperty.call(args, key);
    if (!present) {
      if (node.required === true) violations.push(`${key}: required property is missing`);
      continue;
    }
    violations.push(...validateValue(asValueNode(node), args[key], key));
  }
  return violations;
}

/**
 * 值节点校验（**只**实现本 Spec 用到的关键字：type/enum/items/properties/oneOf）
 *
 * 🔴 2026-10-09：`minimum` / `minLength` 已删（真 DSL 没有这两个键）。相应地，本 Spec 里
 * 「负数 `sinceSeq` 拒收」「空串 `data` 拒收」两条判据分别改由 `register.ts` 的**运行期**判断承担
 * （见其 `read` / `write` 的 execute），而不是靠假 schema 拦 —— 假宿主不该比真宿主更严或更宽。
 */
export function validateValue(node: ValueNode | undefined, value: unknown, path: string): string[] {
  if (node === undefined) return [];
  const violations: string[] = [];
  if (node.type !== undefined && node.type !== 'json') {
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const expected = node.type === 'integer' ? 'number' : node.type;
    if (actual !== expected) return [`${path}: expected ${node.type}, got ${actual}`];
    if (node.type === 'integer' && !Number.isInteger(value)) return [`${path}: expected integer`];
  }
  if (node.enum !== undefined && !node.enum.includes(value as never)) {
    violations.push(`${path}: value not in enum`);
  }
  if (node.type === 'array' && Array.isArray(value) && node.items !== undefined) {
    value.forEach((item, index) => violations.push(...validateValue(node.items, item, `${path}[${index}]`)));
  }
  if (node.type === 'object' && isPlainObject(value)) {
    const properties = node.properties ?? {};
    for (const key of Object.keys(value)) {
      const property = properties[key];
      if (property === undefined) {
        if (node.additionalProperties === false) violations.push(`${path}.${key}: undeclared property`);
        continue;
      }
      violations.push(...validateValue(property, value[key], `${path}.${key}`));
    }
    // 🔴 必填来自**属性节点自己的 `required: true`**（真 DSL 的口径，2026-10-09 改）：原来的写法读
    // 对象节点上的顶层 `required` 数组 —— 那正是真宿主**不认**的形状，假宿主跟着错就会把真缺陷藏起来。
    for (const [key, property] of Object.entries(properties)) {
      if (property.required === true && !Object.prototype.hasOwnProperty.call(value, key)) {
        violations.push(`${path}.${key}: required property is missing`);
      }
    }
  }
  if (node.oneOf !== undefined) {
    const hits = node.oneOf.filter((branch) => validateValue(branch, value, path).length === 0);
    if (hits.length !== 1) violations.push(`${path}: oneOf matched ${hits.length} branches (expected exactly 1)`);
  }
  return violations;
}

/* ────────────────────────── 注册表 fake ────────────────────────── */

export interface FakeToolsRegistry {
  readonly service: { register(definition: unknown): () => void };
  /** 当前注册名（**按注册序**；卸载后真的会变短，NFR-1 靠它） */
  readonly names: readonly string[];
  readonly definitions: readonly CompiledTool[];
  get(name: string): CompiledTool | undefined;
}

export function createFakeTools(): FakeToolsRegistry {
  const entries = new Map<string, { tool: CompiledTool; alive: boolean }>();
  return {
    service: {
      register(definition: unknown) {
        const tool = definition as CompiledTool;
        const entry = { tool, alive: true };
        entries.set(tool.name, entry);
        return () => {
          // 真宿主的 disposer 是**精确**注销：只摘掉自己那一条（重复卸载是幂等的）
          if (entry.alive && entries.get(tool.name) === entry) entries.delete(tool.name);
          entry.alive = false;
        };
      },
    },
    get names() {
      return [...entries.keys()];
    },
    get definitions() {
      return [...entries.values()].map((entry) => entry.tool);
    },
    get(name: string) {
      return entries.get(name)?.tool;
    },
  };
}

/* ────────────────────────── 工具体执行（宿主归一化语义） ────────────────────────── */

/** 宿主的 `toolErrorResult` 形状（只保留本 Spec 断言用得到的两个字段） */
export interface NormalizedToolResult {
  readonly isError: boolean;
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly value?: unknown;
}

/**
 * 跑一次工具体并把结果归一化（A-1 的 ③）。
 *
 * 🔴 `throw` **不**向外传播：宿主会把它折成 `isError:true` 的结果、**会话继续**。测试若把
 * 「rejects」当验收，就与宿主内建机制打架（tasks.md 的 2026-10-09 订正正是这条）。
 */
export async function runTool(
  tool: CompiledTool,
  args: unknown,
  exec: { readonly agent?: unknown; readonly callId?: unknown; readonly signal?: AbortSignal } = {},
): Promise<NormalizedToolResult> {
  try {
    const value = await tool.execute(args, {
      callId: exec.callId ?? 'call-1',
      agent: exec.agent,
      signal: exec.signal ?? new AbortController().signal,
    });
    return { isError: false, content: tool.output.render(args, value) as never, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
  }
}

/** 把归一化结果拍平成一段文本（断言 `hint` 非空 / `code` 可见都靠它） */
export function resultText(result: NormalizedToolResult): string {
  return result.content.map((block) => block.text).join('\n');
}

/** 造一个最小 host context（沙箱/审批按需注入；`get` 拿不到就返回 `undefined` —— REQ-3.4） */
export function createFakeContext(services: {
  readonly sandboxPolicy?: unknown;
  readonly approval?: unknown;
} = {}): HostContextLike & { readonly getCalls: readonly string[] } {
  const getCalls: string[] = [];
  const table: Record<string, unknown> = {};
  if (services.sandboxPolicy !== undefined) table['sandboxPolicy'] = services.sandboxPolicy;
  if (services.approval !== undefined) table['approval'] = services.approval;
  return {
    tools: { register: () => () => {} },
    get(name: string) {
      getCalls.push(name);
      return table[name];
    },
    getCalls,
  };
}
