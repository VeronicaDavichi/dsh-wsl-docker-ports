/**
 * fake `SessionManager`（002 Phase 3 测试基建）
 *
 * 手写的会话层替身（**不用** fake-pty：WS 层不碰 PTY）。它复刻的是 `read` 的三种返回面
 * （snapshot / incremental-hit / incremental-lost）与「下一号」游标语义 —— WS 层的续传、
 * 顶替与背压判据全部依赖这三条，替身把它们做成可脚本化（push / forceLostBelow / failNextRead）。
 */

import type { SessionFailureCode, TerminalInstanceSummary } from '../../src/session/types.ts';
import type { SessionManager } from '../../src/session/manager.ts';
import type { ScreenSnapshot } from '../../src/screen/screen-model.ts';

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ fake SessionManager */

export interface FakeManagerOptions {
  readonly rows?: number | undefined;
  readonly cols?: number | undefined;
}

export interface FakeManager {
  readonly session: SessionManager;
  add(id: string, options?: { profileName?: string; text?: string; rows?: number; cols?: number }): TerminalInstanceSummary;
  push(id: string, data: string): number;
  cursorOf(id: string): number;
  /** 让 `sinceSeq < seq` 的增量读报 `lost`（模拟有界缓冲丢弃，REQ-6.3） */
  forceLostBelow(id: string, seq: number): void;
  setExited(id: string, exited: boolean): void;
  failNextRead(code: SessionFailureCode, message: string): void;
  snapshotTextOf(id: string): string;
  readonly writeCalls: { id: string; data: string }[];
  readonly resizeCalls: { id: string; rows: number; cols: number }[];
  readonly readCalls: { id: string; mode: string; sinceSeq: number | undefined }[];
}

export function createFakeManager(options: FakeManagerOptions = {}): FakeManager {
  const rows = options.rows ?? 24;
  const cols = options.cols ?? 80;
  const instances = new Map<string, TerminalInstanceSummary>();
  const outputs = new Map<string, string[]>();
  const lostBelow = new Map<string, number>();
  let failure: { code: SessionFailureCode; message: string } | undefined;
  const writeCalls: { id: string; data: string }[] = [];
  const resizeCalls: { id: string; rows: number; cols: number }[] = [];
  const readCalls: { id: string; mode: string; sinceSeq: number | undefined }[] = [];

  const chunksOf = (id: string): string[] => outputs.get(id) ?? [];
  const snapshotText = (id: string): string => `${id} 屏幕内容 | ${chunksOf(id).join('')}`;
  const snapshotOf = (id: string): ScreenSnapshot => {
    const summary = instances.get(id);
    return {
      text: snapshotText(id),
      rows: summary?.rows ?? rows,
      cols: summary?.cols ?? cols,
      seq: chunksOf(id).length + 1,
      dropped: lostBelow.get(id) ?? 0,
    };
  };

  const syncSummary = (id: string): void => {
    const summary = instances.get(id);
    if (summary === undefined) return;
    instances.set(id, { ...summary, seq: chunksOf(id).length + 1, dropped: lostBelow.get(id) ?? 0 });
  };

  const manager: FakeManager = {
    session: {
      start: () => Promise.resolve({ ok: false, code: 'spawn-failed', message: '测试替身不启动实例' }),
      list: () => [...instances.values()],
      read: (id, readOptions) => {
        const mode = readOptions?.mode ?? 'snapshot';
        readCalls.push({ id, mode, sinceSeq: readOptions?.sinceSeq });
        if (failure !== undefined) {
          const current = failure;
          failure = undefined;
          return Promise.resolve({ ok: false, code: current.code, message: current.message });
        }
        if (!instances.has(id)) {
          return Promise.resolve({ ok: false, code: 'instance-not-found', message: `实例 ${id} 不在表里` });
        }
        if (mode === 'snapshot') {
          return Promise.resolve({ ok: true, value: { mode: 'snapshot', snapshot: snapshotOf(id) } });
        }
        const chunks = chunksOf(id);
        const nextSeq = chunks.length + 1;
        const oldest = (lostBelow.get(id) ?? 0) + 1;
        const requested = readOptions?.sinceSeq ?? oldest;
        if (requested < oldest) {
          return Promise.resolve({
            ok: true,
            value: {
              mode: 'incremental',
              lost: true,
              snapshot: snapshotOf(id),
              requestedSeq: requested,
              oldestSeq: oldest,
              dropped: lostBelow.get(id) ?? 0,
              seq: nextSeq,
            },
          });
        }
        const sliced = chunks.slice(requested - 1).map((data, index) => {
          const seq = requested + index;
          return { seq, data, bytes: encoder.encode(data).length };
        });
        return Promise.resolve({
          ok: true,
          value: { mode: 'incremental', lost: false, chunks: sliced, seq: nextSeq, dropped: lostBelow.get(id) ?? 0 },
        });
      },
      write: (id, data) => {
        writeCalls.push({ id, data });
        if (!instances.has(id)) {
          return Promise.resolve({ ok: false, code: 'instance-not-found', message: `实例 ${id} 不在表里` });
        }
        return Promise.resolve({ ok: true, value: { written: data.length } });
      },
      resize: (id, nextRows, nextCols) => {
        resizeCalls.push({ id, rows: nextRows, cols: nextCols });
        if (!instances.has(id)) {
          return Promise.resolve({ ok: false, code: 'instance-not-found', message: `实例 ${id} 不在表里` });
        }
        return Promise.resolve({ ok: true, value: { rows: nextRows, cols: nextCols } });
      },
      kill: (id) => {
        instances.delete(id);
        return Promise.resolve({ ok: true, value: { killed: true } });
      },
    },
    add(id, addOptions = {}): TerminalInstanceSummary {
      const summary: TerminalInstanceSummary = {
        id,
        profileName: addOptions.profileName ?? `${id}-profile`,
        rows: addOptions.rows ?? rows,
        cols: addOptions.cols ?? cols,
        seq: 1,
        dropped: 0,
        exited: false,
      };
      instances.set(id, summary);
      outputs.set(id, addOptions.text === undefined ? [] : [addOptions.text]);
      lostBelow.set(id, 0);
      syncSummary(id);
      return instances.get(id) as TerminalInstanceSummary;
    },
    push(id, data): number {
      const chunks = chunksOf(id);
      chunks.push(data);
      outputs.set(id, chunks);
      syncSummary(id);
      return chunks.length;
    },
    cursorOf: (id) => chunksOf(id).length + 1,
    forceLostBelow(id, seq): void {
      lostBelow.set(id, seq - 1);
      syncSummary(id);
    },
    setExited(id, exited): void {
      const summary = instances.get(id);
      if (summary !== undefined) instances.set(id, { ...summary, exited });
    },
    failNextRead(code, message): void {
      failure = { code, message };
    },
    snapshotTextOf: (id) => snapshotText(id),
    writeCalls,
    resizeCalls,
    readCalls,
  };
  return manager;
}
