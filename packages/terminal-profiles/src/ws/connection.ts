/**
 * 通道核心：attach / 续传 / 顶替 / 背压（002 T3.3 / T3.4，REQ-7.3 / 7.4 / 7.7）
 *
 * 本层只认**文本帧**（`FrameSink`）与**会话管理器**（`SessionManager`）两个结构面：
 * 字节面在 `./frames.ts` + `./upgrade-socket.ts`，屏幕/缓冲面在 `SessionManager.read` 背后。
 *
 * ## 三条不可动摇的判据
 * ① **单活跃连接**：`instanceId → Conn` 一对一；新连接先顶掉旧连接（旧的收 `error:'superseded'`
 *    再被 destroy）—— REQ-7.4 二选一，这里择「顶掉」，理由同 design §2.3（刷新后旧连接常处于
 *    半死状态，拒绝新的会把用户锁死）。**先顶后读**：顶替在 `read` 之前完成，这样无论新连接
 *    随后读成功与否，都不存在「两个连接同时可写同一 PTY」的窗口（SHALL NOT 双写）。
 * ② **续传按 `seq`**：重连带 `sinceSeq` 时，补发的块 seq **必须**从 `sinceSeq` 起连续升序、
 *    不重复；区间已被丢弃则走 `lost { snapshot }`（REQ-7.3 / REQ-6.3）。
 * ③ **不无界排队**：所有出站帧都过 `./outbound.ts` 的有界队列；触顶即丢并置 `needsResync`，
 *    下一轮 `pump` 用快照补齐（REQ-7.7 + REQ-6.3）。
 *
 * ⚠️ 推送由宿主调度器调用 `pump()` 驱动，本层**不自起定时器**（自起定时器会在卸载后留下
 * 悬挂句柄 = 与「路由残留」同类的泄漏；调度归属集成方，见 T3.1 的 effect-scoped 口径）。
 */

import { clampInt, TERM_MAX_COLS, TERM_MAX_ROWS, TERM_MIN_COLS, TERM_MIN_ROWS } from '../limits.ts';
import type { SessionManager } from '../session/manager.ts';
import type { TerminalInstanceSummary } from '../session/types.ts';
import { safeEqual, validateHandshake } from './auth.ts';
import type { HandshakeResult, TokenStore } from './auth.ts';
import { createOutboundQueue } from './outbound.ts';
import type { OutboundStats } from './outbound.ts';
import type { HttpRequestLike, ClientMessage, FrameSink, ServerErrorCode, ServerMessage } from './types.ts';

export interface ChannelDeps {
  readonly manager: SessionManager;
  readonly tokens: TokenStore;
  /** 允许的 Origin 白名单（**空 = 全拒**，见 `./auth.ts` 文件头） */
  readonly allowedOrigins: readonly string[];
  readonly now?: (() => number) | undefined;
  readonly maxQueuedFrames?: number | undefined;
  readonly maxQueuedBytes?: number | undefined;
}

/** 一条通道连接（宿主适配层持有它；测试里直接喂文本帧） */
export interface TextConnection {
  readonly id: number;
  readonly instanceId: string | undefined;
  /** 收到一帧 C→H 文本时调用（畸形帧会被整形为 `error` 后关连接） */
  handleText(text: string): void;
  /**
   * 背压解除（宿主在 socket 的 `drain` 事件上调用）⇒ 放行待发队列。
   *
   * 🔴 **不能**由 `pump` 代替：`pump` 是「有新输出就推」，与「消费者已恢复读取」是两件事。
   * 若每轮 `pump` 都无条件 flush，暂停期间每轮就会多灌一帧进内核 —— 单轮有界、总量无界，
   * 正是 REQ-7.7 要禁的东西（区别只在「多慢」而不在「有没有」）。
   */
  drain(): void;
  /** 关闭并销毁 socket（幂等） */
  close(): void;
  readonly stats: OutboundStats;
}

export interface TerminalChannel {
  /** 握手校验（upgrade 与 list 路由**共用**；REQ-7.5） */
  authenticate(req: HttpRequestLike): HandshakeResult;
  /** 升级成功后建连；`boundToken` 是握手时已兑换的那枚（`attach` 必须回显同一枚） */
  accept(socket: FrameSink, boundToken: string): TextConnection;
  /** 把某个（或全部）实例的新输出推给客户端；由宿主调度器调用 */
  pump(instanceId?: string): Promise<void>;
  /** 仍存活的连接数（顶替后旧连接已 closed ⇒ 归 1，T3.3 的判据） */
  readonly activeCount: number;
  activeInstanceIds(): readonly string[];
  closeAll(): void;
}

