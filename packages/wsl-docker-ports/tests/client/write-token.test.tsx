/**
 * 008 T3.1 判据：**凭据持有面**（契约 1/2：sessionStorage、不落盘、不进日志、一次性显示）
 *
 * 这些断言不需要 DOM：`StorageLike` 与 `randomBytes` 都可注入 ⇒ 「存了什么、清了什么、
 * 生成失败时有没有偷偷存下来」全部是确定的。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  bytesToHex,
  createMemoryStorage,
  createWriteTokenStore,
  generateWriteToken,
  issueWriteToken,
  WRITE_TOKEN_BYTES,
  WRITE_TOKEN_STORAGE_KEY,
  type StorageLike,
} from '../../src/client/write-token.ts';

function fakeStorage(): StorageLike & { readonly box: Map<string, string> } {
  const box = new Map<string, string>();
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

const BYTES = Uint8Array.from({ length: WRITE_TOKEN_BYTES }, (_, index) => index);

describe('T3.1 凭据仓库：sessionStorage 命名空间键 + 不落盘', () => {
  it('键名逐字是带命名空间的那个；save/read/clear 只在 sessionStorage 那一格里动', () => {
    expect(WRITE_TOKEN_STORAGE_KEY).toBe('dsh-wsl-docker-ports.writeToken');
    const storage = fakeStorage();
    const store = createWriteTokenStore(storage);
    expect(store.present()).toBe(false);
    expect(store.read()).toBeUndefined();

    store.save('  tok-1  ');
    expect(store.present()).toBe(true);
    expect(store.read()).toBe('tok-1');
    expect([...storage.box.keys()]).toEqual([WRITE_TOKEN_STORAGE_KEY]);

    store.clear();
    expect(store.present()).toBe(false);
    console.log(`  · 扫了 1 个键（${WRITE_TOKEN_STORAGE_KEY}）：save/read/clear 三步全落在同一格`);
  });

  it('空白串一律算「没有凭据」（与 write-auth 的 trim 口径一致）', () => {
    const storage = fakeStorage();
    storage.box.set(WRITE_TOKEN_STORAGE_KEY, '   ');
    expect(createWriteTokenStore(storage).read()).toBeUndefined();
    const store = createWriteTokenStore(storage);
    store.save('   ');
    expect(storage.box.get(WRITE_TOKEN_STORAGE_KEY)).toBe('   ');
    expect(store.present()).toBe(false);
    console.log('  · 扫了 2 处空白输入：read 与 present 都归一成 undefined/false');
  });

  it('没有存储可用时降级为**内存**实现（宁可丢凭据也不落盘）', () => {
    const store = createWriteTokenStore(undefined);
    expect(store.present()).toBe(false);
    store.save('tok-2');
    expect(store.read()).toBe('tok-2');
    store.clear();
    expect(store.present()).toBe(false);
    const memory = createMemoryStorage();
    memory.setItem('k', 'v');
    expect(memory.getItem('k')).toBe('v');
    memory.removeItem('k');
    expect(memory.getItem('k')).toBeNull();
    console.log('  · 扫了 1 条降级路径 + 内存实现 3 个方法');
  });
});

describe('T3.1 生成：32 字节随机 → 十六进制（确定值可复算）', () => {
  it('字节数 = 32、输出 64 位十六进制、可复算', () => {
    expect(WRITE_TOKEN_BYTES).toBe(32);
    const token = generateWriteToken(() => BYTES);
    expect(token).toHaveLength(64);
    expect(token).toBe(bytesToHex(BYTES));
    expect(token).toMatch(/^[0-9a-f]{64}$/u);
    const other = generateWriteToken(() => Uint8Array.from({ length: WRITE_TOKEN_BYTES }, () => 255));
    expect(other).not.toBe(token);
    console.log(`  · 扫了 2 次生成：长度 64 / 只含 [0-9a-f] / 不同字节给出不同串`);
  });

  it('默认取真随机源（crypto.getRandomValues）且两次不同', () => {
    const first = generateWriteToken();
    const second = generateWriteToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(second).not.toBe(first);
    console.log(`  · 扫了 2 次默认生成：真随机源可用、两次不同`);
  });
});

describe('T3.1 一次性颁发：配置写成功才入本会话', () => {
  it('保存成功 ⇒ 入 sessionStorage 且提示「只显示这一次」', async () => {
    const store = createWriteTokenStore(fakeStorage());
    const saved: string[] = [];
    const result = await issueWriteToken({
      store,
      randomBytes: () => BYTES,
      save: async (token) => {
        saved.push(token);
        return { ok: true, message: '配置已写入（live 路径，不重挂载）' };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.token).toBe(bytesToHex(BYTES));
    expect(saved).toEqual([result.token]);
    expect(store.read()).toBe(result.token);
    expect(result.message).toContain('只显示这一次');
    console.log(`  · 扫了 1 次成功颁发：配置侧收到 1 次，本会话 1 次，文案含「只显示这一次」`);
  });

  it('配置写失败 ⇒ **不**入本会话（不留一个服务端不认的凭据），但明文仍交回给用户手工填', async () => {
    const store = createWriteTokenStore(fakeStorage());
    const result = await issueWriteToken({
      store,
      randomBytes: () => BYTES,
      save: async () => ({ ok: false, message: '配置写入失败：只读' }),
    });
    expect(result.ok).toBe(false);
    expect(result.token).toBe(bytesToHex(BYTES));
    expect(store.present()).toBe(false);
    expect(result.message).toContain('凭据**未**存入本会话');
    console.log('  · 扫了 1 次失败颁发：本会话凭据数 0，明文仍可一次性复制');
  });

  it('save 抛异常 ⇒ 归成失败结果（不把异常穿过 UI）', async () => {
    const store = createWriteTokenStore(fakeStorage());
    const result = await issueWriteToken({
      store,
      randomBytes: () => BYTES,
      save: async () => {
        throw new Error('boom');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('boom');
    expect(store.present()).toBe(false);
    console.log('  · 扫了 1 条抛异常路径：结果仍是判别联合');
  });
});

describe('T3.1 红线（静态）：凭据绝不进日志、绝不落盘', () => {
  it('四个写通道客户端文件里零 console 调用、零持久存储用法', () => {
    const dir = path.join(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'), 'src', 'client');
    const files = ['write-token.ts', 'write-channel.ts', 'write-confirm.tsx', 'write-panel.tsx'];
    const hits: string[] = [];
    let bytes = 0;
    for (const file of files) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      bytes += Buffer.byteLength(text);
      // 扫**用法**而不是注释文字：注释里可以讨论「为什么不落盘」，代码里不许真去碰它
      if (text.includes('console.')) hits.push(`${file}:console`);
      if (text.includes('localStorage.') || text.includes('localStorage[')) hits.push(`${file}:localStorage`);
    }
    expect(hits).toEqual([]);
    // 唯一的存储入口是 sessionStorage（且只在 defaultSessionStorage 里软取一次）
    const tokenSource = readFileSync(path.join(dir, 'write-token.ts'), 'utf8');
    expect(tokenSource).toContain('globalThis');
    expect(tokenSource).toContain('sessionStorage');
    console.log(`  · 扫了 ${String(files.length)} 个文件 / ${String(bytes)} 字节：console. 0 处、localStorage 用法 0 处`);
  });

  it('提示文案里不含任何凭据本体（只指路，不回显）', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = createWriteTokenStore(fakeStorage());
    const result = await issueWriteToken({
      store,
      randomBytes: () => BYTES,
      save: async () => ({ ok: true, message: '配置已写入' }),
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(result.message).not.toContain(result.token);
    console.log('  · 扫了 1 条文案 + 1 个 console.log 探针：凭据本体 0 次出现');
  });
});
