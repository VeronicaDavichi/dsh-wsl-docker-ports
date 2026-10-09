/**
 * T2.1 / T2.2 / REQ-3.1–3.5 —— 沙箱映射与审批门
 *
 * 这一组是**权限矩阵**用例（design §4 那张表逐格断言），与 `./tools-lifecycle.test.ts`（工具行为）、
 * `./tools-errors.test.ts`（错误语义）分开：矩阵断言的价值在于「逐格都点到」，混在别的用例里容易被
 * 漏掉一格而看不出来。
 *
 * 🔴 每个「拒绝」用例都必须同时断言**副作用为零**（`spawnCalls` / `list()`，必要时还有 handle 的
 * `resizeCalls`）：只断言 `isError` 证明不了「没进入业务逻辑」，而 REQ-3.1 要的正是后者（拒绝是终态）。
 */

import { describe, expect, it } from 'vitest';

import { createToolsHarness, handleOf } from '../helpers/tools-harness.ts';

/** 四个受策略约束的写工具 + 各自的合法参数（参数合法才能保证「被拒」不是参数问题） */
const WRITE_TOOLS = [
  { name: 'new', args: { profile: 'pwsh' } },
  { name: 'write', args: { id: 'term-1', data: 'Enter' } },
  { name: 'resize', args: { id: 'term-1', rows: 30, cols: 100 } },
  { name: 'kill', args: { id: 'term-1' } },
] as const;

