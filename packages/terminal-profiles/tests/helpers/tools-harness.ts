/**
 * 004 的「假宿主集成」夹具：真 002 实例表 + fake `ctx.subprocess` + fake `defineTool` + fake `ctx.get`
 *
 * 刻意**不**手搓 `SessionManager`：`createSessionManager` 就是 002 交付的那一个（真实例表、真夹紧、
 * 真换序、真 `lost` 判定）。工具面是薄适配层，只有接在**真的** 002 上，「002 的调用计数 = 0」与
 * 「透传给宿主的 `resize` 顺序」这两条断言才有意义 —— 手搓 manager 等于把被测对象换掉。
 *
 * 三层可注入（对应 design §7 的测试策略表）：
 * - `subprocess`：`tests/helpers/fake-pty.ts`（002 那份，**复用**，含按位置记录的 `resizeCalls`）；
 * - `defineTool` / `tools`：`tests/helpers/tools-define.ts`（照 A-1 的机制实现）；
 * - `sandboxPolicy` / `approval`：本文件的两个小 fake（策略矩阵与审批闭集）。
 */

import { createSessionManager } from '../../src/session/manager.ts';
import type { SessionManager } from '../../src/session/manager.ts';
import { parseProfiles } from '../../src/config/profiles.ts';
import type { TerminalProfile } from '../../src/config/profiles.ts';
import { createTerminalTools } from '../../src/tools/register.ts';
import type { HostContextLike } from '../../src/tools/host.ts';
import { createFakeSubprocess } from './fake-pty.ts';
import type { FakeSubprocess, FakePtyHandle } from './fake-pty.ts';
import { compileTool, createFakeContext, createFakeTools, resultText, runTool } from './tools-define.ts';
import type { CompiledTool, NormalizedToolResult } from './tools-define.ts';

/** 用真配置解析器造一条 profile（夹具坏了就直接炸出来，不静默变成空表） */
export function profileOf(raw: unknown): TerminalProfile {
  const parsed = parseProfiles([raw]);
  const profile = parsed.profiles[0];
  if (profile === undefined) throw new Error(`夹具解析失败：${JSON.stringify(parsed.diagnostics)}`);
  return profile;
}

/**
 * 沙箱策略服务的 fake（只实现本 Spec 消费的 `resolve`）。
 *
 * `resolveCalls` 用来断言「**只**走 `ctx.sandboxPolicy` 这一条路」（REQ-3.3 的「同一份策略」）。
 * 用**可写字段**而不是 getter/setter：`exactOptionalPropertyTypes` 下访问器对
 * `string | undefined` 的推断会让「把 undefined 赋回去」编译不过，而「策略服务返回 undefined」
 * 恰恰是 REQ-3.4 要测的分支。
 */
export interface FakeSandboxPolicy {
  readonly service: { resolve(request?: { session?: unknown; mode?: string }): { mode: string } | undefined };
  resolveCalls: number;
  readonly requests: readonly unknown[];
  /** 当前模式；`undefined` = 服务存在但**解析不出**（REQ-3.4 的保守分支） */
  mode: string | undefined;
  /** 设上它就让 `resolve` 抛错（验「解析失败 ⇒ 保守拒绝」） */
  throwOnResolve: Error | undefined;
}

export function createFakeSandboxPolicy(initial: string | undefined = 'workspace-write'): FakeSandboxPolicy {
  const requests: unknown[] = [];
  const fake: FakeSandboxPolicy = {
    service: {
      resolve: (request?: { session?: unknown; mode?: string }) => {
        fake.resolveCalls += 1;
        if (fake.throwOnResolve !== undefined) throw fake.throwOnResolve;
        requests.push(request);
        return fake.mode === undefined ? undefined : { mode: fake.mode };
      },
    },
    resolveCalls: 0,
    requests,
    mode: initial,
    throwOnResolve: undefined,
  };
  return fake;
}

