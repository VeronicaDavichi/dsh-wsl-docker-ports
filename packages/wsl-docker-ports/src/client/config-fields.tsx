/**
 * 017：配置页的段落件（从 `config-page.tsx` 拆出来，只为一件事 —— 单文件 ≤ 400 行 SHALL）。
 *
 * 版式照抄宿主插件设置表单（`@deepseek-ai/dsh-client-ui-primitives` 的
 * `lib/settings-form/fields.module.css`）：一个 field = 标签行 + 控件 + 说明，
 * 相邻 field 之间靠 CSS 的 `.wdp-cfg-field + .wdp-cfg-field` 画 0.5px 分隔线。
 *
 * 这里**只放排版**，不碰草稿/脏判定/写路径 —— 那些仍在 `config-page.tsx`，
 * 因为这些段落件要能被单测直接渲染而不需要 settings 管道。
 */

import type { ReactElement, ReactNode } from 'react';

export interface ConfigFieldProps {
  /** 字段名（`<label>` 文本；只用 `<span>` 时传 `htmlFor === undefined`） */
  readonly label: string;
  /** 右侧小字（「两个组件共用」这类） */
  readonly tag?: string | undefined;
  /** 关联控件 id；省略 = 标题不是 `<label>`（只读段） */
  readonly htmlFor?: string | undefined;
  /** 控件下方的说明文字 */
  readonly hint: ReactNode;
  readonly children: ReactNode;
}

/** 一个设置字段：标签行（可带小字）+ 控件 + 说明 */
export function ConfigField(props: ConfigFieldProps): ReactElement {
  const { label, tag, htmlFor, hint, children } = props;
  return (
    <div className="wdp-cfg-field">
      <div className="wdp-cfg-head">
        {htmlFor === undefined ? (
          <span className="wdp-cfg-label">{label}</span>
        ) : (
          <label className="wdp-cfg-label" htmlFor={htmlFor}>
            {label}
          </label>
        )}
        {tag === undefined ? null : <span className="wdp-cfg-tag">{tag}</span>}
      </div>
      {children}
      <p className="wdp-cfg-hint">{hint}</p>
    </div>
  );
}

export interface ConfigSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface ConfigSelectProps {
  readonly id: string;
  readonly testId: string;
  readonly label?: string | undefined;
  readonly tag?: string | undefined;
  readonly hint: ReactNode;
  readonly value: string;
  readonly options: readonly ConfigSelectOption[];
  readonly disabled: boolean;
  readonly onChange: (next: string) => void;
}

/** 下拉字段：宿主表单里 `.input` 那套外观（高 34 / radius-md / bg-layer-3） */
export function ConfigSelect(props: ConfigSelectProps): ReactElement {
  const { id, testId, label, tag, hint, value, options, disabled, onChange } = props;
  return (
    <ConfigField label={label ?? ''} tag={tag} htmlFor={id} hint={hint}>
      <select
        id={id}
        className="wdp-input"
        data-testid={testId}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </ConfigField>
  );
}

export interface ConfirmCalloutProps {
  /** 待确认的那句话（由页面拼好，含目标档位） */
  readonly text: string;
  readonly busy: boolean;
  readonly confirmTestId: string;
  readonly cancelTestId: string;
  readonly panelTestId: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** 提权档的两段式确认条（`REQ-12.4`：未点确认前零写入，所以它必须是一块独立区域） */
export function ConfirmCallout(props: ConfirmCalloutProps): ReactElement {
  const { text, busy, confirmTestId, cancelTestId, panelTestId, onConfirm, onCancel } = props;
  return (
    <div className="wdp-cfg-callout" data-testid={panelTestId}>
      <p className="wdp-cfg-callout-text">{text}</p>
      <div className="wdp-cfg-callout-actions">
        <button type="button" className="wdp-save" data-testid={confirmTestId} disabled={busy} onClick={onConfirm}>
          确认保存
        </button>
        <button type="button" className="wdp-textbtn" data-testid={cancelTestId} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

export interface ScopeRow {
  readonly port: string;
  readonly scope: string;
}

export interface ScopeFieldProps {
  readonly rows: readonly ScopeRow[];
  readonly hint: string;
  readonly emptyText: string;
  readonly busy: boolean;
  readonly scopeTestId: string;
  readonly refreshTestId: string;
  readonly onRefresh: () => void;
}

/** 端口作用域：只读列表 + 「重新读取」（写入口在右栏页的端口表里，这里是唯一一处只读复述） */
export function ScopeField(props: ScopeFieldProps): ReactElement {
  const { rows, hint, emptyText, busy, scopeTestId, refreshTestId, onRefresh } = props;
  return (
    <div className="wdp-cfg-field">
      <div className="wdp-cfg-head">
        <span className="wdp-cfg-label">端口作用域</span>
        <span className="wdp-cfg-tag">只读</span>
      </div>
      <p className="wdp-cfg-hint" data-testid={scopeTestId}>
        {hint}
      </p>
      {rows.length === 0 ? (
        <p className="wdp-cfg-hint">{emptyText}</p>
      ) : (
        <ul className="wdp-cfg-scopes">
          {rows.map((row) => (
            <li key={row.port}>
              <span className="wdp-cfg-scope-port">{row.port}</span>
              <span className="wdp-cfg-scope-value">{row.scope}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="wdp-cfg-inline">
        <button type="button" className="wdp-textbtn" data-testid={refreshTestId} disabled={busy} onClick={onRefresh}>
          重新读取
        </button>
      </div>
    </div>
  );
}
