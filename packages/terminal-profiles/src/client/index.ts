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
 *
 * ## 2026-10-09 缺陷 C 审计结论（本包）
 *
 * 本文件**没有**「同步软取一次、拿不到就早退」那种写法（`apply` 里没有 `return` 分支）⇒
 * 「惰性注入被同步判空挡死」这条**在本包不成立**。但审计挖出**同一后果的另外两条**，都已修：
 * ① **服务只从注入作用域的同名属性读**（`scope.sidebarRightTabs`）—— 而官方调用点里
 *    `scope.<名字>` 与 `scope.get('<名字>')` **两种写法都出现过**，只认一种就会得到「服务其实在、
 *    页面却不出现」；⇒ `registerTerminalTab` 改成两读（`./tab.ts` 的 `softGet`）。
 * ② **等待期零信号**：`ctx.inject` 登记后若回调迟迟不跑，原先**一行日志都没有**，真机无法区分
 *    「还在等」与「确证缺失」（这正是 003 真机那次 0 warning 的成因）；⇒ 登记后立即补一条
 *    `console.warn` 说明「已登记、服务到位即注册（不是失败）」，与 `report()` 的「确证缺失」文案可区分。
 *
 * ## ⚠️ 2026-10-12 订正（上文 ② 的「登记后**立即**补一条 `console.warn`」已作废；原文保留）
 *
 * 真机时序（2026-10-09 探针）是：宿主两个服务在 `apply` 之后约 **240 ms** 才到位、随后注册**成功**
 * ⇒ 那条 warn 打在**正常路径**上，每次正常启动都响一条 = 训练人忽略真告警；当天它还被误当成
 * 「`register()` 从未运行」的**证据**（那是**误读**——文案与事实一致，故这条**不是误报，是正常路径上的噪声**）。
 * 修法（**不动注入语义**）：同步 warn → **排定一条宽限期后才响**的告警（`PENDING_WARN_GRACE_MS`，注入回调
 * 一到就撤掉它）⇒ 正常启动 **0 warn**，回调真的不跑才在宽限期后响一条（可见性没丢）。同族写法：
 * `packages/wsl-docker-ports/src/client/index.ts` 的 `schedulePendingWarn()`；回归门见
 * `tests/unit/client-pending-warn.test.ts`（自带变异哨兵）。
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

/**
 * 「右栏页还没注册」那条告警的**宽限期**（ms）。
 *
 * 真机上宿主服务在 `apply` 之后数百 ms 才到位是**常态**（2026-10-09 探针实测 ~240 ms）⇒ 若在
 * `apply` 末尾同步打 warn，正常启动每次都响一条，等于训练人忽略真告警。故改为**排定**一条超时才响的
 * 告警：正常启动（服务随后到位）由 `register` 撤掉它；回调真的不跑才在宽限期后响一条。
 * 同族写法：`packages/wsl-docker-ports/src/client/index.ts` 的 `DEFAULT_PENDING_WARN_MS` / `schedulePendingWarn()`。
 */
const PENDING_WARN_GRACE_MS = 2000;

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
  /** 「等太久了」那条告警的定时器句柄（`undefined` = 没排 / 已撤） */
  let pendingWarnTimer: ReturnType<typeof setTimeout> | undefined;
  /** 撤掉已排定的 pending 告警（注册到位 / 宿主卸载时各调一次；幂等） */
  const cancelPendingWarn = (): void => {
    if (pendingWarnTimer === undefined) return;
    clearTimeout(pendingWarnTimer);
    pendingWarnTimer = undefined;
  };

  // ① 自有样式（`dtp-` 前缀 + `--dsw-*` token；disposer 交 ctx.effect）
  const styles: StyleInstallation = installTerminalStyles(resolveDocument());
  // 没有 `ctx.effect` 的宿主（老版本 / 测试替身）⇒ 样式**留着**（主动撤掉等于它永远不生效）
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      // 拆插件时连那条「等太久」的告警一起撤掉 —— 否则卸载后它还会冒一条**无主**的 warn
      cancelPendingWarn();
      styles.dispose();
    }, STYLES_EFFECT_LABEL);
  }

  // ② 页类型 + 两个 keyed seat（`sidebarRightTabs` / `sidebarRight` 是**版本相关**服务 ⇒ 惰性注入）
  /** 注入回调是否**已经**跑过（区分「还在等宿主服务」与「确证缺失」——真机缺陷 C 的可见性要求） */
  let injectFired = false;
  const register = (scope: ClientContextLike): void => {
    injectFired = true;
    // 服务到位 ⇒ 那条「等待超时」告警作废（不留一条会误导的排定项；同族实现见 `wsl-docker-ports`）
    cancelPendingWarn();
    report(registerTerminalTab(scope, { pane: TerminalPane, title: TerminalTitle }));
    // ③ 自绘配置页（T6.1）：注册进 `plugins.row.config`，并把宿主自动表单关掉（REQ-10.1）
    reportConfig(registerConfigSlot(scope, { page: boundConfigPage(scope), summary: ConfigSummary }));
  };
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject([...TERMINAL_TAB_SERVICES], register);
    } catch (error) {
      // 登记失败**不许**把整个客户端插件带崩（REQ-4.5 的同一口径）：降级成「直接试一次」并把原因说出来
      console.warn(`${CLIENT_LOG_TAG} inject 登记失败，退回直接注册：${String(error)}`);
      register(ctx);
    }
    // 🔴 服务还没到 ≠ 缺失 —— 但**不许**在这里同步打 warn：真机上服务晚到数百 ms 是常态（2026-10-09
    // 探针 ~240 ms），同步打 = 每次正常启动响一条 ⇒ 训练人忽略真告警（那条 warn 当天还被误当成
    // 「register() 从未运行」的证据 ✗）。改为**排定**一条宽限期后才响的告警：
    //   ① 正常启动（服务随后到位）⇒ `register` 撤掉它 ⇒ 控制台 **0 warn**；
    //   ② 回调真的不跑（宿主确无这两个服务）⇒ 宽限期后仍有一条 warn（可见性没丢，
    //      文案与 `report()` 的「确证缺失」可区分）。
    if (!injectFired) {
      const handle = setTimeout(() => {
        pendingWarnTimer = undefined;
        if (injectFired) return;
        console.warn(
          `${CLIENT_LOG_TAG} 右栏页等待超时（已等 ${PENDING_WARN_GRACE_MS}ms）：已登记 ctx.inject([${TERMINAL_TAB_SERVICES.join(', ')}]) 但宿主服务仍未到位 ⇒ 页不会出现。正常启动时服务在数百 ms 内到位、不会走到这里（这不是失败）`,
        );
      }, PENDING_WARN_GRACE_MS);
      // Node 侧（单测）不许这条定时器拖住进程；浏览器侧的 `setTimeout` 没有 `unref`
      (handle as unknown as { unref?: () => void }).unref?.();
      pendingWarnTimer = handle;
    }
  } else {
    register(ctx);
  }
}
