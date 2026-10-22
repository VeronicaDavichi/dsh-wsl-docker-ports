/**
 * 「监听地址」单元格（012 REQ-1.1 / REQ-2.1）—— **懒加载 chunk** 内
 *
 * 从 `pane-tables.tsx` 拆出来的唯一理由：那个文件已到 400 行的 SHALL 上限（拆前 414），
 * 而本控件与作用域下拉是同族「逐端口写控件」，拆到独立文件后两者可以各自演进。
 *
 * ## 三条渲染判据
 *
 * 1. **只在生效作用域是 `lan` 时出现**：`loopback` 恒 `127.0.0.1`，没有「用哪块网卡」的自由度；
 *    「生效作用域」= 草稿值优先（用户刚改了作用域还没刷新页面时，控件要当场出现/消失）。
 * 2. **缺省值恒 `0.0.0.0`**（决策 2）：草稿没有记录时回落到视图值（视图值也恒是默认项）。
 * 3. **读失败只降级这一栏**（REQ-2.1）：`note` 非空时显示原因文案（`data-testid="listen-address-note"`），
 *    控件照常存在但只剩默认项 —— 「读不到」绝不渲染成「没有网卡」。
 */

import type { ReactElement } from 'react';

import type { ListenAddressControlView } from './types.ts';

export function ListenAddressCell(props: {
  readonly control: ListenAddressControlView;
  /** 生效作用域（草稿优先；由调用方算好，免得两处各解释一遍） */
  readonly scope: string;
  /** 当前草稿值（可能没有 ⇒ 回落到 `control.value`） */
  readonly draft: string | undefined;
  readonly onChange: (address: string) => void;
}): ReactElement | null {
  const { control, scope, draft, onChange } = props;
  if (scope !== 'lan') return null;
  return (
    <label className="wdp-listen">
      <span className="wdp-muted">监听地址</span>
      <select
        className="wdp-btn"
        data-testid={control.testId}
        data-write-control="1"
        aria-label={`监听地址（端口 ${String(control.port)}）`}
        value={draft ?? control.value}
        disabled={!control.enabled}
        title={control.disabledReason ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {control.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {control.note === null ? null : (
        <span className="wdp-muted" data-testid="listen-address-note">
          {control.note}
        </span>
      )}
    </label>
  );
}
