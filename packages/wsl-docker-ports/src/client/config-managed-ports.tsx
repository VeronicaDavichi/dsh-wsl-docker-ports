/**
 * 卡片页配置里的「端口声明（managedPorts）」编辑块（本轮从右栏页搬上来）。
 *
 * ## 为什么搬家
 *
 * 主人原话：「端口声明（managedPorts） 放到插件页面的配置里，展示放在外面容器的侧边栏里」⇒
 * **写入口单点**在配置页（和提权档 / 刷新频次 / 目标发行版一起，共用底部那一个「保存设置」），
 * 右栏页只做**只读展示**（那里本来就挨着端口表，看得到「声明了什么」最有用）。
 *
 * ## 语义没变
 *
 * - 区间原文（**半角逗号分隔**，2026-10-27 主人拍板；读入侧仍兼容换行）+ presets 勾选 →
 *   `mergeManagedPortsDecl` 合成**同一个** `managedPorts` 数组（REQ-16.4：不另建存储）；
 * - 勾选本身**零写入**（REQ-16.4），只有点「保存设置」才发一次配置写；
 * - 非法项**原样留在输入里**并就地报原因（REQ-16.1），不静默丢弃。
 */

import type { ReactElement } from 'react';

export interface ManagedPortPresetView {
  readonly name: string;
  readonly label: string;
  readonly port: number;
  readonly checked: boolean;
}

/** 输入框占位符：把「半角逗号分隔」这件事直接示范出来，不用读提示语 */
const PLACEHOLDER = '3306, 5432, 1000-3000';

export interface ManagedPortsFieldProps {
  /** 区间原文（半角逗号分隔的单行文本） */
  readonly text: string;
  readonly presets: readonly ManagedPortPresetView[];
  /** 解析出来的非法项原因（空数组 = 合法） */
  readonly issues: readonly string[];
  readonly disabled: boolean;
  readonly onChangeText: (next: string) => void;
  readonly onTogglePreset: (name: string, on: boolean) => void;
}

/**
 * 端口声明编辑块。**不自绘标题**：外层由 `ConfigField` 给标签行（与宿主插件设置表单同款），
 * 这里只负责控件本体（区间原文 + presets + 非法原因）。
 */
export function ManagedPortsField(props: ManagedPortsFieldProps): ReactElement {
  const { text, presets, issues, disabled, onChangeText, onTogglePreset } = props;
  return (
    <div className="wdp-cfg-field">
      <div className="wdp-cfg-head">
        <label className="wdp-cfg-label" htmlFor="config-managed-ports">
          端口声明（managedPorts）
        </label>
        <span className="wdp-cfg-tag">只写配置，不写规则</span>
      </div>
      <label className="wdp-cfg-sublabel" htmlFor="config-managed-ports">
        端口或区间，用半角逗号分隔（如 3306, 5432, 1000-3000）；从别处粘贴「每行一项」的旧文本会自动转成逗号
      </label>
      {/* 单行 input 而不是 textarea：既然分隔符是逗号，「每行一项」的形态会把人往错处带（主人 2026-10-27） */}
      <input
        id="config-managed-ports"
        type="text"
        className="wdp-input wdp-cfg-input-plain"
        data-testid="config-managed-ports"
        placeholder={PLACEHOLDER}
        spellCheck={false}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          onChangeText(event.target.value);
        }}
        onPaste={(event) => {
          // 单行 input 的浏览器行为会**吃掉换行**（`3306\n1000-3000` 变成 `33061000-3000`）
          // ⇒ 粘贴里带换行 / 全角逗号 / 顿号时，先转成「半角逗号 + 空格」再落值。
          // 这样「旧的每行一项」照样粘得进来，而输入框本身坚持单行形态。
          const raw = event.clipboardData?.getData('text') ?? '';
          if (!/[\r\n，、]/u.test(raw)) return;
          event.preventDefault();
          const target = event.currentTarget;
          const at = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? at;
          const before = target.value.slice(0, at);
          const after = target.value.slice(end);
          // 空格子扔掉（尾随换行不该留一个孤零零的逗号），并在需要时补一个分隔逗号
          const parts = raw.split(/[\r\n，、]+/u).map((part) => part.trim()).filter((part) => part !== '');
          if (parts.length === 0) return;
          const head = before === '' || /,\s*$/u.test(before) ? before : `${before}, `;
          const tail = after === '' || /^\s*,/u.test(after) ? after : `, ${after}`;
          onChangeText(`${head}${parts.join(', ')}${tail}`);
        }}
      />
      <div className="wdp-cfg-presets">
        {presets.map((preset) => (
          <label key={preset.name} className="wdp-cfg-preset">
            <input
              type="checkbox"
              data-testid={`config-preset-${preset.name}`}
              disabled={disabled}
              checked={preset.checked}
              onChange={(event) => {
                onTogglePreset(preset.name, event.target.checked);
              }}
            />
            {preset.label}（{String(preset.port)}）
          </label>
        ))}
      </div>
      {issues.length > 0 ? (
        <ul className="wdp-cfg-issues" data-testid="config-managed-ports-issues">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <p className="wdp-cfg-hint">
        {issues.length > 0
          ? '声明里有非法项：改到全部合法才能保存（非法项不会被悄悄丢掉）。'
          : '只有声明过的端口才归本插件管；集合外的既有规则不进五态、不计入任何计数、没有任何动作。'}
      </p>
    </div>
  );
}
