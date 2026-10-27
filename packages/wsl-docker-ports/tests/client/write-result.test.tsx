// @vitest-environment jsdom
/**
 * 009 T1.1–T1.3 判据：写通道**结果区**（四态分色 + 逐步反馈 + 失败带原因）
 *
 * 这里跑的是**真组件**：四态渲染分支直接渲染 `WriteResultPanel`，端到端那几条渲染
 * 真 `WriteChannelBlock` + 真 `write-channel` 客户端 + 假 `fetch` ⇒ 「恰好一次 apply」
 * 与「结果保留」是在真的状态机上数的，不是 mock 掉状态机假装。
 *
 * ## 覆盖矩阵（每条都可二值判定；真实数据来源 = `transport/apply.ts` 的四张清单）
 *
 * ① `executed` 态（`apply.ts:383`）· ② `failed` 态 + **每条原因在同一条目内**（`:385-387`）·
 * ③ 空原因 ⇒ 兜底文案 · ④ `skipped` 态（`:384`，明写「服务端未给逐条原因」）·
 * ⑤ `rolledBack` 态（`:317-348`，含 `message`）· ⑥ 四态分色互不相同且类名在 `styles.ts` 白名单内 ·
 * ⑦ 空态不渲染空段 · ⑧ 逐步顺序 = 服务端顺序（不排序、不跨清单合并）· ⑨ 静态样式门见 write-style-gate.test.tsx ·
 * ⑩ 端到端四态可见 + plan 1 / apply 1 · ⑪ DOM/console 零凭据 + 结果区无执行入口 · ⑫ 结果保留。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PAGE_CSS } from '../../src/client/styles.ts';
import { createWriteChannel, type WriteChannel, type WriteWiring } from '../../src/client/write-channel.ts';
import { WRITE_TESTID } from '../../src/client/write-confirm.tsx';
import { WriteChannelBlock } from '../../src/client/write-panel.tsx';
import {
  buildResultRows,
  FAILURE_REASON_FALLBACK,
  RESULT_GROUP_TESTID,
  RESULT_TONE_CLASS,
  readableReason,
  SKIP_DETAIL,
  WriteResultPanel,
  WRITE_RESULT_TESTID,
} from '../../src/client/write-result.tsx';
import { createWriteTokenStore, type StorageLike } from '../../src/client/write-token.ts';
import type { ClientApplyReport } from '../../src/client/write-dto.ts';
import { applyPayload, CMD_PORT_PROXY, createFetchRig, planPayload, TEST_TOKEN } from './write-fixtures.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CLIENT_DIR = fileURLToPath(new NodeURL('../../src/client/', import.meta.url));

/** 「看起来像凭据」的形状（32+ 连续 hex）—— 反作弊扫描用它 */
const TOKEN_SHAPE = /[0-9a-f]{32,}/u;

/** 四态**同时非空**的一份回执（字段名逐字照 `ApplyReport`）；既喂组件也喂假 fetch */
const FOUR_STATES = {
  status: 'failure',
  message: '部分失败，已回滚本轮新增的转发规则',
  executed: ['portproxy-add', 'firewall-add'],
  skipped: ['firewall-delete'],
  failed: [
    { name: 'firewall-delete', reason: 'R1：拒绝访问（Access is denied）' },
    { name: 'portproxy-delete', reason: 'R2：找不到规则' },
  ],
  rolledBack: [{ port: 3306, ok: true, message: '已删除本轮新增的 127.0.0.1:3306 转发规则' }],
} as const;

/** 只取某一态的条目（`data-state` 是渲染时就写死的，故可精确定位） */
function stepsOf(state: string): readonly HTMLElement[] {
  return screen.getAllByTestId(WRITE_RESULT_TESTID.step).filter((node) => node.getAttribute('data-state') === state);
}

function namesOf(state: string): readonly (string | null)[] {
  return stepsOf(state).map((node) => node.querySelector('span')?.textContent ?? null);
}

