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

/**
 * 2026-10-16 `fix` 扩面（009 `REQ-7.2`）：影响面**不许**沿用增删的措辞。
 *
 * 判据：`fix` ⇒ 出现「先精确删除旧规则，再按当前地址重建」+「净增 0 条」，且**不出现**「会新增 1 条 portproxy
 * 规则」（它的步骤是**先删后加**，说「新增 1 条」是高报）；`lan` 下还须把「防火墙的实际动作」指向**服务端说明**
 * （脚本按「动作 + 作用域」决定放行，不看步骤清单 —— 见 005 收口记录遗留 ⑫）。
 */
describe('2026-10-16 fix：影响面说「先删后加、净增 0」，不说「新增」', () => {
  const FIX_LAN = (): ClientPlan =>
    planWith({
      action: 'fix',
      scope: 'lan',
      ports: [
        {
          port: 45999,
          steps: [
            { kind: 'portproxy-delete', commandText: CMD_PORT_PROXY },
            { kind: 'portproxy-add', commandText: CMD_PORT_PROXY },
          ],
          notes: ['修复：先精确删除旧规则，再按当前 eth0 重建'],
        },
      ],
      notes: ['脚本会在 lan 下顺带放行该端口入站 TCP（脚本固有行为，步骤清单不含该条）'],
    });

  it('lan + fix ⇒ 先删后加 / 净增 0 / 防火墙指向服务端说明；无「会新增 1 条 portproxy 规则」', () => {
    const plan = FIX_LAN();
    const text = buildImpactLines(plan).join('\n');
    expect(text).toContain('修复 1 个端口的地址漂移');
    expect(text).toContain('先精确删除旧规则，再按当前地址重建');
    expect(text).toContain('净增 0 条');
    expect(text).not.toContain('会新增 1 条 portproxy 规则');
    expect(text).not.toContain('会删除 1 条 portproxy 规则 + 1 条防火墙规则');
    expect(text).toContain('共 2 条（portproxy 2 条 + 防火墙 0 条）');
    render(<WriteConfirmDialog plan={plan} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    const rendered = screen.getByTestId(WRITE_TESTID.impact).textContent ?? '';
    expect(rendered).toContain('净增 0 条');
    expect(rendered).not.toContain('会新增 1 条 portproxy 规则');
    // 服务端那条「脚本固有行为」说明**原样透出**：客户端不许把它吞掉（吞掉就等于漏报一次防火墙写入）
    expect(screen.getByTestId(WRITE_TESTID.notes).textContent).toContain('脚本固有行为，步骤清单不含该条');
    console.log('  · 扫了 fix+lan 影响面：不说「新增」、说「净增 0 条」，防火墙行为指向服务端说明');
  });

  it('loopback + fix ⇒ 只说重建回环规则；且明说作用域「沿用既有规则」（不谎称受选择器控制）', () => {
    const text = buildImpactLines(planWith({ action: 'fix', scope: 'loopback' })).join('\n');
    expect(text).toContain('沿用既有规则');
    expect(text).toContain('不新增防火墙放行');
    expect(text).not.toContain('会新增');
    console.log('  · 扫了 fix+loopback 影响面：沿用既有规则、无「新增」字样');
  });
});

/**
 * 009 缺陷 3（2026-10-12 真机）：计划**不可执行 / 零步骤**时，影响面不许高报。
 * 真机现象：同一个弹窗里既有「会新增 1 条 portproxy 规则 + 1 条防火墙规则」，又有「共 0 条」。
 * 判据：这两句**互斥**出现；不可执行时必须出现「不含可执行动作，不会改动任何规则」。
 */
describe('009 缺陷 3：不可执行 / 零步骤 ⇒ 影响面与实际一致（不高报）', () => {
  const NOT_READY = (): ClientPlan =>
    planWith({
      scope: 'lan',
      planId: null,
      ready: false,
      blockedReason: '端口不在所有权集合内',
      ports: [{ port: 3306, ready: false, steps: [], notes: [] }],
    });
  const READY_BUT_EMPTY = (): ClientPlan =>
    planWith({ scope: 'lan', ports: [{ port: 3306, ready: true, steps: [], notes: [] }] });

  it('planId=null + ready=false + 0 步 ⇒ 无「会新增…」、有「不会改动任何规则」，且与「共 0 条」不再自相矛盾', () => {
    const text = buildImpactLines(NOT_READY()).join('\n');
    expect(text).toContain('不会改动任何规则');
    expect(text).not.toContain('会新增');
    expect(text).not.toContain('会删除');
    expect(text).toContain('共 0 条');
    expect(text.includes('共 0 条') && text.includes('会新增')).toBe(false);
    console.log(`  · 扫了不可执行计划（0 步）：影响面 =「${text.split('\n')[1]?.slice(0, 34) ?? ''}…」，高报句 0 次`);
  });

  it('ready=true 但 0 步 ⇒ 同样按现实说话（文案层，不越界改提权档门）', () => {
    const plan = READY_BUT_EMPTY();
    const text = buildImpactLines(plan).join('\n');
    expect(text).toContain('不会改动任何规则');
    expect(text).not.toContain('会新增');
    render(<WriteConfirmDialog plan={plan} busy={false} onConfirm={() => undefined} onCancel={() => undefined} />);
    const rendered = screen.getByTestId(WRITE_TESTID.impact).textContent ?? '';
    expect(rendered).toContain('不含可执行动作');
    // ⚠️ 本态是**人为构造**的：`ready` 由服务端算（`dtos.every(ready)`），若真出现「可执行但零步骤」，
    // 本轮**只改文案**（缺陷 3 的范围），提权档门仍是 008 的口径（`!ready || planId === null` 才拦）
    // ⇒ 这里不假设按钮置灰，只钉「文案不高报」。已作为观察项写进报告。
    console.log('  · 扫了可执行但 0 步的计划：文案不含高报句、含「不含可执行动作」（档门未改，见注）');
  });

  it('反向对照：真有步骤时那句照旧出现（证明上面的「不出现」不是因为整句被删）', () => {
    const text = buildImpactLines(TWO_PORT_PLAN()).join('\n');
    expect(text).toContain('会新增 1 条 portproxy 规则 + 1 条防火墙规则');
    expect(text).not.toContain('不会改动任何规则');
    console.log('  · 扫了反向对照：3 步的 lan 计划仍逐字给「会新增 1 条 + 1 条」');
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
