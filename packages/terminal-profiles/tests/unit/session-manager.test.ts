/**
 * T2.1 / T2.2 / T2.5 —— 实例表、失败路径、只读性（002 REQ-3.1–3.5 / REQ-5.4 / REQ-6.5）
 *
 * 全部用 `tests/helpers/fake-pty.ts` 的 fake `ctx.subprocess`（**零真机**：不起 PTY、不跑 `wsl.exe`）。
 * profile 一律经真的 `parseProfiles` 产出，这样「配置解析 → 启动」是同一条真实的链，不是手搓对象。
 */

import { homedir } from 'node:os';

import { winToWsl } from 'dsh-wsl-shared';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  DEFAULT_TERMINAL_TYPE,
  TERM_MAX_ROWS,
  TERM_MIN_COLS,
  TERM_MIN_ROWS,
  createSessionManager,
  parseProfiles,
} from '../../src/index.ts';
import type { TerminalProfile } from '../../src/index.ts';
import { createFakeSubprocess } from '../helpers/fake-pty.ts';

/** 用真配置解析器造一条 profile（解析失败即测试夹具坏了，直接炸出来） */
function profileOf(raw: unknown): TerminalProfile {
  const parsed = parseProfiles([raw]);
  const profile = parsed.profiles[0];
  if (profile === undefined) throw new Error(`夹具解析失败：${JSON.stringify(parsed.diagnostics)}`);
  return profile;
}

describe('T2.1 session-manager 起实例', () => {
  it('REQ-3.1 正常：spec 字段逐项交给宿主，且**不含** shellActivity、cwd 必为字符串', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });

    const started = await manager.start(
      profileOf({
        name: 'pwsh',
        command: 'pwsh.exe',
        args: ['-NoLogo', '-NoProfile'],
        env: { FOO: 'bar' },
        cwd: 'E:\\proj',
      }),
      { rows: 30, cols: 100 },
    );

    expect(started.ok).toBe(true);
    expect(fake.spawnCalls).toHaveLength(1);
    const spec = fake.spawnCalls[0];
    expect(spec).toStrictEqual({
      argv: ['pwsh.exe', '-NoLogo', '-NoProfile'],
      cwd: 'E:\\proj',
      env: { FOO: 'bar' },
      rows: 30,
      cols: 100,
      terminalType: DEFAULT_TERMINAL_TYPE,
    });
    // 🔴 Windows 上 shellActivity:true 是反效果（activity 无效却跳过 done 后的自动 terminate）
    expect(spec !== undefined && 'shellActivity' in spec).toBe(false);
    // 🔴 cwd: undefined 会落到宿主进程 cwd ⇒ 必须显式传
    expect(typeof spec?.cwd).toBe('string');
  });

  it('REQ-3.1 边界：不给尺寸 ⇒ 80×24；越界/脏输入 ⇒ 夹紧后再交给宿主', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });
    const profile = profileOf({ name: 'p', command: 'pwsh.exe', cwd: 'E:\\proj' });

    await manager.start(profile);
    await manager.start(profile, { rows: 0, cols: 1 });
    await manager.start(profile, { rows: 1e9, cols: Number.NaN });
    await manager.start(profile, { terminalType: 'vt100' });

    expect(fake.spawnCalls[0]?.rows).toBe(DEFAULT_ROWS);
    expect(fake.spawnCalls[0]?.cols).toBe(DEFAULT_COLS);
    expect(fake.spawnCalls[1]?.rows).toBe(TERM_MIN_ROWS);
    expect(fake.spawnCalls[1]?.cols).toBe(TERM_MIN_COLS);
    expect(fake.spawnCalls[2]?.rows).toBe(TERM_MAX_ROWS);
    expect(fake.spawnCalls[2]?.cols).toBe(TERM_MIN_COLS);
    expect(fake.spawnCalls[3]?.terminalType).toBe('vt100');
  });

  it('REQ-3.2 正常：WSL profile 的 PTY cwd 取 cwdLinux（只填 cwd 时经 001 推导）', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });

    // 只填 cwd：经真 001 的 winToWsl 推导
    await manager.start(profileOf({ name: 'w', command: 'wsl.exe', args: ['-d', 'Ubuntu2204'], cwd: 'E:\\proj' }));
    // 两个都填：用 cwdLinux，**不**用 Windows 路径
    await manager.start(
      profileOf({ name: 'w2', command: 'wsl.exe', cwd: 'E:\\proj', cwdLinux: '/home/me/proj' }),
    );

    // 与真 001 的结论对齐（而不是抄一个字面量）：翻译口径漂移时这条会一起红
    const mapped = winToWsl('E:\\proj');
    expect(mapped.ok).toBe(true);
    expect(fake.spawnCalls[0]?.cwd).toBe(mapped.ok ? mapped.path : '');
    expect(fake.spawnCalls[0]?.cwd.startsWith('/')).toBe(true);
    expect(fake.spawnCalls[1]?.cwd).toBe('/home/me/proj');
    // argv 原样进宿主，不经 shell 切词
    expect(fake.spawnCalls[0]?.argv).toStrictEqual(['wsl.exe', '-d', 'Ubuntu2204']);
  });

  it('REQ-3.4 正常：同一 profile 两次启动 ⇒ 两个**不同** id、两个不同 handle、创建序稳定', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });
    const profile = profileOf({ name: 'p', command: 'pwsh.exe', cwd: 'E:\\proj' });

    const first = await manager.start(profile);
    const second = await manager.start(profile);

    expect(first.ok && second.ok).toBe(true);
    const firstId = first.ok ? first.value.id : '';
    const secondId = second.ok ? second.value.id : '';
    expect(firstId).not.toBe(secondId);
    expect(fake.handles).toHaveLength(2);
    expect(fake.handles[0]).not.toBe(fake.handles[1]);
    expect(manager.list().map((i) => i.id)).toStrictEqual([firstId, secondId]);
    expect(manager.list()[0]?.profileName).toBe('p');
  });

  it('REQ-3.1 正常：list 从零开始；实例摘要带 pid 与初始 seq/dropped', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });
    expect(manager.list()).toStrictEqual([]);

    const started = await manager.start(profileOf({ name: 'p', command: 'pwsh.exe', cwd: 'E:\\proj' }));
    expect(started.ok && started.value).toMatchObject({
      profileName: 'p',
      pid: 4242,
      rows: DEFAULT_ROWS,
      cols: DEFAULT_COLS,
      // 下一号口径：第一个块会拿 1，所以「还没有输出」时 seq 也是 1（存下来当 sinceSeq 永远安全）
      seq: 1,
      dropped: 0,
      exited: false,
    });
  });
});

