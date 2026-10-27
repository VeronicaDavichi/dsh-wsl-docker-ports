/**
 * `docker ps --format '{{json .}}'` 解析（003 REQ-2 / 任务 T0.1）
 *
 * 🔴 **真机事实 1（`--format json` 会挂住）**：docker server 29.5.3 上 `docker ps --format json`
 * **不返回**（两次被 `timeout` 杀掉，rc=124），必须用 `--format '{{json .}}'`（每容器一行 JSON）。
 * ⇒ 本解析器**只需单路径**：行分隔 JSON（JSON Lines），不做双路径兜底。
 *
 * 🔴 **真机事实 2（唤醒后第一次调用会超时）**：发行版冷启动后立刻跑 `docker ps`，第一次被
 * `timeout 20` 砍掉（0 输出）；5s 后第二次 637ms 成功。⇒ 调用方必须有**超时 + 重试**，
 * 不可把第一次的空输出当成「没有容器」。
 *
 * 🔴 **真机事实 3（`Ports` 列的三种形态）**，全部来自本机真实输出：
 * - `0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp`（IPv4 + IPv6 各一份）
 * - `0.0.0.0:5002-5003->5002-5003/tcp, [::]:5002-5003->5002-5003/tcp`（**端口区间**）
 * - `""`（未发布任何端口）
 *
 * 字段名以实测键为准（同一台机器、docker 29.5.3）：
 * `Command, CreatedAt, HealthStatus, ID, Image, Labels, LocalVolumes, Mounts, Names, Networks,
 *  Platform, Ports, RunningFor, Size, State, Status`
 */

export type DockerPortProtocol = 'tcp' | 'udp' | 'sctp';

export interface DockerPortMapping {
  /** 未发布端口时为 `null`（`Ports` 里形如 `8080/tcp`）；IPv6 形态原样保留（如 `[::]`） */
  readonly hostIp: string | null;
  readonly hostPort: number | null;
  /** 区间右端；非区间为 `null`（如 `5002-5003` → 5002 / 5003） */
  readonly hostPortEnd: number | null;
  readonly containerPort: number;
  readonly containerPortEnd: number | null;
  readonly protocol: DockerPortProtocol;
}

export interface DockerContainer {
  readonly id: string;
  readonly names: string;
  readonly image: string;
  readonly state: string;
  readonly status: string;
  readonly ports: readonly DockerPortMapping[];
}

export class DockerParseError extends Error {
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DockerParseError';
    this.detail = detail;
  }
}

const PORT_RANGE_RE = /^(\d{1,5})(?:-(\d{1,5}))?$/;
const PROTOCOLS: readonly string[] = ['tcp', 'udp', 'sctp'];

function parsePortRange(text: string, context: Record<string, unknown>): { start: number; end: number | null } {
  const match = PORT_RANGE_RE.exec(text);
  if (match === null) {
    throw new DockerParseError('端口不是 `N` 或 `N-M` 形态', { ...context, text });
  }
  const start = Number(match[1]);
  const end = match[2] === undefined ? null : Number(match[2]);
  if (start < 1 || start > 65535 || (end !== null && (end < start || end > 65535))) {
    throw new DockerParseError('端口越界（1..65535，且区间右端不得小于左端）', { ...context, text });
  }
  return { start, end };
}

/**
 * 解析 `Ports` 列（单个容器的整串，可能是逗号分隔的多段）。
 * 未发布任何端口时传 `''` → 返回 `[]`。
 */
export function parseDockerPorts(field: string): DockerPortMapping[] {
  const mappings: DockerPortMapping[] = [];
  for (const segment of field.split(',')) {
    const text = segment.trim();
    if (text.length === 0) continue;
    const context = { field, segment: text };

    const arrowAt = text.indexOf('->');
    const containerSide = arrowAt < 0 ? text : text.slice(arrowAt + 2);
    const slashAt = containerSide.lastIndexOf('/');
    if (slashAt < 0) {
      throw new DockerParseError('端口段缺少 `/协议`', context);
    }
    const protocol = containerSide.slice(slashAt + 1).toLowerCase();
    if (!PROTOCOLS.includes(protocol)) {
      throw new DockerParseError('未知协议', { ...context, protocol });
    }
    const container = parsePortRange(containerSide.slice(0, slashAt), context);

    let hostIp: string | null = null;
    let hostPort: number | null = null;
    let hostPortEnd: number | null = null;
    if (arrowAt >= 0) {
      const hostSide = text.slice(0, arrowAt);
      const colonAt = hostSide.lastIndexOf(':');
      if (colonAt < 0) {
        throw new DockerParseError('宿主侧缺少 `地址:端口`', context);
      }
      hostIp = hostSide.slice(0, colonAt);
      const host = parsePortRange(hostSide.slice(colonAt + 1), context);
      hostPort = host.start;
      hostPortEnd = host.end;
    }

    mappings.push({
      hostIp,
      hostPort,
      hostPortEnd,
      containerPort: container.start,
      containerPortEnd: container.end,
      protocol: protocol as DockerPortProtocol,
    });
  }
  return mappings;
}

function requireString(source: Record<string, unknown>, key: string, lineNumber: number): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new DockerParseError(`字段 \`${key}\` 不是字符串`, { lineNumber, key, value });
  }
  return value;
}

/**
 * 解析 JSON Lines（每行一个容器）。空行跳过；非法行**抛错**（静默跳过会让 UI 少显示容器却毫无提示）。
 */
export function parseDockerPsJsonl(input: string): DockerContainer[] {
  const containers: DockerContainer[] = [];
  const lines = input.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] as string).trim();
    if (line.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      throw new DockerParseError('docker ps 的行不是合法 JSON', {
        lineNumber: index + 1,
        line,
        cause: String(cause),
      });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new DockerParseError('docker ps 的 JSON 行不是对象', { lineNumber: index + 1 });
    }
    const record = parsed as Record<string, unknown>;
    const ports = record['Ports'];
    if (typeof ports !== 'string') {
      throw new DockerParseError('字段 `Ports` 不是字符串', { lineNumber: index + 1 });
    }
    containers.push({
      id: requireString(record, 'ID', index + 1),
      names: requireString(record, 'Names', index + 1),
      image: requireString(record, 'Image', index + 1),
      state: requireString(record, 'State', index + 1),
      status: requireString(record, 'Status', index + 1),
      ports: parseDockerPorts(ports),
    });
  }
  return containers;
}
