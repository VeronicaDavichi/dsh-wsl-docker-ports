/**
 * 右栏页的**装配与状态**（003 T5.1–T5.8）
 *
 * ## 组件只做三件事
 *
 * ① 挂载时**只读**拉一次快照（`runtime.source.load()`），把 `PortsSnapshot` 交给纯函数
 *    `buildPortsPageView`；② 把视图模型交给三个区域组件画出来；③ 把用户点击交给**注入的**
 *    runtime（配置写回走 `settings`，转发写走 `elevation`）。
 *
 * ## 两条结构性纪律
 *
 * - **不 require `react-dom`**（contract §P4-3）：组件由宿主渲染进它的树，本半自己不建 root。
 * - **挂载路径不写任何东西**（NFR-2）：`useEffect` 里只有 `source.load()`，没有任何
 *   `settings` / `elevation` 调用 —— 测试用计数器断言开页后两者均为 0。
 *
 * JSX 走**经典**转换（`React.createElement`）⇒ 主 bundle 只 require 基线里的 `react`。
 * 区域组件拆在 `pane-tables.tsx` / `pane-settings.tsx`（单文件 ≤ 400 行是 SHALL）。
 */

import { useRef, useState, type ReactElement } from 'react';

import type { Scope } from '../diff/types.ts';
import { usePageScrollFix } from './pane-scroll.ts';
import type { ClientRuntime, ForwardAction } from './host.ts';
import { summarizeWriteReport } from './page.ts';
import { DistroAlarmBlock, DockerFailureBlock, ExternalRulesBlock, PortsBlock, UnsupportedBlock } from './pane-tables.tsx';
import { PaneHeader } from './pane-header.tsx';
import { ElevationBlock, ManagedPortsSummary, NextPhaseBlock, RawOutputBlock, WriteTokenBlock } from './pane-settings.tsx';
import { TESTID } from './rows.ts';
import type { LastWriteView, NatGatePanelView, PortRowView } from './types.ts';
import { useAutoRefresh } from './use-auto-refresh.ts';
import { clearWriteToken, issueWriteToken } from './write-token.ts';

export interface PortsPaneProps {
  readonly runtime: ClientRuntime;
  /** 关掉自动加载（测试要自己控制首帧时用） */
  readonly autoLoad?: boolean;
}

/** 该动作**计划**动哪几步（`SummarizeWriteReport` 据此报「未改项」，与 005 脚本的步骤名同源） */
export function plannedKinds(action: ForwardAction, scope: Scope, fix: PortRowView['fix']): readonly string[] {
  if (action === 'fix-drift') return fix?.steps.map((step) => step.kind) ?? [];
  if (action === 'apply') return scope === 'lan' ? ['portproxy-add', 'firewall-add'] : ['portproxy-add'];
  if (action === 'remove') return ['portproxy-delete', 'firewall-delete'];
  return [];
}

