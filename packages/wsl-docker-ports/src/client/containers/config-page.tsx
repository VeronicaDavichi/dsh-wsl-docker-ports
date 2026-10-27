/**
 * **容器行自己的配置页**（015 `P4`）—— 挂在 `plugins.row.config` 槽、键 = **容器行 id**。
 *
 * ## 为什么必须按角色隐藏字段（owner 决策 ①）
 *
 * 两行共用**同一份** `Config`（7 字段），但每行只「拥有」其中一部分：
 *
 * | 字段 | 转发行拥有 | 容器行拥有 |
 * | --- | :-: | :-: |
 * | `managedPorts` / `scopes` / `listenAddresses` / `elevationPolicy` | ✅ | ❌ |
 * | `distro` / `refreshIntervalSec` / `writeToken` | ✅ | ✅ |
 *
 * 容器行的配置页**只画自己那三个**：画别人的字段 = 让人以为改这里能影响转发侧
 * （实际写的是**本行命名空间**，转发侧根本读不到 ⇒ 纯误会）。
 *
 * ## 数据来源
 *
 * 主包用**同一个** `createSettingsPipe` 造了第二个实例（命名空间 = 容器页 id），
 * 经 `ContainersRuntime.settings()` 传进来 ⇒ 协议只有一份实现，字段读取/写入/校验不复制。
 */

import { createElement, useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import type { ContainersRuntime } from './runtime.ts';

export const CONFIG_CID = {
  distro: 'inp-containers-config-distro',
  distroSave: 'btn-containers-config-distro-save',
  refresh: 'sel-containers-config-refresh',
  token: 'inp-containers-config-token',
  tokenSave: 'btn-containers-config-token-save',
  tokenState: 'txt-containers-config-token-state',
  message: 'txt-containers-config-message',
  unavailable: 'txt-containers-config-unavailable',
} as const;

const REFRESH_CHOICES: readonly number[] = [0, 15, 30, 60, 300];

export function ContainersConfigPage(props: { readonly runtime?: ContainersRuntime }): ReactElement {
  const runtime = props.runtime;
  const [distro, setDistro] = useState('');
  const [refresh, setRefresh] = useState(30);
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
        setDistro(view.distro ?? '');
        const raw = (view as { refreshIntervalSec?: unknown }).refreshIntervalSec;
        const sec = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 30;
        setRefresh(REFRESH_CHOICES.includes(sec) ? sec : 30);
        setTokenConfigured(view.writeTokenConfigured === true);
      })
      .catch(() => {
        if (alive) setUnavailable('读容器行配置失败：请稍后重试（不影响容器列表）');
      });
    return () => {
      alive = false;
    };
  }, [runtime]);

  const saveDistro = useCallback(async (): Promise<void> => {
    const pipe = runtime?.settings();
    if (pipe === undefined) return;
    const result = await pipe.writeDistro(distro.trim());
    setMessage(result.message);
  }, [runtime, distro]);

  const saveRefresh = useCallback(
    async (sec: number): Promise<void> => {
      setRefresh(sec);
      const pipe = runtime?.settings();
      if (pipe === undefined) return;
      const result = await pipe.writeRefreshInterval(sec);
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
      '这里只显示**容器行拥有**的字段：distro / refreshIntervalSec / writeToken。转发侧字段（managedPorts、scopes、listenAddresses、elevationPolicy）在转发行的配置页里改。',
    ),
    createElement(
      'label',
      { className: 'wdp-field' },
      '目标发行版（留空 = 自动发现）',
      createElement('input', { type: 'text', 'data-testid': CONFIG_CID.distro, value: distro, onChange: (event: { target: { value: string } }) => setDistro(event.target.value) }),
    ),
    createElement('button', { type: 'button', 'data-testid': CONFIG_CID.distroSave, onClick: () => void saveDistro() }, '保存发行版'),
    createElement(
      'label',
      { className: 'wdp-field' },
      '自动刷新（秒）',
      createElement(
        'select',
        { 'data-testid': CONFIG_CID.refresh, value: String(refresh), onChange: (event: { target: { value: string } }) => void saveRefresh(Number(event.target.value)) },
        REFRESH_CHOICES.map((sec) => createElement('option', { key: sec, value: String(sec) }, sec === 0 ? '关闭' : `${String(sec)}s`)),
      ),
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