describe('009 T1.1 ①③：成功态渲染 + 失败原因兜底（逐条，不是只给个数）', () => {
  it('① executed 非空 ⇒ 该组按条渲染名称；空清单的组**不存在**（空态不渲染空段）', () => {
    render(<WriteResultPanel report={mkReport({ executed: ['portproxy-add', 'firewall-add'] })} />);
    const group = screen.getByTestId(RESULT_GROUP_TESTID.executed);
    expect(group.getAttribute('data-state')).toBe('executed');
    expect(group.getAttribute('data-tone')).toBe(RESULT_TONE_CLASS.executed);
    expect(group.getAttribute('data-count')).toBe('2');
    expect(namesOf('executed')).toEqual(['portproxy-add', 'firewall-add']);
    expect(stepsOf('executed')[0]?.textContent).toContain('成功');
    // 其余三态为空 ⇒ 连容器都不渲染
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.failed)).toBeNull();
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.skipped)).toBeNull();
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.rolledBack)).toBeNull();
    expect(screen.queryByTestId(WRITE_RESULT_TESTID.empty)).toBeNull();
    console.log('  · 扫了 executed=2：条目 2 / 其余三组 0 个容器');
  });

  it('③ reason 为空串 ⇒ 兜底文案（非空且写明「服务端未给出原因」），不是空原因', () => {
    render(<WriteResultPanel report={mkReport({ failed: [{ name: 'portproxy-add', reason: '' }] })} />);
    const item = stepsOf('failed')[0];
    expect(item?.textContent).toContain('portproxy-add');
    expect(item?.textContent).toContain(FAILURE_REASON_FALLBACK);
    expect(FAILURE_REASON_FALLBACK.length).toBeGreaterThan(0);
    expect(readableReason('  ')).toBe(FAILURE_REASON_FALLBACK);
    expect(readableReason('真原因')).toBe('真原因');
    console.log(`  · 扫了 1 条空原因：兜底文案 ${String(FAILURE_REASON_FALLBACK.length)} 字，非空`);
  });
});

describe('009 T1.1 ②：失败态分色 + 每条原因落在**自己那一条**里', () => {
  it('② failed 2 条 ⇒ 条目数 == failed.length，两条原因各自出现在本条目内（不串行）', () => {
    render(<WriteResultPanel report={mkReport({ failed: FOUR_STATES.failed })} />);
    const group = screen.getByTestId(RESULT_GROUP_TESTID.failed);
    expect(group.getAttribute('data-tone')).toBe('wdp-tag-danger');
    expect(group.getAttribute('data-count')).toBe('2');
    const items = stepsOf('failed');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('R1：拒绝访问（Access is denied）');
    expect(items[0]?.textContent).not.toContain('R2：找不到规则');
    expect(items[1]?.textContent).toContain('R2：找不到规则');
    expect(items[1]?.textContent).not.toContain('R1：拒绝访问（Access is denied）');
    console.log(`  · 扫了 ${String(items.length)} 条失败：每条原因 1 对 1 落在本条目内，零串行`);
  });

  it('②b 失败条目不是「只有一个总数」：textContent 里同时有名称与原因两个片段', () => {
    render(<WriteResultPanel report={mkReport({ failed: [{ name: 'firewall-add', reason: '防火墙规则名已存在' }] })} />);
    const spans = stepsOf('failed')[0]?.querySelectorAll('span');
    expect(spans?.length).toBe(2);
    expect(spans?.[0]?.textContent).toBe('firewall-add');
    expect(spans?.[1]?.textContent).toContain('防火墙规则名已存在');
    expect(spans?.[1]?.textContent).toContain('失败');
    console.log('  · 扫了 1 条失败：名称 + 「失败：原因」两段同条目内');
  });
});

