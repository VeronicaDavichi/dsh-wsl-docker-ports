// @vitest-environment jsdom
/**
 * 008 T3.1 判据：**页面侧接线**（契约 5/6/7 + 1/2 的入口）
 *
 * 这里跑的是**真组件 + 真通道客户端 + 假 fetch**：所以「确认 ⇒ 恰好一次 apply」
 * 与「body 只含白名单字段」是在**真的序列化路径**上验的，不是靠 mock 通道假装。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createWriteChannel, type WriteChannel, type WriteWiring } from '../../src/client/write-channel.ts';
import { WRITE_TESTID } from '../../src/client/write-confirm.tsx';
import { WriteChannelBlock } from '../../src/client/write-panel.tsx';
import { createWriteTokenStore, type StorageLike } from '../../src/client/write-token.ts';
import { applyPayload, CMD_PORT_PROXY, createFetchRig, errorBody, planPayload, TEST_TOKEN } from './write-fixtures.ts';
import type { FetchRig } from './write-fixtures.ts';

afterEach(() => {
  cleanup();
});

function tokenStore(token: string | undefined): ReturnType<typeof createWriteTokenStore> {
  const box = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => {
      box.set(key, value);
    },
    removeItem: (key) => {
      box.delete(key);
    },
  };
  const store = createWriteTokenStore(storage);
  if (token !== undefined) store.save(token);
  return store;
}

function wiringFor(rig: FetchRig, options: { readonly token?: string | undefined; readonly declarationOk?: boolean } = {}): { readonly wiring: WriteWiring; readonly channel: WriteChannel } {
  const channel = createWriteChannel({ token: () => tokenStore(options.token ?? TEST_TOKEN).read(), fetchImpl: rig.fetchImpl });
  const wiring: WriteWiring = {
    channel,
    tokenStore: tokenStore(options.token ?? TEST_TOKEN),
    declaration: async () => (options.declarationOk === false ? { ok: false, message: '声明里有 1 处非法项 ⇒ 零请求' } : { ok: true, ports: [{ start: 3306, end: 3306 }] }),
  };
  return { wiring, channel };
}

function renderBlock(rig: FetchRig, options: { readonly token?: string | undefined; readonly enabled?: boolean } = {}): WriteChannel {
  const { wiring, channel } = wiringFor(rig, options);
  render(<WriteChannelBlock write={wiring} enabled={options.enabled ?? true} disabledReason={null} />);
  return channel;
}

/** 填端口 → 点预演 */
async function preview(ports = '3306'): Promise<void> {
  fireEvent.change(screen.getByTestId(WRITE_TESTID.ports), { target: { value: ports } });
  fireEvent.click(screen.getByTestId(WRITE_TESTID.preview));
}

