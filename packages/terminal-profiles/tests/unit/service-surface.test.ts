/**
 * T7.1 —— `managedTerminal` 服务面（design §5 的表格逐行落地）
 *
 * 验证（tasks.md 第 168 行）：`vitest` + fake —— ① 服务面方法齐全；② 无消费方时**不**报错、不注册
 * 多余内容；③ 契约测试断言服务名与 design.md §5 一致（② 的「插件装载」那一半在 `plugin-entry.test.ts`）。
 * 零真机：PTY 用 `fake-pty`（按位置记录宿主收到的 resize 实参 ⇒ 唯一能查出「行列转置」的证据）；
 * 订阅节奏用**手动推进**的 fake 调度器（不起真定时器）。
 */

import { describe, expect, it } from 'vitest';

import { parseProfiles } from '../../src/config/profiles.ts';
import { TERM_MAX_COLS, TERM_MAX_ROWS, TERM_MIN_ROWS } from '../../src/limits.ts';
import type { TerminalRead } from '../../src/session/manager.ts';
import { createSessionManager } from '../../src/session/manager.ts';
import type { ScreenIncremental, ScreenSnapshot } from '../../src/screen/screen-model.ts';
import type { TermChunk } from '../../src/screen/buffer.ts';
import { createManagedTerminalService, createUnavailableSubprocess } from '../../src/service-export/service.ts';
import type { GuardAction } from '../../src/service-export/service.ts';
import { MANAGED_TERMINAL_SERVICE } from '../../src/service-export/types.ts';
import type { ServiceFailure, ServiceResult } from '../../src/service-export/types.ts';
import { createFakeSubprocess } from '../helpers/fake-pty.ts';
import { manualSchedule } from '../helpers/plugin-fixtures.ts';
import { handleOf } from '../helpers/tools-harness.ts';

/** profile 名录（一条普通 Windows 命令 + 一条 WSL 命令：cwdOverride 的两个槽位各一） */
const RAW_PROFILES = [
  { name: 'pwsh', command: 'pwsh.exe', args: ['-NoLogo'], env: { FOO: 'bar' }, cwd: 'E:\\proj' },
  { name: 'wsl', command: 'wsl.exe', args: ['-d', 'Ubuntu2204'], env: {}, cwdLinux: '/home/u/proj' },
];

/** 取 ok 分支（失败直接抛：测试里失败就是 bug，别让它悄悄变成断言不生效） */
function mustOk<T>(result: ServiceResult<T>): T {
  if (!result.ok) throw new Error(`期望成功，实际失败：${result.code} ${result.message}`);
  return result.value;
}

function snapshotOf(read: TerminalRead): ScreenSnapshot {
  if (read.mode !== 'snapshot') throw new Error(`期望 snapshot，实际 ${read.mode}`);
  return read.snapshot;
}

function incrementalOf(read: TerminalRead): ScreenIncremental {
  if (read.mode !== 'incremental') throw new Error(`期望 incremental，实际 ${read.mode}`);
  return read;
}

/** 增量里的块（`lost` 分支附的是快照、没有块 ⇒ 空数组：两者都是「这一段没有可拼接的增量文本」） */
function chunksOf(read: TerminalRead | ScreenIncremental): readonly TermChunk[] {
  const incremental = 'mode' in read ? incrementalOf(read) : read;
  return incremental.lost ? [] : incremental.chunks;
}

interface SetupOptions {
  readonly rawProfiles?: readonly unknown[] | undefined;
  readonly guard?: ((action: GuardAction) => ServiceFailure | undefined) | undefined;
}

function setup(options: SetupOptions = {}) {
  const fake = createFakeSubprocess();
  const manager = createSessionManager({ subprocess: fake.surface });
  const profiles = parseProfiles(options.rawProfiles ?? RAW_PROFILES).profiles;
  // 手动推进的调度器（共用脚手架）：tick 由测试显式调用 ⇒ 无真定时器、无时序抖动
  const { schedule, ticks, stops } = manualSchedule();
  const host = createManagedTerminalService({
    manager,
    profiles: () => profiles,
    schedule,
    ...(options.guard === undefined ? {} : { guard: options.guard }),
  });
  const open = async (name: string, cwdOverride?: string): Promise<string> => {
    const request = cwdOverride === undefined ? { profile: name } : { profile: name, cwdOverride };
    return mustOk(await host.service.open(request)).id;
  };
  return { fake, manager, host, service: host.service, profiles, ticks, stops: () => stops, open };
}

