/**
 * 009 缺陷 1：宿主侧 `Config` 声明（`node --test`，无 DOM、无真机写入）
 *
 * 要证的五件事（每条二值判定）：
 * 1. **不是假 schema**：`createPortsSchema(真工厂)` 造出来的 schema 必须能通过宿主的
 *    `isSchemastery()` 判据（`schema['~standard'].vendor === 'schemastery'`），
 *    并有**真实校验行为**（合法通过、类型错拒绝、语义未知值降级 —— 与 002 同族同口径）；
 * 2. **字段与两侧读写面同源**：`PORTS_CONFIG_FIELDS` = 客户端 5 个写方法产出的 patch 键集合
 *    （少一个 ⇒ 客户端写不进去；多一个 ⇒ 声明了没人用的字段）；
 * 3. 🔴 **五个字段全部 `.volatile()`**（**2026-10-12 订正，旧判据「刻意 0 次」已作废、留痕见下**）：
 *    宿主 `describe()` 的 `volatileForm(schema) !== undefined` 是命名空间出现的**第二道门**，
 *    `write()` 还会对非 volatile 路径直接抛 `Config field "…" is not volatile` ⇒ 字段集必须全标；
 *    代价（活体包装）由**读侧** `src/config-read.ts` 的统一解包承担，不是靠「别标 volatile」躲开；
 * 4. **`writeToken` 另外标 `.role('secret')`**：宿主 `describe()` 一律 `redactSecrets: true`，
 *    不标则该字段会进 `describe().value` ⇒ 凭据明文发给浏览器；
 * 5. **解析失败不造假**：`Config` 要么是上面那种真 schema、要么是 `undefined` + 诊断原话，
 *    绝不允许是第三种（假 schema 会让宿主静默按「无声明」处理，且比 `undefined` 更难发现）。
 *
 * 🔴 本文件**不碰真机**：只用宿主依赖（profile 层 / 002 的 `node_modules`）在**本进程**里
 * 构造 schema 并调用它；「宿主是否真按 volatile 收下这个命名空间」由
 * `tests/unit/config-gate.test.ts` 用**宿主的真 `volatileForm`** 判，「真机 `settings/describe` 里
 * 是否真出现本命名空间」不在本文件能证的范围内（未验项，见 009 tasks.md）。
 */

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  Config,
  CONFIG_DIAGNOSTICS,
  HOST_SCHEMA_MODULE,
  PORTS_CONFIG_FIELDS,
  createPortsSchema,
  hostModuleAnchors,
  isSchemaFactory,
  memberOf,
  resolveSchemaFactory,
} from '../../src/config.ts';
import type { SchemaFactory, SchemaLike } from '../../src/config.ts';
import { createSettingsPipe, SETTINGS_NAMESPACE } from '../../src/client/settings-pipe.ts';
import type { RemoteSettingsLike, SettingsResponse } from '../../src/client/host.ts';
import type { SettingsPatch } from '../../src/client/settings-pipe.ts';

/** 真 schemastery 的 schema 是**可调用**的（`schema(value)` 返回值/抛 ValidationError） */
type CallableSchema = ((value: unknown) => unknown) & { readonly '~standard'?: { readonly vendor?: string } };

function callable(schema: SchemaLike): CallableSchema {
  return schema as unknown as CallableSchema;
}

/** 字段是否是 **volatile 活体包装**（B-1 定案：带 `.get()` 的深冻结对象） */
function isRef(value: unknown): boolean {
  return value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function';
}

