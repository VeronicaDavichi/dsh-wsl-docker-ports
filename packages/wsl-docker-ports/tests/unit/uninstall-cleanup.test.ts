/**
 * T3.3 卸载语义与清理清单（REQ-5.1 / REQ-5.2 / REQ-5.3 / REQ-5.4）
 *
 * 验收三件事各有一条落点：
 * - ① 卸载**未**产生任何 delete 调用 ⇒ 注入 fake 执行器（写通道），`dispose()` 后断言 **0 次调用**
 * - ② 清理清单含端口 / 规则名 / 地址且**可复制** ⇒ 逐项断言具体命令文本（REQ-5.2 不许只说「请手工清理」）
 * - ③ 临时文件归零（含 runner 三条路径没来得及删的**崩溃残留**）
 * 另加 REQ-5.4：显式清理**只删本插件建的**规则 —— 用一条「`listenPort ∈ managedPorts` 但
 * `connectAddress ≠ 期望 eth0`」的规则证明它**不被删**。
 *
 * 全程离线：fake 执行器 + 内存文件系统，**零真实进程 / 零真实文件系统 / 零提权**。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';

import { singlePort, type ManagedPortRange } from '../../src/diff/managed-ports.ts';
import { TEMP_PREFIX } from '../../src/elevate/script.ts';
import type { PortproxyRule } from 'dsh-wsl-docker-core';
import { buildCleanupSteps } from '../../src/write/cleanup.ts';
import { firewallRuleName } from '../../src/write/firewall.ts';
import type { WriteStep } from '../../src/write/types.ts';
import {
  createUninstallHook,
  type CleanupFs,
  type EnforceOutcome,
  type UninstallDeps,
  type WriteChannel,
} from '../../src/write/uninstall.ts';
import { ETH0, rule, ruleToEth0 } from '../helpers/factories.ts';

const PORTS: readonly ManagedPortRange[] = [singlePort(5000), { start: 6000, end: 6001 }];
const TEMP_DIR = 'temp-fixture-dir';

/** 本插件建的：集合内 + 形状对 + `connectAddress == eth0`（REQ-1.2 命中的两条） */
const OWNED_5000: PortproxyRule = ruleToEth0(5000, '0.0.0.0');
const OWNED_6000: PortproxyRule = rule('127.0.0.1', 6000, ETH0, 6000);
/** 集合内但**地址不符**（漂移过的旧 eth0）：REQ-5.4 里必须**不被删**的那条 */
const DRIFTED_6001: PortproxyRule = rule('0.0.0.0', 6001, '172.20.201.99', 6001);
/** 集合外（原脚本遗留的既有规则）：连清单都不该出现 */
const FOREIGN_5432: PortproxyRule = ruleToEth0(5432);

const ALL_RULES: readonly PortproxyRule[] = [OWNED_5000, OWNED_6000, DRIFTED_6001, FOREIGN_5432];

/** fake 执行器（= 写通道）：记录每次收到的步骤数组，`dispose()` 后必须是 **0 条记录** */
interface FakeExecutor {
  readonly writeChannel: WriteChannel;
  readonly calls: (readonly WriteStep[])[];
}

function createFakeExecutor(outcome?: EnforceOutcome): FakeExecutor {
  const calls: (readonly WriteStep[])[] = [];
  return {
    calls,
    writeChannel: (steps) => {
      calls.push(steps);
      return Promise.resolve(outcome ?? { ok: true, message: 'fake：已执行（离线，未真跑任何命令）' });
    },
  };
}

/** 内存文件系统：`listDir` 只答文件名，`removeFile` 收到的是 `join(dir, name)` */
interface FakeFs {
  readonly fs: CleanupFs;
  readonly files: Set<string>;
}

function createFakeFs(dir: string, names: readonly string[]): FakeFs {
  const files = new Set(names.map((name) => join(dir, name)));
  return {
    files,
    fs: {
      listDir: async (target) => {
        assert.equal(target, dir, '只允许扫注入的临时目录');
        return [...files].map((path) => path.split(/[\\/]/).pop() ?? path);
      },
      removeFile: async (path) => {
        if (!files.delete(path)) throw new Error(`ENOENT: ${path}`);
      },
    },
  };
}

