/**
 * **容器页**（015 `P4`；只活在 `client.containers.js` 这个 chunk 里）
 *
 * ## 与转发页的三条刻意差异
 *
 * 1. **零 netsh**：容器页只谈 `docker ps/logs/start|stop|restart`，一条 `netsh` 都不跑
 *    （宿主半的容器侧路由同样没有 netsh —— `check-borders.mjs` R3 会把这条钉死）；
 * 2. **不依赖转发侧**：`GET /dsh-wsl-docker-containers/snapshot` 是它唯一的数据源，
 *    转发行关掉（甚至没装）时它照常工作；
 * 3. **动作有本地闸门**：没凭据 ⇒ **一个请求都不发**（直接提示去保存凭据），
 *    有凭据才 POST —— 与 009 写通道的「本地拦下」同口径。
 *
 * ## 刷新
 *
 * 自己的 `refreshIntervalSec`（容器侧命名空间），五档 `0/15/30/60/300`，`0` = 关闭。
 * 取不到配置时**不猜**：按 30s 跑，并在页脚写明「配置不可用 ⇒ 按默认 30s」。
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import type { FetchLike } from '../../wire.ts';
import type { ContainersRuntime } from './runtime.ts';
import {
  fetchContainersLogs,
  fetchContainersSnapshot,
  runContainersAction,
  type ContainerRow,
  type ContainersAction,
  type ContainersSnapshotView,
} from './source.ts';

/** 自己的一套 testid（与转发页的 `TESTID` 各管各的，互不复用） */
export const CID = {
  refresh: 'btn-containers-refresh',
  table: 'tbl-containers-side',
  empty: 'txt-containers-empty',
  error: 'txt-containers-error',
  logs: 'pre-containers-logs',
  logsClose: 'btn-containers-logs-close',
  token: 'inp-containers-token',
  tokenSave: 'btn-containers-token-save',
  tokenState: 'txt-containers-token-state',
} as const;

/** 动作按钮的 testid（逐容器逐动作） */
export function actionTestId(id: string, action: ContainersAction): string {
  return `btn-containers-${action}-${id}`;
}

const DEFAULT_REFRESH_SEC = 30;
const LOG_TAIL = 200;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** 从配置视图里取刷新档（只认五档；不在其中一律当 0） */
export function readRefreshSec(view: unknown): number {
  const record = asRecord(view);
  const raw = record?.['refreshIntervalSec'];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return value === 15 || value === 30 || value === 60 || value === 300 ? value : 0;
}

