/**
 * `apply` 行为面判据（002 T4.1 / T4.3 / T6.1）—— 从 `verify-client-loader.mjs` **整体搬来**，零逻辑改动。
 *
 * 为什么搬：`verify-client-loader.mjs` 涨到 **417 行**，越过「单文件 ≤ 400 行」这条 SHALL；
 * 而这一半判据（真跑 `apply` + 降级 + 卸载）本来就自成一节，搬走后两个文件都在 400 行以内。
 * 判据名单、判据文案、断言强度**一个字都没改** —— 复跑 `check:client` 仍是 59 条全绿 + 4 条反控。
 *
 * 依赖的常量/脚手架全部来自 `./loader-harness.mjs`（不反向 import 主脚本 ⇒ 无循环）。
 */

import {
  OFFICIAL_TAB_KINDS,
  PLUGIN_ID,
  STYLE_PLUGIN_ID,
  createCaptureCtx,
  createFakeDocument,
} from './loader-harness.mjs';

export function checkApplyBehaviour(check, main, loaded) {
  main.record.document = createFakeDocument();
  const run = createCaptureCtx();
  let applyError = null;
  try {
    loaded.apply(run.ctx);
  } catch (error) {
    applyError = error;
  }
  check('apply: 不抛异常', applyError === null, applyError === null ? 'ok' : String(applyError));
  check(
    'apply: 惰性注入的服务就是那两个（sidebarRightTabs / sidebarRight）',
    JSON.stringify(run.captured.services) === JSON.stringify(['sidebarRightTabs', 'sidebarRight']),
    JSON.stringify(run.captured.services),
  );
  check('apply: 注册恰好 1 个页类型', run.captured.tab !== undefined, String(run.captured.tab?.id));
  check(
    'apply: kind = managedTerminal 且不与官方 9 个 kind 重名',
    run.captured.tab?.kind === 'managedTerminal' && !OFFICIAL_TAB_KINDS.includes(run.captured.tab?.kind),
    `kind=${String(run.captured.tab?.kind)}`,
  );
  check(
    'apply: multiple/keepMounted = true 且 priority 缺省（extension 档）',
    run.captured.tab?.multiple === true && run.captured.tab?.keepMounted === true && !('priority' in (run.captured.tab ?? {})),
    `multiple=${String(run.captured.tab?.multiple)} keepMounted=${String(run.captured.tab?.keepMounted)} keys=${Object.keys(run.captured.tab ?? {}).join(',')}`,
  );
  check(
    'apply: 两个 keyed seat（name + key = 包名）',
    run.captured.seats
      .filter((seat) => seat.name !== 'plugins.row.config')
      .map((seat) => `${seat.name}#${seat.key}`)
      .join(',') === `sidebar.right.pane.tab#${PLUGIN_ID},sidebar.right.pane.tab.title#${PLUGIN_ID}`,
    run.captured.seats.map((seat) => `${seat.name}#${seat.key}`).join(','),
  );
  check(
    'apply: 配置页注册进 plugins.row.config 且 key = <包名>#<行 id>（T6.1）',
    run.captured.seats
      .filter((seat) => seat.name === 'plugins.row.config')
      .map((seat) => `${seat.name}#${seat.key}`)
      .join(',') === `plugins.row.config#${PLUGIN_ID}#${PLUGIN_ID}`,
    run.captured.seats.map((seat) => `${seat.name}#${seat.key}`).join(','),
  );
  check(
    'apply: 三次 slots.inject（2 seat + 配置页；官方调用点形状）',
    run.captured.slotInjects.join(',') === 'sidebar.right.pane.tab,sidebar.right.pane.tab.title,plugins.row.config',
    run.captured.slotInjects.join(','),
  );
  check(
    'apply: 5 次 ctx.effect（样式 + 页类型 + 2 seat + 配置页）且都带 label',
    run.captured.effects.length === 5 &&
      run.captured.effects.every((label) => label.startsWith(PLUGIN_ID) || label.startsWith('plugins.row.config')),
    JSON.stringify(run.captured.effects),
  );
  check(
    'apply: 关掉宿主自动表单（inject([settings]) + configure({auto:false}, ctx.fiber)，REQ-10.1 逐字）',
    JSON.stringify(run.captured.serviceCalls) ===
      JSON.stringify([['sidebarRightTabs', 'sidebarRight'], ['settings']]) &&
      run.captured.settingsCalls.length === 1 &&
      run.captured.settingsCalls[0].options.auto === false &&
      run.captured.settingsCalls[0].fiber !== undefined,
    `serviceCalls=${JSON.stringify(run.captured.serviceCalls)} settingsCalls=${JSON.stringify(
      run.captured.settingsCalls.map((call) => ({ auto: call.options.auto, fiber: call.fiber !== undefined })),
    )}`,
  );
  check(
    'apply: 自有样式注入带 data-plugin 标记且恰好 1 个节点（查重生效）',
    main.record.document.nodes.length === 1 && main.record.document.nodes[0].dataset.plugin === STYLE_PLUGIN_ID,
    JSON.stringify(main.record.document.nodes.map((node) => node.dataset.plugin)),
  );
  run.unload();
  check(
    'apply: unload 后页类型与 seat 全撤（注册数归零）',
    run.captured.tabDisposals === 1 && run.captured.seatDisposals >= 4,
    `tab=${run.captured.tabDisposals} seat=${run.captured.seatDisposals}`,
  );
  check('apply: unload 后样式节点被移除（REQ-12.2 不残留）', main.record.document.nodes.length === 0, `剩余 ${main.record.document.nodes.length} 个 style`);

  const degraded = createCaptureCtx({ sidebarRight: false });
  let degradeError = null;
  try {
    loaded.apply({ ...degraded.ctx, inject: (_services, callback) => callback(degraded.scope) });
  } catch (error) {
    degradeError = error;
  }
  check('apply: 缺 sidebarRight 时不抛异常（REQ-4.5）', degradeError === null, String(degradeError));
  check(
    'apply: 缺 sidebarRight 时不注册页类型也不注册 seat（REQ-4.5）',
    degraded.captured.tab === undefined &&
      degraded.captured.seats.filter((seat) => seat.name !== 'plugins.row.config').length === 0,
    `tab=${String(degraded.captured.tab)} seats=${degraded.captured.seats.length}`,
  );
  check(
    'apply: 缺 sidebarRight 时配置页**仍**注册（两个功能各自独立降级，T6.1）',
    degraded.captured.seats.filter((seat) => seat.name === 'plugins.row.config').length === 1,
    degraded.captured.seats.map((seat) => seat.name).join(','),
  );
  check(
    'apply: 缺 sidebarRight 时 console 出原因（不是静默）',
    main.record.warnings.some((line) => line.includes('未注册') && line.includes('sidebarRight')),
    JSON.stringify(main.record.warnings),
  );
  return run;
}
