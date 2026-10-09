/**
 * Host 屏幕模型（002 REQ-6.1 / REQ-6.2 / REQ-6.5 / 任务 T2.3–T2.5）
 *
 * ## 快照与增量**同源**（design §2.2）
 *
 * PTY 输出 → `headless.write(data)` → serializer 出快照；同一份 `data` 分片进有界缓冲当增量块。
 * 这样 TUI 重绘（清屏、光标跳转）后**快照仍然正确**，而增量保持低延迟。若反过来靠重放增量拼快照，
 * 一旦缓冲丢过块，屏幕就永久错位。
 *
 * ## 三条容易被误读的事实（2026-10-09 离线实测，`@xterm/headless` 6.0.0 + `addon-serialize` 0.14.0）
 *
 * ① 🔴 serializer **不传 `scrollback` 时会吐出全部 scrollback** ⇒ 快照大小随会话时长线性增长。
 *    REQ-6.2 要的是「有界尾部」⇒ 本模块**永远显式**传 `scrollback`（默认见 `../limits.ts`）。
 * ② serializer 产出的是**可回放的转义序列**（颜色/光标位置都在里面），不是纯文本 —— 这是刻意的：
 *    design §2.2 指定 serializer，客户端要能用它 `term.reset()` + `write(snapshot)` 重建画面。
 *    因此 `text` 里出现 `\u001b[…` 是**预期**，不是脏数据；想要纯文本的消费方自己剥（本包不剥，
 *    剥了就没法重建画面了）。
 * ③ `Terminal.resize` 与宿主 handle 的 `resize` **都是 `(cols, rows)` 列在前** ⇒ 本模块对外的
 *    `resize` 只接受 `TerminalSize` 对象，从签名上消灭「行在前还是列在前」这个问题。
 *
 * ## 只读性（REQ-6.5 / REQ-5.4）
 *
 * `snapshot` / `incremental` **只读**：不写 `headless`、不写 PTY、不改尺寸。本文件里根本没有
 * 「往 PTY 写」的路径 —— 读路径能注入输入的唯一方式就是绕过本模块，所以它在结构上不成立。
 */

import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';

import {
  TERM_SCREEN_SCROLLBACK_LINES,
  TERM_SNAPSHOT_SCROLLBACK_LINES,
  clampInt,
  TERM_SNAPSHOT_SCROLLBACK_MAX,
} from '../limits.ts';
import type { TerminalSize } from '../limits.ts';
import { createTermBuffer } from './buffer.ts';
import type { TermBuffer, TermChunk } from './buffer.ts';

/** 尺寸别名（002 的公开面用 `ScreenSize`；004/003 从 `./screen-model.ts` 拿） */
export type ScreenSize = TerminalSize;

/** 屏幕快照（REQ-6.2）：文本 + 尺寸 + 序号 + 丢弃计数（后两者让消费方能判断「这份快照完不完整」） */
export interface ScreenSnapshot {
  /** serializer 产出（**含**转义序列，见文件头 ②） */
  readonly text: string;
  readonly rows: number;
  readonly cols: number;
  /** 产出该快照时的下一号；消费方拿它作为后续 `sinceSeq`，不会重复也不会漏 */
  readonly seq: number;
  readonly dropped: number;
}

/** 增量仍在：`chunks` 可为空（= 没有新输出） */
export interface ScreenIncrementalHit {
  readonly lost: false;
  readonly chunks: readonly TermChunk[];
  readonly seq: number;
  readonly dropped: number;
}

/** 增量已丢：**附快照**（REQ-6.3「明确返回已丢失并附快照，SHALL NOT 静默丢块」） */
export interface ScreenIncrementalLost {
  readonly lost: true;
  readonly snapshot: ScreenSnapshot;
  readonly requestedSeq: number;
  readonly oldestSeq: number;
  readonly dropped: number;
  /**
   * 下一号（与 `snapshot.seq` 同值）。
   *
   * ⚠️ 这条**必须**和 `ScreenIncrementalHit.seq` 同时存在：否则消费方「`seq = read.seq`」的统一推进
   * 写法会在丢失那一次拿不到值，于是要么崩、要么退回用 `snapshot.seq` —— 两套写法迟早漂移。
   */
  readonly seq: number;
}

