/**
 * 002 T6.1 / T6.2：写入管道 + volatile-only 判定（`src/client/config-pipe.ts`）
 *
 * 判据的写法按主人的硬要求：
 *   - 每条断言都能被一个变异**杀死**（没有「至少调用过」这种废话断言）；
 *   - 「扫了多少」必须打印出来（末尾的 `扫描面统计` 用例）—— 防「零命中假绿」；
 *   - 名字里的 REQ/T 编号可逐条回溯到 `specs/002-terminal-profiles/`。
 *
 * 本文件**不**碰 DOM（`environment: node` 是 vitest 配置的缺省）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CONFIG_PATCH_FIELD,
  CONFIG_ROW_KEY,
  CONFIG_SLOT_NAME,
  DEFAULT_LIVENESS,
  SETTINGS_NAMESPACE,
  VOLATILE_FIELDS,
  classifyPatchFields,
  createConfigPipe,
  describeError,
  isRevisionConflict,
  readNamespaceState,
} from '../../src/client/config-pipe.ts';
import { createFakeRemoteSettings, describeWith } from '../helpers/config-fixtures.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 逐条断言的**实测值**汇总（末尾用例打印出来 ⇒ 判据自己会说自己扫了多少） */
const scan = { assertions: 0, files: 0, bytes: 0 };

function expectThat(label: string, actual: unknown, expected: unknown): void {
  scan.assertions += 1;
  expect(actual, label).toStrictEqual(expected);
}

describe('T6.1 命名空间 / 槽位常量（与 package.json 不漂移）', () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { name: string };

  it('命名空间 = patch 条目 id = 包名（宿主按 row.options.id === ns 寻址，REQ-10.5）', () => {
    expectThat('SETTINGS_NAMESPACE', SETTINGS_NAMESPACE, manifest.name);
    expectThat('CONFIG_ROW_KEY', CONFIG_ROW_KEY, `${manifest.name}#${manifest.name}`);
    expectThat('CONFIG_SLOT_NAME', CONFIG_SLOT_NAME, 'plugins.row.config');
    expectThat('CONFIG_PATCH_FIELD', CONFIG_PATCH_FIELD, 'profiles');
  });

  it('volatile 字段表 = 唯一字段 profiles（不在表里的一律按 ordinary 保守处理）', () => {
    expectThat('VOLATILE_FIELDS', [...VOLATILE_FIELDS], ['profiles']);
  });
});

describe('T6.2 volatile-only 判定（REQ-2.1 / REQ-2.2）', () => {
  it('改 profiles ⇒ volatile-only（不弹确认、走 live 路径）', () => {
    expectThat('classify', classifyPatchFields(['profiles']), { volatileOnly: true, ordinaryFields: [] });
    expectThat('DEFAULT_LIVENESS', DEFAULT_LIVENESS.classify(['profiles']), { volatileOnly: true, ordinaryFields: [] });
  });

  it('含任一 ordinary 字段 ⇒ 需要确认，且字段名回给人看（去重 + 排序）', () => {
    expectThat('单字段', classifyPatchFields(['profiles', 'logLevel']), {
      volatileOnly: false,
      ordinaryFields: ['logLevel'],
    });
    expectThat('去重排序', classifyPatchFields(['zeta', 'profiles', 'alpha', 'zeta']), {
      volatileOnly: false,
      ordinaryFields: ['alpha', 'zeta'],
    });
  });

  it('空字段集 = volatile-only（没有变更根本不会重挂载；是否跳过写盘由调用方决定）', () => {
    expectThat('空集', classifyPatchFields([]), { volatileOnly: true, ordinaryFields: [] });
  });

  it('未知字段一律倒向 ordinary（倒错方向 = 静默重挂载杀终端）', () => {
    expectThat('未知字段', classifyPatchFields(['profiles', 'whatever']).volatileOnly, false);
  });
});

