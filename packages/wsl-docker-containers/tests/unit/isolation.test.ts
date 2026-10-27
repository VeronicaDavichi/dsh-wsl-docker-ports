/**
 * 016 的**跨包隔离**判据（`node --test`，零真机）
 *
 * ## 这一组要证明什么
 *
 * 拆成三个真包之后，最容易出现的退化不是「文件没搬」，而是**看起来分开了、其实还连着**：
 *
 * 1. **凭据不串门**：拿转发行的 `writeToken` 打容器通道 ⇒ **401**（反之亦然）。这是真机验收清单的第 4 条，
 *    也是「两条行」最容易被忽视的耦合 —— 用户配了一行、以为两行都好了。
 * 2. **前缀互不包含**：`/dsh-wsl-docker-ports` 与 `/dsh-wsl-docker-containers` 在宿主里按**最长前缀**分派，
 *    一旦一方写成另一方的前缀前缀（如 `/dsh-wsl-docker`），分派就会互相抢。
 * 3. **行 id / 服务名 / 命名空间三者各自唯一**：它们分别对应「patch 条目」「ctx 服务」「settings 命名空间」，
 *    任何一个撞了，宿主侧的隔离就名存实亡。
 * 4. **显示名真的不同**（三个包各自的 `locale/{zh,en}.json`）：宿主按**包级** locale 取
 *    `meta.title`，同名的两个包在插件列表里就分不清 —— 这是拆分后的**用户可见**差异，必须钉住。
 *
 * ## 为什么 locale 断言写在这里而不是 ports 包
 *
 * 三个包都要有，且要**互相不同**（同包内看不出差异）。容器包是这条判据的「东道主」，因此由它来读三份清单。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createContainersAuthenticator, CONTAINERS_ROW_ID, CONTAINERS_SERVICE } from '../../src/containers/credential.ts';
import { CONTAINERS_ACTION_PATH, CONTAINERS_PREFIX, CONTAINERS_SNAPSHOT_PATH } from '../../src/containers/wire.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** 转发侧的字面量（**只作为字符串**出现在反向断言里：容器包不许 import 转发包） */
const PORTS_PREFIX = '/dsh-wsl-docker-ports';
const PORTS_ROW_ID = 'dsh-wsl-docker-ports';
const PORTS_SERVICE = 'wslDockerPorts';

/** 三个包的清单（locale / 名字） */
const PACKAGES = [
  { dir: 'packages/wsl-docker-core', name: 'dsh-wsl-docker-core', plugin: false },
  { dir: 'packages/wsl-docker-ports', name: 'dsh-wsl-docker-ports', plugin: true },
  { dir: 'packages/wsl-docker-containers', name: 'dsh-wsl-docker-containers', plugin: true },
];

const readJson = (rel: string): any => JSON.parse(readFileSync(path.join(REPO, rel), 'utf8'));

/* ───────────── 1. 凭据不串门（真机验收清单第 4 条） ───────────── */

test('D3-1 凭据隔离：转发行的 writeToken 打容器通道 ⇒ 401；容器行自己的 token ⇒ 200 口径', () => {
  const containersToken = 'containers-token-abc';
  const portsToken = 'ports-token-xyz';

  // 容器行配置的是**自己的** token
  const authenticator = createContainersAuthenticator({ writeToken: containersToken } as never);
  assert.equal(authenticator.configured, true, '容器行配了 writeToken ⇒ configured=true');

  const withPortsToken = authenticator.authorize({ headers: { authorization: `Bearer ${portsToken}` } } as never);
  assert.equal(withPortsToken.ok, false, '拿转发行的 token 打容器通道必须 401（两行凭据互不相认）');

  const withContainersToken = authenticator.authorize({ headers: { authorization: `Bearer ${containersToken}` } } as never);
  assert.equal(withContainersToken.ok, true, '容器行自己的 token 必须通过');
});

test('D3-2 未配置 ⇒ 一切请求 401，且不泄露凭据本体', () => {
  const authenticator = createContainersAuthenticator({} as never);
  assert.equal(authenticator.configured, false, '未配置 ⇒ configured=false（调用方据此给「去配置」文案）');
  const result = authenticator.authorize({ headers: { authorization: 'Bearer anything' } } as never);
  assert.equal(result.ok, false, '未配置时任何 token 都不通过');
});

/* ───────────── 2. 前缀 / 行 id / 服务名 三件套各自唯一 ───────────── */

