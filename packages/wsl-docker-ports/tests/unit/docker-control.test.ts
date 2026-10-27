/**
 * 010 `T7.1` / `T7.2` 的宿主侧判据（`node --test`，零真机）：
 *
 * - `U1`：**用户来源** ⇒ 恰好 1 次 docker 调用；**无凭据（= Agent）** ⇒ 0 次（由路由层判，本文件测执行层「不多调」）；
 * - `U2`：日志 `--tail` 有界（默认 200、上限 200、非法值回落 200），且**只回字符串**；
 * - `REQ-P1-2`：`src/docker/**` 静态扫描里 `/write/` 前缀命中 **0**；
 * - `REQ-P1-3`：日志模块**不落盘**（`node:fs` / `writeFile` / `appendFile` / `createWriteStream` 逐字 0 命中）；
 * - `REQ-11.4`：`package.json` 里**没有** `dsh-terminal-profiles` 依赖边（exec 属下一期，不建边）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { Executor, WslDistro, WslSharedError } from 'dsh-wsl-shared';

import { containerActionArgv, containerLogsArgv, readContainerLogs, runContainerAction } from '../../src/docker/control.ts';
import { CONTAINER_ACTIONS, CONTAINER_ACTION_PATH, CONTAINER_HTTP_PREFIX, CONTAINER_LOGS_PATH, DEFAULT_LOG_TAIL, MAX_LOG_TAIL, clampLogTail, isContainerAction, isContainerId, statusForContainer } from '../../src/docker/wire.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

/**
 * 剥掉注释再扫：`REQ-P1-2` / `REQ-P1-3` 判的是**代码**，
 * 而这两个模块的文档注释里**必须**写清「不落盘」「不借写通道」—— 扫注释会把自证文字判成违规。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const DISTRO = 'Ubuntu2204';
const DISTROS = [{ name: DISTRO, state: 'Running', version: 2, default: true }] as unknown as readonly WslDistro[];

function gatedDistroRowOk(): readonly WslDistro[] {
  return DISTROS;
}

interface Recorded {
  readonly file: string;
  readonly argv: readonly string[];
}

/** 假执行器：**只记账**，成功返回给定的 stdout */
function fakeExec(stdout = '', failWith?: Partial<WslSharedError>): { executor: Executor; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const executor: Executor = (file, argv) => {
    calls.push({ file, argv: [...argv] });
    if (failWith !== undefined) return Promise.resolve({ ok: false, message: 'fake', ...failWith } as WslSharedError);
    return Promise.resolve({ ok: true, exitCode: 0, stdout, stderr: '' });
  };
  return { executor, calls };
}

test('U1 · 容器动作的 argv 是数组、无 shell，且动作白名单只有 start/stop/restart', () => {
  assert.deepEqual(containerActionArgv('abc123', 'stop'), ['docker', 'stop', 'abc123']);
  assert.deepEqual(containerActionArgv('abc123', 'restart'), ['docker', 'restart', 'abc123']);
  assert.deepEqual([...CONTAINER_ACTIONS], ['start', 'stop', 'restart']);
  // 白名单之外的一律不认（`kill` / `rm` / `pause` 都不做）
  for (const bogus of ['kill', 'rm', 'pause', 'exec', '', undefined, 42]) {
    assert.equal(isContainerAction(bogus), false, `${String(bogus)} 不该被当成动作`);
  }
});

test('U1 · 容器 id 白名单：合法形收、注入形拒（不交给 docker 判）', () => {
  for (const good of ['abc', 'a1b2c3', 'web_1', 'x.y-z', 'A'.repeat(128)]) assert.equal(isContainerId(good), true, good);
  for (const bad of ['', ' abc', 'a b', 'a;b', 'a|b', '-x', 'x'.repeat(129), 'a$(id)', null, 7]) assert.equal(isContainerId(bad), false, String(bad));
});

test('U1 · runContainerAction：**恰好一次** docker 调用，argv 经 wsl.exe -d <distro> -- 前置', async () => {
  const fake = fakeExec();
  const outcome = await runContainerAction({ executor: fake.executor, distros: gatedDistroRowOk(), distro: DISTRO }, 'abc123', 'start');
  assert.equal(outcome.ok, true);
  assert.equal(fake.calls.length, 1, '写动作不重试：必须恰好一次');
  assert.equal(fake.calls[0]?.file, 'wsl.exe');
  assert.deepEqual(fake.calls[0]?.argv, ['-d', DISTRO, '--', 'docker', 'start', 'abc123']);
});

