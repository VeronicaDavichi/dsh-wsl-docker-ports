/**
 * T1.1 / T1.3 —— 注册表契约与 `new` / `list` / `kill` 的行为（含参数校验与半成品检查）
 *
 * 零真机：`createToolsHarness` 接**真的** 002 `createSessionManager` + fake `ctx.subprocess`
 * （复用 `tests/helpers/fake-pty.ts`）+ fake `defineTool`（复用 `tests/helpers/tools-define.ts`）。
 * 沙箱/审批矩阵见 `./tools-permissions.test.ts`，错误语义见 `./tools-errors.test.ts`。
 */

import { describe, expect, it } from 'vitest';

import { TERMINAL_TOOL_NAMES } from '../../src/tools/register.ts';
import { createToolsHarness, handleOf } from '../helpers/tools-harness.ts';

describe('T1.1 REQ-1.1 工具注册面恰好 6 个', () => {
  it('正常：注册表名字**恰好**是 design §2 的 6 个，且每个都有 output.schema 与 render', () => {
    const h = createToolsHarness();
    expect(h.tools.names).toStrictEqual([...TERMINAL_TOOL_NAMES]);
    expect(h.tools.names).toHaveLength(6);
    for (const name of TERMINAL_TOOL_NAMES) {
      const tool = h.tool(name);
      expect(tool.output.schema).toBeDefined();
      expect(typeof tool.output.render).toBe('function');
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(20);
    }
    h.dispose();
  });

  it('NFR-1：卸载后工具数归零（幂等），注册表不再含任何名字', () => {
    const h = createToolsHarness();
    expect(h.tools.names).toHaveLength(6);
    h.dispose();
    expect(h.tools.names).toStrictEqual([]);
    h.dispose(); // 再卸一次不炸
    expect(h.tools.names).toStrictEqual([]);
  });

  it('REQ-1.1 / REQ-3.4：`ctx.get` 拿不到沙箱与审批服务时**仍然**注册 6 个（不照抄 static inject 的 fail-fast）', () => {
    const h = createToolsHarness({ withSandbox: false, withApproval: false });
    expect(h.tools.names).toHaveLength(6);
    h.dispose();
  });

  it('REQ-1.1：工具注册是**效果域**的（每次 `register` 都必须拿到 disposer），卸载只摘自己那几条', () => {
    const h = createToolsHarness();
    const first = h.tools.names;
    expect(first).toStrictEqual([...TERMINAL_TOOL_NAMES]);
    h.dispose();
    // 同一份 registry 上再建一套：装卸互不影响（两次注册之间没有共享状态）
    const second = createToolsHarness();
    expect(second.tools.names).toStrictEqual([...TERMINAL_TOOL_NAMES]);
    second.dispose();
    expect(second.tools.names).toStrictEqual([]);
  });
});

describe('T1.1 REQ-1.2 new', () => {
  it('正常：起实例并返回 id；宿主收到的是该 profile 的 argv（不经 shell 切词）', async () => {
    const h = createToolsHarness();
    const result = await h.call('new', { profile: 'pwsh' });

    expect(result.isError).toBe(false);
    expect(result.value).toMatchObject({ id: 'term-1', profile: 'pwsh', rows: 24, cols: 80, pid: 4242 });
    expect(h.fake.spawnCalls).toHaveLength(1);
    expect(h.fake.spawnCalls[0]?.argv).toStrictEqual(['pwsh.exe', '-NoLogo']);
    h.dispose();
  });

  it('正常：每次 `new` 都是**新**实例（id 不复用，REQ-3.4 的可观测形式）', async () => {
    const h = createToolsHarness();
    expect((await h.call('new', { profile: 'pwsh' })).value).toMatchObject({ id: 'term-1' });
    expect((await h.call('new', { profile: 'pwsh' })).value).toMatchObject({ id: 'term-2' });
    expect(h.fake.spawnCalls).toHaveLength(2);
    h.dispose();
  });

  it('REQ-1.2 异常：未知 profile ⇒ profile-not-found 且**附可用列表**，没起任何进程', async () => {
    const h = createToolsHarness();
    const text = await h.text('new', { profile: 'nope' });

    expect(text).toContain('[profile-not-found]');
    expect(text).toContain('pwsh');
    expect(text).toContain('wsl');
    expect(h.fake.spawnCalls).toHaveLength(0);
    h.dispose();
  });

  it('REQ-1.2 边界：配置里一条 profile 都没有 ⇒ 提示说明「没有任何 profile」，不是空白错误', async () => {
    const h = createToolsHarness({ rawProfiles: [] });
    const text = await h.text('new', { profile: 'pwsh' });

    expect(text).toContain('[profile-not-found]');
    expect(text).toContain('没有任何 profile');
    h.dispose();
  });
});