describe('009 T1.1 ④⑤：跳过态 / 回滚态渲染', () => {
  it('④ skipped 非空 ⇒ 该组按条渲染种类，并明写「服务端未给逐条原因」', () => {
    render(<WriteResultPanel report={mkReport({ skipped: ['firewall-add', 'portproxy-delete'] })} />);
    const group = screen.getByTestId(RESULT_GROUP_TESTID.skipped);
    expect(group.getAttribute('data-tone')).toBe('wdp-tag-muted');
    expect(group.getAttribute('data-count')).toBe('2');
    expect(namesOf('skipped')).toEqual(['firewall-add', 'portproxy-delete']);
    expect(stepsOf('skipped')[0]?.textContent).toContain(SKIP_DETAIL);
    expect(group.textContent).toContain('服务端只给步骤种类、没有逐条原因');
    console.log('  · 扫了 skipped=2：种类 2 条 + 「未给逐条原因」明写');
  });

  it('⑤ rolledBack 非空 ⇒ 该组带端口与 message 原文（ok=false 时写「回滚失败」）', () => {
    render(
      <WriteResultPanel
        report={mkReport({
          rolledBack: [
            { port: 3306, ok: true, message: '已删除本轮新增的 127.0.0.1:3306 转发规则' },
            { port: 5432, ok: false, message: '删除失败：Access is denied' },
          ],
        })}
      />,
    );
    const group = screen.getByTestId(RESULT_GROUP_TESTID.rolledBack);
    expect(group.getAttribute('data-tone')).toBe('wdp-tag-warn');
    expect(group.getAttribute('data-count')).toBe('2');
    expect(stepsOf('rolledBack')[0]?.textContent).toContain('端口 3306');
    expect(stepsOf('rolledBack')[0]?.textContent).toContain('回滚成功');
    expect(stepsOf('rolledBack')[0]?.textContent).toContain('已删除本轮新增的 127.0.0.1:3306 转发规则');
    expect(stepsOf('rolledBack')[1]?.textContent).toContain('回滚失败');
    expect(stepsOf('rolledBack')[1]?.textContent).toContain('Access is denied');
    console.log('  · 扫了 rolledBack=2：成功/失败各 1，message 原样搬运');
  });
});

describe('009 T1.1 ⑥⑦⑧：分色可区分 / 空态 / 逐步顺序', () => {
  it('⑥ 四态同时非空 ⇒ 四个组都在，四个 tone **互不相同**且均来自 styles.ts 白名单', () => {
    render(<WriteResultPanel report={mkReport(FOUR_STATES)} />);
    const tones = (['executed', 'failed', 'skipped', 'rolledBack'] as const).map((state) => {
      const group = screen.getByTestId(RESULT_GROUP_TESTID[state]);
      return group.getAttribute('data-tone') ?? '';
    });
    expect(new Set(tones).size).toBe(4);
    for (const tone of tones) expect(PAGE_CSS).toContain(`.${tone}`);
    // 条目上的类名 = `wdp-row` + 该态 tone（没有任何自造类名）
    for (const state of ['executed', 'failed', 'skipped', 'rolledBack'] as const) {
      for (const item of stepsOf(state)) expect(item.getAttribute('class')).toBe(`wdp-row ${RESULT_TONE_CLASS[state]}`);
    }
    console.log(`  · 扫了 4 态：tone = ${tones.join(' / ')}（互不相同，全在 PAGE_CSS 白名单内）`);
  });

  it('⑦ 空态：某态为空 ⇒ 不渲染空段；四张清单全空 ⇒ 中性说明 + status/message 仍在', () => {
    render(<WriteResultPanel report={mkReport({ failed: [{ name: 'portproxy-add', reason: 'R' }] })} />);
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.executed)).toBeNull();
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.skipped)).toBeNull();
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.rolledBack)).toBeNull();
    expect(screen.getByTestId(RESULT_GROUP_TESTID.failed)).toBeDefined();
    cleanup();

    render(<WriteResultPanel report={mkReport({})} />);
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.executed)).toBeNull();
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.failed)).toBeNull();
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.skipped)).toBeNull();
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.rolledBack)).toBeNull();
    expect(screen.getByTestId(WRITE_RESULT_TESTID.empty).textContent).toContain('四张清单都是空的');
    expect(screen.getByTestId(WRITE_RESULT_TESTID.summary).textContent).toContain('status=');
    console.log('  · 扫了 2 棵结果树：空段 0 个容器；全空时中性说明 1 条');
  });

  it('⑧ 逐步顺序 = 服务端顺序（刻意逆序也照原样），且各清单**不跨组合并**', () => {
    // executed 与 failed 都刻意给「非字典序」的顺序 ⇒ 任何排序都会露馅
    render(
      <WriteResultPanel
        report={mkReport({
          executed: ['portproxy-add', 'firewall-add'],
          failed: [
            { name: 'firewall-delete', reason: 'R1' },
            { name: 'portproxy-delete', reason: 'R2' },
          ],
          skipped: ['firewall-add'],
        })}
      />,
    );
    expect(namesOf('executed')).toEqual(['portproxy-add', 'firewall-add']);
    expect(namesOf('failed')).toEqual(['firewall-delete', 'portproxy-delete']);
    expect(namesOf('skipped')).toEqual(['firewall-add']);
    // 组容器彼此独立（DOM 里不合并成一张总表）
    expect(screen.getByTestId(RESULT_GROUP_TESTID.executed)).not.toBe(screen.getByTestId(RESULT_GROUP_TESTID.failed));
    // 条目总数 == 四态之和（没有多渲染、没有少渲染）
    expect(screen.getAllByTestId(WRITE_RESULT_TESTID.step)).toHaveLength(5);
    console.log('  · 扫了 5 条：三组各自保持服务端顺序，零排序、零合并');
  });

  it('⑧b 纯函数层（无 DOM）：行序 + 原因搬运 + 空清单恒空数组', () => {
    const rows = buildResultRows(
      mkReport({
        executed: ['portproxy-add', 'firewall-add'],
        skipped: ['firewall-add', 'portproxy-delete'],
        failed: [{ name: 'firewall-delete', reason: '' }],
      }),
    );
    expect(rows.executed.map((row) => row.name)).toEqual(['portproxy-add', 'firewall-add']);
    expect(rows.skipped.map((row) => row.name)).toEqual(['firewall-add', 'portproxy-delete']);
    expect(rows.failed[0]?.detail).toContain(FAILURE_REASON_FALLBACK);
    expect(rows.rolledBack).toEqual([]);
    console.log('  · 扫了 1 份回执：行序原样、空原因走兜底、空清单 = []');
  });
});

