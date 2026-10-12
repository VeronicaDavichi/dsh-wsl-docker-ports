/**
 * 配置页的**一行表单**（002 T6.1；纯展示 + 受控回调，状态全在页面里）
 *
 * 拆出来的理由：`config-page.tsx` 要同时管加载 / 脏检查 / 确认 / 只读 / 冲突五件事，
 * 行编辑器只是它的一个纯函数式子件 —— 混在一起会让两件事都难读，也容易把
 * 「受控输入」写成「内部 state 与外部值不同步」。
 *
 * `data-testid` 逐字对齐 `specs/002-terminal-profiles/requirements.md` §2.2 的控件表：
 * `inp-profile-<field>` / `btn-profile-remove`（行内删除按钮由页面注入同一 testid 前缀）。
 */

import type { ReactElement } from 'react';

import { EDITABLE_FIELDS, FIELD_PLACEHOLDER, withField } from './config-row-model.ts';
import type { EditableField, EditableRow } from './config-row-model.ts';

export interface ConfigRowProps {
  readonly row: EditableRow;
  readonly index: number;
  /** 该行的错误（结构 / 转换；空数组 = 这一行没问题） */
  readonly problems: readonly string[];
  /**
   * 只读态（REQ-10.3）：`true` ⇒ 本行**不可编辑**（输入框与行内删除按钮都 `disabled`）。
   * 🔴 2026-10-12 缺陷 A：旧实现即使页面已判定只读，**表单看起来仍然完全可编辑**
   * （真机上用户先看到的是一张能随便填的表单）；锁住编辑控件才是「只读态」的一半。
   */
  readonly readOnly?: boolean | undefined;
  onChange(index: number, row: EditableRow): void;
  onRemove(index: number): void;
}

/** 单行只读展示用的字段顺序（与 `EDITABLE_FIELDS` 同序，防止两处走偏） */
const FIELD_LABEL: Readonly<Record<EditableField, string>> = {
  name: '名称',
  command: '命令',
  args: '参数',
  cwd: 'cwd',
  cwdLinux: 'cwdLinux',
  env: 'env',
};

export function ConfigRow({ row, index, problems, readOnly = false, onChange, onRemove }: ConfigRowProps): ReactElement {
  return (
    <div className="dtp-config-row" data-testid={`cfg-row-${index}`} data-row-index={index} data-readonly={readOnly ? 'true' : 'false'}>
      <div className="dtp-config-row-head">
        <span className="dtp-config-row-title">
          第 {index + 1} 条 profile
          {row.name.trim() === '' ? '' : `：${row.name}`}
        </span>
        <button
          type="button"
          className="dtp-config-remove"
          data-testid="btn-profile-remove"
          data-row-index={index}
          disabled={readOnly}
          onClick={() => {
            onRemove(index);
          }}
        >
          删除
        </button>
      </div>
      {EDITABLE_FIELDS.map((field) => (
        <label className="dtp-config-field" key={field}>
          <span className="dtp-config-label">{FIELD_LABEL[field]}</span>
          <input
            className="dtp-config-input"
            data-testid={`inp-profile-${field}`}
            data-row-index={index}
            placeholder={FIELD_PLACEHOLDER[field]}
            value={row[field]}
            disabled={readOnly}
            onChange={(event) => {
              onChange(index, withField(row, field, event.target.value));
            }}
          />
        </label>
      ))}
      {problems.length === 0 ? null : (
        <ul className="dtp-config-problems" data-testid={`cfg-row-error-${index}`}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
