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

import { installConfigStyles } from './config-css.ts';
import { ManagedPortsField } from './config-managed-ports.tsx';
import { WriteChannelSection } from './config-write.tsx';
import {
  checkedPresetsOf,
  distroOf,
  declaredText,
  draftIssues,
  EMPTY_DRAFT,
  mergedManagedPorts,
  policyOf,
  refreshOf,
  type Draft,
  type Policy,
} from './config-model.ts';

import { ConfirmCallout, ConfigSelect, ScopeField, type ScopeRow } from './config-fields.tsx';
import { PORT_PRESETS } from '../diff/port-presets.ts';
import { REFRESH_INTERVAL_OPTIONS } from './refresh.ts';
import type { WriteWiring } from './write-channel.ts';
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
  /**
   * 写通道整包（`undefined` = 未接线 ⇒ 预演控件置灰 + 写明原因）。
   * 017 三订（主人 2026-10-27）：「写通道预演也放到配置页里面去」⇒ 块从右栏页搬到这里。
   */
  readonly write?: WriteWiring | undefined;
  /**
   * 原始输出读取器（017 五订）：放在「写通道预演」子组件**内部**（主人 2026-10-27），
   * **只在用户点开时**调用一次；`undefined` = 未接线 ⇒ 按钮置灰并写明原因。
   */
  readonly loadRawOutput?: (() => Promise<string | null>) | undefined;
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
  const { settings, write, loadRawOutput } = props;
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
        managedPortsText: declaredText(next.managedPorts),
        presets: checkedPresetsOf(next.managedPorts),
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

  // 配置页自己的那套 CSS 在 chunk 里（主包棘轮零余量）：挂载注入、卸载移除
  useEffect(() => installConfigStyles(), []);

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
      const mergedDecl = mergedManagedPorts(draft);
      if (mergedDecl.join('\n') !== mergedManagedPorts(before).join('\n')) {
        const result = await settings.writeManagedPorts(mergedDecl);
        (result.ok ? messages : failures).push(`端口声明 → ${mergedDecl.length === 0 ? '（空）' : mergedDecl.join(', ')}`);
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

  const issues = draftIssues(draft);
  const scopeRows: ScopeRow[] =
    view === null ? [] : Object.entries(view.scopes).map(([port, scope]) => ({ port, scope: String(scope) }));
  const distroOptions = draft.distro !== '' && !distros.includes(draft.distro) ? [draft.distro, ...distros] : distros;
  const disabled = busy || settings === undefined;

  /**
   * 版式 = 宿主插件设置表单的原样（`settings-form/fields.module.css`）：一列 field，
   * 每个 field = 标签行 + 控件 + 说明，相邻 field 之间一条 0.5px 分隔线，
   * 底部一条 footer（状态字在左、保存钮在右）。**不自绘标题**：卡片页上方本来就有
   * 「包名 + 描述」，这里再放一个 h3 只会和宿主标题打架（上一版就是这么丑的）。
   */
  return (
    <section className="wdp-cfg" data-testid={CONFIG_PAGE_TESTID.root} aria-busy={busy}>
      {error === null ? null : (
        <p className="wdp-cfg-hint wdp-cfg-hint-error" data-testid={CONFIG_PAGE_TESTID.readonly}>
          {error}
        </p>
      )}

      <ConfigSelect
        id={CONFIG_PAGE_TESTID.distro}
        testId={CONFIG_PAGE_TESTID.distro}
        label="目标发行版"
        tag="两个组件共用"
        hint={
          distros.length === 0
            ? '清单读取失败或没有已安装的发行版（不影响手头的值）'
            : `已安装 ${String(distros.length)} 个发行版；留空 = 自动发现`
        }
        value={draft.distro}
        options={[{ value: '', label: '自动发现（优先默认发行版）' }, ...distroOptions.map((name) => ({ value: name, label: name }))]}
        disabled={disabled}
        onChange={(next) => {
          setDraft((current) => ({ ...current, distro: next }));
          setNote(null);
        }}
      />

      <ConfigSelect
        id={CONFIG_PAGE_TESTID.refreshPorts}
        testId={CONFIG_PAGE_TESTID.refreshPorts}
        label="端口转发页刷新频次"
        hint="关闭 = 只手动刷新；页头上的旧下拉已删除，这里是唯一入口。"
        value={String(draft.portsRefresh)}
        options={REFRESH_INTERVAL_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
        disabled={disabled}
        onChange={(next) => {
          setDraft((current) => ({ ...current, portsRefresh: Number(next) }));
          setNote(null);
        }}
      />

      <ConfigSelect
        id={CONFIG_PAGE_TESTID.refreshContainers}
        testId={CONFIG_PAGE_TESTID.refreshContainers}
        label="容器页刷新频次"
        hint="与端口转发页各存一份，互不影响。"
        value={String(draft.containersRefresh)}
        options={REFRESH_INTERVAL_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
        disabled={disabled}
        onChange={(next) => {
          setDraft((current) => ({ ...current, containersRefresh: Number(next) }));
          setNote(null);
        }}
      />

      <ConfigSelect
        id={CONFIG_PAGE_TESTID.policy}
        testId={CONFIG_PAGE_TESTID.policy}
        label="提权策略"
        tag="改档需再确认"
        hint="该档位决定后续写动作的提权行为；只改以后的行为，不动任何现有规则。"
        value={draft.policy}
        options={POLICY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        disabled={disabled}
        onChange={(next) => {
          setDraft((current) => ({ ...current, policy: next as Policy }));
          setConfirming(false);
          setNote(null);
        }}
      />

      {confirming ? (
        <ConfirmCallout
          panelTestId="config-confirm-panel"
          confirmTestId={CONFIG_PAGE_TESTID.confirm}
          cancelTestId={CONFIG_PAGE_TESTID.cancel}
          text={`确认把提权档改成「${draft.policy}」？这只影响后续写动作的行为，不改任何现有规则。`}
          busy={busy}
          onConfirm={() => void commit()}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      ) : null}

      <ManagedPortsField
        text={draft.managedPortsText}
        presets={PORT_PRESETS.map((preset) => ({
          name: preset.name,
          label: preset.label,
          port: preset.port,
          checked: draft.presets.includes(preset.name),
        }))}
        issues={issues}
        disabled={disabled}
        onChangeText={(next) => {
          setDraft((current) => ({ ...current, managedPortsText: next }));
          setNote(null);
        }}
        onTogglePreset={(name, on) => {
          setDraft((current) => ({
            ...current,
            // 按表序重排，避免「关了再开」改掉顺序 ⇒ 假脏
            presets: PORT_PRESETS.filter((preset) => (preset.name === name ? on : current.presets.includes(preset.name))).map(
              (preset) => preset.name,
            ),
          }));
          setNote(null);
        }}
      />

      <WriteChannelSection write={write} loadRawOutput={loadRawOutput} />

      <ScopeField        rows={scopeRows}
        hint="逐端口切换在右栏页的端口表里；本页只展示当前值，避免同一字段两个写入口。"
        emptyText="还没有逐端口设置（全部按 loopback 处理）"
        busy={busy}
        scopeTestId={CONFIG_PAGE_TESTID.scope}
        refreshTestId={CONFIG_PAGE_TESTID.refresh}
        onRefresh={() => void load()}
      />

      <div className="wdp-cfg-footer">
        <div className="wdp-cfg-footer-text">
          <p className="wdp-cfg-status" role="status" data-testid={CONFIG_PAGE_TESTID.status}>
            {busy ? '正在处理…' : dirty ? '有未保存的改动' : '设置已保存'}
          </p>
          {note === null ? null : (
            <p
              className={`wdp-cfg-hint${note.includes('失败') || note.includes('异常') ? ' wdp-cfg-hint-error' : ''}`}
              data-testid={CONFIG_PAGE_TESTID.note}
            >
              {note}
            </p>
          )}
        </div>
        <button type="button" className="wdp-save" data-testid={CONFIG_PAGE_TESTID.save} disabled={disabled || !dirty || confirming || issues.length > 0} onClick={requestSave}>
          保存设置
        </button>
      </div>
    </section>
  );
}