describe('T6.3 只读 / 唯一寻址 / revision 的多形状读取（形状未验证 ⇒ 逐个候选都喂一遍）', () => {
  it('writable:false ⇒ 只读，且原因与路径都要拿到（REQ-10.3）', () => {
    const state = readNamespaceState(
      describeWith({ writable: false, reason: 'home patch 覆盖', documentPath: 'C:\\p\\cordis.patch.yml' }),
    );
    expectThat('只读原因', state.readOnly?.reason, 'home patch 覆盖');
    expectThat('只读路径', state.readOnly?.path, 'C:\\p\\cordis.patch.yml');
  });

  it('readOnly:true + path 候选名（readonly / file / settingsPath / 外层 documentPath）', () => {
    expectThat('readonly kebab', readNamespaceState(describeWith({ readonly: true, path: 'a.yml' })).readOnly?.path, 'a.yml');
    expectThat('file', readNamespaceState(describeWith({ readOnly: true, file: 'b.yml' })).readOnly?.path, 'b.yml');
    expectThat(
      '外层 documentPath 兜底',
      readNamespaceState(describeWith({ writable: false }, { documentPath: 'c.yml' })).readOnly?.path,
      'c.yml',
    );
    const noPath = readNamespaceState(describeWith({ writable: false })).readOnly?.path;
    expectThat('一处都没有 ⇒ 明说未提供（不伪造）', noPath, '（宿主未提供配置文件路径）');
  });

  it('addressable:false ⇒ 唯一寻址限制（REQ-10.5；没说的时候不展示）', () => {
    const limited = readNamespaceState(describeWith({ addressable: false }));
    scan.assertions += 1;
    expect(limited.addressability?.reason).toContain('唯一寻址');
    expectThat('没说 ⇒ 不展示', readNamespaceState(describeWith({})).addressability, undefined);
  });

  it('revision 候选名（revision / etag / version；都没有 ⇒ undefined ⇒ 不带第三参）', () => {
    expectThat('revision', readNamespaceState(describeWith({ revision: 7 })).revision, 7);
    expectThat('etag', readNamespaceState(describeWith({ etag: 'abc' })).revision, 'abc');
    expectThat('version', readNamespaceState(describeWith({ version: 3 })).revision, 3);
    expectThat('都没有', readNamespaceState(describeWith({})).revision, undefined);
  });

  it('rows 读取：value.profiles 优先，value 直接是数组时也认，缺失 = 空数组（不抛）', () => {
    expectThat(
      'value.profiles',
      readNamespaceState(describeWith({ value: { profiles: [{ name: 'a', command: 'wsl.exe' }] } })).rows.length,
      1,
    );
    expectThat('value 是数组', readNamespaceState(describeWith({ value: [{ name: 'b' }] })).rows.length, 1);
    expectThat('缺失', readNamespaceState(describeWith({ value: {} })).rows.length, 0);
    expectThat('命名空间不存在 ⇒ rawFound=false', readNamespaceState({ ok: true, value: { namespaces: [] } }).rawFound, false);
  });
});

