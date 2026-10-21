/**
 * 010 `T7.3` 的自绘**插件配置页**（在 chunk 里：主包棘轮零余量）。
 *
 * ## 覆盖的字段（`REQ-12.2` 的字段拆分）
 *
 * - `elevationPolicy`：**本页是唯一写入口**（P0 的右栏页那块改成只读 + 指过来，见 `pane-settings.tsx`）。
 * - `scopes`：**只读展示**。逐端口切换留在右栏页的端口表 —— 那是 P0 `T5.3` 的交付物，
 *   再开一个编辑器就成了同一个字段两个写入口（`REQ-12.2` / D-4 明令禁止）。
 *   ⇒ 页面上直说「逐端口切换在右栏页」，并列出当前值。
 *
 * ## 写路径（`REQ-12.1` / U3）
 *
 * 只经 `SettingsPipe`（内部 = `get('remote.settings').update(ns, patch, revision)`）⇒ **live 生效、不重挂载**。
 * 🔴 本文件**没有** `configEditor.edit()`、没有手写 YAML、没有 `ctx.settings.register`（已移除的 API）。
 *
 * ## 两段式保存（`REQ-12.4` / U4）
 *
 * `elevationPolicy` 改的是**安全档位**（后续所有写动作的提权行为）⇒ 点「保存」只**亮出确认条**，
 * 点「确认保存」才落盘。判据：未点确认 ⇒ `update` 调用次数 **0**。
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import type { SettingsConfigView, SettingsPipe } from './settings-pipe.ts';

/** 提权档（与 `../wire.ts` 的 `ELEVATION_POLICIES` 同值；此处另写一份标签，避免把主包模块拖进 chunk） */
const POLICY_OPTIONS = [
  { value: 'none', label: '不自动提权（默认）' },
  { value: 'ask', label: '每次询问' },
  { value: 'passby', label: '直接执行（已有授权）' },
] as const;

export const CONFIG_PAGE_TESTID = {
  root: 'config-page',
  policy: 'config-policy',
  save: 'config-save',
  confirm: 'config-confirm',
  cancel: 'config-cancel',
  note: 'config-note',
  scope: 'config-scope',
  readonly: 'config-readonly',
  refresh: 'config-refresh',
} as const;

export interface ConfigPageProps {
  /** 宿主配置页座位**一定**有它（由主包壳注入）；缺失 = 只读 + 写明原因，不抛 */
  readonly settings?: SettingsPipe | undefined;
}

type Policy = (typeof POLICY_OPTIONS)[number]['value'];

function policyOf(view: SettingsConfigView | null): Policy {
  return view?.elevationPolicy ?? 'none';
}

export function ConfigPage(props: ConfigPageProps): ReactElement {
  const { settings } = props;
  const [view, setView] = useState<SettingsConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Policy>('none');
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
      setView(next);
      setDraft(policyOf(next));
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

  const commit = async (): Promise<void> => {
    if (settings === undefined) return;
    setBusy(true);
    setConfirming(false);
    try {
      const result = await settings.writeElevationPolicy(draft);
      setNote(result.ok ? `已保存：elevationPolicy = ${draft}（live 生效，未重挂载）` : `保存失败：${result.message}`);
      if (result.ok) await load();
    } catch (thrown) {
      setNote(`保存抛出异常：${thrown instanceof Error ? thrown.message : String(thrown)}（未重试）`);
    } finally {
      setBusy(false);
    }
  };

  const scopeRows = view === null ? [] : Object.entries(view.scopes);

  return (
    <section className="wdp-card" data-testid={CONFIG_PAGE_TESTID.root}>
      <h3>WSL Docker 端口转发 · 配置</h3>
      {error === null ? null : (
        <p className="wdp-error" data-testid={CONFIG_PAGE_TESTID.readonly}>
          {error}
        </p>
      )}

      <h4>提权策略（elevationPolicy）</h4>
      <p className="wdp-secondary">
        该档位决定后续写动作提权的行为。只有本页写它（右栏页那块已改成只读并把入口指到这里）。
      </p>
      <select
        className="wdp-btn"
        data-testid={CONFIG_PAGE_TESTID.policy}
        disabled={busy || settings === undefined}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value as Policy);
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
      <button
        type="button"
        className="wdp-btn"
        data-testid={CONFIG_PAGE_TESTID.save}
        disabled={busy || settings === undefined || confirming}
        onClick={() => setConfirming(true)}
      >
        保存（需确认）
      </button>
      {confirming ? (
        <div className="wdp-card" data-testid="config-confirm-panel">
          <p className="wdp-secondary">确认把提权档改成「{draft}」？这只影响后续写动作的行为，不改任何现有规则。</p>
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

      <h4>端口作用域（scopes，只读）</h4>
      <p className="wdp-secondary" data-testid={CONFIG_PAGE_TESTID.scope}>
        逐端口切换在右栏页的端口表里（P0 T5.3 的交付物）；本页只展示当前值，避免同一字段两个写入口。
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
  );
}
