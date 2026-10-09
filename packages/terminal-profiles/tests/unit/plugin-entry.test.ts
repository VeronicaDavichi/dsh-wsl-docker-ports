/**
 * T7.1 插件入口（服务导出）+ T7.2 卸载清理打底（tasks.md 166–168 / 170–171）。
 *
 * 零真机：PTY = `fake-pty`，webServer = `ws-server-fakes`，工具注册表 = `tools-define` 的 fake，
 * 宿主模块（schemastery / dsh-tools）= 注入的 fake 端口，订阅节奏 = 手动推进的调度器。
 * ⚠️ 「页类型数」= fake ctx 里的**计数版** `sidebarRightTabs`（本任务不许实现 Phase 4 ⇒ 任何一次注册都会
 * 让计数非 0、测试当场变红）；「resize 监听数」= 订阅监听 + 定时器（Phase 5 的 xterm fit 监听尚未实现 ⇒ 贡献 0）。
 */

import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';

import {
  apply,
  applyTerminalProfiles,
  Config,
  createConfigSchema,
  inject,
  name,
  sandboxGuard,
} from '../../src/plugin.ts';
import { defaultHostModulePort, resolveSchemaFactory } from '../../src/service-export/host-modules.ts';
import { MANAGED_TERMINAL_SERVICE } from '../../src/service-export/types.ts';
import type { HostContextLike, ToolRegisterSurface } from '../../src/tools/index.ts';
import {
  TERM_WS_HTTP_PREFIX,
  TERM_WS_LIST_PATH,
  TERM_WS_UPGRADE_PATH,
} from '../../src/ws/constants.ts';
import { createFakeSubprocess } from '../helpers/fake-pty.ts';
import {
  CONFIG,
  ORIGIN,
  WS_KEY,
  createFakePluginCtx,
  createHostSpy,
  manualSchedule,
} from '../helpers/plugin-fixtures.ts';
import { createFakeTools } from '../helpers/tools-define.ts';
import { createFakeWebServer } from '../helpers/ws-server-fakes.ts';
import { handshakeHeaders } from '../helpers/ws-frames-fixture.ts';

/** 6 个 Agent 工具名（**字面量**：故意不从 `src` 取 —— 改名必须让本文件红，而不是自动跟随） */
const TOOL_NAMES = [
  'managed_terminal_new',
  'managed_terminal_list',
  'managed_terminal_read',
  'managed_terminal_write',
  'managed_terminal_resize',
  'managed_terminal_kill',
] as const;

/* 脚手架（constants / fake ctx / fake 宿主模块端口 / 手动调度器）见 `../helpers/plugin-fixtures.ts` */

/* ────────────────────────── 全量装配（含真实装配路径） ────────────────────────── */

function fullSetup(options: { readonly sandboxPolicy?: unknown } = {}) {
  const subprocess = createFakeSubprocess();
  const webServer = createFakeWebServer();
  const tools = createFakeTools();
  const spy = createHostSpy();
  const schedule = manualSchedule();
  const fakeCtx = createFakePluginCtx({
    webServer: webServer.surface,
    subprocess: subprocess.surface,
    tools: tools.service,
    ...(options.sandboxPolicy === undefined ? {} : { sandboxPolicy: options.sandboxPolicy }),
  });
  const handle = applyTerminalProfiles(fakeCtx.ctx, CONFIG, {
    hostModules: spy.port,
    schedule: schedule.schedule,
    allowedOrigins: [ORIGIN],
  });
  return { subprocess, webServer, tools, spy, fakeCtx, handle, schedule };
}

