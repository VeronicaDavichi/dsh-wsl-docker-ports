/**
 * 真机事实探针（001 Phase 6 的真机验收层，T6.3）
 *
 * ## 为什么需要它
 *
 * 单测与契约测试吃的是**fixture 字节**（2026-10-08 捕获）。fixture 只能证明「解析器对那批字节是对的」，
 * 证明不了「**这台机器现在**仍是那样」。本探针把六份 Spec 依赖的 5 项真机事实当场打出来，
 * 供与 `.wslconfig` / `wsl -l -v` 的人工输出肉眼比对。
 *
 * ## 只读承诺（逐条可核对）
 *
 * | 动作 | 是否发生 | 依据 |
 * |---|---|---|
 * | 执行 `wsl.exe -l -v` | ✅ 只读 | A-4 实测：**不唤醒**发行版 |
 * | 执行 `wsl.exe -d X -- ip …` | ⚠️ **仅当该发行版本就 Running** | Stopped 时 `execInDistro` 的守卫直接返回 `DistroNotRunning`，**不执行** |
 * | 读 `%USERPROFILE%\.wslconfig` | ✅ 只读 | DESIGN §3.4：本包 SHALL NOT 写它 |
 * | 写任何文件 / 改任何配置 | ❌ 不发生 | 探针只打印，不落盘；探针**不入库**（同 Phase 5 先例） |
 *
 * 尾部的**副作用断言**是硬门：探测前后各查一次发行版状态，若 Stopped 被唤醒成 Running 就 `exit 1`
 * —— 那是 REQ-2.4 被违反，不是「探针的副作用可以接受」。
 *
 * ## 明确**不**在探针里做的事
 *
 * `netsh portproxy` 的 19 条规则与 eth0 的比对**不属本包**（001 无 netsh 解析，REQ-6.1 ⇒ 归 003）；
 * 本探针只给 003 提供它需要的三个输入（发行版 / eth0 / networkingMode）。
 *
 * 用法：`pnpm -C packages/wsl-shared probe`
 */
import { spawn } from 'node:child_process';

import {
  createExecutor,
  listDistros,
  probeEth0,
  readNetworkingMode,
  resolveDistro,
} from '../src/index.ts';

/** 原始字节捕获的超时：首次 `wsl -l -v` 实测可达 8.6s（A-4）⇒ 20s 留足余量 */
const RAW_TIMEOUT_MS = 20_000;

/** 只有真终端才上色：`pnpm probe | tee` 这类管道会把 ESC 渲染成 `[32m` 噪声 */
const USE_COLOR = process.stdout.isTTY === true;
const GREEN = (text) => (USE_COLOR ? `\u001b[32m${text}\u001b[0m` : text);
const YELLOW = (text) => (USE_COLOR ? `\u001b[33m${text}\u001b[0m` : text);
const RED = (text) => (USE_COLOR ? `\u001b[31m${text}\u001b[0m` : text);

const ms = (elapsed) => `${Math.round(elapsed)}ms`;

/**
 * 原始字节捕获：**故意不走 `createExecutor`** —— 执行器的契约是「解码成文本」，
 * 而事实①要的恰恰是**解码前**的字节指纹。这是探针（诊断工具）的特权，不是包内 API 的形状。
 */
function captureRaw(file, argv, timeoutMs) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, reason: `超时 ${timeoutMs}ms` });
    }, timeoutMs);
    timer.unref();

    const child = spawn(file, argv, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, shell: false });
    child.stdout?.on('data', (chunk) => chunks.push(chunk));
    child.on('error', (error) => done({ ok: false, reason: error.message }));
    child.on('close', (code) => done({ ok: true, code, bytes: Buffer.concat(chunks) }));
  });
}

/**
 * 事实①：`wsl -l -v` 的**原始字节**指纹（A-1 / A-2 的机器级证据）
 *
 * ⚠️ **2026-10-09 本次探针抓到的第一个真缺陷就在这里**：A-1 原先写「行尾 **LF**（无 CRLF）」，
 * 而 fixture 自身与三次实时捕获都是 **CRLF**（UTF-16LE 码元 `0d 00 0a 00`，CR 2 / LF 2）。
 * 当初多半是把同一批捕获的 `ip-eth0.raw`（那个**确实是** LF）的性质写到了发行版表上。
 * 解析器一直用 `split(/\r?\n/)` ⇒ **没有功能缺陷**，但这条文档事实从 2026-10-08 错到 2026-10-09 复测为止。
 * ⇒ 本函数不再「打印 CR 数」，而是**判定行尾**并与 A-1 的判据比对，把这条事实变成可复算的门。
 */
