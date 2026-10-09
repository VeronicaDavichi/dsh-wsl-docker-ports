/**
 * 裸 socket ↔ 通道核心的粘合层（002 T3.1/T3.2 的宿主边界）
 *
 * 宿主 `registerUpgrade({ path, handler })` 给的是**裸 socket**（Node `upgrade` 事件语义）：
 * 握手响应、WS 成帧、粘包缓冲都得自己做。本文件把这份脏活收在一个地方 ——
 * 若真机给的其实是「已解帧的 ws-like 对象」，只需替换本文件（通道逻辑与单测一行不动）。
 *
 * 校验顺序（拒绝时**立刻**写响应并 destroy，绝不留下半开的 socket）：
 * ① `channel.authenticate`（Origin + 一次性令牌，REQ-7.2）→ 失败按结果里的 status/文案拒绝；
 * ② `Sec-WebSocket-Key` 必须存在且非空（缺了就无法算 Accept，101 是算不出来的）。
 *
 * 🔴 两处「不泄露」：拒绝响应体只有**固定文案**（无实例信息）；101 响应里除了 Accept
 * 不带任何本包字段。
 */

import { readHeader } from './auth.ts';
import { buildUpgradeResponse, concatBytes, decodeFrames, encodeCloseFrame, encodePongFrame, encodeTextFrame } from './frames.ts';
import type { TerminalChannel } from './connection.ts';
import type { FrameSink, HttpRequestLike, UpgradeSocketLike } from './types.ts';

const encoder = new TextEncoder();

export interface RejectionPlan {
  readonly status: number;
  /** 机器可读码（进响应体的 `error.code`） */
  readonly code: string;
  /** 固定人话（**不含**任何实例/配置信息） */
  readonly message: string;
}

const REASON_PHRASE: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
};

/** 写一个**完整的** HTTP 响应（含 Content-Length）再 destroy：不做 keep-alive，通道只有 101 一条活路 */
export function writeRejection(socket: UpgradeSocketLike, plan: RejectionPlan): void {
  const body = JSON.stringify({ error: { code: plan.code, message: plan.message } });
  const bytes = encoder.encode(body);
  const head =
    `HTTP/1.1 ${plan.status} ${REASON_PHRASE[plan.status] ?? 'Error'}\r\n` +
    'Content-Type: application/json; charset=utf-8\r\n' +
    `Content-Length: ${bytes.length}\r\n` +
    'Connection: close\r\n\r\n';
  socket.write(encoder.encode(head));
  socket.write(bytes);
  socket.destroy();
}

/** 把 socket 事件给的 `unknown` 收成字节（Buffer 是 Uint8Array 子类；字符串按 UTF-8） */
export function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (typeof chunk === 'string') return encoder.encode(chunk);
  return new Uint8Array(0);
}

/**
 * 组装升级处理器。
 *
 * `head`（Node 在 upgrade 事件里额外给的、已经读进内存的首批字节）**必须**先喂进粘包缓冲：
 * 漏掉它就会丢掉客户端的头几个帧 —— 那是「连上了但永远收不到 attach」这类幽灵故障的来源。
 */
export function createUpgradeHandler(channel: TerminalChannel): (req: HttpRequestLike, socket: UpgradeSocketLike, head?: unknown) => void {
  return (req, socket, head) => {
    const auth = channel.authenticate(req);
    if (!auth.ok) {
      writeRejection(socket, { status: auth.status, code: auth.code, message: auth.message });
      return;
    }
    const key = readHeader(req.headers, 'sec-websocket-key');
    if (key === undefined || key === '') {
      writeRejection(socket, { status: 400, code: 'bad-request', message: '缺少 Sec-WebSocket-Key：拒绝建立通道。' });
      return;
    }

    const sink: FrameSink = {
      write: (text: string) => socket.write(encodeTextFrame(text)),
      destroy: () => socket.destroy(),
    };
    socket.write(encoder.encode(buildUpgradeResponse(key)));
    const conn = channel.accept(sink, auth.token);

    let pending = toBytes(head);
    socket.on('data', (chunk) => {
      pending = concatBytes(pending, toBytes(chunk));
      const decoded = decodeFrames(pending);
      pending = decoded.rest;
      for (const ping of decoded.pings) socket.write(encodePongFrame(ping));
      for (const text of decoded.messages) conn.handleText(text);
      if (decoded.protocolError !== undefined) {
        socket.write(encodeCloseFrame());
        conn.close();
        return;
      }
      if (decoded.closed) {
        socket.write(encodeCloseFrame());
        conn.close();
      }
    });
    socket.on('drain', () => conn.drain());
    socket.on('close', () => conn.close());
    socket.on('error', () => conn.close());
  };
}