describe('T7.1 ①/③ 插件入口与「服务导出」的契约', () => {
  it("name 与包名逐字一致；inject 为空（无强依赖 ⇒ 缺任何服务都不拒绝加载）", () => {
    expect(name).toBe('dsh-terminal-profiles');
    expect(inject).toEqual([]);
  });

  it('类型级证据：cordis 真类型接受本插件的 `provide(name, service)` 与「返回 cleanup 的 effect」', () => {
    // ⚠️ 不能直接断言 `Context extends PluginContextLike`：cordis 的 `effect` 要 `() => SyncEffect`
    // （**不含裸 `void`**），而 `ChannelPluginContext` 声明的是 `() => void | (() => void)`（更宽）。
    // 本插件实际**只**调 `ctx.effect(() => { …; return () => void dispose(); })`（见 plugin.ts）⇒
    // 下面两行就是「我们真正用到的形状被真类型接受」的编译期证据（不容则 `tsc` 红）。
    const provide: (name: string, value: unknown) => unknown = null as unknown as Context['provide'];
    const effect: (execute: () => () => void) => unknown = null as unknown as Context['effect'];
    expect([provide, effect].every((member) => member === null)).toBe(true); // 运行时不构造 Context
  });

  it("ctx.provide('managedTerminal', <7 方法服务>)：**恰好一次**，名字逐字", () => {
    const { fakeCtx, handle } = fullSetup();
    expect(MANAGED_TERMINAL_SERVICE).toBe('managedTerminal');
    expect(fakeCtx.provideCalls).toHaveLength(1);
    const call = fakeCtx.provideCalls[0];
    expect(call?.name).toBe('managedTerminal');
    expect(call?.value).toBe(handle.service);
    // 提供的对象上**只有** §5 的 7 个方法（多一个就是第二份契约）
    expect(Object.keys(call?.value as object).sort()).toEqual([
      'kill',
      'list',
      'open',
      'read',
      'resize',
      'subscribe',
      'write',
    ]);
  });

  it('Config = createProfilesSchema(Schema)：volatile 只标在 profiles 数组节点；缺 Schema ⇒ undefined', () => {
    const spy = createHostSpy();
    expect(createConfigSchema(spy.port)).toBeDefined();
    expect(spy.schemaCalls).toContain('object:profiles');
    expect(spy.schemaCalls.filter((entry) => entry.startsWith('volatile'))).toEqual(['volatile:array']);

    // 拿不到宿主 schemastery 时**不造假 schema**（假 schema 会让 volatile 静默失效）
    expect(createConfigSchema({ load: () => undefined })).toBeUndefined();
  });

  it('宿主命名空间是**可调用对象**（真机 schemastery 形状：无 default、无 Schema）时也认', () => {
    const spy = createHostSpy({ schemaShape: 'callable' });
    expect(createConfigSchema(spy.port)).toBeDefined();
    expect(spy.schemaCalls.filter((entry) => entry.startsWith('volatile'))).toEqual(['volatile:array']);
  });

  it('静态 Config 与缺省端口的解析结果**一致**（依赖在位 ⇒ 有 schema；不在位 ⇒ undefined）', () => {
    const resolved = resolveSchemaFactory(defaultHostModulePort());
    if (resolved === undefined) expect(Config).toBeUndefined();
    else expect(Config).toBeDefined();
  });
});

