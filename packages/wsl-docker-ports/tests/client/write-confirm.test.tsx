// @vitest-environment jsdom
/**
 * 008 T3.1 判据：**写前确认对话框**（契约 4/5/6/8）
 *
 * 本文件要钉死四件事（每条都是主人点名的判据）：
 * ① **未点确认 ⇒ 零网络请求** —— 对话框是纯组件，这里用 `fetch` 探针（全局 stub）当场证；
 * ② **命令原文逐字**出现在对话框里（`textContent === step.commandText`，含首尾空格与换行）；
 * ③ 影响面文案：`loopback` vs `lan`（`lan` + `add` 时必须逐字含「会新增 1 条 portproxy 规则 + 1 条防火墙规则」）；
 * ④ `policy` 为 `none` / `unknown`（以及无票据 / 计划不可执行）⇒ 确认按钮**置灰且有原因**。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parsePlanPayload, type ClientPlan } from '../../src/client/write-dto.ts';
import { buildImpactLines, elevationGate, WriteConfirmDialog, WRITE_TESTID } from '../../src/client/write-confirm.tsx';
import { CMD_FIREWALL, CMD_PORT_PROXY, CMD_QUIRKY, planPayload } from './write-fixtures.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function planWith(overrides: Parameters<typeof planPayload>[0] = {}): ClientPlan {
  return parsePlanPayload(planPayload(overrides));
}

const TWO_PORT_PLAN = (): ClientPlan =>
  planWith({
    scope: 'lan',
    ports: [
      { port: 3306, steps: [{ kind: 'portproxy-add', commandText: CMD_PORT_PROXY }, { kind: 'firewall-add', commandText: CMD_FIREWALL }], notes: ['本端口要加防火墙放行'] },
      { port: 5432, steps: [{ kind: 'portproxy-add', commandText: CMD_QUIRKY }], notes: [] },
    ],
    notes: ['计划只覆盖所有权集合内的端口'],
  });

describe('T3.1 对话框：零副作用（未点确认 ⇒ 零网络请求）', () => {
  it('渲染整份计划（含多端口多步骤）期间，fetch 一次都没有被调用', () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    render(<WriteConfirmDialog plan={TWO_PORT_PLAN()} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByTestId(WRITE_TESTID.dialog)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    console.log(`  · 扫了 1 次渲染（2 端口 / 3 步骤）：fetch 调用 ${String(spy.mock.calls.length)} 次`);
  });
});

describe('T3.1 命令原文：逐条逐字，不改写不拼接', () => {
  it('每个步骤一个元素，textContent 与服务端 commandText 逐字相等', () => {
    render(<WriteConfirmDialog plan={TWO_PORT_PLAN()} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    const blocks = screen.getAllByTestId(WRITE_TESTID.command);
    expect(blocks.map((node) => node.textContent)).toEqual([CMD_PORT_PROXY, CMD_FIREWALL, CMD_QUIRKY]);
    // 反向对照：客户端不许出现「拼接版」——服务端的 plan.commandText 是把步骤用换行连起来的
    expect(blocks.map((node) => node.textContent)).not.toContain([CMD_PORT_PROXY, CMD_FIREWALL].join('\n'));
    // 端口分组：两份 port 容器，端口号可读
    const ports = screen.getAllByTestId(WRITE_TESTID.port);
    expect(ports.map((node) => node.getAttribute('data-port'))).toEqual(['3306', '5432']);
    expect(blocks.map((node) => node.getAttribute('data-step-kind'))).toEqual(['portproxy-add', 'firewall-add', 'portproxy-add']);
    console.log(`  · 扫了 ${String(blocks.length)} 条命令原文：逐字相等（含首尾空格与换行），无拼接版`);
  });

  it('说明（总说明 + 逐端口说明）原样出现在对话框里', () => {
    render(<WriteConfirmDialog plan={TWO_PORT_PLAN()} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    const notes = screen.getByTestId(WRITE_TESTID.notes).textContent ?? '';
    expect(notes).toContain('计划只覆盖所有权集合内的端口');
    expect(notes).toContain('端口 3306：本端口要加防火墙放行');
    console.log('  · 扫了 2 类说明：总说明 1 条 + 逐端口 1 条');
  });
});

describe('T3.1 影响面：loopback vs lan（lan + add 逐字给「1 条 + 1 条」）', () => {
  it('lan + add ⇒ 逐字含「会新增 1 条 portproxy 规则 + 1 条防火墙规则」', () => {
    const lines = buildImpactLines(TWO_PORT_PLAN());
    const text = lines.join('\n');
    expect(text).toContain('会新增 1 条 portproxy 规则 + 1 条防火墙规则');
    expect(text).toContain('局域网');
    expect(text).toContain('共 3 条（portproxy 2 条 + 防火墙 1 条）');
    render(<WriteConfirmDialog plan={TWO_PORT_PLAN()} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByTestId(WRITE_TESTID.impact).textContent).toContain('会新增 1 条 portproxy 规则 + 1 条防火墙规则');
    console.log(`  · 扫了 ${String(lines.length)} 行影响面：lan 的「1 条 + 1 条」逐字命中，步数与服务端一致`);
  });

  it('loopback ⇒ 明说只写本机、且**不**出现防火墙那句；remove + lan ⇒ 说「删除」不说「新增」', () => {
    const loopback = buildImpactLines(planWith({ scope: 'loopback' })).join('\n');
    expect(loopback).toContain('仅本机');
    expect(loopback).not.toContain('防火墙规则（端口专属');
    const remove = buildImpactLines(planWith({ scope: 'lan', action: 'remove' })).join('\n');
    expect(remove).toContain('会删除 1 条 portproxy 规则 + 1 条防火墙规则');
    expect(remove).not.toContain('会新增');
    console.log('  · 扫了 2 组影响面：loopback 不含 lan 那句；remove 用「删除」');
  });
});

describe('T3.1 提权档门：不可能成功的操作不提供', () => {
  it('policy=none ⇒ 置灰 + 原因含 none 与改档指引', () => {
    const plan = planWith({ policy: 'none' });
    expect(elevationGate(plan).allow).toBe(false);
    render(<WriteConfirmDialog plan={plan} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    const confirm = screen.getByTestId(WRITE_TESTID.confirm) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const gate = screen.getByTestId(WRITE_TESTID.gate).textContent ?? '';
    expect(gate).toContain('none');
    expect(gate).toContain('按钮置灰');
    expect(gate).toContain('提权策略');
    console.log(`  · 扫了 policy=none：disabled=true / 原因「${gate.slice(0, 24)}…」`);
  });

  it('policy=unknown ⇒ 置灰 + 原因含 unknown 与 fail-safe', () => {
    const plan = planWith({ policy: 'unknown' });
    expect(elevationGate(plan).allow).toBe(false);
    render(<WriteConfirmDialog plan={plan} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    const gate = screen.getByTestId(WRITE_TESTID.gate).textContent ?? '';
    expect((screen.getByTestId(WRITE_TESTID.confirm) as HTMLButtonElement).disabled).toBe(true);
    expect(gate).toContain('unknown');
    expect(gate).toContain('fail-safe');
    console.log('  · 扫了 policy=unknown：disabled=true / 原因含 unknown 与 fail-safe');
  });

  it('planId=null（被拦下）与无票据 ⇒ 也置灰，且原因各不相同', () => {
    const blocked = planWith({ planId: null, ready: false, ticket: null, blockedReason: '端口不在所有权集合内' });
    render(<WriteConfirmDialog plan={blocked} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    const first = screen.getByTestId(WRITE_TESTID.gate).textContent ?? '';
    expect((screen.getByTestId(WRITE_TESTID.confirm) as HTMLButtonElement).disabled).toBe(true);
    expect(first).toContain('所有权');
    cleanup();
    render(<WriteConfirmDialog plan={planWith({ ticket: null })} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    const second = screen.getByTestId(WRITE_TESTID.gate).textContent ?? '';
    expect((screen.getByTestId(WRITE_TESTID.confirm) as HTMLButtonElement).disabled).toBe(true);
    expect(second).toContain('票据');
    console.log('  · 扫了 2 条置灰路径：被拦下（原因含所有权）/ 无票据（原因含票据）');
  });

  it('policy=ask + 票据齐 ⇒ 可确认；外部前置（NAT 门）未过 ⇒ 一并置灰', () => {
    const plan = planWith({ policy: 'ask' });
    expect(elevationGate(plan).allow).toBe(true);
    const { unmount } = render(<WriteConfirmDialog plan={plan} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    expect((screen.getByTestId(WRITE_TESTID.confirm) as HTMLButtonElement).disabled).toBe(false);
    unmount();
    render(<WriteConfirmDialog plan={plan} busy={false} blocked="非 NAT：写控件全灰" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect((screen.getByTestId(WRITE_TESTID.confirm) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId(WRITE_TESTID.gate).textContent).toContain('非 NAT');
    console.log('  · 扫了 2 组：可确认 1 / 外部前置未过 1');
  });

  it('busy ⇒ 两个按钮都不可点（双击不会变成两次 apply）', () => {
    render(<WriteConfirmDialog plan={planWith()} busy onConfirm={() => undefined} onCancel={() => undefined} />);
    expect((screen.getByTestId(WRITE_TESTID.confirm) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(WRITE_TESTID.cancel) as HTMLButtonElement).disabled).toBe(true);
    console.log('  · 扫了 busy 态：确认/取消都 disabled');
  });
});

describe('T3.1 按钮语义：确认回调一次、取消零请求', () => {
  it('点「确认并执行」⇒ onConfirm 恰一次；点「取消」⇒ onCancel 恰一次且不发请求', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const { unmount } = render(<WriteConfirmDialog plan={planWith()} busy={false} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.confirm));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    unmount();
    render(<WriteConfirmDialog plan={planWith()} busy={false} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.cancel));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    console.log('  · 扫了 2 次点击：onConfirm 1 / onCancel 1 / fetch 0');
  });

  it('置灰时点击**不触发**回调（不做注定失败的请求）', () => {
    const onConfirm = vi.fn();
    render(<WriteConfirmDialog plan={planWith({ policy: 'none' })} busy={false} onConfirm={onConfirm} onCancel={() => undefined} />);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.confirm));
    expect(onConfirm).not.toHaveBeenCalled();
    console.log('  · 扫了 1 次置灰点击：回调 0 次');
  });
});
