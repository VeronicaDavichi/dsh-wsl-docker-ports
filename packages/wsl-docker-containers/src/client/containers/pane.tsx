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
 * ## 刷新（015 D2，2026-10-23 真机）
 *
 * 自己的 `refreshIntervalSec`（容器侧命名空间 `dsh-wsl-docker-containers`），五档
 * `0/15/30/60/300`，**缺省 `0` = 关闭**。选择器写回的是**容器行自己的配置**，
 * 与转发侧 `dsh-wsl-docker-ports` 的 `refreshIntervalSec` 互不影响。
 * 轮询**只在数据变化时重绘**：比较载荷时忽略 `generatedAt`（见 `source.ts` 的
 * `sameContainersPayload`，与 014 忽略 `refreshedAt` 同一口径）。
 * 配置服务不可用 ⇒ 仍按「关闭」处理：**不猜一个默认秒数、不偷偷轮询**。
 *
 * ## 「上次刷新：YYYY-MM-DD HH:mm:ss」（017 六订·三十一 / 三十二，2026-10-28 主人：「先在刷新的右边
 * 容器通道凭据的左边插入上次刷新时间」）
 *
 * 位置固定在页头三件套的中间：**刷新按钮 → 上次刷新 → 容器通道凭据**，同一行。
 * 格式（017 六订·三十二，主人原话「上次刷新：2026-10-28 14:12:56 这个格式表现」）：
 * `上次刷新：YYYY-MM-DD HH:mm:ss` —— **全角冒号** + 日期 + 空格 + 本地时刻，缺一不可。
 * 时钟口径刻意与 D2 的「数据未变零重绘」对齐：**只在那次刷新真的会引起重绘时才更新**
 * （首屏成功 / 手动刷新 / 数据真变），轮询到同一份数据时**既不重绘也不动时间** ——
 * 否则每 15 秒为一个时间戳重绘一次，D2-3 的判据（`renders === 0`）当场作废。
 * 没成功过就显示 `上次刷新：—`，**不写占位时间**（不猜）。
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { installConfigStyles } from './config-css.ts';
import { usePageScrollFix } from './page-scroll.ts';
import type { ReactElement } from 'react';

import type { FetchLike } from '../host.ts';
import { normalizeRefreshIntervalSec } from '../refresh.ts';
import type { ContainersRuntime } from './runtime.ts';
import {
  fetchContainersLogs,
  fetchContainersSnapshot,
  runContainersAction,
  sameContainersPayload,
  type ContainerRow,
  type ContainersAction,
  type ContainersSnapshotView,
} from './source.ts';

/** 自己的一套 testid（与转发页的 `TESTID` 各管各的，互不复用） */
export const CID = {
  refresh: 'btn-containers-refresh',
  // 017：页头的刷新下拉已删除（搬到 bundle 级配置页）⇒ 不再有 `sel-containers-refresh-interval`
  table: 'tbl-containers-side',
  empty: 'txt-containers-empty',
  error: 'txt-containers-error',
  logs: 'pre-containers-logs',
  logsClose: 'btn-containers-logs-close',
  token: 'inp-containers-token',
  tokenSave: 'btn-containers-token-save',
  tokenState: 'txt-containers-token-state',
  /** 页头的「上次刷新：YYYY-MM-DD HH:mm:ss」（017 六订·三十一 / 三十二） */
  refreshedAt: 'txt-containers-refreshed-at',
} as const;

/** 动作按钮的 testid（逐容器逐动作） */
export function actionTestId(id: string, action: ContainersAction): string {
  return `btn-containers-${action}-${id}`;
}

const LOG_TAIL = 200;

/**
 * 五列的**显式**宽度（017 六订·三十三 / 三十四，2026-10-28 主人两次：「将名称栏宽度缩小20%，
 * 镜像栏宽度缩小30%」→「进一步将名称栏宽度缩小20%，镜像栏宽度缩小30%」）。
 *
 * 每一轮都在**上一轮量到的整数**上再缩（逐轮取整，可追溯）：
 * - 六订·三十三（基线：真机 43391、侧栏内容 412 px、表 545 px，逐列 171/189/58/85/42）：
 *   名称 171 → **137**（171×0.8）、镜像 189 → **132**（189×0.7）；
 * - 六订·三十四（本轮，在 137/132 上再缩）：名称 137 → **110**（137×0.8 = 109.6）、
 *   镜像 132 → **92**（132×0.7 = 92.4）；状态 / 端口 / 动作**始终没动**（58 / 85 / 42）。
 * 合计 110+92+58+85+42 = **387 px ≤ 侧栏内容 412 px** ⇒ 这一轮顺带把「动作」列横向滚的老问题解决了。
 *
 * 🔴 但「收进一屏」当场暴露出一个**本来就有、只是看不见**的缺陷：动作列 42 px 时按钮内宽只剩 14 px，
 * 两个汉字被挤成**两行**（真机实测 `Range.getClientRects() = 2`，按钮 30×26）。42 → **64 px** 后
 * 按钮 42×26、文字回到**一行**（rects = 1），合计 110+92+58+85+64 = **409 px ≤ 412 px** 仍然装得下。
 * 因此最终动作列 = 64 px（这一格不是主人点名的两列，属于「收窄两列后必须顺带修」的连带项）。
 *
 * 为什么必须写死 px + `table-layout: fixed`：自动布局下 `<col>` 宽度只是「建议」，
 * 内容最小宽会把它顶回去（实测加了 colgroup 后仍是 171/189，一个像素没动）。
 */
