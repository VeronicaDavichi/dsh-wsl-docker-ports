/**
 * 独立实现的 WS 帧编解码 fixture（002 Phase 3 测试基建）
 *
 * 🔴 这份实现**故意不 import `src/ws/frames.ts`**：验证帧格式时若用被测代码去解自己写的帧，
 * 格式写错也会「自洽地全绿」。测试替身与被测实现必须是**两份独立代码**，往返才算证据。
 */

import { createHash } from 'node:crypto';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/* ------------------------------------------------------------------ 帧（独立实现） */

const MASK = new Uint8Array([0x11, 0x22, 0x33, 0x44]);

/** 客户端帧（**必须**掩码；`fin=false` 用于分片测试） */
export function clientFrame(opcode: number, payload: Uint8Array, fin = true): Uint8Array {
  const length = payload.length;
  const extended = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
  const frame = new Uint8Array(2 + extended + 4 + length);
  frame[0] = (fin ? 0x80 : 0x00) | opcode;
  if (extended === 0) frame[1] = 0x80 | length;
  else if (extended === 2) {
    frame[1] = 0x80 | 126;
    frame[2] = (length >>> 8) & 0xff;
    frame[3] = length & 0xff;
  } else {
    frame[1] = 0x80 | 127;
    new DataView(frame.buffer).setBigUint64(2, BigInt(length));
  }
  const maskAt = 2 + extended;
  frame.set(MASK, maskAt);
  for (let index = 0; index < length; index += 1) {
    frame[maskAt + 4 + index] = (payload[index] ?? 0) ^ (MASK[index & 3] ?? 0);
  }
  return frame;
}

export function clientTextFrame(text: string): Uint8Array {
  return clientFrame(0x1, encoder.encode(text));
}

export interface ServerFrames {
  readonly messages: string[];
  readonly pings: number;
  readonly rest: Uint8Array;
  readonly closeSeen: boolean;
}

/** 服务端帧解码（未掩码）；半包留在 `rest` */
export function decodeServerFrames(input: Uint8Array): ServerFrames {
  const messages: string[] = [];
  let pings = 0;
  let closeSeen = false;
  let offset = 0;
  while (offset + 2 <= input.length) {
    const b1 = input[offset + 1] ?? 0;
    if ((b1 & 0x80) !== 0) throw new Error('测试替身：服务端帧不应带掩码');
    const opcode = (input[offset] ?? 0) & 0x0f;
    let length = b1 & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > input.length) break;
      length = ((input[cursor] ?? 0) << 8) | (input[cursor + 1] ?? 0);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > input.length) break;
      length = Number(new DataView(input.buffer, input.byteOffset + cursor, 8).getBigUint64(0));
      cursor += 8;
    }
    if (cursor + length > input.length) break;
    const payload = input.subarray(cursor, cursor + length);
    cursor += length;
    offset = cursor;
    if (opcode === 0x1) messages.push(decoder.decode(payload));
    else if (opcode === 0x9) pings += 1;
    else if (opcode === 0x8) closeSeen = true;
  }
  return { messages, pings, rest: input.subarray(offset), closeSeen };
}

/** `Sec-WebSocket-Accept` 的独立实现（RFC 6455 §1.3 向量的对照口） */
export function acceptKeyOf(secWebSocketKey: string): string {
  return createHash('sha1').update(`${secWebSocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
}

/** 构造 upgrade/list 用的请求头 */
export function handshakeHeaders(token?: string, origin = 'http://127.0.0.1:19387', extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { host: '127.0.0.1:19387', origin, ...extra };
  if (token !== undefined) headers['x-dsh-terminal-token'] = token;
  return headers;
}