/** 解包活体包装（与宿主 `plainConfig` 同口径：`isVolatile(v) ⇒ plainConfig(v.get())`，只用于断言可读值） */
function plain(value: unknown): unknown {
  if (isRef(value)) return plain((value as { get: () => unknown }).get());
  if (Array.isArray(value)) return value.map((item) => plain(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

/**
 * 记录式假工厂：只看结构面（字段清单、哪个字段被标了 `volatile()` / `role()`、`dict` 缺失时的降级）。
 *
 * 🔴 「哪个字段」是**在 `object(fields)` 收口时**反查的：节点在 `volatile()` 那一刻还不知道自己叫
 * 什么名字（链式调用发生在 Object literal 里）⇒ 必须按**节点身份**记标记，等 `object()` 拿到
 * 字段→节点映射后再回答「哪个字段标了」。
 */
function recordingFactory(withDict: boolean): {
  readonly z: SchemaFactory;
  readonly volatileCalls: () => number;
  readonly volatileFields: () => readonly string[];
  readonly roleOf: (field: string) => string | undefined;
  readonly fields: () => readonly string[];
  readonly kindOf: (field: string) => string;
} {
  let volatileCalls = 0;
  let captured: Record<string, SchemaLike> = {};
  const kinds = new Map<SchemaLike, string>();
  const volatileHit = new Set<SchemaLike>();
  const roles = new Map<SchemaLike, string>();
  const make = (kind: string): SchemaLike => {
    const node = {
      kind,
      volatile(): SchemaLike {
        volatileCalls += 1;
        volatileHit.add(node as unknown as SchemaLike);
        return node;
      },
      role(role: string): SchemaLike {
        roles.set(node as unknown as SchemaLike, role);
        return node;
      },
    };
    kinds.set(node as unknown as SchemaLike, kind);
    return node as unknown as SchemaLike;
  };
  const z: SchemaFactory = {
    any: () => make('any'),
    array: () => make('array'),
    object: (fields) => {
      captured = fields;
      return make('object');
    },
    string: () => make('string'),
  };
  if (withDict) z.dict = () => make('dict');
  return {
    z,
    volatileCalls: () => volatileCalls,
    volatileFields: () => Object.keys(captured).filter((field) => volatileHit.has(captured[field] as SchemaLike)),
    roleOf: (field) => roles.get(captured[field] as SchemaLike),
    fields: () => Object.keys(captured),
    kindOf: (field) => kinds.get(captured[field] as SchemaLike) ?? '(missing)',
  };
}

/** 本机那份**真**宿主依赖：优先用模块自己的多锚点解析结果，退路是 002 的 `node_modules` 链接 */
function realFactory(): { readonly z: SchemaFactory; readonly from: string } {
  const resolved = CONFIG_DIAGNOSTICS.resolution;
  if (resolved.factory !== undefined) return { z: resolved.factory, from: resolved.resolvedFrom ?? '(resolved)' };
  const anchor = new URL('../../terminal-profiles/package.json', import.meta.url).href;
  const viaSibling = resolveSchemaFactory([anchor]);
  assert.notEqual(viaSibling.factory, undefined, `本机找不到 ${HOST_SCHEMA_MODULE}（profile 层与 002 链接都不可用）⇒ 无法证明「不是假 schema」`);
  return { z: viaSibling.factory as SchemaFactory, from: viaSibling.resolvedFrom ?? anchor };
}

test('009 缺陷 1：字段清单 = 客户端 5 个写方法产出的 patch 键集合（与两侧读写面同源）', async () => {
  const record = recordingFactory(true);
  createPortsSchema(record.z);
  assert.deepEqual(record.fields(), [...PORTS_CONFIG_FIELDS], 'schema 字段必须与 PORTS_CONFIG_FIELDS 逐字一致');

  const written: string[] = [];
  const service: RemoteSettingsLike = {
    describe: async (): Promise<SettingsResponse> => ({ ok: true, value: { namespaces: [{ ns: SETTINGS_NAMESPACE, revision: 1, value: {} }] } }),
    update: async (_ns: string, patch: SettingsPatch): Promise<SettingsResponse> => {
      written.push(...Object.keys(patch));
      return { ok: true, value: {} };
    },
    // 本用例只数 `update` 的 patch 键集合（「五个字段都有声明」）；清除走 mutate，这里不该被调到 ⇒ 抛。
    mutate: async (): Promise<SettingsResponse> => {
      throw new Error('本用例不该走 mutate');
    },
  };
  const pipe = createSettingsPipe(() => service);
  await pipe.writeManagedPorts(['3306']);
  await pipe.writeDistro('Ubuntu2204');
  await pipe.writeElevationPolicy('ask');
  await pipe.writeScope(3306, 'lan');
  await pipe.writeWriteToken('t'.repeat(64));
  assert.deepEqual([...new Set(written)].sort(), [...PORTS_CONFIG_FIELDS].sort(), '客户端写过的键必须逐个在 schema 里有声明');
  console.log(`  · 扫了 ${String(record.fields().length)} 个字段与 ${String(written.length)} 次写入：键集合完全一致`);
});

test('009 缺陷 1（2026-10-12 订正）：五个字段**全部** `.volatile()`，`writeToken` 另带 `role(secret)`', () => {
  const record = recordingFactory(true);
  createPortsSchema(record.z);
  // 🔴 旧判据「构建期 volatile() 0 次」**已作废**：它把缺陷 1 的修法判成违规。真机两次给出依据：
  // ① describe() 的 volatileForm 门（0 volatile ⇒ 命名空间整个消失）；② write() 的
  // `Config field "…" is not volatile`（非 volatile 字段根本写不进去）。两处都在 `src/config.ts` 文件头留痕。
  assert.deepEqual(
    record.volatileFields(),
    [...PORTS_CONFIG_FIELDS],
    '五个字段必须全标 volatile：少任何一个 ⇒ 命名空间不出现（volatileForm 门）/ update 直接抛 is not volatile / describe().value 里读不回来',
  );
  assert.equal(record.volatileCalls(), PORTS_CONFIG_FIELDS.length, '`volatile()` 调用次数必须**恰好**等于字段数（不许多标）');
  assert.equal(record.roleOf('writeToken'), 'secret', 'writeToken 必须标 role(secret)：宿主 redactSecrets: true ⇒ 不标则凭据明文进 describe().value');
  assert.deepEqual(
    PORTS_CONFIG_FIELDS.filter((field) => record.roleOf(field) !== undefined),
    ['writeToken'],
    '只有 writeToken 是 secret（别的字段标了会白白从 describe().value 里消失，客户端读不到）',
  );
  console.log(`  · 扫了 ${String(PORTS_CONFIG_FIELDS.length)} 个字段：volatile ${record.volatileFields().join('/')}（${String(record.volatileCalls())} 次调用）；secret 仅 writeToken`);
});

test('009 缺陷 1：`dict` 缺失只降级 `scopes`，不放弃整个工厂', () => {
  const withDict = recordingFactory(true);
  const without = recordingFactory(false);
  createPortsSchema(withDict.z);
  createPortsSchema(without.z);
  assert.equal(withDict.kindOf('scopes'), 'dict');
  assert.equal(without.kindOf('scopes'), 'any', '没有 dict 时 scopes 降级为 any，其余四个字段照旧');
  assert.equal(without.kindOf('managedPorts'), 'array');
  assert.equal(without.fields().length, PORTS_CONFIG_FIELDS.length);
  console.log('  · 扫了 2 份工厂：有 dict ⇒ scopes=dict；无 dict ⇒ scopes=any（其余 4 字段不变）');
});

test('009 缺陷 1：真工厂 ⇒ 真 schema（宿主判据 vendor=schemastery）+ 真校验行为 + 活体形态', () => {
  const { z, from } = realFactory();
  const schema = callable(createPortsSchema(z));
  assert.equal(schema['~standard']?.vendor, 'schemastery', `宿主的 isSchemastery() 判的就是这个（Zod 会让 volatile 静默失效）；来源：${from}`);

  const empty = schema(undefined) as Record<string, unknown>;
  assert.deepEqual(
    PORTS_CONFIG_FIELDS.filter((field) => isRef(empty[field])),
    [...PORTS_CONFIG_FIELDS],
    '🔴 **第二层陷阱的现场证据**：五个字段解析出来都是带 `.get()` 的活体包装（宿主交给我们的是包装，不是值）',
  );
  assert.deepEqual(
    plain(empty),
    { managedPorts: [], scopes: {}, distro: undefined, elevationPolicy: undefined, writeToken: undefined },
    '缺省值（**解包后**）：两个集合为空；三个字符串字段缺省 = `undefined`（`get()` 取到 undefined ⇒ 客户端读到「未配置」）',
  );

  const full = { managedPorts: ['3306', '1000-3000'], scopes: { '3306': 'lan' }, distro: 'Ubuntu2204', elevationPolicy: 'ask', writeToken: 'x' };
  const resolved = schema(full) as Record<string, unknown>;
  assert.deepEqual(plain(resolved), full, '合法文档解包后原样通过');
  assert.deepEqual(
    PORTS_CONFIG_FIELDS.filter((field) => isRef(resolved[field])),
    [...PORTS_CONFIG_FIELDS],
    '合法文档同样全部是活体包装 ⇒ 读侧必须统一走 src/config-read.ts（直接属性读会拿到包装对象）',
  );
  assert.equal((resolved['writeToken'] as { get(): unknown }).get(), 'x', '凭据在**解析结果**里是能取到的（脱敏只发生在 describe 的出口，不影响宿主自用）');

  for (const bad of [{ managedPorts: 3306 }, { elevationPolicy: 5 }, { writeToken: 42 }]) {
    assert.throws(() => schema(bad), /expected (array|string)/u, `类型错必须被拒：${JSON.stringify(bad)}`);
  }
  // 语义未知值**不**在 schema 层拒绝：003 的既定口径是「认不出 ⇒ unknown ⇒ 落 none」（fail-safe 在语义层）
  const degraded = plain(schema({ elevationPolicy: 'bogus' })) as { readonly elevationPolicy?: string };
  assert.equal(degraded.elevationPolicy, 'bogus', '未知策略值必须在 schema 层放行（降级由语义层做，不在 schema 层抛）');
  console.log(`  · 扫了 1 份真 schema（来源 ${from}）：缺省/合法/3 类类型错/1 个语义未知值；活体包装 5/5 已确证`);
});

test('009 缺陷 1：解析器 —— 结构面判定与 `default` 互操作（缺一个方法就拒绝）', () => {
  const { z } = realFactory();
  assert.equal(isSchemaFactory(z), true, '真 schemastery 导出是**可调用对象**，判定必须接受');
  assert.equal(
    isSchemaFactory({ any: () => undefined, array: () => undefined, object: () => undefined }),
    false,
    '缺少 string ⇒ 拒绝（本包要用它；否则构建期 TypeError 会把插件装载打死）',
  );
  assert.equal(isSchemaFactory({ default: { any: () => undefined } }), false);
  assert.equal(isSchemaFactory(null), false);
  assert.equal(isSchemaFactory('schemastery'), false);

  const wrapped = { default: { Schema: z } };
  assert.equal(memberOf(wrapped, 'Schema'), z, 'direct member 优先');
  assert.equal(memberOf({ default: z }, 'Schema'), undefined, '`default` 里没有该成员 ⇒ undefined（不瞎猜）');
  console.log('  · 扫了 6 组：真工厂通过 / 缺 string 拒绝 / null / 字符串 / 两个 memberOf 分支');
});

test('009 缺陷 1：解析失败留原话（绝不静默、绝不造假）', () => {
  const missing = resolveSchemaFactory(['C:/definitely/not/here/index.js']);
  assert.equal(missing.factory, undefined);
  assert.equal(missing.resolvedFrom, null);
  assert.equal(missing.attempts.length, 1);
  assert.equal(missing.attempts[0]?.ok, false);
  assert.equal(missing.attempts[0]?.detail, 'MODULE_NOT_FOUND', '失败原因必须原样留下（诊断靠它）');
  console.log(`  · 扫了 1 个不存在的锚点：${String(missing.attempts[0]?.detail)}（factory=undefined，造不出假 schema）`);
});

test('009 缺陷 1：模块级事实 —— `Config` 要么是真 schema、要么是 undefined + 全部失败原话', () => {
  const diagnostics = CONFIG_DIAGNOSTICS;
  assert.ok(diagnostics.anchors.length >= 3, '锚点必须多于一个（单锚点在本包实测 MODULE_NOT_FOUND）');
  for (const anchor of diagnostics.anchors) {
    assert.ok(anchor.startsWith('file:') || /^[A-Za-z]:[\\/]/u.test(anchor) || anchor.startsWith('/'), `锚点必须是绝对路径/URL：${anchor}`);
  }
  assert.equal(new Set(diagnostics.anchors).size, diagnostics.anchors.length, '锚点不得重复');
  if (Config === undefined) {
    assert.equal(diagnostics.resolution.resolvedFrom, null);
    assert.ok(diagnostics.resolution.attempts.length >= diagnostics.anchors.length - 1, '失败时每个锚点都要留原话');
    console.log(`  · Config=undefined（全部锚点失败，原话已留）：${diagnostics.resolution.attempts.map((item) => `${item.anchor}=${item.detail}`).join(' / ')}`);
  } else {
    assert.equal(callable(Config)['~standard']?.vendor, 'schemastery', 'Config 存在时必须是真 schemastery schema，不许是假 schema');
    assert.equal(diagnostics.buildError, null);
    console.log(`  · Config 由「${String(diagnostics.resolution.resolvedFrom)}」解析：vendor=schemastery，字段 ${PORTS_CONFIG_FIELDS.join('/')}`);
  }
  console.log(`  · 锚点共 ${String(diagnostics.anchors.length)} 个；已试 ${String(diagnostics.resolution.attempts.length)} 个`);
});

test('009 缺陷 1：入口两种形态都带 `Config`（宿主按包根解析，具名与默认对象都要有）', async () => {
  const entry = await import('../../src/index.ts');
  assert.equal(entry.Config, Config, '具名导出必须是同一份 Config');
  assert.equal((entry.default as { Config?: unknown }).Config, Config, '默认对象也必须带 Config（免疫宿主侧解析差异）');
  assert.equal((entry.default as { name?: unknown }).name, 'dsh-wsl-docker-ports');
  console.log('  · 扫了 2 种入口形态：具名导出与 default.Config 都是同一份 Config');
});

test('009 缺陷 1：宿主配置模块的运行时导出面 = 预期清单（不许夹带执行/提权入口）', async () => {
  const module = await import('../../src/config.ts');
  const names = Object.keys(module).filter((key) => key !== 'default').sort();
  const expected = [
    'CONFIG_DIAGNOSTICS',
    'Config',
    'HOST_SCHEMA_MODULE',
    'PORTS_CONFIG_FIELDS',
    'PROFILE_ANCHOR_MAX',
    'createPortsSchema',
    'hostModuleAnchors',
    'isSchemaFactory',
    'memberOf',
    'resolveSchemaFactory',
  ].sort();
  assert.deepEqual(names, expected, '新增导出必须显式登记（否则「悄悄多一条执行入口」不会被任何断言拦住）');
  for (const forbidden of ['run', 'invoke', 'exec', 'elevate', 'spawn']) assert.equal(names.includes(forbidden), false, `配置模块不得出现 ${forbidden}`);
  console.log(`  · 扫了 ${String(names.length)} 个运行时导出：与预期清单一致，执行/提权类名字 0 个`);
});

test('009 缺陷 1：锚点覆盖 profile 层（本机实测唯一解析得到的那一族）', () => {
  const anchors = hostModuleAnchors();
  const profileAnchors = anchors.filter((anchor) => anchor.includes('.dsh') && anchor.includes('profiles'));
  assert.ok(profileAnchors.length >= 1, `必须包含 profile 层锚点（本机实测它能解析到，profile 公共层与自身锚点都失败）：${anchors.join(' / ')}`);
  console.log(`  · 扫了 ${String(anchors.length)} 个锚点，其中 profile 层 ${String(profileAnchors.length)} 个：${profileAnchors.slice(0, 3).join(' / ')}`);
});

test('009 缺陷 1 补强（2026-10-15）：锚点覆盖宿主**自带嵌套依赖树**（全局 npm 安装形态），且**只追加在末尾**', (t) => {
  // 本机实测（2026-10-15）：`D:\nodejs\node_modules\@deepseek-ai\` 下只有 `dsh` 与 `dsh-acp-app`，
  // **没有平铺的** schemastery；宿主把它嵌套在包里。缺这一族 ⇒ ①–⑤ 全 MODULE_NOT_FOUND ⇒
  // `Config === undefined`（5 条宿主判据红 + `check:exports` 的「Config 在场」红，同一根因）。
  const anchors = hostModuleAnchors();
  const nested = join(dirname(process.execPath), 'node_modules/@deepseek-ai/dsh/index.js');
  assert.ok(anchors.includes(nested), `必须包含宿主 CLI 包的嵌套落点锚点：${nested}`);
  assert.equal(anchors[anchors.length - 1], nested, '**只追加**：新族必须是最后一个锚点 ⇒ 既有环境的命中顺序与语义一字不动');

  const viaNested = resolveSchemaFactory([nested]);
  if (viaNested.factory === undefined) {
    // 宿主不在这一形态（Electron 打包 / 未装 / 别的安装形态）⇒ **如实**说清并 skip，不造假判定
    console.log(`  · 本机没有这一形态的宿主依赖树（${String(viaNested.attempts[0]?.detail)}）⇒ 该族解析不到是如实结果`);
    t.skip('本机无该形态宿主依赖树');
    return;
  }
  assert.equal(isSchemaFactory(viaNested.factory), true, '解析到的必须是**真工厂**（any/array/object/string 齐备）');
  const vendor = (viaNested.factory.string() as unknown as CallableSchema)['~standard']?.vendor;
  assert.equal(vendor, 'schemastery', '宿主 `isSchemastery()` 判的就是这个 vendor 串（Zod 会让 volatile 静默失效）');
  console.log(`  · 从新族锚点解析到真 schemastery：${String(viaNested.resolvedFrom)}`);
  console.log(`  · 锚点共 ${String(anchors.length)} 个，新族在**末位**（第 ${String(anchors.length)} 位）：${nested}`);
});