/** 崩溃残留：runner 的成功 / 失败 / 超时三条路径没来得及删的正是这两个形态 */
const CRASH_RESIDUE: readonly string[] = [
  `${TEMP_PREFIX}-0f1e2d3c4b5a.ps1`,
  `${TEMP_PREFIX}-a1b2c3d4e5f6-out.json`,
];

function deps(overrides: Partial<UninstallDeps> = {}): UninstallDeps {
  return {
    facts: () => ({ rules: ALL_RULES, managedPorts: PORTS, expectedConnectAddress: ETH0 }),
    writeChannel: createFakeExecutor().writeChannel,
    tempDir: TEMP_DIR,
    cleanupFs: createFakeFs(TEMP_DIR, []).fs,
    ...overrides,
  };
}

test('T3.3 ① 卸载（dispose）零写调用：REQ-5.1「SHALL NOT 自动删除任何规则」', async () => {
  const executor = createFakeExecutor();
  const fakeFs = createFakeFs(TEMP_DIR, CRASH_RESIDUE);
  const hook = createUninstallHook({ ...deps(), writeChannel: executor.writeChannel, cleanupFs: fakeFs.fs });

  const report = await hook.dispose();

  assert.equal(executor.calls.length, 0, 'REQ-5.1：dispose 对执行器的写调用必须是 0 次');
  assert.deepEqual(executor.calls.flat(), [], '一次步骤都不许下发（连空数组都不该推）');
  assert.equal(report.systemStateTouched, false, 'REQ-5.1：系统规则一条都没碰');
  assert.match(report.message, /未改动任何系统规则/);
  // 卸载仍**必须**交付清单（否则用户无从下手，REQ-5.1 末句 / REQ-5.2）
  assert.equal(report.manifest.items.length, 2);
  // 但卸载**确实**清了临时文件（同一份报告里两件事都自证）
  assert.equal(report.cleanup.removedCount, 2);
  assert.equal(report.cleanup.remaining, 0);
});