export function ContainersPane(props: { readonly runtime?: ContainersRuntime }): ReactElement {
  const runtime = props.runtime;
  const [snapshot, setSnapshot] = useState<ContainersSnapshotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ readonly id: string; readonly text: string } | null>(null);
  const [refreshSec, setRefreshSec] = useState<number>(DEFAULT_REFRESH_SEC);
  const [configNote, setConfigNote] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [tokenPresent, setTokenPresent] = useState<boolean>(() => (runtime?.token() ?? '') !== '');
  const alive = useRef(true);

  // 窄化一次：`fetchImpl` 必须在场才谈得上取数（缺它就只报一行原因，不发请求）。
  // 🔴 真机缺陷（2026-10-23）两连击，都在这一行：
  //   1. **缺省必须回落全局 `fetch`** —— 生产路径下主包不注入 `fetchImpl`（`apply(ctx)` 无 options），
  //      旧写法在这里直接 `== null` ⇒ 容器页首屏只写「没有可用的 fetch」且**一个请求都不发**；
  //   2. **回落时必须 bind** —— 取数面是 `deps.fetchImpl(url, …)`（**方法调用**），原生 `fetch`
  //      在别家接收者上抛 `TypeError: Illegal invocation`（真机实证：页签开着、表永远「读取中…」）。
  //      转发页没踩到，是因为它用局部变量调用（`route-source.ts:82`）。
  const deps = useMemo(() => {
    const fallback = typeof fetch === 'function' ? (fetch.bind(globalThis) as unknown as FetchLike) : undefined;
    const fetchImpl = runtime?.fetchImpl ?? fallback;
    if (fetchImpl === undefined) return undefined;
    return { fetchImpl, baseUrl: runtime?.baseUrl ?? '', token: runtime?.token };
  }, [runtime]);

  const load = useCallback(async (): Promise<void> => {
    if (deps?.fetchImpl === undefined) {
      setError('没有可用的 fetch：本页无法取容器列表（运行环境没有 fetch）');
      return;
    }
    const result = await fetchContainersSnapshot(deps);
    if (!alive.current) return;
    if (result.ok) {
      setSnapshot(result.value);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [deps]);

  // 首屏 + 定时刷新（频次来自容器侧命名空间；取不到按 30s）
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const configure = async (): Promise<void> => {
      const pipe = runtime?.settings();
      if (pipe === undefined) {
        setConfigNote('设置服务不可用：按默认 30s 刷新');
        setRefreshSec(DEFAULT_REFRESH_SEC);
        return;
      }
      try {
        const view = await pipe.readConfig();
        const sec = readRefreshSec(view);
        if (!alive.current) return;
        setConfigNote(sec === 0 ? '自动刷新已关闭（容器侧配置 refreshIntervalSec=0）' : null);
        setRefreshSec(sec === 0 ? 0 : sec);
      } catch {
        setConfigNote('读容器侧配置失败：按默认 30s 刷新');
        setRefreshSec(DEFAULT_REFRESH_SEC);
      }
    };
    void load();
    void configure();
    return () => {
      alive.current = false;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [load, runtime]);

  // 频次变了就重排定时器（0 = 不排）
  useEffect(() => {
    if (refreshSec <= 0) return;
    const timer = setInterval(() => void load(), refreshSec * 1000);
    return () => clearInterval(timer);
  }, [refreshSec, load]);

  const act = useCallback(
    async (id: string, action: ContainersAction): Promise<void> => {
      if (deps?.fetchImpl === undefined) return;
      setBusy(`${action}:${id}`);
      const result = await runContainersAction(deps, id, action);
      if (!alive.current) return;
      setBusy(null);
      if (!result.ok) setError(result.message);
      else await load();
    },
    [deps, load],
  );

  const openLogs = useCallback(
    async (id: string): Promise<void> => {
      if (deps?.fetchImpl === undefined) return;
      setBusy(`logs:${id}`);
      const result = await fetchContainersLogs(deps, id, LOG_TAIL);
      if (!alive.current) return;
      setBusy(null);
      if (result.ok) setLogs({ id, text: result.value.text === '' ? '（该容器最近 200 行没有输出）' : result.value.text });
      else setError(result.message);
    },
    [deps],
  );

  const saveToken = useCallback((): void => {
    if (runtime === undefined) return;
    const value = tokenDraft.trim();
    runtime.saveToken(value);
    setTokenPresent(value !== '');
    setTokenDraft('');
  }, [runtime, tokenDraft]);

  const rows: readonly ContainerRow[] = snapshot?.containers ?? [];

  return createElement(
    'div',
    { className: 'wdp-containers', 'data-side': 'containers' },
    createElement(
      'div',
      { className: 'wdp-row wdp-toolbar' },
      createElement('button', { type: 'button', 'data-testid': CID.refresh, onClick: () => void load(), disabled: busy !== null }, '刷新'),
      createElement('span', { className: 'wdp-muted', 'data-testid': 'txt-containers-distro' }, snapshot?.distro === null || snapshot?.distro === undefined ? '目标发行版：未解析' : `目标发行版：${snapshot.distro.name}`),
      createElement('span', { className: 'wdp-muted' }, `刷新：${refreshSec === 0 ? '关闭' : `${String(refreshSec)}s`}`),
      createElement('span', { className: 'wdp-muted', 'data-testid': CID.tokenState }, tokenPresent ? '容器通道凭据：已保存（本会话）' : '容器通道凭据：未保存'),
    ),
    createElement(
      'div',
      { className: 'wdp-row' },
      createElement('input', {
        type: 'password',
        'data-testid': CID.token,
        placeholder: '容器通道凭据（与转发侧各自独立）',
        value: tokenDraft,
        onChange: (event: { target: { value: string } }) => setTokenDraft(event.target.value),
      }),
      createElement('button', { type: 'button', 'data-testid': CID.tokenSave, onClick: saveToken }, '保存凭据'),
    ),
    configNote === null ? null : createElement('p', { className: 'wdp-note' }, configNote),
    snapshot?.distro?.message == null ? null : createElement('p', { className: 'wdp-warn' }, snapshot.distro.message),
    snapshot?.distroError == null ? null : createElement('p', { className: 'wdp-warn' }, `发行版解析失败：${snapshot.distroError}`),
    snapshot?.error == null ? null : createElement('p', { className: 'wdp-danger', 'data-testid': CID.error }, `${snapshot.error.message}${snapshot.error.hint === '' ? '' : ` —— ${snapshot.error.hint}`}`),
    error === null ? null : createElement('p', { className: 'wdp-danger', 'data-testid': 'txt-containers-error-action' }, error),
    createElement(
      'table',
      { className: 'wdp-table', 'data-testid': CID.table },
      createElement('thead', null, createElement('tr', null, ['名称', '镜像', '状态', '端口', '动作'].map((label) => createElement('th', { key: label }, label)))),
      createElement(
        'tbody',
        null,
        rows.length === 0
          ? createElement('tr', null, createElement('td', { colSpan: 5, 'data-testid': CID.empty }, snapshot === null ? '读取中…' : '这个发行版里没有容器'))
          : rows.map((row) =>
              createElement(
                'tr',
                { key: row.id },
                createElement('td', { title: row.id }, row.name),
                createElement('td', null, row.image),
                createElement('td', null, `${row.state} / ${row.status}`),
                createElement('td', null, row.ports.length === 0 ? '（未发布）' : row.ports.join(', ')),
                createElement(
                  'td',
                  { className: 'wdp-actions' },
                  (['start', 'stop', 'restart'] as const).map((action) =>
                    createElement(
                      'button',
                      {
                        key: action,
                        type: 'button',
                        'data-testid': actionTestId(row.id, action),
                        disabled: busy !== null,
                        onClick: () => void act(row.id, action),
                      },
                      action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启',
                    ),
                  ),
                  createElement('button', { type: 'button', 'data-testid': `btn-containers-logs-${row.id}`, disabled: busy !== null, onClick: () => void openLogs(row.id) }, '日志'),
                ),
              ),
            ),
      ),
    ),
    logs === null
      ? null
      : createElement(
          'div',
          { className: 'wdp-logs' },
          createElement('div', { className: 'wdp-row' }, createElement('strong', null, `日志：${logs.id}`), createElement('button', { type: 'button', 'data-testid': CID.logsClose, onClick: () => setLogs(null) }, '关闭')),
          createElement('pre', { 'data-testid': CID.logs, className: 'wdp-pre' }, logs.text),
        ),
    snapshot !== null && snapshot.notes.length > 0
      ? createElement('ul', { className: 'wdp-notes' }, snapshot.notes.map((note) => createElement('li', { key: note }, note)))
      : null,
  );
}