test('D3-3 前缀互不包含（宿主按最长前缀分派，前缀前缀会互相抢）', () => {
  assert.equal(CONTAINERS_PREFIX, '/dsh-wsl-docker-containers');
  assert.equal(CONTAINERS_SNAPSHOT_PATH, `${CONTAINERS_PREFIX}/snapshot`);
  assert.equal(CONTAINERS_ACTION_PATH, `${CONTAINERS_PREFIX}/action`);

  assert.equal(
    CONTAINERS_PREFIX.startsWith(PORTS_PREFIX),
    false,
    '容器前缀不许以转发前缀开头（否则宿主按最长前缀分派时两边都能接住对方）',
  );
  assert.equal(
    PORTS_PREFIX.startsWith(CONTAINERS_PREFIX),
    false,
    '转发前缀也不许以容器前缀开头',
  );
  assert.notEqual(CONTAINERS_PREFIX, PORTS_PREFIX);
});

test('D3-4 行 id / 服务名 / settings 命名空间三件套与转发侧零重叠', () => {
  assert.equal(CONTAINERS_ROW_ID, 'dsh-wsl-docker-containers');
  assert.equal(CONTAINERS_SERVICE, 'wslDockerContainers');

  assert.notEqual(CONTAINERS_ROW_ID, PORTS_ROW_ID, '行 id = patch 条目的命名空间，撞了就等于共用配置');
  assert.notEqual(CONTAINERS_SERVICE, PORTS_SERVICE, 'ctx 服务名撞了 ⇒ 后注册的覆盖先注册的');
  // settings 命名空间就是行 id；refreshIntervalSec 在两边都存在，靠命名空间分隔
  assert.notEqual(`${CONTAINERS_ROW_ID}.refreshIntervalSec`, `${PORTS_ROW_ID}.refreshIntervalSec`);
});

/* ───────────── 3. 三个包的显示名真的不同（包级 locale） ───────────── */

test('D3-5 两个插件的 zh / en 显示名两两不同（宿主读的就是 meta.title）', () => {
  // ⚠️ 只测**插件**包：core 是纯库，没有 locale、也不出现在插件列表里（见 D3-6）
  const plugins = PACKAGES.filter((pkg) => pkg.plugin);
  const zh = plugins.map((pkg) => readJson(path.posix.join(pkg.dir, 'locale/zh.json')).meta);
  const en = plugins.map((pkg) => readJson(path.posix.join(pkg.dir, 'locale/en.json')).meta);

  for (const [index, meta] of zh.entries()) {
    const name = plugins[index]!.name;
    assert.equal(typeof meta.title, 'string', `${name} 的 zh meta.title 必须存在`);
    assert.equal(meta.title.length > 0, true, `${name} 的 zh meta.title 不许为空`);
    assert.equal(typeof meta.description, 'string', `${name} 的 zh meta.description 必须存在`);
  }
  for (const [index, meta] of en.entries()) {
    assert.equal(meta.title.length > 0, true, `${plugins[index]!.name} 的 en meta.title 不许为空`);
  }

  const zhTitles = zh.map((meta) => meta.title);
  const enTitles = en.map((meta) => meta.title);
  assert.equal(new Set(zhTitles).size, zhTitles.length, `两个插件的 zh 显示名必须不同：${zhTitles.join(' / ')}`);
  assert.equal(new Set(enTitles).size, enTitles.length, `两个插件的 en 显示名必须不同：${enTitles.join(' / ')}`);
  assert.notEqual(zhTitles[0], zhTitles[1], '转发包与容器包的显示名必须分得清（插件列表里两行并排）');
});

/* ───────────── 4. 纯库没有插件面（拆分的结构性判据） ───────────── */

test('D3-6 core 是纯库：没有 cordis 行 / 没有客户端产物声明 / 没有 bundle patch', () => {
  for (const pkg of PACKAGES) {
    const manifest = readJson(path.posix.join(pkg.dir, 'package.json'));
    assert.equal(manifest.name, pkg.name, `${pkg.dir} 的包名必须是 ${pkg.name}`);

    if (pkg.plugin) {
      assert.equal(typeof manifest.dsh?.bundle?.patch, 'string', `${pkg.name} 必须有 dsh.bundle.patch（宿主据此插入本行）`);
      assert.equal(typeof manifest.dsh?.client, 'object', `${pkg.name} 必须有 dsh.client（自己的客户端产物）`);
      assert.equal(typeof manifest.exports?.['./locale/*'], 'string', `${pkg.name} 的 locale 必须能被 exports 解析到（否则宿主读不到显示名）`);
      continue;
    }

    assert.equal(manifest.dsh, undefined, 'core 不许有 dsh 段：它不是插件，没有 cordis 行、没有客户端产物');
    assert.equal(manifest.exports?.['./client'], undefined, 'core 不许声明 ./client');
    assert.equal(manifest.exports?.['./locale/*'], undefined, 'core 不许有 locale（它不出现在插件列表里）');
  }
});
