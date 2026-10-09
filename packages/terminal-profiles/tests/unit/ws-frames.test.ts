/**
 * 字节层：握手向量 + 帧编解码（T3.1/T3.2 的底层，T3.3 的粘包前提）
 *
 * 两个**外部锚点**（避免「自己验自己」）：
 * ① RFC 6455 §1.3 的官方握手向量（key → Accept 是规范里写死的值）；
 * ② 客户端帧用 `tests/helpers/ws-fakes.ts` 里**独立实现**的编码器构造，服务端帧用同样独立的
 *    解码器读回 —— 与被测代码不共享任何一行。
 */

import { describe, expect, it } from 'vitest';
import {
  buildUpgradeResponse,
  computeAcceptKey,
  concatBytes,
  decodeFrames,
  encodeCloseFrame,
  encodePongFrame,
  encodeTextFrame,
} from '../../src/ws/frames.ts';
import { TERM_WS_MAX_FRAME_BYTES } from '../../src/ws/constants.ts';
import { acceptKeyOf, clientFrame, clientTextFrame, decodeServerFrames } from '../helpers/ws-fakes.ts';

const RFC_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const RFC_ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';

describe('握手', () => {
  it('Sec-WebSocket-Accept 与 RFC 6455 §1.3 的官方向量一致', () => {
    expect(computeAcceptKey(RFC_KEY)).toBe(RFC_ACCEPT);
    expect(acceptKeyOf(RFC_KEY)).toBe(RFC_ACCEPT); // 测试替身里那份独立实现算出的也是同一个值
  });

  it('101 响应头齐备且以空行结束', () => {
    const response = buildUpgradeResponse(RFC_KEY);
    const lines = response.split('\r\n');
    expect(lines[0]).toBe('HTTP/1.1 101 Switching Protocols');
    expect(lines).toContain('Upgrade: websocket');
    expect(lines).toContain('Connection: Upgrade');
    expect(lines).toContain(`Sec-WebSocket-Accept: ${RFC_ACCEPT}`);
    expect(response.endsWith('\r\n\r\n')).toBe(true);
  });
});

describe('服务端帧编码', () => {
  it('短/中/长三种长度编码都能被独立解码器读回', () => {
    const samples = ['short', 'x'.repeat(200), 'y'.repeat(70_000)];
    for (const text of samples) {
      const frame = encodeTextFrame(text);
      const decoded = decodeServerFrames(frame);
      expect(decoded.messages).toEqual([text]);
      expect(decoded.rest).toHaveLength(0);
    }
    // 长度分档确实不同（不是「都用 127 档」这种偷懒实现）
    expect(encodeTextFrame('short')).toHaveLength(2 + 5);
    expect(encodeTextFrame('x'.repeat(200))).toHaveLength(4 + 200);
    expect(encodeTextFrame('y'.repeat(70_000))).toHaveLength(10 + 70_000);
  });

  it('pong / close 的 opcode 正确', () => {
    // 直接断言首字节（FIN + opcode），不借测试替身的 ping 计数（那是给 ping 用的）
    expect(encodePongFrame(new TextEncoder().encode('p'))[0]).toBe(0x8a);
    expect(encodeCloseFrame()[0]).toBe(0x88);
    expect(decodeServerFrames(encodeCloseFrame()).closeSeen).toBe(true);
  });
});

describe('客户端帧解码（必须掩码）', () => {
  it('解出文本消息；半包留在 rest 里，补齐后仍能解出', () => {
    const frame = clientTextFrame('{"type":"attach"}');
    const half = frame.subarray(0, 6);
    const partial = decodeFrames(half);
    expect(partial.messages).toEqual([]);
    expect(partial.protocolError).toBeUndefined();
    expect(partial.rest).toHaveLength(6); // 一个字节都没消费

    const joined = concatBytes(partial.rest, frame.subarray(6));
    expect(decodeFrames(joined).messages).toEqual(['{"type":"attach"}']);
  });

  it('一次 data 事件里的多条帧全部解出（粘包）', () => {
    const a = clientTextFrame('one');
    const b = clientTextFrame('two');
    const joined = concatBytes(a, b);
    expect(decodeFrames(joined).messages).toEqual(['one', 'two']);
    expect(decodeFrames(joined).rest).toHaveLength(0);
  });

  it('分片续帧拼回一条消息', () => {
    const first = clientFrame(0x1, new TextEncoder().encode('he'), false);
    const second = clientFrame(0x0, new TextEncoder().encode('llo'), true);
    const decoded = decodeFrames(concatBytes(first, second));
    expect(decoded.messages).toEqual(['hello']);
    expect(decoded.protocolError).toBeUndefined();
  });

  it('ping 原样带出 payload 供适配层回 pong', () => {
    const decoded = decodeFrames(clientFrame(0x9, new TextEncoder().encode('hb')));
    expect(decoded.pings).toHaveLength(1);
    expect(new TextDecoder().decode(decoded.pings[0])).toBe('hb');
  });

  it('close ⇒ closed（由适配层回 close 并关闭）', () => {
    expect(decodeFrames(clientFrame(0x8, new Uint8Array(0))).closed).toBe(true);
  });
});

describe('协议错误一律判错（不许硬撑）', () => {
  it('未掩码的客户端帧 ⇒ protocolError', () => {
    const unmasked = new Uint8Array([0x81, 0x01, 0x61]);
    const decoded = decodeFrames(unmasked);
    expect(decoded.protocolError).toContain('未掩码');
    expect(decoded.closed).toBe(true);
    expect(decoded.messages).toEqual([]);
  });

  it('长度字段声明超过上限 ⇒ 立刻判错，不按声明长度分配', () => {
    const header = new Uint8Array(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    new DataView(header.buffer).setBigUint64(2, BigInt(TERM_WS_MAX_FRAME_BYTES + 1));
    const decoded = decodeFrames(header);
    expect(decoded.protocolError).toContain('超过上限');
    expect(decoded.closed).toBe(true);
  });

  it('二进制帧 ⇒ protocolError（协议表里没有它）', () => {
    const decoded = decodeFrames(clientFrame(0x2, new Uint8Array([1, 2, 3])));
    expect(decoded.protocolError).toContain('二进制');
  });

  it('没有起始帧的续帧 / 未知 opcode ⇒ protocolError', () => {
    expect(decodeFrames(clientFrame(0x0, new TextEncoder().encode('x'))).protocolError).toContain('续帧');
    expect(decodeFrames(clientFrame(0x5, new Uint8Array(0))).protocolError).toContain('opcode');
  });

  it('非 UTF-8 的文本帧 ⇒ protocolError（不让坏字节进 JSON.parse）', () => {
    const decoded = decodeFrames(clientFrame(0x1, new Uint8Array([0x41, 0xff, 0xfe])));
    expect(decoded.protocolError).toContain('UTF-8');
  });
});