describe('009 T1.1 ⑩⑪⑫：端到端（真状态机 + 假 fetch）', () => {
  it('⑩⑪ 预演→确认 ⇒ 结果区四态可见、plan 1 / apply 1 / 无多余请求、DOM 与 console 零凭据', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const rig = createFetchRig([
      { status: 200, payload: planPayload() },
      { status: 200, payload: applyPayload(FOUR_STATES) },
    ]);
    const { channel, container } = renderBlock(rig);
    await preview();
    await screen.findByTestId(WRITE_TESTID.dialog);
    expect(rig.applyCalls()).toHaveLength(0);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.confirm));
    await screen.findByTestId(WRITE_TESTID.result);

    for (const state of ['executed', 'failed', 'skipped', 'rolledBack'] as const) {
      expect(screen.getByTestId(RESULT_GROUP_TESTID[state])).toBeDefined();
    }
    expect(rig.planCalls()).toHaveLength(1);
    expect(rig.applyCalls()).toHaveLength(1);
    expect(channel.requestCount()).toBe(2);
    expect(rig.unexpected()).toBe(0);
    // 🔴 反作弊：结果区里零凭据、零执行入口
    expect(container.innerHTML).not.toContain(TEST_TOKEN);
    expect(TOKEN_SHAPE.test(container.innerHTML)).toBe(false);
    expect(screen.getByTestId(WRITE_TESTID.result).querySelectorAll('[data-write-control]')).toHaveLength(0);
    const leaked = spies.flatMap((spy) => spy.mock.calls).filter((args) => JSON.stringify(args).includes(TEST_TOKEN));
    expect(leaked).toEqual([]);
    for (const spy of spies) spy.mockRestore();
    console.log(`  · 扫了 1 轮确认：plan 1 / apply 1 / 四态 4 组 / DOM+console 凭据 0 次`);
  });

  it('⑫ 结果保留：重新预演**不清掉**结果（apply 仍 1 次）；下一次确认才用新回执替换', async () => {
    const rig = createFetchRig([
      { status: 200, payload: planPayload() },
      { status: 200, payload: applyPayload(FOUR_STATES) },
      { status: 200, payload: planPayload() },
      { status: 200, payload: applyPayload({ status: 'ok', message: '第二次执行成功', executed: ['portproxy-add'] }) },
    ]);
    renderBlock(rig);
    await preview();
    await screen.findByTestId(WRITE_TESTID.dialog);
    fireEvent.click(screen.getByTestId(WRITE_TESTID.confirm));
    await screen.findByTestId(WRITE_TESTID.result);
    expect(screen.getByTestId(WRITE_TESTID.result).getAttribute('data-status')).toBe('failure');

    // 再次预演：结果仍在（可再次预演 ⇒ 不是「一次性结果」）
    await preview();
    await screen.findByTestId(WRITE_TESTID.dialog);
    expect(screen.getByTestId(WRITE_TESTID.result).getAttribute('data-status')).toBe('failure');
    expect(screen.getByTestId(RESULT_GROUP_TESTID.failed)).toBeDefined();
    expect(rig.applyCalls()).toHaveLength(1);
    expect(rig.planCalls()).toHaveLength(2);

    // 第二次确认 ⇒ 新回执**替换**旧回执（不是叠加：失败组消失）
    fireEvent.click(screen.getByTestId(WRITE_TESTID.confirm));
    await waitFor(() => {
      expect(screen.getByTestId(WRITE_TESTID.result).getAttribute('data-status')).toBe('ok');
    });
    expect(screen.queryByTestId(RESULT_GROUP_TESTID.failed)).toBeNull();
    expect(namesOf('executed')).toEqual(['portproxy-add']);
    expect(rig.applyCalls()).toHaveLength(2);
    expect(rig.unexpected()).toBe(0);
    console.log('  · 扫了 2 轮执行：结果保留（重新预演后仍在）→ 第二次确认替换为 ok');
  });

  it('⑪b 静态反作弊：结果区两个客户端文件零 `console.`、零 `localStorage` 用法', () => {
    const files = ['write-result.tsx', 'write-panel.tsx'];
    const hits: string[] = [];
    let bytes = 0;
    for (const file of files) {
      const text = readFileSync(path.join(CLIENT_DIR, file), 'utf8');
      bytes += Buffer.byteLength(text);
      if (text.includes('console.')) hits.push(`${file}:console`);
      if (text.includes('localStorage.') || text.includes('localStorage[')) hits.push(`${file}:localStorage`);
    }
    expect(hits).toEqual([]);
    expect(bytes).toBeGreaterThan(0);
    console.log(`  · 扫了 ${String(files.length)} 文件 / ${String(bytes)} 字节：console. 0 / localStorage 0`);
  });
});

