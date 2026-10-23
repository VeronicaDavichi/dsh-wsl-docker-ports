/**
 * 014：右栏页的「拉取 + 自动轮询」状态机（从 `pane.tsx` 拆出：后者触到 400 行 SHALL）
 *
 * 只做数据面，不画任何控件：
 * - 手动 `refresh()`：**总是**重建视图（`refreshedAt` 变了，「上次刷新」文案就要更新）；
 * - 自动 `poll()`：忽略 `refreshedAt` 后数据不变 ⇒ **不 setState**（因此不重绘）；
 * - 频次：挂载读一次、选择即写一次（经既有 `settings` 管道）、按秒起定时器，卸载清干净。
 *
 * 失败口径：轮询失败沿用既有 `读取失败：…` 展示，**不清空**既有 `view`，定时器继续重试。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientRuntime } from './host.ts';
import { buildPortsPageView } from './page.ts';
import { normalizeRefreshIntervalSec, sameSnapshotPayload } from './refresh.ts';
import type { LastWriteView, PortsPageView, PortsSnapshot } from './types.ts';

export interface AutoRefresh {
  readonly view: PortsPageView | null;
  readonly loadError: string | null;
  readonly busy: boolean;
  readonly refreshIntervalSec: number;
  readonly refresh: (allowColdStart: boolean, previous: LastWriteView | null) => Promise<void>;
  readonly changeRefreshInterval: (sec: number) => Promise<void>;
}

export function useAutoRefresh(
  runtime: ClientRuntime,
  autoLoad: boolean,
  setActionError: (message: string | null) => void,
): AutoRefresh {
  const [view, setView] = useState<PortsPageView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 014：自动刷新频次（秒；`0` = 关闭）。初值关闭，挂载后由 `readConfig()` 回填。 */
  const [refreshIntervalSec, setRefreshIntervalSec] = useState(0);
  /** 轮询判据用的**上一份原始快照**（不含视图派生，`refreshedAt` 比较时剔除） */
  const lastSnapshotRef = useRef<PortsSnapshot | null>(null);
  /** 轮询重建视图时要带上的「最近一次写操作」（用 ref 避免把它变成定时器的重建依赖） */
  const lastWriteRef = useRef<LastWriteView | null>(null);
  /** 既有错误展示的当前值（便于轮询在「无错误」时不 setState） */
  const loadErrorRef = useRef<string | null>(null);

  const refresh = useCallback(
    async (allowColdStart: boolean, previous: LastWriteView | null): Promise<void> => {
      setBusy(true);
      setLoadError(null);
      loadErrorRef.current = null;
      lastWriteRef.current = previous;
      try {
        const snapshot: PortsSnapshot = await runtime.source.load(allowColdStart ? { allowColdStart: true } : undefined);
        lastSnapshotRef.current = snapshot;
        setView(buildPortsPageView(snapshot, { lastWrite: previous }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loadErrorRef.current = message;
        setLoadError(message);
      } finally {
        setBusy(false);
      }
    },
    [runtime],
  );

  /**
   * 014：**自动轮询**（只在 `refreshIntervalSec > 0` 时被定时器调用）。
   *
   * 🔴 与手动「刷新」的差别只有一处：**数据无变化就不 setState** ——
   * 忽略 `refreshedAt` 后与上一份原始快照逐字段相等 ⇒ 直接 return（连 `busy` 都不碰）。
   * 失败时沿用既有 `读取失败：…` 展示，**不清空**既有内容，定时器继续按频次重试。
   */
  const poll = useCallback(async (): Promise<void> => {
    try {
      const snapshot: PortsSnapshot = await runtime.source.load();
      const previousSnapshot = lastSnapshotRef.current;
      if (previousSnapshot !== null && sameSnapshotPayload(previousSnapshot, snapshot)) {
        if (loadErrorRef.current !== null) {
          loadErrorRef.current = null;
          setLoadError(null);
        }
        return;
      }
      lastSnapshotRef.current = snapshot;
      setView(buildPortsPageView(snapshot, { lastWrite: lastWriteRef.current }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (loadErrorRef.current !== message) {
        loadErrorRef.current = message;
        setLoadError(message);
      }
    }
  }, [runtime]);

  // 开页：两条**只读**副作用 —— ① 拉一次快照（NFR-2：不写配置、不调提权）；
  // ② 014 读一次刷新频次回填选择器（读不是写；失败保持「关闭」）。
  useEffect(() => {
    if (!autoLoad) return;
    void refresh(false, null);
  }, [autoLoad, refresh]);

  useEffect(() => {
    const settings = runtime.settings;
    if (settings === undefined) return;
    let alive = true;
    void settings
      .readConfig()
      .then((config) => {
        if (alive) setRefreshIntervalSec(normalizeRefreshIntervalSec(config.refreshIntervalSec));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [runtime]);

  // 014：按频次起定时器；`0`（关闭）不起。卸载/改档时清理 —— 不留下无主定时器。
  useEffect(() => {
    if (refreshIntervalSec <= 0) return;
    const timer = setInterval(() => {
      void poll();
    }, refreshIntervalSec * 1000);
    return () => clearInterval(timer);
  }, [refreshIntervalSec, poll]);

  /** 014：选择器改档 = 立即生效（state 驱动定时器）+ 落盘（既有 live 写管道）。 */
  const changeRefreshInterval = async (sec: number): Promise<void> => {
    setRefreshIntervalSec(sec);
    const settings = runtime.settings;
    if (settings === undefined) {
      setActionError('配置写回管道未接线（remote.settings 缺失）：本会话频次已生效，但未落盘。');
      return;
    }
    try {
      const result = await settings.writeRefreshInterval(sec);
      setActionError(result.ok ? null : result.message);
    } catch (error) {
      setActionError(`配置写入抛出异常：${error instanceof Error ? error.message : String(error)}（未改动任何配置，且不重试）`);
    }
  };

  return { view, loadError, busy, refreshIntervalSec, refresh, changeRefreshInterval };
}