describe('T7.1 ② 无消费方时不报错、不注册多余内容（装载面）', () => {
  it('最小 ctx（无 webServer / subprocess / tools / 003）⇒ 不抛、服务照导出、零多余注册', () => {
    const fakeCtx = createFakePluginCtx({});
    expect(() => apply(fakeCtx.ctx, CONFIG)).not.toThrow();
    expect(fakeCtx.provideCalls.map((call) => call.name)).toEqual(['managedTerminal']);
    expect(fakeCtx.footerRegistrations()).toBe(0); // 页类型（Phase 4）不注册
    expect(fakeCtx.effectCount()).toBe(1); // 只有我们自己的 teardown 收编（没有路由 ⇒ 没有那两条）
  });

  it('连 config 都没有也不崩（Config 缺 Schema 时宿主可能什么都不传）', () => {
    const fakeCtx = createFakePluginCtx({});
    expect(() => apply(fakeCtx.ctx)).not.toThrow();
    const handle = applyTerminalProfiles(fakeCtx.ctx, undefined, { hostModules: createHostSpy().port });
    expect(handle.toolNames).toEqual([]);
    expect(handle.routeCount()).toBe(0);
    expect(handle.service.list()).toEqual([]);
  });

  it('工具面**半途**失败 ⇒ 记 gap + 回滚已注册项，且不拖垮整包（真机：宿主拒绝参数表）', () => {
    const tools = createFakeTools();
    let seen = 0;
    const flaky: ToolRegisterSurface = {
      register(definition) {
        seen += 1;
        if (seen === 3) throw new Error('unsupported JSON schema: schema.required …');
        return tools.service.register(definition);
      },
    };
    const fakeCtx = createFakePluginCtx({ tools: flaky, subprocess: createFakeSubprocess().surface });
    const handle = applyTerminalProfiles(fakeCtx.ctx, CONFIG, { hostModules: createHostSpy().port });

    expect(seen).toBe(3); // 前两个真注册上去了（所以回滚不是空跑）
    expect(tools.names).toEqual([]); // 半途失败 ⇒ 全部撤回，不留残渣（REQ-12.2）
    expect(handle.toolNames).toEqual([]);
    expect(handle.gaps.map((gap) => gap.what)).toContain('tools');
    expect(fakeCtx.provideCalls.map((call) => call.name)).toEqual(['managedTerminal']); // 其余面照常
  });

  it('缺什么就记什么（不静默降级）：subprocess / tools / webServer / allowedOrigins 各有 gap', () => {
    const fakeCtx = createFakePluginCtx({});
    const handle = applyTerminalProfiles(fakeCtx.ctx, CONFIG, {
      hostModules: createHostSpy({ tools: false }).port,
    });
    expect(handle.gaps.map((gap) => gap.what).sort()).toEqual([
      'allowedOrigins',
      'subprocess',
      'tools',
      'webServer',
    ]);
    for (const gap of handle.gaps) expect(gap.reason).not.toBe('');
  });
});

