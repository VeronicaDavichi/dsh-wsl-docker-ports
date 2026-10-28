/**
 * 017 六订·三十（主人 2026-10-28）：把「卡片大标题」与「包含的组件行标题」拆成**两个来源**。
 *
 * 宿主事实（读 `@deepseek-ai/dsh-app-boot` 的 `readPluginMeta` + 插件管理页的
 * `packageText` / `rowText` 确认，不是猜）：
 * - 卡片大标题 = `packageText(pkg)` ⇒ **组合包**包 `locale/*.json` 的 `meta.title`；
 * - 组件行标题 = `rowText(row)` ⇒ 该行 `name` 指向的**那个包**的 `locale/*.json` 的 `meta.title`。
 * 两者在「组合包自己既是卡又是行」时读同一份文件 ⇒ 必然同名。所以 017 拆出壳包
 * `dsh-wsl-docker-ports-bundle`（只有 `cordis.patch.yml` + `locale/`）：
 *   卡片（壳包）= `WSL Docker Ports`；行（本包）= `WSL Port Forwarding`。
 *
 * 本文件钉死三件事，且全部是「文件级」可二值判定的：
 * 1. 壳包的 locale 标题 = `WSL Docker Ports`，且它**真的**是组合包（`dsh.bundle.patch` 指向存在的文件）；
 * 2. 本包的 locale 标题 = `WSL Port Forwarding`，且本包**不再**声明 `dsh.bundle`（否则又会出现一张卡）；
 * 3. 壳包的 patch 插的两行 name 就是两个真实包名（行标题因此来自那两个包的 locale）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(here, '..', '..', '..');
const self = resolve(packagesDir, 'wsl-docker-ports');
const shell = resolve(packagesDir, 'wsl-docker-ports-bundle');

interface Locale {
  readonly meta: { readonly title: string; readonly description: string };
}
interface Manifest {
  readonly name: string;
  readonly dsh?: { readonly bundle?: { readonly patch?: string } };
}

const localeOf = (dir: string, lang: 'zh' | 'en'): Locale =>
  JSON.parse(readFileSync(join(dir, 'locale', `${lang}.json`), 'utf8')) as Locale;
const manifestOf = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;

test('017 六订·三十 ①：卡片标题（壳包）= WSL Docker Ports，且壳包真的是组合包', () => {
  assert.equal(manifestOf(shell).name, 'dsh-wsl-docker-ports-bundle', '壳包名');
  assert.equal(localeOf(shell, 'zh').meta.title, 'WSL Docker Ports', 'zh 卡片标题');
  assert.equal(localeOf(shell, 'en').meta.title, 'WSL Docker Ports', 'en 卡片标题');
  const patch = manifestOf(shell).dsh?.bundle?.patch;
  assert.ok(patch !== undefined, '壳包必须声明 dsh.bundle.patch');
  assert.equal(existsSync(join(shell, patch)), true, `壳包 patch 文件必须存在：${String(patch)}`);
  console.log(`  · 壳包：${manifestOf(shell).name} ⇒ ${localeOf(shell, 'zh').meta.title}（patch=${String(patch)}）`);
});

test('017 六订·三十 ②：组件行标题（本包）= WSL Port Forwarding，且本包不再声明 dsh.bundle', () => {
  assert.equal(localeOf(self, 'zh').meta.title, 'WSL Port Forwarding', 'zh 行标题');
  assert.equal(localeOf(self, 'en').meta.title, 'WSL Port Forwarding', 'en 行标题');
  assert.equal(manifestOf(self).dsh?.bundle, undefined, '本包不得再有 dsh.bundle（否则两张卡）');
  assert.equal(existsSync(join(self, 'cordis.patch.yml')), false, '本包的 patch 已搬进壳包，不应还在');
  console.log(`  · 本包：${manifestOf(self).name} ⇒ ${localeOf(self, 'zh').meta.title}`);
});

test('017 六订·三十 ③：壳包 patch 插的两行 name = 两个真实包名（行标题因此来自它们的 locale）', () => {
  const text = readFileSync(join(shell, 'cordis.patch.yml'), 'utf8');
  assert.equal(text.includes('name: dsh-wsl-docker-ports'), true, '插 dsh-wsl-docker-ports 行');
  assert.equal(text.includes('name: dsh-wsl-docker-containers'), true, '插 dsh-wsl-docker-containers 行');
  assert.equal(text.includes('id: wsl-ports'), true, '行 id 仍是 wsl-ports（settings 命名空间）');
  assert.equal(text.includes('id: wsl-containers'), true, '容器行 id 不变');
  // 反向：行 name 不得误写回壳包自己（那会让行标题也变成卡片标题）
  assert.equal(/name:\s*dsh-wsl-docker-ports-bundle/.test(text), false, '行 name 不得是壳包自己');
  console.log('  · patch 两行：wsl-ports ⇒ dsh-wsl-docker-ports / wsl-containers ⇒ dsh-wsl-docker-containers');
});