async function fact1RawFingerprint() {
  console.log('【1】`wsl.exe -l -v` 原始字节指纹（A-1 / A-2）');
  const captured = await captureRaw('wsl.exe', ['-l', '-v'], RAW_TIMEOUT_MS);
  if (!captured.ok) {
    console.log(`     ${RED('✗')} 捕获失败：${captured.reason}`);
    return false;
  }

  const { bytes } = captured;
  const nuls = bytes.filter((b) => b === 0).length;
  const nulRatio = bytes.length === 0 ? 0 : nuls / bytes.length;
  const hasBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  const crCount = bytes.filter((b) => b === 0x0d).length;
  const lfCount = bytes.filter((b) => b === 0x0a).length;
  const isUtf16 = hasBom || nulRatio > 0.25;
  const lineEnd = crCount === 0 ? 'LF' : crCount === lfCount ? 'CRLF' : `混合（CR ${crCount} / LF ${lfCount}）`;

  console.log(
    `     字节 ${bytes.length} · NUL ${(nulRatio * 100).toFixed(1)}% · ` +
      `BOM ${hasBom ? '有' : '无'} · 行尾 ${lineEnd} · 退出码 ${captured.code}`,
  );
  console.log(
    `     判定：${isUtf16 ? 'UTF-16LE' : 'UTF-8/ASCII'} ` +
      `${isUtf16 ? GREEN('✓ 与 A-1 一致') : RED('✗ 与 A-1 不符 —— 必须先修 A-1 再动解析器')}`,
  );
  // A-1 的另一半（2026-10-09 订正后）：行尾是 **CRLF**，不是 LF
  console.log(
    `     行尾：${lineEnd} ` +
      `${lineEnd === 'CRLF' ? GREEN('✓ 与 A-1（2026-10-09 订正）一致') : YELLOW('⚠ 与 A-1 的 CRLF 判据不符 —— 复核 fixture 与 A-1')}`,
  );
  return isUtf16;
}

const SOURCE_LABEL = {
  config: '① 配置值（显式指定）',
  wslDefault: "② WSL 默认发行版（`wsl -l -v` 行首 `*`）",
  onlyOne: '③ 唯一发行版（一个就是默认，零提问）',
  first: '④ 列表首项（多个且无默认）',
};

/** 事实②：发行版发现（REQ-1） */
async function fact2ListDistros(executor) {
  console.log('\n【2】发行版发现 `listDistros()`（REQ-1）');
  const started = performance.now();
  const listed = await listDistros(executor);
  const elapsed = performance.now() - started;

  if (!listed.ok) {
    console.log(`     ${RED('✗')} ${listed.code}：${listed.message}`);
    return { distros: [], elapsed, ok: false };
  }
  const { distros } = listed;
  console.log(`     耗时 ${ms(elapsed)}（热路径实测 115ms 量级；冷首次可达 8.6s）`);
  if (distros.length === 0) {
    console.log(`     ${YELLOW('⚠')} 命令成功但**一个发行版都没有**（REQ-1.6：这是「[] + ok」，不是错误）`);
  }
  for (const d of distros) {
    console.log(
      `     ${d.isDefault ? '*' : ' '} ${d.name.padEnd(20)} ${d.state.padEnd(10)} ` +
        `v${String(d.version)}${d.isDefault ? '   （默认）' : ''}`,
    );
  }
  return { distros, elapsed, ok: true };
}

/** 事实③：目标发行版四级解析（REQ-1.7 / D-4） */
function fact3Resolve(distros) {
  console.log('\n【3】目标发行版解析 `resolveDistro(distros)`（REQ-1.7 / D-4）');
  console.log('     不传配置项 ⇒ 同时验证「SHALL NOT 阻塞提问」');
  const resolved = resolveDistro(distros);
  if (!resolved.ok) {
    console.log(`     ${YELLOW('⚠')} ${resolved.code}：${resolved.message}`);
    return undefined;
  }
  console.log(`     命中 ${GREEN(resolved.name)}，来源：${SOURCE_LABEL[resolved.source] ?? resolved.source}`);
  return resolved.name;
}

