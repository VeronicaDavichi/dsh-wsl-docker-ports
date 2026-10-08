/**
 * eth0 IPv4 探测（001 REQ-2 / 任务 T3.1–T3.3）
 *
 * ## 真机事实（2026-10-08 实测，原始字节见 `tests/contract/fixtures/ip-eth0.raw`）
 *
 * - `wsl.exe -d X -- ip -4 -o addr show dev eth0` 的输出是 **UTF-8**（NUL 占比 **0.0%**、无 CRLF），
 *   与 `wsl -l -v` 的 **UTF-16LE** **不同** ⇒ 同一个 `wsl.exe`：自带消息 UTF-16LE、透传 Linux
 *   子进程字节 UTF-8。**必须由调用方显式声明编码**（本模块固定 `utf8`），绝不能猜 ——
 *   猜成 UTF-16LE 会把 `inet 172.…` 解成乱码 ⇒ 误判为「eth0 没有 IPv4」（假阴性）。
 * - 冷启动（Stopped → 命令返回）实测 **12,637ms**；热路径 **192 / 218 / 237ms**。
 * - `-o` 单行格式在主地址之后还有 `\` + 空格续行（`… scope global eth0\  valid_lft …`），
 *   解析只认 `inet <ip>/<prefix>`，其余原样忽略。
 * - eth0 实测 `172.20.201.152/20`、brd `172.20.207.255`（与 19 条规则 connectaddress 一致）。
 *
 * ## 为什么绝不回落（REQ-2.3）
 *
 * 取不到就报 `NoInterface`：静默回落成 `127.0.0.1` / `0.0.0.0` / 空串会让 portproxy 规则
 * 指向**错误地址**（handover 原脚本坑 #4 的同类错误 —— 那种错误不会报错，只会"连不上"）。
 */

import { fail, type WslSharedError } from './errors.ts';
import { guardDistroExists, type WslDistro } from './distros.ts';
import type { Executor } from './exec.ts';

/** 热路径超时：实测热路径 192–237ms，留足余量；**不覆盖**冷启动（见下） */
export const ETH0_PROBE_TIMEOUT_MS = 10_000;
/** 显式启动路径的超时：冷启动实测 12,637ms（还会连带拉起 WSL 内服务） */
export const ETH0_COLD_START_TIMEOUT_MS = 30_000;

/**
 * `ip -4 -o addr` 里的 `inet <ipv4>/<prefix>`；`inet6` 不会被命中（`inet` 后紧跟 `6`，不满足 `\s+`）。
 * ⚠️ 带 `/g` 的常量正则**只配 `matchAll` 用**（`matchAll` 内部克隆，不动 `lastIndex`）；
 * 改成循环 `exec`/`test` 会引入跨调用的 `lastIndex` 状态 —— 那正是上一轮自审抓到的同类坑。
 */
const INET_V4 = /\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\s*\//g;