describe('T6.1 写入管道（REQ-10.2：唯一管道 = describe + update）', () => {
  it('describe 失败 / 抛错 / 缺服务 ⇒ 三种可读结果（不是抛异常）', async () => {
    const missing = createConfigPipe(() => undefined);
    expectThat('缺服务', (await missing.readConfig()).kind, 'unavailable');

    const failed = createFakeRemoteSettings({ describe: { ok: false, error: 'boom' } });
    expectThat('ok:false', (await createConfigPipe(() => failed).readConfig()).kind, 'failed');

    const thrown = createFakeRemoteSettings({ describeThrows: new Error('ECONNREFUSED') });
    const outcome = await createConfigPipe(() => thrown).readConfig();
    expectThat('抛错', outcome.kind, 'failed');
    expectThat('抛错原因带出来', outcome.kind === 'failed' ? outcome.message.includes('ECONNREFUSED') : false, true);
  });

  it('读成功 ⇒ 原始行 + revision 一起给出（页面据此填表）', async () => {
    const service = createFakeRemoteSettings({
      describe: describeWith({ value: { profiles: [{ name: 'a', command: 'wsl.exe' }] }, revision: 9 }),
    });
    const outcome = await createConfigPipe(() => service).readConfig();
    expectThat('kind', outcome.kind, 'ok');
    expectThat('revision', outcome.kind === 'ok' ? outcome.state.revision : undefined, 9);
    expectThat('rows', outcome.kind === 'ok' ? outcome.state.rows.length : -1, 1);
  });

  it('写回实参逐字：ns = 包名 / patch = { profiles: [归一化后的行] } / revision 带上', async () => {
    const service = createFakeRemoteSettings();
    const pipe = createConfigPipe(() => service);
    const outcome = await pipe.saveProfiles([{ name: '  dev  ', command: ' wsl.exe ', args: ['-d', 'Ubuntu2204'] }], 42);
    expectThat('结果', outcome.kind, 'ok');
    expectThat('update 次数', service.calls.updates.length, 1);
    expectThat('ns', service.calls.updates[0]?.ns, 'dsh-terminal-profiles');
    expectThat('patch（trim + env 默认补齐）', service.calls.updates[0]?.patch, {
      profiles: [{ name: 'dev', command: 'wsl.exe', args: ['-d', 'Ubuntu2204'], env: {} }],
    });
    expectThat('revision 透传', service.calls.updates[0]?.expectedRevision, 42);
    expectThat('updateCount', pipe.updateCount(), 1);
  });

  it('没有 revision ⇒ 用**两个**实参调用（不瞎传 undefined）', async () => {
    const service = createFakeRemoteSettings();
    const pipe = createConfigPipe(() => service);
    await pipe.saveProfiles([{ name: 'a', command: 'wsl.exe' }]);
    expectThat('expectedRevision', service.calls.updates[0]?.expectedRevision, undefined);
    expectThat('第三参不存在', 'expectedRevision' in (service.calls.updates[0] ?? {}), true);
  });

  it('T6.4 单条无效不阻塞其余：无效行被排除出 patch，其余照常写入', async () => {
    const service = createFakeRemoteSettings();
    const outcome = await createConfigPipe(() => service).saveProfiles([
      { name: '', command: 'wsl.exe' },
      { name: 'ok-one', command: 'wsl.exe' },
    ]);
    expectThat('kind', outcome.kind, 'ok');
    expectThat('写入条数', outcome.kind === 'ok' ? outcome.saved : -1, 1);
    expectThat('被排除的行', outcome.kind === 'ok' ? outcome.skipped.map((item) => item.index) : [], [0]);
    expectThat('patch 只含有效行', service.calls.updates[0]?.patch, {
      profiles: [{ name: 'ok-one', command: 'wsl.exe', args: [], env: {} }],
    });
  });

  it('T6.4 全部无效 ⇒ 一个字节都不写（否则等于用空数组清空既有配置）', async () => {
    const service = createFakeRemoteSettings();
    const pipe = createConfigPipe(() => service);
    const outcome = await pipe.saveProfiles([{ name: '', command: '' }]);
    expectThat('kind', outcome.kind, 'invalid');
    expectThat('未调用 update', service.calls.updates.length, 0);
    expectThat('updateCount 不动', pipe.updateCount(), 0);
  });

  it('清空全部条目（rows = []）是**合法**操作 ⇒ 写入空数组', async () => {
    const service = createFakeRemoteSettings();
    const outcome = await createConfigPipe(() => service).saveProfiles([]);
    expectThat('kind', outcome.kind, 'ok');
    expectThat('patch', service.calls.updates[0]?.patch, { profiles: [] });
  });

  it('REQ-10.4 revision 冲突 ⇒ conflict（不是 failed），且把 skipped 一起带出', async () => {
    const service = createFakeRemoteSettings({
      update: { ok: false, error: { code: 'revision-conflict', message: 'stale revision 3 != 4' } },
    });
    const outcome = await createConfigPipe(() => service).saveProfiles([{ name: 'a', command: 'wsl.exe' }], 3);
    expectThat('kind', outcome.kind, 'conflict');
    expectThat('消息含冲突原因', outcome.kind === 'conflict' ? outcome.message.includes('stale revision') : false, true);
  });

  it('REQ-10.4 其他写入失败 ⇒ failed（不把未知错误说成冲突）', async () => {
    const service = createFakeRemoteSettings({ update: { ok: false, error: '磁盘只读' } });
    const outcome = await createConfigPipe(() => service).saveProfiles([{ name: 'a', command: 'wsl.exe' }]);
    expectThat('kind', outcome.kind, 'failed');
    expectThat('原因', outcome.kind === 'failed' ? outcome.message.includes('磁盘只读') : false, true);
  });

  it('update 抛错 ⇒ failed（不让异常穿过 React 渲染）', async () => {
    const service = createFakeRemoteSettings({ updateThrows: new Error('bridge gone') });
    const outcome = await createConfigPipe(() => service).saveProfiles([{ name: 'a', command: 'wsl.exe' }]);
    expectThat('kind', outcome.kind, 'failed');
  });

  it('缺 remote.settings ⇒ 读与写都 unavailable（明说未写盘）', async () => {
    const pipe = createConfigPipe(() => undefined);
    const outcome = await pipe.saveProfiles([{ name: 'a', command: 'wsl.exe' }]);
    expectThat('kind', outcome.kind, 'unavailable');
    expectThat('updateCount', pipe.updateCount(), 0);
  });

  it('错误描述与冲突判定（isRevisionConflict / describeError）', () => {
    expectThat('字符串冲突', isRevisionConflict('revision mismatch'), true);
    expectThat('对象冲突码', isRevisionConflict({ code: 'RevisionConflict' }), true);
    expectThat('conflict:true', isRevisionConflict({ conflict: true }), true);
    expectThat('中文冲突', isRevisionConflict('写入冲突'), true);
    expectThat('无关错误', isRevisionConflict('permission denied'), false);
    expectThat('描述对象', describeError({ reason: '被上层 patch 覆盖' }), '被上层 patch 覆盖');
    expectThat('描述 undefined', describeError(undefined), '未知原因（宿主未返回 error）');
  });
});

