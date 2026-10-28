// @vitest-environment jsdom
/**
 * 009 加固轮（2026-10-12）：**一次性写通道凭据不进无障碍树** —— 回归门 + 变异哨兵 + 可用性
 *
 * ## 缺陷（本轮修的那个）
 *
 * 修前 `src/client/pane-settings.tsx` 把一次性明文渲染成 `<code>{issued}</code>` —— 值就是
 * **文本子节点** ⇒ 无障碍树里出现一个 `StaticText` 节点（`name` = 凭据本体；CDP `Accessibility`
 * 域就是这么报文本的）⇒ 每次自动化验收快照（chrome-devtools `take_snapshot`）都把一次性凭据
 * 写进快照证据，而 `write-token.ts:10-11` 的契约是「只活在本会话、**不落盘**」。
 *
 * ## 这里的「无障碍树」是什么（口径先钉死，免得门是假的）
 *
 * `a11yNodes()` = **投影**，不是真机 CDP 的 AX 树：
 * ① 元素节点 = `@testing-library/dom` 的 `getRoles(container)`（**隐藏子树已整棵剔除**：
 *    `aria-hidden="true"` / `hidden` / `display:none` / `visibility:hidden` —— 与浏览器 a11y
 *    剔除口径同源），名字来源 = `aria-label` / `title` / `alt` / `placeholder` / 表单 `value`；
 * ② 文本节点 = 非隐藏子树里每个非空文本节点 → 一条 `StaticText`（**修前泄漏的就是这一类**；
 *    「按钮/标题的名字来自内容」也由它覆盖）。
 * 🔴 **真机 AX 树本文件验不到**（红线：不起实例）⇒ 真机复核仍未做，已写进 009 留痕。
 *
 * ## 判据（全部可二值判定）
 *
 * - 门①：渲染后（含点「生成」后）`a11yDump` 里查不到凭据的**任意子串**（长度 ≥6 的全窗口）；
 * - 门②：**任何**元素的**任何**属性（含 `data-*`）都不含凭据子串（带扫描计数防恒真）；
 * - 门③：可用性未被破坏 —— 明文仍渲染（可鼠标选中）、「复制」按钮在且**无障碍名不含值**、
 *   点它真把值送进剪贴板；且它**不是**写控件（非 NAT 时不被锁）；
 * - 哨兵：**修前实现**（逐字复刻）跑一遍 ⇒ **同一投影函数**必须判红（旧 ⇒ 泄漏），
 *   并在同一个用例里证明「旧红 / 新绿」不恒真。
 */

import { getRoles, isInaccessible } from '@testing-library/dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WRITE_TOKEN_TESTID } from '../../src/client/pane-settings.tsx';
import { EXPECTED_TOKEN, harness, mountPane, resetDom, stubRandom } from './write-token-harness.tsx';

beforeEach(() => {
  stubRandom();
});

afterEach(() => {
  resetDom();
});

// ── 判据工具（「任意子串」的可判定形式） ────────────────────────────────────────────────

/** 窗口长度：更短的窗口会与端口号一类界面数字撞车（假红），故取 ≥6 */
const WINDOW_LENGTHS = [6, 8, 16, 32, 64] as const;

function tokenWindows(token: string): string[] {
  const windows: string[] = [];
  for (const length of WINDOW_LENGTHS) {
    for (let start = 0; start + length <= token.length; start += 1) windows.push(token.slice(start, start + length));
  }
  return windows;
}

/** 文本里命中的凭据窗口（空数组 = 一个子串都没漏） */
function leakHits(text: string, token: string): string[] {
  return tokenWindows(token).filter((window) => text.includes(window));
}

// ── 无障碍树投影 ──────────────────────────────────────────────────────────────────────

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

interface A11yNode {
  readonly role: string;
  readonly name: string;
}

/** 非隐藏子树里的**文本节点**（= CDP AX 树的 `StaticText`；文本 = 其 `name`） */
function staticTexts(root: Element, out: string[] = []): string[] {
  if (SKIP_TAGS.has(root.tagName) || isInaccessible(root)) return out;
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? '').trim();
      if (text !== '') out.push(text);
    } else if (node.nodeType === 1) {
      staticTexts(node as Element, out);
    }
  }
  return out;
}

/** 元素的**名字来源**属性（`aria-label` / `title` / `alt` / `placeholder` / 表单 `value`） */
function nameSources(element: Element): string {
  const value = (element as HTMLInputElement).value;
  return [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('alt'), element.getAttribute('placeholder'), typeof value === 'string' ? value : null]
    .filter((part): part is string => part !== null && part !== '')
    .join(' | ');
}

