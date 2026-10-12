// @vitest-environment jsdom
/**
 * 009 T2.1 / T2.3 判据：配置页「生成并保存写通道凭据」按钮（凭据块）
 *
 * 这里跑的是**真组件 + 真配置管道 + 假 remote.settings**：所以「恰好一次 settings 写入」
 * 是在真的 `writeWriteToken()` → `describe()` + `update()` 路径上数的，不是 mock 掉管道假装。
 *
 * 七条判据（全部可二值判定）：
 * ① 点生成 ⇒ **恰好 1 次** settings 写入，写入值 64 位 hex（= 32 字节）；
 * ② 显示区出现过该值一次；卸载重渲染后**不再出现**（凭据仍在 sessionStorage）；
 * ③ 未点生成 ⇒ DOM 里**零**凭据样值（含「已配置」态：**只显示布尔**）；
 * ④ `sessionStorage` 命名空间键被写入且值 = 生成值（且**只此一格**）；
 * ⑤ 「清除凭据」⇒ 二次确认（确认前零写入）+ 写入**空串** + 清本会话；
 * ⑥ 凭据绝不进 `console.*`（静态扫描 + 运行时 spy 双重）；
 * ⑦ 写入失败 ⇒ 可读提示、不静默、不入本会话。
 *
 * 🔴 随机源在本文件里被替换成确定值（`vi.stubGlobal('crypto', …)`）⇒ 断言「写进去的就是
 * 显示出来的那一串」不需要靠猜；生产路径用的仍是 `crypto.getRandomValues`（`write-token.ts`）。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientRuntime, RemoteSettingsLike, SettingsResponse } from '../../src/client/host.ts';
import { PortsPane } from '../../src/client/pane.tsx';
import { WRITE_TOKEN_TESTID } from '../../src/client/pane-settings.tsx';
import { createSettingsPipe, SETTINGS_NAMESPACE } from '../../src/client/settings-pipe.ts';
import { createWriteChannel, type WriteWiring } from '../../src/client/write-channel.ts';
import { bytesToHex, createWriteTokenStore, WRITE_TOKEN_BYTES, WRITE_TOKEN_STORAGE_KEY, type StorageLike } from '../../src/client/write-token.ts';
import { snapshot } from '../unit/client-fixtures.ts';

const BYTES = Uint8Array.from({ length: WRITE_TOKEN_BYTES }, (_, index) => index);
/** 确定性随机源给出的那一串（32 字节 → 64 位小写 hex） */
const EXPECTED_TOKEN = bytesToHex(BYTES);
/** 「看起来像凭据」的形状（32+ 连续 hex）—— 判据 ③/② 用它扫整棵 DOM */
const TOKEN_SHAPE = /[0-9a-f]{32,}/u;
const ONCE_HINT = '离开后将不再显示，请立即复制';

