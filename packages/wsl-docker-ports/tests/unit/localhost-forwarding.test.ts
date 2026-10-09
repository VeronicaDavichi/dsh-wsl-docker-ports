/**
 * T1.3 `localhostForwarding` 自读（005 REQ-2.5）
 *
 * 三件事必须成立：① 缺省 = `true`（WSL 的缺省，也是「NAT 缺省」这句话的依据）；
 * ② 显式 `false` 时 loopback 需要**显式规则**（在 T2.1 的表里落到 `missing`）；
 * ③ 本模块**只读** —— 源码里不许出现任何写文件调用。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  parseLocalhostForwardingValue,
  readLocalhostForwarding,
} from '../../src/read/localhost-forwarding.ts';

const PATH = 'C:\\Users\\<user>\\.wslconfig';
/** 真机实测原文（32 字节、CRLF、无尾换行） */
const REAL = '[wsl2]\r\nlocalhostForwarding=true';

function withText(text: string | Error) {
  return {
    filePath: PATH,
    readFile: async () => {
      if (text instanceof Error) throw text;
      return text;
    },
  };
}

test('T1.3 缺省：文件不存在（ENOENT）→ enabled=true / source=default（WSL 的缺省）', async () => {
  const missing = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
  const outcome = await readLocalhostForwarding(withText(missing));

  assert.ok(outcome.ok);
  assert.equal(outcome.enabled, true);
  assert.equal(outcome.source, 'default');
  assert.equal(outcome.rawValue, null);
  assert.equal(outcome.warning, null);
  assert.equal(outcome.path, PATH, 'REQ-4.7 同口径：读的是什么文件必须能显示出来');
});

test('T1.3 真机原文：`[wsl2] localhostForwarding=true` → enabled=true / source=explicit', async () => {
  const outcome = await readLocalhostForwarding(withText(REAL));

  assert.ok(outcome.ok);
  assert.equal(outcome.enabled, true);
  assert.equal(outcome.source, 'explicit');
  assert.equal(outcome.rawValue, 'true');
});

test('T1.3 [005-REQ-2.5] 显式 false → enabled=false（loopback 走「需显式规则」分支）', async () => {
  const outcome = await readLocalhostForwarding(withText('[wsl2]\r\nlocalhostForwarding=false'));

  assert.ok(outcome.ok);
  assert.equal(outcome.enabled, false);
  assert.equal(outcome.source, 'explicit');
});

test('T1.3 边界：无该键（只有别的键/别的节）→ 缺省 true', async () => {
  for (const text of [
    '',
    '[wsl2]\r\nnetworkingMode=mirrored',
    '[experimental]\r\nlocalhostForwarding=false',
    '[wsl2]\r\n# localhostForwarding=false',
  ]) {
    const outcome = await readLocalhostForwarding(withText(text));
    assert.ok(outcome.ok, text);
    assert.equal(outcome.enabled, true, text);
    assert.equal(outcome.source, 'default', text);
  }
});

test('T1.3 边界：容忍 BOM / CRLF / 单个 CR / 行内注释 / 大小写 / 两侧空白；重复键最后一个胜出', async () => {
  assert.equal(parseLocalhostForwardingValue('\uFEFF[WSL2]\r\nLocalHostForwarding = TRUE '), 'TRUE');
  assert.equal(parseLocalhostForwardingValue('[wsl2]\rlocalhostForwarding=false'), 'false');
  assert.equal(parseLocalhostForwardingValue('[wsl2]\nlocalhostForwarding = false ; 备注'), 'false');
  assert.equal(
    parseLocalhostForwardingValue('[wsl2]\r\nlocalhostForwarding=true\r\nlocalhostForwarding=false'),
    'false',
  );
  // CRLF 定案（2026-10-09 订正）：单行文件若只按 `\n` 切，整份会被当成一行 ⇒ 节判定失效
  const outcome = await readLocalhostForwarding(withText('[wsl2]\r\nlocalhostForwarding=false\r\n'));
  assert.ok(outcome.ok);
  assert.equal(outcome.enabled, false);
});

test('T1.3 异常：值不可识别 → 保守按 false（= 需要显式规则）+ warning 明示（不静默）', async () => {
  const outcome = await readLocalhostForwarding(withText('[wsl2]\r\nlocalhostForwarding=yes'));

  assert.ok(outcome.ok);
  assert.equal(outcome.enabled, false, '宁可多要一条规则，也不许「说无需规则但其实需要」');
  assert.equal(outcome.source, 'fallback');
  assert.equal(outcome.rawValue, 'yes');
  assert.match(outcome.warning ?? '', /无法识别/);
  assert.match(outcome.warning ?? '', /不会替你改文件/);
});

test('T1.3 异常：文件读不了（非 ENOENT）→ `config-unreadable` + 路径，不按缺省放行', async () => {
  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const outcome = await readLocalhostForwarding(withText(denied));

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'config-unreadable');
  assert.match(outcome.message, /<user>\\\.wslconfig/);
});

test('T1.3 异常：默认路径解析不出来（USERPROFILE 为空且取主目录也失败）→ 明确报错，不猜', async () => {
  const outcome = await readLocalhostForwarding({ resolveDefaultPath: async () => undefined });

  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'config-unreadable');
  assert.match(outcome.message, /USERPROFILE/);
});

test('T1.3 边界：省略 filePath 时走注入的默认路径解析（生产 = 借 001 的 `readNetworkingMode()` 的 path）', async () => {
  const outcome = await readLocalhostForwarding({
    resolveDefaultPath: async () => PATH,
    readFile: async () => REAL,
  });

  assert.ok(outcome.ok);
  assert.equal(outcome.path, PATH);
  assert.equal(outcome.enabled, true);
});

test('T1.3 只读断言：剥注释后源码里没有任何写文件/改环境调用（NFR-2 / REQ-1.4）', () => {
  const source = readFileSync(new URL('../../src/read/localhost-forwarding.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbidden of [
    'writeFile',
    'appendFile',
    'mkdir',
    'rm(',
    'unlink',
    'copyFile',
    'rename',
    'chmod',
    'process.env',
  ]) {
    assert.equal(code.includes(forbidden), false, `只读模块不得出现 ${forbidden}`);
  }
});