test('U1 · runContainerAction 失败：如实回报（non-zero-exit / timeout / 权限），**不重试**', async () => {
  const nonZero = fakeExec('', { code: 'NonZeroExit', exitCode: 125, stderr: 'No such container: abc' } as Partial<WslSharedError>);
  const first = await runContainerAction({ executor: nonZero.executor, distros: gatedDistroRowOk(), distro: DISTRO }, 'abc', 'stop');
  assert.equal(first.ok, false);
  if (!first.ok) {
    assert.equal(first.reason, 'non-zero-exit');
    assert.equal(first.exitCode, 125);
    assert.match(first.message, /No such container/);
  }
  assert.equal(nonZero.calls.length, 1, '失败也只调一次（不重试）');

  const timeout = fakeExec('', { code: 'Timeout' } as Partial<WslSharedError>);
  const second = await runContainerAction({ executor: timeout.executor, distros: gatedDistroRowOk(), distro: DISTRO }, 'abc', 'restart');
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, 'timeout');

  const denied = fakeExec('', { code: 'Unexpected', stderr: 'permission denied while trying to connect' } as Partial<WslSharedError>);
  const third = await runContainerAction({ executor: denied.executor, distros: gatedDistroRowOk(), distro: DISTRO }, 'abc', 'start');
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.reason, 'permission-denied');
});

test('U2 · 尾部条数夹紧：缺省/非法 → 200，上界夹到 200（不给「拉全量」的入口）', () => {
  assert.equal(DEFAULT_LOG_TAIL, 200);
  assert.equal(MAX_LOG_TAIL, 200);
  for (const bogus of [undefined, null, '', 'abc', '0', '-5', 0, -1, 1.5, Number.NaN]) {
    assert.equal(clampLogTail(bogus), 200, `${String(bogus)} 应回落到默认 200`);
  }
  assert.equal(clampLogTail('1'), 1);
  assert.equal(clampLogTail(7), 7);
  assert.equal(clampLogTail(200), 200);
  assert.equal(clampLogTail(201), 200, '超过上限必须**夹紧**而不是拒绝');
  assert.equal(clampLogTail('5000'), 200);
});

test('U2 · readContainerLogs：argv 带 --tail <N>、只回字符串（不落盘）', async () => {
  const fake = fakeExec('hello\nworld\n');
  const outcome = await readContainerLogs({ executor: fake.executor, distros: gatedDistroRowOk(), distro: DISTRO }, 'abc123', 50);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.tail, 50);
    assert.equal(outcome.text, 'hello\nworld\n');
  }
  assert.deepEqual(fake.calls[0]?.argv, ['-d', DISTRO, '--', 'docker', 'logs', '--tail', '50', 'abc123']);
  assert.deepEqual(containerLogsArgv('abc123', 200), ['docker', 'logs', '--tail', '200', 'abc123']);
});

test('REQ-P1-3 · 容器模块不落盘：src/docker/** 里没有任何 fs 写入口', () => {
  const files = ['wire.ts', 'control.ts', 'route.ts'];
  const forbidden = [
    /\bfrom\s+['"]node:fs['"]/,
    /\brequire\(\s*['"]node:fs['"]/,
    /\bfrom\s+['"]fs['"]/,
    /\bwriteFileSync?\b/,
    /\bappendFileSync?\b/,
    /\bcreateWriteStream\b/,
  ];
  for (const file of files) {
    const source = stripComments(readFileSync(join(REPO, 'src', 'docker', file), 'utf8'));
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, `${file} 命中落盘入口 ${String(pattern)}（REQ-P1-3 禁止）`);
    }
  }
});

test('REQ-P1-2 · 容器通道不借用写通道：src/docker/** 的**代码**里 `/write/` 命中 0', () => {
  for (const file of ['wire.ts', 'control.ts', 'route.ts']) {
    const source = stripComments(readFileSync(join(REPO, 'src', 'docker', file), 'utf8'));
    assert.equal(source.includes('/write/'), false, `${file} 不该出现 /write/ 路径（容器动作是独立的通道）`);
    assert.equal(source.includes('WRITE_PLAN_PATH') || source.includes('WRITE_APPLY_PATH'), false, `${file} 不该引用写通道端点常量`);
  }
  // 三个前缀互不包含（宿主按「最长 prefix」匹配，相互包含会让分派错位）
  assert.equal(CONTAINER_HTTP_PREFIX.startsWith('/dsh-wsl-docker-ports/write'), false);
  assert.equal('/dsh-wsl-docker-ports/write'.startsWith(CONTAINER_HTTP_PREFIX), false);
  assert.equal(CONTAINER_ACTION_PATH, `${CONTAINER_HTTP_PREFIX}/action`);
  assert.equal(CONTAINER_LOGS_PATH, `${CONTAINER_HTTP_PREFIX}/logs`);
});

test('REQ-11.4 · 不建包依赖边：package.json 里没有 dsh-terminal-profiles（exec 属下一期）', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  assert.equal(Object.hasOwn(all, 'dsh-terminal-profiles'), false, '010 不建包依赖边（REQ-11.4 / 001 L3）');
});

test('错误码 → 状态码是**单值**映射（每条码只有一个答案）', () => {
  assert.equal(statusForContainer('unauthorized'), 401);
  assert.equal(statusForContainer('bad-request'), 400);
  assert.equal(statusForContainer('not-found'), 404);
  assert.equal(statusForContainer('method-not-allowed'), 405);
  assert.equal(statusForContainer('docker-failed'), 502);
  assert.equal(statusForContainer('internal'), 500);
});