/** 点分四段且每段 0–255；**拒绝前导零**（`010` 之类不是合法点分十进制） */
function isIpv4(candidate: string): boolean {
  const parts = candidate.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

/**
 * 结构上**不可能**作为 portproxy connectaddress 的两个地址：
 * `0.0.0.0`（`ip` 用它表示"未设置"）与 `127.0.0.0/8`（环回 —— 主机转发到 WSL 的环回没有意义）。
 * 跳过它们同时兜住一个误用：万一传进来的不是 `dev eth0` 的输出（例如 `lo` 那行），
 * 也不会把 `127.0.0.1` 当成 eth0 地址悄悄写进规则（REQ-2.3 明令禁止回落）。
 */
function isUnusableAddress(candidate: string): boolean {
  return candidate === '0.0.0.0' || candidate.startsWith('127.');
}

/**
 * 从 `ip -4 -o addr` 输出里取**首个** IPv4（REQ-2.2：不返回数组、不拼接）。
 *
 * 返回 `undefined` = 没有可用地址（调用方转成 `NoInterface`，REQ-2.3）。
 * 只跳过 `0.0.0.0` 与 `127.0.0.0/8`（见上）；其余原样返回，**不替用户美化** ——
 * 例如 `169.254.x.x`（DHCP 失败的链路本地地址）会照原样返回：那是发行版的网络问题，
 * 不是解析器该替它掩盖的事。
 */
export function parseEth0Address(input: Uint8Array | string): string | undefined {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
  for (const match of text.matchAll(INET_V4)) {
    const candidate = match[1];
    if (candidate === undefined || !isIpv4(candidate) || isUnusableAddress(candidate)) continue;
    return candidate;
  }
  return undefined;
}

/** 探测选项 */
export interface Eth0ProbeOptions {
  /** 覆盖单次探测超时；默认按是否允许冷启动取两个常量之一 */
  readonly timeoutMs?: number;
  /**
   * ⚠️ **只允许在用户显式动作时传 true**（REQ-2.4 的唯一例外：「启动并核验」/「用这个发行版」）。
   * 传 true 意味着这次调用会**冷启动发行版**（实测 12,637ms，并连带拉起 WSL 内 dockerd 与用户的
   * 全部容器）⇒ 调用方 SHALL 在动作前明示代价。
   */
  readonly allowColdStart?: boolean;
}

/** 探测结果：成功带 IP，失败带 typed error（不抛异常） */
export type Eth0Outcome = { readonly ok: true; readonly ip: string } | WslSharedError;

/**
 * 探测目标发行版的 eth0 IPv4（REQ-2.1–2.5）。
 *
 * 顺序即防线：**① 存在性守卫（REQ-2.5）→ ② 状态守卫（REQ-2.4，非 Running 一律不执行
 * `wsl -d`）→ ③ 执行 → ④ 解析（取不到 → `NoInterface`）**。
 * 第 ② 步是「绝不用自动路径叫醒发行版」的落点：`wsl -d X -- …` 本身就会启动 X。
 */
export async function probeEth0(
  executor: Executor,
  distro: string,
  distros: readonly WslDistro[],
  options: Eth0ProbeOptions = {},
): Promise<Eth0Outcome> {
  // ① REQ-2.5：名字不存在 → DistroNotFound，错误里必须带可用发行版名列表
  const missing = guardDistroExists(distro, distros);
  if (missing !== undefined) return missing;

  // 用列表里的**权威名字**拼 argv（大小写以 WSL 为准，不用调用方的写法）
  const wanted = distro.trim().toLowerCase();
  const row = distros.find((d) => d.name.toLowerCase() === wanted);
  if (row === undefined) {
    // 逻辑上已被 guardDistroExists 拦下；这里只做类型收窄，错误口径保持一致
    return fail('DistroNotFound', `发行版「${distro}」不存在`, {
      distros: distros.map((d) => d.name),
    });
  }

  const allowColdStart = options.allowColdStart === true;
  // ② REQ-2.4：非 Running 直接报错，**不执行**命令（执行即冷启动，实测 12.6s + 拉起用户容器）
  if (!allowColdStart && row.state !== 'Running') {
    return fail(
      'DistroNotRunning',
      `发行版「${row.name}」当前是 ${row.state}，未自动启动（冷启动约 10–12 秒，且会拉起 WSL 内服务）`,
    );
  }

  // ③ 编码固定 utf8：真机指纹 NUL 0.0%（见文件头），**不改用 utf16le** —— 那是 `wsl -l -v` 的形态
  const argv = ['-d', row.name, '--', 'ip', '-4', '-o', 'addr', 'show', 'dev', 'eth0'];
  const outcome = await executor('wsl.exe', argv, {
    encoding: 'utf8',
    timeoutMs:
      options.timeoutMs ?? (allowColdStart ? ETH0_COLD_START_TIMEOUT_MS : ETH0_PROBE_TIMEOUT_MS),
  });
  if (!outcome.ok) return outcome;

  // ④ REQ-2.2/2.3：取首个；取不到 → NoInterface（绝不回落，绝不返回空串）
  const ip = parseEth0Address(outcome.stdout);
  if (ip === undefined) {
    return fail('NoInterface', `发行版「${row.name}」的 eth0 上没有 IPv4 地址`, {
      argv: ['wsl.exe', ...argv],
      stderr: outcome.stderr,
    });
  }

  return { ok: true, ip };
}