describe('T2.1 REQ-3.1–3.4 沙箱映射（design §4 矩阵逐格）', () => {
  it('read-only：四个写工具**全部**被拒、原因可读且含当前策略，且 002 的调用计数为 0', async () => {
    const h = createToolsHarness({ sandboxMode: 'read-only' });
    for (const item of WRITE_TOOLS) {
      const result = await h.call(item.name, item.args);
      expect(result.isError, `${item.name} 应被拒`).toBe(true);
      const text = result.content.map((block) => block.text).join('');
      expect(text).toContain('[sandbox-denied]');
      expect(text).toContain('read-only');
    }
    // 🔴 没有进入业务逻辑：不是「先做后拒」
    expect(h.fake.spawnCalls).toHaveLength(0);
    expect(h.fake.handles).toHaveLength(0);
    expect(h.manager.list()).toStrictEqual([]);
    h.dispose();
  });

  it('read-only：read / list 仍然可用（REQ-3.2 只读语义），read 的失败只可能是「实例不存在」', async () => {
    const h = createToolsHarness({ sandboxMode: 'read-only' });
    expect((await h.call('list', {})).isError).toBe(false);
    const read = await h.call('read', { id: 'term-1' });
    expect(read.isError).toBe(true);
    const text = read.content.map((block) => block.text).join('');
    expect(text).toContain('[instance-not-found]');
    expect(text).not.toContain('[sandbox-denied]');
    h.dispose();
  });

  it('workspace-write：四个写工具**都放行**（对照组：证明上面的拒绝不是恒真）', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write' });
    expect((await h.call('new', { profile: 'pwsh' })).isError).toBe(false);
    expect((await h.call('resize', { id: 'term-1', rows: 30, cols: 100 })).isError).toBe(false);
    expect((await h.call('write', { id: 'term-1', data: 'Enter' })).isError).toBe(false);
    expect((await h.call('kill', { id: 'term-1' })).isError).toBe(false);
    expect(h.fake.spawnCalls).toHaveLength(1);
    h.dispose();
  });

  it('danger-full-access：四个写工具也放行（design §4 把该档归「可写」）', async () => {
    const h = createToolsHarness({ sandboxMode: 'danger-full-access' });
    expect((await h.call('new', { profile: 'pwsh' })).isError).toBe(false);
    expect((await h.call('write', { id: 'term-1', data: 'ls' })).isError).toBe(false);
    h.dispose();
  });

  it('REQ-3.4 异常：**服务缺失** ⇒ 最保守（拒绝写）、002 调用数 = 0；read/list 仍可用', async () => {
    const h = createToolsHarness({ withSandbox: false, withApproval: false });    for (const item of WRITE_TOOLS) {
      const result = await h.call(item.name, item.args);
      expect(result.isError, `${item.name} 应被拒`).toBe(true);
      const text = result.content.map((block) => block.text).join('');
      expect(text).toContain('[sandbox-denied]');
      // 缺服务与「策略就是只读」是两条不同的自救路径，消息必须能区分
      expect(text).toContain('未提供沙箱策略服务');
    }
    expect(h.fake.spawnCalls).toHaveLength(0);
    expect((await h.call('list', {})).isError).toBe(false);
    h.dispose();
  });

  it('REQ-3.4 边界：**只**缺沙箱服务（审批仍在）⇒ 仍是 sandbox-denied，且没问一次审批', async () => {
    const h = createToolsHarness({ withSandbox: false, withApproval: true });
    const result = await h.call('new', { profile: 'pwsh' });
    expect(result.isError).toBe(true);
    expect(result.content.map((b) => b.text).join('')).toContain('[sandbox-denied]');
    expect(h.approval.calls).toHaveLength(0);
    h.dispose();
  });

  it('REQ-3.4 边界：服务在但 `resolve` 返回 undefined / 抛错 / 给未知模式 ⇒ 一律保守拒绝', async () => {
    const noMode = createToolsHarness({ sandboxMode: 'workspace-write' });
    noMode.policy.mode = undefined;
    expect((await noMode.call('new', { profile: 'pwsh' })).isError).toBe(true);
    noMode.dispose();

    const throwing = createToolsHarness({ sandboxMode: 'workspace-write' });
    throwing.policy.throwOnResolve = new Error('backend down');
    expect((await throwing.call('new', { profile: 'pwsh' })).isError).toBe(true);
    throwing.dispose();

    const unknown = createToolsHarness({ sandboxMode: 'yolo-mode' });
    const result = await unknown.call('new', { profile: 'pwsh' });
    expect(result.isError).toBe(true);
    expect(result.content.map((b) => b.text).join('')).toContain('[sandbox-denied]');
    unknown.dispose();
  });

  it('REQ-3.3：判定**只**经 ctx.get("sandboxPolicy") 的非严格取用，且每次写调用都解析一次、带上会话', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write' });
    await h.call('new', { profile: 'pwsh' });
    await h.call('resize', { id: 'term-1', rows: 30, cols: 100 });
    expect(h.policy.resolveCalls).toBe(2);
    // 每次都带上了调用会话（`resolve({ session })`：策略按 session 解析，与官方 fs 同形）
    for (const request of h.policy.requests) {
      expect(request).toMatchObject({ session: expect.anything() });
    }
    // 只读调用**不**解析策略（read / list 与沙箱无关，不该白问一次）
    const before = h.policy.resolveCalls;
    await h.call('list', {});
    await h.call('read', { id: 'term-1' });
    expect(h.policy.resolveCalls).toBe(before);
    h.dispose();
  });

  it('REQ-3.1 边界：沙箱拒绝**先于**审批（不花掉一次注定被拒的审批）', async () => {
    const h = createToolsHarness({ sandboxMode: 'read-only', withApproval: true });
    const result = await h.call('new', { profile: 'pwsh' });
    expect(result.isError).toBe(true);
    expect(h.approval.calls).toHaveLength(0);
    h.dispose();
  });

  it('REQ-3.1 边界：只读下被拒的 `resize` **不**调宿主 handle（可观察的「零副作用」）', async () => {
    // 先在可写策略下起一个实例，再切成只读：实例**存在** ⇒ 唯一能拦住它的就是沙箱门
    const h = createToolsHarness({ sandboxMode: 'workspace-write' });
    await h.call('new', { profile: 'pwsh' });
    const handle = handleOf(h.fake);
    h.policy.mode = 'read-only';

    const result = await h.call('resize', { id: 'term-1', rows: 30, cols: 100 });

    expect(result.isError).toBe(true);
    expect(result.content.map((b) => b.text).join('')).toContain('[sandbox-denied]');
    expect(handle.resizeCalls).toStrictEqual([]);
    h.dispose();
  });
});

