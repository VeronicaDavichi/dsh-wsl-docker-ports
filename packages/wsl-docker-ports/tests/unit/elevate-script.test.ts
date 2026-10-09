/**
 * T2.1 脚本生成与参数结构（REQ-3.4 / REQ-3.6 / REQ-3.7）
 *
 * 验收条件：
 * - 生成 `%TEMP%\dsh-ppp-<rand>.ps1`，参数 `-Action/-Port/-Address/-Scope`
 * - 生成内容**只含白名单动作与数字端口**
 * - 对含 `;` / `&` / 反引号的输入断言**被拒（不拼接）**
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expectedListenAddress } from '../../src/diff/engine.ts';
import {
  assertScriptParams,
  buildElevateScript,
  ElevateParamError,
  isScriptAction,
  prepareElevation,
  SCRIPT_ACTIONS,
  scriptArgs,
  tempOutPath,
  tempScriptPath,
} from '../../src/elevate/script.ts';
import type { ScriptParams } from '../../src/elevate/types.ts';

const SCRIPT = tempScriptPath('C:\\Temp', 'abcdef012345');
const OUT = tempOutPath('C:\\Temp', 'abcdef012345');

function params(overrides: Partial<ScriptParams> = {}): ScriptParams {
  return {
    action: 'add',
    port: 5000,
    address: '172.20.201.152',
    scope: 'loopback',
    scriptPath: SCRIPT,
    outPath: OUT,
    ...overrides,
  };
}

test('T2.1 临时文件名：用户临时目录 + 可识别前缀 + 随机段 + 固定后缀', () => {
  assert.equal(SCRIPT, 'C:\\Temp\\dsh-ppp-abcdef012345.ps1');
  assert.equal(OUT, 'C:\\Temp\\dsh-ppp-abcdef012345-out.json');
  assert.match(SCRIPT, /dsh-ppp-[0-9a-f]+\.ps1$/);

  // 随机段太短（不足 8 位 hex）⇒ 拒（REQ-3.6 的「文件名含随机段」要能被判）
  assert.throws(() => tempScriptPath('C:\\Temp', 'ab'), ElevateParamError);
});

test('T2.1 参数结构：argv 就是 -Action/-Port/-Address/-Scope（外加 -Out），没有别的形态', () => {
  assert.deepEqual(scriptArgs(params({ scope: 'lan' })), [
    '-Out',
    OUT,
    '-Action',
    'add',
    '-Port',
    '5000',
    '-Address',
    '172.20.201.152',
    '-Scope',
    'lan',
  ]);
});

test('T2.1 脚本正文只含白名单动作：ValidateSet 与 switch 分支逐字核对', () => {
  const script = buildElevateScript();

  assert.match(script, /\[ValidateSet\('add', 'remove', 'fix'\)\]/);
  assert.match(script, /\[ValidateRange\(1, 65535\)\]/);
  assert.match(script, /switch \(\$Action\) \{/);
  for (const action of SCRIPT_ACTIONS) assert.match(script, new RegExp(`^  '${action}' \\{$`, 'm'));
  assert.match(script, /^  default \{/m);

  // 白名单就是这三个（不多不少）
  assert.deepEqual([...SCRIPT_ACTIONS], ['add', 'remove', 'fix']);
  assert.equal(isScriptAction('add'), true);
  assert.equal(isScriptAction('Add'), false);
  assert.equal(isScriptAction('reset'), false);
});

test('T2.1 脚本正文不含任何调用方数据：端口/地址只经 argv，不进文本', () => {
  // 用一份「特别显眼」的端口与地址生成参数，脚本正文里必须一个都找不到
  const p = params({ port: 54321, address: '10.11.12.13' });
  const { script, args } = prepareElevation(p);

  assert.equal(script.includes('54321'), false, '端口只走 argv，绝不拼进脚本');
  assert.equal(script.includes('10.11.12.13'), false, '地址只走 argv，绝不拼进脚本');
  assert.deepEqual(args.slice(0, 2), ['-Out', OUT]);
  assert.equal(args[args.indexOf('-Port') + 1], '54321');
});

test('T2.1 $Address / $Action 只出现在允许的位置（参数声明与 netsh 参数），不参与命令拼接', () => {
  const script = buildElevateScript();

  for (const line of script.split('\n')) {
    if (line.includes('$Address')) {
      assert.match(line, /\[string\]\$Address|connectaddress=\$Address/, `非法位置：${line.trim()}`);
    }
    if (line.includes('$Action')) {
      assert.match(
        line,
        /\[string\]\$Action|switch \(\$Action\)|白名单之外|action\s+= \$Action/,
        `$Action 不得出现在命令位置：${line.trim()}`,
      );
    }
  }
});

test('T2.1 脚本里每一处 portproxy add/delete 都带 listenport（红线在脚本层同样成立）', () => {
  const script = buildElevateScript();
  const writeLines = script.split('\n').filter((line) => /portproxy\s+(add|delete)\b/.test(line));

  assert.equal(writeLines.length, 3, 'Add-Portproxy 的清理 + add、Remove-Portproxy 的 delete');
  for (const line of writeLines) assert.match(line, /listenport=\$Port/);
  // 地址来自 003 的引擎口径（单一来源），不是另抄一份字面量
  assert.match(script, new RegExp(`'${expectedListenAddress('lan')}'`));
  assert.match(script, new RegExp(`'${expectedListenAddress('loopback')}'`));
});

test('T2.1 拒绝 `;`：动作里带分号 ⇒ 抛错，不生成脚本、不拼接', () => {
  assert.throws(() => prepareElevation(params({ action: 'add; Remove-Item C:\\ -Recurse' as ScriptParams['action'] })), (error: unknown) => {
    assert.ok(error instanceof ElevateParamError);
    assert.equal(error.field, 'action');
    return true;
  });
});

test('T2.1 拒绝 `&` 与反引号：地址里带它们 ⇒ 抛错（黑名单在字符级）', () => {
  for (const bad of ['172.20.201.152 & calc', '172.20.201.152`whoami`', '172.20.201.152; shutdown /s']) {
    assert.throws(
      () => prepareElevation(params({ address: bad })),
      (error: unknown) => error instanceof ElevateParamError && error.field === 'address',
      `${bad} 必须被拒`,
    );
  }
});

test('T2.1 其余参数级拒绝：端口非整数/越界、作用域越界、路径非本插件临时产物', () => {
  assert.throws(() => assertScriptParams(params({ port: 0 })), ElevateParamError);
  assert.throws(() => assertScriptParams(params({ port: 65536 })), ElevateParamError);
  assert.throws(() => assertScriptParams(params({ port: 5000.5 })), ElevateParamError);
  assert.throws(() => assertScriptParams(params({ port: Number('5000 & calc') })), ElevateParamError);
  assert.throws(() => assertScriptParams(params({ scope: 'all' as ScriptParams['scope'] })), ElevateParamError);
  assert.throws(() => assertScriptParams(params({ scriptPath: 'C:\\Temp\\evil.ps1' })), ElevateParamError);
  assert.throws(() => assertScriptParams(params({ outPath: 'C:\\Temp\\dsh-ppp-abcdef012345.ps1' })), ElevateParamError);
  // 非 IPv4 也不收（只接受字面量，不做名字解析）
  assert.throws(() => assertScriptParams(params({ address: 'localhost' })), ElevateParamError);
  assert.throws(() => assertScriptParams(params({ address: '999.1.1.1' })), ElevateParamError);
});

test('T2.1 退出码与回传在脚本里落地：0/1/2/3 + out 文件 + stdio 双通道', () => {
  const script = buildElevateScript();

  assert.match(script, /Complete \$true 0/);
  assert.match(script, /Complete \$false 1/);
  assert.match(script, /Complete \$false 2/);
  assert.match(script, /Complete \$false 3/);
  assert.match(script, /Set-Content -LiteralPath \$Out/, 'native 后端靠 out 文件回传');
  assert.match(script, /Write-Output \$json/, 'gsudo 后端靠 stdio 回传');
  assert.match(script, /ConvertTo-Json/);
});

test('T2.1 半成品防护在脚本内部：放行失败 ⇒ 回滚刚加的 portproxy（要么都成、要么都不成）', () => {
  const script = buildElevateScript();

  assert.match(script, /portproxy-rollback/);
  // 顺序证据：先 Add-Firewall 失败，再 Remove-Portproxy（回滚），最后 Complete $false 2
  const addFirewallFailed = script.indexOf("if (-not (Add-Firewall))");
  const rollback = script.indexOf('[void](Remove-Portproxy)');
  assert.ok(addFirewallFailed > 0 && rollback > addFirewallFailed, '回滚必须在放行失败之后');
});

test('T2.1 脚本里不存在「全表清空」形态（拼接构造，避免守卫自己命中）', () => {
  const forbidden = `portproxy${' '}reset`;
  assert.equal(buildElevateScript().includes(forbidden), false);
  assert.equal(buildElevateScript().toLowerCase().includes('reset'), false, '脚本里连 reset 这个词都不该有');
});