/** 无障碍树投影：元素（role + 名字来源）+ 文本节点（StaticText） */
function a11yNodes(root: HTMLElement): A11yNode[] {
  const nodes: A11yNode[] = [];
  for (const [role, elements] of Object.entries(getRoles(root))) {
    for (const element of elements) nodes.push({ role, name: nameSources(element) });
  }
  for (const text of staticTexts(root)) nodes.push({ role: 'StaticText', name: text });
  return nodes;
}

function a11yDump(root: HTMLElement): string {
  return a11yNodes(root)
    .map((node) => `${node.role} ${node.name}`)
    .join('\n');
}

/** 属性面扫描（含 `data-*`）：命中项 + 扫了多少条（计数为 0 即恒真） */
function attributeLeaks(container: HTMLElement, token: string): { readonly hits: string[]; readonly scanned: number } {
  const hits: string[] = [];
  let scanned = 0;
  for (const element of Array.from(container.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      scanned += 1;
      if (leakHits(attribute.value, token).length > 0) hits.push(`${element.tagName.toLowerCase()}[${attribute.name}]`);
    }
  }
  return { hits, scanned };
}

/** 假剪贴板：`reject` 模式**故意**把值塞进异常文本（对抗性）—— 证明我们不会把它带进 DOM */
function stubClipboard(written: string[], mode: 'ok' | 'reject' = 'ok'): void {
  const fake = Object.create(globalThis.navigator) as Navigator;
  Object.defineProperty(fake, 'clipboard', {
    value: {
      writeText: async (value: string): Promise<void> => {
        if (mode === 'reject') throw new Error(`对抗性剪贴板拒绝：${value}`);
        written.push(value);
      },
    },
    configurable: true,
  });
  vi.stubGlobal('navigator', fake);
}

/**
 * 🔴 **修前实现**（逐字复刻加固前的 `src/client/pane-settings.tsx`：值直接当 `<code>` 的文本子节点）
 * —— 只作**变异哨兵**用，**不是**另一种可选实现。
 */
function LegacyIssuedBlock(): ReactElement {
  return (
    <div>
      <p className="wdp-error">⚠️ 这串**离开后将不再显示，请立即复制**（页面不提供「再显示一次」的入口）。</p>
      <p>
        <code className="wdp-pre" data-testid={WRITE_TOKEN_TESTID.once}>
          {EXPECTED_TOKEN}
        </code>
      </p>
    </div>
  );
}

/** 点「生成」并等明文出现（门与哨兵共用的前置） */
async function issueOnce(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.generate));
  return screen.findByTestId(WRITE_TOKEN_TESTID.once);
}

