/**
 * **容器行自己的配置页**（015 `P4`；017 收窄）—— 挂在 `plugins.row.config` 槽、键 =
 * `<包名>#<行 id>`（`dsh-wsl-docker-containers#wsl-containers`）。
 *
 * ## 017 六订·九：`refreshIntervalSec` 回到**这一页**

 * 主人 2026-10-27 原话：「容器页刷新频次 把这个移到容器的内页里面」—— 这个字段只影响容器页，
 * 放在转发行的页面上等于让另一个组件替你改自己的刷新节奏。⇒ 本页放两个字段：
 * 容器页刷新频次（写 `wsl-containers` 的 `refreshIntervalSec`）+ 容器通道凭据。
 * `distro` 仍是**共用**项，只由组合包卡片页写（本页只读不写）。
 *
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

import { REFRESH_INTERVAL_OPTIONS } from '../refresh.ts';

import type { ContainersRuntime } from './runtime.ts';

export const CONFIG_CID = {
  refresh: 'inp-containers-config-refresh',
  refreshState: 'txt-containers-config-refresh-state',
  token: 'inp-containers-config-token',
  tokenSave: 'btn-containers-config-token-save',
  tokenState: 'txt-containers-config-token-state',
  message: 'txt-containers-config-message',
  unavailable: 'txt-containers-config-unavailable',
} as const;

export function ContainersConfigPage(props: { readonly runtime?: ContainersRuntime }): ReactElement {
  const runtime = props.runtime;
  const [refresh, setRefresh] = useState(0);
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
        setRefresh(view.refreshIntervalSec);
      })
      .catch(() => {
        if (alive) setUnavailable('读容器行配置失败：请稍后重试（不影响容器列表）');
      });
    return () => {
      alive = false;
    };
  }, [runtime]);

  /** 改刷新频次：立刻写（用户改一次就期望生效，没有「保存」二次确认） */
  const saveRefresh = useCallback(
    async (next: number): Promise<void> => {
      const pipe = runtime?.settings();
      if (pipe === undefined) return;
      setRefresh(next);
      const result = await pipe.writeRefreshInterval(next);
      setMessage(result.message);
    },
    [runtime],
  );

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
      '只显示容器行独占的字段：刷新频次与通道凭据。目标发行版是两个组件共用的，在卡片页的「配置」里改；转发侧字段（managedPorts、scopes、listenAddresses、elevationPolicy）在转发行的配置页里改。',
    ),
    createElement(
      'label',
      { className: 'wdp-field' },
      '容器页刷新频次',
      createElement(
        'select',
        {
          'data-testid': CONFIG_CID.refresh,
          value: String(refresh),
          onChange: (event: { target: { value: string } }) => void saveRefresh(Number(event.target.value)),
        },
        REFRESH_INTERVAL_OPTIONS.map((option) => createElement('option', { key: option.value, value: String(option.value) }, option.label)),
      ),
    ),
    createElement('p', { className: 'wdp-muted', 'data-testid': CONFIG_CID.refreshState }, refresh === 0 ? '容器页不自动刷新（只手动）' : `容器页每 ${String(refresh)} 秒自动刷新一次`),
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