describe('T6.1 本包不自己读写 YAML（REQ-10.2 / REQ-13.3 的源码级判据）', () => {
  const forbidden: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
    { pattern: /cordis\.patch\.ya?ml/, why: '手写 patch 文件路径（patch 由宿主 loader / configEditor 管理）' },
    { pattern: /writeFile|writeFileSync|appendFile|createWriteStream/, why: '任何文件写入（配置落盘只能由宿主做）' },
    { pattern: /readFile|readFileSync/, why: '读 YAML 也算「自行读写配置」' },
    { pattern: /require\(['"]node:fs|from ['"]node:fs/, why: '浏览器半不可能有 fs' },
    { pattern: /configEditor/, why: '完整配置路径会重挂载（杀正在跑的终端）' },
    { pattern: /js-yaml|['"]yaml['"]/, why: 'YAML 解析器不该出现在客户端半' },
  ];

  function clientSources(): Array<{ readonly file: string; readonly text: string }> {
    const roots = [join(packageRoot, 'src/client'), join(packageRoot, 'src/config')];
    const collected: Array<{ file: string; text: string }> = [];
    for (const root of roots) {
      for (const name of readdirSync(root).sort()) {
        const full = join(root, name);
        if (!statSync(full).isFile()) continue;
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const raw = readFileSync(full, 'utf8');
        // 去掉注释再做词法扫描：注释里提到 `cordis.patch.yml` 是**应该**的（解释为什么不能碰它）
        const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        collected.push({ file: full.slice(packageRoot.length + 1), text });
      }
    }
    return collected;
  }

  it('源码里零文件写入 / 零 YAML 拼接 / 零 configEditor（且打印扫了多少）', () => {
    const sources = clientSources();
    scan.files += sources.length;
    for (const source of sources) scan.bytes += Buffer.byteLength(source.text, 'utf8');
    expectThat('扫到的文件数 > 0（防空扫假绿）', sources.length > 0, true);
    const hits: string[] = [];
    for (const source of sources) {
      for (const rule of forbidden) {
        if (rule.pattern.test(source.text)) hits.push(`${source.file} :: ${rule.why}`);
      }
    }
    expectThat('禁止模式命中数', hits, []);
  });
});

describe('扫描面统计（判据自己会说扫了多少）', () => {
  it('打印本次断言数与源码扫描量', () => {
    // eslint 无关：这就是「防真空绿」的那一行输出，永远保留
    console.log(
      `[scan] client-config-pipe：断言 ${scan.assertions} 条 · 源码 ${scan.files} 个文件 / ${scan.bytes} 字节（去注释后词法扫描）`,
    );
    expectThat('断言数 > 0', scan.assertions > 0, true);
    expectThat('扫描字节 > 0', scan.bytes > 0, true);
  });
});
