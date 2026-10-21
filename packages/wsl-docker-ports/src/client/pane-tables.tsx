/**
 * 只读区域组件（003 T5.1 / T5.4 / T5.7）：发行版 / docker 失败 / 容器表 / 端口表 / 不可转发 / 外部规则
 *
 * ## 这里为什么一个写动作都没有
 *
 * 容器表、不可转发映射、外部规则区**只展示**（REQ-2.4 / REQ-9.2 / REQ-15.1）。
 * 「外部规则区无动作控件」因此不是纪律，而是**这个文件里没有任何写回调入参** ——
 * 测试对该区域的 DOM 扫 `button/select/input/textarea`，命中数必须是 0。
 *
 * 端口表带动作，但每个控件的可用性**只**来自视图模型（`enabled` / `disabledReason`），
 * 组件自己不判 NAT、不判策略（判据只有一处：`page.ts` 的 `writeGate`）。
 */

import { useState } from 'react';
import type { ReactElement } from 'react';

import type { Scope } from '../diff/types.ts';
import { DEFAULT_LOG_TAIL } from '../docker/wire.ts';
import type { ContainerControl } from './container-control.ts';
import type { ContainerRowView, DistroPanelView, DockerView, ExternalRulesView, ForwardActionView, PortRowView, UnsupportedRowView } from './types.ts';
import { TESTID } from './rows.ts';

/** 容器动作的测试锚点（**故意不放进 `rows.ts`**：那是主包侧模块，加一个键就涨主包字节） */
export const CONTAINER_TESTID = {
  start: 'container-start',
  stop: 'container-stop',
  restart: 'container-restart',
  logs: 'container-logs-btn',
  logsPanel: 'container-logs',
  error: 'container-action-error',
  note: 'container-action-note',
} as const;

export function DistroBlock(props: { readonly distro: DistroPanelView; readonly onChange: (name: string) => void }): ReactElement {
  const { distro, onChange } = props;
  return (
    <section className="wdp-card" data-testid="distro-panel">
      <h3>目标发行版</h3>
      <p className="wdp-secondary">
        {distro.name ?? '未解析'}（来源：{distro.sourceLabel}
        {distro.state === null ? '' : `，状态：${distro.state}`}）
      </p>
      {distro.stateNote !== null ? (
        <p className="wdp-secondary" data-testid="distro-state-note">
          {distro.stateNote}
        </p>
      ) : null}
      {distro.error !== null ? <p className="wdp-error">{distro.error}</p> : null}
      {distro.staleMessage !== null ? (
        <p className="wdp-error" data-testid="distro-stale">
          {distro.staleMessage}
        </p>
      ) : null}
      {distro.options.length > 0 ? (
        <select
          className="wdp-btn"
          data-testid={TESTID.distro}
          data-settings-control="1"
          value={distro.name ?? ''}
          onChange={(event) => onChange(event.target.value)}
        >
          {distro.options.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name}（{option.state}
              {option.isDefault ? '，默认' : ''}）
            </option>
          ))}
        </select>
      ) : null}
    </section>
  );
}

export function DockerFailureBlock({ docker }: { readonly docker: Extract<DockerView, { ok: false }> }): ReactElement {
  return (
    <section className="wdp-card" data-testid="docker-failure">
      <h3>docker 读取失败（{docker.reason}）</h3>
      <p className="wdp-error">{docker.message}</p>
      <p className="wdp-secondary">{docker.hint}</p>
      {docker.raw !== null ? <pre className="wdp-pre">{docker.raw}</pre> : null}
    </section>
  );
}

