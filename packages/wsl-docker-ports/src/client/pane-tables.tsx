/**
 * 只读区域组件（003 T5.1 / T5.4 / T5.7）：发行版 / docker 失败 / 端口表 / 不可转发 / 外部规则
 *
 * ## 这里为什么一个写动作都没有
 *
 * 不可转发映射、外部规则区**只展示**（REQ-9.2 / REQ-15.1）。
 * 「外部规则区无动作控件」因此不是纪律，而是**这个文件里没有任何写回调入参** ——
 * 测试对该区域的 DOM 扫 `button/select/input/textarea`，命中数必须是 0。
 *
 * 端口表带动作，但每个控件的可用性**只**来自视图模型（`enabled` / `disabledReason`），
 * 组件自己不判 NAT、不判策略（判据只有一处：`page.ts` 的 `writeGate`）。
 *
 * 🔴 **D1（2026-10-23 真机）**：容器表 / 启停重启 / 日志抽屉**已整体移出本文件** ——
 * 转发页只留端口转发功能，容器能力只活在 `client.containers.js`（容器页）。
 * 容器 UI 若再出现在转发 chunk，`assert-client-split` 的反向标记与 `pane.test.tsx` 会当场红。
 */

import type { ReactElement } from 'react';

import type { Scope } from '../diff/types.ts';
import type { DistroPanelView, DockerView, ExternalRulesView, ForwardActionView, PortRowView, UnsupportedRowView } from './types.ts';
import { TESTID } from './rows.ts';
import { ListenAddressCell } from './pane-listen.tsx';

/**
 * 017 三订（主人 2026-10-27）：「侧边栏里面的目标发行版可以去掉了」⇒ 发行版下拉已搬进
 * bundle 卡片页的配置区（那里和刷新频次 / 提权档 / 端口声明共用一个「保存设置」）。
 *
 * 这里**只保留告警**，而且只在真有话说时才渲染：
 * - `staleMessage`：portproxy 规则指向的 eth0 地址与现状不一致（**漂移** —— REQ-6 的安全网，
 *   规则会静默失效，必须喊出来）；
 * - `error`：发行版解析失败（读不出 `wsl -l -v` 之类）。
 *
 * 状态说明（`stateNote`，如「未启动」）属日常提示，跟着下拉一起搬走了 —— 留在侧栏等于把
 * 被删掉的块又长回来一半。
 */
export function DistroAlarmBlock(props: { readonly distro: DistroPanelView }): ReactElement | null {
  const { distro } = props;
  const stale = distro.staleMessage;
  const broken = distro.error;
  const note = distro.stateNote;
  if (stale === null && broken === null && note === null) return null;
  return (
    <section className="wdp-sec" data-testid="distro-alarm">
      <h3>发行版告警</h3>
      {note === null ? null : (
        <p className="wdp-secondary" data-testid="distro-state-note">
          {note}
        </p>
      )}
      {stale === null ? null : (
        <p className="wdp-error" data-testid="distro-stale">
          {stale}
        </p>
      )}
      {broken === null ? null : (
        <p className="wdp-error" data-testid="distro-error">
          {broken}
        </p>
      )}
      <p className="wdp-muted">目标发行版在插件卡片页的配置区里改（本页只报警）。</p>
    </section>
  );
}
export function DockerFailureBlock({ docker }: { readonly docker: Extract<DockerView, { ok: false }> }): ReactElement {
  return (
    <section className="wdp-sec" data-testid="docker-failure">
      <h3>docker 读取失败（{docker.reason}）</h3>
      <p className="wdp-error">{docker.message}</p>
      <p className="wdp-secondary">{docker.hint}</p>
      {docker.raw !== null ? <pre className="wdp-pre">{docker.raw}</pre> : null}
    </section>
  );
}

export function PortRowActions(props: {
  readonly row: PortRowView;
  readonly onForward: (action: ForwardActionView['kind'], row: PortRowView) => void;
}): ReactElement {
  return (
    <>
      {props.row.actions.map((action) => (
        <button
          key={action.kind}
          type="button"
          className="wdp-btn"
          data-testid={action.testId}
          data-write-control="1"
          disabled={!action.enabled}
          title={action.disabledReason ?? ''}
          onClick={() => props.onForward(action.kind, props.row)}
        >
          {action.label}
        </button>
      ))}
    </>
  );
}

