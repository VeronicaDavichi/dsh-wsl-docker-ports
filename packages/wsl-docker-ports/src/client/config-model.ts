/**
 * 配置页的数据模型（从 `config-page.tsx` 拆出来：那个文件贴着 400 行 SHALL，
 * 而且这些函数**与 React 无关**，放一起更好测）。
 *
 * 口径：页面上能改的一共两组东西 ——
 * ① 三个「配置值」（提权档 / 两个刷新频次 / 目标发行版）；
 * ② 端口声明（`managedPorts` 区间原文 + presets 勾选），它和前三个共用底部那一个
 *    「保存设置」（主人 2026-10-27 拍板：并入同一个保存钮，不另开第二个）。
 */

import { isManagedPort, type ManagedPorts } from '../diff/managed-ports.ts';
import { PORT_PRESETS } from '../diff/port-presets.ts';
import { mergeManagedPortsDecl, managedPortsIssues, managedPortsText } from './rows.ts';
import type { SettingsConfigView } from './settings-pipe.ts';

export type Policy = 'none' | 'ask' | 'passby';

/** 页面上的可编辑值（= 一次保存要覆盖的全部字段） */
export interface Draft {
  readonly distro: string;
  readonly portsRefresh: number;
  readonly containersRefresh: number;
  readonly policy: Policy;
  /** 端口声明区间原文（多行 / 逗号都算分隔，原文原样回写） */
  readonly managedPortsText: string;
  /** 勾选的 presets（按 `name` 存，保存时映射回端口号） */
  readonly presets: readonly string[];
}

export const EMPTY_DRAFT: Draft = {
  distro: '',
  portsRefresh: 0,
  containersRefresh: 0,
  policy: 'none',
  managedPortsText: '',
  presets: [],
};

export function policyOf(view: SettingsConfigView | null): Policy {
  return view?.elevationPolicy ?? 'none';
}

export function refreshOf(record: Record<string, unknown> | null): number {
  const raw = record?.['refreshIntervalSec'];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function distroOf(record: Record<string, unknown> | null): string {
  const raw = record?.['distro'];
  return typeof raw === 'string' ? raw : '';
}

/** presets 勾选名 → 端口号（按 `PORT_PRESETS` 的表序，与 UI 展示顺序一致） */
export function presetPortsOf(draft: Draft): readonly number[] {
  return PORT_PRESETS.filter((preset) => draft.presets.includes(preset.name)).map((preset) => preset.port);
}

/** 区间原文 + 勾选的 presets → 声明数组（`mergeManagedPortsDecl` 是既有纯函数，语义一字不动） */
export function mergedManagedPorts(draft: Draft): string[] {
  return mergeManagedPortsDecl(draft.managedPortsText, presetPortsOf(draft));
}

/** 从已落盘的声明反推 presets 勾选态（`isManagedPort` 是同一套区间语义，不另写判断） */
export function checkedPresetsOf(declared: readonly string[]): readonly string[] {
  const parsed = managedPortsIssues(declared);
  if (parsed.ports === null) return [];
  const ports: ManagedPorts = parsed.ports;
  return PORT_PRESETS.filter((preset) => isManagedPort(ports, preset.port)).map((preset) => preset.name);
}

/** 当前草稿的非法项原因（空 = 合法，可保存） */
export function draftIssues(draft: Draft): readonly string[] {
  return managedPortsIssues(mergedManagedPorts(draft)).issues;
}

/** 已落盘声明的可读原文（右栏页只读展示用同一份口径） */
export function declaredText(declared: readonly string[]): string {
  return managedPortsText(declared);
}
