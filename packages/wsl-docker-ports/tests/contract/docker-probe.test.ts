/**
 * T1.1 契约（真机 fixture → 探针 → 解析器）：**断言对象是真机字节**
 *
 * 这一条测的不是「解析器能不能解析」（T0.1 已测），而是「探针把真机字节原样喂给了解析器」：
 * 命令行对不对、容器数对不对、端口四元组对不对。任何一处错位都会让 UI 显示假事实。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DOCKER_PS_ARGV, probeDockerPs } from '../../src/read/docker-probe.ts';
import { createFakeExecutor, fixtureText, ok } from '../helpers/fake-executor.ts';
import { distro } from '../helpers/factories.ts';

const raw = fixtureText('docker-ps.redacted.jsonl');
const distros = [distro('Ubuntu2204')];

test('T1.1 真机 fixture：命令行是 `wsl.exe -d <distro> -- docker ps --format \'{{json .}}\'`', async () => {
  const fake = createFakeExecutor(() => ok(raw));
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', distros);

  assert.equal(fake.calls.length, 1, '只该执行一次（第一次就成功）');
  const call = fake.calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.file, 'wsl.exe');
  assert.deepEqual(call.argv, ['-d', 'Ubuntu2204', '--', 'docker', 'ps', '--format', '{{json .}}']);
  assert.equal(call.options.encoding, 'utf8', '发行版内的输出是 UTF-8（001 实测）');
  assert.equal(call.options.timeoutMs, 10_000, 'REQ-2.5：每次 docker 调用都要有硬超时');

  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.argv, ['wsl.exe', '-d', 'Ubuntu2204', '--', ...DOCKER_PS_ARGV]);
  assert.equal(outcome.attemptCount, 1);
  assert.equal(outcome.emptyAfterRetry, false);
});

test('T1.1 真机 fixture：6 个容器、端口映射四元组与真机一致', async () => {
  const fake = createFakeExecutor(() => ok(raw));
  const outcome = await probeDockerPs(fake.executor, 'Ubuntu2204', distros);
  assert.ok(outcome.ok);
  assert.equal(outcome.containers.length, 6);

  const on6379 = outcome.containers
    .flatMap((item) => item.ports)
    .filter((port) => port.containerPort === 6379);
  assert.deepEqual(
    on6379.map((port) => [port.hostIp, port.hostPort, port.containerPort, port.protocol]),
    [
      ['0.0.0.0', 6379, 6379, 'tcp'],
      ['[::]', 6379, 6379, 'tcp'],
    ],
  );

  const ranged = outcome.containers
    .flatMap((item) => item.ports)
    .filter((port) => port.hostPortEnd !== null);
  assert.deepEqual(
    ranged.map((port) => [port.hostPort, port.hostPortEnd, port.containerPort, port.containerPortEnd]),
    [
      [5002, 5003, 5002, 5003],
      [5002, 5003, 5002, 5003],
    ],
  );
});

test('T1.1 [REQ-2.5] 静态断言：不存在「先试 `--format json` 再回落」的探测式实现', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../src/read/docker-probe.ts', import.meta.url), 'utf8');
  // 剥掉注释：注释里提到 `--format json` 是**好事**（解释为什么不做回落），不该被当成违例
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // ⚠️ 口径订正（2026-10-09 集成方实测）：**不能数裸词 `--format` 的出现次数** ——
  // 给用户看的提示文案里正当提及这个 flag（`hint: '…只认 --format \'{{json .}}\'…'`）
  // 会被数成第二次，把**正确实现**判红（假阳性）。REQ-2.5 真正要禁的是**回落形态**：
  // 「先试 `--format json`，挂了再换成 `{{json .}}`」—— 那必然会在代码里留下一个
  // **裸 `json`**（不带 `{{}}` 模板）跟在 `--format` 后面。故改为断言该形态不存在：
  assert.equal(/--format\s*,?\s*['"]json['"]/.test(code), false, '禁止 `--format`, `json` 这种回落探测');
  assert.equal(/--format\s+json\b/.test(code), false, '禁止 `--format json` 单字符串形态');

  // 结构断言（真正钉死 argv 的那条）：`--format` 只出现在**一个数组字面量**里，且是模板形态
  const argvLiterals = code.match(/\[[^\]]*--format[^\]]*\]/g) ?? [];
  assert.equal(argvLiterals.length, 1, '只允许一处 argv 定义 —— 有第二处就说明存在回落路径');
  assert.deepEqual(DOCKER_PS_ARGV, ['docker', 'ps', '--format', '{{json .}}']);
});