describe('T2.2 失败路径', () => {
  it('REQ-3.3 异常：cwd 不存在 ⇒ 错误里含**该路径**，且**未**回落工作区/$HOME', async () => {
    const fake = createFakeSubprocess({ existingCwds: ['E:\\ok'] });
    const manager = createSessionManager({ subprocess: fake.surface });

    const started = await manager.start(profileOf({ name: 'p', command: 'pwsh.exe', cwd: 'E:\\missing' }));

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe('spawn-failed');
    expect(started.message).toContain('E:\\missing'); // REQ-3.3：错误里指出该路径
    expect(started.message).toContain('未回落');
    expect(started.cwd).toBe('E:\\missing');
    // 🔴 「不回落」的二值判定：传给宿主的就是那个坏路径，**不是**进程 cwd、也**不是** $HOME
    expect(fake.spawnCalls[0]?.cwd).toBe('E:\\missing');
    expect(fake.spawnCalls[0]?.cwd).not.toBe(process.cwd());
    expect(fake.spawnCalls[0]?.cwd).not.toBe(homedir());
    // 宿主抛错 ⇒ 不留幽灵实例
    expect(fake.handles).toHaveLength(0);
    expect(manager.list()).toStrictEqual([]);
  });

  it('REQ-3.5 异常：程序不可解析 ⇒ 可读错误含程序名与 cwd，且无幽灵实例', async () => {
    const fake = createFakeSubprocess({ existingPrograms: ['pwsh.exe'] });
    const manager = createSessionManager({ subprocess: fake.surface });

    const started = await manager.start(
      profileOf({ name: 'p', command: 'nope.exe', args: ['--x'], cwd: 'E:\\proj' }),
    );

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe('spawn-failed');
    expect(started.message).toContain('nope.exe'); // REQ-3.5：含被拒绝的能力名（这里是程序名）
    expect(started.message).toContain('E:\\proj');
    expect(manager.list()).toStrictEqual([]);
  });

  it('REQ-3.5 异常：宿主以 rejected promise 失败 ⇒ 与同步抛**同一个**错误码与文案形状', async () => {
    const fake = createFakeSubprocess({ existingCwds: [], failAsync: true });
    const manager = createSessionManager({ subprocess: fake.surface });

    const started = await manager.start(profileOf({ name: 'p', command: 'pwsh.exe', cwd: 'E:\\proj' }));

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe('spawn-failed');
    expect(started.message).toContain('E:\\proj');
    expect(manager.list()).toStrictEqual([]);
  });

  it('REQ-3.5 边界：宿主返回空 handle ⇒ 也算启动失败，不建实例（防幽灵标签的最后一道）', async () => {
    const fake = createFakeSubprocess({ returnNothing: true });
    const manager = createSessionManager({ subprocess: fake.surface });

    const started = await manager.start(profileOf({ name: 'p', command: 'pwsh.exe', cwd: 'E:\\proj' }));

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe('spawn-failed');
    expect(started.message).toContain('未回落');
    expect(manager.list()).toStrictEqual([]);
  });

  it('REQ-3.3 异常：WSL profile 没有任何可用的 cwd ⇒ 拒绝，且**根本没调** spawnTerminal', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });

    const started = await manager.start(profileOf({ name: 'w', command: 'wsl.exe' }));

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe('cwd-missing');
    expect(fake.spawnCalls).toHaveLength(0); // 拒绝发生在调用宿主**之前**
  });

  it('REQ-3.3 异常：非 WSL profile 没 cwd ⇒ 拒绝（不猜、不回落到宿主进程目录）', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });

    const started = await manager.start(profileOf({ name: 'p', command: 'pwsh.exe' }));

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe('cwd-missing');
    expect(fake.spawnCalls).toHaveLength(0);
  });

  it('REQ-1.4 / REQ-3.3 异常：needsFix 的 profile ⇒ not-startable，透传 001 的错误码，不调宿主', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });
    // `E:\x` 这种骨架路径在 006 的翻译里翻不出来（无盘符语义）⇒ parseProfiles 会标 needsFix
    const profile = profileOf({ name: 'w', command: 'wsl.exe', cwd: '\\Windows' });
    expect(profile.needsFix).toBeDefined();

    const started = await manager.start(profile);

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe('not-startable');
    expect(started.upstreamCode).toBe(profile.needsFix?.code);
    expect(fake.spawnCalls).toHaveLength(0);
  });

  it('REQ-3.3 异常：WSL 的 cwd 翻不成 Linux 路径（手工构造 needsFix 之外的形态）⇒ cwd-unmappable', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });
    // 绕过 Phase 1 的推导标记，直接把「不可翻译的 WSL cwd」交给启动层（覆盖启动期自己的那一支）
    const profile: TerminalProfile = {
      name: 'w',
      command: 'wsl.exe',
      args: [],
      env: {},
      cwd: '\\\\server\\share',
    };

    const started = await manager.start(profile);

    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.code).toBe('cwd-unmappable');
    expect(started.cwd).toBe('\\\\server\\share');
    expect(started.message).toContain('\\\\server\\share');
    expect(fake.spawnCalls).toHaveLength(0);
  });

  it('异常：未知实例 id 的 read/write/resize/kill 都是 instance-not-found，不碰宿主', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });

    const read = await manager.read('term-404');
    const write = await manager.write('term-404', 'x');
    const resize = await manager.resize('term-404', 10, 10);
    const kill = await manager.kill('term-404');
    for (const result of [read, write, resize, kill]) {
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.code).toBe('instance-not-found');
    }
  });
});