describe('T3.1 未点确认 ⇒ 零请求', () => {
  it('挂载后：fetch 0 次、requestCount 0、对话框不渲染', () => {
    const rig = createFetchRig([{ status: 200, payload: planPayload() }]);
    const channel = renderBlock(rig);
    expect(rig.calls).toHaveLength(0);
    expect(channel.requestCount()).toBe(0);
    expect(screen.queryByTestId(WRITE_TESTID.dialog)).toBeNull();
    expect(screen.queryByTestId(WRITE_TESTID.result)).toBeNull();
    console.log('  · 扫了 1 次挂载：fetch 0 / requestCount 0 / 无对话框');
  });

  it('端口文本非法 ⇒ 本地拦下（零请求）+ 可读原因', async () => {
    const rig = createFetchRig([{ status: 200, payload: planPayload() }]);
    renderBlock(rig);
    await preview('3306 abc');
    expect(rig.calls).toHaveLength(0);
    expect((await screen.findByTestId(WRITE_TESTID.notice)).textContent).toContain('零请求');
    console.log('  · 扫了 1 条非法端口：fetch 0 次、原因含「零请求」');
  });

  it('本会话没有凭据 ⇒ 零请求 + 指路到右栏页的凭据块', async () => {
    const rig = createFetchRig([{ status: 200, payload: planPayload() }]);
    renderBlock(rig, { token: '' });
    await preview('3306');
    expect(rig.calls).toHaveLength(0);
    const notice = (await screen.findByTestId(WRITE_TESTID.notice)).textContent ?? '';
    expect(notice).toContain('凭据');
    expect(notice).toContain('生成并保存写通道凭据');
    console.log('  · 扫了 1 条无凭据路径：fetch 0 次、指路文案命中');
  });

  it('所有权声明非法 ⇒ 零请求 + 逐项原因', async () => {
    const rig = createFetchRig([{ status: 200, payload: planPayload() }]);
    const { wiring } = wiringFor(rig, { declarationOk: false });
    render(<WriteChannelBlock write={wiring} enabled disabledReason={null} />);
    await preview('3306');
    expect(rig.calls).toHaveLength(0);
    expect((await screen.findByTestId(WRITE_TESTID.notice)).textContent).toContain('零请求');
    console.log('  · 扫了 1 条声明非法路径：fetch 0 次');
  });

  it('未接线（write 字段缺失）⇒ 写控件全灰、零请求', () => {
    const rig = createFetchRig([]);
    render(<WriteChannelBlock write={undefined} enabled disabledReason={null} />);
    const controls = screen.getByTestId(WRITE_TESTID.block).querySelectorAll('[data-write-control]');
    const clickable = screen.getByTestId(WRITE_TESTID.block).querySelectorAll('[data-write-control]:not([disabled])');
    expect(controls.length).toBeGreaterThan(0);
    expect(clickable).toHaveLength(0);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.preview));
    expect(rig.calls).toHaveLength(0);
    console.log(`  · 扫了 ${String(controls.length)} 个写控件：可点 0 / fetch 0（未接线）`);
  });

  it('外部前置未过（非 NAT）⇒ 写控件全灰，取消点击也零请求', () => {
    const rig = createFetchRig([]);
    renderBlock(rig, { enabled: false });
    const clickable = screen.getByTestId(WRITE_TESTID.block).querySelectorAll('[data-write-control]:not([disabled])');
    expect(clickable).toHaveLength(0);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.preview));
    expect(rig.calls).toHaveLength(0);
    console.log('  · 扫了 1 组非 NAT 控件：可点 0 / fetch 0');
  });
});

describe('T3.1 确认 ⇒ 恰好一次 apply，且 body 只含白名单字段', () => {
  it('预演发 1 次 plan；确认发 1 次 apply；body 五键 + target 与 plan 时逐字相同', async () => {
    const rig = createFetchRig([
      { status: 200, payload: planPayload({ scope: 'lan' }) },
      { status: 200, payload: applyPayload() },
    ]);
    const channel = renderBlock(rig);
    await preview('3306');
    await screen.findByTestId(WRITE_TESTID.dialog);
    expect(rig.planCalls()).toHaveLength(1);
    expect(rig.applyCalls()).toHaveLength(0);
    expect((screen.getByTestId(WRITE_TESTID.confirm) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId(WRITE_TESTID.confirm));
    await screen.findByTestId(WRITE_TESTID.result);
    expect(rig.planCalls()).toHaveLength(1);
    expect(rig.applyCalls()).toHaveLength(1);
    expect(channel.requestCount()).toBe(2);
    const applyCall = rig.applyCalls()[0];
    expect(Object.keys(applyCall?.body ?? {})).toEqual(['target', 'planId', 'confirmed', 'origin', 'ticket']);
    expect(applyCall?.body['planId']).toBe('plan-abcdef0123456789');
    expect(applyCall?.body['ticket']).toBe('tkt-1');
    expect(applyCall?.body['origin']).toBe('user');
    expect(applyCall?.body['confirmed']).toBe(true);
    // plan 与 apply 的 target 逐字相同（含 declaration）——否则服务端重算必然 plan-mismatch
    expect(applyCall?.body['target']).toEqual(rig.planCalls()[0]?.body);
    expect((applyCall?.body['target'] as Record<string, unknown>)['declaration']).toEqual([{ start: 3306, end: 3306 }]);
    // 🔴 命令原文绝不进请求体
    expect(applyCall?.rawBody).not.toContain('netsh');
    expect(applyCall?.rawBody).not.toContain(CMD_PORT_PROXY);
    expect(rig.unexpected()).toBe(0);
    console.log(`  · 扫了 1 轮：plan 1 / apply 1 / body 5 键 / rawBody 里 netsh 0 次 / 无多余请求`);
  });

  it('取消 ⇒ 计划作废、零 apply（连点确认也不会重复发）', async () => {
    const rig = createFetchRig([{ status: 200, payload: planPayload() }]);
    renderBlock(rig);
    await preview('3306');
    await screen.findByTestId(WRITE_TESTID.dialog);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.cancel));
    await waitFor(() => {
      expect(screen.queryByTestId(WRITE_TESTID.dialog)).toBeNull();
    });
    expect(rig.applyCalls()).toHaveLength(0);
    expect(rig.calls).toHaveLength(1);
    expect(screen.getByTestId(WRITE_TESTID.notice).textContent).toContain('零请求');
    console.log('  · 扫了 1 次取消：apply 0 次、总请求停在 1');
  });
});