beforeEach(() => {
  vi.stubGlobal('crypto', {
    getRandomValues: (box: Uint8Array): Uint8Array => {
      for (let index = 0; index < box.length; index += 1) box[index] = BYTES[index % BYTES.length] ?? 0;
      return box;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface StorageRig extends StorageLike {
  readonly box: Map<string, string>;
}

function storageRig(seed?: string): StorageRig {
  const box = new Map<string, string>();
  if (seed !== undefined) box.set(WRITE_TOKEN_STORAGE_KEY, seed);
  return {
    box,
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => {
      box.set(key, value);
    },
    removeItem: (key) => {
      box.delete(key);
    },
  };
}

interface Recorded {
  updates: { readonly ns: string; readonly patch: Record<string, unknown> }[];
  describes: number;
}

interface Harness {
  readonly runtime: ClientRuntime;
  readonly recorded: Recorded;
  readonly storage: StorageRig;
}

/**
 * 注入式 runtime：唯一的外部输入是假 `remote.settings` + 假存储。
 * 通道的 `fetchImpl` **故意抛错** ⇒ 本文件里任何一次真请求都会立刻炸掉用例。
 */
function harness(options: { readonly config?: Record<string, unknown>; readonly seed?: string; readonly updateFails?: string } = {}): Harness {
  const recorded: Recorded = { updates: [], describes: 0 };
  const remote: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => {
      recorded.describes += 1;
      return { ok: true, value: { revision: 3, namespaces: [{ ns: SETTINGS_NAMESPACE, value: options.config ?? {} }] } };
    },
    update: async (ns: string, patch: unknown): Promise<SettingsResponse> => {
      recorded.updates.push({ ns, patch: patch as Record<string, unknown> });
      if (options.updateFails !== undefined) return { ok: false, error: options.updateFails };
      return { ok: true, value: { namespaces: [{ ns, value: patch }] } };
    },
  };
  const storage = storageRig(options.seed);
  const tokenStore = createWriteTokenStore(storage);
  const channel = createWriteChannel({
    token: () => tokenStore.read(),
    fetchImpl: async () => {
      throw new Error('本文件不该发任何写通道请求（fetchImpl 故意抛错）');
    },
  });
  const wiring: WriteWiring = { channel, tokenStore, declaration: async () => ({ ok: true, ports: [] }) };
  return {
    recorded,
    storage,
    runtime: {
      source: { load: async () => snapshot({}) },
      settings: createSettingsPipe(() => remote),
      elevation: undefined,
      exec: undefined,
      write: wiring,
    },
  };
}

/** 渲染整页并等凭据块出现（凭据块的挂载本身**零 IPC**：T5.1 的门保持不变） */
async function mountPane(runtime: ClientRuntime): Promise<HTMLElement> {
  const { container } = render(<PortsPane runtime={runtime} />);
  await screen.findByTestId(WRITE_TOKEN_TESTID.block);
  return container;
}

function stateText(): string {
  return screen.getByTestId(WRITE_TOKEN_TESTID.state).textContent ?? '';
}

describe('009 T2.1 判据①④：生成 ⇒ 恰好一次 settings 写入 + 入 sessionStorage', () => {
  it('① 点「生成并保存」⇒ 恰好 1 次写配置（键恰 writeToken），值是 64 位 hex（≥32 字节）', async () => {
    const test = harness();
    await mountPane(test.runtime);
    expect(test.recorded.updates).toHaveLength(0);

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.generate));
    await waitFor(() => {
      expect(test.recorded.updates).toHaveLength(1);
    });
    const first = test.recorded.updates[0];
    expect(first?.ns).toBe(SETTINGS_NAMESPACE);
    expect(Object.keys(first?.patch ?? {})).toEqual(['writeToken']);
    const written = String(first?.patch['writeToken']);
    expect(written).toBe(EXPECTED_TOKEN);
    expect(written).toMatch(/^[0-9a-f]{64}$/u);
    expect(written.length / 2).toBeGreaterThanOrEqual(32);

    // 轮换 = 再点一次：仍是「一次点击一次写入」（不连发、不批量）
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.generate));
    await waitFor(() => {
      expect(test.recorded.updates).toHaveLength(2);
    });
    expect(test.recorded.updates[1]?.patch['writeToken']).toBe(EXPECTED_TOKEN);
    console.log(`  · 扫了 2 次生成：写入 ${String(test.recorded.updates.length)} 次（每次恰好 1 次），值长度 ${String(written.length)}`);
  });

  it('④ 生成后 sessionStorage 命名空间键 = 生成值，且只占了这一格', async () => {
    const test = harness();
    await mountPane(test.runtime);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.generate));
    await screen.findByTestId(WRITE_TOKEN_TESTID.once);

    expect(WRITE_TOKEN_STORAGE_KEY).toBe('dsh-wsl-docker-ports.writeToken');
    expect([...test.storage.box.keys()]).toEqual([WRITE_TOKEN_STORAGE_KEY]);
    expect(test.storage.box.get(WRITE_TOKEN_STORAGE_KEY)).toBe(EXPECTED_TOKEN);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.once).textContent).toBe(EXPECTED_TOKEN);
    console.log(`  · 扫了 1 个键（${WRITE_TOKEN_STORAGE_KEY}）：值与显示区、与写入配置三处逐字相同`);
  });
});

describe('009 T2.1 判据②：一次性显示（离开后不再出现）', () => {
  it('② 生成后显示区出现过该值一次；卸载重渲染后 DOM 里没有它（凭据仍在会话里）', async () => {
    const test = harness();
    const first = render(<PortsPane runtime={test.runtime} />);
    await screen.findByTestId(WRITE_TOKEN_TESTID.block);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.generate));
    const once = await screen.findByTestId(WRITE_TOKEN_TESTID.once);
    expect(once.textContent).toBe(EXPECTED_TOKEN);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.block).textContent).toContain(ONCE_HINT);

    // 「离开」= 卸载这一棵树（刷新同理：issued 只是组件内状态）
    first.unmount();
    const second = await mountPane(test.runtime);
    expect(screen.queryByTestId(WRITE_TOKEN_TESTID.once)).toBeNull();
    expect(second.innerHTML.includes(EXPECTED_TOKEN)).toBe(false);
    expect(TOKEN_SHAPE.test(second.innerHTML)).toBe(false);
    // 反向对照：凭据**没有**丢 —— 只显示一次 ≠ 只保存一次
    expect(test.runtime.write?.tokenStore.read()).toBe(EXPECTED_TOKEN);
    expect(stateText()).toContain('本会话持有凭据：是');
    console.log('  · 扫了 2 棵树：第一棵有明文 1 次，第二棵 0 次；sessionStorage 里仍是同一串');
  });
});

