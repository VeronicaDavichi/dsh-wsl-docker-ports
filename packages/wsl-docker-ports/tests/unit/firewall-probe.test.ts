/**
 * 008 T2.6：防火墙规则名只读探针（`read/firewall-probe.ts`，`node --test`，零真机）
 *
 * 这条探针的存在理由是**一个真实缺陷**：005 的 `existingFirewallNames` 门一直没有读取件 ⇒
 * 重复 `apply` 会叠第二条**同名**防火墙规则（Windows 允许 `DisplayName` 重名），而回滚只删本轮那条。
 * 故判据围绕两件事：
 *
 * ① **只读且零提权**：命令必须是 `powershell -NoProfile -NonInteractive -Command` + 纯
 *    `Get-NetFirewallRule` 管道（**不得**出现 `New-`/`Set-`/`Remove-`/`Enable-`/`Disable-NetFirewallRule`、
 *    不得出现 `netsh`）⇒ 语法层就排除「顺手改用户规则」；
 * ② **「读不到」≠「没有」**：进程失败/超时/解析不出 ⇒ `ok:false`（可区分原因），
 *    **只有**「进程成功且输出为空」才是事实 `[]` —— 反向断言（不得返回空数组）是这里的红线。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIREWALL_NAME_FILTER,
  FIREWALL_PROBE_TIMEOUT_MS,
  FIREWALL_PS_ARGV,
  firewallProbeScript,
  parseFirewallNames,
  probeFirewallRuleNames,
} from '../../src/read/firewall-probe.ts';
import { createFakeExecutor, failure, ok } from '../helpers/fake-executor.ts';

const NAME_5900 = 'dsh-wsl-docker-ports-5900';
const NAME_6379 = 'dsh-wsl-docker-ports-6379';

/** 只读红线的字面判据（一个写动词都不许出现） */
const WRITE_VERBS = [
  'New-NetFirewallRule',
  'Set-NetFirewallRule',
  'Remove-NetFirewallRule',
  'Enable-NetFirewallRule',
  'Disable-NetFirewallRule',
  'netsh',
  '-Confirm',
];

test('T2.6 ① 命令形态：powershell + 纯只读管道（无任何写动词 / 无 netsh / 无提权）', () => {
  const script = firewallProbeScript();
  assert.equal(script, `Get-NetFirewallRule | Where-Object DisplayName -like '${FIREWALL_NAME_FILTER}' | Select-Object -ExpandProperty DisplayName`);
  assert.match(script, /^Get-NetFirewallRule \| Where-Object DisplayName -like '[a-z0-9-]+\*' \| Select-Object -ExpandProperty DisplayName$/u);
  for (const verb of WRITE_VERBS) {
    assert.equal(script.toLowerCase().includes(verb.toLowerCase()), false, `只读脚本里不许出现 ${verb}`);
  }
  assert.deepEqual([...FIREWALL_PS_ARGV], ['-NoProfile', '-NonInteractive', '-Command', script]);

  const fake = createFakeExecutor(() => ok(''));
  return probeFirewallRuleNames(fake.executor, { timeoutMs: 1234 }).then((outcome) => {
    assert.equal(outcome.ok, true);
    const call = fake.calls[0];
    assert.equal(call?.file, 'powershell.exe', '必须显式走 powershell.exe（不是 pwsh / 不是 cmd）');
    assert.deepEqual([...(call?.argv ?? [])], [...FIREWALL_PS_ARGV]);
    assert.equal(call?.options.encoding, 'utf8', 'Windows 侧输出必须按 utf8 解码');
    assert.equal(call?.options.timeoutMs, 1234, '超时可注入');
    assert.equal(FIREWALL_PROBE_TIMEOUT_MS, 15_000);
  });
});

test('T2.6 ② 成功：一行一个规则名（CRLF 容忍、原样返回、不做去重/猜测）', async () => {
  const fake = createFakeExecutor(() => ok(`${NAME_5900}\r\n${NAME_6379}\r\n`));
  const outcome = await probeFirewallRuleNames(fake.executor);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.ok ? [...outcome.names] : [], [NAME_5900, NAME_6379]);
  assert.equal(fake.calls.length, 1, '一次探测 = 一条进程');
  console.log(`  · 真读到 ${String(outcome.ok ? outcome.names.length : 0)} 个规则名（空行/CRLF 已容忍）`);
});

test('T2.6 ③ 空输出 = **事实**「一条都没有」（这是唯一允许回空数组的路径）', async () => {
  const fake = createFakeExecutor(() => ok('\r\n'));
  const outcome = await probeFirewallRuleNames(fake.executor);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.ok ? outcome.names : ['不该走到这里'], []);
});

test('T2.6 ④ 非 0 退出 / 超时 / 没有 powershell ⇒ 可区分的失败，**绝不**回空数组', async () => {
  const cases = [
    { code: 'NonZeroExit', expected: 'non-zero-exit', extra: { exitCode: 1, stderr: '服务未启动' }, raw: /服务未启动/u },
    { code: 'Timeout', expected: 'timeout', extra: {}, raw: /^$/u },
    { code: 'CommandNotFound', expected: 'powershell-missing', extra: {}, raw: /^$/u },
  ] as const;
  for (const item of cases) {
    const fake = createFakeExecutor(() => failure(item.code, { ...item.extra }));
    const outcome = await probeFirewallRuleNames(fake.executor);
    assert.equal(outcome.ok, false, `${item.code} 必须判失败`);
    assert.equal(outcome.ok ? null : outcome.reason, item.expected);
    assert.equal('names' in outcome, false, '失败态**没有** names 字段（调用方不可能误读成空集）');
    assert.equal(outcome.ok ? '' : typeof outcome.message, 'string');
    assert.ok((outcome.ok ? '' : outcome.message).length > 10, '失败要说清是什么失败');
    assert.ok((outcome.ok ? '' : outcome.hint).length > 10, '失败要给可执行的下一步');
    assert.match(String(outcome.ok ? '' : outcome.raw), item.raw, '有 stderr 就留证据（脱敏后）；没有就是空串而不是编造');
  }
  console.log(`  · 三种进程层失败各自可区分：${cases.map((item) => item.expected).join(' / ')}`);
});

test('T2.6 ⑤ 形态不可识别（stdout 里混入非本插件行）⇒ `parse-error`，不静默过滤', async () => {
  const fake = createFakeExecutor(() => ok(`${NAME_5900}\nGet-NetFirewallRule : 拒绝访问。\n`));
  const outcome = await probeFirewallRuleNames(fake.executor);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? null : outcome.reason, 'parse-error');
  assert.match(outcome.ok ? '' : outcome.message, /输出形态不可识别/u);
  assert.match(String(outcome.ok ? '' : outcome.raw), /拒绝访问/u, '原文（脱敏后）要留着给人看');
  // 解析器本身也要抛（不是「过滤掉不认识的行」）
  assert.throws(() => parseFirewallNames('powershell.exe : 某个错误'), /不属于本插件/u);
  assert.throws(() => parseFirewallNames(`${NAME_5900}\n别的项目的规则\n`), /不属于本插件/u);
  console.log('  · 混入噪声 ⇒ parse-error（不是「过滤后当作读到了 1 条」）');
});

test('T2.6 ⑥ 前缀大小写不敏感（Windows 的 DisplayName 比较如此）', () => {
  assert.deepEqual([...parseFirewallNames(`${NAME_5900}\nDSH-WSL-Docker-Ports-6379\n`)], [NAME_5900, 'DSH-WSL-Docker-Ports-6379']);
});