/**
 * 2026-10-16 `fix` 扩面（009 `REQ-7.2`：`action ∈ {add, remove, fix}`）。
 *
 * 判据：① 面板能选到「修复」且**零请求**（选动作本身不发请求）；② `plan` 的请求体 = **声明式目标**（四键），
 * `action === 'fix'`；③ 确认后 `apply` 的 `target` 与 `plan` 的体**逐字相同**（否则服务端重算必 `plan-mismatch`）；
 * ④ 影响面**不说**「会新增 1 条 portproxy 规则」（`fix` 是先删后加）；⑤ 命令原文**不与**请求体混在一起。
 */
describe('2026-10-16 fix 扩面：面板选「修复」⇒ 声明式目标 action=fix，apply 同体', () => {
  it('选 fix → 预演（1 次 plan，体四键）→ 确认（1 次 apply，target 逐字相同）；影响面不说「新增」', async () => {
    const rig = createFetchRig([
      { status: 200, payload: planPayload({ action: 'fix', scope: 'lan' }) },
      { status: 200, payload: applyPayload() },
    ]);
    renderBlock(rig);
    // ① 选动作：零请求 + 提示条出现（作用域沿用既有规则）
    fireEvent.change(screen.getByTestId(WRITE_TESTID.action), { target: { value: 'fix' } });
    expect((screen.getByTestId(WRITE_TESTID.action) as HTMLSelectElement).value).toBe('fix');
    expect(screen.getByTestId(WRITE_TESTID.fixHint).textContent).toContain('沿用既有规则');
    expect(rig.calls).toHaveLength(0);

    // ② 预演：体就是目标本身（四键），action=fix
    await preview('3306');
    await screen.findByTestId(WRITE_TESTID.dialog);
    expect(rig.planCalls()).toHaveLength(1);
    const planBody = rig.planCalls()[0]?.body ?? {};
    expect(Object.keys(planBody)).toEqual(['action', 'ports', 'scope', 'declaration']);
    expect(planBody['action']).toBe('fix');
    expect(planBody['ports']).toEqual([3306]);

    // ④ 影响面：fix 不许说「新增 1 条 portproxy 规则」
    const impact = screen.getByTestId(WRITE_TESTID.impact).textContent ?? '';
    expect(impact).toContain('净增 0 条');
    expect(impact).not.toContain('会新增 1 条 portproxy 规则');

    // ③ 确认：apply 的 target 与 plan 体逐字相同；⑤ 命令原文不进请求体
    fireEvent.click(screen.getByTestId(WRITE_TESTID.confirm));
    await screen.findByTestId(WRITE_TESTID.result);
    expect(rig.applyCalls()).toHaveLength(1);
    expect(rig.applyCalls()[0]?.body['target']).toEqual(planBody);
    expect(rig.applyCalls()[0]?.rawBody).not.toContain('netsh');
    expect(rig.unexpected()).toBe(0);
    console.log('  · 扫了 fix 一轮：选动作 0 请求 / plan 体四键 action=fix / apply 同体 / 影响面「净增 0 条」');
  });
});