/** 造一份客户端回执（默认四张清单全空；字段名逐字对齐 `ClientApplyReport`） */
function mkReport(overrides: {
  readonly status?: string;
  readonly message?: string;
  readonly executed?: readonly string[];
  readonly failed?: readonly { readonly name: string; readonly reason: string }[];
  readonly skipped?: readonly string[];
  readonly rolledBack?: readonly { readonly port: number; readonly ok: boolean; readonly message: string }[];
}): ClientApplyReport {
  return {
    status: overrides.status ?? 'failure',
    message: overrides.message ?? '服务端给的可读结论',
    hint: '',
    executed: overrides.executed ?? [],
    skipped: overrides.skipped ?? [],
    failed: overrides.failed ?? [],
    rolledBack: overrides.rolledBack ?? [],
    backend: 'gsudo',
    elevationPolicy: 'ask',
    durationMs: 123,
    commandText: CMD_PORT_PROXY,
  };
}

function tokenStore(token: string): ReturnType<typeof createWriteTokenStore> {
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
  store.save(token);
  return store;
}

function renderBlock(rig: ReturnType<typeof createFetchRig>): { readonly channel: WriteChannel; readonly container: HTMLElement } {
  const channel = createWriteChannel({ token: () => tokenStore(TEST_TOKEN).read(), fetchImpl: rig.fetchImpl });
  const wiring: WriteWiring = {
    channel,
    tokenStore: tokenStore(TEST_TOKEN),
    declaration: async () => ({ ok: true, ports: [{ start: 3306, end: 3306 }] }),
  };
  const { container } = render(<WriteChannelBlock write={wiring} enabled disabledReason={null} />);
  return { channel, container };
}

async function preview(ports = '3306'): Promise<void> {
  fireEvent.change(screen.getByTestId(WRITE_TESTID.ports), { target: { value: ports } });
  fireEvent.click(screen.getByTestId(WRITE_TESTID.preview));
}
