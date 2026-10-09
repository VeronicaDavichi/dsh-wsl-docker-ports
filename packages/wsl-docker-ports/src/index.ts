/**
 * `dsh-wsl-docker-ports` 公开面（003 Phase 0–2）。
 *
 * ⚠️ 本包是**插件包**（有 `cordis.patch.yml`、配置页、UI），但那是 Phase 5+ 的事。当前落地：
 *
 * - **Phase 0（T0.1/T0.2）**：`read/netsh.ts` 与 `read/docker.ts` 的纯解析（真机 fixture 契约测试）
 * - **Phase 1（T1.1–T1.3）**：`read/*-probe.ts` 把解析接到 001 的执行器上（超时 + 重试 + 可区分失败）、
 *   `read/localhost-forwarding.ts` 自读 `.wslconfig`（005 REQ-2.5 的单消费者键）
 * - **Phase 2（T2.1–T2.5）**：`diff/` 的五态纯函数 + 外部规则只读集合 + 不可转发映射
 *
 * 还没落地：Phase 3（`managedPorts` 字符串/区间解析）· Phase 5（UI）· Phase 6（质量门）；
 * 写路径与提权（`src/write/` `src/elevate/`）属 **005**，不在本 Spec。
 *
 * 依赖方向：**只消费** `dsh-wsl-shared`（001）的公开面；不 import 002（`dsh-terminal-profiles`），
 * 与它的关系只有 Phase 5 的字符串键可选注入（REQ-10.2）。
 */

export {
  decodeNetshOutput,
  NetshParseError,
  parsePortproxyTable,
  type PortproxyRule,
} from './read/netsh.ts';

export {
  DockerParseError,
  parseDockerPorts,
  parseDockerPsJsonl,
  type DockerContainer,
  type DockerPortMapping,
  type DockerPortProtocol,
} from './read/docker.ts';

export { probeFailure, type ProbeFailure, type ProbeFailureParts } from './read/probe.ts';
export { redactOutput } from './read/redact.ts';

export {
  DOCKER_PS_ARGV,
  DOCKER_PS_ATTEMPTS,
  DOCKER_PS_TIMEOUT_MS,
  probeDockerPs,
  type DockerProbeReason,
  type DockerPsOptions,
  type DockerPsOutcome,
  type DockerPsSuccess,
} from './read/docker-probe.ts';

export {
  NETSH_ARGV,
  NETSH_TIMEOUT_MS,
  probePortproxyRules,
  type NetshProbeOptions,
  type NetshProbeReason,
  type PortproxyOutcome,
  type PortproxySuccess,
} from './read/netsh-probe.ts';

export {
  parseLocalhostForwardingValue,
  readLocalhostForwarding,
  type LocalhostForwarding,
  type LocalhostForwardingDeps,
  type LocalhostForwardingOutcome,
  type LocalhostForwardingSource,
  type ReadFileLike,
} from './read/localhost-forwarding.ts';

export {
  createEth0Source,
  type Eth0ProbeOverride,
  type Eth0Source,
  type Eth0SourceOptions,
} from './read/eth0-source.ts';

export {
  intersectManagedRange,
  isManagedPort,
  singlePort,
  type ManagedPortRange,
  type ManagedPorts,
} from './diff/managed-ports.ts';

export { buildExpectedForwards, type ExpectedBuild } from './diff/expected.ts';

export {
  classifyPorts,
  collectExternalRules,
  diff,
  expectedListenAddress,
} from './diff/engine.ts';

export {
  PORT_STATES,
  type ClassifyReason,
  type DiffFailure,
  type DiffInput,
  type DiffOutcome,
  type DiffResult,
  type DriftDetail,
  type ExpectedForward,
  type ExpectedProtocol,
  type ExternalRule,
  type PortClassification,
  type PortState,
  type Scope,
  type UnsupportedMapping,
} from './diff/types.ts';
