/**
 * 右栏页头部（014 从 `pane.tsx` 拆出：`pane.tsx` 触到单文件 ≤ 400 行 SHALL，按职责拆）
 *
 * 职责边界：只画「刷新 / 自动刷新频次 / 上次刷新 / eth0 / 启动并核验」这一行，不持有任何状态；
 * 定时器与配置写回在 `use-auto-refresh.ts`，页面装配仍在 `pane.tsx`。
 */

import type { ReactElement } from 'react';

import { REFRESH_INTERVAL_OPTIONS } from './refresh.ts';
import { TESTID } from './rows.ts';
import type { PortsPageView } from './types.ts';

export function RefreshIntervalSelect(props: { readonly value: number; readonly onChange: (sec: number) => void }): ReactElement {
  return (
    <select
      data-testid="sel-refresh-interval"
      aria-label="自动刷新频次"
      value={String(props.value)}
      onChange={(event) => props.onChange(Number(event.target.value))}
    >
      {REFRESH_INTERVAL_OPTIONS.map((option) => (
        <option key={option.value} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function PaneHeader(props: {
  readonly view: PortsPageView;
  readonly busy: boolean;
  readonly onRefresh: () => void;
  readonly onLaunch: () => void;
  readonly refreshIntervalSec: number;
  readonly onInterval: (sec: number) => void;
}): ReactElement {
  const { view, busy, onRefresh, onLaunch, refreshIntervalSec, onInterval } = props;
  return (
    <div className="wdp-head">
      <button type="button" className="wdp-btn" data-testid={TESTID.refresh} disabled={busy} onClick={onRefresh}>
        刷新
      </button>
      {/* 014：自动刷新频次（与「刷新」并排；选择即生效 + 落盘） */}
      <RefreshIntervalSelect value={refreshIntervalSec} onChange={onInterval} />
      <span className="wdp-muted">
        上次刷新：<span data-testid="last-refreshed">{view.refreshedAtText}</span>
      </span>
      <span className="wdp-muted">eth0：{view.eth0.text}</span>
      {!view.eth0.known ? (
        <button type="button" className="wdp-btn" data-testid={view.eth0.launchTestId} title={view.eth0.launchNote} onClick={onLaunch}>
          启动并核验
        </button>
      ) : null}
    </div>
  );
}