export function PortsBlock(props: {
  readonly rows: readonly PortRowView[];
  readonly note: string | null;
  readonly scopeDraft: Readonly<Record<string, Scope>>;
  readonly onScope: (port: number, scope: Scope) => void;
  /** 012：监听地址的本地草稿（键 = 端口号字符串；缺省回落到 `row.listenAddress.value`） */
  readonly listenDraft: Readonly<Record<string, string>>;
  readonly onListenAddress: (port: number, address: string) => void;
  readonly onForward: (action: ForwardActionView['kind'], row: PortRowView) => void;
}): ReactElement {
  const { rows, note, scopeDraft, onScope, listenDraft, onListenAddress, onForward } = props;
  return (
    <section className="wdp-sec">
      <h3>端口转发（五态）</h3>
      {note !== null ? <p className="wdp-error">{note}</p> : null}
      <table className="wdp-table" data-testid={TESTID.ports}>
        <thead>
          <tr>
            <th>端口</th>
            <th>状态</th>
            <th>作用域</th>
            <th>动作</th>
            <th>证据</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.port} data-port={String(row.port)} data-state={row.state}>
              <td>{row.port}</td>
              <td>
                <span className={`wdp-tag wdp-tag-${row.tone}`} data-testid={`state-${String(row.port)}`}>
                  {row.stateLabel}
                </span>
                {row.reasonText !== null ? <div className="wdp-muted">{row.reasonText}</div> : null}
                {row.scopeMismatch ? <div className="wdp-muted">监听地址与声明作用域不一致（事实位，不判冲突）</div> : null}
              </td>
              <td>
                <select
                  className="wdp-btn"
                  data-testid={row.scopeControl.testId}
                  data-write-control="1"
                  value={scopeDraft[String(row.port)] ?? row.scopeControl.value}
                  disabled={!row.scopeControl.enabled}
                  title={row.scopeControl.disabledReason ?? ''}
                  onChange={(event) => onScope(row.port, event.target.value as Scope)}
                >
                  {row.scopeControl.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ListenAddressCell
                  control={row.listenAddress}
                  scope={scopeDraft[String(row.port)] ?? row.scopeControl.value}
                  draft={listenDraft[String(row.port)]}
                  onChange={(address) => onListenAddress(row.port, address)}
                />
              </td>
              <td>
                <PortRowActions row={row} onForward={onForward} />
              </td>
              <td>
                {row.drift !== null ? <div data-testid={`drift-${String(row.port)}`}>{row.drift.text}</div> : null}
                {row.fix !== null ? (
                  <div data-testid={`fix-${String(row.port)}`}>
                    <div className="wdp-muted">
                      修复序列（先删后加）：{row.fix.steps.map((step) => `${String(step.order)}.${step.kind}`).join(' → ')}
                    </div>
                    {row.fix.blocked !== null ? <div className="wdp-error">{row.fix.blocked.message}</div> : null}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** 不可转发映射（REQ-9.2）：**只标不支持**，不给任何「试试看」的入口 */
export function UnsupportedBlock({ rows }: { readonly rows: readonly UnsupportedRowView[] }): ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <section className="wdp-sec" data-testid="unsupported-section">
      <h3>不可转发的映射（{rows.length}）</h3>
      <table className="wdp-table" data-testid="tbl-unsupported">
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.containerName}-${row.protocol}-${row.containerPort}`}>
              <td>{row.containerName}</td>
              <td>
                {row.host} → {row.containerPort}/{row.protocol}
              </td>
              <td className="wdp-tag wdp-tag-muted">{row.stateLabel}</td>
              <td className="wdp-muted">{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * 外部规则只读区（REQ-15.1）。**刻意不接任何回调**：本组件没有 `onXxx` 入参，
 * 于是「无动作控件」在类型层就成立。
 */
export function ExternalRulesBlock({ external }: { readonly external: ExternalRulesView | null }): ReactElement | null {
  if (external === null) return null;
  return (
    <section className="wdp-sec" data-testid="external-rules">
      <h3>{external.title}</h3>
      <p className="wdp-muted">{external.note}</p>
      <ul className="wdp-list">
        {external.rows.map((rule) => (
          <li key={rule.display} className="wdp-row">
            <code>{rule.display}</code>
            {/* 主人 2026-10-27：原因只写在描述里 ⇒ 行内只留一个 ⚠（悬停看整句），行短了也就不需要分割线 */}
            <span className="wdp-muted" title={external.note}>
              ⚠
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}


