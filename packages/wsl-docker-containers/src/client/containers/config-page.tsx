/**
 * **容器行自己的配置页**（015 `P4`；017 收窄）—— 挂在 `plugins.row.config` 槽、键 =
 * `<包名>#<行 id>`（`dsh-wsl-docker-containers#wsl-containers`）。
 *
 * ## 017：distro / refreshIntervalSec 已搬走
 *
 * 这两个字段现在只由**组合包级配置页**（`plugins.bundle.config`，在卡片页「描述与组件行
 * 之间」）写。本页保留的唯一字段是**容器行独占的** `writeToken`（与转发侧各自独立，属于
 * 行级卫生）。判定依据：同一字段两个写入口 = 两份可能分叉的值 ⇒ 017 只留一个入口。
 *
 * ## 为什么键是 `<包名>#<行 id>`
 *
 * 宿主 0.2.0-rc.2 随包文档：「`plugins.row.config`（keyed by `<package name>#<row id>`）for
 * one row's configuration, which gives that row a **Configure** control opening the row's page」。
 * 只写行 id（015 当初的写法）宿主找不到这一行 ⇒ 页永远不出现（017 一并修正）。
 *
 * ## 数据来源
 *
 * 主包用**同一个** `createSettingsPipe` 造了第二个实例（命名空间 = 容器行 id），
 * 经 `ContainersRuntime.settings()` 传进来 ⇒ 协议只有一份实现。
 */

import { createElement, useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import type { ContainersRuntime } from './runtime.ts';

export const CONFIG_CID = {
  token: 'inp-containers-config-token',
  tokenSave: 'btn-containers-config-token-save',
  tokenState: 'txt-containers-config-token-state',
  message: 'txt-containers-config-message',
  unavailable: 'txt-containers-config-unavailable',
} as const;

export function ContainersConfigPage(props: { readonly runtime?: ContainersRuntime }): ReactElement {
  const runtime = props.runtime;
  const [token, setToken] = useState('');
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const pipe = runtime?.settings();
    if (pipe === undefined) {
      setUnavailable('设置服务不可用：本行的配置页暂时不能读写（不影响容器列表与动作）');
      return () => {
        alive = false;
      };
    }
    void pipe
      .readConfig()
      .then((view) => {
        if (!alive) return;
        setTokenConfigured(view.writeTokenConfigured === true);
      })
      .catch(() => {
        if (alive) setUnavailable('读容器行配置失败：请稍后重试（不影响容器列表）');
      });
    return () => {
      alive = false;
    };
  }, [runtime]);

  const saveToken = useCallback(async (): Promise<void> => {
    const pipe = runtime?.settings();
    if (pipe === undefined) return;
    const result = await pipe.writeWriteToken(token);
    setMessage(result.message);
    if (result.ok) {
      setToken('');
      setTokenConfigured(token.trim() !== '');
    }
  }, [runtime, token]);

  if (unavailable !== null) {
    return createElement('div', { className: 'wdp-config' }, createElement('p', { className: 'wdp-warn', 'data-testid': CONFIG_CID.unavailable }, unavailable));
  }

  return createElement(
    'div',
    { className: 'wdp-config', 'data-row': 'dsh-wsl-docker-containers' },
    createElement('h3', null, 'WSL Docker 容器（本行配置）'),
    createElement(
      'p',
      { className: 'wdp-muted' },
      '只显示**容器行独占**的字段。目标发行版与刷新频次已搬到卡片页的「配置」（组合包级配置页）；转发侧字段（managedPorts、scopes、listenAddresses、elevationPolicy）在转发行的配置页里改。',
    ),
    createElement(
      'label',
      { className: 'wdp-field' },
      '容器通道凭据（与转发侧各自独立）',
      createElement('input', { type: 'password', 'data-testid': CONFIG_CID.token, value: token, onChange: (event: { target: { value: string } }) => setToken(event.target.value) }),
    ),
    createElement('button', { type: 'button', 'data-testid': CONFIG_CID.tokenSave, onClick: () => void saveToken() }, '保存凭据'),
    createElement('p', { className: 'wdp-muted', 'data-testid': CONFIG_CID.tokenState }, tokenConfigured ? '凭据：已配置（宿主不回显既有值）' : '凭据：未配置'),
    message === null ? null : createElement('p', { className: 'wdp-note', 'data-testid': CONFIG_CID.message }, message),
  );
}
