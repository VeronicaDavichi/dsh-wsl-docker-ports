/**
 * RFC 6455 的**握手响应 + 最小帧编解码**（002 T3.2 的 §「可验收」前提）
 *
 * 为什么自己写而不是引库：硬约束禁止新增依赖，且宿主 `registerUpgrade` 给的是**裸 socket**
 * （Node `upgrade` 事件语义）—— 没有 WS 库可用，握手与成帧只能自己来。
 *
 * 本文件是**唯一**碰字节的地方，且只暴露纯函数（无 socket、无状态）：
 * 这样「零真机」也能用**手搓的字节 fixture** 把编解码钉住（含 RFC 6455 §1.3 的官方
 * 握手向量 —— 拿官方向量当锚点，比自证 en/decode 互逆可信得多）。
 *
 * 覆盖范围（只做 design §2.3 协议表需要的）：文本帧、分片续帧、ping/pong/close。
 * 明确**不支持**：二进制帧（`0x2`，收到即协议错）、压缩扩展、小于 8 字节的掩码（协议不允许）。
 */

import { createHash } from 'node:crypto';
import { TERM_WS_MAX_FRAME_BYTES, WS_GUID } from './constants.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** `Sec-WebSocket-Accept = base64(sha1(key + GUID))`（RFC 6455 §4.2.2） */
export function computeAcceptKey(secWebSocketKey: string): string {
  return createHash('sha1').update(secWebSocketKey + WS_GUID).digest('base64');
}

/** 101 响应（**必须**以空行结束；upgrade 后同一 socket 转为帧序） */
export function buildUpgradeResponse(secWebSocketKey: string): string {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${computeAcceptKey(secWebSocketKey)}`,
    '',
    '',
  ].join('\r\n');
}

/** 服务端→客户端帧**不掩码**（RFC 6455 §5.1）；长度用最紧凑的合法编码 */
function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const length = payload.length;
  const extended = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
  const frame = new Uint8Array(2 + extended + length);
  frame[0] = 0x80 | opcode; // FIN + opcode
  if (extended === 0) {
    frame[1] = length;
  } else if (extended === 2) {
    frame[1] = 126;
    frame[2] = (length >>> 8) & 0xff;
    frame[3] = length & 0xff;
  } else {
    frame[1] = 127;
    new DataView(frame.buffer).setBigUint64(2, BigInt(length));
  }
  frame.set(payload, 2 + extended);
  return frame;
}

export function encodeTextFrame(text: string): Uint8Array {
  return encodeFrame(0x1, encoder.encode(text));
}

/** ping 的应答（RFC 6455 §5.5.3：**原样**回 payload） */
export function encodePongFrame(payload: Uint8Array): Uint8Array {
  return encodeFrame(0xa, payload);
}

export function encodeCloseFrame(payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  return encodeFrame(0x8, payload);
}

/** 拼接半包（TCP 不保证一帧一次 `data` 事件，必须自带粘包缓冲） */
export function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

export interface DecodedFrames {
  /** 完整的文本消息（分片已被拼回一条） */
  readonly messages: readonly string[];
  /** 收到的 ping（宿主适配层需逐个回 pong；不在本纯函数里写 socket） */
  readonly pings: readonly Uint8Array[];
  /** 收到 close（适配层应关连接） */
  readonly closed: boolean;
  /** 未消费完的字节（半包；下次 `data` 时先 `concatBytes` 再解） */
  readonly rest: Uint8Array;
  /** 协议级错误（未掩码 / 超大 / 二进制 / 非 UTF-8）⇒ 调用方必须关连接 */
  readonly protocolError?: string | undefined;
}

/**
 * 解出**所有**完整帧，把半包留在 `rest` 里。
 *
 * 关键判据（T3.2/T3.3 的字节面）：
 * ① 客户端帧**必须**掩码（RFC 6455 §5.1），未掩码 = 协议错；
 * ② 长度字段声明超过 `TERM_WS_MAX_FRAME_BYTES` ⇒ 立刻判错，**不**按声明长度分配内存；
 * ③ 控制帧（close/ping）不参与分片拼接，文本分片按 `continuation` 累加。
 */
export function decodeFrames(input: Uint8Array): DecodedFrames {
  const messages: string[] = [];
  const pings: Uint8Array[] = [];
  let closed = false;
  let protocolError: string | undefined;
  let fragment = '';
  let fragmentOpen = false;
  let offset = 0;

  const bail = (reason: string): DecodedFrames => ({ messages, pings, closed: true, rest: input.subarray(offset), protocolError: reason });

  while (offset + 2 <= input.length) {
    const b0 = input[offset] ?? 0;
    const b1 = input[offset + 1] ?? 0;
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (cursor + 2 > input.length) break;
      length = ((input[cursor] ?? 0) << 8) | (input[cursor + 1] ?? 0);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > input.length) break;
      const declared = new DataView(input.buffer, input.byteOffset + cursor, 8).getBigUint64(0);
      if (declared > BigInt(TERM_WS_MAX_FRAME_BYTES)) return bail(`帧长度 ${declared} 超过上限`);
      length = Number(declared);
      cursor += 8;
    }
    if (length > TERM_WS_MAX_FRAME_BYTES) return bail(`帧长度 ${length} 超过上限`);
    if (!masked) return bail('客户端帧未掩码（RFC 6455 §5.1）');
    if (cursor + 4 + length > input.length) break; // 半包：等下一批字节

    const maskKey = input.subarray(cursor, cursor + 4);
    cursor += 4;
    const payload = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      payload[index] = (input[cursor + index] ?? 0) ^ (maskKey[index & 3] ?? 0);
    }
    cursor += length;
    offset = cursor;

    if (opcode === 0x8) {
      closed = true;
      continue;
    }
    if (opcode === 0x9) {
      pings.push(payload);
      continue;
    }
    if (opcode === 0xa) continue; // pong：无状态可更新，忽略
    if (opcode === 0x2) return bail('不支持二进制帧');

    let text: string;
    try {
      text = decoder.decode(payload);
    } catch {
      return bail('文本帧不是合法 UTF-8');
    }

    if (opcode === 0x1) {
      if (fin) {
        messages.push(text);
      } else {
        fragment = text;
        fragmentOpen = true;
      }
      continue;
    }
    if (opcode === 0x0) {
      if (!fragmentOpen) return bail('收到续帧但没有起始帧');
      fragment += text;
      if (fin) {
        messages.push(fragment);
        fragment = '';
        fragmentOpen = false;
      }
      continue;
    }
    return bail(`未知 opcode 0x${opcode.toString(16)}`);
  }

  return protocolError === undefined
    ? { messages, pings, closed, rest: input.subarray(offset) }
    : { messages, pings, closed, rest: input.subarray(offset), protocolError };
}
