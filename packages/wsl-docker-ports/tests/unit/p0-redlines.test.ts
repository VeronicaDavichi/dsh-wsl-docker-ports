/**
 * 003 T6.6 红线断言：四条 `SHALL NOT` 的可二值判定（离线）
 *
 * | # | 需求 | 判据 |
 * | --- | --- | --- |
 * | ① | REQ-2.4 P0 只读 | P0 路径里**不存在** docker 写子命令，只用 `ps` / `inspect` |
 * | ② | REQ-9.3 不代偿 UDP | 不引入 `v6tov6` / 第三方转发工具 |
 * | ③ | REQ-10.2 不建包边 | 依赖里没有 `dsh-terminal-profiles`，只用字符串键 `managedTerminal` 可选注入 |
 * | ④ | REQ-10.4 不实现 exec | 无容器 exec 调用 |
 *
 * ## 🔴 ①的范围是一个**必须显式留痕**的口径决定
 *
 * ①若写成「整个 `src/` 不许出现 `docker start`」，等 **T7.1（P1 容器启停/重启）** 落地就会**假红** ——
 * P1 的 `docker start` / `stop` / `restart` 是**需求明文允许**的（REQ-11.1）。所以本文件把 ① 的范围
 * 钉死在 **P0 只读路径 = `src/read/**` + `src/diff/**`**（只读展示与状态判定），并额外用**白名单**
 * 锁住 P0 里的 docker 调用点：新增一个调用点就红，逼一次人工复核「它是不是写动作」。
 * ④（exec）没有这个例外 —— REQ-10.4 把 exec 划到「下一期」，故 ④ 扫**整个 `src/`**。
 *
 * 姊妹文件：005 的 T3.1/T3.6 在 `redline-guards.test.ts`（那是「提权写路径」的红线，范围是整个
 * `src/`）。故意分开：不同 Spec、不同范围，混在一起会让「范围」这个最容易出错的东西失去可见性。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { filesMatching, scanFor, srcSources, type Source } from '../helpers/src-scan.ts';
import { DOCKER_PS_ARGV } from 'dsh-wsl-docker-core';
import { NETSH_ARGV } from 'dsh-wsl-docker-core';

const SOURCES = srcSources();

/**
 * P0 只读路径（REQ-2.4 说的「P0 只读展示 + 转发可视化 + 漂移检测」）。
 *
 * 🔴 **016 起只含 `src/diff/`**：只读探针（`read/**`）已迁到 `dsh-wsl-docker-core`，那份红线由
 * core 自己的守卫覆盖；本包现在的 P0 面就是「拿探针结果做状态判定」的 diff 层。
 */
const P0_PREFIXES = ['src/diff/'] as const;

const p0Sources: Source[] = SOURCES.filter((source) =>
  P0_PREFIXES.some((prefix) => source.path.startsWith(prefix)),
);

/** docker 的写子命令（REQ-2.4 点名的六个 + 同类）：P0 里一个都不许出现 */
const DOCKER_WRITE_VERBS = ['start', 'stop', 'restart', 'rm', 'run', 'exec', 'create', 'kill', 'pause'];

test('T6.6 ①-a：P0 只读路径的 docker argv 就是 `docker ps --format {{json .}}`（行为断言）', () => {
  assert.deepEqual(
    [...DOCKER_PS_ARGV],
    ['docker', 'ps', '--format', '{{json .}}'],
    'REQ-2.4：P0 只有这一条 docker 读取命令（`--format` 必须是 Go 模板形态，见 T0.1 的实测坑）',
  );
  assert.equal(
    DOCKER_WRITE_VERBS.includes(DOCKER_PS_ARGV[1]),
    false,
    `P0 的 docker 子命令是只读的（实际 ${DOCKER_PS_ARGV[1]}）`,
  );
});

test('T6.6 ①-b：P0 只读路径里不存在任何 docker 写子命令（按「带引号的 argv 元素」精确判）', () => {
  // 只找**带引号的**字面量：这样 `execInDistro`（001 的 API 名）、`'running'`（状态值）这类
  // 含相同子串的合法文本不会误伤 —— 判据必须精确到 argv 元素。
  const needles = DOCKER_WRITE_VERBS.map((verb) => `'${verb}'`);
  assert.deepEqual(
    scanFor(p0Sources, needles, (source) => source.code),
    [],
    'REQ-2.4：P0 只读 —— 写动作（start/stop/restart/rm/run/exec）一个都不许有',
  );
});