describe('009 T2.1 判据③：未点生成 ⇒ DOM 零凭据样值（含「已配置」态只显示布尔）', () => {
  it('③ 服务端已配置 writeToken ⇒ 只显示布尔「已配置」，值本体不进 DOM，且检查不写配置', async () => {
    const configuredValue = 'a'.repeat(64);
    const test = harness({ config: { writeToken: configuredValue } });
    const container = await mountPane(test.runtime);

    expect(TOKEN_SHAPE.test(container.innerHTML)).toBe(false);
    expect(container.innerHTML.includes(configuredValue)).toBe(false);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-config-configured')).toBe('unknown');

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.check));
    await waitFor(() => {
      expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-config-configured')).toBe('1');
    });
    expect(stateText()).toContain('已配置');
    expect(container.innerHTML.includes(configuredValue)).toBe(false);
    expect(TOKEN_SHAPE.test(container.innerHTML)).toBe(false);
    expect(test.recorded.updates).toHaveLength(0);
    console.log(`  · 扫了 1 个已配置的命名空间（值 ${String(configuredValue.length)} 字符）：DOM 里出现 0 次，只显示布尔`);
  });

  it('③b 本会话已有凭据而**未**点生成 ⇒ 只显示布尔「是」，该值不在 DOM 里', async () => {
    const seeded = 'b'.repeat(64);
    const test = harness({ seed: seeded });
    const container = await mountPane(test.runtime);

    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-session-credential')).toBe('1');
    expect(container.innerHTML.includes(seeded)).toBe(false);
    expect(TOKEN_SHAPE.test(container.innerHTML)).toBe(false);
    expect(test.recorded.updates).toHaveLength(0);
    console.log('  · 扫了 1 个「本会话已有凭据」的挂载：DOM 里 0 次出现，仅布尔');
  });

  it('③c 未配置 ⇒ 明确写出后果「写入口会 401」', async () => {
    const test = harness();
    await mountPane(test.runtime);
    const consequence = screen.getByTestId(WRITE_TOKEN_TESTID.consequence).textContent ?? '';
    expect(consequence).toContain('401');
    expect(consequence).not.toMatch(TOKEN_SHAPE);
    console.log(`  · 扫了 1 条后果文案：${consequence.slice(0, 40)}…`);
  });
});

describe('009 T2.1 判据⑤：清除（二次确认 + 空串）', () => {
  it('⑤ 点「清除凭据」⇒ 确认前零写入；确认后写**空串**并清本会话', async () => {
    const seeded = 'c'.repeat(64);
    const test = harness({ seed: seeded });
    await mountPane(test.runtime);

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clear));
    // 二次确认**真的**生效：确认之前一个字节都没写出去
    expect(test.recorded.updates).toHaveLength(0);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.clearConfirm)).toBeDefined();
    expect(test.storage.box.get(WRITE_TOKEN_STORAGE_KEY)).toBe(seeded);

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clearConfirm));
    await waitFor(() => {
      expect(test.recorded.updates).toHaveLength(1);
    });
    expect(test.recorded.updates[0]?.patch).toEqual({ writeToken: '' });
    expect(test.recorded.updates[0]?.ns).toBe(SETTINGS_NAMESPACE);
    expect(test.storage.box.has(WRITE_TOKEN_STORAGE_KEY)).toBe(false);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-session-credential')).toBe('0');
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-config-configured')).toBe('0');
    console.log('  · 扫了 1 次清除：确认前 0 次写入 / 确认后 1 次（patch 恰 { writeToken: "" }）/ 本会话已清');
  });

  it('⑤b 点「取消」⇒ 零写入，凭据原样留着（不是「删一半」）', async () => {
    const seeded = 'd'.repeat(64);
    const test = harness({ seed: seeded });
    await mountPane(test.runtime);

    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clear));
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clearCancel));
    expect(test.recorded.updates).toHaveLength(0);
    expect(test.storage.box.get(WRITE_TOKEN_STORAGE_KEY)).toBe(seeded);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-session-credential')).toBe('1');
    expect(screen.queryByTestId(WRITE_TOKEN_TESTID.clearConfirm)).toBeNull();
    console.log('  · 扫了 1 次取消：写入 0 次、凭据 1 次仍在、确认按钮已收起');
  });
});