describe('T2.2 REQ-3.5 审批拒绝路径', () => {
  for (const outcome of ['rejected', 'cancelled', 'unavailable'] as const) {
    it(`异常：审批返回 ${outcome} ⇒ cancelled 结果、**无**副作用、**未**标记为系统错误`, async () => {
      const h = createToolsHarness({ sandboxMode: 'workspace-write', withApproval: true, approvalOutcome: outcome });

      const result = await h.call('new', { profile: 'pwsh' });

      // 「未标记为系统错误」：isError=false + 值是结构化的 cancelled
      expect(result.isError).toBe(false);
      expect(result.value).toMatchObject({ ok: false, code: 'cancelled' });
      // 「无副作用」：一个进程都没起
      expect(h.fake.spawnCalls).toHaveLength(0);
      expect(h.manager.list()).toStrictEqual([]);
      h.dispose();
    });
  }

  it('正常：审批 allowed-once ⇒ 放行（对照组），且审批拿到的是 toolName + reason + callId', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write', withApproval: true, approvalOutcome: 'allowed-once' });

    const result = await h.call('new', { profile: 'pwsh' }, { callId: 'call-42' });

    expect(result.isError).toBe(false);
    expect(h.approval.calls).toHaveLength(1);
    expect(h.approval.calls[0]).toMatchObject({ toolName: 'new', callId: 'call-42' });
    expect(String(h.approval.calls[0]?.reason)).toContain('pwsh');
    h.dispose();
  });

  it('异常：无 agent（无人可问）⇒ cancelled 且未标记错误、无副作用（fail closed）', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write', withApproval: true });

    const result = await h.call('new', { profile: 'pwsh' }, { agent: undefined });

    expect(result.isError).toBe(false);
    expect(result.value).toMatchObject({ ok: false, code: 'cancelled' });
    expect(h.fake.spawnCalls).toHaveLength(0);
    h.dispose();
  });

  it('异常：审批服务存在但 `request` 抛错（无开启的 turn）⇒ 同样 cancelled、不炸会话', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write', withApproval: true, approvalThrows: true });

    const result = await h.call('kill', { id: 'term-1' });

    expect(result.isError).toBe(false);
    expect(result.value).toMatchObject({ ok: false, code: 'cancelled' });
    h.dispose();
  });

  it('异常：审批服务**缺失**（`ctx.get` 拿不到）⇒ cancelled 而非放行（REQ-3.4 的审批侧）', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write', withApproval: false });

    const result = await h.call('new', { profile: 'pwsh' });

    expect(result.isError).toBe(false);
    expect(result.value).toMatchObject({ ok: false, code: 'cancelled' });
    expect(h.fake.spawnCalls).toHaveLength(0);
    h.dispose();
  });

  it('REQ-3.5：取消路径**不**走 error 通道（四个写工具一组，isError 计数为 0）', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write', withApproval: true, approvalOutcome: 'rejected' });
    const results = [];
    for (const item of WRITE_TOOLS) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await h.call(item.name, item.args));
    }
    expect(results.filter((item) => item.isError)).toHaveLength(0);
    expect(results.map((item) => (item.value as { code: string }).code)).toStrictEqual([
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(h.fake.spawnCalls).toHaveLength(0);
    expect(h.approval.calls.map((call) => call.toolName)).toStrictEqual(['new', 'write', 'resize', 'kill']);
    h.dispose();
  });

  it('REQ-3.5：审批取消**不**消耗实例（先起的实例仍在，kill 被取消后实例还在）', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write', withApproval: true });
    await h.start('pwsh');
    h.approval.outcome = 'rejected';

    const result = await h.call('kill', { id: 'term-1' });

    expect(result.value).toMatchObject({ ok: false, code: 'cancelled' });
    expect(h.manager.list()).toHaveLength(1);
    expect(handleOf(h.fake).terminated).toBe(false);
    h.dispose();
  });
});