export type ScreenIncremental = ScreenIncrementalHit | ScreenIncrementalLost;

export interface ScreenModel {
  /** 吸收一段 PTY 输出（先入增量缓冲、再喂 headless；回调后才 resolve ⇒ 快照立即可见） */
  write(data: string): Promise<void>;
  snapshot(scrollbackLines?: number): ScreenSnapshot;
  incremental(sinceSeq?: number): ScreenIncremental;
  resize(size: ScreenSize): void;
  size(): ScreenSize;
  readonly seq: number;
  readonly dropped: number;
  dispose(): void;
}

export interface ScreenModelOptions {
  /** xterm 的 scrollback 容量（行）；测试可压小以便复现尾部截断 */
  readonly scrollbackLines?: number;
  /** 注入增量缓冲（测试用小上限复现丢弃；生产用 `../limits.ts` 的命名常量） */
  readonly buffer?: TermBuffer;
}

/** 建一个实例的屏幕模型。`rows/cols` **必须**来自夹紧后的 `TerminalSize`（xterm 同样不夹紧） */
export function createScreenModel(size: ScreenSize, options: ScreenModelOptions = {}): ScreenModel {
  const buffer = options.buffer ?? createTermBuffer();
  const terminal = new Terminal({
    rows: size.rows,
    cols: size.cols,
    scrollback: options.scrollbackLines ?? TERM_SCREEN_SCROLLBACK_LINES,
    // serializer 走的是 addon 通道：开着 proposed API 只是「允许」，不改任何默认行为
    allowProposedApi: true,
  });
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);
  let disposed = false;

  const snapshot = (scrollbackLines?: number): ScreenSnapshot => {
    // 🔴 永远显式传 scrollback（文件头 ①）：不传 = 无界尾部
    const lines = clampInt(scrollbackLines ?? TERM_SNAPSHOT_SCROLLBACK_LINES, 0, TERM_SNAPSHOT_SCROLLBACK_MAX);
    return {
      text: serializer.serialize({ scrollback: lines }),
      rows: terminal.rows,
      cols: terminal.cols,
      seq: buffer.nextSeq,
      dropped: buffer.dropped,
    };
  };

  return {
    async write(data) {
      if (disposed) throw new Error('屏幕模型已释放：不能再吸收输出');
      const chunk = buffer.push(data);
      if (chunk === undefined) return; // 空串：不入块也不喂 headless
      await new Promise<void>((resolve) => {
        terminal.write(data, resolve);
      });
    },

    snapshot,

    incremental(sinceSeq) {
      const read = buffer.read(sinceSeq);
      if (!read.lost) {
        return { lost: false, chunks: read.chunks, seq: read.nextSeq, dropped: read.dropped };
      }
      // 已丢失 ⇒ 必须附快照（REQ-6.3）；快照是只读操作，不影响任何状态
      const lost: ScreenSnapshot = snapshot();
      return {
        lost: true,
        snapshot: lost,
        requestedSeq: read.requestedSeq,
        oldestSeq: read.oldestSeq,
        dropped: read.dropped,
        seq: lost.seq,
      };
    },

    resize(next) {
      if (disposed) return;
      // xterm 的 resize 也是 (cols, rows)：这里只有一处位置参数调用，且用的是对象的字段名
      terminal.resize(next.cols, next.rows);
    },

    size() {
      return { rows: terminal.rows, cols: terminal.cols };
    },

    get seq() {
      return buffer.nextSeq;
    },

    get dropped() {
      return buffer.dropped;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // 只调 `terminal.dispose()`：它经 AddonManager 一并释放 serializer（xterm 6.0.0 源码
      // `loadAddon` → `_addonManager.loadAddon`，而 `_addonManager` 是 `_register` 的子项）。
      // 再手动 `serializer.dispose()` 是重复释放，虽然 xterm 的 DisposableStore 幂等、不会炸，
      // 但「谁拥有谁释放」只有一个答案更不容易在未来漂移。
      terminal.dispose();
    },
  };
}
