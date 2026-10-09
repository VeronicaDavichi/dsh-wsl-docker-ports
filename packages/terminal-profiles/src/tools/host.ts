/**
 * 004 —— `dsh-tools` 工具面的**本地结构面**（design §2 / §7 的 A-1 契约）
 *
 * ## 为什么是「结构面」而不是 `import { defineTool } from '@deepseek-ai/dsh-tools'`
 *
 * 与本包对 `ctx.subprocess` 的做法同源（见 `../session/types.ts` 的文件头）：本包硬约束是
 * **零运行时依赖 + 离线可验证**，`@deepseek-ai/dsh-tools` 不在本 workspace 的 `node_modules` 里
 * （宿主提供的实现），import 它既违反约束、也**离线 typecheck 不过**。
 *
 * ⇒ 这里只声明本 Spec **真正调用**的那几个成员，并把 A-1 复核过的三条事实钉在签名上：
 *
 * ① `defineTool` 是**纯编译函数**（参数 DSL 编译成顶层 `required`），注册走 `ctx.tools.register`；
 * ② `register` **返回 disposer**（NFR-1 的卸载计数靠它）；
 * ③ 参数 DSL 是 **dsh-tools 自有**形状：`{ type, required, description, enum? }` —— `required` 写在
 *    **属性节点内**（**不是** Schemastery；与本包 `Config` 的 schemastery 红线是两套系统）。
 *
 * ## 🔴 为什么 `defineTool` 是**注入**的，而不是本文件里 `import` 一个值
 *
 * 「定义一个工具」这件事必须用**宿主那一份** `defineTool`（它编译出的 `ToolDefinition` 才是注册表
 * 认的形状）。本包不能 import 它（见上），所以把它做成 `createTerminalTools` 的入参：宿主插件入口
 * 在 T4.x 接线时把真 `defineTool` 传进来；单测传 `tests/helpers/tools-harness.ts` 里的 fake（严格
 * 照 ①–③ 与 `validateArgs` 的语义实现）。**类型**则由宿主那一份 `DefineTool` 注入 —— 于是工具的
 * `parameters` / `output` 仍然被**真正**的 `defineTool` 签名检查，不是自说自话。
 *
 * ⚠️ `ctx` 只声明 `get(name)`（非严格取服务，拿不到返回 `undefined`）与 `tools.register`：
 * REQ-3.4 明写**不许**用 `static inject` 的 fail-fast 范式（缺服务时工具会**根本不激活**，
 * 与 REQ-1.1「恰好 6 个」冲突）⇒ 权限与审批一律走 `ctx.get` + 工具体内自判。
 */

/** 工具结果的文本块（本 Spec 只用纯文本；`render` 的返回类型由宿主 `ContentBlock` 约束） */
export interface ToolTextBlock {
  readonly type: 'text';
  readonly text: string;
}

/** 一条内容块的最小结构面（宿主的 `ContentBlock` 有更多变体，本 Spec 只产出/消费文本） */
export type ToolContent = readonly ToolTextBlock[];

/**
 * 参数属性节点（`required` 写在**属性节点内**）
 *
 * 🔴 2026-10-09 集成方**读真源码**校订（`@deepseek-ai/dsh-tools@0.2.0-rc.2` 的
 * `lib/types/schema.js` L126-192 = `assertAuthorKeys` 白名单）：本 DSL **没有** `minimum` /
 * `minLength` / `pattern` / `format` / `maximum` 这些 JSON Schema 数值键 —— 写了就是**作者错**
 * （`… is not supported by the value schema DSL`）。原先那两字段是按「宿主 JSON Schema 子集
 * 支持它」的**推断**加的，实测被推翻 ⇒ 删除；相关约束改由**运行期**兑现。
 * 标量节点允许的键 = `type` + `enum` + `const`（另加 `description`/`title`/`default`/`examples`）。
 */
export interface ParamNode {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  readonly required?: true;
  readonly description?: string;
  readonly enum?: readonly (string | number | boolean)[];
  readonly const?: string | number | boolean | null;
  readonly items?: ParamNode;
  readonly properties?: Record<string, ParamNode>;
  readonly additionalProperties?: boolean;
}