/** 事实④：`.wslconfig` 与 networkingMode（REQ-4，组件② 的硬前提） */
async function fact4NetworkingMode() {
  console.log('\n【4】`networkingMode` 判定 `readNetworkingMode()`（REQ-4 / 组件② 硬前提）');
  const mode = await readNetworkingMode();
  if (!mode.ok) {
    console.log(`     ${RED('✗')} ${mode.code}：${mode.message}`);
    console.log('     ⇒ 按 REQ-4.6：**不得**当成缺省 NAT；组件② 应显示此原因并置灰写操作');
    return undefined;
  }
  const raw = mode.rawValue === undefined ? '（键不存在）' : `"${mode.rawValue}"`;
  console.log(`     路径 ${mode.path}`);
  console.log(`     mode=${mode.mode}（rawValue ${raw}）· resolved=${mode.resolved}`);
  console.log(
    mode.resolved === 'nat'
      ? `     ${GREEN('✓')} NAT ⇒ 组件②（WSL Docker 端口转发）硬前提**在本机成立**`
      : `     ${YELLOW('⚠')} 非 NAT ⇒ 组件② 必须置灰 + 给修复指引（不自动改 .wslconfig）`,
  );
  return mode.resolved;
}

/** 事实⑤：eth0 探测（REQ-2，且带 REQ-2.4 的零副作用证据） */
async function fact5Eth0(executor, target, distros) {
  console.log('\n【5】eth0 探测 `probeEth0()`（REQ-2）');
  if (target === undefined) {
    console.log(`     ${YELLOW('⚠')} 跳过：没有可解析的目标发行版`);
    return;
  }
  const started = performance.now();
  const outcome = await probeEth0(executor, target, distros);
  const elapsed = performance.now() - started;

  if (outcome.ok) {
    console.log(`     ${target} → ${GREEN(outcome.ip)}（耗时 ${ms(elapsed)}）`);
    console.log('     ⇒ 这就是 portproxy 规则 `connectaddress` 该写的值（坑 #4：漂移检测的基准）');
    return;
  }
  if (outcome.code === 'DistroNotRunning') {
    console.log(`     ${YELLOW('⚠')} ${outcome.code}：${outcome.message}`);
    console.log('     ⇒ **正确的保守行为**（REQ-2.4）：Stopped 时不执行 `wsl -d`，故未唤醒发行版');
    return;
  }
  console.log(`     ${RED('✗')} ${outcome.code}：${outcome.message}`);
}

const executor = createExecutor();

console.log('══ dsh-wsl-shared 真机事实探针（只读）══\n');
await fact1RawFingerprint();
const listed = await fact2ListDistros(executor);
if (!listed.ok) {
  console.error(`\n${RED('✗ 探针中止')}：发行版发现失败，后续事实无从谈起（exit 2）`);
  process.exit(2);
}
const target = fact3Resolve(listed.distros);
const resolvedMode = await fact4NetworkingMode();
await fact5Eth0(executor, target, listed.distros);

// ── 副作用断言：REQ-2.4 的「自动路径绝不唤醒」必须在真机上成立 ──────────────
console.log('\n── 副作用检查（REQ-2.4：自动路径 SHALL NOT 唤醒发行版）──');
const after = await listDistros(executor);
if (!after.ok) {
  console.log(`     ${YELLOW('⚠')} 复查失败（${after.code}），无法断言零副作用`);
} else {
  const before = new Map(listed.distros.map((d) => [d.name, d.state]));
  let violated = false;
  for (const d of after.distros) {
    const was = before.get(d.name) ?? '（新增）';
    const changed = was !== d.state;
    if (changed && was === 'Stopped' && d.state === 'Running') violated = true;
    console.log(`     ${d.name}: ${was} → ${d.state}${changed ? RED('  ← 变化') : ''}`);
  }
  if (violated) {
    console.error(`\n${RED('✗ REQ-2.4 被违反')}：探针把 Stopped 发行版唤醒了（exit 1）`);
    process.exit(1);
  }
  console.log(`     ${GREEN('✓')} 零副作用：状态与探测前一致`);
}

// ── 收尾：如实说明本探针证不了什么 ────────────────────────────────────────
console.log('\n── 本探针**不**能证明的事（如实记录）──');
console.log('  · A-6「WSL 缺省网络模式是 NAT」是**版本相关的经验值**：本机 mode=default ⇒ resolved=nat 只说明');
console.log(`    这台机器（Windows 11 23H2 / WSL 2.7.3.0）如此，不等于别的版本也如此。`);
console.log('  · 「规则是不是真的通」需要真发一次流量 —— 那是 003 的转发自检，不在这里。');
console.log(`  · 本次 resolved=${resolvedMode ?? '（读不到）'}。`);
console.log('\n✓ 探针结束（未写任何文件、未改任何配置、未唤醒任何发行版）');
