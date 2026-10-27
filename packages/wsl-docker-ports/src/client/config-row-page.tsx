/**
 * **行级配置页**（宿主 `plugins.row.config`，键 = `dsh-wsl-docker-ports#wsl-ports`）的整页装配。
 *
 * 主人 2026-10-27 第五次拍板（原话）：「把 写通道 / 写通道预演 / 端口声明（managedPorts） /
 * 端口转发页刷新频次 / 提权策略 / 端口作用域 都放进去」—— 「进去」指的是
 * **点 `WSL Port Forwarding` 那一行进去的页面**（不是组合包卡片页）：
 *
 * - 上半 = 整张 `ConfigPage`（写通道预演、端口声明、刷新频次、提权策略、端口作用域、保存按钮…）；
 * - 下半 = 「只读事实层」分组里的 `原始输出` 卡片（上一轮已定在这里，主人没让挪走）。
 *
 * 两页共用**同一个** `settings` 管道与 `write` 接线 ⇒ 不存在「两份配置打架」：
 * 只是同一份 live 状态的第二个入口，保存后另一页刷新即见。样式仍走 `CONFIG_CSS`（chunk 侧）。
 */

import type { ReactElement } from 'react';

import { ConfigPage, type ConfigPageProps } from './config-page.tsx';
import { RawOutputPage } from './config-write.tsx';

export interface RowConfigPageProps extends ConfigPageProps {
  /** 原始输出读取器：**只在用户点开时**调用一次；`undefined` = 未接线 ⇒ 按钮置灰并写明原因 */
  readonly loadRawOutput?: (() => Promise<string | null>) | undefined;
}

export function RowConfigPage(props: RowConfigPageProps): ReactElement {
  return (
    <div data-testid="config-row-page">
      <ConfigPage settings={props.settings} write={props.write} />
      <RawOutputPage loadRawOutput={props.loadRawOutput} />
    </div>
  );
}
