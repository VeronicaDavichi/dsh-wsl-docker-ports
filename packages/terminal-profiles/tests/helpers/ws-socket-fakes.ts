/**
 * fake 裸 socket 与 fake 文本出口（002 Phase 3 测试基建）
 *
 * 两个层次各一个替身：字节层（`FakeSocket`：能喂半包、能模拟背压与 drain）与文本层
 * （`FakeSink`：绕开编解码专测协议语义）。零真机 —— 不建真实连接、不起监听端口。
 */

import { clientTextFrame, decodeServerFrames } from './ws-frames-fixture.ts';
import type { FrameSink, UpgradeSocketLike } from '../../src/ws/types.ts';

const decoder = new TextDecoder('utf-8');

/* ------------------------------------------------------------------ fake 裸 socket */

export interface FakeSocket extends UpgradeSocketLike {
  readonly written: Uint8Array[];
  destroyed: boolean;
  /** 背压开关：为 true 时 `write` 返回 false（模拟消费者暂停） */
  paused: boolean;
  bytes(): Uint8Array;
  /** HTTP 响应状态行里的状态码（未写过 HTTP 响应时 undefined） */
  responseStatus(): number | undefined;
  /** 非 101 响应的响应体 */
  responseBody(): string;
  /** 已写出的服务端文本帧（自动跳过 101/错误响应的 HTTP 头） */
  texts(): string[];
  /** `texts()` 的 JSON.parse 结果 */
  messages(): unknown[];
  /** 以**掩码**客户端帧喂入一条文本消息（模拟浏览器发帧） */
  sendText(text: string): void;
  emitData(chunk: Uint8Array): void;
  /** 模拟内核缓冲排空（宿主应把 `drain` 转发给通道层的 `conn.drain()`） */
  emitDrain(): void;
  emitClose(): void;
  clearWritten(): void;
}

export function createFakeSocket(): FakeSocket {
  const written: Uint8Array[] = [];
  const dataListeners: ((chunk: unknown) => void)[] = [];
  const closeListeners: (() => void)[] = [];
  const errorListeners: ((error: unknown) => void)[] = [];
  const drainListeners: (() => void)[] = [];

  const concat = (parts: readonly Uint8Array[]): Uint8Array => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      merged.set(part, at);
      at += part.length;
    }
    return merged;
  };

  // 握手头一旦写全就**记住**状态码，并把其后字节单独累积：
  // 这样 `clearWritten()`（测试常在握手后清屏再断言帧）不会把「这是 101 通道」这个事实一起清掉。
  const headParts: Uint8Array[] = [];
  const bodyParts: Uint8Array[] = [];
  let status: number | undefined;

  const feed = (chunk: Uint8Array): void => {
    if (status !== undefined) {
      bodyParts.push(chunk);
      return;
    }
    headParts.push(chunk);
    const all = concat(headParts);
    let end = -1;
    for (let index = 0; index + 3 < all.length; index += 1) {
      if (all[index] === 0x0d && all[index + 1] === 0x0a && all[index + 2] === 0x0d && all[index + 3] === 0x0a) {
        end = index;
        break;
      }
    }
    if (end < 0) return;
    // 头是 ASCII；响应体/帧按**字节**切片，避免 UTF-8 解码破坏二进制帧
    const match = /^HTTP\/1\.1 (\d{3})/.exec(decoder.decode(all.subarray(0, end)));
    status = match?.[1] === undefined ? 0 : Number(match[1]);
    const leftover = all.subarray(end + 4);
    if (leftover.length > 0) bodyParts.push(leftover);
  };

  function on(event: 'data', listener: (chunk: unknown) => void): unknown;
  function on(event: 'drain', listener: () => void): unknown;
  function on(event: 'close', listener: () => void): unknown;
  function on(event: 'error', listener: (error: unknown) => void): unknown;
  function on(event: string, listener: unknown): unknown {
    if (event === 'data') dataListeners.push(listener as (chunk: unknown) => void);
    else if (event === 'drain') drainListeners.push(listener as () => void);
    else if (event === 'close') closeListeners.push(listener as () => void);
    else if (event === 'error') errorListeners.push(listener as (error: unknown) => void);
    return socket;
  }

  const socket: FakeSocket = {
    written,
    destroyed: false,
    paused: false,
    write(chunk: Uint8Array): boolean {
      written.push(chunk);
      feed(chunk);
      return !socket.paused;
    },
    destroy(): void {
      socket.destroyed = true;
    },
    on,
    bytes: () => concat(written),
    responseStatus(): number | undefined {
      return status === 0 ? undefined : status;
    },
    responseBody(): string {
      return decoder.decode(concat(bodyParts));
    },
    texts(): string[] {
      if (status !== 101) return [];
      return decodeServerFrames(concat(bodyParts)).messages;
    },
    messages(): unknown[] {
      return socket.texts().map((text) => JSON.parse(text) as unknown);
    },
    sendText(text: string): void {
      socket.emitData(clientTextFrame(text));
    },
    emitData(chunk: Uint8Array): void {
      for (const listener of dataListeners) listener(chunk);
    },
    emitDrain(): void {
      for (const listener of drainListeners) listener();
    },
    emitClose(): void {
      for (const listener of closeListeners) listener();
    },
    clearWritten(): void {
      written.length = 0;
    },
  };
  return socket;
}
/* ------------------------------------------------------------------ fake 文本出口 */

export interface FakeSink extends FrameSink {
  readonly written: string[];
  destroyed: boolean;
  /** 背压开关：为 true 时 `write` 返回 false（模拟消费者暂停） */
  paused: boolean;
  messages(): unknown[];
  clear(): void;
}

/** 通道核心的出口替身（文本帧面）：绕开字节编解码，专测协议语义 */
export function createFakeSink(): FakeSink {
  const written: string[] = [];
  const sink: FakeSink = {
    written,
    destroyed: false,
    paused: false,
    write(text: string): boolean {
      written.push(text);
      return !sink.paused;
    },
    destroy(): void {
      sink.destroyed = true;
    },
    messages: () => written.map((text) => JSON.parse(text) as unknown),
    clear: () => {
      written.length = 0;
    },
  };
  return sink;
}
