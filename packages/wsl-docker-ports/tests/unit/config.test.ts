/**
 * 009 缺陷 1：宿主侧 `Config` 声明（`node --test`，无 DOM、无真机写入）
 *
 * 要证的四件事（每条二值判定）：
 * 1. **不是假 schema**：`createPortsSchema(真工厂)` 造出来的 schema 必须能通过宿主的
 *    `isSchemastery()` 判据（`schema['~standard'].vendor === 'schemastery'`），
 *    并有**真实校验行为**（合法通过、类型错拒绝、语义未知值降级 —— 与 002 同族同口径）；
 * 2. **字段与两侧读写面同源**：`PORTS_CONFIG_FIELDS` = 客户端 5 个写方法产出的 patch 键集合
 *    （少一个 ⇒ 客户端写不进去；多一个 ⇒ 声明了没人用的字段）；
 * 3. **刻意不 volatile**：本包入口按**直接属性读**取策略/凭据，标 volatile 会读成 `undefined`
 *    ⇒ 提权落 `none`、凭据永久 401。所以 schema 构建期 **0 次** `volatile()` 调用（硬断言）；
 * 4. **解析失败不造假**：`Config` 要么是上面那种真 schema、要么是 `undefined` + 诊断原话，
 *    绝不允许是第三种（假 schema 会让宿主静默按「无声明」处理，且比 `undefined` 更难发现）。
 *
 * 🔴 本文件**不碰真机**：只用宿主依赖（profile 层 / 002 的 `node_modules`）在**本进程**里
 * 构造 schema 并调用它 —— 「真机 `settings/describe` 里是否真出现本命名空间」不在本文件能证的范围内。
 */

import assert from 'node:assert/strict';
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

/** 记录式假工厂：只看结构面（字段清单、`volatile()` 调用次数、`dict` 缺失时的降级） */
function recordingFactory(withDict: boolean): {
  readonly z: SchemaFactory;
  readonly volatileCalls: () => number;
  readonly fields: () => readonly string[];
  readonly kindOf: (field: string) => string;
} {
  let volatileCalls = 0;
  let captured: Record<string, SchemaLike> = {};
  const kinds = new Map<SchemaLike, string>();
  const make = (kind: string): SchemaLike => {
    const node = {
      kind,
      volatile(): SchemaLike {
        volatileCalls += 1;
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

test('009 缺陷 1：刻意不 volatile（构建期 `volatile()` 调用 0 次）', () => {
  const record = recordingFactory(true);
  createPortsSchema(record.z);
  assert.equal(record.volatileCalls(), 0, `本包入口是**直接属性读**（config.elevationPolicy / writeToken / distro）：标 volatile 会读成 undefined ⇒ 提权落 none、凭据永久 401，故必须是 0 次`);
  assert.deepEqual(record.fields(), [...PORTS_CONFIG_FIELDS]);
  console.log('  · 扫了 1 份 schema：volatile() 0 次（ordinary 字段，与 002 的 profiles 数组刻意不同）');
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

test('009 缺陷 1：真工厂 ⇒ 真 schema（宿主判据 vendor=schemastery）+ 真校验行为', () => {
  const { z, from } = realFactory();
  const schema = callable(createPortsSchema(z));
  assert.equal(schema['~standard']?.vendor, 'schemastery', `宿主的 isSchemastery() 判的就是这个（Zod 会让 volatile 静默失效）；来源：${from}`);

  assert.deepEqual(schema(undefined), { managedPorts: [], scopes: {} }, '缺省值：两个集合为空，三个字符串字段可缺省');
  assert.deepEqual(
    schema({ managedPorts: ['3306', '1000-3000'], scopes: { '3306': 'lan' }, distro: 'Ubuntu2204', elevationPolicy: 'ask', writeToken: 'x' }),
    { managedPorts: ['3306', '1000-3000'], scopes: { '3306': 'lan' }, distro: 'Ubuntu2204', elevationPolicy: 'ask', writeToken: 'x' },
    '合法文档原样通过',
  );

  for (const bad of [{ managedPorts: 3306 }, { elevationPolicy: 5 }, { writeToken: 42 }]) {
    assert.throws(() => schema(bad), /expected (array|string)/u, `类型错必须被拒：${JSON.stringify(bad)}`);
  }
  // 语义未知值**不**在 schema 层拒绝：003 的既定口径是「认不出 ⇒ unknown ⇒ 落 none」（fail-safe 在语义层）
  const degraded = schema({ elevationPolicy: 'bogus' }) as { readonly elevationPolicy?: string };
  assert.equal(degraded.elevationPolicy, 'bogus', '未知策略值必须在 schema 层放行（降级由语义层做，不在 schema 层抛）');
  console.log(`  · 扫了 1 份真 schema（来源 ${from}）：缺省/合法/3 类类型错/1 个语义未知值，行为与 002 同族一致`);
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
