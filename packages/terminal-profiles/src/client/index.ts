/**
 * 客户端入口（002 T4.1 / REQ-4.1 / REQ-4.4 / REQ-4.5）
 *
 * 📌 **形状照抄实物**（`client-contract.md` §B5/B7/A2）：
 *   - 导出 = `{ apply, inject, name? }`，**没有默认导出**（与宿主半 `export default {…}` **相反**，别照抄）；
 *   - 入口 `inject` 只放**稳定服务**（本包 = `['slots']`）。官方注释原文：声明了却缺失的服务会让
 *     **整个客户端插件 load 失败**（不是局部失效）⇒ 版本相关的 `sidebarRightTabs` / `sidebarRight`
 *     一律**不进**入口 `inject`，改在 `apply` 里用 `ctx.inject([...])` 惰性等待 + 缺能力降级（REQ-4.5）。
 *   - ⚠️ 别与清单里的 `dsh.client.inject` 混：那个是**信息性包名数组**（官方注释 *"not Cordis service injection"*），
 *     本包不 require 任何 `@deepseek-ai/*` 运行时模块 ⇒ 清单里为空（见 `package.json` 与本包回报）。
 *
 * 本文件只做三件事：注入自有样式（`ctx.effect` 收编）→ 惰性等两个右栏服务 → 注册页类型 + 两个 seat。
 * 页类型/页体/标题**全在客户端半**注册，宿主半零改动（§C11）。
 */

import { ConfigPage, ConfigSummary } from './config-page.tsx';
import { createConfigPipe } from './config-pipe.ts';
import type { RemoteSettingsLike } from './config-pipe.ts';
import { registerConfigSlot } from './config-slot.ts';
import type { ConfigSlotResult } from './config-slot.ts';
import { TerminalPane, TerminalTitle } from './TerminalPane.tsx';
import { installTerminalStyles, resolveDocument } from './styles.ts';
import type { StyleInstallation } from './styles.ts';
import { registerTerminalTab, TERMINAL_TAB_SERVICES } from './tab.ts';
import type { ClientContextLike, TabRegistrationResult } from './tab.ts';

/** 稳定服务：`slots` 是页/面板的通用能力（§C10），本包在入口就声明是安全的 */
export const inject = ['slots'];

export const name = 'dsh-terminal-profiles-client';

/** 日志前缀（降级原因必须**可见** —— 静默不注册等于「页面莫名其妙不出现」）；**不导出**（出参只留 apply/inject/name） */
const CLIENT_LOG_TAG = '[dsh-terminal-profiles]';
/** 样式清理动作的 effect label（与 `tab.ts` 的 label 前缀同族，便于宿主诊断） */
const STYLES_EFFECT_LABEL = 'dsh-terminal-profiles: styles';

/** `remote.settings` 的服务名（contract §D13；客户端没有 `ctx.settings`，写回只走它） */
const REMOTE_SETTINGS_SERVICE = 'remote.settings';

function report(result: TabRegistrationResult): void {
  if (result.registered) return;
  console.warn(`${CLIENT_LOG_TAG} 右栏终端页未注册：${result.reason ?? '原因未知'}`);
}

function reportConfig(result: ConfigSlotResult): void {
  if (result.registered) return;
  console.warn(`${CLIENT_LOG_TAG} 配置页未注册：${result.reason ?? '原因未知'}`);
  if (result.autoForm.kind === 'unavailable') {
    console.warn(`${CLIENT_LOG_TAG} 宿主自动表单未关闭：${result.autoForm.reason}`);
  }
}

/** `remote.settings` 的结构面校验（`ctx.get` 可能返回任何东西 ⇒ 先验形状再交给管道） */
function isRemoteSettings(value: unknown): value is RemoteSettingsLike {
  const candidate = value as Partial<RemoteSettingsLike> | null | undefined;
  return typeof candidate?.describe === 'function' && typeof candidate?.update === 'function';
}

/**
 * 把写回管道绑进页面：管道**每次注册只造一次**（惰性软取 `remote.settings`，绝不缓存 `undefined`），
 * 页面组件是纯函数组件 ⇒ 用一层闭包喂 `pipe`，不往组件里塞可变全局。
 */
function boundConfigPage(scope: ClientContextLike): () => unknown {
  const pipe = createConfigPipe(() => {
    const value = scope.get?.(REMOTE_SETTINGS_SERVICE);
    return isRemoteSettings(value) ? value : undefined;
  });
  return function ConfigPageBound(): unknown {
    return ConfigPage({ pipe });
  };
}

/**
 * 客户端插件入口（宿主按 `exports["./client"]` 装载后调用）。
 *
 * 返回 `void`：注册的清理一律经 `ctx.effect`（宿主不自动回收 disposer，§C9）——
 * 这里**不**靠返回值交还清理函数，免得与宿主对 `apply` 返回值的处理方式耦合。
 */
export function apply(ctx: ClientContextLike): void {
  // ① 自有样式（`dtp-` 前缀 + `--dsw-*` token；disposer 交 ctx.effect）
  const styles: StyleInstallation = installTerminalStyles(resolveDocument());
  // 没有 `ctx.effect` 的宿主（老版本 / 测试替身）⇒ 样式**留着**（主动撤掉等于它永远不生效）
  if (typeof ctx.effect === 'function') ctx.effect(() => styles.dispose, STYLES_EFFECT_LABEL);

  // ② 页类型 + 两个 keyed seat（`sidebarRightTabs` / `sidebarRight` 是**版本相关**服务 ⇒ 惰性注入）
  const register = (scope: ClientContextLike): void => {
    report(registerTerminalTab(scope, { pane: TerminalPane, title: TerminalTitle }));
    // ③ 自绘配置页（T6.1）：注册进 `plugins.row.config`，并把宿主自动表单关掉（REQ-10.1）
    reportConfig(registerConfigSlot(scope, { page: boundConfigPage(scope), summary: ConfigSummary }));
  };
  if (typeof ctx.inject === 'function') ctx.inject([...TERMINAL_TAB_SERVICES], register);
  else register(ctx);
}
