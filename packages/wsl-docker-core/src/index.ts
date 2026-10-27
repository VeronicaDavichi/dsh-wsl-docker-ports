/**
 * `dsh-wsl-docker-core` 的**唯一**公开面（barrel）。
 *
 * 判据（016）：两个插件包**只许** `import … from 'dsh-wsl-docker-core'`（`scripts/check-borders.mjs` 钉死）；
 * 本文件由 `016` 的迁移脚本按「插件包真正 import 到的名字」生成（type / value 分开，不多导一个）。
 * 新增共享件时改 `packages/wsl-docker-core/src/**` 后重跑脚本，**不要**在插件包里绕过 barrel 深引。
 */

export { createConfigFieldReader, readConfigToken, readConfigValue, unwrapConfigRefreshInterval, unwrapConfigString, unwrapConfigStringArray, unwrapConfigStringRecord, unwrapConfigValue } from './config-read.ts';
export type { ConfigValueSource, VolatileRefLike } from './config-read.ts';

export { WRITE_AUTHORIZATION_HEADER, WRITE_TOKEN_QUERY_PARAM, createWriteAuthenticator, readWriteCredential } from './credential.ts';
export type { CredentialRequestLike, WriteAuthFailure, WriteAuthResult, WriteAuthenticator, WriteHeaderBag } from './credential.ts';

export { classifyUpstreamFailure, errorCodeOf, errorMessage } from './errors.ts';
export type { UpstreamFailureClass } from './errors.ts';

export { answerHealth, healthPath } from './health.ts';
export type { HealthPayload } from './health.ts';

export { WEB_SERVER_SERVICE, isWebServerSurface, pathOf, queryOf, readJsonBody, resolveWebServer, sendJson } from './http.ts';
export type { BodyRequestLike, HttpRequestLike, HttpResponseLike, RoutePluginContextLike, WebServerRoute, WebServerSurfaceLike } from './http.ts';

export { DOCKER_PS_ARGV, probeDockerPs } from './read/docker-probe.ts';
export type { DockerPsOptions, DockerPsOutcome } from './read/docker-probe.ts';

export { parseDockerPorts, parseDockerPsJsonl } from './read/docker.ts';
export type { DockerContainer, DockerPortMapping, DockerPortProtocol } from './read/docker.ts';

export { createEth0Source } from './read/eth0-source.ts';
export type { Eth0Source, Eth0SourceOptions } from './read/eth0-source.ts';

export { FIREWALL_NAME_PREFIX, probeFirewallRuleNames } from './read/firewall-probe.ts';

export { probeListeners } from './read/listeners-probe.ts';
export type { ListenersOutcome, ListenersProbeOptions } from './read/listeners-probe.ts';

export { isEth0Bind, isLoopbackBind, isWildcardBind } from './read/listeners.ts';
export type { ListenerEntry, ListenerTable } from './read/listeners.ts';

export { probeLocalAddresses } from './read/local-addresses.ts';
export type { LocalAddressEntry, LocalAddressesOptions } from './read/local-addresses.ts';

export { readLocalhostForwarding } from './read/localhost-forwarding.ts';
export type { LocalhostForwardingDeps, LocalhostForwardingOutcome } from './read/localhost-forwarding.ts';

export { NETSH_ARGV, probePortproxyRules } from './read/netsh-probe.ts';
export type { NetshProbeOptions, PortproxyOutcome } from './read/netsh-probe.ts';

export { parsePortproxyTable } from './read/netsh.ts';
export type { PortproxyRule } from './read/netsh.ts';

export { redactOutput } from './read/redact.ts';

export { HOST_SCHEMA_MODULE, buildConfigSchema, createConfigDiagnostics, hostModuleAnchors, isSchemaFactory, memberOf, resolveSchemaFactory } from './schema.ts';
export type { ConfigDiagnostics, HostModuleAttempt, SchemaFactory, SchemaLike, SchemaResolution } from './schema.ts';