interface Conn {
  readonly id: number;
  readonly socket: FrameSink;
  readonly boundToken: string;
  readonly queue: ReturnType<typeof createOutboundQueue>;
  instanceId: string | undefined;
  /** 下一号游标（`seq` 语义同会话层：消费方存它当下次 `sinceSeq`） */
  seq: number | undefined;
  exitSent: boolean;
  closed: boolean;
}

type ParseOutcome = { readonly ok: true; readonly message: ClientMessage } | { readonly ok: false; readonly reason: string };

/** 帧整形：**只**做类型与形状校验，不做业务判断 */
export function parseClientMessage(text: string): ParseOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: '帧不是合法 JSON' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: '帧必须是 JSON 对象' };
  const record = raw as Record<string, unknown>;
  const type = record['type'];
  if (type === 'attach') {
    const instanceId = record['instanceId'];
    const token = record['token'];
    const sinceSeq = record['sinceSeq'];
    if (typeof instanceId !== 'string' || instanceId === '') return { ok: false, reason: 'attach 缺少 instanceId' };
    if (typeof token !== 'string' || token === '') return { ok: false, reason: 'attach 缺少 token' };
    if (sinceSeq !== undefined && (typeof sinceSeq !== 'number' || !Number.isFinite(sinceSeq))) {
      return { ok: false, reason: 'attach 的 sinceSeq 必须是有限数字' };
    }
    return {
      ok: true,
      message: typeof sinceSeq === 'number'
        ? { type: 'attach', instanceId, token, sinceSeq: Math.trunc(sinceSeq) }
        : { type: 'attach', instanceId, token },
    };
  }
  if (type === 'input') {
    const data = record['data'];
    if (typeof data !== 'string') return { ok: false, reason: 'input 的 data 必须是字符串' };
    return { ok: true, message: { type: 'input', data } };
  }
  if (type === 'resize') {
    const rows = record['rows'];
    const cols = record['cols'];
    if (typeof rows !== 'number' || typeof cols !== 'number' || !Number.isFinite(rows) || !Number.isFinite(cols)) {
      return { ok: false, reason: 'resize 的 rows/cols 必须是有限数字' };
    }
    // 夹紧在会话层做（REQ-5.3），这里只把明显越界的值收进合法区间，避免把 1e9 传下去
    return {
      ok: true,
      message: {
        type: 'resize',
        rows: clampInt(rows, TERM_MIN_ROWS, TERM_MAX_ROWS),
        cols: clampInt(cols, TERM_MIN_COLS, TERM_MAX_COLS),
      },
    };
  }
  return { ok: false, reason: `未知帧类型：${String(type)}` };
}

