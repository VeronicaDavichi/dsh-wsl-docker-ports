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

import { useEffect, useRef, type ReactElement } from 'react';

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
  // 主人 2026-10-27：「所有的纵向滚轮都不应该存在」⇒ textarea **随内容长高**，不给自己长出滚动条
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const area = areaRef.current;
    if (area === null) return;
    area.style.height = 'auto';
    // +2 是上下边框（0.5px×2 取整），不加就会被裁掉最后一行
    area.style.height = `${String(area.scrollHeight + 2)}px`;
  }, [text]);
  return (
    <div className="wdp-cfg-field">
      <div className="wdp-cfg-head">
        <label className="wdp-cfg-label" htmlFor="config-managed-ports">
          端口声明（managedPorts）
        </label>
        <span className="wdp-cfg-tag">只写配置，不写规则</span>
      </div>
      <label className="wdp-cfg-sublabel" htmlFor="config-managed-ports">
        端口或区间，半角逗号或换行分隔都行（如 3306, 5432, 1000-3000；一行一项也可以，多了分行更好改）
      </label>
      {/*
        textarea 而不是单行 input（主人 2026-10-27 二次拍板：「还是做成 textarea，多了的话一个长条很难维护」）：
        多行 ⇒ 一行一项最好读最好改；分隔符仍是**半角逗号为主**（换行/全角逗号/顿号都认，见 rows.ts），
        两种写法等价。textarea 天然保留换行 ⇒ 不需要再拦 onPaste。
      */}
      <textarea
        ref={areaRef}
        id="config-managed-ports"
        className="wdp-input wdp-textarea"
        data-testid="config-managed-ports"
        rows={3}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          onChangeText(event.target.value);
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