export function ContainersBlock(props: {
  readonly rows: readonly ContainerRowView[];
  readonly count: number;
  /** 010 T7.1/T7.2：`undefined` ⇒ 动作控件**置灰 + 写明原因**（不抛、不假装可用） */
  readonly control?: ContainerControl | undefined;
  /** 动作成功后让页面重拉快照（状态列要跟着变） */
  readonly onChanged?: (() => void) | undefined;
  /** 控件不可用的原因（`control === undefined` 时展示） */
  readonly disabledReason?: string | undefined;
}): ReactElement {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ readonly id: string; readonly tail: number; readonly text: string } | null>(null);
  const disabled = props.control === undefined;

  const run = async (id: string, action: 'start' | 'stop' | 'restart'): Promise<void> => {
    const control = props.control;
    if (control === undefined) return;
    setBusy(`${id}:${action}`);
    setNote(null);
    try {
      const outcome = await control.action(id, action);
      setNote(outcome.ok ? `已执行 docker ${action}（容器 ${id}）` : `docker ${action} 未成功：${outcome.message}`);
      if (outcome.ok) {
        props.onChanged?.();
        // 停掉的容器日志还有用，但快照要在「状态」列上立刻反映 ⇒ 重拉交给 onChanged
      }
    } catch (error) {
      setNote(`docker ${action} 抛出异常：${error instanceof Error ? error.message : String(error)}（未重试）`);
    } finally {
      setBusy(null);
    }
  };

  const openLogs = async (id: string): Promise<void> => {
    const control = props.control;
    if (control === undefined) return;
    setBusy(`${id}:logs`);
    setNote(null);
    try {
      const outcome = await control.logs(id);
      if (outcome.ok) setLogs({ id, tail: outcome.tail, text: outcome.text });
      else setNote(`读取日志失败：${outcome.message}`);
    } catch (error) {
      setNote(`读取日志时抛出异常：${error instanceof Error ? error.message : String(error)}（未重试）`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="wdp-card">
      <h3>容器（{props.count}）</h3>
      {disabled ? (
        <p className="wdp-secondary" data-testid={CONTAINER_TESTID.note}>
          {props.disabledReason ?? '容器动作未接线：只能浏览（宿主没有提供容器控制通道）'}
        </p>
      ) : (
        <p className="wdp-secondary">
          启停只在你自己点的时候执行：请求带插件凭据，Agent 没有这把凭据 ⇒ 宿主 401，一次 docker 调用都不会发生。
        </p>
      )}
      <table className="wdp-table" data-testid={TESTID.containers}>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>镜像</th>
            <th>状态</th>
            <th>端口</th>
            <th>摘要</th>
            <th>动作</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td>
              <td>{row.name}</td>
              <td>{row.image}</td>
              <td>{row.state}</td>
              <td>{row.ports}</td>
              <td>{row.status}</td>
              <td className="wdp-actions">
                <button
                  type="button"
                  className="wdp-btn"
                  data-testid={`${CONTAINER_TESTID.start}-${row.id}`}
                  disabled={disabled || busy !== null}
                  onClick={() => void run(row.id, 'start')}
                >
                  启动
                </button>
                <button
                  type="button"
                  className="wdp-btn"
                  data-testid={`${CONTAINER_TESTID.stop}-${row.id}`}
                  disabled={disabled || busy !== null}
                  onClick={() => void run(row.id, 'stop')}
                >
                  停止
                </button>
                <button
                  type="button"
                  className="wdp-btn"
                  data-testid={`${CONTAINER_TESTID.restart}-${row.id}`}
                  disabled={disabled || busy !== null}
                  onClick={() => void run(row.id, 'restart')}
                >
                  重启
                </button>
                <button
                  type="button"
                  className="wdp-btn"
                  data-testid={`${CONTAINER_TESTID.logs}-${row.id}`}
                  disabled={disabled || busy !== null}
                  onClick={() => void openLogs(row.id)}
                >
                  日志（{DEFAULT_LOG_TAIL} 行）
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {note === null ? null : (
        <p className="wdp-error" data-testid={CONTAINER_TESTID.error}>
          {note}
        </p>
      )}
      {logs === null ? null : (
        <div className="wdp-card" data-testid={CONTAINER_TESTID.logsPanel}>
          <h4>
            容器 {logs.id} 的最近 {logs.tail} 行（只在内存，关闭即消失）
          </h4>
          <pre className="wdp-pre">{logs.text.trim() === '' ? '（没有日志输出）' : logs.text}</pre>
          <button type="button" className="wdp-btn" onClick={() => setLogs(null)}>
            关闭
          </button>
        </div>
      )}
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
  readonly onForward: (action: ForwardActionView['kind'], row: PortRowView) => void;
}): ReactElement {
  const { rows, note, scopeDraft, onScope, onForward } = props;
  return (
    <section className="wdp-card">
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
    <section className="wdp-card" data-testid="unsupported-section">
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
    <section className="wdp-card" data-testid="external-rules">
      <h3>{external.title}</h3>
      <p className="wdp-muted">{external.note}</p>
      <ul className="wdp-list">
        {external.rows.map((rule) => (
          <li key={rule.display} className="wdp-row">
            <code>{rule.display}</code>
            <span className="wdp-muted">{rule.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