describe('009 T2.1 判据⑥：凭据绝不进 console', () => {
  it('⑥ 静态：凭据通路的四个客户端文件里零 `console.` 用法（且扫描非空）', () => {
    // ⚠️ 本文件跑在 jsdom 环境里 ⇒ 全局 `URL` 是 jsdom 的，它拿 `file:` 基址解析相对路径会给出
    // `http://localhost:3000/lib/index.js` 这种值（实测）⇒ 一律用 Node 自己的 `URL` + `fileURLToPath`。
    const dir = fileURLToPath(new NodeURL('../../src/client/', import.meta.url));
    const files = ['write-token.ts', 'settings-pipe.ts', 'pane-settings.tsx', 'pane.tsx'];
    const hits: string[] = [];
    let bytes = 0;
    for (const file of files) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      bytes += Buffer.byteLength(text);
      if (text.includes('console.')) hits.push(`${file}:console`);
      if (text.includes('localStorage.') || text.includes('localStorage[')) hits.push(`${file}:localStorage`);
    }
    expect(hits).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
    expect(bytes).toBeGreaterThan(0);
    console.log(`  · 扫了 ${String(files.length)} 个文件 / ${String(bytes)} 字节：console. 0 处、localStorage 用法 0 处`);
  });

  it('⑥b 运行时：生成 + 检查 + 清除 全程无任何 console 实参含凭据', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const test = harness({ config: { writeToken: 'a'.repeat(64) } });
    await mountPane(test.runtime);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.generate));
    await screen.findByTestId(WRITE_TOKEN_TESTID.once);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.check));
    await waitFor(() => {
      expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-config-configured')).toBe('1');
    });
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clear));
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clearConfirm));
    await waitFor(() => {
      expect(test.recorded.updates).toHaveLength(2);
    });

    const calls = spies.flatMap((spy) => spy.mock.calls);
    const leaked = calls.filter((args) => JSON.stringify(args).includes(EXPECTED_TOKEN) || TOKEN_SHAPE.test(JSON.stringify(args)));
    expect(leaked).toEqual([]);
    for (const spy of spies) spy.mockRestore();
    console.log(`  · 扫了 5 个 console 通道 / ${String(calls.length)} 次调用：含凭据的实参 0 个`);
  });
});

describe('009 T2.1 判据⑦：错误路径（可读提示、不静默）', () => {
  it('⑦ 生成时写配置失败 ⇒ 提示带原因、明文仍一次性显示、不入本会话', async () => {
    const test = harness({ updateFails: 'revision 冲突' });
    await mountPane(test.runtime);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.generate));

    await waitFor(() => {
      expect(screen.getByTestId(WRITE_TOKEN_TESTID.note).textContent).toContain('revision 冲突');
    });
    const note = screen.getByTestId(WRITE_TOKEN_TESTID.note).textContent ?? '';
    expect(note).toContain('凭据**未**存入本会话');
    expect(test.storage.box.has(WRITE_TOKEN_STORAGE_KEY)).toBe(false);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.once).textContent).toBe(EXPECTED_TOKEN);
    console.log(`  · 扫了 1 条失败路径：提示「…${note.slice(0, 24)}…」；本会话凭据 0 个，明文仍可复制`);
  });

  it('⑦b 清除时写配置失败 ⇒ 不静默、本会话**不**清（避免两边不一致）', async () => {
    const seeded = 'e'.repeat(64);
    const test = harness({ seed: seeded, updateFails: '写入被拒绝' });
    await mountPane(test.runtime);
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clear));
    fireEvent.click(screen.getByTestId(WRITE_TOKEN_TESTID.clearConfirm));

    await waitFor(() => {
      expect(screen.getByTestId(WRITE_TOKEN_TESTID.note).textContent).toContain('写入被拒绝');
    });
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.note).textContent).toContain('保留');
    expect(test.storage.box.get(WRITE_TOKEN_STORAGE_KEY)).toBe(seeded);
    expect(screen.getByTestId(WRITE_TOKEN_TESTID.state).getAttribute('data-session-credential')).toBe('1');
    console.log('  · 扫了 1 条清除失败路径：提示带原因 + 本会话凭据保留（1 个）');
  });
});