test('T3.3 ② 清单含端口 / 规则名 / 地址，且每一项都带**具体命令**（REQ-5.2）', async () => {
  const hook = createUninstallHook(deps());
  const manifest = await hook.describeManifest();

  assert.deepEqual(manifest.ports, [5000, 6000], '只列本插件维护的端口（6001 漂移 / 5432 集合外都不出现）');
  assert.deepEqual(
    manifest.items.map((item) => [item.port, item.ruleName, item.listenAddress]),
    [
      [5000, firewallRuleName(5000), '0.0.0.0'],
      [6000, firewallRuleName(6000), '127.0.0.1'],
    ],
    'REQ-5.2 的三项：端口 / 规则名 / 地址',
  );
  assert.deepEqual(manifest.items.map((item) => item.ruleName), [
    'dsh-wsl-docker-ports-5000',
    'dsh-wsl-docker-ports-6000',
  ]);
  // 归属证据也给人看（REQ-1.2 的地址匹配是「这真是插件建的」的唯一凭据）
  assert.deepEqual(manifest.items.map((item) => item.connectAddress), [ETH0, ETH0]);

  // SHALL NOT 只给一句「请手工清理」：每一项 ≥2 行**具体命令**，逐字可复制
  assert.equal(manifest.text, [
    'netsh interface portproxy delete v4tov4 listenport=5000 listenaddress=0.0.0.0',
    'Get-NetFirewallRule -Group "dsh-wsl-docker-ports" | Where-Object { $_.DisplayName -eq "dsh-wsl-docker-ports-5000" } | Remove-NetFirewallRule',
    'netsh interface portproxy delete v4tov4 listenport=6000 listenaddress=127.0.0.1',
    'Get-NetFirewallRule -Group "dsh-wsl-docker-ports" | Where-Object { $_.DisplayName -eq "dsh-wsl-docker-ports-6000" } | Remove-NetFirewallRule',
  ].join('\n'));

  for (const item of manifest.items) {
    assert.ok(item.lines.length >= 2, `端口 ${String(item.port)} 的条目至少两行命令`);
    assert.match(item.portproxyCommand, new RegExp(`listenport=${String(item.port)}\\b`));
    assert.match(item.portproxyCommand, /listenaddress=\S+$/, '精确四元组：地址必填');
    assert.equal(item.portproxyCommand.includes('reset'), false, '删除永远不带 reset（REQ-1.4）');
    assert.equal(item.firewallCommand, `Get-NetFirewallRule -Group "dsh-wsl-docker-ports" | Where-Object { $_.DisplayName -eq "${item.ruleName}" } | Remove-NetFirewallRule`);
  }
  // 可复制性：text 的每一行都是命令，没有夹带说明文字（说明在 note 里）
  const lines = manifest.text.split('\n').filter((line) => line.trim().length > 0);
  assert.equal(lines.length, manifest.items.length * 2);
  for (const line of lines) {
    assert.match(line, /^(netsh interface portproxy delete v4tov4 |Get-NetFirewallRule -Group ")/);
  }
  assert.doesNotMatch(manifest.text, /请手工清理/, '底线：不许用一句空话代替命令');
  assert.match(manifest.note, /REQ-5\.1/);
});

test('T3.3 ③ 临时文件归零：含崩溃残留（REQ-5.3 / NFR-2 三条路径的兜底）', async () => {
  const fakeFs = createFakeFs(TEMP_DIR, [
    ...CRASH_RESIDUE,
    `${TEMP_PREFIX}-keepme.txt`, // 同前缀但非本插件产物 ⇒ 只报告不删
    'unrelated-notes.txt', // 无关文件
  ]);
  const hook = createUninstallHook({ ...deps(), cleanupFs: fakeFs.fs });

  const before = fakeFs.files.size;
  const report = await hook.dispose();

  assert.equal(report.cleanup.scanned, 4, '首扫看到 4 个目录项');
  assert.equal(report.cleanup.removedCount, 2, '两个崩溃残留都被删');
  assert.equal(report.cleanup.failed.length, 0);
  assert.equal(report.cleanup.remaining, 0, 'REQ-5.3：残留必须为 0（二次扫描得出）');
  assert.equal(fakeFs.files.size, before - 2);
  assert.deepEqual([...fakeFs.files].sort(), [join(TEMP_DIR, 'unrelated-notes.txt'), join(TEMP_DIR, `${TEMP_PREFIX}-keepme.txt`)].sort());
  assert.deepEqual(report.cleanup.skipped, [`${TEMP_PREFIX}-keepme.txt`], '形状不符只报告，绝不顺手删');
  assert.deepEqual([...report.cleanup.removed].sort(), CRASH_RESIDUE.map((name) => join(TEMP_DIR, name)).sort());
});

test('REQ-5.4 显式清理只删本插件建的规则：地址不符 / 集合外的一条都不碰', async () => {
  const executor = createFakeExecutor();
  const hook = createUninstallHook({ ...deps(), writeChannel: executor.writeChannel });

  const report = await hook.runExplicitCleanup();

  assert.equal(report.status, 'enforced');
  assert.equal(executor.calls.length, 1, '显式清理才下发步骤（与 dispose 的分界）');
  const steps = executor.calls[0] ?? [];
  assert.deepEqual(steps.map((step) => step.kind), [
    'portproxy-delete',
    'portproxy-delete',
    'firewall-delete',
    'firewall-delete',
  ]);
  assert.deepEqual(steps.map((step) => step.port), [5000, 6000, 5000, 6000]);
  // DRIFTED_6001：listenPort ∈ managedPorts 但 connectAddress ≠ 期望 eth0 ⇒ 不被删（REQ-1.2）
  assert.equal(steps.some((step) => step.port === 6001), false, '地址不符 ⇒ 删它就可能是别人的规则');
  assert.equal(steps.some((step) => step.port === 5432), false, '集合外端口零参与（REQ-1.1）');
  // 可执行的转发删除必须带 listenport（T3.1 红线②同口径）；防火墙删除只按 DisplayName（不按组全删）
  const portproxySteps = steps.filter((step) => step.kind === 'portproxy-delete');
  assert.equal(portproxySteps.length, 2);
  assert.equal(portproxySteps.every((step) => step.commandText.includes('listenport')), true);
  assert.deepEqual(
    steps.filter((step) => step.kind === 'firewall-delete').map((step) => step.commandText),
    [
      'Get-NetFirewallRule -Group "dsh-wsl-docker-ports" | Where-Object { $_.DisplayName -eq "dsh-wsl-docker-ports-5000" } | Remove-NetFirewallRule',
      'Get-NetFirewallRule -Group "dsh-wsl-docker-ports" | Where-Object { $_.DisplayName -eq "dsh-wsl-docker-ports-6000" } | Remove-NetFirewallRule',
    ],
  );
  assert.equal(steps.some((step) => step.commandText.includes('reset')), false);
  assert.deepEqual(
    // 与清单**同源**：清单里的命令就是会被执行的命令（逐字相等）
    steps.map((step) => step.commandText),
    buildCleanupSteps({ rules: ALL_RULES, managedPorts: PORTS, expectedConnectAddress: ETH0 }).map(
      (step) => step.commandText,
    ),
  );
});

test('REQ-5.2 / 5.4 边界：取不到 eth0（null）⇒ 清单为空、显式清理零动作、执行器零调用', async () => {
  const executor = createFakeExecutor();
  const hook = createUninstallHook({
    ...deps(),
    writeChannel: executor.writeChannel,
    facts: () => ({ rules: ALL_RULES, managedPorts: PORTS, expectedConnectAddress: null }),
  });

  const manifest = await hook.describeManifest();
  assert.deepEqual(manifest.items, [], '期望值不可判定 ⇒ 连本插件规则也不敢认（REQ-1.2 的字面前置）');
  assert.equal(manifest.text, '');
  assert.match(manifest.note, /没有本插件维护的规则/);

  const report = await hook.runExplicitCleanup();
  assert.equal(report.status, 'nothing-to-do');
  assert.deepEqual(report.steps, []);
  assert.equal(executor.calls.length, 0, '零动作 = 一次写调用都没有');
});

test('稳健性：读规则事实抛错 ⇒ dispose 仍交付结果（不抛）且临时文件照清', async () => {
  const fakeFs = createFakeFs(TEMP_DIR, CRASH_RESIDUE);
  const hook = createUninstallHook({
    ...deps(),
    cleanupFs: fakeFs.fs,
    facts: () => {
      throw new Error('netsh 探针超时（fake）');
    },
  });

  const report = await hook.dispose();
  assert.deepEqual(report.manifest.items, []);
  assert.match(report.manifest.note, /读取规则事实失败/);
  assert.equal(report.cleanup.removedCount, 2, 'REQ-5.3 与事实读取无关：临时文件必须清掉');
  assert.equal(report.cleanup.remaining, 0);
  assert.equal(report.systemStateTouched, false);

  const explicit = await hook.runExplicitCleanup();
  assert.equal(explicit.status, 'enforce-failed');
  assert.deepEqual(explicit.steps, [], '连事实都读不到 ⇒ 一个动作都不产生');
});

test('目录不可读时不抛：dirError 上报、残留数按 0 交付（不假装成功）', async () => {
  const hook = createUninstallHook({
    ...deps(),
    cleanupFs: {
      listDir: () => Promise.reject(new Error('EACCES: fake')),
      removeFile: () => Promise.resolve(),
    },
  });

  const report = await hook.dispose();
  assert.match(report.cleanup.dirError ?? '', /EACCES/);
  assert.equal(report.cleanup.removedCount, 0);
  assert.deepEqual(report.cleanup.failed, []);
});