describe('T1.1 REQ-1.3 list', () => {
  it('正常：含 id/profile/pid/尺寸/存活状态，**且**暴露 dropped（REQ-2.4）与下一号 seq', async () => {
    const h = createToolsHarness();
    await h.call('new', { profile: 'pwsh' });
    await h.call('new', { profile: 'wsl' });

    const result = await h.call('list', {});
    expect(result.isError).toBe(false);
    const value = result.value as { instances: any[]; count: number };
    expect(value.count).toBe(2);
    expect(value.instances.map((item) => item.id)).toStrictEqual(['term-1', 'term-2']);
    for (const item of value.instances) {
      expect(item).toMatchObject({ alive: true, dropped: 0, seq: 1, rows: 24, cols: 80, pid: 4242 });
      expect(typeof item.profile).toBe('string');
    }
    h.dispose();
  });

  it('边界：没有实例时 `list` 是**空数组 + count 0**（不是错误、也不是 undefined）', async () => {
    const h = createToolsHarness();
    const result = await h.call('list', {});

    expect(result.isError).toBe(false);
    expect(result.value).toStrictEqual({ instances: [], count: 0 });
    h.dispose();
  });

  it('REQ-1.3 边界：顶层进程退出后 list 说 alive=false（实例仍在表里，可回看屏幕）', async () => {
    const h = createToolsHarness();
    const id = await h.start('pwsh');
    handleOf(h.fake).exit(0);
    await new Promise((resolve) => setImmediate(resolve));

    const value = (await h.call('list', {})).value as { instances: any[] };
    expect(value.instances).toHaveLength(1);
    expect(value.instances[0]).toMatchObject({ id, alive: false });
    h.dispose();
  });
});

describe('T1.1 REQ-1.7 kill', () => {
  it('REQ-1.7 异常：未知实例 ⇒ 明确错误、**未**报成功（不静默）', async () => {
    const h = createToolsHarness();
    const result = await h.call('kill', { id: 'term-404' });

    expect(result.isError).toBe(true);
    // 失败**没有** value（宿主口径：失败的结果不携带成功值）——「没谎报成功」的机器可判定形式
    expect(result.value).toBeUndefined();
    const text = result.content.map((b) => b.text).join('');
    expect(text).toContain('[instance-not-found]');
    expect(text).toContain('term-404');
    h.dispose();
  });

  it('正常：kill 释放实例（list 归零、宿主 handle 被 terminate）', async () => {
    const h = createToolsHarness();
    await h.call('new', { profile: 'pwsh' });
    const handle = handleOf(h.fake);

    const result = await h.call('kill', { id: 'term-1' });

    expect(result.isError).toBe(false);
    expect(result.value).toMatchObject({ killed: true, id: 'term-1' });
    expect(handle.terminated).toBe(true);
    expect(h.manager.list()).toStrictEqual([]);
    // 再 kill 一次 ⇒ 明确错误（幂等的是宿主 terminate，不是这个工具的成功口径）
    expect((await h.call('kill', { id: 'term-1' })).isError).toBe(true);
    h.dispose();
  });

  it('REQ-1.7 边界：terminate 抛错 ⇒ 仍然成功 + warning 明说「尽力而为」，不留幽灵实例', async () => {
    const h = createToolsHarness();
    await h.call('new', { profile: 'pwsh' });
    handleOf(h.fake).terminateError = new Error('EPERM');

    const result = await h.call('kill', { id: 'term-1' });

    expect(result.isError).toBe(false);
    const value = result.value as { killed: boolean; warning?: string };
    expect(value.killed).toBe(true);
    expect(value.warning).toContain('尽力而为');
    expect(h.manager.list()).toStrictEqual([]);
    h.dispose();
  });
});

