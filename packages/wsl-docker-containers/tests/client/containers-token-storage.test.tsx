// @vitest-environment jsdom
/**
 * 019 判据 AC2 / AC4 / AC6：**客户端凭据存储**的三件事
 *
 * - AC6：键 = `wsl-containers.writeToken`（曾经误抄成转发侧的键名）；
 * - AC2：转发侧那格（`dsh-wsl-docker-ports.writeToken`）**不会**被容器侧读到/覆盖（两通道不互抢）；
 * - AC4：缺省存储**优先 `localStorage`**（模拟重启 = 新建仓库实例仍能读到），取不到才退 `sessionStorage`。
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  WRITE_TOKEN_STORAGE_KEY,
  createWriteTokenStore,
  defaultTokenStorage,
} from '../../src/client/write-token.ts';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 假 `localStorage` / `sessionStorage`（各自独立的一格柜子） */
function box(seed: Record<string, string> = {}): StorageLike & { readonly rows: Record<string, string> } {
  const rows: Record<string, string> = { ...seed };
  return {
    rows,
    getItem: (key) => (key in rows ? (rows[key] as string) : null),
    setItem: (key, value) => {
      rows[key] = value;
    },
    removeItem: (key) => {
      delete rows[key];
    },
  };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

describe('019 AC6：键 = 容器页自己的命名空间', () => {
  it('AC6 键名逐字 = `wsl-containers.writeToken`（不是转发侧那个）', () => {
    expect(WRITE_TOKEN_STORAGE_KEY).toBe('wsl-containers.writeToken');
    console.log(`  · AC6 键 = ${WRITE_TOKEN_STORAGE_KEY}`);
  });
});

describe('019 AC2：两侧各占一格，互不覆盖', () => {
  it('AC2 转发侧写了自己的键 ⇒ 容器侧读不到（反之亦然）', () => {
    const shared = box({ 'dsh-wsl-docker-ports.writeToken': 'ports-secret' });
    const containers = createWriteTokenStore(shared);

    expect(containers.read()).toBeUndefined(); // 端口转发那串对容器通道无效
    containers.save('containers-secret');
    expect(shared.rows['dsh-wsl-docker-ports.writeToken']).toBe('ports-secret'); // 没被覆盖
    expect(shared.rows[WRITE_TOKEN_STORAGE_KEY]).toBe('containers-secret');
    console.log('  · AC2 同柜两键：ports-secret 原样保留，容器侧另占一格');
  });

});

describe('019 AC4：持久化优先 localStorage（重启不丢）', () => {
  it('AC4 两个存储都在 ⇒ 选 localStorage；只用它写，sessionStorage 一格不占', () => {
    const local = box();
    const session = box();
    (globalThis as { localStorage?: unknown }).localStorage = local;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = session;

    const picked = defaultTokenStorage();
    expect(picked).toBe(local);

    const store = createWriteTokenStore(picked);
    store.save('persisted-secret');
    expect(local.rows[WRITE_TOKEN_STORAGE_KEY]).toBe('persisted-secret');
    expect(Object.keys(session.rows)).toEqual([]);

    // 「重启」= 新仓库实例读同一份 localStorage
    const afterRestart = createWriteTokenStore(defaultTokenStorage());
    expect(afterRestart.read()).toBe('persisted-secret');
    console.log('  · AC4 选中 localStorage；新实例仍读到同一串（sessionStorage 空白）');
  });

  it('AC4 localStorage 存在但一用就抛（配额/隐私模式）⇒ 仍选它；save 静默不落盘、不炸', () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    (globalThis as { localStorage?: unknown }).localStorage = broken;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = box();

    // 019：**不做探写**（省主包字节）⇒ 选中即用；不可写由仓库的 try/catch 兜住
    expect(defaultTokenStorage()).toBe(broken);
    const store = createWriteTokenStore(defaultTokenStorage());
    expect(() => store.save('cannot-persist')).not.toThrow();
    expect(store.read()).toBeUndefined();
    console.log('  · AC4 存储不可写：save 不抛、read 仍为空（不静默谎报已保存）');
  });

  it('AC4 一个都没有 ⇒ undefined ⇒ 仓库降级内存（仍能读写，只是刷新即丢）', () => {
    expect(defaultTokenStorage()).toBeUndefined();
    const store = createWriteTokenStore(undefined);
    store.save('memory-only');
    expect(store.read()).toBe('memory-only');
    console.log('  · AC4 无存储 ⇒ 内存降级，read 仍可用');
  });
});

