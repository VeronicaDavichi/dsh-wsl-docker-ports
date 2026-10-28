/**
 * **容器行自己的配置页**（015 `P4`；017 收窄 + 换版式）—— 挂在 `plugins.row.config` 槽、键 =
 * `<组合包包名>#<行 id>`（`dsh-wsl-docker-ports#wsl-containers`，见 `config-slot.ts` 的说明）。
 *
 * ## 017 六订·九：`refreshIntervalSec` 回到**这一页**
 *
 * 主人 2026-10-27 原话：「容器页刷新频次 把这个移到容器的内页里面」—— 这个字段只影响容器页，
 * 放在转发行的页面上等于让另一个组件替你改自己的刷新节奏。⇒ 本页放两个字段：
 * 容器页刷新频次（写 `wsl-containers` 的 `refreshIntervalSec`）+ 容器通道凭据。
 * `distro` 仍是**共用**项，只由组合包卡片页写（本页只读不写）。
 *
 * ## 017 六订·十二：删掉自带标题与说明，版式与转发侧一致
 *
 * 主人 2026-10-28：「把『WSL Docker 容器（本行配置）』『只显示容器行独占的字段……』这些字去掉
 * 剩下的东西保持 css 和其他的一致」。⇒ 页面上**只留字段**（宿主自己已经在上面画了
 * 「Docker Containers」标题），字段语法与转发侧配置页同一套类名与尺寸：
 * `.wdp-cfg` / `.wdp-cfg-field` / `.wdp-cfg-label` / `.wdp-cfg-input` / `.wdp-cfg-btn` / `.wdp-cfg-hint`
 * （规则在 `styles.ts` 的 `PAGE_CSS` 里，与转发侧 `CONFIG_CSS` 逐条同值）。
 *
 * ## 为什么键是 `<组合包包名>#<行 id>`
 *
 * 宿主 0.2.0-rc.2 的 `rowConfigKey(bundle, rowId)` = `` `${bundle}#${rowId}` ``，`bundle` 是
 * **卡片所属的包**（本行挂在 `dsh-wsl-docker-ports` 的卡片下，容器包自己不出卡）⇒ 第 half 写
 * `dsh-wsl-docker-containers` 会让这一行**没有「配置」按钮**（2026-10-27 真机实测纠正）。
 *
 * ## 数据来源
 *
 * 主包用**同一个** `createSettingsPipe` 造了第二个实例（命名空间 = 容器行 id），
 * 经 `ContainersRuntime.settings()` 传进来 ⇒ 协议只有一份实现。
 */

import { createElement, useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { REFRESH_INTERVAL_OPTIONS } from '../refresh.ts';

import { installConfigStyles } from './config-css.ts';

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

  // 版式随页面走（不进主包：主包有棘轮地板），挂载时注入、卸载时移除
  useEffect(() => installConfigStyles(), []);

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
    return createElement(
      'div',
      { className: 'wdp-cfg', 'data-row': 'dsh-wsl-docker-containers' },
      createElement('p', { className: 'wdp-cfg-notice', 'data-testid': CONFIG_CID.unavailable }, unavailable),
    );
  }

  return createElement(
    'div',
    { className: 'wdp-cfg', 'data-row': 'dsh-wsl-docker-containers' },
    createElement(
      'div',
      { className: 'wdp-cfg-field' },
      createElement('label', { className: 'wdp-cfg-label', htmlFor: CONFIG_CID.refresh }, '容器页刷新频次'),
      createElement(
        'select',
        {
          id: CONFIG_CID.refresh,
          className: 'wdp-cfg-input',
          'data-testid': CONFIG_CID.refresh,
          value: String(refresh),
          onChange: (event: { target: { value: string } }) => void saveRefresh(Number(event.target.value)),
        },
        REFRESH_INTERVAL_OPTIONS.map((option) => createElement('option', { key: option.value, value: String(option.value) }, option.label)),
      ),
      createElement(
        'p',
        { className: 'wdp-cfg-hint', 'data-testid': CONFIG_CID.refreshState },
        refresh === 0 ? '容器页不自动刷新（只手动）' : `容器页每 ${String(refresh)} 秒自动刷新一次`,
      ),
    ),
    createElement(
      'div',
      { className: 'wdp-cfg-field' },
      createElement('label', { className: 'wdp-cfg-label', htmlFor: CONFIG_CID.token }, '容器通道凭据（与转发侧各自独立）'),
      createElement('input', {
        id: CONFIG_CID.token,
        className: 'wdp-cfg-input',
        type: 'password',
        'data-testid': CONFIG_CID.token,
        value: token,
        onChange: (event: { target: { value: string } }) => setToken(event.target.value),
      }),
      createElement(
        'div',
        { className: 'wdp-cfg-field-actions' },
        createElement('button', { type: 'button', className: 'wdp-cfg-btn', 'data-testid': CONFIG_CID.tokenSave, onClick: () => void saveToken() }, '保存凭据'),
      ),
      createElement('p', { className: 'wdp-cfg-hint', 'data-testid': CONFIG_CID.tokenState }, tokenConfigured ? '凭据：已配置（宿主不回显既有值）' : '凭据：未配置'),
      message === null ? null : createElement('p', { className: 'wdp-cfg-hint', 'data-testid': CONFIG_CID.message }, message),
    ),
  );
}
