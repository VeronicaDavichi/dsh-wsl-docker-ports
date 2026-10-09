/**
 * T3.1 / REQ-4.1–4.4 —— 错误语义（失败必须呈现为**可读结果**且不中断会话）
 *
 * ## 为什么这里**不**断言「`rejects` 计数为 0」
 *
 * design §7 的 2026-10-09 订正写明：`defineTool` **自身**就以 `ToolArgsError` 抛出做参数校验 ⇒
 * 「零 throw」这条断言会与宿主内建机制打架。真正的口径是 A-1 的 ③：
 * **工具体的 throw 被宿主归一化成 `isError: true` 的结构化结果（`Error: <msg>`）且不中断会话**。
 * 本文件用的 `runTool`（`tests/helpers/tools-define.ts`）就是那条归一化路径的替身 ——
 * 它捕获 throw 并折成结果，**不**重抛，于是「不中断」这件事在测试里是可断言的。
 */

import { describe, expect, it } from 'vitest';

import { supportedKeyNames } from '../../src/tools/keys.ts';
import { createFakeContext, runTool } from '../helpers/tools-define.ts';
import {
  createFakeApproval,
  createFakeSandboxPolicy,
  createToolsHarness,
  handleOf,
} from '../helpers/tools-harness.ts';

/** 每个自产失败码一个可复现的触发点（用来逐条验「码 + 人话 + hint」三件套都在） */
interface FailureCase {
  readonly tool: string;
  readonly args: unknown;
  readonly code: string;
  readonly sandbox: string;
}

const CASES: readonly FailureCase[] = [
  { tool: 'new', args: { profile: 'nope' }, code: 'profile-not-found', sandbox: 'workspace-write' },
  { tool: 'list', args: {}, code: '', sandbox: 'read-only' }, // 对照：只读下 list 不该失败
  { tool: 'read', args: { id: 'term-404' }, code: 'instance-not-found', sandbox: 'workspace-write' },
  { tool: 'write', args: { id: 'term-1', data: 'C-?' }, code: 'unknown-key', sandbox: 'workspace-write' },
  { tool: 'write', args: { id: 'term-404', data: 'ls' }, code: 'instance-not-found', sandbox: 'workspace-write' },
  { tool: 'resize', args: { id: 'term-404', rows: 30, cols: 100 }, code: 'instance-not-found', sandbox: 'workspace-write' },
  { tool: 'kill', args: { id: 'term-404' }, code: 'instance-not-found', sandbox: 'workspace-write' },
  { tool: 'new', args: { profile: 'pwsh' }, code: 'sandbox-denied', sandbox: 'read-only' },
  { tool: 'write', args: { id: 'term-1', data: 'Enter' }, code: 'sandbox-denied', sandbox: 'read-only' },
  { tool: 'resize', args: { id: 'term-1', rows: 30, cols: 100 }, code: 'sandbox-denied', sandbox: 'read-only' },
  { tool: 'kill', args: { id: 'term-1' }, code: 'sandbox-denied', sandbox: 'read-only' },
];

