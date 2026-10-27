/**
 * **组合包（外页）配置页**：宿主 `plugins.bundle.config`，键 = 包名 `dsh-wsl-docker-ports`。
 *
 * 主人 2026-10-27 两次拍板（原话）：
 * 「内页有了的外页就不需要了」→ 于是外页一度被清空；
 * 「目标发行版依然放在外面啊，两个组件都要用的」→ **共用项**回到外页。
 *
 * 所以现在的分工是一句话能说清的：
 *
 * - **外页（这一页）**：两个组件共用的项 —— 目前只有 `目标发行版`（`distro`，端口转发与容器两边都读它）；
 * - **内页（行级页）**：只属于 `wsl-ports` 的项 —— 写通道预演 / 端口声明 / 刷新频次 / 提权策略 / 端口作用域 / 原始输出。
 *
 * 两页共用同一个 `ConfigPage`（`part` 决定渲染哪一半）与同一份 `settings` 管道 ⇒ 单一写入口语义不变：
 * `commit()` 只写真正改过的字段，隐藏的那一半不会被顺带写回。
 */

import type { ReactElement } from 'react';

import { ConfigPage, type ConfigPageProps } from './config-page.tsx';

export function BundleConfigPage(props: ConfigPageProps): ReactElement {
  return (
    <div data-testid="config-bundle-page">
      <ConfigPage settings={props.settings} write={props.write} part="distro" />
    </div>
  );
}
