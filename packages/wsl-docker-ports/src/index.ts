/**
 * `dsh-wsl-docker-ports` 只读事实层公开面（003 Phase 0 落地部分）。
 *
 * ⚠️ 本包是**插件包**（有 `cordis.patch.yml`、配置页、UI），但那是 Phase 1+ 的事。
 * 当前只有 T0.1 的**只读解析**：`netsh portproxy` 表 + `docker ps` JSON Lines。
 * 五态分类（REQ-3）、NAT 门（REQ-4）、写路径（005）都还没落地。
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
