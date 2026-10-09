/**
 * T3.3 重连续传与单活跃连接（REQ-7.3 / REQ-7.4）
 *
 * 验证（tasks.md 第 106 行）：`vitest` —— 断线重连后块连续无重复；并发两连接时旧连接被关闭
 * 且新连接正常收块。
 *
 * 主要走**文本帧面**（`channel.accept` + `conn.handleText`）测协议语义，最后一个用例走
 * **完整字节路径**（upgrade → 粘包 → 命令帧）证明两层拼得起来；全流程零真实 socket。
 */

import { describe, expect, it } from 'vitest';
import { createTokenStore } from '../../src/ws/auth.ts';
import { createTerminalChannel } from '../../src/ws/connection.ts';
import type { TextConnection, TerminalChannel } from '../../src/ws/connection.ts';
import { TERM_MAX_ROWS } from '../../src/limits.ts';
import { registerTerminalChannel } from '../../src/ws/routes.ts';
import {
  clientTextFrame,
  createFakeCtx,
  createFakeManager,
  createFakeSink,
  createFakeWebServer,
  handshakeHeaders,
} from '../helpers/ws-fakes.ts';
import type { FakeManager, FakeSink } from '../helpers/ws-fakes.ts';

const ORIGIN = 'http://127.0.0.1:19387';

interface ServerFrame {
  readonly type: string;
  readonly seq?: number;
  readonly data?: string;
  readonly snapshot?: string | null;
  readonly size?: { rows: number; cols: number };
  readonly code?: string;
  readonly message?: string;
}

