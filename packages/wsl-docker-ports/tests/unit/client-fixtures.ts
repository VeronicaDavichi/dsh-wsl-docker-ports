/**
 * 003 Phase 5 的测试夹具（**不是**测试文件：不以 `.test.ts` 结尾，`node --test` 不会收它）
 *
 * 两种来源刻意分清：
 * - **真 fixture**：`tests/contract/fixtures/netsh-portproxy-v4tov4.raw` 的 19 条真规则，
 *   经**真解析器 + 真引擎**跑出 `DiffResult` ⇒ 「外部规则 19 条」不是手抄的数字。
 * - **手搭**：五态各造一条 `PortClassification`。五态的**归属判定**由 003 Phase 2 的单测负责；
 *   本波要证的是「每一态都能被渲染成正确的标签/色调/动作可用性」，与引擎解耦反而更准。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { diff } from '../../src/diff/engine.ts';
import type { ManagedPorts } from '../../src/diff/managed-ports.ts';
import type { DiffResult, ExternalRule, PortClassification, PortState, Scope, UnsupportedMapping } from '../../src/diff/types.ts';
import { parsePortproxyTable } from '../../src/read/netsh.ts';
import type { DockerContainer } from '../../src/read/docker.ts';
import type { PortproxyRule } from '../../src/read/netsh.ts';
import type { NatGateView, PortsSnapshot } from '../../src/client/types.ts';

export const ETH0 = '172.20.201.152';
export const OLD_ETH0 = '172.20.199.7';
export const WSL_CONFIG_PATH = 'C:\\Users\\EDY\\.wslconfig';

/**
 * 定位真 fixture。
 *
 * ⚠️ **不用 `import.meta.url`**：同一个夹具要同时被 `node --test` 与 **vitest** 加载，
 * 而 vitest（vite 的模块图）会把 `import.meta.url` 重写成 bundle 期的 URL ——
 * 实测在 jsdom 用例里会退化成 `E:\tests\contract\fixtures\…`（读不到）。
 * 改为「从 cwd 向上找」：两种运行器下 cwd 都是包目录（pnpm 也是按包设 cwd）。
 */
function fixturePath(name: string): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'tests', 'contract', 'fixtures', name);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`找不到测试 fixture：${name}（cwd=${process.cwd()}）`);
}

/** 真 fixture：19 条 `0.0.0.0:<port> → 172.20.201.152` 规则 */
export function realRules(): readonly PortproxyRule[] {
  return parsePortproxyTable(readFileSync(fixturePath('netsh-portproxy-v4tov4.raw'), 'utf8'));
}

export function rule(port: number, connectAddress = ETH0, listenAddress = '0.0.0.0'): PortproxyRule {
  return { listenAddress, listenPort: port, connectAddress, connectPort: port };
}

export function classification(state: PortState, port: number, extra: Partial<PortClassification> = {}): PortClassification {
  return {
    port,
    state,
    reason: null,
    expected: null,
    rules: [],
    drift: null,
    conflicts: [],
    scopeMismatch: false,
    ...extra,
  };
}

export function managedPorts(ports: readonly number[]): ManagedPorts {
  return ports.map((port) => ({ start: port, end: port }));
}

export function container(name: string, ports: DockerContainer['ports'] = [], state = 'running'): DockerContainer {
  return {
    id: `${name}-id`,
    names: name,
    image: `img/${name}:latest`,
    state,
    status: state === 'running' ? 'Up 2 hours' : 'Exited (0) 3 minutes ago',
    ports,
  };
}

export function unsupportedMapping(name: string, port: number): UnsupportedMapping {
  return { containerName: name, protocol: 'udp', hostIp: '0.0.0.0', hostPort: port, containerPort: port, containerPortEnd: null, reason: 'portproxy-tcp-only' };
}