describe('T1.3 REQ-1.8 / REQ-4.4 参数校验与半成品检查', () => {
  it('异常：new 缺必填 profile ⇒ 参数被拒（ToolArgsError），002 的调用计数 = 0', async () => {
    const h = createToolsHarness();
    await expect(h.tool('new').execute({}, { callId: 'c1' })).rejects.toThrow(/invalid arguments/);
    expect(h.fake.spawnCalls).toHaveLength(0);
    expect(h.manager.list()).toStrictEqual([]);
    h.dispose();
  });

  it('异常：read 的 mode 不在枚举里 / sinceSeq 是负数 / 多给字段 ⇒ 都在进业务逻辑前被拒', async () => {
    const h = createToolsHarness();
    const tool = h.tool('read');

    await expect(tool.execute({ id: 'term-1', mode: 'delta' }, { callId: 'c1' })).rejects.toThrow(/invalid arguments/);
    await expect(tool.execute({ id: 'term-1', mode: 'incremental', sinceSeq: -1 }, { callId: 'c1' })).rejects.toThrow(
      /invalid arguments/,
    );
    await expect(tool.execute({ id: 'term-1', extra: 1 }, { callId: 'c1' })).rejects.toThrow(/undeclared property/);
    expect(h.fake.spawnCalls).toHaveLength(0);
    h.dispose();
  });

  it('异常：write 的 data 是空串 ⇒ **运行期**键名解析拒收（不写 0 字节）', async () => {
    // 🔴 2026-10-09 改判据：本条原先断言「schema 层的 minLength 拦下」。集成时读真源码发现值 schema DSL
    // **没有** `minLength` 键（写了就是作者错：`dsh-tools/lib/types/schema.js` 的白名单），所以空串
    // 现在走**运行期**：`decodeWritePayload('') === ''` ⇒ `unknown-key`（附已支持键名清单）。
    // 判据仍然是「不写 0 字节」，只是拦下的层从 schema 换到了运行期 —— 端到端真模块证据见
    // `tests/unit/tools-real-define.test.ts`。
    const h = createToolsHarness();
    await h.start('pwsh');
    const handle = handleOf(h.fake);

    await expect(h.tool('write').execute({ id: 'term-1', data: '' }, { callId: 'c1' })).rejects.toThrow(
      /unknown-key/,
    );
    expect(handle.writeCalls).toStrictEqual([]);
    h.dispose();
  });

  it('异常：kill / resize / list 的必填缺失也在进体前被拒（逐个工具都声明了参数）', async () => {
    const h = createToolsHarness();
    await expect(h.tool('kill').execute({}, { callId: 'c1' })).rejects.toThrow(/required property is missing/);
    await expect(h.tool('resize').execute({ id: 'term-1', rows: 30 }, { callId: 'c1' })).rejects.toThrow(
      /required property is missing/,
    );
    await expect(h.tool('list').execute({ weird: 1 }, { callId: 'c1' })).rejects.toThrow(/undeclared property/);
    h.dispose();
  });

  it('REQ-4.4 异常：new 失败（cwd 不存在）后实例表**无**新条目，且不产生 handle', async () => {
    const h = createToolsHarness({
      rawProfiles: [{ name: 'bad', command: 'pwsh.exe', cwd: 'E:\\missing' }],
      subprocess: { existingCwds: ['E:\\ok'] },
    });

    const result = await h.call('new', { profile: 'bad' });

    expect(result.isError).toBe(true);
    expect(h.manager.list()).toStrictEqual([]);
    expect(h.fake.handles).toHaveLength(0);
    expect(((await h.call('list', {})).value as { count: number }).count).toBe(0);
    h.dispose();
  });

  it('REQ-4.4 异常：宿主返回空 handle 时**不**建实例（不留幽灵条目），错误可读', async () => {
    const h = createToolsHarness({ subprocess: { returnNothing: true } });

    const result = await h.call('new', { profile: 'pwsh' });

    expect(result.isError).toBe(true);
    expect(result.content.map((b) => b.text).join('')).toMatch(/^Error: \[/);
    expect(h.manager.list()).toStrictEqual([]);
    h.dispose();
  });
});
