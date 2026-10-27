/**
 * 测试数据构造器（003 Phase 1/2）
 *
 * 刻意都走**真解析器**（`parseDockerPorts` / `parsePortproxyTable`）造数据，而不是手搓对象字面量：
 * 手搓的对象只能证明「引擎对手搓输入的反应」，走解析器才能证明「真机形态 → 引擎」这条链是通的。
 */

import type { WslDistro, WslDistroState } from 'dsh-wsl-shared';

import { parseDockerPorts, type DockerContainer } from 'dsh-wsl-docker-core';
import type { PortproxyRule } from 'dsh-wsl-docker-core';

export const ETH0 = '172.20.201.152';

export function distro(
  name: string,
  state: WslDistroState = 'Running',
  isDefault = true,
): WslDistro {
  return { name, state, version: 2, isDefault };
}

/** 一个容器；`ports` 传 `docker ps` 的 `Ports` 列原文（空串 = 未发布任何端口） */
export function container(names: string, ports: string): DockerContainer {
  return {
    id: `dead${names.replace(/[^a-z0-9]/gi, '')}`.padEnd(12, '0').slice(0, 12),
    names,
    image: 'registry.example/svc:1.0.0',
    state: 'running',
    status: 'Up 17 seconds',
    ports: parseDockerPorts(ports),
  };
}

/** 一条既有 portproxy 规则 */
export function rule(
  listenAddress: string,
  listenPort: number,
  connectAddress: string,
  connectPort: number,
): PortproxyRule {
  return { listenAddress, listenPort, connectAddress, connectPort };
}

/** 本机 19 条既有规则里最常见的形态：`0.0.0.0:<p> → <eth0>:<p>` */
export function ruleToEth0(port: number, listenAddress = '0.0.0.0'): PortproxyRule {
  return rule(listenAddress, port, ETH0, port);
}