/** 用**真引擎**跑出 `DiffResult`（19 条真规则 + 给定声明集合） */
export function realDiff(managed: readonly number[] = [], containers: readonly DockerContainer[] = []): DiffResult {
  const outcome = diff({
    containers,
    managedPorts: managedPorts(managed),
    rules: realRules(),
    eth0Ip: ETH0,
    localhostForwarding: true,
  });
  if (!outcome.ok) throw new Error(`夹具期望成功态，却拿到 ${outcome.reason}`);
  return outcome.result;
}

export function externalRulesFromFixture(): readonly ExternalRule[] {
  return realDiff([]).external;
}

export const NAT_OK: NatGateView = { kind: 'nat', mode: 'nat', path: WSL_CONFIG_PATH };
export const NAT_NON_NAT: NatGateView = { kind: 'non-nat', mode: 'mirrored', path: WSL_CONFIG_PATH, rawValue: 'mirrored' };

export interface SnapshotOptions {
  readonly ports?: readonly PortClassification[];
  readonly nat?: NatGateView;
  readonly docker?: PortsSnapshot['docker'];
  readonly diff?: PortsSnapshot['diff'];
  readonly scopes?: Readonly<Record<string, Scope>>;
  readonly managedPortsDecl?: readonly string[];
  readonly elevationPolicy?: PortsSnapshot['elevationPolicy'];
  readonly elevationAvailable?: boolean;
  readonly execAvailable?: boolean;
  readonly refreshedAt?: number;
  readonly distro?: PortsSnapshot['distro'];
  readonly distroError?: string | null;
  /** 012：候选监听地址（缺省 = 本机的真机读数形状：`192.168.31.129` 一块物理网卡） */
  readonly localAddresses?: PortsSnapshot['localAddresses'];
  readonly localAddressesError?: string | null;
}

/** 012 真机读数（2026-10-22：`Get-NetIPAddress` 过滤后只剩这一条） */
export const LOCAL_ADDRESSES_FIXTURE: PortsSnapshot['localAddresses'] = [{ address: '192.168.31.129', ifAlias: '以太网 4', prefixLength: 24 }];

export const FIXED_TIMESTAMP = Date.UTC(2026, 9, 9, 6, 30, 0);

export function snapshot(options: SnapshotOptions = {}): PortsSnapshot {
  const ports = options.ports ?? [];
  const counts: Record<PortState, number> = { ok: 0, missing: 0, drift: 0, conflict: 0, extra: 0 };
  for (const item of ports) counts[item.state] += 1;
  const result: DiffResult = {
    ports,
    expected: [],
    external: [],
    unsupported: [],
    counts,
    eth0Ip: ETH0,
  };
  return {
    refreshedAt: options.refreshedAt ?? FIXED_TIMESTAMP,
    nat: options.nat ?? NAT_OK,
    docker: options.docker ?? { ok: true, containers: [container('mysql-db')], emptyAfterRetry: false, argv: ['docker', 'ps', '--format', '{{json .}}'] },
    localhostForwarding: true,
    diff: options.diff ?? { ok: true, result },
    scopes: options.scopes ?? {},
    managedPortsDecl: options.managedPortsDecl ?? [],
    distro: options.distro === undefined ? { distros: [], name: 'Ubuntu2204', state: 'Running', source: 'wslDefault', staleConfig: false, message: null, stateNote: null } : options.distro,
    distroError: options.distroError ?? null,
    elevationPolicy: options.elevationPolicy ?? 'ask',
    elevationAvailable: options.elevationAvailable ?? true,
    execAvailable: options.execAvailable ?? false,
    iphlpsvcRunning: true,
    localAddresses: options.localAddresses ?? LOCAL_ADDRESSES_FIXTURE,
    localAddressesError: options.localAddressesError ?? null,
  };
}

/** 递归确认「视图模型里没有任何函数」（NFR-2 的结构性证明：无物可调） */
export function countFunctions(value: unknown, path = '$', hits: string[] = []): string[] {
  if (typeof value === 'function') {
    hits.push(path);
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => countFunctions(item, `${path}[${String(index)}]`, hits));
    return hits;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) countFunctions(inner, `${path}.${key}`, hits);
  }
  return hits;
}


