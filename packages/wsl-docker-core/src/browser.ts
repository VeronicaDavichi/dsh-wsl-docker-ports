/**
 * `dsh-wsl-docker-core/browser` —— **能给浏览器 bundle 用的那半个 core**
 *
 * ## 为什么需要一个单独的入口
 *
 * core 里两类东西混在一个 barrel 里：
 *
 * 1. **纯的**：错误模型、HTTP 信封、只读解析器（`docker ps` 的 jsonl / `netsh show` 的表格 /
 *    `ss -ltn`）、脱敏、监听地址判定、健康载荷构造 —— 零 `node:*`，浏览器可以照用；
 * 2. **只属于宿主进程的**：多锚点 `createRequire` 解析宿主 schemastery（`node:module` / `node:fs`
 *    / `node:path` / `node:os`）、探针执行（`node:child_process` 经 `dsh-wsl-shared`）、凭据摘要
 *    （`node:crypto`）。
 *
 * 插件的**客户端 chunk 会被 esbuild 从 `src/client/**` 顺着 import 图整个打进去**，而转发包有一条
 * 真实链路 `client/drift-fix.ts → write/plan.ts → write/guards.ts → write/firewall.ts → core`
 * （构建客户端时要「本机能不能写」的规则文案）。只要那条链落到**主 barrel**，整包 node 侧就被
 * 拖进浏览器产物 —— 016 实测报错正是这一形态：
 *
 * ```text
 * X [ERROR] Could not resolve "node:fs"      ../wsl-docker-core/src/schema.ts:33
 * X [ERROR] Could not resolve "node:crypto"  ../wsl-docker-core/src/credential.ts:22
 * ```
 *
 * ⇒ 浏览器侧一律从这个**子入口**取；宿主侧（插件包的 `src/**` 非 client 部分）继续用主 barrel。
 *
 * ## 纪律
 *
 * - 本文件**只许** re-export **零 `node:*`** 的模块。新增一行前，先确认它整条 import 链上没有
 *   `node:` 前缀 —— `scripts/check-borders.mjs` 的 R7 会**实打实地打一次 esbuild** 来验这件事
 *   （不靠人眼）。
 * - 这里**不是**第二个「什么都往里塞」的 barrel：它按「浏览器能不能用」来划，不按模块类型划。
 */

// ── 纯的：错误模型 / HTTP 信封 / 健康载荷 ──────────────────────────────
export { classifyUpstreamFailure, errorCodeOf, errorMessage } from './errors.ts';
export type { UpstreamFailureClass } from './errors.ts';
export { answerHealth, healthPath } from './health.ts';
export type { HealthPayload } from './health.ts';
export { WEB_SERVER_SERVICE, isWebServerSurface, pathOf, queryOf, sendJson } from './http.ts';
export type { HttpRequestLike, HttpResponseLike, RoutePluginContextLike, WebServerRoute, WebServerSurfaceLike } from './http.ts';

// ── 纯的：只读解析器（**不碰执行器**，只在字符串上工作） ─────────────────
export { parseDockerPorts, parseDockerPsJsonl } from './read/docker.ts';
export type { DockerContainer, DockerPortMapping, DockerPortProtocol } from './read/docker.ts';
export { FIREWALL_NAME_PREFIX } from './read/firewall-probe.ts';
export { isEth0Bind, isLoopbackBind, isWildcardBind } from './read/listeners.ts';
export type { ListenerEntry, ListenerTable } from './read/listeners.ts';
export { parsePortproxyTable } from './read/netsh.ts';
export type { PortproxyRule } from './read/netsh.ts';
export { redactOutput } from './read/redact.ts';