describe('T7.1 ① 服务面方法齐全（§5 的 7 行逐条对应）', () => {
  it('**恰好** 7 个方法，名字与 §5 逐字一致（多一个都是第二份契约）', () => {
    const { service } = setup();
    expect(Object.keys(service).sort()).toEqual([
      'kill',
      'list',
      'open',
      'read',
      'resize',
      'subscribe',
      'write',
    ]);
    for (const method of Object.values(service)) expect(typeof method).toBe('function');
  });

  it('每个方法的返回形状可判别：ok 分支带 value，失败带 code + message（不抛）', async () => {
    const { service, fake, open } = setup();
    const id = await open('pwsh');
    expect(service.list()).toHaveLength(1);
    expect(mustOk(await service.write({ id, data: 'ls\r' }))).toEqual({ written: 3 });
    expect(handleOf(fake).writeCalls).toEqual(['ls\r']);
    expect(mustOk(await service.resize({ id, rows: 30, cols: 90 }))).toEqual({ rows: 30, cols: 90 });
    expect(mustOk(await service.read({ id, mode: 'snapshot' })).mode).toBe('snapshot');
    expect(mustOk(await service.kill({ id }))).toEqual({ killed: true });
    expect(typeof service.subscribe(id, () => undefined)).toBe('function');
  });

  it('失败一律是**可读结果**（本层不抛裸 Error）：未知 id 的 5 个方法都给 instance-not-found', async () => {
    const { service } = setup();
    const results = [
      await service.read({ id: 'nope' }),
      await service.write({ id: 'nope', data: 'x' }),
      await service.resize({ id: 'nope', rows: 10, cols: 10 }),
      await service.kill({ id: 'nope' }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe('instance-not-found');
      expect(result.message).not.toBe('');
    }
  });
});

describe('T7.1 ③ 契约测试：服务名与 design §5 逐字一致', () => {
  it("MANAGED_TERMINAL_SERVICE === 'managedTerminal'（003 按字符串键注入，改一个字就断）", () => {
    expect(MANAGED_TERMINAL_SERVICE).toBe('managedTerminal');
  });
});

describe('T7.1 ② 无消费方时不报错、不注册多余内容（服务面这一侧）', () => {
  it('建服务不改任何外部状态：0 实例、0 定时器、0 监听，且不依赖 003 的任何东西', () => {
    const { service, manager, host } = setup();
    expect(manager.list()).toEqual([]);
    expect(host.listenerCount()).toBe(0);
    expect(host.tickerCount()).toBe(0); // 订阅惰性启动：没人订阅就不许有定时器（REQ-12.2）
    expect(service.list()).toEqual([]);
    expect(Object.keys(service)).toHaveLength(7);
  });

  it('缺 PTY 端口时 open 给**可读**失败（spawn-failed），不是加载期不激活（REQ-3.4 口径）', async () => {
    const manager = createSessionManager({
      subprocess: createUnavailableSubprocess('宿主未提供 ctx.subprocess'),
    });
    const profiles = parseProfiles(RAW_PROFILES).profiles;
    const host = createManagedTerminalService({ manager, profiles: () => profiles });
    const result = await host.service.open({ profile: 'pwsh' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('spawn-failed');
    expect(result.message).toContain('ctx.subprocess');
    await host.dispose();
  });
});

describe('§5 open：profile 查找 + cwdOverride 的两个槽位 + 失败', () => {
  it('未知 profile → profile-not-found，且 hint 附**可用列表**（不是干说没找到）', async () => {
    const { service, fake } = setup();
    const result = await service.open({ profile: 'missing' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('profile-not-found');
    expect(result.hint).toContain('pwsh');
    expect(result.hint).toContain('wsl');
    expect(fake.spawnCalls).toHaveLength(0);
  });

  it('空名录 → profile-not-found + 「当前配置里没有任何 profile」', async () => {
    const { service } = setup({ rawProfiles: [] });
    const result = await service.open({ profile: 'pwsh' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('profile-not-found');
    expect(result.hint).toContain('没有任何 profile');
  });

  it('非 WSL profile 的 cwdOverride 落在 cwd，且**只影响本次**（profile 自身不被改）', async () => {
    const { fake, open } = setup();
    await open('pwsh', 'E:\\other');
    expect(fake.spawnCalls[0]?.cwd).toBe('E:\\other');
    await open('pwsh');
    expect(fake.spawnCalls[1]?.cwd).toBe('E:\\proj');
  });

  it('WSL profile 的 cwdOverride 落在 cwdLinux 槽位（REQ-3.2 的路径语义不混用）', async () => {
    const { fake, open } = setup();
    await open('wsl', '/tmp/override');
    expect(fake.spawnCalls[0]?.cwd).toBe('/tmp/override');
    expect(fake.spawnCalls[0]?.argv).toEqual(['wsl.exe', '-d', 'Ubuntu2204']);
  });

  it('空串/全空白 cwdOverride → cwd-missing（PTY 拿到空 cwd 是未定义行为），且不 spawn', async () => {
    const { service, fake } = setup();
    for (const blank of ['', '   ']) {
      const result = await service.open({ profile: 'pwsh', cwdOverride: blank });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe('cwd-missing');
    }
    expect(fake.spawnCalls).toHaveLength(0);
  });

  it('guard 端口可切换：返回失败即拒绝且**不 spawn**；缺省（undefined）不过门', async () => {
    const denied = { ok: false, code: 'sandbox-denied', message: '被策略拒绝' } as const;
    const gated = setup({ guard: (action) => (action === 'open' ? { ...denied } : undefined) });
    const result = await gated.service.open({ profile: 'pwsh' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('sandbox-denied');
    expect(gated.fake.spawnCalls).toHaveLength(0);

    const open = setup();
    expect(mustOk(await open.service.open({ profile: 'pwsh' })).id).toBe('term-1');
  });
});

describe('§5 read/list/write：同一份会话层，本层不另建状态', () => {
  it('read snapshot 读屏幕、incremental 按 sinceSeq 推进游标（不重复、不漏）', async () => {
    const { service, fake, open } = setup();
    const id = await open('pwsh');
    await handleOf(fake).emit('hello');
    const snapshot = snapshotOf(mustOk(await service.read({ id, mode: 'snapshot' })));
    expect(snapshot.text).toContain('hello');

    const first = incrementalOf(mustOk(await service.read({ id, mode: 'incremental' })));
    expect(chunksOf(first).map((chunk) => chunk.data).join('')).toContain('hello');
    const second = incrementalOf(
      mustOk(await service.read({ id, mode: 'incremental', sinceSeq: first.seq })),
    );
    expect(chunksOf(second)).toEqual([]); // 游标推进后没有新输出
  });

  it('list() 是实例摘要数组（不含 handle / screen —— 内部状态不外泄）', async () => {
    const { service, open } = setup();
    const id = await open('pwsh');
    const [summary] = service.list();
    expect(summary?.id).toBe(id);
    expect(summary?.profileName).toBe('pwsh');
    expect(Object.keys(summary ?? {}).sort()).toEqual([
      'cols',
      'dropped',
      'exited',
      'id',
      'pid',
      'profileName',
      'rows',
      'seq',
    ]);
  });

  it('write 原样写 PTY；未知 id 是 instance-not-found', async () => {
    const { service, fake, open } = setup();
    const id = await open('pwsh');
    expect(mustOk(await service.write({ id, data: 'echo hi\n' }))).toEqual({ written: 8 });
    expect(handleOf(fake).writeCalls).toEqual(['echo hi\n']);
    const missing = await service.write({ id: 'gone', data: 'x' });
    expect(missing.ok).toBe(false);
  });
});

describe('§5 resize：换序与夹紧的**唯一**入口（本层只转发）', () => {
  it('行在前进、列在前出：宿主收到 [cols, rows]，返回值是夹紧后的实际值', async () => {
    const { service, fake, open } = setup();
    const id = await open('pwsh');
    // rows ≠ cols：转置一眼可见（用 80×24 这种「正方形错觉」的尺寸是测不出转置的）
    expect(mustOk(await service.resize({ id, rows: 24, cols: 100 }))).toEqual({ rows: 24, cols: 100 });
    expect(handleOf(fake).resizeCalls).toEqual([[100, 24]]);
  });

  it('夹紧发生在同一条路径上（rows=0 → 下界；cols=1e9 → 上界），宿主收到的是夹紧后的值', async () => {
    const { service, fake, open } = setup();
    const id = await open('pwsh');
    const size = mustOk(await service.resize({ id, rows: 0, cols: 1e9 }));
    expect(size).toEqual({ rows: TERM_MIN_ROWS, cols: TERM_MAX_COLS });
    expect(handleOf(fake).resizeCalls).toEqual([[TERM_MAX_COLS, TERM_MIN_ROWS]]);
    // 上界的另一侧也要钉住（只钉下界的话「恒返回下界」也能过）
    const upper = mustOk(await service.resize({ id, rows: TERM_MAX_ROWS + 1, cols: 1 }));
    expect(upper.rows).toBe(TERM_MAX_ROWS);
    expect(handleOf(fake).resizeCalls[1]).toEqual([2, TERM_MAX_ROWS]); // cols 夹到 TERM_MIN_COLS=2
  });

  it('未知 id → instance-not-found，且**没有**任何宿主 resize 调用', async () => {
    const { service, fake } = setup();
    const result = await service.resize({ id: 'nope', rows: 10, cols: 10 });
    expect(result.ok).toBe(false);
    expect(fake.handles).toHaveLength(0);
  });
});

describe('§5 kill', () => {
  it('kill 终止实例；重复 kill 是 instance-not-found（表里已摘掉）', async () => {
    const { service, fake, open } = setup();
    const id = await open('pwsh');
    expect(mustOk(await service.kill({ id }))).toEqual({ killed: true });
    expect(handleOf(fake).terminated).toBe(true);
    const again = await service.kill({ id });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('instance-not-found');
  });
});

describe('§5 subscribe：增量推送 + 返回 unsubscribe（不静默、不遗留）', () => {
  it('未知 id：立即送一次 instance-not-found，且**不注册监听、不起定时器**', () => {
    const { service, host } = setup();
    const seen: Array<ServiceResult<TerminalRead>> = [];
    const unsubscribe = service.subscribe('nope', (update) => seen.push(update));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.ok).toBe(false);
    expect(host.listenerCount()).toBe(0);
    expect(host.tickerCount()).toBe(0);
    unsubscribe(); // 幂等
    unsubscribe();
  });

  it('已知 id：惰性起定时器 → 手动推进一轮 → 回调收到增量；unsubscribe 幂等并停表', async () => {
    const { service, fake, host, ticks, open, stops } = setup();
    const id = await open('pwsh');
    const seen: Array<ServiceResult<TerminalRead>> = [];
    const unsubscribe = service.subscribe(id, (update) => seen.push(update));
    expect(host.listenerCount()).toBe(1);
    expect(host.tickerCount()).toBe(1);
    expect(ticks).toHaveLength(1);

    await handleOf(fake).emit('abc');
    await ticks[0]?.();
    expect(seen).toHaveLength(1);
    const first = seen[0];
    if (first === undefined || !first.ok) throw new Error('期望第一轮推送成功');
    expect(chunksOf(first.value).length).toBeGreaterThan(0);

    await ticks[0]?.();
    expect(seen).toHaveLength(2); // 无新输出也会有一次（chunks 为空）——调用方不必自己轮询
    unsubscribe();
    expect(host.listenerCount()).toBe(0);
    expect(host.tickerCount()).toBe(0);
    unsubscribe();
    expect(stops()).toBe(1); // 取消只发生一次
  });

  it('实例被 kill 后下一轮：回调收到**失败**并自动注销（不静默停推）', async () => {
    const { service, host, ticks, open } = setup();
    const id = await open('pwsh');
    const seen: Array<ServiceResult<TerminalRead>> = [];
    service.subscribe(id, (update) => seen.push(update));
    await service.kill({ id });
    await ticks[0]?.();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.ok).toBe(false);
    if (seen[0]?.ok === false) expect(seen[0].code).toBe('instance-not-found');
    expect(host.listenerCount()).toBe(0);
    expect(host.tickerCount()).toBe(0);
  });

  it('一个订阅者抛错不影响其它订阅者与后续轮次（回调是调用方的代码）', async () => {
    const { service, fake, host, ticks, open } = setup();
    const id = await open('pwsh');
    const good: number[] = [];
    service.subscribe(id, () => {
      throw new Error('订阅者自己的 bug');
    });
    service.subscribe(id, () => good.push(1));
    await handleOf(fake).emit('x');
    await ticks[0]?.();
    expect(good).toHaveLength(1);
    expect(host.listenerCount()).toBe(2);
    await host.dispose();
  });
});

describe('T7.2 打底：serviceHost.dispose（实例全终止 + 三个计数归零 + 幂等）', () => {
  it('dispose：监听/定时器归零，**PTY kill 调用数 = 实例数**，重复调用是同一个 promise', async () => {
    const { service, fake, host, ticks, open } = setup();
    const first = await open('pwsh');
    await open('wsl');
    service.subscribe(first, () => undefined);
    expect(host.listenerCount()).toBe(1);
    expect(ticks).toHaveLength(1);

    const disposing = host.dispose();
    expect(host.dispose()).toBe(disposing); // 幂等：同一个 promise
    await disposing;

    expect(host.listenerCount()).toBe(0);
    expect(host.tickerCount()).toBe(0);
    expect(service.list()).toEqual([]);
    expect(fake.handles).toHaveLength(2);
    expect(fake.handles.map((handle) => handle.terminateCount)).toEqual([1, 1]);
    // 终止后 kill 不再成功 ⇒ 实例表真的空了（不是留着推不动的幽灵实例）
    expect((await service.kill({ id: first })).ok).toBe(false);
  });
});