/** 隐式参数根（每属性一个节点；编译成顶层 `required`） */
export type ParamSpec = Record<string, ParamNode>;

/**
 * 值 schema 节点（`output.schema` 用；`json` 节点是作者侧的不受限壳）
 *
 * 🔴 校订点（同上，读真源码所得）：`required` **不是**顶层数组，而是**属性节点上的 `true`**；
 * 顶层写 `required: [...]` 会被 `…schema.required is not supported by the value schema DSL` 拒收
 * —— 这正是 6 个工具初次注册**全被拒**的头号原因。`object` 节点的 `additionalProperties`
 * **必须显式给 boolean**（否则 `… must be explicitly true or false`）。
 */
export interface ValueNode {
  readonly type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'json' | 'null';
  readonly description?: string;
  readonly properties?: Record<string, ValueNode>;
  readonly additionalProperties?: boolean;
  readonly items?: ValueNode;
  /** 属性节点上的必填标记（**只有** `properties` 的直接子节点可以写） */
  readonly required?: true;
  /** 判别联合（`read` 的两模式、`write` 的取消分支都靠它）；分支节点**不得**再带 `required` */
  readonly oneOf?: readonly ValueNode[];
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly const?: string | number | boolean | null;
}

/** `defineTool` 的入参面（**只列本 Spec 用到的字段**；`output:{schema,render}` 必填 —— A-1） */
export interface DefineToolOptions {
  readonly name: string;
  readonly description: string;
  readonly parameters: ParamSpec;
  readonly output: {
    readonly schema: ValueNode;
    readonly render: (args: any, value: any) => ToolContent;
  };
  readonly execute: (args: any, exec: ToolRunContext) => Promise<unknown>;
}

/** 宿主 `defineTool` 的可注入签名（单测传 fake；生产传宿主那一份） */
export type DefineTool = (options: DefineToolOptions) => unknown;

/**
 * 工具体收到的执行上下文（只列本 Spec 真正读的字段）。
 *
 * `agent` 是**可选**的：`ctx.approval.request` 要求一个 Agent 来路由与写审计，没有 agent 时
 * 我们只能按「无人可问」走 `unavailable`（REQ-3.5 的 fail-closed）—— 这条分支会真的被走到，
 * 所以类型上不给它 `!`。
 */
export interface ToolRunContext {
  readonly callId?: unknown;
  readonly agent?: unknown;
  readonly signal?: AbortSignal;
}

/** 最小可注入的「工具调用」身份（test harness 只造这些） */
export interface ToolRunContextLike {
  readonly callId?: unknown;
  readonly agent?: unknown;
  readonly signal?: AbortSignal;
}

/** `ctx.tools` 里本 Spec 用到的那一点：`register` **返回 disposer**（A-1 的 ②） */
export interface ToolsServiceLike {
  register(definition: unknown): () => void;
}

/** 沙箱策略解析器（`@deepseek-ai/dsh-sandbox-policy` 的 `SandboxPolicyService`；design §4/§6） */
export interface SandboxPolicyLike {
  /** 逐调用解析：返回完整策略（`mode` + `workspaceRoot`） */
  resolve(request?: { session?: unknown; mode?: string }): { readonly mode?: string } | undefined;
}

/** 审批服务（`@deepseek-ai/dsh-user-approval` 的 `ApprovalService`；REQ-3.5） */
export interface ApprovalLike {
  request(req: {
    readonly agent: unknown;
    readonly toolName: string;
    readonly callId?: unknown;
    readonly reason?: string;
    readonly signal?: AbortSignal;
  }): Promise<string>;
}

/**
 * 本 Spec 消费的 host context 面。
 *
 * ⚠️ `get` 是**非严格**的：拿不到服务返回 `undefined`（不是抛错、也不是 fail-fast）——
 * REQ-3.4 要的正是这条路径，而不是官方 `static inject` 的加载期拒绝。
 */
export interface HostContextLike {
  readonly tools: ToolsServiceLike;
  get?(name: string): unknown;
}

/** 服务器名字（`ctx.get` 的键；与宿主服务名逐字一致） */
export const SANDBOX_POLICY_SERVICE = 'sandboxPolicy';
export const APPROVAL_SERVICE = 'approval';
