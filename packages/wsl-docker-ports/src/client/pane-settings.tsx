/**
 * 配置类与下一期区域（003 T5.3 / T5.5 / T5.7）：端口声明表单 / 提权策略 / exec 注入点 / 原始输出
 *
 * ## 为什么这几块单独一个文件
 *
 * 它们**都只写配置**（`managedPorts` / `elevationPolicy`），与 `pane-tables.tsx` 的只读展示
 * 是两类东西：一个错误的改动方向是「顺手在这里调提权」——拆开后，本文件的入参里
 * **只有** `settings` 侧回调，没有任何写规则/提权的入口。
 *
 * 提权策略下拉**刻意不被 NAT 门或策略自身置灰**：`none` 若把 `sel-elevation` 也锁死，
 * 用户就永远回不到 `ask`（死锁）；「全部写控件置灰」的对象是**转发写控件**（REQ-1.1）。
 */

import { useState, type ReactElement } from 'react';

import { TESTID } from './rows.ts';
import type { ElevationPolicyValue } from './settings-pipe.ts';
import type { ExecControlView, ManagedPortsFormView, DockerView, PortsPageView } from './types.ts';

export function ManagedPortsBlock(props: {
  readonly form: ManagedPortsFormView;
  readonly draft: string;
  readonly checked: readonly string[];
  readonly onDraft: (value: string) => void;
  readonly onToggle: (name: string, on: boolean) => void;
  readonly onSave: () => void;
}): ReactElement {
  const { form, draft, checked, onDraft, onToggle, onSave } = props;
  return (
    <section className="wdp-card">
      <h3>端口声明（managedPorts）</h3>
      <div className="wdp-field">
        <label htmlFor={TESTID.managedPortsInput}>端口或区间（每行一项，如 3306 或 1000-3000）</label>
        <textarea
          id={TESTID.managedPortsInput}
          className="wdp-pre"
          data-testid={TESTID.managedPortsInput}
          data-write-control="1"
          rows={3}
          value={draft}
          disabled={!form.enabled}
          title={form.disabledReason ?? ''}
          onChange={(event) => onDraft(event.target.value)}
        />
      </div>
      {form.issues.length > 0 ? (
        <ul className="wdp-list wdp-error">
          {form.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <div className="wdp-grid">
        {form.presets.map((preset) => (
          <label key={preset.name}>
            <input
              type="checkbox"
              data-testid={preset.testId}
              data-write-control="1"
              disabled={!form.enabled}
              checked={checked.includes(preset.name)}
              onChange={(event) => onToggle(preset.name, event.target.checked)}
            />{' '}
            {preset.label}（{preset.port}）
          </label>
        ))}
      </div>
      <button
        type="button"
        className="wdp-btn wdp-btn-primary"
        data-testid={TESTID.managedPortsSave}
        data-write-control="1"
        disabled={!form.enabled}
        title={form.disabledReason ?? ''}
        onClick={onSave}
      >
        保存声明（只改配置）
      </button>
    </section>
  );
}

export function ElevationBlock(props: {
  readonly elevation: PortsPageView['elevation'];
  readonly onChange: (policy: ElevationPolicyValue) => void;
}): ReactElement {
  const { elevation, onChange } = props;
  return (
    <section className="wdp-card">
      <h3>提权策略</h3>
      <select
        className="wdp-btn"
        data-testid={TESTID.elevation}
        data-settings-control="1"
        disabled={!elevation.enabled}
        value={elevation.value}
        onChange={(event) => onChange(event.target.value as ElevationPolicyValue)}
      >
        {elevation.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="wdp-muted">{elevation.note}</p>
    </section>
  );
}

/** exec 注入点（REQ-10.1/10.3/10.4）：**恒禁用**，只解释原因；002 缺失也不报错。 */
export function NextPhaseBlock({ exec }: { readonly exec: ExecControlView }): ReactElement {
  return (
    <section className="wdp-card">
      <h3>下一期</h3>
      <button type="button" className="wdp-btn" data-testid={TESTID.exec} data-write-control="1" disabled title={exec.reason}>
        {exec.label}
      </button>
      <p className="wdp-muted">{exec.reason}</p>
    </section>
  );
}

/** 原始输出（REQ-3.5）：**只**展示脱敏后的读侧原文，不提供任何解析/执行入口 */
export function RawOutputBlock({ docker }: { readonly docker: DockerView }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <section className="wdp-card">
      <button type="button" className="wdp-btn" data-testid={TESTID.rawOutput} onClick={() => setOpen((value) => !value)}>
        {open ? '收起原始输出' : '查看原始输出'}
      </button>
      {open && !docker.ok && docker.raw !== null ? (
        <pre className="wdp-pre" data-testid="raw-output-body">
          {docker.raw}
        </pre>
      ) : null}
    </section>
  );
}
