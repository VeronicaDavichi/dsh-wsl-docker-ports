/**
 * 017：**bundle 级配置页**（挂在组合包页面的「描述」与「组件行」之间）。
 *
 * ## 为什么从行级搬到 bundle 级（主人 2026-10-27 拍板）
 *
 * 原来三项分散在三处：提权策略在**行级配置页**、刷新频次在两个**右栏页头部的下拉**、
 * 目标发行版在**容器行级配置页 + 右栏页头文字**。同一件事三个入口 ⇒ 找不到、也说不清
 * 「哪个值才算数」。现在只有这一个页面（`plugins.bundle.config`，键 = 组合包包名），
 * 页头上那三个控件**全部删除**。
 *
 * 逐字依据（宿主 0.2.0-rc.2 随包文档，2026-10-27 从 `app.asar` 原文核对）：
 * 「`plugins.bundle.config`（keyed by the bundle's package name）for a bundle's own
 * configuration, shown on the bundle's page between its description and its rows」。
 *
 * ## 布局骨架（抄 `@luweiyabo/dsh-whale-pet` 的 settings 卡片）
 *
 * `panel(title, hint) → section(h4) → field(label + 控件 + hint)`，底部一行
 * 「保存设置（脏了才可点）」+ `role="status"` 的「设置已保存」。**不做自动保存**：
 * 本页有一部分是安全档位（提权策略），误触即改行为 —— 显式保存 + 二次确认更合适。
 *
 * ## 两个命名空间，一次保存
 *
 * `distro` / `refreshIntervalSec` 在两个行的配置里各存一份（`wsl-ports` / `wsl-containers`，
 * 命名空间 = patch 条目 id）。页面把「目标发行版」画成**一个**控件，保存时**同时**写两边
 * （否则两个组件会各用各的发行版）。写路径仍是 `SettingsPipe`（`remote.settings.update`），
 * 干净得一：没有任何手写 YAML、没有 `configEditor.edit()`（那会重挂载）。
 *
 * ## 提权策略仍两段式（`REQ-12.4` / U4）
 *
 * 改档位 = 改后续所有写动作的提权行为 ⇒ 首次点「保存设置」只亮确认条，
 * 点「确认保存」才落盘。判据：未点确认 ⇒ `update` 调用次数 **0**。
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { REFRESH_INTERVAL_OPTIONS } from './refresh.ts';
import type { SettingsConfigView, SettingsPipe } from './settings-pipe.ts';

/** 提权档（与 `../wire.ts` 的 `ELEVATION_POLICIES` 同值；此处另写一份标签，避免把主包模块拖进 chunk） */
const POLICY_OPTIONS = [
  { value: 'none', label: '不自动提权（默认）' },
  { value: 'ask', label: '每次询问' },
  { value: 'passby', label: '直接执行（已有授权）' },
] as const;

/** 容器行（另一个组件）的 settings 命名空间：与它的 patch 条目 id 逐字一致 */
export const CONTAINERS_SETTINGS_NAMESPACE = 'wsl-containers';

/**
 * 只读的发行版清单路由（**本包自己的**轻路由：内部只跑 `wsl.exe -l -v`，
 * 不跑 `docker ps` / `netsh` —— 见 `src/wire.ts` 的 `PORTS_DISTROS_PATH`）。
 *
 * 🔴 为什么不借容器包那条前缀：三包零交叉门（`packages/wsl-docker-core/scripts/check-borders.mjs`
 * 的 R4）禁止 `src/**` 出现**对方**的路由前缀字面量 —— 硬编码对方前缀 = 隐性耦合。
 * 而且这条端点本来就属转发侧（本包自己就有 `wsl -l -v` 的读取路径）。
 */
export const DISTROS_PATH = '/dsh-wsl-docker-ports/distros';

export const CONFIG_PAGE_TESTID = {
  root: 'config-page',
  policy: 'config-policy',
  distro: 'config-distro',
  refreshPorts: 'config-refresh-ports',
  refreshContainers: 'config-refresh-containers',
  save: 'config-save',
  confirm: 'config-confirm',
  cancel: 'config-cancel',
  note: 'config-note',
  status: 'config-status',
  scope: 'config-scope',
  readonly: 'config-readonly',
  refresh: 'config-refresh',
} as const;

export interface ConfigPageProps {
  /** 宿主配置页座位**一定**有它（由主包壳注入）；缺失 = 只读 + 写明原因，不抛 */
  readonly settings?: SettingsPipe | undefined;
}

type Policy = (typeof POLICY_OPTIONS)[number]['value'];

/** 页面上的四个可编辑值（= 一次保存要覆盖的全部字段） */
interface Draft {
  readonly distro: string;
  readonly portsRefresh: number;
  readonly containersRefresh: number;
  readonly policy: Policy;
}

const EMPTY_DRAFT: Draft = { distro: '', portsRefresh: 0, containersRefresh: 0, policy: 'none' };

function policyOf(view: SettingsConfigView | null): Policy {
  return view?.elevationPolicy ?? 'none';
}