/**
 * 审批服务的 fake（REQ-3.5：必须能模拟 `rejected` / `cancelled` / `unavailable` 三种返回，
 * 外加「服务在但 `request` 抛错」这条真实存在的路径 —— `ApprovalService.request` 在没有开启的
 * turn 时就会抛）。
 *
 * ⚠️ 用**独立的布尔开关** `throwOnRequest` 表达「抛错」，而不是让 `outcome === undefined` 兼任：
 * `?? 'allowed-once'` 与 `'key' in options` 这类推断在「显式传 undefined」时是**不可靠**的
 * （实测踩过：`in` 判定在这里返回 false，于是用例静默变成默认放行路径）。
 */
export interface FakeApproval {
  readonly service: {
    request(req: {
      agent: unknown;
      toolName: string;
      callId?: unknown;
      reason?: string;
      signal?: AbortSignal;
    }): Promise<string>;
  };
  /** 下一次（以及之后）的返回（闭集：`allowed-once` / `rejected` / `cancelled` / `unavailable`） */
  outcome: string;
  /** true ⇒ `request` 抛错（模拟「无开启的 turn」/ 审计写入失败） */
  throwOnRequest: boolean;
  readonly calls: readonly { toolName: string; reason?: string | undefined; callId?: unknown }[];
}

export function createFakeApproval(outcome = 'allowed-once'): FakeApproval {
  const calls: { toolName: string; reason?: string | undefined; callId?: unknown }[] = [];
  const fake: FakeApproval = {
    service: {
      async request(req) {
        calls.push({ toolName: req.toolName, reason: req.reason, callId: req.callId });
        if (fake.throwOnRequest) throw new Error('no open turn');
        return fake.outcome;
      },
    },
    outcome,
    throwOnRequest: false,
    calls,
  };
  return fake;
}

export interface ToolsHarnessOptions {
  /** profile 原始配置（默认一条 `pwsh.exe`，cwd `E:\\proj`） */
  readonly rawProfiles?: readonly unknown[];
  /** fake `ctx.subprocess` 的选项（`existingCwds` / `returnNothing` / …） */
  readonly subprocess?: Parameters<typeof createFakeSubprocess>[0];
  /** 沙箱模式；`undefined` = **不挂载** `sandboxPolicy` 服务（REQ-3.4 的缺服务路径） */
  readonly sandboxMode?: string | undefined;
  /** 是否挂载沙箱服务（默认按 `sandboxMode` 推断；显式 `false` 可造「缺失」） */
  readonly withSandbox?: boolean;
  /** 是否挂载审批服务 */
  readonly withApproval?: boolean;
  /** 审批返回（闭集）；不传 = `allowed-once` */
  readonly approvalOutcome?: string;
  /** true ⇒ 审批服务存在但 `request` 抛错（模拟「无开启的 turn」） */
  readonly approvalThrows?: boolean;
}

const DEFAULT_PROFILES: readonly unknown[] = [
  { name: 'pwsh', command: 'pwsh.exe', args: ['-NoLogo'], env: { FOO: 'bar' }, cwd: 'E:\\proj' },
  { name: 'wsl', command: 'wsl.exe', args: ['-d', 'Ubuntu2204'], cwd: 'E:\\proj' },
];

export interface ToolsHarness {
  readonly fake: FakeSubprocess;
  readonly manager: SessionManager;
  readonly tools: ReturnType<typeof createFakeTools>;
  readonly policy: FakeSandboxPolicy;
  readonly approval: FakeApproval;
  readonly ctx: HostContextLike;
  readonly registered: ReturnType<typeof createTerminalTools>;
  readonly profileList: readonly TerminalProfile[];
  /** 按名字取一个注册好的工具（未注册 ⇒ 抛错，测试里立刻可见） */
  tool(name: string): CompiledTool;
  call(
    name: string,
    args: unknown,
    exec?: { readonly agent?: unknown; readonly callId?: unknown },
  ): Promise<NormalizedToolResult>;
  text(name: string, args: unknown, exec?: { readonly agent?: unknown }): Promise<string>;
  /** 起一个真实例（**经工具面**：这样沙箱与审批门与生产同路径，不会「夹具绕过了被测逻辑」） */
  start(profileName: string): Promise<string>;
  readonly dispose: () => void;
}

interface HarnessState {
  readonly fake: FakeSubprocess;
  readonly manager: SessionManager;
  readonly tools: ReturnType<typeof createFakeTools>;
  readonly policy: FakeSandboxPolicy;
  readonly approval: FakeApproval;
  readonly ctx: HostContextLike;
  readonly profileList: readonly TerminalProfile[];
  registered: ReturnType<typeof createTerminalTools> | undefined;
}

