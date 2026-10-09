/**
 * T1.1 的**声明面**：`createProfilesSchema`（REQ-1.1 字段口径 + REQ-1.2 逐条容错 + REQ-2.1 的 volatile 硬边界）
 *
 * 本 Phase 不 import schemastery（零运行时依赖 + 本机 workspace 里没有它）⇒ 注入一个**假 z**，
 * 断言我们「**怎么声明**」：
 * ① 🔴 `.volatile()` **只打在整个 `profiles` 数组节点**上（标进元素内 ⇒ parse 时抛
 *    `ValidationError`；漏标 ⇒ 每次保存都重挂载、杀掉运行中的终端）；
 * ② 元素端**故意不校验类型**（`z.any()`）—— 否则 schemastery 会让**整数组**因一条坏配置失败，
 *    与 REQ-1.2「单条坏只跳过该条」直接冲突（判定全部归 `parseProfiles`）。
 */

import { describe, expect, it } from 'vitest';

import type { SchemaFactory, SchemaLike } from '../../src/config/schema.ts';
import { PROFILE_FIELD_KEYS, createProfilesSchema } from '../../src/config/schema.ts';

/** 假 schemastery 节点：既是 `SchemaLike`，又记录自己被调用过什么 */
interface FakeNode extends SchemaLike {
  readonly kind: 'any' | 'array' | 'object';
  volatileCalls: number;
  inner?: FakeNode;
  shape?: Record<string, FakeNode>;
}

function fakeZ(): SchemaFactory {
  const make = (kind: FakeNode['kind'], extra: Pick<FakeNode, 'inner' | 'shape'> = {}): FakeNode => {
    const node = { kind, volatileCalls: 0, ...extra } as unknown as FakeNode;
    node.volatile = () => {
      node.volatileCalls += 1;
      return node;
    };
    return node;
  };
  return {
    any: () => make('any'),
    array: (inner) => make('array', { inner: inner as FakeNode }),
    object: (shape) => make('object', { shape: shape as Record<string, FakeNode> }),
  };
}

/** 建 schema 并拿回可检查的根节点 */
function build(): FakeNode {
  return createProfilesSchema(fakeZ()) as unknown as FakeNode;
}

/** 展平整棵树：断言「全树只有一处 volatile」不能只看根 */
function walk(node: FakeNode): FakeNode[] {
  return [
    node,
    ...(node.inner === undefined ? [] : walk(node.inner)),
    ...Object.values(node.shape ?? {}).flatMap((child) => walk(child)),
  ];
}

describe('T1.1 createProfilesSchema —— 声明形状（REQ-1.1 / REQ-1.2）', () => {
  it('REQ-1.1 正常：外壳是 object，含 profiles 数组，元素是 any（宽松谓词）', () => {
    const root = build();
    expect(root.kind).toBe('object');
    expect(root.shape?.['profiles']?.kind).toBe('array');
    expect(root.shape?.['profiles']?.inner?.kind).toBe('any');
  });

  it('REQ-1.2 正常：schema 层**不做**条目校验（没有 object/string 谓词、没有 required/default）——这就是「单条坏只跳过该条」的成立条件', () => {
    const root = build();
    // 全树只有 3 个节点，谓词只有 any / array / object ⇒ 没有逐字段的类型声明
    expect(walk(root).map((n) => n.kind)).toStrictEqual(['object', 'array', 'any']);
    // 若有人把元素换回 z.object({...})，这一条会立刻变红，提醒他 REQ-1.2 会被牺牲
    expect(walk(root).filter((n) => n.kind === 'object')).toHaveLength(1);
  });
});

describe('T1.1 createProfilesSchema —— volatile 接线（REQ-2.1 的硬边界）', () => {
  it('REQ-2.1 正常：`.volatile()` 全树恰好一次，且打在 **profiles 数组节点**上（不是元素内、不是根）', () => {
    const root = build();
    expect(root.shape?.['profiles']?.volatileCalls).toBe(1);
    expect(walk(root).filter((n) => n.volatileCalls > 0)).toHaveLength(1);
    expect(root.volatileCalls).toBe(0);
    expect(root.shape?.['profiles']?.inner?.volatileCalls).toBe(0);
  });
});

describe('T1.1 createProfilesSchema —— 异常与防漂移', () => {
  it('异常：注入的 z 不满足结构面 ⇒ 立刻抛 TypeError（不静默造出半个 schema）', () => {
    expect(() => createProfilesSchema({} as unknown as SchemaFactory)).toThrow(TypeError);
  });

  it('防漂移：字段口径的单一来源是 PROFILE_FIELD_KEYS（无重复、6 个键）；与 parseProfiles 的穷尽性对照在 profiles.test.ts', () => {
    expect(new Set(PROFILE_FIELD_KEYS).size).toBe(PROFILE_FIELD_KEYS.length);
    expect([...PROFILE_FIELD_KEYS]).toStrictEqual(['name', 'command', 'args', 'env', 'cwd', 'cwdLinux']);
  });
});
