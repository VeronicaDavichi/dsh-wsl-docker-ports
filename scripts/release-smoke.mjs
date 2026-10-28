#!/usr/bin/env node
/**
 * release-smoke —— 发布前「真装真加载」冒烟门
 *
 * 由来（2026-10-28 事故）：`dsh-wsl-shared` / `dsh-wsl-docker-core` 当时是**源码包**
 * （`exports` 指向 `./src/index.ts`）。workspace 里 `link:` 的真实路径落在
 * `node_modules` **之外**，Node 24 的类型剥离允许，所以本地一切正常；
 * 一旦从 npm 装进 `node_modules`，Node 明确禁止剥离（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）
 * ⇒ 包能装、插件起不来。这个脚本就是把「消费者视角」固化成一道门：
 * **pack 出来的 tarball 装进干净目录、逐个 import，四个包全通才允许 publish。**
 *
 * 用法：
 *   node scripts/release-smoke.mjs --tarballs <含 *.tgz 的目录>
 *   node scripts/release-smoke.mjs --tarballs <目录> --expect-fail   # 负向自检：故意喂坏包，门必须红
 *   node scripts/release-smoke.mjs --tarballs <目录> --keep          # 保留临时目录，便于排查
 *
 * 退出码：0 = 冒烟通过（可以 publish）/ 1 = 冒烟失败（**禁止 publish**）/ 2 = 用法错误
 * 判据（缺一不可）：clean install exit 0；四个包 import 成功；ports/containers 的
 * `Config` 与 `apply` 都是函数（等于「宿主能把它当插件加载」的最小事实）。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PKGS = [
  { name: 'dsh-wsl-shared', probe: 'exports>0' },
  { name: 'dsh-wsl-docker-core', probe: 'exports>0' },
  { name: 'dsh-wsl-docker-ports', probe: 'plugin' },
  { name: 'dsh-wsl-docker-containers', probe: 'plugin' },
];

function parseArgs(argv) {
  const out = { tarballs: null, registry: 'https://registry.npmjs.org/', expectFail: false, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tarballs') out.tarballs = argv[++i];
    else if (a.startsWith('--tarballs=')) out.tarballs = a.slice('--tarballs='.length);
    else if (a === '--registry') out.registry = argv[++i];
    else if (a.startsWith('--registry=')) out.registry = a.slice('--registry='.length);
    else if (a === '--expect-fail') out.expectFail = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--help' || a === '-h') return { help: true };
  }
  return out;
}

function run(cmd, args, cwd) {
  // Windows 上 .cmd 只能经 shell 起（spawnSync + shell:false 会 EINVAL）
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

function firstErrorLine(stdout, stderr, error) {
  if (error) return `启动失败: ${String(error.message ?? error)}`;
  const text = `${stderr}\n${stdout}`;
  const alias = text.match(/Error \[([A-Z_]+)\][^\n]*/);
  if (alias) return alias[0];
  const line = text.split('\n').find((l) => /error|Error|ERR_/.test(l));
  return (line ?? '(无错误行)').trim();
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('用法: node scripts/release-smoke.mjs --tarballs <目录> [--registry <url>] [--expect-fail] [--keep]');
    return 0;
  }
  if (!opts.tarballs) {
    console.error('✗ 缺少 --tarballs <含 *.tgz 的目录>');
    return 2;
  }

  const dir = resolve(opts.tarballs);
  let tarballs;
  try {
    tarballs = readdirSync(dir).filter((f) => f.endsWith('.tgz')).map((f) => join(dir, f));
  } catch {
    console.error(`✗ 目录读不到: ${dir}`);
    return 2;
  }
  if (tarballs.length === 0) {
    console.error(`✗ 目录里没有 *.tgz: ${dir}`);
    return 2;
  }

  console.log(`【release-smoke】tarball 目录 = ${dir}`);
  console.log(`【release-smoke】tarball 数量 = ${tarballs.length}`);
  for (const t of tarballs) console.log(`  · ${t.slice(dir.length + 1)}`);

  const work = mkdtempSync(join(tmpdir(), 'dsh-release-smoke-'));
  const cleanup = () => { if (!opts.keep) rmSync(work, { recursive: true, force: true }); };

  try {
    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'dsh-release-smoke', private: true, type: 'module' }, null, 2) + '\n', 'utf8');

    console.log('\n[1/3] clean install（消费者视角：只给 tarball，不给 workspace 路径）');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = run(npmCmd, ['install', ...tarballs, '--registry', opts.registry, '--no-audit', '--no-fund', '--loglevel=error'], work);
    if (install.code !== 0) {
      console.error(`✗ clean install 失败 (exit ${install.code})`);
      console.error(firstErrorLine(install.stdout, install.stderr, install.error));
      console.error('\n结论：冒烟失败 → **禁止 publish**');
      return 1;
    }
    console.log('  ✓ npm install exit 0');

    console.log('\n[2/3] 逐个 import（必须从 node_modules 解析，不能落到 workspace 路径）');
    const probe = [
      'const out = [];',
      "const req = (m) => { try { return { ok: true, m }; } catch (e) { return { ok: false, m, e: String(e && e.message || e) }; } };",
      'const checks = [',
      ...PKGS.map((p) => {
        const kind = p.probe === 'plugin'
          ? "typeof m.Config === 'function' && typeof m.apply === 'function'"
          : 'Object.keys(m).length > 0';
        return `  { name: '${p.name}', kind: '${p.probe}', run: async () => { const m = await import('${p.name}'); return { pass: ${kind}, detail: '${p.probe}' === 'plugin' ? \`Config=\${typeof m.Config} apply=\${typeof m.apply}\` : \`exports=\${Object.keys(m).length}\` }; } },`;
      }),
      '];',
      'for (const c of checks) {',
      '  try { const r = await c.run(); console.log((r.pass ? "  ✓ " : "  ✗ ") + c.name + " (" + r.detail + ")"); if (!r.pass) out.push(c.name); }',
      '  catch (e) { console.log("  ✗ " + c.name + " → " + String(e && e.message || e)); out.push(c.name); }',
      '}',
      'if (out.length) { console.log("\\nFAILED: " + out.join(", ")); process.exit(1); }',
      'console.log("\\nALL IMPORT OK");',
    ].join('\n');
    writeFileSync(join(work, 'probe.mjs'), probe + '\n', 'utf8');
    const nodeCmd = process.execPath;
    const probeRun = run(nodeCmd, ['probe.mjs'], work);
    process.stdout.write(probeRun.stdout);
    if (probeRun.code !== 0) {
      if (probeRun.stderr.trim()) console.error(probeRun.stderr.trim());
      console.error('\n[3/3] 结论：冒烟失败 → **禁止 publish**');
      return 1;
    }
    console.log('\n[3/3] 结论：冒烟通过 → 允许 publish（仍需 registry 侧三步验证）');
    return 0;
  } finally {
    cleanup();
  }
}

const code = main();
if (process.argv.includes('--expect-fail')) {
  // 负向自检：故意喂坏包时，门必须红（code=1），否则门形同虚设
  const ok = code === 1;
  console.log(`\n【负向自检】期望冒烟失败、实际 exit=${code} ⇒ ${ok ? '门有效 ✓' : '门失效 ✗'}`);
  process.exit(ok ? 0 : 1);
}
process.exit(code);
