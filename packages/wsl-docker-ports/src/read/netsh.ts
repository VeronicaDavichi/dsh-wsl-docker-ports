/**
 * `netsh interface portproxy show v4tov4` 解析（003 REQ-15 / 任务 T0.1）
 *
 * **真机事实**（2026-10-08 本机捕获，原始字节见
 * `packages/wsl-docker-ports/tests/contract/fixtures/netsh-portproxy-v4tov4.raw`）：
 * - 本机输出是**纯 ASCII**（英文表头 `Listen on ipv4:`，高位字节占比 **0%**）⇒ 无需 OEM/GBK 猜测
 * - 行尾是 **CRLF**
 * - 结构：空行 → `Listen on ipv4:             Connect to ipv4:` → 空行 →
 *   `Address         Port        Address         Port` → `----- -----  ----- -----` 分隔线 → 数据行
 * - **无规则时没有分隔线**（只有表头）⇒ 用「找不到分隔线 = 空表」判定，而不是报错
 *
 * 解析策略：找到第一条**纯分隔线**，其后所有非空行必须严格是 4 列
 * （`listenAddress listenPort connectAddress connectPort`）；形状不符**抛错不猜** ——
 * 这份数据是写路径（005）的比对基准，静默丢行会让「他人规则条数不变」这条红线失去意义。
 */

export interface PortproxyRule {
  readonly listenAddress: string;
  readonly listenPort: number;
  readonly connectAddress: string;
  readonly connectPort: number;
}

export class NetshParseError extends Error {
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'NetshParseError';
    this.detail = detail;
  }
}

/** 形如 `--------------- ----------  --------------- ----------` 的分隔线 */
const SEPARATOR_RE = /^\s*-{3,}(?:\s+-{3,})+\s*$/;

export function decodeNetshOutput(input: Uint8Array | string): string {
  if (typeof input === 'string') return input;
  // 本机实测为纯 ASCII，UTF-8 解码即可。集中在**一个函数**里，将来遇到 OEM 代码页机器只改这里。
  return new TextDecoder('utf-8').decode(input);
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function parseRuleLine(line: string, lineNumber: number): PortproxyRule {
  const columns = line.trim().split(/\s+/);
  if (columns.length !== 4) {
    throw new NetshParseError('portproxy 数据行列数不是 4', { lineNumber, line, columns });
  }
  const listenAddress = columns[0] as string;
  const listenPort = Number(columns[1]);
  const connectAddress = columns[2] as string;
  const connectPort = Number(columns[3]);
  if (!isPort(listenPort) || !isPort(connectPort)) {
    throw new NetshParseError('portproxy 数据行端口不是 1..65535 的整数', {
      lineNumber,
      line,
      listenPort,
      connectPort,
    });
  }
  return { listenAddress, listenPort, connectAddress, connectPort };
}

/**
 * 解析为规则数组（顺序与 `netsh` 输出一致）。
 * 无规则 → 返回 `[]`；形状脏 → 抛 `NetshParseError`。
 */
export function parsePortproxyTable(input: Uint8Array | string): PortproxyRule[] {
  const lines = decodeNetshOutput(input).split(/\r?\n/);
  const separatorAt = lines.findIndex((line) => SEPARATOR_RE.test(line));
  if (separatorAt < 0) return [];

  const rules: PortproxyRule[] = [];
  for (let index = separatorAt + 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.trim().length === 0) continue;
    rules.push(parseRuleLine(line, index + 1));
  }
  return rules;
}
