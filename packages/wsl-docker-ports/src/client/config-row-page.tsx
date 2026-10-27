/**
 * **行级配置页**（宿主 `plugins.row.config`，键 = `dsh-wsl-docker-ports#wsl-ports`）的整页装配。
 *
 * 主人 2026-10-27 两次拍板（原话）：
 * 「把 写通道 / 写通道预演 / 端口声明（managedPorts）/ 端口转发页刷新频次 / 提权策略 / 端口作用域 都放进去」
 * 「内页有了的外页就不需要了」⇒ 这一页是**唯一**的配置入口（组合包卡片页不再挂配置页）；
 * 且全页只用一种版式语法：`ConfigField`（标签行 → 控件 → 说明），写通道预演与原始输出也不例外。
 */

import type { ReactElement } from 'react';

import { ConfigPage, type ConfigPageProps } from './config-page.tsx';
import { RawOutputSection } from './config-write.tsx';

export interface RowConfigPageProps extends ConfigPageProps {
  /** 原始输出读取器：**只在用户点开时**调用一次；`undefined` = 未接线 ⇒ 按钮置灰并写明原因 */
  readonly loadRawOutput?: (() => Promise<string | null>) | undefined;
}

export function RowConfigPage(props: RowConfigPageProps): ReactElement {
  return (
    <div data-testid="config-row-page">
      <ConfigPage settings={props.settings} write={props.write} />
      <RawOutputSection loadRawOutput={props.loadRawOutput} />
    </div>
  );
}