export const CONTAINERS_COL_WIDTHS = ['110px', '92px', '58px', '85px', '64px'] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * 把毫秒时间戳格式化成**本地**的 `YYYY-MM-DD HH:mm:ss`
 * （不本地化、不猜时区：就用浏览器本地时间；017 六订·三十二 主人指定带日期）
 */
export function formatRefreshClock(at: number): string {
  const date = new Date(at);
  const day = `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** 页头中间那格的字面量：没成功刷过 = `上次刷新：—`（不填占位时间；冒号是全角） */
export function refreshClockText(at: number | null): string {
  return at === null ? '上次刷新：—' : `上次刷新：${formatRefreshClock(at)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** 从配置视图里取刷新档（只认五档；不在其中 / 缺省一律当 0 = 关闭） */
export function readRefreshSec(view: unknown): number {
  return normalizeRefreshIntervalSec(asRecord(view)?.['refreshIntervalSec']);
}

export function ContainersPane(props: { readonly runtime?: ContainersRuntime }): ReactElement {
  const runtime = props.runtime;
  const [snapshot, setSnapshot] = useState<ContainersSnapshotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ readonly id: string; readonly text: string } | null>(null);
  // D2：默认「关闭」——配置读不到时也不猜默认秒数（不偷偷轮询）
  const [refreshSec, setRefreshSec] = useState<number>(0);
  const [configNote, setConfigNote] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  // 上次成功刷新的本地时刻（null = 还没成功过）
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [tokenPresent, setTokenPresent] = useState<boolean>(() => (runtime?.token() ?? '') !== '');
  const alive = useRef(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 侧边栏与配置内页**同一份版式**（主人 2026-10-28：「这个css和插件配置内页保持一致」）
  useEffect(() => installConfigStyles(), []);
  const lastSnapshot = useRef<ContainersSnapshotView | null>(null);
  // D2：错误态去重后再 setState —— 轮询成功且数据未变时**连 `setError(null)` 都不发**，
  // 否则 React 仍会为一次同值 dispatch 付一次提交（实测 1 次重绘，Profiler 计数不撒谎）。
  const errorRef = useRef<string | null>(null);
  const writeError = useCallback((message: string | null): void => {
    if (errorRef.current === message) return;
    errorRef.current = message;
    setError(message);
  }, []);

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

  const load = useCallback(async (onlyIfChanged = false): Promise<void> => {
    if (deps?.fetchImpl === undefined) {
      writeError('没有可用的 fetch：本页无法取容器列表（运行环境没有 fetch）');
      return;
    }
    const result = await fetchContainersSnapshot(deps);
    if (!alive.current) return;
    if (result.ok) {
      const previous = lastSnapshot.current;
      // D2：轮询只在数据真变化时重绘（忽略 `generatedAt`）；手动刷新 / 动作后重拉照常更新
      if (onlyIfChanged && previous !== null && sameContainersPayload(previous, result.value)) {
        writeError(null);
        return;
      }
      lastSnapshot.current = result.value;
      setSnapshot(result.value);
      // D2 对齐：只有走到这里（首屏 / 手动刷新 / 数据真变）才盖时间戳
      setRefreshedAt(Date.now());
      writeError(null);
    } else {
      writeError(result.message);
    }
  }, [deps, writeError]);

  // 首屏 + 读频次（频次来自容器侧命名空间；缺省 0 = 关闭，读不到也按关闭）
  useEffect(() => {
    alive.current = true;
    const configure = async (): Promise<void> => {
      const pipe = runtime?.settings();
      if (pipe === undefined) {
        setConfigNote('设置服务不可用：刷新频次保持「关闭」（本会话改档不会落盘）');
        setRefreshSec(0);
        return;
      }
      try {
        const view = await pipe.readConfig();
        if (!alive.current) return;
        setRefreshSec(readRefreshSec(view));
        setConfigNote(null);
      } catch {
        if (!alive.current) return;
        setConfigNote('读容器侧配置失败：刷新频次按「关闭」处理（不猜默认值）');
        setRefreshSec(0);
      }
    };
    void load();
    void configure();
    return () => {
      alive.current = false;
    };
  }, [load, runtime]);

  // 频次变了就重排定时器（0 = 不排）；卸载/改档时清理，不留无主定时器
  useEffect(() => {
    if (refreshSec <= 0) return;
    const timer = setInterval(() => void load(true), refreshSec * 1000);
    return () => clearInterval(timer);
  }, [refreshSec, load]);


  const act = useCallback(
    async (id: string, action: ContainersAction): Promise<void> => {
      if (deps?.fetchImpl === undefined) return;
      setBusy(`${action}:${id}`);
      const result = await runContainersAction(deps, id, action);
      if (!alive.current) return;
      setBusy(null);
      if (!result.ok) writeError(result.message);
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
      else writeError(result.message);
    },
    [deps, writeError],
  );

  const saveToken = useCallback((): void => {
    if (runtime === undefined) return;
    const value = tokenDraft.trim();
    runtime.saveToken(value);
    setTokenPresent(value !== '');
    setTokenDraft('');
  }, [runtime, tokenDraft]);

  const rows: readonly ContainerRow[] = snapshot?.containers ?? [];
  // 017 六订·二十（P7）：全页纵向滚动条只在宿主壳上出现一次（行数变了重新量）
  usePageScrollFix(rootRef, rows.length);

  return createElement(
    'div',
    { className: 'wdp-containers', 'data-side': 'containers', ref: rootRef },
    createElement(
      'div',
      { className: 'wdp-row wdp-toolbar' },
      createElement('button', { type: 'button', className: 'wdp-cfg-btn', 'data-testid': CID.refresh, onClick: () => void load(), disabled: busy !== null }, '刷新'),
      createElement('span', { className: 'wdp-muted', 'data-testid': CID.refreshedAt }, refreshClockText(refreshedAt)),
      createElement('span', { className: 'wdp-muted', 'data-testid': CID.tokenState }, tokenPresent ? '容器通道凭据：已保存（本会话）' : '容器通道凭据：未保存'),
    ),
    createElement(
      'div',
      { className: 'wdp-row wdp-token-row' },
      createElement('input', {
        type: 'password',
        className: 'wdp-cfg-input',
        'data-testid': CID.token,
        placeholder: '容器通道凭据（与转发侧各自独立）',
        value: tokenDraft,
        onChange: (event: { target: { value: string } }) => setTokenDraft(event.target.value),
      }),
      createElement('button', { type: 'button', className: 'wdp-cfg-btn', 'data-testid': CID.tokenSave, onClick: saveToken }, '保存'),
    ),
    configNote === null ? null : createElement('p', { className: 'wdp-note' }, configNote),
    snapshot?.distro?.message == null ? null : createElement('p', { className: 'wdp-warn' }, snapshot.distro.message),
    snapshot?.distroError == null ? null : createElement('p', { className: 'wdp-warn' }, `发行版解析失败：${snapshot.distroError}`),
    snapshot?.error == null ? null : createElement('p', { className: 'wdp-danger', 'data-testid': CID.error }, `${snapshot.error.message}${snapshot.error.hint === '' ? '' : ` —— ${snapshot.error.hint}`}`),
    error === null ? null : createElement('p', { className: 'wdp-danger', 'data-testid': 'txt-containers-error-action' }, error),
    createElement(
      'table',
      // 固定布局 + 逐列显式宽度：自动布局会把缩掉的宽度又还给内容（六订·三十三）
      { className: 'wdp-table', 'data-testid': CID.table, style: { tableLayout: 'fixed' } },
      createElement(
        'colgroup',
        null,
        CONTAINERS_COL_WIDTHS.map((width, index) => createElement('col', { key: `col-${String(index)}`, style: { width } })),
      ),
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
                        className: 'wdp-cfg-btn wdp-cfg-btn-sm',
                        'data-testid': actionTestId(row.id, action),
                        disabled: busy !== null,
                        onClick: () => void act(row.id, action),
                      },
                      action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启',
                    ),
                  ),
                  createElement('button', { type: 'button', className: 'wdp-cfg-btn wdp-cfg-btn-sm', 'data-testid': `btn-containers-logs-${row.id}`, disabled: busy !== null, onClick: () => void openLogs(row.id) }, '日志'),
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
          createElement('div', { className: 'wdp-row' }, createElement('strong', null, `日志：${logs.id}`), createElement('button', { type: 'button', className: 'wdp-cfg-btn', 'data-testid': CID.logsClose, onClick: () => setLogs(null) }, '关闭')),
          createElement('pre', { 'data-testid': CID.logs, className: 'wdp-pre' }, logs.text),
        ),
    snapshot !== null && snapshot.notes.length > 0
      ? createElement('ul', { className: 'wdp-notes' }, snapshot.notes.map((note) => createElement('li', { key: note }, note)))
      : null,
  );
}
