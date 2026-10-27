/**
 * 右栏页头部（014 从 `pane.tsx` 拆出：`pane.tsx` 触到单文件 ≤ 400 行 SHALL，按职责拆）
 *
 * 职责边界：只画「刷新 / 上次刷新 / eth0 / 启动并核验」这一行，不持有任何状态；
 * 定时器与配置写回在 `use-auto-refresh.ts`，页面装配仍在 `pane.tsx`。
 *
 * 🔴 017（2026-10-27 主人拍板）：**自动刷新频次的下拉已从这里删除** —— 它搬到组合包级
 * 配置页（`plugins.bundle.config`，卡片页「描述与组件行之间」）。页头保留「刷新」按钮，
 * 自动刷新仍按配置里的值工作，只是不再在这里改。
 */

import type { ReactElement } from 'react';

import { TESTID } from './rows.ts';
import type { PortsPageView } from './types.ts';

export function PaneHeader(props: {
  readonly view: PortsPageView;
  readonly busy: boolean;
  readonly onRefresh: () => void;
  readonly onLaunch: () => void;
}): ReactElement {
  const { view, busy, onRefresh, onLaunch } = props;
  return (
    <div className="wdp-head">
      <button type="button" className="wdp-btn" data-testid={TESTID.refresh} disabled={busy} onClick={onRefresh}>
        刷新
      </button>
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