describe('T2.5 只读性（REQ-6.5 / REQ-5.4）', () => {
  it('正常：连续 read（快照 + 增量 + 各种参数）之后，PTY 的 write 与 resize 调用数都是 0', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });
    const started = await manager.start(profileOf({ name: 'p', command: 'pwsh.exe', cwd: 'E:\\proj' }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const id = started.value.id;
    const handle = fake.handles[0];
    expect(handle).toBeDefined();
    if (handle === undefined) return;

    await handle.emit('hello\r\n');
    await handle.emit('\u001b[2Jredraw\r\n');

    for (let i = 0; i < 5; i += 1) {
      const snapshot = await manager.read(id);
      expect(snapshot.ok).toBe(true);
      const incremental = await manager.read(id, { mode: 'incremental', sinceSeq: 1 });
      expect(incremental.ok).toBe(true);
    }
    await manager.read(id, { mode: 'incremental' });
    await manager.read(id, { scrollbackLines: 0 });

    // 🔴 读是纯只读：不注入输入、不改尺寸
    expect(handle.writeCalls).toStrictEqual([]);
    expect(handle.resizeCalls).toStrictEqual([]);
    // 读也没把屏幕读坏：文本仍然在
    const after = await manager.read(id);
    expect(after.ok && after.value.mode === 'snapshot' && after.value.snapshot.text).toContain('redraw');
    expect(handle.writeCalls).toStrictEqual([]);
  });

  it('正常：写路径**会**调 handle.write（对照组：证明上面那个 0 不是「永远不会写」）', async () => {
    const fake = createFakeSubprocess();
    const manager = createSessionManager({ subprocess: fake.surface });
    const started = await manager.start(profileOf({ name: 'p', command: 'pwsh.exe', cwd: 'E:\\proj' }));
    const id = started.ok ? started.value.id : '';

    const written = await manager.write(id, 'echo hi\r');

    expect(written.ok && written.value.written).toBe('echo hi\r'.length);
    expect(fake.handles[0]?.writeCalls).toStrictEqual(['echo hi\r']);
  });
});