function refreshOf(record: Record<string, unknown> | null): number {
  const raw = record?.['refreshIntervalSec'];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function distroOf(record: Record<string, unknown> | null): string {
  const raw = record?.['distro'];
  return typeof raw === 'string' ? raw : '';
}

/** 发行版清单：失败不抛（页面照常可编辑手头的值，只是下拉里少几项） */
async function fetchDistros(): Promise<readonly string[]> {
  try {
    const response = await fetch(DISTROS_PATH, { headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    const payload = (await response.json()) as { ok?: unknown; distros?: readonly { name?: unknown }[] };
    if (payload.ok !== true || !Array.isArray(payload.distros)) return [];
    return payload.distros
      .map((item) => (typeof item?.name === 'string' ? item.name : ''))
      .filter((name) => name !== '');
  } catch {
    return [];
  }
}

export function ConfigPage(props: ConfigPageProps): ReactElement {
  const { settings } = props;
  const [view, setView] = useState<SettingsConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  /** 已落盘值的 JSON 指纹：脏判定 = `JSON.stringify(draft) !== signature` */
  const [signature, setSignature] = useState<string>(JSON.stringify(EMPTY_DRAFT));
  const [distros, setDistros] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (settings === undefined) {
      setError('宿主没有提供 settings 服务：本页只读（不会写任何配置）');
      return;
    }
    setBusy(true);
    try {
      const next = await settings.readConfig();
      const containers = await settings.readNamespace(CONTAINERS_SETTINGS_NAMESPACE);
      const loaded: Draft = {
        distro: next.distro ?? distroOf(containers),
        portsRefresh: next.refreshIntervalSec,
        containersRefresh: refreshOf(containers),
        policy: policyOf(next),
      };
      setView(next);
      setDraft(loaded);
      setSignature(JSON.stringify(loaded));
      setConfirming(false);
      setError(null);
    } catch (thrown) {
      setError(`读取配置失败：${thrown instanceof Error ? thrown.message : String(thrown)}（本次不写任何东西）`);
    } finally {
      setBusy(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void fetchDistros().then((names) => {
      if (!cancelled) setDistros(names);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = JSON.stringify(draft) !== signature;
  const policyChanged = draft.policy !== JSON.parse(signature).policy;

  const commit = async (): Promise<void> => {
    if (settings === undefined) return;
    setBusy(true);
    setConfirming(false);
    try {
      const before = JSON.parse(signature) as Draft;
      const messages: string[] = [];
      const failures: string[] = [];
      if (draft.distro !== before.distro) {
        const result = await settings.writeDistro(draft.distro);
        (result.ok ? messages : failures).push(`目标发行版 → ${draft.distro === '' ? '（自动发现）' : draft.distro}`);
      }
      if (draft.portsRefresh !== before.portsRefresh) {
        const result = await settings.writeRefreshInterval(draft.portsRefresh);
        (result.ok ? messages : failures).push(`端口转发页刷新 → ${String(draft.portsRefresh)} 秒`);
      }
      if (draft.policy !== before.policy) {
        const result = await settings.writeElevationPolicy(draft.policy);
        (result.ok ? messages : failures).push(`提权策略 → ${draft.policy}`);
      }
      if (draft.containersRefresh !== before.containersRefresh || draft.distro !== before.distro) {
        const result = await settings.writeNamespace(CONTAINERS_SETTINGS_NAMESPACE, {
          refreshIntervalSec: draft.containersRefresh,
          distro: draft.distro,
        });
        (result.ok ? messages : failures).push(`容器页刷新 → ${String(draft.containersRefresh)} 秒`);
      }
      if (failures.length > 0) {
        setNote(`保存失败：${failures.join('；')}`);
        return;
      }
      setNote(messages.length === 0 ? '没有需要保存的改动' : `设置已保存：${messages.join('；')}`);
      await load();
    } catch (thrown) {
      setNote(`保存抛出异常：${thrown instanceof Error ? thrown.message : String(thrown)}（未重试）`);
    } finally {
      setBusy(false);
    }
  };

  const requestSave = (): void => {
    setNote(null);
    if (policyChanged) {
      setConfirming(true);
      return;
    }
    void commit();
  };

  const scopeRows = view === null ? [] : Object.entries(view.scopes);
  const distroOptions = draft.distro !== '' && !distros.includes(draft.distro) ? [draft.distro, ...distros] : distros;

  return (
    <section className="wdp-cfg" data-testid={CONFIG_PAGE_TESTID.root} aria-busy={busy}>
      <h3>WSL Docker 工具箱 · 配置</h3>
      <p className="wdp-secondary">
        本页是这张卡片唯一的配置入口。改动点「保存设置」才落盘（live 生效，不重挂载）；组件页头上不再有这些控件。
      </p>
      {error === null ? null : (
        <p className="wdp-error" data-testid={CONFIG_PAGE_TESTID.readonly}>
          {error}
        </p>
      )}

      <section className="wdp-cfg-section">
        <h4>目标发行版</h4>
        <p className="wdp-secondary">两个组件共用同一个目标发行版。留空 = 自动发现（优先默认发行版）。</p>
        <label className="wdp-cfg-field" htmlFor={CONFIG_PAGE_TESTID.distro}>
          <span>发行版</span>
          <select
            id={CONFIG_PAGE_TESTID.distro}
            className="wdp-btn"
            data-testid={CONFIG_PAGE_TESTID.distro}
            disabled={busy || settings === undefined}
            value={draft.distro}
            onChange={(event) => {
              setDraft((current) => ({ ...current, distro: event.target.value }));
              setNote(null);
            }}
          >
            <option value="">自动发现</option>
            {distroOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span className="wdp-muted">
            {distros.length === 0 ? '清单读取失败或没有已安装的发行版（不影响手头的值）' : `已安装 ${String(distros.length)} 个发行版`}
          </span>
        </label>
      </section>

      <section className="wdp-cfg-section">
        <h4>刷新频次</h4>
        <p className="wdp-secondary">两个组件各有一档自动刷新间隔（关闭 = 只手动刷新）。</p>
        <label className="wdp-cfg-field" htmlFor={CONFIG_PAGE_TESTID.refreshPorts}>
          <span>端口转发页</span>
          <select
            id={CONFIG_PAGE_TESTID.refreshPorts}
            className="wdp-btn"
            data-testid={CONFIG_PAGE_TESTID.refreshPorts}
            disabled={busy || settings === undefined}
            value={String(draft.portsRefresh)}
            onChange={(event) => {
              setDraft((current) => ({ ...current, portsRefresh: Number(event.target.value) }));
              setNote(null);
            }}
          >
            {REFRESH_INTERVAL_OPTIONS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wdp-cfg-field" htmlFor={CONFIG_PAGE_TESTID.refreshContainers}>
          <span>容器页</span>
          <select
            id={CONFIG_PAGE_TESTID.refreshContainers}
            className="wdp-btn"
            data-testid={CONFIG_PAGE_TESTID.refreshContainers}
            disabled={busy || settings === undefined}
            value={String(draft.containersRefresh)}
            onChange={(event) => {
              setDraft((current) => ({ ...current, containersRefresh: Number(event.target.value) }));
              setNote(null);
            }}
          >
            {REFRESH_INTERVAL_OPTIONS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="wdp-cfg-section">
        <h4>提权策略</h4>
        <p className="wdp-secondary">该档位决定后续写动作的提权行为（改它会弹一次确认）。</p>
        <label className="wdp-cfg-field" htmlFor={CONFIG_PAGE_TESTID.policy}>
          <span>档位</span>
          <select
            id={CONFIG_PAGE_TESTID.policy}
            className="wdp-btn"
            data-testid={CONFIG_PAGE_TESTID.policy}
            disabled={busy || settings === undefined}
            value={draft.policy}
            onChange={(event) => {
              setDraft((current) => ({ ...current, policy: event.target.value as Policy }));
              setConfirming(false);
              setNote(null);
            }}
          >
            {POLICY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="wdp-cfg-save">
        <button
          type="button"
          className="wdp-btn wdp-btn-primary"
          data-testid={CONFIG_PAGE_TESTID.save}
          disabled={busy || settings === undefined || !dirty || confirming}
          onClick={requestSave}
        >
          保存设置
        </button>
        <span className="wdp-muted" role="status" data-testid={CONFIG_PAGE_TESTID.status}>
          {dirty ? '有未保存的改动' : '设置已保存'}
        </span>
      </div>

      {confirming ? (
        <div className="wdp-card" data-testid="config-confirm-panel">
          <p className="wdp-secondary">确认把提权档改成「{draft.policy}」？这只影响后续写动作的行为，不改任何现有规则。</p>
          <button type="button" className="wdp-btn" data-testid={CONFIG_PAGE_TESTID.confirm} disabled={busy} onClick={() => void commit()}>
            确认保存
          </button>
          <button type="button" className="wdp-btn" data-testid={CONFIG_PAGE_TESTID.cancel} onClick={() => setConfirming(false)}>
            取消
          </button>
        </div>
      ) : null}
      {note === null ? null : (
        <p className="wdp-secondary" data-testid={CONFIG_PAGE_TESTID.note}>
          {note}
        </p>
      )}

      <section className="wdp-cfg-section">
        <h4>端口作用域（只读）</h4>
        <p className="wdp-secondary" data-testid={CONFIG_PAGE_TESTID.scope}>
          逐端口切换在右栏页的端口表里；本页只展示当前值，避免同一字段两个写入口。
        </p>
        {scopeRows.length === 0 ? (
          <p className="wdp-muted">还没有逐端口设置（全部按 loopback 处理）</p>
        ) : (
          <ul className="wdp-list">
            {scopeRows.map(([port, scope]) => (
              <li key={port}>
                {port} → {String(scope)}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="wdp-btn" data-testid={CONFIG_PAGE_TESTID.refresh} disabled={busy} onClick={() => void load()}>
          重新读取
        </button>
      </section>
    </section>
  );
}