export function createToolsHarness(options: ToolsHarnessOptions = {}): ToolsHarness {
  const raw = options.rawProfiles ?? DEFAULT_PROFILES;
  const parsed = parseProfiles(raw);
  const fake = createFakeSubprocess(options.subprocess ?? {});
  const manager = createSessionManager({ subprocess: fake.surface });
  const tools = createFakeTools();
  const policy = createFakeSandboxPolicy(options.sandboxMode ?? 'workspace-write');
  const approval = createFakeApproval(options.approvalOutcome ?? 'allowed-once');
  approval.throwOnRequest = options.approvalThrows ?? false;

  // 默认**挂载**沙箱服务（`workspace-write`）；要测 REQ-3.4 的缺服务路径就显式 `withSandbox: false`。
  // ⚠️ 这里不能用 `options.sandboxMode !== undefined` 推断 —— 不传 `sandboxMode` 是最常见的用法，
  // 那种写法会把它误判成「缺服务」，于是所有放行用例都变成拒绝，看起来像被测代码坏了。
  const withSandbox = options.withSandbox ?? true;
  // 审批也默认挂载（`allowed-once`）：生产 profile 里 `ctx.approval` 确实在（见 design §8-5），
  // 「缺审批服务」是防御性分支。要测那条分支就显式 `withApproval: false`。
  // ⚠️ 默认**不能**是「不挂载」：那样所有「放行」用例都会变成 cancelled，而失败原因看起来像被测代码坏了。
  const withApproval = options.withApproval ?? true;
  const ctx = createFakeContext({
    ...(withSandbox ? { sandboxPolicy: policy.service } : {}),
    ...(withApproval ? { approval: approval.service } : {}),
  });

  const state: HarnessState = {
    fake,
    manager,
    tools,
    policy,
    approval,
    ctx: { ...ctx, tools: tools.service },
    profileList: parsed.profiles,
    registered: undefined,
  };

  const registered = createTerminalTools({
    defineTool: (definition) => compileTool(definition),
    tools: tools.service,
    manager,
    profiles: () => state.profileList,
    ctx: state.ctx,
  });
  state.registered = registered;

  const tool = (name: string): CompiledTool => {
    const found = tools.get(name);
    if (found === undefined) throw new Error(`工具「${name}」未注册；当前注册表：${tools.names.join('、')}`);
    return found;
  };

  /**
   * 默认 exec：**带 agent**（`ctx.approval.request` 需要它来路由与写审计）。
   * 要验「没有 agent ⇒ 无人可问 ⇒ 取消」时，调用点显式传 `{ agent: undefined }`。
   */
  const defaultExec = { agent: { session: { header: { cwd: 'E:\\proj' } } } } as const;

  const call = (
    name: string,
    args: unknown,
    exec: { readonly agent?: unknown; readonly callId?: unknown } = defaultExec,
  ): Promise<NormalizedToolResult> => {
    const agent = 'agent' in exec ? exec.agent : defaultExec.agent;
    return runTool(tool(name), args, {
      agent,
      ...(exec.callId === undefined ? {} : { callId: exec.callId }),
    });
  };

  return {
    fake,
    manager,
    tools,
    policy,
    approval,
    ctx: state.ctx,
    registered,
    profileList: state.profileList,
    tool,
    call,
    async text(name, args, exec) {
      return resultText(await call(name, args, exec));
    },
    async start(profileName) {
      // 走**工具面**的 `new`：沙箱门、审批门、实例表登记与生产完全同一条路
      const result = await call('new', { profile: profileName });
      if (result.isError) throw new Error(`夹具起实例失败：${resultText(result)}`);
      return (result.value as { id: string }).id;
    },
    dispose: () => registered.dispose(),
  };
}

/** 取第一个 handle（断言宿主侧实参用；没有就抛，避免 `?.` 把测试写成恒真） */
export function handleOf(fake: FakeSubprocess, index = 0): FakePtyHandle {
  const handle = fake.handles[index];
  if (handle === undefined) throw new Error(`夹具没有第 ${index} 个 handle`);
  return handle;
}