test('T6.6 ①-c：P0 的 docker 调用点收在白名单里（新增调用点 ⇒ 逼一次人工复核）', () => {
  assert.deepEqual(
    filesMatching(p0Sources, /DOCKER_[A-Z_]*ARGV/, (source) => source.code),
    [],
    '016：本包 P0 面**零** docker argv 字面量（探针连 argv 一起搬去 core）⇒ 白名单必须为空；出现即红',
  );
});

test('T6.6 ②：不代偿 UDP —— 无 `v6tov6`、无第三方转发工具（REQ-9.3）', () => {
  assert.deepEqual(
    scanFor(SOURCES, ['v6tov6', 'socat', 'wsl2host', 'netsh2ip'], (source) => source.code),
    [],
    'REQ-9.3：portproxy 不支持 UDP ⇒ **明示不支持**，不许引入 v6tov6 或第三方转发工具去「补齐」',
  );
  // 行为面：本包唯一的 netsh argv 是只读 show，且不含任何 UDP 相关参数
  for (const flag of ['udp', 'listenprotocol', 'protocol']) {
    assert.equal(
      (NETSH_ARGV as readonly string[]).includes(flag),
      false,
      `只读探针的 argv 里不该出现 ${flag}（UDP 是明示不支持的能力，不靠参数代偿）`,
    );
  }
});

test('T6.6 ③：不建包边 —— 依赖白名单恰好 core + 组件包 + 共享包，且无 `dsh-terminal-profiles`（REQ-10.2）', () => {
  interface Manifest {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
    readonly optionalDependencies?: Record<string, string>;
  }
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as Manifest;

  assert.deepEqual(
    Object.keys(manifest.dependencies ?? {}).sort(),
    ['dsh-wsl-docker-containers', 'dsh-wsl-docker-core', 'dsh-wsl-shared'],
    'REQ-10.2（016 二订）：恰好三条 —— 共享包 + 纯库 core + 容器组件包（组的第二条行，是兄弟组件不是层）；再加一条必须先改 Spec',
  );

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const keys = Object.keys(manifest[field] ?? {});
    assert.equal(
      keys.includes('dsh-terminal-profiles'),
      false,
      `REQ-10.2：${field} 里不许出现 dsh-terminal-profiles（组件②对组件①只做**可选字符串键**消费，建边会毁掉 L3 隔离）`,
    );
  }

  assert.deepEqual(
    scanFor(SOURCES, ['dsh-terminal-profiles'], (source) => source.code),
    [],
    'REQ-10.2：源码里不许 import 组件①的包名 —— 消费只走字符串键 `managedTerminal`（下一期 T5.5 落地时须保持带引号的字符串形态）',
  );
});

test('T6.6 ④：不实现 exec —— 整个 src/ 无容器 exec 调用（REQ-10.4）', () => {
  const needles = ["'exec'", 'docker exec', 'execInContainer', 'containerExec'];
  assert.deepEqual(
    scanFor(SOURCES, needles, (source) => source.code),
    [],
    'REQ-10.4：进容器 exec 属「下一期」⇒ 本包只预留注入点，不实现、不调用（控件只有禁用态）',
  );
});

test('守卫自身的元断言：P0 只读路径确实被扫到了（防止「扫 0 个文件 ⇒ 全绿」的假绿）', () => {
  assert.ok(p0Sources.length >= 3, `P0 期望 >= 3 个源文件（src/diff/**），实际 ${String(p0Sources.length)}`);
  assert.ok(SOURCES.length > p0Sources.length, 'P0 是 src/ 的子集，不该等于全树');
  for (const expected of ['src/diff/engine.ts', 'src/diff/types.ts']) {
    assert.ok(
      p0Sources.some((source) => source.path === expected),
      `P0 守卫必须覆盖 ${expected}（没扫到 = 断言可能空转）`,
    );
  }
});