describe('009 加固轮：一次性凭据不进 a11y 树', () => {
  it('门① 渲染后 a11y 投影零泄漏；承载明文的元素已被摘出树（明文仍在 DOM，可鼠标选中）', async () => {
    const test = harness();
    const container = await mountPane(test.runtime);
    const once = await issueOnce();
    expect(once.textContent).toBe(EXPECTED_TOKEN);

    const nodes = a11yNodes(container);
    const dump = a11yDump(container);
    const windows = tokenWindows(EXPECTED_TOKEN);
    expect(windows.length).toBeGreaterThan(100);
    expect(nodes.length).toBeGreaterThan(50);
    // 投影不瞎：提示文案与复制按钮的可访问文本都在树里读到
    expect(dump).toContain('离开后将不再显示，请立即复制');
    expect(dump).toContain('复制写通道凭据');
    // 凭据的任何窗口都不在树里
    expect(leakHits(dump, EXPECTED_TOKEN)).toEqual([]);
    expect(dump.includes(EXPECTED_TOKEN)).toBe(false);
    // 修前是 role `code` 在树里；现在连它带 `paragraph` 都整棵被剪掉
    // 2026-10-28 订正：文案里的 netsh portproxy / plan / apply 等现在是真的 <code>（可视、本就该进树），
    // 所以判据从「树里没有 code 角色」收窄成「树里没有任何 code 节点承载凭据」。
    const codeRoles = (getRoles(container)['code'] ?? []) as HTMLElement[];
    expect(codeRoles.some((el) => (el.textContent ?? '').includes(EXPECTED_TOKEN))).toBe(false);
    expect(codeRoles.includes(once)).toBe(false);
    expect(isInaccessible(once)).toBe(true);
    // 摘掉的方式**只有** aria-hidden：元素没被隐藏，明文仍在屏上
    expect(once.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(once.hidden).toBe(false);
    expect(getComputedStyle(once).display).not.toBe('none');
    console.log(`  · 扫了 ${String(windows.length)} 个凭据窗口 / a11y 节点 ${String(nodes.length)} 个（${String(dump.length)} 字符）：命中 0 个`);
  });

  it('门② 属性面：任何元素的任何属性（含 data-*）都不含凭据子串', async () => {
    const test = harness();
    const container = await mountPane(test.runtime);
    await issueOnce();

    const { hits, scanned } = attributeLeaks(container, EXPECTED_TOKEN);
    expect(scanned).toBeGreaterThan(50);
    expect(hits).toEqual([]);
    console.log(`  · 扫了 ${String(scanned)} 条属性：含凭据子串的 ${String(hits.length)} 条`);
  });

  it('门③ 可用性未破坏：明文可选中 + 「复制」按钮无障碍名不含值 + 点击真进剪贴板 + 不是写控件', async () => {
    const written: string[] = [];
    stubClipboard(written);
    const test = harness();
    const container = await mountPane(test.runtime);
    const once = await issueOnce();
    expect(once.textContent).toBe(EXPECTED_TOKEN);

    const copy = screen.getByTestId(WRITE_TOKEN_TESTID.copy);
    expect(copy.tagName).toBe('BUTTON');
    expect(copy.textContent).not.toBe('');
    expect(leakHits(copy.textContent ?? '', EXPECTED_TOKEN)).toEqual([]);
    expect(leakHits(copy.getAttribute('aria-label') ?? '', EXPECTED_TOKEN)).toEqual([]);
    expect(leakHits(copy.getAttribute('title') ?? '', EXPECTED_TOKEN)).toEqual([]);
    // 无障碍名可达（按钮名来自内容），但**不含**值
    expect(screen.getByRole('button', { name: /复制写通道凭据/u })).toBe(copy);
    expect(screen.queryByRole('button', { name: EXPECTED_TOKEN })).toBeNull();
    // 复制动作是客户端本地行为，**不是**提权写控件（非 NAT 时不该被锁）
    expect(copy.hasAttribute('data-write-control')).toBe(false);

    fireEvent.click(copy);
    await waitFor(() => {
      expect(written).toEqual([EXPECTED_TOKEN]);
    });
    await screen.findByTestId(WRITE_TOKEN_TESTID.copyNote);
    expect(leakHits(a11yDump(container), EXPECTED_TOKEN)).toEqual([]);
    console.log(`  · 复制按钮可访问名「${copy.textContent ?? ''}」（含凭据窗口 0 个）；剪贴板收到 ${String(written.length)} 次、逐字相同；复制后 a11y 投影仍 0 命中`);
  });

  it('门④ 复制失败路径也不泄漏：对抗性异常文本里的值被就地遮掉，且失败不静默', async () => {
    const written: string[] = [];
    stubClipboard(written, 'reject');
    const test = harness();
    const container = await mountPane(test.runtime);
    await issueOnce();

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.copy));
    const note = await screen.findByTestId(WRITE_TOKEN_TESTID.copyNote);
    expect(note.textContent).toContain('复制失败');
    expect(note.textContent).toContain('手工复制');
    expect(leakHits(note.textContent ?? '', EXPECTED_TOKEN)).toEqual([]);
    expect(leakHits(a11yDump(container), EXPECTED_TOKEN)).toEqual([]);
    expect(written).toEqual([]);
    console.log(`  · 失败提示「${(note.textContent ?? '').slice(0, 28)}…」：凭据窗口 0 命中（值已就地遮掉）、剪贴板 0 次写入`);
  });

  it('哨兵：同一投影函数对**修前实现**当场判红、对新形态判绿 ⇒ 门不恒真', async () => {
    const legacy = render(<LegacyIssuedBlock />);
    const legacyCode = screen.getByTestId(WRITE_TOKEN_TESTID.once);
    expect(isInaccessible(legacyCode)).toBe(false);
    expect(Object.keys(getRoles(legacy.container))).toContain('code');
    const legacyDump = a11yDump(legacy.container);
    const legacyHits = leakHits(legacyDump, EXPECTED_TOKEN);
    expect(legacyDump).toContain(EXPECTED_TOKEN);
    expect(legacyHits.length).toBeGreaterThan(0);
    legacy.unmount();

    const test = harness();
    const container = await mountPane(test.runtime);
    await issueOnce();
    const fixedHits = leakHits(a11yDump(container), EXPECTED_TOKEN);
    expect(fixedHits).toEqual([]);
    console.log(`  · 同一函数：修前 a11y 投影命中 ${String(legacyHits.length)} 个窗口（判红）、修后命中 ${String(fixedHits.length)} 个（判绿）`);
  });
});