/** 推进微任务：会话层读是已 resolve 的 promise，几轮 tick 足以让 attach 落定（不引入定时器） */
async function flush(): Promise<void> {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

function framesOf(sink: FakeSink): ServerFrame[] {
  return sink.messages() as ServerFrame[];
}

function setup(options: { withInstance?: boolean } = {}) {
  const manager = createFakeManager();
  if (options.withInstance !== false) manager.add('inst-1');
  const tokens = createTokenStore();
  const channel = createTerminalChannel({ manager: manager.session, tokens, allowedOrigins: [ORIGIN] });
  const connect = (): { sink: FakeSink; token: string; conn: TextConnection } => {
    const sink = createFakeSink();
    const token = tokens.issue();
    return { sink, token, conn: channel.accept(sink, token) };
  };
  return { manager, tokens, channel, connect };
}

async function attach(conn: TextConnection, token: string, sinceSeq?: number): Promise<void> {
  conn.handleText(
    JSON.stringify({ type: 'attach', instanceId: 'inst-1', token, ...(sinceSeq === undefined ? {} : { sinceSeq }) }),
  );
  await flush();
}

describe('T3.3 attach 与增量推送', () => {
  it('全新 attach ⇒ attached 带快照与尺寸（无 sinceSeq 的路径）', async () => {
    const { manager, connect } = setup();
    const { sink, token, conn } = connect();
    await attach(conn, token);
    const frames = framesOf(sink);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe('attached');
    expect(frames[0]?.size).toEqual({ rows: 24, cols: 80 });
    expect(frames[0]?.snapshot).toBe(manager.snapshotTextOf('inst-1'));
    expect(frames[0]?.seq).toBe(1);
  });

  it('pump 推块：seq 连续递增；没有新输出时不发空帧', async () => {
    const { manager, channel, connect } = setup();
    const { sink, token, conn } = connect();
    await attach(conn, token);
    sink.clear();
    manager.push('inst-1', 'A');
    manager.push('inst-1', 'B');
    await channel.pump();
    expect(framesOf(sink).map((frame) => [frame.type, frame.seq, frame.data])).toEqual([
      ['chunk', 1, 'A'],
      ['chunk', 2, 'B'],
    ]);
    sink.clear();
    await channel.pump();
    expect(framesOf(sink)).toEqual([]); // 无新输出 ⇒ 静默（不刷空 chunk）
  });

  it('会话层报 lost ⇒ 下发 lost + 快照（REQ-6.3）', async () => {
    const { manager, channel, connect } = setup();
    const { sink, token, conn } = connect();
    await attach(conn, token);
    manager.push('inst-1', 'A');
    await channel.pump(); // 游标推到 2
    manager.forceLostBelow('inst-1', 3); // 缓冲下界跳到 3 ⇒ 游标 2 已丢
    sink.clear();
    await channel.pump();
    const frames = framesOf(sink);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe('lost');
    expect(frames[0]?.snapshot).toBe(manager.snapshotTextOf('inst-1'));
    expect(frames[0]?.seq).toBe(2);
  });
});

describe('T3.3 重连续传（块连续无重复）', () => {
  it('带 sinceSeq 重连 ⇒ 补齐缺口的块，跨连接的 seq 全集连续且不重复', async () => {
    const { manager, channel, connect } = setup();
    const first = connect();
    await attach(first.conn, first.token);
    manager.push('inst-1', 'A');
    manager.push('inst-1', 'B');
    await channel.pump();
    const cursor = manager.cursorOf('inst-1'); // 已交付 2 块 ⇒ 下一号 = 3
    expect(framesOf(first.sink).filter((frame) => frame.type === 'chunk').map((frame) => frame.seq)).toEqual([1, 2]);

    first.conn.close(); // 断线（宿主会另发一枚令牌；这里重新连）
    expect(channel.activeCount).toBe(0);

    const second = connect();
    await attach(second.conn, second.token, cursor);
    const attached = framesOf(second.sink)[0];
    expect(attached?.type).toBe('attached');
    expect(attached?.snapshot).toBeNull(); // 续传成功不重发快照（否则屏幕会重复打印）
    expect(attached?.seq).toBe(cursor);

    manager.push('inst-1', 'C');
    await channel.pump();
    const delivered = framesOf(second.sink).filter((frame) => frame.type === 'chunk');
    expect(delivered.map((frame) => frame.seq)).toEqual([3]); // 缺口正是 3，不重复 1/2

    const allSeqs = [...framesOf(first.sink), ...framesOf(second.sink)]
      .filter((frame) => frame.type === 'chunk')
      .map((frame) => frame.seq);
    expect(allSeqs).toEqual([1, 2, 3]);
    expect(new Set(allSeqs).size).toBe(allSeqs.length); // 无重复
  });

  it('区间已被丢弃 ⇒ 回 lost + 快照，不回空数组冒充满足（REQ-6.3）', async () => {
    const { manager, connect } = setup();
    for (const data of ['A', 'B', 'C', 'D', 'E']) manager.push('inst-1', data);
    manager.forceLostBelow('inst-1', 4); // 下界 4 ⇒ sinceSeq=2 已丢

    const { sink, token, conn } = connect();
    await attach(conn, token, 2);
    const frames = framesOf(sink);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe('lost');
    expect(frames[0]?.snapshot).toBe(manager.snapshotTextOf('inst-1'));
    expect(frames[0]?.seq).toBe(6); // 下一号 = 5 块 + 1
  });

  it('带 sinceSeq 且区间都在 ⇒ 补发快照与块之外不额外发快照', async () => {
    const { manager, connect } = setup();
    manager.push('inst-1', 'A');
    const { sink, token, conn } = connect();
    await attach(conn, token, 1);
    const frames = framesOf(sink);
    expect(frames.map((frame) => frame.type)).toEqual(['attached', 'chunk']);
    expect(frames[1]?.seq).toBe(1);
    expect(frames[1]?.data).toBe('A');
  });
});

describe('T3.3 单活跃连接（顶掉旧的）', () => {
  it('新连接顶掉旧连接：旧连接收 error:superseded 后被关闭，新连接正常收块', async () => {
    const { manager, channel, connect } = setup();
    const first = connect();
    await attach(first.conn, first.token);
    manager.push('inst-1', 'A');
    await channel.pump();
    expect(channel.activeCount).toBe(1);

    const second = connect();
    await attach(second.conn, second.token);
    expect(channel.activeCount).toBe(1); // 旧的已关闭 ⇒ 不是 2
    const lastOfOld = framesOf(first.sink).at(-1);
    expect(lastOfOld?.type).toBe('error');
    expect(lastOfOld?.code).toBe('superseded');
    expect(first.sink.destroyed).toBe(true);

    const writtenBefore = first.sink.written.length;
    manager.push('inst-1', 'B');
    await channel.pump();
    // 新的拿到新块
    expect(framesOf(second.sink).some((frame) => frame.data === 'B')).toBe(true);
    // 旧的一个字节都没再多写（SHALL NOT 双写）
    expect(first.sink.written.length).toBe(writtenBefore);
    expect(channel.activeInstanceIds()).toEqual(['inst-1']);
  });

  it('同一实例顶替后，旧连接的 input 不再落进 PTY', async () => {
    const { manager, connect } = setup();
    const first = connect();
    await attach(first.conn, first.token);
    const second = connect();
    await attach(second.conn, second.token);

    first.conn.handleText(JSON.stringify({ type: 'input', data: 'echo old' }));
    await flush();
    second.conn.handleText(JSON.stringify({ type: 'input', data: 'echo new' }));
    await flush();
    expect(manager.writeCalls).toEqual([{ id: 'inst-1', data: 'echo new' }]);
    expect(second.conn.instanceId).toBe('inst-1');
  });
});

describe('T3.3 input / resize / 失败路径', () => {
  it('attach 后 input 与 resize 透传到会话层（resize 先夹紧）', async () => {
    const { manager, connect } = setup();
    const { token, conn } = connect();
    await attach(conn, token);
    conn.handleText(JSON.stringify({ type: 'input', data: 'ls\r' }));
    conn.handleText(JSON.stringify({ type: 'resize', rows: 1e9, cols: -5 }));
    await flush();
    expect(manager.writeCalls).toEqual([{ id: 'inst-1', data: 'ls\r' }]);
    expect(manager.resizeCalls).toEqual([{ id: 'inst-1', rows: TERM_MAX_ROWS, cols: 2 }]);
  });

  it('未 attach 就 input ⇒ error:not-attached 并关闭', async () => {
    const { connect } = setup();
    const { sink, conn } = connect();
    conn.handleText(JSON.stringify({ type: 'input', data: 'x' }));
    await flush();
    expect(framesOf(sink)[0]?.code).toBe('not-attached');
    expect(sink.destroyed).toBe(true);
  });

  it('attach 回显的令牌与建连令牌不符 ⇒ error:unauthorized（同一 socket 不许换手）', async () => {
    const { connect } = setup();
    const { sink, conn } = connect();
    conn.handleText(JSON.stringify({ type: 'attach', instanceId: 'inst-1', token: 'another-token' }));
    await flush();
    expect(framesOf(sink)[0]?.code).toBe('unauthorized');
    expect(sink.destroyed).toBe(true);
    expect(conn.instanceId).toBeUndefined();
  });

  it('实例不存在 ⇒ error:instance-not-found；畸形帧 ⇒ error:bad-message', async () => {
    const { connect } = setup({ withInstance: false });
    const missing = connect();
    await attach(missing.conn, missing.token); // 先正常 attach 一个不存在的实例
    expect(framesOf(missing.sink)[0]?.code).toBe('instance-not-found');
    expect(missing.sink.destroyed).toBe(true);

    const broken = connect();
    broken.conn.handleText('{not json');
    await flush();
    expect(framesOf(broken.sink)[0]?.code).toBe('bad-message');
    expect(broken.sink.destroyed).toBe(true);
  });

  it('会话层读失败 ⇒ error:read-failed（人话透传，供 UI 显示原因）', async () => {
    const { manager, connect } = setup();
    const { sink, token, conn } = connect();
    manager.failNextRead('spawn-failed', '启动终端失败：程序不可用');
    await attach(conn, token);
    expect(framesOf(sink)[0]?.type).toBe('error');
    expect(framesOf(sink)[0]?.code).toBe('read-failed');
    expect(framesOf(sink)[0]?.message).toContain('程序不可用');
  });

  it('重复 attach / 未知帧类型 ⇒ bad-message + 关闭', async () => {
    const { connect } = setup();
    const twice = connect();
    await attach(twice.conn, twice.token);
    twice.conn.handleText(JSON.stringify({ type: 'attach', instanceId: 'inst-1', token: twice.token }));
    await flush();
    expect(framesOf(twice.sink).at(-1)?.code).toBe('bad-message');

    const unknown = connect();
    unknown.conn.handleText(JSON.stringify({ type: 'teleport' }));
    await flush();
    expect(framesOf(unknown.sink)[0]?.code).toBe('bad-message');
  });

  it('close 幂等：重复 close 不抛，activeCount 归零', () => {
    const { channel, connect } = setup();
    const { conn } = connect();
    conn.close();
    conn.close();
    expect(channel.activeCount).toBe(0);
  });
});

describe('T3.3 端到端字节路径（upgrade → 粘包 → 命令帧）', () => {
  function setupBytes(): { webServer: ReturnType<typeof createFakeWebServer>; manager: FakeManager; issue: () => string; channel: TerminalChannel } {
    const webServer = createFakeWebServer();
    const fakeCtx = createFakeCtx(webServer.surface);
    const manager = createFakeManager();
    manager.add('inst-1');
    const tokens = createTokenStore();
    const registration = registerTerminalChannel(fakeCtx.ctx, {
      manager: manager.session,
      tokens,
      allowedOrigins: [ORIGIN],
    });
    return { webServer, manager, issue: () => tokens.issue(), channel: registration.channel };
  }

  it('半包也要能拼回一条 attach（TCP 不保证一帧一次 data 事件）', async () => {
    const { webServer, issue } = setupBytes();
    const token = issue();
    const socket = webServer.invokeUpgrade('/dsh-managed-terminal/ws', {
      headers: handshakeHeaders(token, ORIGIN, { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' }),
    });
    expect(socket.responseStatus()).toBe(101);
    socket.clearWritten();

    const frame = clientTextFrame(JSON.stringify({ type: 'attach', instanceId: 'inst-1', token }));
    socket.emitData(frame.subarray(0, 7)); // 半包
    await flush();
    expect(socket.messages()).toEqual([]);
    socket.emitData(frame.subarray(7)); // 剩余
    await flush();
    const frames = socket.messages() as ServerFrame[];
    expect(frames[0]?.type).toBe('attached');
    expect(frames[0]?.snapshot).toContain('inst-1');
  });
});