describe('T7.2 卸载清理：全部计数归零 + 全部实例被终止', () => {
  it('装载：路由 2 条、工具 6 个、1 条活连接、1 个订阅监听 / 定时器', async () => {
    const { webServer, tools, fakeCtx, handle } = fullSetup();
    const first = await handle.service.open({ profile: 'pwsh' });
    const second = await handle.service.open({ profile: 'wsl' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const token = handle.tokens.issue();
    webServer.invokeUpgrade(TERM_WS_UPGRADE_PATH, {
      headers: handshakeHeaders(token, ORIGIN, { 'sec-websocket-key': WS_KEY }),
    });

    handle.service.subscribe(first.value.id, () => undefined);
    expect(webServer.liveCount()).toBe(2);
    expect(handle.routeCount()).toBe(2);
    expect(webServer.registerCalls).toEqual([{ kind: 'prefix', path: TERM_WS_HTTP_PREFIX }]);
    expect(webServer.upgradeCalls).toEqual([{ path: TERM_WS_UPGRADE_PATH }]);
    expect(tools.names).toEqual([...TOOL_NAMES]);
    expect(handle.toolNames).toEqual([...TOOL_NAMES]);
    expect(handle.channel?.channel.activeCount).toBe(1);
    expect(handle.serviceHost.listenerCount()).toBe(1);
    expect(handle.serviceHost.tickerCount()).toBe(1);
    expect(fakeCtx.footerRegistrations()).toBe(0);
  });

  it('卸载：WS 连接 / 路由 / 页类型 / 工具 / 监听 / 定时器全归零，且 terminate 调用数 = 实例数', async () => {
    const { subprocess, webServer, tools, fakeCtx, handle } = fullSetup();
    const first = await handle.service.open({ profile: 'pwsh' });
    const second = await handle.service.open({ profile: 'wsl' });
    if (!first.ok || !second.ok) throw new Error('装配失败：open 没成功');
    handle.service.subscribe(first.value.id, () => undefined);
    webServer.invokeUpgrade(TERM_WS_UPGRADE_PATH, {
      headers: handshakeHeaders(handle.tokens.issue(), ORIGIN, { 'sec-websocket-key': WS_KEY }),
    });
    expect(handle.channel?.channel.activeCount).toBe(1);

    fakeCtx.unload(); // 宿主卸载（effect 清理逆序：我们的 teardown 最先跑）
    await handle.dispose();

    expect(handle.channel?.channel.activeCount).toBe(0); // WS 连接
    expect(webServer.liveCount()).toBe(0); // 路由 + upgrade
    expect(handle.routeCount()).toBe(0);
    expect(tools.names).toEqual([]); // 工具
    expect(fakeCtx.footerRegistrations()).toBe(0); // 页类型
    expect(handle.serviceHost.listenerCount()).toBe(0); // 监听（含 resize/输出订阅）
    expect(handle.serviceHost.tickerCount()).toBe(0); // 定时器
    expect(handle.service.list()).toEqual([]); // 实例表清空
    expect(subprocess.handles.map((h) => h.terminateCount)).toEqual([1, 1]); // kill 调用数 = 实例数
    expect(subprocess.handles.every((h) => h.terminated)).toBe(true);
    // 路由真的没了：原来的枚举路径回落到官方行为（不是「注册了但答得动」）
    expect((await webServer.invokeHttp(TERM_WS_LIST_PATH)).status).toBe('fallback');
  });

  it('卸载后可**重新装载**：同一份 webServer 不撞「重复 (kind, path) 抛错」（REQ-7.6）', async () => {
    const { webServer, fakeCtx, handle } = fullSetup();
    fakeCtx.unload();
    await handle.dispose();

    const again = createFakePluginCtx({
      webServer: webServer.surface,
      subprocess: createFakeSubprocess().surface,
      tools: createFakeTools().service,
    });
    const reloaded = applyTerminalProfiles(again.ctx, CONFIG, {
      hostModules: createHostSpy().port,
      schedule: manualSchedule().schedule,
      allowedOrigins: [ORIGIN],
    });
    expect(reloaded.channel?.registered).toBe(true);
    expect(webServer.duplicateAttempts).toBe(0);
    expect(webServer.liveCount()).toBe(2);
    again.unload();
    await reloaded.dispose();
    expect(webServer.liveCount()).toBe(0);
  });
});

describe('沙箱口径（2026-10-09 裁决）：服务面**默认不过门**，端口保留可切换', () => {
  it('read-only 沙箱下缺省 open 仍成功（沙箱管 Agent 写入，不管用户/宿主能力）', async () => {
    const { handle } = fullSetup({ sandboxPolicy: { resolve: () => ({ mode: 'read-only' }) } });
    const opened = await handle.service.open({ profile: 'pwsh' });
    expect(opened.ok).toBe(true);
  });

  it('想切换时传 deps.guard ⇒ 同一份策略生效（read-only 下 open 被拒，且不 spawn）', async () => {
    const subprocess = createFakeSubprocess();
    const tools = createFakeTools();
    const fakeCtx = createFakePluginCtx({
      webServer: createFakeWebServer().surface,
      subprocess: subprocess.surface,
      tools: tools.service,
      sandboxPolicy: { resolve: () => ({ mode: 'read-only' }) },
    });
    const policyCtx: HostContextLike = {
      tools: tools.service,
      get: (serviceName: string) => fakeCtx.ctx.get(serviceName),
    };
    const handle = applyTerminalProfiles(fakeCtx.ctx, CONFIG, {
      hostModules: createHostSpy().port,
      allowedOrigins: [ORIGIN],
      guard: (action) => sandboxGuard(policyCtx, action),
    });
    const opened = await handle.service.open({ profile: 'pwsh' });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.code).toBe('sandbox-denied');
    expect(subprocess.spawnCalls).toHaveLength(0);
    await handle.dispose();
  });
});