/** NAT 硬前提区（REQ-1.1/1.4）：非 NAT 时这里同时是**原因**与**修复指引**的落点 */
function NatGateBlock({ nat }: { readonly nat: NatGatePanelView }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <section className="wdp-card wdp-gate" data-testid={nat.testId} data-gate-open={nat.open ? '1' : '0'}>
      <h3>NAT 硬前提</h3>
      <p className={nat.open ? 'wdp-secondary' : 'wdp-error'}>{nat.reason}</p>
      {nat.guide !== null ? (
        <>
          <button type="button" className="wdp-btn" data-testid={TESTID.natGuide} onClick={() => setOpen((value) => !value)}>
            {open ? '收起修复指引' : '展开修复指引'}
          </button>
          {open ? (
            <div data-testid="nat-guide-body">
              <ul className="wdp-list">
                {nat.guide.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="wdp-muted">配置文件路径：{nat.guide.path}</p>
              <pre className="wdp-pre" data-testid="nat-guide-command">
                {nat.guide.commandText}
              </pre>
              <p className="wdp-muted">{nat.guide.note}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function LastWriteBlock({ lastWrite }: { readonly lastWrite: LastWriteView | null }): ReactElement | null {
  if (lastWrite === null) return null;
  return (
    <section className="wdp-card" data-testid="last-write">
      <h3>最近一次写操作：{lastWrite.status}</h3>
      <p className="wdp-secondary">{lastWrite.message}</p>
      {lastWrite.unapplied.length > 0 ? (
        <p className="wdp-error" data-testid="unapplied">
          未改动：{lastWrite.unapplied.join('、')}
        </p>
      ) : null}
    </section>
  );
}

export function PortsPane(props: PortsPaneProps): ReactElement {
  const { runtime, autoLoad = true } = props;
  const [actionError, setActionError] = useState<string | null>(null);
  // 014：拉取 / 自动轮询 / 频次状态机（含挂载读频次、选择写频次、卸载清定时器）
  // 017：页头上的频次下拉已删（搬到 bundle 级配置页）；`useAutoRefresh` 内部仍按配置值
  //      自动刷新，页面本身不再需要这个数值。
  const { view, loadError, busy, refresh } = useAutoRefresh(runtime, autoLoad, setActionError);
  const [scopeDraft, setScopeDraft] = useState<Readonly<Record<string, Scope>>>({});
  /** 012：监听地址的本地草稿（键 = 端口号）。⚠️ 持久化/写请求本轮**未接线**（常驻主包零余量），见交付报告 */
  const [listenDraft, setListenDraft] = useState<Readonly<Record<string, string>>>({});
  const [lastWrite, setLastWrite] = useState<LastWriteView | null>(null);
  /**
   * 写通道凭据的**本地**状态（T3.1 契约 1/2）：
   * - `tokenPresent` 的初值直接读 sessionStorage（**零 IPC**：挂载期不许 `describe()`，
   *   否则 T5.1 的「开页 0 次配置读」判据立刻红）；
   * - `issuedToken` 只在刚生成后非空 ⇒ 明文**只显示一次**，刷新即不再出现；
   * - `configConfigured` 是**服务端配置的布尔态**（`null` = 未检查）：由用户点「检查服务端配置状态」
   *   经 `readConfig()` 得到（`writeTokenConfigured`，值本体在管道层就被丢弃），
   *   或由一次**成功**的写入推出（生成 ⇒ true / 清除 ⇒ false）——两者都是布尔，页面拿不到值本体。
   */
  const [tokenPresent, setTokenPresent] = useState(() => runtime.write?.tokenStore.present() === true);
  const [configConfigured, setConfigConfigured] = useState<boolean | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenNote, setTokenNote] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  /** 写服务端配置的唯一入口（`settings.writeWriteToken` ⇒ 既有 live 写入管道；不复制 patch/revision 逻辑） */
  const saveWriteToken = async (token: string): Promise<{ readonly ok: boolean; readonly message: string }> => {
    const settings = runtime.settings;
    if (settings === undefined) return { ok: false, message: '配置写回管道未接线（remote.settings 缺失）：凭据没有写进服务端' };
    const saved = await settings.writeWriteToken(token);
    return { ok: saved.ok, message: saved.message };
  };

  /**
   * 清服务端凭据的唯一入口（009 收口轮 T3）：`settings.clearWriteToken()` ⇒ 宿主
   * `mutate(ns, [{op:'unset',path:['writeToken']}], rev)`。**不写空串**（宿主 `walk()` 对空串仍判
   * `set:true` ⇒ 清除后页面会显示「已配置」而写通道实际 401）。`configConfigured` 只转达**服务端
   * 写入后视图**的布尔（`null` = 没拿到 ⇒ 调用方不猜）。
   */
  const unsetWriteToken = async (): Promise<{ readonly ok: boolean; readonly message: string; readonly configConfigured: boolean | null }> => {
    const settings = runtime.settings;
    if (settings === undefined) return { ok: false, message: '配置写回管道未接线（remote.settings 缺失）：没有从服务端清掉', configConfigured: null };
    const cleared = await settings.clearWriteToken();
    return { ok: cleared.ok, message: cleared.message, configConfigured: cleared.writeTokenConfigured };
  };

  const generateToken = async (): Promise<void> => {
    const write = runtime.write;
    if (write === undefined) {
      setTokenNote('写通道未接线：没有凭据仓库可写（只读面不受影响）。');
      return;
    }
    setConfirmingClear(false);
    setTokenBusy(true);
    const result = await issueWriteToken({ store: write.tokenStore, save: saveWriteToken });
    setTokenBusy(false);
    setIssuedToken(result.token);
    setTokenNote(result.message);
    setTokenPresent(write.tokenStore.present());
    if (result.ok) setConfigConfigured(true);
  };

  /** 「检查服务端配置状态」：**只**拿布尔；值本体不进本组件（REQ-1.3） */
  const checkTokenConfig = async (): Promise<void> => {
    const settings = runtime.settings;
    if (settings === undefined) {
      setConfigConfigured(null);
      setTokenNote('配置读取管道未接线（remote.settings 缺失）：判断不了服务端是否已配置 writeToken。');
      return;
    }
    setTokenBusy(true);
    try {
      const config = await settings.readConfig();
      setConfigConfigured(config.writeTokenConfigured);
      setTokenNote(
        config.writeTokenConfigured
          ? '服务端配置里**已配置** writeToken（只报布尔，不回显本体）。'
          : '服务端配置里**未配置** writeToken ⇒ 写入口一律 401（fail-safe，未放宽）。',
      );
    } catch (error) {
      setConfigConfigured(null);
      setTokenNote(`读取服务端配置失败：${error instanceof Error ? error.message : String(error)}（未静默：写入口仍按 fail-safe 一律 401 对待）`);
    } finally {
      setTokenBusy(false);
    }
  };

  /** 清除（二次确认在 `WriteTokenBlock` 的两段式按钮里；这里只在「确认」后被调用） */
  const clearToken = async (): Promise<void> => {
    const write = runtime.write;
    setConfirmingClear(false);
    if (write === undefined) {
      setTokenNote('清除不可用：写通道未接线（没有凭据仓库）——零写入。');
      return;
    }
    setTokenBusy(true);
    const result = await clearWriteToken({ store: write.tokenStore, unset: unsetWriteToken });
    setTokenBusy(false);
    setTokenNote(result.message);
    setTokenPresent(write.tokenStore.present());
    if (result.cleared) {
      /**
       * 🔴 布尔取 `mutate` 的**返回值**（服务端写入后的新脱敏视图）—— 与「刷新页面再读一次」
       * 同源，不是内存推断；`null`（没拿到视图）时**不猜**，留 `null` 让用户自己点「检查」。
       */
      setConfigConfigured(result.configConfigured);
      setIssuedToken(null);
    }
  };


  /** 宿主把本页挂进零高 div ⇒ 见 `pane-scroll.ts`（chunk 侧修复，主包零字节） */
  const rootRef = useRef<HTMLDivElement | null>(null);
  usePageScrollFix(rootRef, view);

  if (view === null) {
    return (
      <div className="wdp-page" data-plugin="dsh-wsl-docker-ports">
        <div className="wdp-head">
          <span>{busy ? '正在读取 docker / netsh / eth0 …' : '尚未读取'}</span>
          <button type="button" className="wdp-btn" data-testid={TESTID.refresh} disabled={busy} onClick={() => void refresh(false, lastWrite)}>
            刷新
          </button>
        </div>
        {loadError !== null ? <p className="wdp-error">读取失败：{loadError}</p> : null}
      </div>
    );
  }

  const runForward = async (action: ForwardAction, row: PortRowView): Promise<void> => {
    if (runtime.elevation === undefined) {
      setActionError('写路径不可用：本行只做只读展示');
      return;
    }
    setActionError(null);
    const report = await runtime.elevation.run({ action, port: row.port, scope: scopeDraft[String(row.port)] ?? row.scopeControl.value });
    const summary = summarizeWriteReport(plannedKinds(action, row.scopeControl.value, row.fix), report);
    setLastWrite(summary);
    await refresh(false, summary);
  };

  /** 配置写回的**唯一出口**（2026-10-12 缺陷 4 的修复点）：任何抛出都化成可读提示。修前
   * `savePorts()` 直接 await：宿主抛错时 Promise 没人接 ⇒ 只有 `Uncaught (in promise)`、页面零提示、
   * 配置也没变。现在：成功清提示、失败给原因、未接线也给原因；**只发一次、不重试**。 */
  const writeSettings = async (run: () => Promise<{ ok: boolean; message: string } | undefined>): Promise<void> => {
    try {
      const result = await run();
      if (result === undefined) setActionError('配置写回管道未接线（remote.settings 缺失）：没有改动任何配置。');
      else setActionError(result.ok ? null : result.message);
    } catch (error) {
      setActionError(`配置写入抛出异常：${error instanceof Error ? error.message : String(error)}（未改动任何配置，且不重试）`);
    }
    await refresh(false, lastWrite);
  };



  return (
    <div className="wdp-page" data-plugin="dsh-wsl-docker-ports" ref={rootRef}>
      <PaneHeader
        view={view}
        busy={busy}
        onRefresh={() => void refresh(false, lastWrite)}
        onLaunch={() => void refresh(true, lastWrite)}
      />
      {loadError !== null ? (
        <p className="wdp-error" data-testid="load-error">
          读取失败：{loadError}
        </p>
      ) : null}
      {actionError !== null ? (
        <p className="wdp-error" data-testid="action-error">
          {actionError}
        </p>
      ) : null}
      <NatGateBlock nat={view.nat} />
      {/* 010 收口（真机反馈 2026-10-22）：配置页在本机 profile 的「内置插件」里没有座位
          （那是 `@deepseek-ai/dsh-plugin-manager` 自己的列表）⇒ 提权档写入口**必须**留在右栏页，
          而且**放在最上面**：主人连着两次「找不到」，埋在端口声明下面等于没做。 */}
      <ElevationBlock elevation={view.elevation} onChange={(policy) => void writeSettings(async () => runtime.settings?.writeElevationPolicy(policy))} />
      {/* 017 三订（主人 2026-10-27）：「侧边栏里面的目标发行版可以去掉了」⇒ 下拉搬去配置页。
          这里只留**漂移 / 解析失败**的告警（REQ-6 的安全网要留着：规则指向失效地址是安全事故，
          平时为空 ⇒ 正常情况下这块根本不渲染，不占版面）。 */}
      <DistroAlarmBlock distro={view.distro} />
      {/* D1（2026-10-23 真机）：容器表 / 启停重启 / 日志抽屉已移入容器页（`client.containers.js`）。
          转发页只保留端口转发；这里仅保留 docker **读数失败**的诊断行（不是容器表、不是动作入口）。 */}
      {view.docker.ok === false ? <DockerFailureBlock docker={view.docker} /> : null}
      <PortsBlock
        rows={view.ports}
        note={view.portsNote}
        scopeDraft={scopeDraft}
        onScope={(port, scope) => {
          setScopeDraft((previous) => ({ ...previous, [String(port)]: scope }));
          void writeSettings(async () => runtime.settings?.writeScope(port, scope));
        }}
        listenDraft={listenDraft}
        onListenAddress={(port, address) => {
          // 012：本地草稿 = 即时反馈；**同时**写回配置（服务端现读它算 listenaddress / RemoteAddress）
          setListenDraft((previous) => ({ ...previous, [String(port)]: address }));
          void writeSettings(async () => runtime.settings?.writeListenAddress(port, address));
        }}
        onForward={(action, row) => void runForward(action, row)}
      />
      <p className="wdp-muted" data-testid={TESTID.udpTip}>
        {view.udpTip.text}
      </p>
      <UnsupportedBlock rows={view.unsupported} />
      <ExternalRulesBlock external={view.external} />
      {/* 017 二订（主人 2026-10-27）：「端口声明放到插件页面的配置里，展示放在外面容器的侧边栏里」
          ⇒ 本页只**展示**声明，编辑入口**没了**（单入口在 bundle 卡片页的配置页）。 */}
      <ManagedPortsSummary form={view.managedPorts} />
      {/* 010 收口（真机反馈）：配置页在本机 profile 的「内置插件」里没有座位（那是插件管理器自己的列表），
          所以提权档的写入口**必须**留在右栏页 —— 否则用户无处可改。 */}
      <WriteTokenBlock
        sessionPresent={tokenPresent}
        configured={configConfigured}
        issued={issuedToken}
        busy={tokenBusy}
        note={tokenNote}
        confirmingClear={confirmingClear}
        onGenerate={() => void generateToken()}
        onCheck={() => void checkTokenConfig()}
        onClearRequest={() => setConfirmingClear(true)}
        onClearConfirm={() => void clearToken()}
        onClearCancel={() => {
          setConfirmingClear(false);
          setTokenNote('已取消清除：零写入（凭据仍留在原处）。');
        }}
      />

      <NextPhaseBlock exec={view.exec} />
      <RawOutputBlock docker={view.docker} />
      <LastWriteBlock lastWrite={view.lastWrite} />
    </div>
  );
}


