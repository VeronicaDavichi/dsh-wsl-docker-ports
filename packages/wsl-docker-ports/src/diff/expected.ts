/**
 * 期望集构造：docker 实际映射 ∩ `managedPorts`（003 REQ-3.1 / REQ-16.2 / REQ-9.2）
 *
 * ## 三条口径
 *
 * 1. **绝不硬编码端口清单**（REQ-3.1）：来源只有 `docker ps` 的 `Ports` 列。原脚本坑 #3
 *    （硬编码 19 个端口、不知道 docker 实际映射了什么）就是在这里被消掉的。
 * 2. **不无界枚举区间**（REQ-16.2）：先与声明集合**求交**再展开，枚举量的上界是
 *    「**映射**的区间宽度」（本机是 `5002-5003` 这种），与声明集合有多大无关。
 * 3. **非 TCP 一律不生成期望项**（REQ-9.2/9.3）：UDP / SCTP 只进 `unsupported` 列表
 *    （「不支持」要标出来，但不许代偿、不许假装能转）。
 *
 * ## 未发布到宿主的映射怎么办
 *
 * `Ports` 列里形如 `8080/tcp`（没有 `host:port->`）表示「容器 EXPOSE 了但没发布到宿主」——
 * 宿主端口根本不存在，谈不上转发 ⇒ 不进期望集。（非 TCP 的**未发布**映射仍然进 `unsupported`：
 * REQ-9.2 要求「不许直接忽略该映射」。）
 */

import type { DockerContainer } from '../read/docker.ts';
import { intersectManagedRange, type ManagedPorts } from './managed-ports.ts';
import type { ExpectedForward, Scope, UnsupportedMapping } from './types.ts';

export interface ExpectedBuild {
  readonly forwards: readonly ExpectedForward[];
  readonly unsupported: readonly UnsupportedMapping[];
}

/** 同一宿主端口只应该有一个容器；聚合是为了不因重复映射而丢信息，也为了求和 `hostIps` */
interface Aggregate {
  readonly containerNames: Set<string>;
  readonly hostIps: Set<string>;
  readonly containerPort: number;
}

/** 单个端口索引用键：`Record<string, Scope>` 的键是**配置里的字符串写法**（YAML 的键天生是字符串） */
function scopeOf(scopes: Readonly<Record<string, Scope>>, port: number): Scope {
  return scopes[String(port)] ?? 'loopback';
}

export function buildExpectedForwards(
  containers: readonly DockerContainer[],
  managedPorts: ManagedPorts,
  scopes: Readonly<Record<string, Scope>> = {},
  localhostForwarding = true,
): ExpectedBuild {
  const unsupported: UnsupportedMapping[] = [];
  const byPort = new Map<number, Aggregate>();

  for (const container of containers) {
    for (const mapping of container.ports) {
      // ① 非 TCP：标「不支持」后**跳过**（REQ-9.2 不忽略 / REQ-9.3 不代偿）
      if (mapping.protocol !== 'tcp') {
        unsupported.push({
          containerName: container.names,
          protocol: mapping.protocol,
          hostIp: mapping.hostIp,
          hostPort: mapping.hostPort,
          containerPort: mapping.containerPort,
          containerPortEnd: mapping.containerPortEnd,
          reason: 'portproxy-tcp-only',
        });
        continue;
      }

      // ② 未发布到宿主（`8080/tcp`）：没有宿主端口可听，不进期望集。
      //    解析器保证 hostIp / hostPort 同时有值或同时为 null（`docker.ts` 的 `->` 判定），
      //    这里两个都判只是让类型收窄，不改变语义。
      if (mapping.hostPort === null || mapping.hostIp === null) continue;

      const hostEnd = mapping.hostPortEnd ?? mapping.hostPort;
      // ③ 先求交、再展开（REQ-16.2）：`intersectManagedRange` 已把重叠段合并，故不会重复计数
      for (const hit of intersectManagedRange(managedPorts, mapping.hostPort, hostEnd)) {
        for (let port = hit.start; port <= hit.end; port += 1) {
          const offset = port - mapping.hostPort;
          const aggregate = byPort.get(port);
          if (aggregate === undefined) {
            byPort.set(port, {
              containerNames: new Set([container.names]),
              hostIps: new Set([mapping.hostIp]),
              // 映射区间是 1:1 的（`5002-5003->5002-5003/tcp`），故容器侧端口按同一偏移平移
              containerPort: mapping.containerPort + offset,
            });
            continue;
          }
          aggregate.containerNames.add(container.names);
          aggregate.hostIps.add(mapping.hostIp);
        }
      }
    }
  }

  const forwards: ExpectedForward[] = [...byPort.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([port, aggregate]) => {
      const scope = scopeOf(scopes, port);
      return {
        port,
        protocol: 'tcp',
        scope,
        // `lan` 必须有规则（005 REQ-2.3）；`loopback` 只在 WSL 自带转发被关掉时才需要（REQ-2.2/2.5）
        needsRule: scope === 'lan' || !localhostForwarding,
        containerNames: [...aggregate.containerNames],
        containerPort: aggregate.containerPort,
        hostIps: [...aggregate.hostIps],
      };
    });

  return { forwards, unsupported };
}