export function createTerminalChannel(deps: ChannelDeps): TerminalChannel {
  const connections: Conn[] = [];
  const activeByInstance = new Map<string, Conn>();
  let nextId = 1;

  const send = (conn: Conn, message: ServerMessage): void => {
    if (conn.closed) return;
    conn.queue.enqueue(JSON.stringify(message));
  };

  const closeConn = (conn: Conn): void => {
    if (conn.closed) return;
    conn.closed = true;
    if (conn.instanceId !== undefined && activeByInstance.get(conn.instanceId) === conn) {
      activeByInstance.delete(conn.instanceId);
    }
    conn.socket.destroy();
  };

  /** 失败一律走这里：`fatal` 决定是否关连接（协议/授权错必须关，业务错保留连接让用户继续） */
  const fail = (conn: Conn, code: ServerErrorCode, message: string, fatal: boolean): void => {
    send(conn, { type: 'error', code, message });
    if (fatal) {
      conn.queue.flush();
      closeConn(conn);
    }
  };

  /** REQ-7.4：新连接顶掉旧连接（旧连接必须先收到可读原因，不能只看到一根断掉的管子） */
  const supersede = (instanceId: string, incoming: Conn): void => {
    const previous = activeByInstance.get(instanceId);
    if (previous === undefined || previous === incoming) return;
    send(previous, { type: 'error', code: 'superseded', message: '该实例已有更新的连接，本连接被顶掉（REQ-7.4）。' });
    previous.queue.flush();
    closeConn(previous);
  };

  const findSummary = (instanceId: string): TerminalInstanceSummary | undefined =>
    deps.manager.list().find((item) => item.id === instanceId);

  const attach = async (conn: Conn, message: { instanceId: string; token: string; sinceSeq?: number | undefined }): Promise<void> => {
    if (conn.instanceId !== undefined) {
      fail(conn, 'bad-message', '本连接已 attach，不允许重复 attach。', true);
      return;
    }
    // 令牌在握手时已兑换（一次性）；这里要求 attach 回显**同一枚**，避免「同一 socket 被换手」
    if (!safeEqual(message.token, conn.boundToken)) {
      fail(conn, 'unauthorized', '令牌与建立连接时使用的不一致：拒绝 attach。', true);
      return;
    }
    if (findSummary(message.instanceId) === undefined) {
      fail(conn, 'instance-not-found', `实例 ${message.instanceId} 不存在（可能已被 kill）。`, true);
      return;
    }
    const instanceId = message.instanceId;
    supersede(instanceId, conn); // 先顶掉旧的，再读 —— 不存在两个连接都能写的窗口
    conn.instanceId = instanceId;
    conn.exitSent = false;
    activeByInstance.set(instanceId, conn);

    const snapshotResult = await deps.manager.read(instanceId, { mode: 'snapshot' });
    if (!snapshotResult.ok) {
      fail(conn, 'read-failed', snapshotResult.message, true);
      return;
    }
    if (snapshotResult.value.mode !== 'snapshot') {
      fail(conn, 'internal', '内部错误：snapshot 读取返回了增量结果。', true);
      return;
    }
    const snapshot = snapshotResult.value.snapshot;
    const size = { rows: snapshot.rows, cols: snapshot.cols };

    if (message.sinceSeq === undefined) {
      conn.seq = snapshot.seq;
      send(conn, { type: 'attached', size, snapshot: snapshot.text, seq: snapshot.seq });
      return;
    }

    const incrementalResult = await deps.manager.read(instanceId, { mode: 'incremental', sinceSeq: message.sinceSeq });
    if (!incrementalResult.ok) {
      fail(conn, 'read-failed', incrementalResult.message, true);
      return;
    }
    if (incrementalResult.value.mode !== 'incremental') {
      fail(conn, 'internal', '内部错误：incremental 读取返回了快照结果。', true);
      return;
    }
    const read = incrementalResult.value;
    if (read.lost) {
      // REQ-7.3 后半句：无法续传 ⇒ 下发快照（且明说「已丢失」，REQ-6.3）
      conn.seq = read.seq;
      send(conn, { type: 'lost', snapshot: read.snapshot.text, seq: read.seq });
      return;
    }
    // 续传成功 ⇒ 不下发快照（客户端已有屏幕；重发会与随后的块在屏幕上重复打印）
    conn.seq = message.sinceSeq;
    send(conn, { type: 'attached', size, snapshot: null, seq: message.sinceSeq });
    for (const chunk of read.chunks) {
      send(conn, { type: 'chunk', seq: chunk.seq, data: chunk.data });
    }
    conn.seq = read.seq;
  };

  const runInput = async (conn: Conn, data: string): Promise<void> => {
    const instanceId = conn.instanceId;
    if (instanceId === undefined) {
      fail(conn, 'not-attached', '尚未 attach：先发送 attach 帧再写入。', true);
      return;
    }
    const result = await deps.manager.write(instanceId, data);
    if (!result.ok) fail(conn, 'write-failed', result.message, false);
  };

  const runResize = async (conn: Conn, rows: number, cols: number): Promise<void> => {
    const instanceId = conn.instanceId;
    if (instanceId === undefined) {
      fail(conn, 'not-attached', '尚未 attach：先发送 attach 帧再改尺寸。', true);
      return;
    }
    const result = await deps.manager.resize(instanceId, rows, cols);
    if (!result.ok) fail(conn, 'resize-failed', result.message, false);
  };

  const dispatch = async (conn: Conn, message: ClientMessage): Promise<void> => {
    if (message.type === 'attach') return attach(conn, message);
    if (message.type === 'input') return runInput(conn, message.data);
    return runResize(conn, message.rows, message.cols);
  };

  /**
   * 出站统一入口：按需重同步，再推增量。
   *
   * ⚠️ 这里**不**调 `queue.flush()`（见 `TextConnection.drain` 的注释）：放行待发队列是
   * 「消费者已恢复」的信号，只能来自宿主的 `drain` 事件，不能由「有新输出」冒充。
   */
  const pumpOne = async (conn: Conn): Promise<void> => {
    if (conn.closed) return;
    const instanceId = conn.instanceId;
    if (instanceId === undefined || conn.closed) return;

    if (conn.queue.stats.needsResync) {
      const snapshotResult = await deps.manager.read(instanceId, { mode: 'snapshot' });
      if (snapshotResult.ok && snapshotResult.value.mode === 'snapshot') {
        const snapshot = snapshotResult.value.snapshot;
        conn.seq = snapshot.seq;
        send(conn, { type: 'lost', snapshot: snapshot.text, seq: snapshot.seq });
        conn.queue.clearResync();
      }
      return; // 本轮只做重同步：增量留给下一轮，避免「快照 + 空洞增量」混发
    }

    if (conn.seq === undefined) return;
    const result = await deps.manager.read(instanceId, { mode: 'incremental', sinceSeq: conn.seq });
    if (!result.ok) {
      fail(conn, 'read-failed', result.message, false);
      return;
    }
    if (result.value.mode !== 'incremental') {
      fail(conn, 'internal', '内部错误：incremental 读取返回了快照结果。', false);
      return;
    }
    const read = result.value;
    if (read.lost) {
      conn.seq = read.seq;
      send(conn, { type: 'lost', snapshot: read.snapshot.text, seq: read.seq });
    } else {
      for (const chunk of read.chunks) {
        send(conn, { type: 'chunk', seq: chunk.seq, data: chunk.data });
      }
      conn.seq = read.seq;
    }

    const summary = findSummary(instanceId);
    if (summary !== undefined && summary.exited && !conn.exitSent) {
      conn.exitSent = true;
      // 摘要层不给退出码（`TerminalInstanceSummary` 没有该字段）⇒ null = 未知，不编造数字
      send(conn, { type: 'exit', code: null });
    }
  };

  const handleText = (conn: Conn, text: string): void => {
    if (conn.closed) return;
    const parsed = parseClientMessage(text);
    if (!parsed.ok) {
      fail(conn, 'bad-message', parsed.reason, true);
      return;
    }
    void dispatch(conn, parsed.message).catch((error: unknown) => {
      fail(conn, 'internal', `内部错误：${error instanceof Error ? error.message : String(error)}`, true);
    });
  };

  return {
    authenticate: (req) =>
      validateHandshake(req, {
        tokens: deps.tokens,
        allowedOrigins: deps.allowedOrigins,
        ...(deps.now === undefined ? {} : { now: deps.now }),
      }),

    accept(socket, boundToken): TextConnection {
      const conn: Conn = {
        id: nextId,
        socket,
        boundToken,
        queue: createOutboundQueue(socket, {
          ...(deps.maxQueuedFrames === undefined ? {} : { maxFrames: deps.maxQueuedFrames }),
          ...(deps.maxQueuedBytes === undefined ? {} : { maxBytes: deps.maxQueuedBytes }),
        }),
        instanceId: undefined,
        seq: undefined,
        exitSent: false,
        closed: false,
      };
      nextId += 1;
      connections.push(conn);
      return {
        get id() {
          return conn.id;
        },
        get instanceId() {
          return conn.instanceId;
        },
        get stats() {
          return conn.queue.stats;
        },
        handleText: (text: string) => handleText(conn, text),
        drain: () => {
          if (!conn.closed) conn.queue.flush();
        },
        close: () => closeConn(conn),
      };
    },

    async pump(instanceId?: string): Promise<void> {
      const targets = instanceId === undefined
        ? [...activeByInstance.values()]
        : [activeByInstance.get(instanceId)].filter((conn): conn is Conn => conn !== undefined);
      for (const conn of targets) {
        await pumpOne(conn);
      }
    },

    get activeCount(): number {
      return connections.filter((conn) => !conn.closed).length;
    },

    activeInstanceIds(): readonly string[] {
      return [...activeByInstance.keys()];
    },

    closeAll(): void {
      for (const conn of connections) closeConn(conn);
    },
  };
}