describe('T3.1 REQ-4.1 失败呈现为可读结果且不中断', () => {
  it('🔴 全部失败路径都归一化成 `isError:true` + `Error: [<code>] <人话>`，且**没有**抛出来', async () => {
    for (const item of CASES) {
      const h = createToolsHarness({ sandboxMode: item.sandbox });
      // 不 try/catch：`runTool` 若重抛，这里会直接炸 ⇒ 「不中断会话」被真的验到
      const result = await h.call(item.tool, item.args);
      if (item.code === '') {
        expect(result.isError, `${item.tool} 不该失败`).toBe(false);
      } else {
        expect(result.isError, `${item.tool} ${JSON.stringify(item.args)} 应失败`).toBe(true);
        const text = result.content[0]?.text ?? '';
        expect(text, `${item.tool} 的失败文本`).toMatch(/^Error: \[[a-z-]+\] /);
        expect(text).toContain(`[${item.code}]`);
        // 失败结果**不**携带成功值（不谎报成功）
        expect(result.value).toBeUndefined();
      }
      h.dispose();
    }
  });

  it('REQ-4.1：一次失败之后**同一套工具**还能继续正常服务（会话没被打断）', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write' });
    expect((await h.call('kill', { id: 'term-404' })).isError).toBe(true);
    expect((await h.call('new', { profile: 'pwsh' })).isError).toBe(false);
    expect((await h.call('write', { id: 'term-1', data: 'ls' })).isError).toBe(false);
    expect((await h.call('read', { id: 'term-1' })).isError).toBe(false);
    expect((await h.call('kill', { id: 'term-1' })).isError).toBe(false);
    h.dispose();
  });

  it('REQ-1.8：参数违规由 schema 在进体前拦下（宿主 `ToolArgsError`），同样归一化成结果', async () => {
    const h = createToolsHarness();
    const result = await runTool(h.tool('new'), {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('invalid arguments');
    // 参数违规根本没有进体 ⇒ 没有副作用
    expect(h.fake.spawnCalls).toHaveLength(0);
    h.dispose();
  });
});

describe('T3.1 REQ-4.3 错误含可读原因与可执行下一步', () => {
  it('沙箱拒绝：说出**当前**策略 + 怎么自救（切到 workspace-write，或用 read/list）', async () => {
    const h = createToolsHarness({ sandboxMode: 'read-only' });
    const text = (await h.call('write', { id: 'term-1', data: 'Enter' })).content
      .map((b) => b.text)
      .join('');

    expect(text).toContain('read-only');
    expect(text).toContain('提示：');
    expect(text).toContain('workspace-write');
    expect(text).toContain('read');
    h.dispose();
  });

  it('profile 不存在：把**可用的** profile 名列出来', async () => {
    const h = createToolsHarness();
    const text = await h.text('new', { profile: 'nope' });
    expect(text).toContain('可用 profile');
    expect(text).toContain('pwsh');
    expect(text).toContain('wsl');
    h.dispose();
  });

  it('实例不存在：指向 `list`（下一步动作可执行）', async () => {
    const h = createToolsHarness();
    const text = await h.text('read', { id: 'term-404' });
    expect(text).toContain('instance-not-found');
    expect(text).toContain('list');
    h.dispose();
  });

  it('未识别键名：把**已支持键名清单**给出来（不猜、不丢弃）', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write' });
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    const text = (await h.call('write', { id: 'term-1', data: 'C-?' })).content
      .map((b) => b.text)
      .join('');

    expect(text).toContain('[unknown-key]');
    for (const name of ['Enter', 'Tab', 'Esc', 'Backspace', 'ArrowUp', 'C-c']) {
      expect(text, `清单里应有 ${name}`).toContain(name);
    }
    expect(text).toContain(supportedKeyNames()[0]!);
    // 半个转义序列都没写进去（REQ-4.4）
    expect(handle.writeCalls).toStrictEqual([]);
    h.dispose();
  });

  it('REQ-4.3：没有任何一条失败是「internal error」这类无信息文本', async () => {
    for (const item of CASES.filter((entry) => entry.code !== '')) {
      const h = createToolsHarness({ sandboxMode: item.sandbox });
      const text = (await h.call(item.tool, item.args)).content.map((b) => b.text).join('');
      expect(text.length, `${item.tool} 的错误文本太短`).toBeGreaterThan(30);
      expect(text.toLowerCase()).not.toContain('internal error');
      expect(text).not.toContain('undefined');
      h.dispose();
    }
  });
});

describe('T3.1 REQ-4.2 未识别键名（不猜、不丢弃）', () => {
  it('异常：判定**先于**实例查找与权限门（参数级错误不该被误报成别的问题）', async () => {
    const h = createToolsHarness({ sandboxMode: 'read-only' });
    const text = (await h.call('write', { id: 'term-404', data: 'Frobnicate' })).content
      .map((b) => b.text)
      .join('');

    expect(text).toContain('[unknown-key]');
    expect(text).not.toContain('[instance-not-found]');
    expect(text).not.toContain('[sandbox-denied]');
    h.dispose();
  });

  it('REQ-4.4：一次非法键名之后工具仍可用（不留半成品、不卡住）', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write' });
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    expect((await h.call('write', { id: 'term-1', data: 'C-?' })).isError).toBe(true);
    expect((await h.call('write', { id: 'term-1', data: 'Enter' })).isError).toBe(false);

    expect(handle.writeCalls).toStrictEqual(['\r']);
    h.dispose();
  });
});

describe('T3.1 工具面只经宿主公开面取服务', () => {
  it('`ctx.get` 只被问 `sandboxPolicy` / `approval` 两个名字，`subprocess` 一次都没问', () => {
    const policy = createFakeSandboxPolicy('workspace-write');
    const approval = createFakeApproval();
    const ctx = createFakeContext({ sandboxPolicy: policy.service, approval: approval.service });

    expect(ctx.get?.('sandboxPolicy')).toBe(policy.service);
    expect(ctx.get?.('approval')).toBe(approval.service);
    expect(ctx.getCalls).toStrictEqual(['sandboxPolicy', 'approval']);
    expect(ctx.get?.('subprocess')).toBeUndefined();
  });

  it('`ctx.get` 本身不存在（极简宿主）也不炸 —— 按缺服务走保守路径', async () => {
    const h = createToolsHarness({ sandboxMode: 'workspace-write' });
    // 去掉 `get`：模拟「宿主没有服务定位器」的极端形态
    delete (h.ctx as { get?: unknown }).get;
    const result = await h.call('new', { profile: 'pwsh' });
    expect(result.isError).toBe(true);
    expect(result.content.map((b) => b.text).join('')).toContain('[sandbox-denied]');
    h.dispose();
  });
});