/**
 * ⑬（2026-10-16 收口）：选 `remove` 也要**当场说明**作用域不由选择器决定（否则用户会以为「选了 loopback
 * 就只删回环那条」，而服务端其实沿用既有规则的 listen address）。
 */
describe('2026-10-16 remove：选「移除」⇒ 提示条明说作用域沿用既有规则（零请求）', () => {
  it('选 remove → 提示条在场 + 0 请求', () => {
    const rig = createFetchRig([]);
    renderBlock(rig);
    fireEvent.change(screen.getByTestId(WRITE_TESTID.action), { target: { value: 'remove' } });
    expect((screen.getByTestId(WRITE_TESTID.action) as HTMLSelectElement).value).toBe('remove');
    const hint = screen.getByTestId(WRITE_TESTID.removeHint).textContent ?? '';
    expect(hint).toContain('沿用既有规则');
    expect(hint).toContain('自己的');
    expect(rig.calls).toHaveLength(0);
    console.log('  · 扫了 remove 提示条：沿用既有规则 + 0 请求');
  });
});

describe('T3.1 提权档联动：不可能成功的操作连按钮都不给点', () => {
  it('policy=none ⇒ 确认置灰，点了也零 apply', async () => {
    const rig = createFetchRig([{ status: 200, payload: planPayload({ policy: 'none' }) }]);
    renderBlock(rig);
    await preview('3306');
    await screen.findByTestId(WRITE_TESTID.dialog);
    const confirm = screen.getByTestId(WRITE_TESTID.confirm) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(rig.applyCalls()).toHaveLength(0);
    expect(screen.getByTestId(WRITE_TESTID.gate).textContent).toContain('none');
    console.log('  · 扫了 policy=none：disabled=true / apply 0 次 / 原因含 none');
  });
});

describe('T3.1 票据失效 / 计划不符 ⇒ 重新 plan + 重新确认（不静默重试）', () => {
  it('apply 回 409 ⇒ apply 只发 1 次、随后重新 plan，并要求**再点一次**确认', async () => {
    const rig = createFetchRig([
      { status: 200, payload: planPayload() },
      { status: 409, payload: errorBody('plan-mismatch', 'planId 与本次重算不一致（目标可能已变）；零提权、零写入。') },
      { status: 200, payload: planPayload() },
    ]);
    renderBlock(rig);
    await preview('3306');
    await screen.findByTestId(WRITE_TESTID.dialog);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.confirm));
    await waitFor(() => {
      expect(rig.planCalls()).toHaveLength(2);
    });
    expect(rig.applyCalls()).toHaveLength(1);
    expect(rig.unexpected()).toBe(0);
    // 回到「等确认」：对话框又出现了（且没有任何自动 apply）
    await screen.findByTestId(WRITE_TESTID.dialog);
    const notice = screen.getByTestId(WRITE_TESTID.notice).textContent ?? '';
    expect(notice).toContain('重新确认');
    expect(notice).toContain('不会静默重试');
    expect(rig.applyCalls()).toHaveLength(1);
    console.log('  · 扫了 1 条 409：apply 1 次 / 重新 plan 1 次 / 提示重新确认（无静默重试）');
  });

  it('apply 回 401 ⇒ 只发 1 次、提示凭据与配置位置、**不重试**', async () => {
    const rig = createFetchRig([
      { status: 200, payload: planPayload() },
      { status: 401, payload: errorBody('unauthorized', '写通道凭据不正确：拒绝本次请求（零执行、零写入、零审计）。') },
    ]);
    renderBlock(rig);
    await preview('3306');
    await screen.findByTestId(WRITE_TESTID.dialog);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.confirm));
    await waitFor(() => {
      expect(rig.applyCalls()).toHaveLength(1);
    });
    const notice = screen.getByTestId(WRITE_TESTID.notice).textContent ?? '';
    expect(notice).toContain('凭据');
    expect(notice).toContain('右栏页');
    expect(screen.queryByTestId(WRITE_TESTID.dialog)).toBeNull();
    expect(rig.calls).toHaveLength(2);
    expect(rig.unexpected()).toBe(0);
    console.log('  · 扫了 1 条 401：apply 1 次 / 总请求 2 / 提示凭据且不重试');
  });
});
